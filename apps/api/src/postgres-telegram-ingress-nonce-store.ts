import { createHash } from 'node:crypto';

import { TELEGRAM_PRIVATE_INGRESS_MAX_TIMESTAMP_SKEW_SECONDS } from '@payreplayy/contracts';

import type { TelegramIngressNonceStore } from './telegram-ingress.js';

const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const MAXIMUM_RESERVATION_WINDOW_MS = TELEGRAM_PRIVATE_INGRESS_MAX_TIMESTAMP_SKEW_SECONDS * 2_000;
const RESERVE_TELEGRAM_PRIVATE_INGRESS_NONCE_SQL =
  'select app.reserve_telegram_private_ingress_nonce($1::text, $2::timestamptz) as reserved';

export interface TelegramIngressNonceReservationDatabase {
  query(
    query: string,
    values: readonly [string, Date],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

/**
 * The caller sees a retryable storage failure only. Database addresses, role names, SQL details,
 * and nonce values are deliberately never attached to this error.
 */
export class TelegramIngressNonceStoreUnavailableError extends Error {
  constructor() {
    super('The private Telegram ingress nonce store is unavailable.');
    this.name = 'TelegramIngressNonceStoreUnavailableError';
  }
}

export function createTelegramIngressNonceDigest(nonce: string): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('The Telegram ingress nonce is invalid.');
  }

  return `sha256-v1:${createHash('sha256')
    .update('payreplayy:telegram:private-ingress:nonce:v1\n', 'utf8')
    .update(nonce, 'utf8')
    .digest('hex')}`;
}

function isReservationWindowValid(expiresAtMs: number, nowMs: number): boolean {
  return (
    Number.isSafeInteger(expiresAtMs) &&
    Number.isSafeInteger(nowMs) &&
    expiresAtMs > nowMs &&
    expiresAtMs <= nowMs + MAXIMUM_RESERVATION_WINDOW_MS
  );
}

function reservationResult(rows: readonly unknown[]): boolean {
  const value = (rows[0] as { reserved?: unknown } | undefined)?.reserved;
  if (typeof value !== 'boolean') {
    throw new TelegramIngressNonceStoreUnavailableError();
  }
  return value;
}

/**
 * Durable, cross-replica nonce store for a future API runtime connection. This class is not wired
 * into server startup in Stage 13B; it receives a future long-lived, least-privilege query client.
 */
export class PostgresTelegramIngressNonceStore implements TelegramIngressNonceStore {
  readonly durable = true;

  constructor(private readonly database: TelegramIngressNonceReservationDatabase) {}

  async reserve(nonce: string, expiresAtMs: number, nowMs: number): Promise<boolean> {
    if (!NONCE_PATTERN.test(nonce) || !isReservationWindowValid(expiresAtMs, nowMs)) {
      return false;
    }

    try {
      const result = await this.database.query(RESERVE_TELEGRAM_PRIVATE_INGRESS_NONCE_SQL, [
        createTelegramIngressNonceDigest(nonce),
        new Date(expiresAtMs),
      ]);
      return reservationResult(result.rows);
    } catch (error) {
      if (error instanceof TelegramIngressNonceStoreUnavailableError) throw error;
      throw new TelegramIngressNonceStoreUnavailableError();
    }
  }
}
