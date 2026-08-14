import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';

import {
  createSqlIntegrationClient,
  readSqlIntegrationEnvironment,
  type SqlIntegrationEnvironment,
} from './environment.js';
import { applyMigrationsLexically, listMigrationsLexically } from './migration-runner.js';
import { applySyntheticSupabaseBootstrap } from './synthetic-bootstrap.js';

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

let environment: SqlIntegrationEnvironment;
let client: ReturnType<typeof createSqlIntegrationClient>;
let appliedMigrationNames: readonly string[];
const ownerAuthUserId = '11111111-1111-4111-8111-111111111111';
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

  it('gives the dedicated Player-ID runtime exactly eight non-executing procedures', async () => {
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
      'app.expire_telegram_player_registration_action(uuid,text)',
      'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
      'app.open_telegram_dry_run_deposit_intent(uuid,text,bigint,text)',
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
});
