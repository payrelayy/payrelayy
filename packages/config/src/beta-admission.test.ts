import { describe, expect, it } from 'vitest';

import {
  loadBetaAdmissionConfig,
  PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE,
  redactedBetaAdmissionConfigForLog,
} from './beta-admission.js';

const sessionPoolerDatabaseUrl = `postgresql://payreplayy_beta_admission_runtime.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}:db-password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;

function enabledEnvironment(databaseUrl = sessionPoolerDatabaseUrl): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED: 'true',
    BETA_ADMISSION_DATABASE_URL: databaseUrl,
    BOT_TO_BETA_ADMISSION_HMAC_SECRET: 'a'.repeat(64),
    BETA_ADMISSION_PAYLOAD_HMAC_SECRET: 'b'.repeat(64),
  };
}

describe('beta-admission runtime configuration', () => {
  it('is disabled by default without reading any secret input', () => {
    const environment = new Proxy(
      { NODE_ENV: 'test' },
      {
        get(target, property, receiver) {
          if (
            typeof property === 'string' &&
            /(?:DATABASE_URL|HMAC_SECRET)(?:_FILE)?$/.test(property)
          ) {
            throw new Error(`disabled runtime must not read ${property}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadBetaAdmissionConfig(environment)).toMatchObject({
      server: { host: '127.0.0.1', port: 3001 },
      runtime: { enabled: false },
    });
  });

  it('accepts only the exact staging eu-west-1 IPv4 session-pooler login', () => {
    expect(loadBetaAdmissionConfig(enabledEnvironment()).runtime).toMatchObject({
      enabled: true,
      stage: 'staging',
      projectReference: PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE,
      connection: {
        database: 'postgres',
        host: 'aws-1-eu-west-1.pooler.supabase.com',
        port: 5432,
      },
      tlsMode: 'verify-full',
    });
  });

  it('rejects production, broad roles, transaction pooling, and weak or ambiguous TLS URLs', () => {
    const invalidUrls = [
      'postgresql://payreplayy_beta_admission_runtime:pw@db.xzztugbgtulptnbpoelr.supabase.co:5432/postgres?sslmode=verify-full',
      `postgresql://payreplayy_beta_admission_runtime:pw@db.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}.supabase.co:5432/postgres?sslmode=verify-full`,
      `postgresql://postgres:pw@db.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}.supabase.co:5432/postgres?sslmode=verify-full`,
      `postgresql://payreplayy_beta_admission_runtime.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
      `postgresql://payreplayy_beta_admission_runtime.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
      `postgresql://payreplayy_beta_admission_runtime:pw@db.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}.supabase.co:5432/postgres?sslmode=require`,
      `postgresql://payreplayy_beta_admission_runtime:pw@db.${PAYREPLAYY_STAGING_SUPABASE_PROJECT_REFERENCE}.supabase.co:5432/postgres?sslmode=verify-full&application_name=unsafe`,
    ];

    for (const databaseUrl of invalidUrls) {
      expect(() => loadBetaAdmissionConfig(enabledEnvironment(databaseUrl))).toThrow();
    }
  });

  it('requires distinct lowercase 32-byte transport and payload HMAC keys', () => {
    expect(() =>
      loadBetaAdmissionConfig({
        ...enabledEnvironment(),
        BETA_ADMISSION_PAYLOAD_HMAC_SECRET: 'a'.repeat(64),
      }),
    ).toThrow('must be distinct');
    expect(() =>
      loadBetaAdmissionConfig({
        ...enabledEnvironment(),
        BOT_TO_BETA_ADMISSION_HMAC_SECRET: 'A'.repeat(64),
      }),
    ).toThrow('32-byte lowercase hexadecimal');
  });

  it('supports mutually exclusive absolute secret files and trims one terminal newline', () => {
    const fileValues: Record<string, string> = {
      '/run/secrets/database-url': `${sessionPoolerDatabaseUrl}\n`,
      '/run/secrets/transport-hmac': `${'a'.repeat(64)}\n`,
      '/run/secrets/payload-hmac': `${'b'.repeat(64)}\n`,
    };
    const config = loadBetaAdmissionConfig(
      {
        NODE_ENV: 'test',
        INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED: 'true',
        BETA_ADMISSION_DATABASE_URL_FILE: '/run/secrets/database-url',
        BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE: '/run/secrets/transport-hmac',
        BETA_ADMISSION_PAYLOAD_HMAC_SECRET_FILE: '/run/secrets/payload-hmac',
      },
      { readSecretFile: (path) => fileValues[path] ?? '' },
    );

    expect(config.runtime.enabled && config.runtime.connection.password).toBe('db-password');
    expect(() =>
      loadBetaAdmissionConfig({
        ...enabledEnvironment(),
        BETA_ADMISSION_DATABASE_URL_FILE: '/run/secrets/database-url',
      }),
    ).toThrow('must not both be configured');
  });

  it('requires the exact private secret-file mounts in the production staging container', () => {
    expect(() =>
      loadBetaAdmissionConfig({
        ...enabledEnvironment(),
        NODE_ENV: 'production',
      }),
    ).toThrow('BETA_ADMISSION_DATABASE_URL_FILE is required');
    expect(() =>
      loadBetaAdmissionConfig(
        {
          NODE_ENV: 'production',
          INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED: 'true',
          BETA_ADMISSION_DATABASE_URL_FILE: '/tmp/database-url',
          BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE: '/run/secrets/beta_admission_bot_transport_hmac',
          BETA_ADMISSION_PAYLOAD_HMAC_SECRET_FILE: '/run/secrets/beta_admission_payload_hmac',
        },
        { readSecretFile: () => sessionPoolerDatabaseUrl },
      ),
    ).toThrow('approved private runtime secret path');
  });

  it('redacts every secret and database identity from the log projection', () => {
    const config = loadBetaAdmissionConfig(enabledEnvironment());
    const serialized = JSON.stringify(redactedBetaAdmissionConfigForLog(config));

    expect(serialized).not.toContain('db-password');
    expect(serialized).not.toContain('a'.repeat(64));
    expect(serialized).not.toContain('payreplayy_beta_admission_runtime');
    expect(serialized).toContain('"connectionConfigured":true');
  });
});
