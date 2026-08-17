import {
  KEMERBET_DEPOSIT_CURRENCY_CODE,
  KEMERBET_DEPOSIT_OPERATION,
  isKemerBetDepositAmountMinor,
  type KemerBetDepositCancellationRecord,
  type KemerBetDepositCancelReason,
  type KemerBetDepositExecutionDatabase,
  type KemerBetDepositExecutionLease,
  type KemerBetDepositExecutionLeaseResult,
  type KemerBetDepositFenceRecord,
  type KemerBetDepositPageObservation,
  type KemerBetDepositReconciliationLease,
  type KemerBetDepositReconciliationRecord,
  type KemerBetDepositReconciliationRequiredRecord,
} from './kemerbet-deposit-types.js';

export const LEASE_NEXT_DEPOSIT_EXECUTION_SQL = `
  select deposit_intent_id, execution_job_id, execution_attempt_id,
         platform_agent_account_id, player_id, amount_minor, currency_code,
         lease_token, lease_expires_at, lease_disposition
  from app.lease_next_deposit_execution($1::uuid, $2::integer)
`;

export const CANCEL_DEPOSIT_EXECUTION_BEFORE_ACTION_SQL = `
  select deposit_intent_id, execution_job_id, execution_attempt_id, attempt_status,
         deposit_status, cancelled_at
  from app.cancel_deposit_execution_before_action($1::uuid, $2::uuid, $3::text)
`;

export const FENCE_DEPOSIT_EXECUTION_FINAL_ACTION_SQL = `
  select deposit_intent_id, execution_attempt_id, final_action_fenced_at,
         first_fence_acquired
  from app.fence_deposit_execution_final_action($1::uuid, $2::uuid)
`;

export const REQUIRE_DEPOSIT_EXECUTION_RECONCILIATION_SQL = `
  select deposit_intent_id, execution_attempt_id, reconciliation_job_id, attempt_status,
         deposit_status, recovery_handoff
  from app.require_deposit_execution_reconciliation($1::uuid, $2::uuid, $3::boolean)
`;

export const LEASE_NEXT_DEPOSIT_EXECUTION_RECONCILIATION_SQL = `
  select deposit_intent_id, reconciliation_job_id, execution_attempt_id,
         platform_agent_account_id, player_id, amount_minor, currency_code,
         lease_token, lease_expires_at, final_action_fenced_at,
         reconciliation_required_at, exact_player_credit_match
  from app.lease_next_deposit_execution_reconciliation($1::uuid, $2::integer)
`;

export const RECORD_DEPOSIT_EXECUTION_RECONCILIATION_SQL = `
  select deposit_intent_id, reconciliation_job_id, execution_attempt_id,
         reconciliation_id, outcome, reason_code, attempt_status, deposit_status,
         follow_up_job_id
  from app.record_deposit_execution_reconciliation(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::smallint, $6::text,
    $7::timestamptz, $8::boolean, $9::boolean, $10::boolean, $11::boolean
  )
`;

export interface KemerBetDepositPostgresQuery {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class KemerBetDepositDatabaseUnavailableError extends Error {
  constructor() {
    super('The KemerBet deposit database runtime is unavailable.');
    this.name = 'KemerBetDepositDatabaseUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function fail(): never {
  throw new KemerBetDepositDatabaseUnavailableError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneRow(rows: readonly unknown[]): Record<string, unknown> {
  if (rows.length !== 1 || !isRecord(rows[0])) return fail();
  return rows[0];
}

function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !UUID_PATTERN.test(value) ||
    value === '00000000-0000-0000-0000-000000000000'
  ) {
    return fail();
  }
  return value;
}

function nullableUuid(value: unknown): string | null {
  return value === null ? null : uuid(value);
}

function date(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return fail();
  return new Date(value.getTime());
}

function integerMinor(value: unknown, maximum: number): number {
  let parsed: number;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'bigint') parsed = Number(value);
  else if (typeof value === 'string' && /^\d{1,16}$/u.test(value)) parsed = Number(value);
  else return fail();
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) return fail();
  return parsed;
}

function depositAmountMinor(value: unknown): number {
  const parsed = integerMinor(value, Number.MAX_SAFE_INTEGER);
  return isKemerBetDepositAmountMinor(parsed) ? parsed : fail();
}

function exactBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}

function nullableBoolean(value: unknown): boolean | null {
  return value === null ? null : exactBoolean(value);
}

function playerId(value: unknown): string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    value === value.trim()
    ? value
    : fail();
}

function leaseRequest(workerInstanceId: string, leaseSeconds: number): void {
  uuid(workerInstanceId);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 600) fail();
}

function requireIds(
  row: Record<string, unknown>,
  expected: {
    readonly depositIntentId: string;
    readonly executionAttemptId?: string;
    readonly executionJobId?: string;
    readonly reconciliationJobId?: string;
  },
): void {
  if (uuid(row.deposit_intent_id) !== expected.depositIntentId) fail();
  if (
    expected.executionAttemptId !== undefined &&
    uuid(row.execution_attempt_id) !== expected.executionAttemptId
  ) {
    fail();
  }
  if (
    expected.executionJobId !== undefined &&
    uuid(row.execution_job_id) !== expected.executionJobId
  ) {
    fail();
  }
  if (
    expected.reconciliationJobId !== undefined &&
    uuid(row.reconciliation_job_id) !== expected.reconciliationJobId
  ) {
    fail();
  }
}

function targetFromRow(row: Record<string, unknown>) {
  if (row.currency_code !== KEMERBET_DEPOSIT_CURRENCY_CODE) fail();
  return {
    operation: KEMERBET_DEPOSIT_OPERATION,
    playerId: playerId(row.player_id),
    amountMinor: depositAmountMinor(row.amount_minor),
    currencyCode: KEMERBET_DEPOSIT_CURRENCY_CODE,
  } as const;
}

export class PostgresKemerBetDepositExecutionDatabase implements KemerBetDepositExecutionDatabase {
  readonly #database: KemerBetDepositPostgresQuery;

  constructor(database: KemerBetDepositPostgresQuery) {
    this.#database = database;
  }

  async leaseNextExecution(
    workerInstanceId: string,
    leaseSeconds: number,
  ): Promise<KemerBetDepositExecutionLeaseResult | null> {
    leaseRequest(workerInstanceId, leaseSeconds);
    const rows = (
      await this.#database.query(LEASE_NEXT_DEPOSIT_EXECUTION_SQL, [workerInstanceId, leaseSeconds])
    ).rows;
    if (rows.length === 0) return null;
    const row = oneRow(rows);
    const depositIntentId = uuid(row.deposit_intent_id);
    const executionAttemptId = uuid(row.execution_attempt_id);
    if (row.lease_disposition === 'recovered_expired_prepared') {
      if (
        row.execution_job_id !== null ||
        row.platform_agent_account_id !== null ||
        row.player_id !== null ||
        row.amount_minor !== null ||
        row.currency_code !== null ||
        row.lease_token !== null ||
        row.lease_expires_at !== null
      ) {
        return fail();
      }
      return {
        disposition: 'recovered_expired_prepared',
        depositIntentId,
        executionAttemptId,
      };
    }
    if (row.lease_disposition !== 'execution') return fail();
    return {
      disposition: 'execution',
      phase: 'execute',
      depositIntentId,
      executionJobId: uuid(row.execution_job_id),
      executionAttemptId,
      platformAgentAccountId: uuid(row.platform_agent_account_id),
      target: targetFromRow(row),
      leaseToken: uuid(row.lease_token),
      leaseExpiresAt: date(row.lease_expires_at),
    };
  }

  async cancelBeforeAction(
    lease: KemerBetDepositExecutionLease,
    reasonCode: KemerBetDepositCancelReason,
  ): Promise<KemerBetDepositCancellationRecord> {
    const row = oneRow(
      (
        await this.#database.query(CANCEL_DEPOSIT_EXECUTION_BEFORE_ACTION_SQL, [
          lease.executionAttemptId,
          lease.leaseToken,
          reasonCode,
        ])
      ).rows,
    );
    requireIds(row, lease);
    if (
      row.attempt_status !== 'cancelled_before_action' ||
      row.deposit_status !== 'execution_review'
    ) {
      return fail();
    }
    return {
      depositIntentId: lease.depositIntentId,
      executionJobId: lease.executionJobId,
      executionAttemptId: lease.executionAttemptId,
      attemptStatus: 'cancelled_before_action',
      depositStatus: 'execution_review',
      cancelledAt: date(row.cancelled_at),
    };
  }

  async fenceFinalAction(
    lease: KemerBetDepositExecutionLease,
  ): Promise<KemerBetDepositFenceRecord> {
    const row = oneRow(
      (
        await this.#database.query(FENCE_DEPOSIT_EXECUTION_FINAL_ACTION_SQL, [
          lease.executionAttemptId,
          lease.leaseToken,
        ])
      ).rows,
    );
    requireIds(row, {
      depositIntentId: lease.depositIntentId,
      executionAttemptId: lease.executionAttemptId,
    });
    return {
      depositIntentId: lease.depositIntentId,
      executionAttemptId: lease.executionAttemptId,
      finalActionFencedAt: date(row.final_action_fenced_at),
      firstFenceAcquired: exactBoolean(row.first_fence_acquired),
    };
  }

  async requireReconciliation(
    lease: KemerBetDepositExecutionLease,
    exactPlayerCreditMatch: boolean,
  ): Promise<KemerBetDepositReconciliationRequiredRecord> {
    if (typeof exactPlayerCreditMatch !== 'boolean') fail();
    const row = oneRow(
      (
        await this.#database.query(REQUIRE_DEPOSIT_EXECUTION_RECONCILIATION_SQL, [
          lease.executionAttemptId,
          lease.leaseToken,
          exactPlayerCreditMatch,
        ])
      ).rows,
    );
    requireIds(row, {
      depositIntentId: lease.depositIntentId,
      executionAttemptId: lease.executionAttemptId,
    });
    if (
      row.attempt_status !== 'reconciliation_required' ||
      row.deposit_status !== 'execution_reconciliation'
    ) {
      return fail();
    }
    return {
      depositIntentId: lease.depositIntentId,
      executionAttemptId: lease.executionAttemptId,
      reconciliationJobId: uuid(row.reconciliation_job_id),
      attemptStatus: 'reconciliation_required',
      depositStatus: 'execution_reconciliation',
      recoveryHandoff: exactBoolean(row.recovery_handoff),
    };
  }

  async leaseNextReconciliation(
    workerInstanceId: string,
    leaseSeconds: number,
  ): Promise<KemerBetDepositReconciliationLease | null> {
    leaseRequest(workerInstanceId, leaseSeconds);
    const rows = (
      await this.#database.query(LEASE_NEXT_DEPOSIT_EXECUTION_RECONCILIATION_SQL, [
        workerInstanceId,
        leaseSeconds,
      ])
    ).rows;
    if (rows.length === 0) return null;
    const row = oneRow(rows);
    const finalActionFencedAt = date(row.final_action_fenced_at);
    const reconciliationRequiredAt = date(row.reconciliation_required_at);
    const leaseExpiresAt = date(row.lease_expires_at);
    if (
      finalActionFencedAt.getTime() > reconciliationRequiredAt.getTime() ||
      reconciliationRequiredAt.getTime() >= leaseExpiresAt.getTime()
    ) {
      return fail();
    }
    return {
      phase: 'reconcile',
      depositIntentId: uuid(row.deposit_intent_id),
      reconciliationJobId: uuid(row.reconciliation_job_id),
      executionAttemptId: uuid(row.execution_attempt_id),
      platformAgentAccountId: uuid(row.platform_agent_account_id),
      target: targetFromRow(row),
      leaseToken: uuid(row.lease_token),
      leaseExpiresAt,
      recovery: {
        finalActionFencedAt,
        reconciliationRequiredAt,
        exactPlayerCreditMatch: nullableBoolean(row.exact_player_credit_match),
      },
    };
  }

  async recordReconciliation(
    lease: KemerBetDepositReconciliationLease,
    observation: KemerBetDepositPageObservation,
  ): Promise<KemerBetDepositReconciliationRecord> {
    const evidence = observation.evidence;
    const row = oneRow(
      (
        await this.#database.query(RECORD_DEPOSIT_EXECUTION_RECONCILIATION_SQL, [
          lease.reconciliationJobId,
          lease.leaseToken,
          observation.observation,
          evidence?.keyedExternalReferenceFingerprint ?? null,
          evidence?.approvedHistoryMatchCount ?? null,
          evidence?.normalizedOperationType ?? null,
          evidence?.matchedHistoryOccurredAt ?? null,
          lease.recovery.exactPlayerCreditMatch,
          evidence?.exactPlayerMatch ?? null,
          evidence?.exactAmountMatch ?? null,
          evidence?.exactCurrencyMatch ?? null,
        ])
      ).rows,
    );
    requireIds(row, lease);

    const outcome = row.outcome;
    const reasonCode = row.reason_code;
    const attemptStatus = row.attempt_status;
    const depositStatus = row.deposit_status;
    const followUpJobId = nullableUuid(row.follow_up_job_id);
    const isConfirmed =
      outcome === 'confirmed_executed' &&
      reasonCode === 'agent_deposit_history_in_window_and_player_credit_confirmed' &&
      attemptStatus === 'confirmed_executed' &&
      depositStatus === 'executed' &&
      followUpJobId === null;
    const isAmbiguous =
      outcome === 'ambiguous' &&
      reasonCode === 'agent_history_ambiguous' &&
      attemptStatus === 'review_required' &&
      depositStatus === 'execution_review' &&
      followUpJobId === null;
    const isNotObserved =
      outcome === 'not_observed' &&
      reasonCode === 'agent_history_not_observed' &&
      attemptStatus === 'reconciliation_required' &&
      depositStatus === 'execution_reconciliation' &&
      followUpJobId !== null;
    if (!isConfirmed && !isAmbiguous && !isNotObserved) return fail();

    return {
      depositIntentId: lease.depositIntentId,
      reconciliationJobId: lease.reconciliationJobId,
      executionAttemptId: lease.executionAttemptId,
      reconciliationId: uuid(row.reconciliation_id),
      outcome,
      reasonCode,
      attemptStatus,
      depositStatus,
      followUpJobId,
    } as KemerBetDepositReconciliationRecord;
  }
}
