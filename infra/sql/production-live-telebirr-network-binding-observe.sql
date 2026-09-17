\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as exact_observer_contract
\gset
\if :exact_observer_contract
\else
  \warn 'The redacted live TeleBirr observer contract is invalid.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed read only;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
with recent_recovery_targets as materialized (
  select job.*
    from app.private_live_telebirr_verification_jobs job
   where job.network_retry_reason_code = 'official_receipt_network_unavailable'
     and job.network_retry_source_job_id is not null
     and job.network_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
     and job.network_binding_original_expires_at is not null
     and job.network_binding_recovered_at is not null
     and job.network_binding_recovery_request_key is not null
     and job.network_binding_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
     and job.network_binding_recovery_reason_code =
         'network_retry_reference_binding_registry'
     and job.network_binding_recovered_at >=
         pg_catalog.clock_timestamp() - interval '24 hours'
     and job.network_binding_recovered_at <= pg_catalog.clock_timestamp()
), target as materialized (
  select job.*
    from recent_recovery_targets job
   where (select count(*) from recent_recovery_targets) = 1
), attempts as materialized (
  select attempt.*
    from app.private_live_telebirr_verification_attempts attempt
    join target job on job.id = attempt.verification_job_id
), attempt_summary as materialized (
  select count(*)::integer as attempts,
         count(*) filter (
           where attempt.expires_at <= pg_catalog.clock_timestamp()
         )::integer as expired_attempts,
         count(*) filter (
           where attempt.expires_at > pg_catalog.clock_timestamp()
         )::integer as active_attempts,
         coalesce(max(attempt.attempt_number), 0)::integer as last_attempt_number,
         coalesce(
           count(*) > 0
           and min(attempt.attempt_number) = 1
           and max(attempt.attempt_number) = count(*)
           and count(distinct attempt.attempt_number) = count(*),
           false
         ) as contiguous_attempts
    from attempts attempt
), assignment_transcripts as materialized (
  select transcript.*
    from app.private_live_telebirr_assignment_transcripts transcript
    join attempts attempt on attempt.id = transcript.verification_attempt_id
), assignment_deliveries as materialized (
  select delivery.*
    from app.private_live_telebirr_assignment_deliveries delivery
    join attempts attempt on attempt.id = delivery.verification_attempt_id
), device_evidence as materialized (
  select evidence.*
    from app.private_live_telebirr_device_evidence_staging evidence
    join attempts attempt on attempt.id = evidence.verification_attempt_id
), evidence_timing as materialized (
  select count(*) filter (
           where evidence.staged_at < attempt.expires_at
         )::integer as evidence_staged_before_expiry,
         count(*) filter (
           where evidence.staged_at <= attempt.expires_at - interval '10 seconds'
         )::integer as evidence_with_ten_second_lead,
         coalesce(least(
           300,
           greatest(
             0,
             floor(min(extract(epoch from (
               attempt.expires_at - evidence.staged_at
             ))))::integer
           )
         ), 0) as minimum_evidence_lead_seconds
    from device_evidence evidence
    join attempts attempt on attempt.id = evidence.verification_attempt_id
), observations as materialized (
  select observation.*
    from app.private_live_telebirr_observation_transcripts observation
    join attempts attempt on attempt.id = observation.verification_attempt_id
), outcomes as materialized (
  select outcome.*
    from app.private_live_telebirr_verification_outcomes outcome
    join target job on job.id = outcome.verification_job_id
), reservations as materialized (
  select reservation.*
    from app.private_live_deposit_pilot_reservations reservation
    join target job
      on job.private_live_deposit_pilot_proof_id =
         reservation.private_live_deposit_pilot_proof_id
), settlement_receipts as materialized (
  select receipt.*
    from app.private_live_telebirr_settlement_receipts receipt
    join outcomes outcome on outcome.id = receipt.verification_outcome_id
), evidence_quarantines as materialized (
  select quarantine.*
    from app.private_live_telebirr_verifier_evidence_quarantine quarantine
    join attempts attempt on attempt.id = quarantine.verification_attempt_id
), eligible_evidence_now as materialized (
  select evidence.observation_body_digest
    from device_evidence evidence
    join attempts attempt on attempt.id = evidence.verification_attempt_id
    join target job on job.id = attempt.verification_job_id
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = job.pilot_revision_id
   where pilot.status = 'armed'
     and pg_catalog.clock_timestamp() >= pilot.active_from
     and pg_catalog.clock_timestamp() < pilot.expires_at
     and pg_catalog.clock_timestamp() >= job.not_before
     and pg_catalog.clock_timestamp() < job.expires_at
     and pg_catalog.clock_timestamp() < attempt.expires_at
     and evidence.observed_at >= attempt.issued_at
     and evidence.observed_at < attempt.expires_at
     and not exists (
       select 1
         from outcomes outcome
        where outcome.verification_attempt_id = attempt.id
     )
     and not exists (
       select 1
         from evidence_quarantines quarantine
        where quarantine.verification_attempt_id = attempt.id
     )
), deposit_execution_jobs as materialized (
  select deposit_job.*
    from app.deposit_jobs deposit_job
    join settlement_receipts receipt on receipt.execution_job_id = deposit_job.id
), queued_deposit_jobs as materialized (
  select deposit_job.*
    from deposit_execution_jobs deposit_job
   where deposit_job.status = 'queued'
     and deposit_job.attempt_count = 0
     and deposit_job.lease_token is null
     and deposit_job.leased_by is null
     and deposit_job.lease_expires_at is null
     and deposit_job.last_error_code is null
     and deposit_job.completed_at is null
), deposit_execution_switch as materialized (
  select feature_switch.mode
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'deposit_execution'
), live_verification_switches as materialized (
  select feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
     and feature_switch.mode = 'live'
), kemer_login_roles as materialized (
  select role.oid
    from pg_catalog.pg_roles role
   where role.rolname in (
     'fetanagent_deposit_executor',
     'fetanagent_deposit_executor_runtime'
   ) and role.rolcanlogin
), kemer_sessions as materialized (
  select activity.pid
    from pg_catalog.pg_stat_activity activity
   where activity.usename in (
     'fetanagent_deposit_executor',
     'fetanagent_deposit_executor_runtime'
   )
), trusted_verifier_sessions as materialized (
  select activity.pid, activity.application_name
    from pg_catalog.pg_stat_activity activity
   where activity.usename = 'fetanagent_trusted_telebirr_verifier_runtime'
     and activity.pid <> pg_catalog.pg_backend_pid()
), summary as materialized (
  select least(
           (select count(*)::integer from recent_recovery_targets),
           2
         ) as recent_recovery_targets,
         (select count(*)::integer from target) as target_count,
         attempt_summary.attempts,
         attempt_summary.expired_attempts,
         attempt_summary.active_attempts,
         attempt_summary.last_attempt_number,
         attempt_summary.contiguous_attempts,
         (select count(*)::integer from assignment_transcripts) as transcripts,
         (select count(*)::integer from assignment_deliveries) as deliveries,
         (select count(*)::integer from device_evidence) as evidence,
         (select count(*)::integer from observations) as observations,
         (select count(*)::integer from outcomes) as outcomes,
         (select count(*)::integer from reservations) as reservations,
         (select count(*)::integer from settlement_receipts) as settlements,
         (select count(*)::integer from evidence_quarantines) as quarantines,
         (select count(*)::integer from eligible_evidence_now) as eligible_evidence,
         evidence_timing.evidence_staged_before_expiry,
         evidence_timing.evidence_with_ten_second_lead,
         evidence_timing.minimum_evidence_lead_seconds,
         (select count(*)::integer from deposit_execution_jobs) as execution_jobs,
         (select count(*)::integer from queued_deposit_jobs) as queued_jobs,
         (select count(*)::integer from deposit_execution_switch) as switch_count,
         coalesce((
           select pg_catalog.bool_and(feature_switch.mode = 'disabled')
             from deposit_execution_switch feature_switch
         ), false) as switch_disabled,
         (select count(*)::integer from kemer_login_roles) as kemer_logins,
         (select count(*)::integer from kemer_sessions) as kemer_sessions,
         coalesce((
           select case
             when role.rolcanlogin
              and not role.rolinherit
              and not role.rolsuper
              and not role.rolcreatedb
              and not role.rolcreaterole
              and not role.rolreplication
              and not role.rolbypassrls
              and role.rolconnlimit = 1
              and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
              and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
              and (select count(*)
                     from pg_catalog.pg_auth_members membership
                    where membership.member = role.oid) = 1
              and exists (
                select 1
                  from pg_catalog.pg_auth_members membership
                  join pg_catalog.pg_roles granted_role
                    on granted_role.oid = membership.roleid
                 where membership.member = role.oid
                   and granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
                   and membership.inherit_option
                   and not membership.set_option
                   and not membership.admin_option
              ) then 'bounded'
             when not role.rolcanlogin
              and not role.rolinherit
              and not role.rolsuper
              and not role.rolcreatedb
              and not role.rolcreaterole
              and not role.rolreplication
              and not role.rolbypassrls
              and role.rolconnlimit = 1
              and auth.rolpassword is null then 'disabled'
             else 'unsafe'
           end
             from pg_catalog.pg_roles role
             join pg_catalog.pg_authid auth on auth.oid = role.oid
            where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
         ), 'missing') as verifier_login_state,
         (select count(*)::integer from trusted_verifier_sessions) as verifier_sessions,
         (select count(*)::integer
            from trusted_verifier_sessions verifier_session
           where verifier_session.application_name is distinct from
                 'fetanagent_trusted_telebirr_verifier') as unexpected_verifier_sessions,
         app.current_private_trusted_telebirr_activation_epoch() is not null
           as financial_authority_active,
         (select count(*)::integer from live_verification_switches) = 4
           as verification_switch_boundary_live,
         (select outcome.disposition from outcomes outcome limit 1) as disposition,
         (select outcome.reason_code from outcomes outcome limit 1) as reason_code,
         (select job.expires_at from target job limit 1) as expires_at,
         coalesce((
           select pg_catalog.bool_and(
             job.network_retry_source_job_id is not null
             and job.network_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
             and job.network_binding_original_expires_at is not null
             and job.network_binding_recovered_at is not null
             and job.network_binding_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
             and job.network_binding_recovery_reason_code =
                 'network_retry_reference_binding_registry'
           ) from target job
         ), false) as recovery_shape_valid
    from attempt_summary
    cross join evidence_timing
), classified as materialized (
  select summary.*,
         summary.kemer_logins <> 0
           or summary.kemer_sessions <> 0 as execution_enabled,
         case
           when summary.recent_recovery_targets <> 1
             or summary.target_count <> 1
             or not summary.recovery_shape_valid
             or summary.switch_count <> 1
             or summary.kemer_logins <> 0
             or summary.kemer_sessions <> 0
             or summary.attempts not between 2 and 100
             or summary.expired_attempts + summary.active_attempts <> summary.attempts
             or not summary.contiguous_attempts
             or summary.transcripts not between 0 and summary.attempts
             or summary.deliveries not between 0 and summary.attempts
             or summary.evidence not between 0 and summary.attempts
             or summary.observations not between 0 and 1
             or summary.outcomes not between 0 and 1
             or summary.reservations not between 0 and 1
             or summary.settlements not between 0 and 1
             or summary.quarantines not between 0 and summary.evidence
             or summary.eligible_evidence not between 0 and summary.evidence
             or summary.evidence_staged_before_expiry <> summary.evidence
             or summary.execution_jobs not between 0 and 1
             or summary.queued_jobs not between 0 and 1
             then 'invalid'
           when summary.outcomes = 0
             and summary.expires_at <= pg_catalog.clock_timestamp()
             then 'expired'
           when summary.outcomes = 0
             then 'waiting'
           when summary.disposition = 'settlement_candidate'
             and summary.reason_code = 'exact_proof_match'
             and summary.attempts >= 3
             and summary.transcripts = 1
             and summary.deliveries = 1
             and summary.evidence = 1
             and summary.observations = 1
             and summary.reservations = 1
             and summary.settlements = 1
             and summary.execution_jobs = 1
             and summary.queued_jobs = 1
             then 'queued'
           when summary.disposition = 'review_required'
             and summary.transcripts = 1
             and summary.deliveries = 1
             and summary.evidence = 1
             and summary.observations = 1
             and summary.reservations = 0
             and summary.settlements = 0
             and summary.execution_jobs = 0
             and summary.queued_jobs = 0
             then 'review_required'
           when summary.disposition = 'definite_reject'
             and summary.transcripts = 1
             and summary.deliveries = 1
             and summary.evidence = 1
             and summary.observations = 1
             and summary.reservations = 0
             and summary.settlements = 0
             and summary.execution_jobs = 0
             and summary.queued_jobs = 0
             then 'definite_reject'
           else 'invalid'
         end as verification_state,
         case
           when summary.recent_recovery_targets <> 1
             or summary.target_count <> 1
             or not summary.recovery_shape_valid
             or summary.switch_count <> 1
             or summary.kemer_logins <> 0
             or summary.kemer_sessions <> 0
             or summary.attempts not between 2 and 100
             or not summary.contiguous_attempts
             then 'invalid'
           when summary.outcomes = 1
             and summary.disposition = 'settlement_candidate'
             and summary.reason_code = 'exact_proof_match'
             and summary.execution_jobs = 1
             and summary.queued_jobs = 1
             then 'queued'
           when summary.outcomes = 1 then 'terminal_non_settlement'
           when summary.quarantines > 0 then 'trusted_evidence_quarantined'
           when summary.evidence > 0
             and summary.observations = 0
             and summary.verifier_login_state <> 'bounded'
             then 'trusted_verifier_login_unavailable'
           when summary.evidence > 0
             and summary.observations = 0
             and summary.verifier_sessions = 0
             then 'trusted_verifier_session_unavailable'
           when summary.evidence > 0
             and summary.observations = 0
             and summary.expires_at <= pg_catalog.clock_timestamp()
             then 'staged_evidence_unconsumed'
           when summary.transcripts > 0
             and summary.evidence = 0
             and summary.expires_at <= pg_catalog.clock_timestamp()
             then 'device_evidence_missing'
           when summary.expires_at <= pg_catalog.clock_timestamp()
             then 'verification_expired'
           else 'verification_waiting'
         end as diagnosis
    from summary
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_network_binding_observe',
  'deploymentTarget', 'production',
  'recentRecoveryTargets', classified.recent_recovery_targets,
  'targetCount', classified.target_count,
  'verificationState', classified.verification_state,
  'diagnosis', classified.diagnosis,
  'outcomeReasonCode', case
    when classified.outcomes = 0 then 'pending'
    when classified.reason_code = 'exact_proof_match' then 'exact_proof_match'
    when classified.outcomes = 1 then 'non_match'
    else 'invalid'
  end,
  'remainingSeconds', coalesce(greatest(
    0,
    floor(extract(epoch from (
      classified.expires_at - pg_catalog.clock_timestamp()
    )))::integer
  ), 0),
  'attempts', classified.attempts,
  'expiredAttempts', classified.expired_attempts,
  'activeAttempts', classified.active_attempts,
  'lastAttemptNumber', classified.last_attempt_number,
  'contiguousAttempts', classified.contiguous_attempts,
  'assignmentTranscripts', classified.transcripts,
  'assignmentDeliveries', classified.deliveries,
  'deviceEvidence', classified.evidence,
  'observations', classified.observations,
  'outcomes', classified.outcomes,
  'reservations', classified.reservations,
  'settlementReceipts', classified.settlements,
  'evidenceQuarantines', classified.quarantines,
  'eligibleEvidenceNow', classified.eligible_evidence,
  'evidenceStagedBeforeExpiry', classified.evidence_staged_before_expiry,
  'evidenceWithTenSecondLead', classified.evidence_with_ten_second_lead,
  'minimumEvidenceLeadSeconds', classified.minimum_evidence_lead_seconds,
  'depositExecutionJobs', classified.execution_jobs,
  'queuedDepositJobs', classified.queued_jobs,
  'depositExecutionSwitchDisabled', classified.switch_disabled,
  'trustedVerifierLoginState', classified.verifier_login_state,
  'trustedVerifierSessions', classified.verifier_sessions,
  'unexpectedVerifierSessions', classified.unexpected_verifier_sessions,
  'financialAuthorityActive', classified.financial_authority_active,
  'verificationBoundaryLive',
    classified.verification_switch_boundary_live
      and classified.financial_authority_active,
  'kemerBetLoginRoles', classified.kemer_logins,
  'kemerBetSessions', classified.kemer_sessions,
  'executionEnabled', classified.execution_enabled,
  'readOnly', true,
  'moneyMoved', false
)::text
from classified;

commit;
