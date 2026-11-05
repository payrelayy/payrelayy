-- Renew only the same recently signed receiver phone while the Owner has paused new deposits.
-- This issues no money authority and preserves historical enrollment rows and SMS events.
-- Reconciliation: keep the Owner master pause in place if renewal fails. The old receipt
-- remains in history; retry only with the same signed phone key and a fresh Owner challenge.
-- If the new enrollment must be withdrawn, use the guarded Owner revocation procedure and
-- restore the prior routine function bodies. Do not delete either enrollment or SMS history.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.routine_telebirr_device_enrollments
  drop constraint routine_telebirr_device_enrollments_device_id_device_key_id_key,
  drop constraint routine_telebirr_device_enrol_device_public_key_spki_sha256_key;
create index routine_telebirr_device_enrollments_key_history_idx
  on app.routine_telebirr_device_enrollments
  (device_id, device_key_id, device_public_key_spki_sha256, valid_until desc);
create index routine_telebirr_device_enrollments_digest_history_idx
  on app.routine_telebirr_device_enrollments
  (device_public_key_spki_sha256, valid_until desc);

create function app.receiver_sms_phone_renewal_window()
returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true then
    return false;
  end if;
  -- The Owner's master pause closes new payment instructions while existing
  -- signed SMS and credit work remain governed by their separate controls.
  perform 1 from app.owner_deposit_availability control
    where control.singleton and not control.enabled for share;
  if not found then return false; end if;
  perform 1 from app.receiver_sms_route_control control
    where control.singleton and control.enabled for share;
  if not found then return false; end if;
  if (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification') and feature.mode = 'live'
        and feature.settings = '{}'::jsonb) <> 3
    or (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in (
        'private_live_deposit_pilot', 'telebirr_authoritative_verification',
        'withdrawal_collection', 'withdrawal_validation')
        and feature.mode = 'disabled' and feature.settings = '{}'::jsonb) <> 4
    or exists (select 1 from app.deposit_jobs job
      where job.job_kind in ('execute_deposit', 'reconcile_execution')
        and job.status in ('queued', 'leased', 'retry_wait'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then
    return false;
  end if;
  return true;
end;
$$;
alter function app.receiver_sms_phone_renewal_window() owner to postgres;
revoke all on function app.receiver_sms_phone_renewal_window()
  from public, anon, authenticated, service_role, fetanagent_owner_control,
       fetanagent_owner_control_runtime;

create or replace function app.issue_owner_routine_telebirr_device_pairing_challenge(
  p_actor_auth_user_id uuid, p_issue_request_key uuid
)
returns table (
  pairing_id uuid, pairing_nonce_digest text,
  receiver_revision_id uuid, receiver_version integer,
  receiver_profile_digest text, expected_receiver_name_digest text,
  issued_at timestamptz, expires_at timestamptz, replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_existing app.routine_telebirr_device_pairing_challenges%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
  v_pairing_id uuid;
  v_nonce_digest text;
  v_profile_digest text;
  v_name_digest text;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null or p_issue_request_key is null
    or p_issue_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '42501',
      message = 'The routine Owner pairing challenge request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);

  -- Serialize all Owner issues so the five-live-challenge limit remains atomic.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:telebirr:routine:owner-pairing:v1:' || v_actor_id::text, 0));
  -- Keep the same no-money mutex order as routine candidate and assignment issuance.
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or (v_disabled_count <> 7
    and not app.receiver_sms_phone_renewal_window()) then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;

  select challenge.* into v_existing
    from app.routine_telebirr_device_pairing_challenges challenge
    where challenge.issue_request_key = p_issue_request_key for update;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  select receiver.* into v_receiver from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where provider.code = 'telebirr' and provider.status = 'active'
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
      and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
      and receiver.protection_profile_version = 1
      and receiver.encryption_key_version = 1
      and receiver.fingerprint_key_version = 1
      and receiver.account_reference_ciphertext
        ~ '^receiver-v1[.]telebirr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
    for share of receiver, provider;
  if v_receiver.id is null then
    raise exception 'The protected routine TeleBirr receiver is unavailable.';
  end if;
  v_profile_digest := app.routine_telebirr_receiver_profile_digest(
    v_receiver.id, v_receiver.version, v_receiver.account_reference_fingerprint,
    v_receiver.account_holder_name);
  v_name_digest := app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name);
  if v_existing.pairing_id is not null then
    if v_existing.created_by_admin_id <> v_actor_id
      or v_existing.consumed_at is not null
      or v_existing.expires_at <= v_now
      or v_existing.receiver_account_id <> v_receiver.id
      or v_existing.receiver_account_version <> v_receiver.version
      or v_existing.receiver_profile_digest <> v_profile_digest
      or v_existing.expected_receiver_name_digest <> v_name_digest then
      raise exception 'The routine pairing challenge is no longer available.';
    end if;
    return query select v_existing.pairing_id, v_existing.pairing_nonce_digest,
      v_existing.receiver_account_id, v_existing.receiver_account_version,
      v_existing.receiver_profile_digest, v_existing.expected_receiver_name_digest,
      v_existing.issued_at, v_existing.expires_at, true;
    return;
  end if;
  if (select pg_catalog.count(*) from app.routine_telebirr_device_pairing_challenges challenge
      where challenge.created_by_admin_id = v_actor_id and challenge.expires_at > v_now
        and challenge.consumed_at is null) >= 5 then
    raise exception 'The routine Owner pairing challenge limit is reached.';
  end if;
  v_pairing_id := pg_catalog.gen_random_uuid();
  v_nonce_digest := app.routine_telebirr_sha256_digest(pg_catalog.convert_to(
    'fetanagent:telebirr:routine:device-pairing-nonce:v1:'
      || v_pairing_id::text || ':' || pg_catalog.gen_random_uuid()::text, 'UTF8'));
  insert into app.routine_telebirr_device_pairing_challenges (
    pairing_id, issue_request_key, created_by_admin_id,
    receiver_account_id, receiver_account_version, receiver_profile_digest,
    expected_receiver_name_digest, pairing_nonce_digest, issued_at, expires_at
  ) values (
    v_pairing_id, p_issue_request_key, v_actor_id,
    v_receiver.id, v_receiver.version, v_profile_digest,
    v_name_digest, v_nonce_digest, v_now, v_now + interval '12 hours'
  );
  return query select v_pairing_id, v_nonce_digest, v_receiver.id, v_receiver.version,
    v_profile_digest, v_name_digest, v_now, v_now + interval '12 hours', false;
end;
$$;
create or replace function app.enroll_owner_routine_telebirr_device_pairing_proof(
  p_actor_auth_user_id uuid, p_pairing_id uuid, p_pairing_nonce_digest text,
  p_receiver_revision_id uuid, p_receiver_version integer,
  p_receiver_profile_digest text, p_expected_receiver_name_digest text,
  p_pairing_evidence_digest text, p_device_id text, p_device_key_id text,
  p_device_public_key_spki_sha256 text,
  p_request_issued_at timestamptz, p_request_expires_at timestamptz
)
returns table (enrollment_id uuid, valid_from timestamptz, valid_until timestamptz,
  replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_challenge app.routine_telebirr_device_pairing_challenges%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_prior app.routine_telebirr_device_enrollments%rowtype;
  v_renewal_mode boolean;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null or p_pairing_id is null
    or p_pairing_nonce_digest is null
    or p_pairing_nonce_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_receiver_revision_id is null or p_receiver_version is null
    or p_receiver_version < 1
    or p_receiver_profile_digest is null
    or p_receiver_profile_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_expected_receiver_name_digest is null
    or p_expected_receiver_name_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_pairing_evidence_digest is null
    or p_pairing_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_device_id is null
    or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id is null
    or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_public_key_spki_sha256 is null
    or p_device_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$'
    or p_request_issued_at is null or p_request_expires_at is null then
    raise exception using errcode = '42501',
      message = 'The routine pairing proof request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);

  -- Keep the same no-money lock order as issue and the postgres-only consume marker.
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or (v_disabled_count <> 7
    and not app.receiver_sms_phone_renewal_window()) then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;
  v_renewal_mode := v_disabled_count <> 7;

  select challenge.* into v_challenge
    from app.routine_telebirr_device_pairing_challenges challenge
    where challenge.pairing_id = p_pairing_id for update;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_challenge.pairing_id is null
    or v_challenge.created_by_admin_id <> v_actor_id
    or v_now < v_challenge.issued_at or v_now >= v_challenge.expires_at
    or p_request_issued_at < v_challenge.issued_at
    or p_request_expires_at <= p_request_issued_at
    or p_request_expires_at > p_request_issued_at + interval '5 minutes'
    or p_request_expires_at > v_challenge.expires_at
    or v_now < p_request_issued_at or v_now >= p_request_expires_at
    or v_challenge.pairing_nonce_digest <> p_pairing_nonce_digest
    or v_challenge.receiver_account_id <> p_receiver_revision_id
    or v_challenge.receiver_account_version <> p_receiver_version
    or v_challenge.receiver_profile_digest <> p_receiver_profile_digest
    or v_challenge.expected_receiver_name_digest <> p_expected_receiver_name_digest then
    raise exception 'The routine pairing challenge has expired or changed.';
  end if;
  select receiver.* into v_receiver from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where receiver.id = v_challenge.receiver_account_id
      and receiver.version = v_challenge.receiver_account_version
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
      and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
      and receiver.protection_profile_version = 1
      and receiver.encryption_key_version = 1
      and receiver.fingerprint_key_version = 1
      and provider.code = 'telebirr' and provider.status = 'active'
    for share of receiver, provider;
  if v_receiver.id is null
    or v_challenge.receiver_profile_digest
      <> app.routine_telebirr_receiver_profile_digest(v_receiver.id, v_receiver.version,
        v_receiver.account_reference_fingerprint, v_receiver.account_holder_name)
    or v_challenge.expected_receiver_name_digest
      <> app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name) then
    raise exception 'The routine pairing receiver has rotated.';
  end if;

  if v_challenge.consumed_at is not null then
    if v_challenge.pairing_evidence_digest <> p_pairing_evidence_digest then
      raise exception 'The routine pairing challenge was already consumed.';
    end if;
    select enrollment.* into v_enrollment
      from app.routine_telebirr_device_enrollments enrollment
      where enrollment.pairing_evidence_digest = p_pairing_evidence_digest;
    if v_enrollment.id is null or v_enrollment.device_id <> p_device_id
      or v_enrollment.device_key_id <> p_device_key_id
      or v_enrollment.device_public_key_spki_sha256 <> p_device_public_key_spki_sha256
      or exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
        where revocation.enrollment_id = v_enrollment.id) then
      raise exception 'The routine pairing enrollment is unavailable.';
    end if;
    return query select v_enrollment.id, v_enrollment.valid_from,
      v_enrollment.valid_until, true;
    return;
  end if;

  -- Serialize renewal of one physical key and retain its historical enrollment row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:receiver-sms:phone-renewal:v1:' || p_device_id, 0));
  select prior.* into v_prior
    from app.routine_telebirr_device_enrollments prior
    where prior.device_id = p_device_id
       or prior.device_public_key_spki_sha256 = p_device_public_key_spki_sha256
    order by prior.valid_until desc, prior.id desc limit 1 for update of prior;
  if v_prior.id is not null then
    if v_prior.device_id <> p_device_id
      or v_prior.device_key_id <> p_device_key_id
      or v_prior.device_public_key_spki_sha256 <> p_device_public_key_spki_sha256
      or v_prior.valid_until > v_now
      or exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
        where revoked.enrollment_id = v_prior.id)
      or not exists (select 1 from app.routine_telebirr_device_pairing_challenges prior_challenge
        where prior_challenge.pairing_evidence_digest = v_prior.pairing_evidence_digest
          and prior_challenge.created_by_admin_id = v_actor_id
          and prior_challenge.consumed_at is not null) then
      raise exception 'The routine phone key is not eligible for renewal.';
    end if;
  end if;
  if v_renewal_mode and (v_prior.id is null
    or v_prior.valid_until < v_now - interval '24 hours'
    or not exists (select 1 from app.receiver_sms_device_status status
      where status.enrollment_id = v_prior.id and status.state = 'ready'
        and status.received_at >= v_prior.valid_until - interval '24 hours'
        and status.received_at <= v_prior.valid_until)) then
    raise exception 'A recently signed, expired receiver phone is required.';
  end if;
  insert into app.routine_telebirr_device_enrollments (
    pairing_evidence_digest, device_id, device_key_id, device_public_key_spki_sha256,
    receiver_account_id, receiver_account_version, receiver_profile_digest,
    expected_receiver_name_digest, valid_from, valid_until
  ) values (
    p_pairing_evidence_digest, p_device_id, p_device_key_id, p_device_public_key_spki_sha256,
    v_receiver.id, v_receiver.version, v_challenge.receiver_profile_digest,
    v_challenge.expected_receiver_name_digest, v_now, v_now + interval '30 days'
  ) returning * into v_enrollment;
  update app.routine_telebirr_device_pairing_challenges challenge
    set consumed_at = v_now, pairing_evidence_digest = p_pairing_evidence_digest
    where challenge.pairing_id = v_challenge.pairing_id;
  return query select v_enrollment.id, v_enrollment.valid_from,
    v_enrollment.valid_until, false;
end;
$$;
create or replace function app.get_owner_routine_telebirr_enrollment_receipt_material_exact(
  p_actor_auth_user_id uuid, p_enrollment_id uuid, p_signer_key_id text, p_signer_public_key_spki_sha256 text
)
returns table (
  enrollment_id uuid, pairing_evidence_digest text, device_id text,
  device_key_id text, device_public_key_spki_sha256 text,
  receiver_revision_id uuid, receiver_version integer,
  receiver_profile_digest text, expected_receiver_name_digest text,
  valid_from timestamptz, valid_until timestamptz, issued_at timestamptz,
  signer_valid_from timestamptz, signer_valid_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_signer app.routine_telebirr_enrollment_receipt_signers%rowtype;
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null or p_enrollment_id is null
    or p_signer_key_id is null
    or p_signer_key_id !~ '^telebirr-routine-enrollment-(staging|production)-v[1-9][0-9]*$'
    or p_signer_public_key_spki_sha256 is null
    or p_signer_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'The routine receipt request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);

  -- Match pairing's no-money lock order so a concurrent switch change cannot race this read.
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or (v_disabled_count <> 7
    and not app.receiver_sms_phone_renewal_window()) then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select signer.* into v_signer from app.routine_telebirr_enrollment_receipt_signers signer
    where signer.signer_key_id = p_signer_key_id
      and signer.public_key_spki_sha256 = p_signer_public_key_spki_sha256
      and signer.valid_from <= v_now and signer.valid_until > v_now
      and not exists (
        select 1 from app.routine_telebirr_enrollment_receipt_signer_revocations revocation
          where revocation.signer_id = signer.id)
    for share of signer;
  if v_signer.id is null then raise exception 'The routine receipt signer is unavailable.'; end if;

  select enrollment.* into strict v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
    join app.routine_telebirr_device_pairing_challenges challenge
      on challenge.pairing_evidence_digest = enrollment.pairing_evidence_digest
    where enrollment.id = p_enrollment_id and challenge.created_by_admin_id = v_actor_id and challenge.consumed_at is not null
      and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
      and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
        where revocation.enrollment_id = enrollment.id)
    for share of enrollment, challenge;
  -- The exact enrollment ID permits a second Owner-linked phone without exposing another enrollment.

  select receiver.* into v_receiver from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where receiver.id = v_enrollment.receiver_account_id
      and receiver.version = v_enrollment.receiver_account_version
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
      and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
      and receiver.protection_profile_version = 1
      and receiver.encryption_key_version = 1
      and receiver.fingerprint_key_version = 1
      and provider.code = 'telebirr' and provider.status = 'active'
    for share of receiver, provider;
  if v_receiver.id is null
    or v_enrollment.receiver_profile_digest
      <> app.routine_telebirr_receiver_profile_digest(v_receiver.id, v_receiver.version,
        v_receiver.account_reference_fingerprint, v_receiver.account_holder_name)
    or v_enrollment.expected_receiver_name_digest
      <> app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name) then
    raise exception 'The routine pairing receiver has rotated.';
  end if;

  return query select v_enrollment.id, v_enrollment.pairing_evidence_digest,
    v_enrollment.device_id, v_enrollment.device_key_id,
    v_enrollment.device_public_key_spki_sha256,
    v_enrollment.receiver_account_id, v_enrollment.receiver_account_version,
    v_enrollment.receiver_profile_digest, v_enrollment.expected_receiver_name_digest,
    v_enrollment.valid_from,
    least(v_enrollment.valid_until, v_signer.valid_until),
    v_now, v_signer.valid_from, v_signer.valid_until;
end;
$$;
comment on function app.receiver_sms_phone_renewal_window() is
  'Owner-runtime-only maintenance window: master deposits paused, receiver SMS route live, exact financial profile, and no unresolved execution work. Grants no money authority.';
comment on function app.issue_owner_routine_telebirr_device_pairing_challenge(uuid,uuid) is
  'Owner-only routine challenge while every money switch is off, or during a paused, idle receiver SMS phone renewal window.';
comment on function app.enroll_owner_routine_telebirr_device_pairing_proof(uuid,uuid,text,uuid,integer,text,text,text,text,text,text,timestamptz,timestamptz) is
  'Owner-only signed phone proof enrollment. A live SMS renewal requires the same recently signed expired key; historical enrollments are retained.';
commit;
