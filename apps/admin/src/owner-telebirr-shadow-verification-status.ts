export interface OwnerTelebirrShadowVerificationStatus {
  readonly contractVersion: 1;
  readonly verificationMode: 'shadow_no_money';
  readonly pilotState: 'absent' | 'armed' | 'draft' | 'stopped';
  readonly switchMode: 'absent' | 'disabled' | 'dry_run' | 'live';
  readonly shadowModeReady: boolean;
  readonly proofCount: string;
  readonly claimableProofCount: string;
  readonly activeAssignmentCount: string;
  readonly stagedEvidenceCount: string;
  readonly completedCount: string;
  readonly wouldVerifyCount: string;
  readonly wouldReviewCount: string;
  readonly wouldRejectCount: string;
  readonly quarantinedCount: string;
  readonly checkedAt: string;
}

export interface OwnerTelebirrShadowVerificationStatusDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerTelebirrShadowVerificationStatusRejectedError extends Error {
  constructor() {
    super('The Owner TeleBirr shadow-verification status request was rejected.');
    this.name = 'OwnerTelebirrShadowVerificationStatusRejectedError';
  }
}

export class OwnerTelebirrShadowVerificationStatusUnavailableError extends Error {
  constructor() {
    super('The Owner TeleBirr shadow-verification status is unavailable.');
    this.name = 'OwnerTelebirrShadowVerificationStatusUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const STATUS_KEYS = [
  'contract_version',
  'verification_mode',
  'pilot_state',
  'switch_mode',
  'shadow_mode_ready',
  'proof_count',
  'claimable_proof_count',
  'active_assignment_count',
  'staged_evidence_count',
  'completed_count',
  'would_verify_count',
  'would_review_count',
  'would_reject_count',
  'quarantined_count',
  'checked_at',
] as const;

export const GET_OWNER_TELEBIRR_SHADOW_VERIFICATION_STATUS_SQL = `
  select contract_version,
         verification_mode,
         pilot_state,
         switch_mode,
         shadow_mode_ready,
         proof_count,
         claimable_proof_count,
         active_assignment_count,
         staged_evidence_count,
         completed_count,
         would_verify_count,
         would_review_count,
         would_reject_count,
         quarantined_count,
         checked_at
    from app.get_owner_telebirr_shadow_verification_status($1::uuid)
`;

function exactRow(value: unknown): Readonly<Record<(typeof STATUS_KEYS)[number], unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== STATUS_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !STATUS_KEYS.includes(key as never)) ||
    STATUS_KEYS.some((key) => {
      const descriptor = descriptors[key];
      return descriptor?.enumerable !== true || !Object.hasOwn(descriptor ?? {}, 'value');
    })
  ) {
    throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
  }
  return value as Readonly<Record<(typeof STATUS_KEYS)[number], unknown>>;
}

function count(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
  }
  return value;
}

function checkedAt(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
  }
  return value.toISOString();
}

function statusFrom(value: unknown): OwnerTelebirrShadowVerificationStatus {
  const row = exactRow(value);
  if (
    row.contract_version !== 1 ||
    row.verification_mode !== 'shadow_no_money' ||
    (row.pilot_state !== 'absent' &&
      row.pilot_state !== 'armed' &&
      row.pilot_state !== 'draft' &&
      row.pilot_state !== 'stopped') ||
    (row.switch_mode !== 'absent' &&
      row.switch_mode !== 'disabled' &&
      row.switch_mode !== 'dry_run' &&
      row.switch_mode !== 'live') ||
    typeof row.shadow_mode_ready !== 'boolean' ||
    (row.shadow_mode_ready && (row.pilot_state !== 'armed' || row.switch_mode !== 'dry_run'))
  ) {
    throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
  }

  const proofCount = count(row.proof_count);
  const claimableProofCount = count(row.claimable_proof_count);
  const activeAssignmentCount = count(row.active_assignment_count);
  const stagedEvidenceCount = count(row.staged_evidence_count);
  const completedCount = count(row.completed_count);
  const wouldVerifyCount = count(row.would_verify_count);
  const wouldReviewCount = count(row.would_review_count);
  const wouldRejectCount = count(row.would_reject_count);
  const quarantinedCount = count(row.quarantined_count);
  if (
    BigInt(claimableProofCount) > BigInt(proofCount) ||
    (!row.shadow_mode_ready && BigInt(claimableProofCount) !== 0n) ||
    BigInt(completedCount) > BigInt(stagedEvidenceCount) ||
    BigInt(quarantinedCount) > BigInt(stagedEvidenceCount) ||
    BigInt(completedCount) + BigInt(quarantinedCount) > BigInt(stagedEvidenceCount) ||
    BigInt(wouldVerifyCount) + BigInt(wouldReviewCount) + BigInt(wouldRejectCount) !==
      BigInt(completedCount)
  ) {
    throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
  }

  return Object.freeze({
    contractVersion: 1,
    verificationMode: 'shadow_no_money',
    pilotState: row.pilot_state,
    switchMode: row.switch_mode,
    shadowModeReady: row.shadow_mode_ready,
    proofCount,
    claimableProofCount,
    activeAssignmentCount,
    stagedEvidenceCount,
    completedCount,
    wouldVerifyCount,
    wouldReviewCount,
    wouldRejectCount,
    quarantinedCount,
    checkedAt: checkedAt(row.checked_at),
  });
}

export class PostgresOwnerTelebirrShadowVerificationStatus {
  constructor(private readonly database: OwnerTelebirrShadowVerificationStatusDatabase) {}

  async status(authUserId: string): Promise<OwnerTelebirrShadowVerificationStatus> {
    if (!UUID_PATTERN.test(authUserId)) {
      throw new OwnerTelebirrShadowVerificationStatusRejectedError();
    }
    try {
      const result = await this.database.query(GET_OWNER_TELEBIRR_SHADOW_VERIFICATION_STATUS_SQL, [
        authUserId,
      ]);
      if (result.rows.length !== 1) {
        throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
      }
      return statusFrom(result.rows[0]);
    } catch (error) {
      if (
        error instanceof OwnerTelebirrShadowVerificationStatusRejectedError ||
        error instanceof OwnerTelebirrShadowVerificationStatusUnavailableError
      ) {
        throw error;
      }
      throw new OwnerTelebirrShadowVerificationStatusUnavailableError();
    }
  }
}
