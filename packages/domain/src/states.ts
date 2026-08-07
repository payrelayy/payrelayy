export type DepositStatus =
  | 'intake_received'
  | 'verification_pending'
  | 'verification_review'
  | 'verified'
  | 'execution_pending'
  | 'execution_in_progress'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'execution_uncertain';

export type WithdrawalStatus =
  | 'validation_pending'
  | 'rejected'
  | 'awaiting_admin_approval'
  | 'approved_for_manual_payout'
  | 'manual_payout_pending'
  | 'manual_payout_recorded'
  | 'manual_payout_uncertain';

const depositTransitions: Readonly<Record<DepositStatus, readonly DepositStatus[]>> = {
  intake_received: ['verification_pending', 'rejected', 'expired'],
  verification_pending: ['verification_review', 'verified', 'rejected', 'expired'],
  verification_review: ['verification_pending', 'verified', 'rejected', 'expired'],
  verified: ['execution_pending', 'execution_uncertain'],
  execution_pending: ['execution_in_progress', 'execution_uncertain'],
  execution_in_progress: ['executed', 'execution_uncertain'],
  executed: [],
  rejected: [],
  expired: ['verification_review'],
  execution_uncertain: ['execution_pending', 'executed', 'verification_review'],
};

export function canTransitionDeposit(from: DepositStatus, to: DepositStatus): boolean {
  return depositTransitions[from].includes(to);
}
