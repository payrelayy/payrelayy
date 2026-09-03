import type { Stats } from 'node:fs';
import { chmod, lstat, realpath, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isProxy } from 'node:util/types';

import {
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT,
  TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET,
  decodeTelebirrAssignmentBrokerLocalPollRequestBytes,
  encodeTelebirrAssignmentBrokerLocalPollResponse,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrAssignmentBrokerPollInput,
  TelebirrAssignmentBrokerPollResult,
} from './telebirr-assignment-broker.js';

export interface TelebirrAssignmentBrokerLocalHttpRequest {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: Uint8Array;
}

export interface TelebirrAssignmentBrokerLocalHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type TelebirrAssignmentBrokerPoll = (
  input: TelebirrAssignmentBrokerPollInput,
) => Promise<TelebirrAssignmentBrokerPollResult>;

export class TelebirrAssignmentBrokerLocalServerError extends Error {
  constructor() {
    super('The private TeleBirr assignment broker is unavailable.');
    this.name = 'TelebirrAssignmentBrokerLocalServerError';
  }
}

const responseHeaders = Object.freeze({
  'cache-control': 'no-store, max-age=0',
  connection: 'close',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
});

function headerValues(
  headers: readonly (readonly [string, string])[],
  expectedName: string,
): readonly string[] | undefined {
  if (!Array.isArray(headers) || isProxy(headers)) return undefined;
  const values: string[] = [];
  for (const header of headers) {
    if (
      !Array.isArray(header) ||
      isProxy(header) ||
      header.length !== 2 ||
      typeof header[0] !== 'string' ||
      typeof header[1] !== 'string'
    ) {
      return undefined;
    }
    if (header[0].toLowerCase() === expectedName) values.push(header[1]);
  }
  return values;
}

function hasValidHttpEnvelope(request: TelebirrAssignmentBrokerLocalHttpRequest): boolean {
  if (
    request.method !== 'POST' ||
    request.path !== TELEBIRR_ASSIGNMENT_BROKER_LOCAL_POLL_PATH ||
    !(request.body instanceof Uint8Array) ||
    isProxy(request.body) ||
    request.body.byteLength === 0 ||
    request.body.byteLength > TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES
  ) {
    return false;
  }
  const contentTypes = headerValues(request.headers, 'content-type');
  const contentLengths = headerValues(request.headers, 'content-length');
  const contentEncodings = headerValues(request.headers, 'content-encoding');
  const transferEncodings = headerValues(request.headers, 'transfer-encoding');
  const expects = headerValues(request.headers, 'expect');
  return (
    contentTypes?.length === 1 &&
    contentTypes[0] === TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE &&
    contentLengths?.length === 1 &&
    contentLengths[0] === String(request.body.byteLength) &&
    contentEncodings?.length === 0 &&
    transferEncodings?.length === 0 &&
    expects?.length === 0
  );
}

function response(
  statusCode: number,
  contentType: string,
  body: Uint8Array,
): TelebirrAssignmentBrokerLocalHttpResponse {
  return Object.freeze({
    statusCode,
    headers: Object.freeze({
      ...responseHeaders,
      'content-length': String(body.byteLength),
      'content-type': contentType,
    }),
    body,
  });
}

function errorResponse(
  statusCode: number,
  code: 'invalid_request' | 'temporarily_unavailable',
): TelebirrAssignmentBrokerLocalHttpResponse {
  return response(statusCode, 'application/json', Buffer.from(JSON.stringify({ code }), 'utf8'));
}

export function createTelebirrAssignmentBrokerLocalHandler(
  poll: TelebirrAssignmentBrokerPoll,
): (
  request: TelebirrAssignmentBrokerLocalHttpRequest,
) => Promise<TelebirrAssignmentBrokerLocalHttpResponse> {
  if (typeof poll !== 'function') throw new TelebirrAssignmentBrokerLocalServerError();
  return async (request) => {
    try {
      if (!hasValidHttpEnvelope(request)) return errorResponse(400, 'invalid_request');
      const decoded = decodeTelebirrAssignmentBrokerLocalPollRequestBytes(request.body);
      if (decoded === undefined) return errorResponse(400, 'invalid_request');
      const result = await poll({
        certificate: decoded.certificate,
        bridgeRequestBodyDigest: decoded.bridgeRequestBodyDigest,
        requestedLeaseSeconds: decoded.requestedLeaseSeconds,
      });
      const body = encodeTelebirrAssignmentBrokerLocalPollResponse({
        contractVersion: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTRACT_VERSION,
        providerCode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROVIDER_CODE,
        protocolMode: TELEBIRR_ASSIGNMENT_BROKER_LOCAL_PROTOCOL_MODE,
        outcome: result.kind,
        assignment: result.kind === 'assignment' ? result.assignment : null,
        ...TELEBIRR_ASSIGNMENT_BROKER_LOCAL_NO_MONEY_SAFETY,
      });
      return body === undefined
        ? errorResponse(503, 'temporarily_unavailable')
        : response(200, TELEBIRR_ASSIGNMENT_BROKER_LOCAL_CONTENT_TYPE, body);
    } catch {
      return errorResponse(503, 'temporarily_unavailable');
    }
  };
}

function rawHeaders(request: IncomingMessage): readonly (readonly [string, string])[] | undefined {
  if (request.rawHeaders.length % 2 !== 0) return undefined;
  const result: (readonly [string, string])[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (name === undefined || value === undefined) return undefined;
    result.push(Object.freeze([name, value] as const));
  }
  return Object.freeze(result);
}

function declaredBodyLength(headers: readonly (readonly [string, string])[]): number | undefined {
  const values = headerValues(headers, 'content-length');
  if (values?.length !== 1 || !/^[1-9][0-9]{0,4}$/u.test(values[0] ?? '')) return undefined;
  const parsed = Number(values[0]);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= TELEBIRR_ASSIGNMENT_BROKER_LOCAL_MAX_REQUEST_BYTES
    ? parsed
    : undefined;
}

async function readExactBody(
  request: IncomingMessage,
  expectedBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunkValue of request) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    receivedBytes += chunk.byteLength;
    if (receivedBytes > expectedBytes) return undefined;
    chunks.push(chunk);
  }
  return receivedBytes === expectedBytes ? Buffer.concat(chunks, receivedBytes) : undefined;
}

function writeResponse(
  target: ServerResponse,
  source: TelebirrAssignmentBrokerLocalHttpResponse,
): void {
  target.writeHead(source.statusCode, source.headers);
  target.end(source.body);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

async function assertSafeRuntimeDirectory(effectiveUserId: number): Promise<void> {
  const before = (await lstat(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT)) as Stats;
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== effectiveUserId ||
    (before.mode & 0o777) !== 0o700 ||
    (await realpath(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT)) !==
      TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT
  ) {
    throw new TelebirrAssignmentBrokerLocalServerError();
  }
  const after = (await lstat(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_ROOT)) as Stats;
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.uid !== before.uid ||
    after.gid !== before.gid ||
    after.mode !== before.mode
  ) {
    throw new TelebirrAssignmentBrokerLocalServerError();
  }
}

async function removeStaleOwnedSocket(effectiveUserId: number): Promise<void> {
  try {
    const socket = (await lstat(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET)) as Stats;
    if (socket.isSymbolicLink() || !socket.isSocket() || socket.uid !== effectiveUserId) {
      throw new TelebirrAssignmentBrokerLocalServerError();
    }
    await unlink(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

interface SocketIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
}

async function removeExactSocket(identity: SocketIdentity): Promise<void> {
  try {
    const socket = (await lstat(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET)) as Stats;
    if (
      socket.isSymbolicLink() ||
      !socket.isSocket() ||
      socket.dev !== identity.dev ||
      socket.ino !== identity.ino ||
      socket.uid !== identity.uid
    ) {
      throw new TelebirrAssignmentBrokerLocalServerError();
    }
    await unlink(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
}

/**
 * Creates a Unix-domain-socket-only server. The fixed runtime directory must already exist, be
 * owned by this process, resolve to itself, and have mode 0700. No TCP address is accepted.
 */
export function createTelebirrAssignmentBrokerLocalUnixServer(poll: TelebirrAssignmentBrokerPoll): {
  readonly server: Server;
  readonly listen: () => Promise<void>;
  readonly close: () => Promise<void>;
} {
  const handler = createTelebirrAssignmentBrokerLocalHandler(poll);
  const server = createServer({ maxHeaderSize: 8_192 }, (request, target) => {
    void (async () => {
      try {
        const headers = rawHeaders(request);
        const expectedBytes = headers && declaredBodyLength(headers);
        if (headers === undefined || expectedBytes === undefined) {
          request.resume();
          writeResponse(target, errorResponse(400, 'invalid_request'));
          return;
        }
        request.setTimeout(5_000, () => request.destroy());
        const body = await readExactBody(request, expectedBytes);
        if (body === undefined) {
          writeResponse(target, errorResponse(400, 'invalid_request'));
          return;
        }
        writeResponse(
          target,
          await handler({ method: request.method, path: request.url, headers, body }),
        );
      } catch {
        if (!target.headersSent)
          writeResponse(target, errorResponse(503, 'temporarily_unavailable'));
        else target.destroy();
      }
    })();
  });
  server.maxConnections = 16;
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 7_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;

  let socketIdentity: SocketIdentity | undefined;
  let closed = false;
  return Object.freeze({
    server,
    listen: async () => {
      try {
        if (closed || server.listening || socketIdentity !== undefined) throw new Error();
        const effectiveUserId =
          typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN;
        if (!Number.isSafeInteger(effectiveUserId) || effectiveUserId < 1) throw new Error();
        await assertSafeRuntimeDirectory(effectiveUserId);
        await removeStaleOwnedSocket(effectiveUserId);
        await new Promise<void>((resolvePromise, rejectPromise) => {
          server.once('error', rejectPromise);
          server.listen(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET, () => {
            server.off('error', rejectPromise);
            resolvePromise();
          });
        });
        const createdSocket = (await lstat(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET)) as Stats;
        if (
          createdSocket.isSymbolicLink() ||
          !createdSocket.isSocket() ||
          createdSocket.uid !== effectiveUserId
        ) {
          throw new Error();
        }
        socketIdentity = Object.freeze({
          dev: createdSocket.dev,
          ino: createdSocket.ino,
          uid: createdSocket.uid,
        });
        await chmod(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET, 0o600);
        const socket = (await lstat(TELEBIRR_ASSIGNMENT_BROKER_LOCAL_SOCKET)) as Stats;
        if (
          socket.isSymbolicLink() ||
          !socket.isSocket() ||
          socket.dev !== socketIdentity.dev ||
          socket.ino !== socketIdentity.ino ||
          socket.uid !== socketIdentity.uid ||
          (socket.mode & 0o777) !== 0o600
        ) {
          throw new Error();
        }
        await assertSafeRuntimeDirectory(effectiveUserId);
      } catch {
        const identity = socketIdentity;
        socketIdentity = undefined;
        await closeServer(server).catch(() => undefined);
        if (identity !== undefined) await removeExactSocket(identity).catch(() => undefined);
        throw new TelebirrAssignmentBrokerLocalServerError();
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      const identity = socketIdentity;
      socketIdentity = undefined;
      try {
        await closeServer(server);
        if (identity !== undefined) await removeExactSocket(identity);
      } catch {
        throw new TelebirrAssignmentBrokerLocalServerError();
      }
    },
  });
}
