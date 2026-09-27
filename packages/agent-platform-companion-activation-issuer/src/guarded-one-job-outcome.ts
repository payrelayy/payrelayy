import type { CompanionActivationSnapshotQuery } from './snapshot.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const APPROVED_JOB_SQL = `
  select approval.execution_job_id::text as job_id,
         (approval.expires_at > pg_catalog.clock_timestamp()) as approval_current,
         job.status::text as job_status
    from app.agent_platform_companion_execution_activation_consumptions consumption
    join app.deposit_execution_owner_approvals approval
      on approval.activation_epoch = consumption.activation_epoch
     and approval.pilot_revision_id = consumption.pilot_revision_id
     and approval.approved_by_admin_id = consumption.activated_by_admin_id
     and approval.approved_at >= consumption.activated_at
    join app.deposit_jobs job
      on job.id = approval.execution_job_id
     and job.deposit_intent_id = approval.deposit_intent_id
     and job.job_kind = 'execute_deposit'
   where consumption.request_key = $1::uuid
     and session_user = 'postgres'
`;

// This query is deliberately anchored to both the consumed activation request and
// the exact Owner-approved execution job. A companion status or browser response
// cannot be substituted for the database's terminal reconciliation evidence.
export const OUTCOME_SQL = `
  select
    job.status::text as job_status,
    intent.status::text as intent_status,
    attempt.status::text as attempt_status,
    (attempt.platform_agent_account_id = request.platform_agent_account_id) as attempt_agent_match,
    assignment.state::text as assignment_state,
    (assignment.activation_epoch = consumption.activation_epoch) as assignment_epoch_match,
    reconciliation.outcome::text as reconciliation_outcome,
    reconciliation_job.status::text as reconciliation_job_status,
    reconciliation.approved_history_match_count::integer as history_match_count,
    reconciliation.exact_player_match as exact_player_match,
    reconciliation.exact_amount_match as exact_amount_match,
    reconciliation.exact_currency_match as exact_currency_match,
    reconciliation.exact_player_credit_match as exact_player_credit_match
  from app.agent_platform_companion_execution_activation_consumptions consumption
  join app.agent_platform_companion_execution_activation_requests request
    on request.request_key = consumption.request_key
   and request.activation_epoch = consumption.activation_epoch
   and request.pilot_revision_id = consumption.pilot_revision_id
  join app.deposit_execution_owner_approvals approval
    on approval.activation_epoch = consumption.activation_epoch
   and approval.pilot_revision_id = consumption.pilot_revision_id
   and approval.approved_by_admin_id = consumption.activated_by_admin_id
  join app.deposit_jobs job
    on job.id = approval.execution_job_id
   and job.deposit_intent_id = approval.deposit_intent_id
   and job.job_kind = 'execute_deposit'
  join app.deposit_intents intent
    on intent.id = job.deposit_intent_id
  left join app.deposit_execution_attempts attempt
    on attempt.deposit_job_id = job.id
   and attempt.deposit_intent_id = intent.id
  left join app.agent_platform_companion_execution_assignments assignment
    on assignment.execution_attempt_id = attempt.id
   and assignment.execution_job_id = job.id
  left join lateral (
    select entry.outcome, entry.deposit_job_id,
           entry.approved_history_match_count,
           entry.exact_player_match, entry.exact_amount_match,
           entry.exact_currency_match, entry.exact_player_credit_match
      from app.execution_reconciliations entry
     where entry.deposit_execution_attempt_id = attempt.id
       and entry.deposit_intent_id = intent.id
       and entry.platform_agent_account_id = attempt.platform_agent_account_id
     order by entry.reconciliation_number desc
     limit 1
  ) reconciliation on true
  left join app.deposit_jobs reconciliation_job
    on reconciliation_job.id = reconciliation.deposit_job_id
   and reconciliation_job.deposit_intent_id = intent.id
   and reconciliation_job.job_kind = 'reconcile_execution'
  where consumption.request_key = $1::uuid
    and approval.execution_job_id = $2::uuid
    and session_user = 'postgres'
`;

export type GuardedOneJobOutcome = 'pending' | 'confirmed' | 'review_required';

export class GuardedOneJobOutcomeUnavailableError extends Error {
  readonly requiresIndependentStopAndReconciliation = true;

  constructor() {
    super('The guarded one-job outcome cannot be confirmed.');
    this.name = 'GuardedOneJobOutcomeUnavailableError';
  }
}

const POLL_MS = 1_500;
const QUERY_WAIT_MS = 8_000;
const EXPIRY_MARGIN_MS = 30_000;

export interface GuardedOneJobOutcomeWatchInput {
  readonly requestKey: string;
  readonly executionJobId: string;
  readonly administrator: CompanionActivationSnapshotQuery;
  /** Exact expiry returned by the one-use database activation transition. */
  readonly validUntil: string;
  readonly trustedNow: () => Date;
  /** Independent database-watchdog/exact-child supervisor loss. */
  readonly supervisorLost: Promise<never>;
  readonly signal?: AbortSignal;
}

export type GuardedApprovedJobWatchInput = Omit<GuardedOneJobOutcomeWatchInput, 'executionJobId'>;

function nowMs(source: () => Date): number {
  const value = source();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error();
  return value.getTime();
}

function waitOrAbort(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, durationMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function boundedObservation<T>(
  task: () => Promise<T>,
  lost: Promise<never>,
  durationMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abort = (): void => undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error()), durationMs);
      abort = () => reject(new Error());
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    return await Promise.race([Promise.resolve().then(task), lost, timeout]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function checkedExpiry(input: GuardedApprovedJobWatchInput): number {
  const expiry = Date.parse(input.validUntil);
  const start = nowMs(input.trustedNow);
  if (
    !Number.isFinite(expiry) ||
    new Date(expiry).toISOString() !== input.validUntil ||
    expiry <= start + EXPIRY_MARGIN_MS ||
    expiry > start + 2 * 60 * 60_000 + 30_000 ||
    typeof input.supervisorLost?.then !== 'function' ||
    input.signal?.aborted
  )
    throw new Error();
  return expiry;
}

/** Read-only wait for exactly one subsequent, database-recorded Owner approval. */
export async function watchGuardedApprovedJobId(
  input: GuardedApprovedJobWatchInput,
): Promise<string> {
  try {
    const expiry = checkedExpiry(input);
    while (true) {
      const remaining = expiry - EXPIRY_MARGIN_MS - nowMs(input.trustedNow);
      if (remaining <= 0 || input.signal?.aborted) throw new Error();
      const jobId = await boundedObservation(
        () => loadGuardedApprovedJobId(input.requestKey, input.administrator),
        input.supervisorLost,
        Math.min(QUERY_WAIT_MS, remaining),
        input.signal,
      );
      if (jobId) return jobId;
      const beforeNext = expiry - EXPIRY_MARGIN_MS - nowMs(input.trustedNow);
      if (beforeNext <= 0) throw new Error();
      await Promise.race([
        waitOrAbort(Math.min(POLL_MS, beforeNext), input.signal),
        input.supervisorLost,
      ]);
    }
  } catch {
    throw new GuardedOneJobOutcomeUnavailableError();
  }
}

/**
 * Polls only the same read-only, exact-job snapshot. This cannot re-lease or
 * retry a provider action. The independent supervisor must remain alive for
 * every observation; expiry, silence, or a broken query requires stop/review.
 */
export async function watchGuardedOneJobOutcome(
  input: GuardedOneJobOutcomeWatchInput,
): Promise<Exclude<GuardedOneJobOutcome, 'pending'>> {
  try {
    const expiry = checkedExpiry(input);

    while (true) {
      const remaining = expiry - EXPIRY_MARGIN_MS - nowMs(input.trustedNow);
      if (remaining <= 0 || input.signal?.aborted) throw new Error();
      const outcome = await boundedObservation(
        () => loadGuardedOneJobOutcome(input.requestKey, input.executionJobId, input.administrator),
        input.supervisorLost,
        Math.min(QUERY_WAIT_MS, remaining),
        input.signal,
      );
      if (outcome !== 'pending') return outcome;
      const beforeNext = expiry - EXPIRY_MARGIN_MS - nowMs(input.trustedNow);
      if (beforeNext <= 0) throw new Error();
      await Promise.race([
        waitOrAbort(Math.min(POLL_MS, beforeNext), input.signal),
        input.supervisorLost,
      ]);
    }
  } catch {
    throw new GuardedOneJobOutcomeUnavailableError();
  }
}

function exactFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

/**
 * Returns no job until the Owner approves one after activation. A second
 * approval within the same activated session is terminal ambiguity, never a
 * second executable command. An expired unclaimed approval also fails closed.
 */
export async function loadGuardedApprovedJobId(
  requestKey: string,
  administrator: CompanionActivationSnapshotQuery,
): Promise<string | null> {
  try {
    if (!UUID_V4.test(requestKey) || !administrator || typeof administrator.query !== 'function')
      throw new Error();
    const result = await administrator.query(APPROVED_JOB_SQL, [requestKey]);
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw new Error();
    const row = result.rows[0];
    if (
      !exactFields(row, ['job_id', 'approval_current', 'job_status']) ||
      typeof row.job_id !== 'string' ||
      !UUID_V4.test(row.job_id) ||
      typeof row.approval_current !== 'boolean' ||
      typeof row.job_status !== 'string' ||
      !['queued', 'leased', 'succeeded', 'dead', 'cancelled'].includes(row.job_status) ||
      (!row.approval_current && row.job_status === 'queued')
    )
      throw new Error();
    return row.job_id;
  } catch {
    throw new GuardedOneJobOutcomeUnavailableError();
  }
}

/**
 * One administrator-only MVCC snapshot. A positive outcome requires the
 * database's completed reconciliation and exact Player, amount, currency, and
 * credit evidence together. An uncertain or malformed row is never success.
 * This adapter does not lease, settle, credit, retry, or execute a job.
 */
export async function loadGuardedOneJobOutcome(
  requestKey: string,
  executionJobId: string,
  administrator: CompanionActivationSnapshotQuery,
): Promise<GuardedOneJobOutcome> {
  try {
    if (
      !UUID_V4.test(requestKey) ||
      !UUID_V4.test(executionJobId) ||
      !administrator ||
      typeof administrator.query !== 'function'
    )
      throw new Error();
    const result = await administrator.query(OUTCOME_SQL, [requestKey, executionJobId]);
    if (result.rows.length !== 1) throw new Error();
    const row = result.rows[0];
    if (
      !exactFields(row, [
        'job_status',
        'intent_status',
        'attempt_status',
        'attempt_agent_match',
        'assignment_state',
        'assignment_epoch_match',
        'reconciliation_outcome',
        'reconciliation_job_status',
        'history_match_count',
        'exact_player_match',
        'exact_amount_match',
        'exact_currency_match',
        'exact_player_credit_match',
      ])
    )
      throw new Error();
    if (
      (row.attempt_status === null
        ? row.attempt_agent_match !== null
        : row.attempt_agent_match !== true) ||
      (row.assignment_state === null
        ? row.assignment_epoch_match !== null
        : row.assignment_epoch_match !== true)
    )
      throw new Error();

    if (
      row.job_status === 'succeeded' &&
      row.intent_status === 'executed' &&
      row.attempt_status === 'confirmed_executed' &&
      row.assignment_state === 'result_recorded' &&
      row.reconciliation_outcome === 'confirmed_executed' &&
      row.reconciliation_job_status === 'succeeded' &&
      row.history_match_count === 1 &&
      row.exact_player_match === true &&
      row.exact_amount_match === true &&
      row.exact_currency_match === true &&
      row.exact_player_credit_match === true
    )
      return 'confirmed';

    if (
      row.intent_status === 'execution_review' ||
      row.attempt_status === 'review_required' ||
      row.reconciliation_outcome === 'ambiguous' ||
      row.reconciliation_outcome === 'not_observed' ||
      row.job_status === 'dead' ||
      row.job_status === 'cancelled'
    )
      return 'review_required';

    if (
      ['queued', 'leased', 'succeeded'].includes(row.job_status as string) &&
      [
        'execution_pending',
        'execution_in_progress',
        'execution_uncertain',
        'execution_reconciliation',
      ].includes(row.intent_status as string) &&
      [null, 'prepared', 'final_action_fenced', 'reconciliation_required'].includes(
        row.attempt_status as string | null,
      ) &&
      [
        null,
        'claimed',
        'signed',
        'authority_claimed',
        'authority_signed',
        'result_recorded',
      ].includes(row.assignment_state as string | null) &&
      row.reconciliation_outcome === null &&
      row.reconciliation_job_status === null &&
      row.history_match_count === null &&
      row.exact_player_match === null &&
      row.exact_amount_match === null &&
      row.exact_currency_match === null &&
      row.exact_player_credit_match === null
    )
      return 'pending';

    throw new Error();
  } catch {
    // Driver errors and rows can contain protected identifiers. Keep them out
    // of operator logs and customer-facing status.
    throw new GuardedOneJobOutcomeUnavailableError();
  }
}
