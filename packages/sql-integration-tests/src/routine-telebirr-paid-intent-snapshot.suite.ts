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
      const snapshotGuard = await client.query<{
        owner: string;
        security_definer: boolean;
        config: string[];
        exact_session_guard: boolean;
        retired_postgres_only_guard: boolean;
        owner_only_execute: boolean;
      }>(`select routine.proowner::regrole::text as owner,
                 routine.prosecdef as security_definer,
                 routine.proconfig as config,
                 strpos(routine.prosrc,
                   'if not app.routine_telebirr_paid_settlement_session_allowed() then') > 0
                   as exact_session_guard,
                 strpos(routine.prosrc, 'if session_user <> ''postgres'' then') > 0
                   as retired_postgres_only_guard,
                 not exists (
                   select 1 from pg_catalog.aclexplode(coalesce(routine.proacl,
                     pg_catalog.acldefault('f', routine.proowner))) privilege
                   where privilege.privilege_type = 'EXECUTE'
                     and privilege.grantee <> routine.proowner) as owner_only_execute
            from pg_catalog.pg_proc routine
           where routine.oid =
             'app.populate_routine_telebirr_paid_intent_snapshot()'::regprocedure`);
      expect(snapshotGuard.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: true,
          config: ['search_path=pg_catalog'],
          exact_session_guard: true,
          retired_postgres_only_guard: false,
          owner_only_execute: true,
        },
      ]);
      const settlementSurface = await client.query<{
        can_insert_intent: boolean;
        can_execute_snapshot: boolean;
      }>(`select has_table_privilege(
                   'fetanagent_routine_telebirr_paid_settlement_runtime',
                   'app.deposit_intents', 'INSERT') as can_insert_intent,
                 has_function_privilege(
                   'fetanagent_routine_telebirr_paid_settlement_runtime',
                   'app.populate_routine_telebirr_paid_intent_snapshot()', 'EXECUTE')
                   as can_execute_snapshot`);
      expect(settlementSurface.rows).toEqual([
        {
          can_insert_intent: false,
          can_execute_snapshot: false,
        },
      ]);
      for (const role of [
        'anon',
        'authenticated',
        'service_role',
        'fetanagent_api_runtime',
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
        const legacy = await paidJob(client, 2500, 'cbe_birr');
        const snapshot = await client.query<{
          customer_id: string;
          platform_id: string;
          player_account_id: string;
        }>(
          `select customer_id, platform_id, player_account_id
                from app.deposit_intents where id = $1::uuid`,
          [legacy.depositIntentId],
        );
        const binding = snapshot.rows[0]!;
        // Other suites can leave a synthetic TeleBirr receiver scheduled for the
        // future. Within this rollback-only fixture, use a revision that was
        // already active when the synthetic receipt occurred.
        await client.query(`update app.receiver_accounts
           set status = 'inactive', retired_at = greatest(clock_timestamp(), active_from)
           where provider_id = (select id from app.payment_providers where code = 'telebirr')
             and status = 'active'`);
        const receiver = await client.query<{
          payment_provider_id: string;
          receiver_account_id: string;
          receiver_account_version: number;
        }>(`insert into app.receiver_accounts (
             provider_id, version, account_holder_name, account_reference_ciphertext,
             verification_reference_ciphertext, account_reference_masked, instructions,
             active_from, rotation_request_id, rotation_reason,
             account_reference_fingerprint, protection_profile_version,
             encryption_key_version, fingerprint_key_version
           ) select provider.id,
               coalesce((select max(existing.version) + 1 from app.receiver_accounts existing
                 where existing.provider_id = provider.id), 1),
               'Synthetic Routine Paid Receiver',
               'receiver-v1.telebirr.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCCCCCCCCCC',
               'synthetic-routine-paid-verification-ciphertext', '***7002',
               jsonb_build_object('customer_message', 'Disposable SQL fixture only'),
               clock_timestamp() - interval '1 minute', gen_random_uuid(),
               'account_rotation', repeat('5', 64), 1, 1, 1
             from app.payment_providers provider where provider.code = 'telebirr'
           returning provider_id as payment_provider_id,
                     id as receiver_account_id, version as receiver_account_version`);
        expect(receiver.rows).toHaveLength(1);
        const telebirr = receiver.rows[0]!;
        const challengeId = randomUUID();
        const candidateId = randomUUID();
        const intentId = randomUUID();
        const fingerprint = createHash('sha256').update(randomUUID()).digest('hex');
        const digest = (value: string) =>
          `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
          [
            challengeId,
            candidateId,
            intentId,
            authorization.authorityId,
            binding.player_account_id,
            telebirr.payment_provider_id,
            telebirr.receiver_account_id,
            telebirr.receiver_account_version,
            fingerprint,
            digest(randomUUID()),
            digest(randomUUID()),
          ],
        );
        const readiness = await client.query<Record<string, boolean>>(
          `select
             player.status = 'active' and player.validation_status = 'valid'
               as player_active,
             platform.status = 'active' as platform_active,
             provider.status = 'active' and provider.code = 'telebirr'
               as provider_active,
             receiver.status = 'active' as receiver_status_active,
             receiver.retired_at is null as receiver_not_retired,
             receiver.active_from <= opening.occurred_at as receiver_active_at_payment,
             policy.freshness_window_seconds = 3600
               and opening.amount_minor between policy.minimum_amount_minor
                                            and policy.maximum_amount_minor as policy_active,
             authority.deposit_policy_version_id = policy.id
               and authority.minimum_amount_minor = policy.minimum_amount_minor
               and authority.maximum_amount_minor = policy.maximum_amount_minor
               and authority.freshness_window_seconds = policy.freshness_window_seconds
               as authority_policy_matches,
             opening.occurred_at >= authority.authorized_at
               and opening.submitted_at >= authority.authorized_at
               as authorized_time,
             exists (select 1 from app.routine_telebirr_processing_events event
               where event.authorization_id = authority.id
                 and event.event_kind = 'authorize'
                 and event.event_sequence = (
                   select max(latest.event_sequence)
                   from app.routine_telebirr_processing_events latest)) as latest_authorize,
             owner_user.role = 'owner' and owner_user.status = 'active'
               as owner_active,
             agent.status = 'active' and agent.platform_id = platform.id
               as agent_active
           from app.routine_telebirr_paid_intent_openings opening
           join app.customer_platform_players player on player.id = opening.player_account_id
           join app.platforms platform on platform.id = player.platform_id
           join app.payment_providers provider on provider.id = opening.payment_provider_id
           join app.receiver_accounts receiver on receiver.id = opening.receiver_account_id
           join app.deposit_policy_versions policy on policy.status = 'active'
           join app.routine_telebirr_processing_authorizations authority
             on authority.id = opening.authorization_id
           join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
           join app.platform_agent_accounts agent on agent.id = authority.platform_agent_account_id
           where opening.challenge_id = $1::uuid`,
          [challengeId],
        );
        expect(readiness.rows).toHaveLength(1);
        expect(Object.entries(readiness.rows[0]!).filter(([, okay]) => !okay)).toEqual([]);
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
          [
            intentId,
            binding.customer_id,
            binding.platform_id,
            binding.player_account_id,
            telebirr.payment_provider_id,
            telebirr.receiver_account_id,
            challengeId,
          ],
        );
        expect(intent.rows[0]!.opened_at).toEqual(insertedOpening.rows[0]!.occurred_at);
        expect(intent.rows[0]!.payment_deadline_at.getTime()).toBe(
          insertedOpening.rows[0]!.occurred_at.getTime() + 3_600_000,
        );
        expect(intent.rows[0]!.expected_amount_minor).toBe('2500');
        expect(intent.rows[0]!.routine_telebirr_paid_opening_challenge_id).toBe(challengeId);
        await rejected(
          client,
          `update app.routine_telebirr_paid_intent_openings
              set amount_minor = 2501 where challenge_id = $1::uuid`,
          [challengeId],
        );
        await rejected(
          client,
          `update app.deposit_intents
              set routine_telebirr_paid_opening_challenge_id = null where id = $1::uuid`,
          [intentId],
        );
        await rejected(
          client,
          `insert into app.deposit_intents (
             customer_id, platform_id, player_account_id, payment_provider_id,
             receiver_account_id, expected_amount_minor,
             routine_telebirr_paid_opening_challenge_id
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                     $5::uuid, 2501, $6::uuid)`,
          [
            binding.customer_id,
            binding.platform_id,
            binding.player_account_id,
            telebirr.payment_provider_id,
            telebirr.receiver_account_id,
            challengeId,
          ],
        );
      } finally {
        await client.query('rollback');
      }
    });
  });
}
