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

async function seedSyntheticCbeHistory(client: Client): Promise<void> {
  const receiver = await client.query<{ id: string; provider_id: string }>(`
    insert into app.receiver_accounts (
      provider_id, version, account_holder_name, account_reference_ciphertext,
      account_reference_masked, account_reference_fingerprint,
      protection_profile_version, encryption_key_version, fingerprint_key_version,
      rotation_request_id, rotation_reason, instructions
    )
    select provider.id, 2, 'Synthetic CBE Receiver',
           'receiver-v1.cbe_birr.' || repeat('A', 16) || '.' || repeat('B', 22) || '.' || repeat('C', 16),
           '***9001', repeat('7', 64), 1, 1, 1,
           gen_random_uuid(), 'initial_configuration',
           jsonb_build_object('customer_message', 'Synthetic SQL fixture only')
      from app.payment_providers provider
     where provider.code = 'cbe_birr'
    returning id, provider_id
  `);
  expect(receiver.rows).toHaveLength(1);

  const customer = await client.query<{ id: string }>(`
    insert into app.customers default values returning id
  `);
  const player = await client.query<{ id: string; platform_id: string }>(
    `insert into app.customer_platform_players (customer_id, platform_id, player_id)
     select $1::uuid, platform.id, 'SYNTHETIC-CBE-STAGING-HISTORY'
       from app.platforms platform where platform.code = 'kemerbet'
     returning id, platform_id`,
    [customer.rows[0]!.id],
  );
  expect(player.rows).toHaveLength(1);
  await client.query(
    `insert into app.player_validation_attempts (
       player_account_id, attempt_number, outcome, reason_code, adapter_version,
       started_at, completed_at, result_digest
     ) values (
       $1::uuid, 1, 'valid', 'synthetic_rehearsal', 'fixture_v1',
       clock_timestamp() - interval '1 second', clock_timestamp(),
       'synthetic-cbe-staging-validation'
     )`,
    [player.rows[0]!.id],
  );
  await client.query(
    `update app.customer_platform_players
        set validation_status = 'valid'
      where id = $1::uuid`,
    [player.rows[0]!.id],
  );
  await client.query(
    `insert into app.player_deposit_eligibility_decisions (
       player_account_id, decision_version, decision, reason_code, actor_kind
     ) values ($1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system')`,
    [player.rows[0]!.id],
  );

  for (let index = 1; index <= 3; index += 1) {
    const intent = await client.query<{ id: string }>(
      `insert into app.deposit_intents (
         customer_id, platform_id, player_account_id, payment_provider_id,
         receiver_account_id, expected_amount_minor
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)
       returning id`,
      [
        customer.rows[0]!.id,
        player.rows[0]!.platform_id,
        player.rows[0]!.id,
        receiver.rows[0]!.provider_id,
        receiver.rows[0]!.id,
      ],
    );
    expect(intent.rows).toHaveLength(1);
    if (index <= 2) {
      await client.query(
        `insert into app.deposit_submissions (
           deposit_intent_id, submission_number, submitted_reference_ciphertext,
           submitted_reference_fingerprint, submitted_reference_masked,
           reference_encryption_key_version
         ) values ($1::uuid, 1, $2::text, $3::text, $4::text, 1)`,
        [
          intent.rows[0]!.id,
          `synthetic-cbe-ciphertext-${index}`,
          String(index).repeat(64),
          `***900${index}`,
        ],
      );
    }
  }
}

it('rehearses a staging-ledger-shaped catch-up with no staging connection or real customer data', async () => {
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
    const catalogFingerprintSql = await readFile(
      new URL('../../../infra/sql/staging-cbe-catalog-fingerprint.sql', import.meta.url),
      'utf8',
    );
    const catalogFingerprint = await client.query<{
      category: string;
      object_count: number;
      definition_md5: string;
    }>(catalogFingerprintSql);
    // The expected hashes were observed through the read-only query against
    // staging on 18 October 2026. No schema body or customer row is copied.
    expect(catalogFingerprint.rows).toEqual([
      {
        category: 'columns',
        object_count: 1265,
        definition_md5: 'a372f8008f2ac92a21163ebfeffc85cc',
      },
      {
        category: 'constraints',
        object_count: 1172,
        definition_md5: 'ddad031c3c9ce4b21117f58023af9fb5',
      },
      { category: 'enums', object_count: 97, definition_md5: '89b3f78fc049863fc64e99e027b79806' },
      {
        category: 'functions',
        object_count: 333,
        definition_md5: '6c36754b59f1a17967581ef048a2a507',
      },
      {
        category: 'indexes',
        object_count: 549,
        definition_md5: 'd00ec89a7d1c18a7fe7c6dee860b1972',
      },
      {
        category: 'policies',
        object_count: 12,
        definition_md5: 'a0f42b0b324203205e87ce680fbfcb81',
      },
      {
        category: 'relations',
        object_count: 113,
        definition_md5: '0b3ab3766c9e2d9466b519ea3d5aaacd',
      },
      {
        category: 'triggers',
        object_count: 291,
        definition_md5: '6839548c09245fee0d444186cecd78cf',
      },
    ]);
    // Match the aggregate legacy CBE row shapes seen in staging, using invented values only.
    await seedSyntheticCbeHistory(client);
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

    const moneyRows = await client.query<{
      intents: number;
      intake_received_intents: number;
      submissions: number;
      received_submissions: number;
      attempts: number;
      jobs: number;
      cbe_instructions: number;
      cbe_proof_bindings: number;
      cbe_v2_lookup_revisions: number;
    }>(`
      select
        (select count(*)::integer from app.deposit_intents) as intents,
        (select count(*)::integer from app.deposit_intents
          where status = 'intake_received') as intake_received_intents,
        (select count(*)::integer from app.deposit_submissions) as submissions,
        (select count(*)::integer from app.deposit_submissions
          where status = 'received') as received_submissions,
        (select count(*)::integer from app.deposit_execution_attempts) as attempts,
        (select count(*)::integer from app.deposit_jobs) as jobs,
        (select count(*)::integer from app.cbe_birr_payment_instructions) as cbe_instructions,
        (select count(*)::integer from app.cbe_birr_instruction_proof_bindings) as cbe_proof_bindings,
        (select count(*)::integer from app.cbe_birr_receiver_lookup_revisions) as cbe_v2_lookup_revisions
    `);
    expect(moneyRows.rows).toEqual([
      {
        intents: 3,
        intake_received_intents: 3,
        submissions: 2,
        received_submissions: 2,
        attempts: 0,
        jobs: 0,
        cbe_instructions: 0,
        cbe_proof_bindings: 0,
        cbe_v2_lookup_revisions: 0,
      },
    ]);
  } finally {
    await client.end();
    // The one-use Compose project removes this entire server after the suite.
  }
}, 180_000);
