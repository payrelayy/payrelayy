import { describe, expect, it } from 'vitest';

import { loadApiConfig, redactedApiConfigForLog } from './api.js';
import { loadBotConfig, redactedBotConfigForLog } from './bot.js';
import { loadExecutorConfig } from './executor.js';
import { loadMaintenanceConfig, redactedMaintenanceConfigForLog } from './maintenance.js';
import { loadWorkerConfig } from './worker.js';

function environmentThatRejectsTelegramReads(): NodeJS.ProcessEnv {
  return new Proxy(
    {
      FINANCIAL_ACTIONS_MODE: 'dry_run',
      NODE_ENV: 'test',
    },
    {
      get(target, property, receiver) {
        if (
          property === 'TELEGRAM_BOT_ENABLED' ||
          property === 'TELEGRAM_BOT_TOKEN' ||
          property === 'BOT_TO_API_INGRESS_BASE_URL' ||
          property === 'BOT_TO_API_INGRESS_HMAC_SECRET' ||
          property === 'API_TELEGRAM_PAYLOAD_HMAC_SECRET' ||
          property === 'API_TELEGRAM_CAPABILITY_HMAC_SECRET' ||
          property === 'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET'
        ) {
          throw new Error(`unexpected Telegram environment read: ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );
}

describe('runtime configuration isolation', () => {
  it('defaults API financial actions to dry-run mode', () => {
    expect(loadApiConfig({ NODE_ENV: 'test' }).financialActionsMode).toBe('dry_run');
  });

  it('refuses API live mode outside production', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'test', FINANCIAL_ACTIONS_MODE: 'live' })).toThrow(
      'only when NODE_ENV=production',
    );
  });

  it('keeps Telegram configuration out of the API process', () => {
    const config = loadApiConfig(environmentThatRejectsTelegramReads());

    expect(config).not.toHaveProperty('telegram');
    expect(Object.keys(config)).not.toContain('telegram');
  });

  it('keeps Telegram configuration out of worker and executor processes', () => {
    const worker = loadWorkerConfig(environmentThatRejectsTelegramReads());
    const executor = loadExecutorConfig(environmentThatRejectsTelegramReads());

    expect(worker).not.toHaveProperty('telegram');
    expect(executor).not.toHaveProperty('telegram');
  });

  it('loads a Telegram token only for an enabled bot and never logs it', () => {
    const token = '123456:example-token-for-test-only';
    const transportHmacSecret = 'a'.repeat(64);
    const config = loadBotConfig({
      NODE_ENV: 'test',
      TELEGRAM_BOT_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: token,
      BOT_TO_API_INGRESS_BASE_URL: 'http://api:3000',
      BOT_TO_API_INGRESS_HMAC_SECRET: transportHmacSecret,
    });

    expect(config.telegram).toEqual({ enabled: true, token });
    expect(config.apiIngress).toEqual({
      enabled: true,
      baseUrl: 'http://api:3000/',
      transportHmacSecret,
    });
    expect(redactedBotConfigForLog(config)).toEqual({
      nodeEnv: 'test',
      logLevel: 'info',
      telegram: { enabled: true, tokenConfigured: true },
      apiIngress: { enabled: true, secretsConfigured: true },
    });
    expect(JSON.stringify(redactedBotConfigForLog(config))).not.toContain(token);
    expect(JSON.stringify(redactedBotConfigForLog(config))).not.toContain(transportHmacSecret);
  });

  it('does not read the API-only payload HMAC when the bot is enabled', () => {
    const environment = new Proxy(
      {
        NODE_ENV: 'test',
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123456:test-token',
        BOT_TO_API_INGRESS_BASE_URL: 'http://api:3000',
        BOT_TO_API_INGRESS_HMAC_SECRET: 'a'.repeat(64),
      },
      {
        get(target, property, receiver) {
          if (
            property === 'API_TELEGRAM_PAYLOAD_HMAC_SECRET' ||
            property === 'API_TELEGRAM_CAPABILITY_HMAC_SECRET' ||
            property === 'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET'
          ) {
            throw new Error('bot must not read an API-only Telegram HMAC secret');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadBotConfig(environment).telegram.enabled).toBe(true);
  });

  it('restricts the production bot ingress to the private Docker API origin', () => {
    const common = {
      NODE_ENV: 'production',
      TELEGRAM_BOT_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '123456:test-token',
      BOT_TO_API_INGRESS_HMAC_SECRET: 'a'.repeat(64),
    };

    expect(() =>
      loadBotConfig({ ...common, BOT_TO_API_INGRESS_BASE_URL: 'https://api.example.test/' }),
    ).toThrow('private Docker API origin');
    expect(
      loadBotConfig({ ...common, BOT_TO_API_INGRESS_BASE_URL: 'http://api:3000/' }).apiIngress,
    ).toMatchObject({ enabled: true, baseUrl: 'http://api:3000/' });
  });

  it('does not read a Telegram token when bot polling is disabled', () => {
    const environment = new Proxy(
      { NODE_ENV: 'test', TELEGRAM_BOT_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (property === 'TELEGRAM_BOT_TOKEN') {
            throw new Error('disabled bot must not read a bot-only secret');
          }
          if (
            property === 'BOT_TO_API_INGRESS_BASE_URL' ||
            property === 'BOT_TO_API_INGRESS_HMAC_SECRET' ||
            property === 'API_TELEGRAM_PAYLOAD_HMAC_SECRET' ||
            property === 'API_TELEGRAM_CAPABILITY_HMAC_SECRET' ||
            property === 'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET'
          ) {
            throw new Error('disabled bot must not read an ingress secret');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadBotConfig(environment).telegram).toEqual({ enabled: false, token: undefined });
  });

  it('does not read the database URL when the API database preflight is disabled', () => {
    const environment = new Proxy(
      { NODE_ENV: 'test', INTERNAL_POSTGRES_RUNTIME_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (property === 'DATABASE_URL') {
            throw new Error('disabled database preflight must not read DATABASE_URL');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadApiConfig(environment).postgresRuntime).toEqual({
      enabled: false,
      connection: undefined,
      tlsMode: undefined,
    });
  });

  it('keeps the maintenance gate and credential out of API, bot, worker, and executor configuration', () => {
    const environment = new Proxy(
      { FINANCIAL_ACTIONS_MODE: 'dry_run', NODE_ENV: 'test' },
      {
        get(target, property, receiver) {
          if (
            property === 'INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED' ||
            property === 'NONCE_RETENTION_DATABASE_URL'
          ) {
            throw new Error(`unexpected maintenance environment read: ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadApiConfig(environment).postgresRuntime.enabled).toBe(false);
    expect(loadBotConfig(environment).telegram.enabled).toBe(false);
    expect(loadWorkerConfig(environment)).toMatchObject({ nodeEnv: 'test' });
    expect(loadExecutorConfig(environment).financialActionsMode).toBe('dry_run');
  });

  it('does not read a maintenance URL when its manual preflight gate is disabled', () => {
    const environment = new Proxy(
      { INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED: 'false', NODE_ENV: 'test' },
      {
        get(target, property, receiver) {
          if (property === 'NONCE_RETENTION_DATABASE_URL') {
            throw new Error('disabled maintenance preflight must not read its database URL');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadMaintenanceConfig(environment).nonceRetentionRuntime).toEqual({
      enabled: false,
      connection: undefined,
      tlsMode: undefined,
    });
  });

  it('loads only a dedicated TLS-protected nonce-retention maintenance URL', () => {
    const connectionString =
      'postgresql://payreplayy_nonce_retention_runtime:example-only@db.example.test/postgres?sslmode=verify-full';
    const environment = new Proxy(
      {
        INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'test',
        NONCE_RETENTION_DATABASE_URL: connectionString,
      },
      {
        get(target, property, receiver) {
          if (
            property === 'DATABASE_URL' ||
            property === 'TELEGRAM_BOT_TOKEN' ||
            property === 'BOT_TO_API_INGRESS_HMAC_SECRET' ||
            property === 'API_TELEGRAM_PAYLOAD_HMAC_SECRET' ||
            property === 'API_TELEGRAM_CAPABILITY_HMAC_SECRET' ||
            property === 'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET' ||
            property === 'KEMERBET_EXECUTOR_ENABLED' ||
            property === 'KEMERBET_FINAL_ACTION_ENABLED'
          ) {
            throw new Error(
              `maintenance must not read another process secret: ${String(property)}`,
            );
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    const config = loadMaintenanceConfig(environment);
    expect(config.nonceRetentionRuntime).toEqual({
      enabled: true,
      connection: {
        database: 'postgres',
        host: 'db.example.test',
        password: 'example-only',
        port: 5432,
        user: 'payreplayy_nonce_retention_runtime',
      },
      tlsMode: 'verify-full',
    });
    expect(JSON.stringify(redactedMaintenanceConfigForLog(config))).not.toContain(connectionString);
    expect(JSON.stringify(redactedMaintenanceConfigForLog(config))).not.toContain('example-only');
  });

  it('accepts only the dedicated Supavisor maintenance login form and rejects unsafe URLs', () => {
    const config = loadMaintenanceConfig({
      INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED: 'true',
      NODE_ENV: 'test',
      NONCE_RETENTION_DATABASE_URL:
        'postgresql://payreplayy_nonce_retention_runtime.abcdefghijklmnopqrst:example-only@aws-0-us-east-1.pooler.supabase.com/postgres?sslmode=verify-full',
    });
    expect(config.nonceRetentionRuntime).toMatchObject({
      enabled: true,
      connection: {
        host: 'aws-0-us-east-1.pooler.supabase.com',
        user: 'payreplayy_nonce_retention_runtime.abcdefghijklmnopqrst',
      },
    });

    expect(() =>
      loadMaintenanceConfig({
        INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'test',
      }),
    ).toThrow('NONCE_RETENTION_DATABASE_URL is required');
    expect(() =>
      loadMaintenanceConfig({
        INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'test',
        NONCE_RETENTION_DATABASE_URL:
          'postgresql://%70ostgres:example@db.example.test/postgres?sslmode=verify-full',
      }),
    ).toThrow('dedicated PayReplayy nonce-retention runtime login');
    expect(() =>
      loadMaintenanceConfig({
        INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'test',
        NONCE_RETENTION_DATABASE_URL:
          'postgresql://payreplayy_nonce_retention_runtime:example@db.example.test/postgres?sslmode=verify-full&user=postgres',
      }),
    ).toThrow('only sslmode=verify-full');
  });

  it('loads a TLS-protected dedicated API runtime URL only when explicitly enabled', () => {
    const connectionString =
      'postgresql://payreplayy_api_runtime:example-only@db.example.test/postgres?sslmode=verify-full';
    const config = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
      DATABASE_URL: connectionString,
    });

    expect(config.postgresRuntime).toEqual({
      enabled: true,
      connection: {
        database: 'postgres',
        host: 'db.example.test',
        password: 'example-only',
        port: 5432,
        user: 'payreplayy_api_runtime',
      },
      tlsMode: 'verify-full',
    });
    expect(JSON.stringify(redactedApiConfigForLog(config))).not.toContain(connectionString);
    expect(redactedApiConfigForLog(config).postgresRuntime).toEqual({
      enabled: true,
      connectionConfigured: true,
      tlsMode: 'verify-full',
    });
  });

  it('accepts only the recognized Supavisor session-pooler login form', () => {
    const config = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
      DATABASE_URL:
        'postgresql://payreplayy_api_runtime.abcdefghijklmnopqrst:example-only@aws-0-us-east-1.pooler.supabase.com/postgres?sslmode=verify-full',
    });

    expect(config.postgresRuntime).toMatchObject({
      enabled: true,
      connection: {
        host: 'aws-0-us-east-1.pooler.supabase.com',
        user: 'payreplayy_api_runtime.abcdefghijklmnopqrst',
      },
    });
  });

  it('rejects missing, untrusted, or elevated API database connection URLs', () => {
    expect(() =>
      loadApiConfig({ NODE_ENV: 'test', INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true' }),
    ).toThrow('DATABASE_URL is required');

    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
        DATABASE_URL: 'postgresql://payreplayy_api_runtime:example@db.example.test/postgres',
      }),
    ).toThrow('only sslmode=verify-full');

    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
        DATABASE_URL:
          'postgresql://%70ostgres:example@db.example.test/postgres?sslmode=verify-full',
      }),
    ).toThrow('dedicated PayReplayy API runtime login');

    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        INTERNAL_POSTGRES_RUNTIME_ENABLED: 'true',
        DATABASE_URL:
          'postgresql://payreplayy_api_runtime:example@db.example.test/postgres?sslmode=verify-full&user=postgres',
      }),
    ).toThrow('only sslmode=verify-full');
  });

  it('requires a token before an enabled bot can start', () => {
    expect(() => loadBotConfig({ NODE_ENV: 'test', TELEGRAM_BOT_ENABLED: 'true' })).toThrow(
      'TELEGRAM_BOT_TOKEN is required',
    );
  });

  it('loads API-only Telegram HMAC keys only when the internal route is explicitly enabled', () => {
    const transportHmacSecret = 'b'.repeat(64);
    const payloadHmacSecret = 'c'.repeat(64);
    const config = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_TELEGRAM_INGRESS_ENABLED: 'true',
      BOT_TO_API_INGRESS_HMAC_SECRET: transportHmacSecret,
      API_TELEGRAM_PAYLOAD_HMAC_SECRET: payloadHmacSecret,
    });

    expect(config.telegramIngress).toEqual({
      enabled: true,
      transportHmacSecret,
      payloadHmacSecret,
    });
    expect(JSON.stringify(redactedApiConfigForLog(config))).not.toContain(transportHmacSecret);
    expect(JSON.stringify(redactedApiConfigForLog(config))).not.toContain(payloadHmacSecret);
  });

  it('requires both API ingress HMAC keys when its route is enabled', () => {
    expect(() =>
      loadApiConfig({ NODE_ENV: 'test', INTERNAL_TELEGRAM_INGRESS_ENABLED: 'true' }),
    ).toThrow('BOT_TO_API_INGRESS_HMAC_SECRET');
  });

  it('loads API-only capability keys only when the inactive contract is explicitly enabled', () => {
    const capabilityHmacSecret = 'd'.repeat(64);
    const semanticHmacSecret = 'e'.repeat(64);
    const config = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
      API_TELEGRAM_CAPABILITY_HMAC_SECRET: capabilityHmacSecret,
      API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: semanticHmacSecret,
    });

    expect(config.telegramActionCapability).toEqual({
      enabled: true,
      capabilityHmacSecret,
      semanticHmacSecret,
    });
    const redacted = JSON.stringify(redactedApiConfigForLog(config));
    expect(redacted).not.toContain(capabilityHmacSecret);
    expect(redacted).not.toContain(semanticHmacSecret);
  });

  it('does not read API-only capability keys when the inactive contract is disabled', () => {
    const environment = new Proxy(
      { NODE_ENV: 'test', INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (
            property === 'API_TELEGRAM_CAPABILITY_HMAC_SECRET' ||
            property === 'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET'
          ) {
            throw new Error('disabled capability contract must not read an API-only secret');
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadApiConfig(environment).telegramActionCapability).toEqual({
      enabled: false,
      capabilityHmacSecret: undefined,
      semanticHmacSecret: undefined,
    });
  });

  it('requires both API-only capability keys when its inactive contract is enabled', () => {
    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
      }),
    ).toThrow('API_TELEGRAM_CAPABILITY_HMAC_SECRET');
  });

  it('requires the capability and semantic keys to be distinct', () => {
    const duplicatedSecret = 'd'.repeat(64);

    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
        API_TELEGRAM_CAPABILITY_HMAC_SECRET: duplicatedSecret,
        API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: duplicatedSecret,
      }),
    ).toThrow('API_TELEGRAM_CAPABILITY_HMAC_SECRET must be distinct');
  });

  it('keeps capability-contract keys distinct from enabled ingress keys', () => {
    const ingressTransportSecret = 'a'.repeat(64);
    const ingressPayloadSecret = 'b'.repeat(64);

    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        INTERNAL_TELEGRAM_INGRESS_ENABLED: 'true',
        BOT_TO_API_INGRESS_HMAC_SECRET: ingressTransportSecret,
        API_TELEGRAM_PAYLOAD_HMAC_SECRET: ingressPayloadSecret,
        INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
        API_TELEGRAM_CAPABILITY_HMAC_SECRET: ingressTransportSecret,
        API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: 'c'.repeat(64),
      }),
    ).toThrow(
      'API_TELEGRAM_CAPABILITY_HMAC_SECRET must be distinct from BOT_TO_API_INGRESS_HMAC_SECRET',
    );
  });
});
