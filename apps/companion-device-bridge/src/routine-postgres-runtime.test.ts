import { describe, expect, it, vi } from 'vitest';

import type { CompanionRoutineDepositConnectionConfig } from './config.js';
import { CompanionDeviceStateUnavailableError } from './postgres-state.js';
import {
  ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL,
  createRoutineDepositPostgresRuntime,
} from './routine-postgres-runtime.js';

const connection: CompanionRoutineDepositConnectionConfig = {
  ca: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`,
  database: 'postgres',
  host: 'aws-0-eu-west-1.pooler.supabase.com',
  password: 'synthetic-routine-password',
  port: 5432,
  user: 'fetanagent_routine_deposit_broker_runtime.xzztugbgtulptnbpoelr',
};

function preflightRow(overrides: Readonly<Record<string, boolean>> = {}) {
  return {
    capability_member: true,
    command_allowed: true,
    command_hardened: true,
    exact_runtime: true,
    no_app_relation_privileges: true,
    schema_usage: true,
    ...overrides,
  };
}

function fakePool(row: unknown) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    expect(sql).toBe(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL);
    return { rows: [row] };
  });
  return {
    pool: {
      connect: vi.fn(async () => ({ release })),
      end: vi.fn(async () => undefined),
      on: vi.fn(),
      query,
      removeListener: vi.fn(),
    },
    query,
    release,
  };
}

describe('routine-deposit PostgreSQL runtime', () => {
  it('uses one verify-full connection and accepts only the exact function-only boundary', async () => {
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain(
      "current_user = 'fetanagent_routine_deposit_broker_runtime'",
    );
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain('session_user = current_user');
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain('not runtime_role.rolbypassrls');
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain('membership.inherit_option');
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain('not membership.set_option');
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain('as schema_usage');
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain(
      'app.execute_agent_platform_routine_deposit_command',
    );
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain('has_any_column_privilege');
    expect(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL).toContain(
      "when relation.relkind = 'S' then pg_catalog.has_sequence_privilege",
    );
    const fake = fakePool(preflightRow());
    let observedConfig: Readonly<Record<string, unknown>> | undefined;
    const runtime = await createRoutineDepositPostgresRuntime(
      connection,
      'companion_server_signer_2026_01',
      'companion-execution-production-v1',
      {
        createPool: (config) => {
          observedConfig = config;
          return fake.pool;
        },
      },
    );
    expect(observedConfig).toMatchObject({
      application_name: 'fetanagent_routine_deposit_broker',
      max: 1,
      min: 0,
      user: connection.user,
      ssl: { ca: connection.ca, rejectUnauthorized: true },
    });
    expect(observedConfig).not.toHaveProperty('connectionString');
    expect(fake.release).toHaveBeenCalledTimes(1);
    await expect(runtime.ready()).resolves.toBe(true);
    await runtime.close();
    expect(fake.pool.end).toHaveBeenCalledTimes(1);
    await expect(runtime.ready()).resolves.toBe(false);
  });

  it('fails startup closed for false, extra, or missing catalog assertions', async () => {
    for (const row of [
      preflightRow({ schema_usage: false }),
      { ...preflightRow(), unexpected: true },
      {
        capability_member: true,
        command_allowed: true,
        command_hardened: true,
        exact_runtime: true,
        no_app_relation_privileges: true,
      },
    ]) {
      const fake = fakePool(row);
      await expect(
        createRoutineDepositPostgresRuntime(
          connection,
          'companion_server_signer_2026_01',
          'companion-execution-production-v1',
          { createPool: () => fake.pool },
        ),
      ).rejects.toThrow(CompanionDeviceStateUnavailableError);
      expect(fake.pool.end).toHaveBeenCalledTimes(1);
    }
  });
});
