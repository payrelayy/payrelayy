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
      }>(
        `select owner.rolname as owner, routine.prosecdef as security_definer,
                 routine.proconfig as config,
                 pg_catalog.strpos(routine.prosrc, 'sourceOriginAttestation') > 0
                   as origin_guard,
                 pg_catalog.strpos(routine.prosrc,
                   'not app.routine_telebirr_paid_settlement_session_allowed()') > 0
                   as session_guard
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
              paymentChannel: 'api_app',
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
      } finally {
        await client.query('rollback');
      }
    });
  });
}
