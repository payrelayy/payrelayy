import {
  loadBetaAdmissionConfig,
  PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE,
} from '@payreplayy/config/beta-admission';
import {
  TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
  TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS,
  TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
  TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
  type TelegramBetaInviteRedemption,
} from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import { buildBetaAdmissionApp } from './app.js';
import type { BetaAdmissionPostgresRuntime } from './postgres-runtime.js';
import {
  createTelegramBetaInviteAdmissionSignatureForTest,
  TelegramBetaInviteAdmissionRejectedError,
  TelegramBetaInviteAdmissionUnavailableError,
} from './telegram-beta-invite-admission.js';

const transportHmacSecret = 'a'.repeat(64);
const payloadHmacSecret = 'b'.repeat(64);
const fixedNow = new Date('2026-08-10T12:00:00.000Z');
const timestamp = Math.floor(fixedNow.getTime() / 1_000).toString();
const nonce = 'n'.repeat(32);
const inviteToken = 'A'.repeat(43);
const redemption: TelegramBetaInviteRedemption = {
  version: 1,
  kind: 'beta_invite_redemption',
  updateId: '123456',
  telegramUserId: '28379330',
  privateChatId: '28379330',
  inviteToken,
  preferredLocale: 'en',
};

function config() {
  const loaded = loadBetaAdmissionConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED: 'true',
    BETA_ADMISSION_DATABASE_URL: `postgresql://payreplayy_beta_admission_runtime.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    BOT_TO_BETA_ADMISSION_HMAC_SECRET: transportHmacSecret,
    BETA_ADMISSION_PAYLOAD_HMAC_SECRET: payloadHmacSecret,
  });
  if (!loaded.runtime.enabled) throw new Error('test configuration failed closed');
  return loaded;
}

function runtime(
  overrides: Partial<BetaAdmissionPostgresRuntime> = {},
): BetaAdmissionPostgresRuntime {
  return {
    admission: {
      redeem: async () => ({
        inboundEventId: '7ce59f16-08e6-4c20-a694-e1f7b1b20d4d',
        receivedAt: fixedNow,
        inboundEventAlreadyRecorded: false,
      }),
    },
    nonceStore: { durable: true, reserve: async () => true },
    ready: async () => true,
    close: async () => undefined,
    ...overrides,
  };
}

function signedRequest() {
  const body = Buffer.from(JSON.stringify(redemption), 'utf8');
  return {
    method: 'POST' as const,
    url: TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
    headers: {
      'content-type': TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.keyId]: TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.timestamp]: timestamp,
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce]: nonce,
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature]:
        createTelegramBetaInviteAdmissionSignatureForTest(
          transportHmacSecret,
          timestamp,
          nonce,
          body,
        ),
    },
    payload: body,
  };
}

describe('dedicated beta-admission Fastify service', () => {
  it('returns 204 only after durable nonce reservation and redemption complete', async () => {
    let nonceReservations = 0;
    let redemptions = 0;
    const app = buildBetaAdmissionApp(config(), {
      now: () => fixedNow,
      runtime: runtime({
        nonceStore: {
          durable: true,
          reserve: async () => {
            nonceReservations += 1;
            return true;
          },
        },
        admission: {
          redeem: async () => {
            redemptions += 1;
            return {
              inboundEventId: '7ce59f16-08e6-4c20-a694-e1f7b1b20d4d',
              receivedAt: fixedNow,
              inboundEventAlreadyRecorded: false,
            };
          },
        },
      }),
    });

    const response = await app.inject(signedRequest());
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(nonceReservations).toBe(1);
    expect(redemptions).toBe(1);
    await app.close();
  });

  it('returns only generic 401 for invalid signatures and terminal invite rejection', async () => {
    const rejectedRuntime = runtime({
      admission: {
        redeem: async () => {
          throw new TelegramBetaInviteAdmissionRejectedError();
        },
      },
    });
    const app = buildBetaAdmissionApp(config(), {
      now: () => fixedNow,
      runtime: rejectedRuntime,
    });

    const rejected = await app.inject(signedRequest());
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toEqual({ error: 'unauthorized' });
    expect(rejected.body).not.toContain(inviteToken);

    const invalid = signedRequest();
    invalid.headers[TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature] = 'v1.invalid';
    const invalidResponse = await app.inject(invalid);
    expect(invalidResponse.statusCode).toBe(401);
    expect(invalidResponse.json()).toEqual({ error: 'unauthorized' });
    await app.close();
  });

  it('returns only generic 503 for retryable runtime failures', async () => {
    const app = buildBetaAdmissionApp(config(), {
      now: () => fixedNow,
      runtime: runtime({
        admission: {
          redeem: async () => {
            throw new TelegramBetaInviteAdmissionUnavailableError();
          },
        },
      }),
    });

    const response = await app.inject(signedRequest());
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'admission_unavailable' });
    expect(response.body).not.toContain('database');
    expect(response.body).not.toContain(inviteToken);
    await app.close();
  });

  it('reports liveness independently and readiness from the database runtime', async () => {
    let closes = 0;
    const app = buildBetaAdmissionApp(config(), {
      runtime: runtime({
        ready: async () => false,
        close: async () => {
          closes += 1;
        },
      }),
    });

    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ ready: false });
    await app.close();
    expect(closes).toBe(1);
  });
});
