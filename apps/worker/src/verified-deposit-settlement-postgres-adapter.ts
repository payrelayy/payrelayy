import { isProxy } from 'node:util/types';

const SETTLEMENT_GROUP_ROLE = 'fetanagent_verification_settlement';
const SETTLEMENT_RUNTIME_ROLE = 'fetanagent_verification_settlement_runtime';
const SETTLEMENT_FUNCTION =
  'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)';
const SETTLEMENT_FUNCTION_SQL = `pg_catalog.to_regprocedure('${SETTLEMENT_FUNCTION}')`;

const PREFLIGHT_RESULT_KEYS = [
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
  'allowed_function_hardened',
  'allowed_function_contract_exact',
  'allowed_function_execution_private',
  'default_function_execution_private',
] as const;

const SETTLEMENT_INPUT_KEYS = [
  'depositIntentId',
  'verificationAttemptId',
  'providerPaymentEvidenceId',
] as const;

const SETTLEMENT_ROW_KEYS = [
  'deposit_intent_id',
  'payment_claim_id',
  'execution_job_id',
  'deposit_status',
  'execution_job_status',
  'already_finalized',
  'updated_at',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Catalog-only and row-data-free. Every named boolean must be exactly true. */
export const VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL = `
  select
    current_user = '${SETTLEMENT_RUNTIME_ROLE}' and session_user = current_user
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
        granted.rolname = '${SETTLEMENT_GROUP_ROLE}' and membership.inherit_option
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
      where granted.rolname = '${SETTLEMENT_RUNTIME_ROLE}'
    ) as runtime_has_no_members,
    exists (
      select 1 from pg_catalog.pg_roles as role
      where role.rolname = '${SETTLEMENT_GROUP_ROLE}'
        and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
        and not role.rolcreatedb and not role.rolcreaterole
        and not role.rolreplication and not role.rolbypassrls
        and role.rolconnlimit = 2
    ) as group_role_is_safe,
    pg_catalog.pg_has_role(current_user, '${SETTLEMENT_GROUP_ROLE}', 'USAGE')
      and not pg_catalog.pg_has_role(current_user, '${SETTLEMENT_GROUP_ROLE}', 'SET')
      as group_usage_allowed_set_denied,
    (
      select count(*) = 1 and pg_catalog.bool_and(
        member.rolname = '${SETTLEMENT_RUNTIME_ROLE}' and membership.inherit_option
        and not membership.set_option and not membership.admin_option
      )
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where granted.rolname = '${SETTLEMENT_GROUP_ROLE}'
    ) as group_only_expected_members,
    not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member on member.oid = membership.member
      where member.rolname = '${SETTLEMENT_GROUP_ROLE}'
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
      select count(*) = 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid = ${SETTLEMENT_FUNCTION_SQL}
    ) and not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app'
        and pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE')
        and routine.oid <> ${SETTLEMENT_FUNCTION_SQL}
    ) as exact_function_surface_allowed,
    exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_roles as owner on owner.oid = routine.proowner
      where routine.oid = ${SETTLEMENT_FUNCTION_SQL}
        and routine.prosecdef and routine.prokind = 'f'
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        and owner.rolname = 'postgres'
    ) as allowed_function_hardened,
    exists (
      select 1
      from pg_catalog.pg_proc as routine
      where routine.oid = ${SETTLEMENT_FUNCTION_SQL}
        and routine.pronargs = 3
        and routine.pronargdefaults = 0
        and routine.proretset
        and routine.prorettype =
          pg_catalog.to_regtype('pg_catalog.record')::pg_catalog.oid
        and routine.proallargtypes = array[
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.uuid')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.text')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.text')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.bool')::pg_catalog.oid,
          pg_catalog.to_regtype('pg_catalog.timestamptz')::pg_catalog.oid
        ]::pg_catalog.oid[]
        and routine.proargmodes = array[
          'i'::pg_catalog."char",
          'i'::pg_catalog."char",
          'i'::pg_catalog."char",
          't'::pg_catalog."char",
          't'::pg_catalog."char",
          't'::pg_catalog."char",
          't'::pg_catalog."char",
          't'::pg_catalog."char",
          't'::pg_catalog."char",
          't'::pg_catalog."char"
        ]::pg_catalog."char"[]
        and routine.proargnames = array[
          'p_deposit_intent_id',
          'p_verification_attempt_id',
          'p_provider_payment_evidence_id',
          'deposit_intent_id',
          'payment_claim_id',
          'execution_job_id',
          'deposit_status',
          'execution_job_status',
          'already_finalized',
          'updated_at'
        ]::pg_catalog.text[]
        and pg_catalog.lower(pg_catalog.pg_get_function_result(routine.oid)) =
          'table(deposit_intent_id uuid, payment_claim_id uuid, execution_job_id uuid, deposit_status text, execution_job_status text, already_finalized boolean, updated_at timestamp with time zone)'
    ) as allowed_function_contract_exact,
    not exists (
      select 1
      from pg_catalog.pg_proc as routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) as privilege
      where routine.oid = ${SETTLEMENT_FUNCTION_SQL}
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee not in (
          routine.proowner,
          (select oid from pg_catalog.pg_roles where rolname = '${SETTLEMENT_GROUP_ROLE}')
        )
    ) as allowed_function_execution_private,
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

export const FINALIZE_PRIVATE_LIVE_VERIFIED_DEPOSIT_AND_ENQUEUE_EXECUTION_SQL = `
  select deposit_intent_id, payment_claim_id, execution_job_id,
         deposit_status, execution_job_status, already_finalized, updated_at
  from app.finalize_private_live_verified_deposit_and_enqueue_execution(
    $1::uuid, $2::uuid, $3::uuid
  )
`;

export interface VerifiedDepositSettlementPostgresDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

/**
 * These identifiers must come from a separately authenticated, database-bound completion
 * boundary. A pure AuthoritativeDepositProofOutcomeCandidate is advisory-only and must never be
 * cast to this input. No such provider-neutral handoff is composed today.
 */
export interface VerifiedDepositSettlementInput {
  readonly depositIntentId: string;
  readonly verificationAttemptId: string;
  readonly providerPaymentEvidenceId: string;
}

export interface VerifiedDepositSettlementResult {
  readonly depositIntentId: string;
  readonly paymentClaimId: string;
  readonly executionJobId: string;
  readonly depositStatus:
    | 'execution_pending'
    | 'execution_in_progress'
    | 'execution_review'
    | 'execution_reconciliation'
    | 'executed';
  readonly executionJobStatus: 'queued' | 'leased' | 'succeeded' | 'cancelled';
  readonly alreadyFinalized: boolean;
  readonly updatedAt: Date;
}

export interface VerifiedDepositSettlementPostgresAdapter {
  finalize(input: VerifiedDepositSettlementInput): Promise<VerifiedDepositSettlementResult>;
}

export class VerifiedDepositSettlementPostgresAdapterUnavailableError extends Error {
  constructor() {
    super('The verified deposit settlement PostgreSQL adapter is unavailable.');
    this.name = 'VerifiedDepositSettlementPostgresAdapterUnavailableError';
  }
}

type DataRecord = Readonly<Record<string, unknown>>;

function exactDataRecord(value: unknown, keys: readonly string[]): DataRecord | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return undefined;
    }
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
  } catch {
    return undefined;
  }
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function exactPassingPreflightRow(value: unknown): boolean {
  const row = exactDataRecord(value, PREFLIGHT_RESULT_KEYS);
  return row !== undefined && PREFLIGHT_RESULT_KEYS.every((key) => row[key] === true);
}

export async function assertVerifiedDepositSettlementCatalogPreflight(
  database: VerifiedDepositSettlementPostgresDatabase,
): Promise<void> {
  try {
    const result = await database.query(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL, []);
    if (result.rows.length !== 1 || !exactPassingPreflightRow(result.rows[0])) {
      throw new Error();
    }
  } catch {
    throw new VerifiedDepositSettlementPostgresAdapterUnavailableError();
  }
}

export async function probeVerifiedDepositSettlementCatalogReadiness(
  database: VerifiedDepositSettlementPostgresDatabase,
): Promise<boolean> {
  try {
    await assertVerifiedDepositSettlementCatalogPreflight(database);
    return true;
  } catch {
    return false;
  }
}

function resultFromRow(
  value: unknown,
  expectedDepositIntentId: string,
): VerifiedDepositSettlementResult | undefined {
  const row = exactDataRecord(value, SETTLEMENT_ROW_KEYS);
  if (
    row === undefined ||
    row.deposit_intent_id !== expectedDepositIntentId ||
    !isCanonicalUuid(row.payment_claim_id) ||
    !isCanonicalUuid(row.execution_job_id) ||
    typeof row.already_finalized !== 'boolean' ||
    !(row.updated_at instanceof Date) ||
    Number.isNaN(row.updated_at.getTime())
  ) {
    return undefined;
  }

  const depositStatus = row.deposit_status;
  const executionJobStatus = row.execution_job_status;
  const alreadyFinalized = row.already_finalized;
  const statusPairAllowed =
    (depositStatus === 'execution_pending' &&
      (executionJobStatus === 'queued' || (alreadyFinalized && executionJobStatus === 'leased'))) ||
    (alreadyFinalized &&
      ((depositStatus === 'execution_in_progress' && executionJobStatus === 'leased') ||
        ((depositStatus === 'execution_reconciliation' || depositStatus === 'executed') &&
          executionJobStatus === 'succeeded') ||
        (depositStatus === 'execution_review' &&
          (executionJobStatus === 'cancelled' || executionJobStatus === 'succeeded'))));
  if (!statusPairAllowed) return undefined;

  return Object.freeze({
    depositIntentId: expectedDepositIntentId,
    paymentClaimId: row.payment_claim_id,
    executionJobId: row.execution_job_id,
    depositStatus,
    executionJobStatus,
    alreadyFinalized,
    updatedAt: new Date(row.updated_at.getTime()),
  });
}

/**
 * Creates only an injected-database adapter. It opens no connection, reads no environment or
 * credential, authenticates no upstream outcome, owns no retry/acknowledgement lifecycle, and is
 * intentionally not composed into worker startup. TeleBirr's trusted completion function already
 * invokes the private finalizer atomically and must never be routed through this adapter again.
 */
export async function createVerifiedDepositSettlementPostgresAdapter(
  database: VerifiedDepositSettlementPostgresDatabase,
): Promise<VerifiedDepositSettlementPostgresAdapter> {
  await assertVerifiedDepositSettlementCatalogPreflight(database);

  return Object.freeze({
    async finalize(input: VerifiedDepositSettlementInput) {
      const record = exactDataRecord(input, SETTLEMENT_INPUT_KEYS);
      if (
        record === undefined ||
        !isCanonicalUuid(record.depositIntentId) ||
        !isCanonicalUuid(record.verificationAttemptId) ||
        !isCanonicalUuid(record.providerPaymentEvidenceId)
      ) {
        throw new VerifiedDepositSettlementPostgresAdapterUnavailableError();
      }

      try {
        const result = await database.query(
          FINALIZE_PRIVATE_LIVE_VERIFIED_DEPOSIT_AND_ENQUEUE_EXECUTION_SQL,
          [record.depositIntentId, record.verificationAttemptId, record.providerPaymentEvidenceId],
        );
        if (result.rows.length !== 1) throw new Error();
        const settlement = resultFromRow(result.rows[0], record.depositIntentId);
        if (settlement === undefined) throw new Error();
        return settlement;
      } catch {
        throw new VerifiedDepositSettlementPostgresAdapterUnavailableError();
      }
    },
  });
}
