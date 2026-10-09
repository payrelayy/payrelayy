import { constants } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { ROUTINE_NO_MONEY_CA_FILE } from './routine-no-money-config.js';
import {
  ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE,
  loadRoutinePaidSettlementConfig,
} from './routine-paid-settlement-config.js';
import type {
  TelebirrAssignmentBrokerConfigDependencies,
  TelebirrAssignmentBrokerGuardedFileStat,
} from './telebirr-assignment-broker-config.js';

const role = 'fetanagent_routine_telebirr_paid_settlement_runtime';
const url = `postgresql://${role}.xzztugbgtulptnbpoelr:synthetic-password-123456@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
const ca = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(62)}==\n-----END CERTIFICATE-----\n`;
const enabled: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'live',
  INTERNAL_ROUTINE_PAID_SETTLEMENT_WORKER_ENABLED: 'true',
  ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE,
};

function fixture(databaseUrl = url) {
  const values: Record<string, string> = {
    [ROUTINE_NO_MONEY_CA_FILE]: ca,
    [ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE]: databaseUrl,
  };
  const bytesFor = (path: string) => Buffer.from(values[path] ?? '', 'utf8');
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
        read: vi.fn(() => bytesFor(path)),
        stat: vi.fn(() => statFor(path)),
      };
    }),
  };
  const dependencies: TelebirrAssignmentBrokerConfigDependencies = {
    effectiveUserId: 10001,
    fileSystem,
    platform: 'linux',
  };
  return { dependencies, fileSystem };
}

describe('isolated paid settlement configuration', () => {
  it('opens no credential when the exact worker flag or live mode is absent', () => {
    for (const change of [
      { INTERNAL_ROUTINE_PAID_SETTLEMENT_WORKER_ENABLED: 'false' },
      { FINANCIAL_ACTIONS_MODE: 'dry_run' },
      { ROUTINE_PAID_SETTLEMENT_DATABASE_URL_FILE: '/tmp/other' },
      { NODE_ENV: 'development' },
      { ROUTINE_PAID_SETTLEMENT_DATABASE_URL: url },
    ]) {
      const { dependencies, fileSystem } = fixture();
      expect(() =>
        loadRoutinePaidSettlementConfig({ ...enabled, ...change }, dependencies),
      ).toThrow();
      expect(fileSystem.open).not.toHaveBeenCalled();
    }
  });

  it('loads only the private settlement login over exact verified TLS', () => {
    const { dependencies, fileSystem } = fixture();
    expect(loadRoutinePaidSettlementConfig(enabled, dependencies)).toMatchObject({
      target: 'production',
      host: 'aws-0-eu-west-1.pooler.supabase.com',
      user: `${role}.xzztugbgtulptnbpoelr`,
      database: 'postgres',
    });
    expect(fileSystem.open).toHaveBeenCalledTimes(2);
  });

  it('rejects a phone-poll credential or weaker TLS', () => {
    for (const badUrl of [
      url.replace(role, 'fetanagent_routine_telebirr_paid_poll_runtime'),
      url.replace('verify-full', 'require'),
    ]) {
      const { dependencies } = fixture(badUrl);
      expect(() => loadRoutinePaidSettlementConfig(enabled, dependencies)).toThrow();
    }
  });
});
