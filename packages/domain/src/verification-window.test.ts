import { describe, expect, it } from 'vitest';

import {
  assessPaymentVerificationWindow,
  PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS,
} from './verification-window.js';

const openedAt = new Date('2026-08-08T10:00:00.000Z');
const paymentDeadlineAt = new Date('2026-08-08T11:00:00.000Z');

describe('payment verification window', () => {
  it('accepts exact opening and deadline boundaries', () => {
    expect(
      assessPaymentVerificationWindow({
        openedAt,
        paymentDeadlineAt,
        occurredAt: openedAt,
        claimAt: paymentDeadlineAt,
      }),
    ).toEqual({ outcome: 'eligible' });
  });

  it('allows exactly five minutes of future provider clock skew', () => {
    const claimAt = new Date('2026-08-08T10:30:00.000Z');
    const occurredAt = new Date(claimAt.getTime() + PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS);

    expect(
      assessPaymentVerificationWindow({ openedAt, paymentDeadlineAt, occurredAt, claimAt }),
    ).toEqual({ outcome: 'eligible' });
  });

  it('fails closed after the deadline or outside the immutable evidence window', () => {
    expect(
      assessPaymentVerificationWindow({
        openedAt,
        paymentDeadlineAt,
        occurredAt: paymentDeadlineAt,
        claimAt: new Date(paymentDeadlineAt.getTime() + 1),
      }),
    ).toEqual({ outcome: 'manual_review', reason: 'payment_stale' });

    expect(
      assessPaymentVerificationWindow({
        openedAt,
        paymentDeadlineAt,
        occurredAt: new Date(openedAt.getTime() - 1),
        claimAt: openedAt,
      }),
    ).toEqual({ outcome: 'manual_review', reason: 'payment_stale' });
  });

  it('rejects provider timestamps beyond the future-clock tolerance', () => {
    const claimAt = new Date('2026-08-08T10:30:00.000Z');
    const occurredAt = new Date(claimAt.getTime() + PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS + 1);

    expect(
      assessPaymentVerificationWindow({ openedAt, paymentDeadlineAt, occurredAt, claimAt }),
    ).toEqual({ outcome: 'manual_review', reason: 'payment_timestamp_future' });
  });

  it('prioritizes stale evidence and fails closed for invalid configuration', () => {
    expect(
      assessPaymentVerificationWindow({
        openedAt,
        paymentDeadlineAt,
        occurredAt: new Date(
          paymentDeadlineAt.getTime() + PAYMENT_EVIDENCE_FUTURE_TOLERANCE_MS + 1,
        ),
        claimAt: openedAt,
      }),
    ).toEqual({ outcome: 'manual_review', reason: 'payment_stale' });

    expect(
      assessPaymentVerificationWindow({
        openedAt: paymentDeadlineAt,
        paymentDeadlineAt: openedAt,
        occurredAt: openedAt,
        claimAt: openedAt,
      }),
    ).toEqual({ outcome: 'manual_review', reason: 'payment_fields_missing' });
  });
});
