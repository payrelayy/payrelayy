export interface OwnerSupportContact {
  readonly telegramUsername: string | null;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export class OwnerSupportContactRejectedError extends Error {}
export class OwnerSupportContactInvalidError extends Error {}
export class OwnerSupportContactConflictError extends Error {}
export class OwnerSupportContactUnavailableError extends Error {}

/** Accept a basic Telegram username, not a URL, phone number or arbitrary link. */
export function normalizeSupportUsername(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 100) return undefined;
  const input = value.trim();
  if (!input) return null;
  const username = input.replace(/^@/u, '');
  return /^[A-Za-z0-9_]{5,32}$/u.test(username) ? username.toLowerCase() : undefined;
}

export const OWNER_SUPPORT_CONTACT_SQL = {
  get: 'select telegram_username, revision, updated_at from app.get_owner_support_contact($1::uuid)',
  set: 'select telegram_username, revision, updated_at from app.set_owner_support_contact($1::uuid, $2::text, $3::integer)',
  public: 'select telegram_username from app.get_public_support_contact()',
} as const;

function validateActor(authUserId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(authUserId)
  ) {
    throw new OwnerSupportContactRejectedError();
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
    throw new OwnerSupportContactUnavailableError();
  return row as Record<string, unknown>;
}

function storedUsername(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-z0-9_]{5,32}$/u.test(value)) {
    throw new OwnerSupportContactUnavailableError();
  }
  return value;
}

function ownerContact(rows: readonly unknown[]): OwnerSupportContact {
  const row = singleRow(rows, 'revision,telegram_username,updated_at');
  const telegramUsername = storedUsername(row.telegram_username);
  if (
    typeof row.revision !== 'number' ||
    !Number.isInteger(row.revision) ||
    row.revision < 0 ||
    row.revision > 2_147_483_647
  )
    throw new OwnerSupportContactUnavailableError();
  const updatedAt =
    row.updated_at === null
      ? null
      : row.updated_at instanceof Date && Number.isFinite(row.updated_at.getTime())
        ? row.updated_at.toISOString()
        : undefined;
  if (
    updatedAt === undefined ||
    (row.revision === 0 && (telegramUsername !== null || updatedAt !== null)) ||
    (row.revision > 0 && updatedAt === null)
  )
    throw new OwnerSupportContactUnavailableError();
  return { telegramUsername, revision: row.revision, updatedAt };
}

function databaseError(error: unknown): never {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === '42501') throw new OwnerSupportContactRejectedError();
  if (code === '22023') throw new OwnerSupportContactInvalidError();
  if (code === '40001') throw new OwnerSupportContactConflictError();
  throw new OwnerSupportContactUnavailableError();
}

export class PostgresOwnerSupportContact {
  constructor(
    private readonly database: {
      query(
        sql: string,
        values: readonly (string | number | null)[],
      ): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async get(authUserId: string): Promise<OwnerSupportContact> {
    validateActor(authUserId);
    try {
      return ownerContact(
        (await this.database.query(OWNER_SUPPORT_CONTACT_SQL.get, [authUserId])).rows,
      );
    } catch (error) {
      return databaseError(error);
    }
  }

  async set(
    authUserId: string,
    username: unknown,
    expectedRevision: number,
  ): Promise<OwnerSupportContact> {
    validateActor(authUserId);
    const normalized = normalizeSupportUsername(username);
    if (
      normalized === undefined ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= 2_147_483_647
    )
      throw new OwnerSupportContactInvalidError();
    try {
      return ownerContact(
        (
          await this.database.query(OWNER_SUPPORT_CONTACT_SQL.set, [
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
        (await this.database.query(OWNER_SUPPORT_CONTACT_SQL.public, [])).rows,
        'telegram_username',
      );
      return { telegramUsername: storedUsername(row.telegram_username) };
    } catch {
      throw new OwnerSupportContactUnavailableError();
    }
  }
}
