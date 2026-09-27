export interface OwnerExecutionApprovalDatabase {
  query(
    sql: string,
    values: readonly (number | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerPendingTelebirrExecution {
  readonly executionJobId: string;
  readonly playerId: string;
  readonly amountMinor: string;
  readonly currencyCode: 'ETB';
  readonly queuedAt: string;
  readonly verifiedAt: string;
  readonly approvedAt?: string;
  readonly approvalExpiresAt?: string;
}

export interface OwnerExecutionApprovalReceipt {
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly alreadyApproved: boolean;
}

export class OwnerExecutionApprovalRejectedError extends Error {
  constructor() {
    super('The Owner execution approval request was rejected.');
    this.name = 'OwnerExecutionApprovalRejectedError';
  }
}

export class OwnerExecutionApprovalConflictError extends Error {
  constructor() {
    super('The selected deposit is not ready for approval.');
    this.name = 'OwnerExecutionApprovalConflictError';
  }
}

export class OwnerExecutionApprovalUnavailableError extends Error {
  constructor() {
    super('The Owner execution approval queue is unavailable.');
    this.name = 'OwnerExecutionApprovalUnavailableError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLAYER_ID = /^[^\s\u0000-\u001f\u007f]{1,64}$/u;

const LIST_SQL = `
  select execution_job_id, player_id, amount_minor, currency_code,
         queued_at, verified_at, approved_at, approval_expires_at
    from app.list_owner_pending_telebirr_executions($1::uuid, $2::integer)
`;
const APPROVE_SQL = `
  select app.approve_owner_telebirr_execution($1::uuid, $2::uuid, $3::uuid) as approval
`;

function databaseCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerExecutionApprovalUnavailableError();
  }
  return value as Record<string, unknown>;
}

function dateValue(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerExecutionApprovalUnavailableError();
  }
  return value.toISOString();
}

export class PostgresOwnerTelebirrExecutionApprovals {
  constructor(private readonly database: OwnerExecutionApprovalDatabase) {}

  async list(authUserId: string, limit = 25): Promise<readonly OwnerPendingTelebirrExecution[]> {
    if (!UUID.test(authUserId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw new OwnerExecutionApprovalRejectedError();
    }
    try {
      const result = await this.database.query(LIST_SQL, [authUserId, limit]);
      if (result.rows.length > limit) throw new OwnerExecutionApprovalUnavailableError();
      return result.rows.map((raw) => {
        const row = record(raw);
        const unapproved = row.approved_at === null && row.approval_expires_at === null;
        const approved = row.approved_at instanceof Date && row.approval_expires_at instanceof Date;
        if (
          typeof row.execution_job_id !== 'string' ||
          !UUID.test(row.execution_job_id) ||
          typeof row.player_id !== 'string' ||
          !PLAYER_ID.test(row.player_id) ||
          typeof row.amount_minor !== 'string' ||
          !/^[1-9][0-9]*$/u.test(row.amount_minor) ||
          row.currency_code !== 'ETB' ||
          !(unapproved || approved)
        ) {
          throw new OwnerExecutionApprovalUnavailableError();
        }
        return {
          executionJobId: row.execution_job_id,
          playerId: row.player_id,
          amountMinor: row.amount_minor,
          currencyCode: 'ETB' as const,
          queuedAt: dateValue(row.queued_at),
          verifiedAt: dateValue(row.verified_at),
          ...(approved
            ? {
                approvedAt: dateValue(row.approved_at),
                approvalExpiresAt: dateValue(row.approval_expires_at),
              }
            : {}),
        };
      });
    } catch (error) {
      if (error instanceof OwnerExecutionApprovalUnavailableError) throw error;
      if (databaseCode(error) === '42501') throw new OwnerExecutionApprovalRejectedError();
      throw new OwnerExecutionApprovalUnavailableError();
    }
  }

  async approve(
    authUserId: string,
    executionJobId: string,
    requestKey: string,
  ): Promise<OwnerExecutionApprovalReceipt> {
    if (!UUID.test(authUserId) || !UUID.test(executionJobId) || !REQUEST_UUID.test(requestKey)) {
      throw new OwnerExecutionApprovalRejectedError();
    }
    try {
      const result = await this.database.query(APPROVE_SQL, [
        authUserId,
        executionJobId,
        requestKey,
      ]);
      if (result.rows.length !== 1) throw new OwnerExecutionApprovalUnavailableError();
      const approval = record(record(result.rows[0]).approval);
      if (
        Object.keys(approval).sort().join(',') !== 'alreadyApproved,approvedAt,expiresAt' ||
        typeof approval.approvedAt !== 'string' ||
        !Number.isFinite(Date.parse(approval.approvedAt)) ||
        typeof approval.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(approval.expiresAt)) ||
        typeof approval.alreadyApproved !== 'boolean'
      ) {
        throw new OwnerExecutionApprovalUnavailableError();
      }
      return {
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        alreadyApproved: approval.alreadyApproved,
      };
    } catch (error) {
      if (error instanceof OwnerExecutionApprovalUnavailableError) throw error;
      if (databaseCode(error) === '42501') throw new OwnerExecutionApprovalRejectedError();
      if (databaseCode(error) === 'P0001') throw new OwnerExecutionApprovalConflictError();
      throw new OwnerExecutionApprovalUnavailableError();
    }
  }
}
