-- Prepare one append-only, no-money expired-window recovery from the exact reviewed live TeleBirr
-- proof's terminal review_required/source_unavailable lineage into the dry-run shadow verifier.
--
-- The exception is represented by one immutable authorization digest rather than a raw production
-- identifier.  It is valid only after the original 24-hour window and expires seven days after the
-- proof was submitted.  The original proof and all source lineage remain immutable.  The recovery
-- can create only one short-lived advisory shadow request under a fresh, semantically identical
-- dry-run pilot; it cannot create a claim, reservation, settlement receipt, execution job,
-- KemerBet action, credit, or financial authority.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;

do $source_unavailable_recovery_installation_preflight$
begin
  if app.current_private_trusted_telebirr_activation_epoch() is not null
    or exists (
      select 1
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'payment_verification',
         'deposit_execution',
         'withdrawal_validation',
         'withdrawal_collection',
         'cbe_birr_authoritative_verification',
         'telebirr_authoritative_verification'
       )
         and (
           feature_switch.mode is distinct from 'disabled'
           or feature_switch.settings is distinct from '{}'::jsonb
         )
    )
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception
      'Live TeleBirr source-unavailable recovery installation requires the no-money boundary.';
  end if;
end;
$source_unavailable_recovery_installation_preflight$;

create table app.private_live_telebirr_expired_source_authorizations (
  source_proof_binding_digest text primary key
    check (source_proof_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  valid_after timestamptz not null,
  expires_at timestamptz not null,
  reason_code text not null
    check (reason_code = 'reviewed_expired_source_unavailable_no_credit'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_tbirr_expired_source_auth_proof_check check (
    source_proof_binding_digest =
      'sha256:a49925667fac7e916e7dd8f3b07b30634d28ef106066582d1c297f860c7655b5'
  ),
  constraint private_live_tbirr_expired_source_auth_window_check check (
    valid_after = timestamptz '2026-09-18 15:03:54+00'
    and expires_at = timestamptz '2026-09-24 15:03:54+00'
    and expires_at = valid_after + interval '6 days'
  )
);

create trigger private_live_tbirr_expired_source_auth_immutable
before update or delete on app.private_live_telebirr_expired_source_authorizations
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_tbirr_expired_source_auth_no_truncate
before truncate on app.private_live_telebirr_expired_source_authorizations
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.private_live_telebirr_expired_source_authorizations enable row level security;
alter table app.private_live_telebirr_expired_source_authorizations force row level security;

create function app.private_live_telebirr_expired_source_binding_digest(
  p_source_live_proof_id uuid
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $$
begin
  if p_source_live_proof_id is null then
    raise exception 'The expired source-unavailable proof binding input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:expired-source-unavailable:authorized-proof:v1'
      || '|source_proof_id=' || p_source_live_proof_id::text
  );
end;
$$;

-- This is a one-proof capability: the digest is domain-separated and reveals no production UUID.
-- Deployment prepares the capability but does not create a shadow request or execute a recovery.
insert into app.private_live_telebirr_expired_source_authorizations (
  source_proof_binding_digest,
  valid_after,
  expires_at,
  reason_code
) values (
  'sha256:a49925667fac7e916e7dd8f3b07b30634d28ef106066582d1c297f860c7655b5',
  timestamptz '2026-09-18 15:03:54+00',
  timestamptz '2026-09-24 15:03:54+00',
  'reviewed_expired_source_unavailable_no_credit'
);

create or replace function app.private_live_telebirr_source_recovery_digest(
  p_recovery_request_key uuid,
  p_root_live_verification_job_id uuid,
  p_root_live_outcome_id uuid,
  p_terminal_live_verification_job_id uuid,
  p_terminal_live_outcome_id uuid,
  p_source_live_proof_id uuid,
  p_source_pilot_revision_id uuid,
  p_source_receiver_profile_id uuid,
  p_replacement_shadow_proof_request_id uuid,
  p_replacement_shadow_verification_job_id uuid,
  p_target_pilot_revision_id uuid,
  p_target_receiver_profile_id uuid,
  p_source_attempt_count integer,
  p_source_assignment_transcript_count integer,
  p_source_assignment_delivery_count integer,
  p_source_device_evidence_count integer,
  p_source_observation_count integer,
  p_source_attempt_history_digest text,
  p_authorized_at timestamptz,
  p_recovery_expires_at timestamptz,
  p_reason_code text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
begin
  if p_recovery_request_key is null
    or p_root_live_verification_job_id is null
    or p_root_live_outcome_id is null
    or p_terminal_live_verification_job_id is null
    or p_terminal_live_outcome_id is null
    or p_source_live_proof_id is null
    or p_source_pilot_revision_id is null
    or p_source_receiver_profile_id is null
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_target_pilot_revision_id is null
    or p_target_receiver_profile_id is null
    or p_source_attempt_count <> 4
    or p_source_assignment_transcript_count <> 2
    or p_source_assignment_delivery_count <> 2
    or p_source_device_evidence_count <> 2
    or p_source_observation_count <> 1
    or p_source_attempt_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_authorized_at is null
    or p_recovery_expires_at is null
    or p_reason_code is distinct from
       'terminal_source_unavailable_recovery_no_credit' then
    raise exception 'The terminal source-unavailable recovery digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:live-source-unavailable:shadow-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|root_job_id=' || p_root_live_verification_job_id::text
      || '|root_outcome_id=' || p_root_live_outcome_id::text
      || '|terminal_job_id=' || p_terminal_live_verification_job_id::text
      || '|terminal_outcome_id=' || p_terminal_live_outcome_id::text
      || '|source_proof_id=' || p_source_live_proof_id::text
      || '|source_pilot_id=' || p_source_pilot_revision_id::text
      || '|source_profile_id=' || p_source_receiver_profile_id::text
      || '|shadow_proof_id=' || p_replacement_shadow_proof_request_id::text
      || '|shadow_job_id=' || p_replacement_shadow_verification_job_id::text
      || '|target_pilot_id=' || p_target_pilot_revision_id::text
      || '|target_profile_id=' || p_target_receiver_profile_id::text
      || '|attempts=' || p_source_attempt_count::text
      || '|transcripts=' || p_source_assignment_transcript_count::text
      || '|deliveries=' || p_source_assignment_delivery_count::text
      || '|device_evidence=' || p_source_device_evidence_count::text
      || '|observations=' || p_source_observation_count::text
      || '|attempt_history=' || p_source_attempt_history_digest
      || '|authorized_at_us=' || (
        extract(epoch from p_authorized_at) * 1000000
      )::bigint::text
      || '|expires_at_us=' || (
        extract(epoch from p_recovery_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create or replace function app.recover_private_live_telebirr_source_to_shadow(
  p_terminal_live_verification_job_id uuid,
  p_source_pilot_revision_id uuid,
  p_target_pilot_revision_id uuid,
  p_replacement_shadow_proof_request_id uuid,
  p_recovery_request_key uuid,
  p_reason_code text
)
returns table (
  shadow_proof_request_id uuid,
  shadow_verification_job_id uuid,
  recovery_expires_at timestamptz,
  already_recovered boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authorized_at timestamptz;
  root_job app.private_live_telebirr_verification_jobs%rowtype;
  terminal_job app.private_live_telebirr_verification_jobs%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  expired_source_authorization
    app.private_live_telebirr_expired_source_authorizations%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  root_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  terminal_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  target_enrollment app.private_live_telebirr_device_enrollments%rowtype;
  target_heartbeat app.private_live_telebirr_device_heartbeats%rowtype;
  existing_recovery app.private_live_telebirr_source_recoveries%rowtype;
  inserted_shadow app.private_telebirr_shadow_proof_requests%rowtype;
  replacement_shadow_job_id uuid;
  shadow_recovery_digest text;
  recovery_digest text;
  source_attempt_history_digest text;
  source_attempt_count integer;
  source_assignment_transcript_count integer;
  source_assignment_delivery_count integer;
  source_device_evidence_count integer;
  source_observation_count integer;
  root_outcome_count integer;
  terminal_outcome_count integer;
  target_enrollment_count integer;
  locked_switch_count integer;
  recovered_until timestamptz;
begin
  if session_user <> 'postgres'
    or p_terminal_live_verification_job_id is null
    or p_source_pilot_revision_id is null
    or p_target_pilot_revision_id is null
    or p_source_pilot_revision_id = p_target_pilot_revision_id
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_proof_request_id::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_recovery_request_key is null
    or p_recovery_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from
       'terminal_source_unavailable_recovery_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The terminal source-unavailable no-money recovery request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:live-source-unavailable:shadow-recovery:'
        || p_terminal_live_verification_job_id::text,
      0
    )
  );

  perform app.lock_private_trusted_telebirr_activation_authority();

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification',
     'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for share;
  get diagnostics locked_switch_count = row_count;

  perform pilot_revision.id
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id in (p_source_pilot_revision_id, p_target_pilot_revision_id)
   order by pilot_revision.id
   for share;

  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select job.*
    into terminal_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = p_terminal_live_verification_job_id
   for update;

  select job.*
    into root_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = terminal_job.network_retry_source_job_id
   for share;

  select proof.*
    into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = terminal_job.private_live_deposit_pilot_proof_id
   for key share;

  select candidate_authorization.*
    into expired_source_authorization
    from app.private_live_telebirr_expired_source_authorizations candidate_authorization
   where candidate_authorization.source_proof_binding_digest =
         app.private_live_telebirr_expired_source_binding_digest(source_proof.id)
   for share;

  select pilot.*
    into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_source_pilot_revision_id;

  select pilot.*
    into target_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_target_pilot_revision_id;

  select profile.*
    into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = terminal_job.receiver_profile_id
   for share;

  select profile.*
    into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.pilot_revision_id = target_pilot.id
     and profile.payment_provider_id = terminal_job.payment_provider_id
     and profile.receiver_account_id = terminal_job.receiver_account_id
     and profile.receiver_account_version = terminal_job.receiver_account_version
   for share;

  select outcome.*
    into root_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = root_job.id
   order by outcome.created_at, outcome.id
   limit 1
   for share;

  select pg_catalog.count(*)::integer
    into root_outcome_count
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = root_job.id;

  select outcome.*
    into terminal_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = terminal_job.id
   order by outcome.created_at, outcome.id
   limit 1
   for share;

  select pg_catalog.count(*)::integer
    into terminal_outcome_count
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = terminal_job.id;

  select pg_catalog.count(*)::integer,
         app.private_live_deposit_pilot_sha256(
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'attempt_id', attempt.id,
                 'attempt_number', attempt.attempt_number,
                 'device_enrollment_id', attempt.device_enrollment_id,
                 'lease_request_digest', attempt.lease_request_digest,
                 'issued_at', attempt.issued_at,
                 'expires_at', attempt.expires_at
               ) order by attempt.attempt_number, attempt.id
             )::text,
             '[]'
           )
         )
    into source_attempt_count, source_attempt_history_digest
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.verification_job_id = terminal_job.id;

  select pg_catalog.count(*)::integer
    into source_assignment_transcript_count
    from app.private_live_telebirr_assignment_transcripts transcript
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = transcript.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;

  select pg_catalog.count(*)::integer
    into source_assignment_delivery_count
    from app.private_live_telebirr_assignment_deliveries delivery
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = delivery.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;

  select pg_catalog.count(*)::integer
    into source_device_evidence_count
    from app.private_live_telebirr_device_evidence_staging evidence
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = evidence.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;

  select pg_catalog.count(*)::integer
    into source_observation_count
    from app.private_live_telebirr_observation_transcripts observation
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = observation.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;

  select enrollment.*
    into target_enrollment
    from app.private_live_telebirr_device_enrollments enrollment
   where enrollment.pilot_revision_id = target_pilot.id
     and enrollment.receiver_profile_id = target_profile.id
     and enrollment.valid_from <= authorized_at
     and enrollment.valid_until > authorized_at + interval '60 seconds'
     and not exists (
       select 1
         from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= authorized_at
     )
   order by enrollment.created_at desc, enrollment.id
   limit 1
   for share;

  select pg_catalog.count(*)::integer
    into target_enrollment_count
    from app.private_live_telebirr_device_enrollments enrollment
   where enrollment.pilot_revision_id = target_pilot.id
     and enrollment.receiver_profile_id = target_profile.id
     and enrollment.valid_from <= authorized_at
     and enrollment.valid_until > authorized_at + interval '60 seconds'
     and not exists (
       select 1
         from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= authorized_at
     );

  select heartbeat.*
    into target_heartbeat
    from app.private_live_telebirr_device_heartbeats heartbeat
   where heartbeat.device_enrollment_id = target_enrollment.id
   for share;

  select recovery.*
    into existing_recovery
    from app.private_live_telebirr_source_recoveries recovery
   where recovery.recovery_request_key = p_recovery_request_key
      or recovery.terminal_live_verification_job_id = terminal_job.id
      or recovery.source_live_proof_id = source_proof.id
   order by (recovery.recovery_request_key = p_recovery_request_key) desc,
            recovery.authorized_at,
            recovery.recovery_request_key
   limit 1
   for share;

  if existing_recovery.recovery_request_key is not null then
    recovery_digest := app.private_live_telebirr_source_recovery_digest(
      existing_recovery.recovery_request_key,
      existing_recovery.root_live_verification_job_id,
      existing_recovery.root_live_outcome_id,
      existing_recovery.terminal_live_verification_job_id,
      existing_recovery.terminal_live_outcome_id,
      existing_recovery.source_live_proof_id,
      existing_recovery.source_pilot_revision_id,
      existing_recovery.source_receiver_profile_id,
      existing_recovery.replacement_shadow_proof_request_id,
      existing_recovery.replacement_shadow_verification_job_id,
      existing_recovery.target_pilot_revision_id,
      existing_recovery.target_receiver_profile_id,
      existing_recovery.source_attempt_count,
      existing_recovery.source_assignment_transcript_count,
      existing_recovery.source_assignment_delivery_count,
      existing_recovery.source_device_evidence_count,
      existing_recovery.source_observation_count,
      existing_recovery.source_attempt_history_digest,
      existing_recovery.authorized_at,
      existing_recovery.recovery_expires_at,
      existing_recovery.reason_code
    );

    if existing_recovery.recovery_request_key is distinct from p_recovery_request_key
      or existing_recovery.terminal_live_verification_job_id
           is distinct from p_terminal_live_verification_job_id
      or existing_recovery.source_pilot_revision_id
           is distinct from p_source_pilot_revision_id
      or existing_recovery.target_pilot_revision_id
           is distinct from p_target_pilot_revision_id
      or existing_recovery.replacement_shadow_proof_request_id
           is distinct from p_replacement_shadow_proof_request_id
      or existing_recovery.reason_code is distinct from p_reason_code
      or existing_recovery.recovery_request_digest is distinct from recovery_digest
      or existing_recovery.source_attempt_count is distinct from source_attempt_count
      or existing_recovery.source_assignment_transcript_count
           is distinct from source_assignment_transcript_count
      or existing_recovery.source_assignment_delivery_count
           is distinct from source_assignment_delivery_count
      or existing_recovery.source_device_evidence_count
           is distinct from source_device_evidence_count
      or existing_recovery.source_observation_count
           is distinct from source_observation_count
      or existing_recovery.source_attempt_history_digest
           is distinct from source_attempt_history_digest then
      raise exception 'The terminal source-unavailable recovery replay conflicts.';
    end if;

    return query
    select existing_recovery.replacement_shadow_proof_request_id,
           existing_recovery.replacement_shadow_verification_job_id,
           existing_recovery.recovery_expires_at,
           true;
    return;
  end if;

  if locked_switch_count <> 7
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or not app.private_telebirr_shadow_mode_is_ready(target_pilot.id)
    or source_pilot.id is null
    or target_pilot.id is null
    or source_pilot.status <> 'stopped'
    or source_pilot.expires_at > authorized_at
    or target_pilot.status <> 'armed'
    or authorized_at < target_pilot.active_from
    or target_pilot.expires_at <= authorized_at + interval '60 seconds'
    or source_proof.id is null
    or source_proof.pilot_revision_id is distinct from source_pilot.id
    or source_proof.provider_code_snapshot <> 'telebirr'
    or source_proof.origin_channel <> 'telegram'
    or source_proof.input_kind <> 'direct_transaction_id'
    or source_proof.submitted_at >= authorized_at
    or (
      authorized_at >= source_proof.submitted_at + interval '24 hours'
      and (
        expired_source_authorization.source_proof_binding_digest is null
        or expired_source_authorization.reason_code is distinct from
           'reviewed_expired_source_unavailable_no_credit'
        or expired_source_authorization.valid_after > authorized_at
        or expired_source_authorization.expires_at <= authorized_at + interval '60 seconds'
        or authorized_at >= source_proof.submitted_at + interval '7 days'
      )
    )
    or root_job.id is null
    or root_job.network_retry_source_job_id is not null
    or root_job.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or root_job.pilot_revision_id is distinct from source_pilot.id
    or root_job.submitted_at is distinct from source_proof.submitted_at
    or root_job.not_before is distinct from source_proof.submitted_at
    or root_job.expires_at <= root_job.submitted_at
    or root_job.expires_at > root_job.submitted_at + interval '5 minutes'
    or terminal_job.id is null
    or terminal_job.network_retry_source_job_id is distinct from root_job.id
    or terminal_job.network_retry_request_key is null
    or terminal_job.network_retry_request_digest is null
    or terminal_job.network_retry_reason_code is distinct from
       'official_receipt_network_unavailable'
    or terminal_job.network_retry_authorized_at is null
    or terminal_job.pilot_revision_id is distinct from source_pilot.id
    or terminal_job.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or terminal_job.expires_at > authorized_at
    or terminal_job.provider_code <> 'telebirr'
    or terminal_job.submitting_customer_id is distinct from source_proof.submitting_customer_id
    or terminal_job.player_account_id is distinct from source_proof.player_account_id
    or terminal_job.payment_provider_id is distinct from source_proof.payment_provider_id
    or terminal_job.candidate_reference_fingerprint
         is distinct from source_proof.candidate_reference_fingerprint
    or terminal_job.reference_encryption_key_version
         is distinct from source_proof.reference_encryption_key_version
    or terminal_job.reference_profile_version
         is distinct from source_proof.reference_profile_version
    or root_job.submitting_customer_id is distinct from terminal_job.submitting_customer_id
    or root_job.player_account_id is distinct from terminal_job.player_account_id
    or root_job.payment_provider_id is distinct from terminal_job.payment_provider_id
    or root_job.receiver_profile_id is distinct from terminal_job.receiver_profile_id
    or root_job.receiver_account_id is distinct from terminal_job.receiver_account_id
    or root_job.receiver_account_version is distinct from terminal_job.receiver_account_version
    or root_job.pilot_configuration_digest
         is distinct from terminal_job.pilot_configuration_digest
    or root_job.receiver_profile_digest is distinct from terminal_job.receiver_profile_digest
    or root_job.receiver_configuration_digest
         is distinct from terminal_job.receiver_configuration_digest
    or root_job.receiver_identity_digest is distinct from terminal_job.receiver_identity_digest
    or root_job.expected_receiver_name_digest
         is distinct from terminal_job.expected_receiver_name_digest
    or root_job.policy_digest is distinct from terminal_job.policy_digest
    or source_profile.id is null
    or source_profile.pilot_revision_id is distinct from source_pilot.id
    or source_profile.id is distinct from terminal_job.receiver_profile_id
    or target_profile.id is null
    or target_profile.pilot_revision_id is distinct from target_pilot.id
    or target_profile.valid_from > authorized_at
    or target_profile.valid_until <= authorized_at + interval '60 seconds'
    or root_outcome_count <> 1
    or root_outcome.id is null
    or root_outcome.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or root_outcome.disposition is distinct from 'review_required'
    or root_outcome.reason_code is distinct from 'source_unavailable'
    or root_outcome.deposit_intent_id is not null
    or root_outcome.deposit_submission_id is not null
    or root_outcome.provider_payment_evidence_id is not null
    or root_outcome.deposit_verification_attempt_id is not null
    or terminal_outcome_count <> 1
    or terminal_outcome.id is null
    or terminal_outcome.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or terminal_outcome.pilot_revision_id is distinct from source_pilot.id
    or terminal_outcome.disposition is distinct from 'review_required'
    or terminal_outcome.reason_code is distinct from 'source_unavailable'
    or terminal_outcome.deposit_intent_id is not null
    or terminal_outcome.deposit_submission_id is not null
    or terminal_outcome.provider_payment_evidence_id is not null
    or terminal_outcome.deposit_verification_attempt_id is not null
    or source_attempt_count <> 4
    or source_assignment_transcript_count <> 2
    or source_assignment_delivery_count <> 2
    or source_device_evidence_count <> 2
    or source_observation_count <> 1
    or (
      select pg_catalog.count(distinct attempt.attempt_number)
        from app.private_live_telebirr_verification_attempts attempt
       where attempt.verification_job_id = terminal_job.id
         and attempt.attempt_number between 1 and 4
    ) <> 4
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
       where attempt.verification_job_id = terminal_job.id
         and attempt.expires_at > authorized_at
    )
    or exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = source_proof.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id in (root_outcome.id, terminal_outcome.id)
    )
    or exists (
      select 1
        from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    )
    or exists (
      select 1
        from app.private_telebirr_shadow_proof_requests shadow_proof
       where shadow_proof.payment_provider_id = source_proof.payment_provider_id
         and shadow_proof.candidate_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    )
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    )
    or target_enrollment_count <> 1
    or target_enrollment.id is null
    or target_heartbeat.device_enrollment_id is null
    or target_heartbeat.runtime_state <> 'ready'
    or target_heartbeat.last_seen_at < authorized_at - pg_catalog.make_interval(
         secs => target_profile.automatic_freshness_seconds
       ) then
    raise exception 'The terminal source-unavailable live proof is not safely recoverable.';
  end if;

  if source_pilot.contract_version is distinct from target_pilot.contract_version
    or source_pilot.platform_id is distinct from target_pilot.platform_id
    or source_pilot.platform_agent_account_id is distinct from target_pilot.platform_agent_account_id
    or source_pilot.platform_agent_label_snapshot
         is distinct from target_pilot.platform_agent_label_snapshot
    or source_pilot.platform_agent_updated_at_snapshot
         is distinct from target_pilot.platform_agent_updated_at_snapshot
    or source_pilot.currency_code is distinct from target_pilot.currency_code
    or source_pilot.minimum_amount_minor is distinct from target_pilot.minimum_amount_minor
    or source_pilot.maximum_per_deposit_minor
         is distinct from target_pilot.maximum_per_deposit_minor
    or source_pilot.maximum_per_player_minor
         is distinct from target_pilot.maximum_per_player_minor
    or source_pilot.maximum_aggregate_minor
         is distinct from target_pilot.maximum_aggregate_minor
    or source_pilot.maximum_reservation_count
         is distinct from target_pilot.maximum_reservation_count
    or source_pilot.created_by_admin_id is distinct from target_pilot.created_by_admin_id
    or (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.player_account_id
             )
        from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = source_pilot.id
    ) is distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.player_account_id
             )
        from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = target_pilot.id
    )
    or (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.customer_id
             )
        from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = source_pilot.id
    ) is distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.customer_id
             )
        from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = target_pilot.id
    )
    or (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.payment_provider_id
             )
        from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = source_pilot.id
    ) is distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member)
                 - array['pilot_revision_id', 'created_at']::text[]
               order by member.payment_provider_id
             )
        from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = target_pilot.id
    )
    or source_profile.payment_provider_id is distinct from target_profile.payment_provider_id
    or source_profile.provider_code is distinct from target_profile.provider_code
    or source_profile.receiver_account_id is distinct from target_profile.receiver_account_id
    or source_profile.receiver_account_version
         is distinct from target_profile.receiver_account_version
    or source_profile.receiver_identity_digest
         is distinct from target_profile.receiver_identity_digest
    or source_profile.expected_receiver_name_digest
         is distinct from target_profile.expected_receiver_name_digest
    or source_profile.receiver_match_basis is distinct from target_profile.receiver_match_basis
    or source_profile.source_profile is distinct from target_profile.source_profile
    or source_profile.receiver_name_normalizer_version
         is distinct from target_profile.receiver_name_normalizer_version
    or source_profile.adapter_version is distinct from target_profile.adapter_version
    or source_profile.parser_version is distinct from target_profile.parser_version
    or source_profile.facts_normalizer_version
         is distinct from target_profile.facts_normalizer_version
    or source_profile.policy_version is distinct from target_profile.policy_version
    or source_profile.deposit_policy_version_id
         is distinct from target_profile.deposit_policy_version_id
    or source_profile.deposit_policy_version is distinct from target_profile.deposit_policy_version
    or source_profile.minimum_principal_amount_minor
         is distinct from target_profile.minimum_principal_amount_minor
    or source_profile.maximum_principal_amount_minor
         is distinct from target_profile.maximum_principal_amount_minor
    or source_profile.policy_digest is distinct from target_profile.policy_digest
    or source_profile.automatic_freshness_seconds
         is distinct from target_profile.automatic_freshness_seconds
    or source_profile.maximum_future_skew_seconds
         is distinct from target_profile.maximum_future_skew_seconds then
    raise exception 'The target dry-run pilot is not identical to the source proof pilot.';
  end if;

  recovered_until := least(
    authorized_at + interval '5 minutes',
    case
      when authorized_at < source_proof.submitted_at + interval '24 hours'
        then source_proof.submitted_at + interval '24 hours'
      else least(
        source_proof.submitted_at + interval '7 days',
        expired_source_authorization.expires_at
      )
    end,
    target_pilot.expires_at,
    target_profile.valid_until,
    target_enrollment.valid_until
  );
  if recovered_until <= authorized_at + interval '60 seconds' then
    raise exception 'The terminal source-unavailable recovery window is unavailable.';
  end if;

  replacement_shadow_job_id := pg_catalog.gen_random_uuid();
  shadow_recovery_digest := app.private_telebirr_expired_pilot_shadow_recovery_digest(
    p_recovery_request_key,
    terminal_job.id,
    source_proof.id,
    source_pilot.id,
    source_profile.id,
    target_pilot.id,
    target_profile.id,
    p_replacement_shadow_proof_request_id,
    replacement_shadow_job_id,
    root_job.expires_at,
    authorized_at,
    recovered_until,
    'expired_pilot_recovery_no_credit'
  );

  recovery_digest := app.private_live_telebirr_source_recovery_digest(
    p_recovery_request_key,
    root_job.id,
    root_outcome.id,
    terminal_job.id,
    terminal_outcome.id,
    source_proof.id,
    source_pilot.id,
    source_profile.id,
    p_replacement_shadow_proof_request_id,
    replacement_shadow_job_id,
    target_pilot.id,
    target_profile.id,
    source_attempt_count,
    source_assignment_transcript_count,
    source_assignment_delivery_count,
    source_device_evidence_count,
    source_observation_count,
    source_attempt_history_digest,
    authorized_at,
    recovered_until,
    p_reason_code
  );

  insert into app.private_telebirr_shadow_proof_requests (
    id,
    verification_job_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    receiver_profile_id,
    pilot_configuration_digest,
    origin_channel,
    input_kind,
    candidate_reference_ciphertext,
    candidate_reference_fingerprint,
    candidate_reference_masked,
    reference_encryption_key_version,
    reference_profile_version,
    submitted_at,
    not_before,
    expires_at,
    source_live_verification_job_id,
    source_live_proof_id,
    source_pilot_revision_id,
    source_receiver_profile_id,
    original_expires_at,
    recovered_at,
    recovery_request_key,
    recovery_request_digest,
    recovery_reason_code
  ) values (
    p_replacement_shadow_proof_request_id,
    replacement_shadow_job_id,
    target_pilot.id,
    source_proof.submitting_customer_id,
    source_proof.player_account_id,
    source_proof.payment_provider_id,
    target_profile.id,
    target_pilot.configuration_digest,
    source_proof.origin_channel,
    source_proof.input_kind,
    source_proof.candidate_reference_ciphertext,
    source_proof.candidate_reference_fingerprint,
    source_proof.candidate_reference_masked,
    source_proof.reference_encryption_key_version,
    source_proof.reference_profile_version,
    source_proof.submitted_at,
    source_proof.submitted_at,
    recovered_until,
    terminal_job.id,
    source_proof.id,
    source_pilot.id,
    source_profile.id,
    root_job.expires_at,
    authorized_at,
    p_recovery_request_key,
    shadow_recovery_digest,
    'expired_pilot_recovery_no_credit'
  )
  returning * into inserted_shadow;

  insert into app.private_live_telebirr_source_recoveries (
    recovery_request_key,
    recovery_request_digest,
    root_live_verification_job_id,
    root_live_outcome_id,
    terminal_live_verification_job_id,
    terminal_live_outcome_id,
    source_live_proof_id,
    source_pilot_revision_id,
    source_receiver_profile_id,
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id,
    target_pilot_revision_id,
    target_receiver_profile_id,
    source_attempt_count,
    source_assignment_transcript_count,
    source_assignment_delivery_count,
    source_device_evidence_count,
    source_observation_count,
    source_attempt_history_digest,
    authorized_at,
    recovery_expires_at,
    reason_code
  ) values (
    p_recovery_request_key,
    recovery_digest,
    root_job.id,
    root_outcome.id,
    terminal_job.id,
    terminal_outcome.id,
    source_proof.id,
    source_pilot.id,
    source_profile.id,
    inserted_shadow.id,
    inserted_shadow.verification_job_id,
    target_pilot.id,
    target_profile.id,
    source_attempt_count,
    source_assignment_transcript_count,
    source_assignment_delivery_count,
    source_device_evidence_count,
    source_observation_count,
    source_attempt_history_digest,
    authorized_at,
    recovered_until,
    p_reason_code
  );

  return query
  select inserted_shadow.id,
         inserted_shadow.verification_job_id,
         inserted_shadow.expires_at,
         false;
end;
$$;

create or replace function app.private_live_telebirr_source_recovery_is_valid(
  p_replacement_shadow_proof_request_id uuid,
  p_recovery_request_key uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  recovery app.private_live_telebirr_source_recoveries%rowtype;
  shadow_proof app.private_telebirr_shadow_proof_requests%rowtype;
  root_job app.private_live_telebirr_verification_jobs%rowtype;
  terminal_job app.private_live_telebirr_verification_jobs%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  expired_source_authorization
    app.private_live_telebirr_expired_source_authorizations%rowtype;
  root_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  terminal_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  current_attempt_count integer;
  current_transcript_count integer;
  current_delivery_count integer;
  current_evidence_count integer;
  current_observation_count integer;
  current_attempt_history_digest text;
  expected_digest text;
  expected_shadow_digest text;
begin
  if p_replacement_shadow_proof_request_id is null or p_recovery_request_key is null then
    return false;
  end if;

  select candidate.*
    into recovery
    from app.private_live_telebirr_source_recoveries candidate
   where candidate.recovery_request_key = p_recovery_request_key
     and candidate.replacement_shadow_proof_request_id =
         p_replacement_shadow_proof_request_id;

  select proof.*
    into shadow_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = recovery.replacement_shadow_proof_request_id
     and proof.verification_job_id = recovery.replacement_shadow_verification_job_id;

  select job.* into root_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = recovery.root_live_verification_job_id;
  select job.* into terminal_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = recovery.terminal_live_verification_job_id;
  select proof.* into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = recovery.source_live_proof_id;
  select candidate_authorization.* into expired_source_authorization
    from app.private_live_telebirr_expired_source_authorizations candidate_authorization
   where candidate_authorization.source_proof_binding_digest =
         app.private_live_telebirr_expired_source_binding_digest(source_proof.id);
  select outcome.* into root_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.id = recovery.root_live_outcome_id;
  select outcome.* into terminal_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.id = recovery.terminal_live_outcome_id;

  select pg_catalog.count(*)::integer,
         app.private_live_deposit_pilot_sha256(
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'attempt_id', attempt.id,
                 'attempt_number', attempt.attempt_number,
                 'device_enrollment_id', attempt.device_enrollment_id,
                 'lease_request_digest', attempt.lease_request_digest,
                 'issued_at', attempt.issued_at,
                 'expires_at', attempt.expires_at
               ) order by attempt.attempt_number, attempt.id
             )::text,
             '[]'
           )
         )
    into current_attempt_count, current_attempt_history_digest
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.verification_job_id = terminal_job.id;

  select pg_catalog.count(*)::integer into current_transcript_count
    from app.private_live_telebirr_assignment_transcripts transcript
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = transcript.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;
  select pg_catalog.count(*)::integer into current_delivery_count
    from app.private_live_telebirr_assignment_deliveries delivery
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = delivery.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;
  select pg_catalog.count(*)::integer into current_evidence_count
    from app.private_live_telebirr_device_evidence_staging evidence
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = evidence.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;
  select pg_catalog.count(*)::integer into current_observation_count
    from app.private_live_telebirr_observation_transcripts observation
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = observation.verification_attempt_id
   where attempt.verification_job_id = terminal_job.id;

  expected_digest := app.private_live_telebirr_source_recovery_digest(
    recovery.recovery_request_key,
    recovery.root_live_verification_job_id,
    recovery.root_live_outcome_id,
    recovery.terminal_live_verification_job_id,
    recovery.terminal_live_outcome_id,
    recovery.source_live_proof_id,
    recovery.source_pilot_revision_id,
    recovery.source_receiver_profile_id,
    recovery.replacement_shadow_proof_request_id,
    recovery.replacement_shadow_verification_job_id,
    recovery.target_pilot_revision_id,
    recovery.target_receiver_profile_id,
    recovery.source_attempt_count,
    recovery.source_assignment_transcript_count,
    recovery.source_assignment_delivery_count,
    recovery.source_device_evidence_count,
    recovery.source_observation_count,
    recovery.source_attempt_history_digest,
    recovery.authorized_at,
    recovery.recovery_expires_at,
    recovery.reason_code
  );

  expected_shadow_digest := app.private_telebirr_expired_pilot_shadow_recovery_digest(
    recovery.recovery_request_key,
    terminal_job.id,
    source_proof.id,
    recovery.source_pilot_revision_id,
    recovery.source_receiver_profile_id,
    recovery.target_pilot_revision_id,
    recovery.target_receiver_profile_id,
    shadow_proof.id,
    shadow_proof.verification_job_id,
    root_job.expires_at,
    recovery.authorized_at,
    recovery.recovery_expires_at,
    'expired_pilot_recovery_no_credit'
  );

  return recovery.recovery_request_key is not null
    and recovery.reason_code = 'terminal_source_unavailable_recovery_no_credit'
    and recovery.recovery_request_digest = expected_digest
    and recovery.recovery_expires_at > pg_catalog.clock_timestamp()
    and (
      (
        recovery.authorized_at < source_proof.submitted_at + interval '24 hours'
        and recovery.recovery_expires_at <=
            source_proof.submitted_at + interval '24 hours'
      )
      or (
        recovery.authorized_at >= source_proof.submitted_at + interval '24 hours'
        and recovery.authorized_at < source_proof.submitted_at + interval '7 days'
        and expired_source_authorization.source_proof_binding_digest is not null
        and expired_source_authorization.reason_code =
            'reviewed_expired_source_unavailable_no_credit'
        and expired_source_authorization.valid_after <= recovery.authorized_at
        and expired_source_authorization.expires_at > recovery.authorized_at
        and recovery.recovery_expires_at <= least(
          source_proof.submitted_at + interval '7 days',
          expired_source_authorization.expires_at
        )
      )
    )
    and current_attempt_count = recovery.source_attempt_count
    and current_transcript_count = recovery.source_assignment_transcript_count
    and current_delivery_count = recovery.source_assignment_delivery_count
    and current_evidence_count = recovery.source_device_evidence_count
    and current_observation_count = recovery.source_observation_count
    and current_attempt_history_digest = recovery.source_attempt_history_digest
    and root_job.id is not null
    and terminal_job.network_retry_source_job_id = root_job.id
    and root_job.private_live_deposit_pilot_proof_id = source_proof.id
    and terminal_job.private_live_deposit_pilot_proof_id = source_proof.id
    and root_outcome.verification_job_id = root_job.id
    and root_outcome.private_live_deposit_pilot_proof_id = source_proof.id
    and root_outcome.disposition = 'review_required'
    and root_outcome.reason_code = 'source_unavailable'
    and terminal_outcome.verification_job_id = terminal_job.id
    and terminal_outcome.private_live_deposit_pilot_proof_id = source_proof.id
    and terminal_outcome.disposition = 'review_required'
    and terminal_outcome.reason_code = 'source_unavailable'
    and root_outcome.deposit_intent_id is null
    and root_outcome.deposit_submission_id is null
    and root_outcome.provider_payment_evidence_id is null
    and root_outcome.deposit_verification_attempt_id is null
    and terminal_outcome.deposit_intent_id is null
    and terminal_outcome.deposit_submission_id is null
    and terminal_outcome.provider_payment_evidence_id is null
    and terminal_outcome.deposit_verification_attempt_id is null
    and shadow_proof.source_live_verification_job_id = terminal_job.id
    and shadow_proof.source_live_proof_id = source_proof.id
    and shadow_proof.pilot_revision_id = recovery.target_pilot_revision_id
    and shadow_proof.receiver_profile_id = recovery.target_receiver_profile_id
    and shadow_proof.recovery_request_key = recovery.recovery_request_key
    and shadow_proof.recovery_request_digest = expected_shadow_digest
    and shadow_proof.recovery_reason_code = 'expired_pilot_recovery_no_credit'
    and shadow_proof.expires_at = recovery.recovery_expires_at
    and not exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = source_proof.id
    )
    and not exists (
      select 1
        from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id in (root_outcome.id, terminal_outcome.id)
    )
    and not exists (
      select 1
        from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    )
    and not exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and role.rolcanlogin
    )
    and not exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    )
    and app.current_private_trusted_telebirr_activation_epoch() is null
    and app.private_telebirr_shadow_mode_is_ready(recovery.target_pilot_revision_id);
exception
  when others then
    return false;
end;
$$;

alter table app.private_live_telebirr_source_recoveries owner to postgres;
alter table app.private_live_telebirr_expired_source_authorizations owner to postgres;
alter function app.private_live_telebirr_expired_source_binding_digest(uuid)
  owner to postgres;
alter function app.private_live_telebirr_source_recovery_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, integer, integer, integer, text, timestamptz, timestamptz, text
) owner to postgres;
alter function app.recover_private_live_telebirr_source_to_shadow(
  uuid, uuid, uuid, uuid, uuid, text
) owner to postgres;
alter function app.private_live_telebirr_source_recovery_is_valid(uuid, uuid)
  owner to postgres;

revoke all on table app.private_live_telebirr_source_recoveries
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on table app.private_live_telebirr_expired_source_authorizations
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function app.private_live_telebirr_expired_source_binding_digest(uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all on function app.private_live_telebirr_source_recovery_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, integer, integer, integer, text, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function app.recover_private_live_telebirr_source_to_shadow(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all on function app.private_live_telebirr_source_recovery_is_valid(uuid, uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

comment on table app.private_live_telebirr_expired_source_authorizations is
  'Immutable reviewed capability ledger containing one domain-separated proof binding and a six-day post-window validity period. It stores no raw production identifier and grants no financial or KemerBet authority.';
comment on function app.private_live_telebirr_expired_source_binding_digest(uuid) is
  'Derives the private domain-separated binding used to match only the reviewed expired live proof without storing its raw identifier.';
comment on table app.private_live_telebirr_source_recoveries is
  'Immutable one-use ledger from the exact terminal live source_unavailable lineage to one advisory dry-run shadow request. It grants no financial or KemerBet authority.';
comment on function app.recover_private_live_telebirr_source_to_shadow(
  uuid, uuid, uuid, uuid, uuid, text
) is
  'Postgres-only creation of one five-minute advisory shadow request for the exact reviewed terminal live source_unavailable lineage, including the single digest-bound expired-window proof. Original live rows remain append-only and no claim, reservation, settlement, execution job, or money movement is created.';
comment on function app.private_live_telebirr_source_recovery_is_valid(uuid, uuid) is
  'Validates the immutable terminal live source_unavailable to shadow recovery lineage without exposing the protected reference.';

commit;
