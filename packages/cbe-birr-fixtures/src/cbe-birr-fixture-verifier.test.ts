import { describe, expect, it } from 'vitest';

import {
  createRedactedCbeBirrFixtureLookup,
  evaluateCbeBirrFixtureVerification,
  redactedCbeBirrFixtureIds,
  redactedCbeBirrFixtureLookup,
  type CbeBirrFixtureClaimLookup,
  type CbeBirrFixtureVerificationInput,
} from './index.js';

const baselineInput: Omit<CbeBirrFixtureVerificationInput, 'fixtureId'> = {
  expectedAmountMinor: 2500,
  expectedReceiverKey: 'fixture-receiver-primary',
  openedAt: new Date('2026-08-09T10:00:00.000Z'),
  paymentDeadlineAt: new Date('2026-08-09T11:00:00.000Z'),
  assessedAt: new Date('2026-08-09T10:10:00.000Z'),
};

const noPriorClaims: CbeBirrFixtureClaimLookup = {
  hasPriorClaim: () => false,
};

function evaluateFixture(
  fixtureId: string,
  claimLookup: CbeBirrFixtureClaimLookup = noPriorClaims,
) {
  return evaluateCbeBirrFixtureVerification(
    { ...baselineInput, fixtureId },
    { fixtureLookup: redactedCbeBirrFixtureLookup, claimLookup },
  );
}

describe('CBE Birr fixture-only dry-run verifier', () => {
  it('fails closed when asked to construct fixtures from an invalid timeline', () => {
    const fixtureLookup = createRedactedCbeBirrFixtureLookup({
      ...baselineInput,
      openedAt: new Date('invalid'),
    });
    expect(fixtureLookup.lookup(redactedCbeBirrFixtureIds.valid)).toEqual({
      kind: 'unavailable',
    });
  });

  it('would verify only the completed, matching, fresh synthetic fixture', () => {
    expect(evaluateFixture(redactedCbeBirrFixtureIds.valid)).toEqual({
      outcome: 'would_verify',
      reason: 'fixture_completed',
    });
  });

  it('would reject a wrong receiver without returning any receiver material', () => {
    const decision = evaluateFixture(redactedCbeBirrFixtureIds.wrongReceiver);

    expect(decision).toEqual({ outcome: 'would_reject', reason: 'receiver_mismatch' });
    expect(JSON.stringify(decision)).not.toContain('fixture-receiver-other');
  });

  it('would review a wrong amount rather than silently crediting it', () => {
    expect(evaluateFixture(redactedCbeBirrFixtureIds.wrongAmount)).toEqual({
      outcome: 'would_review',
      reason: 'amount_mismatch',
    });
  });

  it('would review stale and future evidence', () => {
    expect(evaluateFixture(redactedCbeBirrFixtureIds.stale)).toEqual({
      outcome: 'would_review',
      reason: 'payment_stale',
    });
    expect(evaluateFixture(redactedCbeBirrFixtureIds.future)).toEqual({
      outcome: 'would_review',
      reason: 'payment_timestamp_future',
    });
  });

  it('would review a pending status and reject a failed status', () => {
    expect(evaluateFixture(redactedCbeBirrFixtureIds.pending)).toEqual({
      outcome: 'would_review',
      reason: 'fixture_status_pending',
    });
    expect(evaluateFixture(redactedCbeBirrFixtureIds.failed)).toEqual({
      outcome: 'would_reject',
      reason: 'provider_status_failed',
    });
  });

  it('would review malformed, unknown, missing, and unavailable fixture material', () => {
    expect(evaluateFixture(redactedCbeBirrFixtureIds.malformed)).toEqual({
      outcome: 'would_review',
      reason: 'fixture_malformed',
    });
    expect(evaluateFixture(redactedCbeBirrFixtureIds.unknown)).toEqual({
      outcome: 'would_review',
      reason: 'fixture_unknown',
    });
    expect(evaluateFixture('missing-fixture')).toEqual({
      outcome: 'would_review',
      reason: 'fixture_unknown',
    });
    expect(evaluateFixture(redactedCbeBirrFixtureIds.unavailable)).toEqual({
      outcome: 'would_review',
      reason: 'fixture_unavailable',
    });
  });

  it('fails closed when a fixture changes its exact field order', () => {
    const changedLayoutLookup = {
      lookup: () => ({
        kind: 'found' as const,
        redactedReceipt: [
          'provider=cbe_birr',
          'schema=CBE_BIRR_DRY_RUN_V1',
          'status=completed',
          'canonical_reference=FX-00000010',
          'amount_minor=2500',
          'receiver_key=fixture-receiver-primary',
          'occurred_at=2026-08-09T10:10:00.000Z',
          '',
        ].join('\n'),
      }),
    };

    expect(
      evaluateCbeBirrFixtureVerification(
        { ...baselineInput, fixtureId: 'changed-layout' },
        { fixtureLookup: changedLayoutLookup, claimLookup: noPriorClaims },
      ),
    ).toEqual({ outcome: 'would_review', reason: 'fixture_malformed' });
  });

  it('would reject a reused canonical reference without returning it', () => {
    const priorClaim: CbeBirrFixtureClaimLookup = {
      hasPriorClaim: (canonicalReference) => canonicalReference === 'FX-00000009',
    };
    const decision = evaluateFixture(redactedCbeBirrFixtureIds.duplicate, priorClaim);

    expect(decision).toEqual({ outcome: 'would_reject', reason: 'provider_reference_reused' });
    expect(JSON.stringify(decision)).not.toContain('FX-00000009');
  });

  it('fails closed for an invalid dry-run request or unavailable duplicate check', () => {
    expect(
      evaluateCbeBirrFixtureVerification(
        { ...baselineInput, fixtureId: 'VALID-COMPLETED' },
        { fixtureLookup: redactedCbeBirrFixtureLookup, claimLookup: noPriorClaims },
      ),
    ).toEqual({ outcome: 'would_review', reason: 'fixture_request_invalid' });

    expect(
      evaluateFixture(redactedCbeBirrFixtureIds.valid, {
        hasPriorClaim: () => {
          throw new Error('not exposed');
        },
      }),
    ).toEqual({ outcome: 'would_review', reason: 'fixture_duplicate_check_unavailable' });
  });
});
