import { createHash } from 'node:crypto';

import {
  TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS,
  telegramBetaInviteRedemptionNonceDigestInput,
} from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import {
  PostgresTelegramBetaInviteAdmissionNonceStore,
  TelegramBetaInviteAdmissionNonceStoreUnavailableError,
  type TelegramBetaInviteAdmissionNonceReservationDatabase,
} from './postgres-telegram-beta-invite-admission-nonce-store.js';
import type { TelegramBetaInviteAdmissionNonceStore } from './telegram-beta-invite-admission.js';

const fixedNowMs = Date.parse('2026-08-09T12:00:00.000Z');
const fixedExpiryMs = fixedNowMs + 60_000;
const fixedNonce = 'n'.repeat(32);
const fixedDigest = createHash('sha256')
  .update(telegramBetaInviteRedemptionNonceDigestInput(fixedNonce), 'utf8')
  .digest('hex');
const maximumReservationWindowMs =
  TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS * 2_000;

function createDatabase(result: { readonly rows: readonly unknown[] } | Error): {
  readonly database: TelegramBetaInviteAdmissionNonceReservationDatabase;
  readonly calls: Array<{ readonly query: string; readonly values: readonly [string, Date] }>;
} {
  const calls: Array<{ readonly query: string; readonly values: readonly [string, Date] }> = [];

  return {
    database: {
      async query(query, values) {
        calls.push({ query, values });
        if (result instanceof Error) throw result;
        return result;
      },
    },
    calls,
  };
}

describe('Postgres Telegram beta invite admission nonce store', () => {
  it('reserves the verifier bare lower-hex digest through the dedicated parameterized function', async () => {
    const fake = createDatabase({ rows: [{ reserved: true }] });
    const store: TelegramBetaInviteAdmissionNonceStore =
      new PostgresTelegramBetaInviteAdmissionNonceStore(fake.database);

    await expect(store.reserve(fixedDigest, fixedExpiryMs, fixedNowMs)).resolves.toBe(true);
    expect(store.durable).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.query).toBe(
      'select app.reserve_telegram_beta_invite_admission_nonce($1::text, $2::timestamptz) as reserved',
    );
    expect(fake.calls[0]?.values).toEqual([fixedDigest, new Date(fixedExpiryMs)]);
    expect(fixedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.calls[0]?.query).not.toContain(fixedDigest);
    expect(JSON.stringify(fake.calls)).not.toContain(fixedNonce);
  });

  it('returns false when the database reports an existing reservation', async () => {
    const fake = createDatabase({ rows: [{ reserved: false }] });
    const store = new PostgresTelegramBetaInviteAdmissionNonceStore(fake.database);

    await expect(store.reserve(fixedDigest, fixedExpiryMs, fixedNowMs)).resolves.toBe(false);
  });

  it('fails closed before querying for non-bare digests or invalid expiry windows', async () => {
    const fake = createDatabase({ rows: [{ reserved: true }] });
    const store = new PostgresTelegramBetaInviteAdmissionNonceStore(fake.database);

    await expect(
      store.reserve(`sha256-v1:${fixedDigest}`, fixedExpiryMs, fixedNowMs),
    ).resolves.toBe(false);
    await expect(store.reserve(fixedDigest.toUpperCase(), fixedExpiryMs, fixedNowMs)).resolves.toBe(
      false,
    );
    await expect(store.reserve(fixedDigest, fixedNowMs, fixedNowMs)).resolves.toBe(false);
    await expect(
      store.reserve(fixedDigest, fixedNowMs + maximumReservationWindowMs + 1, fixedNowMs),
    ).resolves.toBe(false);
    await expect(store.reserve(fixedDigest, Number.NaN, fixedNowMs)).resolves.toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('maps database and malformed-result failures without leaking their details', async () => {
    const databaseFailure = createDatabase(new Error('synthetic database address detail'));
    const unavailableStore = new PostgresTelegramBetaInviteAdmissionNonceStore(
      databaseFailure.database,
    );

    await expect(unavailableStore.reserve(fixedDigest, fixedExpiryMs, fixedNowMs)).rejects.toEqual(
      expect.objectContaining({
        message: 'The Telegram beta invite admission nonce store is unavailable.',
        name: 'TelegramBetaInviteAdmissionNonceStoreUnavailableError',
      }),
    );

    const malformedResult = createDatabase({ rows: [{ reserved: 'true' }] });
    const malformedStore = new PostgresTelegramBetaInviteAdmissionNonceStore(
      malformedResult.database,
    );

    await expect(
      malformedStore.reserve(fixedDigest, fixedExpiryMs, fixedNowMs),
    ).rejects.toBeInstanceOf(TelegramBetaInviteAdmissionNonceStoreUnavailableError);
  });
});
