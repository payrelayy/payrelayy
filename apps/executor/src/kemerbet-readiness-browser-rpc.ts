import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { isKemerBetReadinessLayer7Authorization } from './kemerbet-readiness-layer7-authorization.js';

export const KEMERBET_READINESS_BROWSER_RPC_CAPABILITY_FILE =
  '/run/secrets/kemerbet_readiness_browser_rpc_capability';
export const KEMERBET_READINESS_BROWSER_RPC_ORIGIN = 'http://172.31.254.3:4587';
export const KEMERBET_READINESS_BROWSER_RPC_PORT = 4587;
export const KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4 = '172.31.254.3';

const CONTENT_TYPE = 'application/json; charset=utf-8';
const CAPABILITY_HEADER = 'x-fetanagent-readiness-capability';
const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RAW_IDENTITY_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const MAX_REQUEST_BYTES = 256;
const MAX_RESPONSE_BYTES = 512;
const REQUEST_BODY_TIMEOUT_MS = 5_000;
const OPEN_OPERATION_TIMEOUT_MS = 180_000;
const LOOKUP_OPERATION_TIMEOUT_MS = 180_000;
const FINALIZE_OPERATION_TIMEOUT_MS = 90_000;
const CLOSE_OPERATION_TIMEOUT_MS = 60_000;
const CLIENT_CALL_TIMEOUT_MS = 240_000;
const MAX_CALLS = 8;
const OPEN_PATH = '/v1/session/open';
const LOOKUP_PATH = '/v1/session/lookup';
const FINALIZE_PATH = '/v1/session/finalize';
const CLOSE_PATH = '/v1/session/close';
const GENERIC_ERROR_BODY = '{"ok":false}';

interface CapabilityStat {
  readonly dev: number | bigint;
  readonly gid: number;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface KemerBetReadinessBrowserRpcCapabilityFileSystem {
  lstat(path: string): Promise<CapabilityStat>;
  open(path: string, flags: number): Promise<Awaited<ReturnType<typeof open>>>;
  realpath(path: string): Promise<string>;
}

export interface KemerBetReadinessBrowserDriverSession {
  readonly agentIdentity: string;
  close(): Promise<void>;
  finalize(): Promise<void>;
  lookup(playerId: string, layer7Authorization: string): Promise<void>;
}

export interface KemerBetReadinessBrowserRpcClient {
  close(): Promise<void>;
  finalize(): Promise<void>;
  lookup(playerId: string, layer7Authorization: string): Promise<void>;
  open(): Promise<string>;
}

export interface KemerBetReadinessBrowserRpcServerHandle {
  readonly completed: Promise<'failed' | 'succeeded'>;
  readonly origin: string;
  close(): Promise<void>;
}

export class KemerBetReadinessBrowserRpcUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness browser boundary is unavailable.');
    this.name = 'KemerBetReadinessBrowserRpcUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessBrowserRpcUnavailableError();
}

function sameStat(left: CapabilityStat, right: CapabilityStat): boolean {
  return (
    left.dev === right.dev &&
    left.gid === right.gid &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid
  );
}

const productionCapabilityFileSystem: KemerBetReadinessBrowserRpcCapabilityFileSystem = {
  lstat: async (path) => (await lstat(path)) as CapabilityStat,
  open,
  realpath,
};

/** Read the one-run 256-bit capability without following, replacing, or weakening its fixed file. */
export async function loadKemerBetReadinessBrowserRpcCapability(
  options: {
    readonly effectiveUserId?: number;
    readonly filePath?: string;
    readonly fileSystem?: KemerBetReadinessBrowserRpcCapabilityFileSystem;
  } = {},
): Promise<Buffer> {
  const filePath = options.filePath ?? KEMERBET_READINESS_BROWSER_RPC_CAPABILITY_FILE;
  if (filePath !== KEMERBET_READINESS_BROWSER_RPC_CAPABILITY_FILE) unavailable();
  const effectiveUserId =
    options.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (effectiveUserId !== 10001 && effectiveUserId !== 10002) unavailable();
  const fileSystem = options.fileSystem ?? productionCapabilityFileSystem;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await fileSystem.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = (await handle.stat()) as CapabilityStat;
    const pathBefore = await fileSystem.lstat(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameStat(before, pathBefore) ||
      before.uid !== effectiveUserId ||
      before.gid !== effectiveUserId ||
      (before.mode & 0o777) !== 0o400 ||
      before.nlink !== 1 ||
      before.size !== 65 ||
      (await fileSystem.realpath(filePath)) !== filePath
    ) {
      unavailable();
    }
    const serialized = await handle.readFile({ encoding: 'utf8' });
    const after = (await handle.stat()) as CapabilityStat;
    const pathAfter = await fileSystem.lstat(filePath);
    if (
      !sameStat(before, after) ||
      !sameStat(after, pathAfter) ||
      pathAfter.isSymbolicLink() ||
      serialized.length !== 65 ||
      serialized.at(-1) !== '\n' ||
      !CAPABILITY_PATTERN.test(serialized.slice(0, -1))
    ) {
      unavailable();
    }
    return Buffer.from(serialized.slice(0, -1), 'hex');
  } catch {
    return unavailable();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function exactCapability(candidate: string | undefined, capability: Buffer): boolean {
  const candidateIsCanonical = candidate !== undefined && CAPABILITY_PATTERN.test(candidate);
  const candidateBytes = candidateIsCanonical
    ? Buffer.from(candidate, 'hex')
    : Buffer.alloc(capability.length);
  const equal =
    candidateBytes.length === capability.length && timingSafeEqual(candidateBytes, capability);
  candidateBytes.fill(0);
  return candidateIsCanonical && equal;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function writeJson(response: ServerResponse, statusCode: number, value: string): void {
  const body = Buffer.from(value, 'utf8');
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': String(body.length),
    'content-type': CONTENT_TYPE,
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

async function readExactRequestBody(request: IncomingMessage): Promise<unknown> {
  if (
    request.headers['content-type'] !== CONTENT_TYPE ||
    request.headers['transfer-encoding'] !== undefined ||
    request.headers['content-encoding'] !== undefined ||
    Array.isArray(request.headers['content-length'])
  ) {
    return unavailable();
  }
  const serializedLength = request.headers['content-length'];
  if (serializedLength === undefined || !/^(?:[1-9][0-9]{0,2})$/u.test(serializedLength)) {
    return unavailable();
  }
  const expectedLength = Number(serializedLength);
  if (expectedLength < 2 || expectedLength > MAX_REQUEST_BYTES) unavailable();
  const chunks: Buffer[] = [];
  let observedLength = 0;
  const timer = setTimeout(() => request.destroy(), REQUEST_BODY_TIMEOUT_MS);
  timer.unref();
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      observedLength += bytes.length;
      if (observedLength > expectedLength || observedLength > MAX_REQUEST_BYTES) unavailable();
      chunks.push(bytes);
    }
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
  if (observedLength !== expectedLength) unavailable();
  const body = Buffer.concat(chunks, observedLength).toString('utf8');
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return unavailable();
  }
}

type ServerState =
  'awaiting_open' | 'opened' | 'finalizing' | 'finalized' | 'closing' | 'closed' | 'failed';

export function createKemerBetReadinessBrowserRpcRequestHandler(options: {
  readonly capability: Buffer;
  readonly expectedHost: string;
  readonly openSession: () => Promise<KemerBetReadinessBrowserDriverSession>;
  readonly onCompleted?: (outcome: 'failed' | 'succeeded') => void;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  if (
    options.capability.length !== 32 ||
    options.expectedHost.length < 1 ||
    options.expectedHost.length > 253
  ) {
    unavailable();
  }
  let state: ServerState = 'awaiting_open';
  let calls = 0;
  let lookups = 0;
  let busy = false;
  let session: KemerBetReadinessBrowserDriverSession | null = null;

  const fail = async (): Promise<void> => {
    state = 'failed';
    const active = session;
    session = null;
    await active?.close().catch(() => undefined);
  };

  return async (request, response) => {
    if (busy || state === 'failed' || state === 'closed' || calls >= MAX_CALLS) {
      await fail();
      writeJson(response, 400, GENERIC_ERROR_BODY);
      options.onCompleted?.('failed');
      return;
    }
    busy = true;
    calls += 1;
    let peerDisconnected = request.aborted || response.destroyed || request.socket.destroyed;
    let responseFinished = response.writableFinished;
    let transportListenersInstalled = true;
    const removeTransportListeners = () => {
      if (!transportListenersInstalled) return;
      transportListenersInstalled = false;
      request.off('aborted', observePeerDisconnect);
      response.off('close', observePeerDisconnect);
      response.off('finish', observeResponseFinish);
      request.socket.off('close', observePeerDisconnect);
    };
    const observePeerDisconnect = () => {
      if (!responseFinished && !response.writableFinished) {
        peerDisconnected = true;
        void fail()
          .then(() => options.onCompleted?.('failed'))
          .catch(() => undefined);
      }
      removeTransportListeners();
    };
    const observeResponseFinish = () => {
      responseFinished = true;
      removeTransportListeners();
    };
    request.once('aborted', observePeerDisconnect);
    response.once('close', observePeerDisconnect);
    response.once('finish', observeResponseFinish);
    request.socket.once('close', observePeerDisconnect);
    const runBoundedOperation = async <T>(
      timeoutMs: number,
      operation: () => Promise<T>,
      onTimeout?: () => void,
    ): Promise<T> => {
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;
      const deadline = new Promise<never>((_resolvePromise, rejectPromise) => {
        timer = setTimeout(() => {
          timedOut = true;
          onTimeout?.();
          rejectPromise(new KemerBetReadinessBrowserRpcUnavailableError());
        }, timeoutMs);
        timer.unref();
      });
      const activeOperation = Promise.resolve().then(operation);
      try {
        const result = await Promise.race([activeOperation, deadline]);
        if (peerDisconnected || request.aborted || response.destroyed || request.socket.destroyed) {
          await fail();
          unavailable();
        }
        return result;
      } catch {
        if (timedOut) {
          await fail();
          void activeOperation.finally(() => fail()).catch(() => undefined);
        }
        return unavailable();
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    };
    try {
      const capabilityHeader = request.headers[CAPABILITY_HEADER];
      if (
        request.method !== 'POST' ||
        request.headers.host !== options.expectedHost ||
        Array.isArray(capabilityHeader) ||
        !exactCapability(capabilityHeader, options.capability)
      ) {
        unavailable();
      }
      const body = await readExactRequestBody(request);
      if (request.url === OPEN_PATH && state === 'awaiting_open') {
        if (!exactObject(body, ['version']) || body.version !== '1') unavailable();
        let openTimedOut = false;
        const opened = await runBoundedOperation(
          OPEN_OPERATION_TIMEOUT_MS,
          async () => {
            const candidate = await options.openSession();
            if (openTimedOut || peerDisconnected || state !== 'awaiting_open') {
              await candidate.close().catch(() => undefined);
              unavailable();
            }
            // Take ownership before any post-open validation or peer-disconnect check.
            session = candidate;
            return candidate;
          },
          () => {
            openTimedOut = true;
          },
        );
        if (state !== 'awaiting_open' || session !== opened) unavailable();
        if (!RAW_IDENTITY_PATTERN.test(opened.agentIdentity)) unavailable();
        state = 'opened';
        writeJson(response, 200, JSON.stringify({ ok: true, agentIdentity: opened.agentIdentity }));
        return;
      }
      if (request.url === LOOKUP_PATH && state === 'opened' && lookups < 5 && session !== null) {
        if (
          !exactObject(body, ['layer7Authorization', 'playerId']) ||
          typeof body.playerId !== 'string' ||
          !PLAYER_ID_PATTERN.test(body.playerId) ||
          typeof body.layer7Authorization !== 'string' ||
          !isKemerBetReadinessLayer7Authorization(body.layer7Authorization)
        ) {
          unavailable();
        }
        const currentPlayerId = body.playerId;
        const currentLayer7Authorization = body.layer7Authorization;
        await runBoundedOperation(LOOKUP_OPERATION_TIMEOUT_MS, () =>
          session!.lookup(currentPlayerId, currentLayer7Authorization),
        );
        if (state !== 'opened' || session === null) unavailable();
        lookups += 1;
        writeJson(response, 200, '{"ok":true}');
        return;
      }
      if (
        request.url === FINALIZE_PATH &&
        state === 'opened' &&
        lookups === 5 &&
        session !== null
      ) {
        if (!exactObject(body, [])) unavailable();
        state = 'finalizing';
        await runBoundedOperation(FINALIZE_OPERATION_TIMEOUT_MS, () => session!.finalize());
        if (state !== 'finalizing' || session === null) unavailable();
        state = 'finalized';
        writeJson(response, 200, '{"ok":true}');
        return;
      }
      if (
        request.url === CLOSE_PATH &&
        (state === 'opened' || state === 'finalized') &&
        session !== null
      ) {
        if (!exactObject(body, [])) unavailable();
        state = 'closing';
        const active = session;
        session = null;
        await runBoundedOperation(CLOSE_OPERATION_TIMEOUT_MS, () => active.close());
        if (state !== 'closing') unavailable();
        state = 'closed';
        writeJson(response, 200, '{"ok":true}');
        options.onCompleted?.('succeeded');
        return;
      }
      unavailable();
    } catch {
      await fail();
      if (!response.headersSent) writeJson(response, 400, GENERIC_ERROR_BODY);
      else response.destroy();
      options.onCompleted?.('failed');
    } finally {
      busy = false;
      if (response.writableFinished || response.destroyed) removeTransportListeners();
    }
  };
}

export async function startKemerBetReadinessBrowserRpcServer(options: {
  readonly capability: Buffer;
  readonly expectedHost?: string;
  readonly host?: string;
  readonly openSession: () => Promise<KemerBetReadinessBrowserDriverSession>;
  readonly port?: number;
}): Promise<KemerBetReadinessBrowserRpcServerHandle> {
  const host = options.host ?? KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4;
  const port = options.port ?? KEMERBET_READINESS_BROWSER_RPC_PORT;
  const expectedHost =
    options.expectedHost ??
    `${KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4}:${KEMERBET_READINESS_BROWSER_RPC_PORT}`;
  if (
    (host !== KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4 && host !== '127.0.0.1') ||
    !Number.isSafeInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    unavailable();
  }
  let complete!: (outcome: 'failed' | 'succeeded') => void;
  const completed = new Promise<'failed' | 'succeeded'>((resolvePromise) => {
    complete = resolvePromise;
  });
  const handler = createKemerBetReadinessBrowserRpcRequestHandler({
    capability: options.capability,
    expectedHost,
    onCompleted: complete,
    openSession: options.openSession,
  });
  const server: Server = createServer((request, response) => {
    void handler(request, response);
  });
  server.headersTimeout = REQUEST_BODY_TIMEOUT_MS;
  server.requestTimeout = CLIENT_CALL_TIMEOUT_MS;
  server.keepAliveTimeout = 1;
  server.maxHeadersCount = 16;
  server.maxRequestsPerSocket = 1;
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  }).catch(() => unavailable());
  const address = server.address();
  if (address === null || typeof address === 'string') unavailable();
  const origin = `http://${host}:${address.port}`;
  return Object.freeze({
    completed,
    origin,
    close: async () => {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    },
  });
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  if (
    response.status !== 200 ||
    response.headers.get('content-type') !== CONTENT_TYPE ||
    response.headers.get('content-encoding') !== null
  ) {
    unavailable();
  }
  const serializedLength = response.headers.get('content-length');
  if (serializedLength === null || !/^[1-9][0-9]{0,2}$/u.test(serializedLength)) unavailable();
  const expectedLength = Number(serializedLength);
  if (expectedLength > MAX_RESPONSE_BYTES) unavailable();
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') !== expectedLength) unavailable();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return unavailable();
  }
}

export function createKemerBetReadinessBrowserRpcClient(options: {
  readonly capability: Buffer;
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
}): KemerBetReadinessBrowserRpcClient {
  const origin = options.origin ?? KEMERBET_READINESS_BROWSER_RPC_ORIGIN;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (
    options.capability.length !== 32 ||
    (origin !== KEMERBET_READINESS_BROWSER_RPC_ORIGIN &&
      !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/u.test(origin))
  ) {
    unavailable();
  }
  let state: ServerState = 'awaiting_open';
  let lookups = 0;
  let busy = false;
  const capabilityHex = options.capability.toString('hex');

  const call = async (path: string, body: string): Promise<unknown> => {
    if (busy || Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) unavailable();
    busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_CALL_TIMEOUT_MS);
    timer.unref();
    try {
      const response = await fetchImplementation(`${origin}${path}`, {
        body,
        cache: 'no-store',
        headers: {
          [CAPABILITY_HEADER]: capabilityHex,
          'content-length': String(Buffer.byteLength(body, 'utf8')),
          'content-type': CONTENT_TYPE,
        },
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
      });
      return await readBoundedResponse(response);
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  };

  return Object.freeze({
    open: async () => {
      if (state !== 'awaiting_open') unavailable();
      const result = await call(OPEN_PATH, '{"version":"1"}');
      if (
        !exactObject(result, ['agentIdentity', 'ok']) ||
        result.ok !== true ||
        typeof result.agentIdentity !== 'string' ||
        !RAW_IDENTITY_PATTERN.test(result.agentIdentity)
      ) {
        unavailable();
      }
      state = 'opened';
      return result.agentIdentity;
    },
    lookup: async (playerId: string, layer7Authorization: string) => {
      if (
        state !== 'opened' ||
        lookups >= 5 ||
        !PLAYER_ID_PATTERN.test(playerId) ||
        !isKemerBetReadinessLayer7Authorization(layer7Authorization)
      ) {
        unavailable();
      }
      const result = await call(LOOKUP_PATH, JSON.stringify({ layer7Authorization, playerId }));
      if (!exactObject(result, ['ok']) || result.ok !== true) unavailable();
      lookups += 1;
    },
    finalize: async () => {
      if (state !== 'opened' || lookups !== 5) unavailable();
      state = 'finalizing';
      const result = await call(FINALIZE_PATH, '{}');
      if (!exactObject(result, ['ok']) || result.ok !== true) unavailable();
      state = 'finalized';
    },
    close: async () => {
      if (state !== 'opened' && state !== 'finalized') unavailable();
      state = 'closing';
      const result = await call(CLOSE_PATH, '{}');
      if (!exactObject(result, ['ok']) || result.ok !== true) unavailable();
      state = 'closed';
    },
  });
}

export const KEMERBET_READINESS_BROWSER_RPC_CONTRACT = Object.freeze({
  capabilityFile: KEMERBET_READINESS_BROWSER_RPC_CAPABILITY_FILE,
  bindIpv4: KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4,
  closePath: CLOSE_PATH,
  contentType: CONTENT_TYPE,
  finalizePath: FINALIZE_PATH,
  lookupPath: LOOKUP_PATH,
  maxCalls: MAX_CALLS,
  maxRequestBytes: MAX_REQUEST_BYTES,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  clientCallTimeoutMs: CLIENT_CALL_TIMEOUT_MS,
  closeOperationTimeoutMs: CLOSE_OPERATION_TIMEOUT_MS,
  finalizeOperationTimeoutMs: FINALIZE_OPERATION_TIMEOUT_MS,
  lookupOperationTimeoutMs: LOOKUP_OPERATION_TIMEOUT_MS,
  openOperationTimeoutMs: OPEN_OPERATION_TIMEOUT_MS,
  openPath: OPEN_PATH,
  origin: KEMERBET_READINESS_BROWSER_RPC_ORIGIN,
});
