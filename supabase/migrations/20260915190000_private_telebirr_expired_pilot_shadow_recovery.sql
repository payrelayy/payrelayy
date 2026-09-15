-- One-use, no-money recovery of an untouched live TeleBirr proof after its pilot expired.
--
-- The original live proof and verification job remain immutable.  PostgreSQL may copy only the
-- already-protected reference into one short-lived shadow request for a fresh, semantically
-- identical five-Player pilot.  The existing shadow verifier can then produce an advisory
-- would-verify/reject/review outcome while every settlement, claim, execution, and KemerBet switch
-- remains disabled.  No row is recovered automatically by this migration.

begin;

alter table app.private_telebirr_shadow_proof_requests
  drop constraint private_telebirr_shadow_proof_window_check;

alter table app.private_telebirr_shadow_proof_requests
  add column source_live_verification_job_id uuid,
  add column source_live_proof_id uuid,
  add column source_pilot_revision_id uuid,
  add column source_receiver_profile_id uuid,
  add column original_expires_at timestamptz,
  add column recovered_at timestamptz,
  add column recovery_request_key uuid,
  add column recovery_request_digest text,
  add column recovery_reason_code text,
  add constraint private_telebirr_shadow_source_job_fkey
    foreign key (source_live_verification_job_id)
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  add constraint private_telebirr_shadow_source_proof_fkey
    foreign key (source_live_proof_id)
    references app.private_live_deposit_pilot_proofs (id) on delete restrict,
  add constraint private_telebirr_shadow_source_pilot_fkey
    foreign key (source_pilot_revision_id)
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  add constraint private_telebirr_shadow_source_profile_fkey
    foreign key (source_receiver_profile_id)
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  add constraint private_telebirr_shadow_recovery_request_v4_check check (
    recovery_request_key is null
    or recovery_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint private_telebirr_shadow_recovery_digest_check check (
    recovery_request_digest is null
    or recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint private_telebirr_shadow_recovery_reason_check check (
    recovery_reason_code is null
    or recovery_reason_code = 'expired_pilot_recovery_no_credit'
  ),
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
        and expires_at <= submitted_at + interval '5 minutes'
      )
      or
      (
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
        and expires_at > recovered_at + interval '60 seconds'
        and expires_at <= recovered_at + interval '5 minutes'
      )
    )
  );

create unique index private_telebirr_shadow_recovery_source_job_idx
  on app.private_telebirr_shadow_proof_requests (source_live_verification_job_id)
  where source_live_verification_job_id is not null;
create unique index private_telebirr_shadow_recovery_source_proof_idx
  on app.private_telebirr_shadow_proof_requests (source_live_proof_id)
  where source_live_proof_id is not null;
create index private_telebirr_shadow_recovery_source_pilot_idx
  on app.private_telebirr_shadow_proof_requests (source_pilot_revision_id)
  where source_pilot_revision_id is not null;
create index private_telebirr_shadow_recovery_source_profile_idx
  on app.private_telebirr_shadow_proof_requests (source_receiver_profile_id)
  where source_receiver_profile_id is not null;
create unique index private_telebirr_shadow_recovery_request_key_idx
  on app.private_telebirr_shadow_proof_requests (recovery_request_key)
  where recovery_request_key is not null;
create unique index private_telebirr_shadow_recovery_request_digest_idx
  on app.private_telebirr_shadow_proof_requests (recovery_request_digest)
  where recovery_request_digest is not null;

create function app.private_telebirr_expired_pilot_shadow_recovery_digest(
  p_recovery_request_key uuid,
  p_source_live_verification_job_id uuid,
  p_source_live_proof_id uuid,
  p_source_pilot_revision_id uuid,
  p_source_receiver_profile_id uuid,
  p_target_pilot_revision_id uuid,
  p_target_receiver_profile_id uuid,
  p_shadow_proof_request_id uuid,
  p_shadow_verification_job_id uuid,
  p_original_expires_at timestamptz,
  p_recovered_at timestamptz,
  p_recovered_expires_at timestamptz,
  p_reason_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_recovery_request_key is null
    or p_source_live_verification_job_id is null
    or p_source_live_proof_id is null
    or p_source_pilot_revision_id is null
    or p_source_receiver_profile_id is null
    or p_target_pilot_revision_id is null
    or p_target_receiver_profile_id is null
    or p_shadow_proof_request_id is null
    or p_shadow_verification_job_id is null
    or p_original_expires_at is null
    or p_recovered_at is null
    or p_recovered_expires_at is null
    or p_reason_code is distinct from 'expired_pilot_recovery_no_credit' then
    raise exception 'The expired-pilot shadow recovery digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:expired-pilot:shadow-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|source_live_job_id=' || p_source_live_verification_job_id::text
      || '|source_live_proof_id=' || p_source_live_proof_id::text
      || '|source_pilot_revision_id=' || p_source_pilot_revision_id::text
      || '|source_receiver_profile_id=' || p_source_receiver_profile_id::text
      || '|target_pilot_revision_id=' || p_target_pilot_revision_id::text
      || '|target_receiver_profile_id=' || p_target_receiver_profile_id::text
      || '|shadow_proof_request_id=' || p_shadow_proof_request_id::text
      || '|shadow_verification_job_id=' || p_shadow_verification_job_id::text
      || '|original_expires_at_us=' || (
        extract(epoch from p_original_expires_at) * 1000000
      )::bigint::text
      || '|recovered_at_us=' || (
        extract(epoch from p_recovered_at) * 1000000
      )::bigint::text
      || '|recovered_expires_at_us=' || (
        extract(epoch from p_recovered_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.recover_expired_private_live_telebirr_payment_to_shadow(
  p_source_live_verification_job_id uuid,
  p_source_pilot_revision_id uuid,
  p_target_pilot_revision_id uuid,
  p_recovery_request_key uuid,
  p_reason_code text
)
returns table (
  shadow_proof_request_id uuid,
  shadow_verification_job_id uuid,
  recovered_expires_at timestamptz,
  already_recovered boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authorized_at timestamptz;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  source_profile app.private_live_telebirr_receiver_profiles%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  existing_recovery app.private_telebirr_shadow_proof_requests%rowtype;
  inserted_recovery app.private_telebirr_shadow_proof_requests%rowtype;
  locked_switch_count integer;
  recovered_until timestamptz;
  recovery_digest text;
  new_shadow_proof_id uuid;
  new_shadow_job_id uuid;
begin
  if session_user <> 'postgres'
    or p_source_live_verification_job_id is null
    or p_source_pilot_revision_id is null
    or p_target_pilot_revision_id is null
    or p_source_pilot_revision_id = p_target_pilot_revision_id
    or p_recovery_request_key is null
    or p_recovery_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from 'expired_pilot_recovery_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The expired-pilot no-credit recovery request is invalid.';
  end if;

  -- Preserve the repository-wide authority -> switch -> pilot lock order.  No switch is changed.
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

  select pilot_revision.*
    into source_pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_source_pilot_revision_id;

  select pilot_revision.*
    into target_pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_target_pilot_revision_id;

  select verification_job.*
    into source_job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = p_source_live_verification_job_id
   for update;

  select proof.*
    into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = source_job.private_live_deposit_pilot_proof_id
   for key share;

  select receiver_profile.*
    into source_profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = source_job.receiver_profile_id
   for share;

  select receiver_profile.*
    into target_profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.pilot_revision_id = target_pilot.id
     and receiver_profile.payment_provider_id = source_job.payment_provider_id
     and receiver_profile.receiver_account_id = source_job.receiver_account_id
     and receiver_profile.receiver_account_version = source_job.receiver_account_version
   for share;

  select shadow_proof.*
    into existing_recovery
    from app.private_telebirr_shadow_proof_requests shadow_proof
   where shadow_proof.source_live_verification_job_id = p_source_live_verification_job_id
      or shadow_proof.recovery_request_key = p_recovery_request_key
   order by shadow_proof.created_at, shadow_proof.id
   limit 1
   for share;

  if existing_recovery.id is not null then
    recovery_digest := app.private_telebirr_expired_pilot_shadow_recovery_digest(
      existing_recovery.recovery_request_key,
      existing_recovery.source_live_verification_job_id,
      existing_recovery.source_live_proof_id,
      existing_recovery.source_pilot_revision_id,
      existing_recovery.source_receiver_profile_id,
      existing_recovery.pilot_revision_id,
      existing_recovery.receiver_profile_id,
      existing_recovery.id,
      existing_recovery.verification_job_id,
      existing_recovery.original_expires_at,
      existing_recovery.recovered_at,
      existing_recovery.expires_at,
      existing_recovery.recovery_reason_code
    );

    if existing_recovery.source_live_verification_job_id
         is distinct from p_source_live_verification_job_id
      or existing_recovery.source_pilot_revision_id is distinct from p_source_pilot_revision_id
      or existing_recovery.pilot_revision_id is distinct from p_target_pilot_revision_id
      or existing_recovery.recovery_request_key is distinct from p_recovery_request_key
      or existing_recovery.recovery_reason_code is distinct from p_reason_code
      or existing_recovery.recovery_request_digest is distinct from recovery_digest then
      raise exception 'The expired-pilot no-credit recovery replay conflicts.';
    end if;

    return query
    select existing_recovery.id,
           existing_recovery.verification_job_id,
           existing_recovery.expires_at,
           true;
    return;
  end if;

  if locked_switch_count <> 7
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or not app.private_telebirr_shadow_mode_is_ready(target_pilot.id)
    or source_job.id is null
    or source_proof.id is null
    or source_pilot.id is null
    or target_pilot.id is null
    or source_profile.id is null
    or target_profile.id is null
    or source_pilot.status <> 'stopped'
    or source_pilot.expires_at > authorized_at
    or target_pilot.status <> 'armed'
    or authorized_at < target_pilot.active_from
    or target_pilot.expires_at <= authorized_at + interval '10 minutes'
    or source_job.pilot_revision_id is distinct from source_pilot.id
    or source_job.pilot_configuration_digest is distinct from source_pilot.configuration_digest
    or source_job.receiver_profile_id is distinct from source_profile.id
    or source_job.recovery_request_key is not null
    or source_job.original_expires_at is not null
    or source_job.recovered_at is not null
    or source_job.expires_at > authorized_at
    or source_job.submitted_at is distinct from source_proof.submitted_at
    or source_job.not_before is distinct from source_proof.submitted_at
    or source_job.expires_at <= source_job.submitted_at
    or source_job.expires_at > source_job.submitted_at + interval '5 minutes'
    or authorized_at >= source_proof.submitted_at + interval '24 hours'
    or source_proof.pilot_revision_id is distinct from source_pilot.id
    or source_proof.origin_channel <> 'telegram'
    or source_proof.input_kind <> 'direct_transaction_id'
    or source_proof.provider_code_snapshot <> 'telebirr'
    or source_job.provider_code <> 'telebirr'
    or source_job.submitting_customer_id is distinct from source_proof.submitting_customer_id
    or source_job.player_account_id is distinct from source_proof.player_account_id
    or source_job.payment_provider_id is distinct from source_proof.payment_provider_id
    or source_job.candidate_reference_fingerprint
         is distinct from source_proof.candidate_reference_fingerprint
    or source_job.reference_encryption_key_version
         is distinct from source_proof.reference_encryption_key_version
    or source_job.reference_profile_version is distinct from source_proof.reference_profile_version
    or source_profile.pilot_revision_id is distinct from source_pilot.id
    or source_profile.payment_provider_id is distinct from source_job.payment_provider_id
    or source_profile.receiver_account_id is distinct from source_job.receiver_account_id
    or source_profile.receiver_account_version is distinct from source_job.receiver_account_version
    or source_profile.pilot_configuration_digest
         is distinct from source_job.pilot_configuration_digest
    or source_profile.receiver_profile_digest is distinct from source_job.receiver_profile_digest
    or source_profile.receiver_configuration_digest
         is distinct from source_job.receiver_configuration_digest
    or source_profile.receiver_identity_digest is distinct from source_job.receiver_identity_digest
    or source_profile.expected_receiver_name_digest
         is distinct from source_job.expected_receiver_name_digest
    or source_profile.deposit_policy_version_id
         is distinct from source_job.deposit_policy_version_id
    or source_profile.deposit_policy_version is distinct from source_job.deposit_policy_version
    or source_profile.minimum_principal_amount_minor
         is distinct from source_job.minimum_principal_amount_minor
    or source_profile.maximum_principal_amount_minor
         is distinct from source_job.maximum_principal_amount_minor
    or source_profile.policy_digest is distinct from source_job.policy_digest
    or target_profile.pilot_revision_id is distinct from target_pilot.id
    or target_profile.pilot_configuration_digest is distinct from target_pilot.configuration_digest
    or target_profile.valid_from > authorized_at
    or target_profile.valid_until <= authorized_at + interval '10 minutes'
    or not exists (
      select 1
        from app.private_live_deposit_pilot_customers customer_member
       where customer_member.pilot_revision_id = target_pilot.id
         and customer_member.customer_id = source_job.submitting_customer_id
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_players player_member
       where player_member.pilot_revision_id = target_pilot.id
         and player_member.player_account_id = source_job.player_account_id
    )
    or not exists (
      select 1
        from app.private_live_deposit_pilot_providers provider_member
       where provider_member.pilot_revision_id = target_pilot.id
         and provider_member.payment_provider_id = source_job.payment_provider_id
         and provider_member.receiver_account_id = source_job.receiver_account_id
         and provider_member.receiver_account_version = source_job.receiver_account_version
         and provider_member.provider_code_snapshot = 'telebirr'
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
    )
    or exists (
      select 1 from app.private_telebirr_shadow_proof_requests shadow_proof
       where shadow_proof.payment_provider_id = source_proof.payment_provider_id
         and shadow_proof.candidate_reference_fingerprint
             = source_proof.candidate_reference_fingerprint
    ) then
    raise exception 'The expired live TeleBirr payment is not recoverable without credit.';
  end if;

  -- Identical means the same frozen agent, limits, and full membership/provider snapshots.  Only
  -- the revision identity, timestamps, status metadata, and derived digests may differ.
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
    raise exception 'The replacement pilot is not identical to the expired payment pilot.';
  end if;

  recovered_until := pg_catalog.least(
    authorized_at + interval '5 minutes',
    target_pilot.expires_at,
    target_profile.valid_until
  );
  if recovered_until <= authorized_at + interval '60 seconds' then
    raise exception 'The no-credit recovery window is unavailable.';
  end if;

  new_shadow_proof_id := pg_catalog.gen_random_uuid();
  new_shadow_job_id := pg_catalog.gen_random_uuid();
  recovery_digest := app.private_telebirr_expired_pilot_shadow_recovery_digest(
    p_recovery_request_key,
    source_job.id,
    source_proof.id,
    source_pilot.id,
    source_profile.id,
    target_pilot.id,
    target_profile.id,
    new_shadow_proof_id,
    new_shadow_job_id,
    source_job.expires_at,
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
    new_shadow_proof_id,
    new_shadow_job_id,
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
    source_job.id,
    source_proof.id,
    source_pilot.id,
    source_profile.id,
    source_job.expires_at,
    authorized_at,
    p_recovery_request_key,
    recovery_digest,
    p_reason_code
  )
  returning * into inserted_recovery;

  return query
  select inserted_recovery.id,
         inserted_recovery.verification_job_id,
         inserted_recovery.expires_at,
         false;
end;
$$;

alter function app.private_telebirr_expired_pilot_shadow_recovery_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  timestamptz, timestamptz, timestamptz, text
) owner to postgres;
alter function app.recover_expired_private_live_telebirr_payment_to_shadow(
  uuid, uuid, uuid, uuid, text
) owner to postgres;

revoke all on function
  app.private_telebirr_expired_pilot_shadow_recovery_digest(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
    timestamptz, timestamptz, timestamptz, text
  ),
  app.recover_expired_private_live_telebirr_payment_to_shadow(
    uuid, uuid, uuid, uuid, text
  )
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

comment on function app.recover_expired_private_live_telebirr_payment_to_shadow(
  uuid, uuid, uuid, uuid, text
) is
  'Postgres-only one-use recovery of one expired and wholly untouched live TeleBirr proof into a five-minute advisory shadow request for a fresh, semantically identical pilot. It cannot settle, claim, enqueue KemerBet execution, or change a feature switch.';

comment on function app.private_telebirr_expired_pilot_shadow_recovery_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  timestamptz, timestamptz, timestamptz, text
) is
  'Private canonical digest for the exact source live lineage, replacement pilot/profile, one-use shadow request, and bounded recovery window.';

comment on table app.private_telebirr_shadow_proof_requests is
  'Immutable no-money TeleBirr shadow requests, including an optional one-use, fully bound recovery copy from an expired and wholly untouched live proof. Shadow outcomes remain advisory and cannot create settlement, claims, execution, or money movement.';

commit;
