import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';

import {
  createSqlIntegrationClient,
  readSqlIntegrationEnvironment,
  type SqlIntegrationEnvironment,
} from './environment.js';
import { registerDepositExecutionCommandSqlTests } from './deposit-execution-commands.suite.js';
import { registerLiveCustomerDepositIntakeSqlTests } from './live-customer-deposit-intake.suite.js';
import { registerLiveDepositExecutionLineageSqlTests } from './live-deposit-execution-lineage.suite.js';
import { applyMigrationsLexically, listMigrationsLexically } from './migration-runner.js';
import { applySyntheticSupabaseBootstrap } from './synthetic-bootstrap.js';
import { registerVerificationSettlementSqlTests } from './verification-settlement.suite.js';

type RoleRow = {
  readonly rolbypassrls: boolean;
  readonly rolcanlogin: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolinherit: boolean;
  readonly rolname: string;
  readonly rolreplication: boolean;
  readonly rolsuper: boolean;
};

type MembershipRow = {
  readonly admin_option: boolean;
  readonly group_role: string;
  readonly inherit_option: boolean;
  readonly member_role: string;
  readonly set_option: boolean;
};

type RlsRow = {
  readonly relforcerowsecurity: boolean;
  readonly relname: string;
  readonly relrowsecurity: boolean;
};

type AdmissionFunctionCatalogRow = {
  readonly beta_admission_execute_allowed: boolean;
  readonly beta_admission_runtime_direct_execute_allowed: boolean;
  readonly beta_admission_runtime_effective_execute_allowed: boolean;
  readonly generic_api_execute_allowed: boolean;
  readonly generic_api_runtime_execute_allowed: boolean;
  readonly is_security_definer: boolean;
  readonly public_execute_allowed: boolean;
  readonly safe_search_path: boolean;
  readonly signature: string;
  readonly worker_execute_allowed: boolean;
};

type AdmissionReceiptRow = {
  readonly inbound_event_already_recorded: boolean;
  readonly inbound_event_id: string;
  readonly received_at: Date;
};

type NonceReservationRow = {
  readonly reserved: boolean;
};

type PlayerActionCapabilityRow = {
  readonly capability_expires_at: Date;
  readonly expected_conversation_version: string;
  readonly origin_inbound_event_already_consumed: boolean;
  readonly result_capability_id: string;
};

type AdmissionWriteSnapshot = {
  readonly active_invites: number;
  readonly audit_events: number;
  readonly bot_conversations: number;
  readonly customer_identities: number;
  readonly customers: number;
  readonly inbound_events: number;
  readonly redeemed_invites: number;
  readonly telegram_identities: number;
  readonly telegram_beta_invites: number;
};

type CustomerWebFinancialSnapshot = {
  readonly snapshot: string;
};

type CustomerWebSubmitRow = {
  readonly existing_request_reused: boolean;
  readonly platform_code: string;
  readonly request_created_at: Date;
  readonly request_key_already_used: boolean;
  readonly request_status: string;
};

type ValidatedPlayerFixture = {
  readonly customerId: string;
  readonly platformId: string;
  readonly playerAccountId: string;
};

type ExecutionIntentFixture = ValidatedPlayerFixture & {
  readonly depositIntentId: string;
};

const legacyPrivateInboundRecorder =
  'app.record_telegram_private_inbound_event(bigint,bigint,bigint,text,text,text,text,text)';
const betaInviteRedemptionProcedure =
  'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)';
const admittedPrivateInboundRecorder =
  'app.record_admitted_telegram_private_inbound_event(bigint,bigint,bigint,text,text)';
const betaAdmissionNonceReservationProcedure =
  'app.reserve_telegram_beta_invite_admission_nonce(text,timestamptz)';
const betaAdmissionNoncePurgeProcedure =
  'app.purge_expired_telegram_beta_invite_admission_nonce_reservations(integer)';
const betaInviteAdmissionMigrationName =
  '20260809195620_private_telegram_beta_invite_admission.sql';

const payloadHmac = (hexCharacter: string): string => `hmac-sha256-v1:${hexCharacter.repeat(64)}`;
const inviteDigest = (hexCharacter: string): string => `sha256-v1:${hexCharacter.repeat(64)}`;
const nonceDigest = (hexCharacter: string): string => hexCharacter.repeat(64);

async function queryAsRole<T extends QueryResultRow>(
  role:
    | 'fetanagent_api'
    | 'fetanagent_beta_admission'
    | 'fetanagent_cbe_birr_shadow_worker'
    | 'fetanagent_customer_web'
    | 'fetanagent_owner_control'
    | 'fetanagent_player_actions',
  query: string,
  values: readonly (number | string | null)[] = [],
): Promise<readonly T[]> {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    const result = await client.query<T>(query, [...values]);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function queryAsMigrationOwner<T extends QueryResultRow>(
  query: string,
  values: readonly (number | string | null)[] = [],
): Promise<readonly T[]> {
  const result = await client.query<T>(query, [...values]);
  return result.rows;
}

async function readAdmissionWriteSnapshot(): Promise<AdmissionWriteSnapshot> {
  const result = await client.query<AdmissionWriteSnapshot>(`
    select
      (select count(*)::integer from app.customers) as customers,
      (select count(*)::integer from app.customer_identities) as customer_identities,
      (select count(*)::integer from app.telegram_identities) as telegram_identities,
      (select count(*)::integer from app.bot_conversations) as bot_conversations,
      (select count(*)::integer from app.inbound_events) as inbound_events,
      (select count(*)::integer from app.audit_events) as audit_events,
      (select count(*)::integer from app.telegram_beta_invites) as telegram_beta_invites,
      (
        select count(*)::integer
        from app.telegram_beta_invites
        where status = 'active'
      ) as active_invites,
      (
        select count(*)::integer
        from app.telegram_beta_invites
        where status = 'redeemed'
      ) as redeemed_invites
  `);

  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function readBetaAdmissionNonceReservationCount(): Promise<number> {
  const result = await client.query<{ readonly reservations: number }>(`
    select count(*)::integer as reservations
    from app.telegram_beta_invite_admission_nonce_reservations
  `);

  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.reservations;
}

async function readCustomerWebFinancialSnapshot(): Promise<CustomerWebFinancialSnapshot> {
  const result = await client.query<CustomerWebFinancialSnapshot>(`
    select jsonb_build_object(
      'deposit_intents', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_intents
      ),
      'deposit_submissions', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_submissions
      ),
      'deposit_submission_files', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_submission_files
      ),
      'provider_payment_evidence', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.provider_payment_evidence
      ),
      'deposit_verification_attempts', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_verification_attempts
      ),
      'deposit_payment_claims', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_payment_claims
      ),
      'deposit_jobs', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_jobs
      ),
      'deposit_execution_attempts', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_execution_attempts
      ),
      'execution_reconciliations', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.execution_reconciliations
      ),
      'deposit_review_cases', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_review_cases
      ),
      'deposit_state_events', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_state_events
      ),
      'deposit_policy_versions', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_policy_versions
      ),
      'deposit_dry_run_fixture_assessments', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_dry_run_fixture_assessments
      ),
      'deposit_dry_run_fixture_reviews', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.deposit_dry_run_fixture_reviews
      ),
      'feature_switches', (
        select coalesce(jsonb_agg(jsonb_build_array(feature_key, xmin::text, ctid::text)
          order by feature_key), '[]'::jsonb)
        from app.feature_switches
      ),
      'customer_platform_players', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.customer_platform_players
      ),
      'player_deposit_eligibility_decisions', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.player_deposit_eligibility_decisions
      ),
      'player_validation_attempts', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.player_validation_attempts
      ),
      'player_registration_request_associations', (
        select coalesce(jsonb_agg(jsonb_build_array(id, xmin::text, ctid::text)
          order by id), '[]'::jsonb)
        from app.player_registration_request_associations
      )
    )::text as snapshot
  `);

  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function createValidatedPlayerFixture(playerId: string): Promise<ValidatedPlayerFixture> {
  const customer = await client.query<{ readonly id: string }>(
    `insert into app.customers default values returning id`,
  );
  const customerId = customer.rows[0]!.id;
  const platform = await client.query<{ readonly id: string }>(
    `select id from app.platforms where code = 'kemerbet'`,
  );
  const platformId = platform.rows[0]!.id;
  const player = await client.query<{ readonly id: string }>(
    `insert into app.customer_platform_players (customer_id, platform_id, player_id)
     values ($1::uuid, $2::uuid, $3::text)
     returning id`,
    [customerId, platformId, playerId],
  );
  const playerAccountId = player.rows[0]!.id;

  await client.query(
    `insert into app.player_validation_attempts (
       player_account_id, attempt_number, outcome, reason_code, adapter_version,
       started_at, completed_at, result_digest
     ) values (
       $1::uuid, 1, 'valid', 'sql_eligibility_fixture', 'sql_eligibility_fixture_v1',
       clock_timestamp() - interval '1 second', clock_timestamp(),
       'sql-eligibility-fixture'
     )`,
    [playerAccountId],
  );
  await client.query(
    `update app.customer_platform_players
        set validation_status = 'valid'
      where id = $1::uuid`,
    [playerAccountId],
  );

  return { customerId, platformId, playerAccountId };
}

async function createExecutionIntentFixture(playerId: string): Promise<ExecutionIntentFixture> {
  const player = await createValidatedPlayerFixture(playerId);
  await client.query(
    `insert into app.player_deposit_eligibility_decisions (
       player_account_id, decision_version, decision, reason_code, actor_kind
     ) values (
       $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
     )`,
    [player.playerAccountId],
  );

  const paymentBoundary = await client.query<{
    readonly payment_provider_id: string;
    readonly receiver_account_id: string;
  }>(`
    select payment_provider.id as payment_provider_id,
           receiver_account.id as receiver_account_id
      from app.payment_providers payment_provider
      join app.receiver_accounts receiver_account
        on receiver_account.provider_id = payment_provider.id
       and receiver_account.status = 'active'
     where payment_provider.code = 'cbe_birr'
       and payment_provider.status = 'active'
  `);
  expect(paymentBoundary.rows).toHaveLength(1);

  const depositIntent = await client.query<{ readonly id: string }>(
    `insert into app.deposit_intents (
       customer_id, platform_id, player_account_id, payment_provider_id,
       receiver_account_id, expected_amount_minor
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)
     returning id`,
    [
      player.customerId,
      player.platformId,
      player.playerAccountId,
      paymentBoundary.rows[0]!.payment_provider_id,
      paymentBoundary.rows[0]!.receiver_account_id,
    ],
  );

  return {
    ...player,
    depositIntentId: depositIntent.rows[0]!.id,
  };
}

async function expectSqlFailureInTransaction(
  query: string,
  values: readonly (boolean | number | string | null)[],
  message: RegExp | string,
): Promise<void> {
  await client.query('savepoint expected_sql_failure');
  try {
    await expect(client.query(query, [...values])).rejects.toThrow(message);
  } finally {
    await client.query('rollback to savepoint expected_sql_failure');
    await client.query('release savepoint expected_sql_failure');
  }
}

let environment: SqlIntegrationEnvironment;
let client: ReturnType<typeof createSqlIntegrationClient>;
let appliedMigrationNames: readonly string[];
const ownerAuthUserId = '11111111-1111-4111-8111-111111111111';
const customerWebAuthUserId = '21111111-1111-4111-8111-111111111111';
const secondCustomerWebAuthUserId = '21111111-1111-4111-8111-222222222222';
let ownerAdminId: string;

beforeAll(async () => {
  environment = readSqlIntegrationEnvironment();
  client = createSqlIntegrationClient(environment);

  await client.connect();
  await applySyntheticSupabaseBootstrap(client);
  appliedMigrationNames = await applyMigrationsLexically(client, environment.migrationsDirectory);
  await client.query(
    `insert into auth.users (id, email) values ($1::uuid, 'owner@example.invalid')`,
    [ownerAuthUserId],
  );
  const owner = await client.query<{ readonly admin_id: string }>(
    `select app.bootstrap_first_owner($1::uuid, 'Test Owner') as admin_id`,
    [ownerAuthUserId],
  );
  ownerAdminId = owner.rows[0]!.admin_id;
});

afterAll(async () => {
  await client?.end();
});

describe('disposable SQL migration baseline', () => {
  it('applies every checked-in migration in lexical filename order', async () => {
    const expectedMigrationNames = await listMigrationsLexically(environment.migrationsDirectory);
    const appliedRows = await client.query<{ readonly filename: string }>(`
      select filename
      from sql_integration.applied_migrations
      order by filename
    `);

    expect(appliedMigrationNames).toEqual(expectedMigrationNames);
    expect(appliedRows.rows.map((row) => row.filename)).toEqual(expectedMigrationNames);
    expect(expectedMigrationNames).toEqual([...expectedMigrationNames].sort());
  });

  it('fails the invite-only cutover when historical Telegram data exists', async () => {
    const migrationSource = await readFile(
      join(environment.migrationsDirectory, betaInviteAdmissionMigrationName),
      'utf8',
    );
    const preflightStart = migrationSource.indexOf('do $$');
    const preflightEnd = migrationSource.indexOf('$$;', preflightStart);

    expect(preflightStart).toBeGreaterThanOrEqual(0);
    expect(preflightEnd).toBeGreaterThan(preflightStart);
    expect(migrationSource).toContain('lock table app.inbound_events in access exclusive mode;');
    expect(migrationSource).toContain('lock table app.bot_conversations in access exclusive mode;');
    expect(migrationSource).toContain(
      'lock table app.telegram_identities in access exclusive mode;',
    );
    expect(migrationSource).toContain(
      'lock table app.customer_identities in access exclusive mode;',
    );

    const legacyTelegramPreflight = migrationSource.slice(
      preflightStart,
      preflightEnd + '$$;'.length,
    );
    const beforeGuard = await readAdmissionWriteSnapshot();

    await client.query('begin');
    try {
      const legacyCustomer = await client.query<{ readonly id: string }>(`
        insert into app.customers default values returning id
      `);
      const legacyCustomerId = legacyCustomer.rows[0]?.id;
      expect(legacyCustomerId).toEqual(expect.any(String));

      const legacyIdentity = await client.query<{ readonly id: string }>(
        `
          insert into app.customer_identities (customer_id, identity_kind, external_subject)
          values ($1::uuid, 'telegram', $2::text)
          returning id
        `,
        [legacyCustomerId, '9100000900'],
      );
      const legacyIdentityId = legacyIdentity.rows[0]?.id;
      expect(legacyIdentityId).toEqual(expect.any(String));

      await client.query(
        `
          insert into app.telegram_identities (
            customer_identity_id,
            telegram_user_id,
            private_chat_id,
            preferred_locale
          )
          values ($1::uuid, $2::bigint, $2::bigint, 'en')
        `,
        [legacyIdentityId, 9_100_000_900],
      );

      await expect(client.query(legacyTelegramPreflight)).rejects.toThrow(
        'Cannot enable invite-only Telegram beta admission while legacy Telegram identities, conversations, or inbound events exist.',
      );
    } finally {
      await client.query('rollback');
    }

    expect(await readAdmissionWriteSnapshot()).toEqual(beforeGuard);
  });

  it('keeps the app schema unavailable to public and Data API roles', async () => {
    const result = await client.query<{ readonly has_public_privilege: boolean }>(`
      select exists (
        select 1
        from pg_namespace as namespace
        cross join lateral aclexplode(
          coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))
        ) as privilege
        where namespace.nspname = 'app'
          and privilege.grantee = 0
          and privilege.privilege_type in ('USAGE', 'CREATE')
      ) as has_public_privilege
    `);
    const directRolePrivileges = await client.query<{
      readonly allowed: boolean;
      readonly role_name: string;
    }>(`
      select role_name, has_schema_privilege(role_name, 'app', 'USAGE') as allowed
      from unnest(array['anon', 'authenticated', 'service_role']) as candidate(role_name)
      order by role_name
    `);

    expect(result.rows).toEqual([{ has_public_privilege: false }]);
    expect(directRolePrivileges.rows).toEqual([
      { allowed: false, role_name: 'anon' },
      { allowed: false, role_name: 'authenticated' },
      { allowed: false, role_name: 'service_role' },
    ]);
  });

  it('preserves the no-login runtime-role scaffold and constrained memberships', async () => {
    const roleNames = [
      'fetanagent_api',
      'fetanagent_api_runtime',
      'fetanagent_beta_admission',
      'fetanagent_beta_admission_runtime',
      'fetanagent_cbe_birr_shadow_worker',
      'fetanagent_customer_web',
      'fetanagent_customer_web_runtime',
      'fetanagent_nonce_retention',
      'fetanagent_nonce_retention_runtime',
      'fetanagent_owner_control',
      'fetanagent_owner_control_runtime',
      'fetanagent_player_actions',
      'fetanagent_player_actions_runtime',
      'fetanagent_worker',
    ];
    const roles = await client.query<RoleRow>(
      `
        select
          rolname,
          rolcanlogin,
          rolsuper,
          rolcreatedb,
          rolcreaterole,
          rolreplication,
          rolinherit,
          rolbypassrls
        from pg_roles
        where rolname = any($1::text[])
        order by rolname
      `,
      [roleNames],
    );
    const memberships = await client.query<MembershipRow>(
      `
      select
        member_role.rolname as member_role,
        group_role.rolname as group_role,
        membership.inherit_option,
        membership.set_option,
        membership.admin_option
      from pg_auth_members as membership
      join pg_roles as group_role on group_role.oid = membership.roleid
      join pg_roles as member_role on member_role.oid = membership.member
      where member_role.rolname = any($1::text[])
         or group_role.rolname = any($1::text[])
      order by member_role, group_role
    `,
      [roleNames],
    );

    expect(roles.rows).toHaveLength(roleNames.length);
    expect(
      roles.rows.every(
        (role) =>
          !role.rolcanlogin &&
          !role.rolsuper &&
          !role.rolcreatedb &&
          !role.rolcreaterole &&
          !role.rolreplication &&
          !role.rolinherit &&
          !role.rolbypassrls,
      ),
    ).toBe(true);
    expect(memberships.rows).toEqual([
      {
        admin_option: false,
        group_role: 'fetanagent_api',
        inherit_option: true,
        member_role: 'fetanagent_api_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'fetanagent_beta_admission',
        inherit_option: true,
        member_role: 'fetanagent_beta_admission_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'fetanagent_customer_web',
        inherit_option: true,
        member_role: 'fetanagent_customer_web_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'fetanagent_nonce_retention',
        inherit_option: true,
        member_role: 'fetanagent_nonce_retention_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'fetanagent_owner_control',
        inherit_option: true,
        member_role: 'fetanagent_owner_control_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'fetanagent_player_actions',
        inherit_option: true,
        member_role: 'fetanagent_player_actions_runtime',
        set_option: false,
      },
    ]);
  });

  it('confines CBE Birr shadow verification to advisory procedures', async () => {
    const boundary = await client.query<{
      readonly claim_execute_denied: boolean;
      readonly functions_are_hardened: boolean;
      readonly jobs_forced_rls: boolean;
      readonly jobs_have_no_policies: boolean;
      readonly legacy_worker_execution_denied: boolean;
      readonly owner_can_enqueue: boolean;
      readonly owner_can_list: boolean;
      readonly owner_has_no_table_access: boolean;
      readonly preflight_is_hardened: boolean;
      readonly shadow_worker_can_preflight: boolean;
      readonly results_forced_rls: boolean;
      readonly results_have_no_policies: boolean;
      readonly shadow_worker_has_no_authoritative_table_access: boolean;
      readonly shadow_worker_has_no_table_access: boolean;
    }>(`
      select
        job_table.relrowsecurity and job_table.relforcerowsecurity as jobs_forced_rls,
        result_table.relrowsecurity and result_table.relforcerowsecurity as results_forced_rls,
        not exists (
          select 1 from pg_policy policy where policy.polrelid = job_table.oid
        ) as jobs_have_no_policies,
        not exists (
          select 1 from pg_policy policy where policy.polrelid = result_table.oid
        ) as results_have_no_policies,
        not has_table_privilege(
          'fetanagent_cbe_birr_shadow_worker', job_table.oid,
          'select,insert,update,delete,truncate,references,trigger'
        ) and not has_table_privilege(
          'fetanagent_cbe_birr_shadow_worker', result_table.oid,
          'select,insert,update,delete,truncate,references,trigger'
        ) as shadow_worker_has_no_table_access,
        not exists (
          select 1
          from unnest(array[
            'app.provider_payment_evidence',
            'app.deposit_verification_attempts',
            'app.deposit_payment_claims',
            'app.deposit_jobs'
          ]) protected_table(table_name)
          where has_table_privilege(
            'fetanagent_cbe_birr_shadow_worker', protected_table.table_name,
            'select,insert,update,delete,truncate,references,trigger'
          )
        ) as shadow_worker_has_no_authoritative_table_access,
        not has_table_privilege(
          'fetanagent_owner_control', job_table.oid,
          'select,insert,update,delete,truncate,references,trigger'
        ) and not has_table_privilege(
          'fetanagent_owner_control', result_table.oid,
          'select,insert,update,delete,truncate,references,trigger'
        ) as owner_has_no_table_access,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid)', 'execute'
        ) as owner_can_enqueue,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.list_owner_cbe_birr_shadow_verifications(uuid,integer)', 'execute'
        ) as owner_can_list,
        has_function_privilege(
          'fetanagent_cbe_birr_shadow_worker',
          'app.preflight_cbe_birr_shadow_verification_job(uuid)', 'execute'
        ) as shadow_worker_can_preflight,
        not exists (
          select 1
          from (
            values
              ('app.lease_cbe_birr_shadow_verification_job(uuid,integer)'::regprocedure),
              ('app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text)'::regprocedure),
              ('app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)'::regprocedure)
          ) legacy_function(procedure_oid)
          where has_function_privilege(
            'fetanagent_cbe_birr_shadow_worker', legacy_function.procedure_oid, 'execute'
          )
        ) as legacy_worker_execution_denied,
        not has_function_privilege(
          'fetanagent_cbe_birr_shadow_worker',
          'app.claim_verified_deposit_payment(uuid,uuid,uuid)', 'execute'
        ) as claim_execute_denied,
        (
          select procedure.prosecdef
             and procedure.provolatile = 's'
             and procedure.proowner = 'postgres'::regrole
             and procedure.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
          from pg_proc procedure
          where procedure.oid =
            'app.preflight_cbe_birr_shadow_verification_job(uuid)'::regprocedure
        ) as preflight_is_hardened,
        not exists (
          select 1
          from pg_proc procedure
          where procedure.oid in (
            'app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid)'::regprocedure,
            'app.list_owner_cbe_birr_shadow_verifications(uuid,integer)'::regprocedure,
            'app.lease_cbe_birr_shadow_verification_job(uuid,integer)'::regprocedure,
            'app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text)'::regprocedure,
            'app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)'::regprocedure
          ) and (
            not procedure.prosecdef
            or procedure.proowner <> 'postgres'::regrole
            or not (
              coalesce(procedure.proconfig, array[]::text[])
                @> array['search_path=pg_catalog, app, pg_temp']::text[]
            )
          )
        ) as functions_are_hardened
      from pg_class job_table
      join pg_namespace namespace on namespace.oid = job_table.relnamespace
      join pg_class result_table
        on result_table.relnamespace = namespace.oid
       and result_table.relname = 'cbe_birr_shadow_verification_results'
      where namespace.nspname = 'app'
        and job_table.relname = 'cbe_birr_shadow_verification_jobs'
    `);
    const workerFunctions = await client.query<{ readonly signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and has_function_privilege(
          'fetanagent_cbe_birr_shadow_worker', procedure.oid, 'execute'
        )
      order by signature
    `);
    const ownerListOutput = await client.query<{ readonly output_names: readonly string[] }>(`
      select procedure.proargnames[(procedure.pronargs + 1):] as output_names
      from pg_proc procedure
      where procedure.oid =
        'app.list_owner_cbe_birr_shadow_verifications(uuid,integer)'::regprocedure
    `);
    const preflightOutput = await client.query<{
      readonly argument_mode: string;
      readonly data_type: string;
      readonly output_name: string;
      readonly output_position: number;
    }>(`
      select
        (argument.ordinal_position - procedure.pronargs)::integer as output_position,
        argument.argument_name as output_name,
        argument.argument_mode::text as argument_mode,
        pg_catalog.format_type(argument.type_oid, null) as data_type
      from pg_proc procedure
      cross join lateral unnest(
        procedure.proallargtypes,
        procedure.proargmodes,
        procedure.proargnames
      ) with ordinality as argument(
        type_oid, argument_mode, argument_name, ordinal_position
      )
      where procedure.oid =
        'app.preflight_cbe_birr_shadow_verification_job(uuid)'::regprocedure
        and argument.argument_mode = 't'
      order by argument.ordinal_position
    `);
    const preflightDefinition = await client.query<{ readonly source: string }>(`
      select procedure.prosrc as source
      from pg_proc procedure
      where procedure.oid =
        'app.preflight_cbe_birr_shadow_verification_job(uuid)'::regprocedure
    `);
    const broadExecution = await client.query<{
      readonly allowed: boolean;
      readonly role_name: string;
    }>(`
      select denied_role.role_name,
             bool_or(has_function_privilege(
               denied_role.role_name, shadow_function.procedure_oid, 'execute'
             )) as allowed
      from (
        values ('anon'), ('authenticated'), ('service_role'),
               ('fetanagent_api'), ('fetanagent_api_runtime'),
               ('fetanagent_worker')
      ) denied_role(role_name)
      cross join (
        values
          ('app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid)'::regprocedure),
          ('app.list_owner_cbe_birr_shadow_verifications(uuid,integer)'::regprocedure),
          ('app.lease_cbe_birr_shadow_verification_job(uuid,integer)'::regprocedure),
          ('app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text)'::regprocedure),
          ('app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)'::regprocedure),
          ('app.preflight_cbe_birr_shadow_verification_job(uuid)'::regprocedure)
      ) shadow_function(procedure_oid)
      group by denied_role.role_name
      order by denied_role.role_name
    `);
    const preflightDeniedRoles = await client.query<{
      readonly allowed: boolean;
      readonly role_name: string;
    }>(`
      select denied_role.role_name,
             has_function_privilege(
               denied_role.role_name,
               'app.preflight_cbe_birr_shadow_verification_job(uuid)',
               'execute'
             ) as allowed
      from (
        values ('anon'), ('authenticated'), ('service_role'),
               ('fetanagent_api'), ('fetanagent_api_runtime'),
               ('fetanagent_beta_admission'), ('fetanagent_beta_admission_runtime'),
               ('fetanagent_nonce_retention'), ('fetanagent_nonce_retention_runtime'),
               ('fetanagent_owner_control'), ('fetanagent_owner_control_runtime'),
               ('fetanagent_player_actions'), ('fetanagent_player_actions_runtime'),
               ('fetanagent_worker')
      ) denied_role(role_name)
      order by denied_role.role_name
    `);
    const legacyMutationDeniedRoles = await client.query<{
      readonly allowed: boolean;
      readonly role_name: string;
    }>(`
      select denied_role.role_name,
             bool_or(has_function_privilege(
               denied_role.role_name, legacy_function.procedure_oid, 'execute'
             )) as allowed
      from (
        values ('anon'), ('authenticated'), ('service_role'),
               ('fetanagent_api'), ('fetanagent_api_runtime'),
               ('fetanagent_worker'),
               ('fetanagent_beta_admission'), ('fetanagent_beta_admission_runtime'),
               ('fetanagent_nonce_retention'), ('fetanagent_nonce_retention_runtime'),
               ('fetanagent_owner_control'), ('fetanagent_owner_control_runtime'),
               ('fetanagent_player_actions'), ('fetanagent_player_actions_runtime'),
               ('fetanagent_cbe_birr_shadow_worker')
      ) denied_role(role_name)
      cross join (
        values
          ('app.lease_cbe_birr_shadow_verification_job(uuid,integer)'::regprocedure),
          ('app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text)'::regprocedure),
          ('app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)'::regprocedure)
      ) legacy_function(procedure_oid)
      group by denied_role.role_name
      order by denied_role.role_name
    `);

    expect(boundary.rows).toEqual([
      {
        claim_execute_denied: true,
        functions_are_hardened: true,
        jobs_forced_rls: true,
        jobs_have_no_policies: true,
        legacy_worker_execution_denied: true,
        owner_can_enqueue: true,
        owner_can_list: true,
        owner_has_no_table_access: true,
        preflight_is_hardened: true,
        results_forced_rls: true,
        results_have_no_policies: true,
        shadow_worker_can_preflight: true,
        shadow_worker_has_no_authoritative_table_access: true,
        shadow_worker_has_no_table_access: true,
      },
    ]);
    expect(workerFunctions.rows.map((row) => row.signature)).toEqual([
      'app.preflight_cbe_birr_shadow_verification_job(uuid)',
    ]);
    expect(ownerListOutput.rows).toEqual([
      {
        output_names: [
          'job_id',
          'deposit_intent_id',
          'deposit_submission_id',
          'job_status',
          'attempt_count',
          'max_attempts',
          'run_after',
          'lease_expires_at',
          'created_at',
          'updated_at',
          'completed_at',
          'outcome',
          'reason_code',
          'result_completed_at',
        ],
      },
    ]);
    expect(preflightOutput.rows).toEqual([
      { argument_mode: 't', data_type: 'uuid', output_name: 'job_id', output_position: 1 },
      {
        argument_mode: 't',
        data_type: 'text',
        output_name: 'preflight_version',
        output_position: 2,
      },
      {
        argument_mode: 't',
        data_type: 'text',
        output_name: 'verifier_version',
        output_position: 3,
      },
      {
        argument_mode: 't',
        data_type: 'text',
        output_name: 'eligibility',
        output_position: 4,
      },
      {
        argument_mode: 't',
        data_type: 'text',
        output_name: 'blocker_code',
        output_position: 5,
      },
      {
        argument_mode: 't',
        data_type: 'boolean',
        output_name: 'lease_allowed',
        output_position: 6,
      },
      {
        argument_mode: 't',
        data_type: 'boolean',
        output_name: 'protected_material_allowed',
        output_position: 7,
      },
    ]);
    expect(preflightOutput.rows.map((row) => row.output_name).join(' ')).not.toMatch(
      /ciphertext|key|deposit|receiver|submission/u,
    );
    expect(preflightDefinition.rows).toHaveLength(1);
    const preflightSource = preflightDefinition.rows[0]!.source;
    expect(preflightSource).not.toMatch(
      /\bfor\s+(?:(?:no\s+)?key\s+)?update\b|\bfor\s+(?:key\s+)?share\b/iu,
    );
    expect(preflightSource).not.toMatch(
      /\b(?:insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|execute|perform)\b|pg_(?:try_)?advisory|require_financial_features_disabled_for_dry_run|reclaim_expired_cbe_birr_shadow_verification_jobs|(?:lease|complete|retry)_cbe_birr_shadow_verification_job|claim_verified_deposit_payment|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|deposit_state_events|kemerbet/iu,
    );
    expect(
      [...preflightSource.matchAll(/\bapp\.([a-z0-9_]+)/giu)]
        .map((match) => match[1])
        .filter((name, index, names) => names.indexOf(name) === index)
        .sort(),
    ).toEqual(['cbe_birr_shadow_verification_jobs', 'feature_switches']);
    expect(broadExecution.rows.every((row) => !row.allowed)).toBe(true);
    expect(preflightDeniedRoles.rows.every((row) => !row.allowed)).toBe(true);
    expect(legacyMutationDeniedRoles.rows.every((row) => !row.allowed)).toBe(true);
  });

  it('keeps every private app table under forced row-level security', async () => {
    const tables = await client.query<RlsRow>(`
      select class.relname, class.relrowsecurity, class.relforcerowsecurity
      from pg_class as class
      join pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'app'
        and class.relkind = 'r'
      order by class.relname
    `);

    expect(tables.rows.length).toBeGreaterThan(0);
    expect(tables.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(
      true,
    );
  });

  it('does not leave private app functions executable by public', async () => {
    const publiclyExecutableFunctions = await client.query<{ readonly signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      order by signature
    `);

    expect(publiclyExecutableFunctions.rows).toEqual([]);
  });

  it('keeps postgres function default privileges closed to public execution', async () => {
    const defaultFunctionAcls = await client.query<{
      readonly public_execute_allowed: boolean;
      readonly scope: string;
    }>(`
      select
        case
          when default_acl.defaclnamespace = 0 then 'global'
          else namespace.nspname
        end as scope,
        exists (
          select 1
          from aclexplode(
            coalesce(default_acl.defaclacl, acldefault('f', default_acl.defaclrole))
          ) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ) as public_execute_allowed
      from pg_default_acl as default_acl
      left join pg_namespace as namespace on namespace.oid = default_acl.defaclnamespace
      where default_acl.defaclrole = 'postgres'::regrole
        and default_acl.defaclobjtype = 'f'
      order by scope
    `);

    expect(defaultFunctionAcls.rows).toContainEqual({
      public_execute_allowed: false,
      scope: 'global',
    });
    expect(defaultFunctionAcls.rows.every((defaultAcl) => !defaultAcl.public_execute_allowed)).toBe(
      true,
    );
  });

  it('keeps Player-ID action procedures ungranted to the API runtime scaffold', async () => {
    const actionProcedureGrants = await client.query<{
      readonly allowed: boolean;
      readonly procedure_name: string;
    }>(`
      select
        procedure_name,
        has_function_privilege(
          'fetanagent_api_runtime',
          procedure_name::regprocedure,
          'EXECUTE'
        ) as allowed
      from unnest(array[
        'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
        'app.start_telegram_player_registration_action(uuid,uuid,text,text)',
        'app.submit_telegram_player_registration_input(uuid,text,text)',
        'app.expire_telegram_player_registration_action(uuid,text)'
      ]) as candidate(procedure_name)
      order by procedure_name
    `);

    expect(actionProcedureGrants.rows.every((procedure) => !procedure.allowed)).toBe(true);
  });

  it('gives the dedicated Player-ID runtime exactly eleven non-executing procedures', async () => {
    const functions = await client.query<{
      readonly group_allowed: boolean;
      readonly hardened: boolean;
      readonly public_allowed: boolean;
      readonly runtime_direct: boolean;
      readonly runtime_effective: boolean;
      readonly signature: string;
    }>(`
      select
        procedure.oid::regprocedure::text as signature,
        procedure.prosecdef
          and procedure.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
          and procedure.proowner = 'postgres'::regrole as hardened,
        has_function_privilege('fetanagent_player_actions', procedure.oid, 'EXECUTE')
          as group_allowed,
        has_function_privilege('fetanagent_player_actions_runtime', procedure.oid, 'EXECUTE')
          as runtime_effective,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
          where privilege.grantee = 'fetanagent_player_actions_runtime'::regrole
            and privilege.privilege_type = 'EXECUTE'
        ) as runtime_direct,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        ) as public_allowed
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and has_function_privilege('fetanagent_player_actions_runtime', procedure.oid, 'EXECUTE')
      order by signature
    `);
    expect(functions.rows.map((row) => row.signature)).toEqual([
      'app.capture_telegram_dry_run_deposit_reference(uuid,uuid,text,text,text,smallint,text)',
      'app.capture_telegram_live_deposit_reference(uuid,uuid,text,text,text,smallint,text)',
      'app.expire_telegram_player_registration_action(uuid,text)',
      'app.get_telegram_customer_deposit(uuid,uuid)',
      'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
      'app.open_telegram_dry_run_deposit_intent(uuid,text,bigint,text)',
      'app.open_telegram_live_deposit_intent(uuid,text,bigint,text)',
      admittedPrivateInboundRecorder,
      'app.reserve_telegram_private_action_nonce(text,timestamp with time zone)',
      'app.start_telegram_player_registration_action(uuid,uuid,text,text)',
      'app.submit_telegram_player_registration_input(uuid,text,text)',
    ]);
    expect(
      functions.rows.every(
        (row) =>
          row.group_allowed &&
          row.hardened &&
          !row.public_allowed &&
          !row.runtime_direct &&
          row.runtime_effective,
      ),
    ).toBe(true);

    const nonceTable = await client.query<{
      readonly policies: number;
      readonly relforcerowsecurity: boolean;
      readonly relrowsecurity: boolean;
    }>(`
      select relation.relrowsecurity, relation.relforcerowsecurity,
        (select count(*)::integer from pg_policy where polrelid = relation.oid) as policies
      from pg_class relation
      where relation.oid = 'app.telegram_private_action_nonce_reservations'::regclass
    `);
    expect(nonceTable.rows).toEqual([
      { policies: 0, relforcerowsecurity: true, relrowsecurity: true },
    ]);

    const digest = nonceDigest('9');
    await expect(
      queryAsRole<NonceReservationRow>(
        'fetanagent_player_actions',
        `select app.reserve_telegram_private_action_nonce($1::text, clock_timestamp() + interval '2 minutes') as reserved`,
        [digest],
      ),
    ).resolves.toEqual([{ reserved: true }]);
    await expect(
      queryAsRole<NonceReservationRow>(
        'fetanagent_player_actions',
        `select app.reserve_telegram_private_action_nonce($1::text, clock_timestamp() + interval '2 minutes') as reserved`,
        [digest],
      ),
    ).resolves.toEqual([{ reserved: false }]);
  });

  it('commits a Player-ID menu capability through the narrow runtime role', async () => {
    const tokenDigest = inviteDigest('f');
    const telegramUserId = 9_200_000_001;
    const capabilityId = '22222222-2222-4222-8222-222222222222';

    await client.query(
      `
        insert into app.telegram_beta_invites (
          token_digest,
          expires_at,
          issued_by_admin_id
        )
        values ($1::text, clock_timestamp() + interval '1 hour', $2::uuid)
      `,
      [tokenDigest, ownerAdminId],
    );

    await expect(
      queryAsRole<AdmissionReceiptRow>(
        'fetanagent_beta_admission',
        `
          select *
          from app.redeem_telegram_beta_invite(
            $1::bigint,
            $2::bigint,
            $3::bigint,
            $4::text,
            $5::text,
            $6::text
          )
        `,
        [9_200_000_001, telegramUserId, telegramUserId, tokenDigest, payloadHmac('1'), 'en'],
      ),
    ).resolves.toHaveLength(1);

    const inbound = await queryAsRole<AdmissionReceiptRow>(
      'fetanagent_player_actions',
      `
        select *
        from app.record_admitted_telegram_private_inbound_event(
          $1::bigint,
          $2::bigint,
          $3::bigint,
          $4::text,
          $5::text
        )
      `,
      [9_200_000_002, telegramUserId, telegramUserId, payloadHmac('2'), 'en'],
    );
    expect(inbound).toHaveLength(1);

    const capability = await queryAsRole<PlayerActionCapabilityRow>(
      'fetanagent_player_actions',
      `
        select *
        from app.issue_telegram_player_registration_capability(
          $1::uuid,
          $2::uuid,
          $3::text,
          $4::text
        )
      `,
      [inbound[0]!.inbound_event_id, capabilityId, payloadHmac('3'), payloadHmac('4')],
    );

    expect(capability).toHaveLength(1);
    expect(capability[0]).toMatchObject({
      expected_conversation_version: '0',
      origin_inbound_event_already_consumed: false,
      result_capability_id: capabilityId,
    });
    expect(capability[0]!.capability_expires_at).toBeInstanceOf(Date);

    const committedProjection = await client.query<{
      readonly capabilities: number;
      readonly receipts: number;
    }>(
      `
        select
          (
            select count(*)::integer
            from app.bot_action_capabilities
            where id = $1::uuid
              and issued_from_inbound_event_id = $2::uuid
          ) as capabilities,
          (
            select count(*)::integer
            from app.inbound_event_consumptions
            where origin_inbound_event_id = $2::uuid
              and consumer_kind = 'issue_player_registration_capability'
              and outcome = 'completed'
          ) as receipts
      `,
      [capabilityId, inbound[0]!.inbound_event_id],
    );
    expect(committedProjection.rows).toEqual([{ capabilities: 1, receipts: 1 }]);
  });

  it('keeps deferred Player-ID correspondence triggers owner-executed and private', async () => {
    const deferredTriggers = await client.query<{
      readonly fixed_search_path: boolean;
      readonly owner_is_postgres: boolean;
      readonly public_execute: boolean;
      readonly security_definer: boolean;
      readonly trigger_function: string;
    }>(`
      select
        procedure.oid::regprocedure::text as trigger_function,
        procedure.prosecdef as security_definer,
        procedure.proowner = 'postgres'::regrole as owner_is_postgres,
        procedure.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
          as fixed_search_path,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ) as public_execute
      from pg_proc procedure
      where procedure.oid in (
        'app.require_inbound_event_consumption_causal_result()'::regprocedure,
        'app.require_inbound_event_consumption_final_version()'::regprocedure,
        'app.require_bot_action_capability_receipt_correspondence()'::regprocedure,
        'app.require_bot_action_capability_terminal_rejection_correspondence()'::regprocedure,
        'app.require_bot_conversation_action_final_projection()'::regprocedure,
        'app.require_bot_conversation_action_receipt_correspondence()'::regprocedure,
        'app.require_player_registration_request_event_receipt_correspondenc()'::regprocedure
      )
      order by trigger_function
    `);

    expect(deferredTriggers.rows).toHaveLength(7);
    expect(
      deferredTriggers.rows.every(
        (trigger) =>
          trigger.fixed_search_path &&
          trigger.owner_is_postgres &&
          !trigger.public_execute &&
          trigger.security_definer,
      ),
    ).toBe(true);
  });

  it('keeps invite admission private, fixed-search-path, and narrowly executable', async () => {
    const admissionFunctions = await client.query<AdmissionFunctionCatalogRow>(`
      select
        procedure.oid::regprocedure::text as signature,
        procedure.prosecdef as is_security_definer,
        coalesce(procedure.proconfig, array[]::text[])
          @> array['search_path=pg_catalog, app, pg_temp']::text[] as safe_search_path,
        has_function_privilege('fetanagent_beta_admission', procedure.oid, 'EXECUTE')
          as beta_admission_execute_allowed,
        has_function_privilege('fetanagent_beta_admission_runtime', procedure.oid, 'EXECUTE')
          as beta_admission_runtime_effective_execute_allowed,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 'fetanagent_beta_admission_runtime'::regrole
            and privilege.privilege_type = 'EXECUTE'
        ) as beta_admission_runtime_direct_execute_allowed,
        has_function_privilege('fetanagent_api', procedure.oid, 'EXECUTE')
          as generic_api_execute_allowed,
        has_function_privilege('fetanagent_api_runtime', procedure.oid, 'EXECUTE')
          as generic_api_runtime_execute_allowed,
        has_function_privilege('fetanagent_worker', procedure.oid, 'EXECUTE')
          as worker_execute_allowed,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ) as public_execute_allowed
      from pg_proc as procedure
      where procedure.oid in (
        '${betaInviteRedemptionProcedure}'::regprocedure,
        '${admittedPrivateInboundRecorder}'::regprocedure
      )
      order by signature
    `);
    const inviteTable = await client.query<{
      readonly policies: number;
      readonly relforcerowsecurity: boolean;
      readonly relrowsecurity: boolean;
    }>(`
      select
        class.relrowsecurity,
        class.relforcerowsecurity,
        (
          select count(*)::integer
          from pg_policy as policy
          where policy.polrelid = class.oid
        ) as policies
      from pg_class as class
      where class.oid = 'app.telegram_beta_invites'::regclass
    `);
    const inviteTablePrivileges = await client.query<{
      readonly allowed: boolean;
      readonly role_name: string;
    }>(`
      select
        role_name,
        has_table_privilege(role_name, 'app.telegram_beta_invites', 'SELECT')
          or has_table_privilege(role_name, 'app.telegram_beta_invites', 'INSERT')
          or has_table_privilege(role_name, 'app.telegram_beta_invites', 'UPDATE')
          or has_table_privilege(role_name, 'app.telegram_beta_invites', 'DELETE') as allowed
      from unnest(array[
        'anon',
        'authenticated',
        'service_role',
        'fetanagent_api',
        'fetanagent_api_runtime',
        'fetanagent_beta_admission',
        'fetanagent_beta_admission_runtime',
        'fetanagent_worker'
      ]) as candidate(role_name)
      order by role_name
    `);
    const legacyRecorder = await client.query<{
      readonly api_execute_allowed: boolean;
      readonly exists: boolean;
      readonly runtime_execute_allowed: boolean;
    }>(`
      select
        to_regprocedure('${legacyPrivateInboundRecorder}') is not null as exists,
        has_function_privilege(
          'fetanagent_api',
          '${legacyPrivateInboundRecorder}'::regprocedure,
          'EXECUTE'
        ) as api_execute_allowed,
        has_function_privilege(
          'fetanagent_api_runtime',
          '${legacyPrivateInboundRecorder}'::regprocedure,
          'EXECUTE'
        ) as runtime_execute_allowed
    `);

    expect(admissionFunctions.rows.map((procedure) => procedure.signature)).toEqual([
      admittedPrivateInboundRecorder,
      betaInviteRedemptionProcedure,
    ]);
    const redemptionProcedure = admissionFunctions.rows.find(
      (procedure) => procedure.signature === betaInviteRedemptionProcedure,
    );
    const admittedInboxRecorder = admissionFunctions.rows.find(
      (procedure) => procedure.signature === admittedPrivateInboundRecorder,
    );

    expect(redemptionProcedure).toMatchObject({
      beta_admission_execute_allowed: true,
      beta_admission_runtime_direct_execute_allowed: false,
      beta_admission_runtime_effective_execute_allowed: true,
      generic_api_execute_allowed: false,
      generic_api_runtime_execute_allowed: false,
      is_security_definer: true,
      public_execute_allowed: false,
      safe_search_path: true,
      worker_execute_allowed: false,
    });
    expect(admittedInboxRecorder).toMatchObject({
      beta_admission_execute_allowed: false,
      beta_admission_runtime_direct_execute_allowed: false,
      beta_admission_runtime_effective_execute_allowed: false,
      generic_api_execute_allowed: false,
      generic_api_runtime_execute_allowed: false,
      is_security_definer: true,
      public_execute_allowed: false,
      safe_search_path: true,
      worker_execute_allowed: false,
    });
    expect(inviteTable.rows).toEqual([
      { policies: 0, relforcerowsecurity: true, relrowsecurity: true },
    ]);
    expect(inviteTablePrivileges.rows.every((privilege) => !privilege.allowed)).toBe(true);
    expect(legacyRecorder.rows).toEqual([
      { api_execute_allowed: false, exists: true, runtime_execute_allowed: false },
    ]);
  });

  it('keeps beta-admission nonce reservation private, forced-RLS, and narrowly executable', async () => {
    const nonceFunctions = await client.query<{
      readonly anon_execute_allowed: boolean;
      readonly authenticated_execute_allowed: boolean;
      readonly beta_admission_execute_allowed: boolean;
      readonly beta_admission_runtime_direct_execute_allowed: boolean;
      readonly beta_admission_runtime_effective_execute_allowed: boolean;
      readonly generic_api_execute_allowed: boolean;
      readonly generic_api_runtime_execute_allowed: boolean;
      readonly is_security_definer: boolean;
      readonly nonce_retention_execute_allowed: boolean;
      readonly nonce_retention_runtime_execute_allowed: boolean;
      readonly procedure_name: string;
      readonly public_execute_allowed: boolean;
      readonly safe_search_path: boolean;
      readonly service_role_execute_allowed: boolean;
      readonly worker_execute_allowed: boolean;
    }>(`
      select
        procedure.proname as procedure_name,
        procedure.prosecdef as is_security_definer,
        coalesce(procedure.proconfig, array[]::text[])
          @> array['search_path=pg_catalog, app, pg_temp']::text[] as safe_search_path,
        has_function_privilege('fetanagent_beta_admission', procedure.oid, 'EXECUTE')
          as beta_admission_execute_allowed,
        has_function_privilege('fetanagent_beta_admission_runtime', procedure.oid, 'EXECUTE')
          as beta_admission_runtime_effective_execute_allowed,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 'fetanagent_beta_admission_runtime'::regrole
            and privilege.privilege_type = 'EXECUTE'
        ) as beta_admission_runtime_direct_execute_allowed,
        has_function_privilege('fetanagent_api', procedure.oid, 'EXECUTE')
          as generic_api_execute_allowed,
        has_function_privilege('fetanagent_api_runtime', procedure.oid, 'EXECUTE')
          as generic_api_runtime_execute_allowed,
        has_function_privilege('fetanagent_worker', procedure.oid, 'EXECUTE')
          as worker_execute_allowed,
        has_function_privilege('fetanagent_nonce_retention', procedure.oid, 'EXECUTE')
          as nonce_retention_execute_allowed,
        has_function_privilege('fetanagent_nonce_retention_runtime', procedure.oid, 'EXECUTE')
          as nonce_retention_runtime_execute_allowed,
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
          as anon_execute_allowed,
        has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
          as authenticated_execute_allowed,
        has_function_privilege('service_role', procedure.oid, 'EXECUTE')
          as service_role_execute_allowed,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ) as public_execute_allowed
      from pg_proc as procedure
      where procedure.oid in (
        '${betaAdmissionNonceReservationProcedure}'::regprocedure,
        '${betaAdmissionNoncePurgeProcedure}'::regprocedure
      )
      order by procedure_name
    `);
    const nonceReservationTable = await client.query<{
      readonly policies: number;
      readonly public_table_access: boolean;
      readonly relforcerowsecurity: boolean;
      readonly relrowsecurity: boolean;
    }>(`
      select
        class.relrowsecurity,
        class.relforcerowsecurity,
        (
          select count(*)::integer
          from pg_policy as policy
          where policy.polrelid = class.oid
        ) as policies,
        exists (
          select 1
          from aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        ) as public_table_access
      from pg_class as class
      where class.oid = 'app.telegram_beta_invite_admission_nonce_reservations'::regclass
    `);
    const nonceReservationTablePrivileges = await client.query<{
      readonly allowed: boolean;
      readonly role_name: string;
    }>(`
      select
        role_name,
        has_table_privilege(
          role_name,
          'app.telegram_beta_invite_admission_nonce_reservations',
          'SELECT'
        )
          or has_table_privilege(
            role_name,
            'app.telegram_beta_invite_admission_nonce_reservations',
            'INSERT'
          )
          or has_table_privilege(
            role_name,
            'app.telegram_beta_invite_admission_nonce_reservations',
            'UPDATE'
          )
          or has_table_privilege(
            role_name,
            'app.telegram_beta_invite_admission_nonce_reservations',
            'DELETE'
          ) as allowed
      from unnest(array[
        'anon',
        'authenticated',
        'service_role',
        'fetanagent_api',
        'fetanagent_api_runtime',
        'fetanagent_beta_admission',
        'fetanagent_beta_admission_runtime',
        'fetanagent_nonce_retention',
        'fetanagent_nonce_retention_runtime',
        'fetanagent_worker'
      ]) as candidate(role_name)
      order by role_name
    `);

    expect(nonceFunctions.rows.map((procedure) => procedure.procedure_name)).toEqual([
      'purge_expired_telegram_beta_invite_admission_nonce_reservations',
      'reserve_telegram_beta_invite_admission_nonce',
    ]);
    const reserveProcedure = nonceFunctions.rows.find(
      (procedure) => procedure.procedure_name === 'reserve_telegram_beta_invite_admission_nonce',
    );
    const purgeProcedure = nonceFunctions.rows.find(
      (procedure) =>
        procedure.procedure_name ===
        'purge_expired_telegram_beta_invite_admission_nonce_reservations',
    );

    expect(reserveProcedure).toMatchObject({
      anon_execute_allowed: false,
      authenticated_execute_allowed: false,
      beta_admission_execute_allowed: true,
      beta_admission_runtime_direct_execute_allowed: false,
      beta_admission_runtime_effective_execute_allowed: true,
      generic_api_execute_allowed: false,
      generic_api_runtime_execute_allowed: false,
      is_security_definer: true,
      nonce_retention_execute_allowed: false,
      nonce_retention_runtime_execute_allowed: false,
      public_execute_allowed: false,
      safe_search_path: true,
      service_role_execute_allowed: false,
      worker_execute_allowed: false,
    });
    expect(purgeProcedure).toMatchObject({
      anon_execute_allowed: false,
      authenticated_execute_allowed: false,
      beta_admission_execute_allowed: false,
      beta_admission_runtime_direct_execute_allowed: false,
      beta_admission_runtime_effective_execute_allowed: false,
      generic_api_execute_allowed: false,
      generic_api_runtime_execute_allowed: false,
      is_security_definer: true,
      nonce_retention_execute_allowed: false,
      nonce_retention_runtime_execute_allowed: false,
      public_execute_allowed: false,
      safe_search_path: true,
      service_role_execute_allowed: false,
      worker_execute_allowed: false,
    });
    expect(nonceReservationTable.rows).toEqual([
      {
        policies: 0,
        public_table_access: false,
        relforcerowsecurity: true,
        relrowsecurity: true,
      },
    ]);
    expect(nonceReservationTablePrivileges.rows.every((privilege) => !privilege.allowed)).toBe(
      true,
    );
  });

  it('atomically reserves only valid beta-admission nonce digests', async () => {
    const acceptedDigest = nonceDigest('a');
    const reserveStatement = `
      select app.reserve_telegram_beta_invite_admission_nonce(
        $1::text,
        clock_timestamp() + interval '2 minutes'
      ) as reserved
    `;
    const beforeReservation = await readBetaAdmissionNonceReservationCount();
    const leftSession = createSqlIntegrationClient(environment);
    const rightSession = createSqlIntegrationClient(environment);

    await Promise.all([leftSession.connect(), rightSession.connect()]);
    try {
      await Promise.all([leftSession.query('begin'), rightSession.query('begin')]);
      await Promise.all([
        leftSession.query('set local role fetanagent_beta_admission'),
        rightSession.query('set local role fetanagent_beta_admission'),
      ]);

      const leftReservation = leftSession.query<NonceReservationRow>(reserveStatement, [
        acceptedDigest,
      ]);
      const rightReservation = rightSession.query<NonceReservationRow>(reserveStatement, [
        acceptedDigest,
      ]);
      const firstCompletedReservation = await Promise.race([
        leftReservation.then((result) => ({ result, session: leftSession })),
        rightReservation.then((result) => ({ result, session: rightSession })),
      ]);

      expect(firstCompletedReservation.result.rows).toEqual([{ reserved: true }]);
      await firstCompletedReservation.session.query('commit');

      const reservationOutcomes = await Promise.allSettled([leftReservation, rightReservation]);
      expect(reservationOutcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
      const reservationResults = reservationOutcomes.map((outcome) => {
        if (outcome.status !== 'fulfilled') {
          throw outcome.reason;
        }

        return outcome.value.rows[0]?.reserved;
      });
      expect(reservationResults).toContain(true);
      expect(reservationResults).toContain(false);
    } finally {
      await Promise.allSettled([leftSession.query('rollback'), rightSession.query('rollback')]);
      await Promise.allSettled([leftSession.end(), rightSession.end()]);
    }

    expect(await readBetaAdmissionNonceReservationCount()).toBe(beforeReservation + 1);

    await expect(
      queryAsRole<NonceReservationRow>('fetanagent_api', reserveStatement, [nonceDigest('b')]),
    ).rejects.toThrow();
    expect(await readBetaAdmissionNonceReservationCount()).toBe(beforeReservation + 1);

    await expect(
      queryAsRole<NonceReservationRow>('fetanagent_beta_admission', reserveStatement, [
        nonceDigest('g'),
      ]),
    ).rejects.toThrow('The Telegram beta admission nonce digest is invalid.');
    await expect(
      queryAsRole<NonceReservationRow>('fetanagent_beta_admission', reserveStatement, [
        `sha256-v1:${nonceDigest('c')}`,
      ]),
    ).rejects.toThrow('The Telegram beta admission nonce digest is invalid.');
    await expect(
      queryAsRole<NonceReservationRow>(
        'fetanagent_beta_admission',
        `
          select app.reserve_telegram_beta_invite_admission_nonce(
            $1::text,
            clock_timestamp() - interval '1 second'
          ) as reserved
        `,
        [nonceDigest('d')],
      ),
    ).rejects.toThrow('The Telegram beta admission nonce expiry is invalid.');
    await expect(
      queryAsRole<NonceReservationRow>(
        'fetanagent_beta_admission',
        `
          select app.reserve_telegram_beta_invite_admission_nonce(
            $1::text,
            clock_timestamp() + interval '4 minutes'
          ) as reserved
        `,
        [nonceDigest('e')],
      ),
    ).rejects.toThrow('The Telegram beta admission nonce expiry is invalid.');
    expect(await readBetaAdmissionNonceReservationCount()).toBe(beforeReservation + 1);

    await expect(
      queryAsRole(
        'fetanagent_beta_admission',
        `
          select app.purge_expired_telegram_beta_invite_admission_nonce_reservations(
            $1::integer
          )
        `,
        [1],
      ),
    ).rejects.toThrow();
  });

  it('opportunistically removes at most 64 expired nonces without changing conflict results', async () => {
    await client.query(`
      select app.purge_expired_telegram_beta_invite_admission_nonce_reservations(1000)
    `);
    const conflictingDigest = nonceDigest('f');
    await client.query(
      `
        delete from app.telegram_beta_invite_admission_nonce_reservations
        where nonce_digest = $1::text
      `,
      [conflictingDigest],
    );
    await client.query(
      `
        insert into app.telegram_beta_invite_admission_nonce_reservations (
          nonce_digest,
          expires_at
        )
        values ($1::text, clock_timestamp() + interval '2 minutes')
      `,
      [conflictingDigest],
    );
    await client.query(`
      insert into app.telegram_beta_invite_admission_nonce_reservations (
        nonce_digest,
        expires_at,
        created_at
      )
      select
        lpad(to_hex(candidate), 64, '0'),
        clock_timestamp() - interval '5 minutes',
        clock_timestamp() - interval '6 minutes'
      from generate_series(0, 64) as candidate
    `);

    const before = await client.query<{ readonly expired: number }>(`
      select count(*)::integer as expired
      from app.telegram_beta_invite_admission_nonce_reservations
      where expires_at <= clock_timestamp()
    `);
    expect(before.rows).toEqual([{ expired: 65 }]);

    const reservation = await queryAsRole<NonceReservationRow>(
      'fetanagent_beta_admission',
      `
        select app.reserve_telegram_beta_invite_admission_nonce(
          $1::text,
          clock_timestamp() + interval '2 minutes'
        ) as reserved
      `,
      [conflictingDigest],
    );
    expect(reservation).toEqual([{ reserved: false }]);

    const after = await client.query<{ readonly expired: number }>(`
      select count(*)::integer as expired
      from app.telegram_beta_invite_admission_nonce_reservations
      where expires_at <= clock_timestamp()
    `);
    expect(after.rows).toEqual([{ expired: 1 }]);
  });

  it('keeps the legacy auto-registration recorder inaccessible to the API role', async () => {
    await expect(
      queryAsRole(
        'fetanagent_api',
        `
          select *
          from app.record_telegram_private_inbound_event(
            $1::bigint,
            $2::bigint,
            $3::bigint,
            $4::text,
            $5::text,
            $6::text,
            $7::text,
            $8::text
          )
        `,
        [9_100_000_001, 9_100_000_001, 9_100_000_001, payloadHmac('a'), null, null, null, 'en'],
      ),
    ).rejects.toThrow();
  });

  it('keeps the admitted-inbox recorder inaccessible to the beta-admission role', async () => {
    await expect(
      queryAsRole(
        'fetanagent_beta_admission',
        `
          select *
          from app.record_admitted_telegram_private_inbound_event(
            $1::bigint,
            $2::bigint,
            $3::bigint,
            $4::text,
            $5::text
          )
        `,
        [9_100_000_011, 9_100_000_011, 9_100_000_011, payloadHmac('c'), 'en'],
      ),
    ).rejects.toThrow();
  });

  it('keeps the retired legacy recorder fail-closed even for the database owner', async () => {
    const beforeLegacyCall = await readAdmissionWriteSnapshot();

    await expect(
      client.query(
        `
          select *
          from app.record_telegram_private_inbound_event(
            $1::bigint,
            $2::bigint,
            $3::bigint,
            $4::text,
            $5::text,
            $6::text,
            $7::text,
            $8::text
          )
        `,
        [9_100_000_010, 9_100_000_010, 9_100_000_010, payloadHmac('b'), null, null, null, 'en'],
      ),
    ).rejects.toThrow(
      'The generic Telegram inbound recorder is retired; beta admission requires a valid invite.',
    );

    expect(await readAdmissionWriteSnapshot()).toEqual(beforeLegacyCall);
  });

  it('does not write for rejected invite attempts and creates only an admitted private scope', async () => {
    const missingDigest = inviteDigest('a');
    const expiredDigest = inviteDigest('b');
    const revokedDigest = inviteDigest('c');
    const validDigest = inviteDigest('d');
    const telegramUserId = 9_100_000_004;
    const privateChatId = telegramUserId;

    const redeem = async (
      updateId: number,
      userId: number,
      chatId: number,
      tokenDigest: string,
      hmacCharacter: string,
    ): Promise<readonly AdmissionReceiptRow[]> =>
      queryAsRole<AdmissionReceiptRow>(
        'fetanagent_beta_admission',
        `
          select *
          from app.redeem_telegram_beta_invite(
            $1::bigint,
            $2::bigint,
            $3::bigint,
            $4::text,
            $5::text,
            $6::text
          )
        `,
        [updateId, userId, chatId, tokenDigest, payloadHmac(hmacCharacter), 'en'],
      );

    const recordAdmittedInbound = async (
      updateId: number,
      userId: number,
      chatId: number,
      hmacCharacter: string,
    ): Promise<readonly AdmissionReceiptRow[]> => {
      // The beta group is deliberately ungranted from this reserved recorder. Retain the owner
      // behavior checks here so the procedure remains fail-closed while it awaits later review.
      const result = await client.query<AdmissionReceiptRow>(
        `
          select *
          from app.record_admitted_telegram_private_inbound_event(
            $1::bigint,
            $2::bigint,
            $3::bigint,
            $4::text,
            $5::text
          )
        `,
        [updateId, userId, chatId, payloadHmac(hmacCharacter), 'en'],
      );

      return result.rows;
    };

    await client.query(
      `
        insert into app.telegram_beta_invites (
          token_digest,
          created_at,
          expires_at,
          issued_by_admin_id
        )
        values
          (
            $1::text,
            clock_timestamp() - interval '2 hours',
            clock_timestamp() - interval '1 hour',
            $4::uuid
          ),
          ($2::text, clock_timestamp(), clock_timestamp() + interval '1 hour', $4::uuid),
          ($3::text, clock_timestamp(), clock_timestamp() + interval '1 hour', $4::uuid)
      `,
      [expiredDigest, revokedDigest, validDigest, ownerAdminId],
    );
    await client.query(
      `
        update app.telegram_beta_invites
        set status = 'revoked',
            revoked_at = clock_timestamp(),
            revoked_by_admin_id = $2::uuid,
            revocation_reason_code = 'staging_reset'
        where token_digest = $1::text
      `,
      [revokedDigest, ownerAdminId],
    );

    const beforeRejectedAttempts = await readAdmissionWriteSnapshot();

    await expect(
      redeem(9_100_000_101, 9_100_000_001, 9_100_000_001, missingDigest, 'e'),
    ).rejects.toThrow('The Telegram beta admission is not accepted.');
    expect(await readAdmissionWriteSnapshot()).toEqual(beforeRejectedAttempts);

    await expect(
      redeem(9_100_000_102, 9_100_000_002, 9_100_000_002, expiredDigest, 'f'),
    ).rejects.toThrow('The Telegram beta admission is not accepted.');
    expect(await readAdmissionWriteSnapshot()).toEqual(beforeRejectedAttempts);

    await expect(
      redeem(9_100_000_103, 9_100_000_003, 9_100_000_003, revokedDigest, '0'),
    ).rejects.toThrow('The Telegram beta admission is not accepted.');
    expect(await readAdmissionWriteSnapshot()).toEqual(beforeRejectedAttempts);

    await expect(
      redeem(
        9_100_000_104,
        9_100_000_004,
        9_100_000_004,
        'sha256-v1:not-a-valid-token-digest',
        '1',
      ),
    ).rejects.toThrow('The Telegram beta admission is not accepted.');
    expect(await readAdmissionWriteSnapshot()).toEqual(beforeRejectedAttempts);

    await expect(
      recordAdmittedInbound(9_100_000_105, 9_100_000_006, 9_100_000_006, '2'),
    ).rejects.toThrow('The Telegram beta admission is not active.');
    expect(await readAdmissionWriteSnapshot()).toEqual(beforeRejectedAttempts);

    await client.query(
      `
        insert into app.inbound_events (
          channel,
          external_event_id,
          customer_identity_id,
          payload_digest
        )
        values ('telegram', $1::text, null, $2::text)
      `,
      ['update:9100000106', payloadHmac('3')],
    );
    const beforeMalformedExistingInbound = await readAdmissionWriteSnapshot();

    await expect(
      recordAdmittedInbound(9_100_000_106, 9_100_000_006, 9_100_000_006, '3'),
    ).rejects.toThrow('The Telegram beta admission is not active.');
    expect(await readAdmissionWriteSnapshot()).toEqual(beforeMalformedExistingInbound);

    const beforeRedemption = await readAdmissionWriteSnapshot();
    const firstRedemption = await redeem(
      9_100_000_201,
      telegramUserId,
      privateChatId,
      validDigest,
      '2',
    );

    expect(firstRedemption).toHaveLength(1);
    expect(firstRedemption[0]).toMatchObject({
      inbound_event_already_recorded: false,
    });
    expect(firstRedemption[0]?.inbound_event_id).toEqual(expect.any(String));
    expect(firstRedemption[0]?.received_at).toBeInstanceOf(Date);

    const afterFirstRedemption = await readAdmissionWriteSnapshot();
    expect(afterFirstRedemption.customers).toBe(beforeRedemption.customers + 1);
    expect(afterFirstRedemption.customer_identities).toBe(beforeRedemption.customer_identities + 1);
    expect(afterFirstRedemption.telegram_identities).toBe(beforeRedemption.telegram_identities + 1);
    expect(afterFirstRedemption.bot_conversations).toBe(beforeRedemption.bot_conversations + 1);
    expect(afterFirstRedemption.inbound_events).toBe(beforeRedemption.inbound_events + 1);
    expect(afterFirstRedemption.audit_events).toBe(beforeRedemption.audit_events + 1);
    expect(afterFirstRedemption.active_invites).toBe(beforeRedemption.active_invites - 1);
    expect(afterFirstRedemption.redeemed_invites).toBe(beforeRedemption.redeemed_invites + 1);

    const redemptionReplay = await redeem(
      9_100_000_201,
      telegramUserId,
      privateChatId,
      validDigest,
      '2',
    );
    expect(redemptionReplay).toEqual([
      expect.objectContaining({
        inbound_event_already_recorded: true,
        inbound_event_id: firstRedemption[0]?.inbound_event_id,
      }),
    ]);
    expect(await readAdmissionWriteSnapshot()).toEqual(afterFirstRedemption);

    await expect(
      redeem(9_100_000_201, telegramUserId, privateChatId + 1, validDigest, '2'),
    ).rejects.toThrow('The Telegram beta admission is not accepted.');
    expect(await readAdmissionWriteSnapshot()).toEqual(afterFirstRedemption);

    await expect(
      redeem(9_100_000_201, telegramUserId, privateChatId, validDigest, '3'),
    ).rejects.toThrow();
    expect(await readAdmissionWriteSnapshot()).toEqual(afterFirstRedemption);

    await expect(
      redeem(9_100_000_202, telegramUserId, privateChatId, validDigest, '3'),
    ).rejects.toThrow('The Telegram beta admission is not accepted.');
    expect(await readAdmissionWriteSnapshot()).toEqual(afterFirstRedemption);

    await expect(
      redeem(9_100_000_203, 9_100_000_005, 9_100_000_005, validDigest, '4'),
    ).rejects.toThrow('The Telegram beta admission is not accepted.');
    expect(await readAdmissionWriteSnapshot()).toEqual(afterFirstRedemption);

    const admittedInbound = await recordAdmittedInbound(
      9_100_000_301,
      telegramUserId,
      privateChatId,
      '5',
    );
    expect(admittedInbound).toEqual([
      expect.objectContaining({ inbound_event_already_recorded: false }),
    ]);
    expect(admittedInbound[0]?.inbound_event_id).toEqual(expect.any(String));
    const afterAdmittedInbound = await readAdmissionWriteSnapshot();
    expect(afterAdmittedInbound.customers).toBe(afterFirstRedemption.customers);
    expect(afterAdmittedInbound.customer_identities).toBe(afterFirstRedemption.customer_identities);
    expect(afterAdmittedInbound.telegram_identities).toBe(afterFirstRedemption.telegram_identities);
    expect(afterAdmittedInbound.bot_conversations).toBe(afterFirstRedemption.bot_conversations);
    expect(afterAdmittedInbound.inbound_events).toBe(afterFirstRedemption.inbound_events + 1);
    expect(afterAdmittedInbound.audit_events).toBe(afterFirstRedemption.audit_events);

    const admittedInboundReplay = await recordAdmittedInbound(
      9_100_000_301,
      telegramUserId,
      privateChatId,
      '5',
    );
    expect(admittedInboundReplay).toEqual([
      expect.objectContaining({
        inbound_event_already_recorded: true,
        inbound_event_id: admittedInbound[0]?.inbound_event_id,
      }),
    ]);
    expect(await readAdmissionWriteSnapshot()).toEqual(afterAdmittedInbound);

    await expect(
      recordAdmittedInbound(9_100_000_301, telegramUserId, privateChatId, '6'),
    ).rejects.toThrow();
    expect(await readAdmissionWriteSnapshot()).toEqual(afterAdmittedInbound);

    const admittedBinding = await client.query<{
      readonly customer_id: string;
      readonly customer_identity_id: string;
    }>(
      `
        select
          redeemed_customer_id as customer_id,
          redeemed_customer_identity_id as customer_identity_id
        from app.telegram_beta_invites
        where token_digest = $1::text
      `,
      [validDigest],
    );
    expect(admittedBinding.rows).toHaveLength(1);
    const admittedCustomerId = admittedBinding.rows[0]?.customer_id;
    const admittedCustomerIdentityId = admittedBinding.rows[0]?.customer_identity_id;
    expect(admittedCustomerId).toEqual(expect.any(String));
    expect(admittedCustomerIdentityId).toEqual(expect.any(String));

    if (!admittedCustomerId || !admittedCustomerIdentityId) {
      throw new Error('The redeemed beta invite did not retain its immutable admission binding.');
    }

    await client.query(
      `
        update app.customer_identities
        set status = 'inactive'
        where id = $1::uuid
      `,
      [admittedCustomerIdentityId],
    );
    await client.query(
      `
        update app.customers
        set status = 'inactive'
        where id = $1::uuid
      `,
      [admittedCustomerId],
    );
    const afterAdministrativeDeactivation = await readAdmissionWriteSnapshot();

    const redemptionReplayAfterDeactivation = await redeem(
      9_100_000_201,
      telegramUserId,
      privateChatId,
      validDigest,
      '2',
    );
    expect(redemptionReplayAfterDeactivation).toEqual([
      expect.objectContaining({
        inbound_event_already_recorded: true,
        inbound_event_id: firstRedemption[0]?.inbound_event_id,
      }),
    ]);

    const admittedInboundReplayAfterDeactivation = await recordAdmittedInbound(
      9_100_000_301,
      telegramUserId,
      privateChatId,
      '5',
    );
    expect(admittedInboundReplayAfterDeactivation).toEqual([
      expect.objectContaining({
        inbound_event_already_recorded: true,
        inbound_event_id: admittedInbound[0]?.inbound_event_id,
      }),
    ]);
    expect(await readAdmissionWriteSnapshot()).toEqual(afterAdministrativeDeactivation);

    await expect(
      recordAdmittedInbound(9_100_000_302, telegramUserId, privateChatId, '7'),
    ).rejects.toThrow('The Telegram beta admission is not active.');
    expect(await readAdmissionWriteSnapshot()).toEqual(afterAdministrativeDeactivation);
  });

  it('serializes two independent sessions racing to redeem one invite', async () => {
    const raceInviteDigest = inviteDigest('9');
    const leftUpdateId = 9_100_000_401;
    const leftTelegramUserId = leftUpdateId;
    const rightUpdateId = 9_100_000_402;
    const rightTelegramUserId = rightUpdateId;
    const redeemStatement = `
      select *
      from app.redeem_telegram_beta_invite(
        $1::bigint,
        $2::bigint,
        $3::bigint,
        $4::text,
        $5::text,
        $6::text
      )
    `;

    await client.query(
      `
        insert into app.telegram_beta_invites (
          token_digest,
          expires_at,
          issued_by_admin_id
        )
        values ($1::text, clock_timestamp() + interval '1 hour', $2::uuid)
      `,
      [raceInviteDigest, ownerAdminId],
    );
    const beforeRace = await readAdmissionWriteSnapshot();
    const leftSession = createSqlIntegrationClient(environment);
    const rightSession = createSqlIntegrationClient(environment);

    await Promise.all([leftSession.connect(), rightSession.connect()]);
    try {
      await Promise.all([leftSession.query('begin'), rightSession.query('begin')]);
      await Promise.all([
        leftSession.query('set local role fetanagent_beta_admission'),
        rightSession.query('set local role fetanagent_beta_admission'),
      ]);

      const leftRedemption = leftSession.query<AdmissionReceiptRow>(redeemStatement, [
        leftUpdateId,
        leftTelegramUserId,
        leftTelegramUserId,
        raceInviteDigest,
        payloadHmac('8'),
        'en',
      ]);
      const rightRedemption = rightSession.query<AdmissionReceiptRow>(redeemStatement, [
        rightUpdateId,
        rightTelegramUserId,
        rightTelegramUserId,
        raceInviteDigest,
        payloadHmac('9'),
        'en',
      ]);

      const firstCompletedRedemption = await Promise.race([
        leftRedemption.then((result) => ({ result, session: leftSession })),
        rightRedemption.then((result) => ({ result, session: rightSession })),
      ]);
      expect(firstCompletedRedemption.result.rows).toEqual([
        expect.objectContaining({ inbound_event_already_recorded: false }),
      ]);

      await firstCompletedRedemption.session.query('commit');

      const outcomes = await Promise.allSettled([leftRedemption, rightRedemption]);
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);

      const fulfilledRedemption = outcomes.find((outcome) => outcome.status === 'fulfilled');
      const rejectedRedemption = outcomes.find((outcome) => outcome.status === 'rejected');
      if (
        !fulfilledRedemption ||
        fulfilledRedemption.status !== 'fulfilled' ||
        !rejectedRedemption ||
        rejectedRedemption.status !== 'rejected'
      ) {
        throw new Error(
          'The invite-redemption race did not settle into one success and one rejection.',
        );
      }

      expect(fulfilledRedemption.value.rows).toEqual([
        expect.objectContaining({ inbound_event_already_recorded: false }),
      ]);
      expect(rejectedRedemption.reason).toMatchObject({
        message: 'The Telegram beta admission is not accepted.',
      });
    } finally {
      await Promise.allSettled([leftSession.query('rollback'), rightSession.query('rollback')]);
      await Promise.allSettled([leftSession.end(), rightSession.end()]);
    }

    const afterRace = await readAdmissionWriteSnapshot();
    expect(afterRace.customers).toBe(beforeRace.customers + 1);
    expect(afterRace.customer_identities).toBe(beforeRace.customer_identities + 1);
    expect(afterRace.telegram_identities).toBe(beforeRace.telegram_identities + 1);
    expect(afterRace.bot_conversations).toBe(beforeRace.bot_conversations + 1);
    expect(afterRace.inbound_events).toBe(beforeRace.inbound_events + 1);
    expect(afterRace.audit_events).toBe(beforeRace.audit_events + 1);
    expect(afterRace.active_invites).toBe(beforeRace.active_invites - 1);
    expect(afterRace.redeemed_invites).toBe(beforeRace.redeemed_invites + 1);

    const admittedGraph = await client.query<{
      readonly bot_conversations: number;
      readonly customer_identities: number;
      readonly customers: number;
      readonly inbound_events: number;
      readonly telegram_identities: number;
    }>(`
      select
        (
          select count(distinct customer_identity.customer_id)::integer
          from app.customer_identities customer_identity
          where customer_identity.identity_kind = 'telegram'
            and customer_identity.external_subject in ('9100000401', '9100000402')
        ) as customers,
        (
          select count(*)::integer
          from app.customer_identities customer_identity
          where customer_identity.identity_kind = 'telegram'
            and customer_identity.external_subject in ('9100000401', '9100000402')
        ) as customer_identities,
        (
          select count(*)::integer
          from app.telegram_identities telegram_identity
          where telegram_identity.telegram_user_id in (9100000401, 9100000402)
        ) as telegram_identities,
        (
          select count(*)::integer
          from app.bot_conversations conversation
          join app.telegram_identities telegram_identity
            on telegram_identity.customer_identity_id = conversation.telegram_identity_id
          where telegram_identity.telegram_user_id in (9100000401, 9100000402)
        ) as bot_conversations,
        (
          select count(*)::integer
          from app.inbound_events inbound_event
          where inbound_event.channel = 'telegram'
            and inbound_event.external_event_id in ('update:9100000401', 'update:9100000402')
        ) as inbound_events
    `);
    expect(admittedGraph.rows).toEqual([
      {
        bot_conversations: 1,
        customer_identities: 1,
        customers: 1,
        inbound_events: 1,
        telegram_identities: 1,
      },
    ]);
  });

  it('isolates Owner invite control and records only safe audited identifiers', async () => {
    const roleRows = await client.query<RoleRow & { readonly rolconnlimit: number }>(`
      select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
             rolreplication, rolbypassrls, rolconnlimit
      from pg_roles
      where rolname in ('fetanagent_owner_control', 'fetanagent_owner_control_runtime')
      order by rolname
    `);
    expect(roleRows.rows).toEqual([
      {
        rolbypassrls: false,
        rolcanlogin: false,
        rolconnlimit: 1,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolname: 'fetanagent_owner_control',
        rolreplication: false,
        rolsuper: false,
      },
      {
        rolbypassrls: false,
        rolcanlogin: false,
        rolconnlimit: 1,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolname: 'fetanagent_owner_control_runtime',
        rolreplication: false,
        rolsuper: false,
      },
    ]);

    const privileges = await client.query<{
      readonly beta_execute_denied: boolean;
      readonly broad_execution_denied: boolean;
      readonly direct_table_access_denied: boolean;
      readonly functions_are_hardened: boolean;
      readonly issue_allowed: boolean;
      readonly player_association_allowed: boolean;
      readonly player_association_list_allowed: boolean;
      readonly player_list_allowed: boolean;
      readonly player_review_allowed: boolean;
      readonly revoke_allowed: boolean;
      readonly runtime_direct_execute_denied: boolean;
      readonly runtime_effective_issue_allowed: boolean;
    }>(`
      select
        has_function_privilege(
          'fetanagent_owner_control',
          'app.issue_telegram_beta_invite(uuid,text,timestamptz)',
          'execute'
        ) as issue_allowed,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.revoke_telegram_beta_invite(uuid,uuid,text)',
          'execute'
        ) as revoke_allowed,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.list_owner_player_registration_requests(uuid,integer)',
          'execute'
        ) as player_list_allowed,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.review_owner_player_registration_request(uuid,uuid,text,text)',
          'execute'
        ) as player_review_allowed,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.list_owner_player_registration_association_candidates(uuid,integer)',
          'execute'
        ) as player_association_list_allowed,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.associate_owner_validated_player_registration_request(uuid,uuid,text)',
          'execute'
        ) as player_association_allowed,
        has_function_privilege(
          'fetanagent_owner_control_runtime',
          'app.issue_telegram_beta_invite(uuid,text,timestamptz)',
          'execute'
        ) as runtime_effective_issue_allowed,
        not exists (
          select 1
          from pg_proc procedure
          where procedure.oid in (
            'app.issue_telegram_beta_invite(uuid,text,timestamptz)'::regprocedure,
            'app.revoke_telegram_beta_invite(uuid,uuid,text)'::regprocedure,
            'app.list_owner_player_registration_requests(uuid,integer)'::regprocedure,
            'app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure,
            'app.list_owner_player_registration_association_candidates(uuid,integer)'::regprocedure,
            'app.associate_owner_validated_player_registration_request(uuid,uuid,text)'::regprocedure
          )
            and exists (
              select 1
              from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
              where privilege.grantee = 'fetanagent_owner_control_runtime'::regrole
                and privilege.privilege_type = 'EXECUTE'
            )
        ) as runtime_direct_execute_denied,
        not exists (
          select 1
          from pg_proc procedure
          where procedure.oid in (
            'app.issue_telegram_beta_invite(uuid,text,timestamptz)'::regprocedure,
            'app.revoke_telegram_beta_invite(uuid,uuid,text)'::regprocedure,
            'app.list_owner_player_registration_requests(uuid,integer)'::regprocedure,
            'app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure,
            'app.list_owner_player_registration_association_candidates(uuid,integer)'::regprocedure,
            'app.associate_owner_validated_player_registration_request(uuid,uuid,text)'::regprocedure
          )
            and (
              not procedure.prosecdef
              or procedure.proowner <> 'postgres'::regrole
              or not (
                coalesce(procedure.proconfig, array[]::text[])
                  @> array['search_path=pg_catalog, app, pg_temp']::text[]
              )
            )
        ) as functions_are_hardened,
        not exists (
          select 1
          from (
            values
              ('anon'), ('authenticated'), ('service_role'),
              ('fetanagent_api'), ('fetanagent_api_runtime'), ('fetanagent_worker'),
              ('fetanagent_beta_admission'), ('fetanagent_beta_admission_runtime'),
              ('fetanagent_nonce_retention'), ('fetanagent_nonce_retention_runtime')
          ) denied_role(role_name)
          cross join (
            values
              ('app.issue_telegram_beta_invite(uuid,text,timestamptz)'::regprocedure),
              ('app.revoke_telegram_beta_invite(uuid,uuid,text)'::regprocedure),
              ('app.list_owner_player_registration_requests(uuid,integer)'::regprocedure),
              ('app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure),
              ('app.list_owner_player_registration_association_candidates(uuid,integer)'::regprocedure),
              ('app.associate_owner_validated_player_registration_request(uuid,uuid,text)'::regprocedure)
          ) owner_function(procedure_oid)
          where has_function_privilege(
            denied_role.role_name,
            owner_function.procedure_oid,
            'EXECUTE'
          )
        ) as broad_execution_denied,
        not has_function_privilege(
          'fetanagent_owner_control',
          'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)',
          'execute'
        ) as beta_execute_denied,
        not exists (
          select 1
          from (
            values
              ('app.telegram_beta_invites'),
              ('app.player_registration_requests'),
              ('app.player_registration_request_reviews'),
              ('app.player_registration_request_associations'),
              ('app.customer_platform_players'),
              ('app.player_validation_attempts')
          ) protected_table(table_name)
          where has_table_privilege(
            'fetanagent_owner_control',
            protected_table.table_name,
            'select,insert,update,delete,truncate,references,trigger'
          )
        ) as direct_table_access_denied
    `);
    expect(privileges.rows).toEqual([
      {
        beta_execute_denied: true,
        broad_execution_denied: true,
        direct_table_access_denied: true,
        functions_are_hardened: true,
        issue_allowed: true,
        player_association_allowed: true,
        player_association_list_allowed: true,
        player_list_allowed: true,
        player_review_allowed: true,
        revoke_allowed: true,
        runtime_direct_execute_denied: true,
        runtime_effective_issue_allowed: true,
      },
    ]);

    const digest = inviteDigest('e');
    const issued = await queryAsRole<{
      readonly issued_expires_at: Date;
      readonly issued_invite_id: string;
    }>(
      'fetanagent_owner_control',
      `
        select *
        from app.issue_telegram_beta_invite(
          $1::uuid,
          $2::text,
          clock_timestamp() + interval '1 hour'
        )
      `,
      [ownerAuthUserId, digest],
    );
    const issuedInviteId = issued[0]?.issued_invite_id;
    expect(issuedInviteId).toEqual(expect.any(String));

    const stored = await client.query<{
      readonly issued_by_admin_id: string;
      readonly metadata: unknown;
      readonly token_digest: string;
    }>(
      `
        select beta_invite.token_digest,
               beta_invite.issued_by_admin_id,
               audit_event.metadata
        from app.telegram_beta_invites beta_invite
        join app.audit_events audit_event
          on audit_event.resource_id = beta_invite.invite_id
         and audit_event.action = 'telegram.beta_invite_issued'
        where beta_invite.invite_id = $1::uuid
      `,
      [issuedInviteId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.token_digest).toBe(digest);
    expect(stored.rows[0]?.issued_by_admin_id).toBe(ownerAdminId);
    expect(JSON.stringify(stored.rows[0]?.metadata)).not.toContain(digest);

    await queryAsRole(
      'fetanagent_owner_control',
      `select * from app.revoke_telegram_beta_invite($1::uuid, $2::uuid, $3::text)`,
      [ownerAuthUserId, issuedInviteId!, 'owner_cancelled'],
    );
    const revoked = await client.query<{
      readonly reason: string;
      readonly status: string;
    }>(
      `
        select status, revocation_reason_code as reason
        from app.telegram_beta_invites
        where invite_id = $1::uuid
      `,
      [issuedInviteId],
    );
    expect(revoked.rows).toEqual([{ reason: 'owner_cancelled', status: 'revoked' }]);

    const nonOwnerAuthUserId = '33333333-3333-4333-8333-333333333333';
    await client.query(
      `insert into auth.users (id, email) values ($1::uuid, 'administrator@example.invalid')`,
      [nonOwnerAuthUserId],
    );
    await client.query(
      `
        insert into app.admin_users (auth_user_id, role, status)
        values ($1::uuid, 'administrator', 'active')
      `,
      [nonOwnerAuthUserId],
    );
    await expect(
      queryAsRole(
        'fetanagent_owner_control',
        `
          select *
          from app.issue_telegram_beta_invite(
            $1::uuid,
            $2::text,
            clock_timestamp() + interval '1 hour'
          )
        `,
        [nonOwnerAuthUserId, inviteDigest('d')],
      ),
    ).rejects.toThrow('Only an active Owner can issue a Telegram beta invite.');
  });

  it('records non-claiming Owner Player-ID reviews without creating a deposit-usable binding', async () => {
    const catalog = await client.query<{
      readonly policies: number;
      readonly relforcerowsecurity: boolean;
      readonly relrowsecurity: boolean;
    }>(`
      select relation.relrowsecurity,
             relation.relforcerowsecurity,
             (
               select count(*)::integer
               from pg_policy policy
               where policy.polrelid = relation.oid
             ) as policies
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relname = 'player_registration_request_reviews'
    `);
    expect(catalog.rows).toEqual([
      { policies: 0, relforcerowsecurity: true, relrowsecurity: true },
    ]);

    const customer = await client.query<{ readonly id: string }>(
      `insert into app.customers default values returning id`,
    );
    const customerId = customer.rows[0]!.id;
    const request = await client.query<{ readonly id: string }>(
      `
        insert into app.player_registration_requests (customer_id, platform_id, player_id)
        select $1::uuid, platform.id, $2::text
        from app.platforms platform
        where platform.code = 'kemerbet'
        returning id
      `,
      [customerId, 'STAGING-OWNER-REVIEW-01'],
    );
    const requestId = request.rows[0]!.id;

    const listed = await queryAsRole<{
      readonly platform_code: string;
      readonly registration_request_id: string;
      readonly request_status: string;
      readonly submitted_player_id: string;
    }>(
      'fetanagent_owner_control',
      `select * from app.list_owner_player_registration_requests($1::uuid, $2::integer)`,
      [ownerAuthUserId, 50],
    );
    expect(listed).toContainEqual(
      expect.objectContaining({
        platform_code: 'kemerbet',
        registration_request_id: requestId,
        request_status: 'pending_validation',
        submitted_player_id: 'STAGING-OWNER-REVIEW-01',
      }),
    );

    const reviewed = await queryAsRole<{
      readonly decision_already_recorded: boolean;
      readonly reviewed_registration_request_id: string;
      readonly reviewed_status: string;
    }>(
      'fetanagent_owner_control',
      `
        select *
        from app.review_owner_player_registration_request(
          $1::uuid,
          $2::uuid,
          'exists',
          'owner_platform_lookup'
        )
      `,
      [ownerAuthUserId, requestId],
    );
    expect(reviewed).toEqual([
      expect.objectContaining({
        decision_already_recorded: false,
        reviewed_registration_request_id: requestId,
        reviewed_status: 'exists',
      }),
    ]);

    const replayed = await queryAsRole<{
      readonly decision_already_recorded: boolean;
    }>(
      'fetanagent_owner_control',
      `
        select *
        from app.review_owner_player_registration_request(
          $1::uuid,
          $2::uuid,
          'exists',
          'owner_platform_lookup'
        )
      `,
      [ownerAuthUserId, requestId],
    );
    expect(replayed).toEqual([expect.objectContaining({ decision_already_recorded: true })]);

    const persisted = await client.query<{
      readonly audit_events: number;
      readonly metadata: unknown;
      readonly player_bindings: number;
      readonly reviews: number;
      readonly status: string;
    }>(
      `
        select
          registration_request.status::text as status,
          (
            select count(*)::integer
            from app.player_registration_request_reviews review
            where review.player_registration_request_id = registration_request.id
          ) as reviews,
          (
            select count(*)::integer
            from app.customer_platform_players player
            where player.customer_id = registration_request.customer_id
          ) as player_bindings,
          (
            select count(*)::integer
            from app.audit_events audit_event
            where audit_event.action = 'player_registration.owner_review_recorded'
              and audit_event.resource_id = registration_request.id
          ) as audit_events,
          (
            select audit_event.metadata
            from app.audit_events audit_event
            where audit_event.action = 'player_registration.owner_review_recorded'
              and audit_event.resource_id = registration_request.id
            limit 1
          ) as metadata
        from app.player_registration_requests registration_request
        where registration_request.id = $1::uuid
      `,
      [requestId],
    );
    expect(persisted.rows).toEqual([
      {
        audit_events: 1,
        metadata: { decision: 'exists', reason_code: 'owner_platform_lookup' },
        player_bindings: 0,
        reviews: 1,
        status: 'exists',
      },
    ]);
    expect(JSON.stringify(persisted.rows[0]?.metadata)).not.toContain('STAGING-OWNER-REVIEW-01');

    const associationCandidates = await queryAsRole<{
      readonly registration_request_id: string;
      readonly submitted_player_id: string;
    }>(
      'fetanagent_owner_control',
      `select registration_request_id, submitted_player_id
       from app.list_owner_player_registration_association_candidates($1::uuid, 25)`,
      [ownerAuthUserId],
    );
    expect(associationCandidates).toContainEqual({
      registration_request_id: requestId,
      submitted_player_id: 'STAGING-OWNER-REVIEW-01',
    });

    const associated = await queryAsRole<{
      readonly associated_player_account_id: string;
      readonly associated_registration_request_id: string;
      readonly association_already_recorded: boolean;
    }>(
      'fetanagent_owner_control',
      `select * from app.associate_owner_validated_player_registration_request(
         $1::uuid, $2::uuid, 'owner_verified_platform_ownership'
       )`,
      [ownerAuthUserId, requestId],
    );
    expect(associated).toEqual([
      expect.objectContaining({
        associated_registration_request_id: requestId,
        association_already_recorded: false,
      }),
    ]);
    const playerAccountId = associated[0]!.associated_player_account_id;
    const associationGraph = await client.query<{
      readonly association_audit_events: number;
      readonly association_rows: number;
      readonly last_validation_reason_code: string;
      readonly validation_attempts: number;
      readonly validation_status: string;
    }>(
      `select
         player.validation_status::text as validation_status,
         player.last_validation_reason_code,
         (select count(*)::integer from app.player_validation_attempts attempt
          where attempt.player_account_id = player.id) as validation_attempts,
         (select count(*)::integer from app.player_registration_request_associations association
          where association.player_account_id = player.id) as association_rows,
         (select count(*)::integer from app.audit_events audit_event
          where audit_event.action = 'player_registration.owner_association_recorded'
            and audit_event.resource_id = player.id) as association_audit_events
       from app.customer_platform_players player
       where player.id = $1::uuid`,
      [playerAccountId],
    );
    expect(associationGraph.rows).toEqual([
      {
        association_audit_events: 1,
        association_rows: 1,
        last_validation_reason_code: 'owner_verified_platform_ownership',
        validation_attempts: 1,
        validation_status: 'valid',
      },
    ]);

    const associationReplay = await queryAsRole<{
      readonly association_already_recorded: boolean;
    }>(
      'fetanagent_owner_control',
      `select * from app.associate_owner_validated_player_registration_request(
         $1::uuid, $2::uuid, 'owner_verified_platform_ownership'
       )`,
      [ownerAuthUserId, requestId],
    );
    expect(associationReplay).toEqual([
      expect.objectContaining({ association_already_recorded: true }),
    ]);

    const dryRunFunctionAcl = await client.query<{
      readonly api_can_capture: boolean;
      readonly api_can_open: boolean;
      readonly owner_can_list: boolean;
      readonly player_actions_can_capture: boolean;
      readonly player_actions_can_open: boolean;
      readonly public_can_capture: boolean;
      readonly public_can_list: boolean;
      readonly public_can_open: boolean;
    }>(`
      select
        has_function_privilege(
          'fetanagent_player_actions',
          'app.open_telegram_dry_run_deposit_intent(uuid,text,bigint,text)',
          'execute'
        ) as player_actions_can_open,
        has_function_privilege(
          'fetanagent_player_actions',
          'app.capture_telegram_dry_run_deposit_reference(uuid,uuid,text,text,text,smallint,text)',
          'execute'
        ) as player_actions_can_capture,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.list_owner_dry_run_deposit_intake(uuid,integer)',
          'execute'
        ) as owner_can_list,
        has_function_privilege(
          'fetanagent_api',
          'app.open_telegram_dry_run_deposit_intent(uuid,text,bigint,text)',
          'execute'
        ) as api_can_open,
        has_function_privilege(
          'fetanagent_api',
          'app.capture_telegram_dry_run_deposit_reference(uuid,uuid,text,text,text,smallint,text)',
          'execute'
        ) as api_can_capture,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ) as public_can_open,
        exists (
          select 1
          from aclexplode(coalesce(capture.proacl, acldefault('f', capture.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ) as public_can_capture,
        exists (
          select 1
          from aclexplode(coalesce(owner_list.proacl, acldefault('f', owner_list.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ) as public_can_list
      from pg_proc procedure
      join pg_namespace procedure_namespace on procedure_namespace.oid = procedure.pronamespace
      join pg_proc capture on capture.oid =
        'app.capture_telegram_dry_run_deposit_reference(uuid,uuid,text,text,text,smallint,text)'::regprocedure
      join pg_proc owner_list on owner_list.oid =
        'app.list_owner_dry_run_deposit_intake(uuid,integer)'::regprocedure
      where procedure.oid =
        'app.open_telegram_dry_run_deposit_intent(uuid,text,bigint,text)'::regprocedure
        and procedure_namespace.nspname = 'app'
    `);
    expect(dryRunFunctionAcl.rows).toEqual([
      {
        api_can_capture: false,
        api_can_open: false,
        owner_can_list: true,
        player_actions_can_capture: true,
        player_actions_can_open: true,
        public_can_capture: false,
        public_can_list: false,
        public_can_open: false,
      },
    ]);

    const telegramUserId = 9_500_000_001;
    const telegramIdentity = await client.query<{ readonly id: string }>(
      `
        with customer_identity as (
          insert into app.customer_identities (customer_id, identity_kind, external_subject)
          values ($1::uuid, 'telegram', $2::text)
          returning id
        ), telegram_identity as (
          insert into app.telegram_identities (
            customer_identity_id, telegram_user_id, private_chat_id, preferred_locale
          )
          select id, $3::bigint, $3::bigint, 'en'
          from customer_identity
          returning customer_identity_id
        )
        insert into app.bot_conversations (telegram_identity_id)
        select customer_identity_id
        from telegram_identity
        returning telegram_identity_id as id
      `,
      [customerId, telegramUserId.toString(), telegramUserId],
    );
    const telegramIdentityId = telegramIdentity.rows[0]!.id;

    await client.query(
      `
        insert into app.receiver_accounts (
          provider_id, version, account_holder_name, account_reference_ciphertext,
          verification_reference_ciphertext, account_reference_masked, instructions,
          created_by_admin_id
        )
        select payment_provider.id, 1, 'FetanAgent Staging', 'fixture-ciphertext',
               'receiver-verification-ciphertext', '****1234', jsonb_build_object(
                 'customer_message', 'Send only CBE Birr to the shown account.'
               ), $1::uuid
        from app.payment_providers payment_provider
        where payment_provider.code = 'cbe_birr'
      `,
      [ownerAdminId],
    );

    const openingInbound = await client.query<{ readonly id: string }>(
      `
        insert into app.inbound_events (
          channel, external_event_id, customer_identity_id, payload_digest
        )
        values ('telegram', 'update:9500000001', $1::uuid, $2::text)
        returning id
      `,
      [telegramIdentityId, payloadHmac('a')],
    );
    const openingInboundId = openingInbound.rows[0]!.id;

    const beforeEligibilityGate = await client.query<{
      readonly audits: number;
      readonly consumptions: number;
      readonly decisions: number;
      readonly intents: number;
      readonly processed: boolean;
    }>(
      `select
         (select count(*)::integer from app.deposit_intents
           where origin_inbound_event_id = $1::uuid) as intents,
         (select count(*)::integer from app.inbound_event_consumptions
           where origin_inbound_event_id = $1::uuid) as consumptions,
         (select count(*)::integer from app.audit_events
           where action = 'deposit.dry_run_intent_opened'
             and metadata ->> 'platform_code' = 'kemerbet') as audits,
         (select count(*)::integer from app.player_deposit_eligibility_decisions
           where player_account_id = $2::uuid) as decisions,
         (select processed_at is not null from app.inbound_events
           where id = $1::uuid) as processed`,
      [openingInboundId, playerAccountId],
    );

    await expect(
      queryAsRole(
        'fetanagent_player_actions',
        `select * from app.open_telegram_dry_run_deposit_intent(
           $1::uuid, $2::text, $3::bigint, $4::text
         )`,
        [openingInboundId, 'STAGING-OWNER-REVIEW-01', 2500, payloadHmac('b')],
      ),
    ).rejects.toThrow('requires a current Player-ID deposit-eligibility decision');

    const afterEligibilityGate = await client.query<{
      readonly audits: number;
      readonly consumptions: number;
      readonly decisions: number;
      readonly intents: number;
      readonly processed: boolean;
    }>(
      `select
         (select count(*)::integer from app.deposit_intents
           where origin_inbound_event_id = $1::uuid) as intents,
         (select count(*)::integer from app.inbound_event_consumptions
           where origin_inbound_event_id = $1::uuid) as consumptions,
         (select count(*)::integer from app.audit_events
           where action = 'deposit.dry_run_intent_opened'
             and metadata ->> 'platform_code' = 'kemerbet') as audits,
         (select count(*)::integer from app.player_deposit_eligibility_decisions
           where player_account_id = $2::uuid) as decisions,
         (select processed_at is not null from app.inbound_events
           where id = $1::uuid) as processed`,
      [openingInboundId, playerAccountId],
    );
    expect(afterEligibilityGate.rows).toEqual(beforeEligibilityGate.rows);

    const eligibilityDecision = await client.query<{ readonly id: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code,
         actor_kind, actor_admin_id
       ) values (
         $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'admin', $2::uuid
       )
       returning id`,
      [playerAccountId, ownerAdminId],
    );
    const eligibilityDecisionId = eligibilityDecision.rows[0]!.id;

    const opened = await queryAsRole<{
      readonly deposit_intent_id: string;
      readonly deposit_status: string;
      readonly expected_amount_minor: string;
      readonly origin_inbound_event_already_consumed: boolean;
      readonly provider_code: string;
    }>(
      'fetanagent_player_actions',
      `
        select deposit_intent_id, deposit_status, expected_amount_minor,
               origin_inbound_event_already_consumed, provider_code
        from app.open_telegram_dry_run_deposit_intent(
          $1::uuid, $2::text, $3::bigint, $4::text
        )
      `,
      [openingInboundId, 'STAGING-OWNER-REVIEW-01', 2500, payloadHmac('b')],
    );
    expect(opened).toEqual([
      expect.objectContaining({
        deposit_status: 'intake_received',
        expected_amount_minor: '2500',
        origin_inbound_event_already_consumed: false,
        provider_code: 'cbe_birr',
      }),
    ]);
    const depositIntentId = opened[0]!.deposit_intent_id;
    const depositEligibilitySnapshot = await client.query<{
      readonly player_deposit_eligibility_decision_id: string;
    }>(
      `select player_deposit_eligibility_decision_id
         from app.deposit_intents
        where id = $1::uuid`,
      [depositIntentId],
    );
    expect(depositEligibilitySnapshot.rows).toEqual([
      { player_deposit_eligibility_decision_id: eligibilityDecisionId },
    ]);

    const openedReplay = await queryAsRole<{
      readonly deposit_intent_id: string;
      readonly origin_inbound_event_already_consumed: boolean;
    }>(
      'fetanagent_player_actions',
      `select deposit_intent_id, origin_inbound_event_already_consumed
       from app.open_telegram_dry_run_deposit_intent($1::uuid, $2::text, $3::bigint, $4::text)`,
      [openingInboundId, 'STAGING-OWNER-REVIEW-01', 2500, payloadHmac('b')],
    );
    expect(openedReplay).toEqual([
      {
        deposit_intent_id: depositIntentId,
        origin_inbound_event_already_consumed: true,
      },
    ]);

    const referenceInbound = await client.query<{ readonly id: string }>(
      `
        insert into app.inbound_events (
          channel, external_event_id, customer_identity_id, payload_digest
        )
        values ('telegram', 'update:9500000002', $1::uuid, $2::text)
        returning id
      `,
      [telegramIdentityId, payloadHmac('c')],
    );
    const referenceInboundId = referenceInbound.rows[0]!.id;
    const captured = await queryAsRole<{
      readonly deposit_submission_id: string;
      readonly origin_inbound_event_already_consumed: boolean;
      readonly result_deposit_intent_id: string;
      readonly submission_status: string;
    }>(
      'fetanagent_player_actions',
      `
        select deposit_submission_id, result_deposit_intent_id, submission_status,
               origin_inbound_event_already_consumed
        from app.capture_telegram_dry_run_deposit_reference(
          $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::smallint, $7::text
        )
      `,
      [
        referenceInboundId,
        depositIntentId,
        'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC',
        'f'.repeat(64),
        '***7890',
        1,
        payloadHmac('d'),
      ],
    );
    expect(captured).toEqual([
      {
        deposit_submission_id: expect.any(String),
        origin_inbound_event_already_consumed: false,
        result_deposit_intent_id: depositIntentId,
        submission_status: 'received',
      },
    ]);
    const depositSubmissionId = captured[0]!.deposit_submission_id;

    const capturedReplay = await queryAsRole<{
      readonly origin_inbound_event_already_consumed: boolean;
      readonly result_deposit_intent_id: string;
    }>(
      'fetanagent_player_actions',
      `
        select result_deposit_intent_id, origin_inbound_event_already_consumed
        from app.capture_telegram_dry_run_deposit_reference(
          $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::smallint, $7::text
        )
      `,
      [
        referenceInboundId,
        depositIntentId,
        'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC',
        'f'.repeat(64),
        '***7890',
        1,
        payloadHmac('d'),
      ],
    );
    expect(capturedReplay).toEqual([
      {
        origin_inbound_event_already_consumed: true,
        result_deposit_intent_id: depositIntentId,
      },
    ]);

    const createAdditionalShadowSubmission = async (
      externalEventSeed: string,
      expectedAmountMinor: number,
      referenceFingerprintCharacter: string,
      referenceMasked: string,
    ): Promise<{
      readonly depositIntentId: string;
      readonly depositSubmissionId: string;
    }> => {
      const openingUpdateId = BigInt(externalEventSeed);
      const referenceUpdateId = openingUpdateId + 1n;
      const openingEvent = await client.query<{ readonly id: string }>(
        `insert into app.inbound_events (
           channel, external_event_id, customer_identity_id, payload_digest
         ) values ('telegram', $1::text, $2::uuid, $3::text)
        returning id`,
        [
          `update:${openingUpdateId.toString()}`,
          telegramIdentityId,
          payloadHmac(referenceFingerprintCharacter),
        ],
      );
      const openedIntent = await queryAsRole<{ readonly deposit_intent_id: string }>(
        'fetanagent_player_actions',
        `select deposit_intent_id
         from app.open_telegram_dry_run_deposit_intent(
           $1::uuid, 'STAGING-OWNER-REVIEW-01', $2::bigint, $3::text
         )`,
        [openingEvent.rows[0]!.id, expectedAmountMinor, payloadHmac(referenceFingerprintCharacter)],
      );
      const referenceEvent = await client.query<{ readonly id: string }>(
        `insert into app.inbound_events (
           channel, external_event_id, customer_identity_id, payload_digest
         ) values ('telegram', $1::text, $2::uuid, $3::text)
        returning id`,
        [
          `update:${referenceUpdateId.toString()}`,
          telegramIdentityId,
          payloadHmac(referenceFingerprintCharacter),
        ],
      );
      const capturedSubmission = await queryAsRole<{
        readonly deposit_submission_id: string;
      }>(
        'fetanagent_player_actions',
        `select deposit_submission_id
          from app.capture_telegram_dry_run_deposit_reference(
            $1::uuid, $2::uuid, $3::text, $4::text, $5::text, 1::smallint, $6::text
          )`,
        [
          referenceEvent.rows[0]!.id,
          openedIntent[0]!.deposit_intent_id,
          `v1.${referenceFingerprintCharacter.repeat(16)}.${referenceFingerprintCharacter.repeat(24)}.${referenceFingerprintCharacter.repeat(8)}`,
          referenceFingerprintCharacter.repeat(64),
          referenceMasked,
          payloadHmac(referenceFingerprintCharacter),
        ],
      );

      return {
        depositIntentId: openedIntent[0]!.deposit_intent_id,
        depositSubmissionId: capturedSubmission[0]!.deposit_submission_id,
      };
    };

    const ownerProjection = await queryAsRole<{
      readonly deposit_intent_id: string;
      readonly deposit_status: string;
      readonly provider_code: string;
      readonly submission_status: string;
      readonly submitted_reference_masked: string;
    }>(
      'fetanagent_owner_control',
      `
        select deposit_intent_id, deposit_status, provider_code,
               submission_status, submitted_reference_masked
        from app.list_owner_dry_run_deposit_intake($1::uuid, 50)
        where deposit_intent_id = $2::uuid
      `,
      [ownerAuthUserId, depositIntentId],
    );
    expect(ownerProjection).toEqual([
      {
        deposit_intent_id: depositIntentId,
        deposit_status: 'intake_received',
        provider_code: 'cbe_birr',
        submission_status: 'received',
        submitted_reference_masked: '***7890',
      },
    ]);

    const fixtureBoundary = await client.query<{
      readonly assessments_forced_rls: boolean;
      readonly assessments_have_no_policies: boolean;
      readonly owner_can_list_assessments: boolean;
      readonly owner_can_record_assessment: boolean;
      readonly owner_can_review_assessment: boolean;
      readonly owner_has_no_assessment_table_access: boolean;
      readonly public_record_assessment_denied: boolean;
      readonly reviews_forced_rls: boolean;
      readonly reviews_have_no_policies: boolean;
    }>(`
      select
        assessment_table.relrowsecurity and assessment_table.relforcerowsecurity
          as assessments_forced_rls,
        review_table.relrowsecurity and review_table.relforcerowsecurity
          as reviews_forced_rls,
        not exists (
          select 1 from pg_policy policy
          where policy.polrelid in (assessment_table.oid, review_table.oid)
        ) as assessments_have_no_policies,
        not exists (
          select 1 from pg_policy policy where policy.polrelid = review_table.oid
        ) as reviews_have_no_policies,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text)',
          'execute'
        ) as owner_can_record_assessment,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.review_owner_dry_run_fixture_assessment(uuid,uuid,text)',
          'execute'
        ) as owner_can_review_assessment,
        has_function_privilege(
          'fetanagent_owner_control',
          'app.list_owner_dry_run_fixture_assessments(uuid,integer)',
          'execute'
        ) as owner_can_list_assessments,
        not has_table_privilege(
          'fetanagent_owner_control', assessment_table.oid,
          'select,insert,update,delete,truncate,references,trigger'
        ) and not has_table_privilege(
          'fetanagent_owner_control', review_table.oid,
          'select,insert,update,delete,truncate,references,trigger'
        ) as owner_has_no_assessment_table_access,
        not exists (
          select 1
          from pg_proc procedure
          cross join lateral aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) acl
          where procedure.oid =
            'app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text)'::regprocedure
            and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ) as public_record_assessment_denied
      from pg_class assessment_table
      join pg_namespace namespace on namespace.oid = assessment_table.relnamespace
      join pg_class review_table on review_table.relname = 'deposit_dry_run_fixture_reviews'
        and review_table.relnamespace = namespace.oid
      where namespace.nspname = 'app'
        and assessment_table.relname = 'deposit_dry_run_fixture_assessments'
    `);
    expect(fixtureBoundary.rows).toEqual([
      {
        assessments_forced_rls: true,
        assessments_have_no_policies: true,
        owner_can_list_assessments: true,
        owner_can_record_assessment: true,
        owner_can_review_assessment: true,
        owner_has_no_assessment_table_access: true,
        public_record_assessment_denied: true,
        reviews_forced_rls: true,
        reviews_have_no_policies: true,
      },
    ]);

    const fixtureAssessment = await queryAsRole<{
      readonly already_recorded: boolean;
      readonly assessment_id: string;
    }>(
      'fetanagent_owner_control',
      `select assessment_id, already_recorded
       from app.record_owner_dry_run_fixture_assessment(
         $1::uuid, $2::uuid, 'pending-status', 'would_review', 'fixture_status_pending'
       )`,
      [ownerAuthUserId, depositIntentId],
    );
    expect(fixtureAssessment).toEqual([expect.objectContaining({ already_recorded: false })]);
    const fixtureAssessmentId = fixtureAssessment[0]!.assessment_id;
    const fixtureAssessmentReplay = await queryAsRole<{
      readonly already_recorded: boolean;
      readonly assessment_id: string;
    }>(
      'fetanagent_owner_control',
      `select assessment_id, already_recorded
       from app.record_owner_dry_run_fixture_assessment(
         $1::uuid, $2::uuid, 'pending-status', 'would_review', 'fixture_status_pending'
       )`,
      [ownerAuthUserId, depositIntentId],
    );
    expect(fixtureAssessmentReplay).toEqual([
      { already_recorded: true, assessment_id: fixtureAssessmentId },
    ]);

    const fixtureReview = await queryAsRole<{
      readonly already_recorded: boolean;
      readonly assessment_id: string;
      readonly decision: string;
    }>(
      'fetanagent_owner_control',
      `select assessment_id, decision, already_recorded
       from app.review_owner_dry_run_fixture_assessment(
         $1::uuid, $2::uuid, 'manual_review_required'
       )`,
      [ownerAuthUserId, fixtureAssessmentId],
    );
    expect(fixtureReview).toEqual([
      {
        already_recorded: false,
        assessment_id: fixtureAssessmentId,
        decision: 'manual_review_required',
      },
    ]);

    const fixtureProjection = await queryAsRole<{
      readonly assessment_id: string;
      readonly outcome: string;
      readonly review_decision: string;
    }>(
      'fetanagent_owner_control',
      `select assessment_id, outcome, review_decision
       from app.list_owner_dry_run_fixture_assessments($1::uuid, 50)
       where assessment_id = $2::uuid`,
      [ownerAuthUserId, fixtureAssessmentId],
    );
    expect(fixtureProjection).toEqual([
      {
        assessment_id: fixtureAssessmentId,
        outcome: 'would_review',
        review_decision: 'manual_review_required',
      },
    ]);

    await expect(
      client.query(
        `update app.deposit_dry_run_fixture_assessments
            set reason_code = 'amount_mismatch'
          where id = $1::uuid`,
        [fixtureAssessmentId],
      ),
    ).rejects.toThrow(/append-only/u);

    const advisoryRows = await client.query<{
      readonly assessments: number;
      readonly assessment_audits: number;
      readonly review_audits: number;
      readonly reviews: number;
    }>(
      `select
         (select count(*)::integer from app.deposit_dry_run_fixture_assessments)
           as assessments,
         (select count(*)::integer from app.deposit_dry_run_fixture_reviews) as reviews,
         (select count(*)::integer from app.audit_events
           where action = 'deposit.dry_run_fixture_assessed') as assessment_audits,
         (select count(*)::integer from app.audit_events
           where action = 'deposit.dry_run_fixture_reviewed') as review_audits`,
    );
    expect(advisoryRows.rows).toEqual([
      { assessment_audits: 1, assessments: 1, review_audits: 1, reviews: 1 },
    ]);

    await expect(
      queryAsRole(
        'fetanagent_api',
        `select * from app.record_owner_dry_run_fixture_assessment(
          $1::uuid, $2::uuid, 'pending-status', 'would_review', 'fixture_status_pending'
        )`,
        [ownerAuthUserId, depositIntentId],
      ),
    ).rejects.toThrow(/permission denied/u);

    const authoritativeBaseline = await client.query<{
      readonly claims: number;
      readonly deposit_status: string;
      readonly evidence: number;
      readonly jobs: number;
      readonly state_events: number;
      readonly submission_status: string;
      readonly verification_attempts: number;
    }>(
      `
        select
          (select count(*)::integer from app.provider_payment_evidence) as evidence,
          (select count(*)::integer from app.deposit_verification_attempts)
            as verification_attempts,
          (select count(*)::integer from app.deposit_payment_claims) as claims,
          (select count(*)::integer from app.deposit_jobs) as jobs,
          (select count(*)::integer from app.deposit_state_events
            where deposit_intent_id = $1::uuid) as state_events,
          (select status from app.deposit_intents where id = $1::uuid) as deposit_status,
          (select status from app.deposit_submissions where id = $2::uuid)
            as submission_status
      `,
      [depositIntentId, depositSubmissionId],
    );

    const shadowEnqueue = await queryAsRole<{
      readonly already_enqueued: boolean;
      readonly job_id: string;
      readonly job_status: string;
    }>(
      'fetanagent_owner_control',
      `select job_id, job_status, already_enqueued
       from app.enqueue_cbe_birr_shadow_verification($1::uuid, $2::uuid, $3::uuid)`,
      [ownerAuthUserId, depositIntentId, depositSubmissionId],
    );
    expect(shadowEnqueue).toEqual([
      {
        already_enqueued: false,
        job_id: expect.any(String),
        job_status: 'queued',
      },
    ]);
    const shadowJobId = shadowEnqueue[0]!.job_id;

    const shadowEnqueueReplay = await queryAsRole<{
      readonly already_enqueued: boolean;
      readonly job_id: string;
      readonly job_status: string;
    }>(
      'fetanagent_owner_control',
      `select job_id, job_status, already_enqueued
       from app.enqueue_cbe_birr_shadow_verification($1::uuid, $2::uuid, $3::uuid)`,
      [ownerAuthUserId, depositIntentId, depositSubmissionId],
    );
    expect(shadowEnqueueReplay).toEqual([
      { already_enqueued: true, job_id: shadowJobId, job_status: 'queued' },
    ]);

    await expect(
      queryAsRole(
        'fetanagent_api',
        `select * from app.enqueue_cbe_birr_shadow_verification(
           $1::uuid, $2::uuid, $3::uuid
         )`,
        [ownerAuthUserId, depositIntentId, depositSubmissionId],
      ),
    ).rejects.toThrow(/permission denied/u);

    type ShadowPreflightRow = {
      readonly blocker_code: string;
      readonly eligibility: string;
      readonly job_id: string;
      readonly lease_allowed: boolean;
      readonly preflight_version: string;
      readonly protected_material_allowed: boolean;
      readonly verifier_version: string;
    };
    type ShadowPreflightMutationSnapshot = {
      readonly audit_events: number;
      readonly claims: number;
      readonly deposit_jobs: number;
      readonly deposit_status: string;
      readonly evidence: number;
      readonly shadow_job: Readonly<Record<string, unknown>>;
      readonly shadow_job_xmin: string;
      readonly shadow_results: number;
      readonly state_events: number;
      readonly submission_status: string;
      readonly verification_attempts: number;
    };
    const readShadowPreflightMutationSnapshot =
      async (): Promise<ShadowPreflightMutationSnapshot> => {
        const snapshot = await client.query<ShadowPreflightMutationSnapshot>(
          `select
           (select to_jsonb(shadow_job)
              from app.cbe_birr_shadow_verification_jobs shadow_job
             where shadow_job.id = $1::uuid) as shadow_job,
           (select shadow_job.xmin::text
              from app.cbe_birr_shadow_verification_jobs shadow_job
             where shadow_job.id = $1::uuid) as shadow_job_xmin,
           (select count(*)::integer
              from app.cbe_birr_shadow_verification_results
             where job_id = $1::uuid) as shadow_results,
           (select count(*)::integer from app.deposit_verification_attempts)
             as verification_attempts,
           (select count(*)::integer from app.provider_payment_evidence) as evidence,
           (select count(*)::integer from app.deposit_payment_claims) as claims,
           (select count(*)::integer from app.deposit_jobs) as deposit_jobs,
           (select count(*)::integer from app.deposit_state_events
             where deposit_intent_id = $2::uuid) as state_events,
           (select status::text from app.deposit_intents where id = $2::uuid)
             as deposit_status,
           (select status::text from app.deposit_submissions where id = $3::uuid)
             as submission_status,
           (select count(*)::integer from app.audit_events) as audit_events`,
          [shadowJobId, depositIntentId, depositSubmissionId],
        );
        expect(snapshot.rows).toHaveLength(1);
        return snapshot.rows[0]!;
      };
    const expectedShadowPreflight: ShadowPreflightRow = {
      blocker_code: 'legacy_protected_lookup_material_ineligible',
      eligibility: 'blocked',
      job_id: shadowJobId,
      lease_allowed: false,
      preflight_version: 'cbe-birr-shadow-preflight-v1',
      protected_material_allowed: false,
      verifier_version: 'cbe-birr-shadow-v1',
    };
    const preflightMutationBaseline = await readShadowPreflightMutationSnapshot();
    const firstPreflight = await queryAsRole<ShadowPreflightRow>(
      'fetanagent_cbe_birr_shadow_worker',
      `select job_id, preflight_version, verifier_version, eligibility,
              blocker_code, lease_allowed, protected_material_allowed
         from app.preflight_cbe_birr_shadow_verification_job($1::uuid)`,
      [shadowJobId],
    );
    const replayedPreflight = await queryAsRole<ShadowPreflightRow>(
      'fetanagent_cbe_birr_shadow_worker',
      `select job_id, preflight_version, verifier_version, eligibility,
              blocker_code, lease_allowed, protected_material_allowed
         from app.preflight_cbe_birr_shadow_verification_job($1::uuid)`,
      [shadowJobId],
    );
    expect(firstPreflight).toEqual([expectedShadowPreflight]);
    expect(replayedPreflight).toEqual(firstPreflight);
    expect(Object.keys(firstPreflight[0]!).sort()).toEqual(
      [
        'job_id',
        'preflight_version',
        'verifier_version',
        'eligibility',
        'blocker_code',
        'lease_allowed',
        'protected_material_allowed',
      ].sort(),
    );
    expect(Object.keys(firstPreflight[0]!).join(' ')).not.toMatch(
      /ciphertext|key|deposit|receiver|submission/u,
    );

    await expect(
      queryAsRole(
        'fetanagent_cbe_birr_shadow_worker',
        'select * from app.preflight_cbe_birr_shadow_verification_job(null::uuid)',
      ),
    ).rejects.toThrow('The CBE Birr shadow preflight request is invalid.');
    const nonexistentPreflight = await queryAsRole<ShadowPreflightRow>(
      'fetanagent_cbe_birr_shadow_worker',
      'select * from app.preflight_cbe_birr_shadow_verification_job($1::uuid)',
      ['99999999-9999-4999-8999-999999999999'],
    );
    expect(nonexistentPreflight).toEqual([]);
    await expect(
      queryAsRole(
        'fetanagent_cbe_birr_shadow_worker',
        'select * from app.preflight_cbe_birr_shadow_verification_job($1::uuid)',
        [`${shadowJobId}' or true --`],
      ),
    ).rejects.toThrow(/invalid input syntax for type uuid/u);

    for (const deniedRole of [
      'fetanagent_api',
      'fetanagent_beta_admission',
      'fetanagent_owner_control',
      'fetanagent_player_actions',
    ] as const) {
      await expect(
        queryAsRole(
          deniedRole,
          'select * from app.preflight_cbe_birr_shadow_verification_job($1::uuid)',
          [shadowJobId],
        ),
      ).rejects.toThrow(/permission denied/u);
    }

    const deniedLegacyLeaseToken = '33333333-3333-4333-8333-333333333333';
    await expect(
      queryAsRole(
        'fetanagent_cbe_birr_shadow_worker',
        'select * from app.lease_cbe_birr_shadow_verification_job($1::uuid, 30)',
        ['22222222-2222-4222-8222-222222222222'],
      ),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      queryAsRole(
        'fetanagent_cbe_birr_shadow_worker',
        `select * from app.complete_cbe_birr_shadow_verification_job(
           $1::uuid, $2::uuid, 1, 'would_review', 'provider_network_uncertain',
           null, null, 'cbe-birr-shadow-worker-v1', 'cbe-birr-normalization-v1'
         )`,
        [shadowJobId, deniedLegacyLeaseToken],
      ),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      queryAsRole(
        'fetanagent_cbe_birr_shadow_worker',
        `select * from app.retry_cbe_birr_shadow_verification_job(
           $1::uuid, $2::uuid, 1, 'provider_network_uncertain', 1
         )`,
        [shadowJobId, deniedLegacyLeaseToken],
      ),
    ).rejects.toThrow(/permission denied/u);

    for (const protectedTable of [
      'feature_switches',
      'cbe_birr_shadow_verification_jobs',
      'cbe_birr_shadow_verification_results',
      'deposit_verification_attempts',
      'provider_payment_evidence',
      'deposit_payment_claims',
      'deposit_jobs',
      'deposit_state_events',
    ]) {
      await expect(
        queryAsRole(
          'fetanagent_cbe_birr_shadow_worker',
          `select * from app.${protectedTable} limit 1`,
        ),
      ).rejects.toThrow(/permission denied|row-level security/u);
    }

    for (const financialSwitch of [
      'payment_verification',
      'deposit_execution',
      'withdrawal_validation',
      'withdrawal_collection',
    ]) {
      await client.query('begin');
      try {
        await client.query(
          `update app.feature_switches set mode = 'dry_run' where feature_key = $1::text`,
          [financialSwitch],
        );
        await client.query('set local role fetanagent_cbe_birr_shadow_worker');
        await expect(
          client.query('select * from app.preflight_cbe_birr_shadow_verification_job($1::uuid)', [
            shadowJobId,
          ]),
        ).rejects.toThrow('requires every financial feature to remain disabled');
      } finally {
        await client.query('rollback');
      }
    }
    await client.query('begin');
    try {
      await client.query(
        `delete from app.feature_switches where feature_key = 'withdrawal_collection'`,
      );
      await client.query('set local role fetanagent_cbe_birr_shadow_worker');
      await expect(
        client.query('select * from app.preflight_cbe_birr_shadow_verification_job($1::uuid)', [
          shadowJobId,
        ]),
      ).rejects.toThrow('requires every financial feature to remain disabled');
    } finally {
      await client.query('rollback');
    }
    expect(await readShadowPreflightMutationSnapshot()).toEqual(preflightMutationBaseline);

    const shadowWorkerId = '22222222-2222-4222-8222-222222222222';
    const firstLease = await queryAsMigrationOwner<{
      readonly attempt_number: number;
      readonly deposit_intent_id: string;
      readonly deposit_submission_id: string;
      readonly job_id: string;
      readonly lease_token: string;
      readonly receiver_verification_reference_ciphertext: string;
      readonly submitted_reference_ciphertext: string;
    }>(
      `select job_id, deposit_intent_id, deposit_submission_id, attempt_number,
              lease_token, submitted_reference_ciphertext,
              receiver_verification_reference_ciphertext
       from app.lease_cbe_birr_shadow_verification_job($1::uuid, 1)`,
      [shadowWorkerId],
    );
    expect(firstLease).toEqual([
      {
        attempt_number: 1,
        deposit_intent_id: depositIntentId,
        deposit_submission_id: depositSubmissionId,
        job_id: shadowJobId,
        lease_token: expect.any(String),
        receiver_verification_reference_ciphertext: 'receiver-verification-ciphertext',
        submitted_reference_ciphertext: 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC',
      },
    ]);

    await client.query('select pg_sleep(1.1)');
    await expect(
      queryAsMigrationOwner(
        `select * from app.complete_cbe_birr_shadow_verification_job(
           $1::uuid, $2::uuid, 1, 'would_review', 'provider_network_uncertain',
           null, null, 'cbe-birr-shadow-worker-v1', 'cbe-birr-normalization-v1'
         )`,
        [shadowJobId, firstLease[0]!.lease_token],
      ),
    ).rejects.toThrow(/lease has expired/u);

    const reclaimedLease = await queryAsMigrationOwner<{
      readonly attempt_number: number;
      readonly job_id: string;
      readonly lease_token: string;
    }>(
      `select job_id, attempt_number, lease_token
       from app.lease_cbe_birr_shadow_verification_job($1::uuid, 30)`,
      [shadowWorkerId],
    );
    expect(reclaimedLease).toEqual([
      { attempt_number: 2, job_id: shadowJobId, lease_token: expect.any(String) },
    ]);
    expect(reclaimedLease[0]!.lease_token).not.toBe(firstLease[0]!.lease_token);

    const scheduledRetry = await queryAsMigrationOwner<{
      readonly already_recorded: boolean;
      readonly attempt_number: number;
      readonly job_id: string;
      readonly job_status: string;
      readonly run_after: Date;
    }>(
      `select job_id, job_status, attempt_number, run_after, already_recorded
       from app.retry_cbe_birr_shadow_verification_job(
         $1::uuid, $2::uuid, 2, 'provider_network_uncertain', 1
       )`,
      [shadowJobId, reclaimedLease[0]!.lease_token],
    );
    expect(scheduledRetry).toEqual([
      {
        already_recorded: false,
        attempt_number: 2,
        job_id: shadowJobId,
        job_status: 'retry_wait',
        run_after: expect.any(Date),
      },
    ]);

    const scheduledRetryReplay = await queryAsMigrationOwner<{
      readonly already_recorded: boolean;
      readonly attempt_number: number;
      readonly job_id: string;
      readonly job_status: string;
      readonly run_after: Date;
    }>(
      `select job_id, job_status, attempt_number, run_after, already_recorded
       from app.retry_cbe_birr_shadow_verification_job(
         $1::uuid, $2::uuid, 2, 'provider_network_uncertain', 1
       )`,
      [shadowJobId, reclaimedLease[0]!.lease_token],
    );
    expect(scheduledRetryReplay).toEqual([
      {
        already_recorded: true,
        attempt_number: 2,
        job_id: shadowJobId,
        job_status: 'retry_wait',
        run_after: scheduledRetry[0]!.run_after,
      },
    ]);
    await expect(
      queryAsMigrationOwner(
        `select * from app.retry_cbe_birr_shadow_verification_job(
           $1::uuid, $2::uuid, 2, 'provider_network_uncertain', 2
         )`,
        [shadowJobId, reclaimedLease[0]!.lease_token],
      ),
    ).rejects.toThrow(/not leased by this exact attempt/u);

    await client.query('select pg_sleep(1.1)');
    const finalLease = await queryAsMigrationOwner<{
      readonly attempt_number: number;
      readonly job_id: string;
      readonly lease_token: string;
    }>(
      `select job_id, attempt_number, lease_token
       from app.lease_cbe_birr_shadow_verification_job($1::uuid, 30)`,
      [shadowWorkerId],
    );
    expect(finalLease).toEqual([
      { attempt_number: 3, job_id: shadowJobId, lease_token: expect.any(String) },
    ]);

    const canonicalReferenceFingerprint = 'a'.repeat(64);
    const workerDecisionDigest = 'b'.repeat(64);
    const completedShadow = await queryAsMigrationOwner<{
      readonly already_recorded: boolean;
      readonly job_id: string;
      readonly outcome: string;
      readonly reason_code: string;
      readonly result_id: string;
    }>(
      `select job_id, result_id, outcome, reason_code, already_recorded
       from app.complete_cbe_birr_shadow_verification_job(
         $1::uuid, $2::uuid, 3, 'would_verify', 'shadow_checks_passed',
         $3::text, $4::text, 'cbe-birr-shadow-worker-v1',
         'cbe-birr-normalization-v1'
       )`,
      [
        shadowJobId,
        finalLease[0]!.lease_token,
        canonicalReferenceFingerprint,
        workerDecisionDigest,
      ],
    );
    expect(completedShadow).toEqual([
      {
        already_recorded: false,
        job_id: shadowJobId,
        outcome: 'would_verify',
        reason_code: 'shadow_checks_passed',
        result_id: expect.any(String),
      },
    ]);

    const completedShadowReplay = await queryAsMigrationOwner<{
      readonly already_recorded: boolean;
      readonly job_id: string;
      readonly outcome: string;
      readonly reason_code: string;
      readonly result_id: string;
    }>(
      `select job_id, result_id, outcome, reason_code, already_recorded
       from app.complete_cbe_birr_shadow_verification_job(
         $1::uuid, $2::uuid, 3, 'would_verify', 'shadow_checks_passed',
         $3::text, $4::text, 'cbe-birr-shadow-worker-v1',
         'cbe-birr-normalization-v1'
       )`,
      [
        shadowJobId,
        finalLease[0]!.lease_token,
        canonicalReferenceFingerprint,
        workerDecisionDigest,
      ],
    );
    expect(completedShadowReplay).toEqual([{ ...completedShadow[0]!, already_recorded: true }]);
    await expect(
      queryAsMigrationOwner(
        `select * from app.complete_cbe_birr_shadow_verification_job(
           $1::uuid, $2::uuid, 3, 'would_verify', 'shadow_checks_passed',
           $3::text, $4::text, 'cbe-birr-shadow-worker-v1',
           'cbe-birr-normalization-v1'
         )`,
        [shadowJobId, finalLease[0]!.lease_token, canonicalReferenceFingerprint, 'c'.repeat(64)],
      ),
    ).rejects.toThrow(/does not match its result/u);

    const completedPreflightMutationBaseline = await readShadowPreflightMutationSnapshot();
    const completedJobPreflight = await queryAsRole<ShadowPreflightRow>(
      'fetanagent_cbe_birr_shadow_worker',
      `select job_id, preflight_version, verifier_version, eligibility,
              blocker_code, lease_allowed, protected_material_allowed
         from app.preflight_cbe_birr_shadow_verification_job($1::uuid)`,
      [shadowJobId],
    );
    expect(completedJobPreflight).toEqual([expectedShadowPreflight]);
    expect(await readShadowPreflightMutationSnapshot()).toEqual(completedPreflightMutationBaseline);

    const duplicateInput = await createAdditionalShadowSubmission(
      '9500000010',
      2600,
      'd',
      '***0002',
    );
    const duplicateEnqueue = await queryAsRole<{
      readonly job_id: string;
    }>(
      'fetanagent_owner_control',
      `select job_id
       from app.enqueue_cbe_birr_shadow_verification($1::uuid, $2::uuid, $3::uuid)`,
      [ownerAuthUserId, duplicateInput.depositIntentId, duplicateInput.depositSubmissionId],
    );
    const duplicateLease = await queryAsMigrationOwner<{
      readonly attempt_number: number;
      readonly job_id: string;
      readonly lease_token: string;
    }>(
      `select job_id, attempt_number, lease_token
       from app.lease_cbe_birr_shadow_verification_job($1::uuid, 30)`,
      [shadowWorkerId],
    );
    expect(duplicateLease).toEqual([
      {
        attempt_number: 1,
        job_id: duplicateEnqueue[0]!.job_id,
        lease_token: expect.any(String),
      },
    ]);
    const duplicateCompletion = await queryAsMigrationOwner<{
      readonly outcome: string;
      readonly reason_code: string;
    }>(
      `select outcome, reason_code
       from app.complete_cbe_birr_shadow_verification_job(
         $1::uuid, $2::uuid, 1, 'would_verify', 'shadow_checks_passed',
         $3::text, $4::text, 'cbe-birr-shadow-worker-v1',
         'cbe-birr-normalization-v1'
       )`,
      [
        duplicateEnqueue[0]!.job_id,
        duplicateLease[0]!.lease_token,
        canonicalReferenceFingerprint,
        'd'.repeat(64),
      ],
    );
    expect(duplicateCompletion).toEqual([
      { outcome: 'would_reject', reason_code: 'provider_reference_reused' },
    ]);
    const duplicateStoredResult = await client.query<{
      readonly outcome: string;
      readonly reason_code: string;
      readonly reported_outcome: string;
      readonly reported_reason_code: string;
    }>(
      `select reported_outcome, reported_reason_code, outcome, reason_code
       from app.cbe_birr_shadow_verification_results
       where job_id = $1::uuid`,
      [duplicateEnqueue[0]!.job_id],
    );
    expect(duplicateStoredResult.rows).toEqual([
      {
        outcome: 'would_reject',
        reason_code: 'provider_reference_reused',
        reported_outcome: 'would_verify',
        reported_reason_code: 'shadow_checks_passed',
      },
    ]);

    const retryExhaustionInput = await createAdditionalShadowSubmission(
      '9500000020',
      2700,
      'e',
      '***0003',
    );
    const retryExhaustionEnqueue = await queryAsRole<{
      readonly job_id: string;
    }>(
      'fetanagent_owner_control',
      `select job_id
       from app.enqueue_cbe_birr_shadow_verification($1::uuid, $2::uuid, $3::uuid)`,
      [
        ownerAuthUserId,
        retryExhaustionInput.depositIntentId,
        retryExhaustionInput.depositSubmissionId,
      ],
    );
    const retryExhaustionJobId = retryExhaustionEnqueue[0]!.job_id;
    let terminalRetryLeaseToken = '';
    for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber += 1) {
      const retryLease = await queryAsMigrationOwner<{
        readonly attempt_number: number;
        readonly job_id: string;
        readonly lease_token: string;
      }>(
        `select job_id, attempt_number, lease_token
         from app.lease_cbe_birr_shadow_verification_job($1::uuid, 30)`,
        [shadowWorkerId],
      );
      expect(retryLease).toEqual([
        {
          attempt_number: attemptNumber,
          job_id: retryExhaustionJobId,
          lease_token: expect.any(String),
        },
      ]);
      terminalRetryLeaseToken = retryLease[0]!.lease_token;

      const retryReceipt = await queryAsMigrationOwner<{
        readonly already_recorded: boolean;
        readonly attempt_number: number;
        readonly job_id: string;
        readonly job_status: string;
        readonly outcome: string | null;
        readonly reason_code: string | null;
      }>(
        `select job_id, job_status, attempt_number, outcome, reason_code,
                already_recorded
         from app.retry_cbe_birr_shadow_verification_job(
           $1::uuid, $2::uuid, $3::integer,
           'authoritative_receipt_unavailable', 1
         )`,
        [retryExhaustionJobId, terminalRetryLeaseToken, attemptNumber],
      );

      if (attemptNumber < 5) {
        expect(retryReceipt).toEqual([
          {
            already_recorded: false,
            attempt_number: attemptNumber,
            job_id: retryExhaustionJobId,
            job_status: 'retry_wait',
            outcome: null,
            reason_code: null,
          },
        ]);
        await client.query('select pg_sleep(1.1)');
      } else {
        expect(retryReceipt).toEqual([
          {
            already_recorded: false,
            attempt_number: 5,
            job_id: retryExhaustionJobId,
            job_status: 'completed',
            outcome: 'would_review',
            reason_code: 'authoritative_receipt_unavailable',
          },
        ]);
      }
    }
    const terminalRetryReplay = await queryAsMigrationOwner<{
      readonly already_recorded: boolean;
      readonly attempt_number: number;
      readonly job_id: string;
      readonly job_status: string;
      readonly outcome: string;
      readonly reason_code: string;
    }>(
      `select job_id, job_status, attempt_number, outcome, reason_code, already_recorded
       from app.retry_cbe_birr_shadow_verification_job(
         $1::uuid, $2::uuid, 5, 'authoritative_receipt_unavailable', 1
       )`,
      [retryExhaustionJobId, terminalRetryLeaseToken],
    );
    expect(terminalRetryReplay).toEqual([
      {
        already_recorded: true,
        attempt_number: 5,
        job_id: retryExhaustionJobId,
        job_status: 'completed',
        outcome: 'would_review',
        reason_code: 'authoritative_receipt_unavailable',
      },
    ]);

    const shadowOwnerProjection = await queryAsRole<{
      readonly attempt_count: number;
      readonly deposit_intent_id: string;
      readonly deposit_submission_id: string;
      readonly job_id: string;
      readonly job_status: string;
      readonly outcome: string;
      readonly reason_code: string;
    }>(
      'fetanagent_owner_control',
      `select job_id, deposit_intent_id, deposit_submission_id, job_status,
              attempt_count, outcome, reason_code
       from app.list_owner_cbe_birr_shadow_verifications($1::uuid, 50)
       where job_id = $2::uuid`,
      [ownerAuthUserId, shadowJobId],
    );
    expect(shadowOwnerProjection).toEqual([
      {
        attempt_count: 3,
        deposit_intent_id: depositIntentId,
        deposit_submission_id: depositSubmissionId,
        job_id: shadowJobId,
        job_status: 'completed',
        outcome: 'would_verify',
        reason_code: 'shadow_checks_passed',
      },
    ]);
    expect(JSON.stringify(shadowOwnerProjection)).not.toMatch(
      /ciphertext|fingerprint|digest|key_version/u,
    );

    await expect(
      queryAsRole(
        'fetanagent_cbe_birr_shadow_worker',
        'select * from app.cbe_birr_shadow_verification_jobs',
      ),
    ).rejects.toThrow(/permission denied|row-level security/u);
    await expect(
      queryAsRole(
        'fetanagent_cbe_birr_shadow_worker',
        `select * from app.claim_verified_deposit_payment(
           $1::uuid, $2::uuid, $3::uuid
         )`,
        [depositIntentId, depositSubmissionId, completedShadow[0]!.result_id],
      ),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      client.query(
        `update app.cbe_birr_shadow_verification_results
            set reason_code = 'receiver_mismatch'
          where id = $1::uuid`,
        [completedShadow[0]!.result_id],
      ),
    ).rejects.toThrow(/append-only/u);

    const shadowAudits = await client.query<{
      readonly action: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    }>(`
      select action, metadata
      from app.audit_events
      where action like 'deposit.cbe_birr_shadow_%'
      order by created_at, id
    `);
    const safeShadowAuditKeys = new Set([
      'job_id',
      'deposit_intent_id',
      'deposit_submission_id',
      'attempt_number',
      'outcome',
      'reason_code',
      'retry_after_seconds',
    ]);
    expect(shadowAudits.rows.length).toBeGreaterThan(0);
    expect(
      shadowAudits.rows.every((audit) =>
        Object.keys(audit.metadata).every((key) => safeShadowAuditKeys.has(key)),
      ),
    ).toBe(true);
    expect(JSON.stringify(shadowAudits.rows)).not.toContain(
      'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC',
    );
    expect(JSON.stringify(shadowAudits.rows)).not.toContain('receiver-verification-ciphertext');

    const authoritativeAfterShadow = await client.query<{
      readonly claims: number;
      readonly deposit_status: string;
      readonly evidence: number;
      readonly jobs: number;
      readonly state_events: number;
      readonly submission_status: string;
      readonly verification_attempts: number;
    }>(
      `
        select
          (select count(*)::integer from app.provider_payment_evidence) as evidence,
          (select count(*)::integer from app.deposit_verification_attempts)
            as verification_attempts,
          (select count(*)::integer from app.deposit_payment_claims) as claims,
          (select count(*)::integer from app.deposit_jobs) as jobs,
          (select count(*)::integer from app.deposit_state_events
            where deposit_intent_id = $1::uuid) as state_events,
          (select status from app.deposit_intents where id = $1::uuid) as deposit_status,
          (select status from app.deposit_submissions where id = $2::uuid)
            as submission_status
      `,
      [depositIntentId, depositSubmissionId],
    );
    expect(authoritativeAfterShadow.rows).toEqual(authoritativeBaseline.rows);

    await client.query('begin');
    try {
      await client.query(
        `update app.feature_switches
            set mode = 'dry_run'
          where feature_key = 'payment_verification'`,
      );
      await expect(
        client.query(`select * from app.lease_cbe_birr_shadow_verification_job($1::uuid, 30)`, [
          shadowWorkerId,
        ]),
      ).rejects.toThrow('requires every financial feature to remain disabled');
    } finally {
      await client.query('rollback');
    }

    const inertLedger = await client.query<{
      readonly all_financial_switches_disabled: boolean;
      readonly claims: number;
      readonly evidence: number;
      readonly jobs: number;
      readonly non_disabled_switches: number;
    }>(
      `
        select
          (
            select count(*) = 4 and bool_and(feature_switch.mode = 'disabled')
            from app.feature_switches feature_switch
            where feature_switch.feature_key in (
              'payment_verification', 'deposit_execution',
              'withdrawal_validation', 'withdrawal_collection'
            )
          ) as all_financial_switches_disabled,
          (select count(*)::integer from app.provider_payment_evidence) as evidence,
          (select count(*)::integer from app.deposit_payment_claims) as claims,
          (select count(*)::integer from app.deposit_jobs) as jobs,
          (
            select count(*)::integer
            from app.feature_switches feature_switch
            where feature_switch.mode <> 'disabled'
          ) as non_disabled_switches
      `,
    );
    expect(inertLedger.rows).toEqual([
      {
        all_financial_switches_disabled: true,
        claims: 0,
        evidence: 0,
        jobs: 0,
        non_disabled_switches: 0,
      },
    ]);

    await expect(
      queryAsRole(
        'fetanagent_api',
        `select * from app.open_telegram_dry_run_deposit_intent(
           $1::uuid, $2::text, $3::bigint, $4::text
         )`,
        [openingInboundId, 'STAGING-OWNER-REVIEW-01', 2500, payloadHmac('b')],
      ),
    ).rejects.toThrow(/permission denied/u);

    const blockedInbound = await client.query<{ readonly id: string }>(
      `
        insert into app.inbound_events (
          channel, external_event_id, customer_identity_id, payload_digest
        )
        values ('telegram', 'update:9500000003', $1::uuid, $2::text)
        returning id
      `,
      [telegramIdentityId, payloadHmac('e')],
    );
    await client.query('begin');
    try {
      await client.query(
        `update app.feature_switches set mode = 'dry_run' where feature_key = 'payment_verification'`,
      );
      await client.query('set local role fetanagent_player_actions');
      await expect(
        client.query(
          `select * from app.open_telegram_dry_run_deposit_intent(
             $1::uuid, $2::text, $3::bigint, $4::text
           )`,
          [blockedInbound.rows[0]!.id, 'STAGING-OWNER-REVIEW-01', 2500, payloadHmac('f')],
        ),
      ).rejects.toThrow('requires every financial feature to remain disabled');
    } finally {
      await client.query('rollback');
    }

    await expect(
      queryAsRole(
        'fetanagent_api',
        `select * from app.associate_owner_validated_player_registration_request(
           $1::uuid, $2::uuid, 'owner_verified_platform_ownership'
         )`,
        [ownerAuthUserId, requestId],
      ),
    ).rejects.toThrow(/permission denied/u);

    await expect(
      queryAsRole(
        'fetanagent_owner_control',
        `
          select *
          from app.review_owner_player_registration_request(
            $1::uuid,
            $2::uuid,
            'not_found',
            'owner_platform_lookup'
          )
        `,
        [ownerAuthUserId, requestId],
      ),
    ).rejects.toThrow('no longer reviewable');

    await expect(
      queryAsRole(
        'fetanagent_owner_control',
        `update app.player_registration_requests set status = 'cancelled' where id = $1::uuid`,
        [requestId],
      ),
    ).rejects.toThrow(/permission denied|row-level security/u);
  });

  it('pins the private customer-web registration and live-deposit catalog, ACL, and source boundary exactly', async () => {
    const migrationSource = await readFile(
      join(environment.migrationsDirectory, '20260815020000_customer_web_player_registration.sql'),
      'utf8',
    );
    const readyProjectionMigrationSource = await readFile(
      join(
        environment.migrationsDirectory,
        '20260815154559_require_current_deposit_eligibility_for_customer_ready.sql',
      ),
      'utf8',
    );
    const rateLimitMigrationSource = await readFile(
      join(environment.migrationsDirectory, '20260819124846_customer_web_durable_rate_limit.sql'),
      'utf8',
    );
    expect(migrationSource).toContain(
      'create function app.submit_customer_web_player_registration(\n  p_actor_auth_user_id uuid,\n  p_request_key uuid,\n  p_player_id text',
    );
    expect(migrationSource).not.toMatch(/\bauth\.uid\s*\(/iu);
    expect(migrationSource).not.toMatch(
      /\bgrant\s+execute[\s\S]{0,300}\bto\s+(?:public|anon|authenticated|service_role)\b/iu,
    );
    expect(migrationSource).toContain(
      "registration_request.created_at >= clock_timestamp() - interval '24 hours'",
    );
    expect(migrationSource).not.toContain(
      "request_origin.created_at >= clock_timestamp() - interval '24 hours'",
    );
    expect(
      migrationSource.match(/fetanagent:customer-web-player-association-gate:v1:/gu),
    ).toHaveLength(2);
    expect(migrationSource.match(/fetanagent:customer-auth:v1:/gu)).toHaveLength(5);
    expect(readyProjectionMigrationSource).toContain(
      'create or replace function app.list_customer_web_player_registrations(',
    );
    expect(readyProjectionMigrationSource).toContain(
      'alter function app.list_customer_web_player_registrations(uuid, integer) owner to postgres',
    );
    expect(readyProjectionMigrationSource).toContain(
      'grant execute on function app.list_customer_web_player_registrations(uuid, integer)',
    );
    expect(readyProjectionMigrationSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\.player_deposit_eligibility_decisions\b/iu,
    );
    expect(readyProjectionMigrationSource).not.toMatch(
      /\bgrant\s+[^;]*\bon\s+(?:table\s+)?app\.player_deposit_eligibility_decisions\b/iu,
    );
    expect(readyProjectionMigrationSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\.deposit_intents\b/iu,
    );
    expect(readyProjectionMigrationSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\.feature_switches\b/iu,
    );
    expect(readyProjectionMigrationSource).not.toMatch(
      /\bgrant\s+[^;]*\bon\s+(?!function\b)(?:table\s+|sequence\s+)?app\./iu,
    );
    expect(readyProjectionMigrationSource).not.toMatch(
      /\b(?:create|alter|drop)\s+(?:table|policy|role)\b/iu,
    );
    expect(rateLimitMigrationSource).toContain(
      'create function app.consume_customer_web_rate_limit(',
    );
    expect(rateLimitMigrationSource).toContain('security definer');
    expect(rateLimitMigrationSource).toContain('set search_path = pg_catalog, app, pg_temp');
    expect(rateLimitMigrationSource).not.toMatch(
      /\bgrant\s+execute[\s\S]{0,300}\bto\s+(?:public|anon|authenticated|service_role)\b/iu,
    );

    const procedures = await client.query<{
      readonly direct_runtime_execute: boolean;
      readonly group_execute: boolean;
      readonly hardened: boolean;
      readonly output_names: readonly string[];
      readonly public_execute: boolean;
      readonly runtime_effective_execute: boolean;
      readonly signature: string;
    }>(`
      select
        procedure.oid::regprocedure::text as signature,
        procedure.proargnames[(procedure.pronargs + 1):] as output_names,
        procedure.prosecdef
          and procedure.prokind = 'f'
          and procedure.proowner = 'postgres'::regrole
          and procedure.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
          as hardened,
        has_function_privilege(
          'fetanagent_customer_web', procedure.oid, 'EXECUTE'
        ) as group_execute,
        has_function_privilege(
          'fetanagent_customer_web_runtime', procedure.oid, 'EXECUTE'
        ) as runtime_effective_execute,
        exists (
          select 1
          from aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) privilege
          where privilege.grantee = 'fetanagent_customer_web_runtime'::regrole
            and privilege.privilege_type = 'EXECUTE'
        ) as direct_runtime_execute,
        exists (
          select 1
          from aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ) as public_execute
      from pg_proc procedure
      where procedure.oid in (
        'app.consume_customer_web_rate_limit(bytea,text,integer,integer)'::regprocedure,
        'app.ensure_customer_web_account(uuid)'::regprocedure,
        'app.submit_customer_web_player_registration(uuid,uuid,text)'::regprocedure,
        'app.list_customer_web_player_registrations(uuid,integer)'::regprocedure
      )
      order by signature
    `);
    expect(procedures.rows).toEqual([
      {
        direct_runtime_execute: false,
        group_execute: true,
        hardened: true,
        output_names: ['allowed', 'retry_after_seconds', 'current_count'],
        public_execute: false,
        runtime_effective_execute: true,
        signature: 'app.consume_customer_web_rate_limit(bytea,text,integer,integer)',
      },
      {
        direct_runtime_execute: false,
        group_execute: true,
        hardened: true,
        output_names: ['account_status', 'account_created'],
        public_execute: false,
        runtime_effective_execute: true,
        signature: 'app.ensure_customer_web_account(uuid)',
      },
      {
        direct_runtime_execute: false,
        group_execute: true,
        hardened: true,
        output_names: [
          'platform_code',
          'submitted_player_id',
          'request_status',
          'request_created_at',
          'request_updated_at',
        ],
        public_execute: false,
        runtime_effective_execute: true,
        signature: 'app.list_customer_web_player_registrations(uuid,integer)',
      },
      {
        direct_runtime_execute: false,
        group_execute: true,
        hardened: true,
        output_names: [
          'platform_code',
          'request_status',
          'existing_request_reused',
          'request_key_already_used',
          'request_created_at',
        ],
        public_execute: false,
        runtime_effective_execute: true,
        signature: 'app.submit_customer_web_player_registration(uuid,uuid,text)',
      },
    ]);

    const effectiveFunctions = await client.query<{ readonly signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and has_function_privilege(
          'fetanagent_customer_web_runtime', procedure.oid, 'EXECUTE'
        )
      order by signature
    `);
    expect(effectiveFunctions.rows.map((row) => row.signature)).toEqual([
      'app.capture_customer_web_deposit_reference(uuid,uuid,uuid,text,text,text,smallint)',
      'app.consume_customer_web_rate_limit(bytea,text,integer,integer)',
      'app.ensure_customer_web_account(uuid)',
      'app.list_customer_web_deposits(uuid,integer)',
      'app.list_customer_web_player_registrations(uuid,integer)',
      'app.open_customer_web_deposit_intent(uuid,uuid,text,bigint)',
      'app.submit_customer_web_player_registration(uuid,uuid,text)',
    ]);

    const rateLimitStatement = `
      select allowed, retry_after_seconds, current_count
      from app.consume_customer_web_rate_limit(
        decode($1::text, 'hex'), $2::text, $3::integer, $4::integer
      )
    `;
    const bucketKey = 'd'.repeat(64);
    const first = await queryAsRole<{
      readonly allowed: boolean;
      readonly current_count: number;
      readonly retry_after_seconds: number;
    }>('fetanagent_customer_web', rateLimitStatement, [bucketKey, 'POST /sign-in', 2, 60]);
    const second = await queryAsRole<{
      readonly allowed: boolean;
      readonly current_count: number;
      readonly retry_after_seconds: number;
    }>('fetanagent_customer_web', rateLimitStatement, [bucketKey, 'POST /sign-in', 2, 60]);
    const denied = await queryAsRole<{
      readonly allowed: boolean;
      readonly current_count: number;
      readonly retry_after_seconds: number;
    }>('fetanagent_customer_web', rateLimitStatement, [bucketKey, 'POST /sign-in', 2, 60]);
    expect(first).toEqual([{ allowed: true, current_count: 1, retry_after_seconds: 0 }]);
    expect(second).toEqual([{ allowed: true, current_count: 2, retry_after_seconds: 0 }]);
    expect(denied).toEqual([
      {
        allowed: false,
        current_count: 3,
        retry_after_seconds: expect.any(Number),
      },
    ]);
    expect(denied[0]!.retry_after_seconds).toBeGreaterThanOrEqual(1);
    await expect(
      queryAsRole('fetanagent_customer_web', 'select * from app.customer_web_rate_limit_buckets'),
    ).rejects.toThrow(/permission denied|row-level security/u);

    const customerWebRoles = await client.query<RoleRow & { readonly rolconnlimit: number }>(`
      select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
             rolreplication, rolbypassrls, rolconnlimit
      from pg_roles
      where rolname in ('fetanagent_customer_web', 'fetanagent_customer_web_runtime')
      order by rolname
    `);
    expect(customerWebRoles.rows).toEqual([
      {
        rolbypassrls: false,
        rolcanlogin: false,
        rolconnlimit: 2,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolname: 'fetanagent_customer_web',
        rolreplication: false,
        rolsuper: false,
      },
      {
        rolbypassrls: false,
        rolcanlogin: false,
        rolconnlimit: 2,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolname: 'fetanagent_customer_web_runtime',
        rolreplication: false,
        rolsuper: false,
      },
    ]);

    const unexpectedExecutors = await client.query<{
      readonly role_name: string;
      readonly signature: string;
    }>(`
      select role.rolname as role_name, procedure.oid::regprocedure::text as signature
      from pg_roles role
      cross join pg_proc procedure
      where (role.rolname in ('anon', 'authenticated', 'service_role')
          or role.rolname like 'fetanagent\\_%' escape '\\')
        and role.rolname not in (
          'fetanagent_customer_web',
          'fetanagent_customer_web_runtime'
        )
        and procedure.oid in (
          'app.ensure_customer_web_account(uuid)'::regprocedure,
          'app.submit_customer_web_player_registration(uuid,uuid,text)'::regprocedure,
          'app.list_customer_web_player_registrations(uuid,integer)'::regprocedure
        )
        and has_function_privilege(role.rolname, procedure.oid, 'EXECUTE')
      order by role_name, signature
    `);
    expect(unexpectedExecutors.rows).toEqual([]);

    const membership = await client.query<MembershipRow>(`
      select
        member_role.rolname as member_role,
        group_role.rolname as group_role,
        membership.inherit_option,
        membership.set_option,
        membership.admin_option
      from pg_auth_members membership
      join pg_roles group_role on group_role.oid = membership.roleid
      join pg_roles member_role on member_role.oid = membership.member
      where group_role.rolname in (
             'fetanagent_customer_web', 'fetanagent_customer_web_runtime'
           )
         or member_role.rolname in (
           'fetanagent_customer_web', 'fetanagent_customer_web_runtime'
         )
      order by member_role, group_role
    `);
    expect(membership.rows).toEqual([
      {
        admin_option: false,
        group_role: 'fetanagent_customer_web',
        inherit_option: true,
        member_role: 'fetanagent_customer_web_runtime',
        set_option: false,
      },
    ]);

    const mappingConstraints = await client.query<{
      readonly constraint_definition: string;
      readonly constraint_name: string;
    }>(`
      select conname as constraint_name,
             pg_get_constraintdef(catalog_constraint.oid) as constraint_definition
      from pg_constraint catalog_constraint
      where catalog_constraint.conrelid = 'app.customer_auth_identities'::regclass
        and catalog_constraint.conname in (
          'customer_auth_identities_customer_id_key',
          'customer_auth_identities_auth_user_id_key',
          'customer_auth_identities_identity_customer_fkey'
        )
      order by constraint_name
    `);
    expect(mappingConstraints.rows).toEqual([
      {
        constraint_definition: 'UNIQUE (auth_user_id)',
        constraint_name: 'customer_auth_identities_auth_user_id_key',
      },
      {
        constraint_definition: 'UNIQUE (customer_id)',
        constraint_name: 'customer_auth_identities_customer_id_key',
      },
      {
        constraint_definition:
          'FOREIGN KEY (customer_identity_id, customer_id) REFERENCES app.customer_identities(id, customer_id) ON DELETE RESTRICT',
        constraint_name: 'customer_auth_identities_identity_customer_fkey',
      },
    ]);
    const originRequestUniqueness = await client.query<{ readonly constraints: number }>(`
      select count(*)::integer as constraints
      from pg_constraint catalog_constraint
      where catalog_constraint.conrelid =
             'app.customer_web_player_registration_request_origins'::regclass
        and catalog_constraint.contype = 'u'
        and catalog_constraint.conkey = array[(
          select attribute.attnum
          from pg_attribute attribute
          where attribute.attrelid = catalog_constraint.conrelid
            and attribute.attname = 'player_registration_request_id'
            and not attribute.attisdropped
        )]::smallint[]
    `);
    expect(originRequestUniqueness.rows).toEqual([{ constraints: 1 }]);

    const basePrivileges = await client.query<{ readonly privilege_count: number }>(`
      select count(*)::integer as privilege_count
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and (
          (
            relation.relkind = 'S'
            and (
              has_sequence_privilege(
                'fetanagent_customer_web', relation.oid, 'USAGE,SELECT,UPDATE'
              )
              or has_sequence_privilege(
                'fetanagent_customer_web_runtime', relation.oid, 'USAGE,SELECT,UPDATE'
              )
            )
          )
          or (
            relation.relkind in ('r', 'p', 'v', 'm', 'f')
            and (
              has_table_privilege(
                'fetanagent_customer_web', relation.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
              or has_table_privilege(
                'fetanagent_customer_web_runtime', relation.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
              or has_any_column_privilege(
                'fetanagent_customer_web', relation.oid,
                'SELECT,INSERT,UPDATE,REFERENCES'
              )
              or has_any_column_privilege(
                'fetanagent_customer_web_runtime', relation.oid,
                'SELECT,INSERT,UPDATE,REFERENCES'
              )
            )
          )
        )
    `);
    expect(basePrivileges.rows).toEqual([{ privilege_count: 0 }]);

    const unexpectedAssociationInserters = await client.query<{ readonly role_name: string }>(`
      select role.rolname as role_name
      from pg_roles role
      where (role.rolname in ('anon', 'authenticated', 'service_role')
          or role.rolname like 'fetanagent\\_%' escape '\\')
        and has_table_privilege(
          role.rolname,
          'app.player_registration_request_associations',
          'INSERT'
        )
      order by role_name
    `);
    expect(unexpectedAssociationInserters.rows).toEqual([]);

    const associationGuard = await client.query<{
      readonly hardened: boolean;
      readonly public_execute: boolean;
      readonly trigger_enabled: string;
    }>(`
      select
        procedure.prosecdef
          and procedure.proowner = 'postgres'::regrole
          and procedure.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
          as hardened,
        exists (
          select 1
          from aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        ) as public_execute,
        trigger.tgenabled::text as trigger_enabled
      from pg_trigger trigger
      join pg_proc procedure on procedure.oid = trigger.tgfoid
      where trigger.tgrelid = 'app.player_registration_request_associations'::regclass
        and trigger.tgname = 'player_registration_associations_reject_customer_web'
        and not trigger.tgisinternal
    `);
    expect(associationGuard.rows).toEqual([
      { hardened: true, public_execute: false, trigger_enabled: 'O' },
    ]);

    const staffCustomerIdentityGuards = await client.query<{
      readonly hardened: boolean;
      readonly public_execute: boolean;
      readonly relation_name: string;
      readonly security_invoker: boolean;
      readonly trigger_enabled: string;
      readonly trigger_name: string;
    }>(`
      select
        relation.relname as relation_name,
        trigger.tgname as trigger_name,
        not procedure.prosecdef as security_invoker,
        procedure.proowner = 'postgres'::regrole
          and procedure.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
          as hardened,
        exists (
          select 1
          from aclexplode(
            coalesce(procedure.proacl, acldefault('f', procedure.proowner))
          ) privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        ) as public_execute,
        trigger.tgenabled::text as trigger_enabled
      from pg_trigger trigger
      join pg_proc procedure on procedure.oid = trigger.tgfoid
      join pg_class relation on relation.oid = trigger.tgrelid
      where trigger.tgname in (
        'customer_auth_identities_require_parent',
        'admin_users_reject_active_customer_auth_identity'
      )
        and not trigger.tgisinternal
      order by relation_name, trigger_name
    `);
    expect(staffCustomerIdentityGuards.rows).toEqual([
      {
        hardened: true,
        public_execute: false,
        relation_name: 'admin_users',
        security_invoker: true,
        trigger_enabled: 'O',
        trigger_name: 'admin_users_reject_active_customer_auth_identity',
      },
      {
        hardened: true,
        public_execute: false,
        relation_name: 'customer_auth_identities',
        security_invoker: true,
        trigger_enabled: 'O',
        trigger_name: 'customer_auth_identities_require_parent',
      },
    ]);

    const tables = await client.query<{
      readonly policies: number;
      readonly relforcerowsecurity: boolean;
      readonly relname: string;
      readonly relrowsecurity: boolean;
    }>(`
      select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity,
             count(policy.oid)::integer as policies
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      left join pg_policy policy on policy.polrelid = relation.oid
      where namespace.nspname = 'app'
        and relation.relname in (
          'customer_auth_identities',
          'customer_web_player_registration_request_origins'
        )
      group by relation.oid
      order by relation.relname
    `);
    expect(tables.rows).toEqual([
      {
        policies: 0,
        relforcerowsecurity: true,
        relname: 'customer_auth_identities',
        relrowsecurity: true,
      },
      {
        policies: 0,
        relforcerowsecurity: true,
        relname: 'customer_web_player_registration_request_origins',
        relrowsecurity: true,
      },
    ]);

    const functionDefinitions = await client.query<{ readonly definition: string }>(`
      select string_agg(lower(pg_get_functiondef(procedure.oid)), E'\\n') as definition
      from pg_proc procedure
      where procedure.oid in (
        'app.ensure_customer_web_account(uuid)'::regprocedure,
        'app.submit_customer_web_player_registration(uuid,uuid,text)'::regprocedure,
        'app.list_customer_web_player_registrations(uuid,integer)'::regprocedure
      )
    `);
    expect(functionDefinitions.rows).toHaveLength(1);
    const functionDefinition = functionDefinitions.rows[0]!.definition;
    for (const forbiddenRelation of [
      'deposit_intents',
      'deposit_submissions',
      'deposit_jobs',
      'deposit_payment_claims',
      'provider_payment_evidence',
      'feature_switches',
      'telegram_identities',
      'inbound_events',
    ]) {
      expect(functionDefinition).not.toContain(forbiddenRelation);
    }
    expect(functionDefinition).not.toMatch(/\bemail\b/iu);
    for (const requiredReadyPredicate of [
      "registration_request.status = 'exists'",
      'player_account.customer_id = resolved_customer_id',
      'player_account.platform_id = registration_request.platform_id',
      'player_account.player_id = registration_request.player_id',
      'validation_attempt.player_account_id = player_account.id',
      "validation_attempt.outcome = 'valid'",
      "player_account.status = 'active'",
      "player_account.validation_status = 'valid'",
      "platform.status = 'active'",
      'eligibility_history.decision_count > 0',
      'eligibility_history.decision_count = eligibility_history.maximum_version',
      'eligibility_history.history_is_monotonic',
      'latest_eligibility.decision_version = eligibility_history.maximum_version',
      "latest_eligibility.decision = 'eligible'",
      'latest_eligibility.decided_at <= clock_timestamp()',
    ]) {
      expect(functionDefinition).toContain(requiredReadyPredicate);
    }
    expect(functionDefinition).toMatch(
      /latest_eligibility\.player_account_updated_at_snapshot\s+is not distinct from player_account\.updated_at/iu,
    );
    expect(functionDefinition).toContain(
      "when registration_request.status in ('not_found', 'cancelled') then",
    );
    expect(
      functionDefinition.indexOf(
        "when registration_request.status in ('not_found', 'cancelled') then",
      ),
    ).toBeLessThan(functionDefinition.indexOf("when registration_request.status = 'exists'"));
    expect(functionDefinition).toMatch(/else\s+'checking'/iu);
    expect(functionDefinition).toContain('app.player_deposit_eligibility_decisions');
    expect(functionDefinition).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\.player_deposit_eligibility_decisions\b/iu,
    );
    expect(functionDefinition).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\.deposit_intents\b/iu,
    );
    const listFunctionDefinition = await client.query<{ readonly definition: string }>(`
      select lower(pg_get_functiondef(
        'app.list_customer_web_player_registrations(uuid,integer)'::regprocedure
      )) as definition
    `);
    expect(listFunctionDefinition.rows).toHaveLength(1);
    expect(listFunctionDefinition.rows[0]!.definition).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\b/iu,
    );
  });

  it('keeps active staff Auth UUIDs outside the customer-web identity boundary', async () => {
    const readIdentityBoundarySnapshot = async (): Promise<{
      readonly audits: number;
      readonly bindings: number;
      readonly customers: number;
      readonly identities: number;
      readonly origins: number;
      readonly requests: number;
    }> => {
      const result = await client.query<{
        readonly audits: number;
        readonly bindings: number;
        readonly customers: number;
        readonly identities: number;
        readonly origins: number;
        readonly requests: number;
      }>(`
        select
          (select count(*)::integer from app.customers) as customers,
          (select count(*)::integer from app.customer_identities) as identities,
          (select count(*)::integer from app.customer_auth_identities) as bindings,
          (select count(*)::integer
             from app.customer_web_player_registration_request_origins) as origins,
          (select count(*)::integer from app.player_registration_requests) as requests,
          (select count(*)::integer
             from app.audit_events
            where action in (
              'customer.web_account_created',
              'customer.web_player_registration_requested'
            )) as audits
      `);
      expect(result.rows).toHaveLength(1);
      return result.rows[0]!;
    };

    const before = await readIdentityBoundarySnapshot();

    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        'select * from app.ensure_customer_web_account($1::uuid)',
        [ownerAuthUserId],
      ),
    ).rejects.toThrow('customer-web account request is unavailable');
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, $2::uuid, $3::text
         )`,
        [ownerAuthUserId, '21111111-1111-4111-8111-333333333333', 'STAFF-PLAYER-ID'],
      ),
    ).rejects.toThrow('customer-web Player ID request is unavailable');
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        'select * from app.list_customer_web_player_registrations($1::uuid, 20)',
        [ownerAuthUserId],
      ),
    ).rejects.toThrow('customer-web Player ID list request is unavailable');

    await client.query('begin');
    try {
      const customer = await client.query<{ readonly id: string }>(
        `insert into app.customers (status) values ('active') returning id`,
      );
      const identity = await client.query<{ readonly id: string }>(
        `insert into app.customer_identities (
           customer_id, identity_kind, external_subject, status
         )
         values ($1::uuid, 'supabase_auth', $2::text, 'active')
         returning id`,
        [customer.rows[0]!.id, ownerAuthUserId],
      );
      await expect(
        client.query(
          `insert into app.customer_auth_identities (
             customer_identity_id, customer_id, auth_user_id
           )
           values ($1::uuid, $2::uuid, $3::uuid)`,
          [identity.rows[0]!.id, customer.rows[0]!.id, ownerAuthUserId],
        ),
      ).rejects.toThrow('customer Auth identity binding is unavailable');
    } finally {
      await client.query('rollback');
    }

    const inactiveStaffAuthUserId = '21111111-1111-4111-8111-444444444444';
    await client.query('begin');
    try {
      await client.query(
        `insert into auth.users (id, email)
         values ($1::uuid, 'inactive-staff-customer@example.invalid')`,
        [inactiveStaffAuthUserId],
      );
      await client.query(
        `insert into app.admin_users (auth_user_id, role, status)
         values ($1::uuid, 'administrator', 'inactive')`,
        [inactiveStaffAuthUserId],
      );
      await client.query('set local role fetanagent_customer_web');
      const customerAccount = await client.query<{
        readonly account_created: boolean;
        readonly account_status: string;
      }>('select * from app.ensure_customer_web_account($1::uuid)', [inactiveStaffAuthUserId]);
      expect(customerAccount.rows).toEqual([{ account_created: true, account_status: 'active' }]);
      await client.query('reset role');
      await expect(
        client.query(
          `update app.admin_users
              set status = 'active'
            where auth_user_id = $1::uuid`,
          [inactiveStaffAuthUserId],
        ),
      ).rejects.toThrow('account role assignment is unavailable');
    } finally {
      await client.query('rollback');
    }

    expect(await readIdentityBoundarySnapshot()).toEqual(before);
  });

  it('serializes staff activation against customer-web account provisioning', async () => {
    const raceAuthUserId = '29999999-1111-4111-8111-111111111111';
    await client.query(
      `insert into auth.users (id, email)
       values ($1::uuid, 'staff-customer-race@example.invalid')`,
      [raceAuthUserId],
    );
    await client.query(
      `insert into app.admin_users (auth_user_id, role, status)
       values ($1::uuid, 'administrator', 'inactive')`,
      [raceAuthUserId],
    );

    const readProvisionSnapshot = async (): Promise<{
      readonly account_audits: number;
      readonly bindings: number;
      readonly customers: number;
      readonly identities: number;
    }> => {
      const result = await client.query<{
        readonly account_audits: number;
        readonly bindings: number;
        readonly customers: number;
        readonly identities: number;
      }>(`
        select
          (select count(*)::integer from app.customers) as customers,
          (select count(*)::integer from app.customer_identities) as identities,
          (select count(*)::integer from app.customer_auth_identities) as bindings,
          (select count(*)::integer
             from app.audit_events
            where action = 'customer.web_account_created') as account_audits
      `);
      expect(result.rows).toHaveLength(1);
      return result.rows[0]!;
    };
    const beforeProvision = await readProvisionSnapshot();

    type RaceResult = {
      readonly committed: boolean;
      readonly error: string | null;
      readonly side: 'customer' | 'staff';
    };
    const customerConnection = createSqlIntegrationClient(environment);
    const staffConnection = createSqlIntegrationClient(environment);
    await Promise.all([customerConnection.connect(), staffConnection.connect()]);
    await customerConnection.query(`set application_name = 'customer_web_staff_race_customer'`);
    await staffConnection.query(`set application_name = 'customer_web_staff_race_activation'`);
    await client.query('begin');
    let blockerReleased = false;
    try {
      const runCustomerProvision = async (): Promise<RaceResult> => {
        await customerConnection.query('begin');
        try {
          await customerConnection.query('set local role fetanagent_customer_web');
          await customerConnection.query(
            'select * from app.ensure_customer_web_account($1::uuid)',
            [raceAuthUserId],
          );
          await customerConnection.query('commit');
          return { committed: true, error: null, side: 'customer' };
        } catch (error) {
          await customerConnection.query('rollback');
          return {
            committed: false,
            error: error instanceof Error ? error.message : String(error),
            side: 'customer',
          };
        }
      };
      const runStaffActivation = async (): Promise<RaceResult> => {
        await staffConnection.query('begin');
        try {
          await staffConnection.query(
            `update app.admin_users
                set status = 'active'
              where auth_user_id = $1::uuid`,
            [raceAuthUserId],
          );
          await staffConnection.query('commit');
          return { committed: true, error: null, side: 'staff' };
        } catch (error) {
          await staffConnection.query('rollback');
          return {
            committed: false,
            error: error instanceof Error ? error.message : String(error),
            side: 'staff',
          };
        }
      };

      await client.query(
        `select pg_advisory_xact_lock(hashtextextended(
           'fetanagent:customer-auth:v1:' || $1::uuid::text,
           0::bigint
         ))`,
        [raceAuthUserId],
      );
      const customerAttempt = runCustomerProvision();
      const staffAttempt = runStaffActivation();

      let advisoryWaiters = 0;
      for (let poll = 0; poll < 100 && advisoryWaiters !== 2; poll += 1) {
        const waiting = await client.query<{ readonly waiters: number }>(`
          select count(*)::integer as waiters
          from pg_stat_activity
          where application_name in (
            'customer_web_staff_race_customer',
            'customer_web_staff_race_activation'
          )
            and wait_event_type = 'Lock'
            and lower(coalesce(wait_event, '')) = 'advisory'
        `);
        advisoryWaiters = waiting.rows[0]!.waiters;
        if (advisoryWaiters !== 2) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      await client.query('commit');
      blockerReleased = true;
      const raceResults = await Promise.all([customerAttempt, staffAttempt]);
      expect(advisoryWaiters).toBe(2);
      expect(raceResults.filter((result) => result.committed)).toHaveLength(1);
      expect(raceResults.filter((result) => !result.committed)).toHaveLength(1);
      expect(raceResults.find((result) => !result.committed)?.error).toMatch(
        /(?:customer-web account request|account role assignment) is unavailable/u,
      );
    } finally {
      if (!blockerReleased) {
        await client.query('rollback');
      }
      await Promise.all([customerConnection.end(), staffConnection.end()]);
    }

    const committedState = await client.query<{
      readonly account_audits: number;
      readonly active_staff: number;
      readonly bindings: number;
      readonly customers: number;
      readonly identities: number;
    }>(
      `
        select
          (select count(*)::integer
             from app.admin_users admin_user
            where admin_user.auth_user_id = $1::uuid
              and admin_user.status = 'active') as active_staff,
          (select count(*)::integer
             from app.customer_auth_identities customer_auth_identity
            where customer_auth_identity.auth_user_id = $1::uuid) as bindings,
          (select count(*)::integer
             from app.customer_identities customer_identity
            where customer_identity.identity_kind = 'supabase_auth'
              and customer_identity.external_subject = $1::uuid::text) as identities,
          (select count(*)::integer
             from app.customers customer
            where exists (
              select 1
                from app.customer_auth_identities customer_auth_identity
               where customer_auth_identity.auth_user_id = $1::uuid
                 and customer_auth_identity.customer_id = customer.id
            )) as customers,
          (select count(*)::integer
             from app.audit_events audit_event
            where audit_event.action = 'customer.web_account_created'
              and exists (
                select 1
                  from app.customer_auth_identities customer_auth_identity
                 where customer_auth_identity.auth_user_id = $1::uuid
                   and customer_auth_identity.customer_id = audit_event.actor_customer_id
              )) as account_audits
      `,
      [raceAuthUserId],
    );
    expect(committedState.rows).toHaveLength(1);
    const state = committedState.rows[0]!;
    expect(state.active_staff + state.bindings).toBe(1);
    if (state.active_staff === 1) {
      expect(state).toEqual({
        account_audits: 0,
        active_staff: 1,
        bindings: 0,
        customers: 0,
        identities: 0,
      });
      expect(await readProvisionSnapshot()).toEqual(beforeProvision);
    } else {
      expect(state).toEqual({
        account_audits: 1,
        active_staff: 0,
        bindings: 1,
        customers: 1,
        identities: 1,
      });
      expect(await readProvisionSnapshot()).toEqual({
        account_audits: beforeProvision.account_audits + 1,
        bindings: beforeProvision.bindings + 1,
        customers: beforeProvision.customers + 1,
        identities: beforeProvision.identities + 1,
      });
    }
  });

  it('binds Auth UUIDs one-to-one and keeps web Player-ID requests isolated and non-claiming', async () => {
    await client.query(
      `insert into auth.users (id, email) values
         ($1::uuid, 'customer-web-one@example.invalid'),
         ($2::uuid, 'customer-web-two@example.invalid')`,
      [customerWebAuthUserId, secondCustomerWebAuthUserId],
    );
    const financialBefore = await readCustomerWebFinancialSnapshot();

    const firstEnsure = await queryAsRole<{
      readonly account_created: boolean;
      readonly account_status: string;
    }>('fetanagent_customer_web', 'select * from app.ensure_customer_web_account($1::uuid)', [
      customerWebAuthUserId,
    ]);
    expect(firstEnsure).toEqual([{ account_created: true, account_status: 'active' }]);
    expect(
      await queryAsRole(
        'fetanagent_customer_web',
        'select * from app.ensure_customer_web_account($1::uuid)',
        [customerWebAuthUserId],
      ),
    ).toEqual([{ account_created: false, account_status: 'active' }]);
    expect(
      await queryAsRole(
        'fetanagent_customer_web',
        'select * from app.ensure_customer_web_account($1::uuid)',
        [secondCustomerWebAuthUserId],
      ),
    ).toEqual([{ account_created: true, account_status: 'active' }]);

    const bindings = await client.query<{
      readonly auth_user_id: string;
      readonly customer_id: string;
      readonly external_subject: string;
      readonly identity_kind: string;
      readonly identity_status: string;
    }>(
      `
        select binding.auth_user_id::text,
               binding.customer_id::text,
               customer_identity.external_subject,
               customer_identity.identity_kind,
               customer_identity.status::text as identity_status
        from app.customer_auth_identities binding
        join app.customer_identities customer_identity
          on customer_identity.id = binding.customer_identity_id
         and customer_identity.customer_id = binding.customer_id
        where binding.auth_user_id in ($1::uuid, $2::uuid)
        order by binding.auth_user_id
      `,
      [customerWebAuthUserId, secondCustomerWebAuthUserId],
    );
    expect(bindings.rows).toHaveLength(2);
    expect(new Set(bindings.rows.map((row) => row.customer_id)).size).toBe(2);
    expect(bindings.rows).toEqual(
      [customerWebAuthUserId, secondCustomerWebAuthUserId].map((authUserId, index) => ({
        auth_user_id: authUserId,
        customer_id: bindings.rows[index]!.customer_id,
        external_subject: authUserId,
        identity_kind: 'supabase_auth',
        identity_status: 'active',
      })),
    );

    const telegramMerge = await client.query<{ readonly identities: number }>(
      `
        select count(*)::integer as identities
        from app.telegram_identities telegram_identity
        join app.customer_identities customer_identity
          on customer_identity.id = telegram_identity.customer_identity_id
        where customer_identity.customer_id in (
          select customer_id
          from app.customer_auth_identities
          where auth_user_id in ($1::uuid, $2::uuid)
        )
      `,
      [customerWebAuthUserId, secondCustomerWebAuthUserId],
    );
    expect(telegramMerge.rows).toEqual([{ identities: 0 }]);

    const accountAudits = await client.query<{
      readonly action: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    }>(
      `
      select action, metadata
      from app.audit_events
      where action = 'customer.web_account_created'
        and actor_customer_id in (
          select customer_id
          from app.customer_auth_identities
          where auth_user_id in ($1::uuid, $2::uuid)
        )
      order by actor_customer_id
    `,
      [customerWebAuthUserId, secondCustomerWebAuthUserId],
    );
    expect(accountAudits.rows).toHaveLength(2);
    expect(
      accountAudits.rows.every((audit) => audit.action === 'customer.web_account_created'),
    ).toBe(true);
    expect(
      accountAudits.rows.every(
        (audit) => JSON.stringify(audit.metadata) === '{"channel":"customer_web"}',
      ),
    ).toBe(true);

    const firstRequestKey = '31111111-1111-4111-8111-111111111111';
    const firstSubmit = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, $3::text
       )`,
      [customerWebAuthUserId, firstRequestKey, 'WEB-PLAYER-01'],
    );
    expect(firstSubmit).toEqual([
      {
        existing_request_reused: false,
        platform_code: 'kemerbet',
        request_created_at: expect.any(Date),
        request_key_already_used: false,
        request_status: 'checking',
      },
    ]);

    const exactReplay = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, $3::text
       )`,
      [customerWebAuthUserId, firstRequestKey, 'WEB-PLAYER-01'],
    );
    expect(exactReplay).toEqual([
      {
        ...firstSubmit[0]!,
        existing_request_reused: true,
        request_key_already_used: true,
      },
    ]);
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, $2::uuid, $3::text
         )`,
        [customerWebAuthUserId, firstRequestKey, 'CHANGED-WEB-PLAYER'],
      ),
    ).rejects.toThrow(/conflicts with its recorded receipt/u);

    const naturalReplayLedgerBefore = await client.query<{ readonly snapshot: string }>(
      `
        select jsonb_build_object(
          'origins', (
            select jsonb_agg(jsonb_build_array(
              origin.request_key, origin.xmin::text, origin.ctid::text
            ))
            from app.customer_web_player_registration_request_origins origin
            join app.customer_auth_identities binding
              on binding.customer_identity_id = origin.customer_auth_identity_id
            where binding.auth_user_id = $1::uuid
          ),
          'audits', (
            select jsonb_agg(jsonb_build_array(
              audit.id, audit.xmin::text, audit.ctid::text
            ) order by audit.id)
            from app.audit_events audit
            where audit.action = 'customer.web_player_registration_requested'
              and audit.actor_customer_id = (
                select customer_id
                from app.customer_auth_identities
                where auth_user_id = $1::uuid
              )
          )
        )::text as snapshot
      `,
      [customerWebAuthUserId],
    );
    const naturalReplay = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, $3::text
       )`,
      [customerWebAuthUserId, '31111111-1111-4111-8111-111111111112', 'WEB-PLAYER-01'],
    );
    expect(naturalReplay).toEqual([
      {
        ...firstSubmit[0]!,
        existing_request_reused: true,
        request_key_already_used: false,
      },
    ]);
    const naturalReplayLedgerAfter = await client.query<{ readonly snapshot: string }>(
      `
        select jsonb_build_object(
          'origins', (
            select jsonb_agg(jsonb_build_array(
              origin.request_key, origin.xmin::text, origin.ctid::text
            ))
            from app.customer_web_player_registration_request_origins origin
            join app.customer_auth_identities binding
              on binding.customer_identity_id = origin.customer_auth_identity_id
            where binding.auth_user_id = $1::uuid
          ),
          'audits', (
            select jsonb_agg(jsonb_build_array(
              audit.id, audit.xmin::text, audit.ctid::text
            ) order by audit.id)
            from app.audit_events audit
            where audit.action = 'customer.web_player_registration_requested'
              and audit.actor_customer_id = (
                select customer_id
                from app.customer_auth_identities
                where auth_user_id = $1::uuid
              )
          )
        )::text as snapshot
      `,
      [customerWebAuthUserId],
    );
    expect(naturalReplayLedgerAfter.rows).toEqual(naturalReplayLedgerBefore.rows);

    const secondCustomerSubmit = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, $3::text
       )`,
      [secondCustomerWebAuthUserId, '31111111-1111-4111-8111-222222222222', 'WEB-PLAYER-01'],
    );
    expect(secondCustomerSubmit).toEqual([
      {
        existing_request_reused: false,
        platform_code: 'kemerbet',
        request_created_at: expect.any(Date),
        request_key_already_used: false,
        request_status: 'checking',
      },
    ]);

    const firstList = await queryAsRole<{
      readonly platform_code: string;
      readonly request_created_at: Date;
      readonly request_status: string;
      readonly request_updated_at: Date;
      readonly submitted_player_id: string;
    }>(
      'fetanagent_customer_web',
      'select * from app.list_customer_web_player_registrations($1::uuid, 20)',
      [customerWebAuthUserId],
    );
    expect(firstList).toEqual([
      {
        platform_code: 'kemerbet',
        request_created_at: firstSubmit[0]!.request_created_at,
        request_status: 'checking',
        request_updated_at: expect.any(Date),
        submitted_player_id: 'WEB-PLAYER-01',
      },
    ]);
    expect(Object.keys(firstList[0]!).sort()).toEqual([
      'platform_code',
      'request_created_at',
      'request_status',
      'request_updated_at',
      'submitted_player_id',
    ]);

    const requestIds = await client.query<{
      readonly auth_user_id: string;
      readonly request_id: string;
    }>(
      `
        select binding.auth_user_id::text,
               registration_request.id::text as request_id
        from app.customer_web_player_registration_request_origins origin
        join app.customer_auth_identities binding
          on binding.customer_identity_id = origin.customer_auth_identity_id
        join app.player_registration_requests registration_request
          on registration_request.id = origin.player_registration_request_id
        where binding.auth_user_id in ($1::uuid, $2::uuid)
          and registration_request.player_id = 'WEB-PLAYER-01'
        group by binding.auth_user_id, registration_request.id
        order by binding.auth_user_id
      `,
      [customerWebAuthUserId, secondCustomerWebAuthUserId],
    );
    expect(requestIds.rows).toHaveLength(2);
    const firstRequestId = requestIds.rows[0]!.request_id;
    const secondRequestId = requestIds.rows[1]!.request_id;

    await queryAsRole(
      'fetanagent_owner_control',
      `select * from app.review_owner_player_registration_request(
         $1::uuid, $2::uuid, 'exists', 'owner_platform_lookup'
       )`,
      [ownerAuthUserId, firstRequestId],
    );
    const replayAfterExists = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, $3::text
       )`,
      [customerWebAuthUserId, firstRequestKey, 'WEB-PLAYER-01'],
    );
    expect(replayAfterExists[0]?.request_status).toBe('checking');
    const listAfterExists = await queryAsRole<{ readonly request_status: string }>(
      'fetanagent_customer_web',
      `select request_status
       from app.list_customer_web_player_registrations($1::uuid, 20)`,
      [customerWebAuthUserId],
    );
    expect(listAfterExists).toEqual([{ request_status: 'checking' }]);

    await queryAsRole(
      'fetanagent_owner_control',
      `select * from app.review_owner_player_registration_request(
         $1::uuid, $2::uuid, 'review_required', 'provider_evidence_required'
       )`,
      [ownerAuthUserId, secondRequestId],
    );
    expect(
      await queryAsRole(
        'fetanagent_customer_web',
        `select request_status
         from app.list_customer_web_player_registrations($1::uuid, 20)`,
        [secondCustomerWebAuthUserId],
      ),
    ).toEqual([{ request_status: 'checking' }]);
    await queryAsRole(
      'fetanagent_owner_control',
      `select * from app.review_owner_player_registration_request(
         $1::uuid, $2::uuid, 'not_found', 'owner_platform_lookup'
       )`,
      [ownerAuthUserId, secondRequestId],
    );
    expect(
      await queryAsRole(
        'fetanagent_customer_web',
        `select request_status
         from app.list_customer_web_player_registrations($1::uuid, 20)`,
        [secondCustomerWebAuthUserId],
      ),
    ).toEqual([{ request_status: 'needs_attention' }]);

    const associationCandidates = await queryAsRole<{
      readonly registration_request_id: string;
    }>(
      'fetanagent_owner_control',
      `select registration_request_id
       from app.list_owner_player_registration_association_candidates($1::uuid, 50)`,
      [ownerAuthUserId],
    );
    expect(associationCandidates.map((row) => row.registration_request_id)).not.toContain(
      firstRequestId,
    );

    const associationBefore = await client.query<{
      readonly associations: number;
      readonly players: number;
      readonly validations: number;
    }>(`
      select
        (select count(*)::integer from app.player_registration_request_associations)
          as associations,
        (select count(*)::integer from app.customer_platform_players) as players,
        (select count(*)::integer from app.player_validation_attempts) as validations
    `);
    await expect(
      queryAsRole(
        'fetanagent_owner_control',
        `select * from app.associate_owner_validated_player_registration_request(
           $1::uuid, $2::uuid, 'owner_verified_platform_ownership'
         )`,
        [ownerAuthUserId, firstRequestId],
      ),
    ).rejects.toThrow(/ownership association is not available/u);
    const associationAfter = await client.query<{
      readonly associations: number;
      readonly players: number;
      readonly validations: number;
    }>(`
      select
        (select count(*)::integer from app.player_registration_request_associations)
          as associations,
        (select count(*)::integer from app.customer_platform_players) as players,
        (select count(*)::integer from app.player_validation_attempts) as validations
    `);
    expect(associationAfter.rows).toEqual(associationBefore.rows);

    const requestAudits = await client.query<{
      readonly metadata: Readonly<Record<string, unknown>>;
    }>(
      `
        select metadata
        from app.audit_events
        where action = 'customer.web_player_registration_requested'
          and actor_customer_id in (
            select customer_id
            from app.customer_auth_identities
            where auth_user_id in ($1::uuid, $2::uuid)
          )
        order by created_at, id
      `,
      [customerWebAuthUserId, secondCustomerWebAuthUserId],
    );
    expect(requestAudits.rows).toHaveLength(2);
    expect(
      requestAudits.rows.every((audit) =>
        Object.keys(audit.metadata).every((key) =>
          ['channel', 'platform_code', 'request_reused'].includes(key),
        ),
      ),
    ).toBe(true);
    const serializedAudits = JSON.stringify(requestAudits.rows).toLowerCase();
    expect(serializedAudits).not.toContain(customerWebAuthUserId);
    expect(serializedAudits).not.toContain(secondCustomerWebAuthUserId);
    expect(serializedAudits).not.toContain(firstRequestKey);
    expect(serializedAudits).not.toContain('web-player-01');
    expect(serializedAudits).not.toContain('example.invalid');

    expect(await readCustomerWebFinancialSnapshot()).toEqual(financialBefore);
  });

  it('enforces non-consuming replays and serialized rolling and unresolved quotas', async () => {
    const rollingAuthUserId = '21111111-1111-4111-8111-333333333333';
    const unresolvedAuthUserId = '21111111-1111-4111-8111-444444444444';
    const concurrentAuthUserId = '21111111-1111-4111-8111-555555555555';
    await client.query(
      `insert into auth.users (id, email) values
         ($1::uuid, 'rolling-quota@example.invalid'),
         ($2::uuid, 'unresolved-quota@example.invalid'),
         ($3::uuid, 'concurrent-quota@example.invalid')`,
      [rollingAuthUserId, unresolvedAuthUserId, concurrentAuthUserId],
    );
    for (const authUserId of [rollingAuthUserId, unresolvedAuthUserId, concurrentAuthUserId]) {
      await queryAsRole(
        'fetanagent_customer_web',
        'select * from app.ensure_customer_web_account($1::uuid)',
        [authUserId],
      );
    }

    await queryAsRole(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, 'OLD-WEB-PLAYER'
       )`,
      [rollingAuthUserId, '41111111-1111-4111-8111-111111111111'],
    );
    await client.query(
      `
        update app.player_registration_requests registration_request
        set created_at = clock_timestamp() - interval '48 hours'
        where registration_request.id = (
          select origin.player_registration_request_id
          from app.customer_web_player_registration_request_origins origin
          join app.customer_auth_identities binding
            on binding.customer_identity_id = origin.customer_auth_identity_id
          where binding.auth_user_id = $1::uuid
          limit 1
        )
      `,
      [rollingAuthUserId],
    );

    const oldNaturalReplay = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, 'OLD-WEB-PLAYER'
       )`,
      [rollingAuthUserId, '41111111-1111-4111-8111-111111111112'],
    );
    expect(oldNaturalReplay[0]).toMatchObject({
      existing_request_reused: true,
      request_key_already_used: false,
      request_status: 'checking',
    });

    for (let index = 1; index <= 5; index += 1) {
      const submitted = await queryAsRole<CustomerWebSubmitRow>(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, $2::uuid, $3::text
         )`,
        [
          rollingAuthUserId,
          `41111111-1111-4111-8111-22222222222${index}`,
          `RECENT-WEB-PLAYER-${index}`,
        ],
      );
      expect(submitted[0]).toMatchObject({
        existing_request_reused: false,
        request_key_already_used: false,
        request_status: 'checking',
      });
    }
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, $2::uuid, 'RECENT-WEB-PLAYER-6'
         )`,
        [rollingAuthUserId, '41111111-1111-4111-8111-222222222226'],
      ),
    ).rejects.toThrow(/request limit has been reached/u);

    const exactReplayAtLimit = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, 'RECENT-WEB-PLAYER-1'
       )`,
      [rollingAuthUserId, '41111111-1111-4111-8111-222222222221'],
    );
    expect(exactReplayAtLimit[0]).toMatchObject({
      existing_request_reused: true,
      request_key_already_used: true,
    });
    const naturalReplayAtLimit = await queryAsRole<CustomerWebSubmitRow>(
      'fetanagent_customer_web',
      `select * from app.submit_customer_web_player_registration(
         $1::uuid, $2::uuid, 'RECENT-WEB-PLAYER-1'
       )`,
      [rollingAuthUserId, '41111111-1111-4111-8111-333333333331'],
    );
    expect(naturalReplayAtLimit[0]).toMatchObject({
      existing_request_reused: true,
      request_key_already_used: false,
    });

    const rollingCounts = await client.query<{
      readonly recent_distinct_requests: number;
      readonly receipts: number;
    }>(
      `
        select
          count(*)::integer as receipts,
          count(distinct registration_request.id) filter (
            where registration_request.created_at >= clock_timestamp() - interval '24 hours'
          )::integer as recent_distinct_requests
        from app.customer_web_player_registration_request_origins origin
        join app.customer_auth_identities binding
          on binding.customer_identity_id = origin.customer_auth_identity_id
        join app.player_registration_requests registration_request
          on registration_request.id = origin.player_registration_request_id
        where binding.auth_user_id = $1::uuid
      `,
      [rollingAuthUserId],
    );
    expect(rollingCounts.rows).toEqual([{ recent_distinct_requests: 5, receipts: 6 }]);

    const naturalReplayGrowthBefore = await client.query<{ readonly snapshot: string }>(
      `
        select jsonb_build_object(
          'origins', (
            select jsonb_agg(jsonb_build_array(
              origin.request_key, origin.xmin::text, origin.ctid::text
            )
              order by origin.request_key)
            from app.customer_web_player_registration_request_origins origin
            join app.customer_auth_identities binding
              on binding.customer_identity_id = origin.customer_auth_identity_id
            where binding.auth_user_id = $1::uuid
          ),
          'audits', (
            select jsonb_agg(jsonb_build_array(
              audit.id, audit.xmin::text, audit.ctid::text
            ) order by audit.id)
            from app.audit_events audit
            where audit.action = 'customer.web_player_registration_requested'
              and audit.actor_customer_id = (
                select customer_id
                from app.customer_auth_identities
                where auth_user_id = $1::uuid
              )
          )
        )::text as snapshot
      `,
      [rollingAuthUserId],
    );
    for (let index = 1; index <= 25; index += 1) {
      const replay = await queryAsRole<CustomerWebSubmitRow>(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, $2::uuid, 'RECENT-WEB-PLAYER-1'
         )`,
        [rollingAuthUserId, `71111111-1111-4111-8111-7777777777${String(index).padStart(2, '0')}`],
      );
      expect(replay[0]).toMatchObject({
        existing_request_reused: true,
        request_key_already_used: false,
      });
    }
    const naturalReplayGrowthAfter = await client.query<{ readonly snapshot: string }>(
      `
        select jsonb_build_object(
          'origins', (
            select jsonb_agg(jsonb_build_array(
              origin.request_key, origin.xmin::text, origin.ctid::text
            )
              order by origin.request_key)
            from app.customer_web_player_registration_request_origins origin
            join app.customer_auth_identities binding
              on binding.customer_identity_id = origin.customer_auth_identity_id
            where binding.auth_user_id = $1::uuid
          ),
          'audits', (
            select jsonb_agg(jsonb_build_array(
              audit.id, audit.xmin::text, audit.ctid::text
            ) order by audit.id)
            from app.audit_events audit
            where audit.action = 'customer.web_player_registration_requested'
              and audit.actor_customer_id = (
                select customer_id
                from app.customer_auth_identities
                where auth_user_id = $1::uuid
              )
          )
        )::text as snapshot
      `,
      [rollingAuthUserId],
    );
    expect(naturalReplayGrowthAfter.rows).toEqual(naturalReplayGrowthBefore.rows);
    const naturalReplayLedgerCounts = await client.query<{
      readonly audits: number;
      readonly origins: number;
    }>(
      `
        select
          (select count(*)::integer
           from app.customer_web_player_registration_request_origins origin
           join app.customer_auth_identities binding
             on binding.customer_identity_id = origin.customer_auth_identity_id
           where binding.auth_user_id = $1::uuid) as origins,
          (select count(*)::integer
           from app.audit_events audit
           where audit.action = 'customer.web_player_registration_requested'
             and audit.actor_customer_id = (
               select customer_id
               from app.customer_auth_identities
               where auth_user_id = $1::uuid
             )) as audits
      `,
      [rollingAuthUserId],
    );
    expect(naturalReplayLedgerCounts.rows).toEqual([{ audits: 6, origins: 6 }]);

    await client.query(
      `
        with context as (
          select binding.customer_identity_id, binding.customer_id, platform.id as platform_id
          from app.customer_auth_identities binding
          cross join app.platforms platform
          where binding.auth_user_id = $1::uuid
            and platform.code = 'kemerbet'
        ), inserted as (
          insert into app.player_registration_requests (
            customer_id, platform_id, player_id, created_at
          )
          select context.customer_id,
                 context.platform_id,
                 'UNRESOLVED-WEB-PLAYER-' || series.value::text,
                 clock_timestamp() - interval '48 hours'
          from context
          cross join generate_series(1, 10) series(value)
          returning id
        )
        insert into app.customer_web_player_registration_request_origins (
          customer_auth_identity_id,
          request_key,
          player_registration_request_id,
          created_at
        )
        select context.customer_identity_id,
               gen_random_uuid(),
               inserted.id,
               clock_timestamp() - interval '48 hours'
        from context
        cross join inserted
      `,
      [unresolvedAuthUserId],
    );
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, $2::uuid, 'UNRESOLVED-WEB-PLAYER-11'
         )`,
        [unresolvedAuthUserId, '41111111-1111-4111-8111-444444444444'],
      ),
    ).rejects.toThrow(/request limit has been reached/u);

    const concurrentClients = Array.from({ length: 6 }, () =>
      createSqlIntegrationClient(environment),
    );
    await Promise.all(concurrentClients.map(async (connection) => connection.connect()));
    try {
      const outcomes = await Promise.allSettled(
        concurrentClients.map(async (connection, index) => {
          await connection.query('begin');
          try {
            await connection.query('set local role fetanagent_customer_web');
            const result = await connection.query<CustomerWebSubmitRow>(
              `select * from app.submit_customer_web_player_registration(
                 $1::uuid, $2::uuid, $3::text
               )`,
              [
                concurrentAuthUserId,
                `41111111-1111-4111-8111-55555555555${index + 1}`,
                `CONCURRENT-WEB-PLAYER-${index + 1}`,
              ],
            );
            await connection.query('commit');
            return result.rows;
          } catch (error) {
            await connection.query('rollback');
            throw error;
          }
        }),
      );
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(5);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected).toMatchObject({ status: 'rejected' });
      expect(String((rejected as PromiseRejectedResult).reason)).toMatch(
        /request limit has been reached/u,
      );
    } finally {
      await Promise.all(concurrentClients.map(async (connection) => connection.end()));
    }

    const concurrentCount = await client.query<{ readonly requests: number }>(
      `
        select count(distinct origin.player_registration_request_id)::integer as requests
        from app.customer_web_player_registration_request_origins origin
        join app.customer_auth_identities binding
          on binding.customer_identity_id = origin.customer_auth_identity_id
        where binding.auth_user_id = $1::uuid
      `,
      [concurrentAuthUserId],
    );
    expect(concurrentCount.rows).toEqual([{ requests: 5 }]);
  });

  it('serializes the origin-versus-association race so both states cannot commit', async () => {
    const raceAuthUserId = '21111111-1111-4111-8111-999999999999';
    await client.query(
      `insert into auth.users (id, email)
       values ($1::uuid, 'association-race@example.invalid')`,
      [raceAuthUserId],
    );
    await queryAsRole(
      'fetanagent_customer_web',
      'select * from app.ensure_customer_web_account($1::uuid)',
      [raceAuthUserId],
    );
    const raceScope = await client.query<{
      readonly customer_id: string;
      readonly identity_id: string;
    }>(
      `
        select customer_id::text, customer_identity_id::text as identity_id
        from app.customer_auth_identities
        where auth_user_id = $1::uuid
      `,
      [raceAuthUserId],
    );
    expect(raceScope.rows).toHaveLength(1);
    const raceRequest = await client.query<{ readonly request_id: string }>(
      `
        insert into app.player_registration_requests (customer_id, platform_id, player_id)
        select $1::uuid, platform.id, 'RACE-WEB-PLAYER'
        from app.platforms platform
        where platform.code = 'kemerbet'
        returning id::text as request_id
      `,
      [raceScope.rows[0]!.customer_id],
    );
    const raceRequestId = raceRequest.rows[0]!.request_id;
    await queryAsRole(
      'fetanagent_owner_control',
      `select * from app.review_owner_player_registration_request(
         $1::uuid, $2::uuid, 'exists', 'owner_platform_lookup'
       )`,
      [ownerAuthUserId, raceRequestId],
    );

    const originConnection = createSqlIntegrationClient(environment);
    const associationConnection = createSqlIntegrationClient(environment);
    await Promise.all([originConnection.connect(), associationConnection.connect()]);
    await originConnection.query(`set application_name = 'customer_web_origin_race'`);
    await associationConnection.query(`set application_name = 'customer_web_association_race'`);
    await client.query('begin');
    let blockerReleased = false;
    try {
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended(
           'fetanagent:customer-web-player-association-gate:v1:' || $1::uuid::text,
           0::bigint
         ))`,
        [raceRequestId],
      );

      const originAttempt = (async () => {
        await originConnection.query('begin');
        try {
          await originConnection.query(
            `
              insert into app.customer_web_player_registration_request_origins (
                customer_auth_identity_id, request_key, player_registration_request_id
              )
              values ($1::uuid, $2::uuid, $3::uuid)
            `,
            [raceScope.rows[0]!.identity_id, '61111111-1111-4111-8111-111111111111', raceRequestId],
          );
          await originConnection.query('commit');
          return 'origin' as const;
        } catch (error) {
          await originConnection.query('rollback');
          throw error;
        }
      })();
      const associationAttempt = (async () => {
        await associationConnection.query('begin');
        try {
          await associationConnection.query('set local role fetanagent_owner_control');
          await associationConnection.query(
            `select * from app.associate_owner_validated_player_registration_request(
               $1::uuid, $2::uuid, 'owner_verified_platform_ownership'
             )`,
            [ownerAuthUserId, raceRequestId],
          );
          await associationConnection.query('commit');
          return 'association' as const;
        } catch (error) {
          await associationConnection.query('rollback');
          throw error;
        }
      })();

      let advisoryWaiters = 0;
      for (let poll = 0; poll < 100 && advisoryWaiters !== 2; poll += 1) {
        const waiting = await client.query<{ readonly waiters: number }>(`
          select count(*)::integer as waiters
          from pg_stat_activity
          where application_name in (
            'customer_web_origin_race', 'customer_web_association_race'
          )
            and wait_event_type = 'Lock'
            and lower(coalesce(wait_event, '')) = 'advisory'
        `);
        advisoryWaiters = waiting.rows[0]!.waiters;
        if (advisoryWaiters !== 2) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      await client.query('commit');
      blockerReleased = true;
      const outcomes = await Promise.allSettled([originAttempt, associationAttempt]);
      expect(advisoryWaiters).toBe(2);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
      const winner = outcomes.find(
        (outcome): outcome is PromiseFulfilledResult<'origin' | 'association'> =>
          outcome.status === 'fulfilled',
      );
      expect(['origin', 'association']).toContain(winner?.value);
    } finally {
      if (!blockerReleased) {
        await client.query('rollback');
      }
      await Promise.all([originConnection.end(), associationConnection.end()]);
    }

    const committedStates = await client.query<{
      readonly associations: number;
      readonly origins: number;
    }>(
      `
        select
          (select count(*)::integer
           from app.customer_web_player_registration_request_origins origin
           where origin.player_registration_request_id = $1::uuid) as origins,
          (select count(*)::integer
           from app.player_registration_request_associations association
           where association.player_registration_request_id = $1::uuid) as associations
      `,
      [raceRequestId],
    );
    expect(committedStates.rows).toHaveLength(1);
    expect(committedStates.rows[0]!.associations + committedStates.rows[0]!.origins).toBe(1);
  });

  it('fails closed on hostile identity inputs and preserves append-only bindings and receipts', async () => {
    const concurrentEnsureAuthUserId = '21111111-1111-4111-8111-666666666666';
    await client.query(
      `insert into auth.users (id, email)
       values ($1::uuid, 'concurrent-ensure@example.invalid')`,
      [concurrentEnsureAuthUserId],
    );
    const beforeEnsure = await client.query<{
      readonly audits: number;
      readonly bindings: number;
      readonly customers: number;
      readonly identities: number;
    }>(`
      select
        (select count(*)::integer from app.customers) as customers,
        (select count(*)::integer from app.customer_identities) as identities,
        (select count(*)::integer from app.customer_auth_identities) as bindings,
        (select count(*)::integer from app.audit_events
          where action = 'customer.web_account_created') as audits
    `);
    const ensureClients = Array.from({ length: 6 }, () => createSqlIntegrationClient(environment));
    await Promise.all(ensureClients.map(async (connection) => connection.connect()));
    try {
      const concurrentEnsures = await Promise.all(
        ensureClients.map(async (connection) => {
          await connection.query('begin');
          try {
            await connection.query('set local role fetanagent_customer_web');
            const result = await connection.query<{
              readonly account_created: boolean;
              readonly account_status: string;
            }>('select * from app.ensure_customer_web_account($1::uuid)', [
              concurrentEnsureAuthUserId,
            ]);
            await connection.query('commit');
            return result.rows[0]!;
          } catch (error) {
            await connection.query('rollback');
            throw error;
          }
        }),
      );
      expect(concurrentEnsures.filter((receipt) => receipt.account_created)).toHaveLength(1);
      expect(concurrentEnsures.filter((receipt) => !receipt.account_created)).toHaveLength(5);
      expect(concurrentEnsures.every((receipt) => receipt.account_status === 'active')).toBe(true);
    } finally {
      await Promise.all(ensureClients.map(async (connection) => connection.end()));
    }

    const afterEnsure = await client.query<{
      readonly audits: number;
      readonly bindings: number;
      readonly customers: number;
      readonly identities: number;
    }>(`
      select
        (select count(*)::integer from app.customers) as customers,
        (select count(*)::integer from app.customer_identities) as identities,
        (select count(*)::integer from app.customer_auth_identities) as bindings,
        (select count(*)::integer from app.audit_events
          where action = 'customer.web_account_created') as audits
    `);
    expect(afterEnsure.rows).toEqual([
      {
        audits: beforeEnsure.rows[0]!.audits + 1,
        bindings: beforeEnsure.rows[0]!.bindings + 1,
        customers: beforeEnsure.rows[0]!.customers + 1,
        identities: beforeEnsure.rows[0]!.identities + 1,
      },
    ]);

    const invalidBefore = await client.query<{
      readonly bindings: number;
      readonly origins: number;
      readonly requests: number;
    }>(`
      select
        (select count(*)::integer from app.customer_auth_identities) as bindings,
        (select count(*)::integer
          from app.customer_web_player_registration_request_origins) as origins,
        (select count(*)::integer from app.player_registration_requests) as requests
    `);
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        'select * from app.ensure_customer_web_account(null::uuid)',
      ),
    ).rejects.toThrow(/account request is invalid/u);
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        'select * from app.ensure_customer_web_account($1::uuid)',
        ['21111111-1111-4111-8111-777777777777'],
      ),
    ).rejects.toThrow(/account request is unavailable/u);
    for (const invalidPlayerId of [
      null,
      '',
      '   ',
      'HAS SPACE',
      'X'.repeat(65),
      `CONTROL${String.fromCharCode(1)}`,
    ]) {
      await expect(
        queryAsRole(
          'fetanagent_customer_web',
          `select * from app.submit_customer_web_player_registration(
             $1::uuid, $2::uuid, $3::text
           )`,
          [concurrentEnsureAuthUserId, '51111111-1111-4111-8111-111111111111', invalidPlayerId],
        ),
      ).rejects.toThrow(/Player ID request is invalid/u);
    }
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, null::uuid, 'PLAYER'
         )`,
        [concurrentEnsureAuthUserId],
      ),
    ).rejects.toThrow(/Player ID request is invalid/u);
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        `select * from app.submit_customer_web_player_registration(
           $1::uuid, $2::uuid, 'PLAYER'
         )`,
        ['21111111-1111-4111-8111-777777777777', '51111111-1111-4111-8111-222222222222'],
      ),
    ).rejects.toThrow(/Player ID request is unavailable/u);
    for (const invalidLimit of [0, 21, null]) {
      await expect(
        queryAsRole(
          'fetanagent_customer_web',
          'select * from app.list_customer_web_player_registrations($1::uuid, $2::integer)',
          [concurrentEnsureAuthUserId, invalidLimit],
        ),
      ).rejects.toThrow(/list request is invalid/u);
    }
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        'select * from app.list_customer_web_player_registrations($1::uuid, 20)',
        ['21111111-1111-4111-8111-777777777777'],
      ),
    ).rejects.toThrow(/list request is unavailable/u);
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        'select * from app.list_customer_web_player_registrations(null::uuid, 20)',
      ),
    ).rejects.toThrow(/list request is invalid/u);
    const invalidAfter = await client.query<{
      readonly bindings: number;
      readonly origins: number;
      readonly requests: number;
    }>(`
      select
        (select count(*)::integer from app.customer_auth_identities) as bindings,
        (select count(*)::integer
          from app.customer_web_player_registration_request_origins) as origins,
        (select count(*)::integer from app.player_registration_requests) as requests
    `);
    expect(invalidAfter.rows).toEqual(invalidBefore.rows);

    await expect(
      queryAsRole('fetanagent_customer_web', 'select * from app.customer_auth_identities'),
    ).rejects.toThrow(/permission denied|row-level security/u);
    await expect(
      queryAsRole(
        'fetanagent_customer_web',
        'select * from app.customer_web_player_registration_request_origins',
      ),
    ).rejects.toThrow(/permission denied|row-level security/u);

    await expect(
      client.query(
        `update app.customer_auth_identities
         set auth_user_id = $2::uuid
         where auth_user_id = $1::uuid`,
        [customerWebAuthUserId, concurrentEnsureAuthUserId],
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      client.query('delete from app.customer_auth_identities where auth_user_id = $1::uuid', [
        customerWebAuthUserId,
      ]),
    ).rejects.toThrow(/append-only/u);
    await expect(client.query('truncate app.customer_auth_identities')).rejects.toThrow(
      /append-only|cannot truncate/u,
    );
    await expect(
      client.query(
        `
        update app.customer_web_player_registration_request_origins
        set request_key = gen_random_uuid()
        where customer_auth_identity_id = (
          select customer_identity_id
          from app.customer_auth_identities
          where auth_user_id = $1::uuid
        )
      `,
        [customerWebAuthUserId],
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      client.query(
        `
        delete from app.customer_web_player_registration_request_origins
        where customer_auth_identity_id = (
          select customer_identity_id
          from app.customer_auth_identities
          where auth_user_id = $1::uuid
        )
      `,
        [customerWebAuthUserId],
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      client.query('truncate app.customer_web_player_registration_request_origins'),
    ).rejects.toThrow(/append-only/u);

    const webRequest = await client.query<{ readonly request_id: string }>(
      `
        select origin.player_registration_request_id::text as request_id
        from app.customer_web_player_registration_request_origins origin
        join app.customer_auth_identities binding
          on binding.customer_identity_id = origin.customer_auth_identity_id
        where binding.auth_user_id = $1::uuid
        order by origin.created_at
        limit 1
      `,
      [customerWebAuthUserId],
    );
    expect(webRequest.rows).toHaveLength(1);
    const directAssociationBefore = await client.query<{
      readonly associations: number;
    }>(
      'select count(*)::integer as associations from app.player_registration_request_associations',
    );
    await expect(
      client.query(
        `
          insert into app.player_registration_request_associations (
            player_registration_request_id,
            actor_admin_id,
            player_account_id,
            validation_attempt_id,
            reason_code
          )
          values (
            $1::uuid, $2::uuid, gen_random_uuid(), gen_random_uuid(),
            'owner_verified_platform_ownership'
          )
        `,
        [webRequest.rows[0]!.request_id, ownerAdminId],
      ),
    ).rejects.toThrow(/ownership association is not available/u);
    const directAssociationAfter = await client.query<{
      readonly associations: number;
    }>(
      'select count(*)::integer as associations from app.player_registration_request_associations',
    );
    expect(directAssociationAfter.rows).toEqual(directAssociationBefore.rows);

    const associatedFixture = await client.query<{
      readonly customer_id: string;
      readonly request_id: string;
    }>(`
      select registration_request.customer_id::text,
             association.player_registration_request_id::text as request_id
      from app.player_registration_request_associations association
      join app.player_registration_requests registration_request
        on registration_request.id = association.player_registration_request_id
      where not exists (
        select 1
        from app.customer_auth_identities binding
        where binding.customer_id = registration_request.customer_id
      )
      order by association.created_at
      limit 1
    `);
    expect(associatedFixture.rows).toHaveLength(1);
    await client.query('begin');
    try {
      const associatedFixtureAuthUserId = '21111111-1111-4111-8111-888888888888';
      await client.query(
        `insert into auth.users (id, email)
         values ($1::uuid, 'associated-origin-guard@example.invalid')`,
        [associatedFixtureAuthUserId],
      );
      const fixtureIdentity = await client.query<{ readonly identity_id: string }>(
        `
          insert into app.customer_identities (
            customer_id, identity_kind, external_subject, status
          )
          values ($1::uuid, 'supabase_auth', $2::text, 'active')
          returning id::text as identity_id
        `,
        [associatedFixture.rows[0]!.customer_id, associatedFixtureAuthUserId],
      );
      await client.query(
        `
          insert into app.customer_auth_identities (
            customer_identity_id, customer_id, auth_user_id
          )
          values ($1::uuid, $2::uuid, $3::uuid)
        `,
        [
          fixtureIdentity.rows[0]!.identity_id,
          associatedFixture.rows[0]!.customer_id,
          associatedFixtureAuthUserId,
        ],
      );
      await expect(
        client.query(
          `
            insert into app.customer_web_player_registration_request_origins (
              customer_auth_identity_id, request_key, player_registration_request_id
            )
            values ($1::uuid, gen_random_uuid(), $2::uuid)
          `,
          [fixtureIdentity.rows[0]!.identity_id, associatedFixture.rows[0]!.request_id],
        ),
      ).rejects.toThrow(/request origin is invalid/u);
    } finally {
      await client.query('rollback');
    }
  });

  it('installs a private Player-ID deposit-eligibility boundary and audits approved readers', async () => {
    const relationBoundary = await client.query<{
      readonly policies: number;
      readonly relforcerowsecurity: boolean;
      readonly relrowsecurity: boolean;
      readonly snapshot_nullable: boolean;
    }>(`
      select relation.relrowsecurity,
             relation.relforcerowsecurity,
             count(policy.oid)::integer as policies,
             not snapshot_attribute.attnotnull as snapshot_nullable
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      join pg_attribute snapshot_attribute
        on snapshot_attribute.attrelid = 'app.deposit_intents'::regclass
       and snapshot_attribute.attname = 'player_deposit_eligibility_decision_id'
       and not snapshot_attribute.attisdropped
      left join pg_policy policy on policy.polrelid = relation.oid
      where relation.oid = 'app.player_deposit_eligibility_decisions'::regclass
        and namespace.nspname = 'app'
      group by relation.oid, snapshot_attribute.attnotnull
    `);
    expect(relationBoundary.rows).toEqual([
      {
        policies: 0,
        relforcerowsecurity: true,
        relrowsecurity: true,
        snapshot_nullable: true,
      },
    ]);

    const constraints = await client.query<{
      readonly constraint_definition: string;
      readonly constraint_name: string;
    }>(`
      select catalog_constraint.conname as constraint_name,
             pg_get_constraintdef(catalog_constraint.oid) as constraint_definition
      from pg_constraint catalog_constraint
      where catalog_constraint.conrelid in (
        'app.player_deposit_eligibility_decisions'::regclass,
        'app.deposit_intents'::regclass
      )
        and catalog_constraint.conname in (
          'player_deposit_eligibility_decisions_player_version_key',
          'player_deposit_eligibility_decisions_id_player_key',
          'player_deposit_eligibility_decisions_reason_check',
          'player_deposit_eligibility_decisions_actor_check',
          'player_deposit_eligibility_decisions_time_shape_check',
          'deposit_intents_player_eligibility_decision_fkey'
        )
      order by constraint_name
    `);
    expect(constraints.rows).toHaveLength(6);
    expect(constraints.rows).toContainEqual({
      constraint_definition:
        'FOREIGN KEY (player_deposit_eligibility_decision_id, player_account_id) REFERENCES app.player_deposit_eligibility_decisions(id, player_account_id) ON DELETE RESTRICT',
      constraint_name: 'deposit_intents_player_eligibility_decision_fkey',
    });
    expect(constraints.rows).toContainEqual({
      constraint_definition: 'UNIQUE (player_account_id, decision_version)',
      constraint_name: 'player_deposit_eligibility_decisions_player_version_key',
    });
    expect(constraints.rows).toContainEqual({
      constraint_definition: 'UNIQUE (id, player_account_id)',
      constraint_name: 'player_deposit_eligibility_decisions_id_player_key',
    });
    const constraintDefinitions = constraints.rows
      .map((row) => `${row.constraint_name}:${row.constraint_definition}`)
      .join('\n');
    expect(constraintDefinitions).toContain("decision = 'eligible'::text");
    expect(constraintDefinitions).toContain("financial_eligibility_approved'::text");
    expect(constraintDefinitions).toContain("decision = 'revoked'::text");
    expect(constraintDefinitions).toContain("financial_eligibility_revoked'::text");
    expect(constraintDefinitions).toContain("actor_kind = 'admin'::app.actor_kind");
    expect(constraintDefinitions).toContain('decided_at = created_at');

    const indexes = await client.query<{ readonly indexname: string }>(`
      select indexname
      from pg_indexes
      where schemaname = 'app'
        and tablename = 'player_deposit_eligibility_decisions'
      order by indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'player_deposit_eligibility_decisions_actor_created_idx',
      'player_deposit_eligibility_decisions_id_player_key',
      'player_deposit_eligibility_decisions_pkey',
      'player_deposit_eligibility_decisions_player_version_key',
    ]);

    const decisionTriggers = await client.query<{
      readonly trigger_definition: string;
      readonly trigger_name: string;
    }>(`
      select trigger.tgname as trigger_name,
             pg_get_triggerdef(trigger.oid) as trigger_definition
      from pg_trigger trigger
      where trigger.tgrelid = 'app.player_deposit_eligibility_decisions'::regclass
        and not trigger.tgisinternal
      order by trigger_name
    `);
    expect(decisionTriggers.rows.map((row) => row.trigger_name)).toEqual([
      'player_deposit_eligibility_decisions_enforce_insert',
      'player_deposit_eligibility_decisions_immutable',
      'player_deposit_eligibility_decisions_no_truncate',
    ]);
    expect(decisionTriggers.rows[0]!.trigger_definition).toContain('BEFORE INSERT');
    expect(decisionTriggers.rows[1]!.trigger_definition).toContain('BEFORE DELETE OR UPDATE');
    expect(decisionTriggers.rows[2]!.trigger_definition).toContain('BEFORE TRUNCATE');

    const depositInsertTriggers = await client.query<{ readonly trigger_name: string }>(`
      select trigger.tgname as trigger_name
      from pg_trigger trigger
      where trigger.tgrelid = 'app.deposit_intents'::regclass
        and not trigger.tgisinternal
        and (trigger.tgtype & 2) = 2
        and (trigger.tgtype & 4) = 4
      order by trigger_name
    `);
    expect(depositInsertTriggers.rows.map((row) => row.trigger_name)).toEqual([
      'deposit_intents_enforce_player_deposit_eligibility',
      'deposit_intents_populate_snapshot',
    ]);

    const functionBoundary = await client.query<{
      readonly function_name: string;
      readonly hardened: boolean;
      readonly public_execute: boolean;
      readonly runtime_execute: boolean;
    }>(`
      select procedure.proname as function_name,
             procedure.prosecdef
               and procedure.proowner = 'postgres'::regrole
               and procedure.proconfig =
                 array['search_path=pg_catalog, app, pg_temp']::text[] as hardened,
             exists (
               select 1
               from aclexplode(
                 coalesce(procedure.proacl, acldefault('f', procedure.proowner))
               ) privilege
               where privilege.grantee = 0
                 and privilege.privilege_type = 'EXECUTE'
             ) as public_execute,
             exists (
               select 1
               from pg_roles database_role
               where database_role.rolname like 'fetanagent\\_%' escape '\\'
                 and has_function_privilege(
                   database_role.rolname, procedure.oid, 'EXECUTE'
                 )
             ) as runtime_execute
      from pg_proc procedure
      where procedure.oid in (
        'app.enforce_player_deposit_eligibility_decision_insert()'::regprocedure,
        'app.reject_player_deposit_eligibility_decision_mutation()'::regprocedure,
        'app.require_player_deposit_eligibility_for_intent()'::regprocedure,
        'app.enforce_deposit_intent_eligibility_snapshot_immutable()'::regprocedure
      )
      order by function_name
    `);
    expect(functionBoundary.rows).toEqual([
      {
        function_name: 'enforce_deposit_intent_eligibility_snapshot_immutable',
        hardened: true,
        public_execute: false,
        runtime_execute: false,
      },
      {
        function_name: 'enforce_player_deposit_eligibility_decision_insert',
        hardened: true,
        public_execute: false,
        runtime_execute: false,
      },
      {
        function_name: 'reject_player_deposit_eligibility_decision_mutation',
        hardened: true,
        public_execute: false,
        runtime_execute: false,
      },
      {
        function_name: 'require_player_deposit_eligibility_for_intent',
        hardened: true,
        public_execute: false,
        runtime_execute: false,
      },
    ]);

    const runtimeTableAccess = await client.query<{ readonly role_name: string }>(`
      select database_role.rolname as role_name
      from pg_roles database_role
      where (
          database_role.rolname in ('anon', 'authenticated', 'service_role')
          or database_role.rolname like 'fetanagent\\_%' escape '\\'
        )
        and (
          has_table_privilege(
            database_role.rolname,
            'app.player_deposit_eligibility_decisions',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
          or has_any_column_privilege(
            database_role.rolname,
            'app.player_deposit_eligibility_decisions',
            'SELECT,INSERT,UPDATE,REFERENCES'
          )
        )
      order by role_name
    `);
    expect(runtimeTableAccess.rows).toEqual([]);

    const guardDefinition = await client.query<{ readonly definition: string }>(`
      select lower(pg_get_functiondef(
        'app.require_player_deposit_eligibility_for_intent()'::regprocedure
      )) as definition
    `);
    const guardSource = guardDefinition.rows[0]!.definition;
    expect(guardSource).toContain('for update');
    expect(guardSource).toContain('count(*)::integer');
    expect(guardSource).toContain('max(decision.decision_version)');
    expect(guardSource).toContain('maximum_decision_version <> decision_count');
    expect(guardSource).toContain('latest_decision.decision_version <> maximum_decision_version');
    expect(guardSource).toContain('latest_decision.decided_at > clock_timestamp()');
    expect(guardSource).toContain("locked_player.validation_status <> 'valid'");
    expect(guardSource).toContain("player_platform.status <> 'active'");
    expect(guardSource).toContain('latest_decision.player_account_updated_at_snapshot');
    expect(guardSource).toContain('is distinct from locked_player.updated_at');
    expect(guardSource).toContain(
      'new.player_deposit_eligibility_decision_id := latest_decision.id',
    );
    const insertGuardDefinition = await client.query<{ readonly definition: string }>(`
      select lower(pg_get_functiondef(
        'app.enforce_player_deposit_eligibility_decision_insert()'::regprocedure
      )) as definition
    `);
    const insertGuardSource = insertGuardDefinition.rows[0]!.definition;
    expect(insertGuardSource).toContain('existing_decision_count <> existing_maximum_version');
    expect(insertGuardSource).toContain('decision_time < previous_decided_at');
    expect(insertGuardSource).toContain("locked_player.validation_status <> 'valid'");
    expect(insertGuardSource).toContain("player_platform.status <> 'active'");
    expect(insertGuardSource).toContain(
      'new.player_account_updated_at_snapshot := locked_player.updated_at',
    );
    expect(insertGuardSource).toContain('new.decided_at := decision_time');
    expect(insertGuardSource).toContain('new.created_at := decision_time');

    const nonTriggerEligibilityReaders = await client.query<{ readonly signature: string }>(`
      with ordinary_routines as materialized (
        select procedure.oid
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'app'
          and procedure.prokind in ('f', 'p')
          and procedure.prorettype <> 'trigger'::regtype
      )
      select routine.oid::regprocedure::text as signature
      from ordinary_routines routine
      where lower(pg_get_functiondef(routine.oid))
          like '%player_deposit_eligibility_decisions%'
      order by signature
    `);
    expect(nonTriggerEligibilityReaders.rows).toEqual([
      { signature: 'app.enqueue_verified_deposit_execution(uuid)' },
      { signature: 'app.fence_deposit_execution_final_action(uuid,uuid)' },
      { signature: 'app.lease_next_deposit_execution(uuid,integer)' },
      { signature: 'app.list_customer_web_player_registrations(uuid,integer)' },
      { signature: 'app.resolve_current_live_customer_deposit_boundary(uuid,text,bigint)' },
    ]);

    const eligibilityReaderPrivileges = await client.query<{
      readonly customer_web_runtime: boolean;
      readonly deposit_executor_runtime: boolean;
      readonly player_actions_runtime: boolean;
      readonly public_execute: boolean;
      readonly settlement_runtime: boolean;
      readonly signature: string;
    }>(`
      select procedure.oid::regprocedure::text as signature,
             has_function_privilege(
               'fetanagent_player_actions_runtime', procedure.oid, 'EXECUTE'
             ) as player_actions_runtime,
             has_function_privilege(
               'fetanagent_customer_web_runtime', procedure.oid, 'EXECUTE'
             ) as customer_web_runtime,
             has_function_privilege(
               'fetanagent_deposit_executor_runtime', procedure.oid, 'EXECUTE'
             ) as deposit_executor_runtime,
             has_function_privilege(
               'fetanagent_verification_settlement_runtime', procedure.oid, 'EXECUTE'
             ) as settlement_runtime,
             exists (
               select 1
               from aclexplode(coalesce(
                 procedure.proacl,
                 acldefault('f', procedure.proowner)
               )) privilege
               where privilege.grantee = 0
                 and privilege.privilege_type = 'EXECUTE'
             ) as public_execute
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'app'
         and procedure.oid in (
           'app.enqueue_verified_deposit_execution(uuid)'::regprocedure,
           'app.fence_deposit_execution_final_action(uuid,uuid)'::regprocedure,
           'app.lease_next_deposit_execution(uuid,integer)'::regprocedure,
           'app.list_customer_web_player_registrations(uuid,integer)'::regprocedure,
           'app.resolve_current_live_customer_deposit_boundary(uuid,text,bigint)'::regprocedure
         )
       order by signature
    `);
    expect(eligibilityReaderPrivileges.rows).toEqual([
      {
        customer_web_runtime: false,
        deposit_executor_runtime: false,
        player_actions_runtime: false,
        public_execute: false,
        settlement_runtime: false,
        signature: 'app.enqueue_verified_deposit_execution(uuid)',
      },
      {
        customer_web_runtime: false,
        deposit_executor_runtime: true,
        player_actions_runtime: false,
        public_execute: false,
        settlement_runtime: false,
        signature: 'app.fence_deposit_execution_final_action(uuid,uuid)',
      },
      {
        customer_web_runtime: false,
        deposit_executor_runtime: true,
        player_actions_runtime: false,
        public_execute: false,
        settlement_runtime: false,
        signature: 'app.lease_next_deposit_execution(uuid,integer)',
      },
      {
        customer_web_runtime: true,
        deposit_executor_runtime: false,
        player_actions_runtime: false,
        public_execute: false,
        settlement_runtime: false,
        signature: 'app.list_customer_web_player_registrations(uuid,integer)',
      },
      {
        customer_web_runtime: false,
        deposit_executor_runtime: false,
        player_actions_runtime: false,
        public_execute: false,
        settlement_runtime: false,
        signature: 'app.resolve_current_live_customer_deposit_boundary(uuid,text,bigint)',
      },
    ]);

    const webOriginEligibility = await client.query<{ readonly decisions: number }>(`
      select count(*)::integer as decisions
      from app.player_deposit_eligibility_decisions decision
      join app.player_registration_request_associations association
        on association.player_account_id = decision.player_account_id
      join app.customer_web_player_registration_request_origins request_origin
        on request_origin.player_registration_request_id =
           association.player_registration_request_id
    `);
    expect(webOriginEligibility.rows).toEqual([{ decisions: 0 }]);

    const financialSwitches = await client.query<{
      readonly all_disabled: boolean;
      readonly non_disabled: number;
    }>(`
      select count(*) = 4 and bool_and(mode = 'disabled') as all_disabled,
             count(*) filter (where mode <> 'disabled')::integer as non_disabled
      from app.feature_switches
      where feature_key in (
        'payment_verification', 'deposit_execution',
        'withdrawal_validation', 'withdrawal_collection'
      )
    `);
    expect(financialSwitches.rows).toEqual([{ all_disabled: true, non_disabled: 0 }]);

    const migrationSource = await readFile(
      join(
        environment.migrationsDirectory,
        '20260815143416_separate_player_deposit_eligibility.sql',
      ),
      'utf8',
    );
    expect(migrationSource).not.toMatch(
      /insert\s+into\s+app\.player_deposit_eligibility_decisions/iu,
    );
    expect(migrationSource).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+app\.feature_switches/iu,
    );
  });

  it('requires exact append-only decisions and snapshots only current eligibility', async () => {
    const primaryPlayer = await createValidatedPlayerFixture('ELIGIBILITY-DIRECT-PRIMARY');
    const alternatePlayer = await createValidatedPlayerFixture('ELIGIBILITY-DIRECT-ALTERNATE');
    const paymentBoundary = await client.query<{
      readonly payment_provider_id: string;
      readonly receiver_account_id: string;
    }>(`
      select payment_provider.id as payment_provider_id,
             receiver_account.id as receiver_account_id
      from app.payment_providers payment_provider
      join app.receiver_accounts receiver_account
        on receiver_account.provider_id = payment_provider.id
       and receiver_account.status = 'active'
      where payment_provider.code = 'cbe_birr'
        and payment_provider.status = 'active'
    `);
    expect(paymentBoundary.rows).toHaveLength(1);
    const { payment_provider_id: paymentProviderId, receiver_account_id: receiverAccountId } =
      paymentBoundary.rows[0]!;

    const unverifiedCustomer = await client.query<{ readonly id: string }>(
      `insert into app.customers default values returning id`,
    );
    const unverifiedPlayer = await client.query<{ readonly id: string }>(
      `insert into app.customer_platform_players (customer_id, platform_id, player_id)
       values ($1::uuid, $2::uuid, 'ELIGIBILITY-UNVERIFIED-PRESEED')
       returning id`,
      [unverifiedCustomer.rows[0]!.id, primaryPlayer.platformId],
    );
    const unverifiedPlayerId = unverifiedPlayer.rows[0]!.id;
    await expect(
      client.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind
         ) values (
           $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
         )`,
        [unverifiedPlayerId],
      ),
    ).rejects.toThrow(/requires an active, validated player account and platform/u);
    const unverifiedRevocation = await client.query<{ readonly decision: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 1, 'revoked', 'financial_eligibility_revoked', 'system'
       )
       returning decision`,
      [unverifiedPlayerId],
    );
    expect(unverifiedRevocation.rows).toEqual([{ decision: 'revoked' }]);

    await client.query(
      `insert into app.player_validation_attempts (
         player_account_id, attempt_number, outcome, reason_code, adapter_version,
         started_at, completed_at, result_digest
       ) values (
         $1::uuid, 1, 'valid', 'sql_eligibility_fixture',
         'sql_eligibility_fixture_v1', clock_timestamp() - interval '1 second',
         clock_timestamp(), 'sql-eligibility-invalid-to-valid'
       )`,
      [unverifiedPlayerId],
    );
    await client.query(
      `update app.customer_platform_players
          set validation_status = 'valid'
        where id = $1::uuid`,
      [unverifiedPlayerId],
    );
    await expect(
      client.query(
        `insert into app.deposit_intents (
           customer_id, platform_id, player_account_id, payment_provider_id,
           receiver_account_id, expected_amount_minor
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)`,
        [
          unverifiedCustomer.rows[0]!.id,
          primaryPlayer.platformId,
          unverifiedPlayerId,
          paymentProviderId,
          receiverAccountId,
        ],
      ),
    ).rejects.toThrow('requires a current Player-ID deposit-eligibility decision');
    const revalidatedEligibility = await client.query<{ readonly id: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 2, 'eligible', 'financial_eligibility_approved', 'system'
       )
       returning id`,
      [unverifiedPlayerId],
    );
    const revalidatedIntent = await client.query<{
      readonly player_deposit_eligibility_decision_id: string;
    }>(
      `insert into app.deposit_intents (
         customer_id, platform_id, player_account_id, payment_provider_id,
         receiver_account_id, expected_amount_minor
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)
       returning player_deposit_eligibility_decision_id`,
      [
        unverifiedCustomer.rows[0]!.id,
        primaryPlayer.platformId,
        unverifiedPlayerId,
        paymentProviderId,
        receiverAccountId,
      ],
    );
    expect(revalidatedIntent.rows).toEqual([
      { player_deposit_eligibility_decision_id: revalidatedEligibility.rows[0]!.id },
    ]);

    const inactivePlayer = await createValidatedPlayerFixture('ELIGIBILITY-INACTIVE-PRESEED');
    const beforeInactiveEligibility = await client.query<{ readonly id: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
       )
       returning id`,
      [inactivePlayer.playerAccountId],
    );
    await client.query(
      `update app.customer_platform_players set status = 'inactive' where id = $1::uuid`,
      [inactivePlayer.playerAccountId],
    );
    await expect(
      client.query(
        `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
         ) values (
           $1::uuid, 2, 'eligible', 'financial_eligibility_approved', 'system'
         )`,
        [inactivePlayer.playerAccountId],
      ),
    ).rejects.toThrow(/requires an active, validated player account and platform/u);
    await client.query(
      `update app.customer_platform_players set status = 'active' where id = $1::uuid`,
      [inactivePlayer.playerAccountId],
    );
    await expect(
      client.query(
        `insert into app.deposit_intents (
           customer_id, platform_id, player_account_id, payment_provider_id,
           receiver_account_id, expected_amount_minor
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)`,
        [
          inactivePlayer.customerId,
          inactivePlayer.platformId,
          inactivePlayer.playerAccountId,
          paymentProviderId,
          receiverAccountId,
        ],
      ),
    ).rejects.toThrow('requires a current Player-ID deposit-eligibility decision');
    const afterReactivationEligibility = await client.query<{ readonly id: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 2, 'eligible', 'financial_eligibility_approved', 'system'
       )
       returning id`,
      [inactivePlayer.playerAccountId],
    );
    expect(afterReactivationEligibility.rows[0]!.id).not.toBe(
      beforeInactiveEligibility.rows[0]!.id,
    );
    const reactivatedIntent = await client.query<{
      readonly player_deposit_eligibility_decision_id: string;
    }>(
      `insert into app.deposit_intents (
         customer_id, platform_id, player_account_id, payment_provider_id,
         receiver_account_id, expected_amount_minor
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)
       returning player_deposit_eligibility_decision_id`,
      [
        inactivePlayer.customerId,
        inactivePlayer.platformId,
        inactivePlayer.playerAccountId,
        paymentProviderId,
        receiverAccountId,
      ],
    );
    expect(reactivatedIntent.rows).toEqual([
      { player_deposit_eligibility_decision_id: afterReactivationEligibility.rows[0]!.id },
    ]);

    const inactivePlatformPlayer = await createValidatedPlayerFixture(
      'ELIGIBILITY-INACTIVE-PLATFORM-PRESEED',
    );
    await client.query('begin');
    try {
      await client.query(`update app.platforms set status = 'inactive' where id = $1::uuid`, [
        inactivePlatformPlayer.platformId,
      ]);
      await expect(
        client.query(
          `insert into app.player_deposit_eligibility_decisions (
             player_account_id, decision_version, decision, reason_code, actor_kind
           ) values (
             $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
           )`,
          [inactivePlatformPlayer.playerAccountId],
        ),
      ).rejects.toThrow(/requires an active, validated player account and platform/u);
    } finally {
      await client.query('rollback');
    }

    const beforeInvalidDecisions = await client.query<{ readonly decisions: number }>(
      `select count(*)::integer as decisions
         from app.player_deposit_eligibility_decisions
        where player_account_id = $1::uuid`,
      [primaryPlayer.playerAccountId],
    );
    await expect(
      client.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind
         ) values (
           $1::uuid, 2, 'eligible', 'financial_eligibility_approved', 'system'
         )`,
        [primaryPlayer.playerAccountId],
      ),
    ).rejects.toThrow(/exact sequential versions; expected 1/u);
    await expect(
      client.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind
         ) values (
           $1::uuid, 1, 'eligible', 'financial_eligibility_revoked', 'system'
         )`,
        [primaryPlayer.playerAccountId],
      ),
    ).rejects.toThrow(/player_deposit_eligibility_decisions_reason_check/u);
    await expect(
      client.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code,
           actor_kind, actor_admin_id
         ) values (
           $1::uuid, 1, 'eligible', 'financial_eligibility_approved',
           'system', $2::uuid
         )`,
        [primaryPlayer.playerAccountId, ownerAdminId],
      ),
    ).rejects.toThrow(/player_deposit_eligibility_decisions_actor_check/u);
    const afterInvalidDecisions = await client.query<{ readonly decisions: number }>(
      `select count(*)::integer as decisions
         from app.player_deposit_eligibility_decisions
        where player_account_id = $1::uuid`,
      [primaryPlayer.playerAccountId],
    );
    expect(afterInvalidDecisions.rows).toEqual(beforeInvalidDecisions.rows);

    const primaryEligibility = await client.query<{ readonly id: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code,
         actor_kind, actor_admin_id
       ) values (
         $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'admin', $2::uuid
       )
       returning id`,
      [primaryPlayer.playerAccountId, ownerAdminId],
    );
    const primaryEligibilityId = primaryEligibility.rows[0]!.id;
    const alternateEligibility = await client.query<{ readonly id: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
       )
       returning id`,
      [alternatePlayer.playerAccountId],
    );
    const alternateEligibilityId = alternateEligibility.rows[0]!.id;

    await expect(
      client.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind
         ) values (
           $1::uuid, 1, 'revoked', 'financial_eligibility_revoked', 'system'
         )`,
        [primaryPlayer.playerAccountId],
      ),
    ).rejects.toThrow(/exact sequential versions; expected 2/u);

    const directIntent = await client.query<{
      readonly id: string;
      readonly player_deposit_eligibility_decision_id: string;
    }>(
      `insert into app.deposit_intents (
         customer_id, platform_id, player_account_id, payment_provider_id,
         receiver_account_id, expected_amount_minor,
         player_deposit_eligibility_decision_id
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         $5::uuid, 2500, $6::uuid
       )
       returning id, player_deposit_eligibility_decision_id`,
      [
        primaryPlayer.customerId,
        primaryPlayer.platformId,
        primaryPlayer.playerAccountId,
        paymentProviderId,
        receiverAccountId,
        alternateEligibilityId,
      ],
    );
    expect(directIntent.rows).toEqual([
      {
        id: expect.any(String),
        player_deposit_eligibility_decision_id: primaryEligibilityId,
      },
    ]);
    const directIntentId = directIntent.rows[0]!.id;

    // Simulate a row created before this migration: the new snapshot column is NULL, while every
    // other immutable financial field was populated by the historical insert path. Once normal
    // trigger execution is restored, an ordinary lifecycle update must remain available.
    await client.query('begin');
    try {
      await client.query(`set local session_replication_role = 'replica'`);
      await client.query(
        `update app.deposit_intents
            set player_deposit_eligibility_decision_id = null
          where id = $1::uuid`,
        [directIntentId],
      );
      await client.query(`set local session_replication_role = 'origin'`);
      const legacyUpdate = await client.query<{
        readonly player_deposit_eligibility_decision_id: string | null;
        readonly status: string;
      }>(
        `update app.deposit_intents
            set status = 'cancelled'
          where id = $1::uuid
          returning status::text, player_deposit_eligibility_decision_id`,
        [directIntentId],
      );
      expect(legacyUpdate.rows).toEqual([
        { player_deposit_eligibility_decision_id: null, status: 'cancelled' },
      ]);
    } finally {
      await client.query('rollback');
    }

    const cancelledIntent = await client.query<{
      readonly player_deposit_eligibility_decision_id: string;
      readonly status: string;
    }>(
      `update app.deposit_intents
          set status = 'cancelled'
        where id = $1::uuid
        returning status::text, player_deposit_eligibility_decision_id`,
      [directIntentId],
    );
    expect(cancelledIntent.rows).toEqual([
      {
        player_deposit_eligibility_decision_id: primaryEligibilityId,
        status: 'cancelled',
      },
    ]);
    await expect(
      client.query(
        `update app.deposit_intents
            set player_deposit_eligibility_decision_id = $2::uuid
          where id = $1::uuid`,
        [directIntentId, alternateEligibilityId],
      ),
    ).rejects.toThrow(/eligibility snapshot is immutable/u);

    await expect(
      client.query(
        `update app.player_deposit_eligibility_decisions
            set reason_code = 'financial_eligibility_revoked'
          where id = $1::uuid`,
        [primaryEligibilityId],
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      client.query(`delete from app.player_deposit_eligibility_decisions where id = $1::uuid`, [
        primaryEligibilityId,
      ]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      client.query('truncate app.player_deposit_eligibility_decisions cascade'),
    ).rejects.toThrow(/append-only/u);

    const revocation = await client.query<{
      readonly decision_version: number;
      readonly id: string;
    }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 2, 'revoked', 'financial_eligibility_revoked', 'system'
       )
       returning id, decision_version`,
      [primaryPlayer.playerAccountId],
    );
    expect(revocation.rows).toEqual([{ decision_version: 2, id: expect.any(String) }]);

    const latestState = await client.query<{
      readonly decision: string;
      readonly decision_version: number;
      readonly validation_status: string;
    }>(
      `select latest.decision,
              latest.decision_version,
              player.validation_status::text as validation_status
         from app.customer_platform_players player
         join lateral (
           select decision, decision_version
             from app.player_deposit_eligibility_decisions decision
            where decision.player_account_id = player.id
            order by decision_version desc
            limit 1
         ) latest on true
        where player.id = $1::uuid`,
      [primaryPlayer.playerAccountId],
    );
    expect(latestState.rows).toEqual([
      { decision: 'revoked', decision_version: 2, validation_status: 'valid' },
    ]);

    const beforeRevokedIntent = await client.query<{ readonly intents: number }>(
      `select count(*)::integer as intents
         from app.deposit_intents
        where player_account_id = $1::uuid`,
      [primaryPlayer.playerAccountId],
    );
    await expect(
      client.query(
        `insert into app.deposit_intents (
           customer_id, platform_id, player_account_id, payment_provider_id,
           receiver_account_id, expected_amount_minor
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)`,
        [
          primaryPlayer.customerId,
          primaryPlayer.platformId,
          primaryPlayer.playerAccountId,
          paymentProviderId,
          receiverAccountId,
        ],
      ),
    ).rejects.toThrow('requires a current Player-ID deposit-eligibility decision');
    const afterRevokedIntent = await client.query<{ readonly intents: number }>(
      `select count(*)::integer as intents
         from app.deposit_intents
        where player_account_id = $1::uuid`,
      [primaryPlayer.playerAccountId],
    );
    expect(afterRevokedIntent.rows).toEqual(beforeRevokedIntent.rows);
  });

  it('rejects malformed or future eligibility history without deposit side effects', async () => {
    const paymentBoundary = await client.query<{
      readonly payment_provider_id: string;
      readonly receiver_account_id: string;
    }>(`
      select payment_provider.id as payment_provider_id,
             receiver_account.id as receiver_account_id
      from app.payment_providers payment_provider
      join app.receiver_accounts receiver_account
        on receiver_account.provider_id = payment_provider.id
       and receiver_account.status = 'active'
      where payment_provider.code = 'cbe_birr'
        and payment_provider.status = 'active'
    `);
    expect(paymentBoundary.rows).toHaveLength(1);
    const { payment_provider_id: paymentProviderId, receiver_account_id: receiverAccountId } =
      paymentBoundary.rows[0]!;

    const malformedPlayer = await createValidatedPlayerFixture('ELIGIBILITY-MALFORMED-HISTORY');
    const beforeMalformed = await client.query<{
      readonly decisions: number;
      readonly intents: number;
    }>(
      `select
         (select count(*)::integer from app.player_deposit_eligibility_decisions
           where player_account_id = $1::uuid) as decisions,
         (select count(*)::integer from app.deposit_intents
           where player_account_id = $1::uuid) as intents`,
      [malformedPlayer.playerAccountId],
    );
    await client.query('begin');
    try {
      await client.query(`set local session_replication_role = 'replica'`);
      await client.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind,
           player_account_updated_at_snapshot, decided_at, created_at
          )
          select $1::uuid, 2, 'eligible', 'financial_eligibility_approved', 'system',
                 player.updated_at, statement_timestamp(), statement_timestamp()
            from app.customer_platform_players player
            join app.platforms platform on platform.id = player.platform_id
           where player.id = $1::uuid`,
        [malformedPlayer.playerAccountId],
      );
      await client.query(`set local session_replication_role = 'origin'`);
      await expect(
        client.query(
          `insert into app.deposit_intents (
             customer_id, platform_id, player_account_id, payment_provider_id,
             receiver_account_id, expected_amount_minor
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)`,
          [
            malformedPlayer.customerId,
            malformedPlayer.platformId,
            malformedPlayer.playerAccountId,
            paymentProviderId,
            receiverAccountId,
          ],
        ),
      ).rejects.toThrow(/decision history is invalid/u);
    } finally {
      await client.query('rollback');
    }
    const afterMalformed = await client.query<{
      readonly decisions: number;
      readonly intents: number;
    }>(
      `select
         (select count(*)::integer from app.player_deposit_eligibility_decisions
           where player_account_id = $1::uuid) as decisions,
         (select count(*)::integer from app.deposit_intents
           where player_account_id = $1::uuid) as intents`,
      [malformedPlayer.playerAccountId],
    );
    expect(afterMalformed.rows).toEqual(beforeMalformed.rows);

    const futurePlayer = await createValidatedPlayerFixture('ELIGIBILITY-FUTURE-HISTORY');
    const beforeFuture = await client.query<{
      readonly decisions: number;
      readonly intents: number;
    }>(
      `select
         (select count(*)::integer from app.player_deposit_eligibility_decisions
           where player_account_id = $1::uuid) as decisions,
         (select count(*)::integer from app.deposit_intents
           where player_account_id = $1::uuid) as intents`,
      [futurePlayer.playerAccountId],
    );
    await client.query('begin');
    try {
      await client.query(`set local session_replication_role = 'replica'`);
      await client.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind,
           player_account_updated_at_snapshot, decided_at, created_at
         )
         select $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system',
                player.updated_at,
                statement_timestamp() + interval '1 hour',
                statement_timestamp() + interval '1 hour'
           from app.customer_platform_players player
           join app.platforms platform on platform.id = player.platform_id
          where player.id = $1::uuid`,
        [futurePlayer.playerAccountId],
      );
      await client.query(`set local session_replication_role = 'origin'`);
      await expect(
        client.query(
          `insert into app.deposit_intents (
             customer_id, platform_id, player_account_id, payment_provider_id,
             receiver_account_id, expected_amount_minor
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)`,
          [
            futurePlayer.customerId,
            futurePlayer.platformId,
            futurePlayer.playerAccountId,
            paymentProviderId,
            receiverAccountId,
          ],
        ),
      ).rejects.toThrow(/decision history is invalid/u);
    } finally {
      await client.query('rollback');
    }
    const afterFuture = await client.query<{
      readonly decisions: number;
      readonly intents: number;
    }>(
      `select
         (select count(*)::integer from app.player_deposit_eligibility_decisions
           where player_account_id = $1::uuid) as decisions,
         (select count(*)::integer from app.deposit_intents
           where player_account_id = $1::uuid) as intents`,
      [futurePlayer.playerAccountId],
    );
    expect(afterFuture.rows).toEqual(beforeFuture.rows);
  });

  it('keeps the retired live Telegram entry point ungranted and behind the intent table', async () => {
    const liveBoundary = await client.query<{
      readonly api_execute: boolean;
      readonly definition: string;
      readonly public_execute: boolean;
    }>(`
      select lower(pg_get_functiondef(
               'app.open_telegram_deposit_intent(uuid,uuid,uuid,bigint)'::regprocedure
             )) as definition,
             has_function_privilege(
               'public',
               'app.open_telegram_deposit_intent(uuid,uuid,uuid,bigint)',
               'EXECUTE'
             ) as public_execute,
             has_function_privilege(
               'fetanagent_api',
               'app.open_telegram_deposit_intent(uuid,uuid,uuid,bigint)',
               'EXECUTE'
             ) as api_execute
    `);
    expect(liveBoundary.rows).toHaveLength(1);
    expect(liveBoundary.rows[0]).toMatchObject({
      api_execute: false,
      public_execute: false,
    });
    expect(liveBoundary.rows[0]!.definition).toContain('insert into app.deposit_intents');
  });

  it('serializes a new intent against a concurrent eligibility revocation', async () => {
    const racePlayer = await createValidatedPlayerFixture('ELIGIBILITY-REVOCATION-RACE');
    const initialEligibility = await client.query<{ readonly id: string }>(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
       )
       returning id`,
      [racePlayer.playerAccountId],
    );
    const initialEligibilityId = initialEligibility.rows[0]!.id;
    const paymentBoundary = await client.query<{
      readonly payment_provider_id: string;
      readonly receiver_account_id: string;
    }>(`
      select payment_provider.id as payment_provider_id,
             receiver_account.id as receiver_account_id
      from app.payment_providers payment_provider
      join app.receiver_accounts receiver_account
        on receiver_account.provider_id = payment_provider.id
       and receiver_account.status = 'active'
      where payment_provider.code = 'cbe_birr'
        and payment_provider.status = 'active'
    `);
    expect(paymentBoundary.rows).toHaveLength(1);
    const { payment_provider_id: paymentProviderId, receiver_account_id: receiverAccountId } =
      paymentBoundary.rows[0]!;

    const intentConnection = createSqlIntegrationClient(environment);
    const revocationConnection = createSqlIntegrationClient(environment);
    let revocationAttempt: Promise<unknown> | undefined;
    let intentCommitted = false;
    let revocationCommitted = false;
    let concurrentIntentId: string | undefined;
    await Promise.all([intentConnection.connect(), revocationConnection.connect()]);
    try {
      await Promise.all([intentConnection.query('begin'), revocationConnection.query('begin')]);
      await intentConnection.query(`set local lock_timeout = '5s'`);
      await revocationConnection.query(`set local lock_timeout = '5s'`);
      await revocationConnection.query(
        `set local application_name = 'eligibility_revocation_race'`,
      );

      const concurrentIntent = await intentConnection.query<{
        readonly id: string;
        readonly player_deposit_eligibility_decision_id: string;
      }>(
        `insert into app.deposit_intents (
           customer_id, platform_id, player_account_id, payment_provider_id,
           receiver_account_id, expected_amount_minor
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)
         returning id, player_deposit_eligibility_decision_id`,
        [
          racePlayer.customerId,
          racePlayer.platformId,
          racePlayer.playerAccountId,
          paymentProviderId,
          receiverAccountId,
        ],
      );
      expect(concurrentIntent.rows).toEqual([
        {
          id: expect.any(String),
          player_deposit_eligibility_decision_id: initialEligibilityId,
        },
      ]);
      concurrentIntentId = concurrentIntent.rows[0]!.id;

      revocationAttempt = revocationConnection.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind
         ) values (
           $1::uuid, 2, 'revoked', 'financial_eligibility_revoked', 'worker'
         )`,
        [racePlayer.playerAccountId],
      );

      let observedLockWait = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const lockState = await client.query<{ readonly waiting: boolean }>(`
          select exists (
            select 1
            from pg_stat_activity activity
            where activity.application_name = 'eligibility_revocation_race'
              and activity.wait_event_type = 'Lock'
          ) as waiting
        `);
        if (lockState.rows[0]!.waiting) {
          observedLockWait = true;
          break;
        }
        await client.query('select pg_sleep(0.025)');
      }
      expect(observedLockWait).toBe(true);

      await intentConnection.query('commit');
      intentCommitted = true;
      await revocationAttempt;
      revocationAttempt = undefined;
      await revocationConnection.query('commit');
      revocationCommitted = true;
    } finally {
      if (!intentCommitted) {
        await Promise.allSettled([intentConnection.query('rollback')]);
      }
      if (revocationAttempt) {
        await Promise.allSettled([revocationAttempt]);
      }
      if (!revocationCommitted) {
        await Promise.allSettled([revocationConnection.query('rollback')]);
      }
      await Promise.allSettled([intentConnection.end(), revocationConnection.end()]);
    }

    expect(concurrentIntentId).toEqual(expect.any(String));
    const serializedState = await client.query<{
      readonly intent_decision_id: string;
      readonly latest_decision: string;
      readonly latest_version: number;
    }>(
      `select intent.player_deposit_eligibility_decision_id as intent_decision_id,
              latest.decision as latest_decision,
              latest.decision_version as latest_version
         from app.deposit_intents intent
         join lateral (
           select decision, decision_version
             from app.player_deposit_eligibility_decisions decision
            where decision.player_account_id = intent.player_account_id
            order by decision_version desc
            limit 1
         ) latest on true
        where intent.id = $1::uuid`,
      [concurrentIntentId!],
    );
    expect(serializedState.rows).toEqual([
      {
        intent_decision_id: initialEligibilityId,
        latest_decision: 'revoked',
        latest_version: 2,
      },
    ]);

    const beforePostRevocation = await client.query<{ readonly intents: number }>(
      `select count(*)::integer as intents
         from app.deposit_intents
        where player_account_id = $1::uuid`,
      [racePlayer.playerAccountId],
    );
    await expect(
      client.query(
        `insert into app.deposit_intents (
           customer_id, platform_id, player_account_id, payment_provider_id,
           receiver_account_id, expected_amount_minor
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)`,
        [
          racePlayer.customerId,
          racePlayer.platformId,
          racePlayer.playerAccountId,
          paymentProviderId,
          receiverAccountId,
        ],
      ),
    ).rejects.toThrow('requires a current Player-ID deposit-eligibility decision');
    const afterPostRevocation = await client.query<{ readonly intents: number }>(
      `select count(*)::integer as intents
         from app.deposit_intents
        where player_account_id = $1::uuid`,
      [racePlayer.playerAccountId],
    );
    expect(afterPostRevocation.rows).toEqual(beforePostRevocation.rows);

    const revocationFirstPlayer = await createValidatedPlayerFixture(
      'ELIGIBILITY-REVOCATION-FIRST-RACE',
    );
    await client.query(
      `insert into app.player_deposit_eligibility_decisions (
         player_account_id, decision_version, decision, reason_code, actor_kind
       ) values (
         $1::uuid, 1, 'eligible', 'financial_eligibility_approved', 'system'
       )`,
      [revocationFirstPlayer.playerAccountId],
    );

    const revocationFirstConnection = createSqlIntegrationClient(environment);
    const blockedIntentConnection = createSqlIntegrationClient(environment);
    let blockedIntentAttempt: Promise<unknown> | undefined;
    let revocationFirstCommitted = false;
    let blockedIntentRolledBack = false;
    await Promise.all([revocationFirstConnection.connect(), blockedIntentConnection.connect()]);
    try {
      await Promise.all([
        revocationFirstConnection.query('begin'),
        blockedIntentConnection.query('begin'),
      ]);
      await revocationFirstConnection.query(`set local lock_timeout = '5s'`);
      await blockedIntentConnection.query(`set local lock_timeout = '5s'`);
      await blockedIntentConnection.query(
        `set local application_name = 'eligibility_intent_after_revocation_race'`,
      );

      await revocationFirstConnection.query(
        `insert into app.player_deposit_eligibility_decisions (
           player_account_id, decision_version, decision, reason_code, actor_kind
         ) values (
           $1::uuid, 2, 'revoked', 'financial_eligibility_revoked', 'worker'
         )`,
        [revocationFirstPlayer.playerAccountId],
      );

      blockedIntentAttempt = blockedIntentConnection.query(
        `insert into app.deposit_intents (
           customer_id, platform_id, player_account_id, payment_provider_id,
           receiver_account_id, expected_amount_minor
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2500)`,
        [
          revocationFirstPlayer.customerId,
          revocationFirstPlayer.platformId,
          revocationFirstPlayer.playerAccountId,
          paymentProviderId,
          receiverAccountId,
        ],
      );

      let observedIntentLockWait = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const lockState = await client.query<{ readonly waiting: boolean }>(`
          select exists (
            select 1
            from pg_stat_activity activity
            where activity.application_name =
                  'eligibility_intent_after_revocation_race'
              and activity.wait_event_type = 'Lock'
          ) as waiting
        `);
        if (lockState.rows[0]!.waiting) {
          observedIntentLockWait = true;
          break;
        }
        await client.query('select pg_sleep(0.025)');
      }
      expect(observedIntentLockWait).toBe(true);

      await revocationFirstConnection.query('commit');
      revocationFirstCommitted = true;
      await expect(blockedIntentAttempt).rejects.toThrow(
        'requires a current Player-ID deposit-eligibility decision',
      );
      blockedIntentAttempt = undefined;
      await blockedIntentConnection.query('rollback');
      blockedIntentRolledBack = true;
    } finally {
      if (!revocationFirstCommitted) {
        await Promise.allSettled([revocationFirstConnection.query('rollback')]);
      }
      if (blockedIntentAttempt) {
        await Promise.allSettled([blockedIntentAttempt]);
      }
      if (!blockedIntentRolledBack) {
        await Promise.allSettled([blockedIntentConnection.query('rollback')]);
      }
      await Promise.allSettled([revocationFirstConnection.end(), blockedIntentConnection.end()]);
    }

    const revocationFirstState = await client.query<{
      readonly intents: number;
      readonly latest_decision: string;
      readonly latest_version: number;
    }>(
      `select
         (select count(*)::integer from app.deposit_intents
           where player_account_id = $1::uuid) as intents,
         latest.decision as latest_decision,
         latest.decision_version as latest_version
       from lateral (
         select decision, decision_version
         from app.player_deposit_eligibility_decisions decision
         where decision.player_account_id = $1::uuid
         order by decision_version desc
         limit 1
       ) latest`,
      [revocationFirstPlayer.playerAccountId],
    );
    expect(revocationFirstState.rows).toEqual([
      { intents: 0, latest_decision: 'revoked', latest_version: 2 },
    ]);
  });

  it('keeps execution ledgers private beneath the exact production command surface', async () => {
    const enumRows = await client.query<{
      readonly labels: readonly string[];
      readonly type_name: string;
    }>(`
      select enum_type.typname as type_name,
             array_agg(enum_value.enumlabel order by enum_value.enumsortorder)::text[] as labels
        from pg_type enum_type
        join pg_namespace namespace on namespace.oid = enum_type.typnamespace
        join pg_enum enum_value on enum_value.enumtypid = enum_type.oid
       where namespace.nspname = 'app'
         and enum_type.typname in (
           'deposit_execution_attempt_status',
           'execution_reconciliation_outcome'
         )
       group by enum_type.typname
       order by enum_type.typname
    `);
    expect(enumRows.rows).toEqual([
      {
        labels: [
          'prepared',
          'cancelled_before_action',
          'final_action_fenced',
          'reconciliation_required',
          'confirmed_executed',
          'review_required',
        ],
        type_name: 'deposit_execution_attempt_status',
      },
      {
        labels: ['confirmed_executed', 'ambiguous', 'not_observed'],
        type_name: 'execution_reconciliation_outcome',
      },
    ]);

    const columnRows = await client.query<{
      readonly columns: readonly string[];
      readonly table_name: string;
    }>(`
      select table_name,
             array_agg(column_name order by ordinal_position)::text[] as columns
        from information_schema.columns
       where table_schema = 'app'
         and table_name in ('deposit_execution_attempts', 'execution_reconciliations')
       group by table_name
       order by table_name
    `);
    expect(columnRows.rows).toEqual([
      {
        columns: [
          'id',
          'deposit_intent_id',
          'deposit_job_id',
          'platform_agent_account_id',
          'attempt_number',
          'status',
          'final_action_fenced_at',
          'reconciliation_required_at',
          'resolved_at',
          'created_at',
          'updated_at',
          'exact_player_credit_match',
        ],
        table_name: 'deposit_execution_attempts',
      },
      {
        columns: [
          'id',
          'deposit_execution_attempt_id',
          'deposit_intent_id',
          'platform_agent_account_id',
          'deposit_job_id',
          'reconciliation_number',
          'outcome',
          'reason_code',
          'keyed_external_reference_fingerprint',
          'approved_history_match_count',
          'normalized_operation_type',
          'matched_history_occurred_at',
          'exact_player_match',
          'exact_amount_match',
          'exact_currency_match',
          'exact_player_credit_match',
          'created_at',
        ],
        table_name: 'execution_reconciliations',
      },
    ]);

    const forbiddenColumns = await client.query<{ readonly column_name: string }>(`
      select column_name
        from information_schema.columns
       where table_schema = 'app'
         and table_name in ('deposit_execution_attempts', 'execution_reconciliations')
         and column_name ~* '(player_id|username|external_id|balance|route|payload)'
       order by column_name
    `);
    expect(forbiddenColumns.rows).toEqual([]);

    const rlsRows = await client.query<RlsRow>(`
      select relation.relname,
             relation.relrowsecurity,
             relation.relforcerowsecurity
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'app'
         and relation.relname in ('deposit_execution_attempts', 'execution_reconciliations')
       order by relation.relname
    `);
    expect(rlsRows.rows).toEqual([
      {
        relforcerowsecurity: true,
        relname: 'deposit_execution_attempts',
        relrowsecurity: true,
      },
      {
        relforcerowsecurity: true,
        relname: 'execution_reconciliations',
        relrowsecurity: true,
      },
    ]);

    const policyRows = await client.query<{ readonly policies: number }>(`
      select count(*)::integer as policies
        from pg_policy policy
        join pg_class relation on relation.oid = policy.polrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'app'
         and relation.relname in ('deposit_execution_attempts', 'execution_reconciliations')
    `);
    expect(policyRows.rows).toEqual([{ policies: 0 }]);

    const privilegeRows = await client.query<{
      readonly has_privilege: boolean;
      readonly role_name: string;
      readonly table_name: string;
    }>(`
      with roles(role_name) as (
        values
          ('public'),
          ('anon'),
          ('authenticated'),
          ('service_role'),
          ('fetanagent_api'),
          ('fetanagent_api_runtime'),
          ('fetanagent_worker'),
          ('fetanagent_beta_admission'),
          ('fetanagent_beta_admission_runtime'),
          ('fetanagent_nonce_retention'),
          ('fetanagent_nonce_retention_runtime'),
          ('fetanagent_owner_control'),
          ('fetanagent_owner_control_runtime'),
          ('fetanagent_player_actions'),
          ('fetanagent_player_actions_runtime'),
          ('fetanagent_cbe_birr_shadow_worker'),
          ('fetanagent_customer_web'),
          ('fetanagent_customer_web_runtime')
      ), tables(table_name) as (
        values ('deposit_execution_attempts'), ('execution_reconciliations')
      )
      select roles.role_name,
             tables.table_name,
             has_table_privilege(
               roles.role_name,
               pg_catalog.format('app.%I', tables.table_name),
               'SELECT'
             )
             or has_table_privilege(
               roles.role_name,
               pg_catalog.format('app.%I', tables.table_name),
               'INSERT'
             )
             or has_table_privilege(
               roles.role_name,
               pg_catalog.format('app.%I', tables.table_name),
               'UPDATE'
             )
             or has_table_privilege(
               roles.role_name,
               pg_catalog.format('app.%I', tables.table_name),
               'DELETE'
             ) as has_privilege
        from roles
        cross join tables
       order by roles.role_name, tables.table_name
    `);
    expect(privilegeRows.rows.every((row) => row.has_privilege === false)).toBe(true);

    const typePrivilegeRows = await client.query<{
      readonly has_usage: boolean;
      readonly role_name: string;
      readonly type_name: string;
    }>(`
      with roles(role_name) as (
        values
          ('public'),
          ('anon'),
          ('authenticated'),
          ('service_role'),
          ('fetanagent_api'),
          ('fetanagent_api_runtime'),
          ('fetanagent_worker'),
          ('fetanagent_beta_admission'),
          ('fetanagent_beta_admission_runtime'),
          ('fetanagent_nonce_retention'),
          ('fetanagent_nonce_retention_runtime'),
          ('fetanagent_owner_control'),
          ('fetanagent_owner_control_runtime'),
          ('fetanagent_player_actions'),
          ('fetanagent_player_actions_runtime'),
          ('fetanagent_cbe_birr_shadow_worker'),
          ('fetanagent_customer_web'),
          ('fetanagent_customer_web_runtime')
      ), types(type_name) as (
        values
          ('deposit_execution_attempt_status'),
          ('execution_reconciliation_outcome')
      )
      select roles.role_name,
             types.type_name,
             has_type_privilege(
               roles.role_name,
               pg_catalog.format('app.%I', types.type_name),
               'USAGE'
             ) as has_usage
        from roles
        cross join types
       order by roles.role_name, types.type_name
    `);
    expect(typePrivilegeRows.rows.every((row) => row.has_usage === false)).toBe(true);

    const functionRows = await client.query<{
      readonly api_execute: boolean;
      readonly function_name: string;
      readonly is_procedure: boolean;
      readonly is_security_definer: boolean;
      readonly public_execute: boolean;
      readonly returns_trigger: boolean;
      readonly safe_search_path: boolean;
      readonly worker_execute: boolean;
    }>(`
      with expected(signature) as (
        values
          ('app.reject_execution_ledger_truncate()'),
          ('app.enforce_deposit_execution_modal_fact()'),
          ('app.enforce_deposit_execution_attempt()'),
          ('app.enforce_execution_reconciliation_insert()'),
          ('app.enforce_execution_deposit_job_safety()'),
          ('app.require_deposit_execution_correspondence()')
      )
      select routine.proname as function_name,
             routine.prosecdef as is_security_definer,
             routine.prokind = 'p' as is_procedure,
             routine.prorettype = 'trigger'::regtype as returns_trigger,
             coalesce(
               exists (
                 select 1
                   from unnest(routine.proconfig) option
                  where option like 'search_path=pg_catalog%'
               ),
               false
             ) as safe_search_path,
             has_function_privilege('public', routine.oid, 'EXECUTE') as public_execute,
             has_function_privilege('fetanagent_api', routine.oid, 'EXECUTE') as api_execute,
             has_function_privilege('fetanagent_worker', routine.oid, 'EXECUTE') as worker_execute
        from expected
        join pg_proc routine on routine.oid = pg_catalog.to_regprocedure(expected.signature)
       order by routine.proname
    `);
    expect(functionRows.rows).toHaveLength(6);
    expect(
      functionRows.rows.every(
        (row) =>
          row.api_execute === false &&
          row.is_procedure === false &&
          row.is_security_definer === false &&
          row.public_execute === false &&
          row.returns_trigger &&
          row.safe_search_path &&
          row.worker_execute === false,
      ),
    ).toBe(true);

    const functionPrivilegeRows = await client.query<{
      readonly function_name: string;
      readonly has_execute: boolean;
      readonly role_name: string;
    }>(`
      with roles(role_name) as (
        values
          ('public'),
          ('anon'),
          ('authenticated'),
          ('service_role'),
          ('fetanagent_api'),
          ('fetanagent_api_runtime'),
          ('fetanagent_worker'),
          ('fetanagent_beta_admission'),
          ('fetanagent_beta_admission_runtime'),
          ('fetanagent_nonce_retention'),
          ('fetanagent_nonce_retention_runtime'),
          ('fetanagent_owner_control'),
          ('fetanagent_owner_control_runtime'),
          ('fetanagent_player_actions'),
          ('fetanagent_player_actions_runtime'),
          ('fetanagent_cbe_birr_shadow_worker'),
          ('fetanagent_customer_web'),
          ('fetanagent_customer_web_runtime')
      ), expected(signature) as (
        values
          ('app.reject_execution_ledger_truncate()'),
          ('app.enforce_deposit_execution_modal_fact()'),
          ('app.enforce_deposit_execution_attempt()'),
          ('app.enforce_execution_reconciliation_insert()'),
          ('app.enforce_execution_deposit_job_safety()'),
          ('app.require_deposit_execution_correspondence()')
      )
      select roles.role_name,
             routine.proname as function_name,
             has_function_privilege(roles.role_name, routine.oid, 'EXECUTE') as has_execute
        from roles
        cross join expected
        join pg_proc routine on routine.oid = pg_catalog.to_regprocedure(expected.signature)
       order by roles.role_name, routine.proname
    `);
    expect(functionPrivilegeRows.rows).toHaveLength(108);
    expect(functionPrivilegeRows.rows.every((row) => row.has_execute === false)).toBe(true);

    const executionProcedures = await client.query<{ readonly procedures: number }>(`
      select count(*)::integer as procedures
        from pg_proc routine
        join pg_namespace namespace on namespace.oid = routine.pronamespace
       where namespace.nspname = 'app'
         and routine.prokind = 'p'
         and routine.proname ~ '(execution|reconciliation)'
    `);
    expect(executionProcedures.rows).toEqual([{ procedures: 0 }]);

    const callableExecutionRoutines = await client.query<{ readonly routines: number }>(`
      select count(*)::integer as routines
        from pg_proc routine
        join pg_namespace namespace on namespace.oid = routine.pronamespace
       where namespace.nspname = 'app'
         and routine.proname ~ '(execution|reconciliation)'
         and routine.prorettype <> 'trigger'::regtype
    `);
    expect(callableExecutionRoutines.rows).toEqual([{ routines: 8 }]);

    const indexRows = await client.query<{
      readonly indexdef: string;
      readonly indexname: string;
    }>(`
      select indexname, lower(indexdef) as indexdef
        from pg_indexes
       where schemaname = 'app'
         and indexname in (
           'deposit_execution_attempts_one_blocking_intent_idx',
           'deposit_execution_attempts_one_blocking_agent_idx',
           'execution_reconciliations_one_terminal_attempt_idx',
           'execution_reconciliations_agent_reference_idx',
           'deposit_jobs_one_active_execution_intent_idx',
           'deposit_jobs_one_active_reconciliation_intent_idx'
         )
       order by indexname
    `);
    expect(indexRows.rows).toHaveLength(6);
    expect(
      indexRows.rows.find(
        (row) => row.indexname === 'deposit_execution_attempts_one_blocking_agent_idx',
      )?.indexdef,
    ).toContain("'review_required'::app.deposit_execution_attempt_status");
    expect(
      indexRows.rows.find((row) => row.indexname === 'deposit_jobs_one_active_execution_intent_idx')
        ?.indexdef,
    ).toContain("'retry_wait'::app.deposit_job_status");
    expect(
      indexRows.rows.find(
        (row) => row.indexname === 'execution_reconciliations_agent_reference_idx',
      )?.indexdef,
    ).toContain('keyed_external_reference_fingerprint is not null');

    const triggerRows = await client.query<{ readonly trigger_name: string }>(`
      select trigger.tgname as trigger_name
        from pg_trigger trigger
       where not trigger.tgisinternal
         and trigger.tgname in (
           'deposit_execution_attempts_enforce',
           'deposit_execution_attempts_modal_fact_immutable',
           'deposit_execution_attempts_no_delete',
           'deposit_execution_attempts_no_truncate',
           'execution_reconciliations_enforce_insert',
           'execution_reconciliations_require_modal_fact',
           'execution_reconciliations_immutable',
           'execution_reconciliations_no_truncate',
           'deposit_jobs_enforce_execution_safety',
           'deposit_intents_require_execution_correspondence'
         )
       order by trigger.tgname
    `);
    expect(triggerRows.rows.map((row) => row.trigger_name)).toEqual([
      'deposit_execution_attempts_enforce',
      'deposit_execution_attempts_modal_fact_immutable',
      'deposit_execution_attempts_no_delete',
      'deposit_execution_attempts_no_truncate',
      'deposit_intents_require_execution_correspondence',
      'deposit_jobs_enforce_execution_safety',
      'execution_reconciliations_enforce_insert',
      'execution_reconciliations_immutable',
      'execution_reconciliations_no_truncate',
      'execution_reconciliations_require_modal_fact',
    ]);

    const guardSources = await client.query<{
      readonly execution_job_guard: string;
      readonly intent_guard: string;
      readonly reconciliation_guard: string;
    }>(`
      select lower(pg_get_functiondef(
               'app.enforce_execution_deposit_job_safety()'::regprocedure
             )) as execution_job_guard,
             lower(pg_get_functiondef(
               'app.require_deposit_execution_correspondence()'::regprocedure
             )) as intent_guard,
             lower(pg_get_functiondef(
               'app.enforce_execution_reconciliation_insert()'::regprocedure
             )) as reconciliation_guard
    `);
    expect(guardSources.rows).toHaveLength(1);
    expect(guardSources.rows[0]!.execution_job_guard).toContain('new.max_attempts <> 1');
    expect(guardSources.rows[0]!.execution_job_guard).toContain("new.status = 'retry_wait'");
    expect(guardSources.rows[0]!.execution_job_guard).toContain(
      "intent_status <> 'execution_reconciliation'",
    );
    expect(guardSources.rows[0]!.intent_guard).toContain(
      "attempt_row.status <> 'final_action_fenced'",
    );
    expect(guardSources.rows[0]!.intent_guard).toContain(
      "latest_reconciliation.outcome <> 'confirmed_executed'",
    );
    expect(guardSources.rows[0]!.intent_guard).toContain('execution retry is not authorized');
    expect(guardSources.rows[0]!.reconciliation_guard).toContain(
      'new.matched_history_occurred_at < attempt_row.final_action_fenced_at',
    );
    expect(guardSources.rows[0]!.reconciliation_guard).toContain(
      'new.matched_history_occurred_at > attempt_row.reconciliation_required_at',
    );

    const modalFactGuard = await client.query<{ readonly source: string }>(`
      select lower(pg_get_functiondef(
               'app.enforce_deposit_execution_modal_fact()'::regprocedure
             )) as source
    `);
    expect(modalFactGuard.rows[0]!.source).toContain('attempt.exact_player_credit_match is true');
    expect(modalFactGuard.rows[0]!.source).toContain(
      'exact player-credit fact is immutable after handoff',
    );

    const evidenceConstraint = await client.query<{ readonly definition: string }>(`
      select lower(pg_get_constraintdef(constraint_row.oid)) as definition
        from pg_constraint constraint_row
       where constraint_row.conrelid = 'app.execution_reconciliations'::regclass
         and constraint_row.conname = 'execution_reconciliations_evidence_shape_check'
    `);
    expect(evidenceConstraint.rows).toHaveLength(1);
    expect(evidenceConstraint.rows[0]!.definition).toContain(
      "normalized_operation_type = 'deposit'::text",
    );
    expect(evidenceConstraint.rows[0]!.definition).toContain(
      'matched_history_occurred_at is not null',
    );
    expect(evidenceConstraint.rows[0]!.definition).toContain('normalized_operation_type is null');
    expect(evidenceConstraint.rows[0]!.definition).toContain('matched_history_occurred_at is null');
  });

  it('fails closed from the action fence through mandatory reconciliation', async () => {
    await client.query('begin');
    try {
      const agent = await client.query<{ readonly id: string }>(`
        insert into app.platform_agent_accounts (
          platform_id, label, credential_ref
        )
        select platform.id, 'dormant-sql-execution-agent', 'secret://dormant-sql-agent'
          from app.platforms platform
         where platform.code = 'kemerbet'
        returning id
      `);
      expect(agent.rows).toHaveLength(1);
      const agentId = agent.rows[0]!.id;

      const promoteToExecutionPending = async (depositIntentId: string): Promise<void> => {
        await client.query(`set local session_replication_role = 'replica'`);
        try {
          await client.query(
            `update app.deposit_intents
                set status = 'execution_pending',
                    status_changed_at = clock_timestamp()
              where id = $1::uuid`,
            [depositIntentId],
          );
        } finally {
          await client.query(`set local session_replication_role = 'origin'`);
        }
      };

      const leaseJob = async (jobId: string): Promise<void> => {
        await client.query(
          `update app.deposit_jobs
              set status = 'leased',
                  attempt_count = attempt_count + 1,
                  lease_token = gen_random_uuid(),
                  leased_by = 'dormant_sql_test',
                  lease_expires_at = clock_timestamp() + interval '5 minutes'
            where id = $1::uuid`,
          [jobId],
        );
      };

      const succeedJob = async (jobId: string): Promise<void> => {
        await client.query(
          `update app.deposit_jobs
              set status = 'succeeded',
                  lease_token = null,
                  leased_by = null,
                  lease_expires_at = null,
                  last_error_code = null
            where id = $1::uuid`,
          [jobId],
        );
      };

      const first = await createExecutionIntentFixture('DORMANT-EXECUTION-CONFIRMED');
      await promoteToExecutionPending(first.depositIntentId);

      await expectSqlFailureInTransaction(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'execute_deposit', $2::text, 2)`,
        [first.depositIntentId, `sql:execute-invalid:${first.depositIntentId}`],
        /one-shot and require max_attempts = 1/u,
      );

      const executionJob = await client.query<{ readonly id: string }>(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'execute_deposit', $2::text, 1)
         returning id`,
        [first.depositIntentId, `sql:execute:${first.depositIntentId}`],
      );
      const executionJobId = executionJob.rows[0]!.id;
      await leaseJob(executionJobId);

      await expectSqlFailureInTransaction(
        `update app.deposit_jobs
            set status = 'retry_wait',
                run_after = clock_timestamp() + interval '1 minute',
                lease_token = null,
                leased_by = null,
                lease_expires_at = null,
                last_error_code = 'retry_requested'
          where id = $1::uuid`,
        [executionJobId],
        /retry_wait is not authorized/u,
      );

      await expectSqlFailureInTransaction(
        `update app.deposit_intents
            set status = 'execution_in_progress'
          where id = $1::uuid`,
        [first.depositIntentId],
        /durable final-action fence/u,
      );

      const executionAttempt = await client.query<{ readonly id: string }>(
        `insert into app.deposit_execution_attempts (
           deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
         ) values ($1::uuid, $2::uuid, $3::uuid, 1)
         returning id`,
        [first.depositIntentId, executionJobId, agentId],
      );
      const executionAttemptId = executionAttempt.rows[0]!.id;

      await expectSqlFailureInTransaction(
        `update app.deposit_execution_attempts
            set id = gen_random_uuid()
          where id = $1::uuid`,
        [executionAttemptId],
        /identity is immutable/u,
      );

      await client.query(
        `update app.deposit_execution_attempts
            set status = 'final_action_fenced'
          where id = $1::uuid`,
        [executionAttemptId],
      );
      await client.query(
        `update app.deposit_intents
            set status = 'execution_in_progress'
          where id = $1::uuid`,
        [first.depositIntentId],
      );

      await expectSqlFailureInTransaction(
        `update app.deposit_intents
            set status = 'executed'
          where id = $1::uuid`,
        [first.depositIntentId],
        /must be reconciled before execution or review/u,
      );

      await client.query(
        `update app.deposit_execution_attempts
            set status = 'reconciliation_required',
                exact_player_credit_match = true
          where id = $1::uuid`,
        [executionAttemptId],
      );
      await client.query(
        `update app.deposit_intents
            set status = 'execution_uncertain'
          where id = $1::uuid`,
        [first.depositIntentId],
      );
      await succeedJob(executionJobId);

      const firstReconciliationJob = await client.query<{ readonly id: string }>(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'reconcile_execution', $2::text, 4)
         returning id`,
        [first.depositIntentId, `sql:reconcile:1:${first.depositIntentId}`],
      );
      const firstReconciliationJobId = firstReconciliationJob.rows[0]!.id;

      await expectSqlFailureInTransaction(
        `update app.deposit_jobs
            set status = 'leased',
                attempt_count = attempt_count + 1,
                lease_token = gen_random_uuid(),
                leased_by = 'dormant_sql_test',
                lease_expires_at = clock_timestamp() + interval '5 minutes'
          where id = $1::uuid`,
        [firstReconciliationJobId],
        /may be leased only while the intent is reconciling/u,
      );

      await expectSqlFailureInTransaction(
        `insert into app.execution_reconciliations (
           deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
           deposit_job_id, reconciliation_number, outcome, reason_code
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
           'not_observed', 'agent_history_not_observed'
         )`,
        [executionAttemptId, first.depositIntentId, agentId, firstReconciliationJobId],
        /only while the intent is reconciling/u,
      );

      await expectSqlFailureInTransaction(
        `update app.deposit_execution_attempts
            set status = 'confirmed_executed'
          where id = $1::uuid`,
        [executionAttemptId],
        /only while its intent is reconciling/u,
      );

      await client.query(
        `update app.deposit_intents
            set status = 'execution_reconciliation'
          where id = $1::uuid`,
        [first.depositIntentId],
      );
      await leaseJob(firstReconciliationJobId);

      const validFingerprint = `hmac-sha256-v1:${'a'.repeat(64)}`;
      const executionWindow = await client.query<{
        readonly after_execution_window: string;
        readonly before_execution_window: string;
        readonly final_action_fenced_at: string;
        readonly middle_execution_window: string;
        readonly reconciliation_required_at: string;
      }>(
        `select final_action_fenced_at::text,
                reconciliation_required_at::text,
                (
                  final_action_fenced_at
                  + (reconciliation_required_at - final_action_fenced_at) / 2
                )::text as middle_execution_window,
                (final_action_fenced_at - interval '1 microsecond')::text
                  as before_execution_window,
                (reconciliation_required_at + interval '1 microsecond')::text
                  as after_execution_window
           from app.deposit_execution_attempts
          where id = $1::uuid`,
        [executionAttemptId],
      );
      expect(executionWindow.rows).toHaveLength(1);
      const executionWindowStart = executionWindow.rows[0]!.final_action_fenced_at;
      const executionWindowEnd = executionWindow.rows[0]!.reconciliation_required_at;
      const executionWindowMiddle = executionWindow.rows[0]!.middle_execution_window;
      const beforeExecutionWindow = executionWindow.rows[0]!.before_execution_window;
      const afterExecutionWindow = executionWindow.rows[0]!.after_execution_window;
      const confirmedInsert = `insert into app.execution_reconciliations (
         deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
         deposit_job_id, reconciliation_number, outcome, reason_code,
         keyed_external_reference_fingerprint, approved_history_match_count,
         normalized_operation_type, matched_history_occurred_at,
         exact_player_match, exact_amount_match, exact_currency_match,
         exact_player_credit_match
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
         'confirmed_executed',
         'agent_deposit_history_in_window_and_player_credit_confirmed',
         $5::text, $6::smallint, $7::text, $8::timestamptz,
         $9::boolean, $10::boolean, $11::boolean, $12::boolean
       )`;
      const confirmedIdentifiers = [
        executionAttemptId,
        first.depositIntentId,
        agentId,
        firstReconciliationJobId,
      ] as const;

      await expectSqlFailureInTransaction(
        confirmedInsert,
        [...confirmedIdentifiers, null, null, null, null, null, null, null, null],
        /server-authored execution window/u,
      );

      const individuallyMissingEvidence: readonly (readonly (
        boolean | number | string | null
      )[])[] = [
        [null, 1, 'deposit', executionWindowMiddle, true, true, true, true],
        [validFingerprint, null, 'deposit', executionWindowMiddle, true, true, true, true],
        [validFingerprint, 1, null, executionWindowMiddle, true, true, true, true],
        [validFingerprint, 1, 'deposit', null, true, true, true, true],
        [validFingerprint, 1, 'deposit', executionWindowMiddle, null, true, true, true],
        [validFingerprint, 1, 'deposit', executionWindowMiddle, true, null, true, true],
        [validFingerprint, 1, 'deposit', executionWindowMiddle, true, true, null, true],
        [validFingerprint, 1, 'deposit', executionWindowMiddle, true, true, true, null],
      ];
      for (const [index, evidence] of individuallyMissingEvidence.entries()) {
        await expectSqlFailureInTransaction(
          confirmedInsert,
          [...confirmedIdentifiers, ...evidence],
          index === 3
            ? /server-authored execution window/u
            : /execution_reconciliations_evidence_shape_check/u,
        );
      }

      for (const normalizedOperationType of ['non_deposit', 'unknown']) {
        await expectSqlFailureInTransaction(
          confirmedInsert,
          [
            ...confirmedIdentifiers,
            validFingerprint,
            1,
            normalizedOperationType,
            executionWindowMiddle,
            true,
            true,
            true,
            true,
          ],
          /execution_reconciliations_evidence_shape_check/u,
        );
      }

      for (const matchedHistoryOccurredAt of [beforeExecutionWindow, afterExecutionWindow]) {
        await expectSqlFailureInTransaction(
          confirmedInsert,
          [
            ...confirmedIdentifiers,
            validFingerprint,
            1,
            'deposit',
            matchedHistoryOccurredAt,
            true,
            true,
            true,
            true,
          ],
          /server-authored execution window/u,
        );
      }

      for (let falsePredicate = 0; falsePredicate < 4; falsePredicate += 1) {
        const evidence: (boolean | number | string)[] = [
          validFingerprint,
          1,
          'deposit',
          executionWindowMiddle,
          true,
          true,
          true,
          true,
        ];
        evidence[falsePredicate + 4] = false;
        await expectSqlFailureInTransaction(
          confirmedInsert,
          [...confirmedIdentifiers, ...evidence],
          /execution_reconciliations_evidence_shape_check/u,
        );
      }
      await expectSqlFailureInTransaction(
        confirmedInsert,
        [
          ...confirmedIdentifiers,
          validFingerprint,
          2,
          'deposit',
          executionWindowMiddle,
          true,
          true,
          true,
          true,
        ],
        /execution_reconciliations_evidence_shape_check/u,
      );

      for (const inclusiveBoundary of [executionWindowStart, executionWindowEnd]) {
        await client.query('savepoint confirmed_execution_window_boundary');
        await client.query(confirmedInsert, [
          ...confirmedIdentifiers,
          validFingerprint,
          1,
          'deposit',
          inclusiveBoundary,
          true,
          true,
          true,
          true,
        ]);
        await client.query('rollback to savepoint confirmed_execution_window_boundary');
        await client.query('release savepoint confirmed_execution_window_boundary');
      }

      await expectSqlFailureInTransaction(
        `insert into app.execution_reconciliations (
           deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
           deposit_job_id, reconciliation_number, outcome, reason_code,
           normalized_operation_type, matched_history_occurred_at
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
           'not_observed', 'agent_history_not_observed', 'deposit', $5::timestamptz
         )`,
        [
          executionAttemptId,
          first.depositIntentId,
          agentId,
          firstReconciliationJobId,
          executionWindowMiddle,
        ],
        /execution_reconciliations_evidence_shape_check/u,
      );

      await client.query(
        `insert into app.execution_reconciliations (
           deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
           deposit_job_id, reconciliation_number, outcome, reason_code
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
           'not_observed', 'agent_history_not_observed'
         )`,
        [executionAttemptId, first.depositIntentId, agentId, firstReconciliationJobId],
      );
      await succeedJob(firstReconciliationJobId);

      await expectSqlFailureInTransaction(
        `update app.deposit_execution_attempts
            set status = 'confirmed_executed'
          where id = $1::uuid`,
        [executionAttemptId],
        /matching completed reconciliation/u,
      );
      await expectSqlFailureInTransaction(
        `update app.deposit_intents
            set status = 'execution_pending'
          where id = $1::uuid`,
        [first.depositIntentId],
        /retry is not authorized after reconciliation/u,
      );
      await expectSqlFailureInTransaction(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'execute_deposit', $2::text, 1)`,
        [first.depositIntentId, `sql:execute-retry:${first.depositIntentId}`],
        /retry is not authorized/u,
      );

      const secondReconciliationJob = await client.query<{ readonly id: string }>(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'reconcile_execution', $2::text, 4)
         returning id`,
        [first.depositIntentId, `sql:reconcile:2:${first.depositIntentId}`],
      );
      const secondReconciliationJobId = secondReconciliationJob.rows[0]!.id;
      await leaseJob(secondReconciliationJobId);
      await client.query(
        `insert into app.execution_reconciliations (
           deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
           deposit_job_id, reconciliation_number, outcome, reason_code,
           keyed_external_reference_fingerprint, approved_history_match_count,
           normalized_operation_type, matched_history_occurred_at,
           exact_player_match, exact_amount_match, exact_currency_match,
           exact_player_credit_match
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 2,
           'confirmed_executed',
           'agent_deposit_history_in_window_and_player_credit_confirmed',
           $5::text, 1, 'deposit', $6::timestamptz, true, true, true, true
         )`,
        [
          executionAttemptId,
          first.depositIntentId,
          agentId,
          secondReconciliationJobId,
          validFingerprint,
          executionWindowMiddle,
        ],
      );
      await succeedJob(secondReconciliationJobId);
      await client.query(
        `update app.deposit_execution_attempts
            set status = 'confirmed_executed'
          where id = $1::uuid`,
        [executionAttemptId],
      );
      await client.query(
        `update app.deposit_intents
            set status = 'executed'
          where id = $1::uuid`,
        [first.depositIntentId],
      );

      await expectSqlFailureInTransaction(
        `update app.execution_reconciliations
            set reason_code = 'agent_history_ambiguous'
          where deposit_execution_attempt_id = $1::uuid
            and reconciliation_number = 2`,
        [executionAttemptId],
        /must be retained/u,
      );

      const ambiguous = await createExecutionIntentFixture('DORMANT-EXECUTION-AMBIGUOUS');
      await promoteToExecutionPending(ambiguous.depositIntentId);
      const ambiguousExecutionJob = await client.query<{ readonly id: string }>(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'execute_deposit', $2::text, 1)
         returning id`,
        [ambiguous.depositIntentId, `sql:execute:${ambiguous.depositIntentId}`],
      );
      const ambiguousExecutionJobId = ambiguousExecutionJob.rows[0]!.id;
      await leaseJob(ambiguousExecutionJobId);
      const ambiguousAttempt = await client.query<{ readonly id: string }>(
        `insert into app.deposit_execution_attempts (
           deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
         ) values ($1::uuid, $2::uuid, $3::uuid, 1)
         returning id`,
        [ambiguous.depositIntentId, ambiguousExecutionJobId, agentId],
      );
      const ambiguousAttemptId = ambiguousAttempt.rows[0]!.id;
      await client.query(
        `update app.deposit_execution_attempts
            set status = 'final_action_fenced'
          where id = $1::uuid`,
        [ambiguousAttemptId],
      );
      await client.query(
        `update app.deposit_intents set status = 'execution_in_progress'
          where id = $1::uuid`,
        [ambiguous.depositIntentId],
      );
      await client.query(
        `update app.deposit_execution_attempts
            set status = 'reconciliation_required',
                exact_player_credit_match = false
          where id = $1::uuid`,
        [ambiguousAttemptId],
      );
      await client.query(
        `update app.deposit_intents set status = 'execution_uncertain'
          where id = $1::uuid`,
        [ambiguous.depositIntentId],
      );
      await succeedJob(ambiguousExecutionJobId);
      const ambiguousReconciliationJob = await client.query<{ readonly id: string }>(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'reconcile_execution', $2::text, 4)
         returning id`,
        [ambiguous.depositIntentId, `sql:reconcile:1:${ambiguous.depositIntentId}`],
      );
      const ambiguousReconciliationJobId = ambiguousReconciliationJob.rows[0]!.id;
      await client.query(
        `update app.deposit_intents set status = 'execution_reconciliation'
          where id = $1::uuid`,
        [ambiguous.depositIntentId],
      );
      await leaseJob(ambiguousReconciliationJobId);
      await expectSqlFailureInTransaction(
        `insert into app.execution_reconciliations (
           deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
           deposit_job_id, reconciliation_number, outcome, reason_code,
           normalized_operation_type, matched_history_occurred_at
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
           'ambiguous', 'agent_history_ambiguous', 'deposit', clock_timestamp()
         )`,
        [ambiguousAttemptId, ambiguous.depositIntentId, agentId, ambiguousReconciliationJobId],
        /execution_reconciliations_evidence_shape_check/u,
      );
      await client.query(
        `insert into app.execution_reconciliations (
           deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
           deposit_job_id, reconciliation_number, outcome, reason_code
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
           'ambiguous', 'agent_history_ambiguous'
         )`,
        [ambiguousAttemptId, ambiguous.depositIntentId, agentId, ambiguousReconciliationJobId],
      );
      await succeedJob(ambiguousReconciliationJobId);
      await client.query(
        `update app.deposit_execution_attempts set status = 'review_required'
          where id = $1::uuid`,
        [ambiguousAttemptId],
      );
      await client.query(
        `update app.deposit_intents set status = 'execution_review'
          where id = $1::uuid`,
        [ambiguous.depositIntentId],
      );

      await expectSqlFailureInTransaction(
        `update app.deposit_intents
            set status = 'rejected',
                rejection_reason_code = 'execution_rejected'
          where id = $1::uuid`,
        [ambiguous.depositIntentId],
        /cannot be rejected from review/u,
      );

      const blocked = await createExecutionIntentFixture('DORMANT-EXECUTION-AGENT-BLOCKED');
      await promoteToExecutionPending(blocked.depositIntentId);
      const blockedJob = await client.query<{ readonly id: string }>(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'execute_deposit', $2::text, 1)
         returning id`,
        [blocked.depositIntentId, `sql:execute:${blocked.depositIntentId}`],
      );
      const blockedJobId = blockedJob.rows[0]!.id;
      await leaseJob(blockedJobId);
      await expectSqlFailureInTransaction(
        `insert into app.deposit_execution_attempts (
           deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
         ) values ($1::uuid, $2::uuid, $3::uuid, 1)`,
        [blocked.depositIntentId, blockedJobId, agentId],
        /deposit_execution_attempts_one_blocking_agent_idx/u,
      );

      const finalState = await client.query<{
        readonly ambiguous_attempt_status: string;
        readonly ambiguous_intent_status: string;
        readonly confirmed_attempt_status: string;
        readonly confirmed_intent_status: string;
        readonly first_outcome: string;
        readonly second_outcome: string;
      }>(
        `select
           (select status::text from app.deposit_execution_attempts where id = $1::uuid)
             as confirmed_attempt_status,
           (select status::text from app.deposit_intents where id = $2::uuid)
             as confirmed_intent_status,
           (select outcome::text from app.execution_reconciliations
             where deposit_execution_attempt_id = $1::uuid and reconciliation_number = 1)
             as first_outcome,
           (select outcome::text from app.execution_reconciliations
             where deposit_execution_attempt_id = $1::uuid and reconciliation_number = 2)
             as second_outcome,
           (select status::text from app.deposit_execution_attempts where id = $3::uuid)
             as ambiguous_attempt_status,
           (select status::text from app.deposit_intents where id = $4::uuid)
             as ambiguous_intent_status`,
        [executionAttemptId, first.depositIntentId, ambiguousAttemptId, ambiguous.depositIntentId],
      );
      expect(finalState.rows).toEqual([
        {
          ambiguous_attempt_status: 'review_required',
          ambiguous_intent_status: 'execution_review',
          confirmed_attempt_status: 'confirmed_executed',
          confirmed_intent_status: 'executed',
          first_outcome: 'not_observed',
          second_outcome: 'confirmed_executed',
        },
      ]);
    } finally {
      await client.query('rollback');
    }
  });

  it('serializes concurrent execution attempts on one agent account', async () => {
    const agent = await client.query<{ readonly id: string }>(`
      insert into app.platform_agent_accounts (
        platform_id, label, credential_ref
      )
      select platform.id, 'concurrent-sql-execution-agent', 'secret://concurrent-sql-agent'
        from app.platforms platform
       where platform.code = 'kemerbet'
      returning id
    `);
    expect(agent.rows).toHaveLength(1);
    const agentId = agent.rows[0]!.id;

    const first = await createExecutionIntentFixture('DORMANT-EXECUTION-RACE-A');
    const second = await createExecutionIntentFixture('DORMANT-EXECUTION-RACE-B');
    await client.query('begin');
    try {
      await client.query(`set local session_replication_role = 'replica'`);
      await client.query(
        `update app.deposit_intents
            set status = 'execution_pending',
                status_changed_at = clock_timestamp()
          where id in ($1::uuid, $2::uuid)`,
        [first.depositIntentId, second.depositIntentId],
      );
      await client.query(`set local session_replication_role = 'origin'`);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    const insertLeasedJob = async (depositIntentId: string): Promise<string> => {
      const job = await client.query<{ readonly id: string }>(
        `insert into app.deposit_jobs (
           deposit_intent_id, job_kind, job_key, max_attempts
         ) values ($1::uuid, 'execute_deposit', $2::text, 1)
         returning id`,
        [depositIntentId, `sql:concurrent-execute:${depositIntentId}`],
      );
      const jobId = job.rows[0]!.id;
      await client.query(
        `update app.deposit_jobs
            set status = 'leased',
                attempt_count = 1,
                lease_token = gen_random_uuid(),
                leased_by = 'dormant_concurrency_test',
                lease_expires_at = clock_timestamp() + interval '5 minutes'
          where id = $1::uuid`,
        [jobId],
      );
      return jobId;
    };

    const firstJobId = await insertLeasedJob(first.depositIntentId);
    const secondJobId = await insertLeasedJob(second.depositIntentId);
    const firstConnection = createSqlIntegrationClient(environment);
    const secondConnection = createSqlIntegrationClient(environment);
    let firstCommitted = false;
    let secondRolledBack = false;
    let secondAttempt: Promise<unknown> | undefined;
    let firstAttemptId: string | undefined;
    await Promise.all([firstConnection.connect(), secondConnection.connect()]);
    try {
      await Promise.all([firstConnection.query('begin'), secondConnection.query('begin')]);
      await firstConnection.query(`set local lock_timeout = '5s'`);
      await secondConnection.query(`set local lock_timeout = '5s'`);
      await secondConnection.query(`set local application_name = 'execution_agent_lane_race'`);

      const firstAttempt = await firstConnection.query<{ readonly id: string }>(
        `insert into app.deposit_execution_attempts (
           deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
         ) values ($1::uuid, $2::uuid, $3::uuid, 1)
         returning id`,
        [first.depositIntentId, firstJobId, agentId],
      );
      firstAttemptId = firstAttempt.rows[0]!.id;

      secondAttempt = secondConnection.query(
        `insert into app.deposit_execution_attempts (
           deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
         ) values ($1::uuid, $2::uuid, $3::uuid, 1)`,
        [second.depositIntentId, secondJobId, agentId],
      );

      let observedAgentLaneWait = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const lockState = await client.query<{ readonly waiting: boolean }>(`
          select exists (
            select 1
              from pg_stat_activity activity
             where activity.application_name = 'execution_agent_lane_race'
               and activity.wait_event_type = 'Lock'
          ) as waiting
        `);
        if (lockState.rows[0]!.waiting) {
          observedAgentLaneWait = true;
          break;
        }
        await client.query('select pg_sleep(0.025)');
      }
      expect(observedAgentLaneWait).toBe(true);

      await firstConnection.query('commit');
      firstCommitted = true;
      await expect(secondAttempt).rejects.toThrow(
        /deposit_execution_attempts_one_blocking_agent_idx/u,
      );
      secondAttempt = undefined;
      await secondConnection.query('rollback');
      secondRolledBack = true;
    } finally {
      if (!firstCommitted) {
        await Promise.allSettled([firstConnection.query('rollback')]);
      }
      if (secondAttempt) {
        await Promise.allSettled([secondAttempt]);
      }
      if (!secondRolledBack) {
        await Promise.allSettled([secondConnection.query('rollback')]);
      }
      await Promise.allSettled([firstConnection.end(), secondConnection.end()]);
    }

    expect(firstAttemptId).toEqual(expect.any(String));
    await client.query(
      `update app.deposit_execution_attempts
          set status = 'cancelled_before_action'
        where id = $1::uuid`,
      [firstAttemptId!],
    );
    await client.query(
      `update app.deposit_jobs
          set status = 'cancelled',
              lease_token = null,
              leased_by = null,
              lease_expires_at = null,
              last_error_code = 'cancelled_before_action'
        where id = $1::uuid`,
      [firstJobId],
    );
    await client.query(
      `update app.deposit_jobs
          set status = 'cancelled',
              lease_token = null,
              leased_by = null,
              lease_expires_at = null,
              last_error_code = 'agent_lane_unavailable'
        where id = $1::uuid`,
      [secondJobId],
    );

    const blockingRows = await client.query<{ readonly blocking_attempts: number }>(
      `select count(*)::integer as blocking_attempts
         from app.deposit_execution_attempts
        where platform_agent_account_id = $1::uuid
          and status in (
            'prepared',
            'final_action_fenced',
            'reconciliation_required',
            'review_required'
          )`,
      [agentId],
    );
    expect(blockingRows.rows).toEqual([{ blocking_attempts: 0 }]);
  });
});

registerDepositExecutionCommandSqlTests(() => client);
registerLiveCustomerDepositIntakeSqlTests(() => client);
registerLiveDepositExecutionLineageSqlTests(() => client);
registerVerificationSettlementSqlTests(
  () => client,
  () => createSqlIntegrationClient(environment),
);
