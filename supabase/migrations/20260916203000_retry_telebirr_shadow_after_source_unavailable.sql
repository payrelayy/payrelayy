-- A terminal review_required/source_unavailable shadow outcome is honest and immutable, but a
-- transient phone-network route can later recover while the original twelve-hour no-money pilot
-- authority is still current. Preserve the original request, signed attempts, staging, quarantine,
-- and outcome byte-for-byte. This migration permits exactly one replacement shadow request with
-- the same protected reference, bound through an immutable recovery ledger. It cannot verify a
-- payment, create a claim or reservation, enqueue execution, credit KemerBet, or move money.

begin;

alter table app.private_telebirr_shadow_proof_requests
  add column source_unavailable_retry_source_id uuid;

alter table app.private_telebirr_shadow_proof_requests
  add constraint private_tbirr_shadow_proof_source_identity_key
    unique (id, payment_provider_id, candidate_reference_fingerprint),
  add constraint private_tbirr_shadow_retry_source_not_self_check check (
    source_unavailable_retry_source_id is null
    or source_unavailable_retry_source_id <> id
  ),
  add constraint private_tbirr_shadow_retry_branch_shape_check check (
    source_unavailable_retry_source_id is null
    or (
      source_live_verification_job_id is null
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
  add constraint private_tbirr_shadow_retry_source_reference_fkey
    foreign key (
      source_unavailable_retry_source_id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) references app.private_telebirr_shadow_proof_requests (
      id,
      payment_provider_id,
      candidate_reference_fingerprint
    ) on delete restrict,
  add constraint private_tbirr_shadow_retry_source_once_key
    unique (source_unavailable_retry_source_id);

do $migration$
declare
  definition text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_telebirr_shadow_proof_requests'::regclass
     and constraint_row.conname = 'private_telebirr_shadow_provider_reference_key';

  if definition is distinct from
       'UNIQUE (payment_provider_id, candidate_reference_fingerprint)' then
    raise exception 'The TeleBirr shadow provider-reference uniqueness contract is not reviewed.';
  end if;
end;
$migration$;

alter table app.private_telebirr_shadow_proof_requests
  drop constraint private_telebirr_shadow_provider_reference_key;

create unique index private_tbirr_shadow_original_provider_reference_uidx
  on app.private_telebirr_shadow_proof_requests (
    payment_provider_id,
    candidate_reference_fingerprint
  )
  where source_unavailable_retry_source_id is null;

create table app.private_telebirr_shadow_source_unavailable_retries (
  retry_request_key uuid primary key,
  retry_request_digest text not null unique
    check (retry_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_shadow_proof_request_id uuid not null unique,
  source_shadow_verification_job_id uuid not null unique,
  source_outcome_id uuid not null unique
    references app.private_telebirr_shadow_verification_outcomes (id) on delete restrict,
  replacement_shadow_proof_request_id uuid not null unique,
  replacement_shadow_verification_job_id uuid not null unique,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  authorized_at timestamptz not null,
  retry_expires_at timestamptz not null,
  reason_code text not null
    check (reason_code = 'source_unavailable_review_retry_no_credit'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_tbirr_shadow_source_retry_request_v4_check check (
    retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_tbirr_shadow_source_retry_window_check check (
    retry_expires_at > authorized_at + interval '10 minutes'
    and retry_expires_at <= authorized_at + interval '12 hours'
  ),
  constraint private_tbirr_shadow_source_retry_source_job_fkey
    foreign key (source_shadow_proof_request_id, source_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_tbirr_shadow_source_retry_replacement_job_fkey
    foreign key (replacement_shadow_proof_request_id, replacement_shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict
);

create function app.private_telebirr_shadow_source_unavailable_retry_digest(
  p_retry_request_key uuid,
  p_source_shadow_proof_request_id uuid,
  p_source_shadow_verification_job_id uuid,
  p_source_outcome_id uuid,
  p_replacement_shadow_proof_request_id uuid,
  p_replacement_shadow_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_receiver_profile_id uuid,
  p_authorized_at timestamptz,
  p_retry_expires_at timestamptz,
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
    or p_replacement_shadow_proof_request_id is null
    or p_replacement_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_receiver_profile_id is null
    or p_authorized_at is null
    or p_retry_expires_at is null
    or p_reason_code is distinct from
       'source_unavailable_review_retry_no_credit' then
    raise exception 'The TeleBirr source-unavailable retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-source-unavailable-retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|source_shadow_proof_request_id=' || p_source_shadow_proof_request_id::text
      || '|source_shadow_verification_job_id=' || p_source_shadow_verification_job_id::text
      || '|source_outcome_id=' || p_source_outcome_id::text
      || '|replacement_shadow_proof_request_id='
      || p_replacement_shadow_proof_request_id::text
      || '|replacement_shadow_verification_job_id='
      || p_replacement_shadow_verification_job_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|receiver_profile_id=' || p_receiver_profile_id::text
      || '|authorized_at_us='
      || (extract(epoch from p_authorized_at) * 1000000)::bigint::text
      || '|retry_expires_at_us='
      || (extract(epoch from p_retry_expires_at) * 1000000)::bigint::text
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.reject_private_telebirr_shadow_source_retry_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private TeleBirr source-unavailable retry lineage is immutable.';
end;
$$;

create trigger private_tbirr_shadow_source_retries_immutable
before update or delete on app.private_telebirr_shadow_source_unavailable_retries
for each row execute function app.reject_private_telebirr_shadow_source_retry_mutation();

create trigger private_tbirr_shadow_source_retries_no_truncate
before truncate on app.private_telebirr_shadow_source_unavailable_retries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.guard_private_telebirr_shadow_source_retry_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
begin
  if new.source_unavailable_retry_source_id is null then
    return new;
  end if;

  select proof.*
    into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = new.source_unavailable_retry_source_id
   for share;

  select outcome.*
    into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
   for share;

  if session_user <> 'postgres'
    or pg_catalog.current_setting(
         'app.private_telebirr_shadow_source_unavailable_retry', true
       ) is distinct from 'on'
    or source_proof.id is null
    or source_proof.source_unavailable_retry_source_id is not null
    or source_proof.source_live_verification_job_id is not null
    or source_proof.source_live_proof_id is not null
    or source_proof.source_pilot_revision_id is not null
    or source_proof.source_receiver_profile_id is not null
    or source_outcome.id is null
    or source_outcome.disposition is distinct from 'review_required'
    or source_outcome.reason_code is distinct from 'source_unavailable'
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.protocol_reason_code is distinct from 'receipt_requires_review'
    or source_outcome.would_verify
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or new.id = source_proof.id
    or new.verification_job_id = source_proof.verification_job_id
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
    or new.submitted_at is distinct from source_proof.submitted_at
    or new.not_before is distinct from source_proof.not_before
    or new.expires_at <= pg_catalog.clock_timestamp() + interval '10 minutes'
    or new.expires_at > source_proof.submitted_at + interval '12 hours' then
    raise exception 'The TeleBirr source-unavailable replacement proof is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_tbirr_shadow_source_retry_insert_guard
before insert on app.private_telebirr_shadow_proof_requests
for each row
when (new.source_unavailable_retry_source_id is not null)
execute function app.guard_private_telebirr_shadow_source_retry_insert();

create function app.retry_private_telebirr_shadow_after_source_unavailable(
  p_source_shadow_proof_request_id uuid,
  p_pilot_revision_id uuid,
  p_retry_request_key uuid,
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
  existing_retry app.private_telebirr_shadow_source_unavailable_retries%rowtype;
  source_proof app.private_telebirr_shadow_proof_requests%rowtype;
  source_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  replacement_proof_id uuid;
  replacement_job_id uuid;
  retry_until timestamptz;
  retry_digest text;
begin
  if session_user <> 'postgres'
    or p_source_shadow_proof_request_id is null
    or p_pilot_revision_id is null
    or p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from
       'source_unavailable_review_retry_no_credit' then
    raise exception 'The source-unavailable no-credit retry request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-source-unavailable-retry:'
        || p_source_shadow_proof_request_id::text,
      0
    )
  );

  select retry.*
    into existing_retry
    from app.private_telebirr_shadow_source_unavailable_retries retry
   where retry.retry_request_key = p_retry_request_key
      or retry.source_shadow_proof_request_id = p_source_shadow_proof_request_id
   order by (retry.retry_request_key = p_retry_request_key) desc
   limit 1
   for share;

  if existing_retry.retry_request_key is not null then
    retry_digest := app.private_telebirr_shadow_source_unavailable_retry_digest(
      existing_retry.retry_request_key,
      existing_retry.source_shadow_proof_request_id,
      existing_retry.source_shadow_verification_job_id,
      existing_retry.source_outcome_id,
      existing_retry.replacement_shadow_proof_request_id,
      existing_retry.replacement_shadow_verification_job_id,
      existing_retry.pilot_revision_id,
      existing_retry.receiver_profile_id,
      existing_retry.authorized_at,
      existing_retry.retry_expires_at,
      existing_retry.reason_code
    );
    if existing_retry.retry_request_key is distinct from p_retry_request_key
      or existing_retry.source_shadow_proof_request_id
           is distinct from p_source_shadow_proof_request_id
      or existing_retry.pilot_revision_id is distinct from p_pilot_revision_id
      or existing_retry.reason_code is distinct from p_reason_code
      or existing_retry.retry_request_digest is distinct from retry_digest then
      raise exception 'The source-unavailable no-credit retry replay conflicts.';
    end if;

    return query
    select existing_retry.replacement_shadow_proof_request_id,
           existing_retry.replacement_shadow_verification_job_id,
           existing_retry.retry_expires_at,
           true;
    return;
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(p_pilot_revision_id);
  authorized_at := pg_catalog.clock_timestamp();

  select proof.*
    into source_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.id = p_source_shadow_proof_request_id
   for update;
  select outcome.*
    into source_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.shadow_proof_request_id = source_proof.id
   for share;
  select candidate.*
    into pilot
    from app.private_live_deposit_pilot_revisions candidate
   where candidate.id = p_pilot_revision_id
   for share;
  select candidate.*
    into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where candidate.id = source_proof.receiver_profile_id
   for share;

  if source_proof.id is null
    or source_proof.pilot_revision_id is distinct from p_pilot_revision_id
    or source_proof.proof_status is distinct from 'verification_queued'
    or source_proof.source_unavailable_retry_source_id is not null
    or source_proof.source_live_verification_job_id is not null
    or source_proof.source_live_proof_id is not null
    or source_proof.source_pilot_revision_id is not null
    or source_proof.source_receiver_profile_id is not null
    or source_proof.submitted_at >= authorized_at
    or authorized_at >= source_proof.submitted_at + interval '12 hours'
    or not exists (
      select 1
        from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = source_proof.id
    )
    or source_outcome.id is null
    or source_outcome.verification_job_id
         is distinct from source_proof.verification_job_id
    or source_outcome.disposition is distinct from 'review_required'
    or source_outcome.reason_code is distinct from 'source_unavailable'
    or source_outcome.protocol_disposition is distinct from 'would_review'
    or source_outcome.protocol_reason_code is distinct from 'receipt_requires_review'
    or source_outcome.would_verify
    or source_outcome.principal_amount_minor is not null
    or source_outcome.occurred_at is not null
    or source_outcome.receiver_identity_digest is not null
    or pilot.id is null
    or pilot.status is distinct from 'armed'
    or pilot.configuration_digest is distinct from source_proof.pilot_configuration_digest
    or pilot.active_from > authorized_at
    or pilot.expires_at <= authorized_at + interval '10 minutes'
    or profile.id is null
    or profile.pilot_revision_id is distinct from pilot.id
    or profile.payment_provider_id is distinct from source_proof.payment_provider_id
    or profile.valid_from > authorized_at
    or profile.valid_until <= authorized_at + interval '10 minutes' then
    raise exception 'The source-unavailable shadow proof is not safely retryable.';
  end if;

  retry_until := least(
    source_proof.submitted_at + interval '12 hours',
    pilot.expires_at,
    profile.valid_until
  );
  if retry_until <= authorized_at + interval '10 minutes' then
    raise exception 'The source-unavailable no-credit retry window is unavailable.';
  end if;

  replacement_proof_id := pg_catalog.gen_random_uuid();
  replacement_job_id := pg_catalog.gen_random_uuid();
  retry_digest := app.private_telebirr_shadow_source_unavailable_retry_digest(
    p_retry_request_key,
    source_proof.id,
    source_proof.verification_job_id,
    source_outcome.id,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    authorized_at,
    retry_until,
    p_reason_code
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_source_unavailable_retry', 'on', true
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
    source_unavailable_retry_source_id
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
    source_proof.submitted_at,
    source_proof.not_before,
    retry_until,
    source_proof.id
  );
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_source_unavailable_retry', 'off', true
  );

  insert into app.private_telebirr_shadow_source_unavailable_retries (
    retry_request_key,
    retry_request_digest,
    source_shadow_proof_request_id,
    source_shadow_verification_job_id,
    source_outcome_id,
    replacement_shadow_proof_request_id,
    replacement_shadow_verification_job_id,
    pilot_revision_id,
    receiver_profile_id,
    authorized_at,
    retry_expires_at,
    reason_code
  ) values (
    p_retry_request_key,
    retry_digest,
    source_proof.id,
    source_proof.verification_job_id,
    source_outcome.id,
    replacement_proof_id,
    replacement_job_id,
    pilot.id,
    profile.id,
    authorized_at,
    retry_until,
    p_reason_code
  );

  return query
  select replacement_proof_id, replacement_job_id, retry_until, false;
end;
$$;

create function app.private_telebirr_shadow_source_unavailable_retry_is_valid(
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
         app.private_telebirr_shadow_source_unavailable_retry_digest(
           retry.retry_request_key,
           retry.source_shadow_proof_request_id,
           retry.source_shadow_verification_job_id,
           retry.source_outcome_id,
           retry.replacement_shadow_proof_request_id,
           retry.replacement_shadow_verification_job_id,
           retry.pilot_revision_id,
           retry.receiver_profile_id,
           retry.authorized_at,
           retry.retry_expires_at,
           retry.reason_code
         )
       and retry.retry_request_key = p_retry_request_key
       and retry.replacement_shadow_proof_request_id = replacement.id
       and retry.replacement_shadow_verification_job_id = replacement.verification_job_id
       and retry.source_shadow_proof_request_id = source.id
       and retry.source_shadow_verification_job_id = source.verification_job_id
       and retry.source_outcome_id = source_outcome.id
       and retry.pilot_revision_id = replacement.pilot_revision_id
       and retry.receiver_profile_id = replacement.receiver_profile_id
       and retry.retry_expires_at = replacement.expires_at
       and retry.reason_code = 'source_unavailable_review_retry_no_credit'
       and retry.authorized_at <= pg_catalog.clock_timestamp()
       and retry.retry_expires_at > pg_catalog.clock_timestamp()
       and replacement.source_unavailable_retry_source_id = source.id
       and replacement.payment_provider_id = source.payment_provider_id
       and replacement.candidate_reference_fingerprint =
           source.candidate_reference_fingerprint
       and replacement.candidate_reference_ciphertext =
           source.candidate_reference_ciphertext
       and replacement.proof_status = 'verification_queued'
       and source.source_unavailable_retry_source_id is null
       and source_outcome.disposition = 'review_required'
       and source_outcome.reason_code = 'source_unavailable'
       and source_outcome.protocol_disposition = 'would_review'
       and source_outcome.protocol_reason_code = 'receipt_requires_review'
       and not source_outcome.would_verify
       and source_outcome.principal_amount_minor is null
       and source_outcome.occurred_at is null
       and source_outcome.receiver_identity_digest is null
       and exists (
         select 1
           from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = source.id
       )
     )
    from app.private_telebirr_shadow_source_unavailable_retries retry
    join app.private_telebirr_shadow_proof_requests source
      on source.id = retry.source_shadow_proof_request_id
     and source.verification_job_id = retry.source_shadow_verification_job_id
    join app.private_telebirr_shadow_verification_outcomes source_outcome
      on source_outcome.id = retry.source_outcome_id
     and source_outcome.shadow_proof_request_id = source.id
    join app.private_telebirr_shadow_proof_requests replacement
      on replacement.id = retry.replacement_shadow_proof_request_id
     and replacement.verification_job_id = retry.replacement_shadow_verification_job_id
   where retry.retry_request_key = p_retry_request_key
     and replacement.id = p_replacement_shadow_proof_request_id;
$$;

alter table app.private_telebirr_shadow_source_unavailable_retries
  enable row level security;
alter table app.private_telebirr_shadow_source_unavailable_retries
  force row level security;

alter table app.private_telebirr_shadow_source_unavailable_retries owner to postgres;
alter function app.private_telebirr_shadow_source_unavailable_retry_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text
) owner to postgres;
alter function app.reject_private_telebirr_shadow_source_retry_mutation() owner to postgres;
alter function app.guard_private_telebirr_shadow_source_retry_insert() owner to postgres;
alter function app.retry_private_telebirr_shadow_after_source_unavailable(
  uuid, uuid, uuid, text
) owner to postgres;
alter function app.private_telebirr_shadow_source_unavailable_retry_is_valid(
  uuid, uuid
) owner to postgres;

revoke all on table app.private_telebirr_shadow_source_unavailable_retries
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
  app.private_telebirr_shadow_source_unavailable_retry_digest(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
    timestamptz, timestamptz, text
  ),
  app.reject_private_telebirr_shadow_source_retry_mutation(),
  app.guard_private_telebirr_shadow_source_retry_insert(),
  app.retry_private_telebirr_shadow_after_source_unavailable(
    uuid, uuid, uuid, text
  ),
  app.private_telebirr_shadow_source_unavailable_retry_is_valid(uuid, uuid)
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

comment on column app.private_telebirr_shadow_proof_requests.source_unavailable_retry_source_id is
  'Immutable source proof for the single no-money replacement created after a terminal source_unavailable review outcome.';

comment on table app.private_telebirr_shadow_source_unavailable_retries is
  'Immutable one-use ledger binding a terminal source_unavailable shadow outcome to one replacement request with the same protected reference. No financial authority is granted.';

comment on function app.retry_private_telebirr_shadow_after_source_unavailable(
  uuid, uuid, uuid, text
) is
  'Postgres-only, idempotent creation of one fresh no-money shadow request after an immutable source_unavailable review outcome while the same dry-run pilot remains current.';

comment on function app.private_telebirr_shadow_source_unavailable_retry_is_valid(
  uuid, uuid
) is
  'Validates the complete immutable source-unavailable retry lineage for guarded production provisioning without exposing the protected reference.';

comment on index app.private_tbirr_shadow_original_provider_reference_uidx is
  'Preserves global provider/reference uniqueness for every original shadow intake while the separately bound source-unavailable recovery permits exactly one child.';

commit;
