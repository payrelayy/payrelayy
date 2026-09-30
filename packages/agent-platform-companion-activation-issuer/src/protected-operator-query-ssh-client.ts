import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { isIP } from 'node:net';
import { lstatSync, realpathSync } from 'node:fs';
import { win32 } from 'node:path';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import {
  COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
  COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
  COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
  COMPANION_EXECUTION_OPERATOR_STOP_PATH,
  digestCompanionExecutionOperatorBootstrapContent,
  digestCompanionExecutionHandoffSigningContent,
  type SignedCompanionExecutionActivationHandoff,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type { GuardedOperatorRemoteSession } from './guarded-operator-query-client.js';
import {
  createProtectedOperatorRemoteSessionWithPost,
  type ProtectedOperatorDeviceSigner,
} from './protected-operator-query-http-client.js';
import { PROTECTED_OPERATOR_QUERY_LOOPBACK_PORT } from './protected-operator-query-port.js';

const MAX_BODY_BYTES = 16 * 1_024;
const MAX_HEADERS_BYTES = 8 * 1_024;
const MAX_RESPONSE_BYTES = MAX_HEADERS_BYTES + MAX_BODY_BYTES + 4;
const ROUND_TRIP_TIMEOUT_MS = 10_000;
const SIGN_ROUND_TRIP_TIMEOUT_MS = 40_000;
const STOP_ROUND_TRIP_TIMEOUT_MS = 115_000;
const TERMINATION_TIMEOUT_MS = 2_000;
const RESTRICTED_OPERATOR_USER = 'fetanagent-operator';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

export interface ProtectedOperatorSshConnection {
  /** Independently enrolled operator identity, never the CI deployment key. */
  readonly identityFile: string;
  /** Dedicated pinned host-key file, not an ambient SSH configuration. */
  readonly knownHostsFile: string;
  readonly remoteHostIpv4: string;
  readonly remoteUser: string;
  readonly remoteSshPort: number;
  /** The on-demand protected host's loopback-only listener. */
  readonly remoteLoopbackPort: number;
}

export class ProtectedOperatorSshClientUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor(
    readonly bootstrapStage?:
      'local_preflight' | 'ssh_transport' | 'http_response' | 'bootstrap_binding',
  ) {
    super('The authenticated protected operator stream is unavailable.');
    this.name = 'ProtectedOperatorSshClientUnavailableError';
  }
}

class ProtectedOperatorSshExchangeError extends Error {
  constructor(readonly stage: 'ssh_transport' | 'http_response') {
    super('The protected operator exchange is unavailable.');
    this.name = 'ProtectedOperatorSshExchangeError';
  }
}

type SpawnChild = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ProtectedOperatorSshFiles {
  lstat(path: string): { isFile(): boolean; isSymbolicLink(): boolean };
  realpath(path: string): string;
}

const nativeFiles: ProtectedOperatorSshFiles = {
  lstat: lstatSync,
  realpath: realpathSync.native,
};

function canonicalFile(path: string, files: ProtectedOperatorSshFiles): string {
  if (
    typeof path !== 'string' ||
    !win32.isAbsolute(path) ||
    path.length > 220 ||
    win32.normalize(path) !== path ||
    /[\u0000-\u001f\u007f]/u.test(path)
  )
    throw new Error();
  const stat = files.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
  if (files.realpath(path).toLowerCase() !== path.toLowerCase()) throw new Error();
  return path;
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function parseResponse(raw: Buffer): unknown {
  const boundary = raw.indexOf('\r\n\r\n');
  if (boundary < 12 || boundary > MAX_HEADERS_BYTES) throw new Error();
  const headerBlock = raw.subarray(0, boundary).toString('latin1');
  if (!/^[\x20-\x7e\r\n]+$/u.test(headerBlock)) throw new Error();
  const lines = headerBlock.split('\r\n');
  if (lines.shift() !== 'HTTP/1.1 200 OK') throw new Error();
  const headers = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error();
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    if (!HEADER_NAME.test(name) || headers.has(name.toLowerCase())) throw new Error();
    headers.set(name.toLowerCase(), value);
  }
  const length = headers.get('content-length');
  if (
    !length ||
    !/^[1-9][0-9]{0,4}$/u.test(length) ||
    Number(length) < 2 ||
    Number(length) > MAX_BODY_BYTES ||
    headers.has('transfer-encoding') ||
    headers.has('content-encoding') ||
    headers.get('content-type') !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
    headers.get('cache-control') !== 'no-store' ||
    raw.byteLength !== boundary + 4 + Number(length)
  )
    throw new Error();
  const body = raw.subarray(boundary + 4).toString('utf8');
  const parsed: unknown = JSON.parse(body);
  if (JSON.stringify(parsed) !== body) throw new Error();
  return parsed;
}

function requestHeader(path: string, length: number): Buffer {
  return Buffer.from(
    `POST ${path} HTTP/1.1\r\n` +
      'Host: 127.0.0.1\r\n' +
      `Accept: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
      `Content-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
      `Content-Length: ${length}\r\n` +
      'Connection: close\r\n\r\n',
    'ascii',
  );
}

function sshArguments(connection: ProtectedOperatorSshConnection): readonly string[] {
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

async function postOverSsh(
  sshExecutable: string,
  connection: ProtectedOperatorSshConnection,
  path:
    | typeof COMPANION_EXECUTION_OPERATOR_QUERY_PATH
    | typeof COMPANION_EXECUTION_HANDOFF_SIGN_PATH
    | typeof COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH
    | typeof COMPANION_EXECUTION_OPERATOR_STOP_PATH,
  body: Buffer,
  spawnChild: SpawnChild,
  windowsRoot: string,
  timeoutMs = ROUND_TRIP_TIMEOUT_MS,
): Promise<unknown> {
  if (body.byteLength < 2 || body.byteLength > MAX_BODY_BYTES) throw new Error();
  const header = requestHeader(path, body.byteLength);
  const chunks: Buffer[] = [];
  let child: ChildProcess | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let terminationTimeout: NodeJS.Timeout | undefined;
  let stage: 'ssh_transport' | 'http_response' = 'ssh_transport';
  try {
    child = spawnChild(sshExecutable, sshArguments(connection), {
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      // Windows OpenSSH exits before connecting when PROGRAMDATA is absent.
      // Derive it from the trusted Windows drive instead of inheriting the
      // caller's ambient environment or SSH configuration.
      env: {
        SystemRoot: windowsRoot,
        WINDIR: windowsRoot,
        PROGRAMDATA: win32.join(win32.parse(windowsRoot).root, 'ProgramData'),
      },
    });
    // A failed Windows spawn reports error asynchronously, including when it
    // did not assign a PID. Never let that become an unhandled process error.
    child.on('error', () => undefined);
    if (!Number.isInteger(child.pid) || !child.pid || !child.stdin || !child.stdout)
      throw new Error();
    const ownedChild = child;
    const raw = await new Promise<Buffer>((resolve, reject) => {
      let size = 0;
      let failed = false;
      const fail = (): void => {
        failed = true;
        ownedChild.kill();
      };
      timeout = setTimeout(fail, timeoutMs);
      terminationTimeout = setTimeout(
        () => reject(new Error()),
        timeoutMs + TERMINATION_TIMEOUT_MS,
      );
      ownedChild.on('error', fail);
      ownedChild.stdout!.on('error', fail);
      ownedChild.stdin!.on('error', fail);
      ownedChild.stdout!.on('data', (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          fail();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      // Content-Length frames the complete request. Keep SSH stdin open until
      // the remote closes its response: Windows OpenSSH can exit on an immediate
      // local EOF before its stdio-forward channel is established.
      ownedChild.stdout!.on('end', () => {
        if (!ownedChild.stdin!.writableEnded) ownedChild.stdin!.end();
      });
      ownedChild.once('close', (code, signal) => {
        if (failed || code !== 0 || signal !== null || size < 2) {
          reject(new Error());
          return;
        }
        resolve(Buffer.concat(chunks, size));
      });
      ownedChild.stdin!.write(header);
      ownedChild.stdin!.write(body);
    });
    try {
      stage = 'http_response';
      return parseResponse(raw);
    } finally {
      raw.fill(0);
    }
  } catch {
    throw new ProtectedOperatorSshExchangeError(stage);
  } finally {
    clearTimeout(timeout);
    clearTimeout(terminationTimeout);
    header.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    child?.kill();
  }
}

export interface ProtectedOperatorBootstrapBinding {
  readonly requestKey: string;
  readonly actorAuthUserId: string;
}

/** One paired lookup over pinned SSH; no identifier enters argv or an on-disk file. */
export async function readProtectedOperatorSshBootstrapWithSpawn(
  device: ProtectedOperatorDeviceSigner,
  connection: ProtectedOperatorSshConnection,
  windowsRoot: string,
  spawnChild: SpawnChild,
  files: ProtectedOperatorSshFiles = nativeFiles,
): Promise<ProtectedOperatorBootstrapBinding> {
  let stage: 'local_preflight' | 'bootstrap_binding' = 'local_preflight';
  try {
    if (
      !device?.certificate?.bodyDigest ||
      !connection ||
      !win32.isAbsolute(windowsRoot) ||
      win32.normalize(windowsRoot) !== windowsRoot ||
      isIP(connection.remoteHostIpv4) !== 4 ||
      connection.remoteUser !== RESTRICTED_OPERATOR_USER ||
      !validPort(connection.remoteSshPort) ||
      connection.remoteLoopbackPort !== PROTECTED_OPERATOR_QUERY_LOOPBACK_PORT ||
      /\s/u.test(connection.knownHostsFile)
    )
      throw new Error();
    const sshExecutable = canonicalFile(
      win32.join(windowsRoot, 'System32', 'OpenSSH', 'ssh.exe'),
      files,
    );
    const checked = Object.freeze({
      ...connection,
      identityFile: canonicalFile(connection.identityFile, files),
      knownHostsFile: canonicalFile(connection.knownHostsFile, files),
    });
    const digest = digestCompanionExecutionOperatorBootstrapContent(device.certificate.bodyDigest);
    if (!digest) throw new Error();
    const httpRequest = device.createSignedHttpRequest(
      COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
      digest,
    );
    const body = Buffer.from(
      JSON.stringify({ certificate: device.certificate, httpRequest }),
      'utf8',
    );
    try {
      const reply = await postOverSsh(
        sshExecutable,
        checked,
        COMPANION_EXECUTION_OPERATOR_BOOTSTRAP_PATH,
        body,
        spawnChild,
        windowsRoot,
      );
      stage = 'bootstrap_binding';
      if (
        !reply ||
        typeof reply !== 'object' ||
        Array.isArray(reply) ||
        Object.keys(reply).sort().join(',') !== 'actorAuthUserId,requestKey'
      )
        throw new Error();
      const binding = reply as Record<string, unknown>;
      if (
        typeof binding.requestKey !== 'string' ||
        !UUID_V4.test(binding.requestKey) ||
        typeof binding.actorAuthUserId !== 'string' ||
        !UUID.test(binding.actorAuthUserId)
      )
        throw new Error();
      return Object.freeze({
        requestKey: binding.requestKey,
        actorAuthUserId: binding.actorAuthUserId,
      });
    } finally {
      body.fill(0);
    }
  } catch (error) {
    throw new ProtectedOperatorSshClientUnavailableError(
      error instanceof ProtectedOperatorSshExchangeError ? error.stage : stage,
    );
  }
}

export function readProtectedOperatorSshBootstrap(
  device: ProtectedOperatorDeviceSigner,
  connection: ProtectedOperatorSshConnection,
): Promise<ProtectedOperatorBootstrapBinding> {
  if (process.platform !== 'win32' || !process.env.SystemRoot)
    throw new ProtectedOperatorSshClientUnavailableError('local_preflight');
  return readProtectedOperatorSshBootstrapWithSpawn(
    device,
    connection,
    process.env.SystemRoot,
    spawn,
  );
}

/** Test seam: no network connection is possible until the exact paths and target pass validation. */
export async function createProtectedOperatorSshRemoteSessionWithSpawn(
  device: ProtectedOperatorDeviceSigner,
  requestKey: string,
  connection: ProtectedOperatorSshConnection,
  windowsRoot: string,
  spawnChild: SpawnChild,
  files: ProtectedOperatorSshFiles = nativeFiles,
): Promise<GuardedOperatorRemoteSession> {
  try {
    if (
      !connection ||
      !win32.isAbsolute(windowsRoot) ||
      win32.normalize(windowsRoot) !== windowsRoot ||
      isIP(connection.remoteHostIpv4) !== 4 ||
      connection.remoteUser !== RESTRICTED_OPERATOR_USER ||
      !validPort(connection.remoteSshPort) ||
      connection.remoteLoopbackPort !== PROTECTED_OPERATOR_QUERY_LOOPBACK_PORT ||
      /\s/u.test(connection.knownHostsFile)
    )
      throw new Error();
    const sshExecutable = canonicalFile(
      win32.join(windowsRoot, 'System32', 'OpenSSH', 'ssh.exe'),
      files,
    );
    const identityFile = canonicalFile(connection.identityFile, files);
    const knownHostsFile = canonicalFile(connection.knownHostsFile, files);
    const checked = Object.freeze({ ...connection, identityFile, knownHostsFile });
    return await createProtectedOperatorRemoteSessionWithPost(device, requestKey, (body) =>
      postOverSsh(
        sshExecutable,
        checked,
        COMPANION_EXECUTION_OPERATOR_QUERY_PATH,
        body,
        spawnChild,
        windowsRoot,
      ),
    );
  } catch {
    throw new ProtectedOperatorSshClientUnavailableError();
  }
}

/** One signed handoff request over the same pinned SSH transport, before query-session open. */
export function createProtectedOperatorSshHandoffSignerWithSpawn(
  device: ProtectedOperatorDeviceSigner,
  connection: ProtectedOperatorSshConnection,
  windowsRoot: string,
  spawnChild: SpawnChild,
  files: ProtectedOperatorSshFiles = nativeFiles,
): (requestKey: string) => Promise<SignedCompanionExecutionActivationHandoff> {
  let attempted = false;
  return async (requestKey) => {
    try {
      if (
        attempted ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestKey)
      )
        throw new Error();
      attempted = true;
      if (
        !connection ||
        !win32.isAbsolute(windowsRoot) ||
        win32.normalize(windowsRoot) !== windowsRoot ||
        isIP(connection.remoteHostIpv4) !== 4 ||
        connection.remoteUser !== RESTRICTED_OPERATOR_USER ||
        !validPort(connection.remoteSshPort) ||
        connection.remoteLoopbackPort !== PROTECTED_OPERATOR_QUERY_LOOPBACK_PORT ||
        /\s/u.test(connection.knownHostsFile)
      )
        throw new Error();
      const sshExecutable = canonicalFile(
        win32.join(windowsRoot, 'System32', 'OpenSSH', 'ssh.exe'),
        files,
      );
      const checked = Object.freeze({
        ...connection,
        identityFile: canonicalFile(connection.identityFile, files),
        knownHostsFile: canonicalFile(connection.knownHostsFile, files),
      });
      const digest = digestCompanionExecutionHandoffSigningContent(
        requestKey,
        device.certificate.bodyDigest,
      );
      if (!digest) throw new Error();
      const httpRequest = device.createSignedHttpRequest(
        COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
        digest,
      );
      const body = Buffer.from(
        JSON.stringify({ requestKey, certificate: device.certificate, httpRequest }),
        'utf8',
      );
      try {
        const reply = await postOverSsh(
          sshExecutable,
          checked,
          COMPANION_EXECUTION_HANDOFF_SIGN_PATH,
          body,
          spawnChild,
          windowsRoot,
          SIGN_ROUND_TRIP_TIMEOUT_MS,
        );
        if (
          !reply ||
          typeof reply !== 'object' ||
          Array.isArray(reply) ||
          Object.keys(reply).sort().join(',') !== 'body,signature,signerKeyId'
        )
          throw new Error();
        // The publisher checks the exact body and signature before writing a handoff.
        return reply as SignedCompanionExecutionActivationHandoff;
      } finally {
        body.fill(0);
      }
    } catch {
      throw new ProtectedOperatorSshClientUnavailableError();
    }
  };
}

export function createProtectedOperatorSshHandoffSigner(
  device: ProtectedOperatorDeviceSigner,
  connection: ProtectedOperatorSshConnection,
): (requestKey: string) => Promise<SignedCompanionExecutionActivationHandoff> {
  if (process.platform !== 'win32' || !process.env.SystemRoot)
    throw new ProtectedOperatorSshClientUnavailableError();
  return createProtectedOperatorSshHandoffSignerWithSpawn(
    device,
    connection,
    process.env.SystemRoot,
    spawn,
  );
}

/** Stop financial authority through the host's independent database connection. */
export function createProtectedOperatorSshEmergencyStopWithSpawn(
  connection: ProtectedOperatorSshConnection,
  windowsRoot: string,
  spawnChild: SpawnChild,
  files: ProtectedOperatorSshFiles = nativeFiles,
): (requestKey: string) => Promise<void> {
  let attemptedKey: string | undefined;
  let stopPromise: Promise<void> | undefined;
  return (requestKey) => {
    if (attemptedKey && attemptedKey !== requestKey)
      return Promise.reject(new ProtectedOperatorSshClientUnavailableError());
    if (stopPromise) return stopPromise;
    attemptedKey = requestKey;
    stopPromise = (async () => {
      try {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestKey)
        )
          throw new Error();
        if (
          !connection ||
          !win32.isAbsolute(windowsRoot) ||
          win32.normalize(windowsRoot) !== windowsRoot ||
          isIP(connection.remoteHostIpv4) !== 4 ||
          connection.remoteUser !== RESTRICTED_OPERATOR_USER ||
          !validPort(connection.remoteSshPort) ||
          connection.remoteLoopbackPort !== PROTECTED_OPERATOR_QUERY_LOOPBACK_PORT ||
          /\s/u.test(connection.knownHostsFile)
        )
          throw new Error();
        const sshExecutable = canonicalFile(
          win32.join(windowsRoot, 'System32', 'OpenSSH', 'ssh.exe'),
          files,
        );
        const checked = Object.freeze({
          ...connection,
          identityFile: canonicalFile(connection.identityFile, files),
          knownHostsFile: canonicalFile(connection.knownHostsFile, files),
        });
        const body = Buffer.from(JSON.stringify({ requestKey }), 'utf8');
        try {
          const reply = await postOverSsh(
            sshExecutable,
            checked,
            COMPANION_EXECUTION_OPERATOR_STOP_PATH,
            body,
            spawnChild,
            windowsRoot,
            STOP_ROUND_TRIP_TIMEOUT_MS,
          );
          if (
            !reply ||
            typeof reply !== 'object' ||
            Array.isArray(reply) ||
            Object.keys(reply).join(',') !== 'stopped' ||
            (reply as Record<string, unknown>)['stopped'] !== true
          )
            throw new Error();
        } finally {
          body.fill(0);
        }
      } catch {
        throw new ProtectedOperatorSshClientUnavailableError();
      }
    })();
    return stopPromise;
  };
}

export function createProtectedOperatorSshEmergencyStop(
  connection: ProtectedOperatorSshConnection,
): (requestKey: string) => Promise<void> {
  if (process.platform !== 'win32' || !process.env.SystemRoot)
    throw new ProtectedOperatorSshClientUnavailableError();
  return createProtectedOperatorSshEmergencyStopWithSpawn(
    connection,
    process.env.SystemRoot,
    spawn,
  );
}

/** No local forwarding port, ambient SSH config, agent key, shell, or reusable credential. */
export function createProtectedOperatorSshRemoteSession(
  device: ProtectedOperatorDeviceSigner,
  requestKey: string,
  connection: ProtectedOperatorSshConnection,
): Promise<GuardedOperatorRemoteSession> {
  if (process.platform !== 'win32' || !process.env.SystemRoot)
    throw new ProtectedOperatorSshClientUnavailableError();
  return createProtectedOperatorSshRemoteSessionWithSpawn(
    device,
    requestKey,
    connection,
    process.env.SystemRoot,
    spawn,
  );
}
