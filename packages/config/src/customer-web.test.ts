import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE,
  CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE,
  CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE,
} from './deposit-reference-profile.js';

import {
  CUSTOMER_WEB_DATABASE_DIRECT_HOST,
  CUSTOMER_WEB_DATABASE_RUNTIME_ROLE,
  CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
  CUSTOMER_WEB_PRODUCTION_DATABASE_URL_SECRET_FILE,
  CUSTOMER_WEB_PRODUCTION_RATE_LIMIT_HMAC_SECRET_FILE,
  CUSTOMER_WEB_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SECRET_FILE,
  CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE,
  loadCustomerWebAuthConfig,
  loadCustomerWebDepositConfig,
  loadCustomerWebRateLimitConfig,
  loadCustomerWebWorkspaceConfig,
  redactedCustomerWebAuthConfigForLog,
  redactedCustomerWebDepositConfigForLog,
  redactedCustomerWebRateLimitConfigForLog,
  redactedCustomerWebWorkspaceConfigForLog,
} from './customer-web.js';

const publishableKey = `sb_publishable_${'a'.repeat(22)}_${'b'.repeat(8)}`;
const databaseUrl = `postgresql://${CUSTOMER_WEB_DATABASE_RUNTIME_ROLE}:db-password@${CUSTOMER_WEB_DATABASE_DIRECT_HOST}:5432/postgres?sslmode=verify-full`;
const referenceEncryptionSecret = 'a'.repeat(64);
const referenceFingerprintSecret = 'b'.repeat(64);
const referenceProfile = (
  encryption = referenceEncryptionSecret,
  fingerprint = referenceFingerprintSecret,
) =>
  JSON.stringify({
    encryptionKeyFingerprint: `sha256:${createHash('sha256').update(Buffer.from(encryption, 'hex')).digest('hex')}`,
    fingerprintKeyFingerprint: `sha256:${createHash('sha256').update(Buffer.from(fingerprint, 'hex')).digest('hex')}`,
    version: 1,
  });

describe('customer web auth configuration', () => {
  it('is disabled by default without reading the Supabase URL or key', () => {
    const environment = new Proxy(
      { INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (
            property === 'CUSTOMER_WEB_SUPABASE_URL' ||
            property === 'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY' ||
            property === 'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE'
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

  it('loads and redacts only the fixed production publishable-key secret file', () => {
    const readSecretFile = vi.fn(() => `${publishableKey}\n`);
    const config = loadCustomerWebAuthConfig(
      {
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE:
          CUSTOMER_WEB_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SECRET_FILE,
        CUSTOMER_WEB_SUPABASE_URL: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
        INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'production',
      },
      { readSecretFile },
    );

    expect(config.supabasePublishableKey).toBe(publishableKey);
    expect(readSecretFile).toHaveBeenCalledWith(
      CUSTOMER_WEB_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SECRET_FILE,
    );
    expect(JSON.stringify(redactedCustomerWebAuthConfigForLog(config))).not.toContain(
      publishableKey,
    );
  });

  it('rejects direct, wrong, dual, relative, unreadable, and multiline production key inputs', () => {
    const enabled = {
      CUSTOMER_WEB_SUPABASE_URL: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
      INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true',
    } as const;
    expect(() =>
      loadCustomerWebAuthConfig({
        ...enabled,
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        NODE_ENV: 'production',
      }),
    ).toThrow('required in the production customer-web container');
    expect(() =>
      loadCustomerWebAuthConfig({
        ...enabled,
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE: '/tmp/wrong',
        NODE_ENV: 'production',
      }),
    ).toThrow('approved private runtime secret path');
    expect(() =>
      loadCustomerWebAuthConfig({
        ...enabled,
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE: 'C:\\secret',
      }),
    ).toThrow('must not both be configured');
    expect(() =>
      loadCustomerWebAuthConfig({
        ...enabled,
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE: 'relative',
      }),
    ).toThrow('absolute path');
    expect(() =>
      loadCustomerWebAuthConfig(
        { ...enabled, CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE: 'C:\\secret' },
        {
          readSecretFile: () => {
            throw new Error('private');
          },
        },
      ),
    ).toThrow('could not be read');
    expect(() =>
      loadCustomerWebAuthConfig(
        { ...enabled, CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE: 'C:\\secret' },
        { readSecretFile: () => `${publishableKey}\nsecond` },
      ),
    ).toThrow('exactly one secret value');
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

describe('customer web durable rate-limit configuration', () => {
  const hmacSecret = 'c'.repeat(64);

  it('is disabled by default without reading secret inputs', () => {
    const environment = new Proxy(
      { INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (String(property).includes('RATE_LIMIT_HMAC')) throw new Error('unexpected read');
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;
    expect(loadCustomerWebRateLimitConfig(environment)).toEqual({
      enabled: false,
      hmacSecret: undefined,
    });
  });

  it('requires and redacts the fixed production secret file', () => {
    const readSecretFile = vi.fn(() => `${hmacSecret}\n`);
    const config = loadCustomerWebRateLimitConfig(
      {
        CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE:
          CUSTOMER_WEB_PRODUCTION_RATE_LIMIT_HMAC_SECRET_FILE,
        INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED: 'true',
        NODE_ENV: 'production',
      },
      { readSecretFile },
    );
    expect(config).toEqual({ enabled: true, hmacSecret });
    expect(readSecretFile).toHaveBeenCalledWith(
      CUSTOMER_WEB_PRODUCTION_RATE_LIMIT_HMAC_SECRET_FILE,
    );
    const redacted = redactedCustomerWebRateLimitConfigForLog(config);
    expect(redacted).toEqual({ enabled: true, hmacConfigured: true });
    expect(JSON.stringify(redacted)).not.toContain(hmacSecret);
  });

  it('rejects direct production, wrong, dual, relative, unreadable, and malformed inputs', () => {
    const enabled = { INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED: 'true' } as const;
    expect(() =>
      loadCustomerWebRateLimitConfig({
        ...enabled,
        CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET: hmacSecret,
        NODE_ENV: 'production',
      }),
    ).toThrow('required in production');
    expect(() =>
      loadCustomerWebRateLimitConfig({
        ...enabled,
        CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE: '/tmp/wrong',
        NODE_ENV: 'production',
      }),
    ).toThrow('approved private path');
    expect(() =>
      loadCustomerWebRateLimitConfig({
        ...enabled,
        CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET: hmacSecret,
        CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE: 'C:\\secret',
      }),
    ).toThrow('mutually exclusive');
    expect(() =>
      loadCustomerWebRateLimitConfig({
        ...enabled,
        CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE: 'relative',
      }),
    ).toThrow('absolute path');
    expect(() =>
      loadCustomerWebRateLimitConfig(
        { ...enabled, CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE: 'C:\\secret' },
        {
          readSecretFile: () => {
            throw new Error('private');
          },
        },
      ),
    ).toThrow('could not be read');
    expect(() =>
      loadCustomerWebRateLimitConfig({
        ...enabled,
        CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET: 'C'.repeat(64),
      }),
    ).toThrow('exactly 32 lowercase-hex bytes');
  });
});

describe('customer web deposit-reference configuration', () => {
  it('is disabled by default without reading a secret', () => {
    const environment = new Proxy(
      { INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (String(property).includes('DEPOSIT_REFERENCE')) throw new Error('unexpected read');
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(loadCustomerWebDepositConfig(environment)).toEqual({
      enabled: false,
      referenceEncryptionSecret: undefined,
      referenceFingerprintSecret: undefined,
      referenceKeyProfileVersion: undefined,
    });
  });

  it('loads the shared non-production key profile and redacts both secrets', () => {
    const config = loadCustomerWebDepositConfig({
      CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: referenceEncryptionSecret,
      CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: referenceFingerprintSecret,
      CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceProfile(),
      INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
      NODE_ENV: 'test',
    });
    expect(config).toEqual({
      enabled: true,
      referenceEncryptionSecret,
      referenceFingerprintSecret,
      referenceKeyProfileVersion: 1,
    });
    expect(redactedCustomerWebDepositConfigForLog(config)).toEqual({
      enabled: true,
      referenceProtectionConfigured: true,
      referenceKeyProfileVersion: 1,
    });
    const redacted = JSON.stringify(redactedCustomerWebDepositConfigForLog(config));
    expect(redacted).not.toContain(referenceEncryptionSecret);
    expect(redacted).not.toContain(referenceFingerprintSecret);
  });

  it('requires the fixed production files and accepts one terminal secret newline', () => {
    const readSecretFile = vi.fn((path: string) => {
      if (path === CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE) {
        return `${referenceEncryptionSecret}\n`;
      }
      if (path === CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE) {
        return `${referenceFingerprintSecret}\n`;
      }
      if (path === CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE) return referenceProfile();
      throw new Error('unexpected path');
    });
    expect(
      loadCustomerWebDepositConfig(
        {
          CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE:
            CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE,
          CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE:
            CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE,
          CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE: CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE,
          INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
          NODE_ENV: 'production',
        },
        { readSecretFile },
      ),
    ).toEqual({
      enabled: true,
      referenceEncryptionSecret,
      referenceFingerprintSecret,
      referenceKeyProfileVersion: 1,
    });
    expect(readSecretFile).toHaveBeenCalledWith(
      CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE,
    );
    expect(readSecretFile).toHaveBeenCalledWith(
      CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE,
    );
    expect(readSecretFile).toHaveBeenCalledWith(CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE);
  });

  it.each(['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(64)}\nextra`])(
    'rejects malformed secret material without echoing it',
    (secret) => {
      let thrown: unknown;
      try {
        loadCustomerWebDepositConfig({
          CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: secret,
          CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: referenceFingerprintSecret,
          CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceProfile(),
          INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
          NODE_ENV: 'test',
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      if (secret !== '') expect(String(thrown)).not.toContain(secret);
    },
  );

  it('rejects direct production secrets, wrong paths, dual sources, and relative files', () => {
    expect(() =>
      loadCustomerWebDepositConfig({
        CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: referenceEncryptionSecret,
        CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: referenceFingerprintSecret,
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceProfile(),
        INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'production',
      }),
    ).toThrow('required in production');
    expect(() =>
      loadCustomerWebDepositConfig({
        CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE: '/tmp/wrong',
        CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE:
          CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE,
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE: CBE_DEPOSIT_REFERENCE_PRODUCTION_KEY_PROFILE_FILE,
        INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'production',
      }),
    ).toThrow('approved private path');
    expect(() =>
      loadCustomerWebDepositConfig({
        CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: referenceEncryptionSecret,
        CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE: 'C:\\secret',
        CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: referenceFingerprintSecret,
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceProfile(),
        INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'test',
      }),
    ).toThrow('mutually exclusive');
    expect(() =>
      loadCustomerWebDepositConfig({
        CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE: 'relative',
        CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: referenceFingerprintSecret,
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceProfile(),
        INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
        NODE_ENV: 'test',
      }),
    ).toThrow('absolute path');
  });

  it('rejects mismatched, duplicate, and unapproved key profiles', () => {
    const base = {
      CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: referenceEncryptionSecret,
      CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: referenceFingerprintSecret,
      INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'true',
      NODE_ENV: 'test',
    };
    expect(() =>
      loadCustomerWebDepositConfig({
        ...base,
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceProfile('c'.repeat(64)),
      }),
    ).toThrow('do not match');
    expect(() =>
      loadCustomerWebDepositConfig({
        ...base,
        CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: referenceEncryptionSecret,
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceProfile(
          referenceEncryptionSecret,
          referenceEncryptionSecret,
        ),
      }),
    ).toThrow('valid and distinct');
    expect(() =>
      loadCustomerWebDepositConfig({
        ...base,
        CBE_DEPOSIT_REFERENCE_KEY_PROFILE: JSON.stringify({
          ...JSON.parse(referenceProfile()),
          version: 2,
        }),
      }),
    ).toThrow('profile is invalid');
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
