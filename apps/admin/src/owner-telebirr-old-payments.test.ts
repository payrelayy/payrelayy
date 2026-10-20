import { describe, expect, it } from 'vitest';

import {
  OwnerOldPaymentConflictError,
  OwnerOldPaymentRejectedError,
  OwnerOldPaymentUnavailableError,
  PostgresOwnerTelebirrOldPayments,
} from './owner-telebirr-old-payments.js';

const owner = '11111111-1111-4111-8111-111111111111';
const candidate = '22222222-2222-4222-8222-222222222222';

describe('Owner older TeleBirr payment adapter', () => {
  it('returns only masked rows and preserves the exact decision action', async () => {
    const calls: unknown[] = [];
    const adapter = new PostgresOwnerTelebirrOldPayments({
      query: async (sql, values) => {
        calls.push([sql, values]);
        if (sql.includes('list_owner_routine_telebirr_old_payments'))
          return {
            rows: [
              {
                candidate_id: candidate,
                submitted_at: new Date('2026-10-20T10:00:00Z'),
                payment_at: new Date('2026-10-20T08:59:00Z'),
                amount_minor: '2500',
                reference_masked: '***AB12',
                player_masked: '***5678',
              },
            ],
          };
        return {
          rows: [
            {
              decision: {
                decision: 'approved',
                decidedAt: '2026-10-20T10:01:00Z',
                depositIntentId: '33333333-3333-4333-8333-333333333333',
                executionJobId: '44444444-4444-4444-8444-444444444444',
              },
            },
          ],
        };
      },
    });
    expect(await adapter.list(owner)).toMatchObject([
      { candidateId: candidate, referenceMasked: '***AB12', playerMasked: '***5678' },
    ]);
    expect((await adapter.decide(owner, candidate, 'approve')).decision).toBe('approved');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([
      expect.stringContaining('decide_owner_routine_telebirr_old_payment'),
      [owner, candidate, 'approve'],
    ]);
  });

  it('rejects malformed identifiers, unmasked data and stale decisions', async () => {
    const malformed = new PostgresOwnerTelebirrOldPayments({
      query: async () => ({
        rows: [
          {
            candidate_id: candidate,
            submitted_at: new Date(),
            payment_at: new Date(),
            amount_minor: '2500',
            reference_masked: 'FULL_REFERENCE',
            player_masked: '***5678',
          },
        ],
      }),
    });
    await expect(malformed.list(owner)).rejects.toBeInstanceOf(OwnerOldPaymentUnavailableError);
    await expect(malformed.decide('bad', candidate, 'approve')).rejects.toBeInstanceOf(
      OwnerOldPaymentRejectedError,
    );
    const conflict = new PostgresOwnerTelebirrOldPayments({
      query: async () => {
        throw Object.assign(new Error('conflict'), { code: 'P0001' });
      },
    });
    await expect(conflict.decide(owner, candidate, 'approve')).rejects.toBeInstanceOf(
      OwnerOldPaymentConflictError,
    );
  });
});
