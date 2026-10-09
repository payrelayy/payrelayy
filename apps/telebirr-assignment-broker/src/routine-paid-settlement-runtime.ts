import { createRequire } from 'node:module';
import { isProxy } from 'node:util/types';

import {
  ROUTINE_PAID_POLL_DATABASE_TARGETS,
  type RoutinePaidPollDatabaseTarget,
} from './routine-paid-poll-runtime.js';
import type {
  RoutinePaidSettlementCandidate,
  RoutinePaidSettlementDatabase,
} from './routine-paid-settlement-worker.js';

const GROUP_ROLE = 'fetanagent_routine_telebirr_paid_settlement';
const RUNTIME_ROLE = 'fetanagent_routine_telebirr_paid_settlement_runtime';
const SCAN = 'app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)';
const FINALIZE = 'app.finalize_routine_telebirr_paid_observation(uuid)';
const ALLOWED_OIDS = [SCAN, FINALIZE]
  .map((signature) => `pg_catalog.to_regprocedure('${signature}')`)
  .join(', ');

export const ROUTINE_PAID_SETTLEMENT_PREFLIGHT_KEYS = [
  'exact_runtime_identity',
  'runtime_login_safe',
  'membership_exact',
  'group_safe',
  'group_members_exact',
  'database_access_bounded',
  'app_schema_access_only',
  'no_base_object_access',
  'only_two_functions',
  'functions_guarded',
  'function_grants_private',
  'session_guard_private',
] as const;

/** Fixed read-only catalog query; a changed grant or role prevents all worker calls. */
export const ROUTINE_PAID_SETTLEMENT_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${RUNTIME_ROLE}' and session_user = current_user
      as exact_runtime_identity,
    exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname = current_user
         and role.rolcanlogin and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 1 and role.rolvaliduntil is not null
         and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
         and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '30 days 5 minutes'
    ) as runtime_login_safe,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = '${GROUP_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option)
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted on granted.oid = membership.roleid
        join pg_catalog.pg_roles member on member.oid = membership.member
       where member.rolname = current_user
    ) as membership_exact,
    exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname = '${GROUP_ROLE}'
         and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 2
         and not exists (
           select 1 from pg_catalog.pg_auth_members membership
            where membership.member = role.oid)
    ) and pg_catalog.pg_has_role(current_user, '${GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${GROUP_ROLE}', 'SET')
      as group_safe,
    (
      select count(*) filter (where member.rolname = '${RUNTIME_ROLE}') = 1
        and count(*) filter (where member.rolname = 'postgres') <= 1
        and pg_catalog.bool_and(
          (member.rolname = '${RUNTIME_ROLE}' and membership.inherit_option
            and not membership.set_option and not membership.admin_option)
          or (member.rolname = 'postgres' and not membership.inherit_option
            and not membership.set_option and membership.admin_option))
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted on granted.oid = membership.roleid
        join pg_catalog.pg_roles member on member.oid = membership.member
       where granted.rolname = '${GROUP_ROLE}'
    ) as group_members_exact,
    pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CONNECT')
      and not pg_catalog.has_database_privilege(
        current_user, pg_catalog.current_database(), 'CREATE')
      as database_access_bounded,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      and not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      and not exists (
        select 1 from pg_catalog.pg_namespace namespace
         where namespace.nspname not in ('pg_catalog', 'information_schema')
           and namespace.nspname !~ '^pg_(toast|temp)'
           and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE'))
      as app_schema_access_only,
    not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname not in ('pg_catalog', 'information_schema')
         and namespace.nspname !~ '^pg_(toast|temp)'
         and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
         and ((relation.relkind = 'S' and pg_catalog.has_sequence_privilege(
           current_user, relation.oid, 'USAGE,SELECT,UPDATE'))
           or (relation.relkind in ('r','p','v','m','f') and (
             pg_catalog.has_table_privilege(current_user, relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
             or pg_catalog.has_any_column_privilege(current_user, relation.oid,
               'SELECT,INSERT,UPDATE,REFERENCES'))))
    ) as no_base_object_access,
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
    ) as only_two_functions,
    (
      select count(*) = 2 and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and owner.rolname = 'postgres'
        and pg_catalog.strpos(routine.prosrc,
          'not app.routine_telebirr_paid_settlement_session_allowed()') > 0)
        from pg_catalog.pg_proc routine
        join pg_catalog.pg_roles owner on owner.oid = routine.proowner
       where routine.oid in (${ALLOWED_OIDS})
    ) as functions_guarded,
    not exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
       where routine.oid in (${ALLOWED_OIDS})
         and privilege.privilege_type = 'EXECUTE'
         and privilege.grantee not in (
           routine.proowner,
           (select oid from pg_catalog.pg_roles where rolname = '${GROUP_ROLE}'))
    ) as function_grants_private,
    not pg_catalog.has_function_privilege(current_user,
      'app.routine_telebirr_paid_settlement_session_allowed()'::pg_catalog.regprocedure,
      'EXECUTE') as session_guard_private
`;

const LIST_SQL =
  'select * from app.list_routine_telebirr_paid_settlement_candidates($1::timestamptz,$2::uuid,$3::integer)';
const FINALIZE_SQL = 'select * from app.finalize_routine_telebirr_paid_observation($1::uuid)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UTC_MICROSECONDS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u;

export interface RoutinePaidSettlementConnectionConfig {
  readonly target: RoutinePaidPollDatabaseTarget;
  readonly host: string;
  readonly port: 5432;
  readonly database: 'postgres';
  readonly user: string;
  readonly password: string;
  readonly ca: string;
}

export interface RoutinePaidSettlementSqlClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: () => void): void;
  removeListener(event: 'error' | 'end', listener: () => void): void;
  query(text: string, values: unknown[]): Promise<{ readonly rows: unknown[] }>;
}

export class RoutinePaidSettlementUnavailableError extends Error {
  constructor() {
    super('The private routine paid settlement runtime is unavailable.');
    this.name = 'RoutinePaidSettlementUnavailableError';
  }
}

function plainRow(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
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

function connectionIsAllowed(config: RoutinePaidSettlementConnectionConfig): boolean {
  if (config.target !== 'production' && config.target !== 'staging') return false;
  const target = ROUTINE_PAID_POLL_DATABASE_TARGETS[config.target];
  return (
    ((config.host === target.directHost && config.user === RUNTIME_ROLE) ||
      (config.host === target.sessionPoolerHost &&
        config.user === `${RUNTIME_ROLE}.${target.projectReference}`)) &&
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

interface PgModule {
  readonly Client: new (
    config: Readonly<Record<string, unknown>>,
  ) => RoutinePaidSettlementSqlClient;
}

export interface RoutinePaidSettlementRuntime {
  readonly database: RoutinePaidSettlementDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

async function assertCatalog(client: RoutinePaidSettlementSqlClient): Promise<void> {
  const response = await client.query(ROUTINE_PAID_SETTLEMENT_CATALOG_PREFLIGHT_SQL, []);
  const row =
    response.rows.length === 1
      ? plainRow(response.rows[0], ROUTINE_PAID_SETTLEMENT_PREFLIGHT_KEYS)
      : undefined;
  if (!row || !ROUTINE_PAID_SETTLEMENT_PREFLIGHT_KEYS.every((key) => row[key] === true))
    throw new RoutinePaidSettlementUnavailableError();
}

/** Dedicated one-connection worker; no direct table SQL or reference-opening material. */
export async function createRoutinePaidSettlementRuntime(
  connection: RoutinePaidSettlementConnectionConfig,
  dependencies: {
    readonly createClient?: (
      config: Readonly<Record<string, unknown>>,
    ) => RoutinePaidSettlementSqlClient;
  } = {},
): Promise<RoutinePaidSettlementRuntime> {
  if (!connectionIsAllowed(connection)) throw new RoutinePaidSettlementUnavailableError();
  const clientConfig = Object.freeze({
    host: connection.host,
    port: 5432,
    database: 'postgres',
    user: connection.user,
    password: connection.password,
    application_name: 'fetanagent_routine_paid_settlement',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ssl: Object.freeze({ ca: connection.ca, rejectUnauthorized: true }),
  });
  let client: RoutinePaidSettlementSqlClient;
  try {
    client =
      dependencies.createClient?.(clientConfig) ??
      (() => {
        const require = createRequire(import.meta.url);
        const { Client } = require('pg') as PgModule;
        return new Client(clientConfig);
      })();
  } catch {
    throw new RoutinePaidSettlementUnavailableError();
  }
  let available = false;
  let closed = false;
  const unavailable = () => {
    available = false;
  };
  client.on('error', unavailable);
  client.on('end', unavailable);
  try {
    await client.connect();
    available = true;
    await assertCatalog(client);
  } catch {
    available = false;
    await client.end().catch(() => undefined);
    client.removeListener('error', unavailable);
    client.removeListener('end', unavailable);
    throw new RoutinePaidSettlementUnavailableError();
  }
  async function guardedQuery(sql: string, values: unknown[]) {
    if (!available || closed) throw new RoutinePaidSettlementUnavailableError();
    try {
      await assertCatalog(client);
    } catch {
      available = false;
      throw new RoutinePaidSettlementUnavailableError();
    }
    if (!available || closed) throw new RoutinePaidSettlementUnavailableError();
    return client.query(sql, values);
  }
  return Object.freeze({
    database: Object.freeze({
      async listCandidates(cursor: RoutinePaidSettlementCandidate | undefined, limit: number) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 32)
          throw new RoutinePaidSettlementUnavailableError();
        let response: { readonly rows: unknown[] };
        try {
          response = await guardedQuery(LIST_SQL, [
            cursor?.occurredAtUtc ?? null,
            cursor?.challengeId ?? null,
            limit,
          ]);
        } catch {
          throw new RoutinePaidSettlementUnavailableError();
        }
        if (!Array.isArray(response.rows) || response.rows.length > limit)
          throw new RoutinePaidSettlementUnavailableError();
        let previous = cursor;
        return response.rows.map((value) => {
          const row = plainRow(value, ['challenge_id', 'occurred_at_utc']);
          if (
            !row ||
            typeof row.challenge_id !== 'string' ||
            !UUID.test(row.challenge_id) ||
            typeof row.occurred_at_utc !== 'string' ||
            !UTC_MICROSECONDS.test(row.occurred_at_utc)
          )
            throw new RoutinePaidSettlementUnavailableError();
          const candidate = Object.freeze({
            challengeId: row.challenge_id,
            occurredAtUtc: row.occurred_at_utc,
          });
          if (
            previous &&
            (candidate.occurredAtUtc < previous.occurredAtUtc ||
              (candidate.occurredAtUtc === previous.occurredAtUtc &&
                candidate.challengeId <= previous.challengeId))
          )
            throw new RoutinePaidSettlementUnavailableError();
          previous = candidate;
          return candidate;
        });
      },
      async finalize(challengeId: string) {
        if (!UUID.test(challengeId)) throw new RoutinePaidSettlementUnavailableError();
        const response = await guardedQuery(FINALIZE_SQL, [challengeId]);
        const row =
          response.rows.length === 1
            ? plainRow(response.rows[0], [
                'deposit_intent_id',
                'payment_claim_id',
                'execution_job_id',
                'already_finalized',
              ])
            : undefined;
        if (
          !row ||
          ![row.deposit_intent_id, row.payment_claim_id, row.execution_job_id].every(
            (id) => typeof id === 'string' && UUID.test(id),
          ) ||
          typeof row.already_finalized !== 'boolean'
        )
          throw new RoutinePaidSettlementUnavailableError();
        return row.already_finalized ? ('already_finalized' as const) : ('created' as const);
      },
    }),
    async ready() {
      if (!available || closed) return false;
      try {
        await assertCatalog(client);
        return available && !closed;
      } catch {
        available = false;
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      available = false;
      try {
        await client.end();
      } finally {
        client.removeListener('error', unavailable);
        client.removeListener('end', unavailable);
      }
    },
  });
}
