import { describe, expect, it } from 'vitest';

import {
  OwnerDepositIntakeRejectedError,
  OwnerDepositIntakeUnavailableError,
  PostgresOwnerDryRunDepositIntake,
} from './owner-deposit-intake.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const intentId = '22222222-2222-4222-8222-222222222222';

describe('Owner dry-run deposit intake projection', () => {
  it('maps only bounded safe fields and never queries raw reference material', async () => {
    let sql = '';
    const projection = new PostgresOwnerDryRunDepositIntake({
      async query(query, values) {
        sql = query;
        expect(values).toEqual([ownerId, 20]);
        return {
          rows: [
            {
              deposit_intent_id: intentId,
              player_id: '28379330',
              expected_amount_minor: '2500',
              currency_code: 'ETB',
              provider_code: 'cbe_birr',
              receiver_account_masked: '****1234',
              deposit_status: 'intake_received',
              opened_at: new Date('2026-08-12T10:00:00Z'),
              payment_deadline_at: new Date('2026-08-12T11:00:00Z'),
              submitted_reference_masked: '***A1B2',
              submission_status: 'received',
              submitted_at: new Date('2026-08-12T10:05:00Z'),
            },
          ],
        };
      },
    });

    await expect(projection.list(ownerId, 20)).resolves.toEqual([
      expect.objectContaining({
        amountMinor: '2500',
        depositIntentId: intentId,
        submittedReferenceMasked: '***A1B2',
      }),
    ]);
    expect(sql).toContain('app.list_owner_dry_run_deposit_intake');
    expect(sql).not.toMatch(/ciphertext|fingerprint|transaction_reference/iu);
  });

  it('rejects invalid actors and fails closed on malformed database values', async () => {
    const projection = new PostgresOwnerDryRunDepositIntake({
      async query() {
        return {
          rows: [{ deposit_intent_id: intentId, submitted_reference_masked: 'RAW-SECRET' }],
        };
      },
    });
    await expect(projection.list('not-a-uuid')).rejects.toBeInstanceOf(
      OwnerDepositIntakeRejectedError,
    );
    await expect(projection.list(ownerId)).rejects.toBeInstanceOf(
      OwnerDepositIntakeUnavailableError,
    );
  });
});
