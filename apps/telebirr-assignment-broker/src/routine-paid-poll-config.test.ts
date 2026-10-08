import { createHash, generateKeyPairSync } from 'node:crypto';
import { constants } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_PAID_POLL_CA_FILE,
  ROUTINE_PAID_POLL_DATABASE_URL_FILE,
  ROUTINE_PAID_POLL_REFERENCE_OPENING_KEY_FILE,
  ROUTINE_PAID_POLL_SIGNER_MANIFEST_FILE,
  ROUTINE_PAID_POLL_SIGNER_PRIVATE_KEY_FILE,
  loadRoutinePaidPollConfig,
} from './routine-paid-poll-config.js';
import type {
  TelebirrAssignmentBrokerConfigDependencies,
  TelebirrAssignmentBrokerGuardedFileStat,
} from './telebirr-assignment-broker-config.js';

const role = 'fetanagent_routine_telebirr_paid_poll_runtime';
const project = 'xzztugbgtulptnbpoelr';
const url = `postgresql://${role}.${project}:synthetic-password-123456@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
const ca = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(62)}==\n-----END CERTIFICATE-----\n`;
const enabled: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: 'production',
  TELEBIRR_ASSIGNMENT_BROKER_NO_MONEY_PILOT_ENABLED: 'true',
  TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED: 'true',
  INTERNAL_ROUTINE_PAID_POLL_BROKER_ENABLED: 'true',
  ROUTINE_PAID_POLL_DATABASE_URL_FILE,
  ROUTINE_PAID_POLL_REFERENCE_OPENING_KEY_FILE,
  ROUTINE_PAID_POLL_SIGNER_PRIVATE_KEY_FILE,
  ROUTINE_PAID_POLL_SIGNER_MANIFEST_FILE,
};

function fixture(overrides: Partial<Record<string, string | Buffer>> = {}) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = Buffer.from(pair.privateKey.export({ format: 'der', type: 'pkcs8' }));
  const publicKey = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  const keyHex = 'a'.repeat(64);
  const values: Record<string, string | Buffer> = {
    [ROUTINE_PAID_POLL_CA_FILE]: ca,
    [ROUTINE_PAID_POLL_DATABASE_URL_FILE]: url,
    [ROUTINE_PAID_POLL_REFERENCE_OPENING_KEY_FILE]: JSON.stringify({
      contractVersion: 1,
      providerCode: 'telebirr',
      purpose: 'deposit-proof-reference-opening',
      keyVersion: 2,
      keyId: `sha256:${createHash('sha256').update(Buffer.from(keyHex, 'hex')).digest('hex')}`,
      keyHex,
    }),
    [ROUTINE_PAID_POLL_SIGNER_PRIVATE_KEY_FILE]: privateKey,
    [ROUTINE_PAID_POLL_SIGNER_MANIFEST_FILE]: JSON.stringify({
      contractVersion: 1,
      providerCode: 'telebirr',
      assignmentSignerId: '11111111-1111-4111-8111-111111111111',
      keyId: 'telebirr-routine-lookup-production-v1',
      publicKeySpkiSha256: `sha256:${createHash('sha256').update(publicKey).digest('hex')}`,
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
    mode: path === ROUTINE_PAID_POLL_CA_FILE ? 0o100444 : 0o100400,
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
  return { dependencies, fileSystem, returned };
}

describe('production routine paid poll broker configuration', () => {
  it('does not open any credential until the independent flag is true', () => {
    const { dependencies, fileSystem } = fixture();
    expect(loadRoutinePaidPollConfig({}, dependencies)).toBeUndefined();
    expect(fileSystem.open).not.toHaveBeenCalled();
  });

  it('checks production, dry-run, fixed paths, and secret transport before access', () => {
    for (const changed of [
      { NODE_ENV: 'development' },
      { FINANCIAL_ACTIONS_MODE: 'live' },
      { TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: 'staging' },
      { TELEBIRR_ASSIGNMENT_BROKER_NO_MONEY_PILOT_ENABLED: 'false' },
      { TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED: 'false' },
      { ROUTINE_PAID_POLL_DATABASE_URL_FILE: '/tmp/rogue' },
      { NODE_EXTRA_CA_CERTS: ROUTINE_PAID_POLL_CA_FILE },
      { ROUTINE_PAID_POLL_DATABASE_URL: url },
    ]) {
      const { dependencies, fileSystem } = fixture();
      expect(() => loadRoutinePaidPollConfig({ ...enabled, ...changed }, dependencies)).toThrow();
      expect(fileSystem.open).not.toHaveBeenCalled();
    }
  });

  it('loads only the paid SQL login and the existing guarded lookup key', () => {
    const { dependencies, fileSystem, returned } = fixture();
    const config = loadRoutinePaidPollConfig(enabled, dependencies);
    expect(config?.connection).toMatchObject({
      target: 'production',
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      user: `${role}.${project}`,
      database: 'postgres',
    });
    expect(config?.signer.keyId).toBe('telebirr-routine-lookup-production-v1');
    expect(fileSystem.open).toHaveBeenCalledTimes(5);
    expect(returned.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });

  it('rejects the no-money login, loose TLS, and a different signer manifest', () => {
    for (const changed of [
      {
        [ROUTINE_PAID_POLL_DATABASE_URL_FILE]: url.replace(
          role,
          'fetanagent_routine_telebirr_no_money_runtime',
        ),
      },
      { [ROUTINE_PAID_POLL_DATABASE_URL_FILE]: url.replace('verify-full', 'require') },
      { [ROUTINE_PAID_POLL_SIGNER_MANIFEST_FILE]: '{}' },
    ]) {
      const { dependencies } = fixture(changed);
      expect(() => loadRoutinePaidPollConfig(enabled, dependencies)).toThrow();
    }
  });
});
