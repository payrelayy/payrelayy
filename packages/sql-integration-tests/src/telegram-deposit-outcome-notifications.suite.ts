import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

export function registerTelegramDepositOutcomeNotificationsSqlTests(getClient: () => Client): void {
  describe('Telegram deposit outcome notifications', () => {
    it('keeps fast results private and grants only the Owner a redacted alert summary', async () => {
      const client = getClient();
      const rows = await client.query<Record<string, boolean>>(`select
        (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'app.routine_telebirr_fast_results'::regclass) as result_rls,
        (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'app.routine_telebirr_fast_owner_alerts'::regclass) as alert_rls,
        has_table_privilege('fetanagent_player_actions_runtime',
          'app.routine_telebirr_fast_results', 'SELECT,INSERT,UPDATE,DELETE') as bot_table_access,
        has_table_privilege('fetanagent_owner_control_runtime',
          'app.routine_telebirr_fast_owner_alerts', 'SELECT') as owner_table_access,
        has_function_privilege('fetanagent_owner_control_runtime',
          'app.get_owner_routine_telebirr_fast_alert_summary(uuid)', 'EXECUTE') as owner_summary,
        has_function_privilege('anon',
          'app.get_owner_routine_telebirr_fast_alert_summary(uuid)', 'EXECUTE') as anon_summary,
        has_function_privilege('fetanagent_player_actions_runtime',
          'app.resolve_routine_telebirr_fast_results()', 'EXECUTE') as bot_resolver`);
      expect(rows.rows).toEqual([
        {
          result_rls: true,
          alert_rls: true,
          bot_table_access: false,
          owner_table_access: false,
          owner_summary: true,
          anon_summary: false,
          bot_resolver: false,
        },
      ]);
    });
    it('keeps temporary notice IDs private with no customer or direct runtime table access', async () => {
      const client = getClient();
      const catalog = await client.query<{
        relforcerowsecurity: boolean;
        relrowsecurity: boolean;
        runtime_select: boolean;
        anon_select: boolean;
        runtime_record: boolean;
        anon_record: boolean;
      }>(`select relation.relrowsecurity, relation.relforcerowsecurity,
          has_table_privilege('fetanagent_player_actions_runtime', relation.oid, 'SELECT')
            as runtime_select,
          has_table_privilege('anon', relation.oid, 'SELECT') as anon_select,
          has_function_privilege('fetanagent_player_actions_runtime',
            'app.record_telegram_deposit_temporary_message(bigint,bigint,bigint)', 'EXECUTE')
            as runtime_record,
          has_function_privilege('anon',
            'app.record_telegram_deposit_temporary_message(bigint,bigint,bigint)', 'EXECUTE')
            as anon_record
        from pg_catalog.pg_class relation
       where relation.oid = 'app.telegram_deposit_temporary_messages'::regclass`);
      expect(catalog.rows).toEqual([
        {
          relforcerowsecurity: true,
          relrowsecurity: true,
          runtime_select: false,
          anon_select: false,
          runtime_record: true,
          anon_record: false,
        },
      ]);
    });

    it('deletes a cancelled or expired no-candidate notice with one bounded lease', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const updateId = 987654321;
        const recorded = await client.query<{ accepted: boolean }>(
          `select app.record_telegram_deposit_temporary_message($1,123456789,42) as accepted`,
          [updateId],
        );
        expect(recorded.rows).toEqual([{ accepted: true }]);
        const repeated = await client.query<{ accepted: boolean }>(
          `select app.record_telegram_deposit_temporary_message($1,123456789,42) as accepted`,
          [updateId],
        );
        expect(repeated.rows).toEqual([{ accepted: true }]);
        const wrongMessage = await client.query<{ accepted: boolean }>(
          `select app.record_telegram_deposit_temporary_message($1,123456789,43) as accepted`,
          [updateId],
        );
        expect(wrongMessage.rows).toEqual([{ accepted: false }]);
        const cancelled = await client.query<{ accepted: boolean }>(
          `select app.cancel_telegram_deposit_temporary_message($1,123456789,42) as accepted`,
          [updateId],
        );
        expect(cancelled.rows).toEqual([{ accepted: true }]);
        const claimed = await client.query<{
          cleanup_update_id: string;
          cleanup_lease_token: string;
          cleanup_private_chat_id: string;
          cleanup_message_id: string;
        }>('select * from app.claim_telegram_deposit_temporary_deletion()');
        expect(claimed.rows).toMatchObject([
          {
            cleanup_update_id: String(updateId),
            cleanup_private_chat_id: '123456789',
            cleanup_message_id: '42',
          },
        ]);
        const token = claimed.rows[0]!.cleanup_lease_token;
        const wrongToken = await client.query<{ accepted: boolean }>(
          `select app.complete_telegram_deposit_temporary_deletion($1,$2,'deleted') as accepted`,
          [updateId, randomUUID()],
        );
        expect(wrongToken.rows).toEqual([{ accepted: false }]);
        const completed = await client.query<{ accepted: boolean }>(
          `select app.complete_telegram_deposit_temporary_deletion($1,$2,'deleted') as accepted`,
          [updateId, token],
        );
        expect(completed.rows).toEqual([{ accepted: true }]);
        const repeatCompletion = await client.query<{ accepted: boolean }>(
          `select app.complete_telegram_deposit_temporary_deletion($1,$2,'deleted') as accepted`,
          [updateId, token],
        );
        expect(repeatCompletion.rows).toEqual([{ accepted: true }]);
        const empty = await client.query(
          'select * from app.claim_telegram_deposit_temporary_deletion()',
        );
        expect(empty.rows).toEqual([]);
      } finally {
        await client.query('rollback');
      }
    });

    it('does not delete a recent active notice before a status or cancellation', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const updateId = 987654322;
        await client.query(
          `select app.record_telegram_deposit_temporary_message($1,123456789,43)`,
          [updateId],
        );
        const claim = await client.query(
          'select * from app.claim_telegram_deposit_temporary_deletion()',
        );
        expect(claim.rows).toEqual([]);
      } finally {
        await client.query('rollback');
      }
    });

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
        runtime_duplicate_predicate: boolean;
        anon_duplicate_predicate: boolean;
      }>(`select
           has_function_privilege('fetanagent_player_actions_runtime',
             'app.claim_telegram_deposit_outcome_notification()', 'EXECUTE') as runtime_claim,
           has_function_privilege('fetanagent_player_actions_runtime',
             'app.complete_telegram_deposit_outcome_notification(uuid,uuid,text,bigint)',
             'EXECUTE') as runtime_complete,
           has_function_privilege('anon',
             'app.claim_telegram_deposit_outcome_notification()', 'EXECUTE') as anon_claim,
           has_function_privilege('fetanagent_player_actions_runtime',
             'app.routine_telebirr_same_customer_credited_reference(uuid)', 'EXECUTE')
             as runtime_duplicate_predicate,
           has_function_privilege('anon',
             'app.routine_telebirr_same_customer_credited_reference(uuid)', 'EXECUTE')
             as anon_duplicate_predicate`);
      expect(grants.rows).toEqual([
        {
          runtime_claim: true,
          runtime_complete: true,
          anon_claim: false,
          runtime_duplicate_predicate: false,
          anon_duplicate_predicate: false,
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

    it('sends one non-final checking message before a later final outcome', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const candidateId = randomUUID();
        await client.query(
          `insert into app.telegram_deposit_outcome_deliveries
             (candidate_id, notification_stage, private_chat_id, reference_masked,
              outcome_code, amount_minor, next_attempt_at)
           values ($1::uuid, 'checking', 123456789, '***1A2B', 'checking', null,
                   pg_catalog.clock_timestamp())`,
          [candidateId],
        );
        const checking = await client.query<{
          notification_id: string;
          notification_lease_token: string;
          notification_outcome_code: string;
        }>('select * from app.claim_telegram_deposit_outcome_notification()');
        expect(checking.rows).toMatchObject([{ notification_outcome_code: 'checking' }]);
        await client.query(
          `select app.complete_telegram_deposit_outcome_notification(
             $1::uuid,$2::uuid,'sent',42)`,
          [checking.rows[0]!.notification_id, checking.rows[0]!.notification_lease_token],
        );
        await client.query(
          `insert into app.telegram_deposit_outcome_deliveries
             (candidate_id, notification_stage, private_chat_id, reference_masked,
              outcome_code, amount_minor, next_attempt_at)
           values ($1::uuid, 'final', 123456789, '***1A2B', 'not_verified', null,
                   pg_catalog.clock_timestamp())`,
          [candidateId],
        );
        const final = await client.query<{ notification_outcome_code: string }>(
          'select * from app.claim_telegram_deposit_outcome_notification()',
        );
        expect(final.rows).toMatchObject([{ notification_outcome_code: 'not_verified' }]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
