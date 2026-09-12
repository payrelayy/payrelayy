import { generateKeyPairSync } from 'node:crypto';
import { constants } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_SHADOW_VERIFIER_DATABASE_URL_FILE,
  TELEBIRR_SHADOW_VERIFIER_PIN_MANIFEST_FILE,
  TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE,
  TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE,
  TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE,
  loadTelebirrShadowVerifierConfig,
  loadTrustedTelebirrVerifierConfig,
  type TrustedTelebirrVerifierConfigDependencies,
  type TrustedTelebirrVerifierGuardedFileStat,
} from './trusted-telebirr-verifier-config.js';

const databaseUrl =
  'postgresql://fetanagent_trusted_telebirr_verifier_runtime:synthetic-password-123456@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full';
const productionDatabaseUrl =
  'postgresql://fetanagent_trusted_telebirr_verifier_runtime:synthetic-password-123456@db.xzztugbgtulptnbpoelr.supabase.co:5432/postgres?sslmode=verify-full';
const shadowDatabaseUrl =
  'postgresql://fetanagent_telebirr_shadow_verifier_runtime:synthetic-password-123456@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full';
const caCertificate = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`;
const paddedCaCertificate = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n${'A'.repeat(11)}=\n-----END CERTIFICATE-----\n`;

function publicKeySpki(namedCurve: string): Buffer {
  return Buffer.from(
    generateKeyPairSync('ec', { namedCurve }).publicKey.export({ format: 'der', type: 'spki' }),
  );
}

const assignmentSpki = publicKeySpki('prime256v1');
const deviceSpki = publicKeySpki('prime256v1');

function manifest(
  assignmentKeyId = 'assignment-key-0001',
  deviceKeyId = 'device-key-0000001',
  assignmentBytes = assignmentSpki,
  deviceBytes = deviceSpki,
): string {
  return JSON.stringify({
    contractVersion: 1,
    assignmentSigners: [
      { keyId: assignmentKeyId, publicKeySpkiDerBase64: assignmentBytes.toString('base64') },
    ],
    devices: [{ keyId: deviceKeyId, publicKeySpkiDerBase64: deviceBytes.toString('base64') }],
  });
}

const enabledEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'live',
  INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED: 'true',
  TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: 'true',
  TRUSTED_TELEBIRR_VERIFIER_DEPLOYMENT_TARGET: 'staging',
  TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE: TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE,
  TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE: TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE,
  NODE_EXTRA_CA_CERTS: TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE,
};

interface FileOverrides {
  readonly after?: Partial<TrustedTelebirrVerifierGuardedFileStat>;
  readonly before?: Partial<TrustedTelebirrVerifierGuardedFileStat>;
  readonly opened?: Partial<TrustedTelebirrVerifierGuardedFileStat>;
  readonly realpath?: string;
}

function guardedDependencies(
  values: Readonly<Record<string, string>> = {
    [TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE]: databaseUrl,
    [TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE]: manifest(),
    [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: caCertificate,
  },
  target = TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE,
  overrides: FileOverrides = {},
  effectiveUserId = 1_000,
): TrustedTelebirrVerifierConfigDependencies & {
  readonly fileSystem: NonNullable<TrustedTelebirrVerifierConfigDependencies['fileSystem']>;
} {
  const statFor = (
    path: string,
    override: Partial<TrustedTelebirrVerifierGuardedFileStat> = {},
  ): TrustedTelebirrVerifierGuardedFileStat => {
    const value = values[path];
    if (value === undefined) throw new Error('missing synthetic file');
    const secret =
      path === TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE ||
      path === TELEBIRR_SHADOW_VERIFIER_DATABASE_URL_FILE;
    return {
      dev: 7,
      ino: secret ? 11 : path.length,
      mode: secret ? 0o100400 : 0o100444,
      mtimeMs: 1_700_000_000_000,
      size: Buffer.byteLength(value),
      uid: 0,
      isFile: () => true,
      isSymbolicLink: () => false,
      ...override,
    };
  };
  const fileSystem = {
    lstat: vi.fn((path: string) => statFor(path, path === target ? overrides.before : {})),
    realpath: vi.fn((path: string) =>
      path === target && overrides.realpath !== undefined ? overrides.realpath : path,
    ),
    open: vi.fn((path: string, _flags: number) => {
      let stats = 0;
      return {
        close: vi.fn(),
        read: vi.fn(() => Buffer.from(values[path] ?? '', 'utf8')),
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
  return { effectiveUserId, fileSystem, platform: 'linux' };
}

describe('trusted TeleBirr verifier configuration', () => {
  it('is disabled by default without touching any file', () => {
    const dependencies = guardedDependencies();
    expect(loadTrustedTelebirrVerifierConfig({}, dependencies)).toEqual({ enabled: false });
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
  });

  it('loads only the fixed target role, pins, and CA through O_NOFOLLOW descriptors', () => {
    const dependencies = guardedDependencies();
    const config = loadTrustedTelebirrVerifierConfig(enabledEnvironment, dependencies);
    expect(config).toMatchObject({
      enabled: true,
      deploymentTarget: 'staging',
      connection: {
        ca: caCertificate,
        database: 'postgres',
        user: 'fetanagent_trusted_telebirr_verifier_runtime',
        port: 5432,
      },
    });
    expect(dependencies.fileSystem.lstat).toHaveBeenCalledTimes(3);
    expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
      TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
      TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    expect(dependencies.fileSystem.open).toHaveBeenCalledWith(
      TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  });

  it.each([
    ['standard Base64 padding', paddedCaCertificate],
    ['no terminal newline', paddedCaCertificate.slice(0, -1)],
    ['an exact certificate chain', `${caCertificate}${paddedCaCertificate}`],
  ])('accepts canonical CA PEM with %s', (_name, ca) => {
    const config = loadTrustedTelebirrVerifierConfig(
      enabledEnvironment,
      guardedDependencies({
        [TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE]: databaseUrl,
        [TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE]: manifest(),
        [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: ca,
      }),
    );
    expect(config).toMatchObject({ enabled: true, connection: { ca } });
  });

  it.each([
    ['noncanonical padding', paddedCaCertificate.replace(`${'A'.repeat(11)}=`, 'AQ=')],
    [
      'padding before the final payload line',
      paddedCaCertificate.replace(`${'A'.repeat(64)}\n`, 'AQ==\n'),
    ],
    ['a carriage return', paddedCaCertificate.replaceAll('\n', '\r\n')],
    ['a blank chain separator', `${caCertificate}\n${paddedCaCertificate}`],
    ['trailing text', `${paddedCaCertificate}unexpected`],
  ])('rejects CA PEM with %s', (_name, ca) => {
    expect(() =>
      loadTrustedTelebirrVerifierConfig(
        enabledEnvironment,
        guardedDependencies({
          [TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE]: databaseUrl,
          [TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE]: manifest(),
          [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: ca,
        }),
      ),
    ).toThrow('The trusted TeleBirr verifier configuration is unavailable.');
  });

  it('accepts the exact production database target and rejects cross-target URLs', () => {
    const productionEnvironment = {
      ...enabledEnvironment,
      TRUSTED_TELEBIRR_VERIFIER_DEPLOYMENT_TARGET: 'production',
    };
    const productionValues = {
      [TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE]: productionDatabaseUrl,
      [TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE]: manifest(),
      [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: caCertificate,
    };
    expect(
      loadTrustedTelebirrVerifierConfig(
        productionEnvironment,
        guardedDependencies(productionValues),
      ),
    ).toMatchObject({
      enabled: true,
      deploymentTarget: 'production',
      projectReference: 'xzztugbgtulptnbpoelr',
      connection: {
        host: 'db.xzztugbgtulptnbpoelr.supabase.co',
        user: 'fetanagent_trusted_telebirr_verifier_runtime',
      },
    });
    expect(() =>
      loadTrustedTelebirrVerifierConfig(productionEnvironment, guardedDependencies()),
    ).toThrow('configuration is unavailable');
    expect(() =>
      loadTrustedTelebirrVerifierConfig(enabledEnvironment, guardedDependencies(productionValues)),
    ).toThrow('configuration is unavailable');
  });

  it('requires a root/effective-user-owned owner-readable-only database secret', () => {
    for (const uid of [0, 1_000]) {
      expect(() =>
        loadTrustedTelebirrVerifierConfig(
          enabledEnvironment,
          guardedDependencies(undefined, TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE, {
            before: { uid, mode: 0o100400 },
            opened: { uid, mode: 0o100400 },
            after: { uid, mode: 0o100400 },
          }),
        ),
      ).not.toThrow();
    }
    for (const unsafe of [
      { uid: 2_000 },
      { mode: 0o100444 },
      { mode: 0o100644 },
      { mode: 0o100200 },
    ]) {
      expect(() =>
        loadTrustedTelebirrVerifierConfig(
          enabledEnvironment,
          guardedDependencies(undefined, TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE, {
            before: unsafe,
          }),
        ),
      ).toThrow('The trusted TeleBirr verifier configuration is unavailable.');
    }
  });

  it('rejects symlinks, aliases, and inode/device/mtime/size races', () => {
    for (const overrides of [
      { before: { isFile: () => false, isSymbolicLink: () => true } },
      { realpath: '/run/secrets/repointed_database_url' },
      { opened: { ino: 12 } },
      { opened: { dev: 8 } },
      { after: { mtimeMs: 1_700_000_000_001 } },
      { after: { size: Buffer.byteLength(databaseUrl) - 1 } },
    ] as const) {
      expect(() =>
        loadTrustedTelebirrVerifierConfig(
          enabledEnvironment,
          guardedDependencies(undefined, TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE, overrides),
        ),
      ).toThrow('The trusted TeleBirr verifier configuration is unavailable.');
    }
  });

  it('rejects key-ID or SPKI aliases within and across trust roles', () => {
    const sameBytes = assignmentSpki;
    const sameRoleSpkiAlias = JSON.stringify({
      contractVersion: 1,
      assignmentSigners: [
        {
          keyId: 'assignment-key-0001',
          publicKeySpkiDerBase64: assignmentSpki.toString('base64'),
        },
        {
          keyId: 'assignment-key-0002',
          publicKeySpkiDerBase64: assignmentSpki.toString('base64'),
        },
      ],
      devices: [
        { keyId: 'device-key-0000001', publicKeySpkiDerBase64: deviceSpki.toString('base64') },
      ],
    });
    for (const pinManifest of [
      manifest('shared-key-00001', 'shared-key-00001'),
      manifest('assignment-key-0001', 'device-key-0000001', sameBytes, sameBytes),
      sameRoleSpkiAlias,
    ]) {
      expect(() =>
        loadTrustedTelebirrVerifierConfig(
          enabledEnvironment,
          guardedDependencies({
            [TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE]: databaseUrl,
            [TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE]: pinManifest,
            [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: caCertificate,
          }),
        ),
      ).toThrow('The trusted TeleBirr verifier configuration is unavailable.');
    }
  });

  it('requires canonical P-256 SubjectPublicKeyInfo pins', () => {
    const wrongCurve = publicKeySpki('secp384r1');
    const nonCanonical = Buffer.concat([assignmentSpki, Buffer.from([0])]);
    for (const invalidAssignment of [Buffer.alloc(91, 9), wrongCurve, nonCanonical]) {
      const values = {
        [TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE]: databaseUrl,
        [TRUSTED_TELEBIRR_VERIFIER_PIN_MANIFEST_FILE]: manifest(
          'assignment-key-0001',
          'device-key-0000001',
          invalidAssignment,
          deviceSpki,
        ),
        [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: caCertificate,
      };
      expect(() =>
        loadTrustedTelebirrVerifierConfig(enabledEnvironment, guardedDependencies(values)),
      ).toThrow('The trusted TeleBirr verifier configuration is unavailable.');
    }
  });

  it('fails every activation or fixed-path mismatch closed and redacts filesystem details', () => {
    for (const environment of [
      { ...enabledEnvironment, NODE_ENV: 'test' },
      { ...enabledEnvironment, FINANCIAL_ACTIONS_MODE: 'dry_run' },
      { ...enabledEnvironment, TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: 'false' },
      { ...enabledEnvironment, TRUSTED_TELEBIRR_VERIFIER_DEPLOYMENT_TARGET: 'Production' },
      { ...enabledEnvironment, NODE_EXTRA_CA_CERTS: '/tmp/ca' },
      { ...enabledEnvironment, TRUSTED_TELEBIRR_VERIFIER_DATABASE_URL_FILE: '/tmp/db' },
    ]) {
      expect(() => loadTrustedTelebirrVerifierConfig(environment, guardedDependencies())).toThrow();
    }

    const leaked = `${databaseUrl} /private/runtime/path`;
    const dependencies = guardedDependencies();
    dependencies.fileSystem.open = vi.fn(() => {
      throw new Error(leaked);
    });
    let message = '';
    try {
      loadTrustedTelebirrVerifierConfig(enabledEnvironment, dependencies);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('The trusted TeleBirr verifier configuration is unavailable.');
    expect(message).not.toContain('synthetic-password');
    expect(message).not.toContain('/private/runtime/path');
  });
});

describe('TeleBirr shadow verifier configuration', () => {
  const shadowEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    FINANCIAL_ACTIONS_MODE: 'dry_run',
    INTERNAL_TELEBIRR_SHADOW_VERIFIER_ENABLED: 'true',
    TELEBIRR_SHADOW_VERIFICATION_ENABLED: 'true',
    TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: 'false',
    KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
    TELEBIRR_SHADOW_VERIFIER_DEPLOYMENT_TARGET: 'staging',
    TELEBIRR_SHADOW_VERIFIER_DATABASE_URL_FILE,
    TELEBIRR_SHADOW_VERIFIER_PIN_MANIFEST_FILE,
    NODE_EXTRA_CA_CERTS: TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE,
  };
  const shadowFiles = {
    [TELEBIRR_SHADOW_VERIFIER_DATABASE_URL_FILE]: shadowDatabaseUrl,
    [TELEBIRR_SHADOW_VERIFIER_PIN_MANIFEST_FILE]: manifest(),
    [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: caCertificate,
  };

  it('is inert by default without reading configuration', () => {
    const dependencies = guardedDependencies(shadowFiles);
    expect(loadTelebirrShadowVerifierConfig({}, dependencies)).toEqual({ enabled: false });
    expect(dependencies.fileSystem.lstat).not.toHaveBeenCalled();
  });

  it('loads only dry-run mode, the shadow role, reviewed pins, and fixed files', () => {
    const config = loadTelebirrShadowVerifierConfig(
      shadowEnvironment,
      guardedDependencies(shadowFiles),
    );
    expect(config).toMatchObject({
      enabled: true,
      deploymentTarget: 'staging',
      connection: {
        database: 'postgres',
        host: 'db.spzpiyxheappsfyswewl.supabase.co',
        port: 5432,
        user: 'fetanagent_telebirr_shadow_verifier_runtime',
      },
    });
  });

  it('accepts the canonical padded Supabase CA used by the shadow runtime', () => {
    const config = loadTelebirrShadowVerifierConfig(
      shadowEnvironment,
      guardedDependencies({
        ...shadowFiles,
        [TRUSTED_TELEBIRR_VERIFIER_SUPABASE_CA_FILE]: paddedCaCertificate,
      }),
    );
    expect(config).toMatchObject({
      enabled: true,
      connection: { ca: paddedCaCertificate },
    });
  });

  it('fails closed if any no-money or role boundary is cross-wired', () => {
    for (const environment of [
      { ...shadowEnvironment, FINANCIAL_ACTIONS_MODE: 'live' },
      { ...shadowEnvironment, TELEBIRR_SHADOW_VERIFICATION_ENABLED: 'false' },
      { ...shadowEnvironment, TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED: 'true' },
      { ...shadowEnvironment, KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'true' },
    ]) {
      expect(() =>
        loadTelebirrShadowVerifierConfig(environment, guardedDependencies(shadowFiles)),
      ).toThrow('The TeleBirr shadow verifier configuration is unavailable.');
    }

    expect(() =>
      loadTelebirrShadowVerifierConfig(
        shadowEnvironment,
        guardedDependencies({
          ...shadowFiles,
          [TELEBIRR_SHADOW_VERIFIER_DATABASE_URL_FILE]: databaseUrl,
        }),
      ),
    ).toThrow('The TeleBirr shadow verifier configuration is unavailable.');
  });
});
