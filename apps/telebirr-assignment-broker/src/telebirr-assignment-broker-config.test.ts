import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  TELEBIRR_REFERENCE_OPENING_PROVIDER,
  TELEBIRR_REFERENCE_OPENING_PURPOSE,
} from '@fetanagent/telebirr-reference-opening';
import {
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  digestTelebirrLivePilotReceiverName,
} from '@fetanagent/telebirr-verification-foundation';
import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE,
  TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE,
  TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE,
  TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE,
  TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE,
  loadTelebirrAssignmentBrokerConfig,
  redactedTelebirrAssignmentBrokerConfigForLog,
  type TelebirrAssignmentBrokerConfigDependencies,
  type TelebirrAssignmentBrokerGuardedFileStat,
} from './telebirr-assignment-broker-config.js';

const ids = {
  signer: '11111111-1111-4111-8111-111111111111',
  pilot: '22222222-2222-4222-8222-222222222222',
  receiver: '33333333-3333-4333-8333-333333333333',
  profile: '44444444-4444-4444-8444-444444444444',
} as const;
const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const receiverName = 'synthetic pilot receiver';
const caCertificate = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`;
const databaseUrl =
  'postgresql://fetanagent_telebirr_assignment_broker_runtime:synthetic-password-123456@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full';

function p256Pair() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = Buffer.from(pair.privateKey.export({ format: 'der', type: 'pkcs8' }));
  const publicKey = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  return {
    ...pair,
    privateKey,
    publicKey,
    publicKeyDigest: `sha256:${createHash('sha256').update(publicKey).digest('hex')}`,
  };
}

function openingKey() {
  const keyHex = 'a'.repeat(64);
  const bytes = Buffer.from(keyHex, 'hex');
  const keyId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  bytes.fill(0);
  return {
    keyHex,
    keyId,
    json: JSON.stringify({
      contractVersion: TELEBIRR_REFERENCE_OPENING_CONTRACT_VERSION,
      providerCode: TELEBIRR_REFERENCE_OPENING_PROVIDER,
      purpose: TELEBIRR_REFERENCE_OPENING_PURPOSE,
      keyVersion: TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
      keyId,
      keyHex,
    }),
  };
}

function runtimeManifest(
  signerDigest: string,
  referenceOpeningKeyId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    contractVersion: 1,
    providerCode: 'telebirr',
    assignmentSignerId: ids.signer,
    assignmentSignerKeyId: 'pilot-assignment-key-0001',
    assignmentSignerPublicKeySpkiSha256: signerDigest,
    referenceOpeningKeyId,
    receiverManifest: {
      contractVersion: 1,
      providerCode: 'telebirr',
      pilotRevisionId: ids.pilot,
      receiverRevisionId: ids.receiver,
      receiverProfileId: ids.profile,
      receiverProfileDigest: sha('1'),
      receiverConfigurationDigest: sha('2'),
      receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
      expectedReceiverNameNormalized: receiverName,
      expectedReceiverNameDigest: digestTelebirrLivePilotReceiverName(receiverName),
    },
    ...overrides,
  });
}

const enabledEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  INTERNAL_TELEBIRR_ASSIGNMENT_BROKER_ENABLED: 'true',
  TELEBIRR_ASSIGNMENT_BROKER_NO_MONEY_PILOT_ENABLED: 'true',
  TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: 'staging',
  TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE: TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE,
  TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE:
    TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE,
  TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE:
    TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE,
  TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE:
    TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE,
  NODE_EXTRA_CA_CERTS: TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE,
};

type FileValues = Readonly<Record<string, string | Buffer>>;

interface FileOverrides {
  readonly after?: Partial<TelebirrAssignmentBrokerGuardedFileStat>;
  readonly before?: Partial<TelebirrAssignmentBrokerGuardedFileStat>;
  readonly opened?: Partial<TelebirrAssignmentBrokerGuardedFileStat>;
  readonly realpath?: string;
}

function fileValues(signer = p256Pair(), referenceOpeningKey = openingKey()): FileValues {
  return {
    [TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE]: databaseUrl,
    [TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE]: referenceOpeningKey.json,
    [TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE]: runtimeManifest(
      signer.publicKeyDigest,
      referenceOpeningKey.keyId,
    ),
    [TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE]: signer.privateKey,
    [TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE]: caCertificate,
  };
}

function guardedDependencies(
  values: FileValues = fileValues(),
  target = TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE,
  overrides: FileOverrides = {},
  effectiveUserId = 10_001,
): TelebirrAssignmentBrokerConfigDependencies & {
  readonly fileSystem: NonNullable<TelebirrAssignmentBrokerConfigDependencies['fileSystem']>;
  readonly returnedBuffers: Buffer[];
} {
  const bytesFor = (path: string): Buffer => {
    const value = values[path];
    if (value === undefined) throw new Error('missing synthetic file');
    return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
  };
  const statFor = (
    path: string,
    override: Partial<TelebirrAssignmentBrokerGuardedFileStat> = {},
  ): TelebirrAssignmentBrokerGuardedFileStat => {
    const bytes = bytesFor(path);
    const result = {
      dev: 7,
      ino: path.length,
      mode: path === TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE ? 0o100444 : 0o100400,
      mtimeMs: 1_700_000_000_000,
      size: bytes.byteLength,
      uid: 0,
      isFile: () => true,
      isSymbolicLink: () => false,
      ...override,
    };
    bytes.fill(0);
    return result;
  };
  const returnedBuffers: Buffer[] = [];
  const fileSystem = {
    lstat: vi.fn((path: string) => statFor(path, path === target ? overrides.before : {})),
    realpath: vi.fn((path: string) =>
      path === target && overrides.realpath !== undefined ? overrides.realpath : path,
    ),
    open: vi.fn((path: string, _flags: number) => {
      let stats = 0;
      return {
        close: vi.fn(),
        read: vi.fn(() => {
          const bytes = bytesFor(path);
          returnedBuffers.push(bytes);
          return bytes;
        }),
        stat: vi.fn(() => {
          stats += 1;
          return statFor(
            path,
            path === target ? (stats === 1 ? overrides.opened : overrides.after) : {},
          );
        }),
      };
    }),
  };
  return { effectiveUserId, fileSystem, platform: 'linux', returnedBuffers };
}

describe('private TeleBirr assignment broker configuration', () => {
  it('is disabled by default without reading any file', () => {
    const dependencies = guardedDependencies();
    expect(loadTelebirrAssignmentBrokerConfig({}, dependencies)).toEqual({ enabled: false });
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
  });

  it('loads only fixed guarded files and produces a bound P-256 signer', async () => {
    const signer = p256Pair();
    const dependencies = guardedDependencies(fileValues(signer));
    const config = loadTelebirrAssignmentBrokerConfig(enabledEnvironment, dependencies);
    expect(config).toMatchObject({
      enabled: true,
      deploymentTarget: 'staging',
      connection: {
        database: 'postgres',
        host: 'db.spzpiyxheappsfyswewl.supabase.co',
        port: 5432,
        user: 'fetanagent_telebirr_assignment_broker_runtime',
      },
      receiverManifest: {
        pilotRevisionId: ids.pilot,
        receiverRevisionId: ids.receiver,
        receiverProfileId: ids.profile,
      },
    });
    if (!config.enabled) throw new Error('expected enabled synthetic config');
    expect(dependencies.fileSystem.lstat).toHaveBeenCalledTimes(5);
    for (const path of [
      TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE,
      TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE,
      TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE,
      TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE,
      TELEBIRR_ASSIGNMENT_BROKER_SUPABASE_CA_FILE,
    ]) {
      expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
    }
    const transcript = Buffer.from('synthetic assignment transcript', 'utf8');
    const signature = Buffer.from(await config.signer.signP1363(transcript), 'base64url');
    expect(
      verify(
        'sha256',
        transcript,
        { key: signer.publicKey, format: 'der', type: 'spki', dsaEncoding: 'ieee-p1363' },
        signature,
      ),
    ).toBe(true);
    signature.fill(0);
    expect(dependencies.returnedBuffers).toHaveLength(5);
    expect(dependencies.returnedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(
      true,
    );
  });

  it.each([
    ['non-production', { NODE_ENV: 'test' }],
    ['live financial mode', { FINANCIAL_ACTIONS_MODE: 'live' }],
    ['missing no-money pilot gate', { TELEBIRR_ASSIGNMENT_BROKER_NO_MONEY_PILOT_ENABLED: 'false' }],
    ['wrong deployment target', { TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: 'production' }],
    ['wrong CA path', { NODE_EXTRA_CA_CERTS: '/tmp/ca' }],
    [
      'wrong database secret path',
      { TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE: '/tmp/database' },
    ],
    [
      'wrong opening key path',
      { TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE: '/tmp/key' },
    ],
    ['wrong signer path', { TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE: '/tmp/signer' }],
  ])('rejects the enabled runtime with %s', (_name, override) => {
    expect(() =>
      loadTelebirrAssignmentBrokerConfig(
        { ...enabledEnvironment, ...(override as NodeJS.ProcessEnv) },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE',
  ])('rejects forbidden inline or root secret environment %s', (name) => {
    expect(() =>
      loadTelebirrAssignmentBrokerConfig(
        { ...enabledEnvironment, [name]: 'must-not-be-in-this-runtime' },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    [
      'wrong role',
      databaseUrl.replace('fetanagent_telebirr_assignment_broker_runtime', 'postgres'),
    ],
    ['wrong host', databaseUrl.replace('db.spzpiyxheappsfyswewl.supabase.co', 'localhost')],
    ['wrong TLS mode', databaseUrl.replace('verify-full', 'require')],
    ['extra query', `${databaseUrl}&application_name=other`],
    ['short password', databaseUrl.replace('synthetic-password-123456', 'short')],
  ])('rejects a database URL with %s', (_name, value) => {
    expect(() =>
      loadTelebirrAssignmentBrokerConfig(
        enabledEnvironment,
        guardedDependencies({
          ...fileValues(),
          [TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE]: value,
        }),
      ),
    ).toThrow('configuration is unavailable');
  });

  it('binds the runtime manifest to the exact scoped opening and signing keys', () => {
    const signer = p256Pair();
    const referenceOpeningKey = openingKey();
    const base = fileValues(signer, referenceOpeningKey);
    for (const manifest of [
      runtimeManifest(sha('8'), referenceOpeningKey.keyId),
      runtimeManifest(signer.publicKeyDigest, sha('9')),
      ` ${runtimeManifest(signer.publicKeyDigest, referenceOpeningKey.keyId)}`,
      runtimeManifest(signer.publicKeyDigest, referenceOpeningKey.keyId, {
        unexpected: true,
      }),
    ]) {
      expect(() =>
        loadTelebirrAssignmentBrokerConfig(
          enabledEnvironment,
          guardedDependencies({
            ...base,
            [TELEBIRR_ASSIGNMENT_BROKER_RUNTIME_MANIFEST_FILE]: manifest,
          }),
        ),
      ).toThrow('configuration is unavailable');
    }
  });

  it('rejects a malformed, non-P-256, non-canonical, or mismatched private key', () => {
    const signer = p256Pair();
    const referenceOpeningKey = openingKey();
    const base = fileValues(signer, referenceOpeningKey);
    const wrongCurve = Buffer.from(
      generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({
        format: 'der',
        type: 'pkcs8',
      }),
    );
    const mismatched = p256Pair().privateKey;
    const trailingBytes = Buffer.concat([signer.privateKey, Buffer.from([0])]);
    for (const privateKey of [Buffer.from('not-a-key'), wrongCurve, mismatched, trailingBytes]) {
      expect(() =>
        loadTelebirrAssignmentBrokerConfig(
          enabledEnvironment,
          guardedDependencies({
            ...base,
            [TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE]: privateKey,
          }),
        ),
      ).toThrow('configuration is unavailable');
    }
  });

  it.each([
    ['symbolic link', { before: { isSymbolicLink: () => true } }],
    ['writable secret', { before: { mode: 0o100600 } }],
    ['foreign owner', { before: { uid: 20_002 } }],
    ['path substitution', { realpath: '/tmp/substitution' }],
    ['inode swap before open', { opened: { ino: 999 } }],
    ['size change after read', { after: { size: 1 } }],
  ])('rejects guarded-file %s', (_name, overrides) => {
    expect(() =>
      loadTelebirrAssignmentBrokerConfig(
        enabledEnvironment,
        guardedDependencies(
          undefined,
          TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE,
          overrides as FileOverrides,
        ),
      ),
    ).toThrow('configuration is unavailable');
  });

  it('rejects non-Linux and root execution before reading secrets', () => {
    for (const dependencies of [
      { ...guardedDependencies(), platform: 'win32' as const },
      guardedDependencies(undefined, undefined, undefined, 0),
    ]) {
      expect(() => loadTelebirrAssignmentBrokerConfig(enabledEnvironment, dependencies)).toThrow(
        'configuration is unavailable',
      );
      expect(dependencies.fileSystem.open).not.toHaveBeenCalled();
    }
  });

  it('exposes only fixed-key zero-secret diagnostics and no calendar shutdown', async () => {
    const config = loadTelebirrAssignmentBrokerConfig(enabledEnvironment, guardedDependencies());
    const projection = redactedTelebirrAssignmentBrokerConfigForLog(config);
    expect(projection).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      connectionConfigured: true,
      openingKeyConfigured: true,
      receiverManifestConfigured: true,
      signerConfigured: true,
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('synthetic-password');
    expect(serialized).not.toContain(receiverName);
    expect(serialized).not.toContain(ids.signer);

    const source = await readFile(
      new URL('./telebirr-assignment-broker-config.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/2026-09-04|expiresAt|shutdownAt/u);
    expect(source).toContain('rejectInlineOrRootSecrets(environment)');
  });
});
