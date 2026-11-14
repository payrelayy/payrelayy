import type {
  PlatformCreditAdapter,
  PlatformCreditAttempt,
  PlatformCreditAttemptBinding,
  PlatformCreditFinalActionAuthority,
  PlatformCreditPreparedAttempt,
  PlatformCreditReconciliation,
} from '@fetanagent/contracts';

import {
  isRoutineDepositAmountMinor,
  type LocalKemerBetRoutineDepositDispatchOutcome,
} from './local-kemerbet-deposit.js';
import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import {
  projectKemerBetDispatchObservation,
  projectKemerBetFencedAttempt,
  projectKemerBetPreparedAttempt,
  projectKemerBetReconciliation,
} from './kemerbet-credit-boundary.js';
import type {
  RoutineDepositExecutionStore,
  RoutineDepositLease,
} from './routine-deposit-worker.js';
import { isValidRoutineDepositLease } from './routine-deposit-validation.js';

type SuccessfulDispatch = Extract<
  LocalKemerBetRoutineDepositDispatchOutcome,
  { readonly outcome: 'submission_attempted' }
>;

export type KemerBetCompanionSubmission =
  | {
      readonly outcome: 'provider_success_observed';
      readonly evidenceDigest: string;
      readonly dispatch: SuccessfulDispatch;
    }
  | {
      readonly outcome: 'uncertain';
      readonly reason: 'provider_action_ambiguous' | 'confirmation_mismatch';
    };

export interface KemerBetCompanionSubmissionAdapter extends Pick<
  PlatformCreditAdapter,
  'platformCode' | 'submitOnce'
> {
  readonly platformCode: 'kemerbet';
  submitOnce(
    prepared: PlatformCreditPreparedAttempt,
    acquireFinalAction: () => Promise<PlatformCreditFinalActionAuthority>,
  ): Promise<KemerBetCompanionSubmission>;
}

function sameCreditBinding(
  expected: PlatformCreditAttemptBinding,
  actual: PlatformCreditAttemptBinding | undefined,
): boolean {
  const expectedOrder = expected.order;
  const actualOrder = actual?.order;
  return (
    actual?.attemptId === expected.attemptId &&
    actualOrder?.depositIntentId === expectedOrder.depositIntentId &&
    actualOrder.paymentClaimId === expectedOrder.paymentClaimId &&
    actualOrder.platformCode === expectedOrder.platformCode &&
    actualOrder.platformAgentAccountId === expectedOrder.platformAgentAccountId &&
    actualOrder.customerAccountId === expectedOrder.customerAccountId &&
    actualOrder.amount?.minor === expectedOrder.amount.minor &&
    actualOrder.currencyCode === expectedOrder.currencyCode &&
    actualOrder.orderReference === expectedOrder.orderReference
  );
}

function samePreparedAttempt(
  prepared: PlatformCreditPreparedAttempt,
  authority: PlatformCreditFinalActionAuthority,
): boolean {
  return (
    authority?.attempt?.finalActionFenced === true &&
    sameCreditBinding(prepared, authority.attempt) &&
    typeof authority.isFresh === 'function'
  );
}

/** KemerBet browser preflight remains inside the protected session; the fence is requested at Transfer. */
export function createKemerBetCompanionSubmissionAdapter(
  session: Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>,
): KemerBetCompanionSubmissionAdapter {
  return Object.freeze({
    platformCode: 'kemerbet' as const,
    async submitOnce(
      prepared: PlatformCreditPreparedAttempt,
      acquireFinalAction: () => Promise<PlatformCreditFinalActionAuthority>,
    ): Promise<KemerBetCompanionSubmission> {
      const order = prepared.order;
      if (
        prepared.finalActionFenced !== false ||
        order.platformCode !== 'kemerbet' ||
        order.currencyCode !== 'ETB' ||
        !isRoutineDepositAmountMinor(order.amount?.minor) ||
        typeof order.customerAccountId !== 'string' ||
        typeof prepared.attemptId !== 'string' ||
        typeof acquireFinalAction !== 'function'
      )
        throw new Error('KemerBet credit attempt is unavailable.');
      let requested = false;
      const dispatch = await session.executeRoutineOneUseDeposit(
        order.customerAccountId,
        order.amount.minor,
        async () => {
          if (requested) throw new Error('KemerBet final action was already requested.');
          requested = true;
          const authority = await acquireFinalAction();
          if (!samePreparedAttempt(prepared, authority))
            throw new Error('KemerBet final action did not match the prepared credit.');
          return Object.freeze({
            playerId: order.customerAccountId,
            amountMinor: order.amount.minor,
            isFresh: () => authority.isFresh(),
          });
        },
      );
      if (dispatch.outcome === 'local_uncertain')
        return Object.freeze({ outcome: 'uncertain', reason: 'provider_action_ambiguous' });
      try {
        const observation = projectKemerBetDispatchObservation(dispatch);
        if (observation.outcome !== 'provider_success_observed') throw new Error();
        return Object.freeze({ ...observation, dispatch });
      } catch {
        return Object.freeze({ outcome: 'uncertain', reason: 'confirmation_mismatch' });
      }
    },
  });
}

/**
 * Binds both adapter methods to one validated, signed database lease. The live worker still
 * finalizes a success modal; the legacy signed history route is exposed without activating it.
 */
export function createKemerBetCompanionCreditAdapter(
  session: Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>,
  store: Pick<RoutineDepositExecutionStore, 'reconcile'>,
  lease: RoutineDepositLease,
): KemerBetCompanionCreditAdapter {
  if (!isValidRoutineDepositLease(lease)) throw new Error('KemerBet credit lease is invalid.');
  const boundLease = Object.freeze({ ...lease, policy: Object.freeze({ ...lease.policy }) });
  const boundAttempt =
    boundLease.phase === 'execute'
      ? projectKemerBetPreparedAttempt(boundLease)
      : projectKemerBetFencedAttempt(boundLease);
  const submission = createKemerBetCompanionSubmissionAdapter(session);
  return Object.freeze({
    platformCode: 'kemerbet' as const,
    async submitOnce(
      prepared: PlatformCreditPreparedAttempt,
      acquireFinalAction: () => Promise<PlatformCreditFinalActionAuthority>,
    ): Promise<KemerBetCompanionSubmission> {
      if (
        boundLease.phase !== 'execute' ||
        prepared?.finalActionFenced !== false ||
        !sameCreditBinding(boundAttempt, prepared)
      )
        throw new Error('KemerBet credit attempt does not match the leased payment.');
      return submission.submitOnce(prepared, acquireFinalAction);
    },
    async reconcile(attempt: PlatformCreditAttempt): Promise<PlatformCreditReconciliation> {
      if (
        boundLease.phase !== 'reconcile' ||
        attempt?.finalActionFenced !== true ||
        !sameCreditBinding(boundAttempt, attempt)
      )
        throw new Error('KemerBet reconciliation does not match the fenced payment.');
      return projectKemerBetReconciliation(boundLease, await store.reconcile(boundLease));
    },
  });
}

export interface KemerBetCompanionCreditAdapter extends PlatformCreditAdapter {
  readonly platformCode: 'kemerbet';
  submitOnce(
    prepared: PlatformCreditPreparedAttempt,
    acquireFinalAction: () => Promise<PlatformCreditFinalActionAuthority>,
  ): Promise<KemerBetCompanionSubmission>;
}
