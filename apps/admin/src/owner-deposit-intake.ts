export interface OwnerDepositIntakeDatabase {
  query(
    sql: string,
    values: readonly (number | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerDryRunDepositIntakeItem {
  readonly amountMinor: string;
  readonly currencyCode: 'ETB';
  readonly depositIntentId: string;
  readonly depositStatus: 'intake_received';
  readonly openedAt: string;
  readonly paymentDeadline: string;
  readonly playerId: string;
  readonly providerCode: 'cbe_birr';
  readonly receiverAccountMasked: string;
  readonly submissionStatus?: 'received';
  readonly submittedAt?: string;
  readonly submittedReferenceMasked?: string;
}

export class OwnerDepositIntakeRejectedError extends Error {
  constructor() {
    super('The Owner deposit-intake request was rejected.');
    this.name = 'OwnerDepositIntakeRejectedError';
  }
}

export class OwnerDepositIntakeUnavailableError extends Error {
  constructor() {
    super('The Owner deposit-intake queue is unavailable.');
    this.name = 'OwnerDepositIntakeUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_PLAYER_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,64}$/u;
const MASKED_ACCOUNT_PATTERN = /^\*{3,}[A-Za-z0-9._-]{2,16}$/u;
const MASKED_REFERENCE_PATTERN = /^\*{3}[A-Z0-9._-]{4}$/u;
const LIST_SQL = `
  select deposit_intent_id, player_id, expected_amount_minor, currency_code,
         provider_code, receiver_account_masked, deposit_status, opened_at,
         payment_deadline_at, submitted_reference_masked, submission_status, submitted_at
  from app.list_owner_dry_run_deposit_intake($1::uuid, $2::integer)
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function rowObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OwnerDepositIntakeUnavailableError();
  }
  return value as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerDepositIntakeUnavailableError();
  }
  return value.toISOString();
}

export class PostgresOwnerDryRunDepositIntake {
  constructor(private readonly database: OwnerDepositIntakeDatabase) {}

  async list(authUserId: string, limit = 25): Promise<readonly OwnerDryRunDepositIntakeItem[]> {
    if (!UUID_PATTERN.test(authUserId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new OwnerDepositIntakeRejectedError();
    }
    try {
      const result = await this.database.query(LIST_SQL, [authUserId, limit]);
      if (result.rows.length > limit) throw new OwnerDepositIntakeUnavailableError();
      return result.rows.map((rawRow) => {
        const row = rowObject(rawRow);
        const submissionAbsent =
          row.submitted_reference_masked === null &&
          row.submission_status === null &&
          row.submitted_at === null;
        const submissionPresent =
          typeof row.submitted_reference_masked === 'string' &&
          MASKED_REFERENCE_PATTERN.test(row.submitted_reference_masked) &&
          row.submission_status === 'received' &&
          row.submitted_at instanceof Date;
        if (
          typeof row.deposit_intent_id !== 'string' ||
          !UUID_PATTERN.test(row.deposit_intent_id) ||
          typeof row.player_id !== 'string' ||
          !SAFE_PLAYER_ID_PATTERN.test(row.player_id) ||
          typeof row.expected_amount_minor !== 'string' ||
          !/^[1-9][0-9]*$/u.test(row.expected_amount_minor) ||
          row.currency_code !== 'ETB' ||
          row.provider_code !== 'cbe_birr' ||
          typeof row.receiver_account_masked !== 'string' ||
          !MASKED_ACCOUNT_PATTERN.test(row.receiver_account_masked) ||
          row.deposit_status !== 'intake_received' ||
          !(submissionAbsent || submissionPresent)
        ) {
          throw new OwnerDepositIntakeUnavailableError();
        }
        return {
          amountMinor: row.expected_amount_minor,
          currencyCode: 'ETB' as const,
          depositIntentId: row.deposit_intent_id,
          depositStatus: 'intake_received' as const,
          openedAt: isoDate(row.opened_at),
          paymentDeadline: isoDate(row.payment_deadline_at),
          playerId: row.player_id,
          providerCode: 'cbe_birr' as const,
          receiverAccountMasked: row.receiver_account_masked,
          ...(submissionPresent
            ? {
                submissionStatus: 'received' as const,
                submittedAt: isoDate(row.submitted_at),
                submittedReferenceMasked: row.submitted_reference_masked as string,
              }
            : {}),
        };
      });
    } catch (error) {
      if (error instanceof OwnerDepositIntakeUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') throw new OwnerDepositIntakeRejectedError();
      throw new OwnerDepositIntakeUnavailableError();
    }
  }
}
