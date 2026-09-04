import { request as httpRequest } from 'node:http';

import {
  TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
  TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
} from '@fetanagent/telebirr-verification-foundation';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
  TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
  TELEBIRR_DEVICE_BRIDGE_MAX_REQUEST_BYTES,
  TelebirrDeviceBridgeHttpServerError,
  createTelebirrDeviceBridgeHttpServer,
  type TelebirrDeviceBridgeHttpServerRuntime,
} from './telebirr-device-bridge-server.js';

interface NetworkResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Buffer;
}

async function exchange(
  options: {
    readonly path?: string;
    readonly headers?: Readonly<Record<string, string | string[]>>;
    readonly body?: Buffer;
  } = {},
): Promise<NetworkResponse> {
  const body = options.body ?? Buffer.from('{}', 'utf8');
  return new Promise<NetworkResponse>((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
        method: 'POST',
        path: options.path ?? TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
        headers:
          options.headers ??
          ({
            'content-length': String(body.byteLength),
            'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
          } as const),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', rejectPromise);
        response.once('end', () =>
          resolvePromise({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.once('error', rejectPromise);
    request.end(body);
  });
}

describe('TeleBirr device bridge HTTP server', () => {
  let runtime: TelebirrDeviceBridgeHttpServerRuntime | undefined;

  afterEach(async () => {
    await runtime?.close().catch(() => undefined);
    runtime = undefined;
  });

  it('dispatches one exact bounded request and emits explicit safe framing', async () => {
    const handler = vi.fn(async (request) => ({
      statusCode: 201,
      headers: {
        'cache-control': 'no-store',
        'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
      },
      body: Buffer.from(JSON.stringify({ accepted: true }), 'utf8'),
    }));
    runtime = createTelebirrDeviceBridgeHttpServer(handler, {
      host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
      port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
    });
    await runtime.listen();
    expect(runtime.ready()).toBe(true);

    const body = Buffer.from('{"pairing":"synthetic"}', 'utf8');
    const response = await exchange({ body });
    expect(response.statusCode).toBe(201);
    expect(response.headers.connection).toBe('close');
    expect(response.headers['content-length']).toBe(String(response.body.byteLength));
    expect(response.headers['content-type']).toBe(TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE);
    expect(response.body.toString('utf8')).toBe('{"accepted":true}');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      method: 'POST',
      path: TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
      body,
    });
  });

  it.each([
    [
      'duplicate content type',
      TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
      {
        'content-length': '2',
        'content-type': [TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE, TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE],
      },
    ],
    [
      'compressed request',
      TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
      {
        'content-encoding': 'gzip',
        'content-length': '2',
        'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
      },
    ],
    [
      'query-bearing path',
      `${TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH}?retry=1`,
      {
        'content-length': '2',
        'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
      },
    ],
    [
      'oversized declaration',
      TELEBIRR_DEVICE_BRIDGE_PAIRING_PATH,
      {
        'content-length': String(TELEBIRR_DEVICE_BRIDGE_MAX_REQUEST_BYTES + 1),
        'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
      },
    ],
  ])('rejects %s before dispatch', async (_name, path, headers) => {
    const handler = vi.fn();
    runtime = createTelebirrDeviceBridgeHttpServer(handler, {
      host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
      port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
    });
    await runtime.listen();
    const response = await exchange({ path, headers });
    expect(response.statusCode).toBe(400);
    expect(response.body.toString('utf8')).toBe('{"code":"invalid_request"}');
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects chunked framing without dispatch', async () => {
    const handler = vi.fn();
    runtime = createTelebirrDeviceBridgeHttpServer(handler, {
      host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
      port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
    });
    await runtime.listen();
    const response = await exchange({
      headers: {
        'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE,
        'transfer-encoding': 'chunked',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('reduces handler failures and unsafe responses to one opaque 503', async () => {
    for (const handler of [
      vi.fn(async () => {
        throw new Error('private local socket path');
      }),
      vi.fn(async () => ({
        statusCode: 200,
        headers: { 'x-unsafe': 'value\nleak' },
        body: Buffer.from('{}'),
      })),
    ]) {
      runtime = createTelebirrDeviceBridgeHttpServer(handler, {
        host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
        port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
      });
      await runtime.listen();
      const response = await exchange();
      expect(response.statusCode).toBe(503);
      expect(response.body.toString('utf8')).toBe('{"code":"temporarily_unavailable"}');
      expect(response.body.toString('utf8')).not.toContain('socket');
      await runtime.close();
      runtime = undefined;
    }
  });

  it('accepts only the fixed private-network bind contract and closes idempotently', async () => {
    expect(() =>
      createTelebirrDeviceBridgeHttpServer(vi.fn(), {
        host: '127.0.0.1' as typeof TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
        port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
      }),
    ).toThrow(TelebirrDeviceBridgeHttpServerError);
    runtime = createTelebirrDeviceBridgeHttpServer(vi.fn(), {
      host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
      port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
    });
    await runtime.listen();
    await Promise.all([runtime.close(), runtime.close()]);
    expect(runtime.ready()).toBe(false);
  });
});
