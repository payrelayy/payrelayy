import { performance } from 'node:perf_hooks';

import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import {
  isRoutineDepositAmountMinor,
  type LocalKemerBetRoutineFinalAction,
} from './local-kemerbet-deposit.js';
import type { LocalKemerBetDepositDispatchOutcome } from './provider-route.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ACTION_LIFETIME_MS = 10_000;

/** Persistent business authorization; not a pilot, expiring pairing, or per-payment approval. */
export interface RoutineDepositPolicy {
  readonly mode: 'routine_production';
  readonly status: 'active';
  readonly version: 1;
  readonly provider: 'telebirr';
  readonly platformCode: 'kemerbet';
  readonly currencyCode: 'ETB';
  readonly minimumAmountMinor: 2500;
  readonly maximumAmountMinor: 2500000;
  readonly playerScope: 'all_active_deposit_eligible';
  readonly playerOwnershipRequired: false;
  readonly dailyQuotaMinor: null;
  readonly successfulDepositQuota: null;
  readonly maxConcurrentDeposits: 1;
  readonly amountSource: 'official_receipt_settled_amount';
}

export interface RoutineDepositBinding {
  readonly jobId: string;
  readonly intentId: string;
  readonly attemptId: string;
  readonly paymentClaimId: string;
  readonly platformAgentAccountId: string;
  readonly playerId: string;
  readonly amountMinor: number;
  readonly currencyCode: 'ETB';
}

/** Returned only by an authenticated database-backed store, never by a Telegram message. */
export interface RoutineDepositLease extends RoutineDepositBinding {
  readonly policy: RoutineDepositPolicy;
  readonly phase: 'execute' | 'reconcile';
  readonly paymentVerified: true;
  readonly playerActive: true;
  readonly playerDepositEligible: true;
  readonly attemptNumber: 1;
  readonly finalActionFenced: boolean;
}

export interface RoutineDepositFence extends RoutineDepositBinding {
  readonly firstFenceAcquired: true;
  readonly issuedAtMs: number;
  readonly validUntilMs: number;
}

export type RoutineDepositReconciliation =
  | { readonly outcome: 'pending' | 'uncertain' }
  | (RoutineDepositBinding & {
      readonly outcome: 'confirmed_executed';
      readonly reconciliationId: string;
      readonly evidenceDigest: string;
      readonly exactHistoryMatchCount: 1;
      readonly playerCreditConfirmed: true;
    });

export type RoutineDepositPauseReason =
  | 'invalid_policy_or_lease'
  | 'database_unavailable'
  | 'execution_uncertain'
  | 'reconciliation_uncertain'
  | 'confirmation_mismatch'
  | 'operator_stopped';

/**
 * Durable serialization is the store's responsibility, not a JavaScript mutex or an expiring
 * worker lease. The store must retain the existing account's blocking execution-attempt row until
 * exact positive reconciliation; a crash/timeout must return that attempt in reconcile mode.
 * It must recheck active policy, verified one-use payment claim, destination eligibility and
 * untouched job under the same transaction when claiming, fencing and completing. Do not adapt
 * the v2 fixed-amount/pilot broker or fabricate individual Owner approvals to implement this port.
 */
export interface RoutineDepositExecutionStore {
  leaseNext(): Promise<RoutineDepositLease | null>;
  fenceFinalAction(lease: RoutineDepositLease): Promise<RoutineDepositFence>;
  recordDispatch(
    lease: RoutineDepositLease,
    outcome: LocalKemerBetDepositDispatchOutcome,
  ): Promise<void>;
  reconcile(lease: RoutineDepositLease): Promise<RoutineDepositReconciliation>;
  completeConfirmed(
    lease: RoutineDepositLease,
    reconciliationId: string,
  ): Promise<RoutineDepositBinding>;
  pause(lease: RoutineDepositLease | null, reason: RoutineDepositPauseReason): Promise<void>;
}

export type RoutineDepositWorkerResult =
  | { readonly status: 'idle' | 'busy' | 'stopped' | 'awaiting_reconciliation' }
  | { readonly status: 'completed' }
  | { readonly status: 'paused'; readonly reason: RoutineDepositPauseReason };

export interface RoutineDepositWorkerOptions {
  readonly store: RoutineDepositExecutionStore;
  readonly session: Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
  readonly signal: AbortSignal;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
}

export function isRoutineDepositPolicy(candidate: unknown): candidate is RoutineDepositPolicy {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const policy = candidate as Partial<RoutineDepositPolicy>;
  return (
    policy.mode === 'routine_production' &&
    policy.status === 'active' &&
    policy.version === 1 &&
    policy.provider === 'telebirr' &&
    policy.platformCode === 'kemerbet' &&
    policy.currencyCode === 'ETB' &&
    policy.minimumAmountMinor === 2500 &&
    policy.maximumAmountMinor === 2500000 &&
    policy.playerScope === 'all_active_deposit_eligible' &&
    policy.playerOwnershipRequired === false &&
    policy.dailyQuotaMinor === null &&
    policy.successfulDepositQuota === null &&
    policy.maxConcurrentDeposits === 1 &&
    policy.amountSource === 'official_receipt_settled_amount'
  );
}

function validBinding(binding: RoutineDepositBinding): boolean {
  return (
    typeof binding.jobId === 'string' &&
    typeof binding.intentId === 'string' &&
    typeof binding.attemptId === 'string' &&
    typeof binding.paymentClaimId === 'string' &&
    typeof binding.platformAgentAccountId === 'string' &&
    typeof binding.playerId === 'string' &&
    UUID.test(binding.jobId) &&
    UUID.test(binding.intentId) &&
    UUID.test(binding.attemptId) &&
    UUID.test(binding.paymentClaimId) &&
    UUID.test(binding.platformAgentAccountId) &&
    PLAYER_ID.test(binding.playerId) &&
    isRoutineDepositAmountMinor(binding.amountMinor) &&
    binding.currencyCode === 'ETB'
  );
}

export type RoutineDepositWorker = ReturnType<typeof createRoutineDepositWorker>;

function matchesBinding(expected: RoutineDepositBinding, actual: RoutineDepositBinding): boolean {
  return (
    expected.jobId === actual.jobId &&
    expected.intentId === actual.intentId &&
    expected.attemptId === actual.attemptId &&
    expected.paymentClaimId === actual.paymentClaimId &&
    expected.platformAgentAccountId === actual.platformAgentAccountId &&
    expected.playerId === actual.playerId &&
    expected.amountMinor === actual.amountMinor &&
    expected.currencyCode === actual.currencyCode
  );
}

function validLease(lease: RoutineDepositLease): boolean {
  return (
    validBinding(lease) &&
    isRoutineDepositPolicy(lease.policy) &&
    lease.paymentVerified === true &&
    lease.playerActive === true &&
    lease.playerDepositEligible === true &&
    lease.attemptNumber === 1 &&
    ((lease.phase === 'execute' && lease.finalActionFenced === false) ||
      (lease.phase === 'reconcile' && lease.finalActionFenced === true))
  );
}

/** No provider retry, parallel submission, implicit resume after uncertainty, or v2 widening. */
export function createRoutineDepositWorker(options: RoutineDepositWorkerOptions) {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  let busy = false;
  let pauseReason: RoutineDepositPauseReason | undefined;
  let awaitingReconciliation: RoutineDepositLease | undefined;

  async function pause(
    lease: RoutineDepositLease | null,
    reason: RoutineDepositPauseReason,
  ): Promise<RoutineDepositWorkerResult> {
    // Set locally before I/O, even when persisting the pause fails. The durable blocking attempt
    // must remain held in the store; this worker never clears it as a timeout-recovery shortcut.
    pauseReason = reason;
    try {
      await options.store.pause(lease, reason);
    } catch {
      /* Retain the local closed state. */
    }
    return Object.freeze({ status: 'paused' as const, reason });
  }

  async function reconcile(lease: RoutineDepositLease): Promise<RoutineDepositWorkerResult> {
    awaitingReconciliation = Object.freeze({
      ...lease,
      phase: 'reconcile',
      finalActionFenced: true,
    });
    const outcome = await options.store.reconcile(awaitingReconciliation);
    if (outcome.outcome === 'pending') return Object.freeze({ status: 'awaiting_reconciliation' });
    if (outcome.outcome !== 'confirmed_executed') {
      return pause(awaitingReconciliation, 'reconciliation_uncertain');
    }
    if (
      !matchesBinding(lease, outcome) ||
      !UUID.test(outcome.reconciliationId) ||
      !DIGEST.test(outcome.evidenceDigest) ||
      outcome.exactHistoryMatchCount !== 1 ||
      outcome.playerCreditConfirmed !== true
    )
      return pause(awaitingReconciliation, 'confirmation_mismatch');
    const completed = await options.store.completeConfirmed(lease, outcome.reconciliationId);
    if (!matchesBinding(lease, completed))
      return pause(awaitingReconciliation, 'confirmation_mismatch');
    awaitingReconciliation = undefined;
    return Object.freeze({ status: 'completed' });
  }

  return Object.freeze({
    async runOnce(): Promise<RoutineDepositWorkerResult> {
      if (busy) return Object.freeze({ status: 'busy' });
      if (pauseReason) return Object.freeze({ status: 'paused', reason: pauseReason });
      if (options.signal.aborted) return Object.freeze({ status: 'stopped' });
      busy = true;
      let lease: RoutineDepositLease | null = null;
      try {
        if (awaitingReconciliation) {
          lease = awaitingReconciliation;
          return await reconcile(lease);
        }
        lease = await options.store.leaseNext();
        if (!lease) return Object.freeze({ status: 'idle' });
        if (!validLease(lease)) return await pause(lease, 'invalid_policy_or_lease');
        // Snapshot the binding so later mutations by a port cannot change a prepared target.
        lease = Object.freeze({ ...lease, policy: Object.freeze({ ...lease.policy }) });
        if (options.signal.aborted) return await pause(lease, 'operator_stopped');
        if (lease.phase === 'reconcile') return await reconcile(lease);

        const selected = lease;
        let fenceRequested = false;
        let fenceGranted = false;
        let actionAuthority: LocalKemerBetRoutineFinalAction | undefined;
        let dispatch: LocalKemerBetDepositDispatchOutcome;
        try {
          dispatch = await options.session.executeRoutineOneUseDeposit(
            selected.playerId,
            selected.amountMinor,
            async () => {
              if (fenceRequested || options.signal.aborted)
                throw new Error('Routine action unavailable.');
              // An ambiguous fence request must never be retried or treated as pre-action safe.
              fenceRequested = true;
              const fence = await options.store.fenceFinalAction(selected);
              const observedAt = now();
              if (
                !matchesBinding(selected, fence) ||
                fence.firstFenceAcquired !== true ||
                !Number.isSafeInteger(fence.issuedAtMs) ||
                !Number.isSafeInteger(fence.validUntilMs) ||
                !Number.isSafeInteger(observedAt) ||
                fence.validUntilMs <= fence.issuedAtMs ||
                fence.validUntilMs - fence.issuedAtMs > ACTION_LIFETIME_MS ||
                observedAt < fence.issuedAtMs ||
                observedAt >= fence.validUntilMs ||
                options.signal.aborted
              )
                throw new Error('Routine action unavailable.');
              fenceGranted = true;
              const issuedAtMs = fence.issuedAtMs;
              const validUntilMs = fence.validUntilMs;
              const grantedAtMonotonic = monotonicNow();
              if (!Number.isFinite(grantedAtMonotonic))
                throw new Error('Routine action unavailable.');
              const monotonicDeadline = grantedAtMonotonic + (validUntilMs - observedAt);
              let expired = false;
              actionAuthority = Object.freeze({
                playerId: selected.playerId,
                amountMinor: selected.amountMinor,
                isFresh: () => {
                  const wallNow = now();
                  const monoNow = monotonicNow();
                  expired ||=
                    options.signal.aborted ||
                    !Number.isSafeInteger(wallNow) ||
                    !Number.isFinite(monoNow) ||
                    monoNow < grantedAtMonotonic ||
                    monoNow >= monotonicDeadline ||
                    wallNow < issuedAtMs ||
                    wallNow >= validUntilMs;
                  return !expired;
                },
              });
              return actionAuthority;
            },
          );
        } catch {
          return await pause(selected, 'execution_uncertain');
        }
        if (
          !fenceGranted ||
          !actionAuthority ||
          dispatch.outcome !== 'submission_attempted' ||
          dispatch.exactPlayerCreditMatch !== true ||
          !DIGEST.test(dispatch.providerResponseDigest)
        )
          return await pause(selected, 'execution_uncertain');
        // An HTTP 200/digest is NOT credit confirmation. Only exact database reconciliation
        // can release the durable lane and allow a subsequent job to be claimed.
        await options.store.recordDispatch(selected, dispatch);
        return await reconcile(selected);
      } catch {
        return await pause(lease, 'database_unavailable');
      } finally {
        busy = false;
      }
    },
  });
}
