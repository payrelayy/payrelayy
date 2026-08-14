import {
  assessPaymentVerificationWindow,
  PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS,
  type VerificationReasonCode,
} from '@fetanagent/domain';

/**
 * This contract is an advisory shadow boundary only. It cannot create provider evidence, a
 * payment claim, a verification job, a deposit-state transition, or a KemerBet action.
 *
 * The adapter boundary must reduce sensitive provider material to these allowlisted facts before
 * calling this module. Raw transaction references, receiver identifiers, holder names, receipt
 * URLs, response bodies, and credentials are deliberately impossible to represent here.
 */
export const CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION = 1 as const;

export const cbeBirrAuthoritativeShadowOutcomes = [
  'would_verify',
  'would_reject',
  'would_review',
] as const;

export type CbeBirrAuthoritativeShadowOutcome = (typeof cbeBirrAuthoritativeShadowOutcomes)[number];

export const cbeBirrAuthoritativeShadowReasonCodesByOutcome = {
  would_verify: ['shadow_checks_passed'],
  would_reject: [
    'authoritative_receipt_not_found',
    'receiver_mismatch',
    'provider_status_failed',
    'provider_reference_reused',
  ],
  would_review: [
    'authoritative_receipt_unavailable',
    'amount_mismatch',
    'payment_stale',
    'payment_timestamp_future',
    'payment_fields_missing',
    'receipt_parse_uncertain',
    'provider_network_uncertain',
    'provider_status_pending',
    'payment_type_mismatch',
    'verification_review_required',
    'duplicate_check_unavailable',
  ],
} as const;

export const cbeBirrAuthoritativeShadowReasonCodes = [
  ...cbeBirrAuthoritativeShadowReasonCodesByOutcome.would_verify,
  ...cbeBirrAuthoritativeShadowReasonCodesByOutcome.would_reject,
  ...cbeBirrAuthoritativeShadowReasonCodesByOutcome.would_review,
] as const;

export type CbeBirrAuthoritativeShadowReasonCode =
  (typeof cbeBirrAuthoritativeShadowReasonCodes)[number];

type RejectedReason = Extract<
  VerificationReasonCode,
  | 'authoritative_receipt_not_found'
  | 'receiver_mismatch'
  | 'provider_status_failed'
  | 'provider_reference_reused'
>;

type ReviewReason = Extract<
  VerificationReasonCode,
  | 'authoritative_receipt_unavailable'
  | 'amount_mismatch'
  | 'payment_stale'
  | 'payment_timestamp_future'
  | 'payment_fields_missing'
  | 'receipt_parse_uncertain'
  | 'provider_network_uncertain'
  | 'provider_status_pending'
  | 'payment_type_mismatch'
  | 'verification_review_required'
  | 'duplicate_check_unavailable'
>;

export type CbeBirrAuthoritativeShadowDecision =
  | {
      readonly contractVersion: 1;
      readonly outcome: 'would_verify';
      readonly reasonCode: 'shadow_checks_passed';
    }
  | {
      readonly contractVersion: 1;
      readonly outcome: 'would_reject';
      readonly reasonCode: RejectedReason;
    }
  | {
      readonly contractVersion: 1;
      readonly outcome: 'would_review';
      readonly reasonCode: ReviewReason;
    };

export interface CbeBirrAuthoritativeShadowIntentFacts {
  /** Stage 1A assesses the existing dry-run intake without changing its ledger state. */
  readonly state: 'intake_received' | 'verification_pending' | 'verification_review' | 'other';
  readonly openReview: boolean;
  readonly expectedAmountMinor: number;
  readonly currencyCode: 'ETB';
  /** Strict millisecond UTC ISO timestamp. */
  readonly openedAt: string;
  /** Strict millisecond UTC ISO timestamp. */
  readonly paymentDeadlineAt: string;
}

export type CbeBirrAuthoritativeShadowUnavailableEvidence = {
  readonly lookupOutcome: 'unavailable';
  readonly uncertainty: 'provider' | 'network' | 'parser';
};

export type CbeBirrAuthoritativeShadowMissingEvidence = {
  /** The official authoritative lookup conclusively reported no matching payment. */
  readonly lookupOutcome: 'not_found';
};

export interface CbeBirrAuthoritativeShadowFoundEvidence {
  readonly lookupOutcome: 'found';
  readonly evidenceSource: 'provider_api' | 'provider_receipt_lookup' | 'provider_account_activity';
  readonly providerIdentity: 'matched' | 'mismatched' | 'unknown';
  readonly providerFinalStatus: 'completed' | 'pending' | 'failed' | 'unknown';
  /** Presence only. The canonical reference itself stays inside the adapter. */
  readonly canonicalReferencePresent: boolean;
  readonly amountMinor: number | null;
  readonly currencyCode: 'ETB' | 'other' | 'unknown';
  /** Derived against the immutable receiver-account ID and version; neither value crosses here. */
  readonly receiverMatch: 'matched' | 'mismatched' | 'unknown';
  readonly paymentType: 'send_money' | 'other' | 'unknown';
  /** Strict millisecond UTC ISO timestamp, or null when the provider fact is absent. */
  readonly occurredAt: string | null;
  /** Strict millisecond UTC ISO timestamp, or null when the provider fact is absent. */
  readonly retrievedAt: string | null;
  readonly provenance: {
    readonly adapterVersionPresent: boolean;
    readonly normalizationVersionPresent: boolean;
    readonly evidenceDigestPresent: boolean;
  };
  /** Derived by an injected read boundary; this module never queries a database. */
  readonly duplicateCheck: 'clear' | 'reused' | 'unavailable';
}

export type CbeBirrAuthoritativeShadowEvidence =
  | CbeBirrAuthoritativeShadowUnavailableEvidence
  | CbeBirrAuthoritativeShadowMissingEvidence
  | CbeBirrAuthoritativeShadowFoundEvidence;

export interface CbeBirrAuthoritativeShadowInput {
  readonly contractVersion: 1;
  readonly intent: CbeBirrAuthoritativeShadowIntentFacts;
  /** Strict millisecond UTC ISO timestamp. */
  readonly assessedAt: string;
  readonly evidence: CbeBirrAuthoritativeShadowEvidence;
}

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const topLevelKeys = ['contractVersion', 'intent', 'assessedAt', 'evidence'] as const;
const intentKeys = [
  'state',
  'openReview',
  'expectedAmountMinor',
  'currencyCode',
  'openedAt',
  'paymentDeadlineAt',
] as const;
const foundEvidenceKeys = [
  'lookupOutcome',
  'evidenceSource',
  'providerIdentity',
  'providerFinalStatus',
  'canonicalReferencePresent',
  'amountMinor',
  'currencyCode',
  'receiverMatch',
  'paymentType',
  'occurredAt',
  'retrievedAt',
  'provenance',
  'duplicateCheck',
] as const;
const provenanceKeys = [
  'adapterVersionPresent',
  'normalizationVersionPresent',
  'evidenceDigestPresent',
] as const;
const decisionKeys = ['contractVersion', 'outcome', 'reasonCode'] as const;

type UnknownRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== 'string') ||
    !expected.every((key) => actual.includes(key))
  ) {
    return false;
  }

  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
  });
}

function parseUtcTimestamp(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : undefined;
}

function review(reasonCode: ReviewReason): CbeBirrAuthoritativeShadowDecision {
  return {
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    outcome: 'would_review',
    reasonCode,
  };
}

function reject(reasonCode: RejectedReason): CbeBirrAuthoritativeShadowDecision {
  return {
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    outcome: 'would_reject',
    reasonCode,
  };
}

function isIntentFacts(value: unknown): value is CbeBirrAuthoritativeShadowIntentFacts {
  if (!isPlainRecord(value) || !hasExactKeys(value, intentKeys)) return false;
  return (
    (value.state === 'verification_pending' ||
      value.state === 'intake_received' ||
      value.state === 'verification_review' ||
      value.state === 'other') &&
    typeof value.openReview === 'boolean' &&
    Number.isSafeInteger(value.expectedAmountMinor) &&
    (value.expectedAmountMinor as number) > 0 &&
    value.currencyCode === 'ETB' &&
    parseUtcTimestamp(value.openedAt) !== undefined &&
    parseUtcTimestamp(value.paymentDeadlineAt) !== undefined
  );
}

function isProvenance(
  value: unknown,
): value is CbeBirrAuthoritativeShadowFoundEvidence['provenance'] {
  if (!isPlainRecord(value) || !hasExactKeys(value, provenanceKeys)) return false;
  return provenanceKeys.every((key) => typeof value[key] === 'boolean');
}

function isFoundEvidence(
  value: UnknownRecord,
): value is UnknownRecord & CbeBirrAuthoritativeShadowFoundEvidence {
  if (!hasExactKeys(value, foundEvidenceKeys)) return false;
  return (
    value.lookupOutcome === 'found' &&
    (value.evidenceSource === 'provider_api' ||
      value.evidenceSource === 'provider_receipt_lookup' ||
      value.evidenceSource === 'provider_account_activity') &&
    (value.providerIdentity === 'matched' ||
      value.providerIdentity === 'mismatched' ||
      value.providerIdentity === 'unknown') &&
    (value.providerFinalStatus === 'completed' ||
      value.providerFinalStatus === 'pending' ||
      value.providerFinalStatus === 'failed' ||
      value.providerFinalStatus === 'unknown') &&
    typeof value.canonicalReferencePresent === 'boolean' &&
    (value.amountMinor === null ||
      (Number.isSafeInteger(value.amountMinor) && (value.amountMinor as number) > 0)) &&
    (value.currencyCode === 'ETB' ||
      value.currencyCode === 'other' ||
      value.currencyCode === 'unknown') &&
    (value.receiverMatch === 'matched' ||
      value.receiverMatch === 'mismatched' ||
      value.receiverMatch === 'unknown') &&
    (value.paymentType === 'send_money' ||
      value.paymentType === 'other' ||
      value.paymentType === 'unknown') &&
    (value.occurredAt === null || parseUtcTimestamp(value.occurredAt) !== undefined) &&
    (value.retrievedAt === null || parseUtcTimestamp(value.retrievedAt) !== undefined) &&
    isProvenance(value.provenance) &&
    (value.duplicateCheck === 'clear' ||
      value.duplicateCheck === 'reused' ||
      value.duplicateCheck === 'unavailable')
  );
}

function parseEvidence(value: unknown): CbeBirrAuthoritativeShadowEvidence | undefined {
  if (!isPlainRecord(value) || typeof value.lookupOutcome !== 'string') return undefined;

  if (value.lookupOutcome === 'not_found') {
    return hasExactKeys(value, ['lookupOutcome']) ? { lookupOutcome: 'not_found' } : undefined;
  }

  if (value.lookupOutcome === 'unavailable') {
    if (
      !hasExactKeys(value, ['lookupOutcome', 'uncertainty']) ||
      (value.uncertainty !== 'provider' &&
        value.uncertainty !== 'network' &&
        value.uncertainty !== 'parser')
    ) {
      return undefined;
    }
    return { lookupOutcome: 'unavailable', uncertainty: value.uncertainty };
  }

  return isFoundEvidence(value) ? value : undefined;
}

function parseInput(value: unknown): CbeBirrAuthoritativeShadowInput | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, topLevelKeys)) return undefined;
  const evidence = parseEvidence(value.evidence);
  if (
    value.contractVersion !== CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION ||
    !isIntentFacts(value.intent) ||
    !parseUtcTimestamp(value.assessedAt) ||
    !evidence
  ) {
    return undefined;
  }
  return {
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    intent: value.intent,
    assessedAt: value.assessedAt as string,
    evidence,
  };
}

function parseDecisionForLog(value: unknown): CbeBirrAuthoritativeShadowDecision | undefined {
  if (!isPlainRecord(value)) return undefined;

  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== decisionKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !decisionKeys.every((key) => actualKeys.includes(key))
  ) {
    return undefined;
  }

  const descriptors = decisionKeys.map((key) => Object.getOwnPropertyDescriptor(value, key));
  if (
    descriptors.some(
      (descriptor) =>
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value'),
    )
  ) {
    return undefined;
  }

  const contractVersion = descriptors[0]!.value as unknown;
  const outcome = descriptors[1]!.value as unknown;
  const reasonCode = descriptors[2]!.value as unknown;
  if (contractVersion !== CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION) return undefined;

  if (outcome === 'would_verify' && reasonCode === 'shadow_checks_passed') {
    return { contractVersion, outcome, reasonCode };
  }
  if (
    outcome === 'would_reject' &&
    (reasonCode === 'authoritative_receipt_not_found' ||
      reasonCode === 'receiver_mismatch' ||
      reasonCode === 'provider_status_failed' ||
      reasonCode === 'provider_reference_reused')
  ) {
    return { contractVersion, outcome, reasonCode };
  }
  if (
    outcome === 'would_review' &&
    (reasonCode === 'authoritative_receipt_unavailable' ||
      reasonCode === 'amount_mismatch' ||
      reasonCode === 'payment_stale' ||
      reasonCode === 'payment_timestamp_future' ||
      reasonCode === 'payment_fields_missing' ||
      reasonCode === 'receipt_parse_uncertain' ||
      reasonCode === 'provider_network_uncertain' ||
      reasonCode === 'provider_status_pending' ||
      reasonCode === 'payment_type_mismatch' ||
      reasonCode === 'verification_review_required' ||
      reasonCode === 'duplicate_check_unavailable')
  ) {
    return { contractVersion, outcome, reasonCode };
  }

  return undefined;
}

/**
 * Pure, fail-closed assessment of normalized safe facts. The input is `unknown` intentionally so
 * a changed provider/parser shape cannot bypass runtime validation merely because TypeScript types
 * were asserted upstream.
 */
export function evaluateCbeBirrAuthoritativeShadow(
  candidate: unknown,
): CbeBirrAuthoritativeShadowDecision {
  let input: CbeBirrAuthoritativeShadowInput | undefined;
  try {
    input = parseInput(candidate);
  } catch {
    return review('payment_fields_missing');
  }
  if (!input) return review('payment_fields_missing');

  const openedAt = parseUtcTimestamp(input.intent.openedAt);
  const paymentDeadlineAt = parseUtcTimestamp(input.intent.paymentDeadlineAt);
  const assessedAt = parseUtcTimestamp(input.assessedAt);
  if (
    !openedAt ||
    !paymentDeadlineAt ||
    !assessedAt ||
    openedAt > paymentDeadlineAt ||
    assessedAt < openedAt
  ) {
    return review('payment_fields_missing');
  }

  if (input.intent.state !== 'intake_received' || input.intent.openReview) {
    return review('verification_review_required');
  }

  if (input.evidence.lookupOutcome === 'not_found') {
    return reject('authoritative_receipt_not_found');
  }

  if (input.evidence.lookupOutcome === 'unavailable') {
    if (input.evidence.uncertainty === 'network') return review('provider_network_uncertain');
    if (input.evidence.uncertainty === 'parser') return review('receipt_parse_uncertain');
    return review('authoritative_receipt_unavailable');
  }

  const evidence = input.evidence;
  if (evidence.providerIdentity !== 'matched') return review('receipt_parse_uncertain');

  if (evidence.providerFinalStatus === 'failed') return reject('provider_status_failed');
  if (evidence.providerFinalStatus === 'pending') return review('provider_status_pending');
  if (evidence.providerFinalStatus !== 'completed') return review('receipt_parse_uncertain');

  if (evidence.paymentType === 'other') return review('payment_type_mismatch');
  if (evidence.paymentType !== 'send_money') return review('payment_fields_missing');

  if (evidence.currencyCode === 'other') return review('receipt_parse_uncertain');
  if (evidence.currencyCode !== 'ETB') return review('payment_fields_missing');

  if (evidence.receiverMatch === 'mismatched') return reject('receiver_mismatch');
  if (evidence.receiverMatch !== 'matched') return review('payment_fields_missing');

  if (!evidence.canonicalReferencePresent || evidence.amountMinor === null) {
    return review('payment_fields_missing');
  }
  if (evidence.amountMinor !== input.intent.expectedAmountMinor) return review('amount_mismatch');

  const occurredAt = parseUtcTimestamp(evidence.occurredAt);
  const retrievedAt = parseUtcTimestamp(evidence.retrievedAt);
  if (!occurredAt || !retrievedAt) return review('payment_fields_missing');

  if (
    !evidence.provenance.adapterVersionPresent ||
    !evidence.provenance.normalizationVersionPresent ||
    !evidence.provenance.evidenceDigestPresent
  ) {
    return review('payment_fields_missing');
  }

  const windowAssessment = assessPaymentVerificationWindow({
    openedAt,
    paymentDeadlineAt,
    occurredAt,
    claimAt: assessedAt,
  });
  if (windowAssessment.outcome === 'manual_review') return review(windowAssessment.reason);

  if (retrievedAt < occurredAt || retrievedAt < openedAt) {
    return review('receipt_parse_uncertain');
  }
  if (retrievedAt.getTime() > assessedAt.getTime() + PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS) {
    return review('payment_timestamp_future');
  }

  if (evidence.duplicateCheck === 'reused') return reject('provider_reference_reused');
  if (evidence.duplicateCheck !== 'clear') return review('duplicate_check_unavailable');

  return {
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
    outcome: 'would_verify',
    reasonCode: 'shadow_checks_passed',
  };
}

/** Safe log projection. No caller-supplied fact is copied into logs. */
export function redactedCbeBirrAuthoritativeShadowDecisionForLog(candidate: unknown): {
  readonly contractVersion: 1;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly outcome: CbeBirrAuthoritativeShadowOutcome;
  readonly reasonCode: CbeBirrAuthoritativeShadowReasonCode;
} {
  let decision: CbeBirrAuthoritativeShadowDecision | undefined;
  try {
    decision = parseDecisionForLog(candidate);
  } catch {
    decision = undefined;
  }

  if (!decision) {
    return {
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      outcome: 'would_review',
      reasonCode: 'payment_fields_missing',
    };
  }

  return {
    contractVersion: decision.contractVersion,
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
  };
}
