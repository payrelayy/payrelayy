import { describe, expect, it, vi } from 'vitest';

import { createKemerBetCompanionCreditAdapter } from './kemerbet-companion-credit-adapter.js';
import {
  projectKemerBetFencedAttempt,
  projectKemerBetPreparedAttempt,
} from './kemerbet-credit-boundary.js';
import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import type {
  RoutineDepositExecutionStore,
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

function fixture(lease: RoutineDepositLease, result: RoutineDepositReconciliation) {
  const session = {
    executeRoutineOneUseDeposit: vi.fn(async () => {
      throw new Error('Unexpected Transfer.');
    }),
  } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
  const store = {
    reconcile: vi.fn(async () => result),
  } satisfies Pick<RoutineDepositExecutionStore, 'reconcile'>;
  return { session, store, adapter: createKemerBetCompanionCreditAdapter(session, store, lease) };
}

function confirmedResult(overrides: Record<string, unknown> = {}): RoutineDepositReconciliation {
  return {
    ...FENCED_LEASE,
    outcome: 'confirmed_executed',
    reconciliationId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    evidenceDigest: DIGEST,
    exactHistoryMatchCount: 1,
    playerCreditConfirmed: true,
    ...overrides,
  } as RoutineDepositReconciliation;
}

describe('KemerBet Companion signed reconciliation adapter', () => {
  it('maps a signed exact history confirmation without inventing a platform transaction ID', async () => {
    const { adapter, store, session } = fixture(FENCED_LEASE, confirmedResult());
    expect(await adapter.reconcile(projectKemerBetFencedAttempt(FENCED_LEASE))).toEqual({
      outcome: 'confirmed',
      evidenceDigest: DIGEST,
    });
    expect(store.reconcile).toHaveBeenCalledExactlyOnceWith(FENCED_LEASE);
    expect(session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
  });

  it('keeps missing history pending and ambiguous history uncertain', async () => {
    const pending = fixture(FENCED_LEASE, {
      outcome: 'pending',
      historyWindow: { from: '2026-11-14T00:00:00Z', until: '2026-11-14T00:10:00Z' },
    });
    expect(await pending.adapter.reconcile(projectKemerBetFencedAttempt(FENCED_LEASE))).toEqual({
      outcome: 'pending',
    });
    const uncertain = fixture(FENCED_LEASE, { outcome: 'uncertain' });
    expect(await uncertain.adapter.reconcile(projectKemerBetFencedAttempt(FENCED_LEASE))).toEqual({
      outcome: 'uncertain',
      reason: 'platform_credit_unresolved',
    });
    expect(pending.session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
    expect(uncertain.session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
  });

  it.each([
    'depositIntentId',
    'paymentClaimId',
    'platformCode',
    'platformAgentAccountId',
    'customerAccountId',
    'orderReference',
  ] as const)('rejects a changed %s before the signed reconciliation call', async (field) => {
    const { adapter, store } = fixture(FENCED_LEASE, confirmedResult());
    const attempt = projectKemerBetFencedAttempt(FENCED_LEASE);
    await expect(
      adapter.reconcile({
        ...attempt,
        order: { ...attempt.order, [field]: 'changed-value' },
      }),
    ).rejects.toThrow();
    expect(store.reconcile).not.toHaveBeenCalled();
  });

  it('rejects a changed attempt, amount, or unfenced input before the signed call', async () => {
    const { adapter, store } = fixture(FENCED_LEASE, confirmedResult());
    const attempt = projectKemerBetFencedAttempt(FENCED_LEASE);
    for (const altered of [
      { ...attempt, attemptId: 'other-attempt' },
      { ...attempt, order: { ...attempt.order, amount: { minor: 10125 } } },
      { ...attempt, finalActionFenced: false },
    ]) {
      await expect(adapter.reconcile(altered as typeof attempt)).rejects.toThrow();
    }
    expect(store.reconcile).not.toHaveBeenCalled();
  });

  it('rejects an invalid confirmed binding or evidence without claiming a credit', async () => {
    const mismatch = fixture(FENCED_LEASE, confirmedResult({ playerId: 'OTHER-PLAYER' }));
    await expect(
      mismatch.adapter.reconcile(projectKemerBetFencedAttempt(FENCED_LEASE)),
    ).rejects.toThrow();
    const malformed = fixture(FENCED_LEASE, confirmedResult({ evidenceDigest: 'invalid' }));
    await expect(
      malformed.adapter.reconcile(projectKemerBetFencedAttempt(FENCED_LEASE)),
    ).rejects.toThrow();
    expect(mismatch.session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
    expect(malformed.session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
  });

  it('never submits again from a fenced lease', async () => {
    const { adapter, store, session } = fixture(FENCED_LEASE, { outcome: 'uncertain' });
    await expect(
      adapter.submitOnce(projectKemerBetPreparedAttempt(EXECUTE_LEASE), async () => {
        throw new Error('Unexpected fence.');
      }),
    ).rejects.toThrow();
    expect(session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
    expect(store.reconcile).not.toHaveBeenCalled();
  });

  it('rejects a mismatched prepared payment before opening the browser action', async () => {
    const { adapter, store, session } = fixture(EXECUTE_LEASE, { outcome: 'uncertain' });
    const prepared = projectKemerBetPreparedAttempt(EXECUTE_LEASE);
    await expect(
      adapter.submitOnce(
        { ...prepared, order: { ...prepared.order, paymentClaimId: 'other-claim' } },
        async () => {
          throw new Error('Unexpected fence.');
        },
      ),
    ).rejects.toThrow();
    expect(session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
    expect(store.reconcile).not.toHaveBeenCalled();
  });

  it('never reconciles an unfenced execution lease', async () => {
    const { adapter, store } = fixture(EXECUTE_LEASE, { outcome: 'uncertain' });
    await expect(adapter.reconcile(projectKemerBetFencedAttempt(FENCED_LEASE))).rejects.toThrow();
    expect(store.reconcile).not.toHaveBeenCalled();
  });
});
