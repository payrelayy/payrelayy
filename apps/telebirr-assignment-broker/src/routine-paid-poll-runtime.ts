import { createRequire } from 'node:module';
import { isProxy } from 'node:util/types';

import {
  createRoutinePaidPollPostgresDatabase,
  type RoutinePaidPollSqlClient,
} from './routine-paid-poll-postgres.js';
import type { RoutinePaidPollBrokerDatabase } from './routine-paid-poll-broker.js';

const GROUP_ROLE = 'fetanagent_routine_telebirr_paid_poll';
const RUNTIME_ROLE = 'fetanagent_routine_telebirr_paid_poll_runtime';
const ALLOWED_FUNCTIONS = [
  'app.load_routine_telebirr_paid_poll_enrollment(uuid)',
  'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)',
] as const;
const GUARDED_FUNCTIONS = [
  ...ALLOWED_FUNCTIONS,
  'app.issue_routine_telebirr_paid_lookup_assignment_material(uuid,uuid,uuid)',
  'app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)',
] as const;
const ALLOWED_OIDS = ALLOWED_FUNCTIONS.map(
  (signature) => `pg_catalog.to_regprocedure('${signature}')`,
).join(', ');
const GUARDED_OIDS = GUARDED_FUNCTIONS.map(
  (signature) => `pg_catalog.to_regprocedure('${signature}')`,
).join(', ');

export const ROUTINE_PAID_POLL_DATABASE_TARGETS = Object.freeze({
  staging: Object.freeze({
    projectReference: 'spzpiyxheappsfyswewl',
    directHost: 'db.spzpiyxheappsfyswewl.supabase.co',
    sessionPoolerHost: 'aws-1-eu-west-1.pooler.supabase.com',
  }),
  production: Object.freeze({
    projectReference: 'xzztugbgtulptnbpoelr',
    directHost: 'db.xzztugbgtulptnbpoelr.supabase.co',
    sessionPoolerHost: 'aws-0-eu-west-1.pooler.supabase.com',
  }),
} as const);

export type RoutinePaidPollDatabaseTarget = keyof typeof ROUTINE_PAID_POLL_DATABASE_TARGETS;

export interface RoutinePaidPollConnectionConfig {
  readonly target: RoutinePaidPollDatabaseTarget;
  readonly host: string;
  readonly port: 5432;
  readonly database: 'postgres';
  readonly user: string;
  readonly password: string;
  readonly ca: string;
}

export const ROUTINE_PAID_POLL_PREFLIGHT_KEYS = [
  'runtime_login_identity_allowed',
  'runtime_login_is_safe',
  'only_expected_direct_membership',
  'runtime_only_trusted_members',
  'group_role_is_safe',
  'group_usage_allowed_set_denied',
  'group_only_expected_members',
  'group_has_no_upstream_membership',
  'database_connect_temp_boundary_acknowledged',
  'app_schema_boundary_allowed',
  'non_system_schema_usage_exact',
  'no_non_system_schema_create',
  'no_non_system_base_object_access',
  'exact_reachable_function_surface_allowed',
  'guarded_functions_hardened',
  'allowed_functions_execution_private',
  'session_guard_execution_private',
] as const;

/** A fixed, read-only catalog query. Every column must be true before any routine function call. */
export const ROUTINE_PAID_POLL_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${RUNTIME_ROLE}' and session_user = current_user
      as runtime_login_identity_allowed,
    exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = current_user
        and role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 1 and role.rolvaliduntil is not null
        and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
        and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '30 days 5 minutes'
    ) as runtime_login_is_safe,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = '${GROUP_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where member.rolname = current_user
    ) as only_expected_direct_membership,
    (
      select count(*) <= 1 and coalesce(pg_catalog.bool_and(
        member.rolname = 'postgres'
        and not membership.inherit_option
        and not membership.set_option
        and membership.admin_option
      ), true)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where granted.rolname = '${RUNTIME_ROLE}'
    ) as runtime_only_trusted_members,
    exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = '${GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select count(*) filter (
        where member.rolname = '${RUNTIME_ROLE}'
          and membership.inherit_option and not membership.set_option
          and not membership.admin_option
      ) = 1
      and count(*) filter (where member.rolname = 'postgres') <= 1
      and pg_catalog.bool_and(
        (member.rolname = '${RUNTIME_ROLE}'
          and membership.inherit_option and not membership.set_option
          and not membership.admin_option)
        or (member.rolname = 'postgres'
          and not membership.inherit_option and not membership.set_option
          and membership.admin_option)
      )
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where granted.rolname = '${GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member on member.oid = membership.member
      where member.rolname = '${GROUP_ROLE}'
    ) as group_has_no_upstream_membership,
    pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CONNECT')
      and pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'TEMPORARY')
      and not pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CREATE')
      as database_connect_temp_boundary_acknowledged,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      and not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      as app_schema_boundary_allowed,
    (
      select coalesce(pg_catalog.array_agg(namespace.nspname::text order by namespace.nspname),
        '{}'::text[]) = array['app', 'public']::text[]
      from pg_catalog.pg_namespace namespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
    ) as non_system_schema_usage_exact,
    not exists (
      select 1 from pg_catalog.pg_namespace namespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE')
    ) as no_non_system_schema_create,
    not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and (
          (relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
            current_user, relation.oid, 'USAGE,SELECT,UPDATE'))
          or (relation.relkind in ('r','p','v','m','f') and (
            pg_catalog.has_table_privilege(current_user, relation.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
            or pg_catalog.has_any_column_privilege(current_user, relation.oid,
              'SELECT,INSERT,UPDATE,REFERENCES')
          ))
        )
    ) as no_non_system_base_object_access,
    (
      select count(*) = 2
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid in (${ALLOWED_OIDS})
    ) and not exists (
      select 1 from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid not in (${ALLOWED_OIDS})
    ) as exact_reachable_function_surface_allowed,
    (
      select count(*) = 4 and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and owner.rolname = 'postgres'
        and (pg_catalog.length(routine.prosrc) - pg_catalog.length(pg_catalog.replace(
          routine.prosrc, 'not app.routine_telebirr_paid_poll_session_allowed()', '')))
          = pg_catalog.length('not app.routine_telebirr_paid_poll_session_allowed()')
      )
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_roles owner on owner.oid = routine.proowner
      where routine.oid in (${GUARDED_OIDS})
    ) as guarded_functions_hardened,
    not exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
      where routine.oid in (${ALLOWED_OIDS})
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select oid from pg_catalog.pg_roles where rolname = '${GROUP_ROLE}')
        )
    ) as allowed_functions_execution_private,
    not pg_catalog.has_function_privilege(current_user,
      'app.routine_telebirr_paid_poll_session_allowed()'::pg_catalog.regprocedure,
      'EXECUTE')
      as session_guard_execution_private
`;

export class RoutinePaidPollRuntimeUnavailableError extends Error {
  constructor() {
    super('The private routine paid poll database runtime is unavailable.');
    this.name = 'RoutinePaidPollRuntimeUnavailableError';
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return undefined;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function connectionIsAllowed(value: unknown): value is RoutinePaidPollConnectionConfig {
  const config = exactObject(value, [
    'target',
    'host',
    'port',
    'database',
    'user',
    'password',
    'ca',
  ]);
  if (!config || (config.target !== 'staging' && config.target !== 'production')) return false;
  const target = ROUTINE_PAID_POLL_DATABASE_TARGETS[config.target];
  const direct = config.host === target.directHost && config.user === RUNTIME_ROLE;
  const sessionPooler =
    config.host === target.sessionPoolerHost &&
    config.user === `${RUNTIME_ROLE}.${target.projectReference}`;
  return (
    (direct || sessionPooler) &&
    config.port === 5432 &&
    config.database === 'postgres' &&
    typeof config.password === 'string' &&
    config.password.length >= 16 &&
    !/[\r\n\0]/u.test(config.password) &&
    typeof config.ca === 'string' &&
    config.ca.length <= 16_384 &&
    /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n?$/u.test(config.ca)
  );
}

export interface RoutinePaidPollPostgresClient extends RoutinePaidPollSqlClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: () => void): void;
  removeListener(event: 'error' | 'end', listener: () => void): void;
}

interface PgModule {
  readonly Client: new (config: Readonly<Record<string, unknown>>) => RoutinePaidPollPostgresClient;
}

export interface RoutinePaidPollPostgresRuntimeDependencies {
  readonly createClient?: (
    config: Readonly<Record<string, unknown>>,
  ) => RoutinePaidPollPostgresClient;
}

export interface RoutinePaidPollPostgresRuntime {
  readonly database: RoutinePaidPollBrokerDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

async function assertCatalog(client: RoutinePaidPollSqlClient): Promise<void> {
  try {
    const result = await client.query(ROUTINE_PAID_POLL_CATALOG_PREFLIGHT_SQL, []);
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw new Error();
    const row = exactObject(result.rows[0], ROUTINE_PAID_POLL_PREFLIGHT_KEYS);
    if (!row || !ROUTINE_PAID_POLL_PREFLIGHT_KEYS.every((key) => row[key] === true))
      throw new Error();
  } catch {
    throw new RoutinePaidPollRuntimeUnavailableError();
  }
}

/** No environment loader or production caller: this boundary cannot start without an explicit caller-owned secret. */
export async function createRoutinePaidPollPostgresRuntime(
  connection: RoutinePaidPollConnectionConfig,
  dependencies: RoutinePaidPollPostgresRuntimeDependencies = {},
): Promise<RoutinePaidPollPostgresRuntime> {
  if (!connectionIsAllowed(connection)) throw new RoutinePaidPollRuntimeUnavailableError();
  const clientConfig = Object.freeze({
    host: connection.host,
    port: 5432,
    database: 'postgres',
    user: connection.user,
    password: connection.password,
    application_name: 'fetanagent_routine_paid_poll_broker',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    ssl: Object.freeze({ ca: connection.ca, rejectUnauthorized: true }),
  });
  let client: RoutinePaidPollPostgresClient;
  try {
    client =
      dependencies.createClient?.(clientConfig) ??
      (() => {
        const require = createRequire(import.meta.url);
        const { Client } = require('pg') as PgModule;
        return new Client(clientConfig);
      })();
  } catch {
    throw new RoutinePaidPollRuntimeUnavailableError();
  }
  let available = false;
  let closed = false;
  const markUnavailable = () => {
    available = false;
  };
  client.on('error', markUnavailable);
  client.on('end', markUnavailable);
  try {
    await client.connect();
    available = true;
    await assertCatalog(client);
  } catch {
    markUnavailable();
    await client.end().catch(() => undefined);
    client.removeListener('error', markUnavailable);
    client.removeListener('end', markUnavailable);
    throw new RoutinePaidPollRuntimeUnavailableError();
  }
  const guarded: RoutinePaidPollSqlClient = Object.freeze({
    async query(sql: string, values: unknown[]) {
      if (!available || closed) throw new RoutinePaidPollRuntimeUnavailableError();
      try {
        await assertCatalog(client);
        if (!available || closed) throw new Error();
        const result = await client.query(sql, values);
        if (!available || closed) throw new Error();
        return result;
      } catch {
        markUnavailable();
        throw new RoutinePaidPollRuntimeUnavailableError();
      }
    },
  });
  return Object.freeze({
    database: createRoutinePaidPollPostgresDatabase(guarded),
    async ready() {
      if (!available || closed) return false;
      try {
        await assertCatalog(client);
        return available && !closed;
      } catch {
        markUnavailable();
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      markUnavailable();
      try {
        await client.end();
      } catch {
        throw new RoutinePaidPollRuntimeUnavailableError();
      } finally {
        client.removeListener('error', markUnavailable);
        client.removeListener('end', markUnavailable);
      }
    },
  });
}
