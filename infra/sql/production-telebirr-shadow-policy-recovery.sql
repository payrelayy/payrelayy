\set ON_ERROR_STOP on

begin;

select *
  from app.retry_quarantined_private_telebirr_shadow_after_policy_fix(
    :'shadow_proof_request_id'::uuid,
    :'shadow_verification_job_id'::uuid,
    :'pilot_revision_id'::uuid,
    :'quarantined_verification_attempt_id'::uuid,
    :'recovery_request_key'::uuid,
    :'reviewed_main_commit_sha'::text,
    'verifier_policy_fix_retry_no_credit'
  )
\gset recovery_

do $policy_recovery_postcondition$
begin
  if :'recovery_shadow_proof_request_id'::uuid
       is distinct from :'shadow_proof_request_id'::uuid
    or :'recovery_shadow_verification_job_id'::uuid
         is distinct from :'shadow_verification_job_id'::uuid
    or :'recovery_retry_expires_at'::timestamptz
         <= pg_catalog.clock_timestamp() + interval '10 minutes'
    or (select pg_catalog.count(*)
          from app.private_telebirr_shadow_policy_recoveries recovery
         where recovery.recovery_request_key = :'recovery_request_key'::uuid
           and recovery.shadow_proof_request_id = :'shadow_proof_request_id'::uuid
           and recovery.shadow_verification_job_id = :'shadow_verification_job_id'::uuid
           and recovery.pilot_revision_id = :'pilot_revision_id'::uuid
           and recovery.quarantined_verification_attempt_id =
               :'quarantined_verification_attempt_id'::uuid
           and recovery.reviewed_main_commit_sha = :'reviewed_main_commit_sha'::text
           and recovery.reason_code = 'verifier_policy_fix_retry_no_credit') <> 1
    or (select proof.expires_at
          from app.private_telebirr_shadow_proof_requests proof
         where proof.id = :'shadow_proof_request_id'::uuid
           and proof.verification_job_id = :'shadow_verification_job_id'::uuid)
         is distinct from :'recovery_retry_expires_at'::timestamptz
    or (select pg_catalog.count(*)
          from app.private_telebirr_shadow_evidence_quarantine quarantine
         where quarantine.verification_attempt_id =
               :'quarantined_verification_attempt_id'::uuid
           and quarantine.reason_code = 'trusted_evidence_invalid') <> 1
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = :'shadow_proof_request_id'::uuid
    )
    or exists (
      select 1 from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification',
         'deposit_execution',
         'payment_verification',
         'telebirr_authoritative_verification',
         'withdrawal_collection',
         'withdrawal_validation'
       )
         and (
           feature_switch.mode <> 'disabled'
           or feature_switch.settings <> '{}'::jsonb
         )
    )
    or not exists (
      select 1 from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.mode = 'dry_run'
         and feature_switch.settings ->> 'pilot_revision_id' = :'pilot_revision_id'::text
    )
    or exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
         and role.rolcanlogin
    ) then
    raise exception 'The production TeleBirr shadow policy-recovery postcondition failed.';
  end if;
end;
$policy_recovery_postcondition$;

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'telebirr_shadow_policy_recovery',
  'deploymentTarget', 'production',
  'shadowProofRequestId', :'recovery_shadow_proof_request_id'::uuid,
  'shadowVerificationJobId', :'recovery_shadow_verification_job_id'::uuid,
  'pilotRevisionId', :'pilot_revision_id'::uuid,
  'quarantinedVerificationAttemptId', :'quarantined_verification_attempt_id'::uuid,
  'recoveryRequestKey', :'recovery_request_key'::uuid,
  'retryExpiresAt', :'recovery_retry_expires_at'::timestamptz,
  'alreadyRecovered', :'recovery_already_recovered'::boolean,
  'quarantinePreserved', true,
  'financialActionsEnabled', false,
  'kemerBetCreditEnabled', false
);

commit;
