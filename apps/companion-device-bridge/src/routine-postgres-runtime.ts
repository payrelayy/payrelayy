import { createRequire } from 'node:module';

import type { CompanionRoutineDepositConnectionConfig } from './config.js';
import {
  CompanionDeviceStateUnavailableError,
  PostgresCompanionDeviceState,
  type CompanionDeviceStateDatabase,
} from './postgres-state.js';

const ROUTINE_FUNCTION =
  'app.execute_agent_platform_routine_deposit_command(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb)';

export const ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL = `
  select
    current_user = 'fetanagent_routine_deposit_broker_runtime'
      and session_user = current_user
      and exists (
        select 1 from pg_catalog.pg_roles runtime_role
         where runtime_role.rolname = current_user
           and runtime_role.rolcanlogin and not runtime_role.rolinherit
           and not runtime_role.rolsuper and not runtime_role.rolcreatedb
           and not runtime_role.rolcreaterole and not runtime_role.rolreplication
           and not runtime_role.rolbypassrls and runtime_role.rolconnlimit = 1
           and runtime_role.rolvaliduntil > pg_catalog.clock_timestamp()
      ) as exact_runtime,
    pg_catalog.pg_has_role(
      current_user, 'fetanagent_routine_deposit_broker', 'member'
    ) and (
      select pg_catalog.count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = 'fetanagent_routine_deposit_broker'
          and membership.inherit_option and not membership.set_option
          and not membership.admin_option
      )
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted on granted.oid = membership.roleid
        join pg_catalog.pg_roles member on member.oid = membership.member
       where member.rolname = current_user
    ) as capability_member,
    pg_catalog.has_function_privilege(current_user, '${ROUTINE_FUNCTION}', 'execute')
      and not exists (
        select 1 from pg_catalog.pg_proc routine
        join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
        where namespace.nspname not in ('pg_catalog', 'information_schema')
          and namespace.nspname !~ '^pg_(toast|temp)'
          and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'usage')
          and pg_catalog.has_function_privilege(current_user, routine.oid, 'execute')
          and routine.oid <> pg_catalog.to_regprocedure('${ROUTINE_FUNCTION}')
      ) as command_allowed,
    pg_catalog.has_schema_privilege(current_user, 'app', 'usage')
      and not pg_catalog.has_schema_privilege(current_user, 'app', 'create')
      and (
        select coalesce(
          pg_catalog.array_agg(namespace.nspname::text order by namespace.nspname),
          '{}'::text[]
        ) = array['app', 'public']::text[]
          from pg_catalog.pg_namespace namespace
         where namespace.nspname not in ('pg_catalog', 'information_schema')
           and namespace.nspname !~ '^pg_(toast|temp)'
           and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'usage')
      )
      and not exists (
        select 1 from pg_catalog.pg_namespace namespace
         where namespace.nspname not in ('pg_catalog', 'information_schema')
           and namespace.nspname !~ '^pg_(toast|temp)'
           and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'create')
      ) as schema_usage,
    not exists (
      select 1
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname not in ('pg_catalog', 'information_schema')
         and namespace.nspname !~ '^pg_(toast|temp)'
         and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'usage')
         and (
           (relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
             current_user, relation.oid, 'usage,select,update'
           )) or
           (relation.relkind in ('r','p','v','m','f') and (
             pg_catalog.has_table_privilege(
               current_user, relation.oid,
               'select,insert,update,delete,truncate,references,trigger,maintain'
             ) or pg_catalog.has_any_column_privilege(
               current_user, relation.oid, 'select,insert,update,references'
             )
           ))
         )
    ) as no_app_relation_privileges,
    exists (
      select 1
        from pg_catalog.pg_proc routine
        join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
        join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
       where routine.oid = pg_catalog.to_regprocedure('${ROUTINE_FUNCTION}')
         and namespace.nspname = 'app'
         and owner_role.rolname = 'postgres'
         and routine.prosecdef
         and routine.proconfig = array['search_path=pg_catalog']::text[]
    ) as command_hardened
`;

interface RoutinePool {
  query(sql: string, values?: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
  connect(): Promise<{ release(destroy?: boolean): void }>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): void;
  removeListener(event: 'error', listener: (error: Error) => void): void;
}

interface PgModule {
  readonly Pool: new (config: Readonly<Record<string, unknown>>) => RoutinePool;
}

export interface RoutineDepositPostgresRuntimeDependencies {
  readonly createPool?: (config: Readonly<Record<string, unknown>>) => RoutinePool;
}

export interface RoutineDepositPostgresRuntime {
  readonly state: PostgresCompanionDeviceState;
  readonly database: CompanionDeviceStateDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

function passed(row: unknown): boolean {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
  const value = row as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(',') ===
      [
        'capability_member',
        'command_allowed',
        'command_hardened',
        'exact_runtime',
        'no_app_relation_privileges',
        'schema_usage',
      ]
        .sort()
        .join(',') && Object.values(value).every((item) => item === true)
  );
}

export async function createRoutineDepositPostgresRuntime(
  connection: CompanionRoutineDepositConnectionConfig,
  signerKeyId: string,
  executionSignerKeyId: string,
  dependencies: RoutineDepositPostgresRuntimeDependencies = {},
): Promise<RoutineDepositPostgresRuntime> {
  const { ca, ...postgresConnection } = connection;
  const poolConfig = Object.freeze({
    ...postgresConnection,
    application_name: 'fetanagent_routine_deposit_broker',
    allowExitOnIdle: false,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 1,
    min: 0,
    query_timeout: 20_000,
    statement_timeout: 15_000,
    ssl: { ca, rejectUnauthorized: true },
  });
  const pool =
    dependencies.createPool?.(poolConfig) ??
    (() => {
      const require = createRequire(import.meta.url);
      const { Pool } = require('pg') as PgModule;
      return new Pool(poolConfig);
    })();
  let closed = false;
  const discardIdleClientError = () => undefined;
  pool.on('error', discardIdleClientError);

  async function preflight(): Promise<boolean> {
    if (closed) return false;
    try {
      const result = await pool.query(ROUTINE_DEPOSIT_POSTGRES_PREFLIGHT_SQL);
      return result.rows.length === 1 && passed(result.rows[0]) && !closed;
    } catch {
      return false;
    }
  }

  const guarded: CompanionDeviceStateDatabase = {
    async query(sql, values) {
      if (!(await preflight())) throw new CompanionDeviceStateUnavailableError();
      try {
        const result = await pool.query(sql, values);
        if (closed) throw new Error();
        return result;
      } catch {
        throw new CompanionDeviceStateUnavailableError();
      }
    },
  };

  try {
    const client = await pool.connect();
    client.release();
    if (!(await preflight())) throw new Error();
  } catch {
    await pool.end().catch(() => undefined);
    pool.removeListener('error', discardIdleClientError);
    throw new CompanionDeviceStateUnavailableError();
  }

  return Object.freeze({
    state: new PostgresCompanionDeviceState(guarded, signerKeyId, executionSignerKeyId),
    database: guarded,
    ready: preflight,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await pool.end();
      } catch {
        throw new CompanionDeviceStateUnavailableError();
      } finally {
        pool.removeListener('error', discardIdleClientError);
      }
    },
  });
}
