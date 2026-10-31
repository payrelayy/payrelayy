import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  OWNER_CONTROL_DATABASE_TARGETS,
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
const cbeBirrLookupEncryptionMaster = 'e'.repeat(64);
const cbeBirrLookupFingerprintMaster = 'f'.repeat(64);
const receiverReferenceProfile = JSON.stringify({
  encryptionMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(receiverReferenceEncryptionMaster, 'hex'))
    .digest('hex')}`,
  fingerprintMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(receiverReferenceFingerprintMaster, 'hex'))
    .digest('hex')}`,
  version: 2,
});
const cbeBirrLookupProfile = JSON.stringify({
  encryptionMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(cbeBirrLookupEncryptionMaster, 'hex'))
    .digest('hex')}`,
  fingerprintMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from(cbeBirrLookupFingerprintMaster, 'hex'))
    .digest('hex')}`,
  purpose: 'cbe_birr_receiver_lookup',
  version: 2,
});

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
    OWNER_CONTROL_DEPLOYMENT_TARGET: 'staging',
    OWNER_CONTROL_DATABASE_URL: databaseUrl,
    OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
    OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER: receiverReferenceEncryptionMaster,
    OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER: receiverReferenceFingerprintMaster,
    OWNER_RECEIVER_REFERENCE_PROFILE: receiverReferenceProfile,
  };
}

describe('Owner-control configuration', () => {
  it('keeps the private release token server-side and rejects broad user tokens', () => {
    const token = `github_pat_${'A'.repeat(60)}`;
    const configured = loadOwnerControlConfig({
      ...enabledEnvironment(),
      OWNER_COMPANION_RELEASE_READ_TOKEN: token,
    });
    expect(configured.runtime.companionReleaseReadToken).toBe(token);
    expect(JSON.stringify(redactedOwnerControlConfigForLog(configured))).not.toContain(token);
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        OWNER_COMPANION_RELEASE_READ_TOKEN: 'gho_broad_user_token',
      }),
    ).toThrow('OWNER_COMPANION_RELEASE_READ_TOKEN is malformed');
  });
  it('requires a distinct display key only when full Owner identifiers are enabled', () => {
    const disabled = loadOwnerControlConfig(enabledEnvironment());
    expect(disabled.runtime.enabled && disabled.runtime.paymentDisplayProtection).toBeUndefined();
    const base = {
      ...enabledEnvironment(),
      INTERNAL_OWNER_FULL_PAYMENT_IDENTIFIERS_ENABLED: 'true',
    };
    expect(() => loadOwnerControlConfig(base)).toThrow('Owner payment display keys');
    expect(() =>
      loadOwnerControlConfig({
        ...base,
        OWNER_SMS_DISPLAY_ENCRYPTION_MASTER: receiverReferenceFingerprintMaster,
      }),
    ).toThrow('Owner payment display keys');
    const key = 'a'.repeat(64);
    const config = loadOwnerControlConfig({
      ...base,
      OWNER_SMS_DISPLAY_ENCRYPTION_MASTER: key,
    });
    expect(config.runtime.enabled && config.runtime.paymentDisplayProtection).toEqual({
      smsDisplayEncryptionSecret: key,
    });
    expect(JSON.stringify(redactedOwnerControlConfigForLog(config))).not.toContain(key);
  });
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
      cbeBirrLookupKeyMaterial: { configured: false },
      companionDevicePairing: { serverSignerKeyId: undefined, configured: false },
      devicePairing: { assignmentSignerKeyId: undefined, configured: false },
      deploymentTarget: 'staging',
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

  it('keeps the separate CBE Birr lookup keys default-off and rejects reuse or profile drift', () => {
    const unreadEnvironment = new Proxy(enabledEnvironment(), {
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('OWNER_CBE_BIRR_LOOKUP_')) {
          throw new Error('Default-off lookup keys were read.');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(loadOwnerControlConfig(unreadEnvironment).runtime).toMatchObject({
      cbeBirrLookupKeyMaterial: { configured: false },
      cbeBirrReceiverV2RotationEnabled: false,
    });
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        INTERNAL_OWNER_CBE_BIRR_V2_RECEIVER_ROTATION_ENABLED: 'true',
      }),
    ).toThrow('requires the lookup key profile');
    const enabled = {
      ...enabledEnvironment(),
      INTERNAL_OWNER_CBE_BIRR_LOOKUP_KEY_LOADING_ENABLED: 'true',
      OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER: cbeBirrLookupEncryptionMaster,
      OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER: cbeBirrLookupFingerprintMaster,
      OWNER_CBE_BIRR_LOOKUP_PROFILE: cbeBirrLookupProfile,
    };
    const configured = loadOwnerControlConfig(enabled);
    expect(configured.runtime).toMatchObject({
      cbeBirrReceiverV2RotationEnabled: false,
      cbeBirrLookupKeyMaterial: {
        configured: true,
        encryptionSecret: cbeBirrLookupEncryptionMaster,
        fingerprintSecret: cbeBirrLookupFingerprintMaster,
        masterProfile: { purpose: 'cbe_birr_receiver_lookup', version: 2 },
      },
    });
    const redacted = JSON.stringify(redactedOwnerControlConfigForLog(configured));
    expect(redacted).toContain('"cbeBirrLookupKeyMaterialConfigured":true');
    expect(redacted).toContain('"cbeBirrReceiverV2RotationEnabled":false');
    const rotationEnabled = loadOwnerControlConfig({
      ...enabled,
      INTERNAL_OWNER_CBE_BIRR_V2_RECEIVER_ROTATION_ENABLED: 'true',
    });
    expect(
      rotationEnabled.runtime.enabled && rotationEnabled.runtime.cbeBirrReceiverV2RotationEnabled,
    ).toBe(true);
    for (const secret of [
      cbeBirrLookupEncryptionMaster,
      cbeBirrLookupFingerprintMaster,
      receiverReferenceEncryptionMaster,
      receiverReferenceFingerprintMaster,
    ]) {
      expect(redacted).not.toContain(secret);
    }
    for (const override of [
      { OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER: receiverReferenceEncryptionMaster },
      { OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER: receiverReferenceFingerprintMaster },
      { OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER: receiverReferenceFingerprintMaster },
      { OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER: cbeBirrLookupEncryptionMaster },
      { OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER: 'short' },
    ]) {
      expect(() => loadOwnerControlConfig({ ...enabled, ...override })).toThrow(
        'missing, malformed, or reused',
      );
    }
    for (const override of [
      { OWNER_CBE_BIRR_LOOKUP_PROFILE: undefined },
      { OWNER_CBE_BIRR_LOOKUP_PROFILE: receiverReferenceProfile },
      {
        OWNER_CBE_BIRR_LOOKUP_PROFILE: JSON.stringify({
          ...JSON.parse(cbeBirrLookupProfile),
          encryptionMasterFingerprint: `sha256:${'0'.repeat(64)}`,
        }),
      },
    ]) {
      expect(() => loadOwnerControlConfig({ ...enabled, ...override })).toThrow();
    }
    expect(() =>
      loadOwnerControlConfig({
        ...enabled,
        OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE: '/tmp/duplicate-profile.json',
      }),
    ).toThrow('mutually exclusive');
    expect(() =>
      loadOwnerControlConfig({
        ...enabled,
        INTERNAL_OWNER_CBE_BIRR_LOOKUP_KEY_LOADING_ENABLED: 'yes',
      }),
    ).toThrow('INTERNAL_OWNER_CBE_BIRR_LOOKUP_KEY_LOADING_ENABLED');
  });

  it('binds the exact production Auth and database routes only when production is explicit', () => {
    const productionTarget = OWNER_CONTROL_DATABASE_TARGETS.production;
    const productionDirectUrl = `postgresql://${OWNER_CONTROL_DATABASE_RUNTIME_ROLE}:password@${productionTarget.directHost}:5432/postgres?sslmode=verify-full`;
    const productionPoolerUrl = `postgresql://${productionTarget.poolerRuntimeRole}:password@${productionTarget.poolerHost}:5432/postgres?sslmode=verify-full`;
    const productionEnvironment = {
      ...enabledEnvironment(),
      OWNER_CONTROL_DEPLOYMENT_TARGET: 'production',
      OWNER_CONTROL_DATABASE_URL: productionDirectUrl,
      OWNER_CONTROL_SUPABASE_URL: productionTarget.supabaseUrl,
    };

    expect(loadOwnerControlConfig(productionEnvironment).runtime).toMatchObject({
      enabled: true,
      deploymentTarget: 'production',
      projectReference: productionTarget.projectReference,
      stage: 'production',
      supabaseUrl: productionTarget.supabaseUrl,
      connection: {
        host: productionTarget.directHost,
        user: OWNER_CONTROL_DATABASE_RUNTIME_ROLE,
      },
    });
    expect(
      loadOwnerControlConfig({
        ...productionEnvironment,
        OWNER_CONTROL_DATABASE_URL: productionPoolerUrl,
      }).runtime,
    ).toMatchObject({
      enabled: true,
      connection: {
        host: productionTarget.poolerHost,
        user: productionTarget.poolerRuntimeRole,
      },
    });

    expect(() =>
      loadOwnerControlConfig({
        ...productionEnvironment,
        OWNER_CONTROL_DATABASE_URL: databaseUrl,
      }),
    ).toThrow('must match the explicit deployment target');
    expect(() =>
      loadOwnerControlConfig({
        ...productionEnvironment,
        OWNER_CONTROL_SUPABASE_URL: OWNER_CONTROL_DATABASE_TARGETS.staging.supabaseUrl,
      }),
    ).toThrow('must match the explicit deployment target');
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        OWNER_CONTROL_DATABASE_URL: productionDirectUrl,
      }),
    ).toThrow('must match the explicit deployment target');
  });

  it('rejects a missing, differently cased, or unknown deployment target', () => {
    for (const target of [undefined, 'Production', 'prod']) {
      expect(() =>
        loadOwnerControlConfig({
          ...enabledEnvironment(),
          OWNER_CONTROL_DEPLOYMENT_TARGET: target,
        }),
      ).toThrow('OWNER_CONTROL_DEPLOYMENT_TARGET must be explicitly set');
    }
  });

  it('enables only a validated public TeleBirr assignment-signer identifier', () => {
    const configured = loadOwnerControlConfig({
      ...enabledEnvironment(),
      OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID: 'telebirr_assignment_signer_2026_01',
    });
    expect(configured.runtime).toMatchObject({
      devicePairing: {
        assignmentSignerKeyId: 'telebirr_assignment_signer_2026_01',
        configured: true,
      },
    });
    expect(JSON.stringify(redactedOwnerControlConfigForLog(configured))).not.toContain(
      'telebirr_assignment_signer_2026_01',
    );
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID: 'short',
      }),
    ).toThrow('OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID is malformed');
  });

  it('enables only a validated public Windows companion server-signer identifier', () => {
    const configured = loadOwnerControlConfig({
      ...enabledEnvironment(),
      OWNER_COMPANION_SERVER_SIGNER_KEY_ID: 'companion_server_signer_2026_01',
    });
    expect(configured.runtime).toMatchObject({
      companionDevicePairing: {
        serverSignerKeyId: 'companion_server_signer_2026_01',
        configured: true,
      },
    });
    expect(JSON.stringify(redactedOwnerControlConfigForLog(configured))).not.toContain(
      'companion_server_signer_2026_01',
    );
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        OWNER_COMPANION_SERVER_SIGNER_KEY_ID: 'short',
      }),
    ).toThrow('OWNER_COMPANION_SERVER_SIGNER_KEY_ID is malformed');
  });

  it('keeps the independent routine receipt signer optional and never logs its private key', () => {
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64url');
    expect(loadOwnerControlConfig(enabledEnvironment()).runtime).toMatchObject({
      routineEnrollmentReceiptSigner: { configured: false },
    });
    const configured = loadOwnerControlConfig({
      ...enabledEnvironment(),
      OWNER_ROUTINE_ENROLLMENT_SIGNER_PRIVATE_KEY: key,
    });
    expect(configured.runtime).toMatchObject({
      routineEnrollmentReceiptSigner: {
        configured: true,
        signerKeyId: 'telebirr-routine-enrollment-staging-v1',
        privateKeyPkcs8: key,
      },
    });
    expect(JSON.stringify(redactedOwnerControlConfigForLog(configured))).not.toContain(key);
    expect(() =>
      loadOwnerControlConfig({
        ...enabledEnvironment(),
        OWNER_ROUTINE_ENROLLMENT_SIGNER_PRIVATE_KEY: 'short',
      }),
    ).toThrow('OWNER_ROUTINE_ENROLLMENT_SIGNER_PRIVATE_KEY is malformed');
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
    const routineSignerKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64url');
    const values: Record<string, string> = {
      '/run/secrets/owner_control_database_url': `${databaseUrl}\n`,
      '/run/secrets/owner_control_supabase_publishable_key': `${publishableKey}\n`,
      '/run/secrets/owner_receiver_reference_encryption_master': `${receiverReferenceEncryptionMaster}\n`,
      '/run/secrets/owner_receiver_reference_fingerprint_master': `${receiverReferenceFingerprintMaster}\n`,
      '/run/secrets/owner_cbe_birr_lookup_encryption_master': `${cbeBirrLookupEncryptionMaster}\n`,
      '/run/secrets/owner_cbe_birr_lookup_fingerprint_master': `${cbeBirrLookupFingerprintMaster}\n`,
      '/run/secrets/owner_routine_enrollment_signer_pkcs8': `${routineSignerKey}\n`,
      '/etc/fetanagent/deposit-proof-reference-profile.v2.json': receiverReferenceProfile,
      '/etc/fetanagent/owner-cbe-birr-receiver-lookup-profile.v2.json': cbeBirrLookupProfile,
    };
    const config = loadOwnerControlConfig(
      {
        NODE_ENV: 'production',
        INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
        OWNER_CONTROL_DEPLOYMENT_TARGET: 'staging',
        OWNER_CONTROL_DATABASE_URL_FILE: '/run/secrets/owner_control_database_url',
        OWNER_CONTROL_SUPABASE_URL: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
        OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE:
          '/run/secrets/owner_control_supabase_publishable_key',
        OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER_FILE:
          '/run/secrets/owner_receiver_reference_encryption_master',
        OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER_FILE:
          '/run/secrets/owner_receiver_reference_fingerprint_master',
        OWNER_ROUTINE_ENROLLMENT_SIGNER_PRIVATE_KEY_FILE:
          '/run/secrets/owner_routine_enrollment_signer_pkcs8',
        OWNER_RECEIVER_REFERENCE_PROFILE_FILE:
          '/etc/fetanagent/deposit-proof-reference-profile.v2.json',
      },
      { readSecretFile: (path) => values[path] ?? '' },
    );
    expect(config.runtime.enabled && config.runtime.publishableKey).toBe(publishableKey);
    expect(config.runtime.enabled && config.runtime.routineEnrollmentReceiptSigner.configured).toBe(
      true,
    );
    expect(JSON.stringify(redactedOwnerControlConfigForLog(config))).not.toContain(
      routineSignerKey,
    );
    expect(
      config.runtime.enabled && config.runtime.receiverReferenceProtection.masterProfile.version,
    ).toBe(2);
    const cbeProductionEnvironment: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true',
      INTERNAL_OWNER_CBE_BIRR_LOOKUP_KEY_LOADING_ENABLED: 'true',
      OWNER_CONTROL_DEPLOYMENT_TARGET: 'staging',
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
      OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_FILE:
        '/run/secrets/owner_cbe_birr_lookup_encryption_master',
      OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_FILE:
        '/run/secrets/owner_cbe_birr_lookup_fingerprint_master',
      OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE:
        '/etc/fetanagent/owner-cbe-birr-receiver-lookup-profile.v2.json',
    };
    const cbeConfigured = loadOwnerControlConfig(cbeProductionEnvironment, {
      readSecretFile: (path) => values[path] ?? '',
    });
    expect(cbeConfigured.runtime).toMatchObject({
      cbeBirrLookupKeyMaterial: { configured: true },
    });
    expect(JSON.stringify(redactedOwnerControlConfigForLog(cbeConfigured))).not.toContain(
      cbeBirrLookupEncryptionMaster,
    );
    for (const override of [
      { OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_FILE: '/tmp/lookup-secret' },
      { OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_FILE: '/tmp/lookup-secret' },
      { OWNER_CBE_BIRR_LOOKUP_PROFILE_FILE: '/tmp/lookup-profile.json' },
      { OWNER_CBE_BIRR_LOOKUP_PROFILE: cbeBirrLookupProfile },
    ]) {
      expect(() =>
        loadOwnerControlConfig(
          { ...cbeProductionEnvironment, ...override },
          { readSecretFile: (path) => values[path] ?? '' },
        ),
      ).toThrow();
    }
  });
});
