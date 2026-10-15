import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';
import {
  fixtureEligiblePlayer,
  fixtureInboundEvent,
  fixtureTelegramActor,
} from './routine-telebirr-untrusted-proof.suite.js';

type PreviewRow = {
  disposition: string;
  reason_code: string;
  matched_instruction_event_id: string | null;
  matched_receiver_account_id: string | null;
  financial_action_allowed: boolean;
};

const PREVIEW = `select * from app.preview_routine_telebirr_direct_receiver_grace(
  $1::uuid, $2::text, $3::text, $4::timestamptz)`;

function digest(seed: string = randomUUID()): string {
  return createHash('sha256').update(seed).digest('hex');
}

function isoAt(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

async function receiver(
  client: Client,
  providerId: string,
  version: number,
  suffix: string,
  activeFrom: string,
  status: 'active' | 'inactive' = 'active',
  retiredAt: string | null = null,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into app.receiver_accounts (
       provider_id, version, account_holder_name, account_reference_ciphertext,
       account_reference_masked, account_reference_fingerprint,
       protection_profile_version, encryption_key_version, fingerprint_key_version,
       rotation_request_id, rotation_reason, active_from, status, retired_at
     ) values (
       $1::uuid, $2::integer, 'FetanAgent Grace Fixture', $3::text, $4::text,
       $5::text, 1, 1, 1, $6::uuid, 'account_rotation', $7::timestamptz,
       $8::app.record_status, $9::timestamptz
     ) returning id`,
    [
      providerId,
      version,
      `receiver-v1.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`,
      `***${suffix}`,
      digest(),
      randomUUID(),
      activeFrom,
      status,
      retiredAt,
    ],
  );
  return result.rows[0]!.id;
}

export function registerRoutineTelebirrReceiverGracePreviewSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('advisory-only TeleBirr receiver-rotation preview', () => {
    it('requires one tracked, same-chat/Player instruction and never grants money authority', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const now = (await client.query<{ at: Date }>('select clock_timestamp() as at')).rows[0]!
          .at;
        const owner = await client.query<{ auth_user_id: string }>(
          'select auth_user_id from app.admin_users where id = $1::uuid',
          [getOwnerAdminId()],
        );
        const authority = await persistentPolicyFixture(client, owner.rows[0]!.auth_user_id);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId(), false);
        const playerId = await fixtureEligiblePlayer(client);
        const player = await client.query<{
          id: string;
          platform_id: string;
          decision_id: string;
        }>(
          `select player.id, player.platform_id, decision.id as decision_id
             from app.customer_platform_players player
             join app.player_deposit_eligibility_decisions decision
               on decision.player_account_id = player.id
            where player.player_id = $1::text and decision.decision = 'eligible'`,
          [playerId],
        );
        const provider = await client.query<{ id: string; version: number }>(
          `select provider.id,
                  coalesce(max(receiver.version), 0)::integer + 1 as version
             from app.payment_providers provider
             left join app.receiver_accounts receiver on receiver.provider_id = provider.id
            where provider.code = 'telebirr'
            group by provider.id`,
        );
        const providerId = provider.rows[0]!.id;
        // Make the fixture independent from other tests that might seed an active receiver.
        await client.query(
          `update app.receiver_accounts
              set status = 'inactive',
                  retired_at = greatest(active_from, $2::timestamptz)
            where provider_id = $1::uuid and status = 'active'`,
          [providerId, isoAt(now, -60)],
        );
        const oldReceiverId = await receiver(
          client,
          providerId,
          provider.rows[0]!.version,
          '7494',
          isoAt(now, -120),
        );
        const chat = await client.query<{ private_chat_id: string; conversation_id: string }>(
          `select telegram.private_chat_id::text,
                  conversation.id as conversation_id
             from app.telegram_identities telegram
             join app.bot_conversations conversation
               on conversation.telegram_identity_id = telegram.customer_identity_id
            where telegram.customer_identity_id = $1::uuid`,
          [actor.identityId],
        );
        const instructionEvent = await fixtureInboundEvent(client, actor.identityId);
        await client.query(
          `insert into app.telegram_telebirr_destination_receipts (
             origin_inbound_event_id, customer_identity_id, customer_id,
             conversation_id, player_account_id, receiver_account_id,
             semantic_input_hmac, created_at, payment_presentation_expires_at,
             routine_processing_authorization_id
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
             $7::text, $8::timestamptz, $9::timestamptz, $10::uuid)`,
          [
            instructionEvent,
            actor.identityId,
            actor.customerId,
            chat.rows[0]!.conversation_id,
            player.rows[0]!.id,
            oldReceiverId,
            `hmac-sha256-v1:${digest()}`,
            isoAt(now, -30),
            isoAt(now, 30),
            authority.authorityId,
          ],
        );
        const candidateEvent = await fixtureInboundEvent(client, actor.identityId);
        await client.query(
          `update app.inbound_events set processed_at = $2::timestamptz where id = $1::uuid`,
          [candidateEvent, isoAt(now, -1)],
        );
        await client.query(
          `update app.receiver_accounts set status = 'inactive', retired_at = $2::timestamptz
            where id = $1::uuid`,
          [oldReceiverId, isoAt(now, -10)],
        );
        const activeReceiverId = await receiver(
          client,
          providerId,
          provider.rows[0]!.version + 1,
          '7002',
          isoAt(now, -10),
        );
        const candidate = await client.query<{ id: string; receiver_account_id: string }>(
          `insert into app.routine_telebirr_untrusted_proof_requests (
             submitting_customer_id, origin_identity_id, origin_channel, origin_request_key,
             semantic_input_hmac, platform_id, player_account_id,
             player_deposit_eligibility_decision_id, payment_provider_id, provider_code,
             candidate_reference_ciphertext, candidate_reference_fingerprint,
             candidate_reference_masked, reference_encryption_key_version,
             reference_profile_version, submitted_at, intake_mode
           ) values (
             $1::uuid, $2::uuid, 'telegram', $3::uuid, $4::text, $5::uuid, $6::uuid,
             $7::uuid, $8::uuid, 'telebirr', $9::text, $10::text, '***AB12', 2, 2,
             $11::timestamptz, 'paid'
           ) returning id, receiver_account_id`,
          [
            actor.customerId,
            actor.identityId,
            candidateEvent,
            `hmac-sha256-v1:${digest()}`,
            player.rows[0]!.platform_id,
            player.rows[0]!.id,
            player.rows[0]!.decision_id,
            providerId,
            `v2.telebirr.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(16)}`,
            digest(),
            isoAt(now, -1),
          ],
        );
        expect(candidate.rows[0]!.receiver_account_id).toBe(activeReceiverId);
        const candidateId = candidate.rows[0]!.id;
        const name = await client.query<{ digest: string }>(
          `select app.routine_telebirr_receiver_name_digest('FetanAgent Grace Fixture') as digest`,
        );
        const args = [candidateId, name.rows[0]!.digest, '7494', isoAt(now, -5)] as const;
        const preview = async (values: readonly (string | null)[]) =>
          (await client.query<PreviewRow>(PREVIEW, [...values])).rows[0]!;
        const before = await client.query(`select
          (select count(*)::integer from app.deposit_payment_claims) as claims,
          (select count(*)::integer from app.deposit_jobs) as jobs`);

        // A destination row alone is not proof that the bot actually showed instructions.
        expect((await preview(args)).reason_code).toBe('instruction_not_found');
        await client.query(
          `insert into app.telegram_payment_instruction_messages (
             origin_inbound_event_id, private_chat_id, telegram_message_id, expires_at
           ) values ($1::uuid, $2::bigint, 101, $3::timestamptz)`,
          [instructionEvent, chat.rows[0]!.private_chat_id, isoAt(now, 30)],
        );
        expect(await preview(args)).toEqual({
          disposition: 'would_match_one_instruction',
          reason_code: 'one_instruction_matches',
          matched_instruction_event_id: instructionEvent,
          matched_receiver_account_id: oldReceiverId,
          financial_action_allowed: false,
        });
        expect(
          (await preview([candidateId, name.rows[0]!.digest, '9999', isoAt(now, -5)])).reason_code,
        ).toBe('receiver_mismatch');
        await client.query('savepoint receiver_suffix_collision');
        await receiver(
          client,
          providerId,
          provider.rows[0]!.version + 2,
          '7494',
          isoAt(now, -120),
          'inactive',
          isoAt(now, -10),
        );
        expect((await preview(args)).reason_code).toBe('receiver_ambiguous');
        await client.query('rollback to savepoint receiver_suffix_collision');
        await client.query('release savepoint receiver_suffix_collision');
        expect(
          (await preview([candidateId, name.rows[0]!.digest, null, isoAt(now, -5)])).reason_code,
        ).toBe('invalid_input');
        expect(
          (await preview([candidateId, name.rows[0]!.digest, '7494', isoAt(now, 30)])).reason_code,
        ).toBe('candidate_unavailable');

        const secondInstruction = await fixtureInboundEvent(client, actor.identityId);
        await client.query(
          `insert into app.telegram_telebirr_destination_receipts (
             origin_inbound_event_id, customer_identity_id, customer_id,
             conversation_id, player_account_id, receiver_account_id,
             semantic_input_hmac, created_at, payment_presentation_expires_at,
             routine_processing_authorization_id
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
             $7::text, $8::timestamptz, $9::timestamptz, $10::uuid)`,
          [
            secondInstruction,
            actor.identityId,
            actor.customerId,
            chat.rows[0]!.conversation_id,
            player.rows[0]!.id,
            oldReceiverId,
            `hmac-sha256-v1:${digest()}`,
            isoAt(now, -20),
            isoAt(now, 40),
            authority.authorityId,
          ],
        );
        await client.query(
          `insert into app.telegram_payment_instruction_messages (
             origin_inbound_event_id, private_chat_id, telegram_message_id, expires_at
           ) values ($1::uuid, $2::bigint, 102, $3::timestamptz)`,
          [secondInstruction, chat.rows[0]!.private_chat_id, isoAt(now, 40)],
        );
        expect((await preview(args)).reason_code).toBe('instruction_ambiguous');
        await client.query(
          `insert into app.routine_telebirr_receiver_grace_revocations (
             receiver_account_id, revoked_by_admin_id, reason_code
           ) values ($1::uuid, $2::uuid, 'emergency_stop')`,
          [oldReceiverId, getOwnerAdminId()],
        );
        expect((await preview(args)).reason_code).toBe('emergency_revoked');
        expect(
          (
            await client.query(`select
          (select count(*)::integer from app.deposit_payment_claims) as claims,
          (select count(*)::integer from app.deposit_jobs) as jobs`)
          ).rows,
        ).toEqual(before.rows);
        const privilege = await client.query<{ permitted: boolean }>(
          `select has_function_privilege('fetanagent_player_actions',
            'app.preview_routine_telebirr_direct_receiver_grace(uuid,text,text,timestamptz)',
            'EXECUTE') as permitted`,
        );
        expect(privilege.rows).toEqual([{ permitted: false }]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
