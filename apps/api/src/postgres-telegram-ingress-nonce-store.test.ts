import { describe, expect, it } from 'vitest';

import {
  createTelegramIngressNonceDigest,
  PostgresTelegramIngressNonceStore,
  TelegramIngressNonceStoreUnavailableError,
  type TelegramIngressNonceReservationDatabase,
} from './postgres-telegram-ingress-nonce-store.js';

const fixedNowMs = Date.parse('2026-08-08T12:00:00.000Z');
const fixedExpiryMs = fixedNowMs + 120_000;
const fixedNonce = 'n'.repeat(32);

function createDatabase(result: { readonly rows: readonly unknown[] } | Error): {
  readonly database: TelegramIngressNonceReservationDatabase;
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

describe('Postgres Telegram ingress nonce store', () => {
  it('reserves a digest through a parameterized function call', async () => {
    const fake = createDatabase({ rows: [{ reserved: true }] });
    const store = new PostgresTelegramIngressNonceStore(fake.database);

    await expect(store.reserve(fixedNonce, fixedExpiryMs, fixedNowMs)).resolves.toBe(true);
    expect(store.durable).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.query).toBe(
      'select app.reserve_telegram_private_ingress_nonce($1::text, $2::timestamptz) as reserved',
    );
    expect(fake.calls[0]?.values).toEqual([
      createTelegramIngressNonceDigest(fixedNonce),
      new Date(fixedExpiryMs),
    ]);
    expect(fake.calls[0]?.query).not.toContain(fixedNonce);
  });

  it('returns false when the database reports an existing reservation', async () => {
    const fake = createDatabase({ rows: [{ reserved: false }] });
    const store = new PostgresTelegramIngressNonceStore(fake.database);

    await expect(store.reserve(fixedNonce, fixedExpiryMs, fixedNowMs)).resolves.toBe(false);
  });

  it('fails closed before querying for malformed, stale, or too-far future reservations', async () => {
    const fake = createDatabase({ rows: [{ reserved: true }] });
    const store = new PostgresTelegramIngressNonceStore(fake.database);

    await expect(store.reserve('not-a-valid-nonce', fixedExpiryMs, fixedNowMs)).resolves.toBe(
      false,
    );
    await expect(store.reserve(fixedNonce, fixedNowMs, fixedNowMs)).resolves.toBe(false);
    await expect(store.reserve(fixedNonce, fixedNowMs + 120_001, fixedNowMs)).resolves.toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('reports database and malformed-result failures without leaking their details', async () => {
    const databaseFailure = createDatabase(new Error('synthetic database address detail'));
    const unavailableStore = new PostgresTelegramIngressNonceStore(databaseFailure.database);

    await expect(unavailableStore.reserve(fixedNonce, fixedExpiryMs, fixedNowMs)).rejects.toEqual(
      expect.objectContaining({
        message: 'The private Telegram ingress nonce store is unavailable.',
        name: 'TelegramIngressNonceStoreUnavailableError',
      }),
    );

    const malformedResult = createDatabase({ rows: [{ reserved: 'true' }] });
    const malformedStore = new PostgresTelegramIngressNonceStore(malformedResult.database);

    await expect(
      malformedStore.reserve(fixedNonce, fixedExpiryMs, fixedNowMs),
    ).rejects.toBeInstanceOf(TelegramIngressNonceStoreUnavailableError);
  });

  it('uses a stable domain-separated digest without retaining the raw nonce', () => {
    const digest = createTelegramIngressNonceDigest(fixedNonce);

    expect(digest).toMatch(/^sha256-v1:[0-9a-f]{64}$/);
    expect(createTelegramIngressNonceDigest(fixedNonce)).toBe(digest);
    expect(createTelegramIngressNonceDigest('m'.repeat(32))).not.toBe(digest);
    expect(digest).not.toContain(fixedNonce);
  });
});
