-- Read-only, identifier-free image-handoff boundary. Run immediately before and after the
-- one-use host operation. Never invoke the staged-evidence loader as a diagnostic query.
with captured as (
  select pg_catalog.clock_timestamp() as checked_at
), active_candidates as (
  select pg_catalog.count(*) as count
    from app.private_live_telebirr_device_evidence_staging staged
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
    join app.private_live_telebirr_verification_jobs job
      on job.id = attempt.verification_job_id
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = job.pilot_revision_id
   cross join captured
   where pilot.status = 'armed'
     and captured.checked_at >= pilot.active_from
     and captured.checked_at < pilot.expires_at
     and captured.checked_at >= job.not_before
     and captured.checked_at < job.expires_at
     and captured.checked_at < attempt.expires_at
     and staged.observed_at >= attempt.issued_at
     and staged.observed_at < attempt.expires_at
     and attempt.lease_request_key::text
       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and not exists (
       select 1 from app.private_live_telebirr_verification_outcomes outcome
        where outcome.verification_attempt_id = attempt.id
           or outcome.completion_request_key = attempt.lease_request_key
     )
     and not exists (
       select 1 from app.private_live_telebirr_verifier_evidence_quarantine quarantine
        where quarantine.verification_attempt_id = attempt.id
           or quarantine.observation_body_digest = staged.observation_body_digest
     )
), historical_candidates as (
  select pg_catalog.count(*) as count
    from app.private_live_telebirr_historical_completion_authorities authority
   where app.is_private_live_telebirr_historical_attempt_authorized(
     authority.verification_attempt_id
   )
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'activeLoaderCandidates', (select count from active_candidates),
  'historicalLoaderCandidates', (select count from historical_candidates),
  'armedPilotsWithThirtyMinutes', (
    select pg_catalog.count(*) from app.private_live_deposit_pilot_revisions pilot, captured
     where pilot.status = 'armed'
       and pilot.active_from <= captured.checked_at
       and pilot.expires_at > captured.checked_at + interval '30 minutes'
  ),
  'currentActivationPresent',
    app.current_private_trusted_telebirr_activation_epoch() is not null,
  'verifierLoginBounded', exists (
    select 1 from pg_catalog.pg_roles role, captured
     where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and role.rolcanlogin and not role.rolinherit and not role.rolsuper
       and not role.rolcreatedb and not role.rolcreaterole
       and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil > captured.checked_at + interval '30 minutes'
  ),
  'verifierSessions', (
    select pg_catalog.count(*) from pg_catalog.pg_stat_activity activity
     where activity.usename = 'fetanagent_trusted_telebirr_verifier_runtime'
       and activity.application_name = 'fetanagent_trusted_telebirr_verifier'
       and activity.pid <> pg_catalog.pg_backend_pid()
  ),
  'unexpectedVerifierSessions', (
    select pg_catalog.count(*) from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
       and not (
         activity.usename = 'fetanagent_trusted_telebirr_verifier_runtime'
         and activity.application_name = 'fetanagent_trusted_telebirr_verifier'
       )
  ),
  'executorSessions', (
    select pg_catalog.count(*) from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
     ) and activity.pid <> pg_catalog.pg_backend_pid()
  ),
  'executorLogins', (
    select pg_catalog.count(*) from pg_catalog.pg_roles role
     where role.rolname in (
       'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
     ) and role.rolcanlogin
  ),
  'liveVerificationSwitches', (
    select pg_catalog.count(*) from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'payment_verification', 'deposit_execution',
       'telebirr_authoritative_verification', 'private_live_deposit_pilot'
     ) and feature_switch.mode = 'live'
  ),
  'disabledOtherFinancialSwitches', (
    select pg_catalog.count(*) from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'withdrawal_validation', 'withdrawal_collection',
       'cbe_birr_authoritative_verification'
     ) and feature_switch.mode = 'disabled'
       and feature_switch.settings = '{}'::jsonb
  ),
  'stagedEvidenceRows', (
    select pg_catalog.count(*) from app.private_live_telebirr_device_evidence_staging
  ),
  'verificationOutcomeRows', (
    select pg_catalog.count(*) from app.private_live_telebirr_verification_outcomes
  ),
  'quarantineRows', (
    select pg_catalog.count(*) from app.private_live_telebirr_verifier_evidence_quarantine
  )
) as handoff_boundary;
