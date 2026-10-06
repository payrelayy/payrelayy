-- Owner-authenticated routine pairing challenge, separate from every pilot pairing table.
-- A postgres-only consumption marker is not a verified enrollment or financial authority.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_device_pairing_challenges (
  pairing_id uuid primary key,
  issue_request_key uuid not null unique,
  created_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  receiver_account_id uuid not null references app.receiver_accounts (id) on delete restrict,
  receiver_account_version integer not null check (receiver_account_version > 0),
  receiver_profile_digest text not null
    check (receiver_profile_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_receiver_name_digest text not null
    check (expected_receiver_name_digest ~ '^sha256:[0-9a-f]{64}$'),
  pairing_nonce_digest text not null unique
    check (pairing_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  pairing_evidence_digest text unique
    check (pairing_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  check ((consumed_at is null) = (pairing_evidence_digest is null)),
  check (consumed_at is null or (consumed_at >= issued_at and consumed_at < expires_at))
);
create index routine_telebirr_pairing_owner_issued_idx
  on app.routine_telebirr_device_pairing_challenges (created_by_admin_id, issued_at desc);
create index routine_telebirr_pairing_receiver_idx
  on app.routine_telebirr_device_pairing_challenges (receiver_account_id);

alter table app.routine_telebirr_device_pairing_challenges owner to postgres;
alter table app.routine_telebirr_device_pairing_challenges enable row level security;
alter table app.routine_telebirr_device_pairing_challenges force row level security;

create function app.enforce_routine_telebirr_pairing_one_use()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if old.consumed_at is not null or old.pairing_evidence_digest is not null
    or new.pairing_id is distinct from old.pairing_id
    or new.issue_request_key is distinct from old.issue_request_key
    or new.created_by_admin_id is distinct from old.created_by_admin_id
    or new.receiver_account_id is distinct from old.receiver_account_id
    or new.receiver_account_version is distinct from old.receiver_account_version
    or new.receiver_profile_digest is distinct from old.receiver_profile_digest
    or new.expected_receiver_name_digest is distinct from old.expected_receiver_name_digest
    or new.pairing_nonce_digest is distinct from old.pairing_nonce_digest
    or new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at
    or new.consumed_at is null or new.pairing_evidence_digest is null then
    raise exception 'Routine pairing challenges can only be consumed once.';
  end if;
  return new;
end;
$$;
create trigger routine_telebirr_pairing_one_use
before update on app.routine_telebirr_device_pairing_challenges
for each row execute function app.enforce_routine_telebirr_pairing_one_use();
create trigger routine_telebirr_pairing_no_delete
before delete on app.routine_telebirr_device_pairing_challenges
for each row execute function app.reject_deposit_ledger_delete();
create trigger routine_telebirr_pairing_no_truncate
before truncate on app.routine_telebirr_device_pairing_challenges
for each statement execute function app.reject_execution_ledger_truncate();

create function app.issue_owner_routine_telebirr_device_pairing_challenge(
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

  -- Serialize all Owner issues, not just retries, so the five-live-challenge limit is atomic.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:telebirr:routine:owner-pairing:v1:' || v_actor_id::text, 0));
  -- Same no-money mutex order as routine candidate and assignment issuance.
  -- These locks precede a challenge-row lock in both issuance and consumption.
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
    v_name_digest, v_nonce_digest, v_now, v_now + interval '10 minutes'
  );
  return query select v_pairing_id, v_nonce_digest, v_receiver.id, v_receiver.version,
    v_profile_digest, v_name_digest, v_now, v_now + interval '10 minutes', false;
end;
$$;

-- The future protected proof verifier may call this only after independently verifying the
-- Android P-256 signature and its exact challenge binding. This is not that verification.
create function app.consume_routine_telebirr_device_pairing_challenge(
  p_pairing_id uuid, p_pairing_evidence_digest text
)
returns table (consumed_at timestamptz, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_challenge app.routine_telebirr_device_pairing_challenges%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Routine pairing consumption is administrator-only.';
  end if;
  if p_pairing_id is null or p_pairing_evidence_digest is null
    or p_pairing_evidence_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'The routine pairing proof identity is invalid.';
  end if;
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
  select challenge.* into v_challenge from app.routine_telebirr_device_pairing_challenges challenge
    where challenge.pairing_id = p_pairing_id for update;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_challenge.pairing_id is null or v_now < v_challenge.issued_at
    or v_now >= v_challenge.expires_at then
    raise exception 'The routine pairing challenge has expired or is unavailable.';
  end if;
  perform 1 from app.admin_users owner_user
    where owner_user.id = v_challenge.created_by_admin_id
      and owner_user.role = 'owner' and owner_user.status = 'active' for share;
  if not found then raise exception 'The routine pairing Owner is unavailable.'; end if;
  select receiver.* into v_receiver from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where receiver.id = v_challenge.receiver_account_id
      and receiver.version = v_challenge.receiver_account_version
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
      and provider.code = 'telebirr' and provider.status = 'active'
    for share of receiver, provider;
  if v_receiver.id is null or v_challenge.receiver_profile_digest
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
    return query select v_challenge.consumed_at, true;
    return;
  end if;
  update app.routine_telebirr_device_pairing_challenges challenge
    set consumed_at = v_now, pairing_evidence_digest = p_pairing_evidence_digest
    where challenge.pairing_id = v_challenge.pairing_id;
  return query select v_now, false;
end;
$$;

alter function app.issue_owner_routine_telebirr_device_pairing_challenge(uuid, uuid) owner to postgres;
alter function app.consume_routine_telebirr_device_pairing_challenge(uuid, text) owner to postgres;
alter function app.enforce_routine_telebirr_pairing_one_use() owner to postgres;
revoke all on table app.routine_telebirr_device_pairing_challenges from public, anon,
  authenticated, service_role, fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_api, fetanagent_api_runtime, fetanagent_player_actions,
  fetanagent_player_actions_runtime, fetanagent_telebirr_device_state,
  fetanagent_telebirr_device_state_runtime, fetanagent_telebirr_assignment_broker,
  fetanagent_telebirr_assignment_broker_runtime, fetanagent_routine_deposit_broker,
  fetanagent_routine_deposit_broker_runtime, fetanagent_trusted_telebirr_verifier,
  fetanagent_trusted_telebirr_verifier_runtime, fetanagent_deposit_executor,
  fetanagent_deposit_executor_runtime;
revoke all on function app.issue_owner_routine_telebirr_device_pairing_challenge(uuid, uuid),
  app.consume_routine_telebirr_device_pairing_challenge(uuid, text),
  app.enforce_routine_telebirr_pairing_one_use()
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
  'Owner-issued, ten-minute routine pairing challenges. A consumed proof digest is not a device enrollment; pilot credentials and financial authority are excluded.';
comment on function app.consume_routine_telebirr_device_pairing_challenge(uuid, text) is
  'Postgres-only one-use marker for a future independent P-256 proof verifier. It performs no signature verification, enrollment, assignment, provider lookup, or financial action.';

commit;
