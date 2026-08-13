import { TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS } from '@fetanagent/contracts';

import type { TelegramBetaInviteAdmissionNonceStore } from './telegram-beta-invite-admission.js';

const NONCE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_RESERVATION_WINDOW_MS =
  TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS * 2_000;
const RESERVE_TELEGRAM_BETA_INVITE_ADMISSION_NONCE_SQL =
  'select app.reserve_telegram_beta_invite_admission_nonce($1::text, $2::timestamptz) as reserved';

export interface TelegramBetaInviteAdmissionNonceReservationDatabase {
  query(
    query: string,
    values: readonly [string, Date],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

/**
 * The caller sees a retryable storage failure only. Database addresses, roles, SQL details, and
 * the one-way nonce digest are deliberately never attached to this error.
 */
export class TelegramBetaInviteAdmissionNonceStoreUnavailableError extends Error {
  constructor() {
    super('The Telegram beta invite admission nonce store is unavailable.');
    this.name = 'TelegramBetaInviteAdmissionNonceStoreUnavailableError';
  }
}

function isValidDateMs(value: number): boolean {
  return Number.isSafeInteger(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * The admission verifier accepts timestamps within one skew interval of now, then calculates an
 * expiry no more than two intervals ahead. Keep this adapter bounded to that same acceptance
 * window before issuing a database call.
 */
function isReservationWindowValid(expiresAtMs: number, nowMs: number): boolean {
  return (
    isValidDateMs(expiresAtMs) &&
    isValidDateMs(nowMs) &&
    expiresAtMs > nowMs &&
    expiresAtMs <= nowMs + MAXIMUM_RESERVATION_WINDOW_MS
  );
}

function reservationResult(rows: readonly unknown[]): boolean {
  if (rows.length !== 1) throw new TelegramBetaInviteAdmissionNonceStoreUnavailableError();

  const value = (rows[0] as { reserved?: unknown } | undefined)?.reserved;
  if (typeof value !== 'boolean') {
    throw new TelegramBetaInviteAdmissionNonceStoreUnavailableError();
  }
  return value;
}

/**
 * Durable, cross-replica nonce store for the beta-admission verifier. It intentionally receives
 * only the verifier's bare, domain-separated lower-hex digest and owns no connection, pool, route
 * route, bot transport, or runtime composition.
 */
export class PostgresTelegramBetaInviteAdmissionNonceStore implements TelegramBetaInviteAdmissionNonceStore {
  readonly durable = true as const;

  constructor(private readonly database: TelegramBetaInviteAdmissionNonceReservationDatabase) {}

  async reserve(nonceDigest: string, expiresAtMs: number, nowMs: number): Promise<boolean> {
    if (!NONCE_DIGEST_PATTERN.test(nonceDigest) || !isReservationWindowValid(expiresAtMs, nowMs)) {
      return false;
    }

    try {
      const result = await this.database.query(RESERVE_TELEGRAM_BETA_INVITE_ADMISSION_NONCE_SQL, [
        nonceDigest,
        new Date(expiresAtMs),
      ]);
      return reservationResult(result.rows);
    } catch (error) {
      if (error instanceof TelegramBetaInviteAdmissionNonceStoreUnavailableError) throw error;
      throw new TelegramBetaInviteAdmissionNonceStoreUnavailableError();
    }
  }
}
