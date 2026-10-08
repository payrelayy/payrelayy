import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';
import {
  CAPTURE,
  captureArguments,
  fixtureEligiblePlayer,
  fixtureInboundEvent,
  fixtureRoutineLookupTrust,
  fixtureTelegramActor,
  fixtureTelebirrReceiver,
} from './routine-telebirr-untrusted-proof.suite.js';

const procedure = 'app.finalize_routine_telebirr_paid_observation(uuid)';

export function registerRoutineTelebirrPaidAtomicClaimSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
  getOwnerAuthUserId: () => string,
): void {
  describe('dormant atomic routine TeleBirr paid claim boundary', () => {
    it('is invoker-only and grants no runtime a claim capability', async () => {
      const client = getClient();
      const catalog = await client.query<{
        owner: string;
        security_definer: boolean;
        config: string[];
      }>(
        `select owner.rolname as owner, routine.prosecdef as security_definer,
                 routine.proconfig as config
            from pg_catalog.pg_proc routine
            join pg_catalog.pg_roles owner on owner.oid = routine.proowner
           where routine.oid = $1::pg_catalog.regprocedure`,
        [procedure],
      );
      expect(catalog.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: false,
          config: ['search_path=pg_catalog'],
        },
      ]);
      for (const role of [
        'public',
        'anon',
        'authenticated',
        'service_role',
        'fetanagent_routine_telebirr_paid_poll_runtime',
        'fetanagent_routine_deposit_broker_runtime',
        'fetanagent_deposit_executor_runtime',
        'fetanagent_trusted_telebirr_verifier_runtime',
        'fetanagent_verification_settlement_runtime',
      ]) {
        const grant = await client.query<{ permitted: boolean }>(
          `select pg_catalog.has_function_privilege($1::text, $2::text, 'EXECUTE')
             as permitted`,
          [role, procedure],
        );
        expect(grant.rows).toEqual([{ permitted: false }]);
      }
      const appGrants = await client.query<{ role_name: string }>(
        `select role.rolname as role_name from pg_catalog.pg_roles role
          where role.rolname like 'fetanagent\\_%' escape '\\'
            and pg_catalog.has_function_privilege(role.rolname,
              $1::text, 'EXECUTE')`,
        [procedure],
      );
      expect(appGrants.rows).toEqual([]);
    });

    it('cannot create a claim while production-style financial gates are off', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(`update app.feature_switches set mode = 'disabled',
          settings = '{}'::jsonb where feature_key in
          ('deposit_execution', 'payment_verification',
           'private_live_deposit_pilot', 'telebirr_authoritative_verification')`);
        const before = await client.query<{ openings: string; claims: string; jobs: string }>(
          `select
             (select count(*)::text from app.routine_telebirr_paid_intent_openings) as openings,
             (select count(*)::text from app.deposit_payment_claims) as claims,
             (select count(*)::text from app.deposit_jobs where job_kind = 'execute_deposit') as jobs`,
        );
        await client.query('savepoint stopped_paid_claim');
        await expect(
          client.query('select * from app.finalize_routine_telebirr_paid_observation($1::uuid)', [
            randomUUID(),
          ]),
        ).rejects.toThrow(/routine paid settlement is stopped/iu);
        await client.query('rollback to savepoint stopped_paid_claim');
        await client.query('release savepoint stopped_paid_claim');
        const after = await client.query<{ openings: string; claims: string; jobs: string }>(
          `select
             (select count(*)::text from app.routine_telebirr_paid_intent_openings) as openings,
             (select count(*)::text from app.deposit_payment_claims) as claims,
             (select count(*)::text from app.deposit_jobs where job_kind = 'execute_deposit') as jobs`,
        );
        expect(after.rows).toEqual(before.rows);
      } finally {
        await client.query('rollback');
      }
    });

    it('atomically creates one receipt-amount claim, job, and routine binding; replays exactly', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query(`update app.feature_switches set mode = 'disabled', settings = '{}'::jsonb
          where feature_key in ('deposit_execution', 'payment_verification',
            'private_live_deposit_pilot', 'telebirr_authoritative_verification')`);
        const actor = await fixtureTelegramActor(client, getOwnerAdminId());
        const playerId = await fixtureEligiblePlayer(client, actor.customerId);
        await fixtureTelebirrReceiver(client);
        const noMoneyEvent = await fixtureInboundEvent(client, actor.identityId);
        const captured = await client.query<{ proof_request_id: string }>(CAPTURE, [
          ...captureArguments(noMoneyEvent, playerId),
        ]);
        const noMoneyId = captured.rows[0]!.proof_request_id;
        const authority = await persistentPolicyFixture(client, getOwnerAuthUserId());
        const paidEvent = await fixtureInboundEvent(client, actor.identityId);
        const submitted = await client.query<{ submitted_at: Date }>(
          `update app.inbound_events
              set processed_at = date_trunc('milliseconds', clock_timestamp())
            where id = $1::uuid returning processed_at as submitted_at`,
          [paidEvent],
        );
        const paid = await client.query<{ id: string }>(
          `insert into app.routine_telebirr_untrusted_proof_requests (
             submitting_customer_id, origin_identity_id, origin_channel,
             origin_request_key, semantic_input_hmac, platform_id,
             player_account_id, player_deposit_eligibility_decision_id,
             payment_provider_id, provider_code, candidate_reference_ciphertext,
             candidate_reference_fingerprint, candidate_reference_masked,
             reference_encryption_key_version, reference_profile_version,
             receiver_account_id, receiver_account_version, submitted_at, intake_mode
           ) select submitting_customer_id, origin_identity_id, origin_channel,
               $2::uuid, semantic_input_hmac, platform_id,
               player_account_id, player_deposit_eligibility_decision_id,
               payment_provider_id, provider_code, candidate_reference_ciphertext,
               candidate_reference_fingerprint, candidate_reference_masked,
               reference_encryption_key_version, reference_profile_version,
               receiver_account_id, receiver_account_version, $3::timestamptz, 'paid'
             from app.routine_telebirr_untrusted_proof_requests where id = $1::uuid
           returning id`,
          [noMoneyId, paidEvent, submitted.rows[0]!.submitted_at],
        );
        const paidId = paid.rows[0]!.id;
        const trust = await fixtureRoutineLookupTrust(client, paidId);
        await client.query(`update app.feature_switches set mode = 'live'
          where feature_key in ('deposit_execution', 'payment_verification')`);
        const issued = await client.query<{
          challenge_id: string;
          challenge_digest: string;
        }>(
          `select challenge_id, challenge_digest
             from app.issue_routine_telebirr_paid_lookup_challenge($1::uuid,$2::uuid,$3::uuid)`,
          [paidId, trust.enrollmentId, trust.signerId],
        );
        const challengeId = issued.rows[0]!.challenge_id;
        const exact = await client.query<{
          amount_minor: string;
          payment_provider_id: string;
          reference_fingerprint: string;
          receiver_account_id: string;
          receiver_account_version: number;
          observed_at: Date;
          occurred_at: Date;
        }>(
          `select 2500::bigint as amount_minor, candidate.payment_provider_id,
                  candidate.candidate_reference_fingerprint as reference_fingerprint,
                  receiver.id as receiver_account_id, receiver.version as receiver_account_version,
                  date_trunc('milliseconds', clock_timestamp()) as observed_at,
                  candidate.submitted_at as occurred_at
             from app.routine_telebirr_untrusted_proof_requests candidate
             join app.receiver_accounts receiver on receiver.id = candidate.receiver_account_id
            where candidate.id = $1::uuid`,
          [paidId],
        );
        const data = exact.rows[0]!;
        const digest = (seed: string) =>
          `sha256:${createHash('sha256').update(seed).digest('hex')}`;
        const observationBodyDigest = digest(randomUUID());
        const sourceDocumentDigest = digest(randomUUID());
        // Privileged disposable SQL fixture: only the bridge verifies a real phone signature.
        // The settlement function can consume this private inbox but cannot insert into it.
        const signedObservation = {
          contractVersion: 1,
          providerCode: 'telebirr',
          protocolMode: 'routine_signed_observation_v1',
          bodyDigest: observationBodyDigest,
          signature: 'A'.repeat(86),
          body: {
            candidateId: paidId,
            challengeId,
            challengeDigest: issued.rows[0]!.challenge_digest,
            referenceFingerprint: data.reference_fingerprint,
            receiverRevisionId: data.receiver_account_id,
            receiverVersion: data.receiver_account_version,
            receiverProfileDigest: trust.receiverProfileDigest,
            expectedReceiverNameDigest: trust.expectedReceiverNameDigest,
            deviceId: trust.deviceId,
            keyId: trust.deviceKeyId,
            sourceDocumentDigest,
            observedAt: data.observed_at.toISOString(),
            facts: {
              amountMinor: Number(data.amount_minor),
              canonicalReferencePresent: true,
              creditedPartyNameDigest: trust.expectedReceiverNameDigest,
              currencyCode: 'ETB',
              evidenceSource: 'provider_receipt_lookup',
              occurredAt: data.occurred_at.toISOString(),
              paymentChannel: 'api_app',
              paymentMode: 'telebirr',
              paymentReason: 'send_money_to_registered_customer',
              providerFinalStatus: 'completed',
              providerIdentity: 'matched',
              receiverMatch: 'matched',
              referenceMatch: 'matched',
              retrievedAt: data.observed_at.toISOString(),
              sourceProfile: 'telebirr_official_receipt_v1',
            },
          },
        };
        await client.query(
          `insert into app.routine_telebirr_paid_observation_staging (
             challenge_id, candidate_id, payment_provider_id, reference_fingerprint,
             source_document_digest, assignment_body_digest, observation_body_digest,
             observation_signature_digest, replay_identity, signed_observation,
             observed_at, occurred_at, amount_minor
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::text,
             $5::text, $6::text, $7::text, $8::text, $9::text, $10::jsonb,
             $11::timestamptz, $12::timestamptz, $13::bigint)`,
          [
            challengeId,
            paidId,
            data.payment_provider_id,
            data.reference_fingerprint,
            sourceDocumentDigest,
            digest(randomUUID()),
            observationBodyDigest,
            digest(randomUUID()),
            digest(randomUUID()),
            JSON.stringify(signedObservation),
            data.observed_at,
            data.occurred_at,
            data.amount_minor,
          ],
        );
        const settled = await client.query<{
          deposit_intent_id: string;
          payment_claim_id: string;
          execution_job_id: string;
          already_finalized: boolean;
        }>(`select * from app.finalize_routine_telebirr_paid_observation($1::uuid)`, [challengeId]);
        expect(settled.rows).toHaveLength(1);
        expect(settled.rows[0]!.already_finalized).toBe(false);
        const replay = await client.query<(typeof settled.rows)[number]>(
          `select * from app.finalize_routine_telebirr_paid_observation($1::uuid)`,
          [challengeId],
        );
        expect(replay.rows).toEqual([{ ...settled.rows[0]!, already_finalized: true }]);
        const persisted = await client.query<{
          amount_minor: string;
          claim_count: string;
          job_count: string;
          binding_count: string;
          opened_at: Date;
          occurred_at: Date;
          authorization_id: string;
        }>(
          `select evidence.amount_minor, intent.opened_at, evidence.occurred_at,
                  (select count(*)::text from app.deposit_payment_claims claim
                    where claim.deposit_intent_id = intent.id) as claim_count,
                  (select count(*)::text from app.deposit_jobs job
                    where job.deposit_intent_id = intent.id and job.job_kind = 'execute_deposit')
                    as job_count,
                  (select count(*)::text from app.routine_telebirr_execution_bindings binding
                    where binding.deposit_intent_id = intent.id) as binding_count,
                  opening.authorization_id
             from app.deposit_intents intent
             join app.routine_telebirr_paid_intent_openings opening
               on opening.deposit_intent_id = intent.id
             join app.deposit_payment_claims claim on claim.deposit_intent_id = intent.id
             join app.provider_payment_evidence evidence on evidence.id = claim.provider_payment_evidence_id
            where intent.id = $1::uuid`,
          [settled.rows[0]!.deposit_intent_id],
        );
        expect(persisted.rows).toHaveLength(1);
        expect(persisted.rows[0]).toMatchObject({
          amount_minor: '2500',
          claim_count: '1',
          job_count: '1',
          binding_count: '1',
          authorization_id: authority.authorityId,
        });
        expect(persisted.rows[0]!.opened_at).toEqual(persisted.rows[0]!.occurred_at);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
