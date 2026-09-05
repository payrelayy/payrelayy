import { createRequire } from 'node:module';
import { types as nodeUtilTypes } from 'node:util';

import {
  decodeSignedTelebirrDeviceBridgeEnrollmentCertificate,
  decodeSignedTelebirrDeviceBridgePairingRequest,
  decodeSignedTelebirrDeviceBridgeRequest,
  decodeTelebirrDeviceBridgeEnrollmentCertificateBody,
  decodeTelebirrDeviceBridgeHeartbeatPayload,
  decodeTelebirrDeviceBridgeObservationUploadPayload,
  digestTelebirrDeviceBridgePayload,
  telebirrDeviceBridgeCertificateMatchesPairingRequest,
} from '@fetanagent/telebirr-verification-foundation';

import {
  decodeTelebirrDeviceStateCommandResponse,
  type TelebirrDeviceStateDatabase,
  type TelebirrDeviceStateEvidenceResult,
  type TelebirrDeviceStateHeartbeatResult,
  type TelebirrDeviceStatePairingClaim,
  type TelebirrDeviceStateReplayClaim,
} from './telebirr-device-state.js';

const DEVICE_STATE_GROUP_ROLE = 'fetanagent_telebirr_device_state';
const DEVICE_STATE_RUNTIME_ROLE = 'fetanagent_telebirr_device_state_runtime';

const CLAIM_PAIRING_FUNCTION =
  'app.claim_private_telebirr_device_pairing(uuid,text,text,text,text,text,text,text,timestamptz,timestamptz)';
const COMPLETE_PAIRING_FUNCTION =
  'app.complete_private_telebirr_device_pairing(text,text,text,text,jsonb)';
const RELEASE_PAIRING_FUNCTION = 'app.release_private_telebirr_device_pairing(text)';
const LOAD_ENROLLMENT_FUNCTION = 'app.load_private_telebirr_device_enrollment(uuid)';
const CLAIM_REPLAY_FUNCTION = 'app.claim_private_telebirr_device_replay(text,timestamptz)';
const COMPLETE_REPLAY_FUNCTION =
  'app.complete_private_telebirr_device_replay(text,jsonb,timestamptz)';
const RELEASE_REPLAY_FUNCTION = 'app.release_private_telebirr_device_replay(text)';
const HEARTBEAT_FUNCTION =
  'app.record_private_telebirr_device_heartbeat(uuid,text,text,text,text,timestamptz)';
const STAGE_EVIDENCE_FUNCTION =
  'app.stage_private_telebirr_device_evidence(uuid,text,text,text,jsonb,jsonb)';

const ALLOWED_FUNCTIONS = [
  CLAIM_PAIRING_FUNCTION,
  COMPLETE_PAIRING_FUNCTION,
  RELEASE_PAIRING_FUNCTION,
  LOAD_ENROLLMENT_FUNCTION,
  CLAIM_REPLAY_FUNCTION,
  COMPLETE_REPLAY_FUNCTION,
  RELEASE_REPLAY_FUNCTION,
  HEARTBEAT_FUNCTION,
  STAGE_EVIDENCE_FUNCTION,
] as const;
const ALLOWED_FUNCTIONS_SQL = ALLOWED_FUNCTIONS.map(
  (signature) => `pg_catalog.to_regprocedure('${signature}')`,
).join(', ');

export const TELEBIRR_DEVICE_STATE_PREFLIGHT_KEYS = [
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

export const TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${DEVICE_STATE_RUNTIME_ROLE}' and session_user = current_user
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
        granted.rolname = '${DEVICE_STATE_GROUP_ROLE}' and membership.inherit_option
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
      where granted.rolname = '${DEVICE_STATE_RUNTIME_ROLE}'
    ) as runtime_only_trusted_members,
    exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = '${DEVICE_STATE_GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${DEVICE_STATE_GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${DEVICE_STATE_GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select
        count(*) filter (
          where member.rolname = '${DEVICE_STATE_RUNTIME_ROLE}'
            and membership.inherit_option
            and not membership.set_option
            and not membership.admin_option
        ) = 1
        and count(*) filter (where member.rolname = 'postgres') <= 1
        and pg_catalog.bool_and(
          (
            member.rolname = '${DEVICE_STATE_RUNTIME_ROLE}'
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
      where granted.rolname = '${DEVICE_STATE_GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member on member.oid = membership.member
      where member.rolname = '${DEVICE_STATE_GROUP_ROLE}'
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
      select count(*) = 9
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
      select count(*) = 9 and pg_catalog.bool_and(
        routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and owner.rolname = 'postgres'
      )
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_roles owner on owner.oid = routine.proowner
      where routine.oid in (${ALLOWED_FUNCTIONS_SQL})
    ) as allowed_functions_hardened,
    (
      select count(*) = 9 and pg_catalog.bool_and(
        routine.pronargs = expected.argument_count
        and routine.pronargdefaults = 0
        and routine.proretset = expected.returns_set
        and routine.prorettype = pg_catalog.to_regtype(expected.return_type)::pg_catalog.oid
        and pg_catalog.lower(pg_catalog.pg_get_function_result(routine.oid)) = expected.result
      )
      from (values
        (pg_catalog.to_regprocedure('${CLAIM_PAIRING_FUNCTION}'), 10, true,
          'pg_catalog.record',
          'table(claim_state text, certificate_body jsonb, signed_certificate jsonb)'),
        (pg_catalog.to_regprocedure('${COMPLETE_PAIRING_FUNCTION}'), 5, false,
          'pg_catalog.bool', 'boolean'),
        (pg_catalog.to_regprocedure('${RELEASE_PAIRING_FUNCTION}'), 1, false,
          'pg_catalog.void', 'void'),
        (pg_catalog.to_regprocedure('${LOAD_ENROLLMENT_FUNCTION}'), 1, false,
          'pg_catalog.jsonb', 'jsonb'),
        (pg_catalog.to_regprocedure('${CLAIM_REPLAY_FUNCTION}'), 2, true,
          'pg_catalog.record',
          'table(claim_state text, response jsonb)'),
        (pg_catalog.to_regprocedure('${COMPLETE_REPLAY_FUNCTION}'), 3, false,
          'pg_catalog.bool', 'boolean'),
        (pg_catalog.to_regprocedure('${RELEASE_REPLAY_FUNCTION}'), 1, false,
          'pg_catalog.void', 'void'),
        (pg_catalog.to_regprocedure('${HEARTBEAT_FUNCTION}'), 6, true,
          'pg_catalog.record',
          'table(outcome text, reason_code text)'),
        (pg_catalog.to_regprocedure('${STAGE_EVIDENCE_FUNCTION}'), 6, true,
          'pg_catalog.record',
          'table(outcome text, reason_code text, replayed boolean)')
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
          (select oid from pg_catalog.pg_roles where rolname = '${DEVICE_STATE_GROUP_ROLE}')
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

export const CLAIM_TELEBIRR_DEVICE_PAIRING_SQL = `
  select * from app.claim_private_telebirr_device_pairing(
    $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
    $7::text, $8::text, $9::timestamptz, $10::timestamptz
  )
`;
export const COMPLETE_TELEBIRR_DEVICE_PAIRING_SQL = `
  select app.complete_private_telebirr_device_pairing(
    $1::text, $2::text, $3::text, $4::text, $5::jsonb
  ) as completed
`;
export const RELEASE_TELEBIRR_DEVICE_PAIRING_SQL = `
  select app.release_private_telebirr_device_pairing($1::text) as released
`;
export const LOAD_TELEBIRR_DEVICE_ENROLLMENT_SQL = `
  select app.load_private_telebirr_device_enrollment($1::uuid) as certificate
`;
export const CLAIM_TELEBIRR_DEVICE_REPLAY_SQL = `
  select * from app.claim_private_telebirr_device_replay($1::text, $2::timestamptz)
`;
export const COMPLETE_TELEBIRR_DEVICE_REPLAY_SQL = `
  select app.complete_private_telebirr_device_replay(
    $1::text, $2::jsonb, $3::timestamptz
  ) as completed
`;
export const RELEASE_TELEBIRR_DEVICE_REPLAY_SQL = `
  select app.release_private_telebirr_device_replay($1::text) as released
`;
export const RECORD_TELEBIRR_DEVICE_HEARTBEAT_SQL = `
  select * from app.record_private_telebirr_device_heartbeat(
    $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::timestamptz
  )
`;
export const STAGE_TELEBIRR_DEVICE_EVIDENCE_SQL = `
  select * from app.stage_private_telebirr_device_evidence(
    $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb
  )
`;

// Stable four-byte protocol namespaces ("FETA" / "TDST"), never a date or shutdown key.
export const TELEBIRR_DEVICE_STATE_SINGLETON_KEYS = Object.freeze([
  0x46455441, 0x54445354,
] as const);
export const TELEBIRR_DEVICE_STATE_SINGLETON_ACQUIRE_SQL = `
  select pg_catalog.pg_try_advisory_lock($1::integer, $2::integer)
    as singleton_acquired
`;
export const TELEBIRR_DEVICE_STATE_SINGLETON_HELD_SQL = `
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
export const TELEBIRR_DEVICE_STATE_SINGLETON_RELEASE_SQL = `
  select pg_catalog.pg_advisory_unlock($1::integer, $2::integer)
    as singleton_released
`;

const PAIRING_CLAIM_ROW_KEYS = ['claim_state', 'certificate_body', 'signed_certificate'] as const;
const REPLAY_CLAIM_ROW_KEYS = ['claim_state', 'response'] as const;
const HEARTBEAT_ROW_KEYS = ['outcome', 'reason_code'] as const;
const EVIDENCE_ROW_KEYS = ['outcome', 'reason_code', 'replayed'] as const;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export interface TelebirrDeviceStatePostgresQuery {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class TelebirrDeviceStatePostgresUnavailableError extends Error {
  constructor() {
    super('The TeleBirr device-state PostgreSQL runtime is unavailable.');
    this.name = 'TelebirrDeviceStatePostgresUnavailableError';
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
  const row = exactRecord(value, TELEBIRR_DEVICE_STATE_PREFLIGHT_KEYS);
  return (
    row !== undefined && TELEBIRR_DEVICE_STATE_PREFLIGHT_KEYS.every((key) => row[key] === true)
  );
}

function exactBooleanRow(value: unknown, key: string): boolean | undefined {
  const candidate = exactRecord(value, [key])?.[key];
  return typeof candidate === 'boolean' ? candidate : undefined;
}

function exactNullRow(value: unknown, key: string): boolean {
  return exactRecord(value, [key])?.[key] === null;
}

function canonicalTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function uuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function sha256Digest(value: unknown): value is string {
  return typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value);
}

function pairingBodyMatchesRequest(
  body: ReturnType<typeof decodeTelebirrDeviceBridgeEnrollmentCertificateBody>,
  request: ReturnType<typeof decodeSignedTelebirrDeviceBridgePairingRequest>,
): boolean {
  return Boolean(
    body &&
    request &&
    body.pairingId === request.body.pairingId &&
    body.pairingRequestBodyDigest === request.bodyDigest &&
    body.pairingNonceDigest === request.body.pairingNonceDigest &&
    body.deviceId === request.body.deviceId &&
    body.keyId === request.body.keyId &&
    body.devicePublicKeySpki === request.body.devicePublicKeySpki &&
    body.devicePublicKeySpkiSha256 === request.body.devicePublicKeySpkiSha256,
  );
}

export async function assertTelebirrDeviceStateCatalogPreflight(
  database: TelebirrDeviceStatePostgresQuery,
): Promise<void> {
  try {
    const result = await database.query(TELEBIRR_DEVICE_STATE_CATALOG_PREFLIGHT_SQL, []);
    if (result.rows.length !== 1 || !exactTrueRow(result.rows[0])) throw new Error();
  } catch {
    throw new TelebirrDeviceStatePostgresUnavailableError();
  }
}

export class PostgresTelebirrDeviceStateDatabase implements TelebirrDeviceStateDatabase {
  constructor(private readonly database: TelebirrDeviceStatePostgresQuery) {}

  async claimPairingChallenge(
    requestCandidate: Parameters<TelebirrDeviceStateDatabase['claimPairingChallenge']>[0],
    assessedAtCandidate: string,
  ): Promise<TelebirrDeviceStatePairingClaim | undefined> {
    try {
      const request = decodeSignedTelebirrDeviceBridgePairingRequest(requestCandidate);
      const assessedAt = canonicalTimestamp(assessedAtCandidate);
      if (!request || !assessedAt) throw new Error();
      if (!uuidV4(request.body.pairingId)) return undefined;
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(CLAIM_TELEBIRR_DEVICE_PAIRING_SQL, [
        request.body.pairingId,
        request.body.pairingNonceDigest,
        request.bodyDigest,
        request.body.deviceId,
        request.body.keyId,
        request.body.devicePublicKeySpki,
        request.body.devicePublicKeySpkiSha256,
        request.body.appVersion,
        request.body.issuedAt,
        request.body.expiresAt,
      ]);
      if (result.rows.length === 0) return undefined;
      const row = exactRecord(result.rows[0], PAIRING_CLAIM_ROW_KEYS);
      if (result.rows.length !== 1 || !row) throw new Error();
      if (
        row.claim_state === 'in_progress' &&
        row.certificate_body === null &&
        row.signed_certificate === null
      ) {
        return Object.freeze({ kind: 'in_progress' });
      }
      const body = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(row.certificate_body);
      if (!pairingBodyMatchesRequest(body, request)) throw new Error();
      if (row.claim_state === 'claimed' && row.signed_certificate === null) {
        return Object.freeze({ kind: 'claimed', certificateBody: body! });
      }
      const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(
        row.signed_certificate,
      );
      if (
        row.claim_state !== 'completed' ||
        !certificate ||
        !telebirrDeviceBridgeCertificateMatchesPairingRequest(certificate, request)
      ) {
        throw new Error();
      }
      return Object.freeze({ kind: 'completed', certificate });
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }

  async completePairingChallenge(
    pairingRequestBodyDigest: string,
    certificateCandidate: Parameters<TelebirrDeviceStateDatabase['completePairingChallenge']>[1],
  ): Promise<boolean> {
    try {
      const certificate =
        decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(certificateCandidate);
      if (
        !sha256Digest(pairingRequestBodyDigest) ||
        !certificate ||
        certificate.body.pairingRequestBodyDigest !== pairingRequestBodyDigest
      ) {
        throw new Error();
      }
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(COMPLETE_TELEBIRR_DEVICE_PAIRING_SQL, [
        pairingRequestBodyDigest,
        certificate.bodyDigest,
        certificate.signerKeyId,
        certificate.signature,
        certificate,
      ]);
      if (result.rows.length !== 1) throw new Error();
      const completed = exactBooleanRow(result.rows[0], 'completed');
      if (completed === undefined) throw new Error();
      return completed;
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }

  async releasePairingChallenge(pairingRequestBodyDigest: string): Promise<void> {
    await this.release(RELEASE_TELEBIRR_DEVICE_PAIRING_SQL, pairingRequestBodyDigest);
  }

  async loadEnrollment(
    enrollmentId: string,
  ): Promise<ReturnType<typeof decodeSignedTelebirrDeviceBridgeEnrollmentCertificate>> {
    try {
      if (!uuidV4(enrollmentId)) return undefined;
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(LOAD_TELEBIRR_DEVICE_ENROLLMENT_SQL, [enrollmentId]);
      const row = exactRecord(result.rows[0], ['certificate']);
      if (result.rows.length !== 1 || !row) throw new Error();
      if (row.certificate === null) return undefined;
      const certificate = decodeSignedTelebirrDeviceBridgeEnrollmentCertificate(row.certificate);
      if (!certificate) throw new Error();
      return certificate;
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }

  async claimReplay(
    replayIdentity: string,
    requestExpiresAt: string,
  ): Promise<TelebirrDeviceStateReplayClaim> {
    try {
      if (!sha256Digest(replayIdentity) || !canonicalTimestamp(requestExpiresAt)) {
        throw new Error();
      }
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(CLAIM_TELEBIRR_DEVICE_REPLAY_SQL, [
        replayIdentity,
        requestExpiresAt,
      ]);
      const row = exactRecord(result.rows[0], REPLAY_CLAIM_ROW_KEYS);
      if (result.rows.length !== 1 || !row) throw new Error();
      if (row.claim_state === 'claimed' && row.response === null) {
        return Object.freeze({ kind: 'claimed' });
      }
      if (row.claim_state === 'in_progress' && row.response === null) {
        return Object.freeze({ kind: 'in_progress' });
      }
      const response = decodeTelebirrDeviceStateCommandResponse(row.response);
      if (row.claim_state !== 'completed' || !response) throw new Error();
      return Object.freeze({ kind: 'completed', response });
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }

  async completeReplay(
    replayIdentity: string,
    responseCandidate: Parameters<TelebirrDeviceStateDatabase['completeReplay']>[1],
    requestExpiresAt: string,
  ): Promise<boolean> {
    try {
      const response = decodeTelebirrDeviceStateCommandResponse(responseCandidate);
      if (!sha256Digest(replayIdentity) || !response || !canonicalTimestamp(requestExpiresAt)) {
        throw new Error();
      }
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(COMPLETE_TELEBIRR_DEVICE_REPLAY_SQL, [
        replayIdentity,
        response,
        requestExpiresAt,
      ]);
      if (result.rows.length !== 1) throw new Error();
      const completed = exactBooleanRow(result.rows[0], 'completed');
      if (completed === undefined) throw new Error();
      return completed;
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }

  async releaseReplay(replayIdentity: string): Promise<void> {
    await this.release(RELEASE_TELEBIRR_DEVICE_REPLAY_SQL, replayIdentity);
  }

  async recordHeartbeat(
    certificateCandidate: Parameters<TelebirrDeviceStateDatabase['recordHeartbeat']>[0],
    requestCandidate: Parameters<TelebirrDeviceStateDatabase['recordHeartbeat']>[1],
    payloadCandidate: Parameters<TelebirrDeviceStateDatabase['recordHeartbeat']>[2],
  ): Promise<TelebirrDeviceStateHeartbeatResult> {
    try {
      const certificate = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(certificateCandidate);
      const request = decodeSignedTelebirrDeviceBridgeRequest(requestCandidate);
      const payload = decodeTelebirrDeviceBridgeHeartbeatPayload(payloadCandidate);
      if (
        !certificate ||
        !request ||
        !payload ||
        !uuidV4(certificate.enrollmentId) ||
        request.body.command !== 'heartbeat' ||
        digestTelebirrDeviceBridgePayload('heartbeat', payload) !== request.body.payloadDigest ||
        request.body.enrollmentId !== certificate.enrollmentId ||
        request.body.deviceId !== certificate.deviceId ||
        request.body.keyId !== certificate.keyId
      ) {
        throw new Error();
      }
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(RECORD_TELEBIRR_DEVICE_HEARTBEAT_SQL, [
        certificate.enrollmentId,
        request.bodyDigest,
        payload.runtimeState,
        payload.statusCode,
        payload.appVersion,
        request.body.issuedAt,
      ]);
      const row = exactRecord(result.rows[0], HEARTBEAT_ROW_KEYS);
      if (result.rows.length !== 1 || !row) throw new Error();
      if (row.outcome === 'accepted' && row.reason_code === null) {
        return Object.freeze({ kind: 'accepted' });
      }
      if (row.outcome === 'retry' && row.reason_code === null) {
        return Object.freeze({ kind: 'retry' });
      }
      if (
        row.outcome === 'rejected' &&
        (row.reason_code === 'device_revoked' || row.reason_code === 'pilot_stopped')
      ) {
        return Object.freeze({ kind: 'rejected', reason: row.reason_code });
      }
      throw new Error();
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }

  async stageEvidenceOnly(
    certificateCandidate: Parameters<TelebirrDeviceStateDatabase['stageEvidenceOnly']>[0],
    requestCandidate: Parameters<TelebirrDeviceStateDatabase['stageEvidenceOnly']>[1],
    payloadCandidate: Parameters<TelebirrDeviceStateDatabase['stageEvidenceOnly']>[2],
  ): Promise<TelebirrDeviceStateEvidenceResult> {
    try {
      const certificate = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(certificateCandidate);
      const request = decodeSignedTelebirrDeviceBridgeRequest(requestCandidate);
      const payload = decodeTelebirrDeviceBridgeObservationUploadPayload(payloadCandidate);
      const assignment = payload?.signedAssignment;
      const observation = payload?.signedObservation;
      if (
        !certificate ||
        !request ||
        !payload ||
        !assignment ||
        !observation ||
        !uuidV4(certificate.enrollmentId) ||
        request.body.command !== 'observation_upload' ||
        digestTelebirrDeviceBridgePayload('observation_upload', payload) !==
          request.body.payloadDigest ||
        request.body.enrollmentId !== certificate.enrollmentId ||
        request.body.deviceId !== certificate.deviceId ||
        request.body.keyId !== certificate.keyId ||
        assignment.body.deviceId !== certificate.deviceId ||
        assignment.body.keyId !== certificate.keyId ||
        assignment.body.pilotRevisionId !== certificate.pilotRevisionId ||
        assignment.body.receiverRevisionId !== certificate.receiverRevisionId ||
        assignment.body.receiverProfileId !== certificate.receiverProfileId ||
        assignment.body.receiverProfileDigest !== certificate.receiverProfileDigest ||
        assignment.body.receiverConfigurationDigest !== certificate.receiverConfigurationDigest ||
        assignment.signerKeyId !== certificate.assignmentSignerKeyId ||
        observation.body.deviceId !== certificate.deviceId ||
        observation.body.keyId !== certificate.keyId ||
        observation.body.assignmentBodyDigest !== assignment.bodyDigest
      ) {
        throw new Error();
      }
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(STAGE_TELEBIRR_DEVICE_EVIDENCE_SQL, [
        certificate.enrollmentId,
        request.bodyDigest,
        assignment.bodyDigest,
        observation.bodyDigest,
        assignment,
        observation,
      ]);
      const row = exactRecord(result.rows[0], EVIDENCE_ROW_KEYS);
      if (result.rows.length !== 1 || !row) throw new Error();
      if (
        row.outcome === 'accepted' &&
        row.reason_code === null &&
        typeof row.replayed === 'boolean'
      ) {
        return Object.freeze({ kind: 'accepted', replayed: row.replayed });
      }
      if (row.outcome === 'retry' && row.reason_code === null && row.replayed === false) {
        return Object.freeze({ kind: 'retry' });
      }
      if (
        row.outcome === 'rejected' &&
        row.replayed === false &&
        (row.reason_code === 'binding_mismatch' ||
          row.reason_code === 'device_revoked' ||
          row.reason_code === 'observation_rejected' ||
          row.reason_code === 'pilot_stopped')
      ) {
        return Object.freeze({ kind: 'rejected', reason: row.reason_code });
      }
      throw new Error();
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }

  private async release(query: string, identity: string): Promise<void> {
    try {
      if (!sha256Digest(identity)) throw new Error();
      await assertTelebirrDeviceStateCatalogPreflight(this.database);
      const result = await this.database.query(query, [identity]);
      if (result.rows.length !== 1 || !exactNullRow(result.rows[0], 'released')) {
        throw new Error();
      }
    } catch (error) {
      if (error instanceof TelebirrDeviceStatePostgresUnavailableError) throw error;
      throw new TelebirrDeviceStatePostgresUnavailableError();
    }
  }
}

export interface TelebirrDeviceStateConnectionConfig {
  readonly ca: string;
  readonly database: 'postgres';
  readonly host: string;
  readonly password: string;
  readonly port: 5432;
  readonly user:
    | 'fetanagent_telebirr_device_state_runtime'
    | 'fetanagent_telebirr_device_state_runtime.spzpiyxheappsfyswewl';
}

export interface TelebirrDeviceStatePostgresClient extends TelebirrDeviceStatePostgresQuery {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: (error?: Error) => void): void;
  removeListener(event: 'error' | 'end', listener: (error?: Error) => void): void;
}

interface PgModule {
  readonly Client: new (
    config: Readonly<Record<string, unknown>>,
  ) => TelebirrDeviceStatePostgresClient;
}

export interface TelebirrDeviceStatePostgresRuntimeDependencies {
  readonly createClient?: (
    config: Readonly<Record<string, unknown>>,
  ) => TelebirrDeviceStatePostgresClient;
}

export interface TelebirrDeviceStatePostgresRuntime {
  readonly database: TelebirrDeviceStateDatabase;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createTelebirrDeviceStatePostgresRuntime(
  connection: TelebirrDeviceStateConnectionConfig,
  dependencies: TelebirrDeviceStatePostgresRuntimeDependencies = {},
): Promise<TelebirrDeviceStatePostgresRuntime> {
  const { ca, ...postgresConnection } = connection;
  const clientConfig = Object.freeze({
    ...postgresConnection,
    application_name: 'fetanagent_telebirr_device_state',
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

  const guarded: TelebirrDeviceStatePostgresQuery = {
    async query(query, values) {
      if (!available || closed) throw new TelebirrDeviceStatePostgresUnavailableError();
      try {
        const result = await client.query(query, values);
        if (!available || closed) throw new Error();
        return result;
      } catch {
        markUnavailable();
        throw new TelebirrDeviceStatePostgresUnavailableError();
      }
    },
  };

  try {
    await client.connect();
    available = true;
    const acquired = await guarded.query(TELEBIRR_DEVICE_STATE_SINGLETON_ACQUIRE_SQL, [
      ...TELEBIRR_DEVICE_STATE_SINGLETON_KEYS,
    ]);
    if (acquired.rows.length !== 1 || !exactBooleanRow(acquired.rows[0], 'singleton_acquired')) {
      throw new Error();
    }
    lockHeld = true;
    await assertTelebirrDeviceStateCatalogPreflight(guarded);
  } catch {
    available = false;
    lockHeld = false;
    await client.end().catch(() => undefined);
    client.removeListener('error', markUnavailable);
    client.removeListener('end', markUnavailable);
    throw new TelebirrDeviceStatePostgresUnavailableError();
  }

  return Object.freeze({
    database: new PostgresTelebirrDeviceStateDatabase(guarded),
    async ready() {
      if (!available || closed || !lockHeld) return false;
      try {
        const held = await guarded.query(TELEBIRR_DEVICE_STATE_SINGLETON_HELD_SQL, [
          ...TELEBIRR_DEVICE_STATE_SINGLETON_KEYS,
        ]);
        if (held.rows.length !== 1 || !exactBooleanRow(held.rows[0], 'singleton_held')) {
          markUnavailable();
          return false;
        }
        await assertTelebirrDeviceStateCatalogPreflight(guarded);
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
          const released = await client.query(TELEBIRR_DEVICE_STATE_SINGLETON_RELEASE_SQL, [
            ...TELEBIRR_DEVICE_STATE_SINGLETON_KEYS,
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
      if (failed) throw new TelebirrDeviceStatePostgresUnavailableError();
    },
  });
}
