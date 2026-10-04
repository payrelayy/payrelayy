// Credential-free transport diagnostic. Never starts the one-job operator.
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREVIEW_PATH = '/fetanagent/transport-preview';
export const CONTENT_TYPE = 'application/vnd.fetanagent.companion-device-bridge+json';
const MAX_RESPONSE_BYTES = 8 * 1_024 + 16 * 1_024 + 4;
const CHALLENGE = /^[0-9a-f]{32}$/u;

export class TransportPreviewUnavailableError extends Error {
  constructor(stage, category = stage) {
    super('The non-executing connection preview is unavailable.');
    this.stage = stage;
    this.category = category;
  }
}

function requireValue(value) {
  if (!value) throw new TransportPreviewUnavailableError('local_preflight');
}

function canonicalFile(path) {
  requireValue(
    typeof path === 'string' &&
      /^[A-Za-z]:\\/u.test(path) &&
      path.length <= 220 &&
      win32.normalize(path) === path &&
      !/[\u0000-\u001f\u007f]/u.test(path),
  );
  const stat = lstatSync(path);
  requireValue(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      realpathSync.native(path).toLowerCase() === path.toLowerCase(),
  );
  return path;
}

export function parsePreviewConnection(text) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text) <= 8 * 1_024);
  const document = JSON.parse(text);
  requireValue(document?.version === 2);
  const connection = document.connection;
  requireValue(
    connection &&
      typeof connection === 'object' &&
      !Array.isArray(connection) &&
      Object.keys(connection).sort().join(',') ===
        'identityFile,knownHostsFile,remoteHostIpv4,remoteLoopbackPort,remoteSshPort,remoteUser' &&
      typeof connection.remoteHostIpv4 === 'string' &&
      isIP(connection.remoteHostIpv4) === 4 &&
      connection.remoteUser === 'fetanagent-operator' &&
      Number.isInteger(connection.remoteSshPort) &&
      connection.remoteSshPort >= 1 &&
      connection.remoteSshPort <= 65_535 &&
      connection.remoteLoopbackPort === 743 &&
      typeof connection.identityFile === 'string' &&
      typeof connection.knownHostsFile === 'string' &&
      !/\s/u.test(connection.knownHostsFile),
  );
  return Object.freeze({ ...connection });
}

// A parity test binds these arguments to the shipped companion transport.
export function previewSshArguments(connection) {
  return [
    '-F',
    'none',
    '-p',
    String(connection.remoteSshPort),
    '-i',
    connection.identityFile,
    '-o',
    `UserKnownHostsFile=${connection.knownHostsFile}`,
    '-o',
    'GlobalKnownHostsFile=NUL',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'UpdateHostKeys=no',
    '-o',
    'VerifyHostKeyDNS=no',
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'IdentityAgent=none',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'NumberOfPasswordPrompts=0',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ConnectTimeout=5',
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'ServerAliveInterval=5',
    '-o',
    'ServerAliveCountMax=1',
    '-T',
    '-W',
    `127.0.0.1:${connection.remoteLoopbackPort}`,
    `${connection.remoteUser}@${connection.remoteHostIpv4}`,
  ];
}

export function previewResponse(challenge) {
  requireValue(typeof challenge === 'string' && CHALLENGE.test(challenge));
  return JSON.stringify({ version: 1, challenge, transportOnly: true });
}

export function createTransportPreviewServer(challenge, { port = 743, lifetimeMs = 90_000 } = {}) {
  requireValue(CHALLENGE.test(challenge));
  const expected = JSON.stringify({ version: 1, challenge });
  const response = previewResponse(challenge);
  let accepted = false;
  const server = createServer({ maxHeaderSize: 8 * 1_024 }, (request, reply) => {
    if (
      accepted ||
      request.method !== 'POST' ||
      request.url !== PREVIEW_PATH ||
      request.headers.host !== '127.0.0.1' ||
      request.headers['content-type'] !== CONTENT_TYPE ||
      request.headers['content-length'] !== String(Buffer.byteLength(expected)) ||
      request.headers['transfer-encoding'] !== undefined ||
      request.headers['content-encoding'] !== undefined
    ) {
      reply.writeHead(404, { Connection: 'close' });
      reply.end();
      return;
    }
    const chunks = [];
    let size = 0;
    request.on('error', () => undefined);
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 128) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (accepted || Buffer.concat(chunks).toString('utf8') !== expected) {
        reply.writeHead(404, { Connection: 'close' });
        reply.end();
        return;
      }
      accepted = true;
      reply.writeHead(200, {
        'Content-Type': CONTENT_TYPE,
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(response),
        Connection: 'close',
      });
      reply.end(response);
      server.close();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.setTimeout(10_000, (socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  const deadline = setTimeout(() => {
    server.close();
    server.closeAllConnections();
  }, lifetimeMs);
  server.once('close', () => clearTimeout(deadline));
  server.once('error', () => clearTimeout(deadline));
  server.listen(port, '127.0.0.1');
  return server;
}

function parseResponse(raw, challenge) {
  const boundary = raw.indexOf('\r\n\r\n');
  if (boundary < 12 || boundary > 8 * 1_024) throw new Error();
  const lines = raw.subarray(0, boundary).toString('latin1').split('\r\n');
  if (lines.shift() !== 'HTTP/1.1 200 OK') throw new Error();
  const headers = new Map();
  for (const line of lines) {
    const separator = line.indexOf(':');
    const name = line.slice(0, separator).toLowerCase();
    if (separator < 1 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(name) || headers.has(name))
      throw new Error();
    headers.set(name, line.slice(separator + 1).trim());
  }
  const expected = previewResponse(challenge);
  if (
    headers.get('content-length') !== String(Buffer.byteLength(expected)) ||
    headers.get('content-type') !== CONTENT_TYPE ||
    headers.get('cache-control') !== 'no-store' ||
    headers.has('transfer-encoding') ||
    headers.has('content-encoding') ||
    raw.subarray(boundary + 4).toString('utf8') !== expected
  )
    throw new Error();
}

function failureCategory(stderr) {
  if (/Permission denied|no mutual signature|Load key|invalid format/iu.test(stderr))
    return 'ssh_authentication';
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/iu.test(stderr))
    return 'host_key_rejected';
  if (/administratively prohibited|connect failed: Connection refused/iu.test(stderr))
    return 'forwarding_refused';
  if (/Connection timed out|Connection timeout/iu.test(stderr)) return 'connection_timeout';
  return 'ssh_transport';
}

export async function previewWithSpawn(
  connection,
  windowsRoot,
  challenge,
  spawnChild = spawn,
  timeoutMs = 10_000,
) {
  requireValue(CHALLENGE.test(challenge));
  const body = Buffer.from(JSON.stringify({ version: 1, challenge }));
  const header = Buffer.from(
    `POST ${PREVIEW_PATH} HTTP/1.1\r\n` +
      'Host: 127.0.0.1\r\n' +
      `Accept: ${CONTENT_TYPE}\r\n` +
      `Content-Type: ${CONTENT_TYPE}\r\n` +
      `Content-Length: ${body.length}\r\n` +
      'Connection: close\r\n\r\n',
  );
  const chunks = [];
  const errors = [];
  let child;
  let timeout;
  let terminationTimeout;
  let stage = 'ssh_transport';
  try {
    child = spawnChild(
      win32.join(windowsRoot, 'System32', 'OpenSSH', 'ssh.exe'),
      previewSshArguments(connection),
      {
        shell: false,
        detached: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          SystemRoot: windowsRoot,
          WINDIR: windowsRoot,
          PROGRAMDATA: win32.join(win32.parse(windowsRoot).root, 'ProgramData'),
        },
      },
    );
    child.on('error', () => undefined);
    if (
      !Number.isInteger(child.pid) ||
      !child.pid ||
      !child.stdin ||
      !child.stdout ||
      !child.stderr
    )
      throw new Error();
    const ownedChild = child;
    const raw = await new Promise((accept, reject) => {
      let size = 0;
      let errorSize = 0;
      let failed = false;
      const fail = () => {
        failed = true;
        ownedChild.kill();
      };
      timeout = setTimeout(fail, timeoutMs);
      terminationTimeout = setTimeout(() => reject(new Error()), timeoutMs + 2_000);
      ownedChild.on('error', fail);
      ownedChild.stdin.on('error', fail);
      ownedChild.stdout.on('error', fail);
      ownedChild.stderr.on('error', fail);
      ownedChild.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) fail();
        else chunks.push(Buffer.from(chunk));
      });
      ownedChild.stderr.on('data', (chunk) => {
        errorSize += chunk.length;
        if (errorSize > 8 * 1_024) fail();
        else errors.push(Buffer.from(chunk));
      });
      // Match the shipped client's framing: no immediate local stdin EOF.
      ownedChild.stdout.on('end', () => {
        if (!ownedChild.stdin.writableEnded) ownedChild.stdin.end();
      });
      ownedChild.once('close', (code, signal) => {
        if (failed || code !== 0 || signal !== null || size < 2) reject(new Error());
        else accept(Buffer.concat(chunks, size));
      });
      ownedChild.stdin.write(header);
      ownedChild.stdin.write(body);
    });
    try {
      stage = 'http_response';
      parseResponse(raw, challenge);
    } finally {
      raw.fill(0);
    }
  } catch {
    throw new TransportPreviewUnavailableError(
      stage,
      stage === 'ssh_transport'
        ? failureCategory(Buffer.concat(errors).toString('utf8'))
        : 'http_response',
    );
  } finally {
    clearTimeout(timeout);
    clearTimeout(terminationTimeout);
    header.fill(0);
    body.fill(0);
    for (const chunk of [...chunks, ...errors]) chunk.fill(0);
    child?.kill();
  }
}

export function previewReport(error) {
  return {
    component: 'fetanagent_operator_transport_preview',
    result: error ? 'stopped' : 'passed',
    stage: error?.stage ?? 'connected',
    failureCategory: error?.category ?? null,
    liveExecutionReadinessProven: false,
    requestCreated: false,
    approvalCreated: false,
    queueMutationAttempted: false,
    executionEnabled: false,
    moneyMoved: false,
    identifiersRedacted: true,
  };
}

async function main(args) {
  if (args.length === 2 && args[0] === 'server' && CHALLENGE.test(args[1])) {
    requireValue(process.platform === 'linux');
    await new Promise((accept, reject) => {
      const server = createTransportPreviewServer(args[1]);
      server.once('error', reject);
      server.once('listening', () => process.stdout.write('transport_preview_ready\n'));
      server.once('close', accept);
    });
    return;
  }
  let error;
  try {
    requireValue(args.length === 3 && args[0] === 'client' && process.platform === 'win32');
    const documentPath = canonicalFile(args[1]);
    requireValue(lstatSync(documentPath).size <= 8 * 1_024);
    const connection = parsePreviewConnection(readFileSync(documentPath, 'utf8'));
    canonicalFile(connection.identityFile);
    canonicalFile(connection.knownHostsFile);
    const windowsRoot = process.env.SystemRoot;
    requireValue(
      typeof windowsRoot === 'string' &&
        /^[A-Za-z]:\\/u.test(windowsRoot) &&
        win32.normalize(windowsRoot) === windowsRoot,
    );
    canonicalFile(win32.join(windowsRoot, 'System32', 'OpenSSH', 'ssh.exe'));
    await previewWithSpawn(connection, windowsRoot, args[2]);
  } catch (caught) {
    error =
      caught instanceof TransportPreviewUnavailableError
        ? caught
        : new TransportPreviewUnavailableError('local_preflight');
  }
  process.stdout.write(`${JSON.stringify(previewReport(error))}\n`);
  if (error) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stdout.write('transport_preview_startup_failed\n');
    process.exitCode = 1;
  });
}
