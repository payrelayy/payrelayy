import { createRequire } from 'node:module';
import { types as nodeUtilTypes } from 'node:util';

import type {
  TelebirrAssignmentBrokerDatabase,
  TelebirrAssignmentLease,
  TelebirrAssignmentLeaseRequest,
  TelebirrAssignmentPersistenceRequest,
  TelebirrPersistedAssignmentSignature,
} from './telebirr-assignment-broker.js';

const BROKER_GROUP_ROLE = 'fetanagent_telebirr_assignment_broker';
const BROKER_RUNTIME_ROLE = 'fetanagent_telebirr_assignment_broker_runtime';
const LEASE_FUNCTION = 'app.lease_private_live_telebirr_assignment_broker(uuid,text,uuid,integer)';
const PERSIST_FUNCTION =
  'app.persist_private_live_telebirr_assignment_broker_signature(uuid,uuid,uuid,text,text,text,text)';
const LEASE_FUNCTION_SQL = `pg_catalog.to_regprocedure('${LEASE_FUNCTION}')`;
const PERSIST_FUNCTION_SQL = `pg_catalog.to_regprocedure('${PERSIST_FUNCTION}')`;
const ALLOWED_FUNCTIONS_SQL = `${LEASE_FUNCTION_SQL}, ${PERSIST_FUNCTION_SQL}`;

export const TELEBIRR_ASSIGNMENT_BROKER_PREFLIGHT_KEYS = [
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
  'lease_function_contract_exact',
  'persist_function_contract_exact',
  'allowed_functions_execution_private',
  'default_function_execution_private',
] as const;

export const TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${BROKER_RUNTIME_ROLE}' and session_user = current_user
      as runtime_login_identity_allowed,
    exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = current_user
        and role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 1 and role.rolvaliduntil is not null
        and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
        and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
    ) as runtime_login_is_safe,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        granted.rolname = '${BROKER_GROUP_ROLE}' and membership.inherit_option
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
      where granted.rolname = '${BROKER_RUNTIME_ROLE}'
    ) as runtime_only_trusted_members,
    exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = '${BROKER_GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${BROKER_GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${BROKER_GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select
        count(*) filter (
          where member.rolname = '${BROKER_RUNTIME_ROLE}'
            and membership.inherit_option
            and not membership.set_option
            and not membership.admin_option
        ) = 1
        and count(*) filter (where member.rolname = 'postgres') <= 1
        and pg_catalog.bool_and(
          (
            member.rolname = '${BROKER_RUNTIME_ROLE}'
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
      where granted.rolname = '${BROKER_GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member on member.oid = membership.member
      where member.rolname = '${BROKER_GROUP_ROLE}'
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
      select count(*) = 2
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
      select count(*) = 2 and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and owner.rolname = 'postgres'
      )
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_roles owner on owner.oid = routine.proowner
      where routine.oid in (${ALLOWED_FUNCTIONS_SQL})
    ) as allowed_functions_hardened,
    exists (
      select 1 from pg_catalog.pg_proc routine
      where routine.oid = ${LEASE_FUNCTION_SQL}
        and routine.pronargs = 4 and routine.pronargdefaults = 0 and routine.proretset
        and routine.prorettype = pg_catalog.to_regtype('pg_catalog.record')::pg_catalog.oid
        and pg_catalog.lower(pg_catalog.pg_get_function_result(routine.oid)) =
          'table(verification_attempt_id uuid, lease_token uuid, job_id uuid, attempt_number integer, request_id uuid, assignment_id uuid, lease_nonce_digest text, challenge_id uuid, challenge_digest text, issued_at timestamp with time zone, expires_at timestamp with time zone, pilot_revision_id uuid, device_enrollment_id uuid, device_id text, device_key_id text, device_public_key_spki_sha256 text, receiver_revision_id uuid, receiver_profile_id uuid, receiver_profile_digest text, receiver_configuration_digest text, expected_receiver_name_digest text, receiver_name_normalizer_version text, source_profile text, adapter_version text, parser_version text, facts_normalizer_version text, candidate_reference_ciphertext text, candidate_reference_fingerprint text, reference_encryption_key_version smallint, reference_profile_version smallint, replayed boolean)'
    ) as lease_function_contract_exact,
    exists (
      select 1 from pg_catalog.pg_proc routine
      where routine.oid = ${PERSIST_FUNCTION_SQL}
        and routine.pronargs = 7 and routine.pronargdefaults = 0 and routine.proretset
        and routine.prorettype = pg_catalog.to_regtype('pg_catalog.record')::pg_catalog.oid
        and pg_catalog.lower(pg_catalog.pg_get_function_result(routine.oid)) =
          'table(assignment_signature text, assignment_signature_digest text, signed_at timestamp with time zone, replayed boolean)'
    ) as persist_function_contract_exact,
    not exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) privilege
      where routine.oid in (${ALLOWED_FUNCTIONS_SQL})
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select oid from pg_catalog.pg_roles where rolname = '${BROKER_GROUP_ROLE}')
        )
    ) as allowed_functions_execution_private,
    exists (
      select 1 from pg_catalog.pg_default_acl defaults
      join pg_catalog.pg_roles owner on owner.oid = defaults.defaclrole
      join pg_catalog.pg_namespace namespace on namespace.oid = defaults.defaclnamespace
      where owner.rolname = 'postgres' and namespace.nspname = 'app'
        and defaults.defaclobjtype = 'f'
        and not exists (
          select 1 from pg_catalog.aclexplode(defaults.defaclacl) privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        )
    ) as default_function_execution_private
`;

export const LEASE_TELEBIRR_ASSIGNMENT_SQL = `
  select * from app.lease_private_live_telebirr_assignment_broker(
    $1::uuid, $2::text, $3::uuid, $4::integer
  )
`;
export const PERSIST_TELEBIRR_ASSIGNMENT_SIGNATURE_SQL = `
  select * from app.persist_private_live_telebirr_assignment_broker_signature(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text
  )
`;

// Stable four-byte protocol namespaces ("FETA" / "TBRR"), never a calendar date or shutdown key.
export const TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_KEYS = Object.freeze([
  0x46455441, 0x54425252,
] as const);
export const TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_ACQUIRE_SQL = `
  select pg_catalog.pg_try_advisory_lock($1::integer, $2::integer)
    as singleton_acquired
`;
export const TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_HELD_SQL = `
  select exists (
    select 1 from pg_catalog.pg_locks advisory_lock
    where advisory_lock.locktype = 'advisory'
      and advisory_lock.pid = pg_catalog.pg_backend_pid()
      and advisory_lock.database = (
        select database_catalog.oid from pg_catalog.pg_database database_catalog
        where database_catalog.datname = pg_catalog.current_database()
      )
      and advisory_lock.classid = $1::integer
      and advisory_lock.objid = $2::integer
      and advisory_lock.objsubid = 2
      and advisory_lock.granted
  ) as singleton_held
`;
export const TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_RELEASE_SQL = `
  select pg_catalog.pg_advisory_unlock($1::integer, $2::integer)
    as singleton_released
`;

const LEASE_ROW_KEYS = [
  'verification_attempt_id',
  'lease_token',
  'job_id',
  'attempt_number',
  'request_id',
  'assignment_id',
  'lease_nonce_digest',
  'challenge_id',
  'challenge_digest',
  'issued_at',
  'expires_at',
  'pilot_revision_id',
  'device_enrollment_id',
  'device_id',
  'device_key_id',
  'device_public_key_spki_sha256',
  'receiver_revision_id',
  'receiver_profile_id',
  'receiver_profile_digest',
  'receiver_configuration_digest',
  'expected_receiver_name_digest',
  'receiver_name_normalizer_version',
  'source_profile',
  'adapter_version',
  'parser_version',
  'facts_normalizer_version',
  'candidate_reference_ciphertext',
  'candidate_reference_fingerprint',
  'reference_encryption_key_version',
  'reference_profile_version',
  'replayed',
] as const;
const PERSIST_ROW_KEYS = [
  'assignment_signature',
  'assignment_signature_digest',
  'signed_at',
  'replayed',
] as const;

export interface TelebirrAssignmentBrokerPostgresQuery {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class TelebirrAssignmentBrokerPostgresUnavailableError extends Error {
  constructor() {
    super('The TeleBirr assignment broker PostgreSQL runtime is unavailable.');
    this.name = 'TelebirrAssignmentBrokerPostgresUnavailableError';
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    nodeUtilTypes.isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return undefined;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function exactTrueRow(value: unknown): boolean {
  const row = exactRecord(value, TELEBIRR_ASSIGNMENT_BROKER_PREFLIGHT_KEYS);
  return (
    row !== undefined && TELEBIRR_ASSIGNMENT_BROKER_PREFLIGHT_KEYS.every((key) => row[key] === true)
  );
}

function exactBooleanRow(value: unknown, key: string): boolean {
  return exactRecord(value, [key])?.[key] === true;
}

function timestamp(value: unknown): string | undefined {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export async function assertTelebirrAssignmentBrokerCatalogPreflight(
  database: TelebirrAssignmentBrokerPostgresQuery,
): Promise<void> {
  try {
    const result = await database.query(TELEBIRR_ASSIGNMENT_BROKER_CATALOG_PREFLIGHT_SQL, []);
    if (result.rows.length !== 1 || !exactTrueRow(result.rows[0])) throw new Error();
  } catch {
    throw new TelebirrAssignmentBrokerPostgresUnavailableError();
  }
}

export class PostgresTelebirrAssignmentBrokerDatabase implements TelebirrAssignmentBrokerDatabase {
  constructor(private readonly database: TelebirrAssignmentBrokerPostgresQuery) {}

  async leaseAssignment(
    request: TelebirrAssignmentLeaseRequest,
  ): Promise<TelebirrAssignmentLease | null> {
    try {
      await assertTelebirrAssignmentBrokerCatalogPreflight(this.database);
      const result = await this.database.query(LEASE_TELEBIRR_ASSIGNMENT_SQL, [
        request.deviceEnrollmentId,
        request.leasedBy,
        request.leaseRequestKey,
        request.requestedLeaseSeconds,
      ]);
      if (result.rows.length === 0) return null;
      const row = exactRecord(result.rows[0], LEASE_ROW_KEYS);
      const issuedAt = timestamp(row?.issued_at);
      const expiresAt = timestamp(row?.expires_at);
      if (result.rows.length !== 1 || row === undefined || !issuedAt || !expiresAt)
        throw new Error();
      return Object.freeze({
        verificationAttemptId: row.verification_attempt_id as string,
        leaseToken: row.lease_token as string,
        jobId: row.job_id as string,
        attemptNumber: row.attempt_number as number,
        requestId: row.request_id as string,
        assignmentId: row.assignment_id as string,
        leaseNonceDigest: row.lease_nonce_digest as string,
        challengeId: row.challenge_id as string,
        challengeDigest: row.challenge_digest as string,
        issuedAt,
        expiresAt,
        pilotRevisionId: row.pilot_revision_id as string,
        deviceEnrollmentId: row.device_enrollment_id as string,
        deviceId: row.device_id as string,
        deviceKeyId: row.device_key_id as string,
        devicePublicKeySpkiSha256: row.device_public_key_spki_sha256 as string,
        receiverRevisionId: row.receiver_revision_id as string,
        receiverProfileId: row.receiver_profile_id as string,
        receiverProfileDigest: row.receiver_profile_digest as string,
        receiverConfigurationDigest: row.receiver_configuration_digest as string,
        expectedReceiverNameDigest: row.expected_receiver_name_digest as string,
        receiverNameNormalizerVersion:
          row.receiver_name_normalizer_version as TelebirrAssignmentLease['receiverNameNormalizerVersion'],
        sourceProfile: row.source_profile as TelebirrAssignmentLease['sourceProfile'],
        adapterVersion: row.adapter_version as TelebirrAssignmentLease['adapterVersion'],
        parserVersion: row.parser_version as TelebirrAssignmentLease['parserVersion'],
        factsNormalizerVersion:
          row.facts_normalizer_version as TelebirrAssignmentLease['factsNormalizerVersion'],
        candidateReferenceCiphertext: row.candidate_reference_ciphertext as string,
        candidateReferenceFingerprint: row.candidate_reference_fingerprint as string,
        referenceEncryptionKeyVersion: row.reference_encryption_key_version as 2,
        referenceProfileVersion: row.reference_profile_version as 2,
        replayed: row.replayed as boolean,
      });
    } catch {
      throw new TelebirrAssignmentBrokerPostgresUnavailableError();
    }
  }

  async persistAssignmentSignature(
    request: TelebirrAssignmentPersistenceRequest,
  ): Promise<TelebirrPersistedAssignmentSignature> {
    try {
      await assertTelebirrAssignmentBrokerCatalogPreflight(this.database);
      const result = await this.database.query(PERSIST_TELEBIRR_ASSIGNMENT_SIGNATURE_SQL, [
        request.verificationAttemptId,
        request.leaseToken,
        request.assignmentSignerId,
        request.assignmentBodyDigest,
        request.proposedAssignmentSignature,
        request.proposedAssignmentSignatureDigest,
        request.referenceBindingDigest,
      ]);
      const row = exactRecord(result.rows[0], PERSIST_ROW_KEYS);
      if (result.rows.length !== 1 || row === undefined || !timestamp(row.signed_at))
        throw new Error();
      return Object.freeze({
        assignmentSignature: row.assignment_signature as string,
        assignmentSignatureDigest: row.assignment_signature_digest as string,
        replayed: row.replayed as boolean,
      });
    } catch {
      throw new TelebirrAssignmentBrokerPostgresUnavailableError();
    }
  }
}

export interface TelebirrAssignmentBrokerConnectionConfig {
  readonly ca: string;
  readonly database: 'postgres';
  readonly host: string;
  readonly password: string;
  readonly port: 5432;
  readonly user: 'fetanagent_telebirr_assignment_broker_runtime';
}

export interface TelebirrAssignmentBrokerPostgresClient extends TelebirrAssignmentBrokerPostgresQuery {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: (error?: Error) => void): void;
  removeListener(event: 'error' | 'end', listener: (error?: Error) => void): void;
}

interface PgModule {
  readonly Client: new (
    config: Readonly<Record<string, unknown>>,
  ) => TelebirrAssignmentBrokerPostgresClient;
}

export interface TelebirrAssignmentBrokerPostgresRuntimeDependencies {
  readonly createClient?: (
    config: Readonly<Record<string, unknown>>,
  ) => TelebirrAssignmentBrokerPostgresClient;
}

export interface TelebirrAssignmentBrokerPostgresRuntime {
  readonly database: TelebirrAssignmentBrokerDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createTelebirrAssignmentBrokerPostgresRuntime(
  connection: TelebirrAssignmentBrokerConnectionConfig,
  dependencies: TelebirrAssignmentBrokerPostgresRuntimeDependencies = {},
): Promise<TelebirrAssignmentBrokerPostgresRuntime> {
  const { ca, ...postgresConnection } = connection;
  const clientConfig = Object.freeze({
    ...postgresConnection,
    application_name: 'fetanagent_telebirr_assignment_broker',
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

  const guarded: TelebirrAssignmentBrokerPostgresQuery = {
    async query(query, values) {
      if (!available || closed) throw new TelebirrAssignmentBrokerPostgresUnavailableError();
      try {
        const result = await client.query(query, values);
        if (!available || closed) throw new Error();
        return result;
      } catch {
        markUnavailable();
        throw new TelebirrAssignmentBrokerPostgresUnavailableError();
      }
    },
  };

  try {
    await client.connect();
    available = true;
    const acquired = await guarded.query(TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_ACQUIRE_SQL, [
      ...TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_KEYS,
    ]);
    if (acquired.rows.length !== 1 || !exactBooleanRow(acquired.rows[0], 'singleton_acquired')) {
      throw new Error();
    }
    lockHeld = true;
    await assertTelebirrAssignmentBrokerCatalogPreflight(guarded);
  } catch {
    available = false;
    lockHeld = false;
    await client.end().catch(() => undefined);
    client.removeListener('error', markUnavailable);
    client.removeListener('end', markUnavailable);
    throw new TelebirrAssignmentBrokerPostgresUnavailableError();
  }

  return Object.freeze({
    database: new PostgresTelebirrAssignmentBrokerDatabase(guarded),
    async ready() {
      if (!available || closed || !lockHeld) return false;
      try {
        const held = await guarded.query(TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_HELD_SQL, [
          ...TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_KEYS,
        ]);
        if (held.rows.length !== 1 || !exactBooleanRow(held.rows[0], 'singleton_held')) {
          markUnavailable();
          return false;
        }
        await assertTelebirrAssignmentBrokerCatalogPreflight(guarded);
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
          const released = await client.query(TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_RELEASE_SQL, [
            ...TELEBIRR_ASSIGNMENT_BROKER_SINGLETON_KEYS,
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
      if (failed) throw new TelebirrAssignmentBrokerPostgresUnavailableError();
    },
  });
}
