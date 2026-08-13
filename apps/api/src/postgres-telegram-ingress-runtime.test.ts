import { loadApiConfig, type ApiConfig } from '@fetanagent/config/api';
import {
  TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
  TELEGRAM_PRIVATE_INGRESS_HEADERS,
  TELEGRAM_PRIVATE_INGRESS_KEY_ID,
  TELEGRAM_PRIVATE_INGRESS_PATH,
  type TelegramPrivateInboundEvent,
} from '@fetanagent/contracts';
import type { PoolConfig } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import {
  createPostgresTelegramIngressRuntime,
  type PostgresTelegramIngressRuntimePool,
} from './postgres-telegram-ingress-runtime.js';
import { createTelegramIngressSignatureForTest } from './telegram-ingress.js';

const transportHmacSecret = 'a'.repeat(64);
const payloadHmacSecret = 'b'.repeat(64);
const fixedNow = new Date('2026-08-09T12:00:00.000Z');
const fixedTimestamp = Math.floor(fixedNow.getTime() / 1000).toString();
const fixedNonce = 'n'.repeat(32);
const inboundEvent: TelegramPrivateInboundEvent = {
  version: 1,
  updateId: '123456',
  telegramUserId: '28379330',
  privateChatId: '28379330',
  firstName: 'Example',
  lastName: null,
  username: 'example_user',
  preferredLocale: 'en',
};

interface QueryCall {
  readonly query: string;
  readonly values: readonly unknown[];
}

function bothGatesConfig(): ApiConfig {
  return loadApiConfig({
    NODE_ENV: 'test',
    INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
    DATABASE_URL:
      'postgresql://fetanagent_api_runtime:example-only@db.xzztugbgtulptnbpoelr.supabase.co/postgres?sslmode=verify-full',
    INTERNAL_TELEGRAM_INGRESS_ENABLED: 'true',
    BOT_TO_API_INGRESS_HMAC_SECRET: transportHmacSecret,
    API_TELEGRAM_PAYLOAD_HMAC_SECRET: payloadHmacSecret,
    INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED: 'true',
  });
}

function signedIngressRequest() {
  const rawBody = Buffer.from(JSON.stringify(inboundEvent), 'utf8');
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

function createFakePool(results: readonly { readonly rows: readonly unknown[] }[]): {
  readonly pool: PostgresTelegramIngressRuntimePool;
  readonly queries: QueryCall[];
  readonly end: ReturnType<typeof vi.fn>;
} {
  const queries: QueryCall[] = [];
  const end = vi.fn(async () => undefined);
  let resultIndex = 0;

  return {
    pool: {
      query: async (query, values) => {
        queries.push({ query, values });
        const result = results[resultIndex];
        resultIndex += 1;
        if (!result) throw new Error('Unexpected PostgreSQL query.');
        return result;
      },
      end,
    },
    queries,
    end,
  };
}

describe('Postgres Telegram ingress runtime composition', () => {
  it('does not create a pool or route unless all three explicit gates are enabled', async () => {
    const createRuntime = vi.fn();
    const postgresOnlyConfig = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
      DATABASE_URL:
        'postgresql://fetanagent_api_runtime:example-only@db.xzztugbgtulptnbpoelr.supabase.co/postgres?sslmode=verify-full',
    });
    const telegramOnlyConfig = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_TELEGRAM_INGRESS_ENABLED: 'true',
      BOT_TO_API_INGRESS_HMAC_SECRET: transportHmacSecret,
      API_TELEGRAM_PAYLOAD_HMAC_SECRET: payloadHmacSecret,
    });
    const prerequisiteGatesWithoutPrivateRuntimeConfig = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
      DATABASE_URL:
        'postgresql://fetanagent_api_runtime:example-only@db.xzztugbgtulptnbpoelr.supabase.co/postgres?sslmode=verify-full',
      INTERNAL_TELEGRAM_INGRESS_ENABLED: 'true',
      BOT_TO_API_INGRESS_HMAC_SECRET: transportHmacSecret,
      API_TELEGRAM_PAYLOAD_HMAC_SECRET: payloadHmacSecret,
    });

    for (const config of [
      postgresOnlyConfig,
      telegramOnlyConfig,
      prerequisiteGatesWithoutPrivateRuntimeConfig,
    ]) {
      const app = buildApp(config, { createPostgresTelegramIngressRuntime: createRuntime });
      expect((await app.inject(signedIngressRequest())).statusCode).toBe(404);
      await app.close();
    }

    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('fails closed before pool construction when either runtime gate is disabled', () => {
    const createPool = vi.fn();

    expect(() =>
      createPostgresTelegramIngressRuntime(loadApiConfig({ NODE_ENV: 'test' }), { createPool }),
    ).toThrow('requires Postgres, Telegram ingress, and private ingress runtime gates');

    expect(createPool).not.toHaveBeenCalled();
  });

  it('fails closed when only one manual ingress adapter is supplied', () => {
    const createRuntime = vi.fn();

    expect(() =>
      buildApp(bothGatesConfig(), {
        createPostgresTelegramIngressRuntime: createRuntime,
        telegramPrivateInboundRecorder: { record: async () => undefined },
      }),
    ).toThrow('must provide both nonce storage and an inbox recorder');

    expect(() =>
      buildApp(bothGatesConfig(), {
        createPostgresTelegramIngressRuntime: createRuntime,
        telegramIngressNonceStore: { durable: true, reserve: async () => true },
      }),
    ).toThrow('must provide both nonce storage and an inbox recorder');

    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('builds a bounded verify-full pool from the sanitized configuration without connecting', async () => {
    const fake = createFakePool([]);
    const createPool = vi.fn((config: PoolConfig) => fake.pool);
    const runtime = createPostgresTelegramIngressRuntime(bothGatesConfig(), { createPool });

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith({
      application_name: 'fetanagent-api-telegram-ingress',
      connectionTimeoutMillis: 5_000,
      database: 'postgres',
      host: 'db.xzztugbgtulptnbpoelr.supabase.co',
      idleTimeoutMillis: 10_000,
      max: 2,
      min: 0,
      password: 'example-only',
      port: 5432,
      query_timeout: 5_000,
      ssl: { rejectUnauthorized: true },
      statement_timeout: 5_000,
      user: 'fetanagent_api_runtime',
    });
    expect(fake.queries).toEqual([]);

    await runtime.close();
    await runtime.close();
    expect(fake.end).toHaveBeenCalledTimes(1);
  });

  it('reserves the nonce and records the inbox event as ordered separate autocommit pool queries', async () => {
    const fake = createFakePool([
      { rows: [{ reserved: true }] },
      {
        rows: [
          {
            inbound_event_already_recorded: false,
            inbound_event_id: '123e4567-e89b-42d3-a456-426614174000',
          },
        ],
      },
    ]);
    const runtime = createPostgresTelegramIngressRuntime(bothGatesConfig(), {
      createPool: () => fake.pool,
    });
    const app = buildApp(bothGatesConfig(), {
      now: () => fixedNow,
      postgresTelegramIngressRuntime: runtime,
    });

    expect((await app.inject(signedIngressRequest())).statusCode).toBe(204);
    expect(fake.queries).toHaveLength(2);
    expect(fake.queries[0]?.query).toContain('reserve_telegram_private_ingress_nonce');
    expect(fake.queries[1]?.query).toContain('record_telegram_private_inbound_event');
    expect(fake.queries.map(({ query }) => query).join('\n')).not.toMatch(
      /\b(?:begin|commit|rollback)\b/i,
    );

    await app.close();
    expect(fake.end).toHaveBeenCalledTimes(1);
  });
});
