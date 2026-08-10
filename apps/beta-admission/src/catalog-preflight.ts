import type { BetaAdmissionRuntimeConfig } from '@payreplayy/config/beta-admission';
import { Pool } from 'pg';

const BETA_GROUP_ROLE = 'payreplayy_beta_admission';
const BETA_RUNTIME_ROLE = 'payreplayy_beta_admission_runtime';
const REDEMPTION_PROCEDURE = 'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)';
const BETA_NONCE_PROCEDURE = 'app.reserve_telegram_beta_invite_admission_nonce(text,timestamptz)';

/** One SELECT over PostgreSQL catalogs and privilege helpers; it contains no application rows. */
export const BETA_ADMISSION_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${BETA_RUNTIME_ROLE}'
      and session_user = current_user as runtime_login_identity_allowed,
    exists (
      select 1
      from pg_catalog.pg_roles as runtime_role
      where runtime_role.rolname = current_user
        and runtime_role.rolcanlogin
        and not runtime_role.rolinherit
        and not runtime_role.rolsuper
        and not runtime_role.rolcreatedb
        and not runtime_role.rolcreaterole
        and not runtime_role.rolreplication
        and not runtime_role.rolbypassrls
        and runtime_role.rolconnlimit = 1
    ) as runtime_login_is_safe,
    exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as group_role on group_role.oid = membership.roleid
      join pg_catalog.pg_roles as runtime_role on runtime_role.oid = membership.member
      where runtime_role.rolname = current_user
        and group_role.rolname = '${BETA_GROUP_ROLE}'
        and membership.inherit_option
        and not membership.set_option
        and not membership.admin_option
    ) as beta_role_membership_shape_allowed,
    pg_catalog.pg_has_role(current_user, '${BETA_GROUP_ROLE}', 'USAGE')
      as beta_role_usage_allowed,
    not pg_catalog.pg_has_role(current_user, '${BETA_GROUP_ROLE}', 'SET')
      as beta_role_set_denied,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where member_role.rolname = current_user
        and granted_role.rolname <> '${BETA_GROUP_ROLE}'
    ) as no_other_direct_role_memberships,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where member_role.rolname = '${BETA_GROUP_ROLE}'
    ) as beta_group_has_no_parent_roles,
    (
      select count(*) = 2
        and pg_catalog.bool_and(
          case member_role.rolname
            when '${BETA_RUNTIME_ROLE}' then
              membership.inherit_option
              and not membership.set_option
              and not membership.admin_option
            when 'postgres' then
              not membership.inherit_option
              and not membership.set_option
              and membership.admin_option
            else false
          end
        )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as group_role on group_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where group_role.rolname = '${BETA_GROUP_ROLE}'
    )
    and not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as group_role on group_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where group_role.rolname = '${BETA_GROUP_ROLE}'
        and member_role.rolname not in ('${BETA_RUNTIME_ROLE}', 'postgres')
    )
    and (
      select count(*) = 1
        and pg_catalog.bool_and(
          member_role.rolname = 'postgres'
          and not membership.inherit_option
          and not membership.set_option
          and membership.admin_option
        )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as runtime_role on runtime_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where runtime_role.rolname = '${BETA_RUNTIME_ROLE}'
    )
    and not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as runtime_role on runtime_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where runtime_role.rolname = '${BETA_RUNTIME_ROLE}'
        and member_role.rolname <> 'postgres'
    ) as beta_role_only_expected_members,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      as app_schema_usage_allowed,
    not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      as app_schema_create_denied,
    not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and (
          (relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
            current_user, relation.oid, 'USAGE,SELECT,UPDATE'
          ))
          or (relation.relkind in ('r', 'p', 'v', 'm', 'f') and (
            pg_catalog.has_table_privilege(
              current_user,
              relation.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            )
            or pg_catalog.has_any_column_privilege(current_user, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
          ))
        )
    ) as no_direct_base_object_access,
    not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
    and not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner_role on owner_role.oid = relation.relowner
      where namespace.nspname = 'app'
        and owner_role.rolname in (current_user, '${BETA_GROUP_ROLE}')
    )
    and not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      join pg_catalog.pg_roles as owner_role on owner_role.oid = routine.proowner
      where namespace.nspname = 'app'
        and owner_role.rolname in (current_user, '${BETA_GROUP_ROLE}')
    ) as no_app_object_ownership,
    pg_catalog.has_function_privilege(current_user, '${REDEMPTION_PROCEDURE}', 'EXECUTE')
      as redemption_execute_allowed,
    pg_catalog.has_function_privilege(current_user, '${BETA_NONCE_PROCEDURE}', 'EXECUTE')
      as nonce_reservation_execute_allowed,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.record_admitted_telegram_private_inbound_event(bigint,bigint,bigint,text,text)',
      'EXECUTE'
    ) as admitted_inbox_recorder_execute_denied,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.record_telegram_private_inbound_event(bigint,bigint,bigint,text,text,text,text,text)',
      'EXECUTE'
    ) as legacy_inbox_recorder_execute_denied,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.reserve_telegram_private_ingress_nonce(text,timestamptz)',
      'EXECUTE'
    ) as generic_nonce_reservation_execute_denied,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.purge_expired_telegram_beta_invite_admission_nonce_reservations(integer)',
      'EXECUTE'
    ) as beta_nonce_purge_execute_denied,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid not in (
          pg_catalog.to_regprocedure('${REDEMPTION_PROCEDURE}'),
          pg_catalog.to_regprocedure('${BETA_NONCE_PROCEDURE}')
        )
    ) as no_other_app_function_execute_allowed,
    (
      select count(*) = 2
        and pg_catalog.bool_and(
          routine.prosecdef
          and routine.prokind = 'f'
          and routine.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
        )
      from pg_catalog.pg_proc as routine
      where routine.oid in (
        pg_catalog.to_regprocedure('${REDEMPTION_PROCEDURE}'),
        pg_catalog.to_regprocedure('${BETA_NONCE_PROCEDURE}')
      )
    ) as allowed_procedures_security_definer_safe_path,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) as privilege
      where routine.oid in (
        pg_catalog.to_regprocedure('${REDEMPTION_PROCEDURE}'),
        pg_catalog.to_regprocedure('${BETA_NONCE_PROCEDURE}')
      )
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select role.oid from pg_catalog.pg_roles as role where role.rolname = '${BETA_GROUP_ROLE}')
        )
    ) as allowed_procedures_execution_is_private,
    (
      select count(*) = 2
        and pg_catalog.bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relname in (
          'telegram_beta_invites',
          'telegram_beta_invite_admission_nonce_reservations'
        )
    )
    and not exists (
      select 1
      from pg_catalog.pg_policy as policy
      join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relname in (
          'telegram_beta_invites',
          'telegram_beta_invite_admission_nonce_reservations'
        )
    ) as beta_boundary_tables_forced_rls_no_policies,
    exists (
      select 1
      from pg_catalog.pg_default_acl as defaults
      join pg_catalog.pg_roles as owner_role on owner_role.oid = defaults.defaclrole
      where owner_role.rolname = 'postgres'
        and defaults.defaclnamespace = 0
        and defaults.defaclobjtype = 'f'
        and not exists (
          select 1
          from pg_catalog.aclexplode(defaults.defaclacl) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
    ) as default_function_execution_is_private
`;

export interface BetaAdmissionPreflightRow {
  readonly runtime_login_identity_allowed: boolean;
  readonly runtime_login_is_safe: boolean;
  readonly beta_role_membership_shape_allowed: boolean;
  readonly beta_role_usage_allowed: boolean;
  readonly beta_role_set_denied: boolean;
  readonly no_other_direct_role_memberships: boolean;
  readonly beta_group_has_no_parent_roles: boolean;
  readonly beta_role_only_expected_members: boolean;
  readonly app_schema_usage_allowed: boolean;
  readonly app_schema_create_denied: boolean;
  readonly no_direct_base_object_access: boolean;
  readonly no_app_object_ownership: boolean;
  readonly redemption_execute_allowed: boolean;
  readonly nonce_reservation_execute_allowed: boolean;
  readonly admitted_inbox_recorder_execute_denied: boolean;
  readonly legacy_inbox_recorder_execute_denied: boolean;
  readonly generic_nonce_reservation_execute_denied: boolean;
  readonly beta_nonce_purge_execute_denied: boolean;
  readonly no_other_app_function_execute_allowed: boolean;
  readonly allowed_procedures_security_definer_safe_path: boolean;
  readonly allowed_procedures_execution_is_private: boolean;
  readonly beta_boundary_tables_forced_rls_no_policies: boolean;
  readonly default_function_execution_is_private: boolean;
}

export interface BetaAdmissionPreflightResult {
  readonly passed: boolean;
  readonly runtimeLoginIdentityAllowed: boolean;
  readonly runtimeLoginIsSafe: boolean;
  readonly betaRoleMembershipShapeAllowed: boolean;
  readonly betaRoleUsageAllowed: boolean;
  readonly betaRoleSetDenied: boolean;
  readonly noOtherDirectRoleMemberships: boolean;
  readonly betaGroupHasNoParentRoles: boolean;
  readonly betaRoleOnlyExpectedMembers: boolean;
  readonly appSchemaUsageAllowed: boolean;
  readonly appSchemaCreateDenied: boolean;
  readonly noDirectBaseObjectAccess: boolean;
  readonly noAppObjectOwnership: boolean;
  readonly redemptionExecuteAllowed: boolean;
  readonly nonceReservationExecuteAllowed: boolean;
  readonly admittedInboxRecorderExecuteDenied: boolean;
  readonly legacyInboxRecorderExecuteDenied: boolean;
  readonly genericNonceReservationExecuteDenied: boolean;
  readonly betaNoncePurgeExecuteDenied: boolean;
  readonly noOtherAppFunctionExecuteAllowed: boolean;
  readonly allowedProceduresSecurityDefinerSafePath: boolean;
  readonly allowedProceduresExecutionIsPrivate: boolean;
  readonly betaBoundaryTablesForcedRlsNoPolicies: boolean;
  readonly defaultFunctionExecutionIsPrivate: boolean;
}

export interface BetaAdmissionPreflightClient {
  query(query: string): Promise<{ readonly rows: readonly unknown[] }>;
  release(): void;
}

export interface BetaAdmissionPreflightPool {
  connect(): Promise<BetaAdmissionPreflightClient>;
  end(): Promise<void>;
}

export interface BetaAdmissionPreflightDependencies {
  readonly pool?: BetaAdmissionPreflightPool;
}

function asBoolean(row: Record<string, unknown>, field: keyof BetaAdmissionPreflightRow): boolean {
  const value = row[field];
  if (typeof value !== 'boolean') {
    throw new Error('The beta-admission catalog preflight returned an invalid result.');
  }
  return value;
}

/** Every missing, malformed, or false catalog capability fact fails closed. */
export function parseBetaAdmissionCatalogPreflightResult(
  row: unknown,
): BetaAdmissionPreflightResult {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('The beta-admission catalog preflight returned an invalid result.');
  }

  const catalogRow = row as Record<string, unknown>;
  const checks = {
    runtimeLoginIdentityAllowed: asBoolean(catalogRow, 'runtime_login_identity_allowed'),
    runtimeLoginIsSafe: asBoolean(catalogRow, 'runtime_login_is_safe'),
    betaRoleMembershipShapeAllowed: asBoolean(catalogRow, 'beta_role_membership_shape_allowed'),
    betaRoleUsageAllowed: asBoolean(catalogRow, 'beta_role_usage_allowed'),
    betaRoleSetDenied: asBoolean(catalogRow, 'beta_role_set_denied'),
    noOtherDirectRoleMemberships: asBoolean(catalogRow, 'no_other_direct_role_memberships'),
    betaGroupHasNoParentRoles: asBoolean(catalogRow, 'beta_group_has_no_parent_roles'),
    betaRoleOnlyExpectedMembers: asBoolean(catalogRow, 'beta_role_only_expected_members'),
    appSchemaUsageAllowed: asBoolean(catalogRow, 'app_schema_usage_allowed'),
    appSchemaCreateDenied: asBoolean(catalogRow, 'app_schema_create_denied'),
    noDirectBaseObjectAccess: asBoolean(catalogRow, 'no_direct_base_object_access'),
    noAppObjectOwnership: asBoolean(catalogRow, 'no_app_object_ownership'),
    redemptionExecuteAllowed: asBoolean(catalogRow, 'redemption_execute_allowed'),
    nonceReservationExecuteAllowed: asBoolean(catalogRow, 'nonce_reservation_execute_allowed'),
    admittedInboxRecorderExecuteDenied: asBoolean(
      catalogRow,
      'admitted_inbox_recorder_execute_denied',
    ),
    legacyInboxRecorderExecuteDenied: asBoolean(catalogRow, 'legacy_inbox_recorder_execute_denied'),
    genericNonceReservationExecuteDenied: asBoolean(
      catalogRow,
      'generic_nonce_reservation_execute_denied',
    ),
    betaNoncePurgeExecuteDenied: asBoolean(catalogRow, 'beta_nonce_purge_execute_denied'),
    noOtherAppFunctionExecuteAllowed: asBoolean(
      catalogRow,
      'no_other_app_function_execute_allowed',
    ),
    allowedProceduresSecurityDefinerSafePath: asBoolean(
      catalogRow,
      'allowed_procedures_security_definer_safe_path',
    ),
    allowedProceduresExecutionIsPrivate: asBoolean(
      catalogRow,
      'allowed_procedures_execution_is_private',
    ),
    betaBoundaryTablesForcedRlsNoPolicies: asBoolean(
      catalogRow,
      'beta_boundary_tables_forced_rls_no_policies',
    ),
    defaultFunctionExecutionIsPrivate: asBoolean(
      catalogRow,
      'default_function_execution_is_private',
    ),
  };

  return { passed: Object.values(checks).every(Boolean), ...checks };
}

export function createBetaAdmissionPreflightPool(
  config: Extract<BetaAdmissionRuntimeConfig, { readonly enabled: true }>,
): BetaAdmissionPreflightPool {
  return new Pool({
    application_name: 'payreplayy-beta-admission-preflight',
    database: config.connection.database,
    connectionTimeoutMillis: 5_000,
    host: config.connection.host,
    idleTimeoutMillis: 10_000,
    max: 1,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    query_timeout: 5_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
    lock_timeout: 1_000,
    idle_in_transaction_session_timeout: 5_000,
    user: config.connection.user,
  });
}

/** Runs only catalog checks inside an always-rolled-back read-only transaction. */
export async function runBetaAdmissionCatalogPreflight(
  config: Extract<BetaAdmissionRuntimeConfig, { readonly enabled: true }>,
  dependencies: BetaAdmissionPreflightDependencies = {},
): Promise<BetaAdmissionPreflightResult> {
  const pool = dependencies.pool ?? createBetaAdmissionPreflightPool(config);
  const ownsPool = dependencies.pool === undefined;

  try {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('begin transaction read only');
      transactionStarted = true;
      await client.query("set local statement_timeout = '5s'");
      await client.query("set local lock_timeout = '1s'");
      await client.query("set local idle_in_transaction_session_timeout = '5s'");
      await client.query('set local search_path = pg_catalog');
      const result = await client.query(BETA_ADMISSION_CATALOG_PREFLIGHT_SQL);
      if (result.rows.length !== 1) {
        throw new Error('The beta-admission catalog preflight returned an invalid result.');
      }
      return parseBetaAdmissionCatalogPreflightResult(result.rows[0]);
    } finally {
      if (transactionStarted) {
        try {
          await client.query('rollback');
        } catch {
          // Callers receive only the generic preflight failure.
        }
      }
      client.release();
    }
  } finally {
    if (ownsPool) await pool.end();
  }
}
