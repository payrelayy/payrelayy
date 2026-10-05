import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  createRoutineDepositWorker,
  isRoutineDepositPolicy,
  type RoutineDepositExecutionStore,
  type RoutineDepositFence,
  type RoutineDepositLease,
  type RoutineDepositPolicy,
  type RoutineDepositReconciliation,
} from './routine-deposit-worker.js';

const NOW = 1_800_000_000_000;
const policy: RoutineDepositPolicy = Object.freeze({
  mode: 'routine_production',
  status: 'active',
  version: 1,
  provider: 'telebirr',
  platformCode: 'kemerbet',
  currencyCode: 'ETB',
  minimumAmountMinor: 2500,
  maximumAmountMinor: 2500000,
  playerScope: 'all_active_deposit_eligible',
  playerOwnershipRequired: false,
  dailyQuotaMinor: null,
  successfulDepositQuota: null,
  maxConcurrentDeposits: 1,
  amountSource: 'official_receipt_settled_amount',
});

function makeLease(overrides: Partial<RoutineDepositLease> = {}): RoutineDepositLease {
  return {
    jobId: randomUUID(),
    intentId: randomUUID(),
    attemptId: randomUUID(),
    paymentClaimId: randomUUID(),
    platformAgentAccountId: randomUUID(),
    playerId: 'ANY-ELIGIBLE-PLAYER',
    amountMinor: 2500000,
    currencyCode: 'ETB',
    policy,
    phase: 'execute',
    paymentVerified: true,
    playerActive: true,
    playerDepositEligible: true,
    attemptNumber: 1,
    finalActionFenced: false,
    ...overrides,
  };
}

function confirmed(lease: RoutineDepositLease): RoutineDepositReconciliation {
  return {
    ...lease,
    outcome: 'confirmed_executed',
    reconciliationId: randomUUID(),
    evidenceDigest: `sha256:${'a'.repeat(64)}`,
    exactHistoryMatchCount: 1,
    playerCreditConfirmed: true,
  };
}

function fixture(lease = makeLease()) {
  const controller = new AbortController();
  let currentTime = NOW;
  let monotonicTime = 1000;
  const store = {
    leaseNext: vi.fn(async () => lease as RoutineDepositLease | null),
    fenceFinalAction: vi.fn(
      async (selected: RoutineDepositLease): Promise<RoutineDepositFence> => ({
        ...selected,
        firstFenceAcquired: true as const,
        issuedAtMs: NOW,
        validUntilMs: NOW + 10000,
      }),
    ),
    recordDispatch: vi.fn(async () => undefined),
    reconcile: vi.fn(async (selected: RoutineDepositLease): Promise<RoutineDepositReconciliation> =>
      confirmed(selected),
    ),
    completeConfirmed: vi.fn(async (selected: RoutineDepositLease) => ({ ...selected })),
    pause: vi.fn(async () => undefined),
  } satisfies RoutineDepositExecutionStore;
  const session = {
    executeRoutineOneUseDeposit: vi.fn(
      async (
        _player: string,
        _amount: number,
        acquire: Parameters<
          import('./local-kemerbet-session.js').LocalKemerBetSession['executeRoutineOneUseDeposit']
        >[2],
      ) => {
        const authority = await acquire();
        if (!authority.isFresh()) throw new Error('stale');
        return {
          outcome: 'submission_attempted' as const,
          providerResponseDigest: `sha256:${'b'.repeat(64)}`,
          exactPlayerCreditMatch: true as const,
        };
      },
    ),
  };
  const worker = createRoutineDepositWorker({
    store,
    session,
    signal: controller.signal,
    now: () => currentTime,
    monotonicNow: () => monotonicTime,
  });
  return {
    lease,
    store,
    session,
    worker,
    controller,
    setTime: (value: number) => {
      currentTime = value;
    },
    setMonotonicTime: (value: number) => {
      monotonicTime = value;
    },
  };
}

describe('routine production serial deposit worker', () => {
  it('accepts persistent routine policy, not fixed pilot or quotas', () => {
    expect(isRoutineDepositPolicy(policy)).toBe(true);
    for (const altered of [
      { mode: 'private_pilot' },
      { maximumAmountMinor: 2500 },
      { playerScope: 'five_players' },
      { playerOwnershipRequired: true },
      { dailyQuotaMinor: 12500 },
      { successfulDepositQuota: 5 },
      { maxConcurrentDeposits: 2 },
      { amountSource: 'telegram_amount' },
      { status: 'disabled' },
      { version: 2 },
    ])
      expect(isRoutineDepositPolicy({ ...policy, ...altered })).toBe(false);
  });

  it('executes an arbitrary eligible Player and receipt amount, then confirms credit before completion', async () => {
    const { worker, store, session, lease } = fixture();
    expect(await worker.runOnce()).toEqual({ status: 'completed' });
    expect(session.executeRoutineOneUseDeposit).toHaveBeenCalledWith(
      lease.playerId,
      2500000,
      expect.any(Function),
    );
    expect(store.fenceFinalAction).toHaveBeenCalledTimes(1);
    expect(store.recordDispatch).toHaveBeenCalledTimes(1);
    expect(store.reconcile).toHaveBeenCalledTimes(1);
    expect(store.completeConfirmed).toHaveBeenCalledTimes(1);
    expect(store.recordDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      store.reconcile.mock.invocationCallOrder[0]!,
    );
    expect(store.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      store.completeConfirmed.mock.invocationCallOrder[0]!,
    );
    expect(store.pause).not.toHaveBeenCalled();
  });

  it('does not confuse HTTP submission success with credit confirmation', async () => {
    const { worker, store, session } = fixture();
    store.reconcile
      .mockResolvedValueOnce({ outcome: 'pending' })
      .mockResolvedValueOnce({ outcome: 'pending' });
    expect(await worker.runOnce()).toEqual({ status: 'awaiting_reconciliation' });
    expect(await worker.runOnce()).toEqual({ status: 'awaiting_reconciliation' });
    expect(await worker.runOnce()).toEqual({ status: 'completed' });
    expect(store.leaseNext).toHaveBeenCalledTimes(1);
    expect(session.executeRoutineOneUseDeposit).toHaveBeenCalledTimes(1);
    expect(store.fenceFinalAction).toHaveBeenCalledTimes(1);
    expect(store.completeConfirmed).toHaveBeenCalledTimes(1);
  });

  it('blocks a concurrent local run while one provider operation is unresolved', async () => {
    const { worker, store } = fixture();
    let unblock!: (lease: RoutineDepositLease) => void;
    store.leaseNext.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          unblock = resolve;
        }),
    );
    const first = worker.runOnce();
    expect(await worker.runOnce()).toEqual({ status: 'busy' });
    expect(store.leaseNext).toHaveBeenCalledTimes(1);
    unblock(makeLease());
    expect(await first).toEqual({ status: 'completed' });
  });

  it('can process more than five distinct deposits for the same Player without a business quota', async () => {
    const { worker, store, session } = fixture();
    store.leaseNext.mockImplementation(async () =>
      makeLease({ playerId: 'SAME-PLAYER', amountMinor: 2501 }),
    );
    for (let count = 0; count < 8; count += 1) {
      expect(await worker.runOnce()).toEqual({ status: 'completed' });
    }
    expect(session.executeRoutineOneUseDeposit).toHaveBeenCalledTimes(8);
    expect(store.completeConfirmed).toHaveBeenCalledTimes(8);
  });

  it('after restart reconciles a fenced attempt without executing again', async () => {
    const { worker, store, session } = fixture(
      makeLease({ phase: 'reconcile', finalActionFenced: true }),
    );
    expect(await worker.runOnce()).toEqual({ status: 'completed' });
    expect(session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
    expect(store.fenceFinalAction).not.toHaveBeenCalled();
    expect(store.recordDispatch).not.toHaveBeenCalled();
    expect(store.reconcile).toHaveBeenCalledTimes(1);
  });

  it.each([
    { amountMinor: 2499 },
    { amountMinor: 2500001 },
    { amountMinor: 2500.1 },
    { paymentVerified: false },
    { playerActive: false },
    { playerDepositEligible: false },
    { attemptNumber: 2 },
    { phase: 'execute', finalActionFenced: true },
    { phase: 'reconcile', finalActionFenced: false },
    { currencyCode: 'USD' },
    { jobId: 'unknown' },
    { playerId: '' },
  ])('does not prepare or fence an invalid lease: %j', async (alteration) => {
    const { worker, store, session } = fixture(
      makeLease(alteration as Partial<RoutineDepositLease>),
    );
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'invalid_policy_or_lease' });
    expect(session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
    expect(store.fenceFinalAction).not.toHaveBeenCalled();
  });

  it.each([
    'amountMinor',
    'playerId',
    'jobId',
    'attemptId',
    'intentId',
    'paymentClaimId',
    'platformAgentAccountId',
  ] as const)('rejects mismatched %s in the final database fence', async (key) => {
    const { worker, store, session } = fixture();
    store.fenceFinalAction.mockImplementationOnce(async (lease) => ({
      ...lease,
      [key]: key === 'amountMinor' ? 2500 : key === 'playerId' ? 'OTHER-PLAYER' : randomUUID(),
      firstFenceAcquired: true,
      issuedAtMs: NOW,
      validUntilMs: NOW + 10000,
    }));
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
    expect(store.fenceFinalAction).toHaveBeenCalledTimes(1);
    expect(session.executeRoutineOneUseDeposit).toHaveBeenCalledTimes(1);
    expect(store.recordDispatch).not.toHaveBeenCalled();
    expect(store.completeConfirmed).not.toHaveBeenCalled();
  });

  it.each([
    { firstFenceAcquired: false },
    { validUntilMs: NOW },
    { validUntilMs: NOW + 10001 },
    { issuedAtMs: NOW + 1 },
  ])('does not use expired, overlong, future or reused authority: %j', async (override) => {
    const { worker, store } = fixture();
    store.fenceFinalAction.mockImplementationOnce(
      async (lease) =>
        ({
          ...lease,
          firstFenceAcquired: true,
          issuedAtMs: NOW,
          validUntilMs: NOW + 10000,
          ...override,
        }) as Awaited<ReturnType<RoutineDepositExecutionStore['fenceFinalAction']>>,
    );
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
    expect(store.recordDispatch).not.toHaveBeenCalled();
  });

  it('grants a per-action deadline even though business authorization is persistent', async () => {
    const { worker, session, setTime, controller } = fixture();
    session.executeRoutineOneUseDeposit.mockImplementationOnce(
      async (_player, _amount, acquire) => {
        const authority = await acquire();
        expect(authority.isFresh()).toBe(true);
        setTime(NOW + 10000);
        expect(authority.isFresh()).toBe(false);
        setTime(NOW);
        controller.abort();
        expect(authority.isFresh()).toBe(false);
        throw new Error('Not dispatched');
      },
    );
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
  });

  it('burns an ambiguous fence request without retrying it', async () => {
    const { worker, store } = fixture();
    store.fenceFinalAction.mockRejectedValueOnce(new Error('connection lost after commit'));
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
    expect(store.fenceFinalAction).toHaveBeenCalledTimes(1);
    expect(store.leaseNext).toHaveBeenCalledTimes(1);
  });

  it('cannot regain expired authority when the wall clock moves backwards', async () => {
    const { worker, session, setTime, setMonotonicTime } = fixture();
    session.executeRoutineOneUseDeposit.mockImplementationOnce(
      async (_player, _amount, acquire) => {
        const authority = await acquire();
        expect(authority.isFresh()).toBe(true);
        setMonotonicTime(11000);
        setTime(NOW - 1000);
        expect(authority.isFresh()).toBe(false);
        setTime(NOW);
        setMonotonicTime(1000);
        expect(authority.isFresh()).toBe(false);
        throw new Error('expired');
      },
    );
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
  });

  it.each([NaN, Infinity])(
    'cannot grant final authority with an invalid wall clock: %s',
    async (clock) => {
      const { worker, store, setTime } = fixture();
      setTime(clock);
      expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'execution_uncertain' });
      expect(store.recordDispatch).not.toHaveBeenCalled();
    },
  );

  it('never grants a second action authority to the same browser invocation', async () => {
    const { worker, store, session } = fixture();
    session.executeRoutineOneUseDeposit.mockImplementationOnce(
      async (_player, _amount, acquire) => {
        await acquire();
        await expect(acquire()).rejects.toThrow();
        return {
          outcome: 'submission_attempted',
          providerResponseDigest: `sha256:${'b'.repeat(64)}`,
          exactPlayerCreditMatch: true,
        };
      },
    );
    expect(await worker.runOnce()).toEqual({ status: 'completed' });
    expect(store.fenceFinalAction).toHaveBeenCalledTimes(1);
  });

  it.each(['uncertain', 'wrong_amount', 'wrong_player', 'no_credit', 'multiple_history_matches'])(
    'pauses permanently for this instance when reconciliation is %s',
    async (kind) => {
      const { worker, store } = fixture();
      store.reconcile.mockImplementationOnce(async (lease) => {
        if (kind === 'uncertain') return { outcome: 'uncertain' };
        return {
          ...confirmed(lease),
          ...(kind === 'wrong_amount' ? { amountMinor: 2500 } : {}),
          ...(kind === 'wrong_player' ? { playerId: 'OTHER' } : {}),
          ...(kind === 'no_credit' ? { playerCreditConfirmed: false } : {}),
          ...(kind === 'multiple_history_matches' ? { exactHistoryMatchCount: 2 } : {}),
        } as RoutineDepositReconciliation;
      });
      expect(await worker.runOnce()).toMatchObject({ status: 'paused' });
      expect(await worker.runOnce()).toMatchObject({ status: 'paused' });
      expect(store.leaseNext).toHaveBeenCalledTimes(1);
      expect(store.completeConfirmed).not.toHaveBeenCalled();
    },
  );

  it.each(['recordDispatch', 'reconcile', 'completeConfirmed'] as const)(
    'holds the lane and does not retry provider submission if %s fails',
    async (operation) => {
      const { worker, store, session } = fixture();
      store[operation].mockRejectedValueOnce(new Error('database unavailable'));
      expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'database_unavailable' });
      expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'database_unavailable' });
      expect(session.executeRoutineOneUseDeposit).toHaveBeenCalledTimes(1);
      expect(store.pause).toHaveBeenCalledTimes(1);
    },
  );

  it('stays paused locally even if the durable pause notification fails', async () => {
    const { worker, store } = fixture();
    store.leaseNext.mockRejectedValueOnce(new Error('offline'));
    store.pause.mockRejectedValueOnce(new Error('offline'));
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'database_unavailable' });
    expect(await worker.runOnce()).toEqual({ status: 'paused', reason: 'database_unavailable' });
    expect(store.leaseNext).toHaveBeenCalledTimes(1);
  });

  it('does not claim anything when stopped or idle', async () => {
    const { worker, store, controller } = fixture();
    store.leaseNext.mockResolvedValueOnce(null);
    expect(await worker.runOnce()).toEqual({ status: 'idle' });
    controller.abort();
    expect(await worker.runOnce()).toEqual({ status: 'stopped' });
    expect(store.leaseNext).toHaveBeenCalledTimes(1);
  });
});
