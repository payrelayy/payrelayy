import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';

export const KEMERBET_DEPOSIT_CURRENCY_CODE = 'ETB' as const;
export const KEMERBET_DEPOSIT_OPERATION = 'deposit' as const;

export type KemerBetDepositPhase = 'prepare' | 'execute' | 'reconcile';

export interface KemerBetDepositTarget {
  readonly operation: typeof KEMERBET_DEPOSIT_OPERATION;
  readonly playerId: string;
  readonly amountMinor: number;
  readonly currencyCode: typeof KEMERBET_DEPOSIT_CURRENCY_CODE;
}

interface KemerBetDepositLeaseBase {
  readonly depositIntentId: string;
  readonly executionAttemptId: string;
  readonly platformAgentAccountId: string;
  readonly target: KemerBetDepositTarget;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
}

export interface KemerBetDepositExecutionLease extends KemerBetDepositLeaseBase {
  readonly disposition: 'execution';
  readonly phase: 'execute';
  readonly executionJobId: string;
}

export interface KemerBetDepositExecutionRecoveryCircuit {
  readonly disposition: 'recovered_expired_prepared';
  readonly depositIntentId: string;
  readonly executionAttemptId: string;
}

export type KemerBetDepositExecutionLeaseResult =
  KemerBetDepositExecutionLease | KemerBetDepositExecutionRecoveryCircuit;

export interface KemerBetDepositReconciliationLease extends KemerBetDepositLeaseBase {
  readonly phase: 'reconcile';
  readonly reconciliationJobId: string;
  readonly recovery: {
    readonly finalActionFencedAt: Date;
    readonly reconciliationRequiredAt: Date;
    readonly exactPlayerCreditMatch: boolean | null;
  };
}

export type KemerBetDepositCancelReason =
  | 'preparation_failed'
  | 'agent_unavailable_before_action'
  | 'session_unavailable_before_action'
  | 'operator_stopped_before_action'
  | 'execution_lease_expired_before_action';

export interface KemerBetDepositPreparedPage {
  readonly exactPlayerMatch: true;
  readonly exactCurrencyMatch: true;
  readonly amountFilledMinor: number;
  readonly preparedAt: Date;
}

export interface KemerBetDepositPositiveEvidence {
  readonly keyedExternalReferenceFingerprint: string;
  readonly approvedHistoryMatchCount: 1;
  readonly normalizedOperationType: 'deposit';
  readonly matchedHistoryOccurredAt: Date;
  readonly exactPlayerMatch: true;
  readonly exactAmountMatch: true;
  readonly exactCurrencyMatch: true;
  readonly exactPlayerCreditMatch: true;
}

export type KemerBetDepositPageObservation =
  | {
      readonly observation: 'confirmed_executed';
      readonly evidence: KemerBetDepositPositiveEvidence;
      readonly reasonCode: 'exact_history_and_player_credit';
    }
  | {
      readonly observation: 'ambiguous';
      readonly evidence: null;
      readonly reasonCode:
        'multiple_exact_history_rows' | 'history_mismatch' | 'player_credit_mismatch';
    }
  | {
      readonly observation: 'not_observed';
      readonly evidence: null;
      readonly reasonCode: 'history_missing' | 'history_unavailable';
    };

export interface KemerBetDepositCancellationRecord {
  readonly depositIntentId: string;
  readonly executionJobId: string;
  readonly executionAttemptId: string;
  readonly attemptStatus: 'cancelled_before_action';
  readonly depositStatus: 'execution_review';
  readonly cancelledAt: Date;
}

export interface KemerBetDepositFenceRecord {
  readonly depositIntentId: string;
  readonly executionAttemptId: string;
  readonly finalActionFencedAt: Date;
  readonly firstFenceAcquired: boolean;
}

export interface KemerBetDepositReconciliationRequiredRecord {
  readonly depositIntentId: string;
  readonly executionAttemptId: string;
  readonly reconciliationJobId: string;
  readonly attemptStatus: 'reconciliation_required';
  readonly depositStatus: 'execution_reconciliation';
  readonly recoveryHandoff: boolean;
}

export interface KemerBetDepositReconciliationRecord {
  readonly depositIntentId: string;
  readonly reconciliationJobId: string;
  readonly executionAttemptId: string;
  readonly reconciliationId: string;
  readonly outcome: 'confirmed_executed' | 'ambiguous' | 'not_observed';
  readonly reasonCode:
    | 'agent_deposit_history_in_window_and_player_credit_confirmed'
    | 'agent_history_ambiguous'
    | 'agent_history_not_observed';
  readonly attemptStatus: 'confirmed_executed' | 'review_required' | 'reconciliation_required';
  readonly depositStatus: 'executed' | 'execution_review' | 'execution_reconciliation';
  readonly followUpJobId: string | null;
}

export interface KemerBetDepositExecutionDatabase {
  leaseNextExecution(
    workerInstanceId: string,
    leaseSeconds: number,
  ): Promise<KemerBetDepositExecutionLeaseResult | null>;
  cancelBeforeAction(
    lease: KemerBetDepositExecutionLease,
    reasonCode: KemerBetDepositCancelReason,
  ): Promise<KemerBetDepositCancellationRecord>;
  fenceFinalAction(lease: KemerBetDepositExecutionLease): Promise<KemerBetDepositFenceRecord>;
  requireReconciliation(
    lease: KemerBetDepositExecutionLease,
    exactPlayerCreditMatch: boolean,
  ): Promise<KemerBetDepositReconciliationRequiredRecord>;
  leaseNextReconciliation(
    workerInstanceId: string,
    leaseSeconds: number,
  ): Promise<KemerBetDepositReconciliationLease | null>;
  recordReconciliation(
    lease: KemerBetDepositReconciliationLease,
    observation: KemerBetDepositPageObservation,
  ): Promise<KemerBetDepositReconciliationRecord>;
}

export interface KemerBetDepositRedactedLog {
  readonly component: 'kemerbet_deposit_executor';
  readonly event:
    | 'idle'
    | 'prepared_before_action'
    | 'cancelled_before_action'
    | 'final_action_fenced'
    | 'reconciliation_required'
    | 'completed'
    | 'needs_attention'
    | 'reconciliation_follow_up';
  readonly phase: KemerBetDepositPhase | 'none';
  readonly actionRetryAllowed: false;
  readonly financialDetailsRedacted: true;
}

export function isKemerBetDepositAmountMinor(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= DEPOSIT_MINIMUM_MINOR &&
    value <= DEPOSIT_MAXIMUM_MINOR
  );
}
