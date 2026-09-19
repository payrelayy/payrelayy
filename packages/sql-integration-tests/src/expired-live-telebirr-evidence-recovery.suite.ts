import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  prepareTelebirrPilot,
  prepareVerification,
} from './private-live-telebirr-proof-lineage.suite.js';

const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

async function withRollback(client: Client, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
  } finally {
    await client.query('rollback');
  }
}

export function registerExpiredLiveTelebirrEvidenceRecoverySqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('expired live TeleBirr evidence recovery', () => {
    it('keeps the post-emergency source-binding predicate lock-free', async () => {
      const client = getClient();
      const definition = await client.query<{
        readonly has_legacy_locking_helper: boolean;
        readonly has_row_lock: boolean;
        readonly is_security_definer: boolean;
        readonly volatility: string;
      }>(
        `select routine.prosrc like
                  '%current_private_trusted_telebirr_activation_epoch()%' as has_legacy_locking_helper,
                routine.prosrc ~* E'\\\\mfor\\\\s+(share|update)\\\\M' as has_row_lock,
                routine.prosecdef as is_security_definer,
                routine.provolatile::text as volatility
           from pg_catalog.pg_proc routine
          where routine.oid =
            'app.is_private_live_telebirr_source_binding_post_emergency_ready(uuid)'::regprocedure`,
      );

      expect(definition.rows).toEqual([
        {
          has_legacy_locking_helper: false,
          has_row_lock: false,
          is_security_definer: true,
          volatility: 's',
        },
      ]);
    });

    it('compiles the reviewed source-binding retry guard as one 12-hour sidecar', async () => {
      const client = getClient();
      const scramVerifier =
        `SCRAM-SHA-256$4096:${'A'.repeat(22)}==` + `$${'B'.repeat(43)}=:${'C'.repeat(43)}=`;

      await client.query('begin');
      try {
        const constraint = await client.query<{ readonly definition: string }>(`
          select pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
            from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid =
                 'app.private_live_telebirr_source_binding_recovery_retries'::regclass
             and constraint_row.conname =
                 'private_live_tbirr_source_binding_retry_window'
        `);
        expect(constraint.rows).toHaveLength(1);
        expect(constraint.rows[0]!.definition).toContain('12:00:00');

        let failure: unknown;
        try {
          await client.query(
            `select *
               from app.arm_private_live_telebirr_source_binding_recovery(
                 $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text, $6::text
               )`,
            [
              '00000000-0000-4000-8000-000000000021',
              '00000000-0000-4000-8000-000000000022',
              '1',
              '00000000-0000-4000-8000-000000000023',
              scramVerifier,
              'source_binding_supersession_after_nonfinancial_review',
            ],
          );
        } catch (error) {
          failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          'The reviewed TeleBirr source binding is not recoverable.',
        );
        expect((failure as Error).message).not.toContain('ambiguous');
      } finally {
        await client.query('rollback');
      }
    });

    it('compiles the one-attempt 12-hour arming guard without ambiguous references', async () => {
      const client = getClient();
      const scramVerifier =
        `SCRAM-SHA-256$4096:${'A'.repeat(22)}==` + `$${'B'.repeat(43)}=:${'C'.repeat(43)}=`;

      await client.query('begin');
      try {
        const constraint = await client.query<{ readonly definition: string }>(`
          select pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
            from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid =
                 'app.private_live_telebirr_historical_completion_authorities'::regclass
             and constraint_row.conname =
                 'private_live_telebirr_historical_completion_window'
        `);
        expect(constraint.rows).toHaveLength(1);
        expect(constraint.rows[0]!.definition).toContain('12:00:00');

        let failure: unknown;
        try {
          await client.query(
            `select *
               from app.arm_private_live_telebirr_staged_attempt_completion(
                 $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text, $6::text
               )`,
            [
              '00000000-0000-4000-8000-000000000011',
              '00000000-0000-4000-8000-000000000012',
              '1',
              '00000000-0000-4000-8000-000000000013',
              scramVerifier,
              'expired_attempt_staged_evidence_completion',
            ],
          );
        } catch (error) {
          failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          'The staged TeleBirr evidence is not recoverable.',
        );
        expect((failure as Error).message).not.toContain('ambiguous');
      } finally {
        await client.query('rollback');
      }
    });

    it('compiles the historical arming guard without ambiguous local references', async () => {
      const client = getClient();
      const scramVerifier =
        `SCRAM-SHA-256$4096:${'A'.repeat(22)}==` + `$${'B'.repeat(43)}=:${'C'.repeat(43)}=`;

      await client.query('begin');
      try {
        let failure: unknown;
        try {
          await client.query(
            `select *
               from app.arm_private_live_telebirr_historical_completion(
                 $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text, $6::text
               )`,
            [
              '00000000-0000-4000-8000-000000000001',
              '00000000-0000-4000-8000-000000000002',
              '1',
              '00000000-0000-4000-8000-000000000003',
              scramVerifier,
              'expired_authority_staged_evidence_completion',
            ],
          );
        } catch (error) {
          failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          'The expired TeleBirr evidence is not recoverable.',
        );
        expect((failure as Error).message).not.toContain('ambiguous');
      } finally {
        await client.query('rollback');
      }
    });

    it('recognizes one exact source-binding authority after an early emergency stop', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const ownerAdminId = getOwnerAdminId();
        const pilot = await prepareTelebirrPilot(client, ownerAdminId);
        const prepared = await prepareVerification(client, pilot);
        const attempt = await client.query<{
          readonly assignment_body_digest: string;
          readonly assignment_transcript_id: string;
          readonly issued_at: Date;
        }>(
          `select transcript.assignment_body_digest,
                  transcript.id as assignment_transcript_id,
                  attempt.issued_at
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_transcripts transcript
               on transcript.verification_attempt_id = attempt.id
            where attempt.id = $1::uuid`,
          [prepared.lease.verification_attempt_id],
        );
        expect(attempt.rows).toHaveLength(1);

        const observationBodyDigest = sha256(`post-emergency-observation:${randomUUID()}`);
        const sourceDocumentDigest = sha256(`post-emergency-document:${randomUUID()}`);
        const observedAt = new Date(attempt.rows[0]!.issued_at.getTime() + 1);
        const stagedAt = new Date(attempt.rows[0]!.issued_at.getTime() + 2);
        const expiredAt = new Date(attempt.rows[0]!.issued_at.getTime() + 20);

        await client.query(
          `insert into app.private_live_telebirr_device_evidence_staging (
             observation_body_digest,
             assignment_body_digest,
             verification_attempt_id,
             assignment_transcript_id,
             device_enrollment_id,
             first_request_body_digest,
             signed_assignment,
             signed_observation,
             observed_at,
             staged_at
           ) values (
             $1::text, $2::text, $3::uuid, $4::uuid, $5::uuid, $6::text,
             '{}'::jsonb,
             jsonb_build_object(
               'body', jsonb_build_object('sourceDocumentDigest', $7::text)
             ),
             $8::timestamptz, $9::timestamptz
           )`,
          [
            observationBodyDigest,
            attempt.rows[0]!.assignment_body_digest,
            prepared.lease.verification_attempt_id,
            attempt.rows[0]!.assignment_transcript_id,
            pilot.deviceEnrollmentId,
            sha256(`post-emergency-upload:${randomUUID()}`),
            sourceDocumentDigest,
            observedAt,
            stagedAt,
          ],
        );

        const activation = await client.query<{ readonly epoch: string }>(`
          select current_epoch::text as epoch
            from app.private_trusted_telebirr_activation_control
           where control_key = 'trusted_telebirr_financial_authority'
        `);
        expect(activation.rows).toHaveLength(1);

        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_live_deposit_pilot_proofs
              set origin_channel = 'telegram'
            where id = $1::uuid`,
          [prepared.proof.id],
        );
        await client.query(
          `update app.private_live_telebirr_verification_jobs
              set expires_at = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, prepared.stage.verification_job_id],
        );
        await client.query(
          `update app.private_live_telebirr_verification_attempts
              set expires_at = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, prepared.lease.verification_attempt_id],
        );
        await client.query("set local session_replication_role = 'origin'");
        await client.query('select pg_catalog.pg_sleep(0.05)');

        const authorityRequestKey = randomUUID();
        await client.query(
          `with boundary as materialized (
             select pg_catalog.clock_timestamp() as authorized_at
           )
           insert into app.private_live_telebirr_historical_completion_authorities (
             request_key,
             verification_job_id,
             verification_attempt_id,
             private_live_deposit_pilot_proof_id,
             pilot_revision_id,
             receiver_profile_id,
             expired_activation_epoch,
             observation_body_digest,
             source_document_digest,
             reason_code,
             request_digest,
             authorized_at,
             expires_at
           )
           select $1::uuid,
                  $2::uuid,
                  $3::uuid,
                  $4::uuid,
                  $5::uuid,
                  $6::uuid,
                  $7::bigint,
                  $8::text,
                  $9::text,
                  'expired_attempt_staged_evidence_completion',
                  app.private_live_telebirr_historical_completion_digest(
                    $1::uuid, $2::uuid, $3::uuid, $5::uuid, $7::bigint,
                    $8::text, $9::text, boundary.authorized_at,
                    boundary.authorized_at + interval '12 hours',
                    'expired_attempt_staged_evidence_completion'
                  ),
                  boundary.authorized_at,
                  boundary.authorized_at + interval '12 hours'
             from boundary`,
          [
            authorityRequestKey,
            prepared.stage.verification_job_id,
            prepared.lease.verification_attempt_id,
            prepared.proof.id,
            pilot.pilotRevisionId,
            pilot.receiverProfileId,
            activation.rows[0]!.epoch,
            observationBodyDigest,
            sourceDocumentDigest,
          ],
        );
        await client.query(
          `select *
             from app.close_private_live_telebirr_historical_completion(
               $1::uuid, 'operator_stop'
             )`,
          [authorityRequestKey],
        );
        await client.query('select pg_catalog.pg_sleep(0.005)');
        await client.query(
          `select *
             from app.request_private_trusted_telebirr_emergency_disable(
               $1::uuid, $2::bigint, $3::uuid, 'execution_uncertainty'
             )`,
          [ownerAdminId, activation.rows[0]!.epoch, randomUUID()],
        );

        const boundary = await client.query<{
          readonly activation_ready: boolean;
          readonly all_disabled_switches: number;
          readonly authority_ready: boolean;
          readonly boundary_rows: number;
          readonly current_authority: string | null;
          readonly evidence_ready: boolean;
          readonly lineage_ready: boolean;
          readonly pilot_ready: boolean;
          readonly post_emergency_ready: boolean;
        }>(
          `with boundary_rows as materialized (
             select authority.*, job.id as job_id, job.pilot_revision_id as job_pilot_id,
                    job.pilot_configuration_digest as job_configuration_digest,
                    job.receiver_profile_id as job_receiver_profile_id,
                    attempt.id as attempt_id,
                    attempt.verification_job_id as attempt_job_id,
                    attempt.issued_at as attempt_issued_at,
                    attempt.expires_at as attempt_expires_at,
                    staged.observation_body_digest as staged_observation_digest,
                    staged.signed_observation as staged_observation,
                    staged.observed_at, staged.staged_at,
                    proof.id as proof_id, proof.pilot_revision_id as proof_pilot_id,
                    proof.origin_channel, proof.input_kind, proof.submitted_at,
                    pilot.id as pilot_id, pilot.configuration_digest,
                    pilot.active_from as pilot_active_from,
                    pilot.expires_at as pilot_expires_at,
                    pilot.status as pilot_status, pilot.stopped_at,
                    pilot.stopped_by_admin_id, pilot.stop_reason_code,
                    control.current_epoch,
                    activation.authority_state, activation.pilot_revision_id as activation_pilot_id,
                    activation.configuration_digest as activation_configuration_digest,
                    activation.active_from as activation_active_from,
                    activation.expires_at as activation_expires_at,
                    activation.revoked_at, activation.revocation_reason_code,
                    emergency.expected_epoch, emergency.requested_by_admin_id,
                    emergency.reason_code as emergency_reason_code, emergency.requested_at,
                    closure.reason_code as closure_reason_code, closure.closed_at
               from app.private_live_telebirr_historical_completion_authorities authority
               join app.private_live_telebirr_verification_jobs job
                 on job.id = authority.verification_job_id
               join app.private_live_telebirr_verification_attempts attempt
                 on attempt.id = authority.verification_attempt_id
                and attempt.verification_job_id = job.id
               join app.private_live_telebirr_device_evidence_staging staged
                 on staged.verification_attempt_id = attempt.id
               join app.private_live_deposit_pilot_proofs proof
                 on proof.id = authority.private_live_deposit_pilot_proof_id
               join app.private_live_deposit_pilot_revisions pilot
                 on pilot.id = authority.pilot_revision_id
               join app.private_trusted_telebirr_activation_control control
                 on control.control_key = 'trusted_telebirr_financial_authority'
               join app.private_trusted_telebirr_activation_epochs activation
                 on activation.epoch = control.current_epoch
                and activation.epoch = authority.expired_activation_epoch
               join app.private_trusted_telebirr_emergency_disable_intents emergency
                 on emergency.expected_epoch = activation.epoch
               join app.private_live_telebirr_historical_completion_closures closure
                 on closure.request_key = authority.request_key
              where authority.request_key = $1::uuid
           )
           select
             app.is_private_live_telebirr_source_binding_post_emergency_ready(
               $1::uuid
             ) as post_emergency_ready,
             app.current_private_trusted_telebirr_activation_epoch()::text
               as current_authority,
             (select count(*)::integer
                from app.feature_switches feature_switch
               where feature_switch.feature_key in (
                 'cbe_birr_authoritative_verification', 'deposit_execution',
                 'payment_verification', 'private_live_deposit_pilot',
                 'telebirr_authoritative_verification', 'withdrawal_collection',
                 'withdrawal_validation'
               ) and feature_switch.mode = 'disabled'
                 and feature_switch.settings = '{}'::jsonb) as all_disabled_switches,
             (select count(*)::integer from boundary_rows) as boundary_rows,
             (select bool_and(
                request_key = $1::uuid
                and reason_code = 'expired_attempt_staged_evidence_completion'
                and verification_job_id = job_id
                and verification_attempt_id = attempt_id
                and private_live_deposit_pilot_proof_id = proof_id
                and pilot_revision_id = pilot_id
                and receiver_profile_id = job_receiver_profile_id
                and observation_body_digest = staged_observation_digest
                and source_document_digest =
                    staged_observation -> 'body' ->> 'sourceDocumentDigest'
              ) from boundary_rows) as lineage_ready,
             (select bool_and(
                authorized_at < requested_at
                and closure_reason_code = 'operator_stop'
                and closed_at >= authorized_at
                and closed_at <= requested_at
              ) from boundary_rows) as authority_ready,
             (select bool_and(
                current_epoch = expired_activation_epoch
                and authority_state = 'active'
                and activation_pilot_id = pilot_id
                and activation_configuration_digest = configuration_digest
                and revoked_at is not null
                and revocation_reason_code = 'execution_uncertainty'
                and revoked_at is not distinct from requested_at
                and expected_epoch = expired_activation_epoch
                and emergency_reason_code = revocation_reason_code
              ) from boundary_rows) as activation_ready,
             (select bool_and(
                pilot_status = 'stopped'
                and stopped_at is not distinct from requested_at
                and stopped_by_admin_id is not distinct from requested_by_admin_id
                and stop_reason_code is not distinct from emergency_reason_code
                and job_pilot_id = pilot_id
                and job_configuration_digest = configuration_digest
                and proof_pilot_id = pilot_id
                and origin_channel = 'telegram'
                and input_kind = 'direct_transaction_id'
                and submitted_at + interval '24 hours' > pg_catalog.clock_timestamp()
              ) from boundary_rows) as pilot_ready,
             (select bool_and(
                attempt_job_id = job_id
                and attempt_issued_at >= pilot_active_from
                and attempt_expires_at <= pilot_expires_at
                and attempt_issued_at >= activation_active_from
                and attempt_expires_at <= activation_expires_at
                and attempt_expires_at <= pg_catalog.clock_timestamp()
                and observed_at >= attempt_issued_at
                and observed_at < attempt_expires_at
                and staged_at < attempt_expires_at
                and observed_at < requested_at
                and staged_at < requested_at
              ) from boundary_rows) as evidence_ready`,
          [authorityRequestKey],
        );
        expect(boundary.rows).toEqual([
          {
            activation_ready: true,
            all_disabled_switches: 7,
            authority_ready: true,
            boundary_rows: 1,
            current_authority: null,
            evidence_ready: true,
            lineage_ready: true,
            pilot_ready: true,
            post_emergency_ready: true,
          },
        ]);
      });
    });

    it('completes one emergency-stopped historical payment without restoring global authority', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const ownerAdminId = getOwnerAdminId();
        const pilot = await prepareTelebirrPilot(client, ownerAdminId);
        const prepared = await prepareVerification(client, pilot);
        const attempt = await client.query<{
          readonly assignment_body_digest: string;
          readonly assignment_transcript_id: string;
          readonly issued_at: Date;
          readonly lease_request_key: string;
        }>(
          `select transcript.assignment_body_digest,
                  transcript.id as assignment_transcript_id,
                  attempt.issued_at,
                  attempt.lease_request_key
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_transcripts transcript
               on transcript.verification_attempt_id = attempt.id
            where attempt.id = $1::uuid`,
          [prepared.lease.verification_attempt_id],
        );
        expect(attempt.rows).toHaveLength(1);

        const observationBodyDigest = sha256(`observation:${randomUUID()}`);
        const sourceDocumentDigest = sha256(`document:${randomUUID()}`);
        const observedAt = new Date(attempt.rows[0]!.issued_at.getTime() + 1);
        const stagedAt = new Date(attempt.rows[0]!.issued_at.getTime() + 2);
        const expiredAt = new Date(attempt.rows[0]!.issued_at.getTime() + 20);

        await client.query(
          `insert into app.private_live_telebirr_device_evidence_staging (
             observation_body_digest,
             assignment_body_digest,
             verification_attempt_id,
             assignment_transcript_id,
             device_enrollment_id,
             first_request_body_digest,
             signed_assignment,
             signed_observation,
             observed_at,
             staged_at
           ) values (
             $1::text, $2::text, $3::uuid, $4::uuid, $5::uuid, $6::text,
             '{}'::jsonb,
             jsonb_build_object(
               'body', jsonb_build_object('sourceDocumentDigest', $7::text)
             ),
             $8::timestamptz, $9::timestamptz
           )`,
          [
            observationBodyDigest,
            attempt.rows[0]!.assignment_body_digest,
            prepared.lease.verification_attempt_id,
            attempt.rows[0]!.assignment_transcript_id,
            pilot.deviceEnrollmentId,
            sha256(`upload:${randomUUID()}`),
            sourceDocumentDigest,
            observedAt,
            stagedAt,
          ],
        );

        const activation = await client.query<{ readonly epoch: string }>(`
          select current_epoch::text as epoch
            from app.private_trusted_telebirr_activation_control
           where control_key = 'trusted_telebirr_financial_authority'
        `);
        expect(activation.rows).toHaveLength(1);

        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set expires_at = $1::timestamptz
            where epoch = $2::bigint`,
          [expiredAt, activation.rows[0]!.epoch],
        );
        await client.query(
          `update app.private_live_deposit_pilot_revisions
              set expires_at = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, pilot.pilotRevisionId],
        );
        await client.query(
          `update app.private_live_telebirr_receiver_profiles
              set valid_until = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, pilot.receiverProfileId],
        );
        await client.query(
          `update app.private_live_telebirr_device_enrollments
              set valid_until = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, pilot.deviceEnrollmentId],
        );
        await client.query(
          `update app.private_live_telebirr_assignment_signers
              set valid_until = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, pilot.assignmentSignerId],
        );
        await client.query(
          `update app.private_live_telebirr_verification_jobs
              set expires_at = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, prepared.stage.verification_job_id],
        );
        await client.query(
          `update app.private_live_telebirr_verification_attempts
              set expires_at = $1::timestamptz
            where id = $2::uuid`,
          [expiredAt, prepared.lease.verification_attempt_id],
        );
        await client.query("set local session_replication_role = 'origin'");
        await client.query('select pg_catalog.pg_sleep(0.05)');

        await client.query(
          `select *
             from app.request_private_trusted_telebirr_emergency_disable(
               $1::uuid, $2::bigint, $3::uuid, 'execution_uncertainty'
             )`,
          [ownerAdminId, activation.rows[0]!.epoch, randomUUID()],
        );

        const stopped = await client.query<{
          readonly current_authority: string | null;
          readonly live_switches: number;
          readonly pilot_status: string;
        }>(
          `select app.current_private_trusted_telebirr_activation_epoch()::text
                    as current_authority,
                  (select count(*)::integer
                     from app.feature_switches feature_switch
                    where feature_switch.feature_key in (
                      'cbe_birr_authoritative_verification', 'deposit_execution',
                      'payment_verification', 'private_live_deposit_pilot',
                      'telebirr_authoritative_verification', 'withdrawal_collection',
                      'withdrawal_validation'
                    ) and feature_switch.mode = 'live') as live_switches,
                  (select status::text
                     from app.private_live_deposit_pilot_revisions
                    where id = $1::uuid) as pilot_status`,
          [pilot.pilotRevisionId],
        );
        expect(stopped.rows).toEqual([
          { current_authority: null, live_switches: 0, pilot_status: 'stopped' },
        ]);

        const recoveryRequestKey = randomUUID();
        const authority = await client.query<{ readonly expires_at_text: string }>(
          `with boundary as materialized (
             select pg_catalog.clock_timestamp() as authorized_at
           )
           insert into app.private_live_telebirr_historical_completion_authorities (
             request_key,
             verification_job_id,
             verification_attempt_id,
             private_live_deposit_pilot_proof_id,
             pilot_revision_id,
             receiver_profile_id,
             expired_activation_epoch,
             observation_body_digest,
             source_document_digest,
             reason_code,
             request_digest,
             authorized_at,
             expires_at
           )
           select $1::uuid,
                  $2::uuid,
                  $3::uuid,
                  $4::uuid,
                  $5::uuid,
                  $6::uuid,
                  $7::bigint,
                  $8::text,
                  $9::text,
                  'expired_authority_staged_evidence_completion',
                  app.private_live_telebirr_historical_completion_digest(
                    $1::uuid, $2::uuid, $3::uuid, $5::uuid, $7::bigint,
                    $8::text, $9::text, boundary.authorized_at,
                    boundary.authorized_at + interval '15 minutes',
                    'expired_authority_staged_evidence_completion'
                  ),
                  boundary.authorized_at,
                  boundary.authorized_at + interval '15 minutes'
             from boundary
           returning expires_at::text as expires_at_text`,
          [
            recoveryRequestKey,
            prepared.stage.verification_job_id,
            prepared.lease.verification_attempt_id,
            prepared.proof.id,
            pilot.pilotRevisionId,
            pilot.receiverProfileId,
            activation.rows[0]!.epoch,
            observationBodyDigest,
            sourceDocumentDigest,
          ],
        );
        expect(authority.rows).toHaveLength(1);

        const scramVerifier =
          `SCRAM-SHA-256$4096:${'A'.repeat(22)}==` + `$${'B'.repeat(43)}=:${'C'.repeat(43)}=`;
        await client.query(
          `alter role fetanagent_trusted_telebirr_verifier_runtime
             login password '${scramVerifier}'
             valid until '${authority.rows[0]!.expires_at_text}'`,
        );

        const authorized = await client.query<{ readonly authorized: boolean }>(
          `select app.is_private_live_telebirr_historical_attempt_authorized(
             $1::uuid, $2::uuid, $3::text, $4::text
           ) as authorized`,
          [
            prepared.lease.verification_attempt_id,
            prepared.lease.lease_token,
            observationBodyDigest,
            sourceDocumentDigest,
          ],
        );
        expect(authorized.rows).toEqual([{ authorized: true }]);

        const completed = await client.query<{
          readonly execution_job_id: string;
          readonly outcome_disposition: string;
          readonly outcome_reason_code: string;
          readonly settlement_created: boolean;
        }>(
          `select execution_job_id, outcome_disposition, outcome_reason_code,
                  settlement_created
             from app.complete_private_live_telebirr_verification(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
               $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
               $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
               $17::timestamptz, 2500::bigint, $18::timestamptz, $19::text
             )`,
          [
            prepared.lease.verification_attempt_id,
            prepared.lease.lease_token,
            attempt.rows[0]!.lease_request_key,
            observationBodyDigest,
            sha256(`observation-signature:${randomUUID()}`),
            sha256(`replay:${randomUUID()}`),
            sourceDocumentDigest,
            sha256(`facts:${randomUUID()}`),
            observedAt,
            'would_forward_signed_evidence',
            'signed_evidence_verified',
            sha256(`assessment:${randomUUID()}`),
            stagedAt,
            'settlement_candidate',
            'exact_proof_match',
            sha256(`evidence:${randomUUID()}`),
            stagedAt,
            prepared.proof.submitted_at,
            pilot.receiverIdentityDigest,
          ],
        );
        expect(completed.rows).toEqual([
          {
            execution_job_id: expect.any(String),
            outcome_disposition: 'settlement_candidate',
            outcome_reason_code: 'exact_proof_match',
            settlement_created: true,
          },
        ]);

        await client.query(
          `select *
             from app.close_private_live_telebirr_historical_completion(
               $1::uuid, 'completed'
             )`,
          [recoveryRequestKey],
        );

        const final = await client.query<{
          readonly authority_consumptions: number;
          readonly authority_closures: number;
          readonly current_authority: string | null;
          readonly kemer_logins: number;
          readonly live_switches: number;
          readonly queued_jobs: number;
          readonly verifier_logins: number;
        }>(
          `select app.current_private_trusted_telebirr_activation_epoch()::text
                    as current_authority,
                  (select count(*)::integer
                     from app.feature_switches feature_switch
                    where feature_switch.feature_key in (
                      'cbe_birr_authoritative_verification', 'deposit_execution',
                      'payment_verification', 'private_live_deposit_pilot',
                      'telebirr_authoritative_verification', 'withdrawal_collection',
                      'withdrawal_validation'
                    ) and feature_switch.mode = 'live') as live_switches,
                  (select count(*)::integer
                     from pg_catalog.pg_roles role
                    where role.rolname in (
                      'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
                    ) and role.rolcanlogin) as kemer_logins,
                  (select count(*)::integer
                     from pg_catalog.pg_roles role
                    where role.rolname in (
                      'fetanagent_trusted_telebirr_verifier',
                      'fetanagent_trusted_telebirr_verifier_runtime'
                    ) and role.rolcanlogin) as verifier_logins,
                  (select count(*)::integer
                     from app.deposit_jobs execution_job
                    where execution_job.id = $1::uuid
                      and execution_job.status = 'queued'
                      and execution_job.attempt_count = 0
                      and execution_job.lease_token is null
                      and execution_job.leased_by is null
                      and execution_job.lease_expires_at is null
                      and execution_job.last_error_code is null
                      and execution_job.completed_at is null) as queued_jobs,
                  (select count(*)::integer
                     from app.private_live_telebirr_historical_completion_consumptions
                    where request_key = $2::uuid) as authority_consumptions,
                  (select count(*)::integer
                     from app.private_live_telebirr_historical_completion_closures
                    where request_key = $2::uuid) as authority_closures`,
          [completed.rows[0]!.execution_job_id, recoveryRequestKey],
        );
        expect(final.rows).toEqual([
          {
            authority_closures: 1,
            authority_consumptions: 1,
            current_authority: null,
            kemer_logins: 0,
            live_switches: 0,
            queued_jobs: 1,
            verifier_logins: 0,
          },
        ]);
      });
    });
  });
}
