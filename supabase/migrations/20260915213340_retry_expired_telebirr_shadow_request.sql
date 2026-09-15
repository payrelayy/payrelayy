-- One-use retry for an expired, wholly untouched no-money TeleBirr shadow request.
--
-- The original live proof, live job, protected reference, shadow request identity, and shadow job
-- identity remain unchanged. PostgreSQL may rebind that one retained shadow request to one fresh,
-- semantically identical pilot and open one final five-minute advisory verification window. This
-- migration never enables a feature switch and never creates settlement, reservation, execution,
-- KemerBet, or money-movement authority.

begin;

alter table app.private_telebirr_shadow_proof_requests
  drop constraint private_telebirr_shadow_proof_window_check;

alter table app.private_telebirr_shadow_proof_requests
  add column retry_request_key uuid,
  add column retry_request_digest text,
  add column retry_reason_code text,
  add column retry_prior_pilot_revision_id uuid,
  add column retry_prior_receiver_profile_id uuid,
  add column retry_prior_configuration_digest text,
  add column retry_original_expires_at timestamptz,
  add column retried_at timestamptz,
  add constraint private_telebirr_shadow_retry_request_v4_check check (
    retry_request_key is null
    or retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint private_telebirr_shadow_retry_digest_check check (
    retry_request_digest is null
    or retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint private_telebirr_shadow_retry_reason_check check (
    retry_reason_code is null
    or retry_reason_code = 'expired_shadow_retry_no_credit'
  ),
  add constraint private_telebirr_shadow_retry_prior_pilot_fkey
    foreign key (retry_prior_pilot_revision_id)
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  add constraint private_telebirr_shadow_retry_prior_profile_fkey
    foreign key (retry_prior_receiver_profile_id)
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  add constraint private_telebirr_shadow_proof_window_check check (
    not_before = submitted_at
    and expires_at > not_before
    and (
      (
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
        and retry_prior_pilot_revision_id is null
        and retry_prior_receiver_profile_id is null
        and retry_prior_configuration_digest is null
        and retry_original_expires_at is null
        and retried_at is null
        and expires_at <= submitted_at + interval '5 minutes'
      )
      or (
        source_live_verification_job_id is not null
        and source_live_proof_id is not null
        and source_pilot_revision_id is not null
        and source_receiver_profile_id is not null
        and original_expires_at is not null
        and recovered_at is not null
        and recovery_request_key is not null
        and recovery_request_digest is not null
        and recovery_reason_code = 'expired_pilot_recovery_no_credit'
        and source_pilot_revision_id <> pilot_revision_id
        and original_expires_at > submitted_at
        and original_expires_at <= submitted_at + interval '5 minutes'
        and recovered_at >= original_expires_at
        and recovered_at < submitted_at + interval '24 hours'
        and (
          (
            retry_request_key is null
            and retry_request_digest is null
            and retry_reason_code is null
            and retry_prior_pilot_revision_id is null
            and retry_prior_receiver_profile_id is null
            and retry_prior_configuration_digest is null
            and retry_original_expires_at is null
            and retried_at is null
            and expires_at > recovered_at + interval '60 seconds'
            and expires_at <= recovered_at + interval '5 minutes'
          )
          or (
            retry_request_key is not null
            and retry_request_digest is not null
            and retry_reason_code = 'expired_shadow_retry_no_credit'
            and retry_prior_pilot_revision_id is not null
            and retry_prior_receiver_profile_id is not null
            and retry_prior_configuration_digest is not null
            and retry_prior_configuration_digest ~ '^sha256:[0-9a-f]{64}$'
            and retry_original_expires_at is not null
            and retried_at is not null
            and retry_prior_pilot_revision_id <> pilot_revision_id
            and retry_prior_receiver_profile_id <> receiver_profile_id
            and source_pilot_revision_id <> retry_prior_pilot_revision_id
            and retry_original_expires_at > recovered_at + interval '60 seconds'
            and retry_original_expires_at <= recovered_at + interval '5 minutes'
            and retried_at >= retry_original_expires_at
            and retried_at < submitted_at + interval '24 hours'
            and expires_at > retried_at + interval '60 seconds'
            and expires_at <= retried_at + interval '5 minutes'
          )
        )
      )
    )
  );

create unique index private_telebirr_shadow_retry_request_key_idx
  on app.private_telebirr_shadow_proof_requests (retry_request_key)
  where retry_request_key is not null;
create unique index private_telebirr_shadow_retry_request_digest_idx
  on app.private_telebirr_shadow_proof_requests (retry_request_digest)
  where retry_request_digest is not null;
create index private_telebirr_shadow_retry_prior_pilot_idx
  on app.private_telebirr_shadow_proof_requests (retry_prior_pilot_revision_id)
  where retry_prior_pilot_revision_id is not null;
create index private_telebirr_shadow_retry_prior_profile_idx
  on app.private_telebirr_shadow_proof_requests (retry_prior_receiver_profile_id)
  where retry_prior_receiver_profile_id is not null;

create function app.private_telebirr_expired_shadow_retry_digest(
  p_retry_request_key uuid,
  p_shadow_proof_request_id uuid,
  p_shadow_verification_job_id uuid,
  p_source_live_verification_job_id uuid,
  p_source_live_proof_id uuid,
  p_source_pilot_revision_id uuid,
  p_source_receiver_profile_id uuid,
  p_prior_pilot_revision_id uuid,
  p_prior_receiver_profile_id uuid,
  p_prior_configuration_digest text,
  p_target_pilot_revision_id uuid,
  p_target_receiver_profile_id uuid,
  p_target_configuration_digest text,
  p_original_shadow_expires_at timestamptz,
  p_retried_at timestamptz,
  p_retry_expires_at timestamptz,
  p_reason_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_retry_request_key is null
    or p_shadow_proof_request_id is null
    or p_shadow_verification_job_id is null
    or p_source_live_verification_job_id is null
    or p_source_live_proof_id is null
    or p_source_pilot_revision_id is null
    or p_source_receiver_profile_id is null
    or p_prior_pilot_revision_id is null
    or p_prior_receiver_profile_id is null
    or p_prior_configuration_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_target_pilot_revision_id is null
    or p_target_receiver_profile_id is null
    or p_target_configuration_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_prior_pilot_revision_id = p_target_pilot_revision_id
    or p_prior_receiver_profile_id = p_target_receiver_profile_id
    or p_original_shadow_expires_at is null
    or p_retried_at is null
    or p_retry_expires_at is null
    or p_reason_code is distinct from 'expired_shadow_retry_no_credit' then
    raise exception 'The expired-shadow retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:expired-shadow:retry:v1'
      || '|request_key=' || p_retry_request_key::text
      || '|shadow_proof_request_id=' || p_shadow_proof_request_id::text
      || '|shadow_verification_job_id=' || p_shadow_verification_job_id::text
      || '|source_live_job_id=' || p_source_live_verification_job_id::text
      || '|source_live_proof_id=' || p_source_live_proof_id::text
      || '|source_pilot_revision_id=' || p_source_pilot_revision_id::text
      || '|source_receiver_profile_id=' || p_source_receiver_profile_id::text
      || '|prior_pilot_revision_id=' || p_prior_pilot_revision_id::text
      || '|prior_receiver_profile_id=' || p_prior_receiver_profile_id::text
      || '|prior_configuration_digest=' || p_prior_configuration_digest
      || '|target_pilot_revision_id=' || p_target_pilot_revision_id::text
      || '|target_receiver_profile_id=' || p_target_receiver_profile_id::text
      || '|target_configuration_digest=' || p_target_configuration_digest
      || '|original_shadow_expires_at_us=' || (
        extract(epoch from p_original_shadow_expires_at) * 1000000
      )::bigint::text
      || '|retried_at_us=' || (
        extract(epoch from p_retried_at) * 1000000
      )::bigint::text
      || '|retry_expires_at_us=' || (
        extract(epoch from p_retry_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.enforce_private_telebirr_shadow_proof_retry_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  expected_digest text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Private TeleBirr shadow lineage is immutable.';
  end if;

  if session_user <> 'postgres'
    or pg_catalog.current_setting('app.private_telebirr_shadow_retry', true)
         is distinct from 'on'
    or old.source_live_verification_job_id is null
    or old.source_live_proof_id is null
    or old.source_pilot_revision_id is null
    or old.source_receiver_profile_id is null
    or old.original_expires_at is null
    or old.recovered_at is null
    or old.recovery_request_key is null
    or old.recovery_request_digest is null
    or old.recovery_reason_code is distinct from 'expired_pilot_recovery_no_credit'
    or old.retry_request_key is not null
    or old.retry_request_digest is not null
    or old.retry_reason_code is not null
    or old.retry_prior_pilot_revision_id is not null
    or old.retry_prior_receiver_profile_id is not null
    or old.retry_prior_configuration_digest is not null
    or old.retry_original_expires_at is not null
    or old.retried_at is not null
    or old.expires_at > pg_catalog.clock_timestamp()
    or new.retry_request_key is null
    or new.retry_request_digest is null
    or new.retry_reason_code is distinct from 'expired_shadow_retry_no_credit'
    or new.retry_prior_pilot_revision_id is distinct from old.pilot_revision_id
    or new.retry_prior_receiver_profile_id is distinct from old.receiver_profile_id
    or new.retry_prior_configuration_digest
         is distinct from old.pilot_configuration_digest
    or new.retry_original_expires_at is distinct from old.expires_at
    or new.retried_at is null
    or new.retried_at < old.expires_at
    or new.expires_at <= new.retried_at + interval '60 seconds'
    or new.expires_at > new.retried_at + interval '5 minutes'
    or new.pilot_revision_id = old.pilot_revision_id
    or new.receiver_profile_id = old.receiver_profile_id
    or (
      pg_catalog.to_jsonb(new) - array[
        'pilot_revision_id',
        'receiver_profile_id',
        'pilot_configuration_digest',
        'expires_at',
        'retry_request_key',
        'retry_request_digest',
        'retry_reason_code',
        'retry_prior_pilot_revision_id',
        'retry_prior_receiver_profile_id',
        'retry_prior_configuration_digest',
        'retry_original_expires_at',
        'retried_at'
      ]::text[]
    ) is distinct from (
      pg_catalog.to_jsonb(old) - array[
        'pilot_revision_id',
        'receiver_profile_id',
        'pilot_configuration_digest',
        'expires_at',
        'retry_request_key',
        'retry_request_digest',
        'retry_reason_code',
        'retry_prior_pilot_revision_id',
        'retry_prior_receiver_profile_id',
        'retry_prior_configuration_digest',
        'retry_original_expires_at',
        'retried_at'
      ]::text[]
    )
    or exists (
      select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = old.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = old.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = old.id
    ) then
    raise exception 'Private TeleBirr shadow lineage is immutable.';
  end if;

  expected_digest := app.private_telebirr_expired_shadow_retry_digest(
    new.retry_request_key,
    new.id,
    new.verification_job_id,
    new.source_live_verification_job_id,
    new.source_live_proof_id,
    new.source_pilot_revision_id,
    new.source_receiver_profile_id,
    new.retry_prior_pilot_revision_id,
    new.retry_prior_receiver_profile_id,
    new.retry_prior_configuration_digest,
    new.pilot_revision_id,
    new.receiver_profile_id,
    new.pilot_configuration_digest,
    new.retry_original_expires_at,
    new.retried_at,
    new.expires_at,
    new.retry_reason_code
  );

  if new.retry_request_digest is distinct from expected_digest then
    raise exception 'The expired-shadow retry digest does not match.';
  end if;

  return new;
end;
$$;

drop trigger private_telebirr_shadow_proofs_immutable
  on app.private_telebirr_shadow_proof_requests;
create trigger private_telebirr_shadow_proofs_immutable
before update or delete on app.private_telebirr_shadow_proof_requests
for each row execute function app.enforce_private_telebirr_shadow_proof_retry_only();

create function app.retry_expired_private_telebirr_shadow_request(
  p_shadow_proof_request_id uuid,
  p_source_live_verification_job_id uuid,
  p_target_pilot_revision_id uuid,
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
  seed app.private_telebirr_shadow_proof_requests%rowtype;
  shadow_request app.private_telebirr_shadow_proof_requests%rowtype;
  updated_request app.private_telebirr_shadow_proof_requests%rowtype;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  prior_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  prior_profile app.private_live_telebirr_receiver_profiles%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  locked_switch_count integer;
  retry_until timestamptz;
  retry_digest text;
  initial_recovery_digest text;
begin
  if session_user <> 'postgres'
    or p_shadow_proof_request_id is null
    or p_source_live_verification_job_id is null
    or p_target_pilot_revision_id is null
    or p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from 'expired_shadow_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The expired-shadow no-credit retry request is invalid.';
  end if;

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

  select candidate.*
    into seed
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = p_shadow_proof_request_id
      or candidate.retry_request_key = p_retry_request_key
   order by candidate.created_at, candidate.id
   limit 1;

  perform pilot_revision.id
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id in (
     seed.source_pilot_revision_id,
     seed.pilot_revision_id,
     p_target_pilot_revision_id
   )
   order by pilot_revision.id
   for share;

  select candidate.*
    into shadow_request
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = p_shadow_proof_request_id
      or candidate.retry_request_key = p_retry_request_key
   order by candidate.created_at, candidate.id
   limit 1
   for update;

  if shadow_request.id is null then
    raise exception 'The expired shadow request is unavailable.';
  end if;

  if shadow_request.retry_request_key is not null then
    retry_digest := app.private_telebirr_expired_shadow_retry_digest(
      shadow_request.retry_request_key,
      shadow_request.id,
      shadow_request.verification_job_id,
      shadow_request.source_live_verification_job_id,
      shadow_request.source_live_proof_id,
      shadow_request.source_pilot_revision_id,
      shadow_request.source_receiver_profile_id,
      shadow_request.retry_prior_pilot_revision_id,
      shadow_request.retry_prior_receiver_profile_id,
      shadow_request.retry_prior_configuration_digest,
      shadow_request.pilot_revision_id,
      shadow_request.receiver_profile_id,
      shadow_request.pilot_configuration_digest,
      shadow_request.retry_original_expires_at,
      shadow_request.retried_at,
      shadow_request.expires_at,
      shadow_request.retry_reason_code
    );

    if shadow_request.id is distinct from p_shadow_proof_request_id
      or shadow_request.source_live_verification_job_id
           is distinct from p_source_live_verification_job_id
      or shadow_request.pilot_revision_id is distinct from p_target_pilot_revision_id
      or shadow_request.retry_request_key is distinct from p_retry_request_key
      or shadow_request.retry_reason_code is distinct from p_reason_code
      or shadow_request.retry_request_digest is distinct from retry_digest then
      raise exception 'The expired-shadow no-credit retry replay conflicts.';
    end if;

    return query
    select shadow_request.id,
           shadow_request.verification_job_id,
           shadow_request.expires_at,
           true;
    return;
  end if;

  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select job.* into source_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = p_source_live_verification_job_id
   for share;
  select proof.* into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = shadow_request.source_live_proof_id
   for key share;
  select pilot.* into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = shadow_request.source_pilot_revision_id;
  select pilot.* into prior_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = shadow_request.pilot_revision_id;
  select pilot.* into target_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_target_pilot_revision_id;
  select profile.* into source_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = shadow_request.source_receiver_profile_id
   for share;
  select profile.* into prior_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = shadow_request.receiver_profile_id
   for share;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.pilot_revision_id = target_pilot.id
     and profile.payment_provider_id = shadow_request.payment_provider_id
     and profile.receiver_account_id = source_job.receiver_account_id
     and profile.receiver_account_version = source_job.receiver_account_version
   for share;

  initial_recovery_digest := app.private_telebirr_expired_pilot_shadow_recovery_digest(
    shadow_request.recovery_request_key,
    shadow_request.source_live_verification_job_id,
    shadow_request.source_live_proof_id,
    shadow_request.source_pilot_revision_id,
    shadow_request.source_receiver_profile_id,
    shadow_request.pilot_revision_id,
    shadow_request.receiver_profile_id,
    shadow_request.id,
    shadow_request.verification_job_id,
    shadow_request.original_expires_at,
    shadow_request.recovered_at,
    shadow_request.expires_at,
    shadow_request.recovery_reason_code
  );

  if locked_switch_count <> 7
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or not app.private_telebirr_shadow_mode_is_ready(target_pilot.id)
    or shadow_request.id is distinct from p_shadow_proof_request_id
    or shadow_request.source_live_verification_job_id
         is distinct from p_source_live_verification_job_id
    or shadow_request.recovery_reason_code
         is distinct from 'expired_pilot_recovery_no_credit'
    or shadow_request.recovery_request_digest is distinct from initial_recovery_digest
    or shadow_request.expires_at > authorized_at
    or source_job.id is null
    or source_proof.id is null
    or source_pilot.id is null
    or prior_pilot.id is null
    or target_pilot.id is null
    or source_profile.id is null
    or prior_profile.id is null
    or target_profile.id is null
    or source_pilot.status <> 'stopped'
    or prior_pilot.status <> 'stopped'
    or prior_pilot.expires_at > authorized_at
    or target_pilot.status <> 'armed'
    or authorized_at < target_pilot.active_from
    or target_pilot.expires_at <= authorized_at + interval '10 minutes'
    or authorized_at >= source_proof.submitted_at + interval '24 hours'
    or source_job.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or source_job.pilot_revision_id is distinct from source_pilot.id
    or source_job.receiver_profile_id is distinct from source_profile.id
    or source_job.submitting_customer_id is distinct from shadow_request.submitting_customer_id
    or source_job.player_account_id is distinct from shadow_request.player_account_id
    or source_job.payment_provider_id is distinct from shadow_request.payment_provider_id
    or source_job.candidate_reference_fingerprint
         is distinct from shadow_request.candidate_reference_fingerprint
    or source_proof.candidate_reference_ciphertext
         is distinct from shadow_request.candidate_reference_ciphertext
    or source_proof.candidate_reference_fingerprint
         is distinct from shadow_request.candidate_reference_fingerprint
    or source_proof.candidate_reference_masked
         is distinct from shadow_request.candidate_reference_masked
    or source_proof.reference_encryption_key_version
         is distinct from shadow_request.reference_encryption_key_version
    or source_proof.reference_profile_version
         is distinct from shadow_request.reference_profile_version
    or source_proof.origin_channel is distinct from shadow_request.origin_channel
    or source_proof.input_kind is distinct from shadow_request.input_kind
    or shadow_request.provider_code <> 'telebirr'
    or shadow_request.proof_status <> 'verification_queued'
    or target_profile.pilot_revision_id is distinct from target_pilot.id
    or target_profile.pilot_configuration_digest is distinct from target_pilot.configuration_digest
    or target_profile.valid_from > authorized_at
    or target_profile.valid_until <= authorized_at + interval '10 minutes'
    or not exists (
      select 1 from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = target_pilot.id
         and member.customer_id = shadow_request.submitting_customer_id
    )
    or not exists (
      select 1 from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = target_pilot.id
         and member.player_account_id = shadow_request.player_account_id
    )
    or not exists (
      select 1 from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = target_pilot.id
         and member.payment_provider_id = shadow_request.payment_provider_id
         and member.receiver_account_id = source_job.receiver_account_id
         and member.receiver_account_version = source_job.receiver_account_version
         and member.provider_code_snapshot = 'telebirr'
    )
    or exists (
      select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = shadow_request.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = shadow_request.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = shadow_request.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verification_attempts attempt
       where attempt.verification_job_id = source_job.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = source_job.id
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = source_proof.id
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint
             = source_proof.candidate_reference_fingerprint
    ) then
    raise exception 'The expired shadow request is not safely retryable without credit.';
  end if;

  -- The new target must be semantically identical to the original payment pilot. Only revision
  -- identity, lifecycle timestamps, status metadata, and derived configuration/profile digests may
  -- differ.
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
    raise exception 'The retry pilot is not identical to the original payment pilot.';
  end if;

  retry_until := least(
    authorized_at + interval '5 minutes',
    target_pilot.expires_at,
    target_profile.valid_until
  );
  if retry_until <= authorized_at + interval '60 seconds' then
    raise exception 'The expired-shadow no-credit retry window is unavailable.';
  end if;

  retry_digest := app.private_telebirr_expired_shadow_retry_digest(
    p_retry_request_key,
    shadow_request.id,
    shadow_request.verification_job_id,
    shadow_request.source_live_verification_job_id,
    shadow_request.source_live_proof_id,
    shadow_request.source_pilot_revision_id,
    shadow_request.source_receiver_profile_id,
    shadow_request.pilot_revision_id,
    shadow_request.receiver_profile_id,
    shadow_request.pilot_configuration_digest,
    target_pilot.id,
    target_profile.id,
    target_pilot.configuration_digest,
    shadow_request.expires_at,
    authorized_at,
    retry_until,
    p_reason_code
  );

  perform pg_catalog.set_config('app.private_telebirr_shadow_retry', 'on', true);
  update app.private_telebirr_shadow_proof_requests request
     set pilot_revision_id = target_pilot.id,
         receiver_profile_id = target_profile.id,
         pilot_configuration_digest = target_pilot.configuration_digest,
         expires_at = retry_until,
         retry_request_key = p_retry_request_key,
         retry_request_digest = retry_digest,
         retry_reason_code = p_reason_code,
         retry_prior_pilot_revision_id = shadow_request.pilot_revision_id,
         retry_prior_receiver_profile_id = shadow_request.receiver_profile_id,
         retry_prior_configuration_digest = shadow_request.pilot_configuration_digest,
         retry_original_expires_at = shadow_request.expires_at,
         retried_at = authorized_at
   where request.id = shadow_request.id
     and request.retry_request_key is null
  returning * into updated_request;
  perform pg_catalog.set_config('app.private_telebirr_shadow_retry', 'off', true);

  if updated_request.id is null then
    raise exception 'The expired-shadow no-credit retry changed before commit.';
  end if;

  return query
  select updated_request.id,
         updated_request.verification_job_id,
         updated_request.expires_at,
         false;
end;
$$;

alter function app.private_telebirr_expired_shadow_retry_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text,
  uuid, uuid, text, timestamptz, timestamptz, timestamptz, text
) owner to postgres;
alter function app.enforce_private_telebirr_shadow_proof_retry_only() owner to postgres;
alter function app.retry_expired_private_telebirr_shadow_request(
  uuid, uuid, uuid, uuid, text
) owner to postgres;

revoke all on function
  app.private_telebirr_expired_shadow_retry_digest(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text,
    uuid, uuid, text, timestamptz, timestamptz, timestamptz, text
  ),
  app.enforce_private_telebirr_shadow_proof_retry_only(),
  app.retry_expired_private_telebirr_shadow_request(uuid, uuid, uuid, uuid, text)
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

comment on function app.retry_expired_private_telebirr_shadow_request(
  uuid, uuid, uuid, uuid, text
) is
  'Postgres-only, exactly-once rebind of one expired and wholly untouched recovered TeleBirr shadow request to one fresh semantically identical pilot for a final five-minute advisory no-credit verification window.';
comment on function app.private_telebirr_expired_shadow_retry_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text,
  uuid, uuid, text, timestamptz, timestamptz, timestamptz, text
) is
  'Private canonical digest binding the retained shadow/live lineage, prior and target pilot/profile identities, and final bounded no-credit retry window.';
comment on function app.enforce_private_telebirr_shadow_proof_retry_only() is
  'Keeps TeleBirr shadow requests immutable except for the single fully bound postgres-only expired-shadow retry transition.';
comment on table app.private_telebirr_shadow_proof_requests is
  'Immutable no-money TeleBirr shadow requests. A recovered request may be rebound exactly once to one fresh identical pilot while retaining its original protected reference and complete lineage.';

commit;
