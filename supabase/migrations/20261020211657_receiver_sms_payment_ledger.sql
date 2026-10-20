-- Receiver SMS facts are stored before a customer submits a reference. This
-- migration has no login, claim, job, or Player-credit grant.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create role fetanagent_receiver_sms_ingest
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;

create table app.receiver_sms_payment_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider_code text not null check (provider_code in ('telebirr', 'cbe_birr')),
  payment_provider_id uuid not null,
  receiver_account_id uuid not null,
  receiver_account_version integer not null check (receiver_account_version > 0),
  reference_digest text not null check (reference_digest ~ '^sha256:[0-9a-f]{64}$'),
  amount_minor bigint not null check (amount_minor between 1 and 9999999999),
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  observed_at timestamptz not null,
  source_message_digest text not null unique
    check (source_message_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_body_digest text not null unique
    check (event_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_subscription_id integer not null check (source_subscription_id >= -1),
  device_enrollment_id uuid not null
    references app.routine_telebirr_device_enrollments (id) on delete restrict,
  device_id text not null check (device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_key_id text not null check (device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_public_key_spki_sha256 text not null
    check (device_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (payment_provider_id, provider_code)
    references app.payment_providers (id, code) on delete restrict,
  foreign key (receiver_account_id, payment_provider_id, receiver_account_version)
    references app.receiver_accounts (id, provider_id, version) on delete restrict,
  unique (provider_code, reference_digest),
  check (occurred_at <= received_at + interval '5 minutes'
    and occurred_at >= received_at - interval '30 days'),
  check (received_at <= observed_at + interval '5 minutes'
    and received_at >= observed_at - interval '30 days')
);

create index receiver_sms_payment_events_recorded_idx
  on app.receiver_sms_payment_events (recorded_at desc, id);

create table app.receiver_sms_payment_conflicts (
  event_body_digest text primary key
    check (event_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  existing_event_id uuid not null
    references app.receiver_sms_payment_events (id) on delete restrict,
  source_message_digest text not null
    check (source_message_digest ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index receiver_sms_payment_conflicts_existing_idx
  on app.receiver_sms_payment_conflicts (existing_event_id, recorded_at desc);

create trigger receiver_sms_payment_events_immutable
before update or delete on app.receiver_sms_payment_events
for each row execute function app.reject_provider_payment_evidence_mutation();
create trigger receiver_sms_payment_conflicts_immutable
before update or delete on app.receiver_sms_payment_conflicts
for each row execute function app.reject_provider_payment_evidence_mutation();

alter table app.receiver_sms_payment_events enable row level security;
alter table app.receiver_sms_payment_events force row level security;
alter table app.receiver_sms_payment_conflicts enable row level security;
alter table app.receiver_sms_payment_conflicts force row level security;
alter table app.receiver_sms_payment_events owner to postgres;
alter table app.receiver_sms_payment_conflicts owner to postgres;
revoke all on app.receiver_sms_payment_events, app.receiver_sms_payment_conflicts
  from public, anon, authenticated, service_role;

create function app.record_receiver_sms_payment_event(
  p_provider_code text, p_reference_digest text, p_amount_minor bigint,
  p_occurred_at timestamptz, p_received_at timestamptz, p_observed_at timestamptz,
  p_source_message_digest text, p_event_body_digest text,
  p_device_id text, p_device_key_id text, p_device_public_key_spki_sha256 text,
  p_source_subscription_id integer
)
returns text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_provider app.payment_providers%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_existing app.receiver_sms_payment_events%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user not in ('postgres', 'fetanagent_receiver_sms_ingest_runtime')
    or p_provider_code is null or p_provider_code not in ('telebirr', 'cbe_birr')
    or p_reference_digest is null or p_reference_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_amount_minor is null or p_amount_minor not between 1 and 9999999999
    or p_occurred_at is null or p_received_at is null or p_observed_at is null
    or p_source_message_digest is null
    or p_source_message_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_event_body_digest is null or p_event_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_device_id is null or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id is null
    or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_public_key_spki_sha256 is null
    or p_device_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$'
    or p_source_subscription_id is null or p_source_subscription_id < -1
    or p_observed_at > v_now + interval '5 seconds'
    or p_observed_at < v_now - interval '7 days'
    or p_received_at > p_observed_at + interval '5 minutes'
    or p_received_at < p_observed_at - interval '30 days'
    or p_occurred_at > p_received_at + interval '5 minutes'
    or p_occurred_at < p_received_at - interval '30 days' then
    raise exception using errcode = '42501',
      message = 'The receiver SMS event is unavailable.';
  end if;

  -- The bridge verifies the P256 signature. Recheck its enrolled key and
  -- revocation in the database before accepting the signed fields.
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
    where enrollment.device_id = p_device_id
      and enrollment.device_key_id = p_device_key_id
      and enrollment.device_public_key_spki_sha256 = p_device_public_key_spki_sha256
      and enrollment.valid_from <= p_observed_at
      and enrollment.valid_until > p_observed_at
      and enrollment.valid_until > v_now
      and not exists (
        select 1 from app.routine_telebirr_device_enrollment_revocations revocation
          where revocation.enrollment_id = enrollment.id)
    for share;
  if v_enrollment.id is null then
    raise exception using errcode = '42501',
      message = 'The receiver SMS device is unavailable.';
  end if;

  select provider.* into v_provider from app.payment_providers provider
    where provider.code = p_provider_code and provider.status = 'active' for share;
  if v_provider.id is null then
    raise exception using errcode = '42501',
      message = 'The receiver SMS provider is unavailable.';
  end if;
  select receiver.* into v_receiver from app.receiver_accounts receiver
    where receiver.provider_id = v_provider.id and receiver.status = 'active'
      and receiver.retired_at is null and receiver.active_from <= p_occurred_at
    for share;
  if v_receiver.id is null or (p_provider_code = 'telebirr'
    and (v_enrollment.receiver_account_id <> v_receiver.id
      or v_enrollment.receiver_account_version <> v_receiver.version)) then
    raise exception using errcode = '42501',
      message = 'The receiver SMS account is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_provider_code || ':' || p_reference_digest, 20261020));
  select event.* into v_existing from app.receiver_sms_payment_events event
    where (event.provider_code = p_provider_code
       and event.reference_digest = p_reference_digest)
       or event.source_message_digest = p_source_message_digest
    order by event.recorded_at, event.id limit 1 for share;
  if v_existing.id is not null then
    if v_existing.provider_code = p_provider_code
      and v_existing.reference_digest = p_reference_digest
      and v_existing.amount_minor = p_amount_minor
      and v_existing.occurred_at = p_occurred_at
      and v_existing.source_message_digest = p_source_message_digest
      and v_existing.receiver_account_id = v_receiver.id
      and v_existing.device_enrollment_id = v_enrollment.id then
      return 'exact_replay';
    end if;
    insert into app.receiver_sms_payment_conflicts (
      event_body_digest, existing_event_id, source_message_digest
    ) values (p_event_body_digest, v_existing.id, p_source_message_digest)
    on conflict (event_body_digest) do nothing;
    return 'conflict';
  end if;
  insert into app.receiver_sms_payment_events (
    provider_code, payment_provider_id, receiver_account_id,
    receiver_account_version, reference_digest, amount_minor, occurred_at, received_at,
    observed_at, source_message_digest, event_body_digest, source_subscription_id,
    device_enrollment_id, device_id, device_key_id, device_public_key_spki_sha256
  ) values (
    p_provider_code, v_provider.id, v_receiver.id, v_receiver.version,
    p_reference_digest, p_amount_minor, p_occurred_at, p_received_at,
    p_observed_at, p_source_message_digest, p_event_body_digest, p_source_subscription_id,
    v_enrollment.id, p_device_id, p_device_key_id, p_device_public_key_spki_sha256
  );
  return 'recorded';
end;
$$;

alter function app.record_receiver_sms_payment_event(
  text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer
) owner to postgres;
revoke all on function app.record_receiver_sms_payment_event(
  text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_player_actions,
  fetanagent_player_actions_runtime, fetanagent_worker;
grant usage on schema app to fetanagent_receiver_sms_ingest;
grant execute on function app.record_receiver_sms_payment_event(
  text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer
) to fetanagent_receiver_sms_ingest;

create function app.load_receiver_sms_device_enrollment(p_device_id text)
returns table (
  device_id text, key_id text, public_key_spki_sha256 text,
  state text, valid_from timestamptz, valid_until timestamptz
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select enrollment.device_id, enrollment.device_key_id,
         enrollment.device_public_key_spki_sha256, 'active'::text,
         enrollment.valid_from, enrollment.valid_until
    from app.routine_telebirr_device_enrollments enrollment
   where enrollment.device_id = p_device_id
     and not exists (
       select 1 from app.routine_telebirr_device_enrollment_revocations revocation
        where revocation.enrollment_id = enrollment.id)
   order by enrollment.valid_from desc, enrollment.id desc
   limit 1
$$;
alter function app.load_receiver_sms_device_enrollment(text) owner to postgres;
revoke all on function app.load_receiver_sms_device_enrollment(text)
  from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_player_actions,
  fetanagent_player_actions_runtime, fetanagent_worker;
grant execute on function app.load_receiver_sms_device_enrollment(text)
  to fetanagent_receiver_sms_ingest;

comment on table app.receiver_sms_payment_events is
  'Signed paired-phone receiver SMS payment facts only. No raw SMS or reference, claim, job, or credit.';
comment on function app.record_receiver_sms_payment_event(
  text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer
) is 'Ingests a signed phone payment fact after bridge verification. Cannot match a customer or credit.';
comment on function app.load_receiver_sms_device_enrollment(text) is
  'Returns one nonsecret currently non-revoked paired-phone identity for SMS signature verification.';

commit;
