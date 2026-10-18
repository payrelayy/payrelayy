import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import type { Client } from 'pg';

import { createSqlIntegrationClient, readSqlIntegrationEnvironment } from './environment.js';
import { listMigrationsLexically } from './migration-runner.js';
import { applySyntheticSupabaseBootstrap } from './synthetic-bootstrap.js';

// The 18 October 2026 read-only staging check showed 87/272 applied,
// 185 pending, and these four older gaps before the latest applied version.
// It also showed only the private pilot in dry_run with a three-field manifest;
// the other six switches remain disabled. This fixture contains no staging
// schema, data, manifest values, or credentials.
const latestAppliedVersion = '20260915190000';
const observedLatestRepositoryVersion = '20261018170000';
const allDisabledPreflightMigration =
  '20261011183500_routine_paid_poll_idles_with_deposits_disabled.sql';
const olderMissingVersions = new Set([
  '20260912233000',
  '20260914030000',
  '20260914123000',
  '20260914165043',
]);

async function applyMigrationFiles(
  client: Client,
  migrationsDirectory: string,
  names: readonly string[],
  phase: 'staging-ledger baseline' | 'pending catch-up',
): Promise<void> {
  for (const name of names) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    if (sql.trim() === '') throw new Error(`${phase} contains an empty migration: ${name}`);
    try {
      await client.query(sql);
      await client.query('insert into sql_integration.applied_migrations (filename) values ($1)', [
        name,
      ]);
    } catch (error) {
      throw new Error(`${phase} failed at ${name}`, { cause: error });
    }
  }
}

it('rehearses a staging-ledger-shaped catch-up with no staging connection or customer data', async () => {
  const environment = readSqlIntegrationEnvironment();
  const migrations = await listMigrationsLexically(environment.migrationsDirectory);
  const version = (name: string): string => name.slice(0, 14);
  const alreadyApplied = migrations.filter(
    (name) => version(name) <= latestAppliedVersion && !olderMissingVersions.has(version(name)),
  );
  const pending = migrations.filter((name) => !alreadyApplied.includes(name));

  expect(
    migrations.filter((name) => version(name) <= observedLatestRepositoryVersion),
  ).toHaveLength(272);
  expect(alreadyApplied).toHaveLength(87);
  expect(pending.filter((name) => version(name) <= observedLatestRepositoryVersion)).toHaveLength(
    185,
  );
  expect(pending).toHaveLength(migrations.length - alreadyApplied.length);
  expect(pending.filter((name) => version(name) < latestAppliedVersion).map(version)).toEqual(
    [...olderMissingVersions].sort(),
  );
  const preflightIndex = pending.indexOf(allDisabledPreflightMigration);
  expect(preflightIndex).toBeGreaterThanOrEqual(0);

  // PostgreSQL roles are cluster-wide, so use a separate one-use server rather
  // than another database on the full clean-replay suite's server.
  const client = createSqlIntegrationClient(environment, environment.stagingRehearsalHost);
  await client.connect();
  try {
    await applySyntheticSupabaseBootstrap(client);
    // Match the existing disposable runner's marker and applied-file ledger.
    // Some production-only migrations use this marker to omit hosted pg_cron setup.
    await client.query('create schema sql_integration');
    await client.query(`
      create table sql_integration.applied_migrations (
        filename text primary key,
        applied_at timestamptz not null default clock_timestamp()
      )
    `);
    await applyMigrationFiles(
      client,
      environment.migrationsDirectory,
      alreadyApplied,
      'staging-ledger baseline',
    );
    const pilot = await client.query<{ feature_key: string; mode: string }>(`
      update app.feature_switches
         set mode = 'dry_run',
             settings = pg_catalog.jsonb_build_object(
               'contract_version', 1,
               'pilot_revision_id', '00000000-0000-4000-8000-000000000001',
               'configuration_digest', 'sha256:' || pg_catalog.repeat('0', 64)
             )
       where feature_key = 'private_live_deposit_pilot'
      returning feature_key, mode::text
    `);
    expect(pilot.rows).toEqual([{ feature_key: 'private_live_deposit_pilot', mode: 'dry_run' }]);
    const syntheticManifest = await client.query<{ keys: string[] }>(`
      select pg_catalog.array_agg(manifest_key.key_name order by manifest_key.key_name) as keys
        from app.feature_switches feature_switch,
             pg_catalog.jsonb_object_keys(feature_switch.settings) as manifest_key(key_name)
       where feature_switch.feature_key = 'private_live_deposit_pilot'
    `);
    expect(syntheticManifest.rows).toEqual([
      { keys: ['configuration_digest', 'contract_version', 'pilot_revision_id'] },
    ]);
    await applyMigrationFiles(
      client,
      environment.migrationsDirectory,
      pending.slice(0, preflightIndex),
      'pending catch-up',
    );
    await expect(
      applyMigrationFiles(
        client,
        environment.migrationsDirectory,
        [allDisabledPreflightMigration],
        'pending catch-up',
      ),
    ).rejects.toMatchObject({
      message: `pending catch-up failed at ${allDisabledPreflightMigration}`,
      cause: { message: 'The seven financial switches must remain disabled.' },
    });
    await client.query('rollback');

    // The synthetic run can continue only after the private pilot is disabled.
    // This is a required staging change, not an action performed by this test.
    const pausedPilot = await client.query<{ feature_key: string; mode: string }>(`
      update app.feature_switches
         set mode = 'disabled', settings = '{}'::jsonb
       where feature_key = 'private_live_deposit_pilot'
      returning feature_key, mode::text
    `);
    expect(pausedPilot.rows).toEqual([
      { feature_key: 'private_live_deposit_pilot', mode: 'disabled' },
    ]);
    await applyMigrationFiles(
      client,
      environment.migrationsDirectory,
      pending.slice(preflightIndex),
      'pending catch-up',
    );

    const applied = await client.query<{ count: number }>(`
      select count(*)::integer as count from sql_integration.applied_migrations
    `);
    expect(applied.rows).toEqual([{ count: migrations.length }]);

    const switches = await client.query<{ feature_key: string; mode: string }>(`
      select feature_key, mode::text
      from app.feature_switches
      order by feature_key
    `);
    expect(switches.rows).toHaveLength(7);
    expect(switches.rows.every((row) => row.mode === 'disabled')).toBe(true);
    const settingsCount = await client.query<{ count: number }>(`
      select pg_catalog.count(*)::integer as count
        from app.feature_switches
       where settings <> '{}'::jsonb
    `);
    expect(settingsCount.rows).toEqual([{ count: 0 }]);

    const moneyRows = await client.query<{ intents: number; attempts: number }>(`
      select
        (select count(*)::integer from app.deposit_intents) as intents,
        (select count(*)::integer from app.deposit_execution_attempts) as attempts
    `);
    expect(moneyRows.rows).toEqual([{ intents: 0, attempts: 0 }]);
  } finally {
    await client.end();
    // The one-use Compose project removes this entire server after the suite.
  }
}, 180_000);
