import type { OwnerControlRuntimeConfig } from '@payreplayy/config/owner-control';
import { Pool, type PoolConfig } from 'pg';

import { PostgresOwnerInviteControl } from './owner-invites.js';
import { PostgresOwnerPlayerRegistrationReviews } from './owner-player-registration-reviews.js';

export interface OwnerControlPostgresRuntime {
  readonly invites: Pick<PostgresOwnerInviteControl, 'issue' | 'revoke'>;
  readonly playerRegistrations: Pick<PostgresOwnerPlayerRegistrationReviews, 'list' | 'review'>;
  close(): Promise<void>;
  ready(): Promise<boolean>;
}

export class OwnerControlPostgresRuntimeUnavailableError extends Error {
  constructor() {
    super('The Owner-control PostgreSQL runtime is unavailable.');
    this.name = 'OwnerControlPostgresRuntimeUnavailableError';
  }
}

export function ownerControlPoolConfig(
  config: Extract<OwnerControlRuntimeConfig, { readonly enabled: true }>,
): PoolConfig {
  if (config.tlsMode !== 'verify-full') {
    throw new OwnerControlPostgresRuntimeUnavailableError();
  }
  return {
    application_name: 'payreplayy-owner-control',
    database: config.connection.database,
    connectionTimeoutMillis: 5_000,
    host: config.connection.host,
    idleTimeoutMillis: 10_000,
    idle_in_transaction_session_timeout: 5_000,
    lock_timeout: 1_000,
    max: 1,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    query_timeout: 5_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
    user: config.connection.user,
  };
}

export const OWNER_CONTROL_PREFLIGHT_SQL = `
  select
    current_user = 'payreplayy_owner_control_runtime' as exact_runtime,
    session_user = 'payreplayy_owner_control_runtime' as exact_session,
    has_schema_privilege(current_user, 'app', 'usage') as app_usage,
    not has_schema_privilege(current_user, 'app', 'create') as app_create_denied,
    exists (
      select 1
      from pg_roles role
      where role.rolname = current_user
        and role.rolcanlogin
        and not role.rolinherit
        and not role.rolsuper
        and not role.rolcreatedb
        and not role.rolcreaterole
        and not role.rolreplication
        and not role.rolbypassrls
        and role.rolconnlimit = 1
    ) as runtime_role_is_narrow,
    (
      select count(*) = 1
      from pg_auth_members membership
      join pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = current_user
        and granted_role.rolname = 'payreplayy_owner_control'
        and membership.inherit_option
        and not membership.set_option
        and not membership.admin_option
    ) as exact_runtime_membership,
    not exists (
      select 1
      from pg_auth_members membership
      join pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = current_user
        and granted_role.rolname <> 'payreplayy_owner_control'
    ) as no_other_runtime_memberships,
    not exists (
      select 1
      from pg_auth_members membership
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = 'payreplayy_owner_control'
    ) as owner_group_has_no_parent_roles,
    not exists (
      select 1
      from pg_auth_members membership
      join pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_roles member_role on member_role.oid = membership.member
      where granted_role.rolname = 'payreplayy_owner_control'
        and member_role.rolname not in ('payreplayy_owner_control_runtime', 'postgres')
    ) as owner_group_members_are_private,
    has_function_privilege(current_user, 'app.issue_telegram_beta_invite(uuid,text,timestamptz)', 'execute') as issue_allowed,
    has_function_privilege(current_user, 'app.revoke_telegram_beta_invite(uuid,uuid,text)', 'execute') as revoke_allowed,
    has_function_privilege(current_user, 'app.list_owner_player_registration_requests(uuid,integer)', 'execute') as player_request_list_allowed,
    has_function_privilege(current_user, 'app.review_owner_player_registration_request(uuid,uuid,text,text)', 'execute') as player_request_review_allowed,
    not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        and has_table_privilege(current_user, relation.oid, 'select,insert,update,delete,truncate,references,trigger')
    ) as direct_table_access_denied,
    not has_function_privilege(current_user, 'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)', 'execute') as redemption_denied,
    not has_function_privilege(current_user, 'app.record_admitted_telegram_private_inbound_event(bigint,bigint,bigint,text,text)', 'execute') as recorder_denied,
    not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and has_function_privilege(current_user, procedure.oid, 'execute')
        and procedure.oid not in (
          'app.issue_telegram_beta_invite(uuid,text,timestamptz)'::regprocedure,
          'app.revoke_telegram_beta_invite(uuid,uuid,text)'::regprocedure,
          'app.list_owner_player_registration_requests(uuid,integer)'::regprocedure,
          'app.review_owner_player_registration_request(uuid,uuid,text,text)'::regprocedure
        )
    ) as all_other_app_functions_denied
`;

export async function createOwnerControlPostgresRuntime(
  config: Extract<OwnerControlRuntimeConfig, { readonly enabled: true }>,
): Promise<OwnerControlPostgresRuntime> {
  const pool = new Pool(ownerControlPoolConfig(config));
  let poolHealthy = true;
  pool.on('error', () => {
    poolHealthy = false;
  });
  try {
    const result = await pool.query<Record<string, boolean>>(OWNER_CONTROL_PREFLIGHT_SQL);
    const row = result.rows.length === 1 ? result.rows[0] : undefined;
    if (!row || Object.values(row).some((value) => value !== true)) {
      throw new Error('preflight failed');
    }
  } catch {
    await pool.end();
    throw new OwnerControlPostgresRuntimeUnavailableError();
  }

  let closed = false;
  return {
    invites: new PostgresOwnerInviteControl({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    playerRegistrations: new PostgresOwnerPlayerRegistrationReviews({
      query: async (sql, values) => pool.query(sql, [...values]),
    }),
    ready: async () => {
      if (closed) return false;
      try {
        const result = await pool.query<{ ready: boolean }>(
          "select current_user = 'payreplayy_owner_control_runtime' as ready",
        );
        const ready = result.rows.length === 1 && result.rows[0]?.ready === true;
        poolHealthy = ready;
        return poolHealthy;
      } catch {
        poolHealthy = false;
        return false;
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
