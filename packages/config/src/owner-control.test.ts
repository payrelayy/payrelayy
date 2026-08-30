import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  OWNER_CONTROL_DATABASE_DIRECT_HOST,
  OWNER_CONTROL_DATABASE_POOLER_HOST,
  OWNER_CONTROL_DATABASE_RUNTIME_ROLE,
  OWNER_CONTROL_DATABASE_POOLER_RUNTIME_ROLE,
  OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
  OWNER_CONTROL_TELEGRAM_BOT_USERNAME,
  loadOwnerControlConfig,
  redactedOwnerControlConfigForLog,
} from './owner-control.js';

const databaseUrl = `postgresql://fetanagent_owner_control_runtime:password@${OWNER_CONTROL_DATABASE_DIRECT_HOST}:5432/postgres?sslmode=verify-full`;
const poolerDatabaseUrl = `postgresql://${OWNER_CONTROL_DATABASE_POOLER_RUNTIME_ROLE}:password@${OWNER_CONTROL_DATABASE_POOLER_HOST}:5432/postgres?sslmode=verify-full`;
const publishableKey = 'sb_publishable_test_key_for_staging_only';
const receiverReferenceEncryptionMaster = 'c'.repeat(64);
const receiverReferenceFingerprintMaster = 'd'.repeat(64);
const receiverReferenceProfile = JSON.stringify({
  encryptionMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(receiverReferenceEncryptionMaster, 'hex'))
    .digest('hex')}`,
  fingerprintMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(receiverReferenceFingerprintMaster, 'hex'))
    .digest('hex')}`,
  version: 2,
});

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
    OWNER_CONTROL_DATABASE_URL: databaseUrl,
    OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER: receiverReferenceEncryptionMaster,
    OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER: receiverReferenceFingerprintMaster,
    OWNER_RECEIVER_REFERENCE_PROFILE: receiverReferenceProfile,
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
      botUsername: OWNER_CONTROL_TELEGRAM_BOT_USERNAME,
      runtime: { enabled: false },
      server: { host: '127.0.0.1', port: 3002 },
    });
    expect(OWNER_CONTROL_TELEGRAM_BOT_USERNAME).toBe('fetanagentbot');
  });

  it('accepts only the exact staging project, dedicated role, pinned database routes, and verify-full URL', () => {
    expect(loadOwnerControlConfig(enabledEnvironment()).runtime).toMatchObject({
      enabled: true,
      projectReference: OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
      stage: 'staging',
      tlsMode: 'verify-full',
      connection: {
        host: OWNER_CONTROL_DATABASE_DIRECT_HOST,
        user: 'fetanagent_owner_control_runtime',
      },
    });
    expect(
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        OWNER_CONTROL_DATABASE_URL: poolerDatabaseUrl,
      }).runtime,
    ).toMatchObject({
      enabled: true,
      connection: {
        host: OWNER_CONTROL_DATABASE_POOLER_HOST,
        user: OWNER_CONTROL_DATABASE_POOLER_RUNTIME_ROLE,
      },
    });
    for (const unsafe of [
      databaseUrl.replace(OWNER_CONTROL_DATABASE_DIRECT_HOST, OWNER_CONTROL_DATABASE_POOLER_HOST),
      poolerDatabaseUrl.replace(OWNER_CONTROL_DATABASE_POOLER_RUNTIME_ROLE, 'postgres'),
      poolerDatabaseUrl.replace(
        OWNER_CONTROL_DATABASE_POOLER_RUNTIME_ROLE,
        OWNER_CONTROL_DATABASE_RUNTIME_ROLE,
      ),
      databaseUrl.replace('fetanagent_owner_control_runtime', 'postgres'),
      databaseUrl.replace('5432', '6543'),
      poolerDatabaseUrl.replace('5432', '6543'),
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
    expect(serialized).not.toContain(receiverReferenceEncryptionMaster);
    expect(serialized).not.toContain(receiverReferenceFingerprintMaster);
    expect(serialized).not.toContain('fetanagent_owner_control_runtime');

    expect(() =>
      loadOwnerControlConfig({ ...enabledEnvironment(), NODE_ENV: 'production' }),
    ).toThrow('OWNER_CONTROL_DATABASE_URL_FILE is required');
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        OWNER_RECEIVER_REFERENCE_PROFILE: JSON.stringify({
          ...JSON.parse(receiverReferenceProfile),
          encryptionMasterFingerprint: `sha256:${'0'.repeat(64)}`,
        }),
      }),
    ).toThrow('do not match the approved version 2 profile');
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        DEPOSIT_PROOF_REFERENCE_PROFILE: receiverReferenceProfile,
      }),
    ).toThrow('must use the Owner-specific profile setting');
  });

  it('reads one newline-terminated value from each approved production file', () => {
    const values: Record<string, string> = {
      '/run/secrets/owner_control_database_url': `${databaseUrl}\n`,
      '/run/secrets/owner_control_supabase_publishable_key': `${publishableKey}\n`,
      '/run/secrets/owner_receiver_reference_encryption_master': `${receiverReferenceEncryptionMaster}\n`,
      '/run/secrets/owner_receiver_reference_fingerprint_master': `${receiverReferenceFingerprintMaster}\n`,
      '/etc/fetanagent/deposit-proof-reference-profile.v2.json': receiverReferenceProfile,
    };
    const config = loadOwnerControlConfig(
      {
        NODE_ENV: 'production',
        INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
        OWNER_CONTROL_DATABASE_URL_FILE: '/run/secrets/owner_control_database_url',
        OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
        OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE:
          '/run/secrets/owner_control_supabase_publishable_key',
        OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER_FILE:
          '/run/secrets/owner_receiver_reference_encryption_master',
        OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER_FILE:
          '/run/secrets/owner_receiver_reference_fingerprint_master',
        OWNER_RECEIVER_REFERENCE_PROFILE_FILE:
          '/etc/fetanagent/deposit-proof-reference-profile.v2.json',
      },
      { readSecretFile: (path) => values[path] ?? '' },
    );
    expect(config.runtime.enabled && config.runtime.publishableKey).toBe(publishableKey);
    expect(
      config.runtime.enabled && config.runtime.receiverReferenceProtection.masterProfile.version,
    ).toBe(2);
  });
});
