/**
 * Offline CBE Birr format candidate. This module has no runtime consumers and confers no
 * provider authority. Its outputs must not be used to fetch a receipt, settle a proof, or credit
 * a Player until the separate ownership, key-lifecycle, source, and lease reviews are complete.
 */
export const CBE_BIRR_NORMALIZATION_CANDIDATE_VERSION = 1 as const;

const SUBMITTED_REFERENCE_PATTERN = /^[A-Za-z0-9]{8,32}$/u;
const CANONICAL_REFERENCE_PATTERN = /^[A-Z0-9]{8,32}$/u;
const RECEIVER_LOOKUP_SELECTOR_PATTERN = /^251[0-9]{9}$/u;

/**
 * Candidate for customer-entered references only. Accepts ASCII case variation, but never trims,
 * removes punctuation, changes Unicode, or infers a missing character. Null means invalid input.
 */
export function normalizeCbeBirrSubmittedReferenceCandidate(value: unknown): string | null {
  return typeof value === 'string' && SUBMITTED_REFERENCE_PATTERN.test(value)
    ? value.toUpperCase()
    : null;
}

/**
 * A separately observed receipt or protected lookup value must already be canonical. This check
 * does not prove that a provider issued the reference or that it belongs to a particular payment.
 */
export function isCanonicalCbeBirrReferenceCandidate(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_REFERENCE_PATTERN.test(value);
}

/**
 * The official PH lookup selector is exactly 251 plus nine ASCII digits. A 9-digit Owner value
 * is not silently upgraded; the full value must be provisioned and independently reviewed.
 * PH is a lookup selector, never proof that the receipt's credit account matches the receiver.
 */
export function isCbeBirrReceiverLookupSelectorCandidate(value: unknown): value is string {
  return typeof value === 'string' && RECEIVER_LOOKUP_SELECTOR_PATTERN.test(value);
}
