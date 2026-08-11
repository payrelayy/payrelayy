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
    | 'payreplayy_api'
    | 'payreplayy_beta_admission'
    | 'payreplayy_owner_control'
    | 'payreplayy_player_actions',
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
      'payreplayy_api',
      'payreplayy_api_runtime',
      'payreplayy_beta_admission',
      'payreplayy_beta_admission_runtime',
      'payreplayy_nonce_retention',
      'payreplayy_nonce_retention_runtime',
      'payreplayy_owner_control',
      'payreplayy_owner_control_runtime',
      'payreplayy_player_actions',
      'payreplayy_player_actions_runtime',
      'payreplayy_worker',
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
        group_role: 'payreplayy_api',
        inherit_option: true,
        member_role: 'payreplayy_api_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'payreplayy_beta_admission',
        inherit_option: true,
        member_role: 'payreplayy_beta_admission_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'payreplayy_nonce_retention',
        inherit_option: true,
        member_role: 'payreplayy_nonce_retention_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'payreplayy_owner_control',
        inherit_option: true,
        member_role: 'payreplayy_owner_control_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'payreplayy_player_actions',
        inherit_option: true,
        member_role: 'payreplayy_player_actions_runtime',
        set_option: false,
      },
    ]);
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
          'payreplayy_api_runtime',
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

  it('gives the dedicated Player-ID runtime exactly six non-financial procedures', async () => {
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
        has_function_privilege('payreplayy_player_actions', procedure.oid, 'EXECUTE')
          as group_allowed,
        has_function_privilege('payreplayy_player_actions_runtime', procedure.oid, 'EXECUTE')
          as runtime_effective,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
          where privilege.grantee = 'payreplayy_player_actions_runtime'::regrole
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
        and has_function_privilege('payreplayy_player_actions_runtime', procedure.oid, 'EXECUTE')
      order by signature
    `);
    expect(functions.rows.map((row) => row.signature)).toEqual([
      'app.expire_telegram_player_registration_action(uuid,text)',
      'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
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
        'payreplayy_player_actions',
        `select app.reserve_telegram_private_action_nonce($1::text, clock_timestamp() + interval '2 minutes') as reserved`,
        [digest],
      ),
    ).resolves.toEqual([{ reserved: true }]);
    await expect(
      queryAsRole<NonceReservationRow>(
        'payreplayy_player_actions',
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
        'payreplayy_beta_admission',
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
      'payreplayy_player_actions',
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
      'payreplayy_player_actions',
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
        has_function_privilege('payreplayy_beta_admission', procedure.oid, 'EXECUTE')
          as beta_admission_execute_allowed,
        has_function_privilege('payreplayy_beta_admission_runtime', procedure.oid, 'EXECUTE')
          as beta_admission_runtime_effective_execute_allowed,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 'payreplayy_beta_admission_runtime'::regrole
            and privilege.privilege_type = 'EXECUTE'
        ) as beta_admission_runtime_direct_execute_allowed,
        has_function_privilege('payreplayy_api', procedure.oid, 'EXECUTE')
          as generic_api_execute_allowed,
        has_function_privilege('payreplayy_api_runtime', procedure.oid, 'EXECUTE')
          as generic_api_runtime_execute_allowed,
        has_function_privilege('payreplayy_worker', procedure.oid, 'EXECUTE')
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
        'payreplayy_api',
        'payreplayy_api_runtime',
        'payreplayy_beta_admission',
        'payreplayy_beta_admission_runtime',
        'payreplayy_worker'
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
          'payreplayy_api',
          '${legacyPrivateInboundRecorder}'::regprocedure,
          'EXECUTE'
        ) as api_execute_allowed,
        has_function_privilege(
          'payreplayy_api_runtime',
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
        has_function_privilege('payreplayy_beta_admission', procedure.oid, 'EXECUTE')
          as beta_admission_execute_allowed,
        has_function_privilege('payreplayy_beta_admission_runtime', procedure.oid, 'EXECUTE')
          as beta_admission_runtime_effective_execute_allowed,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 'payreplayy_beta_admission_runtime'::regrole
            and privilege.privilege_type = 'EXECUTE'
        ) as beta_admission_runtime_direct_execute_allowed,
        has_function_privilege('payreplayy_api', procedure.oid, 'EXECUTE')
          as generic_api_execute_allowed,
        has_function_privilege('payreplayy_api_runtime', procedure.oid, 'EXECUTE')
          as generic_api_runtime_execute_allowed,
        has_function_privilege('payreplayy_worker', procedure.oid, 'EXECUTE')
          as worker_execute_allowed,
        has_function_privilege('payreplayy_nonce_retention', procedure.oid, 'EXECUTE')
          as nonce_retention_execute_allowed,
        has_function_privilege('payreplayy_nonce_retention_runtime', procedure.oid, 'EXECUTE')
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
        'payreplayy_api',
        'payreplayy_api_runtime',
        'payreplayy_beta_admission',
        'payreplayy_beta_admission_runtime',
        'payreplayy_nonce_retention',
        'payreplayy_nonce_retention_runtime',
        'payreplayy_worker'
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
        leftSession.query('set local role payreplayy_beta_admission'),
        rightSession.query('set local role payreplayy_beta_admission'),
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
      queryAsRole<NonceReservationRow>('payreplayy_api', reserveStatement, [nonceDigest('b')]),
    ).rejects.toThrow();
    expect(await readBetaAdmissionNonceReservationCount()).toBe(beforeReservation + 1);

    await expect(
      queryAsRole<NonceReservationRow>('payreplayy_beta_admission', reserveStatement, [
        nonceDigest('g'),
      ]),
    ).rejects.toThrow('The Telegram beta admission nonce digest is invalid.');
    await expect(
      queryAsRole<NonceReservationRow>('payreplayy_beta_admission', reserveStatement, [
        `sha256-v1:${nonceDigest('c')}`,
      ]),
    ).rejects.toThrow('The Telegram beta admission nonce digest is invalid.');
    await expect(
      queryAsRole<NonceReservationRow>(
        'payreplayy_beta_admission',
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
        'payreplayy_beta_admission',
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
        'payreplayy_beta_admission',
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
      'payreplayy_beta_admission',
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
        'payreplayy_api',
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
        'payreplayy_beta_admission',
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
        'payreplayy_beta_admission',
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
        leftSession.query('set local role payreplayy_beta_admission'),
        rightSession.query('set local role payreplayy_beta_admission'),
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
      where rolname in ('payreplayy_owner_control', 'payreplayy_owner_control_runtime')
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
        rolname: 'payreplayy_owner_control',
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
        rolname: 'payreplayy_owner_control_runtime',
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
      readonly player_list_allowed: boolean;
      readonly player_review_allowed: boolean;
      readonly revoke_allowed: boolean;
      readonly runtime_direct_execute_denied: boolean;
      readonly runtime_effective_issue_allowed: boolean;
    }>(`
      select
        has_function_privilege(
          'payreplayy_owner_control',
          'app.issue_telegram_beta_invite(uuid,text,timestamptz)',
          'execute'
        ) as issue_allowed,
        has_function_privilege(
          'payreplayy_owner_control',
          'app.revoke_telegram_beta_invite(uuid,uuid,text)',
          'execute'
        ) as revoke_allowed,
        has_function_privilege(
          'payreplayy_owner_control',
          'app.list_owner_player_registration_requests(uuid,integer)',
          'execute'
        ) as player_list_allowed,
        has_function_privilege(
          'payreplayy_owner_control',
          'app.review_owner_player_registration_request(uuid,uuid,text,text)',
          'execute'
        ) as player_review_allowed,
        has_function_privilege(
          'payreplayy_owner_control_runtime',
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
            'app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure
          )
            and exists (
              select 1
              from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
              where privilege.grantee = 'payreplayy_owner_control_runtime'::regrole
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
            'app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure
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
              ('payreplayy_api'), ('payreplayy_api_runtime'), ('payreplayy_worker'),
              ('payreplayy_beta_admission'), ('payreplayy_beta_admission_runtime'),
              ('payreplayy_nonce_retention'), ('payreplayy_nonce_retention_runtime')
          ) denied_role(role_name)
          cross join (
            values
              ('app.issue_telegram_beta_invite(uuid,text,timestamptz)'::regprocedure),
              ('app.revoke_telegram_beta_invite(uuid,uuid,text)'::regprocedure),
              ('app.list_owner_player_registration_requests(uuid,integer)'::regprocedure),
              ('app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure)
          ) owner_function(procedure_oid)
          where has_function_privilege(
            denied_role.role_name,
            owner_function.procedure_oid,
            'EXECUTE'
          )
        ) as broad_execution_denied,
        not has_function_privilege(
          'payreplayy_owner_control',
          'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)',
          'execute'
        ) as beta_execute_denied,
        not exists (
          select 1
          from (
            values
              ('app.telegram_beta_invites'),
              ('app.player_registration_requests'),
              ('app.player_registration_request_reviews')
          ) protected_table(table_name)
          where has_table_privilege(
            'payreplayy_owner_control',
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
      'payreplayy_owner_control',
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
      'payreplayy_owner_control',
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
        'payreplayy_owner_control',
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
      'payreplayy_owner_control',
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
      'payreplayy_owner_control',
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
      'payreplayy_owner_control',
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

    await expect(
      queryAsRole(
        'payreplayy_owner_control',
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
        'payreplayy_owner_control',
        `update app.player_registration_requests set status = 'cancelled' where id = $1::uuid`,
        [requestId],
      ),
    ).rejects.toThrow(/permission denied|row-level security/u);
  });
});
