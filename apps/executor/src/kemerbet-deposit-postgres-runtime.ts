import { createRequire } from 'node:module';

import type {
  ExecutorConfig,
  KemerBetPrivateLiveDepositPilotManifest,
} from '@fetanagent/config/executor';

import {
  PostgresKemerBetDepositExecutionDatabase,
  type KemerBetDepositPostgresQuery,
} from './postgres-kemerbet-deposit-database.js';

type EnabledExecutionRuntimeConfig = Extract<
  ExecutorConfig['kemerBet']['executionRuntime'],
  { readonly enabled: true }
>;

const EXECUTOR_GROUP_ROLE = 'fetanagent_deposit_executor';
const EXECUTOR_RUNTIME_ROLE = 'fetanagent_deposit_executor_runtime';
const PRIVATE_PILOT_FUNCTIONS = [
  'app.lease_next_private_live_deposit_execution(uuid,integer)',
  'app.fence_private_live_deposit_execution_final_action(uuid,uuid,uuid,uuid,uuid)',
] as const;
const RECOVERY_FUNCTIONS = [
  'app.cancel_deposit_execution_before_action(uuid,uuid,text)',
  'app.require_deposit_execution_reconciliation(uuid,uuid,boolean)',
  'app.lease_next_deposit_execution_reconciliation(uuid,integer)',
  'app.record_deposit_execution_reconciliation(uuid,uuid,text,text,smallint,text,timestamptz,boolean,boolean,boolean,boolean)',
] as const;
const ALLOWED_FUNCTIONS = [...PRIVATE_PILOT_FUNCTIONS, ...RECOVERY_FUNCTIONS] as const;
const procedureSql = (signatures: readonly string[]) =>
  signatures.map((signature) => `pg_catalog.to_regprocedure('${signature}')`).join(',\n        ');
const ALLOWED_FUNCTION_SQL = ALLOWED_FUNCTIONS.map(
  (signature) => `pg_catalog.to_regprocedure('${signature}')`,
).join(',\n        ');
const PRIVATE_PILOT_FUNCTION_SQL = procedureSql(PRIVATE_PILOT_FUNCTIONS);
const RECOVERY_FUNCTION_SQL = procedureSql(RECOVERY_FUNCTIONS);
const EXPECTED_PREFLIGHT_KEYS = [
  'runtime_login_identity_allowed',
  'runtime_login_is_safe',
  'only_expected_direct_membership',
  'runtime_has_no_members',
  'group_role_is_safe',
  'group_usage_allowed_set_denied',
  'group_only_expected_members',
  'group_has_no_upstream_membership',
  'app_schema_boundary_allowed',
  'no_app_base_object_access',
  'exact_function_surface_allowed',
  'allowed_functions_hardened',
  'allowed_functions_execution_private',
  'default_function_execution_private',
] as const;

const EXECUTOR_SINGLETON_LOCK_KEYS = [20_260_816, 10_001] as const;

export const KEMERBET_EXECUTOR_SINGLETON_ACQUIRE_SQL = `
  select pg_catalog.pg_try_advisory_lock($1::integer, $2::integer)
    as singleton_acquired
`;

export const KEMERBET_EXECUTOR_SINGLETON_HELD_SQL = `
  select exists (
    select 1
    from pg_catalog.pg_locks as advisory_lock
    where advisory_lock.locktype = 'advisory'
      and advisory_lock.pid = pg_catalog.pg_backend_pid()
      and advisory_lock.database = (
        select database_catalog.oid
        from pg_catalog.pg_database as database_catalog
        where database_catalog.datname = pg_catalog.current_database()
      )
      and advisory_lock.classid = ($1::integer)::oid
      and advisory_lock.objid = ($2::integer)::oid
      and advisory_lock.objsubid = 2
      and advisory_lock.granted
  ) as singleton_held
`;

export const KEMERBET_EXECUTOR_SINGLETON_RELEASE_SQL = `
  select pg_catalog.pg_advisory_unlock($1::integer, $2::integer)
    as singleton_released
`;

/** Catalog-only and row-data-free. Every named boolean must be exactly true at startup. */
export const KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL = `
  select
    current_user = '${EXECUTOR_RUNTIME_ROLE}' and session_user = current_user
      as runtime_login_identity_allowed,
    exists (
      select 1 from pg_catalog.pg_roles as role
      where role.rolname = current_user
        and role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 1
    ) as runtime_login_is_safe,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = '${EXECUTOR_GROUP_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where member.rolname = current_user
    ) as only_expected_direct_membership,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      where granted.rolname = '${EXECUTOR_RUNTIME_ROLE}'
    ) as runtime_has_no_members,
    exists (
      select 1 from pg_catalog.pg_roles as role
      where role.rolname = '${EXECUTOR_GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${EXECUTOR_GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${EXECUTOR_GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        member.rolname = '${EXECUTOR_RUNTIME_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where granted.rolname = '${EXECUTOR_GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where member.rolname = '${EXECUTOR_GROUP_ROLE}'
    ) as group_has_no_upstream_membership,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      and not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      as app_schema_boundary_allowed,
    not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app' and (
        (relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
          current_user, relation.oid, 'USAGE,SELECT,UPDATE'
        )) or
        (relation.relkind in ('r','p','v','m','f') and (
          pg_catalog.has_table_privilege(
            current_user, relation.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          ) or pg_catalog.has_any_column_privilege(
            current_user, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
          )
        ))
      )
    ) as no_app_base_object_access,
    (
      select count(*) = ${ALLOWED_FUNCTIONS.length}
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid in (${ALLOWED_FUNCTION_SQL})
    ) and not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid not in (${ALLOWED_FUNCTION_SQL})
    ) as exact_function_surface_allowed,
    (
      select count(*) = ${ALLOWED_FUNCTIONS.length} and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and (
          (routine.oid in (${PRIVATE_PILOT_FUNCTION_SQL})
            and routine.proconfig = array['search_path=pg_catalog']::text[])
          or (routine.oid in (${RECOVERY_FUNCTION_SQL})
            and routine.proconfig = array['search_path=pg_catalog, app']::text[])
        )
        and owner.rolname = 'postgres'
      )
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_roles as owner on owner.oid = routine.proowner
      where routine.oid in (${ALLOWED_FUNCTION_SQL})
    ) as allowed_functions_hardened,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) as privilege
      where routine.oid in (${ALLOWED_FUNCTION_SQL})
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select oid from pg_catalog.pg_roles where rolname = '${EXECUTOR_GROUP_ROLE}')
        )
    ) as allowed_functions_execution_private,
    exists (
      select 1
      from pg_catalog.pg_default_acl as defaults
      join pg_catalog.pg_roles as owner on owner.oid = defaults.defaclrole
      where owner.rolname = 'postgres' and defaults.defaclnamespace = 0
        and defaults.defaclobjtype = 'f'
        and not exists (
          select 1 from pg_catalog.aclexplode(defaults.defaclacl) as privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        )
    ) as default_function_execution_private
`;

export interface KemerBetDepositPostgresClient extends KemerBetDepositPostgresQuery {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: (error?: Error) => void): void;
  removeListener(event: 'error' | 'end', listener: (error?: Error) => void): void;
}

interface PgModule {
  readonly Client: new (config: Record<string, unknown>) => KemerBetDepositPostgresClient;
}

export interface KemerBetDepositPostgresRuntimeDependencies {
  readonly createClient?: (
    config: Readonly<Record<string, unknown>>,
  ) => KemerBetDepositPostgresClient;
}

export class KemerBetDepositPostgresRuntimeUnavailableError extends Error {
  constructor() {
    super('The KemerBet deposit PostgreSQL runtime is unavailable.');
    this.name = 'KemerBetDepositPostgresRuntimeUnavailableError';
  }
}

function isExactTrueRow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== EXPECTED_PREFLIGHT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !EXPECTED_PREFLIGHT_KEYS.includes(key as never))
    ) {
      return false;
    }
    return EXPECTED_PREFLIGHT_KEYS.every((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.value === true
      );
    });
  } catch {
    return false;
  }
}

function isExactBooleanRow(value: unknown, key: string, expected: boolean): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const descriptor = descriptors[key];
    return (
      keys.length === 1 &&
      keys[0] === key &&
      descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === expected
    );
  } catch {
    return false;
  }
}

function exactSingletonResult(rows: readonly unknown[], key: string): boolean {
  return rows.length === 1 && isExactBooleanRow(rows[0], key, true);
}

export async function assertKemerBetDepositCatalogPreflight(
  pool: KemerBetDepositPostgresQuery,
): Promise<void> {
  const rows = (await pool.query(KEMERBET_DEPOSIT_DATABASE_PREFLIGHT_SQL, [])).rows;
  if (rows.length !== 1 || !isExactTrueRow(rows[0])) {
    throw new KemerBetDepositPostgresRuntimeUnavailableError();
  }
}

export async function probeKemerBetDepositCatalogReadiness(
  pool: KemerBetDepositPostgresQuery,
): Promise<boolean> {
  try {
    await assertKemerBetDepositCatalogPreflight(pool);
    return true;
  } catch {
    return false;
  }
}

export interface KemerBetDepositPostgresRuntime {
  readonly database: PostgresKemerBetDepositExecutionDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createKemerBetDepositPostgresRuntime(
  config: EnabledExecutionRuntimeConfig,
  privateLiveDepositPilotManifest: KemerBetPrivateLiveDepositPilotManifest,
  dependencies: KemerBetDepositPostgresRuntimeDependencies = {},
): Promise<KemerBetDepositPostgresRuntime> {
  const clientConfig = Object.freeze({
    ...config.connection,
    application_name: 'fetanagent_deposit_executor',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    ssl: { rejectUnauthorized: true },
  });
  const client =
    dependencies.createClient?.(clientConfig) ??
    (() => {
      const require = createRequire(import.meta.url);
      const { Client } = require('pg') as PgModule;
      return new Client(clientConfig);
    })();
  let available = false;
  let closed = false;
  let lockHeld = false;

  const markUnavailable = () => {
    available = false;
    lockHeld = false;
  };
  client.on('error', markUnavailable);
  client.on('end', markUnavailable);

  const guardedQuery: KemerBetDepositPostgresQuery = {
    async query(query, values) {
      if (!available || closed) throw new KemerBetDepositPostgresRuntimeUnavailableError();
      try {
        const result = await client.query(query, values);
        if (!available || closed) throw new KemerBetDepositPostgresRuntimeUnavailableError();
        return result;
      } catch {
        markUnavailable();
        throw new KemerBetDepositPostgresRuntimeUnavailableError();
      }
    },
  };
  let database: PostgresKemerBetDepositExecutionDatabase;
  try {
    database = new PostgresKemerBetDepositExecutionDatabase(
      guardedQuery,
      privateLiveDepositPilotManifest,
    );
  } catch {
    client.removeListener('error', markUnavailable);
    client.removeListener('end', markUnavailable);
    throw new KemerBetDepositPostgresRuntimeUnavailableError();
  }

  try {
    await client.connect();
    available = true;
    const singletonRows = (
      await guardedQuery.query(KEMERBET_EXECUTOR_SINGLETON_ACQUIRE_SQL, [
        ...EXECUTOR_SINGLETON_LOCK_KEYS,
      ])
    ).rows;
    if (!exactSingletonResult(singletonRows, 'singleton_acquired')) {
      throw new KemerBetDepositPostgresRuntimeUnavailableError();
    }
    lockHeld = true;
    await assertKemerBetDepositCatalogPreflight(guardedQuery);
  } catch {
    available = false;
    lockHeld = false;
    await client.end().catch(() => undefined);
    client.removeListener('error', markUnavailable);
    client.removeListener('end', markUnavailable);
    throw new KemerBetDepositPostgresRuntimeUnavailableError();
  }

  async function ready(): Promise<boolean> {
    if (!available || closed || !lockHeld) return false;
    try {
      const singletonRows = (
        await guardedQuery.query(KEMERBET_EXECUTOR_SINGLETON_HELD_SQL, [
          ...EXECUTOR_SINGLETON_LOCK_KEYS,
        ])
      ).rows;
      if (!exactSingletonResult(singletonRows, 'singleton_held')) {
        markUnavailable();
        return false;
      }
      await assertKemerBetDepositCatalogPreflight(guardedQuery);
      return available && lockHeld && !closed;
    } catch {
      markUnavailable();
      return false;
    }
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    available = false;
    let failed = false;
    if (lockHeld) {
      try {
        const rows = (
          await client.query(KEMERBET_EXECUTOR_SINGLETON_RELEASE_SQL, [
            ...EXECUTOR_SINGLETON_LOCK_KEYS,
          ])
        ).rows;
        if (!exactSingletonResult(rows, 'singleton_released')) failed = true;
      } catch {
        failed = true;
      } finally {
        lockHeld = false;
      }
    }
    try {
      await client.end();
    } catch {
      failed = true;
    } finally {
      client.removeListener('error', markUnavailable);
      client.removeListener('end', markUnavailable);
    }
    if (failed) throw new KemerBetDepositPostgresRuntimeUnavailableError();
  }

  return {
    database,
    ready,
    close,
  };
}
