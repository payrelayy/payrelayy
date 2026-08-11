export type OwnerPlayerRegistrationDecision =
  'exists' | 'not_found' | 'review_required' | 'cancelled';

export type OwnerPlayerRegistrationReason =
  'owner_platform_lookup' | 'provider_evidence_required' | 'owner_cancelled';

export interface OwnerPlayerRegistrationDatabase {
  query(
    sql: string,
    values: readonly (number | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerPlayerRegistrationRequest {
  readonly createdAt: string;
  readonly playerId: string;
  readonly platformCode: 'kemerbet';
  readonly requestId: string;
  readonly status: 'pending_validation' | 'review_required';
  readonly updatedAt: string;
}

export interface OwnerPlayerRegistrationReviewReceipt {
  readonly alreadyRecorded: boolean;
  readonly requestId: string;
  readonly reviewedAt: string;
  readonly status: OwnerPlayerRegistrationDecision;
}

export class OwnerPlayerRegistrationReviewRejectedError extends Error {
  constructor() {
    super('The Owner Player ID review operation was rejected.');
    this.name = 'OwnerPlayerRegistrationReviewRejectedError';
  }
}

export class OwnerPlayerRegistrationReviewUnavailableError extends Error {
  constructor() {
    super('The Owner Player ID review operation is unavailable.');
    this.name = 'OwnerPlayerRegistrationReviewUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLAYER_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,64}$/u;
const LIST_SQL = `
  select registration_request_id,
         platform_code,
         submitted_player_id,
         request_status,
         request_created_at,
         request_updated_at
  from app.list_owner_player_registration_requests($1::uuid, $2::integer)
`;
const REVIEW_SQL = `
  select reviewed_registration_request_id,
         reviewed_status,
         reviewed_at,
         decision_already_recorded
  from app.review_owner_player_registration_request($1::uuid, $2::uuid, $3::text, $4::text)
`;

const REVIEW_REASONS: Readonly<
  Record<OwnerPlayerRegistrationDecision, OwnerPlayerRegistrationReason>
> = {
  cancelled: 'owner_cancelled',
  exists: 'owner_platform_lookup',
  not_found: 'owner_platform_lookup',
  review_required: 'provider_evidence_required',
};

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new OwnerPlayerRegistrationReviewUnavailableError();
  }
  return row as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerPlayerRegistrationReviewUnavailableError();
  }
  return value.toISOString();
}

export class PostgresOwnerPlayerRegistrationReviews {
  constructor(private readonly database: OwnerPlayerRegistrationDatabase) {}

  async list(authUserId: string, limit = 25): Promise<readonly OwnerPlayerRegistrationRequest[]> {
    if (!UUID_PATTERN.test(authUserId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new OwnerPlayerRegistrationReviewRejectedError();
    }

    try {
      const result = await this.database.query(LIST_SQL, [authUserId, limit]);
      if (result.rows.length > limit) throw new OwnerPlayerRegistrationReviewUnavailableError();
      return result.rows.map((rawRow) => {
        const row = rowObject(rawRow);
        const requestId = row.registration_request_id;
        const platformCode = row.platform_code;
        const playerId = row.submitted_player_id;
        const status = row.request_status;
        if (
          typeof requestId !== 'string' ||
          !UUID_PATTERN.test(requestId) ||
          platformCode !== 'kemerbet' ||
          typeof playerId !== 'string' ||
          !PLAYER_ID_PATTERN.test(playerId) ||
          (status !== 'pending_validation' && status !== 'review_required')
        ) {
          throw new OwnerPlayerRegistrationReviewUnavailableError();
        }
        return {
          createdAt: isoDate(row.request_created_at),
          playerId,
          platformCode,
          requestId,
          status,
          updatedAt: isoDate(row.request_updated_at),
        };
      });
    } catch (error) {
      if (error instanceof OwnerPlayerRegistrationReviewUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerPlayerRegistrationReviewRejectedError();
      }
      throw new OwnerPlayerRegistrationReviewUnavailableError();
    }
  }

  async review(
    authUserId: string,
    requestId: string,
    decision: OwnerPlayerRegistrationDecision,
  ): Promise<OwnerPlayerRegistrationReviewReceipt> {
    if (
      !UUID_PATTERN.test(authUserId) ||
      !UUID_PATTERN.test(requestId) ||
      !(decision in REVIEW_REASONS)
    ) {
      throw new OwnerPlayerRegistrationReviewRejectedError();
    }

    try {
      const result = await this.database.query(REVIEW_SQL, [
        authUserId,
        requestId,
        decision,
        REVIEW_REASONS[decision],
      ]);
      const row = result.rows.length === 1 ? rowObject(result.rows[0]) : undefined;
      if (
        !row ||
        row.reviewed_registration_request_id !== requestId ||
        row.reviewed_status !== decision ||
        typeof row.decision_already_recorded !== 'boolean'
      ) {
        throw new OwnerPlayerRegistrationReviewUnavailableError();
      }
      return {
        alreadyRecorded: row.decision_already_recorded,
        requestId,
        reviewedAt: isoDate(row.reviewed_at),
        status: decision,
      };
    } catch (error) {
      if (error instanceof OwnerPlayerRegistrationReviewUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerPlayerRegistrationReviewRejectedError();
      }
      throw new OwnerPlayerRegistrationReviewUnavailableError();
    }
  }
}
