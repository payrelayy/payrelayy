import { createServer, type Server } from 'node:http';

import type { KemerBetExecutorHealth } from './executor-health.js';

export interface KemerBetExecutorHealthServer {
  start(): Promise<void>;
  close(): Promise<void>;
  address(): { readonly host: '127.0.0.1'; readonly port: number } | null;
}

export interface KemerBetExecutorHealthServerOptions {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly allowEphemeralTestPort?: boolean;
}

function json(serverResponse: import('node:http').ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  serverResponse.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  serverResponse.end(body);
}

export function createKemerBetExecutorHealthServer(
  health: KemerBetExecutorHealth,
  options: KemerBetExecutorHealthServerOptions,
): KemerBetExecutorHealthServer {
  if (
    options.host !== '127.0.0.1' ||
    !Number.isInteger(options.port) ||
    (options.port === 0 ? options.allowEphemeralTestPort !== true : options.port < 1) ||
    options.port > 65_535
  ) {
    throw new TypeError('The executor health listener must use its private loopback boundary.');
  }

  let server: Server | null = null;
  let boundPort: number | null = null;

  return {
    async start() {
      if (server !== null) throw new Error('The executor health listener is already started.');
      const candidate = createServer(async (request, response) => {
        response.setHeader('x-content-type-options', 'nosniff');
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
      candidate.on('clientError', (_error, socket) => socket.destroy());
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
        candidate.close();
        throw new Error('The executor health listener could not start.');
      }
      const address = candidate.address();
      if (address === null || typeof address === 'string') {
        candidate.close();
        throw new Error('The executor health listener could not start.');
      }
      boundPort = address.port;
      server = candidate;
    },

    async close() {
      const active = server;
      server = null;
      boundPort = null;
      if (active === null) return;
      await new Promise<void>((resolve) => active.close(() => resolve()));
    },

    address() {
      return boundPort === null ? null : { host: '127.0.0.1', port: boundPort };
    },
  };
}
