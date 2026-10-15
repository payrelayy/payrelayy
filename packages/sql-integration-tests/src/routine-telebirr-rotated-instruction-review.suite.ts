import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';
import {
  fixtureEligiblePlayer,
  fixtureInboundEvent,
  fixtureTelegramActor,
} from './routine-telebirr-untrusted-proof.suite.js';

const digest = (seed: string = randomUUID()) => createHash('sha256').update(seed).digest('hex');
const at = (base: Date, minutes: number) =>
  new Date(base.getTime() + minutes * 60_000).toISOString();

export function registerRoutineTelebirrRotatedInstructionReviewSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('rotated one-hour TeleBirr instructions require review', () => {
    for (const rotationTiming of ['before_submission', 'after_submission'] as const) {
      it(`holds a same-name old-receiver instruction when rotation is ${rotationTiming}`, async () => {
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
            where provider.code = 'telebirr' group by provider.id`,
          );
          const providerId = provider.rows[0]!.id;
          await client.query(
            `update app.receiver_accounts
              set status = 'inactive',
                  retired_at = greatest(active_from, $2::timestamptz)
            where provider_id = $1::uuid and status = 'active'`,
            [providerId, at(now, -60)],
          );
          const addReceiver = async (
            version: number,
            suffix: string,
            activeFrom: string,
            status: 'active' | 'inactive',
            retiredAt: string | null,
          ) =>
            (
              await client.query<{ id: string }>(
                `insert into app.receiver_accounts (
             provider_id, version, account_holder_name, account_reference_ciphertext,
             account_reference_masked, account_reference_fingerprint,
             protection_profile_version, encryption_key_version, fingerprint_key_version,
             rotation_request_id, rotation_reason, active_from, status, retired_at
           ) values ($1::uuid, $2::integer, 'Same Receiver Name', $3::text,
             $4::text, $5::text, 1, 1, 1, $6::uuid, 'account_rotation',
             $7::timestamptz, $8::app.record_status, $9::timestamptz)
           returning id`,
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
              )
            ).rows[0]!.id;
          const oldReceiverId = await addReceiver(
            provider.rows[0]!.version,
            '7494',
            at(now, -120),
            rotationTiming === 'before_submission' ? 'inactive' : 'active',
            rotationTiming === 'before_submission' ? at(now, -10) : null,
          );
          let newReceiverId: string | null = null;
          if (rotationTiming === 'before_submission') {
            newReceiverId = await addReceiver(
              provider.rows[0]!.version + 1,
              '7002',
              at(now, -10),
              'active',
              null,
            );
          }
          const chat = await client.query<{ private_chat_id: string; conversation_id: string }>(
            `select telegram.private_chat_id::text, conversation.id as conversation_id
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
              at(now, -30),
              at(now, 30),
              authority.authorityId,
            ],
          );
          await client.query(
            `insert into app.telegram_payment_instruction_messages (
             origin_inbound_event_id, private_chat_id, telegram_message_id, expires_at
           ) values ($1::uuid, $2::bigint, 101, $3::timestamptz)`,
            [instructionEvent, chat.rows[0]!.private_chat_id, at(now, 30)],
          );
          const candidateEvent = await fixtureInboundEvent(client, actor.identityId);
          const beforeClaims = (
            await client.query<{ count: number }>(
              'select count(*)::integer as count from app.deposit_payment_claims',
            )
          ).rows[0]!.count;
          await client.query(
            'update app.inbound_events set processed_at = $2::timestamptz where id = $1::uuid',
            [candidateEvent, at(now, -1)],
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
             $7::uuid, $8::uuid, 'telebirr', $9::text, $10::text, '***AB12',
             2, 2, $11::timestamptz, 'paid'
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
              at(now, -1),
            ],
          );
          expect(candidate.rows[0]!.receiver_account_id).toBe(
            rotationTiming === 'before_submission' ? newReceiverId : oldReceiverId,
          );
          if (rotationTiming === 'after_submission') {
            expect(
              (
                await client.query(
                  'select count(*)::integer as count from app.routine_telebirr_rotated_instruction_reviews where candidate_id = $1::uuid',
                  [candidate.rows[0]!.id],
                )
              ).rows[0]!.count,
            ).toBe(0);
            await client.query(
              `update app.receiver_accounts
                set status = 'inactive', retired_at = $2::timestamptz
              where id = $1::uuid`,
              [oldReceiverId, at(now, 0)],
            );
            newReceiverId = await addReceiver(
              provider.rows[0]!.version + 1,
              '7002',
              at(now, 0),
              'active',
              null,
            );
          }
          const review = await client.query<{
            instruction_event_id: string;
            reason_code: string;
          }>(
            `select instruction_event_id, reason_code
             from app.routine_telebirr_rotated_instruction_reviews
            where candidate_id = $1::uuid`,
            [candidate.rows[0]!.id],
          );
          expect(review.rows).toEqual([
            {
              instruction_event_id: instructionEvent,
              reason_code: 'receiver_changed_during_instruction',
            },
          ]);
          const ownerQueue = await client.query<{
            case_id: string;
            player_id: string;
            reference_masked: string;
            instructed_receiver_masked: string;
            candidate_receiver_masked: string;
            reason_code: string;
          }>(
            'select case_id, player_id, reference_masked, ' +
              'instructed_receiver_masked, candidate_receiver_masked, reason_code ' +
              'from app.list_owner_routine_telebirr_receiver_change_reviews($1::uuid, 25) ' +
              'where case_id = $2::uuid',
            [owner.rows[0]!.auth_user_id, candidate.rows[0]!.id],
          );
          expect(ownerQueue.rows).toEqual([
            {
              case_id: candidate.rows[0]!.id,
              player_id: playerId,
              reference_masked: '***AB12',
              instructed_receiver_masked: '***7494',
              candidate_receiver_masked:
                rotationTiming === 'before_submission' ? '***7002' : '***7494',
              reason_code: 'receiver_changed_during_instruction',
            },
          ]);
          const olderPage = await client.query<{ case_id: string }>(
            'select case_id ' +
              'from app.list_owner_routine_telebirr_receiver_change_reviews($1::uuid, 25, $2::uuid) ' +
              'where case_id = $2::uuid',
            [owner.rows[0]!.auth_user_id, candidate.rows[0]!.id],
          );
          expect(olderPage.rows).toEqual([]);
          const ownerAcl = await client.query<{ owner_allowed: boolean; public_allowed: boolean }>(
            'select has_function_privilege(' +
              "'fetanagent_owner_control', " +
              "'app.list_owner_routine_telebirr_receiver_change_reviews(uuid,integer,uuid)', " +
              "'execute') as owner_allowed, " +
              'exists (select 1 from pg_proc procedure, ' +
              'lateral aclexplode(coalesce(procedure.proacl, acldefault(' +
              "'f', procedure.proowner))) acl " +
              'where procedure.oid = ' +
              "'app.list_owner_routine_telebirr_receiver_change_reviews(uuid,integer,uuid)'::regprocedure " +
              "and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as public_allowed",
          );
          expect(ownerAcl.rows).toEqual([{ owner_allowed: true, public_allowed: false }]);
          expect(newReceiverId).toBeTruthy();
          const notification = await client.query<{ outcome_code: string; amount_minor: null }>(
            `select outcome_code, amount_minor
             from app.telegram_deposit_outcome_deliveries
            where candidate_id = $1::uuid and notification_stage = 'final'`,
            [candidate.rows[0]!.id],
          );
          expect(notification.rows).toEqual([
            { outcome_code: 'manual_review', amount_minor: null },
          ]);
          const audit = await client.query<{ count: number }>(
            `select count(*)::integer as count from app.audit_events
              where action = 'deposit.telebirr_receiver_rotation_review_queued'
                and resource_type = 'routine_telebirr_candidate'
                and resource_id = $1::uuid`,
            [candidate.rows[0]!.id],
          );
          expect(audit.rows[0]!.count).toBe(1);
          expect(
            (
              await client.query(
                'select count(*)::integer as count from app.deposit_payment_claims',
              )
            ).rows[0]!.count,
          ).toBe(beforeClaims);
        } finally {
          await client.query('rollback');
        }
      });
    }
  });
}
