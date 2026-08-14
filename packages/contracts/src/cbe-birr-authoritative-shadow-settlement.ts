import { isProxy } from 'node:util/types';

/**
 * Pure Stage 1D planner contract. It only reconstructs a closed, advisory settlement command.
 * It does not execute SQL, open a database connection, schedule work, persist state, or perform a
 * provider or financial action.
 */
export const CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION = 1 as const;

export const CBE_BIRR_SHADOW_COMPLETE_PROCEDURE =
  'app.complete_cbe_birr_shadow_verification_job' as const;
export const CBE_BIRR_SHADOW_COMPLETE_PROCEDURE_SIGNATURE =
  'app.complete_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,text,text,text,text,text)' as const;
export const CBE_BIRR_SHADOW_COMPLETE_ARGUMENT_NAMES = Object.freeze([
  'p_job_id',
  'p_lease_token',
  'p_attempt_number',
  'p_outcome',
  'p_reason_code',
  'p_canonical_reference_fingerprint',
  'p_worker_decision_digest',
  'p_adapter_version',
  'p_normalization_version',
] as const);

export const CBE_BIRR_SHADOW_RETRY_PROCEDURE =
  'app.retry_cbe_birr_shadow_verification_job' as const;
export const CBE_BIRR_SHADOW_RETRY_PROCEDURE_SIGNATURE =
  'app.retry_cbe_birr_shadow_verification_job(uuid,uuid,integer,text,integer)' as const;
export const CBE_BIRR_SHADOW_RETRY_ARGUMENT_NAMES = Object.freeze([
  'p_job_id',
  'p_lease_token',
  'p_attempt_number',
  'p_error_code',
  'p_retry_after_seconds',
] as const);

export const CBE_BIRR_SHADOW_ADAPTER_VERSION = 'cbe-birr-shadow-worker-v1' as const;
export const CBE_BIRR_SHADOW_NORMALIZATION_VERSION = 'cbe-birr-normalization-v1' as const;

/**
 * Planner-owned retry policy. Callers cannot inject or override the delay, so an idempotent replay
 * produces the same durable retry receipt. The database contract accepts 1..3600 seconds.
 */
export const CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS = 300 as const;

export type CbeBirrAuthoritativeShadowCompleteOutcome = 'would_reject' | 'would_review';

export type CbeBirrAuthoritativeShadowCompleteRejectReasonCode =
  'authoritative_receipt_not_found' | 'receiver_mismatch' | 'provider_status_failed';

export type CbeBirrAuthoritativeShadowCompleteReviewReasonCode =
  | 'amount_mismatch'
  | 'payment_stale'
  | 'payment_timestamp_future'
  | 'payment_fields_missing'
  | 'provider_status_pending'
  | 'payment_type_mismatch'
  | 'verification_review_required'
  | 'duplicate_check_unavailable';

export type CbeBirrAuthoritativeShadowCompleteReasonCode =
  | CbeBirrAuthoritativeShadowCompleteRejectReasonCode
  | CbeBirrAuthoritativeShadowCompleteReviewReasonCode;

export type CbeBirrAuthoritativeShadowRetryReasonCode =
  'authoritative_receipt_unavailable' | 'receipt_parse_uncertain' | 'provider_network_uncertain';

export type CbeBirrAuthoritativeShadowAttemptNumber = 1 | 2 | 3 | 4 | 5;

export interface CbeBirrAuthoritativeShadowLeaseReceipt {
  readonly contractVersion: 1;
  readonly providerCode: 'cbe_birr';
  readonly jobId: string;
  readonly leaseToken: string;
  readonly attemptNumber: CbeBirrAuthoritativeShadowAttemptNumber;
}

export type CbeBirrAuthoritativeShadowCompleteProcedureArguments =
  | readonly [
      jobId: string,
      leaseToken: string,
      attemptNumber: CbeBirrAuthoritativeShadowAttemptNumber,
      outcome: 'would_reject',
      reasonCode: CbeBirrAuthoritativeShadowCompleteRejectReasonCode,
      canonicalReferenceFingerprint: null,
      workerDecisionDigest: null,
      adapterVersion: typeof CBE_BIRR_SHADOW_ADAPTER_VERSION,
      normalizationVersion: typeof CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
    ]
  | readonly [
      jobId: string,
      leaseToken: string,
      attemptNumber: CbeBirrAuthoritativeShadowAttemptNumber,
      outcome: 'would_review',
      reasonCode: CbeBirrAuthoritativeShadowCompleteReviewReasonCode,
      canonicalReferenceFingerprint: null,
      workerDecisionDigest: null,
      adapterVersion: typeof CBE_BIRR_SHADOW_ADAPTER_VERSION,
      normalizationVersion: typeof CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
    ];

export type CbeBirrAuthoritativeShadowRetryProcedureArguments = readonly [
  jobId: string,
  leaseToken: string,
  attemptNumber: CbeBirrAuthoritativeShadowAttemptNumber,
  errorCode: CbeBirrAuthoritativeShadowRetryReasonCode,
  retryAfterSeconds: typeof CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS,
];

export type CbeBirrAuthoritativeShadowSettlementCommand =
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'complete_advisory';
      readonly procedure: typeof CBE_BIRR_SHADOW_COMPLETE_PROCEDURE;
      readonly arguments: CbeBirrAuthoritativeShadowCompleteProcedureArguments;
    }
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'retry_candidate';
      readonly procedure: typeof CBE_BIRR_SHADOW_RETRY_PROCEDURE;
      readonly arguments: CbeBirrAuthoritativeShadowRetryProcedureArguments;
    };

export type RedactedCbeBirrAuthoritativeShadowSettlementCommandLogProjection =
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'invalid_command';
    }
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'complete_advisory';
      readonly attemptNumber: CbeBirrAuthoritativeShadowAttemptNumber;
      readonly outcome: 'would_reject';
      readonly reasonCode: CbeBirrAuthoritativeShadowCompleteRejectReasonCode;
    }
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'complete_advisory';
      readonly attemptNumber: CbeBirrAuthoritativeShadowAttemptNumber;
      readonly outcome: 'would_review';
      readonly reasonCode: CbeBirrAuthoritativeShadowCompleteReviewReasonCode;
    }
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'retry_candidate';
      readonly attemptNumber: CbeBirrAuthoritativeShadowAttemptNumber;
      readonly outcome: 'would_review';
      readonly reasonCode: CbeBirrAuthoritativeShadowRetryReasonCode;
      readonly retryAfterSeconds: typeof CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS;
    };

type UnknownRecord = Record<string, unknown>;

type ReconstructedAttemptPlan =
  | {
      readonly disposition: 'complete_advisory';
      readonly outcome: 'would_reject';
      readonly reasonCode: CbeBirrAuthoritativeShadowCompleteRejectReasonCode;
    }
  | {
      readonly disposition: 'complete_advisory';
      readonly outcome: 'would_review';
      readonly reasonCode: CbeBirrAuthoritativeShadowCompleteReviewReasonCode;
    }
  | {
      readonly disposition: 'retry_candidate';
      readonly outcome: 'would_review';
      readonly reasonCode: CbeBirrAuthoritativeShadowRetryReasonCode;
    };

const leaseReceiptKeys = [
  'contractVersion',
  'providerCode',
  'jobId',
  'leaseToken',
  'attemptNumber',
] as const;
const attemptPlanKeys = [
  'contractVersion',
  'providerCode',
  'advisoryOnly',
  'disposition',
  'decision',
] as const;
const decisionKeys = ['contractVersion', 'outcome', 'reasonCode'] as const;
const settlementCommandKeys = [
  'contractVersion',
  'providerCode',
  'advisoryOnly',
  'disposition',
  'procedure',
  'arguments',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const completeRejectReasonCodes = new Set<CbeBirrAuthoritativeShadowCompleteRejectReasonCode>([
  'authoritative_receipt_not_found',
  'receiver_mismatch',
  'provider_status_failed',
]);
const completeReviewReasonCodes = new Set<CbeBirrAuthoritativeShadowCompleteReviewReasonCode>([
  'amount_mismatch',
  'payment_stale',
  'payment_timestamp_future',
  'payment_fields_missing',
  'provider_status_pending',
  'payment_type_mismatch',
  'verification_review_required',
  'duplicate_check_unavailable',
]);
const retryReasonCodes = new Set<CbeBirrAuthoritativeShadowRetryReasonCode>([
  'authoritative_receipt_unavailable',
  'receipt_parse_uncertain',
  'provider_network_uncertain',
]);

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value')
    );
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function hasExactArrayDataElements(value: unknown, expectedLength: number): value is unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }

  const expectedIndexKeys = Array.from({ length: expectedLength }, (_, index) => String(index));
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedLength + 1 ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedIndexKeys.every((key) => actualKeys.includes(key)) ||
    !actualKeys.includes('length')
  ) {
    return false;
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== expectedLength
  ) {
    return false;
  }

  return expectedIndexKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value')
    );
  });
}

function ownArrayDataValue(value: unknown[], index: number): unknown {
  return Object.getOwnPropertyDescriptor(value, String(index))?.value as unknown;
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isAttemptNumber(value: unknown): value is CbeBirrAuthoritativeShadowAttemptNumber {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function reconstructLeaseReceipt(
  candidate: unknown,
): CbeBirrAuthoritativeShadowLeaseReceipt | null {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, leaseReceiptKeys) ||
    ownDataValue(candidate, 'contractVersion') !==
      CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'cbe_birr'
  ) {
    return null;
  }

  const jobId = ownDataValue(candidate, 'jobId');
  const leaseToken = ownDataValue(candidate, 'leaseToken');
  const attemptNumber = ownDataValue(candidate, 'attemptNumber');
  if (!isCanonicalUuid(jobId) || !isCanonicalUuid(leaseToken) || !isAttemptNumber(attemptNumber)) {
    return null;
  }

  return Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    jobId,
    leaseToken,
    attemptNumber,
  });
}

function isCompleteRejectReasonCode(
  value: unknown,
): value is CbeBirrAuthoritativeShadowCompleteRejectReasonCode {
  return (
    typeof value === 'string' &&
    completeRejectReasonCodes.has(value as CbeBirrAuthoritativeShadowCompleteRejectReasonCode)
  );
}

function isCompleteReviewReasonCode(
  value: unknown,
): value is CbeBirrAuthoritativeShadowCompleteReviewReasonCode {
  return (
    typeof value === 'string' &&
    completeReviewReasonCodes.has(value as CbeBirrAuthoritativeShadowCompleteReviewReasonCode)
  );
}

function isRetryReasonCode(value: unknown): value is CbeBirrAuthoritativeShadowRetryReasonCode {
  return (
    typeof value === 'string' &&
    retryReasonCodes.has(value as CbeBirrAuthoritativeShadowRetryReasonCode)
  );
}

function reconstructAttemptPlan(candidate: unknown): ReconstructedAttemptPlan | null {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, attemptPlanKeys) ||
    ownDataValue(candidate, 'contractVersion') !== 1 ||
    ownDataValue(candidate, 'providerCode') !== 'cbe_birr' ||
    ownDataValue(candidate, 'advisoryOnly') !== true
  ) {
    return null;
  }

  const disposition = ownDataValue(candidate, 'disposition');
  const decision = ownDataValue(candidate, 'decision');
  if (
    !isPlainNonProxyRecord(decision) ||
    !hasExactEnumerableDataKeys(decision, decisionKeys) ||
    ownDataValue(decision, 'contractVersion') !== 1
  ) {
    return null;
  }

  const outcome = ownDataValue(decision, 'outcome');
  const reasonCode = ownDataValue(decision, 'reasonCode');

  if (
    disposition === 'complete_advisory' &&
    outcome === 'would_reject' &&
    isCompleteRejectReasonCode(reasonCode)
  ) {
    return Object.freeze({ disposition, outcome, reasonCode });
  }

  if (
    disposition === 'complete_advisory' &&
    outcome === 'would_review' &&
    isCompleteReviewReasonCode(reasonCode)
  ) {
    return Object.freeze({ disposition, outcome, reasonCode });
  }

  if (
    disposition === 'retry_candidate' &&
    outcome === 'would_review' &&
    isRetryReasonCode(reasonCode)
  ) {
    return Object.freeze({ disposition, outcome, reasonCode });
  }

  return null;
}

/**
 * Reconstructs a Stage 1C advisory plan and a minimal lease receipt into the exact ordered
 * arguments for one existing settlement procedure. Invalid input returns null; it never creates a
 * callable fallback. This function does not execute the returned command.
 */
export function planCbeBirrAuthoritativeShadowSettlementCommand(
  leaseReceiptCandidate: unknown,
  attemptPlanCandidate: unknown,
): CbeBirrAuthoritativeShadowSettlementCommand | null {
  try {
    const leaseReceipt = reconstructLeaseReceipt(leaseReceiptCandidate);
    const attemptPlan = reconstructAttemptPlan(attemptPlanCandidate);
    if (leaseReceipt === null || attemptPlan === null) return null;

    if (attemptPlan.disposition === 'complete_advisory') {
      let procedureArguments: CbeBirrAuthoritativeShadowCompleteProcedureArguments;
      if (attemptPlan.outcome === 'would_reject') {
        procedureArguments = Object.freeze([
          leaseReceipt.jobId,
          leaseReceipt.leaseToken,
          leaseReceipt.attemptNumber,
          attemptPlan.outcome,
          attemptPlan.reasonCode,
          null,
          null,
          CBE_BIRR_SHADOW_ADAPTER_VERSION,
          CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
        ]);
      } else {
        procedureArguments = Object.freeze([
          leaseReceipt.jobId,
          leaseReceipt.leaseToken,
          leaseReceipt.attemptNumber,
          attemptPlan.outcome,
          attemptPlan.reasonCode,
          null,
          null,
          CBE_BIRR_SHADOW_ADAPTER_VERSION,
          CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
        ]);
      }

      return Object.freeze({
        contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
        providerCode: 'cbe_birr' as const,
        advisoryOnly: true as const,
        disposition: attemptPlan.disposition,
        procedure: CBE_BIRR_SHADOW_COMPLETE_PROCEDURE,
        arguments: procedureArguments,
      });
    }

    const procedureArguments: CbeBirrAuthoritativeShadowRetryProcedureArguments = Object.freeze([
      leaseReceipt.jobId,
      leaseReceipt.leaseToken,
      leaseReceipt.attemptNumber,
      attemptPlan.reasonCode,
      CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS,
    ]);

    return Object.freeze({
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
      providerCode: 'cbe_birr' as const,
      advisoryOnly: true as const,
      disposition: attemptPlan.disposition,
      procedure: CBE_BIRR_SHADOW_RETRY_PROCEDURE,
      arguments: procedureArguments,
    });
  } catch {
    return null;
  }
}

const invalidSettlementCommandLogProjection = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  advisoryOnly: true as const,
  disposition: 'invalid_command' as const,
});

/**
 * Revalidates an untrusted settlement command and returns only a frozen, allowlisted log
 * projection. Job and lease identifiers, procedure names and arguments, versions, SQL, and raw
 * provider material never cross this boundary.
 */
export function redactedCbeBirrAuthoritativeShadowSettlementCommandForLog(
  commandCandidate: unknown,
): RedactedCbeBirrAuthoritativeShadowSettlementCommandLogProjection {
  try {
    if (
      !isPlainNonProxyRecord(commandCandidate) ||
      !hasExactEnumerableDataKeys(commandCandidate, settlementCommandKeys) ||
      ownDataValue(commandCandidate, 'contractVersion') !==
        CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION ||
      ownDataValue(commandCandidate, 'providerCode') !== 'cbe_birr' ||
      ownDataValue(commandCandidate, 'advisoryOnly') !== true
    ) {
      return invalidSettlementCommandLogProjection;
    }

    const disposition = ownDataValue(commandCandidate, 'disposition');
    const procedure = ownDataValue(commandCandidate, 'procedure');
    const procedureArguments = ownDataValue(commandCandidate, 'arguments');

    if (
      disposition === 'complete_advisory' &&
      procedure === CBE_BIRR_SHADOW_COMPLETE_PROCEDURE &&
      hasExactArrayDataElements(procedureArguments, CBE_BIRR_SHADOW_COMPLETE_ARGUMENT_NAMES.length)
    ) {
      const jobId = ownArrayDataValue(procedureArguments, 0);
      const leaseToken = ownArrayDataValue(procedureArguments, 1);
      const attemptNumber = ownArrayDataValue(procedureArguments, 2);
      const outcome = ownArrayDataValue(procedureArguments, 3);
      const reasonCode = ownArrayDataValue(procedureArguments, 4);
      const canonicalReferenceFingerprint = ownArrayDataValue(procedureArguments, 5);
      const workerDecisionDigest = ownArrayDataValue(procedureArguments, 6);
      const adapterVersion = ownArrayDataValue(procedureArguments, 7);
      const normalizationVersion = ownArrayDataValue(procedureArguments, 8);

      if (
        !isCanonicalUuid(jobId) ||
        !isCanonicalUuid(leaseToken) ||
        !isAttemptNumber(attemptNumber) ||
        canonicalReferenceFingerprint !== null ||
        workerDecisionDigest !== null ||
        adapterVersion !== CBE_BIRR_SHADOW_ADAPTER_VERSION ||
        normalizationVersion !== CBE_BIRR_SHADOW_NORMALIZATION_VERSION
      ) {
        return invalidSettlementCommandLogProjection;
      }

      if (outcome === 'would_reject' && isCompleteRejectReasonCode(reasonCode)) {
        return Object.freeze({
          contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
          providerCode: 'cbe_birr' as const,
          advisoryOnly: true as const,
          disposition,
          attemptNumber,
          outcome,
          reasonCode,
        });
      }

      if (outcome === 'would_review' && isCompleteReviewReasonCode(reasonCode)) {
        return Object.freeze({
          contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
          providerCode: 'cbe_birr' as const,
          advisoryOnly: true as const,
          disposition,
          attemptNumber,
          outcome,
          reasonCode,
        });
      }

      return invalidSettlementCommandLogProjection;
    }

    if (
      disposition === 'retry_candidate' &&
      procedure === CBE_BIRR_SHADOW_RETRY_PROCEDURE &&
      hasExactArrayDataElements(procedureArguments, CBE_BIRR_SHADOW_RETRY_ARGUMENT_NAMES.length)
    ) {
      const jobId = ownArrayDataValue(procedureArguments, 0);
      const leaseToken = ownArrayDataValue(procedureArguments, 1);
      const attemptNumber = ownArrayDataValue(procedureArguments, 2);
      const reasonCode = ownArrayDataValue(procedureArguments, 3);
      const retryAfterSeconds = ownArrayDataValue(procedureArguments, 4);

      if (
        isCanonicalUuid(jobId) &&
        isCanonicalUuid(leaseToken) &&
        isAttemptNumber(attemptNumber) &&
        isRetryReasonCode(reasonCode) &&
        retryAfterSeconds === CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS
      ) {
        return Object.freeze({
          contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_SETTLEMENT_CONTRACT_VERSION,
          providerCode: 'cbe_birr' as const,
          advisoryOnly: true as const,
          disposition,
          attemptNumber,
          outcome: 'would_review' as const,
          reasonCode,
          retryAfterSeconds,
        });
      }
    }

    return invalidSettlementCommandLogProjection;
  } catch {
    return invalidSettlementCommandLogProjection;
  }
}
