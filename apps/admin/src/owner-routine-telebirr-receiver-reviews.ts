export interface OwnerRoutineTelebirrReceiverReviewDatabase {
  query(
    sql: string,
    values: readonly (number | string | null)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerRoutineTelebirrReceiverReview {
  readonly caseId: string;
  readonly playerId: string;
  readonly referenceMasked: string;
  readonly instructedReceiverMasked: string;
  readonly candidateReceiverMasked: string;
  readonly submittedAt: string;
  readonly recordedAt: string;
  readonly reasonCode: 'receiver_changed_during_instruction';
}

export class OwnerRoutineTelebirrReceiverReviewRejectedError extends Error {
  constructor() {
    super('The Owner TeleBirr receiver-review request was rejected.');
    this.name = 'OwnerRoutineTelebirrReceiverReviewRejectedError';
  }
}

export class OwnerRoutineTelebirrReceiverReviewUnavailableError extends Error {
  constructor() {
    super('The Owner TeleBirr receiver-review queue is unavailable.');
    this.name = 'OwnerRoutineTelebirrReceiverReviewUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLAYER_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,64}$/u;
const MASKED_REFERENCE_PATTERN = /^\*{3}[A-Z0-9]{4}$/u;
const MASKED_RECEIVER_PATTERN = /^\*{3,}[A-Za-z0-9._-]{2,16}$/u;
const LIST_SQL = `
  select case_id, player_id, reference_masked,
         instructed_receiver_masked, candidate_receiver_masked,
         submitted_at, recorded_at, reason_code
  from app.list_owner_routine_telebirr_receiver_change_reviews($1::uuid, $2::integer, $3::uuid)
`;

function rowObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerRoutineTelebirrReceiverReviewUnavailableError();
  }
  return value as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerRoutineTelebirrReceiverReviewUnavailableError();
  }
  return value.toISOString();
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

export class PostgresOwnerRoutineTelebirrReceiverReviews {
  constructor(private readonly database: OwnerRoutineTelebirrReceiverReviewDatabase) {}

  async list(
    authUserId: string,
    limit = 25,
    beforeCaseId?: string,
  ): Promise<readonly OwnerRoutineTelebirrReceiverReview[]> {
    if (
      !UUID_PATTERN.test(authUserId) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (beforeCaseId !== undefined && !UUID_PATTERN.test(beforeCaseId))
    ) {
      throw new OwnerRoutineTelebirrReceiverReviewRejectedError();
    }
    try {
      const result = await this.database.query(LIST_SQL, [authUserId, limit, beforeCaseId ?? null]);
      if (result.rows.length > limit)
        throw new OwnerRoutineTelebirrReceiverReviewUnavailableError();
      return result.rows.map((rawRow) => {
        const row = rowObject(rawRow);
        if (
          typeof row.case_id !== 'string' ||
          !UUID_PATTERN.test(row.case_id) ||
          typeof row.player_id !== 'string' ||
          !PLAYER_ID_PATTERN.test(row.player_id) ||
          typeof row.reference_masked !== 'string' ||
          !MASKED_REFERENCE_PATTERN.test(row.reference_masked) ||
          typeof row.instructed_receiver_masked !== 'string' ||
          !MASKED_RECEIVER_PATTERN.test(row.instructed_receiver_masked) ||
          typeof row.candidate_receiver_masked !== 'string' ||
          !MASKED_RECEIVER_PATTERN.test(row.candidate_receiver_masked) ||
          row.reason_code !== 'receiver_changed_during_instruction'
        ) {
          throw new OwnerRoutineTelebirrReceiverReviewUnavailableError();
        }
        return {
          caseId: row.case_id,
          playerId: row.player_id,
          referenceMasked: row.reference_masked,
          instructedReceiverMasked: row.instructed_receiver_masked,
          candidateReceiverMasked: row.candidate_receiver_masked,
          submittedAt: isoDate(row.submitted_at),
          recordedAt: isoDate(row.recorded_at),
          reasonCode: 'receiver_changed_during_instruction' as const,
        };
      });
    } catch (error) {
      if (error instanceof OwnerRoutineTelebirrReceiverReviewUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerRoutineTelebirrReceiverReviewRejectedError();
      }
      throw new OwnerRoutineTelebirrReceiverReviewUnavailableError();
    }
  }
}
