import { describe, expect, it, vi } from 'vitest';

import type { CompanionDeviceBridgeConnectionConfig } from './config.js';
import { RELEASE_COMPANION_PAIRING_SQL } from './postgres-state.js';
import {
  COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL,
  COMPANION_DEVICE_BRIDGE_PREFLIGHT_KEYS,
  CompanionDeviceBridgePostgresUnavailableError,
  assertCompanionDeviceBridgeCatalogPreflight,
  createCompanionDeviceBridgePostgresRuntime,
} from './postgres-runtime.js';

const connection: CompanionDeviceBridgeConnectionConfig = {
  ca: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`,
  database: 'postgres',
  host: 'db.spzpiyxheappsfyswewl.supabase.co',
  password: 'synthetic-password-123456',
  port: 5432,
  user: 'fetanagent_companion_device_bridge_runtime',
};

function passingPreflight() {
  return Object.fromEntries(COMPANION_DEVICE_BRIDGE_PREFLIGHT_KEYS.map((key) => [key, true]));
}

function fakePool(options: { readonly badPreflight?: boolean } = {}) {
  let errorListener: ((error: Error) => void) | undefined;
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values: readonly string[] = []) => {
    if (sql === COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL) {
      const row = passingPreflight();
      if (options.badPreflight) row.runtime_login_is_safe = false;
      return { rows: [row] };
    }
    if (sql === RELEASE_COMPANION_PAIRING_SQL) {
      expect(values).toEqual([`sha256:${'a'.repeat(64)}`]);
      return { rows: [{ released: true }] };
    }
    throw new Error('unexpected query');
  });
  const pool = {
    connect: vi.fn(async () => ({ release })),
    end: vi.fn(async () => undefined),
    on: vi.fn((_event: 'error', listener: (error: Error) => void) => {
      errorListener = listener;
    }),
    query,
    removeListener: vi.fn(),
  };
  return { pool, release, query, emitError: () => errorListener?.(new Error('connection lost')) };
}

describe('companion device bridge PostgreSQL runtime', () => {
  it('uses one verify-full connection and rechecks the exact function-only catalog boundary', async () => {
    expect(COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL).toContain(
      'array_agg(namespace.nspname::text order by namespace.nspname)',
    );
    expect(COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL).not.toContain(
      'array_agg(namespace.nspname order by namespace.nspname)',
    );
    const fake = fakePool();
    let observedConfig: Readonly<Record<string, unknown>> | undefined;
    const runtime = await createCompanionDeviceBridgePostgresRuntime(
      connection,
      'companion_server_signer_2026_01',
      {
        createPool: (config) => {
          observedConfig = config;
          return fake.pool;
        },
      },
    );
    expect(observedConfig).toMatchObject({
      application_name: 'fetanagent_companion_device_bridge',
      max: 1,
      min: 1,
      user: 'fetanagent_companion_device_bridge_runtime',
      ssl: { ca: connection.ca, rejectUnauthorized: true },
    });
    expect(observedConfig).not.toHaveProperty('connectionString');
    expect(fake.release).toHaveBeenCalledTimes(1);
    await runtime.state.releasePairing(`sha256:${'a'.repeat(64)}`);
    expect(fake.query.mock.calls.map(([sql]) => sql)).toEqual([
      COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL,
      COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL,
      RELEASE_COMPANION_PAIRING_SQL,
    ]);
    await expect(runtime.ready()).resolves.toBe(true);
    await runtime.close();
    expect(fake.pool.end).toHaveBeenCalledTimes(1);
    await expect(runtime.ready()).resolves.toBe(false);
  });

  it('fails startup closed when any catalog assertion is false', async () => {
    const fake = fakePool({ badPreflight: true });
    const failures: unknown[] = [];
    await expect(
      createCompanionDeviceBridgePostgresRuntime(connection, 'companion_server_signer_2026_01', {
        createPool: () => fake.pool,
        onInitialPreflightFailure: (failure) => failures.push(failure),
      }),
    ).rejects.toThrow(CompanionDeviceBridgePostgresUnavailableError);
    expect(failures).toEqual([
      { kind: 'catalog_checks_rejected', checks: ['runtime_login_is_safe'] },
    ]);
    expect(fake.pool.end).toHaveBeenCalledTimes(1);
  });

  it('reports only fixed safe classifications for connection, query, and response failures', async () => {
    const cases = [
      {
        expected: { kind: 'database_connection_unavailable' },
        pool: {
          ...fakePool().pool,
          connect: vi.fn(async () => Promise.reject(new Error('secret'))),
        },
      },
      {
        expected: { kind: 'database_query_unavailable' },
        pool: { ...fakePool().pool, query: vi.fn(async () => Promise.reject(new Error('secret'))) },
      },
      {
        expected: { kind: 'catalog_response_invalid' },
        pool: { ...fakePool().pool, query: vi.fn(async () => ({ rows: [] })) },
      },
    ] as const;
    for (const testCase of cases) {
      const failures: unknown[] = [];
      await expect(
        createCompanionDeviceBridgePostgresRuntime(connection, 'companion_server_signer_2026_01', {
          createPool: () => testCase.pool,
          onInitialPreflightFailure: (failure) => failures.push(failure),
        }),
      ).rejects.toThrow(CompanionDeviceBridgePostgresUnavailableError);
      expect(failures).toEqual([testCase.expected]);
      expect(JSON.stringify(failures)).not.toContain('secret');
    }
  });

  it('rejects malformed, extra, or proxied preflight rows', async () => {
    for (const row of [
      { ...passingPreflight(), unexpected: true },
      { ...passingPreflight(), runtime_login_identity_allowed: 'true' },
      new Proxy(passingPreflight(), {}),
      Object.defineProperty(passingPreflight(), 'runtime_login_identity_allowed', {
        enumerable: true,
        get: () => {
          throw new Error('untrusted accessor detail');
        },
      }),
    ]) {
      await expect(
        assertCompanionDeviceBridgeCatalogPreflight({
          query: async () => ({ rows: [row] }),
        }),
      ).rejects.toThrow(CompanionDeviceBridgePostgresUnavailableError);
    }
  });

  it('marks readiness unavailable after an idle pool error without logging its detail', async () => {
    const fake = fakePool();
    const runtime = await createCompanionDeviceBridgePostgresRuntime(
      connection,
      'companion_server_signer_2026_01',
      { createPool: () => fake.pool },
    );
    fake.emitError();
    await expect(runtime.ready()).resolves.toBe(false);
    await expect(runtime.state.releasePairing(`sha256:${'a'.repeat(64)}`)).rejects.toThrow(
      'device-state boundary is unavailable',
    );
    await runtime.close();
  });
});
