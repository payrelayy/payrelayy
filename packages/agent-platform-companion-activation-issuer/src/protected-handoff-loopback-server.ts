import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE } from '@fetanagent/agent-platform-companion-contracts';

import type {
  ProtectedHandoffHttpRequest,
  ProtectedHandoffHttpResponse,
} from './protected-handoff-request.js';

const MAX_REQUEST_BYTES = 16 * 1_024;
const errorBody = Buffer.from('{"code":"temporarily_unavailable"}', 'utf8');
const errorHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

export interface ProtectedHandoffLoopbackServer {
  listen(): Promise<number>;
  close(): Promise<void>;
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

function contentLength(headers: readonly (readonly [string, string])[]): number | undefined {
  const values = headers
    .filter(([name]) => name.toLowerCase() === 'content-length')
    .map(([, value]) => value);
  if (values.length !== 1 || !/^[1-9][0-9]{0,4}$/u.test(values[0]!)) return undefined;
  const length = Number(values[0]);
  return length <= MAX_REQUEST_BYTES ? length : undefined;
}

async function readExactBody(
  request: IncomingMessage,
  declaredLength: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      received += chunk.byteLength;
      if (received > declaredLength) return undefined;
      chunks.push(Buffer.from(chunk));
    }
    return received === declaredLength ? Buffer.concat(chunks, received) : undefined;
  } catch {
    return undefined;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function respond(response: ServerResponse, result: ProtectedHandoffHttpResponse): void {
  response.writeHead(result.statusCode, {
    ...result.headers,
    'content-length': result.body.byteLength,
  });
  response.end(result.body);
}

function fail(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(503, { ...errorHeaders, 'content-length': errorBody.byteLength });
  response.end(errorBody);
}

/**
 * An on-demand, loopback-only HTTP adapter for one protected handler instance.
 * This is not installed in the public bridge and has no credential loader,
 * service entry point, or remote listener. A protected caller must supply a
 * separately authenticated tunnel and close this listener on every outcome.
 */
export function createProtectedHandoffLoopbackServer(
  handler: (request: ProtectedHandoffHttpRequest) => Promise<ProtectedHandoffHttpResponse>,
  port: number,
): ProtectedHandoffLoopbackServer {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  let started = false;
  let closed = false;
  const server: Server = createServer({ maxHeaderSize: 8 * 1_024 }, async (request, response) => {
    let body: Buffer | undefined;
    try {
      if (request.socket.remoteAddress !== '127.0.0.1') throw new Error();
      const headers = rawHeaders(request);
      const length = headers && contentLength(headers);
      if (!headers || length === undefined) throw new Error();
      body = await readExactBody(request, length);
      if (!body) throw new Error();
      respond(
        response,
        await handler({
          method: request.method ?? '',
          path: request.url ?? '',
          headers,
          body,
        }),
      );
    } catch {
      fail(response);
    } finally {
      body?.fill(0);
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  return Object.freeze({
    listen(): Promise<number> {
      if (started || closed) return Promise.reject(new Error('Listener unavailable.'));
      started = true;
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Listener unavailable.'));
            return;
          }
          resolve(address.port);
        });
      });
    },
    close(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      if (!started) return Promise.resolve();
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(new Error('Listener close failed.')) : resolve()));
        server.closeAllConnections();
      });
    },
  });
}
