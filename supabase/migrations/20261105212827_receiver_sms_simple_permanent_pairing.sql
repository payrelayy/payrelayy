-- Receiver SMS phones use a one-use, Owner-issued 12-character code. A paired
-- phone remains authorized until its exact enrollment is revoked. Existing
-- timed routine lookup and payment freshness windows are unchanged.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.routine_telebirr_device_pairing_challenges
  drop constraint routine_telebirr_device_pairing_challenges_check,
  add constraint routine_telebirr_device_pairing_challenges_check
    check (expires_at > issued_at);
alter table app.routine_telebirr_device_enrollments
  drop constraint routine_telebirr_device_enrollments_check,
  add constraint routine_telebirr_device_enrollments_check
    check (valid_until > valid_from);

create table app.receiver_sms_pairing_code_revocations (
  pairing_id uuid primary key references app.routine_telebirr_device_pairing_challenges(pairing_id)
    on delete restrict,
  revoked_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table app.receiver_sms_pairing_code_revocations owner to postgres;
alter table app.receiver_sms_pairing_code_revocations enable row level security;
alter table app.receiver_sms_pairing_code_revocations force row level security;
create trigger receiver_sms_pairing_code_revocations_immutable
  before update or delete on app.receiver_sms_pairing_code_revocations
  for each row execute function app.reject_deposit_ledger_delete();
create trigger receiver_sms_pairing_code_revocations_no_truncate
  before truncate on app.receiver_sms_pairing_code_revocations
  for each statement execute function app.reject_execution_ledger_truncate();
revoke all on table app.receiver_sms_pairing_code_revocations
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime;

create function app.issue_owner_receiver_sms_pairing_code(
  p_actor_auth_user_id uuid, p_code_digest text
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_actor_id uuid;
  v_receiver app.receiver_accounts%rowtype;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_pairing_id uuid := pg_catalog.gen_random_uuid();
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_actor_auth_user_id is null
    or p_code_digest is null or p_code_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'Receiver SMS pairing is unavailable.';
  end if;
  v_actor_id := app.require_routine_telebirr_owner(p_actor_auth_user_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:receiver-sms:pairing-code:' || v_actor_id::text, 0));

  select receiver.* into v_receiver from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where provider.code = 'telebirr' and provider.status = 'active'
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
      and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
      and receiver.protection_profile_version = 1
      and receiver.encryption_key_version = 1
      and receiver.fingerprint_key_version = 1
    for share of receiver, provider;
  if v_receiver.id is null then
    raise exception 'The receiver SMS account is unavailable.';
  end if;

  -- Replacing a code invalidates the earlier unused code. A consumed code
  -- remains in the audit ledger and cannot authorize a second device.
  insert into app.receiver_sms_pairing_code_revocations(pairing_id)
    select challenge.pairing_id
      from app.routine_telebirr_device_pairing_challenges challenge
      where challenge.created_by_admin_id = v_actor_id
        and challenge.expires_at = '9999-12-31 00:00:00+00'::timestamptz
        and challenge.consumed_at is null
        and not exists (select 1 from app.receiver_sms_pairing_code_revocations revoked
          where revoked.pairing_id = challenge.pairing_id)
    on conflict (pairing_id) do nothing;

  insert into app.routine_telebirr_device_pairing_challenges (
    pairing_id, issue_request_key, created_by_admin_id,
    receiver_account_id, receiver_account_version, receiver_profile_digest,
    expected_receiver_name_digest, pairing_nonce_digest, issued_at, expires_at
  ) values (
    v_pairing_id, pg_catalog.gen_random_uuid(), v_actor_id,
    v_receiver.id, v_receiver.version,
    app.routine_telebirr_receiver_profile_digest(v_receiver.id, v_receiver.version,
      v_receiver.account_reference_fingerprint, v_receiver.account_holder_name),
    app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name),
    p_code_digest, v_now, '9999-12-31 00:00:00+00'::timestamptz
  );
  return v_pairing_id;
end;
$$;

create function app.consume_receiver_sms_pairing_code(
  p_code_digest text, p_pairing_evidence_digest text,
  p_device_id text, p_device_key_id text, p_device_public_key_spki_sha256 text
)
returns table (enrollment_id uuid, already_enrolled boolean)
language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_challenge app.routine_telebirr_device_pairing_challenges%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_prior record;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_fingerprint text;
  v_actor_id uuid;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true
    or p_code_digest is null or p_code_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_pairing_evidence_digest is null
    or p_pairing_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_device_public_key_spki_sha256 is null
    or p_device_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'Receiver SMS pairing is unavailable.';
  end if;
  v_fingerprint := pg_catalog.substr(p_device_public_key_spki_sha256, 8);
  if p_device_id is distinct from 'routine_device_' || v_fingerprint
    or p_device_key_id is distinct from 'routine_key_' || v_fingerprint then
    raise exception using errcode = '42501', message = 'Receiver SMS pairing is unavailable.';
  end if;

  -- Serialize code use with Owner replacement before locking the challenge row.
  select challenge.created_by_admin_id into v_actor_id
    from app.routine_telebirr_device_pairing_challenges challenge
    where challenge.pairing_nonce_digest = p_code_digest
      and challenge.expires_at = '9999-12-31 00:00:00+00'::timestamptz;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'Receiver SMS pairing is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:receiver-sms:pairing-code:' || v_actor_id::text, 0));
  select challenge.* into v_challenge
    from app.routine_telebirr_device_pairing_challenges challenge
    where challenge.pairing_nonce_digest = p_code_digest
      and challenge.expires_at = '9999-12-31 00:00:00+00'::timestamptz
    for update;
  if v_challenge.pairing_id is null or exists (
      select 1 from app.receiver_sms_pairing_code_revocations revoked
        where revoked.pairing_id = v_challenge.pairing_id) then
    raise exception using errcode = '42501', message = 'Receiver SMS pairing is unavailable.';
  end if;
  if v_challenge.consumed_at is not null then
    select enrollment.* into v_enrollment
      from app.routine_telebirr_device_enrollments enrollment
      where enrollment.pairing_evidence_digest = p_pairing_evidence_digest
        and enrollment.device_id = p_device_id
        and enrollment.device_key_id = p_device_key_id
        and enrollment.device_public_key_spki_sha256 = p_device_public_key_spki_sha256
        and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
          where revoked.enrollment_id = enrollment.id);
    if v_enrollment.id is null
      or v_challenge.pairing_evidence_digest <> p_pairing_evidence_digest then
      raise exception using errcode = '42501', message = 'Receiver SMS pairing is unavailable.';
    end if;
    return query select v_enrollment.id, true;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:receiver-sms:device:' || p_device_id, 0));
  select receiver.* into v_receiver from app.receiver_accounts receiver
    join app.payment_providers provider on provider.id = receiver.provider_id
    where receiver.id = v_challenge.receiver_account_id
      and receiver.version = v_challenge.receiver_account_version
      and provider.code = 'telebirr' and provider.status = 'active'
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
    for share of receiver, provider;
  if v_receiver.id is null or v_challenge.receiver_profile_digest <>
      app.routine_telebirr_receiver_profile_digest(v_receiver.id, v_receiver.version,
        v_receiver.account_reference_fingerprint, v_receiver.account_holder_name)
    or v_challenge.expected_receiver_name_digest <>
      app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name) then
    raise exception using errcode = '42501', message = 'Receiver SMS pairing is unavailable.';
  end if;

  -- Keep immutable history, but make the newest phone authorization unambiguous.
  for v_prior in
    select prior.id from app.routine_telebirr_device_enrollments prior
      where prior.device_id = p_device_id and prior.device_key_id = p_device_key_id
        and prior.device_public_key_spki_sha256 = p_device_public_key_spki_sha256
        and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
          where revoked.enrollment_id = prior.id)
      for update
  loop
    insert into app.routine_telebirr_device_enrollment_revocations(enrollment_id, reason_code)
      values (v_prior.id, 'rotation');
  end loop;
  insert into app.routine_telebirr_device_enrollments (
    pairing_evidence_digest, device_id, device_key_id, device_public_key_spki_sha256,
    receiver_account_id, receiver_account_version, receiver_profile_digest,
    expected_receiver_name_digest, valid_from, valid_until
  ) values (
    p_pairing_evidence_digest, p_device_id, p_device_key_id,
    p_device_public_key_spki_sha256, v_receiver.id, v_receiver.version,
    v_challenge.receiver_profile_digest, v_challenge.expected_receiver_name_digest,
    v_now, '9999-12-31 00:00:00+00'::timestamptz
  ) returning * into v_enrollment;
  update app.routine_telebirr_device_pairing_challenges challenge
    set consumed_at = v_now, pairing_evidence_digest = p_pairing_evidence_digest
    where challenge.pairing_id = v_challenge.pairing_id;
  return query select v_enrollment.id, false;
end;
$$;

alter function app.issue_owner_receiver_sms_pairing_code(uuid,text) owner to postgres;
alter function app.consume_receiver_sms_pairing_code(text,text,text,text,text) owner to postgres;
revoke all on function app.issue_owner_receiver_sms_pairing_code(uuid,text),
  app.consume_receiver_sms_pairing_code(text,text,text,text,text)
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime;
grant execute on function app.issue_owner_receiver_sms_pairing_code(uuid,text),
  app.consume_receiver_sms_pairing_code(text,text,text,text,text)
  to fetanagent_owner_control;

comment on function app.issue_owner_receiver_sms_pairing_code(uuid,text) is
  'Creates one non-expiring, one-use code digest for the authenticated Owner. Replaces unused prior code.';
comment on function app.consume_receiver_sms_pairing_code(text,text,text,text,text) is
  'Consumes a signed phone code once and creates a revocable receiver SMS enrollment with no scheduled renewal.';

commit;
