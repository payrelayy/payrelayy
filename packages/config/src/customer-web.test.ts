import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER_WEB_DATABASE_DIRECT_HOST,
  CUSTOMER_WEB_DATABASE_RUNTIME_ROLE,
  CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
  CUSTOMER_WEB_PRODUCTION_DATABASE_URL_SECRET_FILE,
  CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE,
  loadCustomerWebAuthConfig,
  loadCustomerWebWorkspaceConfig,
  redactedCustomerWebAuthConfigForLog,
  redactedCustomerWebWorkspaceConfigForLog,
} from './customer-web.js';

const publishableKey = `sb_publishable_${'a'.repeat(22)}_${'b'.repeat(8)}`;
const databaseUrl = `postgresql://${CUSTOMER_WEB_DATABASE_RUNTIME_ROLE}:db-password@${CUSTOMER_WEB_DATABASE_DIRECT_HOST}:5432/postgres?sslmode=verify-full`;

describe('customer web auth configuration', () => {
  it('is disabled by default without reading the Supabase URL or key', () => {
    const environment = new Proxy(
      { INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (
            property === 'CUSTOMER_WEB_SUPABASE_URL' ||
            property === 'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY'
          ) {
            throw new Error(`disabled auth configuration read ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadCustomerWebAuthConfig(environment)).toEqual({
      enabled: false,
      passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
      supabasePublishableKey: undefined,
      supabaseUrl: undefined,
    });
  });

  it('loads only the exact staging origin and a current publishable key', () => {
    const config = loadCustomerWebAuthConfig({
      CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      CUSTOMER_WEB_SUPABASE_URL: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
      INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true',
    });

    expect(config).toEqual({
      enabled: true,
      passwordRecoveryRedirectUrl: 'https://fetanagent.com/auth/recovery',
      supabasePublishableKey: publishableKey,
      supabaseUrl: 'https://spzpiyxheappsfyswewl.supabase.co',
    });
    expect(redactedCustomerWebAuthConfigForLog(config)).toEqual({
      enabled: true,
      passwordRecoveryRedirectUrl: 'https://fetanagent.com/auth/recovery',
      publishableKeyConfigured: true,
      supabaseOriginConfigured: true,
    });
    expect(JSON.stringify(redactedCustomerWebAuthConfigForLog(config))).not.toContain(
      publishableKey,
    );
  });

  it('rejects alternate origins, secret keys, service-role material, and malformed keys', () => {
    const loadWith = (url: string, key: string) =>
      loadCustomerWebAuthConfig({
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY: key,
        CUSTOMER_WEB_SUPABASE_URL: url,
        INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true',
      });

    expect(() => loadWith('https://example.test', publishableKey)).toThrow(
      'exact approved customer-web staging Supabase origin',
    );
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_secret_${'a'.repeat(32)}`),
    ).toThrow('current Supabase publishable key');
    expect(() => loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, 'service_role')).toThrow(
      'current Supabase publishable key',
    );
    expect(() => loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, 'eyJ.fake.jwt')).toThrow(
      'current Supabase publishable key',
    );
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(19)}`),
    ).toThrow('current Supabase publishable key');
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(20)}`),
    ).not.toThrow();
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(256)}`),
    ).not.toThrow();
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(257)}`),
    ).toThrow('current Supabase publishable key');
  });
});

describe('customer web workspace configuration', () => {
  it('is disabled by default without reading database URL inputs', () => {
    const environment = new Proxy(
      { INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (
            property === 'CUSTOMER_WEB_DATABASE_URL' ||
            property === 'CUSTOMER_WEB_DATABASE_URL_FILE'
          ) {
            throw new Error(`disabled workspace configuration read ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadCustomerWebWorkspaceConfig(environment)).toEqual({
      connection: undefined,
      enabled: false,
      projectReference: undefined,
      stage: undefined,
      tlsMode: undefined,
    });
  });

  it('loads only the exact staging direct host, role, database, port, and verify-full mode', () => {
    const config = loadCustomerWebWorkspaceConfig({
      CUSTOMER_WEB_DATABASE_URL: databaseUrl,
      INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
    });

    expect(config).toEqual({
      connection: {
        database: 'postgres',
        host: 'db.spzpiyxheappsfyswewl.supabase.co',
        password: 'db-password',
        port: 5432,
        user: 'fetanagent_customer_web_runtime',
      },
      enabled: true,
      projectReference: CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE,
      stage: 'staging',
      tlsMode: 'verify-full',
    });
    const redacted = redactedCustomerWebWorkspaceConfigForLog(config);
    expect(redacted).toEqual({
      connectionConfigured: true,
      enabled: true,
      projectReference: 'spzpiyxheappsfyswewl',
      stage: 'staging',
      tlsMode: 'verify-full',
    });
    expect(JSON.stringify(redacted)).not.toContain('db-password');
    expect(JSON.stringify(redacted)).not.toContain(CUSTOMER_WEB_DATABASE_RUNTIME_ROLE);
  });

  it('accepts one absolute secret file and trims only one terminal newline', () => {
    const readSecretFile = vi.fn(() => `${databaseUrl}\n`);
    const config = loadCustomerWebWorkspaceConfig(
      {
        CUSTOMER_WEB_DATABASE_URL_FILE: 'C:\\runtime-secrets\\customer-web-database-url',
        INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
      },
      { readSecretFile },
    );

    expect(config.enabled).toBe(true);
    expect(readSecretFile).toHaveBeenCalledWith('C:\\runtime-secrets\\customer-web-database-url');
  });

  it('requires the exact private secret mount in production and rejects direct secret env input', () => {
    const readSecretFile = vi.fn(() => databaseUrl);
    expect(
      loadCustomerWebWorkspaceConfig(
        {
          CUSTOMER_WEB_DATABASE_URL_FILE: CUSTOMER_WEB_PRODUCTION_DATABASE_URL_SECRET_FILE,
          INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
          NODE_ENV: 'production',
        },
        { readSecretFile },
      ),
    ).toMatchObject({ enabled: true });
    expect(() =>
      loadCustomerWebWorkspaceConfig({
        CUSTOMER_WEB_DATABASE_URL: databaseUrl,
        INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'production',
      }),
    ).toThrow('CUSTOMER_WEB_DATABASE_URL_FILE is required');
    expect(() =>
      loadCustomerWebWorkspaceConfig(
        {
          CUSTOMER_WEB_DATABASE_URL: '',
          CUSTOMER_WEB_DATABASE_URL_FILE: CUSTOMER_WEB_PRODUCTION_DATABASE_URL_SECRET_FILE,
          INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
          NODE_ENV: 'production',
        },
        { readSecretFile },
      ),
    ).toThrow('CUSTOMER_WEB_DATABASE_URL_FILE is required');
    expect(() =>
      loadCustomerWebWorkspaceConfig(
        {
          CUSTOMER_WEB_DATABASE_URL_FILE: '/tmp/customer-web-database-url',
          INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
          NODE_ENV: 'production',
        },
        { readSecretFile },
      ),
    ).toThrow('approved private runtime secret path');
  });

  it('rejects ambiguous, relative, unreadable, empty, and multiline secret inputs', () => {
    expect(() =>
      loadCustomerWebWorkspaceConfig({
        CUSTOMER_WEB_DATABASE_URL: databaseUrl,
        CUSTOMER_WEB_DATABASE_URL_FILE: 'C:\\secret',
        INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
      }),
    ).toThrow('must not both be configured');
    expect(() =>
      loadCustomerWebWorkspaceConfig({
        CUSTOMER_WEB_DATABASE_URL_FILE: 'relative-secret',
        INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
      }),
    ).toThrow('absolute path');
    expect(() =>
      loadCustomerWebWorkspaceConfig(
        {
          CUSTOMER_WEB_DATABASE_URL_FILE: 'C:\\secret',
          INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
        },
        { readSecretFile: () => '' },
      ),
    ).toThrow('exactly one secret value');
    expect(() =>
      loadCustomerWebWorkspaceConfig(
        {
          CUSTOMER_WEB_DATABASE_URL_FILE: 'C:\\secret',
          INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
        },
        { readSecretFile: () => `${databaseUrl}\nextra` },
      ),
    ).toThrow('exactly one secret value');
    expect(() =>
      loadCustomerWebWorkspaceConfig(
        {
          CUSTOMER_WEB_DATABASE_URL_FILE: 'C:\\secret',
          INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
        },
        { readSecretFile: () => `${databaseUrl} ` },
      ),
    ).toThrow('valid PostgreSQL connection URL');
    expect(() =>
      loadCustomerWebWorkspaceConfig(
        {
          CUSTOMER_WEB_DATABASE_URL_FILE: 'C:\\secret',
          INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
        },
        {
          readSecretFile: () => {
            throw new Error('private detail');
          },
        },
      ),
    ).toThrow('could not be read');
  });

  it.each([
    databaseUrl.replace(CUSTOMER_WEB_DATABASE_DIRECT_HOST, 'db.example.test'),
    databaseUrl.replace(CUSTOMER_WEB_DATABASE_RUNTIME_ROLE, 'postgres'),
    databaseUrl.replace(':5432/', ':6543/'),
    databaseUrl.replace('/postgres?', '/template1?'),
    databaseUrl.replace('sslmode=verify-full', 'sslmode=require'),
    `${databaseUrl}&application_name=unsafe`,
    databaseUrl.replace('postgresql:', 'https:'),
  ])('rejects an unsafe database URL shape without exposing it in the error', (unsafeUrl) => {
    let thrown: unknown;
    try {
      loadCustomerWebWorkspaceConfig({
        CUSTOMER_WEB_DATABASE_URL: unsafeUrl,
        INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(unsafeUrl);
    expect((thrown as Error).message).not.toContain('db-password');
  });
});
