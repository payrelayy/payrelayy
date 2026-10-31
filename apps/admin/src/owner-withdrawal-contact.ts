import { normalizeSupportUsername } from './owner-support-contact.js';

export interface OwnerWithdrawalContact {
  readonly telegramUsername: string | null;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export class OwnerWithdrawalContactRejectedError extends Error {}
export class OwnerWithdrawalContactInvalidError extends Error {}
export class OwnerWithdrawalContactConflictError extends Error {}
export class OwnerWithdrawalContactUnavailableError extends Error {}

export const OWNER_WITHDRAWAL_CONTACT_SQL = {
  get: 'select telegram_username, revision, updated_at from app.get_owner_withdrawal_contact($1::uuid)',
  set: 'select telegram_username, revision, updated_at from app.set_owner_withdrawal_contact($1::uuid, $2::text, $3::integer)',
  public: 'select telegram_username from app.get_public_withdrawal_contact()',
} as const;

function validateActor(authUserId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(authUserId)
  ) {
    throw new OwnerWithdrawalContactRejectedError();
  }
}

function singleRow(rows: readonly unknown[], keys: string): Record<string, unknown> {
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    Object.keys(row).sort().join(',') !== keys
  )
    throw new OwnerWithdrawalContactUnavailableError();
  return row as Record<string, unknown>;
}

function storedUsername(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-z0-9_]{5,32}$/u.test(value)) {
    throw new OwnerWithdrawalContactUnavailableError();
  }
  return value;
}

function ownerContact(rows: readonly unknown[]): OwnerWithdrawalContact {
  const row = singleRow(rows, 'revision,telegram_username,updated_at');
  const telegramUsername = storedUsername(row.telegram_username);
  if (
    typeof row.revision !== 'number' ||
    !Number.isInteger(row.revision) ||
    row.revision < 0 ||
    row.revision > 2_147_483_647
  )
    throw new OwnerWithdrawalContactUnavailableError();
  const updatedAt =
    row.updated_at === null
      ? null
      : row.updated_at instanceof Date && Number.isFinite(row.updated_at.getTime())
        ? row.updated_at.toISOString()
        : undefined;
  if (
    updatedAt === undefined ||
    (row.revision === 0 && updatedAt !== null) ||
    (row.revision > 0 && updatedAt === null)
  )
    throw new OwnerWithdrawalContactUnavailableError();
  return { telegramUsername, revision: row.revision, updatedAt };
}

function databaseError(error: unknown): never {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === '42501') throw new OwnerWithdrawalContactRejectedError();
  if (code === '22023') throw new OwnerWithdrawalContactInvalidError();
  if (code === '40001') throw new OwnerWithdrawalContactConflictError();
  throw new OwnerWithdrawalContactUnavailableError();
}

export class PostgresOwnerWithdrawalContact {
  constructor(
    private readonly database: {
      query(
        sql: string,
        values: readonly (string | number | null)[],
      ): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async get(authUserId: string): Promise<OwnerWithdrawalContact> {
    validateActor(authUserId);
    try {
      return ownerContact(
        (await this.database.query(OWNER_WITHDRAWAL_CONTACT_SQL.get, [authUserId])).rows,
      );
    } catch (error) {
      return databaseError(error);
    }
  }

  async set(
    authUserId: string,
    username: unknown,
    expectedRevision: number,
  ): Promise<OwnerWithdrawalContact> {
    validateActor(authUserId);
    const normalized = normalizeSupportUsername(username);
    if (
      normalized === undefined ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= 2_147_483_647
    )
      throw new OwnerWithdrawalContactInvalidError();
    try {
      return ownerContact(
        (
          await this.database.query(OWNER_WITHDRAWAL_CONTACT_SQL.set, [
            authUserId,
            normalized,
            expectedRevision,
          ])
        ).rows,
      );
    } catch (error) {
      return databaseError(error);
    }
  }

  async publicContact(): Promise<{ readonly telegramUsername: string | null }> {
    try {
      const row = singleRow(
        (await this.database.query(OWNER_WITHDRAWAL_CONTACT_SQL.public, [])).rows,
        'telegram_username',
      );
      return { telegramUsername: storedUsername(row.telegram_username) };
    } catch {
      throw new OwnerWithdrawalContactUnavailableError();
    }
  }
}
