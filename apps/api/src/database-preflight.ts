import type { ApiPostgresRuntimeConfig } from '@payreplayy/config/api';
import { Pool } from 'pg';

const API_RUNTIME_GROUP_ROLE = 'payreplayy_api';
const API_RUNTIME_LOGIN_ROLE = 'payreplayy_api_runtime';

const API_DATABASE_PREFLIGHT_SQL = `
  select
    current_user = '${API_RUNTIME_LOGIN_ROLE}' as runtime_login_identity_allowed,
    current_user = session_user
      and current_user not in (
        'postgres',
        'service_role',
        'anon',
        'authenticated',
        'payreplayy_api',
        'payreplayy_worker'
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
      ) as runtime_login_is_safe,
    exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as group_role on group_role.oid = membership.roleid
      join pg_catalog.pg_roles as runtime_role on runtime_role.oid = membership.member
      where runtime_role.rolname = current_user
        and group_role.rolname = '${API_RUNTIME_GROUP_ROLE}'
        and membership.inherit_option
        and not membership.set_option
        and not membership.admin_option
    ) as api_role_membership_shape_allowed,
    pg_catalog.pg_has_role(current_user, '${API_RUNTIME_GROUP_ROLE}', 'USAGE')
      as api_role_usage_allowed,
    not pg_catalog.pg_has_role(current_user, '${API_RUNTIME_GROUP_ROLE}', 'SET')
      as api_role_set_denied,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as runtime_role on runtime_role.oid = membership.member
      where runtime_role.rolname = current_user
        and granted_role.rolname <> '${API_RUNTIME_GROUP_ROLE}'
    ) as no_other_direct_role_memberships,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      as app_schema_usage_allowed,
    not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      as app_schema_create_denied,
    pg_catalog.has_function_privilege(
      current_user,
      'app.record_telegram_private_inbound_event(bigint,bigint,bigint,text,text,text,text,text)',
      'EXECUTE'
    ) as inbox_recorder_execute_allowed,
    not exists (
      select 1
      from (
        values
          ('app.customers'::text),
          ('app.customer_identities'::text),
          ('app.telegram_identities'::text),
          ('app.inbound_events'::text),
          ('app.bot_conversations'::text),
          ('app.audit_events'::text)
      ) as protected_table(table_name)
      cross join (
        values
          ('SELECT'::text),
          ('INSERT'::text),
          ('UPDATE'::text),
          ('DELETE'::text),
          ('TRUNCATE'::text),
          ('REFERENCES'::text),
          ('TRIGGER'::text)
      ) as table_privilege(privilege)
      where pg_catalog.has_table_privilege(
        current_user,
        protected_table.table_name,
        table_privilege.privilege
      )
    ) as private_telegram_boundary_table_access_denied,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
      'EXECUTE'
    ) as issue_player_registration_capability_denied,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.start_telegram_player_registration_action(uuid,uuid,text,text)',
      'EXECUTE'
    ) as start_player_registration_action_denied,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.submit_telegram_player_registration_input(uuid,text,text)',
      'EXECUTE'
    ) as submit_player_registration_input_denied,
    not pg_catalog.has_function_privilege(
      current_user,
      'app.expire_telegram_player_registration_action(uuid,text)',
      'EXECUTE'
    ) as expire_player_registration_action_denied
`;

interface ApiDatabasePreflightRow {
  readonly runtime_login_identity_allowed: boolean;
  readonly runtime_login_is_safe: boolean;
  readonly api_role_membership_shape_allowed: boolean;
  readonly api_role_usage_allowed: boolean;
  readonly api_role_set_denied: boolean;
  readonly no_other_direct_role_memberships: boolean;
  readonly app_schema_usage_allowed: boolean;
  readonly app_schema_create_denied: boolean;
  readonly inbox_recorder_execute_allowed: boolean;
  readonly private_telegram_boundary_table_access_denied: boolean;
  readonly issue_player_registration_capability_denied: boolean;
  readonly start_player_registration_action_denied: boolean;
  readonly submit_player_registration_input_denied: boolean;
  readonly expire_player_registration_action_denied: boolean;
}

export interface ApiDatabasePreflightResult {
  readonly passed: boolean;
  readonly runtimeLoginIdentityAllowed: boolean;
  readonly runtimeLoginIsSafe: boolean;
  readonly apiRoleMembershipShapeAllowed: boolean;
  readonly apiRoleUsageAllowed: boolean;
  readonly apiRoleSetDenied: boolean;
  readonly noOtherDirectRoleMemberships: boolean;
  readonly appSchemaUsageAllowed: boolean;
  readonly appSchemaCreateDenied: boolean;
  readonly inboxRecorderExecuteAllowed: boolean;
  readonly privateTelegramBoundaryTableAccessDenied: boolean;
  readonly issuePlayerRegistrationCapabilityDenied: boolean;
  readonly startPlayerRegistrationActionDenied: boolean;
  readonly submitPlayerRegistrationInputDenied: boolean;
  readonly expirePlayerRegistrationActionDenied: boolean;
}

export interface ApiDatabasePreflightClient {
  query(query: string): Promise<{ readonly rows: readonly unknown[] }>;
  release(): void;
}

export interface ApiDatabasePreflightPool {
  connect(): Promise<ApiDatabasePreflightClient>;
  end(): Promise<void>;
}

export interface ApiDatabasePreflightDependencies {
  readonly pool?: ApiDatabasePreflightPool;
}

function asBoolean(row: ApiDatabasePreflightRow, name: keyof ApiDatabasePreflightRow): boolean {
  const value = row[name];
  if (typeof value !== 'boolean') {
    throw new Error('The database preflight returned an invalid result.');
  }
  return value;
}

function toPreflightResult(row: ApiDatabasePreflightRow): ApiDatabasePreflightResult {
  const checks = {
    runtimeLoginIdentityAllowed: asBoolean(row, 'runtime_login_identity_allowed'),
    runtimeLoginIsSafe: asBoolean(row, 'runtime_login_is_safe'),
    apiRoleMembershipShapeAllowed: asBoolean(row, 'api_role_membership_shape_allowed'),
    apiRoleUsageAllowed: asBoolean(row, 'api_role_usage_allowed'),
    apiRoleSetDenied: asBoolean(row, 'api_role_set_denied'),
    noOtherDirectRoleMemberships: asBoolean(row, 'no_other_direct_role_memberships'),
    appSchemaUsageAllowed: asBoolean(row, 'app_schema_usage_allowed'),
    appSchemaCreateDenied: asBoolean(row, 'app_schema_create_denied'),
    inboxRecorderExecuteAllowed: asBoolean(row, 'inbox_recorder_execute_allowed'),
    privateTelegramBoundaryTableAccessDenied: asBoolean(
      row,
      'private_telegram_boundary_table_access_denied',
    ),
    issuePlayerRegistrationCapabilityDenied: asBoolean(
      row,
      'issue_player_registration_capability_denied',
    ),
    startPlayerRegistrationActionDenied: asBoolean(row, 'start_player_registration_action_denied'),
    submitPlayerRegistrationInputDenied: asBoolean(row, 'submit_player_registration_input_denied'),
    expirePlayerRegistrationActionDenied: asBoolean(
      row,
      'expire_player_registration_action_denied',
    ),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    ...checks,
  };
}

export function createApiDatabasePreflightPool(
  config: Extract<ApiPostgresRuntimeConfig, { readonly enabled: true }>,
): ApiDatabasePreflightPool {
  return new Pool({
    application_name: 'payreplayy-api-preflight',
    database: config.connection.database,
    connectionTimeoutMillis: 5_000,
    host: config.connection.host,
    idleTimeoutMillis: 10_000,
    max: 2,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    ssl: { rejectUnauthorized: true },
    user: config.connection.user,
  });
}

/**
 * Performs only PostgreSQL catalog capability checks in a read-only transaction and always
 * rolls it back. This function is intentionally disconnected from Fastify and Telegram.
 */
export async function runApiDatabasePreflight(
  config: Extract<ApiPostgresRuntimeConfig, { readonly enabled: true }>,
  dependencies: ApiDatabasePreflightDependencies = {},
): Promise<ApiDatabasePreflightResult> {
  const pool = dependencies.pool ?? createApiDatabasePreflightPool(config);

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

      const queryResult = await client.query(API_DATABASE_PREFLIGHT_SQL);
      const row = queryResult.rows[0] as ApiDatabasePreflightRow | undefined;
      if (!row) {
        throw new Error('The database preflight returned no result.');
      }

      return toPreflightResult(row);
    } finally {
      if (transactionStarted) {
        try {
          await client.query('rollback');
        } catch {
          // The preflight caller receives only a generic failure; never surface database details.
        }
      }
      client.release();
    }
  } finally {
    await pool.end();
  }
}
