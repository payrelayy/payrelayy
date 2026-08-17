import { constants } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
  KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
  KEMERBET_AGENT_PROFILES_ROOT,
  KEMERBET_BROWSER_EXECUTABLE_PATH,
  KEMERBET_EXECUTOR_DATABASE_TARGETS,
  KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE,
  KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
  KEMERBET_EXECUTOR_HEALTH_HOST,
  KEMERBET_EXECUTOR_HEALTH_PORT,
  KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE,
  KEMERBET_SELECTOR_CONTRACT_FILE,
  KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
  loadExecutorConfig,
  redactedExecutorConfigForLog,
} from './executor.js';

function databaseUrlFor(target: 'staging' | 'production'): string {
  return `postgresql://${KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE}:test-password@${KEMERBET_EXECUTOR_DATABASE_TARGETS[target].host}:5432/postgres?sslmode=verify-full`;
}

const databaseUrl = databaseUrlFor('staging');
const enabledEnvironment = {
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'live',
  KEMERBET_EXECUTOR_ENABLED: 'true',
  KEMERBET_FINAL_ACTION_ENABLED: 'true',
  INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true',
  KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: 'staging',
  KEMERBET_EXECUTOR_DATABASE_URL_FILE: KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
  NODE_EXTRA_CA_CERTS: KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
} as const;

interface FakeSecretFileStat {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

function fakeStat(overrides: Partial<FakeSecretFileStat> = {}): FakeSecretFileStat {
  return {
    dev: 8,
    ino: 21,
    mode: 0o100444,
    size: Buffer.byteLength(databaseUrl),
    uid: 0,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  };
}

function secureSecretFixture(
  options: {
    readonly afterRead?: Partial<FakeSecretFileStat>;
    readonly before?: Partial<FakeSecretFileStat>;
    readonly opened?: Partial<FakeSecretFileStat>;
    readonly openError?: Error;
    readonly realPath?: string;
    readonly value?: string;
  } = {},
) {
  const before = fakeStat(options.before);
  const opened = fakeStat(options.opened);
  const afterRead = fakeStat(options.afterRead ?? options.opened);
  let statCall = 0;
  const handle = {
    close: vi.fn(),
    read: vi.fn(() => Buffer.from(options.value ?? databaseUrl, 'utf8')),
    stat: vi.fn(() => (statCall++ === 0 ? opened : afterRead)),
  };
  const fileSystem = {
    lstat: vi.fn(() => before),
    open: vi.fn((_path: string, _flags: number) => {
      if (options.openError) throw options.openError;
      return handle;
    }),
    realpath: vi.fn(() => options.realPath ?? KEMERBET_EXECUTOR_DATABASE_SECRET_FILE),
  };
  return {
    dependencies: {
      effectiveUserId: 1_000,
      platform: 'linux' as const,
      secretFileSystem: fileSystem,
    },
    fileSystem,
    handle,
  };
}

describe('KemerBet deposit executor configuration', () => {
  it('is disabled by default and does not read a secret file', () => {
    let reads = 0;
    const config = loadExecutorConfig({ NODE_ENV: 'test' }, () => {
      reads += 1;
      return databaseUrl;
    });

    expect(config.kemerBet.executionRuntime).toEqual({ enabled: false });
    expect(reads).toBe(0);
  });

  it('requires every live gate and the exact secret-file connection', () => {
    const config = loadExecutorConfig(enabledEnvironment, () => databaseUrl);
    expect(config.kemerBet.executionRuntime).toEqual({
      enabled: true,
      deploymentTarget: 'staging',
      projectReference: KEMERBET_EXECUTOR_DATABASE_TARGETS.staging.projectReference,
      tlsMode: 'verify-full',
      connection: {
        database: 'postgres',
        host: KEMERBET_EXECUTOR_DATABASE_TARGETS.staging.host,
        password: 'test-password',
        port: 5432,
        user: KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE,
      },
    });
    const redacted = JSON.stringify(redactedExecutorConfigForLog(config));
    expect(redacted).not.toContain('test-password');
    expect(redacted).not.toContain(databaseUrl);
    expect(redacted).toContain('staging');
    expect(config.kemerBet.runtimeIsolation).toEqual({
      agentIdentityBindingsFile: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
      agentProfilesRoot: KEMERBET_AGENT_PROFILES_ROOT,
      browserExecutablePath: KEMERBET_BROWSER_EXECUTABLE_PATH,
      selectorContractFile: KEMERBET_SELECTOR_CONTRACT_FILE,
      historyReferenceHmacKeyFile: KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE,
      agentIdentityHmacKeyFile: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
      supabaseCaCertificateFile: KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
      healthHost: KEMERBET_EXECUTOR_HEALTH_HOST,
      healthPort: KEMERBET_EXECUTOR_HEALTH_PORT,
    });
  });

  it('requires an explicit deployment target and maps each target to its exact project', () => {
    for (const target of ['staging', 'production'] as const) {
      const config = loadExecutorConfig(
        { ...enabledEnvironment, KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: target },
        () => databaseUrlFor(target),
      );
      expect(config.kemerBet.executionRuntime).toMatchObject({
        enabled: true,
        deploymentTarget: target,
        projectReference: KEMERBET_EXECUTOR_DATABASE_TARGETS[target].projectReference,
        connection: { host: KEMERBET_EXECUTOR_DATABASE_TARGETS[target].host },
      });
    }

    for (const target of [undefined, '', 'Production', 'preview']) {
      expect(() =>
        loadExecutorConfig(
          { ...enabledEnvironment, KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: target },
          () => databaseUrl,
        ),
      ).toThrow('must be explicitly set to staging or production');
    }
  });

  it('rejects a database project that does not match the explicit target', () => {
    expect(() =>
      loadExecutorConfig(
        { ...enabledEnvironment, KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: 'staging' },
        () => databaseUrlFor('production'),
      ),
    ).toThrow('must match the explicit deployment target');
    expect(() =>
      loadExecutorConfig(
        { ...enabledEnvironment, KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: 'production' },
        () => databaseUrlFor('staging'),
      ),
    ).toThrow('must match the explicit deployment target');
  });

  it('rejects a missing secret file, foreign host, generic role, and weak TLS', () => {
    expect(() =>
      loadExecutorConfig(
        { ...enabledEnvironment, KEMERBET_EXECUTOR_DATABASE_URL_FILE: undefined },
        () => databaseUrl,
      ),
    ).toThrow('KEMERBET_EXECUTOR_DATABASE_URL_FILE is required');
    expect(() =>
      loadExecutorConfig(
        {
          ...enabledEnvironment,
          KEMERBET_EXECUTOR_DATABASE_URL_FILE: '/run/secrets/unapproved_database_url',
        },
        () => databaseUrl,
      ),
    ).toThrow('approved production secret path');

    for (const invalid of [
      databaseUrl.replace(
        KEMERBET_EXECUTOR_DATABASE_TARGETS.staging.host,
        'db.foreign.supabase.co',
      ),
      databaseUrl.replace(KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE, 'postgres'),
      databaseUrl.replace('sslmode=verify-full', 'sslmode=require'),
      `${databaseUrl}&application_name=unsafe`,
    ]) {
      expect(() => loadExecutorConfig(enabledEnvironment, () => invalid)).toThrow(
        'exact direct host',
      );
    }
  });

  it('rejects execution unless every live switch is true', () => {
    for (const environment of [
      { ...enabledEnvironment, NODE_ENV: 'test', FINANCIAL_ACTIONS_MODE: 'dry_run' },
      { ...enabledEnvironment, KEMERBET_EXECUTOR_ENABLED: 'false' },
      { ...enabledEnvironment, KEMERBET_FINAL_ACTION_ENABLED: 'false' },
      { ...enabledEnvironment, NODE_EXTRA_CA_CERTS: undefined },
    ]) {
      expect(() => loadExecutorConfig(environment, () => databaseUrl)).toThrow();
    }
  });

  it('rejects every production isolation path or health-listener override', () => {
    for (const [name, value] of [
      ['KEMERBET_AGENT_IDENTITY_BINDINGS_FILE', 'C:\\unsafe\\bindings'],
      ['KEMERBET_AGENT_PROFILES_ROOT', '/tmp/profiles'],
      ['KEMERBET_BROWSER_EXECUTABLE_PATH', '/tmp/browser'],
      ['KEMERBET_SELECTOR_CONTRACT_FILE', '/tmp/selectors.json'],
      ['KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE', '/tmp/key'],
      ['KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE', '/tmp/identity-key'],
      ['NODE_EXTRA_CA_CERTS', '/tmp/ca.pem'],
      ['EXECUTOR_HEALTH_HOST', '0.0.0.0'],
      ['EXECUTOR_HEALTH_PORT', '8080'],
    ] as const) {
      expect(() =>
        loadExecutorConfig({ ...enabledEnvironment, [name]: value }, () => databaseUrl),
      ).toThrow('cannot be overridden');
    }
  });

  it('securely reads the fixed root-owned 0444 Docker secret', () => {
    const fixture = secureSecretFixture();
    const config = loadExecutorConfig(enabledEnvironment, fixture.dependencies);

    expect(config.kemerBet.executionRuntime).toMatchObject({ enabled: true });
    expect(fixture.fileSystem.lstat).toHaveBeenCalledWith(KEMERBET_EXECUTOR_DATABASE_SECRET_FILE);
    expect(fixture.fileSystem.realpath).toHaveBeenCalledWith(
      KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
    );
    expect(fixture.fileSystem.open).toHaveBeenCalledWith(
      KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    expect(fixture.handle.stat).toHaveBeenCalledTimes(2);
    expect(fixture.handle.read).toHaveBeenCalledWith(4_096);
    expect(fixture.handle.close).toHaveBeenCalledOnce();
  });

  it('accepts an effective-user-owned secret but rejects unsafe mode or ownership', () => {
    expect(() =>
      loadExecutorConfig(
        enabledEnvironment,
        secureSecretFixture({
          afterRead: { mode: 0o100400, uid: 1_000 },
          before: { mode: 0o100400, uid: 1_000 },
          opened: { mode: 0o100400, uid: 1_000 },
        }).dependencies,
      ),
    ).not.toThrow();

    for (const before of [
      { mode: 0o100446 },
      { mode: 0o100444, uid: 2_000 },
      { isFile: () => false },
    ]) {
      expect(() =>
        loadExecutorConfig(enabledEnvironment, secureSecretFixture({ before }).dependencies),
      ).toThrow('The KemerBet executor database secret is unavailable.');
    }
  });

  it('rejects symlinks, realpath aliases, and an opened-file race', () => {
    for (const fixture of [
      secureSecretFixture({
        before: { isFile: () => false, isSymbolicLink: () => true },
      }),
      secureSecretFixture({ realPath: '/run/secrets/repointed_database_url' }),
      secureSecretFixture({ opened: { ino: 22 } }),
      secureSecretFixture({ afterRead: { size: Buffer.byteLength(databaseUrl) - 1 } }),
    ]) {
      expect(() => loadExecutorConfig(enabledEnvironment, fixture.dependencies)).toThrow(
        'The KemerBet executor database secret is unavailable.',
      );
    }
  });

  it('rejects overlong or multi-value secret contents', () => {
    expect(() =>
      loadExecutorConfig(
        enabledEnvironment,
        secureSecretFixture({
          before: { size: 4_097 },
          opened: { size: 4_097 },
        }).dependencies,
      ),
    ).toThrow('The KemerBet executor database secret is unavailable.');
    expect(() => loadExecutorConfig(enabledEnvironment, () => `${databaseUrl}\nsecond`)).toThrow(
      'The KemerBet executor database secret is unavailable.',
    );
  });

  it('redacts secret material, paths, and underlying filesystem failures', () => {
    const leakedDetail = `${databaseUrl} at /private/host/secret`;
    let message = '';
    try {
      loadExecutorConfig(
        enabledEnvironment,
        secureSecretFixture({ openError: new Error(leakedDetail) }).dependencies,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('The KemerBet executor database secret is unavailable.');
    expect(message).not.toContain('test-password');
    expect(message).not.toContain('/private/host/secret');

    const malformed = databaseUrl.replace('postgresql:', 'not-a-database:');
    let malformedMessage = '';
    try {
      loadExecutorConfig(enabledEnvironment, () => malformed);
    } catch (error) {
      malformedMessage = error instanceof Error ? error.message : String(error);
    }
    expect(malformedMessage).toContain('must match the explicit deployment target');
    expect(malformedMessage).not.toContain('test-password');
    expect(malformedMessage).not.toContain(malformed);
  });
});
