import { describe, expect, it } from 'vitest';

import {
  OwnerOldPaymentRejectedError,
  OwnerOldPaymentUnavailableError,
} from './owner-telebirr-old-payments.js';
import { PostgresOwnerReceiverSmsOldPayments } from './owner-receiver-sms-old-payments.js';

const owner = '11111111-1111-4111-8111-111111111111';
const candidate = '22222222-2222-4222-8222-222222222222';

describe('Owner older receiver SMS payments', () => {
  it('shows both providers with masked values', async () => {
    const calls: unknown[] = [];
    const adapter = new PostgresOwnerReceiverSmsOldPayments({
      query: async (sql, values) => {
        calls.push([sql, values]);
        if (sql.includes('list_owner_receiver_sms_old_payments'))
          return {
            rows: [
              {
                candidate_id: candidate,
                provider_code: 'cbe_birr',
                submitted_at: new Date('2026-10-20T10:00:00Z'),
                payment_at: new Date('2026-10-20T08:59:00Z'),
                amount_minor: '2500',
                reference_masked: '***AB12',
                player_masked: '***5678',
                review_kind: 'older_approval',
                reason_code: 'old_payment',
              },
            ],
          };
        return { rows: [] };
      },
    });
    expect(await adapter.list(owner)).toMatchObject([
      {
        providerCode: 'cbe_birr',
        referenceMasked: '***AB12',
        playerMasked: '***5678',
      },
    ]);
    expect(calls).toHaveLength(1);
  });

  it('rejects unmasked output and malformed list parameters', async () => {
    const malformed = new PostgresOwnerReceiverSmsOldPayments({
      query: async () => ({
        rows: [
          {
            candidate_id: candidate,
            provider_code: 'telebirr',
            submitted_at: new Date(),
            payment_at: new Date(),
            amount_minor: '2500',
            reference_masked: 'FULL_REFERENCE',
            player_masked: '***5678',
            review_kind: 'older_approval',
            reason_code: 'old_payment',
          },
        ],
      }),
    });
    await expect(malformed.list(owner)).rejects.toBeInstanceOf(OwnerOldPaymentUnavailableError);
    await expect(malformed.list('bad')).rejects.toBeInstanceOf(OwnerOldPaymentRejectedError);
  });

  it('recognizes the new 60-minute review reason and historical 5-minute holds', async () => {
    for (const reasonCode of ['no_receiver_sms_after_60m', 'no_receiver_sms_after_5m']) {
      const adapter = new PostgresOwnerReceiverSmsOldPayments({
        query: async () => ({
          rows: [
            {
              candidate_id: candidate,
              provider_code: 'telebirr',
              submitted_at: new Date('2026-10-28T00:00:00Z'),
              payment_at: null,
              amount_minor: null,
              reference_masked: '***AB12',
              player_masked: '***5678',
              review_kind: 'held_review',
              reason_code: reasonCode,
            },
          ],
        }),
      });
      expect(await adapter.list(owner)).toMatchObject([{ reasonCode }]);
    }
  });
});
