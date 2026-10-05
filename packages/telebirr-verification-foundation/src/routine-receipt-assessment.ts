import { TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE } from './synthetic-official-receipt.js';

/** Policy-only assessment. This never authenticates a device or creates financial authority. */
export const ROUTINE_TELEBIRR_MINIMUM_AMOUNT_MINOR = 2_500;
export const ROUTINE_TELEBIRR_MAXIMUM_AMOUNT_MINOR = 2_500_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const SEVEN_DAYS_MS = 7 * 24 * ONE_HOUR_MS;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
// The routine candidate stores the v2 protected-reference HMAC as 64 lowercase hex characters.
// The old pilot's `hmac-sha256:` envelope is a different profile and must not be reused here.
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const INPUT_KEYS = [
  'assessedAt',
  'candidate',
  'expectedReceiverNameDigest',
  'expectedReceiverProfileDigest',
  'expectedReceiverRevisionId',
  'observation',
] as const;
const CANDIDATE_KEYS = [
  'providerCode',
  'referenceFingerprint',
  'referenceKeyVersion',
  'referenceProfileVersion',
  'submittedAt',
] as const;
const OBSERVATION_KEYS = [
  'amountMinor',
  'canonicalReferencePresent',
  'creditedPartyNameDigest',
  'currencyCode',
  'evidenceSource',
  'occurredAt',
  'observedAt',
  'paymentChannel',
  'paymentMode',
  'paymentReason',
  'providerCode',
  'providerFinalStatus',
  'providerIdentity',
  'receiverMatch',
  'receiverProfileDigest',
  'receiverRevisionId',
  'referenceFingerprint',
  'referenceMatch',
  'retrievedAt',
  'sourceProfile',
] as const;

export type RoutineTelebirrReceiptAssessmentReason =
  | 'invalid_request'
  | 'candidate_expired'
  | 'provider_mismatch'
  | 'reference_mismatch'
  | 'receiver_mismatch'
  | 'provider_not_completed'
  | 'amount_out_of_range'
  | 'receipt_semantics_incomplete'
  | 'payment_time_mismatch'
  | 'observation_time_invalid'
  | 'observed_facts_match';

export interface RoutineTelebirrReceiptAssessment {
  readonly advisoryOnly: true;
  readonly sourceAuthenticationPerformed: false;
  readonly databaseWriteAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_match_observed_facts';
  readonly reasonCode: RoutineTelebirrReceiptAssessmentReason;
}

function result(
  disposition: RoutineTelebirrReceiptAssessment['disposition'],
  reasonCode: RoutineTelebirrReceiptAssessmentReason,
): RoutineTelebirrReceiptAssessment {
  return Object.freeze({
    advisoryOnly: true,
    sourceAuthenticationPerformed: false,
    databaseWriteAllowed: false,
    claimAllowed: false,
    settlementAllowed: false,
    enqueueAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    disposition,
    reasonCode,
  });
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    keys.some(
      (key) => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key]!, 'value'),
    )
  ) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function utcMs(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
}

/**
 * Checks only the non-pilot amount, reference, receiver and timing policy against observed facts.
 * The caller must separately authenticate the official source and signed phone observation, then
 * establish a one-use claim and verified job transactionally in the database. A matching result
 * is never permission to perform any of those actions.
 */
export function assessRoutineTelebirrObservedReceiptFacts(
  candidateInput: unknown,
): RoutineTelebirrReceiptAssessment {
  try {
    const input = exactDataRecord(candidateInput, INPUT_KEYS);
    const candidate = input && exactDataRecord(input.candidate, CANDIDATE_KEYS);
    const observation = input && exactDataRecord(input.observation, OBSERVATION_KEYS);
    if (!input || !candidate || !observation) return result('would_review', 'invalid_request');

    const submittedAt = utcMs(candidate.submittedAt);
    const occurredAt = utcMs(observation.occurredAt);
    const retrievedAt = utcMs(observation.retrievedAt);
    const observedAt = utcMs(observation.observedAt);
    const assessedAt = utcMs(input.assessedAt);
    if (
      candidate.providerCode !== 'telebirr' ||
      candidate.referenceKeyVersion !== 2 ||
      candidate.referenceProfileVersion !== 2 ||
      typeof candidate.referenceFingerprint !== 'string' ||
      !FINGERPRINT.test(candidate.referenceFingerprint) ||
      typeof observation.referenceFingerprint !== 'string' ||
      !FINGERPRINT.test(observation.referenceFingerprint) ||
      typeof input.expectedReceiverNameDigest !== 'string' ||
      !DIGEST.test(input.expectedReceiverNameDigest) ||
      typeof input.expectedReceiverProfileDigest !== 'string' ||
      !DIGEST.test(input.expectedReceiverProfileDigest) ||
      typeof input.expectedReceiverRevisionId !== 'string' ||
      !UUID_V4.test(input.expectedReceiverRevisionId) ||
      typeof observation.receiverProfileDigest !== 'string' ||
      !DIGEST.test(observation.receiverProfileDigest) ||
      typeof observation.receiverRevisionId !== 'string' ||
      !UUID_V4.test(observation.receiverRevisionId) ||
      typeof observation.creditedPartyNameDigest !== 'string' ||
      !DIGEST.test(observation.creditedPartyNameDigest) ||
      submittedAt === null ||
      occurredAt === null ||
      retrievedAt === null ||
      observedAt === null ||
      assessedAt === null ||
      typeof observation.amountMinor !== 'number' ||
      !Number.isSafeInteger(observation.amountMinor) ||
      typeof observation.canonicalReferencePresent !== 'boolean'
    ) {
      return result('would_review', 'invalid_request');
    }
    if (assessedAt < submittedAt || assessedAt - submittedAt >= SEVEN_DAYS_MS) {
      return result('would_review', 'candidate_expired');
    }
    if (observation.providerCode !== 'telebirr' || observation.providerIdentity !== 'matched') {
      return result('would_review', 'provider_mismatch');
    }
    if (
      observation.referenceFingerprint !== candidate.referenceFingerprint ||
      observation.canonicalReferencePresent !== true ||
      observation.referenceMatch !== 'matched'
    ) {
      return result('would_review', 'reference_mismatch');
    }
    if (
      observation.receiverMatch !== 'matched' ||
      observation.creditedPartyNameDigest !== input.expectedReceiverNameDigest ||
      observation.receiverProfileDigest !== input.expectedReceiverProfileDigest ||
      observation.receiverRevisionId !== input.expectedReceiverRevisionId
    ) {
      return result('would_review', 'receiver_mismatch');
    }
    if (observation.providerFinalStatus !== 'completed') {
      return result('would_review', 'provider_not_completed');
    }
    if (
      observation.amountMinor < ROUTINE_TELEBIRR_MINIMUM_AMOUNT_MINOR ||
      observation.amountMinor > ROUTINE_TELEBIRR_MAXIMUM_AMOUNT_MINOR
    ) {
      return result('would_review', 'amount_out_of_range');
    }
    if (
      observation.currencyCode !== 'ETB' ||
      observation.evidenceSource !== 'provider_receipt_lookup' ||
      observation.sourceProfile !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
      observation.paymentMode !== 'telebirr' ||
      observation.paymentReason !== 'send_money_to_registered_customer' ||
      observation.paymentChannel !== 'api_app'
    ) {
      return result('would_review', 'receipt_semantics_incomplete');
    }
    if (occurredAt < submittedAt - ONE_HOUR_MS || occurredAt > submittedAt + FIVE_MINUTES_MS) {
      return result('would_review', 'payment_time_mismatch');
    }
    if (retrievedAt !== observedAt || observedAt < occurredAt || observedAt > assessedAt) {
      return result('would_review', 'observation_time_invalid');
    }
    return result('would_match_observed_facts', 'observed_facts_match');
  } catch {
    return result('would_review', 'invalid_request');
  }
}
