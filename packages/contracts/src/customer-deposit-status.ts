import type { DepositStatus } from '@fetanagent/domain';

export type CustomerDepositStatusLabel =
  | 'Ready to start'
  | 'Checking payment'
  | 'Being checked'
  | 'Preparing deposit'
  | 'Completed'
  | 'Needs attention'
  | 'Could not confirm'
  | 'Expired'
  | 'Cancelled';

export type CustomerDepositStatusTone = 'neutral' | 'working' | 'success' | 'attention';

/**
 * The complete customer-safe deposit status surface. It deliberately contains no internal status,
 * database identifier, agent detail, execution attempt, or provider reference.
 */
export interface CustomerDepositStatusProjection {
  readonly label: CustomerDepositStatusLabel;
  readonly tone: CustomerDepositStatusTone;
}

const projection = (
  label: CustomerDepositStatusLabel,
  tone: CustomerDepositStatusTone,
): CustomerDepositStatusProjection => Object.freeze({ label, tone });

const CUSTOMER_DEPOSIT_STATUS_BY_INTERNAL_STATUS = {
  intake_received: projection('Ready to start', 'neutral'),
  verification_pending: projection('Checking payment', 'working'),
  verification_review: projection('Being checked', 'working'),
  verified: projection('Preparing deposit', 'working'),
  execution_pending: projection('Preparing deposit', 'working'),
  execution_in_progress: projection('Preparing deposit', 'working'),
  execution_review: projection('Needs attention', 'attention'),
  execution_reconciliation: projection('Being checked', 'working'),
  executed: projection('Completed', 'success'),
  rejected: projection('Could not confirm', 'attention'),
  expired: projection('Expired', 'neutral'),
  cancelled: projection('Cancelled', 'neutral'),
  execution_uncertain: projection('Being checked', 'working'),
} as const satisfies Readonly<Record<DepositStatus, CustomerDepositStatusProjection>>;

/** Project one authoritative internal status to the deliberately small customer-facing surface. */
export function projectCustomerDepositStatus(
  status: DepositStatus,
): CustomerDepositStatusProjection {
  return CUSTOMER_DEPOSIT_STATUS_BY_INTERNAL_STATUS[status];
}

/** Strictly validate a projection received over an internal presentation transport. */
export function isCustomerDepositStatusProjection(
  value: unknown,
): value is CustomerDepositStatusProjection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(',') !== 'label,tone') return false;
  return (
    [
      'Ready to start',
      'Checking payment',
      'Being checked',
      'Preparing deposit',
      'Completed',
      'Needs attention',
      'Could not confirm',
      'Expired',
      'Cancelled',
    ] satisfies readonly CustomerDepositStatusLabel[]
  ).includes(candidate.label as CustomerDepositStatusLabel) &&
    (
      ['neutral', 'working', 'success', 'attention'] satisfies readonly CustomerDepositStatusTone[]
    ).includes(candidate.tone as CustomerDepositStatusTone)
    ? validLabelTonePair(candidate.label, candidate.tone)
    : false;
}

function validLabelTonePair(label: unknown, tone: unknown): boolean {
  if (label === 'Completed') return tone === 'success';
  if (label === 'Needs attention' || label === 'Could not confirm') return tone === 'attention';
  if (label === 'Ready to start' || label === 'Expired' || label === 'Cancelled') {
    return tone === 'neutral';
  }
  return tone === 'working';
}
