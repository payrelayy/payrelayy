import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
  AGENT_PLATFORM_COMPANION_PAIRING_PATH,
} from '@fetanagent/agent-platform-companion-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompanionBridgeHttpRequest } from './pairing-handler.js';
import {
  COMPANION_DEVICE_BRIDGE_LISTEN_HOST,
  COMPANION_DEVICE_BRIDGE_LISTEN_PORT,
  createCompanionDeviceBridgeHttpServer,
  type CompanionDeviceBridgeHttpServerRuntime,
} from './server.js';

let activeServer: CompanionDeviceBridgeHttpServerRuntime | undefined;

afterEach(async () => {
  await activeServer?.close();
  activeServer = undefined;
});

function start() {
  let observedBody: Buffer | undefined;
  const handler = vi.fn(async (request: CompanionBridgeHttpRequest) => {
    observedBody = Buffer.from(request.body);
    return {
      statusCode: 201,
      headers: {
        'cache-control': 'no-store',
        'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
      },
      body: Buffer.from('{"certificate":"synthetic"}', 'utf8'),
    };
  });
  activeServer = createCompanionDeviceBridgeHttpServer(handler, {
    host: COMPANION_DEVICE_BRIDGE_LISTEN_HOST,
    port: COMPANION_DEVICE_BRIDGE_LISTEN_PORT,
  });
  return { handler, observedBody: () => observedBody, server: activeServer };
}

function request(body: Buffer, headers: Record<string, string> = {}) {
  return new Promise<{
    readonly body: string;
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
    readonly statusCode: number | undefined;
  }>((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: COMPANION_DEVICE_BRIDGE_LISTEN_PORT,
        method: 'POST',
        path: AGENT_PLATFORM_COMPANION_PAIRING_PATH,
        headers: {
          accept: AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          'content-length': String(body.byteLength),
          'content-type': AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE,
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.once('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          for (const chunk of chunks) chunk.fill(0);
          resolvePromise({
            body: responseBody,
            headers: response.headers,
            statusCode: response.statusCode,
          });
        });
      },
    );
    request.once('error', rejectPromise);
    request.end(body);
  });
}

function rawRequest(payload: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect({ host: '127.0.0.1', port: COMPANION_DEVICE_BRIDGE_LISTEN_PORT });
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000, () => socket.destroy());
    socket.once('connect', () => socket.end(payload, 'utf8'));
    socket.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    socket.once('error', rejectPromise);
    socket.once('close', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      for (const chunk of chunks) chunk.fill(0);
      resolvePromise(response);
    });
  });
}

describe('companion device bridge HTTP boundary', () => {
  it('accepts only the exact bounded pairing request and closes the connection', async () => {
    const { handler, observedBody, server } = start();
    await server.listen();
    expect(server.ready()).toBe(true);
    const body = Buffer.from('{"request":"synthetic"}', 'utf8');
    const response = await request(body);
    expect(response.statusCode).toBe(201);
    expect(response.headers.connection).toBe('close');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toBe('{"certificate":"synthetic"}');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      method: 'POST',
      path: AGENT_PLATFORM_COMPANION_PAIRING_PATH,
    });
    expect(observedBody()).toEqual(body);
    expect(Buffer.from(handler.mock.calls[0]?.[0].body ?? [])).toEqual(Buffer.alloc(body.length));
    observedBody()?.fill(0);
    body.fill(0);
  });

  it('rejects duplicated authority headers before the pairing handler', async () => {
    const { handler, server } = start();
    await server.listen();
    const response = await rawRequest(
      `POST ${AGENT_PLATFORM_COMPANION_PAIRING_PATH} HTTP/1.1\r\n` +
        'Host: 127.0.0.1\r\n' +
        `Accept: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
        `Content-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
        `Content-Type: ${AGENT_PLATFORM_COMPANION_PAIRING_CONTENT_TYPE}\r\n` +
        'Content-Length: 2\r\n' +
        'Connection: close\r\n\r\n{}',
    );
    expect(response).toContain('HTTP/1.1 400 Bad Request');
    expect(response).toContain('{"code":"invalid_request"}');
    expect(handler).not.toHaveBeenCalled();
  });

  it('closes parser-invalid clients without exposing Node parser details', async () => {
    const { handler, server } = start();
    await server.listen();
    const response = await rawRequest(
      `POST ${AGENT_PLATFORM_COMPANION_PAIRING_PATH} HTTP/1.1\r\n` +
        'Host: 127.0.0.1\r\n' +
        'Broken\u0000Header: value\r\n\r\n',
    );
    expect(response).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });
});
