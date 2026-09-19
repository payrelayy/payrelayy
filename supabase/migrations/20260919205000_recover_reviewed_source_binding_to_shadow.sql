-- Continue one reviewed, closed TeleBirr source-binding recovery into a fresh no-money shadow
-- request under the exact current twelve-hour dry-run pilot. The prior and current live proof
-- lineages remain immutable. This migration never enables financial authority, creates a claim,
-- reserves funds, settles, enqueues execution, credits KemerBet, or moves money.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;
lock table app.private_live_telebirr_source_binding_recovery_retries
  in share row exclusive mode;
lock table app.private_live_telebirr_source_binding_recovery_closures
  in share row exclusive mode;

do $reviewed_source_binding_shadow_installation_preflight$
declare
  safe_switch_count integer;
  disabled_companion_count integer;
begin
  if pg_catalog.to_regclass(
       'app.private_live_telebirr_source_binding_shadow_recoveries'
     ) is not null
    or pg_catalog.to_regprocedure(
         'app.private_live_telebirr_source_binding_shadow_recovery_is_valid(uuid,uuid)'
       ) is not null
    or pg_catalog.to_regprocedure(
         'app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(text)'
       ) is not null
    or app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'The reviewed source-binding shadow recovery prerequisites do not match.';
  end if;

  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  select pg_catalog.count(*)::integer
    into disabled_companion_count
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
     and execution_control.control_state = 'disabled'
     and execution_control.certificate_id is null
     and execution_control.device_id is null
     and execution_control.device_key_id is null
     and execution_control.no_money_signer_key_id is null
     and execution_control.execution_signer_key_id is null
     and execution_control.execution_signer_public_key_spki is null
     and execution_control.execution_signer_public_key_spki_sha256 is null
     and execution_control.platform_agent_account_id is null
     and execution_control.pilot_revision_id is null
     and execution_control.pilot_revision is null
     and execution_control.pilot_configuration_digest is null
     and execution_control.activation_epoch is null
     and execution_control.active_from is null
     and execution_control.expires_at is null
     and execution_control.activated_by_admin_id is null
     and execution_control.activated_at is null;

  if safe_switch_count <> 7
    or disabled_companion_count <> 1
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception 'The reviewed source-binding shadow recovery requires the no-money boundary.';
  end if;
end;
$reviewed_source_binding_shadow_installation_preflight$;

alter table app.private_telebirr_shadow_proof_requests
  drop constraint private_telebirr_shadow_recovery_reason_check,
  add constraint private_telebirr_shadow_recovery_reason_check check (
    recovery_reason_code is null
    or recovery_reason_code in (
      'expired_pilot_recovery_no_credit',
      'reviewed_source_binding_source_unavailable_recovery_no_credit'
    )
  );

-- Extend the deployed constraint expression instead of rebuilding it from an older schema
-- snapshot. This preserves the direct, ordinary recovery, retry, infrastructure-retry, and
-- runtime-retry branches byte-for-byte and adds exactly one disjoint reviewed branch.
do $extend_reviewed_source_binding_shadow_window$
declare
  definition text;
  prior_expression text;
  installed_definition text;
  new_reason constant text :=
    'reviewed_source_binding_source_unavailable_recovery_no_credit';
  legacy_reason constant text := 'expired_pilot_recovery_no_credit';
  new_branch constant text := $reviewed_branch$
    not_before = submitted_at
    and expires_at > not_before
    and source_live_verification_job_id is not null
    and source_live_proof_id is not null
    and source_pilot_revision_id is not null
    and source_receiver_profile_id is not null
    and original_expires_at is not null
    and recovered_at is not null
    and recovery_request_key is not null
    and recovery_request_digest is not null
    and recovery_reason_code =
        'reviewed_source_binding_source_unavailable_recovery_no_credit'
    and source_pilot_revision_id <> pilot_revision_id
    and original_expires_at > submitted_at
    and recovered_at >= original_expires_at
    and retry_request_key is null
    and retry_request_digest is null
    and retry_reason_code is null
    and retry_prior_pilot_revision_id is null
    and retry_prior_receiver_profile_id is null
    and retry_prior_configuration_digest is null
    and retry_original_expires_at is null
    and retried_at is null
    and infrastructure_retry_request_key is null
    and infrastructure_retry_request_digest is null
    and infrastructure_retry_reason_code is null
    and infrastructure_retry_original_expires_at is null
    and infrastructure_retried_at is null
    and runtime_retry_request_key is null
    and runtime_retry_request_digest is null
    and runtime_retry_reason_code is null
    and runtime_retry_original_expires_at is null
    and runtime_retry_prior_attempt_count is null
    and runtime_retry_prior_attempt_history_digest is null
    and runtime_retried_at is null
    and source_unavailable_retry_source_id is null
    and observation_clock_retry_source_id is null
    and authority_deadline_retry_source_id is null
    and assessment_clock_retry_source_id is null
    and expires_at > recovered_at + interval '11 hours 50 minutes'
    and expires_at <= recovered_at + interval '12 hours 5 minutes'
  $reviewed_branch$;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_proof_window_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;

  if definition is null
    or pg_catalog.left(definition, 7) <> 'CHECK ('
    or pg_catalog.right(definition, 1) <> ')'
    or pg_catalog.strpos(definition, new_reason) <> 0
    or (
      pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition, legacy_reason, ''))
    ) / pg_catalog.length(legacy_reason) <> 1
    or pg_catalog.strpos(definition, 'source_unavailable_retry_source_id') <> 0
    or pg_catalog.strpos(definition, 'observation_clock_retry_source_id') <> 0
    or pg_catalog.strpos(definition, 'authority_deadline_retry_source_id') <> 0
    or pg_catalog.strpos(definition, 'assessment_clock_retry_source_id') <> 0 then
    raise exception 'The deployed TeleBirr shadow proof window changed shape.';
  end if;

  prior_expression := pg_catalog.substring(
    definition,
    8,
    pg_catalog.length(definition) - 8
  );
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'drop constraint private_telebirr_shadow_proof_window_check';
  execute 'alter table app.private_telebirr_shadow_proof_requests '
       || 'add constraint private_telebirr_shadow_proof_window_check check (('
       || prior_expression || ') or (' || new_branch || '))';

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into installed_definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_proof_window_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;

  if installed_definition is null
    or (
      pg_catalog.length(installed_definition)
      - pg_catalog.length(pg_catalog.replace(installed_definition, new_reason, ''))
    ) / pg_catalog.length(new_reason) <> 1
    or pg_catalog.strpos(installed_definition, legacy_reason) = 0
    or pg_catalog.strpos(
         installed_definition,
         'runtime_retry_request_key'
       ) = 0
    or pg_catalog.strpos(
         installed_definition,
         'source_unavailable_retry_source_id'
       ) = 0
    or pg_catalog.strpos(
         installed_definition,
         'assessment_clock_retry_source_id'
       ) = 0 then
    raise exception 'The reviewed source-binding shadow window was not installed exactly.';
  end if;
end;
$extend_reviewed_source_binding_shadow_window$;

create table app.private_live_telebirr_source_binding_shadow_recoveries (
  recovery_request_key uuid primary key,
  recovery_request_digest text not null unique
    check (recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_binding_retry_request_key uuid not null unique
    references app.private_live_telebirr_source_binding_recovery_retries (
      retry_request_key
    ) on delete restrict,
  source_live_proof_id uuid not null unique
    references app.private_live_deposit_pilot_proofs (id) on delete restrict,
  source_live_outcome_id uuid not null unique
    references app.private_live_telebirr_verification_outcomes (id) on delete restrict,
  source_pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  source_receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  replacement_shadow_proof_request_id uuid not null unique,
  replacement_shadow_verification_job_id uuid not null unique,
  target_pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  target_receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  source_attempt_count integer not null check (source_attempt_count = 1),
  source_assignment_transcript_count integer not null
    check (source_assignment_transcript_count = 1),
  source_assignment_delivery_count integer not null
    check (source_assignment_delivery_count = 1),
  source_device_evidence_count integer not null
    check (source_device_evidence_count = 1),
  source_observation_count integer not null check (source_observation_count = 1),
  source_outcome_count integer not null check (source_outcome_count = 1),
  source_attempt_history_digest text not null
    check (source_attempt_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  authorized_at timestamptz not null,
  recovery_expires_at timestamptz not null,
  reason_code text not null check (
    reason_code = 'reviewed_source_binding_source_unavailable_recovery_no_credit'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_tbirr_binding_shadow_request_v4_check check (
    recovery_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_tbirr_binding_shadow_pilots_distinct_check check (
    source_pilot_revision_id <> target_pilot_revision_id
  ),
  constraint private_live_tbirr_binding_shadow_window_check check (
    recovery_expires_at > authorized_at + interval '11 hours 50 minutes'
    and recovery_expires_at <= authorized_at + interval '12 hours 5 minutes'
  ),
  constraint private_live_tbirr_binding_shadow_proof_fkey foreign key (
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id
  ) references app.private_telebirr_shadow_proof_requests (
    id,
    verification_job_id
  ) on delete restrict
);

create trigger private_live_tbirr_binding_shadow_recoveries_immutable
before update or delete on app.private_live_telebirr_source_binding_shadow_recoveries
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_tbirr_binding_shadow_recoveries_no_truncate
before truncate on app.private_live_telebirr_source_binding_shadow_recoveries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.private_live_telebirr_source_binding_shadow_recoveries
  enable row level security;
alter table app.private_live_telebirr_source_binding_shadow_recoveries
  force row level security;

create function app.private_live_telebirr_source_binding_shadow_recovery_digest(
  p_recovery_request_key uuid,
  p_source_binding_retry_request_key uuid,
  p_source_binding_retry_digest text,
  p_source_live_proof_id uuid,
  p_source_live_outcome_id uuid,
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
  p_source_outcome_count integer,
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
    or p_source_binding_retry_request_key is null
    or p_source_binding_retry_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_live_proof_id is null
    or p_source_live_outcome_id is null
    or p_source_pilot_revision_id is null
    or p_source_receiver_profile_id is null
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_target_pilot_revision_id is null
    or p_target_receiver_profile_id is null
    or p_source_attempt_count <> 1
    or p_source_assignment_transcript_count <> 1
    or p_source_assignment_delivery_count <> 1
    or p_source_device_evidence_count <> 1
    or p_source_observation_count <> 1
    or p_source_outcome_count <> 1
    or p_source_attempt_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_authorized_at is null
    or p_recovery_expires_at is null
    or p_reason_code is distinct from
       'reviewed_source_binding_source_unavailable_recovery_no_credit' then
    raise exception 'The reviewed source-binding shadow recovery digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:reviewed-source-binding:shadow-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|source_binding_retry_key=' || p_source_binding_retry_request_key::text
      || '|source_binding_retry_digest=' || p_source_binding_retry_digest
      || '|source_proof_id=' || p_source_live_proof_id::text
      || '|source_outcome_id=' || p_source_live_outcome_id::text
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
      || '|outcomes=' || p_source_outcome_count::text
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

create function app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
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
  recovery app.private_live_telebirr_source_binding_shadow_recoveries%rowtype;
  source_retry app.private_live_telebirr_source_binding_recovery_retries%rowtype;
  source_closure app.private_live_telebirr_source_binding_recovery_closures%rowtype;
  original_closure app.private_live_telebirr_historical_completion_closures%rowtype;
  shadow_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  source_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  current_attempt_count integer;
  current_transcript_count integer;
  current_delivery_count integer;
  current_evidence_count integer;
  current_observation_count integer;
  current_outcome_count integer;
  current_attempt_history_digest text;
  expected_source_binding_digest text;
  expected_recovery_digest text;
begin
  if p_replacement_shadow_proof_request_id is null
    or p_recovery_request_key is null then
    return false;
  end if;

  select candidate.* into recovery
    from app.private_live_telebirr_source_binding_shadow_recoveries candidate
   where candidate.recovery_request_key = p_recovery_request_key
     and candidate.replacement_shadow_proof_request_id =
         p_replacement_shadow_proof_request_id;

  select retry.* into source_retry
    from app.private_live_telebirr_source_binding_recovery_retries retry
   where retry.retry_request_key = recovery.source_binding_retry_request_key;
  select closure.* into source_closure
    from app.private_live_telebirr_source_binding_recovery_closures closure
   where closure.retry_request_key = source_retry.retry_request_key;
  select closure.* into original_closure
    from app.private_live_telebirr_historical_completion_closures closure
   where closure.request_key = source_retry.original_authority_request_key;
  select proof.* into shadow_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = recovery.replacement_shadow_proof_request_id
     and proof.verification_job_id = recovery.replacement_shadow_verification_job_id;
  select job.* into source_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = source_retry.current_verification_job_id;
  select proof.* into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = recovery.source_live_proof_id;
  select outcome.* into source_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.id = recovery.source_live_outcome_id;
  select profile.* into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = recovery.source_receiver_profile_id;

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
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into current_transcript_count
    from app.private_live_telebirr_assignment_transcripts transcript
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = transcript.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into current_delivery_count
    from app.private_live_telebirr_assignment_deliveries delivery
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = delivery.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into current_evidence_count
    from app.private_live_telebirr_device_evidence_staging evidence
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = evidence.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into current_observation_count
    from app.private_live_telebirr_observation_transcripts observation
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = observation.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into current_outcome_count
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = source_job.id;

  expected_source_binding_digest :=
    app.private_live_telebirr_source_binding_recovery_digest(
      source_retry.retry_request_key,
      source_retry.original_authority_request_key,
      source_retry.source_document_digest,
      source_retry.payment_provider_id,
      source_retry.prior_verification_job_id,
      source_retry.prior_verification_attempt_id,
      source_retry.prior_verification_outcome_id,
      source_retry.current_verification_job_id,
      source_retry.current_verification_attempt_id,
      source_retry.prior_candidate_reference_fingerprint,
      source_retry.current_candidate_reference_fingerprint,
      source_retry.normalized_facts_digest,
      source_retry.authorized_at,
      source_retry.expires_at,
      source_retry.reason_code
    );

  expected_recovery_digest :=
    app.private_live_telebirr_source_binding_shadow_recovery_digest(
      recovery.recovery_request_key,
      recovery.source_binding_retry_request_key,
      source_retry.request_digest,
      recovery.source_live_proof_id,
      recovery.source_live_outcome_id,
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
      recovery.source_outcome_count,
      recovery.source_attempt_history_digest,
      recovery.authorized_at,
      recovery.recovery_expires_at,
      recovery.reason_code
    );

  return recovery.recovery_request_key is not null
    and recovery.reason_code =
        'reviewed_source_binding_source_unavailable_recovery_no_credit'
    and recovery.recovery_request_digest = expected_recovery_digest
    and recovery.authorized_at <= pg_catalog.clock_timestamp()
    and recovery.recovery_expires_at > pg_catalog.clock_timestamp()
    and source_retry.request_digest = expected_source_binding_digest
    and source_retry.reason_code =
        'source_binding_supersession_after_nonfinancial_review'
    and source_closure.reason_code = 'operator_stop'
    and source_closure.closed_at >= source_retry.authorized_at
    and original_closure.reason_code = 'operator_stop'
    and original_closure.closed_at <= source_retry.authorized_at
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = source_retry.original_authority_request_key
    )
    and source_job.id = source_retry.current_verification_job_id
    and source_job.private_live_deposit_pilot_proof_id = source_proof.id
    and source_job.pilot_revision_id = recovery.source_pilot_revision_id
    and source_job.receiver_profile_id = source_profile.id
    and source_job.payment_provider_id = source_retry.payment_provider_id
    and source_job.candidate_reference_fingerprint =
        source_retry.current_candidate_reference_fingerprint
    and source_job.expires_at <= recovery.authorized_at
    and source_proof.pilot_revision_id = recovery.source_pilot_revision_id
    and source_proof.provider_code_snapshot = 'telebirr'
    and source_proof.origin_channel = 'telegram'
    and source_proof.input_kind = 'direct_transaction_id'
    and source_outcome.verification_job_id = source_job.id
    and source_outcome.private_live_deposit_pilot_proof_id = source_proof.id
    and source_outcome.disposition = 'review_required'
    and source_outcome.reason_code = 'source_unavailable'
    and source_outcome.deposit_intent_id is null
    and source_outcome.deposit_submission_id is null
    and source_outcome.provider_payment_evidence_id is null
    and source_outcome.deposit_verification_attempt_id is null
    and current_attempt_count = recovery.source_attempt_count
    and current_transcript_count = recovery.source_assignment_transcript_count
    and current_delivery_count = recovery.source_assignment_delivery_count
    and current_evidence_count = recovery.source_device_evidence_count
    and current_observation_count = recovery.source_observation_count
    and current_outcome_count = recovery.source_outcome_count
    and current_attempt_history_digest = recovery.source_attempt_history_digest
    and shadow_proof.source_live_verification_job_id = source_job.id
    and shadow_proof.source_live_proof_id = source_proof.id
    and shadow_proof.source_pilot_revision_id = recovery.source_pilot_revision_id
    and shadow_proof.source_receiver_profile_id = recovery.source_receiver_profile_id
    and shadow_proof.pilot_revision_id = recovery.target_pilot_revision_id
    and shadow_proof.receiver_profile_id = recovery.target_receiver_profile_id
    and shadow_proof.recovery_request_key = recovery.recovery_request_key
    and shadow_proof.recovery_request_digest = recovery.recovery_request_digest
    and shadow_proof.recovery_reason_code = recovery.reason_code
    and shadow_proof.recovered_at = recovery.authorized_at
    and shadow_proof.expires_at = recovery.recovery_expires_at
    and not exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id in (
         source_proof.id,
         (
           select prior_job.private_live_deposit_pilot_proof_id
             from app.private_live_telebirr_verification_jobs prior_job
            where prior_job.id = source_retry.prior_verification_job_id
         )
       )
    )
    and not exists (
      select 1
        from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id in (
         source_outcome.id,
         source_retry.prior_verification_outcome_id
       )
    )
    and not exists (
      select 1
        from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint in (
           source_retry.prior_candidate_reference_fingerprint,
           source_retry.current_candidate_reference_fingerprint
         )
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
    and app.private_telebirr_shadow_mode_is_ready(
      recovery.target_pilot_revision_id
    );
exception
  when others then
    return false;
end;
$$;

create function app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(
  p_reason_code text
)
returns table (
  created boolean,
  shadow_request_count integer,
  configured_window_seconds integer,
  remaining_seconds integer,
  money_moved boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  source_retry app.private_live_telebirr_source_binding_recovery_retries%rowtype;
  source_closure app.private_live_telebirr_source_binding_recovery_closures%rowtype;
  original_closure app.private_live_telebirr_historical_completion_closures%rowtype;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  source_attempt app.private_live_telebirr_verification_attempts%rowtype;
  source_observation app.private_live_telebirr_observation_transcripts%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  source_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  prior_job app.private_live_telebirr_verification_jobs%rowtype;
  prior_attempt app.private_live_telebirr_verification_attempts%rowtype;
  prior_observation app.private_live_telebirr_observation_transcripts%rowtype;
  prior_proof app.private_live_deposit_pilot_proofs%rowtype;
  prior_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  source_binding app.private_live_telebirr_source_document_bindings%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  existing_recovery app.private_live_telebirr_source_binding_shadow_recoveries%rowtype;
  inserted_shadow app.private_telebirr_shadow_proof_requests%rowtype;
  candidate_count integer;
  existing_recovery_count integer;
  locked_switch_count integer;
  source_attempt_count integer;
  source_transcript_count integer;
  source_delivery_count integer;
  source_evidence_count integer;
  source_observation_count integer;
  source_outcome_count integer;
  source_attempt_history_digest text;
  expected_source_binding_digest text;
  recovery_request_key uuid;
  replacement_shadow_proof_id uuid;
  replacement_shadow_job_id uuid;
  recovery_digest text;
  authorized_at timestamptz;
begin
  if session_user <> 'postgres'
    or p_reason_code is distinct from
       'reviewed_source_binding_source_unavailable_recovery_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The reviewed source-binding shadow recovery request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:reviewed-source-binding:shadow-recovery',
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
   for update;
  get diagnostics locked_switch_count = row_count;

  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select pilot.* into target_pilot
    from app.feature_switches pilot_switch
    join app.private_live_deposit_pilot_revisions pilot
      on pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
   where pilot_switch.feature_key = 'private_live_deposit_pilot'
     and pilot_switch.mode = 'dry_run'
     and pilot.status = 'armed'
   for update of pilot;

  select pg_catalog.count(*)::integer
    into candidate_count
    from app.private_live_telebirr_source_binding_recovery_retries retry
    join app.private_live_telebirr_source_binding_recovery_closures closure
      on closure.retry_request_key = retry.retry_request_key
     and closure.reason_code = 'operator_stop'
    join app.private_live_telebirr_verification_outcomes outcome
      on outcome.verification_job_id = retry.current_verification_job_id
     and outcome.verification_attempt_id = retry.current_verification_attempt_id
     and outcome.disposition = 'review_required'
     and outcome.reason_code = 'source_unavailable'
     and outcome.deposit_intent_id is null
     and outcome.deposit_submission_id is null
     and outcome.provider_payment_evidence_id is null
     and outcome.deposit_verification_attempt_id is null
    left join app.private_live_telebirr_source_binding_shadow_recoveries recovery
      on recovery.source_binding_retry_request_key = retry.retry_request_key
   where recovery.recovery_request_key is null
     and not exists (
       select 1
         from app.private_live_telebirr_historical_completion_consumptions consumption
        where consumption.request_key = retry.original_authority_request_key
     );

  if candidate_count = 0 then
    select pg_catalog.count(*)::integer
      into existing_recovery_count
      from app.private_live_telebirr_source_binding_shadow_recoveries recovery
     where recovery.reason_code =
           'reviewed_source_binding_source_unavailable_recovery_no_credit';
    select recovery.* into existing_recovery
      from app.private_live_telebirr_source_binding_shadow_recoveries recovery
     where recovery.reason_code =
           'reviewed_source_binding_source_unavailable_recovery_no_credit'
     order by recovery.authorized_at desc, recovery.recovery_request_key
     limit 1;
    if existing_recovery_count = 1
      and existing_recovery.recovery_request_key is not null
      and app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
        existing_recovery.replacement_shadow_proof_request_id,
        existing_recovery.recovery_request_key
      ) then
      return query
      select false,
             1,
             extract(epoch from (
               (
                 select pilot.expires_at - pilot.active_from
                   from app.private_live_deposit_pilot_revisions pilot
                  where pilot.id = existing_recovery.target_pilot_revision_id
               )
             ))::integer,
             greatest(
               0,
               extract(epoch from (
                 existing_recovery.recovery_expires_at - pg_catalog.clock_timestamp()
               ))::integer
             ),
             false;
      return;
    end if;
  end if;

  if candidate_count <> 1 then
    raise exception 'Exactly one reviewed source-binding recovery must be eligible.';
  end if;

  select retry.* into source_retry
    from app.private_live_telebirr_source_binding_recovery_retries retry
    join app.private_live_telebirr_source_binding_recovery_closures closure
      on closure.retry_request_key = retry.retry_request_key
     and closure.reason_code = 'operator_stop'
    join app.private_live_telebirr_verification_outcomes outcome
      on outcome.verification_job_id = retry.current_verification_job_id
     and outcome.verification_attempt_id = retry.current_verification_attempt_id
     and outcome.disposition = 'review_required'
     and outcome.reason_code = 'source_unavailable'
    left join app.private_live_telebirr_source_binding_shadow_recoveries recovery
      on recovery.source_binding_retry_request_key = retry.retry_request_key
   where recovery.recovery_request_key is null
     and not exists (
       select 1
         from app.private_live_telebirr_historical_completion_consumptions consumption
        where consumption.request_key = retry.original_authority_request_key
     )
   for share of retry, closure, outcome;

  select closure.* into source_closure
    from app.private_live_telebirr_source_binding_recovery_closures closure
   where closure.retry_request_key = source_retry.retry_request_key
   for share;
  select closure.* into original_closure
    from app.private_live_telebirr_historical_completion_closures closure
   where closure.request_key = source_retry.original_authority_request_key
   for share;
  select job.* into source_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = source_retry.current_verification_job_id
   for update;
  select attempt.* into source_attempt
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.id = source_retry.current_verification_attempt_id
   for share;
  select observation.* into source_observation
    from app.private_live_telebirr_observation_transcripts observation
   where observation.verification_attempt_id = source_attempt.id
   for share;
  select proof.* into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = source_job.private_live_deposit_pilot_proof_id
   for key share;
  select outcome.* into source_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = source_job.id
     and outcome.verification_attempt_id = source_attempt.id
   for share;
  select pilot.* into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = source_job.pilot_revision_id
   for share;
  select profile.* into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = source_job.receiver_profile_id
   for share;
  select job.* into prior_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = source_retry.prior_verification_job_id
   for share;
  select attempt.* into prior_attempt
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.id = source_retry.prior_verification_attempt_id
   for share;
  select observation.* into prior_observation
    from app.private_live_telebirr_observation_transcripts observation
   where observation.verification_attempt_id = prior_attempt.id
   for share;
  select proof.* into prior_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = prior_job.private_live_deposit_pilot_proof_id
   for share;
  select outcome.* into prior_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.id = source_retry.prior_verification_outcome_id
   for share;
  select binding.* into source_binding
    from app.private_live_telebirr_source_document_bindings binding
   where binding.source_document_digest = source_retry.source_document_digest
   for share;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.pilot_revision_id = target_pilot.id
     and profile.payment_provider_id = source_job.payment_provider_id
     and profile.receiver_account_id = source_job.receiver_account_id
     and profile.receiver_account_version = source_job.receiver_account_version
   for share;

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
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into source_transcript_count
    from app.private_live_telebirr_assignment_transcripts transcript
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = transcript.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into source_delivery_count
    from app.private_live_telebirr_assignment_deliveries delivery
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = delivery.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into source_evidence_count
    from app.private_live_telebirr_device_evidence_staging evidence
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = evidence.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into source_observation_count
    from app.private_live_telebirr_observation_transcripts observation
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = observation.verification_attempt_id
   where attempt.verification_job_id = source_job.id;
  select pg_catalog.count(*)::integer into source_outcome_count
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = source_job.id;

  expected_source_binding_digest :=
    app.private_live_telebirr_source_binding_recovery_digest(
      source_retry.retry_request_key,
      source_retry.original_authority_request_key,
      source_retry.source_document_digest,
      source_retry.payment_provider_id,
      source_retry.prior_verification_job_id,
      source_retry.prior_verification_attempt_id,
      source_retry.prior_verification_outcome_id,
      source_retry.current_verification_job_id,
      source_retry.current_verification_attempt_id,
      source_retry.prior_candidate_reference_fingerprint,
      source_retry.current_candidate_reference_fingerprint,
      source_retry.normalized_facts_digest,
      source_retry.authorized_at,
      source_retry.expires_at,
      source_retry.reason_code
    );

  if locked_switch_count <> 7
    or target_pilot.id is null
    or target_profile.id is null
    or not app.private_telebirr_shadow_mode_is_ready(target_pilot.id)
    or target_pilot.expires_at is distinct from
       target_pilot.active_from + interval '12 hours'
    or target_pilot.expires_at <= authorized_at + interval '11 hours 50 minutes'
    or target_profile.valid_from > authorized_at
    or target_profile.valid_until < target_pilot.expires_at
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or source_retry.request_digest is distinct from expected_source_binding_digest
    or source_closure.reason_code <> 'operator_stop'
    or source_closure.closed_at < source_retry.authorized_at
    or original_closure.reason_code <> 'operator_stop'
    or original_closure.closed_at > source_retry.authorized_at
    or source_job.id is null or source_attempt.id is null
    or source_observation.id is null or source_proof.id is null
    or source_outcome.id is null or source_pilot.id is null or source_profile.id is null
    or source_job.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or source_job.pilot_revision_id is distinct from source_pilot.id
    or source_job.receiver_profile_id is distinct from source_profile.id
    or source_job.payment_provider_id is distinct from source_retry.payment_provider_id
    or source_job.candidate_reference_fingerprint is distinct from
       source_retry.current_candidate_reference_fingerprint
    or source_attempt.verification_job_id is distinct from source_job.id
    or source_observation.verification_attempt_id is distinct from source_attempt.id
    or source_observation.source_document_digest is distinct from
       source_retry.source_document_digest
    or source_observation.normalized_facts_digest is distinct from
       source_retry.normalized_facts_digest
    or source_proof.provider_code_snapshot <> 'telebirr'
    or source_proof.origin_channel <> 'telegram'
    or source_proof.input_kind <> 'direct_transaction_id'
    or source_job.expires_at > authorized_at
    or source_attempt.expires_at > authorized_at
    or source_outcome.observation_transcript_id is distinct from source_observation.id
    or source_outcome.disposition <> 'review_required'
    or source_outcome.reason_code <> 'source_unavailable'
    or source_outcome.deposit_intent_id is not null
    or source_outcome.deposit_submission_id is not null
    or source_outcome.provider_payment_evidence_id is not null
    or source_outcome.deposit_verification_attempt_id is not null
    or source_attempt_count <> 1
    or source_transcript_count <> 1
    or source_delivery_count <> 1
    or source_evidence_count <> 1
    or source_observation_count <> 1
    or source_outcome_count <> 1
    or prior_job.id is null or prior_attempt.id is null or prior_observation.id is null
    or prior_proof.id is null or prior_outcome.id is null or source_binding.source_document_digest is null
    or prior_job.id is distinct from source_retry.prior_verification_job_id
    or prior_attempt.id is distinct from source_retry.prior_verification_attempt_id
    or prior_attempt.verification_job_id is distinct from prior_job.id
    or prior_observation.verification_attempt_id is distinct from prior_attempt.id
    or prior_observation.source_document_digest is distinct from
       source_retry.source_document_digest
    or prior_observation.normalized_facts_digest is distinct from
       source_retry.normalized_facts_digest
    or prior_outcome.verification_job_id is distinct from prior_job.id
    or prior_outcome.verification_attempt_id is distinct from prior_attempt.id
    or prior_outcome.observation_transcript_id is distinct from prior_observation.id
    or prior_outcome.disposition <> 'review_required'
    or prior_outcome.reason_code <> 'source_unavailable'
    or prior_outcome.deposit_intent_id is not null
    or prior_outcome.deposit_submission_id is not null
    or prior_outcome.provider_payment_evidence_id is not null
    or prior_outcome.deposit_verification_attempt_id is not null
    or source_binding.payment_provider_id is distinct from source_job.payment_provider_id
    or source_binding.candidate_reference_fingerprint is distinct from
       source_retry.prior_candidate_reference_fingerprint
    or source_binding.first_verification_attempt_id is distinct from prior_attempt.id
    or source_retry.prior_candidate_reference_fingerprint =
       source_retry.current_candidate_reference_fingerprint
    or exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = source_retry.original_authority_request_key
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id in (
         source_proof.id, prior_proof.id
       )
    )
    or exists (
      select 1 from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id in (source_outcome.id, prior_outcome.id)
    )
    or exists (
      select 1 from app.private_live_telebirr_settlement_documents document
       where document.source_document_digest = source_retry.source_document_digest
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_job.payment_provider_id
         and evidence.canonical_reference_fingerprint in (
           source_retry.prior_candidate_reference_fingerprint,
           source_retry.current_candidate_reference_fingerprint
         )
    )
    or exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       ) and role.rolcanlogin
    )
    or exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       ) and activity.pid <> pg_catalog.pg_backend_pid()
    )
    or not exists (
      select 1
        from app.agent_platform_companion_execution_control execution_control
       where execution_control.singleton
         and execution_control.control_state = 'disabled'
         and execution_control.certificate_id is null
         and execution_control.device_id is null
         and execution_control.device_key_id is null
         and execution_control.no_money_signer_key_id is null
         and execution_control.execution_signer_key_id is null
         and execution_control.platform_agent_account_id is null
         and execution_control.pilot_revision_id is null
         and execution_control.activation_epoch is null
    ) then
    raise exception 'The reviewed source-binding lineage is not safely recoverable to shadow.';
  end if;

  if source_pilot.contract_version is distinct from target_pilot.contract_version
    or source_pilot.platform_id is distinct from target_pilot.platform_id
    or source_pilot.platform_agent_account_id is distinct from
       target_pilot.platform_agent_account_id
    or source_pilot.platform_agent_label_snapshot is distinct from
       target_pilot.platform_agent_label_snapshot
    or source_pilot.platform_agent_updated_at_snapshot is distinct from
       target_pilot.platform_agent_updated_at_snapshot
    or source_pilot.currency_code is distinct from target_pilot.currency_code
    or source_pilot.minimum_amount_minor is distinct from target_pilot.minimum_amount_minor
    or source_pilot.maximum_per_deposit_minor is distinct from
       target_pilot.maximum_per_deposit_minor
    or source_pilot.maximum_per_player_minor is distinct from
       target_pilot.maximum_per_player_minor
    or source_pilot.maximum_aggregate_minor is distinct from
       target_pilot.maximum_aggregate_minor
    or source_pilot.maximum_reservation_count is distinct from
       target_pilot.maximum_reservation_count
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
    or source_profile.receiver_account_version is distinct from
       target_profile.receiver_account_version
    or source_profile.receiver_identity_digest is distinct from
       target_profile.receiver_identity_digest
    or source_profile.expected_receiver_name_digest is distinct from
       target_profile.expected_receiver_name_digest
    or source_profile.receiver_match_basis is distinct from
       target_profile.receiver_match_basis
    or source_profile.source_profile is distinct from target_profile.source_profile
    or source_profile.receiver_name_normalizer_version is distinct from
       target_profile.receiver_name_normalizer_version
    or source_profile.adapter_version is distinct from target_profile.adapter_version
    or source_profile.parser_version is distinct from target_profile.parser_version
    or source_profile.facts_normalizer_version is distinct from
       target_profile.facts_normalizer_version
    or source_profile.policy_version is distinct from target_profile.policy_version
    or source_profile.deposit_policy_version_id is distinct from
       target_profile.deposit_policy_version_id
    or source_profile.deposit_policy_version is distinct from
       target_profile.deposit_policy_version
    or source_profile.minimum_principal_amount_minor is distinct from
       target_profile.minimum_principal_amount_minor
    or source_profile.maximum_principal_amount_minor is distinct from
       target_profile.maximum_principal_amount_minor
    or source_profile.policy_digest is distinct from target_profile.policy_digest
    or source_profile.automatic_freshness_seconds is distinct from
       target_profile.automatic_freshness_seconds
    or source_profile.maximum_future_skew_seconds is distinct from
       target_profile.maximum_future_skew_seconds then
    raise exception 'The target dry-run pilot is not identical to the reviewed source pilot.';
  end if;

  recovery_request_key := pg_catalog.gen_random_uuid();
  replacement_shadow_proof_id := pg_catalog.gen_random_uuid();
  replacement_shadow_job_id := pg_catalog.gen_random_uuid();

  recovery_digest :=
    app.private_live_telebirr_source_binding_shadow_recovery_digest(
      recovery_request_key,
      source_retry.retry_request_key,
      source_retry.request_digest,
      source_proof.id,
      source_outcome.id,
      source_pilot.id,
      source_profile.id,
      replacement_shadow_proof_id,
      replacement_shadow_job_id,
      target_pilot.id,
      target_profile.id,
      source_attempt_count,
      source_transcript_count,
      source_delivery_count,
      source_evidence_count,
      source_observation_count,
      source_outcome_count,
      source_attempt_history_digest,
      authorized_at,
      target_pilot.expires_at,
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
    replacement_shadow_proof_id,
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
    target_pilot.expires_at,
    source_job.id,
    source_proof.id,
    source_pilot.id,
    source_profile.id,
    source_job.expires_at,
    authorized_at,
    recovery_request_key,
    recovery_digest,
    p_reason_code
  ) returning * into inserted_shadow;

  insert into app.private_live_telebirr_source_binding_shadow_recoveries (
    recovery_request_key,
    recovery_request_digest,
    source_binding_retry_request_key,
    source_live_proof_id,
    source_live_outcome_id,
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
    source_outcome_count,
    source_attempt_history_digest,
    authorized_at,
    recovery_expires_at,
    reason_code
  ) values (
    recovery_request_key,
    recovery_digest,
    source_retry.retry_request_key,
    source_proof.id,
    source_outcome.id,
    source_pilot.id,
    source_profile.id,
    inserted_shadow.id,
    inserted_shadow.verification_job_id,
    target_pilot.id,
    target_profile.id,
    source_attempt_count,
    source_transcript_count,
    source_delivery_count,
    source_evidence_count,
    source_observation_count,
    source_outcome_count,
    source_attempt_history_digest,
    authorized_at,
    target_pilot.expires_at,
    p_reason_code
  );

  if not app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
    inserted_shadow.id,
    recovery_request_key
  ) then
    raise exception 'The reviewed source-binding shadow recovery did not validate exactly.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_label,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'worker',
    'reviewed-live-telebirr-source-binding-shadow-recovery',
    'deposit.live_telebirr_source_binding_shadow_recovered',
    'private_live_deposit_pilot',
    target_pilot.id,
    pg_catalog.jsonb_build_object(
      'reason_code', p_reason_code,
      'configured_window_seconds',
        extract(epoch from (target_pilot.expires_at - target_pilot.active_from))::integer,
      'financial_rows_created', false,
      'execution_enabled', false,
      'money_moved', false
    )
  );

  return query
  select true,
         1,
         extract(epoch from (target_pilot.expires_at - target_pilot.active_from))::integer,
         greatest(
           0,
           extract(epoch from (
             target_pilot.expires_at - pg_catalog.clock_timestamp()
           ))::integer
         ),
         false;
end;
$$;

-- Preserve the exact prior validator for legacy rows, then make its public private surface a
-- strict union of the legacy lineage and the new independently validated source-binding lineage.
do $extend_source_recovery_validator$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.private_live_telebirr_source_recovery_is_valid(uuid,uuid)'
  );
  old_name constant text := 'app.private_live_telebirr_source_recovery_is_valid';
  legacy_name constant text := 'app.private_live_telebirr_source_recovery_legacy_is_valid';
  original_definition text;
  legacy_definition text;
begin
  if pg_catalog.to_regprocedure(
       'app.private_live_telebirr_source_recovery_legacy_is_valid(uuid,uuid)'
     ) is not null then
    raise exception 'The legacy source-recovery validator already exists.';
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid)
    into original_definition
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.provolatile = 's'
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_name, ''))
    ) / pg_catalog.length(old_name) <> 1 then
    raise exception 'The source-recovery validator changed shape.';
  end if;

  legacy_definition := pg_catalog.replace(
    original_definition,
    old_name,
    legacy_name
  );
  execute legacy_definition;
end;
$extend_source_recovery_validator$;

create or replace function app.private_live_telebirr_source_recovery_is_valid(
  p_replacement_shadow_proof_request_id uuid,
  p_recovery_request_key uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app.private_live_telebirr_source_recovery_legacy_is_valid(
           p_replacement_shadow_proof_request_id,
           p_recovery_request_key
         )
      or app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
           p_replacement_shadow_proof_request_id,
           p_recovery_request_key
         )
$$;

alter table app.private_live_telebirr_source_binding_shadow_recoveries
  owner to postgres;
alter function app.private_live_telebirr_source_binding_shadow_recovery_digest(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, integer, integer, integer, integer, text,
  timestamptz, timestamptz, text
) owner to postgres;
alter function app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
  uuid, uuid
) owner to postgres;
alter function app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(text)
  owner to postgres;
alter function app.private_live_telebirr_source_recovery_legacy_is_valid(uuid, uuid)
  owner to postgres;
alter function app.private_live_telebirr_source_recovery_is_valid(uuid, uuid)
  owner to postgres;

revoke all privileges on table
  app.private_live_telebirr_source_binding_shadow_recoveries
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.private_live_telebirr_source_binding_shadow_recovery_digest(
    uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
    integer, integer, integer, integer, integer, integer, text,
    timestamptz, timestamptz, text
  ),
  app.private_live_telebirr_source_binding_shadow_recovery_is_valid(uuid, uuid),
  app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(text),
  app.private_live_telebirr_source_recovery_legacy_is_valid(uuid, uuid),
  app.private_live_telebirr_source_recovery_is_valid(uuid, uuid)
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

comment on table app.private_live_telebirr_source_binding_shadow_recoveries is
  'Immutable one-use ledger from one closed reviewed live source-binding recovery to one fresh twelve-hour advisory shadow request. It grants no financial or KemerBet authority.';
comment on function app.recover_reviewed_private_live_telebirr_source_binding_to_shadow(text) is
  'Postgres-only idempotent creation of one twelve-hour no-money shadow request from the unique closed reviewed source-binding lineage and exact current dry-run pilot; returns redacted state only.';
comment on function app.private_live_telebirr_source_binding_shadow_recovery_is_valid(
  uuid, uuid
) is
  'Validates the immutable reviewed source-binding to no-money shadow lineage without exposing protected identifiers or evidence.';
comment on function app.private_live_telebirr_source_recovery_is_valid(uuid, uuid) is
  'Validates either the exact legacy terminal source-unavailable recovery or the independently bound reviewed source-binding recovery; both remain no-money shadow lineages.';

commit;
