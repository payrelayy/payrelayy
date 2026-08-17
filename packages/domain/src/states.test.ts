import { describe, expect, it } from 'vitest';

import { canTransitionDeposit, canTransitionWithdrawal } from './states.js';

describe('deposit state machine', () => {
  it('requires reconciliation before an uncertain execution can become executed', () => {
    expect(canTransitionDeposit('execution_uncertain', 'executed')).toBe(false);
    expect(canTransitionDeposit('execution_uncertain', 'execution_reconciliation')).toBe(true);
    expect(canTransitionDeposit('execution_reconciliation', 'executed')).toBe(true);
  });

  it('does not expose a positive execution retry path', () => {
    expect(canTransitionDeposit('execution_pending', 'execution_uncertain')).toBe(false);
    expect(canTransitionDeposit('execution_pending', 'execution_review')).toBe(false);
    expect(canTransitionDeposit('execution_in_progress', 'executed')).toBe(false);
    expect(canTransitionDeposit('execution_in_progress', 'execution_review')).toBe(false);
    expect(canTransitionDeposit('execution_uncertain', 'execution_review')).toBe(false);
    expect(canTransitionDeposit('execution_review', 'execution_pending')).toBe(false);
    expect(canTransitionDeposit('execution_review', 'rejected')).toBe(false);
    expect(canTransitionDeposit('execution_reconciliation', 'execution_pending')).toBe(false);
  });
});

describe('withdrawal state machine', () => {
  it('requires validation and approval before manual payout', () => {
    expect(canTransitionWithdrawal('validation_pending', 'awaiting_admin_approval')).toBe(true);
    expect(canTransitionWithdrawal('validation_pending', 'awaiting_manual_payout')).toBe(false);
    expect(canTransitionWithdrawal('awaiting_admin_approval', 'approved_for_collection')).toBe(
      true,
    );
  });
});
