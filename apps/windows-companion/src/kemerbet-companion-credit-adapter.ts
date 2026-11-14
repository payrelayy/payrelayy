import type {
  PlatformCreditAdapter,
  PlatformCreditFinalActionAuthority,
  PlatformCreditPreparedAttempt,
} from '@fetanagent/contracts';

import {
  isRoutineDepositAmountMinor,
  type LocalKemerBetRoutineDepositDispatchOutcome,
} from './local-kemerbet-deposit.js';
import type { LocalKemerBetSession } from './local-kemerbet-session.js';
import { projectKemerBetDispatchObservation } from './kemerbet-credit-boundary.js';

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

function samePreparedAttempt(
  prepared: PlatformCreditPreparedAttempt,
  authority: PlatformCreditFinalActionAuthority,
): boolean {
  const attempt = authority.attempt;
  const expected = prepared.order;
  const actual = attempt?.order;
  return (
    attempt?.finalActionFenced === true &&
    attempt.attemptId === prepared.attemptId &&
    actual?.depositIntentId === expected.depositIntentId &&
    actual.paymentClaimId === expected.paymentClaimId &&
    actual.platformCode === expected.platformCode &&
    actual.platformAgentAccountId === expected.platformAgentAccountId &&
    actual.customerAccountId === expected.customerAccountId &&
    actual.amount?.minor === expected.amount.minor &&
    actual.currencyCode === expected.currencyCode &&
    actual.orderReference === expected.orderReference &&
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
