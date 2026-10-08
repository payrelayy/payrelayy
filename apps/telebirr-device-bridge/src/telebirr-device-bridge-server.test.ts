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
import {
  ROUTINE_NO_MONEY_CONTENT_TYPE,
  ROUTINE_NO_MONEY_POLL_PATH,
  ROUTINE_NO_MONEY_UPLOAD_PATH,
} from './routine-no-money-bridge.js';
import {
  ROUTINE_PAID_POLL_CONTENT_TYPE,
  ROUTINE_PAID_POLL_PATH,
} from './routine-paid-poll-bridge.js';
import {
  ROUTINE_PAID_UPLOAD_CONTENT_TYPE,
  ROUTINE_PAID_UPLOAD_PATH,
} from './routine-paid-upload-bridge.js';

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

  it('keeps both routine routes closed when no private handler is composed', async () => {
    const pilot = vi.fn();
    runtime = createTelebirrDeviceBridgeHttpServer(pilot, {
      host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
      port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
    });
    await runtime.listen();
    for (const path of [
      ROUTINE_NO_MONEY_POLL_PATH,
      ROUTINE_NO_MONEY_UPLOAD_PATH,
      ROUTINE_PAID_POLL_PATH,
      ROUTINE_PAID_UPLOAD_PATH,
    ]) {
      const response = await exchange({
        path,
        headers: {
          'content-length': '2',
          'content-type':
            path === ROUTINE_PAID_UPLOAD_PATH
              ? ROUTINE_PAID_UPLOAD_CONTENT_TYPE
              : path === ROUTINE_PAID_POLL_PATH
                ? ROUTINE_PAID_POLL_CONTENT_TYPE
                : ROUTINE_NO_MONEY_CONTENT_TYPE,
        },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(pilot).not.toHaveBeenCalled();
  });

  it('dispatches paid upload only to its explicit handler and preserves no-credit responses', async () => {
    const pilot = vi.fn();
    const paidUpload = vi.fn(async () => ({
      statusCode: 202,
      headers: { 'cache-control': 'no-store', 'content-type': ROUTINE_PAID_UPLOAD_CONTENT_TYPE },
      body: Buffer.from(
        JSON.stringify({
          outcome: 'signed_paid_observation_staged',
          advisoryOnly: true,
          paymentVerificationRequested: true,
          pairedPhoneEvidenceVerified: true,
          sourceAuthenticationPerformed: false,
          financialActionAllowed: false,
        }),
      ),
    }));
    runtime = createTelebirrDeviceBridgeHttpServer(
      pilot,
      { host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST, port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT },
      undefined,
      undefined,
      paidUpload,
    );
    await runtime.listen();
    const valid = await exchange({
      path: ROUTINE_PAID_UPLOAD_PATH,
      headers: { 'content-length': '2', 'content-type': ROUTINE_PAID_UPLOAD_CONTENT_TYPE },
    });
    expect(valid.statusCode).toBe(202);
    expect(valid.headers['content-type']).toBe(ROUTINE_PAID_UPLOAD_CONTENT_TYPE);
    expect(paidUpload).toHaveBeenCalledOnce();
    for (const headers of [
      { 'content-length': '2', 'content-type': ROUTINE_PAID_POLL_CONTENT_TYPE },
      { 'content-length': '49153', 'content-type': ROUTINE_PAID_UPLOAD_CONTENT_TYPE },
    ])
      expect((await exchange({ path: ROUTINE_PAID_UPLOAD_PATH, headers })).statusCode).toBe(400);
    expect(paidUpload).toHaveBeenCalledOnce();
    expect(pilot).not.toHaveBeenCalled();
  });

  it('isolates the paid poll path and media type from no-money and pilot handlers', async () => {
    const pilot = vi.fn();
    const noMoney = vi.fn();
    const paid = vi.fn(async () => ({
      statusCode: 200,
      headers: { 'cache-control': 'no-store', 'content-type': ROUTINE_PAID_POLL_CONTENT_TYPE },
      body: Buffer.from(
        '{"outcome":"no_assignment","advisoryOnly":true,"paymentVerificationRequested":true,"financialActionAllowed":false}',
      ),
    }));
    runtime = createTelebirrDeviceBridgeHttpServer(
      pilot,
      { host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST, port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT },
      noMoney,
      paid,
    );
    await runtime.listen();
    const valid = await exchange({
      path: ROUTINE_PAID_POLL_PATH,
      headers: { 'content-length': '2', 'content-type': ROUTINE_PAID_POLL_CONTENT_TYPE },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.headers['content-type']).toBe(ROUTINE_PAID_POLL_CONTENT_TYPE);
    expect(paid).toHaveBeenCalledOnce();
    for (const headers of [
      { 'content-length': '2', 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
      { 'content-length': '4097', 'content-type': ROUTINE_PAID_POLL_CONTENT_TYPE },
    ]) {
      expect((await exchange({ path: ROUTINE_PAID_POLL_PATH, headers })).statusCode).toBe(400);
    }
    expect(paid).toHaveBeenCalledOnce();
    expect(noMoney).not.toHaveBeenCalled();
    expect(pilot).not.toHaveBeenCalled();
  });

  it('does not emit a paid success response without the verification-requested marker', async () => {
    runtime = createTelebirrDeviceBridgeHttpServer(
      vi.fn(),
      { host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST, port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT },
      undefined,
      vi.fn(async () => ({
        statusCode: 200,
        headers: { 'cache-control': 'no-store', 'content-type': ROUTINE_PAID_POLL_CONTENT_TYPE },
        body: Buffer.from(
          '{"outcome":"assignment","advisoryOnly":true,"financialActionAllowed":false}',
        ),
      })),
    );
    await runtime.listen();
    const response = await exchange({
      path: ROUTINE_PAID_POLL_PATH,
      headers: { 'content-length': '2', 'content-type': ROUTINE_PAID_POLL_CONTENT_TYPE },
    });
    expect(response.statusCode).toBe(503);
  });

  it('dispatches only exact bounded vendor requests to an explicitly composed routine handler', async () => {
    const pilot = vi.fn();
    const routine = vi.fn(async () => ({
      statusCode: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE,
      },
      body: Buffer.from(
        '{"outcome":"no_assignment","advisoryOnly":true,"financialActionAllowed":false}',
      ),
    }));
    runtime = createTelebirrDeviceBridgeHttpServer(
      pilot,
      {
        host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
        port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
      },
      routine,
    );
    await runtime.listen();
    for (const path of [ROUTINE_NO_MONEY_POLL_PATH, ROUTINE_NO_MONEY_UPLOAD_PATH]) {
      const response = await exchange({
        path,
        headers: { 'content-length': '2', 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe(ROUTINE_NO_MONEY_CONTENT_TYPE);
    }
    expect(routine).toHaveBeenCalledTimes(2);
    expect(pilot).not.toHaveBeenCalled();
  });

  it.each([
    [
      'pilot media type',
      ROUTINE_NO_MONEY_POLL_PATH,
      { 'content-length': '2', 'content-type': TELEBIRR_DEVICE_BRIDGE_CONTENT_TYPE },
    ],
    [
      'duplicate routine media type',
      ROUTINE_NO_MONEY_POLL_PATH,
      {
        'content-length': '2',
        'content-type': [ROUTINE_NO_MONEY_CONTENT_TYPE, ROUTINE_NO_MONEY_CONTENT_TYPE],
      },
    ],
    [
      'query-bearing route',
      `${ROUTINE_NO_MONEY_POLL_PATH}?retry=1`,
      { 'content-length': '2', 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
    ],
    [
      'oversized poll',
      ROUTINE_NO_MONEY_POLL_PATH,
      { 'content-length': String(4_097), 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
    ],
    [
      'oversized upload',
      ROUTINE_NO_MONEY_UPLOAD_PATH,
      { 'content-length': String(48 * 1_024 + 1), 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
    ],
    [
      'compressed poll',
      ROUTINE_NO_MONEY_POLL_PATH,
      {
        'content-length': '2',
        'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE,
        'content-encoding': 'gzip',
      },
    ],
  ])('rejects %s before either route handler', async (_name, path, headers) => {
    const pilot = vi.fn();
    const routine = vi.fn();
    runtime = createTelebirrDeviceBridgeHttpServer(
      pilot,
      {
        host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
        port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
      },
      routine,
    );
    await runtime.listen();
    const response = await exchange({ path, headers });
    expect(response.statusCode).toBe(400);
    expect(pilot).not.toHaveBeenCalled();
    expect(routine).not.toHaveBeenCalled();
  });

  it.each([
    [
      { 'cache-control': 'no-store', 'content-type': 'application/json' },
      '{"outcome":"no_assignment","advisoryOnly":true,"financialActionAllowed":false}',
      200,
    ],
    [
      { 'cache-control': 'no-store', 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
      '{"outcome":"no_assignment","advisoryOnly":true,"financialActionAllowed":true}',
      200,
    ],
    [
      { 'cache-control': 'no-store', 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
      '{"outcome":"review","advisoryOnly":true,"sourceAuthenticationPerformed":true,"financialActionAllowed":false}',
      202,
    ],
    [
      { 'cache-control': 'no-store', 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
      '{"code":"invalid_request","rawReference":"SAMPLE9ABC1234"}',
      401,
    ],
  ])('reduces an unsafe routine response to an opaque 503', async (headers, body, statusCode) => {
    const routine = vi.fn(async () => ({ statusCode, headers, body: Buffer.from(body) }));
    runtime = createTelebirrDeviceBridgeHttpServer(
      vi.fn(),
      {
        host: TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
        port: TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
      },
      routine,
    );
    await runtime.listen();
    const response = await exchange({
      path: ROUTINE_NO_MONEY_POLL_PATH,
      headers: { 'content-length': '2', 'content-type': ROUTINE_NO_MONEY_CONTENT_TYPE },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body.toString('utf8')).toBe('{"code":"temporarily_unavailable"}');
    expect(routine).toHaveBeenCalledOnce();
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
