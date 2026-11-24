export interface OwnerPlatformPlayDestination {
  readonly platformCode: string;
  readonly destinationUrl: string | null;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export class OwnerPlatformPlayRejectedError extends Error {}
export class OwnerPlatformPlayInvalidError extends Error {}
export class OwnerPlatformPlayConflictError extends Error {}
export class OwnerPlatformPlayUnavailableError extends Error {}

export const OWNER_PLATFORM_PLAY_SQL = {
  get: 'select platform_code, destination_url, revision, updated_at from app.get_owner_platform_play_destination($1::uuid, $2::text)',
  set: 'select platform_code, destination_url, revision, updated_at from app.set_owner_platform_play_destination($1::uuid, $2::text, $3::text, $4::integer)',
  public: 'select destination_url from app.get_public_platform_play_destination($1::text)',
} as const;

const PLATFORM_CODE = /^[a-z0-9_]{1,64}$/u;
const AUTH_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Only an Owner-saved public HTTPS website can become a Telegram redirect. */
export function normalizePlatformPlayUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value !== value.trim() || /[\x00-\x20\x7f\\]/u.test(value))
    return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== '' ||
      url.port !== '' ||
      url.hostname.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(url.hostname) ||
      !url.hostname.includes('.') ||
      url.hostname.includes('..') ||
      /^\d+(?:\.\d+){3}$/u.test(url.hostname) ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === 'fetanagent.com' ||
      url.hostname.endsWith('.fetanagent.com') ||
      url.href.length > 2048
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
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
    throw new OwnerPlatformPlayUnavailableError();
  return row as Record<string, unknown>;
}

function parseStoredUrl(value: unknown): string | null {
  const normalized = normalizePlatformPlayUrl(value);
  if (normalized === undefined || normalized !== value)
    throw new OwnerPlatformPlayUnavailableError();
  return normalized;
}

function parseOwnerDestination(rows: readonly unknown[]): OwnerPlatformPlayDestination {
  const row = singleRow(rows, 'destination_url,platform_code,revision,updated_at');
  if (typeof row.platform_code !== 'string' || !PLATFORM_CODE.test(row.platform_code))
    throw new OwnerPlatformPlayUnavailableError();
  if (
    typeof row.revision !== 'number' ||
    !Number.isInteger(row.revision) ||
    row.revision < 0 ||
    row.revision > 2_147_483_647
  )
    throw new OwnerPlatformPlayUnavailableError();
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
    throw new OwnerPlatformPlayUnavailableError();
  return {
    platformCode: row.platform_code,
    destinationUrl: parseStoredUrl(row.destination_url),
    revision: row.revision,
    updatedAt,
  };
}

function databaseError(error: unknown): never {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === '42501') throw new OwnerPlatformPlayRejectedError();
  if (code === '22023') throw new OwnerPlatformPlayInvalidError();
  if (code === '40001') throw new OwnerPlatformPlayConflictError();
  throw new OwnerPlatformPlayUnavailableError();
}

export class PostgresOwnerPlatformPlayDestinations {
  constructor(
    private readonly database: {
      query(
        sql: string,
        values: readonly (string | number | null)[],
      ): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async get(authUserId: string, platformCode: string): Promise<OwnerPlatformPlayDestination> {
    if (!AUTH_USER_ID.test(authUserId)) throw new OwnerPlatformPlayRejectedError();
    if (!PLATFORM_CODE.test(platformCode)) throw new OwnerPlatformPlayInvalidError();
    try {
      return parseOwnerDestination(
        (await this.database.query(OWNER_PLATFORM_PLAY_SQL.get, [authUserId, platformCode])).rows,
      );
    } catch (error) {
      return databaseError(error);
    }
  }

  async set(
    authUserId: string,
    platformCode: string,
    destinationUrl: unknown,
    expectedRevision: number,
  ): Promise<OwnerPlatformPlayDestination> {
    if (!AUTH_USER_ID.test(authUserId)) throw new OwnerPlatformPlayRejectedError();
    const normalized = normalizePlatformPlayUrl(destinationUrl);
    if (
      !PLATFORM_CODE.test(platformCode) ||
      normalized === undefined ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= 2_147_483_647
    )
      throw new OwnerPlatformPlayInvalidError();
    try {
      return parseOwnerDestination(
        (
          await this.database.query(OWNER_PLATFORM_PLAY_SQL.set, [
            authUserId,
            platformCode,
            normalized,
            expectedRevision,
          ])
        ).rows,
      );
    } catch (error) {
      return databaseError(error);
    }
  }

  async publicDestination(platformCode: string): Promise<string | null> {
    if (!PLATFORM_CODE.test(platformCode)) throw new OwnerPlatformPlayInvalidError();
    try {
      const row = singleRow(
        (await this.database.query(OWNER_PLATFORM_PLAY_SQL.public, [platformCode])).rows,
        'destination_url',
      );
      return parseStoredUrl(row.destination_url);
    } catch {
      throw new OwnerPlatformPlayUnavailableError();
    }
  }
}
