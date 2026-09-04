import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE,
  TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
  TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE,
  loadTelebirrDeviceBridgeConfig,
  redactedTelebirrDeviceBridgeConfigForLog,
  type TelebirrDeviceBridgeGuardedFileStat,
} from './telebirr-device-bridge-config.js';
import {
  TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
  TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT,
} from './telebirr-device-bridge-server.js';

interface KeyFixture {
  readonly serverPrivateKey: Buffer;
  readonly serverPublicKey: Buffer;
  readonly serverPublicKeyDigest: string;
  readonly assignmentPublicKey: Buffer;
  readonly assignmentPublicKeyDigest: string;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function keys(): KeyFixture {
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const assignment = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serverPrivateKey = Buffer.from(server.privateKey.export({ format: 'der', type: 'pkcs8' }));
  const serverPublicKey = Buffer.from(server.publicKey.export({ format: 'der', type: 'spki' }));
  const assignmentPublicKey = Buffer.from(
    assignment.publicKey.export({ format: 'der', type: 'spki' }),
  );
  return {
    serverPrivateKey,
    serverPublicKey,
    serverPublicKeyDigest: sha256(serverPublicKey),
    assignmentPublicKey,
    assignmentPublicKeyDigest: sha256(assignmentPublicKey),
  };
}

function manifest(fixture: KeyFixture, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    contractVersion: 1,
    providerCode: 'telebirr',
    serverSignerKeyId: 'bridge-server-key-0001',
    serverSigningPublicKeySpkiSha256: fixture.serverPublicKeyDigest,
    assignmentSigningPublicKeySpkiSha256: fixture.assignmentPublicKeyDigest,
    ...extra,
  });
}

function fileValues(fixture = keys()): Readonly<Record<string, string | Buffer>> {
  return {
    [TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE]: fixture.serverPrivateKey,
    [TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE]: fixture.assignmentPublicKey,
    [TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: manifest(fixture),
  };
}

const enabledEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  INTERNAL_TELEBIRR_DEVICE_BRIDGE_ENABLED: 'true',
  TELEBIRR_DEVICE_BRIDGE_NO_MONEY_PILOT_ENABLED: 'true',
  TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET: 'staging',
  TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST,
  TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT: String(TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT),
  TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE,
  TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE,
  TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
};

interface FileOverrides {
  readonly before?: Partial<TelebirrDeviceBridgeGuardedFileStat>;
  readonly opened?: Partial<TelebirrDeviceBridgeGuardedFileStat>;
  readonly after?: Partial<TelebirrDeviceBridgeGuardedFileStat>;
  readonly realpath?: string;
}

function guardedDependencies(
  values: Readonly<Record<string, string | Buffer>> = fileValues(),
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
    override: Partial<TelebirrDeviceBridgeGuardedFileStat> = {},
  ): TelebirrDeviceBridgeGuardedFileStat => {
    const bytes = bytesFor(path);
    const result = {
      dev: 7,
      ino: path.length,
      mode: path === TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE ? 0o100400 : 0o100444,
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

describe('TeleBirr device bridge guarded configuration', () => {
  it('is disabled by default without reading any file', () => {
    const dependencies = guardedDependencies();
    expect(loadTelebirrDeviceBridgeConfig({}, dependencies)).toEqual({ enabled: false });
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
  });

  it('loads exactly one server private key, one assignment public key, and their manifest', async () => {
    const fixture = keys();
    const dependencies = guardedDependencies(fileValues(fixture));
    const config = loadTelebirrDeviceBridgeConfig(enabledEnvironment, dependencies);
    expect(config).toMatchObject({
      enabled: true,
      deploymentTarget: 'staging',
      host: '0.0.0.0',
      port: 8084,
      serverSigner: { keyId: 'bridge-server-key-0001' },
    });
    if (!config.enabled) throw new Error('expected enabled synthetic config');
    expect(Buffer.from(config.serverSigningPublicKeySpkiDer)).toEqual(fixture.serverPublicKey);
    expect(Buffer.from(config.assignmentSigningPublicKeySpkiDer)).toEqual(
      fixture.assignmentPublicKey,
    );
    const transcript = Buffer.from('synthetic bridge signing transcript', 'utf8');
    const signature = Buffer.from(await config.serverSigner.signP1363(transcript), 'base64url');
    expect(
      verify(
        'sha256',
        transcript,
        {
          key: fixture.serverPublicKey,
          format: 'der',
          type: 'spki',
          dsaEncoding: 'ieee-p1363',
        },
        signature,
      ),
    ).toBe(true);
    signature.fill(0);
    expect(dependencies.fileSystem.lstat).toHaveBeenCalledTimes(3);
    for (const path of [
      TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE,
      TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE,
      TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE,
    ]) {
      expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
    }
    expect(dependencies.returnedBuffers).toHaveLength(3);
    expect(dependencies.returnedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(
      true,
    );
  });

  it.each([
    ['non-production', { NODE_ENV: 'test' }],
    ['live financial mode', { FINANCIAL_ACTIONS_MODE: 'live' }],
    ['missing no-money gate', { TELEBIRR_DEVICE_BRIDGE_NO_MONEY_PILOT_ENABLED: 'false' }],
    ['wrong target', { TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET: 'production' }],
    ['wrong host', { TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST: '127.0.0.1' }],
    ['wrong port', { TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT: '443' }],
    [
      'wrong server key path',
      { TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE: '/tmp/key' },
    ],
  ])('rejects the enabled runtime with %s', (_name, override) => {
    expect(() =>
      loadTelebirrDeviceBridgeConfig(
        { ...enabledEnvironment, ...(override as NodeJS.ProcessEnv) },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it.each([
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE',
    'TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE',
    'TELEBIRR_ASSIGNMENT_BROKER_SIGNER_PRIVATE_KEY_FILE',
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
    'TELEGRAM_BOT_TOKEN',
    'HTTPS_PROXY',
  ])('rejects broader authority or outbound proxy environment %s', (name) => {
    expect(() =>
      loadTelebirrDeviceBridgeConfig(
        { ...enabledEnvironment, [name]: 'must-not-be-in-this-runtime' },
        guardedDependencies(),
      ),
    ).toThrow('configuration is unavailable');
  });

  it('binds both public keys and the server key id to canonical manifest bytes', () => {
    const fixture = keys();
    const base = fileValues(fixture);
    for (const candidate of [
      manifest({ ...fixture, serverPublicKeyDigest: `sha256:${'1'.repeat(64)}` }),
      manifest({ ...fixture, assignmentPublicKeyDigest: `sha256:${'2'.repeat(64)}` }),
      ` ${manifest(fixture)}`,
      manifest(fixture, { unexpected: true }),
      manifest(fixture).replace('bridge-server-key-0001', 'short'),
    ]) {
      expect(() =>
        loadTelebirrDeviceBridgeConfig(
          enabledEnvironment,
          guardedDependencies({
            ...base,
            [TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE]: candidate,
          }),
        ),
      ).toThrow('configuration is unavailable');
    }
  });

  it('rejects malformed, non-P-256, non-canonical, and mismatched key material', () => {
    const fixture = keys();
    const wrongCurve = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const wrongPrivate = Buffer.from(
      wrongCurve.privateKey.export({ format: 'der', type: 'pkcs8' }),
    );
    const wrongPublic = Buffer.from(wrongCurve.publicKey.export({ format: 'der', type: 'spki' }));
    const another = keys();
    for (const values of [
      {
        ...fileValues(fixture),
        [TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE]: Buffer.from('not-a-key'),
      },
      {
        ...fileValues(fixture),
        [TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE]: wrongPrivate,
      },
      {
        ...fileValues(fixture),
        [TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE]: another.serverPrivateKey,
      },
      {
        ...fileValues(fixture),
        [TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE]: wrongPublic,
      },
      {
        ...fileValues(fixture),
        [TELEBIRR_DEVICE_BRIDGE_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE]: Buffer.concat([
          fixture.assignmentPublicKey,
          Buffer.from([0]),
        ]),
      },
    ]) {
      expect(() =>
        loadTelebirrDeviceBridgeConfig(enabledEnvironment, guardedDependencies(values)),
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
      loadTelebirrDeviceBridgeConfig(
        enabledEnvironment,
        guardedDependencies(
          undefined,
          TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE,
          overrides as FileOverrides,
        ),
      ),
    ).toThrow('configuration is unavailable');
  });

  it('rejects non-Linux and root execution before opening key material', () => {
    for (const dependencies of [
      { ...guardedDependencies(), platform: 'win32' as const },
      guardedDependencies(undefined, undefined, undefined, 0),
    ]) {
      expect(() => loadTelebirrDeviceBridgeConfig(enabledEnvironment, dependencies)).toThrow(
        'configuration is unavailable',
      );
      expect(dependencies.fileSystem.open).not.toHaveBeenCalled();
    }
  });

  it('exposes only fixed-key diagnostics and has no calendar stop', async () => {
    const config = loadTelebirrDeviceBridgeConfig(enabledEnvironment, guardedDependencies());
    expect(redactedTelebirrDeviceBridgeConfigForLog(config)).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      serverSignerConfigured: true,
      assignmentSignerPublicKeyConfigured: true,
    });
    const source = await readFile(
      new URL('./telebirr-device-bridge-config.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/2026-09-04|expiresAt|shutdownAt|stopAt/u);
    expect(source).toContain('rejectBroaderAuthority(environment)');
    expect(source).not.toMatch(/from ['"]pg['"]/u);
  });
});
