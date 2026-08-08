import type { VerificationReasonCode } from './reason-codes.js';

/**
 * Mirrors the maximum future-clock tolerance enforced by the database claim procedure. This is
 * advisory only: the database remains the final authority for an automatic payment claim.
 */
export const PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface PaymentVerificationWindowInput {
  readonly openedAt: Date;
  readonly paymentDeadlineAt: Date;
  readonly occurredAt: Date;
  readonly claimAt: Date;
}

export type PaymentVerificationWindowAssessment =
  | { readonly outcome: 'eligible' }
  | {
      readonly outcome: 'manual_review';
      readonly reason: Extract<
        VerificationReasonCode,
        'payment_fields_missing' | 'payment_stale' | 'payment_timestamp_future'
      >;
    };

function isValidTimestamp(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

/**
 * Fails closed when a provider timestamp is outside the immutable deposit window or beyond the
 * small permitted future clock skew. It does not create a claim or change a deposit state.
 */
export function assessPaymentVerificationWindow(
  input: PaymentVerificationWindowInput,
): PaymentVerificationWindowAssessment {
  const { openedAt, paymentDeadlineAt, occurredAt, claimAt } = input;

  if (
    !isValidTimestamp(openedAt) ||
    !isValidTimestamp(paymentDeadlineAt) ||
    !isValidTimestamp(occurredAt) ||
    !isValidTimestamp(claimAt) ||
    openedAt > paymentDeadlineAt ||
    claimAt < openedAt
  ) {
    return { outcome: 'manual_review', reason: 'payment_fields_missing' };
  }

  if (claimAt > paymentDeadlineAt || occurredAt < openedAt || occurredAt > paymentDeadlineAt) {
    return { outcome: 'manual_review', reason: 'payment_stale' };
  }

  if (occurredAt.getTime() > claimAt.getTime() + PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS) {
    return { outcome: 'manual_review', reason: 'payment_timestamp_future' };
  }

  return { outcome: 'eligible' };
}
