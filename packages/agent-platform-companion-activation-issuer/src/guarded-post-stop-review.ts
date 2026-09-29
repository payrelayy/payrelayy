import type { GuardedCompanionEmergencyStopRehearsalResult } from './guarded-emergency-stop-rehearsal.js';
import { loadGuardedOneJobOutcome } from './guarded-one-job-outcome.js';
import type { CompanionActivationSnapshotQuery } from './snapshot.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Read only: locate the one Owner approval for a consumed activation after its
 * window may have expired. Unlike the live watcher, an expired queued approval
 * is still relevant to recovery and must not disappear from this inspection.
 */
export const POST_STOP_APPROVED_JOB_SQL = `
  select approval.execution_job_id::text as job_id,
         (approval.execution_job_id is not null) as approval_recorded,
         (job.id is not null) as job_match
    from app.agent_platform_companion_execution_activation_consumptions consumption
    left join app.deposit_execution_owner_approvals approval
      on approval.activation_epoch = consumption.activation_epoch
     and approval.pilot_revision_id = consumption.pilot_revision_id
     and approval.approved_by_admin_id = consumption.activated_by_admin_id
     and approval.approved_at >= consumption.activated_at
    left join app.deposit_jobs job
      on job.id = approval.execution_job_id
     and job.deposit_intent_id = approval.deposit_intent_id
     and job.job_kind = 'execute_deposit'
   where consumption.request_key = $1::uuid
     and session_user = 'postgres'
`;

export type GuardedPostStopReview =
  'no_owner_approval_recorded' | 'confirmed_in_reconciliation_ledger' | 'provider_review_required';

export class GuardedPostStopReviewUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The exact one-job post-stop review could not be confirmed.');
    this.name = 'GuardedPostStopReviewUnavailableError';
  }
}

function validStopProof(value: unknown): value is GuardedCompanionEmergencyStopRehearsalResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  const fields = [
    'databaseCredentialsAndSessionsRevoked',
    'financialAuthorityDisabled',
    'companionExecutionDisabled',
    'exactHostStopped',
    'providerOutcomeRequiresReconciliation',
  ];
  return Object.keys(proof).length === fields.length && fields.every((key) => proof[key] === true);
}

/**
 * Source-only, identifier-free classification after the caller's independent
 * database-and-exact-host stop has committed. A missing approval means only
 * that none was recorded for this request, not that a provider action is
 * impossible. A pending or ambiguous ledger always needs manual provider
 * review. This never leases, retries, credits, or releases another request.
 */
export async function inspectGuardedOneJobAfterStop(input: {
  readonly requestKey: string;
  readonly administrator: CompanionActivationSnapshotQuery;
  readonly stopOnUncertainty: () => Promise<GuardedCompanionEmergencyStopRehearsalResult>;
}): Promise<GuardedPostStopReview> {
  try {
    if (!input || typeof input.stopOnUncertainty !== 'function') throw new Error();
    const proof = await input.stopOnUncertainty();
    if (!validStopProof(proof)) throw new Error();
    if (
      typeof input.requestKey !== 'string' ||
      !UUID_V4.test(input.requestKey) ||
      !input.administrator ||
      typeof input.administrator.query !== 'function'
    )
      throw new Error();
    const result = await input.administrator.query(POST_STOP_APPROVED_JOB_SQL, [input.requestKey]);
    if (result.rows.length !== 1) throw new Error();
    const row = result.rows[0];
    if (
      !row ||
      Object.keys(row).length !== 3 ||
      typeof row.approval_recorded !== 'boolean' ||
      typeof row.job_match !== 'boolean'
    )
      throw new Error();
    if (row.job_id === null && !row.approval_recorded && !row.job_match)
      return 'no_owner_approval_recorded';
    if (
      !row.approval_recorded ||
      !row.job_match ||
      typeof row.job_id !== 'string' ||
      !UUID_V4.test(row.job_id)
    )
      throw new Error();
    const outcome = await loadGuardedOneJobOutcome(
      input.requestKey,
      row.job_id,
      input.administrator,
    );
    return outcome === 'confirmed'
      ? 'confirmed_in_reconciliation_ledger'
      : 'provider_review_required';
  } catch {
    throw new GuardedPostStopReviewUnavailableError();
  }
}
