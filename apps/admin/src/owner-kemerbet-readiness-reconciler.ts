import { randomUUID } from 'node:crypto';

import type {
  OwnerKemerbetReadinessCohortFailureCode,
  OwnerKemerbetReadinessCohortControl,
  OwnerKemerbetReadinessRootReceipt,
} from './owner-kemerbet-readiness-cohort.js';

interface OwnerKemerbetReadinessRootReceiptRecorder {
  recordRootReceipt(
    claimId: string,
    receiptId: string,
    event: 'completed' | 'imported',
    failureCode?: OwnerKemerbetReadinessCohortFailureCode,
  ): Promise<unknown>;
}

export type OwnerKemerbetReadinessReconciliationResult =
  | 'completed_recorded'
  | 'imported_recorded'
  | 'none'
  | 'recheck_authorization_spent_failed_terminal'
  | 'retryable_failed'
  | 'security_recovery_cohort_required'
  | 'security_recovery_required';

/**
 * Reconcile only an exact root-owned filesystem receipt into the private DB ledger.
 * The return value deliberately contains no claim, receipt, Player, or configuration identifier.
 */
export async function reconcileOwnerKemerbetReadinessRootReceipt(
  control: Pick<OwnerKemerbetReadinessCohortControl, 'rootReceipt'>,
  recorder: OwnerKemerbetReadinessRootReceiptRecorder,
  createReceiptId: () => string = randomUUID,
): Promise<OwnerKemerbetReadinessReconciliationResult> {
  const receipt: OwnerKemerbetReadinessRootReceipt | undefined = await control.rootReceipt();
  if (!receipt) return 'none';
  if (receipt.event === 'retryable_failed') return 'retryable_failed';
  if (receipt.event === 'recheck_authorization_spent_failed_terminal') {
    return 'recheck_authorization_spent_failed_terminal';
  }
  if (receipt.event === 'security_recovery_failed_terminal') {
    return 'security_recovery_required';
  }
  if (receipt.event === 'security_recovery_profile_finalized') {
    return 'security_recovery_cohort_required';
  }

  await recorder.recordRootReceipt(receipt.claimId, createReceiptId(), receipt.event);
  return receipt.event === 'completed' ? 'completed_recorded' : 'imported_recorded';
}
