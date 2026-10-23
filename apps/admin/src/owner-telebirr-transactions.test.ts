import { describe, expect, it } from 'vitest';

import {
  OwnerTransactionsRejectedError,
  OwnerTransactionsUnavailableError,
  PostgresOwnerTelebirrTransactions,
} from './owner-telebirr-transactions.js';

const owner = '11111111-1111-4111-8111-111111111111';
const pending = {
  candidateId: '22222222-2222-4222-8222-222222222222',
  submittedAt: '2026-10-20T10:00:00Z',
  paymentAt: '2026-10-20T08:59:00Z',
  amountMinor: '2500',
  referenceMasked: '***AB12',
  playerMasked: '***5678',
  statusGroup: 'pending',
  statusDetail: 'waiting_approval',
  reason: 'Payment older than 1 hour',
  decidedBy: null,
  decidedAt: null,
  canDecide: true,
} as const;

describe('Owner TeleBirr Transactions adapter', () => {
  it('returns only masked, filtered rows and a global waiting count', async () => {
    const calls: unknown[] = [];
    const adapter = new PostgresOwnerTelebirrTransactions({
      query: async (sql, values) => {
        calls.push([sql, values]);
        return {
          rows: [
            {
              transactions: {
                rows: [pending],
                total: 1,
                pending: 1,
                credited: 0,
                rejected: 0,
                waitingCount: 3,
              },
            },
          ],
        };
      },
    });
    expect(
      await adapter.list(owner, {
        status: 'pending',
        from: '2026-10-20',
        to: '2026-10-20',
        last4: 'AB12',
        limit: 25,
        offset: 0,
      }),
    ).toMatchObject({ rows: [pending], waitingCount: 3 });
    expect(calls).toEqual([
      [
        expect.stringContaining('list_owner_routine_telebirr_transactions'),
        [owner, 'pending', '2026-10-20', '2026-10-20', 'AB12', 25, 0],
      ],
    ]);
  });

  it('rejects unmasked references and unauthorized action flags', async () => {
    for (const unsafe of [
      { ...pending, referenceMasked: 'FULL_REFERENCE' },
      { ...pending, statusDetail: 'held_review', canDecide: true },
      { ...pending, playerMasked: '12345678' },
    ]) {
      const adapter = new PostgresOwnerTelebirrTransactions({
        query: async () => ({
          rows: [
            {
              transactions: {
                rows: [unsafe],
                total: 1,
                pending: 1,
                credited: 0,
                rejected: 0,
                waitingCount: 1,
              },
            },
          ],
        }),
      });
      await expect(
        adapter.list(owner, { status: 'all', limit: 25, offset: 0 }),
      ).rejects.toBeInstanceOf(OwnerTransactionsUnavailableError);
    }
  });

  it('accepts an audited Owner manual outcome in read-only history', async () => {
    const manual = {
      ...pending,
      statusGroup: 'credited',
      statusDetail: 'manually_credited',
      reason: 'Owner marked manually credited',
      decidedBy: 'Owner',
      decidedAt: '2026-10-20T10:05:00Z',
      canDecide: false,
    };
    const adapter = new PostgresOwnerTelebirrTransactions({
      query: async () => ({
        rows: [
          {
            transactions: {
              rows: [manual],
              total: 1,
              pending: 0,
              credited: 1,
              rejected: 0,
              waitingCount: 0,
            },
          },
        ],
      }),
    });
    expect(await adapter.list(owner, { status: 'all', limit: 25, offset: 0 })).toMatchObject({
      rows: [manual],
    });
  });

  it('rejects malformed filters before any database call', async () => {
    let calls = 0;
    const adapter = new PostgresOwnerTelebirrTransactions({
      query: async () => {
        calls += 1;
        return { rows: [] };
      },
    });
    await expect(
      adapter.list(owner, { status: 'all', last4: 'ABCDE', limit: 25, offset: 0 }),
    ).rejects.toBeInstanceOf(OwnerTransactionsRejectedError);
    await expect(
      adapter.list(owner, { status: 'all', from: '2026-02-30', limit: 25, offset: 0 }),
    ).rejects.toBeInstanceOf(OwnerTransactionsRejectedError);
    expect(calls).toBe(0);
  });
});
