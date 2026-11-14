import { isRoutineDepositAmountMinor } from './local-kemerbet-deposit.js';
import type {
  RoutineDepositBinding,
  RoutineDepositLease,
  RoutineDepositPolicy,
} from './routine-deposit-worker.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export function isRoutineDepositPolicy(candidate: unknown): candidate is RoutineDepositPolicy {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const policy = candidate as Partial<RoutineDepositPolicy>;
  return (
    policy.mode === 'routine_production' &&
    policy.status === 'active' &&
    policy.version === 1 &&
    (policy.provider === 'telebirr' || policy.provider === 'receiver_sms') &&
    policy.platformCode === 'kemerbet' &&
    policy.currencyCode === 'ETB' &&
    (policy.minimumAmountMinor === 2500 || policy.minimumAmountMinor === 10000) &&
    policy.maximumAmountMinor === 2500000 &&
    policy.playerScope === 'all_active_deposit_eligible' &&
    policy.playerOwnershipRequired === false &&
    policy.dailyQuotaMinor === null &&
    policy.successfulDepositQuota === null &&
    policy.maxConcurrentDeposits === 1 &&
    ((policy.provider === 'telebirr' &&
      policy.amountSource === 'official_receipt_settled_amount') ||
      (policy.provider === 'receiver_sms' && policy.amountSource === 'receiver_sms_amount'))
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

export function matchesRoutineDepositBinding(
  expected: RoutineDepositBinding,
  actual: RoutineDepositBinding,
): boolean {
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

export function isValidRoutineDepositLease(lease: RoutineDepositLease): boolean {
  return (
    validBinding(lease) &&
    isRoutineDepositPolicy(lease.policy) &&
    lease.amountMinor >= lease.policy.minimumAmountMinor &&
    lease.amountMinor <= lease.policy.maximumAmountMinor &&
    lease.paymentVerified === true &&
    lease.playerActive === true &&
    lease.playerDepositEligible === true &&
    lease.attemptNumber === 1 &&
    ((lease.phase === 'execute' && lease.finalActionFenced === false) ||
      (lease.phase === 'reconcile' && lease.finalActionFenced === true))
  );
}
