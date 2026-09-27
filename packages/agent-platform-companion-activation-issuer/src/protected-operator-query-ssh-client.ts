import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { isIP } from 'node:net';
import { lstatSync, realpathSync } from 'node:fs';
import { win32 } from 'node:path';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';
import { COMPANION_EXECUTION_OPERATOR_QUERY_PATH } from '@fetanagent/agent-platform-companion-execution-contracts';

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
const TERMINATION_TIMEOUT_MS = 2_000;
const RESTRICTED_OPERATOR_USER = 'fetanagent-operator';
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

  constructor() {
    super('The authenticated protected operator stream is unavailable.');
    this.name = 'ProtectedOperatorSshClientUnavailableError';
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

function requestHeader(length: number): Buffer {
  return Buffer.from(
    `POST ${COMPANION_EXECUTION_OPERATOR_QUERY_PATH} HTTP/1.1\r\n` +
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
  body: Buffer,
  spawnChild: SpawnChild,
  windowsRoot: string,
): Promise<unknown> {
  if (body.byteLength < 2 || body.byteLength > MAX_BODY_BYTES) throw new Error();
  const header = requestHeader(body.byteLength);
  const chunks: Buffer[] = [];
  let child: ChildProcess | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let terminationTimeout: NodeJS.Timeout | undefined;
  try {
    child = spawnChild(sshExecutable, sshArguments(connection), {
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { SystemRoot: windowsRoot, WINDIR: windowsRoot },
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
      timeout = setTimeout(fail, ROUND_TRIP_TIMEOUT_MS);
      terminationTimeout = setTimeout(
        () => reject(new Error()),
        ROUND_TRIP_TIMEOUT_MS + TERMINATION_TIMEOUT_MS,
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
      ownedChild.once('close', (code, signal) => {
        if (failed || code !== 0 || signal !== null || size < 2) {
          reject(new Error());
          return;
        }
        resolve(Buffer.concat(chunks, size));
      });
      ownedChild.stdin!.write(header);
      ownedChild.stdin!.end(body);
    });
    try {
      return parseResponse(raw);
    } finally {
      raw.fill(0);
    }
  } finally {
    clearTimeout(timeout);
    clearTimeout(terminationTimeout);
    header.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    child?.kill();
  }
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
      postOverSsh(sshExecutable, checked, body, spawnChild, windowsRoot),
    );
  } catch {
    throw new ProtectedOperatorSshClientUnavailableError();
  }
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
