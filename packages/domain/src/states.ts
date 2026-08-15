export type DepositStatus =
  | 'intake_received'
  | 'verification_pending'
  | 'verification_review'
  | 'verified'
  | 'execution_pending'
  | 'execution_in_progress'
  | 'execution_review'
  | 'execution_reconciliation'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'execution_uncertain';

export type WithdrawalStatus =
  | 'validation_pending'
  | 'validation_unavailable'
  | 'awaiting_admin_approval'
  | 'approved_for_collection'
  | 'collection_in_progress'
  | 'collection_uncertain'
  | 'awaiting_manual_payout'
  | 'manual_payout_recorded'
  | 'manual_payout_uncertain'
  | 'rejected'
  | 'expired'
  | 'cancelled';

const depositTransitions: Readonly<Record<DepositStatus, readonly DepositStatus[]>> = {
  intake_received: ['verification_pending', 'rejected', 'expired', 'cancelled'],
  verification_pending: ['verification_review', 'verified', 'rejected', 'expired', 'cancelled'],
  verification_review: ['verification_pending', 'verified', 'rejected', 'expired', 'cancelled'],
  verified: ['execution_pending', 'execution_review'],
  execution_pending: ['execution_in_progress'],
  execution_in_progress: ['execution_uncertain'],
  execution_review: ['execution_reconciliation'],
  execution_reconciliation: ['executed', 'execution_review'],
  executed: [],
  rejected: [],
  expired: ['verification_review', 'cancelled'],
  cancelled: [],
  execution_uncertain: ['execution_reconciliation'],
};

export function canTransitionDeposit(from: DepositStatus, to: DepositStatus): boolean {
  return depositTransitions[from].includes(to);
}

const withdrawalTransitions: Readonly<Record<WithdrawalStatus, readonly WithdrawalStatus[]>> = {
  validation_pending: ['validation_unavailable', 'awaiting_admin_approval', 'rejected', 'expired'],
  validation_unavailable: ['validation_pending', 'rejected', 'expired', 'cancelled'],
  awaiting_admin_approval: ['approved_for_collection', 'rejected', 'expired', 'cancelled'],
  approved_for_collection: ['collection_in_progress', 'cancelled'],
  collection_in_progress: ['awaiting_manual_payout', 'collection_uncertain', 'rejected'],
  collection_uncertain: ['collection_in_progress', 'awaiting_manual_payout', 'rejected'],
  awaiting_manual_payout: ['manual_payout_recorded', 'manual_payout_uncertain'],
  manual_payout_uncertain: ['awaiting_manual_payout', 'manual_payout_recorded'],
  manual_payout_recorded: [],
  rejected: [],
  expired: ['validation_pending', 'cancelled'],
  cancelled: [],
};

export function canTransitionWithdrawal(from: WithdrawalStatus, to: WithdrawalStatus): boolean {
  return withdrawalTransitions[from].includes(to);
}
