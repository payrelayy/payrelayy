import { createRequire } from 'node:module';
import { types as nodeUtilTypes } from 'node:util';

import {
  COMPANION_DEVICE_BRIDGE_DATABASE_ROLE,
  COMPANION_DEVICE_BRIDGE_GROUP_ROLE,
  type CompanionDeviceBridgeConnectionConfig,
} from './config.js';
import {
  PostgresCompanionDeviceState,
  type CompanionDeviceStateDatabase,
} from './postgres-state.js';

const CLAIM_PAIRING_FUNCTION =
  'app.claim_agent_platform_companion_pairing(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text)';
const COMPLETE_PAIRING_FUNCTION =
  'app.complete_agent_platform_companion_pairing(text,text,text,text,jsonb)';
const RELEASE_PAIRING_FUNCTION = 'app.release_agent_platform_companion_pairing(text)';
const ALLOWED_FUNCTIONS = [
  CLAIM_PAIRING_FUNCTION,
  COMPLETE_PAIRING_FUNCTION,
  RELEASE_PAIRING_FUNCTION,
] as const;
const ALLOWED_FUNCTIONS_SQL = ALLOWED_FUNCTIONS.map(
  (signature) => `pg_catalog.to_regprocedure('${signature}')`,
).join(', ');

export const COMPANION_DEVICE_BRIDGE_PREFLIGHT_KEYS = [
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
  'no_reachable_unallowlisted_security_definer',
  'allowed_functions_hardened',
  'allowed_function_contracts_exact',
  'allowed_functions_execution_private',
  'default_function_execution_private',
] as const;

export const COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${COMPANION_DEVICE_BRIDGE_DATABASE_ROLE}' and session_user = current_user
      as runtime_login_identity_allowed,
    exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = current_user
        and role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 1
        and role.rolvaliduntil = 'infinity'::timestamptz
    ) as runtime_login_is_safe,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = '${COMPANION_DEVICE_BRIDGE_GROUP_ROLE}' and membership.inherit_option
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
      where granted.rolname = '${COMPANION_DEVICE_BRIDGE_DATABASE_ROLE}'
    ) as runtime_only_trusted_members,
    exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = '${COMPANION_DEVICE_BRIDGE_GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${COMPANION_DEVICE_BRIDGE_GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${COMPANION_DEVICE_BRIDGE_GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select
        count(*) filter (
          where member.rolname = '${COMPANION_DEVICE_BRIDGE_DATABASE_ROLE}'
            and membership.inherit_option
            and not membership.set_option
            and not membership.admin_option
        ) = 1
        and count(*) filter (where member.rolname = 'postgres') <= 1
        and pg_catalog.bool_and(
          (
            member.rolname = '${COMPANION_DEVICE_BRIDGE_DATABASE_ROLE}'
            and membership.inherit_option
            and not membership.set_option
            and not membership.admin_option
          ) or (
            member.rolname = 'postgres'
            and not membership.inherit_option
            and not membership.set_option
            and membership.admin_option
          )
        )
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where granted.rolname = '${COMPANION_DEVICE_BRIDGE_GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member on member.oid = membership.member
      where member.rolname = '${COMPANION_DEVICE_BRIDGE_GROUP_ROLE}'
    ) as group_has_no_upstream_membership,
    pg_catalog.has_database_privilege(
      current_user, pg_catalog.current_database(), 'CONNECT'
    ) and pg_catalog.has_database_privilege(
      current_user, pg_catalog.current_database(), 'TEMPORARY'
    ) and not pg_catalog.has_database_privilege(
      current_user, pg_catalog.current_database(), 'CREATE'
    ) as database_connect_temp_boundary_acknowledged,
    pg_catalog.has_schema_privilege(current_user, 'app', 'USAGE')
      and not pg_catalog.has_schema_privilege(current_user, 'app', 'CREATE')
      as app_schema_boundary_allowed,
    (
      select coalesce(
        pg_catalog.array_agg(namespace.nspname::text order by namespace.nspname),
        '{}'::text[]
      ) = array['app', 'public']::text[]
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
            current_user, relation.oid, 'USAGE,SELECT,UPDATE'
          )) or
          (relation.relkind in ('r','p','v','m','f') and (
            pg_catalog.has_table_privilege(
              current_user, relation.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
            ) or pg_catalog.has_any_column_privilege(
              current_user, relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
            )
          ))
        )
    ) as no_non_system_base_object_access,
    (
      select count(*) = 3
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid in (${ALLOWED_FUNCTIONS_SQL})
    ) and not exists (
      select 1 from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid not in (${ALLOWED_FUNCTIONS_SQL})
    ) as exact_reachable_function_surface_allowed,
    not exists (
      select 1 from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.prosecdef and routine.oid not in (${ALLOWED_FUNCTIONS_SQL})
    ) as no_reachable_unallowlisted_security_definer,
    (
      select count(*) = 3 and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and owner.rolname = 'postgres'
      )
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_roles owner on owner.oid = routine.proowner
      where routine.oid in (${ALLOWED_FUNCTIONS_SQL})
    ) as allowed_functions_hardened,
    (
      select count(*) = 3 and pg_catalog.bool_and(
        routine.pronargs = expected.argument_count
        and routine.pronargdefaults = 0
        and routine.proretset = expected.returns_set
        and routine.prorettype = pg_catalog.to_regtype(expected.return_type)::pg_catalog.oid
        and pg_catalog.lower(pg_catalog.pg_get_function_result(routine.oid)) = expected.result
      )
      from (values
        (pg_catalog.to_regprocedure('${CLAIM_PAIRING_FUNCTION}'), 12, true,
          'pg_catalog.record',
          'table(claim_state text, certificate_body jsonb, signed_certificate jsonb)'),
        (pg_catalog.to_regprocedure('${COMPLETE_PAIRING_FUNCTION}'), 5, false,
          'pg_catalog.bool', 'boolean'),
        (pg_catalog.to_regprocedure('${RELEASE_PAIRING_FUNCTION}'), 1, false,
          'pg_catalog.bool', 'boolean')
      ) expected(oid, argument_count, returns_set, return_type, result)
      join pg_catalog.pg_proc routine on routine.oid = expected.oid
    ) as allowed_function_contracts_exact,
    not exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) privilege
      where routine.oid in (${ALLOWED_FUNCTIONS_SQL})
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select oid from pg_catalog.pg_roles
            where rolname = '${COMPANION_DEVICE_BRIDGE_GROUP_ROLE}')
        )
    ) as allowed_functions_execution_private,
    exists (
      select 1 from pg_catalog.pg_default_acl defaults
      join pg_catalog.pg_roles owner on owner.oid = defaults.defaclrole
      where owner.rolname = 'postgres' and defaults.defaclnamespace = 0
        and defaults.defaclobjtype = 'f'
        and not exists (
          select 1 from pg_catalog.aclexplode(defaults.defaclacl) privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        )
    ) as default_function_execution_private
`;

interface CompanionDeviceBridgePostgresQuery {
  query(sql: string, values?: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export type CompanionDeviceBridgeInitialPreflightFailure =
  | Readonly<{ readonly kind: 'database_connection_unavailable' }>
  | Readonly<{ readonly kind: 'database_query_unavailable' }>
  | Readonly<{ readonly kind: 'catalog_response_invalid' }>
  | Readonly<{
      readonly kind: 'catalog_checks_rejected';
      readonly checks: readonly (typeof COMPANION_DEVICE_BRIDGE_PREFLIGHT_KEYS)[number][];
    }>;

type CompanionDeviceBridgeCatalogPreflightAssessment =
  Readonly<{ readonly kind: 'passed' }> | CompanionDeviceBridgeInitialPreflightFailure;

export class CompanionDeviceBridgePostgresUnavailableError extends Error {
  constructor() {
    super('The companion device bridge database boundary is unavailable.');
    this.name = 'CompanionDeviceBridgePostgresUnavailableError';
  }
}

async function assessCompanionDeviceBridgeCatalogPreflight(
  database: CompanionDeviceBridgePostgresQuery,
): Promise<CompanionDeviceBridgeCatalogPreflightAssessment> {
  let rows: readonly unknown[];
  try {
    rows = (await database.query(COMPANION_DEVICE_BRIDGE_CATALOG_PREFLIGHT_SQL, [])).rows;
  } catch {
    return Object.freeze({ kind: 'database_query_unavailable' as const });
  }
  try {
    if (rows.length !== 1) {
      return Object.freeze({ kind: 'catalog_response_invalid' as const });
    }
    const candidate = rows[0];
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      Array.isArray(candidate) ||
      nodeUtilTypes.isProxy(candidate) ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      return Object.freeze({ kind: 'catalog_response_invalid' as const });
    }
    const row = candidate as Record<string, unknown>;
    const keys = Object.keys(row).sort();
    const expected = [...COMPANION_DEVICE_BRIDGE_PREFLIGHT_KEYS].sort();
    if (
      keys.length !== expected.length ||
      !keys.every((key, index) => key === expected[index]) ||
      !expected.every((key) => typeof row[key] === 'boolean')
    ) {
      return Object.freeze({ kind: 'catalog_response_invalid' as const });
    }
    const checks = Object.freeze(
      COMPANION_DEVICE_BRIDGE_PREFLIGHT_KEYS.filter((key) => row[key] === false),
    );
    return checks.length === 0
      ? Object.freeze({ kind: 'passed' as const })
      : Object.freeze({ kind: 'catalog_checks_rejected' as const, checks });
  } catch {
    return Object.freeze({ kind: 'catalog_response_invalid' as const });
  }
}

export async function assertCompanionDeviceBridgeCatalogPreflight(
  database: CompanionDeviceBridgePostgresQuery,
): Promise<void> {
  if ((await assessCompanionDeviceBridgeCatalogPreflight(database)).kind !== 'passed') {
    throw new CompanionDeviceBridgePostgresUnavailableError();
  }
}

interface CompanionDeviceBridgePool extends CompanionDeviceBridgePostgresQuery {
  connect(): Promise<{ release(destroy?: boolean): void }>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): void;
  removeListener(event: 'error', listener: (error: Error) => void): void;
}

interface PgModule {
  readonly Pool: new (config: Readonly<Record<string, unknown>>) => CompanionDeviceBridgePool;
}

export interface CompanionDeviceBridgePostgresRuntimeDependencies {
  readonly createPool?: (config: Readonly<Record<string, unknown>>) => CompanionDeviceBridgePool;
  readonly onInitialPreflightFailure?: (
    failure: CompanionDeviceBridgeInitialPreflightFailure,
  ) => void;
}

export interface CompanionDeviceBridgePostgresRuntime {
  readonly state: PostgresCompanionDeviceState;
  readonly database: CompanionDeviceStateDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createCompanionDeviceBridgePostgresRuntime(
  connection: CompanionDeviceBridgeConnectionConfig,
  signerKeyId: string,
  dependencies: CompanionDeviceBridgePostgresRuntimeDependencies = {},
): Promise<CompanionDeviceBridgePostgresRuntime> {
  const { ca, ...postgresConnection } = connection;
  const poolConfig = Object.freeze({
    ...postgresConnection,
    application_name: 'fetanagent_companion_device_bridge',
    allowExitOnIdle: false,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 0,
    max: 1,
    min: 1,
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
  let available = false;
  let closed = false;
  const markUnavailable = () => {
    available = false;
  };
  pool.on('error', markUnavailable);

  const raw: CompanionDeviceBridgePostgresQuery = {
    query: (sql, values = []) => pool.query(sql, values),
  };
  const reportInitialPreflightFailure = (failure: CompanionDeviceBridgeInitialPreflightFailure) => {
    try {
      dependencies.onInitialPreflightFailure?.(failure);
    } catch {
      // Diagnostics are observational only and can never change the fail-closed runtime outcome.
    }
  };
  const guarded: CompanionDeviceStateDatabase = {
    async query(sql, values) {
      if (!available || closed) throw new CompanionDeviceBridgePostgresUnavailableError();
      try {
        await assertCompanionDeviceBridgeCatalogPreflight(raw);
        const result = await raw.query(sql, values);
        if (!available || closed) throw new Error();
        return result;
      } catch {
        markUnavailable();
        throw new CompanionDeviceBridgePostgresUnavailableError();
      }
    },
  };

  let connected = false;
  try {
    const client = await pool.connect();
    client.release();
    connected = true;
    available = true;
    const assessment = await assessCompanionDeviceBridgeCatalogPreflight(raw);
    if (assessment.kind !== 'passed') {
      reportInitialPreflightFailure(assessment);
      throw new Error();
    }
  } catch {
    if (!connected) {
      reportInitialPreflightFailure(
        Object.freeze({ kind: 'database_connection_unavailable' as const }),
      );
    }
    available = false;
    await pool.end().catch(() => undefined);
    pool.removeListener('error', markUnavailable);
    throw new CompanionDeviceBridgePostgresUnavailableError();
  }

  const state = new PostgresCompanionDeviceState(guarded, signerKeyId);
  return Object.freeze({
    state,
    database: guarded,
    async ready() {
      if (!available || closed) return false;
      try {
        await assertCompanionDeviceBridgeCatalogPreflight(raw);
        return available && !closed;
      } catch {
        markUnavailable();
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      available = false;
      try {
        await pool.end();
      } catch {
        throw new CompanionDeviceBridgePostgresUnavailableError();
      } finally {
        pool.removeListener('error', markUnavailable);
      }
    },
  });
}
