import { describe, expect, it } from 'vitest';

import {
  planCbeBirrAuthoritativeShadowAttempt,
  type CbeBirrAuthoritativeShadowAttemptPlan,
} from '@fetanagent/contracts';

import {
  normalizeCbeBirrAuthoritativeFixtureResponse,
  redactedCbeBirrAuthoritativeFixtureResponses,
} from './index.js';

const intent = {
  state: 'intake_received' as const,
  openReview: false,
  expectedAmountMinor: 2_500,
  currencyCode: 'ETB' as const,
  openedAt: '2026-08-14T10:00:00.000Z',
  paymentDeadlineAt: '2026-08-14T11:00:00.000Z',
};

function planFixture(
  fixtureKey: keyof typeof redactedCbeBirrAuthoritativeFixtureResponses,
): CbeBirrAuthoritativeShadowAttemptPlan {
  const evidence = normalizeCbeBirrAuthoritativeFixtureResponse(
    redactedCbeBirrAuthoritativeFixtureResponses[fixtureKey],
  );
  return planCbeBirrAuthoritativeShadowAttempt({
    contractVersion: 1,
    intent,
    assessedAt: '2026-08-14T10:10:00.000Z',
    adapterResult: { contractVersion: 1, providerCode: 'cbe_birr', evidence },
  });
}

const expectedPlans = {
  completed: ['complete_advisory', 'would_review', 'duplicate_check_unavailable'],
  wrongReceiver: ['complete_advisory', 'would_reject', 'receiver_mismatch'],
  providerIdentityMismatch: ['retry_candidate', 'would_review', 'receipt_parse_uncertain'],
  wrongAmount: ['complete_advisory', 'would_review', 'amount_mismatch'],
  stale: ['complete_advisory', 'would_review', 'payment_stale'],
  future: ['complete_advisory', 'would_review', 'payment_timestamp_future'],
  pending: ['complete_advisory', 'would_review', 'provider_status_pending'],
  failed: ['complete_advisory', 'would_reject', 'provider_status_failed'],
  notFound: ['complete_advisory', 'would_reject', 'authoritative_receipt_not_found'],
  providerOutage: ['retry_candidate', 'would_review', 'authoritative_receipt_unavailable'],
  networkUncertain: ['retry_candidate', 'would_review', 'provider_network_uncertain'],
  parserUncertain: ['retry_candidate', 'would_review', 'receipt_parse_uncertain'],
  malformed: ['retry_candidate', 'would_review', 'receipt_parse_uncertain'],
  layoutDrift: ['retry_candidate', 'would_review', 'receipt_parse_uncertain'],
  reused: ['complete_advisory', 'would_review', 'duplicate_check_unavailable'],
  duplicateUnavailable: ['complete_advisory', 'would_review', 'duplicate_check_unavailable'],
} as const satisfies Record<
  keyof typeof redactedCbeBirrAuthoritativeFixtureResponses,
  readonly [
    CbeBirrAuthoritativeShadowAttemptPlan['disposition'],
    'would_reject' | 'would_review',
    CbeBirrAuthoritativeShadowAttemptPlan['decision']['reasonCode'],
  ]
>;

describe('CBE Birr authoritative fixtures through the Stage 1C planner', () => {
  it('crosses every Stage 1B fixture through the non-verifying attempt boundary', () => {
    expect(Object.keys(expectedPlans)).toEqual(
      Object.keys(redactedCbeBirrAuthoritativeFixtureResponses),
    );

    for (const fixtureKey of Object.keys(expectedPlans) as Array<keyof typeof expectedPlans>) {
      const [disposition, outcome, reasonCode] = expectedPlans[fixtureKey];
      const plan = planFixture(fixtureKey);
      expect(plan).toMatchObject({ disposition, decision: { outcome, reasonCode } });
      expect(plan.decision.outcome).not.toBe('would_verify');
    }
  });

  it('does not leak any synthetic reference, receiver, or digest through planner output', () => {
    const serialized = JSON.stringify(
      Object.keys(redactedCbeBirrAuthoritativeFixtureResponses).map((fixtureKey) =>
        planFixture(fixtureKey as keyof typeof redactedCbeBirrAuthoritativeFixtureResponses),
      ),
    );

    expect(serialized).not.toContain('SYN-CBE-');
    expect(serialized).not.toContain('fixture-receiver-');
    expect(serialized).not.toContain('fixture-sha256:');
  });
});
