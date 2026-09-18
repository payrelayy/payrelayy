-- Preserve the immutable original transfer/submission clock when a terminal source-recovery
-- shadow proof is retried after the reviewed authority-deadline defect. The replacement proof
-- receives a new exact twelve-hour review window, but the verifier assesses receipt freshness
-- against the original source-recovery submission time. Every prior proof, attempt, observation,
-- quarantine, and outcome remains append-only. This migration grants no KemerBet execution,
-- reservation, settlement, credit, payment, or money-movement authority.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;
lock table app.private_live_telebirr_receiver_profiles in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;
lock table app.private_telebirr_shadow_verification_attempts in share row exclusive mode;
lock table app.private_telebirr_shadow_device_evidence_staging in share row exclusive mode;
lock table app.private_telebirr_shadow_verification_outcomes in share row exclusive mode;

do $assessment_clock_retry_preflight$
declare
  safe_switch_count integer;
  exact_disabled_companion_count integer;
  original_reference_index text;
  authority_source text;
  loader_source text;
begin
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
    into exact_disabled_companion_count
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
     and execution_control.activated_at is null
     and execution_control.disabled_at is null
     and execution_control.disable_reason_code is null;

  select pg_catalog.pg_get_indexdef(index_row.indexrelid)
    into original_reference_index
    from pg_catalog.pg_index index_row
   where index_row.indexrelid =
         'app.private_tbirr_shadow_original_provider_reference_uidx'::regclass
     and index_row.indisunique
     and index_row.indisvalid;

  select routine.prosrc into authority_source
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
           'app.load_private_telebirr_shadow_verification_authority(uuid,uuid,timestamp with time zone)'
         )
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.pronargs = 3
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  select routine.prosrc into loader_source
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
           'app.load_next_private_telebirr_shadow_staged_evidence()'
         )
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if app.current_private_trusted_telebirr_activation_epoch() is not null
    or safe_switch_count <> 7
    or exact_disabled_companion_count <> 1
    or original_reference_index is distinct from
       'CREATE UNIQUE INDEX private_tbirr_shadow_original_provider_reference_uidx ON app.private_telebirr_shadow_proof_requests USING btree (payment_provider_id, candidate_reference_fingerprint) WHERE ((source_unavailable_retry_source_id IS NULL) AND (observation_clock_retry_source_id IS NULL) AND (authority_deadline_retry_source_id IS NULL))'
    or authority_source is null
    or pg_catalog.strpos(
         authority_source,
         '''submittedAt'', pg_catalog.to_jsonb(proof.submitted_at)'
       ) = 0
    or loader_source is null
    or pg_catalog.strpos(
         loader_source,
         '(proof.source_unavailable_retry_source_id is null'
         || ' and proof.observation_clock_retry_source_id is null'
         || ' and proof.authority_deadline_retry_source_id is null)'
       ) = 0
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
    raise exception
      'Assessment-clock recovery requires the complete reviewed no-money boundary.';
  end if;
end;
$assessment_clock_retry_preflight$;

alter table app.private_telebirr_shadow_proof_requests
  add column assessment_clock_retry_source_id uuid;

alter table app.private_telebirr_shadow_proof_requests
  add constraint private_tbirr_shadow_assessment_retry_source_not_self_check check (
    assessment_clock_retry_source_id is null
    or assessment_clock_retry_source_id <> id
  ),
  add constraint private_tbirr_shadow_assessment_retry_branch_shape_check check (
    assessment_clock_retry_source_id is null
    or (
      source_unavailable_retry_source_id is null
      and observation_clock_retry_source_id is null
      and authority_deadline_retry_source_id is null
      and source_live_verification_job_id is null
      and source_live_proof_id is null
      and source_pilot_revision_id is null
      and source_receiver_profile_id is null
      and original_expires_at is null
      and recovered_at is null
      and recovery_request_key is null
      and recovery_request_digest is null
      and recovery_reason_code is null
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
    )
  ),
  add constraint private_tbirr_shadow_assessment_retry_source_reference_fkey
    foreign key (
      assessment_clock_retry_source_id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) references app.private_telebirr_shadow_proof_requests (
      id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) on delete restrict,
  add constraint private_tbirr_shadow_assessment_retry_source_once_key
    unique (assessment_clock_retry_source_id);

drop index app.private_tbirr_shadow_original_provider_reference_uidx;
create unique index private_tbirr_shadow_original_provider_reference_uidx
  on app.private_telebirr_shadow_proof_requests (
    payment_provider_id,
    candidate_reference_fingerprint
  )
  where source_unavailable_retry_source_id is null
    and observation_clock_retry_source_id is null
    and authority_deadline_retry_source_id is null
    and assessment_clock_retry_source_id is null;

create table app.private_telebirr_shadow_assessment_clock_retries (
  retry_request_key uuid primary key,
  retry_request_digest text not null unique
    check (retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_shadow_proof_request_id uuid not null unique,
  source_shadow_verification_job_id uuid not null unique,
  source_authority_retry_request_key uuid not null unique
    references app.private_telebirr_shadow_authority_deadline_retries (retry_request_key)
      on delete restrict,
  source_authority_retry_request_digest text not null unique
    check (source_authority_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_outcome_id uuid not null unique
    references app.private_telebirr_shadow_verification_outcomes (id) on delete restrict,
  source_outcome_evidence_digest text not null unique
    check (source_outcome_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_assessment_input_digest text not null unique
    check (source_assessment_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_attempt_count integer not null check (source_attempt_count between 1 and 99),
  source_attempt_history_digest text not null
    check (source_attempt_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  original_shadow_proof_request_id uuid not null unique,
  original_shadow_verification_job_id uuid not null unique,
  assessment_submitted_at timestamptz not null,
  replacement_shadow_proof_request_id uuid not null unique,
  replacement_shadow_verification_job_id uuid not null unique,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  authorized_at timestamptz not null,
  retry_expires_at timestamptz not null,
  reviewed_main_commit_sha text not null
    check (reviewed_main_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null
    check (reason_code = 'source_recovery_assessment_clock_retry_no_credit'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_tbirr_shadow_assessment_retry_request_v4_check check (
    retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_tbirr_shadow_assessment_retry_window_check check (
    retry_expires_at = authorized_at + interval '12 hours'
  ),
  constraint private_tbirr_shadow_assessment_retry_clock_check check (
    assessment_submitted_at < authorized_at
  ),
  constraint private_tbirr_shadow_assessment_retry_source_job_fkey
    foreign key (source_shadow_proof_request_id, source_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_tbirr_shadow_assessment_retry_original_job_fkey
    foreign key (original_shadow_proof_request_id, original_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_tbirr_shadow_assessment_retry_replacement_job_fkey
    foreign key (replacement_shadow_proof_request_id, replacement_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict deferrable initially deferred
);

create function app.private_telebirr_shadow_assessment_clock_retry_digest(
  p_retry_request_key uuid,
  p_source_shadow_proof_request_id uuid,
  p_source_shadow_verification_job_id uuid,
  p_source_authority_retry_request_key uuid,
  p_source_authority_retry_request_digest text,
  p_source_outcome_id uuid,
  p_source_outcome_evidence_digest text,
  p_source_assessment_input_digest text,
  p_source_attempt_count integer,
  p_source_attempt_history_digest text,
  p_original_shadow_proof_request_id uuid,
  p_original_shadow_verification_job_id uuid,
  p_assessment_submitted_at timestamptz,
  p_replacement_shadow_proof_request_id uuid,
  p_replacement_shadow_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_receiver_profile_id uuid,
  p_authorized_at timestamptz,
  p_retry_expires_at timestamptz,
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_source_shadow_proof_request_id is null
    or p_source_shadow_verification_job_id is null
    or p_source_authority_retry_request_key is null
    or p_source_authority_retry_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_outcome_id is null
    or p_source_outcome_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_assessment_input_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_attempt_count not between 1 and 99
    or p_source_attempt_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_original_shadow_proof_request_id is null
    or p_original_shadow_verification_job_id is null
    or p_assessment_submitted_at is null
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_receiver_profile_id is null
    or p_authorized_at is null
    or p_assessment_submitted_at >= p_authorized_at
    or p_retry_expires_at is distinct from p_authorized_at + interval '12 hours'
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from
       'source_recovery_assessment_clock_retry_no_credit' then
    raise exception 'The TeleBirr assessment-clock retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-assessment-clock-retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|source_shadow_proof_request_id=' || p_source_shadow_proof_request_id::text
      || '|source_shadow_verification_job_id=' || p_source_shadow_verification_job_id::text
      || '|source_authority_retry_request_key='
      || p_source_authority_retry_request_key::text
      || '|source_authority_retry_request_digest='
      || p_source_authority_retry_request_digest
      || '|source_outcome_id=' || p_source_outcome_id::text
      || '|source_outcome_evidence_digest=' || p_source_outcome_evidence_digest
      || '|source_assessment_input_digest=' || p_source_assessment_input_digest
      || '|source_attempt_count=' || p_source_attempt_count::text
      || '|source_attempt_history_digest=' || p_source_attempt_history_digest
      || '|original_shadow_proof_request_id='
      || p_original_shadow_proof_request_id::text
      || '|original_shadow_verification_job_id='
      || p_original_shadow_verification_job_id::text
      || '|assessment_submitted_at_us=' || (
        extract(epoch from p_assessment_submitted_at) * 1000000
      )::bigint::text
      || '|replacement_shadow_proof_request_id='
      || p_replacement_shadow_proof_request_id::text
      || '|replacement_shadow_verification_job_id='
      || p_replacement_shadow_verification_job_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|receiver_profile_id=' || p_receiver_profile_id::text
      || '|authorized_at_us=' || (
        extract(epoch from p_authorized_at) * 1000000
      )::bigint::text
      || '|retry_expires_at_us=' || (
        extract(epoch from p_retry_expires_at) * 1000000
      )::bigint::text
      || '|reviewed_main_commit_sha=' || p_reviewed_main_commit_sha
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.reject_private_telebirr_shadow_assessment_clock_retry_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private TeleBirr assessment-clock retry lineage is immutable.';
end;
$$;

create trigger private_tbirr_shadow_assessment_clock_retries_immutable
before update or delete on app.private_telebirr_shadow_assessment_clock_retries
for each row
execute function app.reject_private_telebirr_shadow_assessment_clock_retry_mutation();

create trigger private_tbirr_shadow_assessment_clock_retries_no_truncate
before truncate on app.private_telebirr_shadow_assessment_clock_retries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.guard_private_telebirr_shadow_assessment_clock_retry_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  request_key_text text := pg_catalog.current_setting(
    'app.private_telebirr_shadow_assessment_clock_retry', true
  );
  retry app.private_telebirr_shadow_assessment_clock_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  original_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  authority_retry app.private_telebirr_shadow_authority_deadline_retries%rowtype;
  expected_digest text;
  expected_authority_digest text;
begin
  if new.assessment_clock_retry_source_id is null then
    return new;
  end if;

  if request_key_text is null
    or request_key_text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The TeleBirr assessment-clock replacement context is invalid.';
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_assessment_clock_retries candidate
   where candidate.retry_request_key = request_key_text::uuid
   for share;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = new.assessment_clock_retry_source_id
   for share;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.id = retry.source_outcome_id
     and outcome.shadow_proof_request_id = source_proof.id
   for share;
  select candidate.* into authority_retry
    from app.private_telebirr_shadow_authority_deadline_retries candidate
   where candidate.retry_request_key = retry.source_authority_retry_request_key
     and candidate.replacement_shadow_proof_request_id = source_proof.id
   for share;
  select proof.* into original_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.original_shadow_proof_request_id
     and proof.id = source_proof.authority_deadline_retry_source_id
   for share;

  expected_digest := app.private_telebirr_shadow_assessment_clock_retry_digest(
    retry.retry_request_key,
    retry.source_shadow_proof_request_id,
    retry.source_shadow_verification_job_id,
    retry.source_authority_retry_request_key,
    retry.source_authority_retry_request_digest,
    retry.source_outcome_id,
    retry.source_outcome_evidence_digest,
    retry.source_assessment_input_digest,
    retry.source_attempt_count,
    retry.source_attempt_history_digest,
    retry.original_shadow_proof_request_id,
    retry.original_shadow_verification_job_id,
    retry.assessment_submitted_at,
    retry.replacement_shadow_proof_request_id,
    retry.replacement_shadow_verification_job_id,
    retry.pilot_revision_id,
    retry.receiver_profile_id,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );
  expected_authority_digest := app.private_telebirr_shadow_authority_deadline_retry_digest(
    authority_retry.retry_request_key,
    authority_retry.source_shadow_proof_request_id,
    authority_retry.source_shadow_verification_job_id,
    authority_retry.source_recovery_request_key,
    authority_retry.source_recovery_request_digest,
    authority_retry.source_shadow_recovery_digest,
    authority_retry.replacement_shadow_proof_request_id,
    authority_retry.replacement_shadow_verification_job_id,
    authority_retry.pilot_revision_id,
    authority_retry.receiver_profile_id,
    authority_retry.prior_attempt_count,
    authority_retry.prior_attempt_history_digest,
    authority_retry.prior_quarantine_count,
    authority_retry.prior_quarantine_history_digest,
    authority_retry.authorized_at,
    authority_retry.retry_expires_at,
    authority_retry.reviewed_main_commit_sha,
    authority_retry.reason_code
  );

  if session_user <> 'postgres'
    or retry.retry_request_key is null
    or retry.retry_request_digest is distinct from expected_digest
    or retry.source_shadow_proof_request_id is distinct from source_proof.id
    or retry.source_shadow_verification_job_id
         is distinct from source_proof.verification_job_id
    or retry.source_authority_retry_request_digest
         is distinct from expected_authority_digest
    or authority_retry.retry_request_digest is distinct from expected_authority_digest
    or retry.source_outcome_evidence_digest is distinct from source_outcome.evidence_digest
    or retry.source_assessment_input_digest
         is distinct from source_outcome.assessment_input_digest
    or retry.source_attempt_count is distinct from (
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = source_proof.id
    )
    or retry.source_attempt_history_digest is distinct from
         app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id)
    or source_outcome.disposition is distinct from 'review_required'
    or source_outcome.reason_code is distinct from 'receipt_too_old'
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or original_proof.id is null
    or original_proof.submitted_at is distinct from retry.assessment_submitted_at
    or not app.private_live_telebirr_source_recovery_history_is_valid(
         original_proof.id,
         authority_retry.source_recovery_request_key
       )
    or new.id is distinct from retry.replacement_shadow_proof_request_id
    or new.verification_job_id is distinct from retry.replacement_shadow_verification_job_id
    or new.pilot_revision_id is distinct from source_proof.pilot_revision_id
    or new.submitting_customer_id is distinct from source_proof.submitting_customer_id
    or new.player_account_id is distinct from source_proof.player_account_id
    or new.payment_provider_id is distinct from source_proof.payment_provider_id
    or new.provider_code is distinct from source_proof.provider_code
    or new.receiver_profile_id is distinct from source_proof.receiver_profile_id
    or new.pilot_configuration_digest is distinct from source_proof.pilot_configuration_digest
    or new.origin_channel is distinct from source_proof.origin_channel
    or new.input_kind is distinct from source_proof.input_kind
    or new.candidate_reference_ciphertext
         is distinct from source_proof.candidate_reference_ciphertext
    or new.candidate_reference_fingerprint
         is distinct from source_proof.candidate_reference_fingerprint
    or new.candidate_reference_masked is distinct from source_proof.candidate_reference_masked
    or new.reference_encryption_key_version
         is distinct from source_proof.reference_encryption_key_version
    or new.reference_profile_version is distinct from source_proof.reference_profile_version
    or new.proof_status is distinct from 'verification_queued'
    or new.submitted_at is distinct from retry.authorized_at
    or new.not_before is distinct from retry.authorized_at
    or new.expires_at is distinct from retry.retry_expires_at
    or new.expires_at is distinct from new.submitted_at + interval '12 hours'
    or new.source_unavailable_retry_source_id is not null
    or new.observation_clock_retry_source_id is not null
    or new.authority_deadline_retry_source_id is not null then
    raise exception 'The TeleBirr assessment-clock replacement proof is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_tbirr_shadow_assessment_clock_retry_insert_guard
before insert on app.private_telebirr_shadow_proof_requests
for each row
when (new.assessment_clock_retry_source_id is not null)
execute function app.guard_private_telebirr_shadow_assessment_clock_retry_insert();

create function app.retry_private_telebirr_shadow_after_assessment_clock_fix(
  p_source_shadow_proof_request_id uuid,
  p_source_shadow_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_retry_request_key uuid,
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns table (
  shadow_proof_request_id uuid,
  shadow_verification_job_id uuid,
  retry_expires_at timestamptz,
  already_retried boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authorized_at timestamptz;
  retry_until timestamptz;
  existing_retry app.private_telebirr_shadow_assessment_clock_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  original_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  authority_retry app.private_telebirr_shadow_authority_deadline_retries%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  replacement_proof_id uuid;
  replacement_job_id uuid;
  retry_digest text;
  authority_retry_digest text;
  source_attempt_count integer;
  source_attempt_history_digest text;
  source_staged_count integer;
  source_quarantine_count integer;
  safe_switch_count integer;
  exact_disabled_companion_count integer;
  active_enrollment_count integer;
  active_signer_count integer;
begin
  if session_user <> 'postgres'
    or p_source_shadow_proof_request_id is null
    or p_source_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from
       'source_recovery_assessment_clock_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The TeleBirr assessment-clock retry request is invalid.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-assessment-clock-retry:v1:'
        || p_source_shadow_proof_request_id::text,
      0::bigint
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-assessment-clock-retry-request:v1:'
        || p_retry_request_key::text,
      0::bigint
    )
  );

  select retry.* into existing_retry
    from app.private_telebirr_shadow_assessment_clock_retries retry
   where retry.retry_request_key = p_retry_request_key
      or retry.source_shadow_proof_request_id = p_source_shadow_proof_request_id
   order by (retry.retry_request_key = p_retry_request_key) desc
   limit 1
   for share;

  if existing_retry.retry_request_key is not null then
    retry_digest := app.private_telebirr_shadow_assessment_clock_retry_digest(
      existing_retry.retry_request_key,
      existing_retry.source_shadow_proof_request_id,
      existing_retry.source_shadow_verification_job_id,
      existing_retry.source_authority_retry_request_key,
      existing_retry.source_authority_retry_request_digest,
      existing_retry.source_outcome_id,
      existing_retry.source_outcome_evidence_digest,
      existing_retry.source_assessment_input_digest,
      existing_retry.source_attempt_count,
      existing_retry.source_attempt_history_digest,
      existing_retry.original_shadow_proof_request_id,
      existing_retry.original_shadow_verification_job_id,
      existing_retry.assessment_submitted_at,
      existing_retry.replacement_shadow_proof_request_id,
      existing_retry.replacement_shadow_verification_job_id,
      existing_retry.pilot_revision_id,
      existing_retry.receiver_profile_id,
      existing_retry.authorized_at,
      existing_retry.retry_expires_at,
      existing_retry.reviewed_main_commit_sha,
      existing_retry.reason_code
    );
    if existing_retry.retry_request_key is distinct from p_retry_request_key
      or existing_retry.source_shadow_proof_request_id
           is distinct from p_source_shadow_proof_request_id
      or existing_retry.source_shadow_verification_job_id
           is distinct from p_source_shadow_verification_job_id
      or existing_retry.pilot_revision_id is distinct from p_pilot_revision_id
      or existing_retry.reviewed_main_commit_sha is distinct from p_reviewed_main_commit_sha
      or existing_retry.reason_code is distinct from p_reason_code
      or existing_retry.retry_request_digest is distinct from retry_digest then
      raise exception 'The TeleBirr assessment-clock retry replay conflicts.';
    end if;

    return query
    select existing_retry.replacement_shadow_proof_request_id,
           existing_retry.replacement_shadow_verification_job_id,
           existing_retry.retry_expires_at,
           true;
    return;
  end if;

  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  retry_until := authorized_at + interval '12 hours';

  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = p_source_shadow_proof_request_id
     and proof.verification_job_id = p_source_shadow_verification_job_id
   for update;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
     and outcome.verification_job_id = source_proof.verification_job_id
   for share;
  select retry.* into authority_retry
    from app.private_telebirr_shadow_authority_deadline_retries retry
   where retry.replacement_shadow_proof_request_id = source_proof.id
     and retry.replacement_shadow_verification_job_id = source_proof.verification_job_id
   for share;
  select proof.* into original_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = source_proof.authority_deadline_retry_source_id
     and proof.id = authority_retry.source_shadow_proof_request_id
   for share;
  select candidate.* into pilot
    from app.private_live_deposit_pilot_revisions candidate
   where candidate.id = p_pilot_revision_id
   for share;
  select candidate.* into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where candidate.id = source_proof.receiver_profile_id
   for share;

  select pg_catalog.count(*)::integer,
         app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id)
    into source_attempt_count, source_attempt_history_digest
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer
    into source_staged_count
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer
    into source_quarantine_count
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = quarantine.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;

  authority_retry_digest := app.private_telebirr_shadow_authority_deadline_retry_digest(
    authority_retry.retry_request_key,
    authority_retry.source_shadow_proof_request_id,
    authority_retry.source_shadow_verification_job_id,
    authority_retry.source_recovery_request_key,
    authority_retry.source_recovery_request_digest,
    authority_retry.source_shadow_recovery_digest,
    authority_retry.replacement_shadow_proof_request_id,
    authority_retry.replacement_shadow_verification_job_id,
    authority_retry.pilot_revision_id,
    authority_retry.receiver_profile_id,
    authority_retry.prior_attempt_count,
    authority_retry.prior_attempt_history_digest,
    authority_retry.prior_quarantine_count,
    authority_retry.prior_quarantine_history_digest,
    authority_retry.authorized_at,
    authority_retry.retry_expires_at,
    authority_retry.reviewed_main_commit_sha,
    authority_retry.reason_code
  );

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
     and feature_switch.mode = 'dry_run'
     and feature_switch.settings = pg_catalog.jsonb_build_object(
       'contract_version', 1,
       'pilot_revision_id', pilot.id,
       'configuration_digest', pilot.configuration_digest
     )
   );
  select pg_catalog.count(*)::integer
    into exact_disabled_companion_count
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
     and execution_control.activated_at is null
     and execution_control.disabled_at is null
     and execution_control.disable_reason_code is null;
  select pg_catalog.count(*)::integer
    into active_enrollment_count
    from app.private_live_telebirr_device_enrollments enrollment
   where enrollment.pilot_revision_id = pilot.id
     and enrollment.receiver_profile_id = profile.id
     and enrollment.valid_from <= authorized_at
     and enrollment.valid_until >= retry_until
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
     );
  select pg_catalog.count(*)::integer
    into active_signer_count
    from app.private_live_telebirr_assignment_signers signer
   where signer.valid_from <= authorized_at
     and signer.valid_until >= retry_until
     and not exists (
       select 1
         from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
     );

  if source_proof.id is null
    or source_proof.pilot_revision_id is distinct from p_pilot_revision_id
    or source_proof.proof_status is distinct from 'verification_queued'
    or source_proof.provider_code is distinct from 'telebirr'
    or source_proof.authority_deadline_retry_source_id is null
    or source_proof.assessment_clock_retry_source_id is not null
    or source_proof.source_unavailable_retry_source_id is not null
    or source_proof.observation_clock_retry_source_id is not null
    or authority_retry.retry_request_key is null
    or authority_retry.retry_request_digest is distinct from authority_retry_digest
    or authority_retry.replacement_shadow_proof_request_id is distinct from source_proof.id
    or authority_retry.source_shadow_proof_request_id is distinct from original_proof.id
    or authority_retry.pilot_revision_id is distinct from source_proof.pilot_revision_id
    or authority_retry.receiver_profile_id is distinct from source_proof.receiver_profile_id
    or authority_retry.authorized_at is distinct from source_proof.submitted_at
    or authority_retry.retry_expires_at is distinct from source_proof.expires_at
    or authority_retry.retry_expires_at is distinct from
       authority_retry.authorized_at + interval '12 hours'
    or authority_retry.reason_code is distinct from
       'source_recovery_authority_deadline_retry_no_credit'
    or original_proof.id is null
    or original_proof.submitted_at >= source_proof.submitted_at
    or authority_retry.prior_attempt_count is distinct from (
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = original_proof.id
    )
    or authority_retry.prior_attempt_history_digest is distinct from
       app.private_telebirr_shadow_retry_attempt_history_digest(original_proof.id)
    or authority_retry.prior_quarantine_count is distinct from (
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_evidence_quarantine quarantine
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = quarantine.verification_attempt_id
       where attempt.shadow_proof_request_id = original_proof.id
    )
    or authority_retry.prior_quarantine_history_digest is distinct from
       app.private_telebirr_shadow_quarantine_history_digest(original_proof.id)
    or not app.private_live_telebirr_source_recovery_history_is_valid(
         original_proof.id,
         authority_retry.source_recovery_request_key
       )
    or source_outcome.id is null
    or source_outcome.disposition is distinct from 'review_required'
    or source_outcome.reason_code is distinct from 'receipt_too_old'
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or source_outcome.created_at < authority_retry.authorized_at
    or source_outcome.created_at >= authority_retry.retry_expires_at
    or source_attempt_count not between 1 and 99
    or source_attempt_history_digest is null
    or source_staged_count is distinct from source_attempt_count
    or source_quarantine_count <> 0
    or not exists (
      select 1
        from app.private_telebirr_shadow_verification_attempts attempt
        join app.private_telebirr_shadow_device_evidence_staging staged
          on staged.verification_attempt_id = attempt.id
         and staged.observation_body_digest = source_outcome.observation_body_digest
       where attempt.id = source_outcome.verification_attempt_id
         and attempt.shadow_proof_request_id = source_proof.id
         and attempt.verification_job_id = source_proof.verification_job_id
         and staged.observed_at = source_outcome.observed_at
         and staged.staged_at >= authority_retry.authorized_at
         and staged.staged_at < source_proof.expires_at
         and staged.staged_at < attempt.expires_at
         and staged.observed_at >= attempt.issued_at
         and staged.observed_at < attempt.expires_at
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id =
             (select recovery.source_live_proof_id
                from app.private_live_telebirr_source_recoveries recovery
               where recovery.recovery_request_key =
                     authority_retry.source_recovery_request_key)
    )
    or exists (
      select 1
        from app.private_live_telebirr_settlement_receipts receipt
        join app.private_live_telebirr_source_recoveries recovery
          on receipt.verification_outcome_id in (
            recovery.root_live_outcome_id,
            recovery.terminal_live_outcome_id
          )
       where recovery.recovery_request_key =
             authority_retry.source_recovery_request_key
    )
    or pilot.id is null
    or pilot.status is distinct from 'armed'
    or pilot.configuration_digest is distinct from source_proof.pilot_configuration_digest
    or pilot.active_from > authorized_at
    or pilot.expires_at < retry_until
    or profile.id is null
    or profile.pilot_revision_id is distinct from pilot.id
    or profile.payment_provider_id is distinct from source_proof.payment_provider_id
    or profile.pilot_configuration_digest is distinct from pilot.configuration_digest
    or profile.valid_from > authorized_at
    or profile.valid_until < retry_until
    or active_enrollment_count <> 1
    or active_signer_count <> 1
    or safe_switch_count <> 7
    or exact_disabled_companion_count <> 1
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception 'The terminal assessment-clock source proof is not safely retryable.';
  end if;

  replacement_proof_id := pg_catalog.gen_random_uuid();
  replacement_job_id := pg_catalog.gen_random_uuid();
  retry_digest := app.private_telebirr_shadow_assessment_clock_retry_digest(
    p_retry_request_key,
    source_proof.id,
    source_proof.verification_job_id,
    authority_retry.retry_request_key,
    authority_retry.retry_request_digest,
    source_outcome.id,
    source_outcome.evidence_digest,
    source_outcome.assessment_input_digest,
    source_attempt_count,
    source_attempt_history_digest,
    original_proof.id,
    original_proof.verification_job_id,
    original_proof.submitted_at,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  insert into app.private_telebirr_shadow_assessment_clock_retries (
    retry_request_key,
    retry_request_digest,
    source_shadow_proof_request_id,
    source_shadow_verification_job_id,
    source_authority_retry_request_key,
    source_authority_retry_request_digest,
    source_outcome_id,
    source_outcome_evidence_digest,
    source_assessment_input_digest,
    source_attempt_count,
    source_attempt_history_digest,
    original_shadow_proof_request_id,
    original_shadow_verification_job_id,
    assessment_submitted_at,
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id,
    pilot_revision_id,
    receiver_profile_id,
    authorized_at,
    retry_expires_at,
    reviewed_main_commit_sha,
    reason_code,
    created_at
  ) values (
    p_retry_request_key,
    retry_digest,
    source_proof.id,
    source_proof.verification_job_id,
    authority_retry.retry_request_key,
    authority_retry.retry_request_digest,
    source_outcome.id,
    source_outcome.evidence_digest,
    source_outcome.assessment_input_digest,
    source_attempt_count,
    source_attempt_history_digest,
    original_proof.id,
    original_proof.verification_job_id,
    original_proof.submitted_at,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code,
    authorized_at
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_assessment_clock_retry',
    p_retry_request_key::text,
    true
  );
  insert into app.private_telebirr_shadow_proof_requests (
    id,
    verification_job_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    provider_code,
    receiver_profile_id,
    pilot_configuration_digest,
    origin_channel,
    input_kind,
    candidate_reference_ciphertext,
    candidate_reference_fingerprint,
    candidate_reference_masked,
    reference_encryption_key_version,
    reference_profile_version,
    proof_status,
    submitted_at,
    not_before,
    expires_at,
    assessment_clock_retry_source_id
  ) values (
    replacement_proof_id,
    replacement_job_id,
    source_proof.pilot_revision_id,
    source_proof.submitting_customer_id,
    source_proof.player_account_id,
    source_proof.payment_provider_id,
    source_proof.provider_code,
    source_proof.receiver_profile_id,
    source_proof.pilot_configuration_digest,
    source_proof.origin_channel,
    source_proof.input_kind,
    source_proof.candidate_reference_ciphertext,
    source_proof.candidate_reference_fingerprint,
    source_proof.candidate_reference_masked,
    source_proof.reference_encryption_key_version,
    source_proof.reference_profile_version,
    source_proof.proof_status,
    authorized_at,
    authorized_at,
    retry_until,
    source_proof.id
  );
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_assessment_clock_retry', 'off', true
  );

  insert into app.audit_events (
    actor_kind,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'system',
    'verification.telebirr_shadow_assessment_clock_retry_armed',
    'telebirr_shadow_proof_request',
    replacement_proof_id,
    pg_catalog.jsonb_build_object(
      'source_shadow_proof_request_id', source_proof.id,
      'source_shadow_verification_job_id', source_proof.verification_job_id,
      'source_authority_retry_request_key', authority_retry.retry_request_key,
      'source_outcome_id', source_outcome.id,
      'retry_request_key', p_retry_request_key,
      'pilot_revision_id', pilot.id,
      'source_attempt_count', source_attempt_count,
      'assessment_submitted_at', original_proof.submitted_at,
      'retry_expires_at', retry_until,
      'reviewed_main_commit_sha', p_reviewed_main_commit_sha,
      'reason_code', p_reason_code,
      'review_window_hours', 12,
      'financial_actions_enabled', false,
      'money_moved', false
    )
  );

  return query select replacement_proof_id, replacement_job_id, retry_until, false;
end;
$$;

create function app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(
  p_replacement_shadow_proof_request_id uuid,
  p_retry_request_key uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  retry app.private_telebirr_shadow_assessment_clock_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  original_proof app.private_telebirr_shadow_proof_requests%rowtype;
  replacement app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  authority_retry app.private_telebirr_shadow_authority_deadline_retries%rowtype;
  expected_digest text;
  expected_authority_digest text;
begin
  if p_replacement_shadow_proof_request_id is null or p_retry_request_key is null then
    return false;
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_assessment_clock_retries candidate
   where candidate.retry_request_key = p_retry_request_key
     and candidate.replacement_shadow_proof_request_id =
         p_replacement_shadow_proof_request_id;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.source_shadow_proof_request_id
     and proof.verification_job_id = retry.source_shadow_verification_job_id;
  select proof.* into original_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.original_shadow_proof_request_id
     and proof.verification_job_id = retry.original_shadow_verification_job_id;
  select proof.* into replacement
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.id = retry.source_outcome_id
     and outcome.shadow_proof_request_id = source_proof.id;
  select candidate.* into authority_retry
    from app.private_telebirr_shadow_authority_deadline_retries candidate
   where candidate.retry_request_key = retry.source_authority_retry_request_key
     and candidate.replacement_shadow_proof_request_id = source_proof.id;

  expected_digest := app.private_telebirr_shadow_assessment_clock_retry_digest(
    retry.retry_request_key,
    retry.source_shadow_proof_request_id,
    retry.source_shadow_verification_job_id,
    retry.source_authority_retry_request_key,
    retry.source_authority_retry_request_digest,
    retry.source_outcome_id,
    retry.source_outcome_evidence_digest,
    retry.source_assessment_input_digest,
    retry.source_attempt_count,
    retry.source_attempt_history_digest,
    retry.original_shadow_proof_request_id,
    retry.original_shadow_verification_job_id,
    retry.assessment_submitted_at,
    retry.replacement_shadow_proof_request_id,
    retry.replacement_shadow_verification_job_id,
    retry.pilot_revision_id,
    retry.receiver_profile_id,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );
  expected_authority_digest := app.private_telebirr_shadow_authority_deadline_retry_digest(
    authority_retry.retry_request_key,
    authority_retry.source_shadow_proof_request_id,
    authority_retry.source_shadow_verification_job_id,
    authority_retry.source_recovery_request_key,
    authority_retry.source_recovery_request_digest,
    authority_retry.source_shadow_recovery_digest,
    authority_retry.replacement_shadow_proof_request_id,
    authority_retry.replacement_shadow_verification_job_id,
    authority_retry.pilot_revision_id,
    authority_retry.receiver_profile_id,
    authority_retry.prior_attempt_count,
    authority_retry.prior_attempt_history_digest,
    authority_retry.prior_quarantine_count,
    authority_retry.prior_quarantine_history_digest,
    authority_retry.authorized_at,
    authority_retry.retry_expires_at,
    authority_retry.reviewed_main_commit_sha,
    authority_retry.reason_code
  );

  return retry.retry_request_key is not null
    and retry.retry_request_digest = expected_digest
    and retry.source_authority_retry_request_digest = expected_authority_digest
    and authority_retry.retry_request_digest = expected_authority_digest
    and authority_retry.replacement_shadow_proof_request_id = source_proof.id
    and authority_retry.source_shadow_proof_request_id = original_proof.id
    and source_proof.authority_deadline_retry_source_id = original_proof.id
    and source_proof.assessment_clock_retry_source_id is null
    and source_proof.submitted_at = authority_retry.authorized_at
    and source_proof.expires_at = authority_retry.retry_expires_at
    and source_outcome.id = retry.source_outcome_id
    and source_outcome.verification_job_id = source_proof.verification_job_id
    and source_outcome.disposition = 'review_required'
    and source_outcome.reason_code = 'receipt_too_old'
    and source_outcome.protocol_disposition = 'would_review'
    and source_outcome.evidence_digest = retry.source_outcome_evidence_digest
    and source_outcome.assessment_input_digest = retry.source_assessment_input_digest
    and source_outcome.principal_amount_minor is null
    and source_outcome.occurred_at is null
    and source_outcome.receiver_identity_digest is null
    and source_outcome.created_at >= authority_retry.authorized_at
    and source_outcome.created_at < authority_retry.retry_expires_at
    and retry.source_attempt_count = (
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = source_proof.id
    )
    and retry.source_attempt_history_digest =
        app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id)
    and retry.source_attempt_count = (
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
       where attempt.shadow_proof_request_id = source_proof.id
    )
    and exists (
      select 1
        from app.private_telebirr_shadow_verification_attempts attempt
        join app.private_telebirr_shadow_device_evidence_staging staged
          on staged.verification_attempt_id = attempt.id
         and staged.observation_body_digest = source_outcome.observation_body_digest
       where attempt.id = source_outcome.verification_attempt_id
         and attempt.shadow_proof_request_id = source_proof.id
         and staged.observed_at = source_outcome.observed_at
         and staged.staged_at >= authority_retry.authorized_at
         and staged.staged_at < source_proof.expires_at
         and staged.staged_at < attempt.expires_at
         and staged.observed_at >= attempt.issued_at
         and staged.observed_at < attempt.expires_at
    )
    and authority_retry.prior_attempt_count = (
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = original_proof.id
    )
    and authority_retry.prior_attempt_history_digest =
        app.private_telebirr_shadow_retry_attempt_history_digest(original_proof.id)
    and authority_retry.prior_quarantine_count = (
      select pg_catalog.count(*)::integer
        from app.private_telebirr_shadow_evidence_quarantine quarantine
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = quarantine.verification_attempt_id
       where attempt.shadow_proof_request_id = original_proof.id
    )
    and authority_retry.prior_quarantine_history_digest =
        app.private_telebirr_shadow_quarantine_history_digest(original_proof.id)
    and original_proof.submitted_at = retry.assessment_submitted_at
    and original_proof.submitted_at < retry.authorized_at
    and app.private_live_telebirr_source_recovery_history_is_valid(
          original_proof.id,
          authority_retry.source_recovery_request_key
        )
    and replacement.id = p_replacement_shadow_proof_request_id
    and replacement.assessment_clock_retry_source_id = source_proof.id
    and replacement.source_unavailable_retry_source_id is null
    and replacement.observation_clock_retry_source_id is null
    and replacement.authority_deadline_retry_source_id is null
    and replacement.pilot_revision_id = retry.pilot_revision_id
    and replacement.receiver_profile_id = retry.receiver_profile_id
    and replacement.submitting_customer_id = source_proof.submitting_customer_id
    and replacement.player_account_id = source_proof.player_account_id
    and replacement.payment_provider_id = source_proof.payment_provider_id
    and replacement.provider_code = source_proof.provider_code
    and replacement.pilot_configuration_digest = source_proof.pilot_configuration_digest
    and replacement.origin_channel = source_proof.origin_channel
    and replacement.input_kind = source_proof.input_kind
    and replacement.candidate_reference_ciphertext =
        source_proof.candidate_reference_ciphertext
    and replacement.candidate_reference_fingerprint =
        source_proof.candidate_reference_fingerprint
    and replacement.candidate_reference_masked = source_proof.candidate_reference_masked
    and replacement.reference_encryption_key_version =
        source_proof.reference_encryption_key_version
    and replacement.reference_profile_version = source_proof.reference_profile_version
    and replacement.proof_status = 'verification_queued'
    and replacement.submitted_at = retry.authorized_at
    and replacement.not_before = retry.authorized_at
    and replacement.expires_at = retry.retry_expires_at
    and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
    and retry.reason_code = 'source_recovery_assessment_clock_retry_no_credit'
    and not exists (
      select 1
        from app.private_telebirr_shadow_evidence_quarantine quarantine
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = quarantine.verification_attempt_id
       where attempt.shadow_proof_request_id = source_proof.id
    )
    and not exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    );
exception
  when others then
    return false;
end;
$$;

create function app.private_telebirr_shadow_assessment_clock_retry_is_valid(
  p_replacement_shadow_proof_request_id uuid,
  p_retry_request_key uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  retry app.private_telebirr_shadow_assessment_clock_retries%rowtype;
  replacement app.private_telebirr_shadow_proof_requests%rowtype;
begin
  select candidate.* into retry
    from app.private_telebirr_shadow_assessment_clock_retries candidate
   where candidate.retry_request_key = p_retry_request_key
     and candidate.replacement_shadow_proof_request_id =
         p_replacement_shadow_proof_request_id;
  select proof.* into replacement
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = p_replacement_shadow_proof_request_id;

  return app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(
           p_replacement_shadow_proof_request_id,
           p_retry_request_key
         )
    and retry.authorized_at <= pg_catalog.clock_timestamp()
    and retry.retry_expires_at > pg_catalog.clock_timestamp()
    and replacement.proof_status = 'verification_queued'
    and app.private_telebirr_shadow_mode_is_ready(retry.pilot_revision_id)
    and app.current_private_trusted_telebirr_activation_epoch() is null
    and not exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = replacement.id
    )
    and not exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and role.rolcanlogin
    )
    and not exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    );
exception
  when others then
    return false;
end;
$$;

create function app.private_telebirr_shadow_assessment_submitted_at(
  p_shadow_proof_request_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  retry app.private_telebirr_shadow_assessment_clock_retries%rowtype;
begin
  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = p_shadow_proof_request_id;

  if proof.id is null then
    return null;
  end if;
  if proof.assessment_clock_retry_source_id is null then
    return proof.submitted_at;
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_assessment_clock_retries candidate
   where candidate.replacement_shadow_proof_request_id = proof.id;
  if retry.retry_request_key is null
    or not app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(
      proof.id,
      retry.retry_request_key
    ) then
    return null;
  end if;
  return retry.assessment_submitted_at;
exception
  when others then
    return null;
end;
$$;

-- Bind the exact assessment timestamp into the two-read authority digest and into the trusted
-- request sent to the no-money verifier. Invalid lineage therefore fails closed before parsing.
do $bind_assessment_submission_clock_to_authority$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_private_telebirr_shadow_verification_authority(uuid,uuid,timestamp with time zone)'
  );
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
  old_ready constant text :=
    'shadow_ready := app.private_telebirr_shadow_mode_is_ready(pilot.id)';
  new_ready constant text := old_ready || pg_catalog.chr(10)
    || '    and app.private_telebirr_shadow_assessment_submitted_at(proof.id) is not null';
  old_state constant text :=
    '''proof'', pg_catalog.to_jsonb(proof),';
  new_state constant text := old_state || pg_catalog.chr(10)
    || '    ''assessmentSubmittedAt'', pg_catalog.to_jsonb(' || pg_catalog.chr(10)
    || '      app.private_telebirr_shadow_assessment_submitted_at(proof.id)' || pg_catalog.chr(10)
    || '    ),';
  old_output constant text :=
    '''submittedAt'', pg_catalog.to_jsonb(proof.submitted_at)';
  new_output constant text :=
    '''submittedAt'', pg_catalog.to_jsonb(' || pg_catalog.chr(10)
    || '        app.private_telebirr_shadow_assessment_submitted_at(proof.id)' || pg_catalog.chr(10)
    || '      )';
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.pronargs = 3
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_ready, ''))
    ) / pg_catalog.length(old_ready) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_state, ''))
    ) / pg_catalog.length(old_state) <> 1
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_output, ''))
    ) / pg_catalog.length(old_output) <> 1
    or pg_catalog.strpos(original_source, new_ready) <> 0
    or pg_catalog.strpos(original_source, new_state) <> 0
    or pg_catalog.strpos(original_source, new_output) <> 0 then
    raise exception 'The TeleBirr shadow authority assessment clock is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_ready, new_ready);
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_state, new_state);
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_output, new_output);
  rewritten_source := pg_catalog.replace(original_source, old_ready, new_ready);
  rewritten_source := pg_catalog.replace(rewritten_source, old_state, new_state);
  rewritten_source := pg_catalog.replace(rewritten_source, old_output, new_output);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The TeleBirr authority assessment-clock rewrite changed its authority.';
  end if;
end;
$bind_assessment_submission_clock_to_authority$;

-- A twelve-hour replacement may receive several short signed assignments. Keep only its newest
-- eligible staged observation in the global loader, as for every other append-only retry branch.
do $prefer_latest_assessment_clock_retry_evidence$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_next_private_telebirr_shadow_staged_evidence()'
  );
  old_fragment constant text :=
    '(proof.source_unavailable_retry_source_id is null'
    || ' and proof.observation_clock_retry_source_id is null'
    || ' and proof.authority_deadline_retry_source_id is null)';
  new_fragment constant text :=
    '(proof.source_unavailable_retry_source_id is null'
    || ' and proof.observation_clock_retry_source_id is null'
    || ' and proof.authority_deadline_retry_source_id is null'
    || ' and proof.assessment_clock_retry_source_id is null)';
  original_definition text;
  original_source text;
  rewritten_definition text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  select pg_catalog.pg_get_functiondef(routine.oid),
         routine.prosrc,
         routine.proowner,
         routine.proacl,
         routine.proconfig,
         routine.provolatile,
         routine.proparallel,
         routine.proleakproof,
         routine.prosecdef,
         routine.proretset
    into original_definition,
         original_source,
         original_owner,
         original_acl,
         original_config,
         original_volatility,
         original_parallel,
         original_leakproof,
         original_security_definer,
         original_returns_set
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The TeleBirr staged-evidence assessment retry ordering is not reviewed.';
  end if;

  rewritten_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute rewritten_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosrc = rewritten_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.proconfig is not distinct from original_config
       and routine.provolatile = original_volatility
       and routine.proparallel = original_parallel
       and routine.proleakproof = original_leakproof
       and routine.prosecdef = original_security_definer
       and routine.proretset = original_returns_set
  ) then
    raise exception 'The TeleBirr staged-evidence assessment ordering changed its authority.';
  end if;
end;
$prefer_latest_assessment_clock_retry_evidence$;

alter table app.private_telebirr_shadow_assessment_clock_retries
  enable row level security;
alter table app.private_telebirr_shadow_assessment_clock_retries
  force row level security;
alter table app.private_telebirr_shadow_assessment_clock_retries owner to postgres;

alter function app.private_telebirr_shadow_assessment_clock_retry_digest(
  uuid, uuid, uuid, uuid, text, uuid, text, text, integer, text, uuid, uuid,
  timestamptz, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text
) owner to postgres;
alter function app.reject_private_telebirr_shadow_assessment_clock_retry_mutation()
  owner to postgres;
alter function app.guard_private_telebirr_shadow_assessment_clock_retry_insert()
  owner to postgres;
alter function app.retry_private_telebirr_shadow_after_assessment_clock_fix(
  uuid, uuid, uuid, uuid, text, text
) owner to postgres;
alter function app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(
  uuid, uuid
) owner to postgres;
alter function app.private_telebirr_shadow_assessment_clock_retry_is_valid(uuid, uuid)
  owner to postgres;
alter function app.private_telebirr_shadow_assessment_submitted_at(uuid)
  owner to postgres;

revoke all on table app.private_telebirr_shadow_assessment_clock_retries
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

revoke all on function
  app.private_telebirr_shadow_assessment_clock_retry_digest(
    uuid, uuid, uuid, uuid, text, uuid, text, text, integer, text, uuid, uuid,
    timestamptz, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text
  ),
  app.reject_private_telebirr_shadow_assessment_clock_retry_mutation(),
  app.guard_private_telebirr_shadow_assessment_clock_retry_insert(),
  app.retry_private_telebirr_shadow_after_assessment_clock_fix(
    uuid, uuid, uuid, uuid, text, text
  ),
  app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(uuid, uuid),
  app.private_telebirr_shadow_assessment_clock_retry_is_valid(uuid, uuid),
  app.private_telebirr_shadow_assessment_submitted_at(uuid)
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

comment on column
  app.private_telebirr_shadow_proof_requests.assessment_clock_retry_source_id is
  'Immutable terminal authority-deadline child whose receipt was reviewed against the wrong retry submission clock; its replacement uses separately ledger-bound original submission time only for assessment.';
comment on table app.private_telebirr_shadow_assessment_clock_retries is
  'Immutable no-money lineage from one receipt_too_old authority-deadline outcome to one fresh exact twelve-hour shadow child whose assessment clock is the original transfer submission time.';
comment on function app.retry_private_telebirr_shadow_after_assessment_clock_fix(
  uuid, uuid, uuid, uuid, text, text
) is
  'Postgres-only idempotent creation of one exact twelve-hour no-money shadow child after the reviewed assessment submission-clock defect. All prior proofs, evidence, and outcomes remain immutable.';
comment on function app.private_telebirr_shadow_assessment_clock_retry_history_is_valid(
  uuid, uuid
) is
  'Validates immutable source recovery, authority retry, receipt_too_old outcome, replacement lineage, and original assessment timestamp without granting current authority.';
comment on function app.private_telebirr_shadow_assessment_clock_retry_is_valid(
  uuid, uuid
) is
  'Validates one current exact twelve-hour no-money assessment-clock retry while all financial and KemerBet authority remains disabled.';
comment on function app.private_telebirr_shadow_assessment_submitted_at(uuid) is
  'Returns the immutable trusted assessment submission time. Ordinary proofs use their own submission time; a valid assessment-clock retry uses its ledger-bound original source-recovery submission time.';
comment on function app.load_private_telebirr_shadow_verification_authority(
  uuid, uuid, timestamptz
) is
  'Loads current no-money shadow authority and binds the immutable assessment submission timestamp into both the trusted request and authority-state digest. Review windows remain exactly twelve hours while machine assignments remain short.';
comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads immutable staged evidence inside its exact twelve-hour review window and selects only the newest eligible attempt for every append-only retry branch.';
comment on index app.private_tbirr_shadow_original_provider_reference_uidx is
  'Preserves global provider/reference uniqueness for original shadow intake while separately ledger-bound no-money recovery children are permitted.';

commit;
