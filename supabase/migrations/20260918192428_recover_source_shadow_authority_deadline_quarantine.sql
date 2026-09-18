-- Repair the remaining shadow-authority review deadline for terminal source-unavailable
-- recoveries, and provide one append-only replacement after evidence was quarantined by that
-- exact reviewed defect. The original proof, attempts, signed evidence, and quarantine remain
-- immutable. The replacement stays review-only for exactly twelve hours, while every signed
-- phone assignment remains independently bounded to at most five minutes. This migration grants
-- no KemerBet execution, reservation, settlement, credit, payment, or money-movement authority.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.agent_platform_companion_execution_control in share row exclusive mode;
lock table app.private_telebirr_shadow_proof_requests in share row exclusive mode;
lock table app.private_telebirr_shadow_verification_attempts in share row exclusive mode;
lock table app.private_telebirr_shadow_device_evidence_staging in share row exclusive mode;
lock table app.private_telebirr_shadow_evidence_quarantine in share row exclusive mode;

do $authority_deadline_recovery_preflight$
declare
  safe_switch_count integer;
  exact_disabled_companion_count integer;
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
    or authority_source is null
    or (
      pg_catalog.length(authority_source)
      - pg_catalog.length(pg_catalog.replace(
          authority_source,
          'and captured_at < proof.submitted_at + interval ''12 hours''',
          ''
        ))
    ) / pg_catalog.length(
      'and captured_at < proof.submitted_at + interval ''12 hours'''
    ) <> 1
    or loader_source is null
    or pg_catalog.strpos(
         loader_source,
         '(proof.source_unavailable_retry_source_id is null and proof.observation_clock_retry_source_id is null)'
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
      'Authority-deadline recovery requires the complete reviewed no-money boundary.';
  end if;
end;
$authority_deadline_recovery_preflight$;

alter table app.private_telebirr_shadow_proof_requests
  add column authority_deadline_retry_source_id uuid;

alter table app.private_telebirr_shadow_proof_requests
  add constraint private_tbirr_shadow_authority_retry_source_not_self_check check (
    authority_deadline_retry_source_id is null
    or authority_deadline_retry_source_id <> id
  ),
  add constraint private_tbirr_shadow_authority_retry_branch_shape_check check (
    authority_deadline_retry_source_id is null
    or (
      source_unavailable_retry_source_id is null
      and observation_clock_retry_source_id is null
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
  add constraint private_tbirr_shadow_authority_retry_source_reference_fkey
    foreign key (
      authority_deadline_retry_source_id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) references app.private_telebirr_shadow_proof_requests (
      id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) on delete restrict,
  add constraint private_tbirr_shadow_authority_retry_source_once_key
    unique (authority_deadline_retry_source_id);

do $replace_original_reference_index$
declare
  index_definition text;
begin
  select pg_catalog.pg_get_indexdef(index_row.indexrelid)
    into index_definition
    from pg_catalog.pg_index index_row
   where index_row.indexrelid =
         'app.private_tbirr_shadow_original_provider_reference_uidx'::regclass
     and index_row.indisunique
     and index_row.indisvalid;

  if index_definition is distinct from
       'CREATE UNIQUE INDEX private_tbirr_shadow_original_provider_reference_uidx ON app.private_telebirr_shadow_proof_requests USING btree (payment_provider_id, candidate_reference_fingerprint) WHERE ((source_unavailable_retry_source_id IS NULL) AND (observation_clock_retry_source_id IS NULL))' then
    raise exception 'The TeleBirr original provider-reference index is not reviewed.';
  end if;
end;
$replace_original_reference_index$;

drop index app.private_tbirr_shadow_original_provider_reference_uidx;
create unique index private_tbirr_shadow_original_provider_reference_uidx
  on app.private_telebirr_shadow_proof_requests (
    payment_provider_id,
    candidate_reference_fingerprint
  )
  where source_unavailable_retry_source_id is null
    and observation_clock_retry_source_id is null
    and authority_deadline_retry_source_id is null;

create table app.private_telebirr_shadow_authority_deadline_retries (
  retry_request_key uuid primary key,
  retry_request_digest text not null unique
    check (retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_shadow_proof_request_id uuid not null unique,
  source_shadow_verification_job_id uuid not null unique,
  source_recovery_request_key uuid not null unique
    references app.private_live_telebirr_source_recoveries (recovery_request_key)
      on delete restrict,
  source_recovery_request_digest text not null unique
    check (source_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_shadow_recovery_digest text not null unique
    check (source_shadow_recovery_digest ~ '^sha256:[0-9a-f]{64}$'),
  replacement_shadow_proof_request_id uuid not null unique,
  replacement_shadow_verification_job_id uuid not null unique,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  prior_attempt_count integer not null check (prior_attempt_count between 1 and 99),
  prior_attempt_history_digest text not null
    check (prior_attempt_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  prior_quarantine_count integer not null check (prior_quarantine_count between 1 and 99),
  prior_quarantine_history_digest text not null
    check (prior_quarantine_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  authorized_at timestamptz not null,
  retry_expires_at timestamptz not null,
  reviewed_main_commit_sha text not null
    check (reviewed_main_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null
    check (reason_code = 'source_recovery_authority_deadline_retry_no_credit'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_tbirr_shadow_authority_retry_request_v4_check check (
    retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_tbirr_shadow_authority_retry_history_check check (
    prior_quarantine_count = prior_attempt_count
  ),
  constraint private_tbirr_shadow_authority_retry_window_check check (
    retry_expires_at = authorized_at + interval '12 hours'
  ),
  constraint private_tbirr_shadow_authority_retry_source_job_fkey
    foreign key (source_shadow_proof_request_id, source_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_tbirr_shadow_authority_retry_replacement_job_fkey
    foreign key (replacement_shadow_proof_request_id, replacement_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict deferrable initially deferred
);

create function app.private_telebirr_shadow_quarantine_history_digest(
  p_shadow_proof_request_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select case when pg_catalog.count(*) = 0 then null else
    app.private_live_deposit_pilot_sha256(
      pg_catalog.string_agg(
        'attempt_number=' || attempt.attempt_number::text
          || '|attempt_id=' || attempt.id::text
          || '|observation_body_digest=' || quarantine.observation_body_digest
          || '|reason_code=' || quarantine.reason_code
          || '|quarantined_at_us=' || (
            extract(epoch from quarantine.quarantined_at) * 1000000
          )::bigint::text,
        E'\n' order by attempt.attempt_number, attempt.id
      )
    )
  end
    from app.private_telebirr_shadow_verification_attempts attempt
    join app.private_telebirr_shadow_evidence_quarantine quarantine
      on quarantine.verification_attempt_id = attempt.id
   where attempt.shadow_proof_request_id = p_shadow_proof_request_id;
$$;

create function app.private_telebirr_shadow_authority_deadline_retry_digest(
  p_retry_request_key uuid,
  p_source_shadow_proof_request_id uuid,
  p_source_shadow_verification_job_id uuid,
  p_source_recovery_request_key uuid,
  p_source_recovery_request_digest text,
  p_source_shadow_recovery_digest text,
  p_replacement_shadow_proof_request_id uuid,
  p_replacement_shadow_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_receiver_profile_id uuid,
  p_prior_attempt_count integer,
  p_prior_attempt_history_digest text,
  p_prior_quarantine_count integer,
  p_prior_quarantine_history_digest text,
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
    or p_source_recovery_request_key is null
    or p_source_recovery_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_shadow_recovery_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_receiver_profile_id is null
    or p_prior_attempt_count not between 1 and 99
    or p_prior_attempt_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_prior_quarantine_count is distinct from p_prior_attempt_count
    or p_prior_quarantine_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_authorized_at is null
    or p_retry_expires_at is distinct from p_authorized_at + interval '12 hours'
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from
       'source_recovery_authority_deadline_retry_no_credit' then
    raise exception 'The TeleBirr authority-deadline retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-authority-deadline-retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|source_shadow_proof_request_id=' || p_source_shadow_proof_request_id::text
      || '|source_shadow_verification_job_id=' || p_source_shadow_verification_job_id::text
      || '|source_recovery_request_key=' || p_source_recovery_request_key::text
      || '|source_recovery_request_digest=' || p_source_recovery_request_digest
      || '|source_shadow_recovery_digest=' || p_source_shadow_recovery_digest
      || '|replacement_shadow_proof_request_id='
      || p_replacement_shadow_proof_request_id::text
      || '|replacement_shadow_verification_job_id='
      || p_replacement_shadow_verification_job_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|receiver_profile_id=' || p_receiver_profile_id::text
      || '|prior_attempt_count=' || p_prior_attempt_count::text
      || '|prior_attempt_history_digest=' || p_prior_attempt_history_digest
      || '|prior_quarantine_count=' || p_prior_quarantine_count::text
      || '|prior_quarantine_history_digest=' || p_prior_quarantine_history_digest
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

create function app.reject_private_telebirr_shadow_authority_deadline_retry_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private TeleBirr authority-deadline retry lineage is immutable.';
end;
$$;

create trigger private_tbirr_shadow_authority_deadline_retries_immutable
before update or delete on app.private_telebirr_shadow_authority_deadline_retries
for each row
execute function app.reject_private_telebirr_shadow_authority_deadline_retry_mutation();

create trigger private_tbirr_shadow_authority_deadline_retries_no_truncate
before truncate on app.private_telebirr_shadow_authority_deadline_retries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.guard_private_telebirr_shadow_authority_deadline_retry_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  request_key_text text := pg_catalog.current_setting(
    'app.private_telebirr_shadow_authority_deadline_retry', true
  );
  retry app.private_telebirr_shadow_authority_deadline_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  expected_digest text;
  current_attempt_count integer;
  current_quarantine_count integer;
begin
  if new.authority_deadline_retry_source_id is null then
    return new;
  end if;

  if request_key_text is null
    or request_key_text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The TeleBirr authority-deadline replacement context is invalid.';
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_authority_deadline_retries candidate
   where candidate.retry_request_key = request_key_text::uuid
   for share;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = new.authority_deadline_retry_source_id
   for share;
  select pg_catalog.count(*)::integer
    into current_attempt_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer
    into current_quarantine_count
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = quarantine.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;

  expected_digest := app.private_telebirr_shadow_authority_deadline_retry_digest(
    retry.retry_request_key,
    retry.source_shadow_proof_request_id,
    retry.source_shadow_verification_job_id,
    retry.source_recovery_request_key,
    retry.source_recovery_request_digest,
    retry.source_shadow_recovery_digest,
    retry.replacement_shadow_proof_request_id,
    retry.replacement_shadow_verification_job_id,
    retry.pilot_revision_id,
    retry.receiver_profile_id,
    retry.prior_attempt_count,
    retry.prior_attempt_history_digest,
    retry.prior_quarantine_count,
    retry.prior_quarantine_history_digest,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );

  if session_user <> 'postgres'
    or retry.retry_request_key is null
    or retry.retry_request_digest is distinct from expected_digest
    or retry.source_shadow_proof_request_id is distinct from source_proof.id
    or retry.source_shadow_verification_job_id
         is distinct from source_proof.verification_job_id
    or retry.source_recovery_request_key is distinct from source_proof.recovery_request_key
    or retry.source_shadow_recovery_digest
         is distinct from source_proof.recovery_request_digest
    or retry.pilot_revision_id is distinct from source_proof.pilot_revision_id
    or retry.receiver_profile_id is distinct from source_proof.receiver_profile_id
    or retry.prior_attempt_count is distinct from current_attempt_count
    or retry.prior_attempt_history_digest is distinct from
         app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id)
    or retry.prior_quarantine_count is distinct from current_quarantine_count
    or retry.prior_quarantine_history_digest is distinct from
         app.private_telebirr_shadow_quarantine_history_digest(source_proof.id)
    or not app.private_live_telebirr_source_recovery_is_valid(
         source_proof.id,
         source_proof.recovery_request_key
       )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = source_proof.id
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
    or new.observation_clock_retry_source_id is not null then
    raise exception 'The TeleBirr authority-deadline replacement proof is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_tbirr_shadow_authority_deadline_retry_insert_guard
before insert on app.private_telebirr_shadow_proof_requests
for each row
when (new.authority_deadline_retry_source_id is not null)
execute function app.guard_private_telebirr_shadow_authority_deadline_retry_insert();

create function app.retry_private_telebirr_shadow_after_authority_deadline_fix(
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
  existing_retry app.private_telebirr_shadow_authority_deadline_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_recovery app.private_live_telebirr_source_recoveries%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  replacement_proof_id uuid;
  replacement_job_id uuid;
  retry_digest text;
  prior_attempt_count integer;
  prior_attempt_history_digest text;
  prior_quarantine_count integer;
  prior_quarantine_history_digest text;
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
       'source_recovery_authority_deadline_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The TeleBirr authority-deadline retry request is invalid.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-authority-deadline-retry:v1:'
        || p_source_shadow_proof_request_id::text,
      0::bigint
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-authority-deadline-retry-request:v1:'
        || p_retry_request_key::text,
      0::bigint
    )
  );

  select retry.* into existing_retry
    from app.private_telebirr_shadow_authority_deadline_retries retry
   where retry.retry_request_key = p_retry_request_key
      or retry.source_shadow_proof_request_id = p_source_shadow_proof_request_id
   order by (retry.retry_request_key = p_retry_request_key) desc
   limit 1
   for share;

  if existing_retry.retry_request_key is not null then
    retry_digest := app.private_telebirr_shadow_authority_deadline_retry_digest(
      existing_retry.retry_request_key,
      existing_retry.source_shadow_proof_request_id,
      existing_retry.source_shadow_verification_job_id,
      existing_retry.source_recovery_request_key,
      existing_retry.source_recovery_request_digest,
      existing_retry.source_shadow_recovery_digest,
      existing_retry.replacement_shadow_proof_request_id,
      existing_retry.replacement_shadow_verification_job_id,
      existing_retry.pilot_revision_id,
      existing_retry.receiver_profile_id,
      existing_retry.prior_attempt_count,
      existing_retry.prior_attempt_history_digest,
      existing_retry.prior_quarantine_count,
      existing_retry.prior_quarantine_history_digest,
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
      raise exception 'The TeleBirr authority-deadline retry replay conflicts.';
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
  select recovery.* into source_recovery
    from app.private_live_telebirr_source_recoveries recovery
   where recovery.recovery_request_key = source_proof.recovery_request_key
     and recovery.replacement_shadow_proof_request_id = source_proof.id
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
    into prior_attempt_count, prior_attempt_history_digest
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer,
         app.private_telebirr_shadow_quarantine_history_digest(source_proof.id)
    into prior_quarantine_count, prior_quarantine_history_digest
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = quarantine.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;

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
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
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
    or source_proof.source_live_verification_job_id is null
    or source_proof.source_live_proof_id is null
    or source_proof.source_pilot_revision_id is null
    or source_proof.source_receiver_profile_id is null
    or source_proof.recovery_request_key is null
    or source_proof.recovery_request_digest is null
    or source_proof.recovery_reason_code is distinct from
       'expired_pilot_recovery_no_credit'
    or source_proof.retry_request_key is not null
    or source_proof.infrastructure_retry_request_key is not null
    or source_proof.runtime_retry_request_key is not null
    or source_proof.source_unavailable_retry_source_id is not null
    or source_proof.observation_clock_retry_source_id is not null
    or source_proof.authority_deadline_retry_source_id is not null
    or source_proof.expires_at > authorized_at
    or source_recovery.recovery_request_key is distinct from source_proof.recovery_request_key
    or source_recovery.recovery_request_digest is null
    or source_recovery.replacement_shadow_verification_job_id
         is distinct from source_proof.verification_job_id
    or not app.private_live_telebirr_source_recovery_is_valid(
         source_proof.id,
         source_proof.recovery_request_key
       )
    or prior_attempt_count not between 1 and 99
    or prior_attempt_history_digest is null
    or prior_quarantine_count is distinct from prior_attempt_count
    or prior_quarantine_history_digest is null
    or exists (
      select 1
        from app.private_telebirr_shadow_verification_attempts attempt
        left join app.private_telebirr_shadow_device_evidence_staging staged
          on staged.verification_attempt_id = attempt.id
        left join app.private_telebirr_shadow_evidence_quarantine quarantine
          on quarantine.verification_attempt_id = attempt.id
         and quarantine.observation_body_digest = staged.observation_body_digest
       where attempt.shadow_proof_request_id = source_proof.id
         and (
           staged.verification_attempt_id is null
           or staged.observed_at < attempt.issued_at
           or staged.observed_at >= attempt.expires_at
           or staged.staged_at >= attempt.expires_at
           or staged.staged_at >= source_proof.expires_at
           or quarantine.verification_attempt_id is null
           or quarantine.reason_code <> 'trusted_evidence_invalid'
         )
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = source_proof.id
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
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
    raise exception 'The quarantined source-recovery proof is not safely retryable.';
  end if;

  replacement_proof_id := pg_catalog.gen_random_uuid();
  replacement_job_id := pg_catalog.gen_random_uuid();
  retry_digest := app.private_telebirr_shadow_authority_deadline_retry_digest(
    p_retry_request_key,
    source_proof.id,
    source_proof.verification_job_id,
    source_recovery.recovery_request_key,
    source_recovery.recovery_request_digest,
    source_proof.recovery_request_digest,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    prior_attempt_count,
    prior_attempt_history_digest,
    prior_quarantine_count,
    prior_quarantine_history_digest,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  insert into app.private_telebirr_shadow_authority_deadline_retries (
    retry_request_key,
    retry_request_digest,
    source_shadow_proof_request_id,
    source_shadow_verification_job_id,
    source_recovery_request_key,
    source_recovery_request_digest,
    source_shadow_recovery_digest,
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id,
    pilot_revision_id,
    receiver_profile_id,
    prior_attempt_count,
    prior_attempt_history_digest,
    prior_quarantine_count,
    prior_quarantine_history_digest,
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
    source_recovery.recovery_request_key,
    source_recovery.recovery_request_digest,
    source_proof.recovery_request_digest,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    prior_attempt_count,
    prior_attempt_history_digest,
    prior_quarantine_count,
    prior_quarantine_history_digest,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code,
    authorized_at
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_authority_deadline_retry',
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
    authority_deadline_retry_source_id
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
    'app.private_telebirr_shadow_authority_deadline_retry', 'off', true
  );

  insert into app.audit_events (
    actor_kind,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'system',
    'verification.telebirr_shadow_authority_deadline_retry_armed',
    'telebirr_shadow_proof_request',
    replacement_proof_id,
    pg_catalog.jsonb_build_object(
      'source_shadow_proof_request_id', source_proof.id,
      'source_shadow_verification_job_id', source_proof.verification_job_id,
      'source_recovery_request_key', source_recovery.recovery_request_key,
      'retry_request_key', p_retry_request_key,
      'pilot_revision_id', pilot.id,
      'prior_attempt_count', prior_attempt_count,
      'prior_attempt_history_digest', prior_attempt_history_digest,
      'prior_quarantine_count', prior_quarantine_count,
      'prior_quarantine_history_digest', prior_quarantine_history_digest,
      'retry_expires_at', retry_until,
      'reviewed_main_commit_sha', p_reviewed_main_commit_sha,
      'reason_code', p_reason_code,
      'financial_actions_enabled', false,
      'money_moved', false
    )
  );

  return query select replacement_proof_id, replacement_job_id, retry_until, false;
end;
$$;

create function app.private_telebirr_shadow_authority_deadline_retry_is_valid(
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
  retry app.private_telebirr_shadow_authority_deadline_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  replacement app.private_telebirr_shadow_proof_requests%rowtype;
  source_recovery app.private_live_telebirr_source_recoveries%rowtype;
  expected_digest text;
  expected_source_recovery_digest text;
  current_attempt_count integer;
  current_quarantine_count integer;
begin
  if p_replacement_shadow_proof_request_id is null or p_retry_request_key is null then
    return false;
  end if;

  select candidate.* into retry
    from app.private_telebirr_shadow_authority_deadline_retries candidate
   where candidate.retry_request_key = p_retry_request_key
     and candidate.replacement_shadow_proof_request_id =
         p_replacement_shadow_proof_request_id;
  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.source_shadow_proof_request_id
     and proof.verification_job_id = retry.source_shadow_verification_job_id;
  select proof.* into replacement
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = retry.replacement_shadow_proof_request_id
     and proof.verification_job_id = retry.replacement_shadow_verification_job_id;
  select recovery.* into source_recovery
    from app.private_live_telebirr_source_recoveries recovery
   where recovery.recovery_request_key = retry.source_recovery_request_key
     and recovery.replacement_shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into current_attempt_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = source_proof.id;
  select pg_catalog.count(*)::integer into current_quarantine_count
    from app.private_telebirr_shadow_evidence_quarantine quarantine
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = quarantine.verification_attempt_id
   where attempt.shadow_proof_request_id = source_proof.id;

  expected_digest := app.private_telebirr_shadow_authority_deadline_retry_digest(
    retry.retry_request_key,
    retry.source_shadow_proof_request_id,
    retry.source_shadow_verification_job_id,
    retry.source_recovery_request_key,
    retry.source_recovery_request_digest,
    retry.source_shadow_recovery_digest,
    retry.replacement_shadow_proof_request_id,
    retry.replacement_shadow_verification_job_id,
    retry.pilot_revision_id,
    retry.receiver_profile_id,
    retry.prior_attempt_count,
    retry.prior_attempt_history_digest,
    retry.prior_quarantine_count,
    retry.prior_quarantine_history_digest,
    retry.authorized_at,
    retry.retry_expires_at,
    retry.reviewed_main_commit_sha,
    retry.reason_code
  );
  expected_source_recovery_digest := app.private_live_telebirr_source_recovery_digest(
    source_recovery.recovery_request_key,
    source_recovery.root_live_verification_job_id,
    source_recovery.root_live_outcome_id,
    source_recovery.terminal_live_verification_job_id,
    source_recovery.terminal_live_outcome_id,
    source_recovery.source_live_proof_id,
    source_recovery.source_pilot_revision_id,
    source_recovery.source_receiver_profile_id,
    source_recovery.replacement_shadow_proof_request_id,
    source_recovery.replacement_shadow_verification_job_id,
    source_recovery.target_pilot_revision_id,
    source_recovery.target_receiver_profile_id,
    source_recovery.source_attempt_count,
    source_recovery.source_assignment_transcript_count,
    source_recovery.source_assignment_delivery_count,
    source_recovery.source_device_evidence_count,
    source_recovery.source_observation_count,
    source_recovery.source_attempt_history_digest,
    source_recovery.authorized_at,
    source_recovery.recovery_expires_at,
    source_recovery.reason_code
  );

  return retry.retry_request_key is not null
    and retry.retry_request_digest = expected_digest
    and retry.source_recovery_request_digest = expected_source_recovery_digest
    and source_recovery.recovery_request_digest = expected_source_recovery_digest
    and retry.source_shadow_recovery_digest = source_proof.recovery_request_digest
    and source_proof.recovery_request_key = source_recovery.recovery_request_key
    and source_proof.id = source_recovery.replacement_shadow_proof_request_id
    and source_proof.verification_job_id =
        source_recovery.replacement_shadow_verification_job_id
    and source_proof.pilot_revision_id = retry.pilot_revision_id
    and source_proof.receiver_profile_id = retry.receiver_profile_id
    and source_proof.proof_status = 'verification_queued'
    and current_attempt_count = retry.prior_attempt_count
    and app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id) =
        retry.prior_attempt_history_digest
    and current_quarantine_count = retry.prior_quarantine_count
    and app.private_telebirr_shadow_quarantine_history_digest(source_proof.id) =
        retry.prior_quarantine_history_digest
    and not exists (
      select 1
        from app.private_telebirr_shadow_verification_attempts attempt
        left join app.private_telebirr_shadow_device_evidence_staging staged
          on staged.verification_attempt_id = attempt.id
        left join app.private_telebirr_shadow_evidence_quarantine quarantine
          on quarantine.verification_attempt_id = attempt.id
         and quarantine.observation_body_digest = staged.observation_body_digest
       where attempt.shadow_proof_request_id = source_proof.id
         and (
           staged.verification_attempt_id is null
           or quarantine.verification_attempt_id is null
           or quarantine.reason_code <> 'trusted_evidence_invalid'
         )
    )
    and replacement.id = p_replacement_shadow_proof_request_id
    and replacement.authority_deadline_retry_source_id = source_proof.id
    and replacement.source_unavailable_retry_source_id is null
    and replacement.observation_clock_retry_source_id is null
    and replacement.pilot_revision_id = retry.pilot_revision_id
    and replacement.receiver_profile_id = retry.receiver_profile_id
    and replacement.submitting_customer_id = source_proof.submitting_customer_id
    and replacement.player_account_id = source_proof.player_account_id
    and replacement.payment_provider_id = source_proof.payment_provider_id
    and replacement.candidate_reference_ciphertext =
        source_proof.candidate_reference_ciphertext
    and replacement.candidate_reference_fingerprint =
        source_proof.candidate_reference_fingerprint
    and replacement.submitted_at = retry.authorized_at
    and replacement.not_before = retry.authorized_at
    and replacement.expires_at = retry.retry_expires_at
    and retry.retry_expires_at = retry.authorized_at + interval '12 hours'
    and retry.authorized_at <= pg_catalog.clock_timestamp()
    and retry.retry_expires_at > pg_catalog.clock_timestamp()
    and retry.reason_code = 'source_recovery_authority_deadline_retry_no_credit'
    and app.private_telebirr_shadow_mode_is_ready(retry.pilot_revision_id)
    and app.current_private_trusted_telebirr_activation_epoch() is null
    and not exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id in (source_proof.id, replacement.id)
    )
    and not exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    )
    and not exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id =
             source_recovery.source_live_proof_id
    )
    and not exists (
      select 1 from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id in (
         source_recovery.root_live_outcome_id,
         source_recovery.terminal_live_outcome_id
       )
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

-- The original authority loader was the only review boundary still tied solely to submitted_at.
-- Rewrite that one comparison while preserving every owner, ACL, volatility, config, and return
-- property of the reviewed security-definer routine.
do $fix_source_recovery_authority_deadline$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_private_telebirr_shadow_verification_authority(uuid,uuid,timestamp with time zone)'
  );
  old_fragment constant text :=
    'and captured_at < proof.submitted_at + interval ''12 hours''';
  new_fragment constant text :=
    'and captured_at < case' || pg_catalog.chr(10)
    || '      when proof.recovery_request_key is not null' || pg_catalog.chr(10)
    || '        and proof.recovered_at is not null' || pg_catalog.chr(10)
    || '        and app.private_live_telebirr_source_recovery_is_valid(' || pg_catalog.chr(10)
    || '              proof.id,' || pg_catalog.chr(10)
    || '              proof.recovery_request_key' || pg_catalog.chr(10)
    || '            )' || pg_catalog.chr(10)
    || '        then proof.recovered_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '      else proof.submitted_at + interval ''12 hours''' || pg_catalog.chr(10)
    || '    end';
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
     and routine.pronargs = 3
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_definition is null
    or (
      pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
    ) / pg_catalog.length(old_fragment) <> 1
    or pg_catalog.strpos(original_source, new_fragment) <> 0 then
    raise exception 'The TeleBirr shadow authority review deadline is not reviewed.';
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
    raise exception 'The TeleBirr shadow authority rewrite changed its authority.';
  end if;
end;
$fix_source_recovery_authority_deadline$;

-- A twelve-hour replacement can receive more than one short phone attempt. Preserve the loader's
-- newest-evidence rule for this new append-only retry branch as well.
do $prefer_latest_authority_deadline_retry_evidence$
declare
  routine_oid oid := pg_catalog.to_regprocedure(
    'app.load_next_private_telebirr_shadow_staged_evidence()'
  );
  old_fragment constant text :=
    '(proof.source_unavailable_retry_source_id is null and proof.observation_clock_retry_source_id is null)';
  new_fragment constant text :=
    '(proof.source_unavailable_retry_source_id is null'
    || ' and proof.observation_clock_retry_source_id is null'
    || ' and proof.authority_deadline_retry_source_id is null)';
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
    raise exception 'The TeleBirr staged-evidence retry ordering is not reviewed.';
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
    raise exception 'The TeleBirr staged-evidence ordering rewrite changed its authority.';
  end if;
end;
$prefer_latest_authority_deadline_retry_evidence$;

alter table app.private_telebirr_shadow_authority_deadline_retries
  enable row level security;
alter table app.private_telebirr_shadow_authority_deadline_retries
  force row level security;
alter table app.private_telebirr_shadow_authority_deadline_retries owner to postgres;

alter function app.private_telebirr_shadow_quarantine_history_digest(uuid)
  owner to postgres;
alter function app.private_telebirr_shadow_authority_deadline_retry_digest(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid,
  integer, text, integer, text, timestamptz, timestamptz, text, text
) owner to postgres;
alter function app.reject_private_telebirr_shadow_authority_deadline_retry_mutation()
  owner to postgres;
alter function app.guard_private_telebirr_shadow_authority_deadline_retry_insert()
  owner to postgres;
alter function app.retry_private_telebirr_shadow_after_authority_deadline_fix(
  uuid, uuid, uuid, uuid, text, text
) owner to postgres;
alter function app.private_telebirr_shadow_authority_deadline_retry_is_valid(uuid, uuid)
  owner to postgres;

revoke all on table app.private_telebirr_shadow_authority_deadline_retries
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
  app.private_telebirr_shadow_quarantine_history_digest(uuid),
  app.private_telebirr_shadow_authority_deadline_retry_digest(
    uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid,
    integer, text, integer, text, timestamptz, timestamptz, text, text
  ),
  app.reject_private_telebirr_shadow_authority_deadline_retry_mutation(),
  app.guard_private_telebirr_shadow_authority_deadline_retry_insert(),
  app.retry_private_telebirr_shadow_after_authority_deadline_fix(
    uuid, uuid, uuid, uuid, text, text
  ),
  app.private_telebirr_shadow_authority_deadline_retry_is_valid(uuid, uuid)
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
  app.private_telebirr_shadow_proof_requests.authority_deadline_retry_source_id is
  'Immutable source proof whose authenticated signed observations were quarantined only because the reviewed authority loader used the original submission deadline.';
comment on table app.private_telebirr_shadow_authority_deadline_retries is
  'Immutable no-money lineage from one valid terminal source recovery and all retained trusted-evidence-invalid quarantines to one fresh twelve-hour review-only child proof.';
comment on function app.retry_private_telebirr_shadow_after_authority_deadline_fix(
  uuid, uuid, uuid, uuid, text, text
) is
  'Postgres-only, idempotent creation of one fresh twelve-hour no-money shadow request after the exact reviewed source-recovery authority-deadline defect. It preserves every prior attempt, signed observation, and quarantine.';
comment on function app.private_telebirr_shadow_authority_deadline_retry_is_valid(
  uuid, uuid
) is
  'Validates the immutable source-recovery authority-deadline retry lineage and current no-money boundary for guarded one-time shadow verification.';
comment on function app.load_private_telebirr_shadow_verification_authority(
  uuid, uuid, timestamptz
) is
  'Loads current no-money shadow authority while binding staged evidence to its short assignment. A valid source-unavailable recovery is reviewable for twelve hours from reviewed recovery authorization.';
comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads immutable staged evidence inside its reviewed no-money window and selects only the newest eligible attempt for every append-only retry branch.';
comment on index app.private_tbirr_shadow_original_provider_reference_uidx is
  'Preserves global provider/reference uniqueness for original shadow intake while separately ledger-bound no-money recovery children are permitted.';

commit;
