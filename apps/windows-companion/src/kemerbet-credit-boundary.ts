import { EtbAmount } from '@fetanagent/domain';
import type {
  PlatformCreditAttempt,
  PlatformCreditOrder,
  PlatformCreditPreparedAttempt,
  PlatformCreditReconciliation,
  PlatformCreditSubmission,
} from '@fetanagent/contracts';

import type { LocalKemerBetDepositDispatchOutcome } from './provider-route.js';
import {
  isValidRoutineDepositLease,
  matchesRoutineDepositBinding,
  type RoutineDepositLease,
  type RoutineDepositReconciliation,
} from './routine-deposit-worker.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

/** A read-only projection of a validated database lease; it grants no transfer authority. */
export function projectKemerBetCreditOrder(lease: RoutineDepositLease): PlatformCreditOrder {
  if (!isValidRoutineDepositLease(lease)) throw new Error('Invalid KemerBet credit lease.');
  return Object.freeze({
    depositIntentId: lease.intentId,
    paymentClaimId: lease.paymentClaimId,
    platformCode: lease.policy.platformCode,
    platformAgentAccountId: lease.platformAgentAccountId,
    customerAccountId: lease.playerId,
    amount: EtbAmount.fromMinor(lease.amountMinor),
    currencyCode: lease.currencyCode,
    // The job ID is correlation only. KemerBet does not accept it as an idempotency key.
    orderReference: lease.jobId,
  });
}

export function projectKemerBetPreparedAttempt(
  lease: RoutineDepositLease,
): PlatformCreditPreparedAttempt {
  const order = projectKemerBetCreditOrder(lease);
  return Object.freeze({ order, attemptId: lease.attemptId });
}

/** Only a lease already fenced by the durable store can be represented as an attempt. */
export function projectKemerBetFencedAttempt(lease: RoutineDepositLease): PlatformCreditAttempt {
  const prepared = projectKemerBetPreparedAttempt(lease);
  if (lease.phase !== 'reconcile' || lease.finalActionFenced !== true)
    throw new Error('KemerBet final action is not fenced.');
  return Object.freeze({ ...prepared, finalActionFenced: true });
}

/** Provider success is an observation; the signed dispatch and durable modal confirmation follow. */
export function projectKemerBetDispatchObservation(
  dispatch: LocalKemerBetDepositDispatchOutcome,
): PlatformCreditSubmission {
  if (dispatch.outcome === 'local_uncertain')
    return Object.freeze({ outcome: 'uncertain', reason: 'provider_action_ambiguous' });
  if (
    dispatch.outcome !== 'submission_attempted' ||
    dispatch.exactPlayerCreditMatch !== true ||
    !DIGEST.test(dispatch.providerResponseDigest)
  )
    throw new Error('KemerBet success evidence did not match the prepared credit.');
  return Object.freeze({
    outcome: 'provider_success_observed',
    evidenceDigest: dispatch.providerResponseDigest,
  });
}

/** A signed reconciliation ID is internal; never present it as a KemerBet transaction ID. */
export function projectKemerBetReconciliation(
  lease: RoutineDepositLease,
  result: RoutineDepositReconciliation,
): PlatformCreditReconciliation {
  projectKemerBetFencedAttempt(lease);
  if (result.outcome === 'pending') return Object.freeze({ outcome: 'pending' });
  if (result.outcome === 'uncertain')
    return Object.freeze({ outcome: 'uncertain', reason: 'platform_credit_unresolved' });
  if (
    result.outcome !== 'confirmed_executed' ||
    !matchesRoutineDepositBinding(lease, result) ||
    result.exactHistoryMatchCount !== 1 ||
    result.playerCreditConfirmed !== true ||
    !DIGEST.test(result.evidenceDigest)
  )
    throw new Error('KemerBet credit reconciliation did not match the fenced attempt.');
  return Object.freeze({ outcome: 'confirmed', evidenceDigest: result.evidenceDigest });
}
