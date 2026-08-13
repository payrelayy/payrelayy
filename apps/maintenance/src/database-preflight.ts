import type { NonceRetentionMaintenanceRuntimeConfig } from '@fetanagent/config/maintenance';
import { Pool } from 'pg';

const NONCE_RETENTION_GROUP_ROLE = 'fetanagent_nonce_retention';
const NONCE_RETENTION_RUNTIME_LOGIN_ROLE = 'fetanagent_nonce_retention_runtime';
const NONCE_PURGE_FUNCTION =
  'app.purge_expired_telegram_private_ingress_nonce_reservations(integer)';
const NONCE_RESERVATION_FUNCTION = 'app.reserve_telegram_private_ingress_nonce(text,timestamptz)';

const NONCE_RETENTION_DATABASE_PREFLIGHT_SQL = `
  select
    current_user = '${NONCE_RETENTION_RUNTIME_LOGIN_ROLE}'
      and session_user = '${NONCE_RETENTION_RUNTIME_LOGIN_ROLE}'
      as runtime_login_identity_allowed,
    current_user = session_user
      and current_user not in (
        'postgres',
        'service_role',
        'anon',
        'authenticated',
        'fetanagent_api',
        'fetanagent_api_runtime',
        'fetanagent_worker',
        '${NONCE_RETENTION_GROUP_ROLE}'
      )
      and exists (
        select 1
        from pg_catalog.pg_roles as runtime_role
        where runtime_role.rolname = current_user
          and runtime_role.rolcanlogin
          and not runtime_role.rolsuper
          and not runtime_role.rolcreatedb
          and not runtime_role.rolcreaterole
          and not runtime_role.rolreplication
          and not runtime_role.rolbypassrls
          and not runtime_role.rolinherit
          and runtime_role.rolconnlimit = 1
      ) as runtime_login_is_safe,
    exists (
      select 1
      from pg_catalog.pg_roles as group_role
      where group_role.rolname = '${NONCE_RETENTION_GROUP_ROLE}'
        and not group_role.rolcanlogin
        and not group_role.rolinherit
        and not group_role.rolsuper
        and not group_role.rolcreatedb
        and not group_role.rolcreaterole
        and not group_role.rolreplication
        and not group_role.rolbypassrls
        and group_role.rolconnlimit = 1
    ) as nonce_retention_group_shape_allowed,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as group_member on group_member.oid = membership.member
      where group_member.rolname = '${NONCE_RETENTION_GROUP_ROLE}'
    ) as nonce_retention_group_has_no_parent_roles,
    (
      select count(*) = 2
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where granted_role.rolname = '${NONCE_RETENTION_GROUP_ROLE}'
        and member_role.rolname in ('${NONCE_RETENTION_RUNTIME_LOGIN_ROLE}', 'postgres')
    )
    and not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where granted_role.rolname = '${NONCE_RETENTION_GROUP_ROLE}'
        and member_role.rolname not in ('${NONCE_RETENTION_RUNTIME_LOGIN_ROLE}', 'postgres')
    ) as nonce_retention_group_members_allowed,
    (
      select count(*) = 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where granted_role.rolname = '${NONCE_RETENTION_RUNTIME_LOGIN_ROLE}'
        and member_role.rolname = 'postgres'
    )
    and not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      where granted_role.rolname = '${NONCE_RETENTION_RUNTIME_LOGIN_ROLE}'
        and member_role.rolname <> 'postgres'
    ) as nonce_retention_runtime_members_allowed,
    exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as group_role on group_role.oid = membership.roleid
      join pg_catalog.pg_roles as runtime_role on runtime_role.oid = membership.member
      where runtime_role.rolname = current_user
        and group_role.rolname = '${NONCE_RETENTION_GROUP_ROLE}'
        and membership.inherit_option
        and not membership.set_option
        and not membership.admin_option
    ) as nonce_retention_role_membership_shape_allowed,
    pg_catalog.pg_has_role(current_user, '${NONCE_RETENTION_GROUP_ROLE}', 'USAGE')
      as nonce_retention_role_usage_allowed,
    not pg_catalog.pg_has_role(current_user, '${NONCE_RETENTION_GROUP_ROLE}', 'SET')
      as nonce_retention_role_set_denied,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as runtime_role on runtime_role.oid = membership.member
      where runtime_role.rolname = current_user
        and granted_role.rolname <> '${NONCE_RETENTION_GROUP_ROLE}'
    ) as no_other_direct_role_memberships,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      as app_schema_usage_allowed,
    not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      as app_schema_create_denied,
    not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT')
          or pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT')
          or pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE')
          or pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE')
          or pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE')
          or pg_catalog.has_table_privilege(current_user, relation.oid, 'REFERENCES')
          or pg_catalog.has_table_privilege(current_user, relation.oid, 'TRIGGER')
          or exists (
            select 1
            from pg_catalog.pg_attribute as attribute
            where attribute.attrelid = relation.oid
              and attribute.attnum > 0
              and not attribute.attisdropped
              and (
                pg_catalog.has_column_privilege(current_user, relation.oid, attribute.attnum, 'SELECT')
                or pg_catalog.has_column_privilege(current_user, relation.oid, attribute.attnum, 'INSERT')
                or pg_catalog.has_column_privilege(current_user, relation.oid, attribute.attnum, 'UPDATE')
                or pg_catalog.has_column_privilege(current_user, relation.oid, attribute.attnum, 'REFERENCES')
              )
          )
        )
    ) as app_relation_access_denied,
    not exists (
      select 1
      from pg_catalog.pg_class as sequence
      join pg_catalog.pg_namespace as namespace on namespace.oid = sequence.relnamespace
      where namespace.nspname = 'app'
        and sequence.relkind = 'S'
        and (
          pg_catalog.has_sequence_privilege(current_user, sequence.oid, 'USAGE')
          or pg_catalog.has_sequence_privilege(current_user, sequence.oid, 'SELECT')
          or pg_catalog.has_sequence_privilege(current_user, sequence.oid, 'UPDATE')
        )
    ) as app_sequence_access_denied,
    pg_catalog.has_function_privilege(
      current_user,
      '${NONCE_PURGE_FUNCTION}',
      'EXECUTE'
    ) as nonce_purge_execute_allowed,
    pg_catalog.has_function_privilege(
      '${NONCE_RETENTION_GROUP_ROLE}',
      '${NONCE_PURGE_FUNCTION}',
      'EXECUTE'
    ) as nonce_retention_group_purge_execute_allowed,
    not exists (
      select 1
      from unnest(array[
        'anon',
        'authenticated',
        'service_role',
        'fetanagent_api',
        'fetanagent_api_runtime',
        'fetanagent_worker'
      ]) as broad_role(role_name)
      where pg_catalog.has_function_privilege(
        broad_role.role_name,
        '${NONCE_PURGE_FUNCTION}',
        'EXECUTE'
      )
    )
    and not exists (
      select 1
      from pg_catalog.pg_proc as routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) as privilege
      where routine.oid = '${NONCE_PURGE_FUNCTION}'::regprocedure
        and privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) as nonce_purge_execution_is_private,
    exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      join pg_catalog.pg_roles as routine_owner on routine_owner.oid = routine.proowner
      where routine.oid = '${NONCE_PURGE_FUNCTION}'::regprocedure
        and namespace.nspname = 'app'
        and routine_owner.rolname = 'postgres'
        and routine.prosecdef
        and routine.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
    ) as nonce_purge_function_security_shape_allowed,
    not pg_catalog.has_function_privilege(
      current_user,
      '${NONCE_RESERVATION_FUNCTION}',
      'EXECUTE'
    ) as nonce_reservation_execute_denied,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      join pg_catalog.pg_roles as runtime_role on runtime_role.rolname = current_user
      cross join lateral pg_catalog.aclexplode(routine.proacl) as privilege
      where namespace.nspname = 'app'
        and privilege.grantee = runtime_role.oid
    ) as runtime_has_no_direct_app_function_grants,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and routine.oid <> '${NONCE_PURGE_FUNCTION}'::regprocedure
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
    ) as only_nonce_purge_app_function_executable,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) as privilege
      where namespace.nspname = 'app'
        and privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) as public_app_function_execution_denied,
    exists (
      select 1
      from pg_catalog.pg_default_acl as default_acl
      join pg_catalog.pg_roles as owner on owner.oid = default_acl.defaclrole
      where owner.rolname = 'postgres'
        and default_acl.defaclnamespace = 0
        and default_acl.defaclobjtype = 'f'
        and not exists (
          select 1
          from pg_catalog.aclexplode(default_acl.defaclacl) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
    ) as default_public_function_execution_denied
`;

interface NonceRetentionDatabasePreflightRow {
  readonly runtime_login_identity_allowed: boolean;
  readonly runtime_login_is_safe: boolean;
  readonly nonce_retention_group_shape_allowed: boolean;
  readonly nonce_retention_group_has_no_parent_roles: boolean;
  readonly nonce_retention_group_members_allowed: boolean;
  readonly nonce_retention_runtime_members_allowed: boolean;
  readonly nonce_retention_role_membership_shape_allowed: boolean;
  readonly nonce_retention_role_usage_allowed: boolean;
  readonly nonce_retention_role_set_denied: boolean;
  readonly no_other_direct_role_memberships: boolean;
  readonly app_schema_usage_allowed: boolean;
  readonly app_schema_create_denied: boolean;
  readonly app_relation_access_denied: boolean;
  readonly app_sequence_access_denied: boolean;
  readonly nonce_purge_execute_allowed: boolean;
  readonly nonce_retention_group_purge_execute_allowed: boolean;
  readonly nonce_purge_execution_is_private: boolean;
  readonly nonce_purge_function_security_shape_allowed: boolean;
  readonly nonce_reservation_execute_denied: boolean;
  readonly runtime_has_no_direct_app_function_grants: boolean;
  readonly only_nonce_purge_app_function_executable: boolean;
  readonly public_app_function_execution_denied: boolean;
  readonly default_public_function_execution_denied: boolean;
}

export interface NonceRetentionDatabasePreflightResult {
  readonly passed: boolean;
  readonly runtimeLoginIdentityAllowed: boolean;
  readonly runtimeLoginIsSafe: boolean;
  readonly nonceRetentionGroupShapeAllowed: boolean;
  readonly nonceRetentionGroupHasNoParentRoles: boolean;
  readonly nonceRetentionGroupMembersAllowed: boolean;
  readonly nonceRetentionRuntimeMembersAllowed: boolean;
  readonly nonceRetentionRoleMembershipShapeAllowed: boolean;
  readonly nonceRetentionRoleUsageAllowed: boolean;
  readonly nonceRetentionRoleSetDenied: boolean;
  readonly noOtherDirectRoleMemberships: boolean;
  readonly appSchemaUsageAllowed: boolean;
  readonly appSchemaCreateDenied: boolean;
  readonly appRelationAccessDenied: boolean;
  readonly appSequenceAccessDenied: boolean;
  readonly noncePurgeExecuteAllowed: boolean;
  readonly nonceRetentionGroupPurgeExecuteAllowed: boolean;
  readonly noncePurgeExecutionIsPrivate: boolean;
  readonly noncePurgeFunctionSecurityShapeAllowed: boolean;
  readonly nonceReservationExecuteDenied: boolean;
  readonly runtimeHasNoDirectAppFunctionGrants: boolean;
  readonly onlyNoncePurgeAppFunctionExecutable: boolean;
  readonly publicAppFunctionExecutionDenied: boolean;
  readonly defaultPublicFunctionExecutionDenied: boolean;
}

export interface NonceRetentionDatabasePreflightClient {
  query(query: string): Promise<{ readonly rows: readonly unknown[] }>;
  release(): void;
}

export interface NonceRetentionDatabasePreflightPool {
  connect(): Promise<NonceRetentionDatabasePreflightClient>;
  end(): Promise<void>;
}

export interface NonceRetentionDatabasePreflightDependencies {
  readonly pool?: NonceRetentionDatabasePreflightPool;
}

function asBoolean(
  row: NonceRetentionDatabasePreflightRow,
  name: keyof NonceRetentionDatabasePreflightRow,
): boolean {
  const value = row[name];
  if (typeof value !== 'boolean') {
    throw new Error('The nonce-retention database preflight returned an invalid result.');
  }
  return value;
}

function toPreflightResult(
  row: NonceRetentionDatabasePreflightRow,
): NonceRetentionDatabasePreflightResult {
  const checks = {
    runtimeLoginIdentityAllowed: asBoolean(row, 'runtime_login_identity_allowed'),
    runtimeLoginIsSafe: asBoolean(row, 'runtime_login_is_safe'),
    nonceRetentionGroupShapeAllowed: asBoolean(row, 'nonce_retention_group_shape_allowed'),
    nonceRetentionGroupHasNoParentRoles: asBoolean(
      row,
      'nonce_retention_group_has_no_parent_roles',
    ),
    nonceRetentionGroupMembersAllowed: asBoolean(row, 'nonce_retention_group_members_allowed'),
    nonceRetentionRuntimeMembersAllowed: asBoolean(row, 'nonce_retention_runtime_members_allowed'),
    nonceRetentionRoleMembershipShapeAllowed: asBoolean(
      row,
      'nonce_retention_role_membership_shape_allowed',
    ),
    nonceRetentionRoleUsageAllowed: asBoolean(row, 'nonce_retention_role_usage_allowed'),
    nonceRetentionRoleSetDenied: asBoolean(row, 'nonce_retention_role_set_denied'),
    noOtherDirectRoleMemberships: asBoolean(row, 'no_other_direct_role_memberships'),
    appSchemaUsageAllowed: asBoolean(row, 'app_schema_usage_allowed'),
    appSchemaCreateDenied: asBoolean(row, 'app_schema_create_denied'),
    appRelationAccessDenied: asBoolean(row, 'app_relation_access_denied'),
    appSequenceAccessDenied: asBoolean(row, 'app_sequence_access_denied'),
    noncePurgeExecuteAllowed: asBoolean(row, 'nonce_purge_execute_allowed'),
    nonceRetentionGroupPurgeExecuteAllowed: asBoolean(
      row,
      'nonce_retention_group_purge_execute_allowed',
    ),
    noncePurgeExecutionIsPrivate: asBoolean(row, 'nonce_purge_execution_is_private'),
    noncePurgeFunctionSecurityShapeAllowed: asBoolean(
      row,
      'nonce_purge_function_security_shape_allowed',
    ),
    nonceReservationExecuteDenied: asBoolean(row, 'nonce_reservation_execute_denied'),
    runtimeHasNoDirectAppFunctionGrants: asBoolean(
      row,
      'runtime_has_no_direct_app_function_grants',
    ),
    onlyNoncePurgeAppFunctionExecutable: asBoolean(row, 'only_nonce_purge_app_function_executable'),
    publicAppFunctionExecutionDenied: asBoolean(row, 'public_app_function_execution_denied'),
    defaultPublicFunctionExecutionDenied: asBoolean(
      row,
      'default_public_function_execution_denied',
    ),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    ...checks,
  };
}

export function createNonceRetentionDatabasePreflightPool(
  config: Extract<NonceRetentionMaintenanceRuntimeConfig, { readonly enabled: true }>,
): NonceRetentionDatabasePreflightPool {
  return new Pool({
    application_name: 'fetanagent-nonce-retention-preflight',
    database: config.connection.database,
    connectionTimeoutMillis: 5_000,
    host: config.connection.host,
    idleTimeoutMillis: 5_000,
    max: 1,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    ssl: { rejectUnauthorized: true },
    user: config.connection.user,
  });
}

/**
 * Performs catalog-only capability checks in a read-only transaction and always rolls it back.
 * It intentionally never invokes the nonce-purge helper or any other application procedure.
 */
export async function runNonceRetentionDatabasePreflight(
  config: Extract<NonceRetentionMaintenanceRuntimeConfig, { readonly enabled: true }>,
  dependencies: NonceRetentionDatabasePreflightDependencies = {},
): Promise<NonceRetentionDatabasePreflightResult> {
  const pool = dependencies.pool ?? createNonceRetentionDatabasePreflightPool(config);

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

      const queryResult = await client.query(NONCE_RETENTION_DATABASE_PREFLIGHT_SQL);
      if (queryResult.rows.length !== 1) {
        throw new Error('The nonce-retention database preflight returned an invalid result.');
      }
      const row = queryResult.rows[0] as NonceRetentionDatabasePreflightRow | undefined;
      if (row === undefined) {
        throw new Error('The nonce-retention database preflight returned an invalid result.');
      }

      return toPreflightResult(row);
    } finally {
      if (transactionStarted) {
        try {
          await client.query('rollback');
        } catch {
          // The CLI exposes only a generic failure, never database details.
        }
      }
      client.release();
    }
  } finally {
    await pool.end();
  }
}
