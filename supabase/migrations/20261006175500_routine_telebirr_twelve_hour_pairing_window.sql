-- Give the Owner time to complete a direct, one-use phone handoff. The separate
-- signed phone proof remains short-lived, and every no-money gate is unchanged.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.routine_telebirr_device_pairing_challenges
  drop constraint routine_telebirr_device_pairing_challenges_check;
alter table app.routine_telebirr_device_pairing_challenges
  add constraint routine_telebirr_device_pairing_challenges_check
    check (expires_at > issued_at and expires_at <= issued_at + interval '12 hours');

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
  if v_switch_count <> 7 or v_disabled_count <> 7 then
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

revoke all on function app.issue_owner_routine_telebirr_device_pairing_challenge(uuid, uuid)
  from public, anon, authenticated, service_role, fetanagent_owner_control,
    fetanagent_owner_control_runtime, fetanagent_api, fetanagent_api_runtime,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
grant execute on function app.issue_owner_routine_telebirr_device_pairing_challenge(uuid, uuid)
  to fetanagent_owner_control;

comment on table app.routine_telebirr_device_pairing_challenges is
  'Owner-issued, one-use routine pairing challenges valid for at most twelve hours. The separately signed phone proof remains short-lived. No pilot credential or financial authority.';
comment on function app.issue_owner_routine_telebirr_device_pairing_challenge(uuid, uuid) is
  'Owner-runtime-only twelve-hour routine challenge issuer. Requires every financial switch disabled, an active protected TeleBirr receiver, and no more than five fresh challenges per Owner.';

commit;
