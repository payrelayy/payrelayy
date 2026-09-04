import { createRequire } from 'node:module';

import {
  type TrustedTelebirrCompletionInput,
  type TrustedTelebirrVerifierDatabase,
} from './trusted-telebirr-verifier.js';

const VERIFIER_GROUP_ROLE = 'fetanagent_trusted_telebirr_verifier';
const VERIFIER_RUNTIME_ROLE = 'fetanagent_trusted_telebirr_verifier_runtime';
const AUTHORITY_FUNCTION =
  'app.load_private_live_telebirr_verification_authority(uuid,uuid,timestamp with time zone)';
const COMPLETION_FUNCTION =
  'app.complete_private_live_telebirr_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)';
const AUTHORITY_FUNCTION_SQL = `pg_catalog.to_regprocedure('${AUTHORITY_FUNCTION}')`;
const COMPLETION_FUNCTION_SQL = `pg_catalog.to_regprocedure('${COMPLETION_FUNCTION}')`;
const ALLOWED_FUNCTIONS_SQL = `${AUTHORITY_FUNCTION_SQL}, ${COMPLETION_FUNCTION_SQL}`;

export const TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS = [
  'runtime_login_identity_allowed',
  'runtime_login_is_safe',
  'only_expected_direct_membership',
  'runtime_has_no_members',
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
  'authority_function_contract_exact',
  'completion_function_contract_exact',
  'allowed_functions_execution_private',
  'default_function_execution_private',
] as const;

/** Catalog-only, row-data-free startup proof. Every named result must be exactly true. */
export const TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${VERIFIER_RUNTIME_ROLE}' and session_user = current_user
      as runtime_login_identity_allowed,
    exists (
      select 1 from pg_catalog.pg_roles as role
      where role.rolname = current_user
        and role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 1
        and role.rolvaliduntil is not null
        and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
        and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
    ) as runtime_login_is_safe,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = '${VERIFIER_GROUP_ROLE}' and membership.inherit_option
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
      where granted.rolname = '${VERIFIER_RUNTIME_ROLE}'
    ) as runtime_has_no_members,
    exists (
      select 1 from pg_catalog.pg_roles as role
      where role.rolname = '${VERIFIER_GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${VERIFIER_GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${VERIFIER_GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        member.rolname = '${VERIFIER_RUNTIME_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where granted.rolname = '${VERIFIER_GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where member.rolname = '${VERIFIER_GROUP_ROLE}'
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
        pg_catalog.array_agg(namespace.nspname order by namespace.nspname),
        '{}'::text[]
      ) = array['app', 'public']::text[]
      from pg_catalog.pg_namespace as namespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
    ) as non_system_schema_usage_exact,
    not exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE')
    ) as no_non_system_schema_create,
    not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
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
      select count(*) = 2
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid in (${ALLOWED_FUNCTIONS_SQL})
    ) and not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid not in (${ALLOWED_FUNCTIONS_SQL})
    ) as exact_reachable_function_surface_allowed,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema')
        and namespace.nspname !~ '^pg_(toast|temp)'
        and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'USAGE')
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.prosecdef
        and routine.oid not in (${ALLOWED_FUNCTIONS_SQL})
    ) as no_reachable_unallowlisted_security_definer,
    (
      select count(*) = 2 and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and owner.rolname = 'postgres'
      )
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_roles as owner on owner.oid = routine.proowner
      where routine.oid in (${ALLOWED_FUNCTIONS_SQL})
    ) as allowed_functions_hardened,
    exists (
      select 1 from pg_catalog.pg_proc as routine
      where routine.oid = ${AUTHORITY_FUNCTION_SQL}
        and routine.pronargs = 3 and routine.pronargdefaults = 0
        and not routine.proretset
        and routine.prorettype = pg_catalog.to_regtype('pg_catalog.jsonb')::pg_catalog.oid
        and routine.proargtypes = array[
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.timestamptz')::pg_catalog.oid
        ]::pg_catalog.oidvector
        and routine.proargnames = array[
          'p_verification_attempt_id', 'p_lease_token', 'p_occurred_at'
        ]::pg_catalog.text[]
        and pg_catalog.lower(pg_catalog.pg_get_function_result(routine.oid)) = 'jsonb'
    ) as authority_function_contract_exact,
    exists (
      select 1 from pg_catalog.pg_proc as routine
      where routine.oid = ${COMPLETION_FUNCTION_SQL}
        and routine.pronargs = 20 and routine.pronargdefaults = 0
        and routine.proretset
        and routine.prorettype = pg_catalog.to_regtype('pg_catalog.record')::pg_catalog.oid
        and pg_catalog.lower(pg_catalog.pg_get_function_result(routine.oid)) =
          'table(verification_outcome_id uuid, outcome_disposition text, outcome_reason_code text, deposit_intent_id uuid, deposit_payment_claim_id uuid, execution_job_id uuid, settlement_created boolean, already_completed boolean)'
    ) as completion_function_contract_exact,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) as privilege
      where routine.oid in (${ALLOWED_FUNCTIONS_SQL})
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select oid from pg_catalog.pg_roles where rolname = '${VERIFIER_GROUP_ROLE}')
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

export const LOAD_TRUSTED_TELEBIRR_AUTHORITY_SQL = `
  select app.load_private_live_telebirr_verification_authority(
    $1::uuid, $2::uuid, $3::timestamptz
  ) as authority_payload
`;

export const COMPLETE_TRUSTED_TELEBIRR_VERIFICATION_SQL = `
  select verification_outcome_id, outcome_disposition, outcome_reason_code,
         deposit_intent_id, deposit_payment_claim_id, execution_job_id,
         settlement_created, already_completed
    from app.complete_private_live_telebirr_verification(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
      $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
      $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
      $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
    )
`;

export const TRUSTED_TELEBIRR_VERIFIER_SINGLETON_KEYS = Object.freeze([20260821, 204500] as const);

export const TRUSTED_TELEBIRR_VERIFIER_SINGLETON_ACQUIRE_SQL = `
  select pg_catalog.pg_try_advisory_lock($1::integer, $2::integer)
    as singleton_acquired
`;
export const TRUSTED_TELEBIRR_VERIFIER_SINGLETON_HELD_SQL = `
  select exists (
    select 1 from pg_catalog.pg_locks as advisory_lock
    where advisory_lock.locktype = 'advisory'
      and advisory_lock.pid = pg_catalog.pg_backend_pid()
      and advisory_lock.database = (
        select database_catalog.oid
          from pg_catalog.pg_database as database_catalog
         where database_catalog.datname = pg_catalog.current_database()
      )
      and advisory_lock.classid = $1::integer
      and advisory_lock.objid = $2::integer
      and advisory_lock.objsubid = 2
      and advisory_lock.granted
  ) as singleton_held
`;
export const TRUSTED_TELEBIRR_VERIFIER_SINGLETON_RELEASE_SQL = `
  select pg_catalog.pg_advisory_unlock($1::integer, $2::integer)
    as singleton_released
`;

export interface TrustedTelebirrPostgresQuery {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class TrustedTelebirrPostgresRuntimeUnavailableError extends Error {
  constructor() {
    super('The trusted TeleBirr PostgreSQL runtime is unavailable.');
    this.name = 'TrustedTelebirrPostgresRuntimeUnavailableError';
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

function exactTrueRow(value: unknown): boolean {
  const record = exactRecord(value, TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS);
  return (
    record !== undefined &&
    TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS.every((key) => record[key] === true)
  );
}

function exactBooleanRow(value: unknown, key: string): boolean {
  const record = exactRecord(value, [key]);
  return record?.[key] === true;
}

export async function assertTrustedTelebirrVerifierCatalogPreflight(
  database: TrustedTelebirrPostgresQuery,
): Promise<void> {
  try {
    const result = await database.query(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL, []);
    if (result.rows.length !== 1 || !exactTrueRow(result.rows[0])) throw new Error();
  } catch {
    throw new TrustedTelebirrPostgresRuntimeUnavailableError();
  }
}

export async function probeTrustedTelebirrVerifierCatalogReadiness(
  database: TrustedTelebirrPostgresQuery,
): Promise<boolean> {
  try {
    await assertTrustedTelebirrVerifierCatalogPreflight(database);
    return true;
  } catch {
    return false;
  }
}

export class PostgresTrustedTelebirrVerifierDatabase implements TrustedTelebirrVerifierDatabase {
  constructor(private readonly database: TrustedTelebirrPostgresQuery) {}

  async loadAuthority(
    verificationAttemptId: string,
    leaseToken: string,
    occurredAt: string | null,
  ): Promise<unknown> {
    try {
      await assertTrustedTelebirrVerifierCatalogPreflight(this.database);
      const result = await this.database.query(LOAD_TRUSTED_TELEBIRR_AUTHORITY_SQL, [
        verificationAttemptId,
        leaseToken,
        occurredAt,
      ]);
      const row = exactRecord(result.rows[0], ['authority_payload']);
      if (result.rows.length !== 1 || !row || row.authority_payload === null) throw new Error();
      return row.authority_payload;
    } catch {
      throw new TrustedTelebirrPostgresRuntimeUnavailableError();
    }
  }

  async complete(input: TrustedTelebirrCompletionInput): Promise<unknown> {
    try {
      await assertTrustedTelebirrVerifierCatalogPreflight(this.database);
      const result = await this.database.query(COMPLETE_TRUSTED_TELEBIRR_VERIFICATION_SQL, [
        input.verificationAttemptId,
        input.leaseToken,
        input.completionRequestKey,
        input.observationBodyDigest,
        input.observationSignatureDigest,
        input.replayIdentity,
        input.sourceDocumentDigest,
        input.normalizedFactsDigest,
        input.observedAt,
        input.protocolDisposition,
        input.protocolReasonCode,
        input.assessmentInputDigest,
        input.assessedAt,
        input.disposition,
        input.reasonCode,
        input.evidenceDigest,
        input.retrievedAt,
        input.receiptPrincipalAmountMinor,
        input.occurredAt,
        input.receiverIdentityDigest,
      ]);
      if (result.rows.length !== 1) throw new Error();
      return result.rows[0];
    } catch {
      throw new TrustedTelebirrPostgresRuntimeUnavailableError();
    }
  }
}

export interface TrustedTelebirrVerifierConnectionConfig {
  readonly ca: string;
  readonly database: 'postgres';
  readonly host: string;
  readonly password: string;
  readonly port: 5432;
  readonly user: 'fetanagent_trusted_telebirr_verifier_runtime';
}

export interface TrustedTelebirrPostgresClient extends TrustedTelebirrPostgresQuery {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: (error?: Error) => void): void;
  removeListener(event: 'error' | 'end', listener: (error?: Error) => void): void;
}

interface PgModule {
  readonly Client: new (config: Readonly<Record<string, unknown>>) => TrustedTelebirrPostgresClient;
}

export interface TrustedTelebirrPostgresRuntimeDependencies {
  readonly createClient?: (
    config: Readonly<Record<string, unknown>>,
  ) => TrustedTelebirrPostgresClient;
}

export interface TrustedTelebirrPostgresRuntime {
  readonly database: TrustedTelebirrVerifierDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createTrustedTelebirrPostgresRuntime(
  connection: TrustedTelebirrVerifierConnectionConfig,
  dependencies: TrustedTelebirrPostgresRuntimeDependencies = {},
): Promise<TrustedTelebirrPostgresRuntime> {
  const { ca, ...postgresConnection } = connection;
  const clientConfig = Object.freeze({
    ...postgresConnection,
    application_name: 'fetanagent_trusted_telebirr_verifier',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    ssl: { ca, rejectUnauthorized: true },
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

  const guarded: TrustedTelebirrPostgresQuery = {
    async query(query, values) {
      if (!available || closed) throw new TrustedTelebirrPostgresRuntimeUnavailableError();
      try {
        const result = await client.query(query, values);
        if (!available || closed) throw new Error();
        return result;
      } catch {
        markUnavailable();
        throw new TrustedTelebirrPostgresRuntimeUnavailableError();
      }
    },
  };

  try {
    await client.connect();
    available = true;
    const acquired = await guarded.query(TRUSTED_TELEBIRR_VERIFIER_SINGLETON_ACQUIRE_SQL, [
      ...TRUSTED_TELEBIRR_VERIFIER_SINGLETON_KEYS,
    ]);
    if (acquired.rows.length !== 1 || !exactBooleanRow(acquired.rows[0], 'singleton_acquired')) {
      throw new Error();
    }
    lockHeld = true;
    await assertTrustedTelebirrVerifierCatalogPreflight(guarded);
  } catch {
    available = false;
    lockHeld = false;
    await client.end().catch(() => undefined);
    client.removeListener('error', markUnavailable);
    client.removeListener('end', markUnavailable);
    throw new TrustedTelebirrPostgresRuntimeUnavailableError();
  }

  const database = new PostgresTrustedTelebirrVerifierDatabase(guarded);
  return Object.freeze({
    database,
    async ready() {
      if (!available || closed || !lockHeld) return false;
      try {
        const held = await guarded.query(TRUSTED_TELEBIRR_VERIFIER_SINGLETON_HELD_SQL, [
          ...TRUSTED_TELEBIRR_VERIFIER_SINGLETON_KEYS,
        ]);
        if (held.rows.length !== 1 || !exactBooleanRow(held.rows[0], 'singleton_held')) {
          markUnavailable();
          return false;
        }
        await assertTrustedTelebirrVerifierCatalogPreflight(guarded);
        return available && !closed && lockHeld;
      } catch {
        markUnavailable();
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      available = false;
      let failed = false;
      if (lockHeld) {
        try {
          const released = await client.query(TRUSTED_TELEBIRR_VERIFIER_SINGLETON_RELEASE_SQL, [
            ...TRUSTED_TELEBIRR_VERIFIER_SINGLETON_KEYS,
          ]);
          if (
            released.rows.length !== 1 ||
            !exactBooleanRow(released.rows[0], 'singleton_released')
          ) {
            failed = true;
          }
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
      if (failed) throw new TrustedTelebirrPostgresRuntimeUnavailableError();
    },
  });
}
