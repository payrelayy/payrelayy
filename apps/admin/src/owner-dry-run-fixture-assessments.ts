import {
  evaluateCbeBirrFixtureVerification,
  createRedactedCbeBirrFixtureLookup,
  redactedCbeBirrFixtureIds,
  type CbeBirrFixtureVerificationDecision,
} from '@payreplayy/cbe-birr-fixtures';

import type { OwnerDryRunDepositIntakeItem } from './owner-deposit-intake.js';

export const OWNER_DRY_RUN_FIXTURE_IDS = [
  redactedCbeBirrFixtureIds.valid,
  redactedCbeBirrFixtureIds.wrongReceiver,
  redactedCbeBirrFixtureIds.wrongAmount,
  redactedCbeBirrFixtureIds.stale,
  redactedCbeBirrFixtureIds.future,
  redactedCbeBirrFixtureIds.pending,
  redactedCbeBirrFixtureIds.failed,
  redactedCbeBirrFixtureIds.malformed,
  redactedCbeBirrFixtureIds.unknown,
  redactedCbeBirrFixtureIds.duplicate,
  redactedCbeBirrFixtureIds.unavailable,
] as const;
export type OwnerDryRunFixtureId = (typeof OWNER_DRY_RUN_FIXTURE_IDS)[number];
export type OwnerDryRunFixtureReviewDecision = 'acknowledged' | 'manual_review_required';

export interface OwnerDryRunFixtureAssessment {
  readonly assessedAt: string;
  readonly assessmentId: string;
  readonly depositIntentId: string;
  readonly fixtureId: OwnerDryRunFixtureId;
  readonly outcome: CbeBirrFixtureVerificationDecision['outcome'];
  readonly reasonCode: CbeBirrFixtureVerificationDecision['reason'];
  readonly reviewDecision?: OwnerDryRunFixtureReviewDecision;
  readonly reviewedAt?: string;
}

export interface OwnerDryRunFixtureAssessmentReceipt extends OwnerDryRunFixtureAssessment {
  readonly alreadyRecorded: boolean;
}

export interface OwnerDryRunFixtureReviewReceipt {
  readonly alreadyRecorded: boolean;
  readonly assessmentId: string;
  readonly decision: OwnerDryRunFixtureReviewDecision;
  readonly reviewedAt: string;
}

export interface OwnerDryRunFixtureAssessmentDatabase {
  query(
    sql: string,
    values: readonly (number | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerDryRunFixtureAssessmentRejectedError extends Error {
  constructor() {
    super('The Owner dry-run fixture assessment request was rejected.');
    this.name = 'OwnerDryRunFixtureAssessmentRejectedError';
  }
}

export class OwnerDryRunFixtureAssessmentUnavailableError extends Error {
  constructor() {
    super('The Owner dry-run fixture assessment boundary is unavailable.');
    this.name = 'OwnerDryRunFixtureAssessmentUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIXTURE_ID_SET = new Set<string>(OWNER_DRY_RUN_FIXTURE_IDS);
const OUTCOME_SET = new Set(['would_verify', 'would_reject', 'would_review']);
const REASON_SET = new Set([
  'fixture_completed',
  'receiver_mismatch',
  'provider_status_failed',
  'provider_reference_reused',
  'amount_mismatch',
  'payment_stale',
  'payment_timestamp_future',
  'fixture_request_invalid',
  'fixture_unavailable',
  'fixture_malformed',
  'fixture_unknown',
  'fixture_status_pending',
  'fixture_duplicate_check_unavailable',
]);
const REVIEW_DECISION_SET = new Set<OwnerDryRunFixtureReviewDecision>([
  'acknowledged',
  'manual_review_required',
]);

const RECORD_SQL = `
  select assessment_id, assessed_at, already_recorded
  from app.record_owner_dry_run_fixture_assessment(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::text
  )
`;
const REVIEW_SQL = `
  select assessment_id, decision, reviewed_at, already_recorded
  from app.review_owner_dry_run_fixture_assessment($1::uuid, $2::uuid, $3::text)
`;
const LIST_SQL = `
  select assessment_id, deposit_intent_id, fixture_id, outcome, reason_code,
         assessed_at, review_decision, reviewed_at
  from app.list_owner_dry_run_fixture_assessments($1::uuid, $2::integer)
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function rowObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerDryRunFixtureAssessmentUnavailableError();
  }
  return value as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerDryRunFixtureAssessmentUnavailableError();
  }
  return value.toISOString();
}

function mapAssessment(raw: unknown): OwnerDryRunFixtureAssessment {
  const row = rowObject(raw);
  const reviewAbsent = row.review_decision === null && row.reviewed_at === null;
  const reviewPresent =
    typeof row.review_decision === 'string' &&
    REVIEW_DECISION_SET.has(row.review_decision as OwnerDryRunFixtureReviewDecision) &&
    row.reviewed_at instanceof Date;
  if (
    typeof row.assessment_id !== 'string' ||
    !UUID_PATTERN.test(row.assessment_id) ||
    typeof row.deposit_intent_id !== 'string' ||
    !UUID_PATTERN.test(row.deposit_intent_id) ||
    typeof row.fixture_id !== 'string' ||
    !FIXTURE_ID_SET.has(row.fixture_id) ||
    typeof row.outcome !== 'string' ||
    !OUTCOME_SET.has(row.outcome) ||
    typeof row.reason_code !== 'string' ||
    !REASON_SET.has(row.reason_code) ||
    !(row.assessed_at instanceof Date) ||
    !(reviewAbsent || reviewPresent)
  ) {
    throw new OwnerDryRunFixtureAssessmentUnavailableError();
  }
  return {
    assessedAt: isoDate(row.assessed_at),
    assessmentId: row.assessment_id,
    depositIntentId: row.deposit_intent_id,
    fixtureId: row.fixture_id as OwnerDryRunFixtureId,
    outcome: row.outcome as CbeBirrFixtureVerificationDecision['outcome'],
    reasonCode: row.reason_code as CbeBirrFixtureVerificationDecision['reason'],
    ...(reviewPresent
      ? {
          reviewDecision: row.review_decision as OwnerDryRunFixtureReviewDecision,
          reviewedAt: isoDate(row.reviewed_at),
        }
      : {}),
  };
}

function validateActorAndFixture(authUserId: string, fixtureId: string): OwnerDryRunFixtureId {
  if (!UUID_PATTERN.test(authUserId) || !FIXTURE_ID_SET.has(fixtureId)) {
    throw new OwnerDryRunFixtureAssessmentRejectedError();
  }
  return fixtureId as OwnerDryRunFixtureId;
}

export class PostgresOwnerDryRunFixtureAssessments {
  constructor(private readonly database: OwnerDryRunFixtureAssessmentDatabase) {}

  async assess(
    authUserId: string,
    deposit: OwnerDryRunDepositIntakeItem,
    fixtureId: string,
    assessedAt: Date,
  ): Promise<OwnerDryRunFixtureAssessmentReceipt> {
    const normalizedFixtureId = validateActorAndFixture(authUserId, fixtureId);
    const expectedAmountMinor = Number(deposit.amountMinor);
    const openedAt = new Date(deposit.openedAt);
    const paymentDeadlineAt = new Date(deposit.paymentDeadline);
    if (
      !UUID_PATTERN.test(deposit.depositIntentId) ||
      deposit.submissionStatus !== 'received' ||
      !Number.isSafeInteger(expectedAmountMinor) ||
      expectedAmountMinor < 1 ||
      !Number.isFinite(assessedAt.getTime()) ||
      !Number.isFinite(openedAt.getTime()) ||
      !Number.isFinite(paymentDeadlineAt.getTime()) ||
      openedAt.getTime() >= paymentDeadlineAt.getTime()
    ) {
      throw new OwnerDryRunFixtureAssessmentRejectedError();
    }

    const input = {
      assessedAt,
      expectedAmountMinor,
      expectedReceiverKey: 'fixture-receiver-primary',
      fixtureId: normalizedFixtureId,
      openedAt,
      paymentDeadlineAt,
    } as const;
    const decision = evaluateCbeBirrFixtureVerification(input, {
      fixtureLookup: createRedactedCbeBirrFixtureLookup(input),
      claimLookup: {
        hasPriorClaim: () => normalizedFixtureId === redactedCbeBirrFixtureIds.duplicate,
      },
    });

    try {
      const result = await this.database.query(RECORD_SQL, [
        authUserId,
        deposit.depositIntentId,
        normalizedFixtureId,
        decision.outcome,
        decision.reason,
      ]);
      if (result.rows.length !== 1) throw new OwnerDryRunFixtureAssessmentUnavailableError();
      const row = rowObject(result.rows[0]);
      if (
        typeof row.assessment_id !== 'string' ||
        !UUID_PATTERN.test(row.assessment_id) ||
        !(row.assessed_at instanceof Date) ||
        typeof row.already_recorded !== 'boolean'
      ) {
        throw new OwnerDryRunFixtureAssessmentUnavailableError();
      }
      return {
        assessedAt: isoDate(row.assessed_at),
        assessmentId: row.assessment_id,
        depositIntentId: deposit.depositIntentId,
        fixtureId: normalizedFixtureId,
        outcome: decision.outcome,
        reasonCode: decision.reason,
        alreadyRecorded: row.already_recorded,
      };
    } catch (error) {
      if (error instanceof OwnerDryRunFixtureAssessmentUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerDryRunFixtureAssessmentRejectedError();
      }
      throw new OwnerDryRunFixtureAssessmentUnavailableError();
    }
  }

  async list(authUserId: string, limit = 25): Promise<readonly OwnerDryRunFixtureAssessment[]> {
    if (!UUID_PATTERN.test(authUserId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new OwnerDryRunFixtureAssessmentRejectedError();
    }
    try {
      const result = await this.database.query(LIST_SQL, [authUserId, limit]);
      if (result.rows.length > limit) throw new OwnerDryRunFixtureAssessmentUnavailableError();
      return result.rows.map(mapAssessment);
    } catch (error) {
      if (error instanceof OwnerDryRunFixtureAssessmentUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerDryRunFixtureAssessmentRejectedError();
      }
      throw new OwnerDryRunFixtureAssessmentUnavailableError();
    }
  }

  async review(
    authUserId: string,
    assessmentId: string,
    decision: OwnerDryRunFixtureReviewDecision,
  ): Promise<OwnerDryRunFixtureReviewReceipt> {
    if (
      !UUID_PATTERN.test(authUserId) ||
      !UUID_PATTERN.test(assessmentId) ||
      !REVIEW_DECISION_SET.has(decision)
    ) {
      throw new OwnerDryRunFixtureAssessmentRejectedError();
    }
    try {
      const result = await this.database.query(REVIEW_SQL, [authUserId, assessmentId, decision]);
      if (result.rows.length !== 1) throw new OwnerDryRunFixtureAssessmentUnavailableError();
      const row = rowObject(result.rows[0]);
      if (
        row.assessment_id !== assessmentId ||
        row.decision !== decision ||
        !(row.reviewed_at instanceof Date) ||
        typeof row.already_recorded !== 'boolean'
      ) {
        throw new OwnerDryRunFixtureAssessmentUnavailableError();
      }
      return {
        alreadyRecorded: row.already_recorded,
        assessmentId,
        decision,
        reviewedAt: isoDate(row.reviewed_at),
      };
    } catch (error) {
      if (error instanceof OwnerDryRunFixtureAssessmentUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerDryRunFixtureAssessmentRejectedError();
      }
      throw new OwnerDryRunFixtureAssessmentUnavailableError();
    }
  }
}
