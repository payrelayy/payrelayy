/**
 * This module is intentionally limited to redacted, local fixtures. It does not make provider
 * calls, access a database, log receipt material, create a payment claim, or initiate execution.
 */

export const CBE_BIRR_FIXTURE_SCHEMA = 'CBE_BIRR_DRY_RUN_V1' as const;
export const CBE_BIRR_FIXTURE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const MAX_REDACTED_RECEIPT_LENGTH = 4_096;
const FIXTURE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CANONICAL_REFERENCE_PATTERN = /^FX-[A-Z0-9]{8,32}$/;
const RECEIVER_KEY_PATTERN = /^fixture-receiver-[a-z0-9-]{1,40}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]{0,8}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const fixtureKeys = [
  'schema',
  'provider',
  'status',
  'canonical_reference',
  'amount_minor',
  'receiver_key',
  'occurred_at',
] as const;

type FixtureStatus = 'completed' | 'pending' | 'failed';

interface ParsedFixtureEvidence {
  readonly status: FixtureStatus;
  /**
   * Kept inside this pure module only. It is never placed in an outcome, error, or log message.
   */
  readonly canonicalReference: string;
  readonly amountMinor: number;
  /** Kept inside this pure module only. */
  readonly receiverKey: string;
  readonly occurredAt: Date;
}

type FixtureParseResult =
  | { readonly kind: 'parsed'; readonly evidence: ParsedFixtureEvidence }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unknown' };

/**
 * A lookup supplies redacted static test material only. Production code must never implement this
 * interface with an HTTP client, database, browser, or provider credential.
 */
export interface CbeBirrFixtureLookup {
  lookup(fixtureId: string): CbeBirrFixtureLookupResponse;
}

export type CbeBirrFixtureLookupResponse =
  | { readonly kind: 'found'; readonly redactedReceipt: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' };

/**
 * This is an injected in-memory test double for duplicate-reference behavior. The argument is
 * deliberately confined to this module; it must never be logged or returned to a caller.
 */
export interface CbeBirrFixtureClaimLookup {
  hasPriorClaim(canonicalReference: string): boolean;
}

export interface CbeBirrFixtureVerificationInput {
  /** Opaque fixture label, not a transaction reference. */
  readonly fixtureId: string;
  readonly expectedAmountMinor: number;
  /** A synthetic fixture key, never a real receiver account or phone number. */
  readonly expectedReceiverKey: string;
  readonly openedAt: Date;
  readonly paymentDeadlineAt: Date;
  readonly assessedAt: Date;
}

export interface CbeBirrFixtureVerifierDependencies {
  readonly fixtureLookup: CbeBirrFixtureLookup;
  readonly claimLookup: CbeBirrFixtureClaimLookup;
}

/**
 * The decision contains no receipt, canonical-reference, receiver, transaction-ID, or provider
 * payload values. It is advisory fixture output only and is not a payment-verification result.
 */
export type CbeBirrFixtureVerificationDecision =
  | { readonly outcome: 'would_verify'; readonly reason: 'fixture_completed' }
  | {
      readonly outcome: 'would_reject';
      readonly reason: 'receiver_mismatch' | 'provider_status_failed' | 'provider_reference_reused';
    }
  | {
      readonly outcome: 'would_review';
      readonly reason:
        | 'amount_mismatch'
        | 'payment_stale'
        | 'payment_timestamp_future'
        | 'fixture_request_invalid'
        | 'fixture_unavailable'
        | 'fixture_malformed'
        | 'fixture_unknown'
        | 'fixture_status_pending'
        | 'fixture_duplicate_check_unavailable';
    };

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function parseUtcTimestamp(value: string): Date | undefined {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) return undefined;

  const parsed = new Date(value);
  if (!isValidDate(parsed) || parsed.toISOString() !== value) return undefined;
  return parsed;
}

/**
 * Accept only the synthetic canonical form that fixture data declares. There is intentionally no
 * forgiving trim, case folding, OCR repair, or layout guessing at this boundary.
 */
function normalizeCanonicalReference(value: string): string | undefined {
  return CANONICAL_REFERENCE_PATTERN.test(value) ? value : undefined;
}

function normalizeReceiverKey(value: string): string | undefined {
  return RECEIVER_KEY_PATTERN.test(value) ? value : undefined;
}

function parseStrictRedactedFixtureReceipt(redactedReceipt: string): FixtureParseResult {
  if (
    redactedReceipt.length === 0 ||
    redactedReceipt.length > MAX_REDACTED_RECEIPT_LENGTH ||
    redactedReceipt.includes('\r') ||
    redactedReceipt.includes('\0') ||
    !redactedReceipt.endsWith('\n')
  ) {
    return { kind: 'malformed' };
  }

  const lines = redactedReceipt.slice(0, -1).split('\n');
  if (lines.length !== fixtureKeys.length || lines.some((line) => line.length === 0)) {
    return { kind: 'malformed' };
  }

  const values = new Map<string, string>();
  for (const [index, key] of fixtureKeys.entries()) {
    const line = lines[index];
    const prefix = `${key}=`;
    if (!line?.startsWith(prefix)) return { kind: 'malformed' };

    const value = line.slice(prefix.length);
    if (value.length === 0 || value.includes('=')) return { kind: 'malformed' };
    values.set(key, value);
  }

  const schema = values.get('schema');
  const provider = values.get('provider');
  const status = values.get('status');
  const reference = values.get('canonical_reference');
  const amountMinor = values.get('amount_minor');
  const receiverKey = values.get('receiver_key');
  const occurredAt = values.get('occurred_at');

  if (
    schema !== CBE_BIRR_FIXTURE_SCHEMA ||
    provider !== 'cbe_birr' ||
    !status ||
    !reference ||
    !amountMinor ||
    !receiverKey ||
    !occurredAt
  ) {
    return { kind: 'unknown' };
  }

  if (status !== 'completed' && status !== 'pending' && status !== 'failed') {
    return { kind: 'unknown' };
  }

  const canonicalReference = normalizeCanonicalReference(reference);
  const normalizedReceiverKey = normalizeReceiverKey(receiverKey);
  const normalizedOccurredAt = parseUtcTimestamp(occurredAt);

  if (
    !canonicalReference ||
    !normalizedReceiverKey ||
    !POSITIVE_INTEGER_PATTERN.test(amountMinor)
  ) {
    return { kind: 'malformed' };
  }

  const normalizedAmountMinor = Number(amountMinor);
  if (!Number.isSafeInteger(normalizedAmountMinor) || !normalizedOccurredAt) {
    return { kind: 'malformed' };
  }

  return {
    kind: 'parsed',
    evidence: {
      status,
      canonicalReference,
      amountMinor: normalizedAmountMinor,
      receiverKey: normalizedReceiverKey,
      occurredAt: normalizedOccurredAt,
    },
  };
}

function isValidInput(input: CbeBirrFixtureVerificationInput): boolean {
  return (
    FIXTURE_ID_PATTERN.test(input.fixtureId) &&
    Number.isSafeInteger(input.expectedAmountMinor) &&
    input.expectedAmountMinor > 0 &&
    RECEIVER_KEY_PATTERN.test(input.expectedReceiverKey) &&
    isValidDate(input.openedAt) &&
    isValidDate(input.paymentDeadlineAt) &&
    isValidDate(input.assessedAt) &&
    input.openedAt <= input.paymentDeadlineAt &&
    input.assessedAt >= input.openedAt
  );
}

function assessEvidenceWindow(
  evidence: ParsedFixtureEvidence,
  input: CbeBirrFixtureVerificationInput,
): CbeBirrFixtureVerificationDecision | undefined {
  if (
    input.assessedAt > input.paymentDeadlineAt ||
    evidence.occurredAt < input.openedAt ||
    evidence.occurredAt > input.paymentDeadlineAt
  ) {
    return { outcome: 'would_review', reason: 'payment_stale' };
  }

  if (
    evidence.occurredAt.getTime() >
    input.assessedAt.getTime() + CBE_BIRR_FIXTURE_FUTURE_TOLERANCE_MS
  ) {
    return { outcome: 'would_review', reason: 'payment_timestamp_future' };
  }

  return undefined;
}

/**
 * Evaluates only redacted local fixtures. This function is side-effect free and must remain
 * disconnected from production provider, database, Telegram, KemerBet, and execution code.
 */
export function evaluateCbeBirrFixtureVerification(
  input: CbeBirrFixtureVerificationInput,
  dependencies: CbeBirrFixtureVerifierDependencies,
): CbeBirrFixtureVerificationDecision {
  if (!isValidInput(input)) {
    return { outcome: 'would_review', reason: 'fixture_request_invalid' };
  }

  let lookupResponse: CbeBirrFixtureLookupResponse;
  try {
    lookupResponse = dependencies.fixtureLookup.lookup(input.fixtureId);
  } catch {
    return { outcome: 'would_review', reason: 'fixture_unavailable' };
  }

  if (!lookupResponse || lookupResponse.kind === 'unavailable') {
    return { outcome: 'would_review', reason: 'fixture_unavailable' };
  }

  if (lookupResponse.kind === 'missing') {
    return { outcome: 'would_review', reason: 'fixture_unknown' };
  }

  if (lookupResponse.kind !== 'found' || typeof lookupResponse.redactedReceipt !== 'string') {
    return { outcome: 'would_review', reason: 'fixture_malformed' };
  }

  const parsed = parseStrictRedactedFixtureReceipt(lookupResponse.redactedReceipt);
  if (parsed.kind === 'malformed') {
    return { outcome: 'would_review', reason: 'fixture_malformed' };
  }

  if (parsed.kind === 'unknown') {
    return { outcome: 'would_review', reason: 'fixture_unknown' };
  }

  const { evidence } = parsed;
  if (evidence.status === 'pending') {
    return { outcome: 'would_review', reason: 'fixture_status_pending' };
  }

  if (evidence.status === 'failed') {
    return { outcome: 'would_reject', reason: 'provider_status_failed' };
  }

  if (evidence.receiverKey !== input.expectedReceiverKey) {
    return { outcome: 'would_reject', reason: 'receiver_mismatch' };
  }

  if (evidence.amountMinor !== input.expectedAmountMinor) {
    return { outcome: 'would_review', reason: 'amount_mismatch' };
  }

  const windowDecision = assessEvidenceWindow(evidence, input);
  if (windowDecision) return windowDecision;

  try {
    if (dependencies.claimLookup.hasPriorClaim(evidence.canonicalReference)) {
      return { outcome: 'would_reject', reason: 'provider_reference_reused' };
    }
  } catch {
    return { outcome: 'would_review', reason: 'fixture_duplicate_check_unavailable' };
  }

  return { outcome: 'would_verify', reason: 'fixture_completed' };
}
