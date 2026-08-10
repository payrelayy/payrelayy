import { createHash, randomBytes } from 'node:crypto';

import {
  TELEGRAM_BETA_INVITE_TOKEN_BYTES,
  isTelegramBetaInviteToken,
  telegramBetaInviteTokenDigestInput,
} from '@payreplayy/contracts';

export type BetaInviteRevocationReason = 'owner_cancelled' | 'security_rotation' | 'staging_reset';

export interface OwnerInviteDatabase {
  query(
    sql: string,
    values: readonly (string | Date)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface IssuedBetaInvite {
  readonly expiresAt: string;
  readonly inviteId: string;
  readonly inviteUrl: string;
}

export class OwnerInviteRejectedError extends Error {
  constructor() {
    super('The Owner invite operation was rejected.');
    this.name = 'OwnerInviteRejectedError';
  }
}

export class OwnerInviteUnavailableError extends Error {
  constructor() {
    super('The Owner invite operation is unavailable.');
    this.name = 'OwnerInviteUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISSUE_SQL = `
  select issued_invite_id, issued_expires_at
  from app.issue_telegram_beta_invite($1::uuid, $2::text, $3::timestamptz)
`;
const REVOKE_SQL = `
  select revoked_invite_id, revoked_at
  from app.revoke_telegram_beta_invite($1::uuid, $2::uuid, $3::text)
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function oneRow(rows: readonly unknown[]): Record<string, unknown> {
  const row = rows.length === 1 ? rows[0] : undefined;
  if (typeof row !== 'object' || row === null) throw new OwnerInviteUnavailableError();
  return row as Record<string, unknown>;
}

function inviteTokenDigest(token: string): string {
  return `sha256-v1:${createHash('sha256')
    .update(telegramBetaInviteTokenDigestInput(token), 'utf8')
    .digest('hex')}`;
}

export class PostgresOwnerInviteControl {
  constructor(private readonly database: OwnerInviteDatabase) {}

  async issue(authUserId: string, expiresAt: Date, botUsername: string): Promise<IssuedBetaInvite> {
    if (!UUID_PATTERN.test(authUserId) || !Number.isFinite(expiresAt.getTime())) {
      throw new OwnerInviteRejectedError();
    }
    const token = randomBytes(TELEGRAM_BETA_INVITE_TOKEN_BYTES).toString('base64url');
    if (!isTelegramBetaInviteToken(token)) throw new OwnerInviteUnavailableError();

    try {
      const result = await this.database.query(ISSUE_SQL, [
        authUserId,
        inviteTokenDigest(token),
        expiresAt,
      ]);
      const row = oneRow(result.rows);
      const inviteId = row.issued_invite_id;
      const issuedExpiresAt = row.issued_expires_at;
      if (
        typeof inviteId !== 'string' ||
        !UUID_PATTERN.test(inviteId) ||
        !(issuedExpiresAt instanceof Date) ||
        !Number.isFinite(issuedExpiresAt.getTime())
      ) {
        throw new OwnerInviteUnavailableError();
      }
      return {
        expiresAt: issuedExpiresAt.toISOString(),
        inviteId,
        inviteUrl: `https://t.me/${botUsername}?start=${token}`,
      };
    } catch (error) {
      if (error instanceof OwnerInviteUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001' || databaseErrorCode(error) === '23505') {
        throw new OwnerInviteRejectedError();
      }
      throw new OwnerInviteUnavailableError();
    }
  }

  async revoke(
    authUserId: string,
    inviteId: string,
    reasonCode: BetaInviteRevocationReason,
  ): Promise<void> {
    if (!UUID_PATTERN.test(authUserId) || !UUID_PATTERN.test(inviteId)) {
      throw new OwnerInviteRejectedError();
    }
    try {
      const result = await this.database.query(REVOKE_SQL, [authUserId, inviteId, reasonCode]);
      const row = oneRow(result.rows);
      if (row.revoked_invite_id !== inviteId || !(row.revoked_at instanceof Date)) {
        throw new OwnerInviteUnavailableError();
      }
    } catch (error) {
      if (error instanceof OwnerInviteUnavailableError) throw error;
      if (databaseErrorCode(error) === 'P0001') throw new OwnerInviteRejectedError();
      throw new OwnerInviteUnavailableError();
    }
  }
}
