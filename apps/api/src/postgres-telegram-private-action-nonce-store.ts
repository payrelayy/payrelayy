import { TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS } from '@payreplayy/contracts';

import type { TelegramPrivateActionNonceStore } from './telegram-private-action.js';

const NONCE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_RESERVATION_WINDOW_MS = TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS * 2_000;
const RESERVE_SQL =
  'select app.reserve_telegram_private_action_nonce($1::text, $2::timestamptz) as reserved';

export interface TelegramPrivateActionNonceDatabase {
  query(
    query: string,
    values: readonly [string, Date],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export class TelegramPrivateActionNonceStoreUnavailableError extends Error {
  constructor() {
    super('The Telegram private-action nonce store is unavailable.');
    this.name = 'TelegramPrivateActionNonceStoreUnavailableError';
  }
}

export class PostgresTelegramPrivateActionNonceStore implements TelegramPrivateActionNonceStore {
  readonly durable = true as const;

  constructor(private readonly database: TelegramPrivateActionNonceDatabase) {}

  async reserve(nonceDigest: string, expiresAtMs: number, nowMs: number): Promise<boolean> {
    if (
      !NONCE_DIGEST_PATTERN.test(nonceDigest) ||
      !Number.isSafeInteger(expiresAtMs) ||
      !Number.isSafeInteger(nowMs) ||
      expiresAtMs <= nowMs ||
      expiresAtMs > nowMs + MAXIMUM_RESERVATION_WINDOW_MS
    ) {
      return false;
    }

    try {
      const result = await this.database.query(RESERVE_SQL, [nonceDigest, new Date(expiresAtMs)]);
      if (result.rows.length !== 1) throw new TelegramPrivateActionNonceStoreUnavailableError();
      const reserved = (result.rows[0] as { reserved?: unknown } | undefined)?.reserved;
      if (typeof reserved !== 'boolean') {
        throw new TelegramPrivateActionNonceStoreUnavailableError();
      }
      return reserved;
    } catch (error) {
      if (error instanceof TelegramPrivateActionNonceStoreUnavailableError) throw error;
      throw new TelegramPrivateActionNonceStoreUnavailableError();
    }
  }
}
