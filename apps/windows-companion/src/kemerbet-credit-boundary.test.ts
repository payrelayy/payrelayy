import { describe, expect, it } from 'vitest';

import {
  projectKemerBetCreditOrder,
  projectKemerBetDispatchObservation,
  projectKemerBetFencedAttempt,
  projectKemerBetPreparedAttempt,
  projectKemerBetReconciliation,
} from './kemerbet-credit-boundary.js';
import type {
  RoutineDepositLease,
  RoutineDepositPolicy,
  RoutineDepositReconciliation,
} from './routine-deposit-worker.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const POLICY: RoutineDepositPolicy = Object.freeze({
  mode: 'routine_production',
  status: 'active',
  version: 1,
  provider: 'receiver_sms',
  platformCode: 'kemerbet',
  currencyCode: 'ETB',
  minimumAmountMinor: 2500,
  maximumAmountMinor: 2500000,
  playerScope: 'all_active_deposit_eligible',
  playerOwnershipRequired: false,
  dailyQuotaMinor: null,
  successfulDepositQuota: null,
  maxConcurrentDeposits: 1,
  amountSource: 'receiver_sms_amount',
});
const EXECUTE_LEASE: RoutineDepositLease = Object.freeze({
  jobId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  intentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  attemptId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  paymentClaimId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  platformAgentAccountId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  playerId: 'PLAYER-10025',
  amountMinor: 10025,
  currencyCode: 'ETB',
  policy: POLICY,
  phase: 'execute',
  paymentVerified: true,
  playerActive: true,
  playerDepositEligible: true,
  attemptNumber: 1,
  finalActionFenced: false,
});
const FENCED_LEASE: RoutineDepositLease = Object.freeze({
  ...EXECUTE_LEASE,
  phase: 'reconcile',
  finalActionFenced: true,
});

function confirmedResult(
  overrides: Partial<Extract<RoutineDepositReconciliation, { outcome: 'confirmed_executed' }>> = {},
): RoutineDepositReconciliation {
  return {
    ...FENCED_LEASE,
    outcome: 'confirmed_executed',
    reconciliationId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    evidenceDigest: DIGEST,
    exactHistoryMatchCount: 1,
    playerCreditConfirmed: true,
    ...overrides,
  };
}

describe('KemerBet credit contract projection', () => {
  it('maps a validated lease to the same customer, payment claim, and 100.25 ETB amount', () => {
    const order = projectKemerBetCreditOrder(EXECUTE_LEASE);
    expect(order).toMatchObject({
      depositIntentId: EXECUTE_LEASE.intentId,
      paymentClaimId: EXECUTE_LEASE.paymentClaimId,
      platformCode: 'kemerbet',
      platformAgentAccountId: EXECUTE_LEASE.platformAgentAccountId,
      customerAccountId: EXECUTE_LEASE.playerId,
      currencyCode: 'ETB',
      orderReference: EXECUTE_LEASE.jobId,
    });
    expect(order.amount.minor).toBe(10025);
    expect(order.amount.toDisplay()).toBe('100.25');
    expect(() =>
      projectKemerBetCreditOrder({
        ...EXECUTE_LEASE,
        paymentVerified: false,
      } as unknown as RoutineDepositLease),
    ).toThrow();
  });

  it('does not call an unfenced execution lease a credit attempt', () => {
    expect(projectKemerBetPreparedAttempt(EXECUTE_LEASE)).toMatchObject({
      attemptId: EXECUTE_LEASE.attemptId,
      order: { customerAccountId: EXECUTE_LEASE.playerId },
    });
    expect(() => projectKemerBetFencedAttempt(EXECUTE_LEASE)).toThrow();
    expect(projectKemerBetFencedAttempt(FENCED_LEASE)).toMatchObject({
      attemptId: EXECUTE_LEASE.attemptId,
      finalActionFenced: true,
    });
  });

  it('keeps a success dialog observation separate from durable confirmation', () => {
    expect(
      projectKemerBetDispatchObservation({
        outcome: 'submission_attempted',
        providerResponseDigest: DIGEST,
        exactPlayerCreditMatch: true,
      }),
    ).toEqual({ outcome: 'provider_success_observed', evidenceDigest: DIGEST });
    expect(
      projectKemerBetDispatchObservation({
        outcome: 'local_uncertain',
        providerResponseDigest: null,
      }),
    ).toEqual({ outcome: 'uncertain', reason: 'provider_action_ambiguous' });
    expect(() =>
      projectKemerBetDispatchObservation({
        outcome: 'submission_attempted',
        providerResponseDigest: DIGEST,
      }),
    ).toThrow();
  });

  it('maps signed reconciliation without inventing an external transaction ID', () => {
    expect(
      projectKemerBetReconciliation(FENCED_LEASE, {
        outcome: 'pending',
        historyWindow: { from: '2026-11-14T00:00:00Z', until: '2026-11-14T00:10:00Z' },
      }),
    ).toEqual({ outcome: 'pending' });
    expect(projectKemerBetReconciliation(FENCED_LEASE, { outcome: 'uncertain' })).toEqual({
      outcome: 'uncertain',
      reason: 'platform_credit_unresolved',
    });
    expect(projectKemerBetReconciliation(FENCED_LEASE, confirmedResult())).toEqual({
      outcome: 'confirmed',
      evidenceDigest: DIGEST,
    });
    expect(() => projectKemerBetReconciliation(EXECUTE_LEASE, confirmedResult())).toThrow();
    expect(() =>
      projectKemerBetReconciliation(FENCED_LEASE, confirmedResult({ playerId: 'OTHER-PLAYER' })),
    ).toThrow();
    expect(() =>
      projectKemerBetReconciliation(FENCED_LEASE, confirmedResult({ evidenceDigest: 'invalid' })),
    ).toThrow();
  });
});
