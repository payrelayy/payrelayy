import { describe, expect, it } from 'vitest';

import {
  CBE_BIRR_SHADOW_ADAPTER_VERSION,
  CBE_BIRR_SHADOW_COMPLETE_PROCEDURE,
  CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
  CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS,
  CBE_BIRR_SHADOW_RETRY_PROCEDURE,
  planCbeBirrAuthoritativeShadowAttempt,
  planCbeBirrAuthoritativeShadowSettlementCommand,
  type CbeBirrAuthoritativeShadowAttemptPlan,
  type CbeBirrAuthoritativeShadowSettlementCommand,
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

const leaseReceipt = Object.freeze({
  contractVersion: 1 as const,
  providerCode: 'cbe_birr' as const,
  jobId: '00000000-0000-4000-8000-000000000001',
  leaseToken: '00000000-0000-4000-8000-000000000002',
  attemptNumber: 1,
});

const expectedDispositions = {
  completed: 'complete_advisory',
  wrongReceiver: 'complete_advisory',
  providerIdentityMismatch: 'retry_candidate',
  wrongAmount: 'complete_advisory',
  stale: 'complete_advisory',
  future: 'complete_advisory',
  pending: 'complete_advisory',
  failed: 'complete_advisory',
  notFound: 'complete_advisory',
  providerOutage: 'retry_candidate',
  networkUncertain: 'retry_candidate',
  parserUncertain: 'retry_candidate',
  malformed: 'retry_candidate',
  layoutDrift: 'retry_candidate',
  reused: 'complete_advisory',
  duplicateUnavailable: 'complete_advisory',
} as const satisfies Record<
  keyof typeof redactedCbeBirrAuthoritativeFixtureResponses,
  CbeBirrAuthoritativeShadowSettlementCommand['disposition']
>;

function settleFixture(fixtureKey: keyof typeof redactedCbeBirrAuthoritativeFixtureResponses): {
  readonly attemptPlan: CbeBirrAuthoritativeShadowAttemptPlan;
  readonly command: CbeBirrAuthoritativeShadowSettlementCommand;
} {
  const evidence = normalizeCbeBirrAuthoritativeFixtureResponse(
    redactedCbeBirrAuthoritativeFixtureResponses[fixtureKey],
  );
  const attemptPlan = planCbeBirrAuthoritativeShadowAttempt({
    contractVersion: 1,
    intent,
    assessedAt: '2026-08-14T10:10:00.000Z',
    adapterResult: { contractVersion: 1, providerCode: 'cbe_birr', evidence },
  });
  const command = planCbeBirrAuthoritativeShadowSettlementCommand(leaseReceipt, attemptPlan);
  if (command === null) throw new Error(`Fixture ${fixtureKey} did not produce a command.`);

  return { attemptPlan, command };
}

describe('CBE Birr authoritative fixtures through the Stage 1D settlement planner', () => {
  it('maps every Stage 1B fixture through Stage 1C into the correct command class', () => {
    expect(Object.keys(expectedDispositions)).toEqual(
      Object.keys(redactedCbeBirrAuthoritativeFixtureResponses),
    );

    for (const fixtureKey of Object.keys(expectedDispositions) as Array<
      keyof typeof expectedDispositions
    >) {
      const { attemptPlan, command } = settleFixture(fixtureKey);
      expect(attemptPlan.decision.outcome).not.toBe('would_verify');
      expect(command.disposition).toBe(expectedDispositions[fixtureKey]);

      if (command.disposition === 'complete_advisory') {
        expect(attemptPlan.disposition).toBe('complete_advisory');
        expect(command.procedure).toBe(CBE_BIRR_SHADOW_COMPLETE_PROCEDURE);
        expect(command.arguments).toEqual([
          leaseReceipt.jobId,
          leaseReceipt.leaseToken,
          leaseReceipt.attemptNumber,
          attemptPlan.decision.outcome,
          attemptPlan.decision.reasonCode,
          null,
          null,
          CBE_BIRR_SHADOW_ADAPTER_VERSION,
          CBE_BIRR_SHADOW_NORMALIZATION_VERSION,
        ]);
      } else {
        expect(attemptPlan.disposition).toBe('retry_candidate');
        expect(command.procedure).toBe(CBE_BIRR_SHADOW_RETRY_PROCEDURE);
        expect(command.arguments).toEqual([
          leaseReceipt.jobId,
          leaseReceipt.leaseToken,
          leaseReceipt.attemptNumber,
          attemptPlan.decision.reasonCode,
          CBE_BIRR_SHADOW_RETRY_AFTER_SECONDS,
        ]);
      }
    }
  });

  it('does not emit SQL or leak synthetic reference, receiver, or digest material', () => {
    const results = Object.keys(redactedCbeBirrAuthoritativeFixtureResponses).map((fixtureKey) =>
      settleFixture(fixtureKey as keyof typeof redactedCbeBirrAuthoritativeFixtureResponses),
    );
    const serialized = JSON.stringify(results);

    expect(serialized).not.toContain('would_verify');
    expect(serialized).not.toContain('SYN-CBE-');
    expect(serialized).not.toContain('fixture-receiver-');
    expect(serialized).not.toContain('fixture-sha256:');

    for (const { command } of results) {
      expect(Object.keys(command)).toEqual([
        'contractVersion',
        'providerCode',
        'advisoryOnly',
        'disposition',
        'procedure',
        'arguments',
      ]);
      expect(command.procedure).not.toMatch(/[;\s]/u);
    }
  });
});
