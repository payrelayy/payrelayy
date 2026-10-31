import { OwnerAuthenticationRejectedError } from './owner-auth.js';

export interface OwnerBrowserSession {
  readonly absoluteExpiresAt: string;
  readonly idleExpiresAt: string;
}

export class OwnerBrowserSessionUnavailableError extends Error {
  constructor() {
    super('Owner browser session is unavailable.');
    this.name = 'OwnerBrowserSessionUnavailableError';
  }
}

export const OWNER_BROWSER_SESSION_SQL =
  'select app.owner_browser_session($1::uuid, $2::uuid, $3::text) as session';

function sessionFromRow(rows: readonly unknown[]): OwnerBrowserSession {
  const row = rows.length === 1 ? rows[0] : undefined;
  const value =
    row && typeof row === 'object' && !Array.isArray(row) && 'session' in row
      ? row.session
      : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnerBrowserSessionUnavailableError();
  }
  const session = value as Record<string, unknown>;
  if (
    typeof session.idleExpiresAt !== 'string' ||
    typeof session.absoluteExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(session.idleExpiresAt)) ||
    !Number.isFinite(Date.parse(session.absoluteExpiresAt))
  ) {
    throw new OwnerBrowserSessionUnavailableError();
  }
  return {
    absoluteExpiresAt: session.absoluteExpiresAt,
    idleExpiresAt: session.idleExpiresAt,
  };
}

export class PostgresOwnerBrowserSessions {
  constructor(
    private readonly database: {
      query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
    },
  ) {}

  async run(
    authUserId: string,
    sessionId: string,
    action: 'start' | 'check' | 'touch',
  ): Promise<OwnerBrowserSession> {
    try {
      const result = await this.database.query(OWNER_BROWSER_SESSION_SQL, [
        authUserId,
        sessionId,
        action,
      ]);
      return sessionFromRow(result.rows);
    } catch (error) {
      if (error instanceof OwnerAuthenticationRejectedError) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
        throw new OwnerAuthenticationRejectedError();
      }
      throw new OwnerBrowserSessionUnavailableError();
    }
  }
}
