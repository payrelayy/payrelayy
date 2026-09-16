-- Preserve the terminal parser-uncertain outcome caused by the reviewed Android observation
-- clock defect and create exactly one fresh no-money request on a semantically identical pilot.
-- The source observation is accepted for retry authorization only when every receipt fact was
-- exact and the sole defect was a positive, sub-second retrievedAt/observedAt drift. The original
-- request, attempt, signed observation, and outcome remain immutable.

begin;

alter table app.private_telebirr_shadow_proof_requests
  add column observation_clock_retry_source_id uuid;

alter table app.private_telebirr_shadow_proof_requests
  add constraint private_tbirr_shadow_clock_retry_source_not_self_check check (
    observation_clock_retry_source_id is null
    or observation_clock_retry_source_id <> id
  ),
  add constraint private_tbirr_shadow_clock_retry_branch_shape_check check (
    observation_clock_retry_source_id is null
    or (
      source_unavailable_retry_source_id is null
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
      and infrastructure_retry_request_key is null
      and infrastructure_retry_request_digest is null
      and infrastructure_retry_reason_code is null
      and runtime_retry_request_key is null
      and runtime_retry_request_digest is null
      and runtime_retry_reason_code is null
    )
  ),
  add constraint private_tbirr_shadow_clock_retry_source_reference_fkey
    foreign key (
      observation_clock_retry_source_id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) references app.private_telebirr_shadow_proof_requests (
      id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) on delete restrict,
  add constraint private_tbirr_shadow_clock_retry_source_once_key
    unique (observation_clock_retry_source_id);

do $migration$
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
       'CREATE UNIQUE INDEX private_tbirr_shadow_original_provider_reference_uidx ON app.private_telebirr_shadow_proof_requests USING btree (payment_provider_id, candidate_reference_fingerprint) WHERE (source_unavailable_retry_source_id IS NULL)' then
    raise exception 'The TeleBirr original provider-reference index is not reviewed.';
  end if;
end;
$migration$;

drop index app.private_tbirr_shadow_original_provider_reference_uidx;
create unique index private_tbirr_shadow_original_provider_reference_uidx
  on app.private_telebirr_shadow_proof_requests (
    payment_provider_id,
    candidate_reference_fingerprint
  )
  where source_unavailable_retry_source_id is null
    and observation_clock_retry_source_id is null;

create table app.private_telebirr_shadow_observation_clock_retries (
  retry_request_key uuid primary key,
  retry_request_digest text not null unique
    check (retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_shadow_proof_request_id uuid not null unique,
  source_shadow_verification_job_id uuid not null unique,
  source_outcome_id uuid not null unique
    references app.private_telebirr_shadow_verification_outcomes (id) on delete restrict,
  source_verification_attempt_id uuid not null unique
    references app.private_telebirr_shadow_verification_attempts (id) on delete restrict,
  source_observation_body_digest text not null unique
    check (source_observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
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
  source_retrieved_at timestamptz not null,
  source_observed_at timestamptz not null,
  source_staged_at timestamptz not null,
  mismatch_microseconds bigint not null
    check (mismatch_microseconds between 1 and 1000000),
  authorized_at timestamptz not null,
  retry_expires_at timestamptz not null,
  reviewed_main_commit_sha text not null
    check (reviewed_main_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null
    check (reason_code = 'observation_clock_mismatch_retry_no_credit'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_tbirr_shadow_clock_retry_request_v4_check check (
    retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_tbirr_shadow_clock_retry_time_check check (
    source_retrieved_at < source_observed_at
    and source_observed_at <= source_staged_at
    and mismatch_microseconds =
        (extract(epoch from source_observed_at - source_retrieved_at) * 1000000)::bigint
    and retry_expires_at > authorized_at + interval '10 minutes'
    and retry_expires_at <= authorized_at + interval '12 hours'
  ),
  constraint private_tbirr_shadow_clock_retry_source_job_fkey
    foreign key (source_shadow_proof_request_id, source_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_tbirr_shadow_clock_retry_replacement_job_fkey
    foreign key (replacement_shadow_proof_request_id, replacement_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict
);

create function app.private_telebirr_shadow_observation_clock_retry_digest(
  p_retry_request_key uuid,
  p_source_shadow_proof_request_id uuid,
  p_source_shadow_verification_job_id uuid,
  p_source_outcome_id uuid,
  p_source_verification_attempt_id uuid,
  p_source_observation_body_digest text,
  p_source_pilot_revision_id uuid,
  p_source_receiver_profile_id uuid,
  p_replacement_shadow_proof_request_id uuid,
  p_replacement_shadow_verification_job_id uuid,
  p_target_pilot_revision_id uuid,
  p_target_receiver_profile_id uuid,
  p_source_retrieved_at timestamptz,
  p_source_observed_at timestamptz,
  p_source_staged_at timestamptz,
  p_mismatch_microseconds bigint,
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
    or p_source_outcome_id is null
    or p_source_verification_attempt_id is null
    or p_source_observation_body_digest is null
    or p_source_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_source_pilot_revision_id is null
    or p_source_receiver_profile_id is null
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_target_pilot_revision_id is null
    or p_target_receiver_profile_id is null
    or p_source_retrieved_at is null
    or p_source_observed_at is null
    or p_source_staged_at is null
    or p_mismatch_microseconds not between 1 and 1000000
    or p_authorized_at is null
    or p_retry_expires_at is null
    or p_reviewed_main_commit_sha is null
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from 'observation_clock_mismatch_retry_no_credit' then
    raise exception 'The TeleBirr observation-clock retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-observation-clock-retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|source_shadow_proof_request_id=' || p_source_shadow_proof_request_id::text
      || '|source_shadow_verification_job_id=' || p_source_shadow_verification_job_id::text
      || '|source_outcome_id=' || p_source_outcome_id::text
      || '|source_verification_attempt_id=' || p_source_verification_attempt_id::text
      || '|source_observation_body_digest=' || p_source_observation_body_digest
      || '|source_pilot_revision_id=' || p_source_pilot_revision_id::text
      || '|source_receiver_profile_id=' || p_source_receiver_profile_id::text
      || '|replacement_shadow_proof_request_id='
      || p_replacement_shadow_proof_request_id::text
      || '|replacement_shadow_verification_job_id='
      || p_replacement_shadow_verification_job_id::text
      || '|target_pilot_revision_id=' || p_target_pilot_revision_id::text
      || '|target_receiver_profile_id=' || p_target_receiver_profile_id::text
      || '|source_retrieved_at_us='
      || (extract(epoch from p_source_retrieved_at) * 1000000)::bigint::text
      || '|source_observed_at_us='
      || (extract(epoch from p_source_observed_at) * 1000000)::bigint::text
      || '|source_staged_at_us='
      || (extract(epoch from p_source_staged_at) * 1000000)::bigint::text
      || '|mismatch_microseconds=' || p_mismatch_microseconds::text
      || '|authorized_at_us='
      || (extract(epoch from p_authorized_at) * 1000000)::bigint::text
      || '|retry_expires_at_us='
      || (extract(epoch from p_retry_expires_at) * 1000000)::bigint::text
      || '|reviewed_main_commit_sha=' || p_reviewed_main_commit_sha
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.reject_private_telebirr_shadow_clock_retry_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private TeleBirr observation-clock retry lineage is immutable.';
end;
$$;

create trigger private_tbirr_shadow_clock_retries_immutable
before update or delete on app.private_telebirr_shadow_observation_clock_retries
for each row execute function app.reject_private_telebirr_shadow_clock_retry_mutation();

create trigger private_tbirr_shadow_clock_retries_no_truncate
before truncate on app.private_telebirr_shadow_observation_clock_retries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.guard_private_telebirr_shadow_clock_retry_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  source_attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  staged app.private_telebirr_shadow_device_evidence_staging%rowtype;
begin
  if new.observation_clock_retry_source_id is null then
    return new;
  end if;

  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = new.observation_clock_retry_source_id
   for share;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
   for share;
  select attempt.* into source_attempt
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.id = source_outcome.verification_attempt_id
   for share;
  select evidence.* into staged
    from app.private_telebirr_shadow_device_evidence_staging evidence
   where evidence.verification_attempt_id = source_attempt.id
     and evidence.observation_body_digest = source_outcome.observation_body_digest
   for share;

  if session_user <> 'postgres'
    or pg_catalog.current_setting(
         'app.private_telebirr_shadow_observation_clock_retry', true
       ) is distinct from 'on'
    or source_proof.id is null
    or source_proof.source_unavailable_retry_source_id is null
    or source_proof.observation_clock_retry_source_id is not null
    or source_proof.source_live_verification_job_id is not null
    or source_proof.source_live_proof_id is not null
    or source_proof.source_pilot_revision_id is not null
    or source_proof.source_receiver_profile_id is not null
    or source_outcome.id is null
    or source_outcome.verification_job_id is distinct from source_proof.verification_job_id
    or source_outcome.disposition is distinct from 'review_required'
    or source_outcome.reason_code is distinct from 'parser_uncertain'
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.protocol_reason_code is distinct from 'receipt_semantics_incomplete'
    or source_outcome.would_verify
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or source_attempt.id is null
    or source_attempt.shadow_proof_request_id is distinct from source_proof.id
    or source_attempt.verification_job_id is distinct from source_proof.verification_job_id
    or staged.verification_attempt_id is distinct from source_attempt.id
    or staged.observation_body_digest is distinct from source_outcome.observation_body_digest
    or source_outcome.observed_at is distinct from staged.observed_at
    or source_outcome.retrieved_at is null
    or source_outcome.retrieved_at >= source_outcome.observed_at
    or source_outcome.observed_at - source_outcome.retrieved_at > interval '1 second'
    or (staged.signed_observation #>> '{body,observedAt}')::timestamptz
         is distinct from staged.observed_at
    or (staged.signed_observation #>> '{body,facts,retrievedAt}')::timestamptz
         is distinct from source_outcome.retrieved_at
    or staged.signed_observation #>> '{body,facts,lookupOutcome}' is distinct from 'found'
    or staged.signed_observation #>> '{body,facts,amountMinor}' is distinct from '2500'
    or staged.signed_observation #>> '{body,facts,currencyCode}' is distinct from 'ETB'
    or staged.signed_observation #>> '{body,facts,paymentMode}' is distinct from 'telebirr'
    or staged.signed_observation #>> '{body,facts,paymentReason}'
         is distinct from 'send_money_to_registered_customer'
    or staged.signed_observation #>> '{body,facts,paymentChannel}' is distinct from 'api_app'
    or staged.signed_observation #>> '{body,facts,referenceMatch}' is distinct from 'matched'
    or staged.signed_observation #>> '{body,facts,receiverMatch}' is distinct from 'matched'
    or staged.signed_observation #>> '{body,facts,providerFinalStatus}'
         is distinct from 'completed'
    or staged.signed_observation #> '{body,facts,canonicalReferencePresent}'
         is distinct from 'true'::jsonb
    or staged.signed_observation #>> '{body,facts,evidenceSource}'
         is distinct from 'provider_receipt_lookup'
    or staged.signed_observation #>> '{body,facts,layoutAttestation}'
         is distinct from 'recognized_layout_v1'
    or staged.signed_observation #>> '{body,facts,occurredAt}' is null
    or new.id = source_proof.id
    or new.verification_job_id = source_proof.verification_job_id
    or new.submitting_customer_id is distinct from source_proof.submitting_customer_id
    or new.player_account_id is distinct from source_proof.player_account_id
    or new.payment_provider_id is distinct from source_proof.payment_provider_id
    or new.provider_code is distinct from source_proof.provider_code
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
    or new.submitted_at is distinct from source_proof.submitted_at
    or new.not_before is distinct from source_proof.not_before
    or new.expires_at <= pg_catalog.clock_timestamp() + interval '10 minutes'
    or new.expires_at > source_proof.submitted_at + interval '12 hours' then
    raise exception 'The TeleBirr observation-clock replacement proof is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_tbirr_shadow_clock_retry_insert_guard
before insert on app.private_telebirr_shadow_proof_requests
for each row
when (new.observation_clock_retry_source_id is not null)
execute function app.guard_private_telebirr_shadow_clock_retry_insert();

create function app.retry_private_telebirr_shadow_after_observation_clock_fix(
  p_source_shadow_proof_request_id uuid,
  p_target_pilot_revision_id uuid,
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
  existing_retry app.private_telebirr_shadow_observation_clock_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  source_attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  staged app.private_telebirr_shadow_device_evidence_staging%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  replacement_proof_id uuid;
  replacement_job_id uuid;
  retry_until timestamptz;
  retry_digest text;
  mismatch_us bigint;
begin
  if session_user <> 'postgres'
    or p_source_shadow_proof_request_id is null
    or p_target_pilot_revision_id is null
    or p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reviewed_main_commit_sha is null
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from 'observation_clock_mismatch_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The observation-clock no-credit retry request is invalid.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-observation-clock-retry:'
        || p_source_shadow_proof_request_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-observation-clock-retry-request:'
        || p_retry_request_key::text,
      0
    )
  );

  select retry.* into existing_retry
    from app.private_telebirr_shadow_observation_clock_retries retry
   where retry.retry_request_key = p_retry_request_key
      or retry.source_shadow_proof_request_id = p_source_shadow_proof_request_id
   order by (retry.retry_request_key = p_retry_request_key) desc
   limit 1
   for share;

  if existing_retry.retry_request_key is not null then
    retry_digest := app.private_telebirr_shadow_observation_clock_retry_digest(
      existing_retry.retry_request_key,
      existing_retry.source_shadow_proof_request_id,
      existing_retry.source_shadow_verification_job_id,
      existing_retry.source_outcome_id,
      existing_retry.source_verification_attempt_id,
      existing_retry.source_observation_body_digest,
      existing_retry.source_pilot_revision_id,
      existing_retry.source_receiver_profile_id,
      existing_retry.replacement_shadow_proof_request_id,
      existing_retry.replacement_shadow_verification_job_id,
      existing_retry.target_pilot_revision_id,
      existing_retry.target_receiver_profile_id,
      existing_retry.source_retrieved_at,
      existing_retry.source_observed_at,
      existing_retry.source_staged_at,
      existing_retry.mismatch_microseconds,
      existing_retry.authorized_at,
      existing_retry.retry_expires_at,
      existing_retry.reviewed_main_commit_sha,
      existing_retry.reason_code
    );
    if existing_retry.retry_request_key is distinct from p_retry_request_key
      or existing_retry.source_shadow_proof_request_id
           is distinct from p_source_shadow_proof_request_id
      or existing_retry.target_pilot_revision_id
           is distinct from p_target_pilot_revision_id
      or existing_retry.reviewed_main_commit_sha
           is distinct from p_reviewed_main_commit_sha
      or existing_retry.reason_code is distinct from p_reason_code
      or existing_retry.retry_request_digest is distinct from retry_digest then
      raise exception 'The observation-clock no-credit retry replay conflicts.';
    end if;

    return query
    select existing_retry.replacement_shadow_proof_request_id,
           existing_retry.replacement_shadow_verification_job_id,
           existing_retry.retry_expires_at,
           true;
    return;
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(p_target_pilot_revision_id);
  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select proof.* into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = p_source_shadow_proof_request_id
   for update;
  select outcome.* into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
   for share;
  select attempt.* into source_attempt
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.id = source_outcome.verification_attempt_id
   for share;
  select evidence.* into staged
    from app.private_telebirr_shadow_device_evidence_staging evidence
   where evidence.verification_attempt_id = source_attempt.id
     and evidence.observation_body_digest = source_outcome.observation_body_digest
   for share;
  select pilot.* into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = source_proof.pilot_revision_id;
  select pilot.* into target_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_target_pilot_revision_id;
  select profile.* into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = source_proof.receiver_profile_id
   for share;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.pilot_revision_id = target_pilot.id
     and profile.payment_provider_id = source_proof.payment_provider_id
     and profile.receiver_account_id = source_profile.receiver_account_id
     and profile.receiver_account_version = source_profile.receiver_account_version
   for share;

  mismatch_us := (
    extract(epoch from source_outcome.observed_at - source_outcome.retrieved_at) * 1000000
  )::bigint;

  if source_proof.id is null
    or source_proof.proof_status is distinct from 'verification_queued'
    or source_proof.source_unavailable_retry_source_id is null
    or source_proof.observation_clock_retry_source_id is not null
    or source_proof.source_live_verification_job_id is not null
    or source_proof.source_live_proof_id is not null
    or source_proof.source_pilot_revision_id is not null
    or source_proof.source_receiver_profile_id is not null
    or source_proof.submitted_at >= authorized_at
    or authorized_at >= source_proof.submitted_at + interval '12 hours'
    or source_outcome.id is null
    or source_outcome.verification_job_id is distinct from source_proof.verification_job_id
    or source_outcome.disposition is distinct from 'review_required'
    or source_outcome.reason_code is distinct from 'parser_uncertain'
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.protocol_reason_code is distinct from 'receipt_semantics_incomplete'
    or source_outcome.would_verify
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or source_attempt.id is null
    or source_attempt.shadow_proof_request_id is distinct from source_proof.id
    or source_attempt.verification_job_id is distinct from source_proof.verification_job_id
    or staged.verification_attempt_id is distinct from source_attempt.id
    or staged.observation_body_digest is distinct from source_outcome.observation_body_digest
    or source_outcome.observed_at is distinct from staged.observed_at
    or source_outcome.retrieved_at is null
    or mismatch_us not between 1 and 1000000
    or (staged.signed_observation #>> '{body,observedAt}')::timestamptz
         is distinct from staged.observed_at
    or (staged.signed_observation #>> '{body,facts,retrievedAt}')::timestamptz
         is distinct from source_outcome.retrieved_at
    or staged.signed_observation #>> '{body,facts,lookupOutcome}' is distinct from 'found'
    or staged.signed_observation #>> '{body,facts,amountMinor}' is distinct from '2500'
    or staged.signed_observation #>> '{body,facts,currencyCode}' is distinct from 'ETB'
    or staged.signed_observation #>> '{body,facts,paymentMode}' is distinct from 'telebirr'
    or staged.signed_observation #>> '{body,facts,paymentReason}'
         is distinct from 'send_money_to_registered_customer'
    or staged.signed_observation #>> '{body,facts,paymentChannel}' is distinct from 'api_app'
    or staged.signed_observation #>> '{body,facts,referenceMatch}' is distinct from 'matched'
    or staged.signed_observation #>> '{body,facts,receiverMatch}' is distinct from 'matched'
    or staged.signed_observation #>> '{body,facts,providerFinalStatus}'
         is distinct from 'completed'
    or staged.signed_observation #> '{body,facts,canonicalReferencePresent}'
         is distinct from 'true'::jsonb
    or staged.signed_observation #>> '{body,facts,evidenceSource}'
         is distinct from 'provider_receipt_lookup'
    or staged.signed_observation #>> '{body,facts,layoutAttestation}'
         is distinct from 'recognized_layout_v1'
    or staged.signed_observation #>> '{body,facts,occurredAt}' is null
    or staged.signed_observation #>> '{body,referenceFingerprint}'
         is distinct from source_proof.candidate_reference_fingerprint
    or staged.signed_observation #>> '{body,receiverProfileId}'
         is distinct from source_profile.id::text
    or staged.signed_observation #>> '{body,pilotRevisionId}'
         is distinct from source_pilot.id::text
    or staged.signed_observation #>> '{body,jobId}'
         is distinct from source_proof.verification_job_id::text
    or staged.signed_observation #>> '{body,attemptNumber}'
         is distinct from source_attempt.attempt_number::text
    or staged.signed_observation #>> '{body,facts,creditedPartyNameDigest}'
         is distinct from source_profile.expected_receiver_name_digest
    or staged.signed_observation #>> '{body,expectedReceiverNameDigest}'
         is distinct from source_profile.expected_receiver_name_digest
    or source_pilot.id is null
    or source_pilot.status is distinct from 'stopped'
    or target_pilot.id is null
    or target_pilot.status is distinct from 'armed'
    or target_pilot.active_from > authorized_at
    or target_pilot.expires_at <= authorized_at + interval '10 minutes'
    or source_profile.id is null
    or target_profile.id is null
    or target_profile.pilot_revision_id is distinct from target_pilot.id
    or target_profile.pilot_configuration_digest is distinct from target_pilot.configuration_digest
    or target_profile.valid_from > authorized_at
    or target_profile.valid_until <= authorized_at + interval '10 minutes'
    or not exists (
      select 1 from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = target_pilot.id
         and member.customer_id = source_proof.submitting_customer_id
    )
    or not exists (
      select 1 from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = target_pilot.id
         and member.player_account_id = source_proof.player_account_id
    )
    or not exists (
      select 1 from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = target_pilot.id
         and member.payment_provider_id = source_proof.payment_provider_id
         and member.receiver_account_id = source_profile.receiver_account_id
         and member.receiver_account_version = source_profile.receiver_account_version
         and member.provider_code_snapshot = 'telebirr'
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    ) then
    raise exception 'The observation-clock source proof is not safely retryable.';
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
               pg_catalog.to_jsonb(member) - array['pilot_revision_id', 'created_at']::text[]
               order by member.player_account_id
             )
        from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = source_pilot.id
    ) is distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member) - array['pilot_revision_id', 'created_at']::text[]
               order by member.player_account_id
             )
        from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = target_pilot.id
    )
    or (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member) - array['pilot_revision_id', 'created_at']::text[]
               order by member.customer_id
             )
        from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = source_pilot.id
    ) is distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member) - array['pilot_revision_id', 'created_at']::text[]
               order by member.customer_id
             )
        from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = target_pilot.id
    )
    or (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member) - array['pilot_revision_id', 'created_at']::text[]
               order by member.payment_provider_id
             )
        from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = source_pilot.id
    ) is distinct from (
      select pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(member) - array['pilot_revision_id', 'created_at']::text[]
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
    or source_profile.deposit_policy_version
         is distinct from target_profile.deposit_policy_version
    or source_profile.minimum_principal_amount_minor
         is distinct from target_profile.minimum_principal_amount_minor
    or source_profile.maximum_principal_amount_minor
         is distinct from target_profile.maximum_principal_amount_minor
    or source_profile.policy_digest is distinct from target_profile.policy_digest
    or source_profile.automatic_freshness_seconds
         is distinct from target_profile.automatic_freshness_seconds
    or source_profile.maximum_future_skew_seconds
         is distinct from target_profile.maximum_future_skew_seconds then
    raise exception 'The observation-clock retry pilot is not identical to the source pilot.';
  end if;

  retry_until := pg_catalog.date_trunc(
    'milliseconds',
    least(
      source_proof.submitted_at + interval '12 hours',
      target_pilot.expires_at,
      target_profile.valid_until
    )
  );
  if retry_until <= authorized_at + interval '10 minutes' then
    raise exception 'The observation-clock no-credit retry window is unavailable.';
  end if;

  replacement_proof_id := pg_catalog.gen_random_uuid();
  replacement_job_id := pg_catalog.gen_random_uuid();
  retry_digest := app.private_telebirr_shadow_observation_clock_retry_digest(
    p_retry_request_key,
    source_proof.id,
    source_proof.verification_job_id,
    source_outcome.id,
    source_attempt.id,
    staged.observation_body_digest,
    source_pilot.id,
    source_profile.id,
    replacement_proof_id,
    replacement_job_id,
    target_pilot.id,
    target_profile.id,
    source_outcome.retrieved_at,
    source_outcome.observed_at,
    staged.staged_at,
    mismatch_us,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_observation_clock_retry', 'on', true
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
    observation_clock_retry_source_id
  ) values (
    replacement_proof_id,
    replacement_job_id,
    target_pilot.id,
    source_proof.submitting_customer_id,
    source_proof.player_account_id,
    source_proof.payment_provider_id,
    source_proof.provider_code,
    target_profile.id,
    target_pilot.configuration_digest,
    source_proof.origin_channel,
    source_proof.input_kind,
    source_proof.candidate_reference_ciphertext,
    source_proof.candidate_reference_fingerprint,
    source_proof.candidate_reference_masked,
    source_proof.reference_encryption_key_version,
    source_proof.reference_profile_version,
    source_proof.proof_status,
    source_proof.submitted_at,
    source_proof.not_before,
    retry_until,
    source_proof.id
  );
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_observation_clock_retry', 'off', true
  );

  insert into app.private_telebirr_shadow_observation_clock_retries (
    retry_request_key,
    retry_request_digest,
    source_shadow_proof_request_id,
    source_shadow_verification_job_id,
    source_outcome_id,
    source_verification_attempt_id,
    source_observation_body_digest,
    source_pilot_revision_id,
    source_receiver_profile_id,
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id,
    target_pilot_revision_id,
    target_receiver_profile_id,
    source_retrieved_at,
    source_observed_at,
    source_staged_at,
    mismatch_microseconds,
    authorized_at,
    retry_expires_at,
    reviewed_main_commit_sha,
    reason_code
  ) values (
    p_retry_request_key,
    retry_digest,
    source_proof.id,
    source_proof.verification_job_id,
    source_outcome.id,
    source_attempt.id,
    staged.observation_body_digest,
    source_pilot.id,
    source_profile.id,
    replacement_proof_id,
    replacement_job_id,
    target_pilot.id,
    target_profile.id,
    source_outcome.retrieved_at,
    source_outcome.observed_at,
    staged.staged_at,
    mismatch_us,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  return query
  select replacement_proof_id, replacement_job_id, retry_until, false;
end;
$$;

create function app.private_telebirr_shadow_observation_clock_retry_is_valid(
  p_replacement_shadow_proof_request_id uuid,
  p_retry_request_key uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.count(*) = 1
     and pg_catalog.bool_and(
       retry.retry_request_digest =
         app.private_telebirr_shadow_observation_clock_retry_digest(
           retry.retry_request_key,
           retry.source_shadow_proof_request_id,
           retry.source_shadow_verification_job_id,
           retry.source_outcome_id,
           retry.source_verification_attempt_id,
           retry.source_observation_body_digest,
           retry.source_pilot_revision_id,
           retry.source_receiver_profile_id,
           retry.replacement_shadow_proof_request_id,
           retry.replacement_shadow_verification_job_id,
           retry.target_pilot_revision_id,
           retry.target_receiver_profile_id,
           retry.source_retrieved_at,
           retry.source_observed_at,
           retry.source_staged_at,
           retry.mismatch_microseconds,
           retry.authorized_at,
           retry.retry_expires_at,
           retry.reviewed_main_commit_sha,
           retry.reason_code
         )
       and retry.retry_request_key = p_retry_request_key
       and retry.replacement_shadow_proof_request_id = replacement.id
       and retry.replacement_shadow_verification_job_id = replacement.verification_job_id
       and retry.source_shadow_proof_request_id = source.id
       and retry.source_shadow_verification_job_id = source.verification_job_id
       and retry.source_outcome_id = source_outcome.id
       and retry.source_verification_attempt_id = source_attempt.id
       and retry.source_observation_body_digest = staged.observation_body_digest
       and retry.source_pilot_revision_id = source.pilot_revision_id
       and retry.source_receiver_profile_id = source.receiver_profile_id
       and retry.target_pilot_revision_id = replacement.pilot_revision_id
       and retry.target_receiver_profile_id = replacement.receiver_profile_id
       and retry.retry_expires_at = replacement.expires_at
       and retry.reason_code = 'observation_clock_mismatch_retry_no_credit'
       and retry.authorized_at <= pg_catalog.clock_timestamp()
       and retry.retry_expires_at > pg_catalog.clock_timestamp()
       and retry.source_retrieved_at = source_outcome.retrieved_at
       and retry.source_observed_at = source_outcome.observed_at
       and retry.source_staged_at = staged.staged_at
       and retry.mismatch_microseconds =
           (extract(epoch from retry.source_observed_at - retry.source_retrieved_at)
             * 1000000)::bigint
       and replacement.observation_clock_retry_source_id = source.id
       and replacement.source_unavailable_retry_source_id is null
       and replacement.payment_provider_id = source.payment_provider_id
       and replacement.candidate_reference_fingerprint =
           source.candidate_reference_fingerprint
       and replacement.candidate_reference_ciphertext = source.candidate_reference_ciphertext
       and replacement.proof_status = 'verification_queued'
       and source.source_unavailable_retry_source_id is not null
       and source.observation_clock_retry_source_id is null
       and source_outcome.disposition = 'review_required'
       and source_outcome.reason_code = 'parser_uncertain'
       and source_outcome.protocol_disposition = 'would_review'
       and source_outcome.protocol_reason_code = 'receipt_semantics_incomplete'
       and not source_outcome.would_verify
       and source_outcome.principal_amount_minor is null
       and source_outcome.occurred_at is null
       and source_outcome.receiver_identity_digest is null
       and source_outcome.observation_body_digest = staged.observation_body_digest
       and source_outcome.observed_at = staged.observed_at
       and source_outcome.retrieved_at < source_outcome.observed_at
       and source_outcome.observed_at - source_outcome.retrieved_at <= interval '1 second'
     )
    from app.private_telebirr_shadow_observation_clock_retries retry
    join app.private_telebirr_shadow_proof_requests source
      on source.id = retry.source_shadow_proof_request_id
     and source.verification_job_id = retry.source_shadow_verification_job_id
    join app.private_telebirr_shadow_verification_outcomes source_outcome
      on source_outcome.id = retry.source_outcome_id
     and source_outcome.shadow_proof_request_id = source.id
    join app.private_telebirr_shadow_verification_attempts source_attempt
      on source_attempt.id = retry.source_verification_attempt_id
     and source_attempt.shadow_proof_request_id = source.id
    join app.private_telebirr_shadow_device_evidence_staging staged
      on staged.verification_attempt_id = source_attempt.id
     and staged.observation_body_digest = retry.source_observation_body_digest
    join app.private_telebirr_shadow_proof_requests replacement
      on replacement.id = retry.replacement_shadow_proof_request_id
     and replacement.verification_job_id = retry.replacement_shadow_verification_job_id
   where retry.retry_request_key = p_retry_request_key
     and replacement.id = p_replacement_shadow_proof_request_id;
$$;

-- Retry proofs keep all signed observations, but the verifier must select the newest eligible
-- evidence after a phone has staged more than one attempt during a long no-money window.
do $migration$
declare
  loader_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.load_next_private_telebirr_shadow_staged_evidence()'
  );
  expected_source_sha256 constant text :=
    '9a4379d37bb62c2778def14a3606f52404ee46ac2f1d851629f0ab6abfae43ad';
  old_fragment constant text := 'proof.source_unavailable_retry_source_id is null';
  new_fragment constant text :=
    '(proof.source_unavailable_retry_source_id is null'
    || ' and proof.observation_clock_retry_source_id is null)';
  original_definition text;
  original_source text;
  corrected_definition text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
  original_source_sha256 text;
  marker_count integer;
begin
  if loader_signature is null then
    raise exception 'The TeleBirr shadow staged-evidence loader is unavailable.';
  end if;

  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into original_source,
         original_owner,
         original_acl,
         original_definition,
         original_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = loader_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);

  if original_definition is null
    or original_source is null
    or original_source_sha256 <> expected_source_sha256
    or marker_count <> 1 then
    raise exception 'The TeleBirr staged-evidence loader does not match the reviewed source.';
  end if;

  corrected_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);
  corrected_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  execute corrected_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = loader_signature
       and routine.prosrc = corrected_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.proretset
       and routine.pronargs = 0
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The TeleBirr staged-evidence loader repair changed its authority.';
  end if;
end;
$migration$;

alter table app.private_telebirr_shadow_observation_clock_retries
  enable row level security;
alter table app.private_telebirr_shadow_observation_clock_retries
  force row level security;
alter table app.private_telebirr_shadow_observation_clock_retries owner to postgres;

alter function app.private_telebirr_shadow_observation_clock_retry_digest(
  uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid,
  timestamptz, timestamptz, timestamptz, bigint, timestamptz, timestamptz, text, text
) owner to postgres;
alter function app.reject_private_telebirr_shadow_clock_retry_mutation() owner to postgres;
alter function app.guard_private_telebirr_shadow_clock_retry_insert() owner to postgres;
alter function app.retry_private_telebirr_shadow_after_observation_clock_fix(
  uuid, uuid, uuid, text, text
) owner to postgres;
alter function app.private_telebirr_shadow_observation_clock_retry_is_valid(
  uuid, uuid
) owner to postgres;

revoke all on table app.private_telebirr_shadow_observation_clock_retries
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;

revoke all on function
  app.private_telebirr_shadow_observation_clock_retry_digest(
    uuid, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid,
    timestamptz, timestamptz, timestamptz, bigint, timestamptz, timestamptz, text, text
  ),
  app.reject_private_telebirr_shadow_clock_retry_mutation(),
  app.guard_private_telebirr_shadow_clock_retry_insert(),
  app.retry_private_telebirr_shadow_after_observation_clock_fix(
    uuid, uuid, uuid, text, text
  ),
  app.private_telebirr_shadow_observation_clock_retry_is_valid(uuid, uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;

comment on column app.private_telebirr_shadow_proof_requests.observation_clock_retry_source_id is
  'Immutable terminal parser-uncertain source whose exact signed receipt facts had only the reviewed sub-second Android observation-clock defect.';
comment on table app.private_telebirr_shadow_observation_clock_retries is
  'Immutable one-use no-money lineage from an exact terminal observation-clock mismatch to one replacement request on an identical armed dry-run pilot.';
comment on function app.retry_private_telebirr_shadow_after_observation_clock_fix(
  uuid, uuid, uuid, text, text
) is
  'Postgres-only creation of one immutable no-money replacement after the exact reviewed Android retrievedAt/observedAt defect; prior evidence and outcome remain unchanged.';
comment on function app.private_telebirr_shadow_observation_clock_retry_is_valid(
  uuid, uuid
) is
  'Validates the complete immutable observation-clock retry lineage for guarded one-time production shadow verification.';
comment on function app.load_next_private_telebirr_shadow_staged_evidence() is
  'Loads FIFO evidence for ordinary no-money proofs and only the newest eligible immutable observation for source-unavailable or observation-clock retry proofs.';
comment on index app.private_tbirr_shadow_original_provider_reference_uidx is
  'Preserves global provider/reference uniqueness for original shadow intake while separately ledger-bound no-money recovery children are permitted.';

commit;
