import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE,
  COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
  COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE,
  COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE,
  loadCompanionDeviceBridgeConfig,
  redactedCompanionDeviceBridgeConfigForLog,
  type CompanionDeviceBridgeGuardedFileStat,
} from './config.js';

const directDatabaseUrl =
  'postgresql://fetanagent_companion_device_bridge_runtime:synthetic-password-123456@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full';
const databaseUrl =
  'postgresql://fetanagent_companion_device_bridge_runtime.spzpiyxheappsfyswewl:synthetic-password-123456@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const ca = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`;
const paddedCa = '-----BEGIN CERTIFICATE-----\nAQ==\n-----END CERTIFICATE-----\n';
const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateKey = Buffer.from(keyPair.privateKey.export({ format: 'der', type: 'pkcs8' }));
const publicKey = Buffer.from(keyPair.publicKey.export({ format: 'der', type: 'spki' }));
const publicKeyDigest = `sha256:${createHash('sha256').update(publicKey).digest('hex')}`;
const manifest = JSON.stringify({
  contractVersion: 2,
  deploymentTarget: 'staging',
  pairingAllowed: true,
  exactFiveReadOnlyLookupAllowed: true,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  serverSignerId: '11111111-1111-4111-8111-111111111111',
  serverSignerKeyId: 'companion_server_signer_2026_01',
  serverSignerPublicKeySpkiSha256: publicKeyDigest,
});

const enabledEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  INTERNAL_COMPANION_DEVICE_BRIDGE_ENABLED: 'true',
  COMPANION_DEVICE_BRIDGE_NO_MONEY_READ_ONLY_LOOKUP_ENABLED: 'true',
  COMPANION_DEVICE_BRIDGE_DEPLOYMENT_TARGET: 'staging',
  COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE,
  COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
  COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE,
  NODE_EXTRA_CA_CERTS: COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE,
};

interface FileOverrides {
  readonly before?: Partial<CompanionDeviceBridgeGuardedFileStat>;
  readonly opened?: Partial<CompanionDeviceBridgeGuardedFileStat>;
  readonly after?: Partial<CompanionDeviceBridgeGuardedFileStat>;
  readonly realpath?: string;
}

function guardedDependencies(
  values: Readonly<Record<string, string | Buffer>> = {
    [COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE]: databaseUrl,
    [COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: manifest,
    [COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE]: privateKey,
    [COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE]: ca,
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
    override: Partial<CompanionDeviceBridgeGuardedFileStat> = {},
  ): CompanionDeviceBridgeGuardedFileStat => {
    const bytes = bytesFor(path);
    const publicConfig =
      path === COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE ||
      path === COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE;
    const result = {
      dev: 7,
      ino: path.length,
      mode: publicConfig ? 0o100444 : 0o100400,
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

describe('companion device bridge configuration', () => {
  it('is disabled by default without reading a file', () => {
    const dependencies = guardedDependencies();
    expect(loadCompanionDeviceBridgeConfig({}, dependencies)).toEqual({ enabled: false });
    expect(dependencies.fileSystem.open).not.toHaveBeenCalled();
  });

  it('loads only fixed guarded files and derives the public signer from a canonical P-256 key', async () => {
    const dependencies = guardedDependencies();
    const config = loadCompanionDeviceBridgeConfig(enabledEnvironment, dependencies);
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error('expected enabled config');
    expect(config.connection).toMatchObject({
      database: 'postgres',
      host: 'aws-1-eu-west-1.pooler.supabase.com',
      password: 'synthetic-password-123456',
      port: 5432,
      user: 'fetanagent_companion_device_bridge_runtime.spzpiyxheappsfyswewl',
      ca,
    });
    expect(config.serverSignerId).toBe('11111111-1111-4111-8111-111111111111');
    expect(config.signer.keyId).toBe('companion_server_signer_2026_01');
    expect(Buffer.from(config.signer.publicKeySpkiDer)).toEqual(publicKey);
    const transcript = Buffer.from('bounded-companion-pairing-transcript', 'utf8');
    const signature = await config.signer.signP1363(transcript);
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    expect(
      verify(
        'sha256',
        transcript,
        {
          key: keyPair.publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);

    expect(dependencies.fileSystem.lstat).toHaveBeenCalledTimes(4);
    for (const path of [
      COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE,
      COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
      COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE,
      COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE,
    ]) {
      expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
    }
    expect(dependencies.returnedBuffers).toHaveLength(4);
    expect(dependencies.returnedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(
      true,
    );
  });

  it('also accepts only the exact staging direct route and bare runtime role', () => {
    const config = loadCompanionDeviceBridgeConfig(
      enabledEnvironment,
      guardedDependencies({
        [COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE]: directDatabaseUrl,
        [COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: manifest,
        [COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE]: privateKey,
        [COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE]: ca,
      }),
    );
    expect(config).toMatchObject({
      enabled: true,
      connection: {
        host: 'db.spzpiyxheappsfyswewl.supabase.co',
        user: 'fetanagent_companion_device_bridge_runtime',
      },
    });
  });

  it.each([
    ['non-production', { NODE_ENV: 'test' }],
    ['live financial mode', { FINANCIAL_ACTIONS_MODE: 'live' }],
    [
      'missing no-money lookup gate',
      { COMPANION_DEVICE_BRIDGE_NO_MONEY_READ_ONLY_LOOKUP_ENABLED: 'false' },
    ],
    ['wrong target', { COMPANION_DEVICE_BRIDGE_DEPLOYMENT_TARGET: 'production' }],
    ['wrong CA path', { NODE_EXTRA_CA_CERTS: '/tmp/ca' }],
    ['wrong database file', { COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE: '/tmp/database' }],
    ['wrong signer file', { COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE: '/tmp/key' }],
    ['wrong manifest file', { COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE: '/tmp/manifest' }],
  ])('rejects enabled runtime with %s', (_name, override) => {
    expect(() =>
      loadCompanionDeviceBridgeConfig(
        { ...enabledEnvironment, ...(override as NodeJS.ProcessEnv) },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'COMPANION_DEVICE_BRIDGE_DATABASE_URL',
    'COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY',
    'OWNER_CONTROL_DATABASE_URL_FILE',
    'KEMERBET_EXECUTOR_DATABASE_URL_FILE',
  ])('rejects broader or inline secret %s', (name) => {
    expect(() =>
      loadCompanionDeviceBridgeConfig(
        { ...enabledEnvironment, [name]: 'must-not-enter-this-runtime' },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    ['wrong role', databaseUrl.replace('fetanagent_companion_device_bridge_runtime', 'postgres')],
    ['wrong host', databaseUrl.replace('aws-1-eu-west-1.pooler.supabase.com', 'localhost')],
    [
      'bare role on the session pooler',
      databaseUrl.replace(
        'fetanagent_companion_device_bridge_runtime.spzpiyxheappsfyswewl',
        'fetanagent_companion_device_bridge_runtime',
      ),
    ],
    [
      'project-suffixed role on the direct route',
      directDatabaseUrl.replace(
        'fetanagent_companion_device_bridge_runtime:',
        'fetanagent_companion_device_bridge_runtime.spzpiyxheappsfyswewl:',
      ),
    ],
    ['transaction pooler port', databaseUrl.replace(':5432/', ':6543/')],
    ['wrong TLS', databaseUrl.replace('verify-full', 'require')],
    ['extra query', `${databaseUrl}&application_name=other`],
    ['short password', databaseUrl.replace('synthetic-password-123456', 'short')],
    ['newline', `${databaseUrl}\n`],
  ])('rejects database URL with %s', (_name, value) => {
    expect(() =>
      loadCompanionDeviceBridgeConfig(
        enabledEnvironment,
        guardedDependencies({
          [COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE]: value,
          [COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: manifest,
          [COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE]: privateKey,
          [COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE]: ca,
        }),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    ['standard Base64 padding', paddedCa],
    ['no terminal newline', paddedCa.slice(0, -1)],
    ['an exact certificate chain', `${ca}${paddedCa}`],
  ])('accepts canonical CA PEM with %s', (_name, value) => {
    const config = loadCompanionDeviceBridgeConfig(
      enabledEnvironment,
      guardedDependencies({
        [COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE]: databaseUrl,
        [COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: manifest,
        [COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE]: privateKey,
        [COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE]: value,
      }),
    );
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error('expected enabled config');
    expect(config.connection.ca).toBe(value);
  });

  it.each([
    ['noncanonical padding', paddedCa.replace('AQ==', 'AQ=')],
    ['a carriage return', paddedCa.replaceAll('\n', '\r\n')],
    ['a blank chain separator', `${ca}\n${paddedCa}`],
    ['trailing text', `${paddedCa}unexpected`],
  ])('rejects CA PEM with %s', (_name, value) => {
    expect(() =>
      loadCompanionDeviceBridgeConfig(
        enabledEnvironment,
        guardedDependencies({
          [COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE]: databaseUrl,
          [COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: manifest,
          [COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE]: privateKey,
          [COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE]: value,
        }),
      ),
    ).toThrow('configuration is unavailable');
  });

  it('rejects a private key that does not match the public manifest digest', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const otherKey = Buffer.from(other.privateKey.export({ format: 'der', type: 'pkcs8' }));
    expect(() =>
      loadCompanionDeviceBridgeConfig(
        enabledEnvironment,
        guardedDependencies({
          [COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE]: databaseUrl,
          [COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: manifest,
          [COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE]: otherKey,
          [COMPANION_DEVICE_BRIDGE_SUPABASE_CA_FILE]: ca,
        }),
      ),
    ).toThrow('configuration is unavailable');
    otherKey.fill(0);
  });

  it.each([
    ['symbolic link', { before: { isSymbolicLink: () => true } }],
    ['writable secret', { before: { mode: 0o100600 } }],
    ['foreign owner', { before: { uid: 20_002 } }],
    ['path substitution', { realpath: '/tmp/substitution' }],
    ['inode swap', { opened: { ino: 999 } }],
    ['size change', { after: { size: 1 } }],
  ])('rejects guarded-file %s', (_name, overrides) => {
    expect(() =>
      loadCompanionDeviceBridgeConfig(
        enabledEnvironment,
        guardedDependencies(
          undefined,
          COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE,
          overrides as FileOverrides,
        ),
      ),
    ).toThrow('configuration is unavailable');
  });

  it('projects zero secrets and contains no calendar shutdown', async () => {
    const config = loadCompanionDeviceBridgeConfig(enabledEnvironment, guardedDependencies());
    const projection = redactedCompanionDeviceBridgeConfigForLog(config);
    expect(projection).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      connectionConfigured: true,
      signerConfigured: true,
      pairingAllowed: true,
      exactFiveReadOnlyLookupAllowed: true,
      financialActionAllowed: false,
      moneyMovementAllowed: false,
    });
    expect(JSON.stringify(projection)).not.toContain('synthetic-password');
    expect(JSON.stringify(projection)).not.toContain('companion_server_signer_2026_01');
    const source = await readFile(new URL('./config.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/shutdownAt|stopAt|2026-09-04/u);
  });
});
