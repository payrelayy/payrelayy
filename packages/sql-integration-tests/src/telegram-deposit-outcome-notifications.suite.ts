import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

export function registerTelegramDepositOutcomeNotificationsSqlTests(getClient: () => Client): void {
  describe('Telegram deposit outcome notifications', () => {
    it('keeps the delivery queue private and grants only the narrow bot action runtime', async () => {
      const client = getClient();
      const catalog = await client.query<{
        relforcerowsecurity: boolean;
        relrowsecurity: boolean;
        runtime_select: boolean;
        public_select: boolean;
      }>(`select relation.relrowsecurity, relation.relforcerowsecurity,
                 has_table_privilege('fetanagent_player_actions_runtime', relation.oid, 'SELECT')
                   as runtime_select,
                 has_table_privilege('anon', relation.oid, 'SELECT') as public_select
            from pg_catalog.pg_class relation
           where relation.oid = 'app.telegram_deposit_outcome_deliveries'::regclass`);
      expect(catalog.rows).toEqual([
        {
          relforcerowsecurity: true,
          relrowsecurity: true,
          runtime_select: false,
          public_select: false,
        },
      ]);
      const grants = await client.query<{
        runtime_claim: boolean;
        runtime_complete: boolean;
        anon_claim: boolean;
      }>(`select
           has_function_privilege('fetanagent_player_actions_runtime',
             'app.claim_telegram_deposit_outcome_notification()', 'EXECUTE') as runtime_claim,
           has_function_privilege('fetanagent_player_actions_runtime',
             'app.complete_telegram_deposit_outcome_notification(uuid,uuid,text,bigint)',
             'EXECUTE') as runtime_complete,
           has_function_privilege('anon',
             'app.claim_telegram_deposit_outcome_notification()', 'EXECUTE') as anon_claim`);
      expect(grants.rows).toEqual([
        {
          runtime_claim: true,
          runtime_complete: true,
          anon_claim: false,
        },
      ]);
    });

    it('leases and acknowledges one final notification without touching a payment', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const candidateId = randomUUID();
        const inserted = await client.query<{ id: string }>(
          `
          insert into app.telegram_deposit_outcome_deliveries
            (candidate_id, private_chat_id, reference_masked, outcome_code,
             amount_minor, next_attempt_at)
          values ($1::uuid, 123456789, '***1A2B', 'credited', 3000,
                  pg_catalog.clock_timestamp() - interval '6 days')
          returning id`,
          [candidateId],
        );
        const notificationId = inserted.rows[0]?.id;
        expect(notificationId).toBeTypeOf('string');
        const claimed = await client.query<{
          notification_id: string;
          notification_lease_token: string;
          notification_outcome_code: string;
          notification_amount_minor: string;
          notification_reference_masked: string;
        }>('select * from app.claim_telegram_deposit_outcome_notification()');
        expect(claimed.rows).toHaveLength(1);
        expect(claimed.rows[0]).toMatchObject({
          notification_id: notificationId,
          notification_outcome_code: 'credited',
          notification_amount_minor: '3000',
          notification_reference_masked: '***1A2B',
        });
        const token = claimed.rows[0]?.notification_lease_token;
        const wrong = await client.query<{ accepted: boolean }>(
          `select app.complete_telegram_deposit_outcome_notification(
             $1::uuid, $2::uuid, 'sent', 42) as accepted`,
          [notificationId, randomUUID()],
        );
        expect(wrong.rows).toEqual([{ accepted: false }]);
        const completed = await client.query<{ accepted: boolean }>(
          `select app.complete_telegram_deposit_outcome_notification(
             $1::uuid, $2::uuid, 'sent', 42) as accepted`,
          [notificationId, token],
        );
        expect(completed.rows).toEqual([{ accepted: true }]);
        const duplicate = await client.query<{ accepted: boolean }>(
          `select app.complete_telegram_deposit_outcome_notification(
             $1::uuid, $2::uuid, 'sent', 42) as accepted`,
          [notificationId, token],
        );
        expect(duplicate.rows).toEqual([{ accepted: true }]);
        const status = await client.query<{ status: string; telegram_message_id: string }>(
          `select status, telegram_message_id from app.telegram_deposit_outcome_deliveries
            where id = $1::uuid`,
          [notificationId],
        );
        expect(status.rows).toEqual([{ status: 'sent', telegram_message_id: '42' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('suppresses a stale waiting update and sends the final result for the same candidate', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const candidateId = randomUUID();
        await client.query(
          `insert into app.telegram_deposit_outcome_deliveries
             (candidate_id, notification_stage, private_chat_id, reference_masked,
              outcome_code, amount_minor, next_attempt_at)
           values
             ($1::uuid, 'waiting', 123456789, '***1A2B', 'verified_waiting', null,
              pg_catalog.clock_timestamp() - interval '1 minute'),
             ($1::uuid, 'final', 123456789, '***1A2B', 'credited', 3000,
              pg_catalog.clock_timestamp() - interval '1 minute')`,
          [candidateId],
        );
        const claimed = await client.query<{
          notification_outcome_code: string;
        }>('select * from app.claim_telegram_deposit_outcome_notification()');
        expect(claimed.rows).toEqual([
          expect.objectContaining({ notification_outcome_code: 'credited' }),
        ]);
        const states = await client.query<{ notification_stage: string; status: string }>(
          `select notification_stage, status
             from app.telegram_deposit_outcome_deliveries
            where candidate_id = $1::uuid order by notification_stage`,
          [candidateId],
        );
        expect(states.rows).toEqual([
          { notification_stage: 'final', status: 'leased' },
          { notification_stage: 'waiting', status: 'unavailable' },
        ]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
