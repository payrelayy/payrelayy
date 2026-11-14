import { performance } from 'node:perf_hooks';
import type { RoutineDepositHistoryWindow } from '@fetanagent/agent-platform-companion-execution-contracts';
import type { PlatformCreditFinalActionAuthority } from '@fetanagent/contracts';

import {
  createKemerBetCompanionSubmissionAdapter,
  type KemerBetCompanionSubmission,
} from './kemerbet-companion-credit-adapter.js';
import { projectKemerBetPreparedAttempt } from './kemerbet-credit-boundary.js';
import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import type { LocalKemerBetDepositDispatchOutcome } from './provider-route.js';
import {
  isValidRoutineDepositLease,
  matchesRoutineDepositBinding,
} from './routine-deposit-validation.js';
import type { RoutineHistoryObservation } from './routine-kemerbet-history.js';

const ACTION_LIFETIME_MS = 10_000;

export {
  isRoutineDepositPolicy,
  isValidRoutineDepositLease,
  matchesRoutineDepositBinding,
} from './routine-deposit-validation.js';

/** Persistent business authorization; not a pilot, expiring pairing, or per-payment approval. */
export interface RoutineDepositPolicy {
  readonly mode: 'routine_production';
  readonly status: 'active';
  readonly version: 1;
  readonly provider: 'telebirr' | 'receiver_sms';
  readonly platformCode: 'kemerbet';
  readonly currencyCode: 'ETB';
  readonly minimumAmountMinor: 2500 | 10000;
  readonly maximumAmountMinor: 2500000;
  readonly playerScope: 'all_active_deposit_eligible';
  readonly playerOwnershipRequired: false;
  readonly dailyQuotaMinor: null;
  readonly successfulDepositQuota: null;
  readonly maxConcurrentDeposits: 1;
  readonly amountSource: 'official_receipt_settled_amount' | 'receiver_sms_amount';
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

/** Legacy wire result retained for already running Companion releases during rollout. */
export type RoutineDepositReconciliation =
  | { readonly outcome: 'pending'; readonly historyWindow: RoutineDepositHistoryWindow }
  | { readonly outcome: 'uncertain' }
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

type LocalRoutineDepositPauseReason = RoutineDepositPauseReason | 'result_modal_unavailable';

/**
 * Durable serialization is the store's responsibility, not a JavaScript mutex or an expiring
 * worker lease. A fenced attempt blocks the account until exact modal confirmation or an
 * immutable uncertain outcome with an Owner review case. A reviewed payment remains one-use;
 * another payment for that same Player is held until the review is resolved.
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
  /** Finalizes only a durable, signed dispatch that follows the exact success result. */
  confirmModal(lease: RoutineDepositLease): Promise<RoutineDepositBinding | null>;
  reconcile(lease: RoutineDepositLease): Promise<RoutineDepositReconciliation>;
  confirmHistory(
    lease: RoutineDepositLease,
    observation: RoutineHistoryObservation,
  ): Promise<RoutineDepositReconciliation>;
  completeConfirmed(
    lease: RoutineDepositLease,
    reconciliationId: string,
  ): Promise<RoutineDepositBinding>;
  pause(lease: RoutineDepositLease | null, reason: RoutineDepositPauseReason): Promise<void>;
}

export type RoutineDepositWorkerResult =
  | {
      readonly status: 'idle' | 'busy' | 'stopped' | 'awaiting_reconciliation';
    }
  | { readonly status: 'temporarily_unavailable'; readonly readOnlyFindSafe?: true }
  | { readonly status: 'completed' }
  | {
      readonly status: 'contained';
      readonly reason: 'execution_uncertain' | 'reconciliation_uncertain';
    }
  | { readonly status: 'paused'; readonly reason: LocalRoutineDepositPauseReason };

export interface RoutineDepositWorkerOptions {
  readonly store: RoutineDepositExecutionStore;
  readonly session: Pick<
    LocalKemerBetSession,
    | 'executeRoutineOneUseDeposit'
    | 'dismissSettledRoutineSuccess'
    | 'resetAfterContainedRoutineDeposit'
  >;
  readonly signal: AbortSignal;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
}

export type RoutineDepositWorker = ReturnType<typeof createRoutineDepositWorker>;

/** No provider retry, parallel submission, or v2 widening. */
export function createRoutineDepositWorker(options: RoutineDepositWorkerOptions) {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const creditAdapter = createKemerBetCompanionSubmissionAdapter(options.session);
  let busy = false;
  let pauseReason: LocalRoutineDepositPauseReason | undefined;
  let awaitingReconciliation: RoutineDepositLease | undefined;
  let pendingContainment:
    | { lease: RoutineDepositLease; reason: 'execution_uncertain' | 'reconciliation_uncertain' }
    | undefined;
  let pendingPageReset: 'execution_uncertain' | 'reconciliation_uncertain' | undefined;

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

  async function dismissSettledResult(): Promise<RoutineDepositWorkerResult | undefined> {
    try {
      await options.session.dismissSettledRoutineSuccess();
      return undefined;
    } catch {
      // The payment is already settled or durably isolated. Do not lease another
      // payment behind an obstructing provider dialog or relabel the settled credit.
      pauseReason = 'result_modal_unavailable';
      return Object.freeze({ status: 'paused', reason: pauseReason });
    }
  }

  async function containUncertain(
    lease: RoutineDepositLease,
    reason: 'execution_uncertain' | 'reconciliation_uncertain',
  ): Promise<RoutineDepositWorkerResult> {
    pendingContainment = { lease, reason };
    return resumeContainment();
  }

  async function resumeContainment(): Promise<RoutineDepositWorkerResult> {
    if (pendingContainment) {
      const { lease, reason } = pendingContainment;
      try {
        // A lost gateway response can leave a prepared or fenced attempt on the
        // server. Repeat only the idempotent review handoff, never the fence or Transfer.
        await options.store.pause(lease, reason);
      } catch {
        // Keep this binding locally and retry its signed containment when the
        // bridge returns. No later payment may be leased before it is isolated.
        return Object.freeze({ status: 'temporarily_unavailable' });
      }
      pendingContainment = undefined;
      awaitingReconciliation = undefined;
      pendingPageReset = reason;
    }
    if (!pendingPageReset) return Object.freeze({ status: 'idle' });
    const reason = pendingPageReset;
    try {
      await options.session.dismissSettledRoutineSuccess();
      await options.session.resetAfterContainedRoutineDeposit();
    } catch {
      // The payment is already isolated, but the old form may still be visible.
      // Retry the guarded reset before allowing any new browser work.
      return Object.freeze({ status: 'temporarily_unavailable' });
    }
    pendingPageReset = undefined;
    return Object.freeze({ status: 'contained', reason });
  }

  async function finalizeModal(lease: RoutineDepositLease): Promise<RoutineDepositWorkerResult> {
    awaitingReconciliation = Object.freeze({
      ...lease,
      phase: 'reconcile',
      finalActionFenced: true,
    });
    let confirmed: RoutineDepositBinding | null;
    try {
      confirmed = await options.store.confirmModal(awaitingReconciliation);
    } catch {
      return containUncertain(awaitingReconciliation, 'reconciliation_uncertain');
    }
    if (confirmed === null)
      return containUncertain(awaitingReconciliation, 'reconciliation_uncertain');
    if (!matchesRoutineDepositBinding(lease, confirmed))
      return pause(awaitingReconciliation, 'confirmation_mismatch');
    awaitingReconciliation = undefined;
    const dismissFailure = await dismissSettledResult();
    if (dismissFailure) return dismissFailure;
    return Object.freeze({ status: 'completed' });
  }

  return Object.freeze({
    needsRecovery: () => pendingContainment !== undefined || pendingPageReset !== undefined,
    async runOnce(): Promise<RoutineDepositWorkerResult> {
      if (busy) return Object.freeze({ status: 'busy' });
      if (pauseReason) return Object.freeze({ status: 'paused', reason: pauseReason });
      if (options.signal.aborted) return Object.freeze({ status: 'stopped' });
      busy = true;
      let lease: RoutineDepositLease | null = null;
      try {
        if (pendingContainment || pendingPageReset) return await resumeContainment();
        if (awaitingReconciliation) {
          lease = awaitingReconciliation;
          return await finalizeModal(lease);
        }
        try {
          lease = await options.store.leaseNext();
        } catch {
          // No lease was delivered and no provider action has started. Keep the
          // guarded browser available while the runner backs off and retries.
          // A failed request may have prepared a durable lease on the server;
          // the next authenticated lease call must recover it before any action.
          return Object.freeze({ status: 'temporarily_unavailable', readOnlyFindSafe: true });
        }
        if (!lease) return Object.freeze({ status: 'idle' });
        if (!isValidRoutineDepositLease(lease))
          return await pause(lease, 'invalid_policy_or_lease');
        // Snapshot the binding so later mutations by a port cannot change a prepared target.
        lease = Object.freeze({ ...lease, policy: Object.freeze({ ...lease.policy }) });
        if (options.signal.aborted) return await pause(lease, 'operator_stopped');
        if (lease.phase === 'reconcile') return await finalizeModal(lease);

        const selected = lease;
        const prepared = projectKemerBetPreparedAttempt(selected);
        let fenceRequested = false;
        let fenceGranted = false;
        let integrityFailure = false;
        let actionAuthority: PlatformCreditFinalActionAuthority | undefined;
        let submission: KemerBetCompanionSubmission;
        try {
          submission = await creditAdapter.submitOnce(prepared, async () => {
            if (fenceRequested || options.signal.aborted)
              throw new Error('Routine action unavailable.');
            // An ambiguous fence request must never be retried or treated as pre-action safe.
            fenceRequested = true;
            // Start both deadlines before the request. The database issues its fence during
            // this round trip, so a deadline measured from here expires no later than the
            // database fence. Comparing absolute database and PC times would instead reject
            // a valid fast response whenever the PC clock is slightly behind.
            const requestStartedAt = now();
            const requestStartedMonotonic = monotonicNow();
            if (
              !Number.isSafeInteger(requestStartedAt) ||
              !Number.isFinite(requestStartedMonotonic)
            ) {
              integrityFailure = true;
              throw new Error('Routine action unavailable.');
            }
            const fence = await options.store.fenceFinalAction(selected);
            const observedAt = now();
            const observedAtMonotonic = monotonicNow();
            const lifetimeMs = fence.validUntilMs - fence.issuedAtMs;
            if (
              !matchesRoutineDepositBinding(selected, fence) ||
              fence.firstFenceAcquired !== true ||
              !Number.isSafeInteger(fence.issuedAtMs) ||
              !Number.isSafeInteger(fence.validUntilMs) ||
              fence.issuedAtMs <= 0 ||
              lifetimeMs <= 0 ||
              lifetimeMs > ACTION_LIFETIME_MS
            ) {
              integrityFailure = true;
              throw new Error('Routine action unavailable.');
            }
            if (
              !Number.isSafeInteger(observedAt) ||
              !Number.isFinite(observedAtMonotonic) ||
              observedAt < requestStartedAt ||
              observedAtMonotonic < requestStartedMonotonic ||
              options.signal.aborted
            ) {
              integrityFailure = true;
              throw new Error('Routine action unavailable.');
            }
            if (
              observedAt - requestStartedAt >= lifetimeMs ||
              observedAtMonotonic - requestStartedMonotonic >= lifetimeMs
            )
              throw new Error('Routine action unavailable.');
            fenceGranted = true;
            const wallDeadline = requestStartedAt + lifetimeMs;
            const monotonicDeadline = requestStartedMonotonic + lifetimeMs;
            let lastWallNow = observedAt;
            let lastMonotonicNow = observedAtMonotonic;
            let expired = false;
            actionAuthority = Object.freeze({
              attempt: Object.freeze({ ...prepared, finalActionFenced: true as const }),
              isFresh: () => {
                const wallNow = now();
                const monoNow = monotonicNow();
                integrityFailure ||=
                  !Number.isSafeInteger(wallNow) ||
                  !Number.isFinite(monoNow) ||
                  wallNow < lastWallNow ||
                  monoNow < lastMonotonicNow;
                expired ||=
                  options.signal.aborted ||
                  !Number.isSafeInteger(wallNow) ||
                  !Number.isFinite(monoNow) ||
                  wallNow < lastWallNow ||
                  monoNow < lastMonotonicNow ||
                  monoNow >= monotonicDeadline ||
                  wallNow >= wallDeadline;
                lastWallNow = wallNow;
                lastMonotonicNow = monoNow;
                return !expired;
              },
            });
            return actionAuthority;
          });
        } catch {
          if (options.signal.aborted) return await pause(selected, 'operator_stopped');
          return integrityFailure
            ? await pause(selected, 'confirmation_mismatch')
            : await containUncertain(selected, 'execution_uncertain');
        }
        if (!fenceGranted || !actionAuthority)
          return await pause(selected, 'confirmation_mismatch');
        if (submission.outcome === 'uncertain')
          return submission.reason === 'confirmation_mismatch'
            ? await pause(selected, 'confirmation_mismatch')
            : await containUncertain(selected, 'execution_uncertain');
        // Only the exact, fresh Transfer Successful result permits this signed dispatch.
        // The server verifies its immutable one-use record before releasing the lane.
        try {
          await options.store.recordDispatch(selected, submission.dispatch);
        } catch {
          return await containUncertain(selected, 'execution_uncertain');
        }
        return await finalizeModal(selected);
      } catch {
        return await pause(lease, 'database_unavailable');
      } finally {
        busy = false;
      }
    },
  });
}
