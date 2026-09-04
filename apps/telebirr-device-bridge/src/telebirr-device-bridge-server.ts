import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH,
  TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
  TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH,
  TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH,
  TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
} from '@fetanagent/telebirr-verification-foundation';

import type {
  TelebirrDeviceBridgeHttpRequest,
  TelebirrDeviceBridgeHttpResponse,
} from './telebirr-device-bridge.js';

export const TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST = '0.0.0.0' as const;
export const TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT = 8084 as const;
export const TELEBIRR_DEVICE_BRIDGE_MAX_REQUEST_BYTES = 256 * 1_024;
export const TELEBIRR_DEVICE_BRIDGE_MAX_RESPONSE_BYTES = 512 * 1_024;

const paths = new Set<string>([
  TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_POLL_PATH,
  TELEBIRR_DEVICE_BRIDGE_HEARTBEAT_PATH,
  TELEBIRR_DEVICE_BRIDGE_OBSERVATION_UPLOAD_PATH,
]);

const errorHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export type TelebirrDeviceBridgeHandler = (
  request: TelebirrDeviceBridgeHttpRequest,
) => Promise<TelebirrDeviceBridgeHttpResponse>;

export interface TelebirrDeviceBridgeHttpServerRuntime {
  readonly server: Pick<Server, 'listening'>;
  readonly listen: () => Promise<void>;
  readonly ready: () => boolean;
  readonly close: () => Promise<void>;
}

export class TelebirrDeviceBridgeHttpServerError extends Error {
  constructor() {
    super('The TeleBirr device bridge HTTP server is unavailable.');
    this.name = 'TelebirrDeviceBridgeHttpServerError';
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
  const contentLengths = headerValues(headers, 'content-length');
  const contentEncodings = headerValues(headers, 'content-encoding');
  const transferEncodings = headerValues(headers, 'transfer-encoding');
  const expects = headerValues(headers, 'expect');
  if (
    method !== 'POST' ||
    typeof path !== 'string' ||
    !paths.has(path) ||
    contentTypes?.length !== 1 ||
    contentTypes[0] !== TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE ||
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
    parsed <= TELEBIRR_DEVICE_BRIDGE_MAX_REQUEST_BYTES
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

function opaqueError(statusCode: 400 | 503, code: 'invalid_request' | 'temporarily_unavailable') {
  const body = Buffer.from(JSON.stringify({ code }), 'utf8');
  return Object.freeze({ statusCode, headers: errorHeaders, body });
}

function safeResponse(
  candidate: TelebirrDeviceBridgeHttpResponse,
): TelebirrDeviceBridgeHttpResponse {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !Number.isSafeInteger(candidate.statusCode) ||
    candidate.statusCode < 200 ||
    candidate.statusCode > 599 ||
    typeof candidate.headers !== 'object' ||
    candidate.headers === null ||
    !(candidate.body instanceof Uint8Array) ||
    candidate.body.byteLength === 0 ||
    candidate.body.byteLength > TELEBIRR_DEVICE_BRIDGE_MAX_RESPONSE_BYTES
  ) {
    return opaqueError(503, 'temporarily_unavailable');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(candidate.headers)) {
    const normalized = name.toLowerCase();
    if (
      normalized !== name ||
      !/^[a-z0-9-]+$/u.test(name) ||
      typeof value !== 'string' ||
      /[\0\r\n]/u.test(value) ||
      normalized === 'content-length' ||
      normalized === 'connection' ||
      Object.hasOwn(headers, normalized)
    ) {
      return opaqueError(503, 'temporarily_unavailable');
    }
    headers[normalized] = value;
  }
  return Object.freeze({
    statusCode: candidate.statusCode,
    headers: Object.freeze(headers),
    body: Buffer.from(candidate.body),
  });
}

function writeResponse(target: ServerResponse, source: TelebirrDeviceBridgeHttpResponse): void {
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

/**
 * Creates the internal plain-HTTP listener intended only for a private Docker network behind the
 * reviewed HTTPS gateway. Deployment must not publish this port directly to the host or Internet.
 */
export function createTelebirrDeviceBridgeHttpServer(
  handler: TelebirrDeviceBridgeHandler,
  options: {
    readonly host: typeof TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST;
    readonly port: typeof TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT;
  },
): TelebirrDeviceBridgeHttpServerRuntime {
  if (
    typeof handler !== 'function' ||
    options.host !== TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST ||
    options.port !== TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT
  ) {
    throw new TelebirrDeviceBridgeHttpServerError();
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
          writeResponse(target, opaqueError(400, 'invalid_request'));
          return;
        }
        request.setTimeout(7_000, () => request.destroy());
        const body = await readExactBody(request, expectedBytes);
        if (body === undefined) {
          writeResponse(target, opaqueError(400, 'invalid_request'));
          return;
        }
        writeResponse(
          target,
          await handler({ method: request.method ?? '', path: request.url ?? '', headers, body }),
        );
      } catch {
        if (!target.headersSent) {
          writeResponse(target, opaqueError(503, 'temporarily_unavailable'));
        } else {
          target.destroy();
        }
      }
    })();
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
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
        throw new TelebirrDeviceBridgeHttpServerError();
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
          throw new TelebirrDeviceBridgeHttpServerError();
        }
      })();
      return closePromise;
    },
  });
}
