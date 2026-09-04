import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PAIRING_PATH,
} from '@fetanagent/agent-platform-companion-contracts';

import type { CompanionBridgeHttpRequest, CompanionBridgeHttpResponse } from './pairing-handler.js';

export const COMPANION_DEVICE_BRIDGE_LISTEN_HOST = '0.0.0.0' as const;
export const COMPANION_DEVICE_BRIDGE_LISTEN_PORT = 8085 as const;
export const COMPANION_DEVICE_BRIDGE_MAX_REQUEST_BYTES = 64 * 1_024;
export const COMPANION_DEVICE_BRIDGE_MAX_RESPONSE_BYTES = 64 * 1_024;

const errorHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export type CompanionDeviceBridgeHandler = (
  request: CompanionBridgeHttpRequest,
) => Promise<CompanionBridgeHttpResponse>;

export interface CompanionDeviceBridgeHttpServerRuntime {
  readonly server: Pick<Server, 'listening'>;
  listen(): Promise<void>;
  ready(): boolean;
  close(): Promise<void>;
}

export class CompanionDeviceBridgeHttpServerError extends Error {
  constructor() {
    super('The companion device bridge HTTP server is unavailable.');
    this.name = 'CompanionDeviceBridgeHttpServerError';
  }
}

function headerValues(
  headers: readonly (readonly [string, string])[],
  expectedName: string,
): readonly string[] | undefined {
  if (!Array.isArray(headers)) return undefined;
  const result: string[] = [];
  for (const candidate of headers) {
    if (
      !Array.isArray(candidate) ||
      candidate.length !== 2 ||
      typeof candidate[0] !== 'string' ||
      typeof candidate[1] !== 'string'
    ) {
      return undefined;
    }
    if (candidate[0].toLowerCase() === expectedName) result.push(candidate[1]);
  }
  return result;
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

function declaredBodyLength(
  method: string | undefined,
  path: string | undefined,
  headers: readonly (readonly [string, string])[],
): number | undefined {
  const contentTypes = headerValues(headers, 'content-type');
  const accepts = headerValues(headers, 'accept');
  const contentLengths = headerValues(headers, 'content-length');
  const contentEncodings = headerValues(headers, 'content-encoding');
  const transferEncodings = headerValues(headers, 'transfer-encoding');
  const expects = headerValues(headers, 'expect');
  if (
    method !== 'POST' ||
    path !== AGENT_PLATFORM_COMPANION_PAIRING_PATH ||
    contentTypes?.length !== 1 ||
    contentTypes[0] !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
    accepts?.length !== 1 ||
    accepts[0] !== AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE ||
    contentLengths?.length !== 1 ||
    !/^[1-9][0-9]{0,5}$/u.test(contentLengths[0] ?? '') ||
    contentEncodings?.length !== 0 ||
    transferEncodings?.length !== 0 ||
    expects?.length !== 0
  ) {
    return undefined;
  }
  const parsed = Number(contentLengths[0]);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= COMPANION_DEVICE_BRIDGE_MAX_REQUEST_BYTES
    ? parsed
    : undefined;
}

async function readExactBody(
  request: IncomingMessage,
  expectedBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  try {
    for await (const chunkValue of request) {
      const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > expectedBytes) return undefined;
      chunks.push(Buffer.from(chunk));
    }
    return receivedBytes === expectedBytes ? Buffer.concat(chunks, receivedBytes) : undefined;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function opaqueError(): CompanionBridgeHttpResponse {
  return Object.freeze({
    statusCode: 400,
    headers: errorHeaders,
    body: Buffer.from(JSON.stringify({ code: 'invalid_request' }), 'utf8'),
  });
}

function unavailableError(): CompanionBridgeHttpResponse {
  return Object.freeze({
    statusCode: 503,
    headers: errorHeaders,
    body: Buffer.from(JSON.stringify({ code: 'temporarily_unavailable' }), 'utf8'),
  });
}

function safeResponse(candidate: CompanionBridgeHttpResponse): CompanionBridgeHttpResponse {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !Number.isSafeInteger(candidate.statusCode) ||
    candidate.statusCode < 200 ||
    candidate.statusCode > 599 ||
    typeof candidate.headers !== 'object' ||
    candidate.headers === null ||
    !(candidate.body instanceof Uint8Array) ||
    candidate.body.byteLength < 1 ||
    candidate.body.byteLength > COMPANION_DEVICE_BRIDGE_MAX_RESPONSE_BYTES
  ) {
    return unavailableError();
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(candidate.headers)) {
    if (
      name !== name.toLowerCase() ||
      !/^[a-z0-9-]+$/u.test(name) ||
      typeof value !== 'string' ||
      /[\0\r\n]/u.test(value) ||
      name === 'content-length' ||
      name === 'connection' ||
      Object.hasOwn(headers, name)
    ) {
      return unavailableError();
    }
    headers[name] = value;
  }
  return Object.freeze({
    statusCode: candidate.statusCode,
    headers: Object.freeze(headers),
    body: Buffer.from(candidate.body),
  });
}

function writeResponse(target: ServerResponse, source: CompanionBridgeHttpResponse): void {
  const selected = safeResponse(source);
  target.writeHead(selected.statusCode, {
    ...selected.headers,
    connection: 'close',
    'content-length': String(selected.body.byteLength),
  });
  target.end(selected.body);
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
}

export function createCompanionDeviceBridgeHttpServer(
  handler: CompanionDeviceBridgeHandler,
  options: {
    readonly host: typeof COMPANION_DEVICE_BRIDGE_LISTEN_HOST;
    readonly port: typeof COMPANION_DEVICE_BRIDGE_LISTEN_PORT;
  },
): CompanionDeviceBridgeHttpServerRuntime {
  if (
    typeof handler !== 'function' ||
    options.host !== COMPANION_DEVICE_BRIDGE_LISTEN_HOST ||
    options.port !== COMPANION_DEVICE_BRIDGE_LISTEN_PORT
  ) {
    throw new CompanionDeviceBridgeHttpServerError();
  }
  let available = false;
  let closed = false;
  const server = createServer({ maxHeaderSize: 8_192 }, (request, target) => {
    void (async () => {
      try {
        const headers = rawHeaders(request);
        const expectedBytes = headers && declaredBodyLength(request.method, request.url, headers);
        if (headers === undefined || expectedBytes === undefined) {
          request.resume();
          writeResponse(target, opaqueError());
          return;
        }
        request.setTimeout(7_000, () => request.destroy());
        const body = await readExactBody(request, expectedBytes);
        if (!body) {
          writeResponse(target, opaqueError());
          return;
        }
        try {
          writeResponse(
            target,
            await handler({ method: request.method ?? '', path: request.url ?? '', headers, body }),
          );
        } finally {
          body.fill(0);
        }
      } catch {
        if (!target.headersSent) writeResponse(target, unavailableError());
        else target.destroy();
      }
    })();
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.on('clientError', (_error, socket) => {
    socket.destroy();
  });
  server.on('error', () => {
    available = false;
  });

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    server,
    listen: async () => {
      try {
        if (closed || server.listening || available) throw new Error();
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const failed = (error: Error) => {
            server.off('listening', listening);
            rejectPromise(error);
          };
          const listening = () => {
            server.off('error', failed);
            resolvePromise();
          };
          server.once('error', failed);
          server.once('listening', listening);
          server.listen(options.port, options.host);
        });
        const address = server.address();
        if (
          address === null ||
          typeof address === 'string' ||
          address.address !== options.host ||
          address.port !== options.port
        ) {
          throw new Error();
        }
        available = true;
      } catch {
        available = false;
        await closeServer(server).catch(() => undefined);
        throw new CompanionDeviceBridgeHttpServerError();
      }
    },
    ready: () => available && !closed && server.listening,
    close: () => {
      closePromise ??= (async () => {
        closed = true;
        available = false;
        try {
          await closeServer(server);
        } catch {
          throw new CompanionDeviceBridgeHttpServerError();
        }
      })();
      return closePromise;
    },
  });
}
