import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE,
  TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE,
  loadTelebirrDeviceStateBrokerConfig,
  redactedTelebirrDeviceStateBrokerConfigForLog,
  type TelebirrDeviceStateBrokerGuardedFileStat,
} from './telebirr-device-state-broker-config.js';

const directDatabaseUrl =
  'postgresql://fetanagent_telebirr_device_state_runtime:synthetic-password-123456@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full';
const databaseUrl =
  'postgresql://fetanagent_telebirr_device_state_runtime.spzpiyxheappsfyswewl:synthetic-password-123456@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const ca = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(62)}==\n-----END CERTIFICATE-----\n`;
const enabledEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  INTERNAL_TELEBIRR_DEVICE_STATE_BROKER_ENABLED: 'true',
  TELEBIRR_DEVICE_STATE_BROKER_NO_MONEY_PILOT_ENABLED: 'true',
  TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET: 'staging',
  TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE: TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE,
  NODE_EXTRA_CA_CERTS: TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE,
};

interface FileOverrides {
  readonly before?: Partial<TelebirrDeviceStateBrokerGuardedFileStat>;
  readonly opened?: Partial<TelebirrDeviceStateBrokerGuardedFileStat>;
  readonly after?: Partial<TelebirrDeviceStateBrokerGuardedFileStat>;
  readonly realpath?: string;
}

function guardedDependencies(
  values: Readonly<Record<string, string | Buffer>> = {
    [TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE]: databaseUrl,
    [TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE]: ca,
  },
  target?: string,
  overrides: FileOverrides = {},
  effectiveUserId = 10_001,
) {
  const bytesFor = (path: string): Buffer => {
    const value = values[path];
    if (value === undefined) throw new Error('missing synthetic file');
    return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
  };
  const statFor = (
    path: string,
    override: Partial<TelebirrDeviceStateBrokerGuardedFileStat> = {},
  ): TelebirrDeviceStateBrokerGuardedFileStat => {
    const bytes = bytesFor(path);
    const result = {
      dev: 7,
      ino: path.length,
      mode: path === TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE ? 0o100444 : 0o100400,
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
  return { effectiveUserId, fileSystem, platform: 'linux' as const, returnedBuffers };
}

describe('private TeleBirr device-state broker configuration', () => {
  it('is disabled by default without reading any file', () => {
    const dependencies = guardedDependencies();
    expect(loadTelebirrDeviceStateBrokerConfig({}, dependencies)).toEqual({ enabled: false });
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
  });

  it('loads only the fixed guarded database URL and CA', () => {
    const dependencies = guardedDependencies();
    const config = loadTelebirrDeviceStateBrokerConfig(enabledEnvironment, dependencies);
    expect(config).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      projectReference: 'spzpiyxheappsfyswewl',
      connection: {
        ca,
        database: 'postgres',
        host: 'aws-1-eu-west-1.pooler.supabase.com',
        password: 'synthetic-password-123456',
        port: 5432,
        user: 'fetanagent_telebirr_device_state_runtime.spzpiyxheappsfyswewl',
      },
    });
    expect(dependencies.fileSystem.lstat).toHaveBeenCalledTimes(2);
    for (const path of [
      TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE,
      TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE,
    ]) {
      expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
    }
    expect(dependencies.returnedBuffers).toHaveLength(2);
    expect(dependencies.returnedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(
      true,
    );
  });

  it('also accepts only the exact staging direct route and bare runtime role', () => {
    const config = loadTelebirrDeviceStateBrokerConfig(
      enabledEnvironment,
      guardedDependencies({
        [TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE]: directDatabaseUrl,
        [TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE]: ca,
      }),
    );
    expect(config).toMatchObject({
      enabled: true,
      connection: {
        host: 'db.spzpiyxheappsfyswewl.supabase.co',
        user: 'fetanagent_telebirr_device_state_runtime',
      },
    });
  });

  it.each([
    ['non-production', { NODE_ENV: 'test' }],
    ['live financial mode', { FINANCIAL_ACTIONS_MODE: 'live' }],
    ['missing no-money gate', { TELEBIRR_DEVICE_STATE_BROKER_NO_MONEY_PILOT_ENABLED: 'false' }],
    ['wrong deployment target', { TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET: 'production' }],
    ['wrong CA path', { NODE_EXTRA_CA_CERTS: '/tmp/ca' }],
    ['wrong database path', { TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE: '/tmp/database' }],
  ])('rejects the enabled runtime with %s', (_name, override) => {
    expect(() =>
      loadTelebirrDeviceStateBrokerConfig(
        { ...enabledEnvironment, ...(override as NodeJS.ProcessEnv) },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
  ])('rejects forbidden inline or broader-authority secret environment %s', (name) => {
    expect(() =>
      loadTelebirrDeviceStateBrokerConfig(
        { ...enabledEnvironment, [name]: 'must-not-be-in-this-runtime' },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    ['wrong role', databaseUrl.replace('fetanagent_telebirr_device_state_runtime', 'postgres')],
    ['wrong host', databaseUrl.replace('aws-1-eu-west-1.pooler.supabase.com', 'localhost')],
    [
      'bare role on the session pooler',
      databaseUrl.replace(
        'fetanagent_telebirr_device_state_runtime.spzpiyxheappsfyswewl',
        'fetanagent_telebirr_device_state_runtime',
      ),
    ],
    [
      'project-suffixed role on the direct route',
      directDatabaseUrl.replace(
        'fetanagent_telebirr_device_state_runtime:',
        'fetanagent_telebirr_device_state_runtime.spzpiyxheappsfyswewl:',
      ),
    ],
    ['transaction pooler port', databaseUrl.replace(':5432/', ':6543/')],
    ['wrong TLS mode', databaseUrl.replace('verify-full', 'require')],
    ['extra query', `${databaseUrl}&application_name=other`],
    ['short password', databaseUrl.replace('synthetic-password-123456', 'short')],
    ['trailing newline', `${databaseUrl}\n`],
  ])('rejects a database URL with %s', (_name, value) => {
    expect(() =>
      loadTelebirrDeviceStateBrokerConfig(
        enabledEnvironment,
        guardedDependencies({
          [TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE]: value,
          [TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE]: ca,
        }),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    [
      'padding before the final data line',
      `-----BEGIN CERTIFICATE-----\nQQ==\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`,
    ],
    ['an extra trailing blank line', `${ca}\n`],
  ])('rejects a CA certificate with %s', (_name, value) => {
    expect(() =>
      loadTelebirrDeviceStateBrokerConfig(
        enabledEnvironment,
        guardedDependencies({
          [TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE]: databaseUrl,
          [TELEBIRR_DEVICE_STATE_BROKER_SUPABASE_CA_FILE]: value,
        }),
      ),
    ).toThrow('configuration is unavailable');
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
      loadTelebirrDeviceStateBrokerConfig(
        enabledEnvironment,
        guardedDependencies(
          undefined,
          TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE,
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
      expect(() => loadTelebirrDeviceStateBrokerConfig(enabledEnvironment, dependencies)).toThrow(
        'configuration is unavailable',
      );
      expect(dependencies.fileSystem.open).not.toHaveBeenCalled();
    }
  });

  it('exposes only fixed-key zero-secret diagnostics and no calendar shutdown', async () => {
    const config = loadTelebirrDeviceStateBrokerConfig(enabledEnvironment, guardedDependencies());
    const projection = redactedTelebirrDeviceStateBrokerConfigForLog(config);
    expect(projection).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      connectionConfigured: true,
    });
    expect(JSON.stringify(projection)).not.toContain('synthetic-password');

    const source = await readFile(
      new URL('./telebirr-device-state-broker-config.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/2026-09-04|expiresAt|shutdownAt|stopAt/u);
    expect(source).toContain('rejectInlineOrRootSecrets(environment)');
  });
});
