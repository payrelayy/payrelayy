import { createServer, type Server, type ServerResponse } from 'node:http';

import type { TrustedTelebirrVerifierHealth } from './trusted-telebirr-verifier-health.js';

export interface TrustedTelebirrVerifierHealthServer {
  start(): Promise<void>;
  close(): Promise<void>;
  address(): { readonly host: '127.0.0.1'; readonly port: number } | null;
}

export interface TrustedTelebirrVerifierHealthServerOptions {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly allowEphemeralTestPort?: boolean;
}

function json(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/** A loopback-only health listener. It deliberately has no verifier or financial request route. */
export function createTrustedTelebirrVerifierHealthServer(
  health: TrustedTelebirrVerifierHealth,
  options: TrustedTelebirrVerifierHealthServerOptions,
): TrustedTelebirrVerifierHealthServer {
  if (
    options.host !== '127.0.0.1' ||
    !Number.isInteger(options.port) ||
    (options.port === 0 ? options.allowEphemeralTestPort !== true : options.port < 1) ||
    options.port > 65_535
  ) {
    throw new TypeError('The trusted TeleBirr verifier health listener must use loopback.');
  }

  let server: Server | null = null;
  let boundPort: number | null = null;

  return Object.freeze({
    async start() {
      if (server !== null) throw new Error('The verifier health listener is already started.');
      const candidate = createServer(async (request, response) => {
        if (request.method !== 'GET') {
          response.setHeader('allow', 'GET');
          return json(response, 405, { status: 'method_not_allowed' });
        }
        if (request.url === '/healthz') return json(response, 200, health.healthz());
        if (request.url === '/readyz') {
          const readiness = await health.readyz();
          return json(response, readiness.ready ? 200 : 503, readiness);
        }
        return json(response, 404, { status: 'not_found' });
      });
      candidate.headersTimeout = 5_000;
      candidate.requestTimeout = 5_000;
      candidate.keepAliveTimeout = 1_000;
      candidate.maxHeadersCount = 16;
      candidate.on('clientError', (_error, socket) => socket.destroy());
      // Publish the candidate before the asynchronous listen completes so an immediate process
      // stop can close the pending listener rather than leaving a late-bound server behind.
      server = candidate;

      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            candidate.off('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            candidate.off('error', onError);
            resolve();
          };
          candidate.once('error', onError);
          candidate.once('listening', onListening);
          candidate.listen(options.port, options.host);
        });
      } catch {
        if (server === candidate) server = null;
        candidate.closeAllConnections();
        candidate.close();
        throw new Error('The verifier health listener could not start.');
      }

      const address = candidate.address();
      if (server !== candidate || address === null || typeof address === 'string') {
        if (server === candidate) server = null;
        candidate.closeAllConnections();
        candidate.close();
        throw new Error('The verifier health listener could not start.');
      }
      boundPort = address.port;
    },

    async close() {
      const active = server;
      server = null;
      boundPort = null;
      if (active === null) return;
      await new Promise<void>((resolve) => {
        active.close(() => resolve());
        active.closeAllConnections();
      });
    },

    address() {
      return boundPort === null ? null : { host: '127.0.0.1' as const, port: boundPort };
    },
  });
}
