import { describe, expect, it } from 'vitest';

import {
  OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
  loadOwnerControlConfig,
  redactedOwnerControlConfigForLog,
} from './owner-control.js';

const databaseUrl = `postgresql://payreplayy_owner_control_runtime.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}:password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
const publishableKey = 'sb_publishable_test_key_for_staging_only';

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
    OWNER_CONTROL_DATABASE_URL: databaseUrl,
    OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
}

describe('Owner-control configuration', () => {
  it('is disabled by default without reading credential inputs', () => {
    const environment = new Proxy(
      { NODE_ENV: 'test' },
      {
        get(target, property, receiver) {
          if (
            typeof property === 'string' &&
            /OWNER_CONTROL_(?:DATABASE|SUPABASE)/u.test(property)
          ) {
            throw new Error(`disabled config read ${property}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;
    expect(loadOwnerControlConfig(environment)).toMatchObject({
      runtime: { enabled: false },
      server: { host: '127.0.0.1', port: 3002 },
    });
  });

  it('accepts only the exact staging project, role, pooler, and verify-full URL', () => {
    expect(loadOwnerControlConfig(enabledEnvironment()).runtime).toMatchObject({
      enabled: true,
      projectReference: OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
      stage: 'staging',
      tlsMode: 'verify-full',
      connection: {
        host: 'aws-1-eu-west-1.pooler.supabase.com',
        user: `payreplayy_owner_control_runtime.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}`,
      },
    });
    for (const unsafe of [
      databaseUrl.replace('aws-1-eu-west-1', 'aws-0-eu-west-1'),
      databaseUrl.replace('payreplayy_owner_control_runtime', 'postgres'),
      databaseUrl.replace('5432', '6543'),
      databaseUrl.replace('verify-full', 'require'),
    ]) {
      expect(() =>
        loadOwnerControlConfig({ ...enabledEnvironment(), OWNER_CONTROL_DATABASE_URL: unsafe }),
      ).toThrow();
    }
  });

  it('requires exact production secret mounts and never logs credentials', () => {
    const config = loadOwnerControlConfig(enabledEnvironment());
    const serialized = JSON.stringify(redactedOwnerControlConfigForLog(config));
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain(publishableKey);
    expect(serialized).not.toContain('payreplayy_owner_control_runtime');

    expect(() =>
      loadOwnerControlConfig({ ...enabledEnvironment(), NODE_ENV: 'production' }),
    ).toThrow('OWNER_CONTROL_DATABASE_URL_FILE is required');
  });

  it('reads one newline-terminated value from each approved production file', () => {
    const values: Record<string, string> = {
      '/run/secrets/owner_control_database_url': `${databaseUrl}\n`,
      '/run/secrets/owner_control_supabase_publishable_key': `${publishableKey}\n`,
    };
    const config = loadOwnerControlConfig(
      {
        NODE_ENV: 'production',
        INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
        OWNER_CONTROL_DATABASE_URL_FILE: '/run/secrets/owner_control_database_url',
        OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
        OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE:
          '/run/secrets/owner_control_supabase_publishable_key',
      },
      { readSecretFile: (path) => values[path] ?? '' },
    );
    expect(config.runtime.enabled && config.runtime.publishableKey).toBe(publishableKey);
  });
});
