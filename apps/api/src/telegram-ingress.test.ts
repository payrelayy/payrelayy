import { loadApiConfig } from '@payreplayy/config/api';
import {
  TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
  TELEGRAM_PRIVATE_INGRESS_HEADERS,
  TELEGRAM_PRIVATE_INGRESS_KEY_ID,
  TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES,
  TELEGRAM_PRIVATE_INGRESS_PATH,
  type TelegramPrivateInboundEvent,
} from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import {
  createTelegramIngressSignatureForTest,
  InMemoryTelegramIngressNonceStore,
  type TelegramPrivateInboundRecord,
  verifyTelegramIngressRequest,
} from './telegram-ingress.js';
import { TelegramIngressNonceStoreUnavailableError } from './postgres-telegram-ingress-nonce-store.js';

const transportHmacSecret = 'a'.repeat(64);
const payloadHmacSecret = 'b'.repeat(64);
const fixedNow = new Date('2026-08-08T12:00:00.000Z');
const fixedTimestamp = Math.floor(fixedNow.getTime() / 1000).toString();
const fixedNonce = 'n'.repeat(32);
const event: TelegramPrivateInboundEvent = {
  version: 1,
  updateId: '123456',
  telegramUserId: '28379330',
  privateChatId: '28379330',
  firstName: 'Example',
  lastName: null,
  username: 'example_user',
  preferredLocale: 'en',
};

function enabledApiConfig(nodeEnv: 'test' | 'production' = 'test') {
  return loadApiConfig({
    NODE_ENV: nodeEnv,
    INTERNAL_TELEGRAM_INGRESS_ENABLED: 'true',
    BOT_TO_API_INGRESS_HMAC_SECRET: transportHmacSecret,
    API_TELEGRAM_PAYLOAD_HMAC_SECRET: payloadHmacSecret,
  });
}

function signedIngressRequest(rawBody = Buffer.from(JSON.stringify(event), 'utf8')) {
  return {
    method: 'POST' as const,
    url: TELEGRAM_PRIVATE_INGRESS_PATH,
    payload: rawBody,
    headers: {
      'content-type': TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
      [TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId]: TELEGRAM_PRIVATE_INGRESS_KEY_ID,
      [TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp]: fixedTimestamp,
      [TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce]: fixedNonce,
      [TELEGRAM_PRIVATE_INGRESS_HEADERS.signature]: createTelegramIngressSignatureForTest(
        transportHmacSecret,
        fixedTimestamp,
        fixedNonce,
        rawBody,
      ),
    },
  };
}

describe('private Telegram ingress', () => {
  it('does not register the private route while ingress is disabled', async () => {
    const app = buildApp(loadApiConfig({ NODE_ENV: 'test' }));

    const response = await app.inject(signedIngressRequest());

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('authenticates exact raw bytes and forwards only a safe event plus API-only payload HMAC', async () => {
    const recorded: TelegramPrivateInboundRecord[] = [];
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramPrivateInboundRecorder: {
        record: async (input) => {
          recorded.push(input);
        },
      },
    });

    const response = await app.inject(signedIngressRequest());

    expect(response.statusCode).toBe(204);
    expect(recorded).toEqual([
      {
        event,
        payloadHmac: expect.stringMatching(/^hmac-sha256-v1:[0-9a-f]{64}$/),
      },
    ]);
    await app.close();
  });

  it('accepts only the legacy exact am wire value and normalizes it to English before recording', async () => {
    const recorded: TelegramPrivateInboundRecord[] = [];
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramPrivateInboundRecorder: {
        record: async (input) => {
          recorded.push(input);
        },
      },
    });
    const rawBody = Buffer.from(JSON.stringify({ ...event, preferredLocale: 'am' }), 'utf8');

    expect((await app.inject(signedIngressRequest(rawBody))).statusCode).toBe(204);
    expect(recorded).toEqual([
      {
        event,
        payloadHmac: expect.stringMatching(/^hmac-sha256-v1:[0-9a-f]{64}$/),
      },
    ]);
    await app.close();
  });

  it.each(['am-ET', 'fr', ''])(
    'rejects a signed non-English locale (%j) before calling the recorder',
    async (preferredLocale) => {
      const recorded: TelegramPrivateInboundRecord[] = [];
      const app = buildApp(enabledApiConfig(), {
        now: () => fixedNow,
        telegramPrivateInboundRecorder: {
          record: async (input) => {
            recorded.push(input);
          },
        },
      });
      const rawBody = Buffer.from(JSON.stringify({ ...event, preferredLocale }), 'utf8');

      expect((await app.inject(signedIngressRequest(rawBody))).statusCode).toBe(401);
      expect(recorded).toEqual([]);
      await app.close();
    },
  );

  it('rejects a replayed nonce before calling the recorder a second time', async () => {
    const recorded: TelegramPrivateInboundRecord[] = [];
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramPrivateInboundRecorder: {
        record: async (input) => {
          recorded.push(input);
        },
      },
    });
    const request = signedIngressRequest();

    expect((await app.inject(request)).statusCode).toBe(204);
    expect((await app.inject(request)).statusCode).toBe(401);
    expect(recorded).toHaveLength(1);
    await app.close();
  });

  it('does not parse or record an unsigned malformed body', async () => {
    const recorded: TelegramPrivateInboundRecord[] = [];
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramPrivateInboundRecorder: {
        record: async (input) => {
          recorded.push(input);
        },
      },
    });
    const request = signedIngressRequest(Buffer.from('{not JSON', 'utf8'));
    request.headers[TELEGRAM_PRIVATE_INGRESS_HEADERS.signature] = 'v1.invalid';

    const response = await app.inject(request);

    expect(response.statusCode).toBe(401);
    expect(recorded).toEqual([]);
    await app.close();
  });

  it('fails closed when the signed body is changed or contains fields outside the allowlist', async () => {
    const recorded: TelegramPrivateInboundRecord[] = [];
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramPrivateInboundRecorder: {
        record: async (input) => {
          recorded.push(input);
        },
      },
    });
    const tampered = signedIngressRequest(Buffer.from(JSON.stringify(event), 'utf8'));
    tampered.payload = Buffer.from(`${tampered.payload.toString('utf8')} `, 'utf8');

    expect((await app.inject(tampered)).statusCode).toBe(401);

    const extraFieldBody = Buffer.from(
      JSON.stringify({ ...event, text: 'never forwarded' }),
      'utf8',
    );
    const extraFieldRequest = signedIngressRequest(extraFieldBody);
    expect((await app.inject(extraFieldRequest)).statusCode).toBe(401);
    expect(recorded).toEqual([]);
    await app.close();
  });

  it('rejects an oversized body before invoking the inbox recorder', async () => {
    const recorded: TelegramPrivateInboundRecord[] = [];
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramPrivateInboundRecorder: {
        record: async (input) => {
          recorded.push(input);
        },
      },
    });

    const oversized = Buffer.alloc(TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES + 1, 0x20);
    expect((await app.inject(signedIngressRequest(oversized))).statusCode).toBe(413);
    expect(recorded).toEqual([]);
    await app.close();
  });

  it('returns a retryable response when the inbox recorder is unavailable', async () => {
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramPrivateInboundRecorder: {
        record: async () => {
          throw new Error('simulated recorder failure');
        },
      },
    });

    expect((await app.inject(signedIngressRequest())).statusCode).toBe(503);
    await app.close();
  });

  it('returns a retryable response when durable nonce storage is unavailable', async () => {
    const recorded: TelegramPrivateInboundRecord[] = [];
    const app = buildApp(enabledApiConfig(), {
      now: () => fixedNow,
      telegramIngressNonceStore: {
        durable: true,
        reserve: async () => {
          throw new TelegramIngressNonceStoreUnavailableError();
        },
      },
      telegramPrivateInboundRecorder: {
        record: async (input) => {
          recorded.push(input);
        },
      },
    });

    expect((await app.inject(signedIngressRequest())).statusCode).toBe(503);
    expect(recorded).toEqual([]);
    await app.close();
  });

  it('refuses production route activation with a process-local nonce store', () => {
    expect(() =>
      buildApp(enabledApiConfig('production'), {
        now: () => fixedNow,
        telegramIngressNonceStore: new InMemoryTelegramIngressNonceStore(),
        telegramPrivateInboundRecorder: { record: async () => undefined },
      }),
    ).toThrow('durable, cross-replica nonce store');
  });

  it('awaits a durable nonce reservation before accepting a production request', async () => {
    let reservations = 0;
    const app = buildApp(enabledApiConfig('production'), {
      now: () => fixedNow,
      telegramIngressNonceStore: {
        durable: true,
        reserve: async () => {
          reservations += 1;
          return true;
        },
      },
      telegramPrivateInboundRecorder: { record: async () => undefined },
    });

    expect((await app.inject(signedIngressRequest())).statusCode).toBe(204);
    expect(reservations).toBe(1);
    await app.close();
  });

  it('rejects duplicate authentication headers before parsing or reserving a nonce', async () => {
    const rawBody = Buffer.from(JSON.stringify(event), 'utf8');
    const signature = createTelegramIngressSignatureForTest(
      transportHmacSecret,
      fixedTimestamp,
      fixedNonce,
      rawBody,
    );
    let reservations = 0;

    const result = await verifyTelegramIngressRequest(
      {
        method: 'POST',
        url: TELEGRAM_PRIVATE_INGRESS_PATH,
        headers: {
          'content-type': TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId]: TELEGRAM_PRIVATE_INGRESS_KEY_ID,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp]: fixedTimestamp,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce]: fixedNonce,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.signature]: signature,
        },
        rawHeaders: [
          'content-type',
          TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId,
          TELEGRAM_PRIVATE_INGRESS_KEY_ID,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp,
          fixedTimestamp,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce,
          fixedNonce,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.signature,
          signature,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.signature,
          signature,
        ],
      },
      rawBody,
      {
        transportHmacSecret,
        payloadHmacSecret,
        now: fixedNow,
        nonceStore: {
          durable: true,
          reserve: async () => {
            reservations += 1;
            return true;
          },
        },
      },
    );

    expect(result).toBeUndefined();
    expect(reservations).toBe(0);
  });

  it('rejects duplicate optional content-encoding headers before parsing or reserving a nonce', async () => {
    const rawBody = Buffer.from(JSON.stringify(event), 'utf8');
    const signature = createTelegramIngressSignatureForTest(
      transportHmacSecret,
      fixedTimestamp,
      fixedNonce,
      rawBody,
    );
    let reservations = 0;

    const result = await verifyTelegramIngressRequest(
      {
        method: 'POST',
        url: TELEGRAM_PRIVATE_INGRESS_PATH,
        headers: {
          'content-type': TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId]: TELEGRAM_PRIVATE_INGRESS_KEY_ID,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp]: fixedTimestamp,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce]: fixedNonce,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.signature]: signature,
        },
        rawHeaders: [
          'content-type',
          TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId,
          TELEGRAM_PRIVATE_INGRESS_KEY_ID,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp,
          fixedTimestamp,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce,
          fixedNonce,
          TELEGRAM_PRIVATE_INGRESS_HEADERS.signature,
          signature,
          'content-encoding',
          'identity',
          'content-encoding',
          'identity',
        ],
      },
      rawBody,
      {
        transportHmacSecret,
        payloadHmacSecret,
        now: fixedNow,
        nonceStore: {
          durable: true,
          reserve: async () => {
            reservations += 1;
            return true;
          },
        },
      },
    );

    expect(result).toBeUndefined();
    expect(reservations).toBe(0);
  });
});
