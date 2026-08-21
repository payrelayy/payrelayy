import {
  KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE,
  KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
  KEMERBET_EXECUTOR_DATABASE_TARGETS,
  KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE,
  KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
  loadExecutorConfig,
} from '@fetanagent/config/executor';
import { describe, expect, it, vi } from 'vitest';

import {
  assertKemerBetDepositCatalogPreflight,
  createKemerBetDepositPostgresRuntime,
  KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL,
  KEMERBET_EXECUTOR_SINGLETON_ACQUIRE_SQL,
  KEMERBET_EXECUTOR_SINGLETON_HELD_SQL,
  KEMERBET_EXECUTOR_SINGLETON_RELEASE_SQL,
  type KemerBetDepositPostgresClient,
  KemerBetDepositPostgresRuntimeUnavailableError,
  probeKemerBetDepositCatalogReadiness,
} from './kemerbet-deposit-postgres-runtime.js';
import { LEASE_NEXT_DEPOSIT_EXECUTION_SQL } from './postgres-kemerbet-deposit-database.js';

const WORKER_INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const privateLiveDepositPilotManifest = Object.freeze({
  contractVersion: 1 as const,
  pilotRevisionId: '11111111-1111-4111-8111-111111111112',
  configurationDigest: `sha256:${'1'.repeat(64)}`,
});
const privateLiveDepositPilotManifestJson = JSON.stringify(privateLiveDepositPilotManifest);

const passingRow = {
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
  only_expected_direct_membership: true,
  runtime_has_no_members: true,
  group_role_is_safe: true,
  group_usage_allowed_set_denied: true,
  group_only_expected_members: true,
  group_has_no_upstream_membership: true,
  app_schema_boundary_allowed: true,
  no_app_base_object_access: true,
  exact_function_surface_allowed: true,
  allowed_functions_hardened: true,
  allowed_functions_execution_private: true,
  default_function_execution_private: true,
};

function enabledRuntimeConfig() {
  const databaseUrl = `postgresql://${KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE}:test-password@${KEMERBET_EXECUTOR_DATABASE_TARGETS.staging.host}:5432/postgres?sslmode=verify-full`;
  const config = loadExecutorConfig(
    {
      NODE_ENV: 'production',
      FINANCIAL_ACTIONS_MODE: 'live',
      KEMERBET_EXECUTOR_ENABLED: 'true',
      KEMERBET_FINAL_ACTION_ENABLED: 'true',
      KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'true',
      KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE,
      INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true',
      KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: 'staging',
      KEMERBET_EXECUTOR_DATABASE_URL_FILE: KEMERBET_EXECUTOR_DATABASE_SECRET_FILE,
      NODE_EXTRA_CA_CERTS: KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
    },
    {
      readSecretFile: () => databaseUrl,
      readPrivateLiveDepositPilotManifestFile: () => privateLiveDepositPilotManifestJson,
    },
  );
  if (!config.kemerBet.executionRuntime.enabled) throw new Error('test setup failed');
  return config.kemerBet.executionRuntime;
}

function clientFixture(
  options: {
    readonly singletonAcquired?: boolean;
    readonly singletonHeld?: boolean;
    readonly queryFailure?: string;
  } = {},
) {
  const listeners = new Map<'error' | 'end', Set<(error?: Error) => void>>();
  const events: string[] = [];
  const query = vi.fn(async (statement: string, values: readonly unknown[]) => {
    events.push(
      statement === KEMERBET_EXECUTOR_SINGLETON_ACQUIRE_SQL
        ? 'singleton-acquire'
        : statement === KEMERBET_EXECUTOR_SINGLETON_HELD_SQL
          ? 'singleton-held'
          : statement === KEMERBET_EXECUTOR_SINGLETON_RELEASE_SQL
            ? 'singleton-release'
            : statement === KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL
              ? 'catalog-preflight'
              : statement === LEASE_NEXT_DEPOSIT_EXECUTION_SQL
                ? 'lease'
                : 'unexpected-query',
    );
    if (options.queryFailure === statement) throw new Error('sensitive backend failure');
    if (statement === KEMERBET_EXECUTOR_SINGLETON_ACQUIRE_SQL) {
      expect(values).toHaveLength(2);
      return { rows: [{ singleton_acquired: options.singletonAcquired !== false }] };
    }
    if (statement === KEMERBET_EXECUTOR_SINGLETON_HELD_SQL) {
      expect(values).toEqual(query.mock.calls[0]?.[1]);
      return { rows: [{ singleton_held: options.singletonHeld !== false }] };
    }
    if (statement === KEMERBET_EXECUTOR_SINGLETON_RELEASE_SQL) {
      expect(values).toEqual(query.mock.calls[0]?.[1]);
      return { rows: [{ singleton_released: true }] };
    }
    if (statement === KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL) {
      expect(values).toEqual([]);
      return { rows: [passingRow] };
    }
    if (statement === LEASE_NEXT_DEPOSIT_EXECUTION_SQL) return { rows: [] };
    throw new Error('unexpected query');
  });
  const client: KemerBetDepositPostgresClient = {
    connect: vi.fn(async () => {
      events.push('connect');
    }),
    end: vi.fn(async () => {
      events.push('end');
      for (const listener of listeners.get('end') ?? []) listener();
    }),
    query,
    on(event, listener) {
      const existing = listeners.get(event) ?? new Set();
      existing.add(listener);
      listeners.set(event, existing);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
  return {
    client,
    events,
    query,
    emitError(detail = 'sensitive connection detail') {
      for (const listener of listeners.get('error') ?? []) listener(new Error(detail));
    },
  };
}

describe('KemerBet deposit PostgreSQL startup preflight', () => {
  it('pins the safe runtime, six consume-only procedures, and zero base-object access', () => {
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain(
      "current_user = 'fetanagent_deposit_executor_runtime'",
    );
    for (const signature of [
      'lease_next_private_live_deposit_execution(uuid,integer)',
      'cancel_deposit_execution_before_action(uuid,uuid,text)',
      'fence_private_live_deposit_execution_final_action(uuid,uuid,uuid,uuid,uuid)',
      'require_deposit_execution_reconciliation(uuid,uuid,boolean)',
      'lease_next_deposit_execution_reconciliation(uuid,integer)',
      'record_deposit_execution_reconciliation(uuid,uuid,text,text,smallint,text,timestamptz,boolean,boolean,boolean,boolean)',
    ]) {
      expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain(signature);
    }
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).not.toContain(
      'enqueue_verified_deposit_execution',
    );
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain('role.rolconnlimit = 1');
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain('no_app_base_object_access');
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain('exact_function_surface_allowed');
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain(
      'allowed_functions_execution_private',
    );
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain("array['search_path=pg_catalog']");
    expect(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL).toContain(
      "array['search_path=pg_catalog, app']",
    );
  });

  it('accepts one exact all-true preflight row', async () => {
    await expect(
      assertKemerBetDepositCatalogPreflight({
        async query(query, values) {
          expect(query).toBe(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL);
          expect(values).toEqual([]);
          return { rows: [passingRow] };
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed on false, extra, or missing catalog facts', async () => {
    for (const rows of [
      [],
      [{ ...passingRow, no_app_base_object_access: false }],
      [{ ...passingRow, unexpected: true }],
    ]) {
      await expect(
        assertKemerBetDepositCatalogPreflight({
          async query() {
            return { rows };
          },
        }),
      ).rejects.toBeInstanceOf(KemerBetDepositPostgresRuntimeUnavailableError);
    }
  });

  it('exposes a boolean catalog-only readiness probe without leaking failures', async () => {
    await expect(
      probeKemerBetDepositCatalogReadiness({
        async query() {
          return { rows: [passingRow] };
        },
      }),
    ).resolves.toBe(true);
    await expect(
      probeKemerBetDepositCatalogReadiness({
        async query() {
          throw new Error('sensitive database detail');
        },
      }),
    ).resolves.toBe(false);
  });
});

describe('KemerBet deposit PostgreSQL lifetime singleton', () => {
  it('rejects an invalid pilot manifest before opening the database connection', async () => {
    const fixture = clientFixture();

    await expect(
      createKemerBetDepositPostgresRuntime(
        enabledRuntimeConfig(),
        {
          ...privateLiveDepositPilotManifest,
          configurationDigest: 'sha256:invalid',
        },
        { createClient: () => fixture.client },
      ),
    ).rejects.toBeInstanceOf(KemerBetDepositPostgresRuntimeUnavailableError);
    expect(fixture.events).toEqual([]);
  });

  it('holds one direct client for singleton, catalog, RPC, readiness, and shutdown', async () => {
    const fixture = clientFixture();
    let receivedClientConfig: Readonly<Record<string, unknown>> | undefined;
    const runtime = await createKemerBetDepositPostgresRuntime(
      enabledRuntimeConfig(),
      privateLiveDepositPilotManifest,
      {
        createClient(config) {
          receivedClientConfig = config;
          return fixture.client;
        },
      },
    );

    expect(fixture.events).toEqual(['connect', 'singleton-acquire', 'catalog-preflight']);
    expect(receivedClientConfig).toMatchObject({
      host: KEMERBET_EXECUTOR_DATABASE_TARGETS.staging.host,
      user: KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE,
      application_name: 'fetanagent_deposit_executor',
      ssl: { rejectUnauthorized: true },
    });
    expect(receivedClientConfig).not.toHaveProperty('max');
    expect(receivedClientConfig).not.toHaveProperty('min');
    expect(receivedClientConfig).not.toHaveProperty('idleTimeoutMillis');

    await expect(runtime.ready()).resolves.toBe(true);
    expect(runtime.database).not.toHaveProperty('enqueueVerifiedDeposit');
    await expect(runtime.database.leaseNextExecution(WORKER_INSTANCE_ID, 300)).resolves.toBeNull();
    await runtime.close();
    await runtime.close();

    expect(fixture.events).toEqual([
      'connect',
      'singleton-acquire',
      'catalog-preflight',
      'singleton-held',
      'catalog-preflight',
      'lease',
      'singleton-release',
      'end',
    ]);
  });

  it('fails the second executor closed before catalog or any RPC when the lock is occupied', async () => {
    const fixture = clientFixture({ singletonAcquired: false });

    await expect(
      createKemerBetDepositPostgresRuntime(
        enabledRuntimeConfig(),
        privateLiveDepositPilotManifest,
        {
          createClient: () => fixture.client,
        },
      ),
    ).rejects.toBeInstanceOf(KemerBetDepositPostgresRuntimeUnavailableError);
    expect(fixture.events).toEqual(['connect', 'singleton-acquire', 'end']);
  });

  it('turns readiness off and blocks every later RPC after the held session reports an error', async () => {
    const fixture = clientFixture();
    const runtime = await createKemerBetDepositPostgresRuntime(
      enabledRuntimeConfig(),
      privateLiveDepositPilotManifest,
      { createClient: () => fixture.client },
    );
    const queryCountBeforeLoss = fixture.query.mock.calls.length;

    fixture.emitError();

    await expect(runtime.ready()).resolves.toBe(false);
    await expect(
      runtime.database.leaseNextExecution(WORKER_INSTANCE_ID, 300),
    ).rejects.toBeInstanceOf(KemerBetDepositPostgresRuntimeUnavailableError);
    expect(fixture.query).toHaveBeenCalledTimes(queryCountBeforeLoss);
    await runtime.close();
    expect(fixture.events).toEqual(['connect', 'singleton-acquire', 'catalog-preflight', 'end']);
  });

  it('fails permanently if readiness can no longer prove the singleton lock is held', async () => {
    const fixture = clientFixture({ singletonHeld: false });
    const runtime = await createKemerBetDepositPostgresRuntime(
      enabledRuntimeConfig(),
      privateLiveDepositPilotManifest,
      { createClient: () => fixture.client },
    );

    await expect(runtime.ready()).resolves.toBe(false);
    const queryCountAfterProbe = fixture.query.mock.calls.length;
    await expect(
      runtime.database.leaseNextExecution(WORKER_INSTANCE_ID, 300),
    ).rejects.toBeInstanceOf(KemerBetDepositPostgresRuntimeUnavailableError);
    expect(fixture.query).toHaveBeenCalledTimes(queryCountAfterProbe);
    await runtime.close();
    expect(fixture.events).toEqual([
      'connect',
      'singleton-acquire',
      'catalog-preflight',
      'singleton-held',
      'end',
    ]);
  });

  it('redacts a client query failure and never resumes leasing on that session', async () => {
    const fixture = clientFixture({ queryFailure: KEMERBET_EXECUTOR_SINGLETON_HELD_SQL });
    const runtime = await createKemerBetDepositPostgresRuntime(
      enabledRuntimeConfig(),
      privateLiveDepositPilotManifest,
      { createClient: () => fixture.client },
    );

    await expect(runtime.ready()).resolves.toBe(false);
    let message = '';
    try {
      await runtime.database.leaseNextExecution(WORKER_INSTANCE_ID, 300);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('The KemerBet deposit PostgreSQL runtime is unavailable.');
    expect(message).not.toContain('sensitive backend failure');
    await runtime.close();
  });
});
