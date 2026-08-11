import { describe, expect, it } from 'vitest';

import {
  PostgresTelegramPrivateActionNonceStore,
  TelegramPrivateActionNonceStoreUnavailableError,
} from './postgres-telegram-private-action-nonce-store.js';

describe('Postgres private-action nonce store', () => {
  it('uses one parameterized bounded reservation statement', async () => {
    const calls: { query: string; values: readonly [string, Date] }[] = [];
    const store = new PostgresTelegramPrivateActionNonceStore({
      query: async (query, values) => {
        calls.push({ query, values });
        return { rows: [{ reserved: true }] };
      },
    });
    const now = Date.parse('2026-08-11T12:00:00.000Z');
    await expect(store.reserve('a'.repeat(64), now + 120_000, now)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain('reserve_telegram_private_action_nonce($1::text');
    expect(calls[0]?.query).not.toContain('a'.repeat(64));
    expect(calls[0]?.values).toEqual(['a'.repeat(64), new Date(now + 120_000)]);
  });

  it('rejects malformed inputs without querying and hides database failures', async () => {
    let queried = false;
    const store = new PostgresTelegramPrivateActionNonceStore({
      query: async () => {
        queried = true;
        throw new Error('sensitive database detail');
      },
    });
    const now = Date.parse('2026-08-11T12:00:00.000Z');
    await expect(store.reserve('sha256-v1:' + 'a'.repeat(64), now + 1_000, now)).resolves.toBe(
      false,
    );
    expect(queried).toBe(false);
    await expect(store.reserve('a'.repeat(64), now + 1_000, now)).rejects.toEqual(
      new TelegramPrivateActionNonceStoreUnavailableError(),
    );
  });
});
