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
const scanProcedure =
  'app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)';

export function registerRoutineTelebirrPaidAtomicClaimSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
  getOwnerAuthUserId: () => string,
): void {
  describe('isolated atomic routine TeleBirr paid claim boundary', () => {
    it('grants only an unprovisioned exact-login runtime the guarded claim capability', async () => {
      const client = getClient();
      const catalog = await client.query<{
        owner: string;
        security_definer: boolean;
        config: string[];
        origin_guard: boolean;
        session_guard: boolean;
        channel_guard_absent: boolean;
      }>(
        `select owner.rolname as owner, routine.prosecdef as security_definer,
                 routine.proconfig as config,
                 pg_catalog.strpos(routine.prosrc, 'sourceOriginAttestation') > 0
                   as origin_guard,
                 pg_catalog.strpos(routine.prosrc,
                   'not app.routine_telebirr_paid_settlement_session_allowed()') > 0
                   as session_guard,
                 pg_catalog.strpos(routine.prosrc, 'paymentChannel') = 0
                   as channel_guard_absent
            from pg_catalog.pg_proc routine
            join pg_catalog.pg_roles owner on owner.oid = routine.proowner
           where routine.oid = $1::pg_catalog.regprocedure`,
        [procedure],
      );
      expect(catalog.rows).toEqual([
        {
          owner: 'postgres',
          security_definer: true,
          config: ['search_path=pg_catalog'],
          origin_guard: true,
          session_guard: true,
          channel_guard_absent: true,
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
              $1::text, 'EXECUTE')
          order by role.rolname`,
        [procedure],
      );
      expect(appGrants.rows).toEqual([
        { role_name: 'fetanagent_routine_telebirr_paid_settlement' },
        { role_name: 'fetanagent_routine_telebirr_paid_settlement_runtime' },
      ]);
      const roles = await client.query<{
        role_name: string;
        can_login: boolean;
        inherits: boolean;
        bypasses_rls: boolean;
        valid_until: Date | null;
        connection_limit: number;
      }>(
        `select rolname as role_name, rolcanlogin as can_login,
                rolinherit as inherits, rolbypassrls as bypasses_rls,
                rolvaliduntil as valid_until, rolconnlimit as connection_limit
           from pg_catalog.pg_roles
          where rolname in ('fetanagent_routine_telebirr_paid_settlement',
            'fetanagent_routine_telebirr_paid_settlement_runtime')
          order by rolname`,
      );
      expect(roles.rows).toEqual([
        {
          role_name: 'fetanagent_routine_telebirr_paid_settlement',
          can_login: false,
          inherits: false,
          bypasses_rls: false,
          valid_until: null,
          connection_limit: 2,
        },
        {
          role_name: 'fetanagent_routine_telebirr_paid_settlement_runtime',
          can_login: false,
          inherits: false,
          bypasses_rls: false,
          valid_until: null,
          connection_limit: 1,
        },
      ]);
      const guard = await client.query<{ permitted: boolean }>(
        `select pg_catalog.has_function_privilege($1::text,
          'app.routine_telebirr_paid_settlement_session_allowed()'::text,
          'EXECUTE') as permitted`,
        ['fetanagent_routine_telebirr_paid_settlement_runtime'],
      );
      expect(guard.rows).toEqual([{ permitted: false }]);
      const surface = await client.query<{
        only_settlement_functions: boolean;
        no_base_object_access: boolean;
      }>(
        `select (
           select count(*) = 2 and pg_catalog.bool_and(routine.oid in
             ($1::pg_catalog.regprocedure, $3::pg_catalog.regprocedure))
             from pg_catalog.pg_proc routine
             join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
            where namespace.nspname not in ('pg_catalog', 'information_schema')
              and namespace.nspname !~ '^pg_(toast|temp)'
              and pg_catalog.has_schema_privilege($2::text, namespace.oid, 'USAGE')
              and pg_catalog.has_function_privilege($2::text, routine.oid, 'EXECUTE')
         ) as only_settlement_functions,
         not exists (
           select 1 from pg_catalog.pg_class relation
             join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
            where namespace.nspname not in ('pg_catalog', 'information_schema')
              and namespace.nspname !~ '^pg_(toast|temp)'
              and pg_catalog.has_schema_privilege($2::text, namespace.oid, 'USAGE')
              and relation.relkind in ('r','p','v','m','f','S')
              and case when relation.relkind = 'S'
                then pg_catalog.has_sequence_privilege($2::text, relation.oid,
                  'USAGE,SELECT,UPDATE')
                else pg_catalog.has_table_privilege($2::text, relation.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
              end
         ) as no_base_object_access`,
        [procedure, 'fetanagent_routine_telebirr_paid_settlement_runtime', scanProcedure],
      );
      expect(surface.rows).toEqual([
        { only_settlement_functions: true, no_base_object_access: true },
      ]);
      const scanGrants = await client.query<{ role_name: string }>(
        `select role.rolname as role_name from pg_catalog.pg_roles role
          where role.rolname like 'fetanagent\\_%' escape '\\'
            and pg_catalog.has_function_privilege(role.rolname,
              $1::text, 'EXECUTE')
          order by role.rolname`,
        [scanProcedure],
      );
      expect(scanGrants.rows).toEqual([
        { role_name: 'fetanagent_routine_telebirr_paid_settlement' },
        { role_name: 'fetanagent_routine_telebirr_paid_settlement_runtime' },
      ]);
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
        const playerId = await fixtureEligiblePlayer(client); // Another customer's eligible Player.
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
          contractVersion: 2,
          providerCode: 'telebirr',
          protocolMode: 'routine_signed_observation_v2',
          transcriptVersion: 'telebirr-routine-observation-transcript-v2',
          bodyDigest: observationBodyDigest,
          signature: 'A'.repeat(86),
          body: {
            contractVersion: 2,
            protocolMode: 'routine_signed_observation_v2',
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
              paymentChannel: 'other',
              paymentMode: 'telebirr',
              paymentReason: 'send_money_to_registered_customer',
              providerFinalStatus: 'completed',
              providerIdentity: 'matched',
              receiverMatch: 'matched',
              referenceMatch: 'matched',
              retrievedAt: data.observed_at.toISOString(),
              sourceProfile: 'telebirr_official_receipt_v1',
              sourceOriginAttestation: 'official_tls_origin',
            },
          },
        };
        const stagingSql = `insert into app.routine_telebirr_paid_observation_staging (
             challenge_id, candidate_id, payment_provider_id, reference_fingerprint,
             source_document_digest, assignment_body_digest, observation_body_digest,
             observation_signature_digest, replay_identity, signed_observation,
             observed_at, occurred_at, amount_minor
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::text,
             $5::text, $6::text, $7::text, $8::text, $9::text, $10::jsonb,
             $11::timestamptz, $12::timestamptz, $13::bigint)`;
        const stagingArgs = [
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
        ];
        // New legacy uploads cannot enter the paid inbox. Existing old rows
        // remain readable during migration, but the finalizer rejects them.
        await client.query('savepoint reject_legacy_origin');
        await expect(
          client.query(stagingSql, [
            ...stagingArgs.slice(0, 9),
            JSON.stringify({
              ...signedObservation,
              contractVersion: 1,
              protocolMode: 'routine_signed_observation_v1',
            }),
            ...stagingArgs.slice(10),
          ]),
        ).rejects.toThrow(/routine_paid_staging_observation_check/iu);
        await client.query('rollback to savepoint reject_legacy_origin');
        await client.query('release savepoint reject_legacy_origin');
        await client.query(stagingSql, stagingArgs);
        const stagedClock = await client.query<{ verification_completed_at_utc: string }>(
          `select pg_catalog.to_char(staged.recorded_at at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as verification_completed_at_utc
             from app.routine_telebirr_paid_observation_staging staged
            where staged.challenge_id = $1::uuid`,
          [challengeId],
        );
        const pending = await client.query<{ challenge_id: string; occurred_at_utc: string }>(
          `select * from app.list_routine_telebirr_paid_settlement_candidates(
            null::timestamptz, null::uuid, 32)`,
        );
        expect(pending.rows).toContainEqual({
          challenge_id: challengeId,
          occurred_at_utc: stagedClock.rows[0]!.verification_completed_at_utc,
        });
        const scanDefinition = await client.query<{ definition: string }>(
          `select pg_catalog.pg_get_functiondef(
             'app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)'
               ::pg_catalog.regprocedure) as definition`,
        );
        expect(scanDefinition.rows[0]!.definition).toContain(
          'order by staged.recorded_at, staged.challenge_id',
        );
        const settled = await client.query<{
          deposit_intent_id: string;
          payment_claim_id: string;
          execution_job_id: string;
          already_finalized: boolean;
        }>(`select * from app.finalize_routine_telebirr_paid_observation($1::uuid)`, [challengeId]);
        expect(settled.rows).toHaveLength(1);
        expect(settled.rows[0]!.already_finalized).toBe(false);
        // Verification/queueing succeeds without a Windows broker lease. Its
        // absence must not erase or disable an already verified payment.
        const offlineQueue = await client.query<{
          worker_recent: boolean;
          live_gates: string;
          queued_jobs: string;
          eligible_jobs: string;
        }>(
          `select app.observe_routine_telebirr_worker_liveness() as worker_recent,
                  (select count(*)::text from app.feature_switches
                    where feature_key in ('payment_verification', 'deposit_execution')
                      and mode = 'live') as live_gates,
                  (select count(*)::text from app.deposit_jobs
                    where id = $1::uuid and status = 'queued' and attempt_count = 0)
                    as queued_jobs,
                  (select count(*)::text from app.assess_routine_telebirr_execution_job(
                    $1::uuid)) as eligible_jobs`,
          [settled.rows[0]!.execution_job_id],
        );
        expect(offlineQueue.rows).toEqual([
          { worker_recent: false, live_gates: '2', queued_jobs: '1', eligible_jobs: '1' },
        ]);
        const replay = await client.query<(typeof settled.rows)[number]>(
          `select * from app.finalize_routine_telebirr_paid_observation($1::uuid)`,
          [challengeId],
        );
        expect(replay.rows).toEqual([{ ...settled.rows[0]!, already_finalized: true }]);
        const noLongerPending = await client.query<{ challenge_id: string }>(
          `select challenge_id from app.list_routine_telebirr_paid_settlement_candidates(
            null::timestamptz, null::uuid, 32) where challenge_id = $1::uuid`,
          [challengeId],
        );
        expect(noLongerPending.rows).toEqual([]);
        const persisted = await client.query<{
          amount_minor: string;
          intent_customer_id: string;
          submitting_customer_id: string;
          player_owner_customer_id: string;
          claim_count: string;
          job_count: string;
          binding_count: string;
          opened_at: Date;
          occurred_at: Date;
          authorization_id: string;
        }>(
          `select evidence.amount_minor, intent.opened_at, evidence.occurred_at,
                  intent.customer_id as intent_customer_id,
                  candidate.submitting_customer_id,
                  player.customer_id as player_owner_customer_id,
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
             join app.routine_telebirr_untrusted_proof_requests candidate
               on candidate.id = opening.candidate_id
             join app.customer_platform_players player on player.id = intent.player_account_id
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
          intent_customer_id: expect.any(String),
          submitting_customer_id: actor.customerId,
          player_owner_customer_id: expect.any(String),
        });
        expect(persisted.rows[0]!.intent_customer_id).toBe(
          persisted.rows[0]!.player_owner_customer_id,
        );
        expect(persisted.rows[0]!.intent_customer_id).not.toBe(actor.customerId);
        expect(persisted.rows[0]!.opened_at).toEqual(persisted.rows[0]!.occurred_at);

        // A second submission is not a known duplicate merely because its
        // protected reference matches an uncompleted prior intent.
        const duplicateEvent = await fixtureInboundEvent(client, actor.identityId);
        const duplicateSubmittedAt = (
          await client.query<{ processed_at: Date }>(
            `update app.inbound_events
                set processed_at = date_trunc('milliseconds', clock_timestamp())
              where id = $1::uuid returning processed_at`,
            [duplicateEvent],
          )
        ).rows[0]!.processed_at;
        const duplicateId = (
          await client.query<{ id: string }>(
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
            [paidId, duplicateEvent, duplicateSubmittedAt],
          )
        ).rows[0]!.id;
        const knownDuplicate = await client.query<{ already_used: boolean }>(
          `select app.routine_telebirr_same_customer_credited_reference($1::uuid)
            as already_used`,
          [duplicateId],
        );
        expect(knownDuplicate.rows).toEqual([{ already_used: false }]);
        const pendingReference = (
          await client.query<{
            candidate_reference_ciphertext: string;
            candidate_reference_fingerprint: string;
            candidate_reference_masked: string;
            semantic_input_hmac: string;
          }>(
            `select candidate_reference_ciphertext, candidate_reference_fingerprint,
                    candidate_reference_masked, semantic_input_hmac
               from app.routine_telebirr_untrusted_proof_requests
              where id = $1::uuid`,
            [duplicateId],
          )
        ).rows[0]!;
        const pendingReplay = await client.query<{
          proof_status: string;
          request_replayed: boolean;
        }>(CAPTURE, [
          duplicateEvent,
          playerId,
          pendingReference.candidate_reference_ciphertext,
          pendingReference.candidate_reference_fingerprint,
          pendingReference.candidate_reference_masked,
          pendingReference.semantic_input_hmac,
        ]);
        expect(pendingReplay.rows).toEqual([
          expect.objectContaining({ proof_status: 'paid_pending', request_replayed: true }),
        ]);
        // Disposable fixture only: advance the prior intent through the
        // real one-shot fence and reconciliation ledger, without KemerBet.
        // A queued intent alone must never mark a repeated reference used.
        const intentId = settled.rows[0]!.deposit_intent_id;
        const executionJobId = settled.rows[0]!.execution_job_id;
        // The routine lease trigger requires the broker's session_user, not
        // just a privileged SQL client. Use a transaction-local definer
        // wrapper so the disposable fixture exercises that identity guard.
        await client.query(`create function pg_temp.lease_duplicate_fixture_job(p_job_id uuid)
          returns void language plpgsql security definer set search_path = pg_catalog
          as $$ begin
            update app.deposit_jobs set status = 'leased', attempt_count = 1,
              lease_token = gen_random_uuid(), leased_by = 'duplicate_sql_test',
              lease_expires_at = clock_timestamp() + interval '5 minutes'
              where id = p_job_id;
          end; $$`);
        await client.query(
          `revoke all on function pg_temp.lease_duplicate_fixture_job(uuid) from public`,
        );
        await client.query(
          `grant execute on function pg_temp.lease_duplicate_fixture_job(uuid)
             to fetanagent_routine_deposit_broker_runtime`,
        );
        // Production grants this membership only when routine transport is
        // explicitly activated. Model that activation within the rolled-back
        // disposable test transaction, without enabling a production login.
        await client.query(
          `grant fetanagent_routine_deposit_broker
             to fetanagent_routine_deposit_broker_runtime`,
        );
        await client.query('set session authorization fetanagent_routine_deposit_broker_runtime');
        try {
          await client.query(`select pg_temp.lease_duplicate_fixture_job($1::uuid)`, [
            executionJobId,
          ]);
        } finally {
          await client.query('reset session authorization');
        }
        const attemptId = (
          await client.query<{ id: string }>(
            `insert into app.deposit_execution_attempts (
               deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
             ) values ($1::uuid, $2::uuid, $3::uuid, 1) returning id`,
            [intentId, executionJobId, authority.accountId],
          )
        ).rows[0]!.id;
        await client.query(
          `update app.deposit_execution_attempts set status = 'final_action_fenced'
             where id = $1::uuid`,
          [attemptId],
        );
        await client.query(
          `update app.deposit_intents set status = 'execution_in_progress'
             where id = $1::uuid`,
          [intentId],
        );
        await client.query(
          `update app.deposit_execution_attempts
             set status = 'reconciliation_required', exact_player_credit_match = true
             where id = $1::uuid`,
          [attemptId],
        );
        await client.query(
          `update app.deposit_intents set status = 'execution_uncertain'
             where id = $1::uuid`,
          [intentId],
        );
        await client.query(
          `update app.deposit_jobs set status = 'succeeded', lease_token = null,
             leased_by = null, lease_expires_at = null, last_error_code = null
             where id = $1::uuid`,
          [executionJobId],
        );
        const reconciliationJobId = (
          await client.query<{ id: string }>(
            `insert into app.deposit_jobs (
               deposit_intent_id, job_kind, job_key, max_attempts
             ) values ($1::uuid, 'reconcile_execution', $2::text, 4) returning id`,
            [intentId, `sql:reconcile:duplicate:${intentId}`],
          )
        ).rows[0]!.id;
        await client.query(
          `update app.deposit_intents set status = 'execution_reconciliation'
             where id = $1::uuid`,
          [intentId],
        );
        await client.query(
          `update app.deposit_jobs set status = 'leased', attempt_count = 1,
             lease_token = gen_random_uuid(), leased_by = 'duplicate_sql_test',
             lease_expires_at = clock_timestamp() + interval '5 minutes'
             where id = $1::uuid`,
          [reconciliationJobId],
        );
        await client.query(
          `insert into app.execution_reconciliations (
             deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
             deposit_job_id, reconciliation_number, outcome, reason_code,
             keyed_external_reference_fingerprint, approved_history_match_count,
             normalized_operation_type, matched_history_occurred_at,
             exact_player_match, exact_amount_match, exact_currency_match,
             exact_player_credit_match
           ) select $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
              'confirmed_executed',
              'agent_deposit_history_in_window_and_player_credit_confirmed',
              $5::text, 1, 'deposit',
              attempt.final_action_fenced_at
                + (attempt.reconciliation_required_at - attempt.final_action_fenced_at) / 2,
              true, true, true, true
             from app.deposit_execution_attempts attempt where attempt.id = $1::uuid`,
          [
            attemptId,
            intentId,
            authority.accountId,
            reconciliationJobId,
            `hmac-sha256-v1:${'a'.repeat(64)}`,
          ],
        );
        await client.query(
          `update app.deposit_jobs set status = 'succeeded', lease_token = null,
             leased_by = null, lease_expires_at = null, last_error_code = null
             where id = $1::uuid`,
          [reconciliationJobId],
        );
        await client.query(
          `update app.deposit_execution_attempts set status = 'confirmed_executed'
             where id = $1::uuid`,
          [attemptId],
        );
        await client.query(
          `update app.deposit_intents set status = 'executed' where id = $1::uuid`,
          [intentId],
        );
        const completedDuplicate = await client.query<{ already_used: boolean }>(
          `select app.routine_telebirr_same_customer_credited_reference($1::uuid)
            as already_used`,
          [duplicateId],
        );
        expect(completedDuplicate.rows).toEqual([{ already_used: true }]);
        const priorReference = (
          await client.query<{
            candidate_reference_ciphertext: string;
            candidate_reference_fingerprint: string;
            candidate_reference_masked: string;
          }>(
            `select candidate_reference_ciphertext, candidate_reference_fingerprint,
                    candidate_reference_masked
               from app.routine_telebirr_untrusted_proof_requests
              where id = $1::uuid`,
            [paidId],
          )
        ).rows[0]!;
        const freshDuplicateEvent = await fixtureInboundEvent(client, actor.identityId);
        const freshDuplicateArgs = [
          freshDuplicateEvent,
          playerId,
          priorReference.candidate_reference_ciphertext,
          priorReference.candidate_reference_fingerprint,
          priorReference.candidate_reference_masked,
          `hmac-sha256-v1:${createHash('sha256').update(randomUUID()).digest('hex')}`,
        ];
        const capturedDuplicate = await client.query<{
          proof_request_id: string;
          proof_status: string;
          request_replayed: boolean;
        }>(CAPTURE, freshDuplicateArgs);
        expect(capturedDuplicate.rows).toMatchObject([
          { proof_status: 'already_used', request_replayed: false },
        ]);
        const replayedDuplicate = await client.query<{
          proof_request_id: string;
          proof_status: string;
          request_replayed: boolean;
        }>(CAPTURE, freshDuplicateArgs);
        expect(replayedDuplicate.rows).toMatchObject([
          {
            proof_request_id: capturedDuplicate.rows[0]!.proof_request_id,
            proof_status: 'already_used',
            request_replayed: true,
          },
        ]);
        const duplicateFinancialArtifacts = await client.query<{
          openings: string;
          jobs: string;
        }>(
          `select (select count(*)::text from app.routine_telebirr_paid_intent_openings
                    where candidate_id = $1::uuid) as openings,
                  (select count(*)::text from app.deposit_jobs job
                    join app.routine_telebirr_paid_intent_openings opening
                      on opening.deposit_intent_id = job.deposit_intent_id
                   where opening.candidate_id = $1::uuid) as jobs`,
          [capturedDuplicate.rows[0]!.proof_request_id],
        );
        expect(duplicateFinancialArtifacts.rows).toEqual([{ openings: '0', jobs: '0' }]);
        const otherActor = await fixtureTelegramActor(client, getOwnerAdminId());
        const otherEvent = await fixtureInboundEvent(client, otherActor.identityId);
        const otherSubmittedAt = (
          await client.query<{ processed_at: Date }>(
            `update app.inbound_events
                set processed_at = date_trunc('milliseconds', clock_timestamp())
              where id = $1::uuid returning processed_at`,
            [otherEvent],
          )
        ).rows[0]!.processed_at;
        const otherCustomerCandidateId = (
          await client.query<{ id: string }>(
            `insert into app.routine_telebirr_untrusted_proof_requests (
               submitting_customer_id, origin_identity_id, origin_channel,
               origin_request_key, semantic_input_hmac, platform_id,
               player_account_id, player_deposit_eligibility_decision_id,
               payment_provider_id, provider_code, candidate_reference_ciphertext,
               candidate_reference_fingerprint, candidate_reference_masked,
               reference_encryption_key_version, reference_profile_version,
               receiver_account_id, receiver_account_version, submitted_at, intake_mode
             ) select $2::uuid, $3::uuid, origin_channel,
                 $4::uuid, semantic_input_hmac, platform_id,
                 player_account_id, player_deposit_eligibility_decision_id,
                 payment_provider_id, provider_code, candidate_reference_ciphertext,
                 candidate_reference_fingerprint, candidate_reference_masked,
                 reference_encryption_key_version, reference_profile_version,
                 receiver_account_id, receiver_account_version, $5::timestamptz, 'paid'
               from app.routine_telebirr_untrusted_proof_requests where id = $1::uuid
             returning id`,
            [paidId, otherActor.customerId, otherActor.identityId, otherEvent, otherSubmittedAt],
          )
        ).rows[0]!.id;
        const crossCustomerDuplicate = await client.query<{ already_used: boolean }>(
          `select app.routine_telebirr_same_customer_credited_reference($1::uuid)
            as already_used`,
          [otherCustomerCandidateId],
        );
        expect(crossCustomerDuplicate.rows).toEqual([{ already_used: false }]);
        const duplicatePoll = await client.query<{ candidate_id: string }>(
          `select candidate_id from app.issue_routine_telebirr_paid_poll_assignment(
            $1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::uuid)`,
          [
            trust.enrollmentId,
            randomUUID(),
            digest(randomUUID()),
            new Date(Date.now() + 30_000),
            trust.signerId,
          ],
        );
        expect(duplicatePoll.rows).toEqual([{ candidate_id: otherCustomerCandidateId }]);
        await client.query('savepoint reject_duplicate_paid_challenge');
        await expect(
          client.query(
            `select * from app.issue_routine_telebirr_paid_lookup_challenge(
            $1::uuid,$2::uuid,$3::uuid)`,
            [duplicateId, trust.enrollmentId, trust.signerId],
          ),
        ).rejects.toThrow();
        await client.query('rollback to savepoint reject_duplicate_paid_challenge');
        await client.query('release savepoint reject_duplicate_paid_challenge');
        await client.query(
          `update app.telegram_deposit_outcome_cutover
              set enabled_at = $1::timestamptz - interval '1 minute',
                  waiting_enabled_at = $1::timestamptz - interval '1 minute',
                  checking_enabled_at = $1::timestamptz - interval '1 minute'
            where singleton = true`,
          [duplicateSubmittedAt],
        );
        await client.query('select * from app.claim_telegram_deposit_outcome_notification()');
        const duplicateDelivery = await client.query<{
          notification_stage: string;
          outcome_code: string;
        }>(
          `select notification_stage, outcome_code
             from app.telegram_deposit_outcome_deliveries
            where candidate_id = $1::uuid`,
          [duplicateId],
        );
        expect(duplicateDelivery.rows).toEqual([
          { notification_stage: 'final', outcome_code: 'already_used' },
        ]);
        const otherDelivery = await client.query<{ outcome_code: string }>(
          `select outcome_code from app.telegram_deposit_outcome_deliveries
            where candidate_id = $1::uuid`,
          [otherCustomerCandidateId],
        );
        expect(otherDelivery.rows).toEqual([{ outcome_code: 'already_used' }]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
