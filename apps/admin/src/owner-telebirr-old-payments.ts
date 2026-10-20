export interface OwnerOldPaymentDatabase {
  query(
    sql: string,
    values: readonly (string | number)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerOldPaymentPending {
  readonly candidateId: string;
  readonly submittedAt: string;
  readonly paymentAt: string;
  readonly amountMinor: string;
  readonly referenceMasked: string;
  readonly playerMasked: string;
}

export interface OwnerOldPaymentDecision {
  readonly decision: 'approved' | 'rejected';
  readonly decidedAt: string;
  readonly depositIntentId?: string;
  readonly executionJobId?: string;
}

export class OwnerOldPaymentRejectedError extends Error {}
export class OwnerOldPaymentConflictError extends Error {}
export class OwnerOldPaymentUnavailableError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MASKED_REFERENCE = /^\*{3}[A-Z0-9]{4}$/u;
const MASKED_PLAYER = /^\*{3}[^\s\u0000-\u001f\u007f]{1,4}$/u;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new OwnerOldPaymentUnavailableError();
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new OwnerOldPaymentUnavailableError();
  return value.toISOString();
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

export class PostgresOwnerTelebirrOldPayments {
  constructor(private readonly database: OwnerOldPaymentDatabase) {}

  async list(authUserId: string, limit = 25): Promise<readonly OwnerOldPaymentPending[]> {
    if (!UUID.test(authUserId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new OwnerOldPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select candidate_id, submitted_at, payment_at, amount_minor::text as amount_minor,
                reference_masked, player_masked
           from app.list_owner_routine_telebirr_old_payments($1::uuid,$2::integer)`,
        [authUserId, limit],
      );
      if (result.rows.length > limit) throw new OwnerOldPaymentUnavailableError();
      return result.rows.map((raw) => {
        const row = object(raw);
        if (
          typeof row.candidate_id !== 'string' ||
          !UUID.test(row.candidate_id) ||
          typeof row.amount_minor !== 'string' ||
          !/^[1-9][0-9]*$/u.test(row.amount_minor) ||
          typeof row.reference_masked !== 'string' ||
          !MASKED_REFERENCE.test(row.reference_masked) ||
          typeof row.player_masked !== 'string' ||
          !MASKED_PLAYER.test(row.player_masked)
        )
          throw new OwnerOldPaymentUnavailableError();
        return {
          candidateId: row.candidate_id,
          submittedAt: timestamp(row.submitted_at),
          paymentAt: timestamp(row.payment_at),
          amountMinor: row.amount_minor,
          referenceMasked: row.reference_masked,
          playerMasked: row.player_masked,
        };
      });
    } catch (error) {
      if (error instanceof OwnerOldPaymentUnavailableError) throw error;
      if (errorCode(error) === '42501') throw new OwnerOldPaymentRejectedError();
      throw new OwnerOldPaymentUnavailableError();
    }
  }

  async decide(
    authUserId: string,
    candidateId: string,
    action: 'approve' | 'reject',
  ): Promise<OwnerOldPaymentDecision> {
    if (
      !UUID.test(authUserId) ||
      !UUID.test(candidateId) ||
      (action !== 'approve' && action !== 'reject')
    )
      throw new OwnerOldPaymentRejectedError();
    try {
      const result = await this.database.query(
        `select app.decide_owner_routine_telebirr_old_payment(
          $1::uuid,$2::uuid,$3::text) as decision`,
        [authUserId, candidateId, action],
      );
      if (result.rows.length !== 1) throw new OwnerOldPaymentUnavailableError();
      const data = object(object(result.rows[0]).decision);
      if (
        (data.decision !== 'approved' && data.decision !== 'rejected') ||
        typeof data.decidedAt !== 'string' ||
        Number.isNaN(Date.parse(data.decidedAt))
      )
        throw new OwnerOldPaymentUnavailableError();
      if (data.decision === 'approved') {
        if (
          typeof data.depositIntentId !== 'string' ||
          !UUID.test(data.depositIntentId) ||
          typeof data.executionJobId !== 'string' ||
          !UUID.test(data.executionJobId)
        )
          throw new OwnerOldPaymentUnavailableError();
        return {
          decision: 'approved',
          decidedAt: data.decidedAt,
          depositIntentId: data.depositIntentId,
          executionJobId: data.executionJobId,
        };
      }
      if ('depositIntentId' in data || 'executionJobId' in data)
        throw new OwnerOldPaymentUnavailableError();
      return { decision: 'rejected', decidedAt: data.decidedAt };
    } catch (error) {
      if (error instanceof OwnerOldPaymentUnavailableError) throw error;
      if (errorCode(error) === '42501') throw new OwnerOldPaymentRejectedError();
      if (errorCode(error) === 'P0001' || errorCode(error) === '23505')
        throw new OwnerOldPaymentConflictError();
      throw new OwnerOldPaymentUnavailableError();
    }
  }
}
