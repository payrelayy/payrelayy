import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { paidJob, persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';

async function rejected(client: Client, sql: string, values: unknown[] = []) {
  await client.query('savepoint paid_intent_rejected');
  try {
    await expect(client.query(sql, values)).rejects.toBeDefined();
  } finally {
    await client.query('rollback to savepoint paid_intent_rejected');
    await client.query('release savepoint paid_intent_rejected');
  }
}

export function registerRoutineTelebirrPaidIntentSnapshotSqlTests(
  getClient: () => Client,
  getOwner: () => string,
): void {
  describe('routine TeleBirr paid receipt-time intent snapshot', () => {
    it('keeps openings private, immutable, and unprovisioned', async () => {
      const client = getClient();
      const catalog = await client.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`select relrowsecurity, relforcerowsecurity from pg_class
          where oid = 'app.routine_telebirr_paid_intent_openings'::regclass`);
      expect(catalog.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      for (const role of [
        'anon', 'authenticated', 'service_role', 'fetanagent_api_runtime',
        'fetanagent_routine_telebirr_no_money_runtime',
        'fetanagent_routine_deposit_broker_runtime',
        'fetanagent_deposit_executor_runtime',
      ]) {
        const access = await client.query<{ can_insert: boolean; can_select: boolean }>(
          `select has_table_privilege($1::text,
                    'app.routine_telebirr_paid_intent_openings', 'INSERT') as can_insert,
                  has_table_privilege($1::text,
                    'app.routine_telebirr_paid_intent_openings', 'SELECT') as can_select`,
          [role],
        );
        expect(access.rows).toEqual([{ can_insert: false, can_select: false }]);
      }
    });

    it('opens a reviewed receipt-derived intent at occurrence time without changing legacy intake', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const authorization = await persistentPolicyFixture(client, getOwner());
        const legacy = await paidJob(client);
        const snapshot = await client.query<{
          customer_id: string;
          platform_id: string;
          player_account_id: string;
          payment_provider_id: string;
          receiver_account_id: string;
          receiver_account_version: number;
        }>(`select customer_id, platform_id, player_account_id, payment_provider_id,
                     receiver_account_id, receiver_account_version
                from app.deposit_intents where id = $1::uuid`, [legacy.depositIntentId]);
        const binding = snapshot.rows[0]!;
        const challengeId = randomUUID();
        const candidateId = randomUUID();
        const intentId = randomUUID();
        const fingerprint = createHash('sha256').update(randomUUID()).digest('hex');
        const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
        const insertedOpening = await client.query<{ occurred_at: Date }>(
          `insert into app.routine_telebirr_paid_intent_openings (
             challenge_id, candidate_id, deposit_intent_id, authorization_id, player_account_id,
             payment_provider_id, receiver_account_id, receiver_account_version,
             reference_fingerprint, observation_body_digest, source_document_digest,
             submitted_at, challenge_issued_at, observed_at, occurred_at, amount_minor
           ) values (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::uuid, $7::uuid, $8::integer,
             $9::text, $10::text, $11::text,
             clock_timestamp() - interval '250 milliseconds',
             clock_timestamp() - interval '200 milliseconds',
             clock_timestamp() - interval '100 milliseconds',
             clock_timestamp() - interval '500 milliseconds', 2500
           ) returning occurred_at`,
          [challengeId, candidateId, intentId, authorization.authorityId,
            binding.player_account_id, binding.payment_provider_id,
            binding.receiver_account_id, binding.receiver_account_version, fingerprint,
            digest(randomUUID()), digest(randomUUID())],
        );
        const intent = await client.query<{
          opened_at: Date;
          payment_deadline_at: Date;
          expected_amount_minor: string;
          routine_telebirr_paid_opening_challenge_id: string;
        }>(
          `insert into app.deposit_intents (
             id, customer_id, platform_id, player_account_id, payment_provider_id,
             receiver_account_id, expected_amount_minor,
             routine_telebirr_paid_opening_challenge_id
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                     $6::uuid, 2500, $7::uuid)
           returning opened_at, payment_deadline_at, expected_amount_minor,
                     routine_telebirr_paid_opening_challenge_id`,
          [intentId, binding.customer_id, binding.platform_id, binding.player_account_id,
            binding.payment_provider_id, binding.receiver_account_id, challengeId],
        );
        expect(intent.rows[0]!.opened_at).toEqual(insertedOpening.rows[0]!.occurred_at);
        expect(intent.rows[0]!.payment_deadline_at.getTime()).toBe(
          insertedOpening.rows[0]!.occurred_at.getTime() + 3_600_000,
        );
        expect(intent.rows[0]!.expected_amount_minor).toBe('2500');
        expect(intent.rows[0]!.routine_telebirr_paid_opening_challenge_id).toBe(challengeId);
        await rejected(client,
          `update app.routine_telebirr_paid_intent_openings
              set amount_minor = 2501 where challenge_id = $1::uuid`, [challengeId]);
        await rejected(client,
          `update app.deposit_intents
              set routine_telebirr_paid_opening_challenge_id = null where id = $1::uuid`,
          [intentId]);
        await rejected(client,
          `insert into app.deposit_intents (
             customer_id, platform_id, player_account_id, payment_provider_id,
             receiver_account_id, expected_amount_minor,
             routine_telebirr_paid_opening_challenge_id
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                     $5::uuid, 2501, $6::uuid)`,
          [binding.customer_id, binding.platform_id, binding.player_account_id,
            binding.payment_provider_id, binding.receiver_account_id, challengeId]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
