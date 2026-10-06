-- Owner-authenticated, routine-only proof enrollment. The Owner service must verify the
-- Android P-256 signature against the independently read challenge before calling enroll.
-- No pilot trust, assignment, provider lookup, or financial authority is granted here.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.get_owner_routine_telebirr_device_pairing_challenge(
  p_actor_auth_user_id uuid, p_pairing_id uuid
)
returns table (
  pairing_id uuid, pairing_nonce_digest text,
  receiver_revision_id uuid, receiver_version integer,
  receiver_profile_digest text, expected_receiver_name_digest text,
  issued_at timestamptz, expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_actor_id uuid;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null or p_pairing_id is null then
    raise exception using errcode = '42501',
      message = 'The routine pairing proof request is invalid.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);
  return query
    select challenge.pairing_id, challenge.pairing_nonce_digest,
      challenge.receiver_account_id, challenge.receiver_account_version,
      challenge.receiver_profile_digest, challenge.expected_receiver_name_digest,
      challenge.issued_at, challenge.expires_at
    from app.routine_telebirr_device_pairing_challenges challenge
    where challenge.pairing_id = p_pairing_id
      and challenge.created_by_admin_id = v_actor_id
      and challenge.consumed_at is null
      and challenge.issued_at <= pg_catalog.clock_timestamp()
      and challenge.expires_at > pg_catalog.clock_timestamp();
end;
$$;

create function app.enroll_owner_routine_telebirr_device_pairing_proof(
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
  if v_switch_count <> 7 or v_disabled_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;

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

  -- A unique evidence digest and unique key identity prohibit re-binding another device.
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

alter function app.get_owner_routine_telebirr_device_pairing_challenge(uuid, uuid)
  owner to postgres;
alter function app.enroll_owner_routine_telebirr_device_pairing_proof(
  uuid, uuid, text, uuid, integer, text, text, text, text, text, text, timestamptz, timestamptz
) owner to postgres;
revoke all on function app.get_owner_routine_telebirr_device_pairing_challenge(uuid, uuid),
  app.enroll_owner_routine_telebirr_device_pairing_proof(
    uuid, uuid, text, uuid, integer, text, text, text, text, text, text, timestamptz, timestamptz
  ) from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
grant execute on function app.get_owner_routine_telebirr_device_pairing_challenge(uuid, uuid),
  app.enroll_owner_routine_telebirr_device_pairing_proof(
    uuid, uuid, text, uuid, integer, text, text, text, text, text, text, timestamptz, timestamptz
  ) to fetanagent_owner_control;

comment on function app.enroll_owner_routine_telebirr_device_pairing_proof(
  uuid, uuid, text, uuid, integer, text, text, text, text, text, text, timestamptz, timestamptz
) is 'Owner-runtime-only atomic routine enrollment after independent Android P-256 proof verification. Rechecks one-use challenge, receiver, expiry and no-money gates; grants no pilot, lookup, provider, or financial authority.';

commit;
