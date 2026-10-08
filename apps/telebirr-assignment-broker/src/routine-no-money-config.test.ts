import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { constants } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_NO_MONEY_CA_FILE,
  ROUTINE_NO_MONEY_DATABASE_URL_FILE,
  ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE,
  ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE,
  ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE,
  loadRoutineNoMoneyConfig,
} from './routine-no-money-config.js';
import type {
  TelebirrAssignmentBrokerConfigDependencies,
  TelebirrAssignmentBrokerGuardedFileStat,
} from './telebirr-assignment-broker-config.js';

const signerId = '11111111-1111-4111-8111-111111111111';
const ca = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(62)}==\n-----END CERTIFICATE-----\n`;
const role = 'fetanagent_routine_telebirr_no_money_runtime';
const productionProject = 'xzztugbgtulptnbpoelr';
const url = `postgresql://${role}.${productionProject}:synthetic-password-123456@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;

const enabled: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: 'production',
  TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED: 'true',
  INTERNAL_ROUTINE_NO_MONEY_BROKER_ENABLED: 'true',
  ROUTINE_NO_MONEY_DATABASE_URL_FILE,
  ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE,
  ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE,
  ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE,
};

function fixture(overrides: Partial<Record<string, string | Buffer>> = {}) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = Buffer.from(pair.privateKey.export({ format: 'der', type: 'pkcs8' }));
  const publicKey = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  const publicDigest = `sha256:${createHash('sha256').update(publicKey).digest('hex')}`;
  const keyHex = 'a'.repeat(64);
  const keyId = `sha256:${createHash('sha256').update(Buffer.from(keyHex, 'hex')).digest('hex')}`;
  const values: Record<string, string | Buffer> = {
    [ROUTINE_NO_MONEY_CA_FILE]: ca,
    [ROUTINE_NO_MONEY_DATABASE_URL_FILE]: url,
    [ROUTINE_NO_MONEY_REFERENCE_OPENING_KEY_FILE]: JSON.stringify({
      contractVersion: 1,
      providerCode: 'telebirr',
      purpose: 'deposit-proof-reference-opening',
      keyVersion: 2,
      keyId,
      keyHex,
    }),
    [ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE]: privateKey,
    [ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE]: JSON.stringify({
      contractVersion: 1,
      providerCode: 'telebirr',
      assignmentSignerId: signerId,
      keyId: 'telebirr-routine-lookup-production-v1',
      publicKeySpkiSha256: publicDigest,
    }),
    ...overrides,
  };
  const returned: Buffer[] = [];
  const bytesFor = (path: string) => {
    const value = values[path];
    if (value === undefined) throw new Error('Missing synthetic guarded file');
    return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
  };
  const statFor = (path: string): TelebirrAssignmentBrokerGuardedFileStat => ({
    dev: 1,
    ino: path.length,
    mode: path === ROUTINE_NO_MONEY_CA_FILE ? 0o100444 : 0o100400,
    mtimeMs: 1_700_000_000_000,
    size: bytesFor(path).byteLength,
    uid: 0,
    isFile: () => true,
    isSymbolicLink: () => false,
  });
  const fileSystem = {
    lstat: vi.fn(statFor),
    realpath: vi.fn((path: string) => path),
    open: vi.fn((path: string, flags: number) => {
      expect(flags).toBe(constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      return {
        close: vi.fn(),
        read: vi.fn(() => {
          const bytes = bytesFor(path);
          returned.push(bytes);
          return bytes;
        }),
        stat: vi.fn(() => statFor(path)),
      };
    }),
  };
  const dependencies: TelebirrAssignmentBrokerConfigDependencies = {
    effectiveUserId: 10001,
    fileSystem,
    platform: 'linux',
  };
  return { dependencies, fileSystem, returned, pair, publicDigest };
}

describe('production routine no-money broker configuration', () => {
  it('does not open any credential when the explicit flag is absent', () => {
    const { dependencies, fileSystem } = fixture();
    expect(loadRoutineNoMoneyConfig({}, dependencies)).toBeUndefined();
    expect(fileSystem.open).not.toHaveBeenCalled();
  });

  it('requires production, dry-run, enrollment-only, and fixed guarded paths before file access', () => {
    for (const changed of [
      { NODE_ENV: 'development' },
      { FINANCIAL_ACTIONS_MODE: 'live' },
      { TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: 'staging' },
      { TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED: 'false' },
      { ROUTINE_NO_MONEY_DATABASE_URL_FILE: '/tmp/rogue' },
      { NODE_EXTRA_CA_CERTS: ROUTINE_NO_MONEY_CA_FILE },
      { ROUTINE_NO_MONEY_DATABASE_URL: url },
    ]) {
      const { dependencies, fileSystem } = fixture();
      expect(() => loadRoutineNoMoneyConfig({ ...enabled, ...changed }, dependencies)).toThrow();
      expect(fileSystem.open).not.toHaveBeenCalled();
    }
  });

  it('loads the separate no-money login and signs with only the pinned P-256 key', async () => {
    const { dependencies, fileSystem, returned, pair, publicDigest } = fixture();
    const config = loadRoutineNoMoneyConfig(enabled, dependencies);
    expect(config?.connection).toMatchObject({
      target: 'production',
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      user: `${role}.${productionProject}`,
      database: 'postgres',
    });
    expect(config?.signer.assignmentSignerId).toBe(signerId);
    expect(config?.signer.keyId).toBe('telebirr-routine-lookup-production-v1');
    expect(
      `sha256:${createHash('sha256').update(config!.signer.publicKeySpkiDer).digest('hex')}`,
    ).toBe(publicDigest);
    const transcript = Buffer.from('routine-no-money-synthetic-transcript');
    const signature = Buffer.from(await config!.signer.signP1363(transcript), 'base64url');
    expect(
      verify(
        'sha256',
        transcript,
        {
          key: pair.publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        signature,
      ),
    ).toBe(true);
    signature.fill(0);
    expect(fileSystem.open).toHaveBeenCalledTimes(5);
    expect(returned).toHaveLength(5);
    expect(returned.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });

  it('rejects a different database login, signing key, or noncanonical manifest', () => {
    const cases = [
      { [ROUTINE_NO_MONEY_DATABASE_URL_FILE]: url.replace(role, 'postgres') },
      { [ROUTINE_NO_MONEY_SIGNER_MANIFEST_FILE]: '{}' },
      { [ROUTINE_NO_MONEY_SIGNER_PRIVATE_KEY_FILE]: Buffer.from('not a DER key') },
    ];
    for (const changed of cases) {
      const { dependencies } = fixture(changed);
      expect(() => loadRoutineNoMoneyConfig(enabled, dependencies)).toThrow();
    }
  });
});
