-- The phone inbox and customer submissions meet only by the existing keyed
-- reference fingerprint. Matching is inert until a separately approved cutover.
-- This migration cannot create a payment claim, execution job or Player credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.receiver_sms_route_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  cutover_at timestamptz,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (not enabled or cutover_at is not null)
);
insert into app.receiver_sms_route_control (singleton, enabled) values (true, false);
alter table app.receiver_sms_route_control enable row level security;
alter table app.receiver_sms_route_control force row level security;
alter table app.receiver_sms_route_control owner to postgres;
revoke all on app.receiver_sms_route_control from public, anon, authenticated, service_role;

create table app.receiver_sms_deposit_candidates (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  origin_inbound_event_id uuid not null unique
    references app.inbound_events (id) on delete restrict,
  origin_identity_id uuid not null
    references app.customer_identities (id) on delete restrict,
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  platform_id uuid not null references app.platforms (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  player_deposit_eligibility_decision_id uuid not null
    references app.player_deposit_eligibility_decisions (id) on delete restrict,
  payment_provider_id uuid not null,
  provider_code text not null check (provider_code in ('telebirr', 'cbe_birr')),
  reference_ciphertext text not null,
  reference_fingerprint text not null check (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  reference_masked text not null check (reference_masked ~ '^\*{3}[A-Z0-9]{4}$'),
  reference_key_version smallint not null check (reference_key_version = 2),
  reference_profile_version smallint not null check (reference_profile_version = 2),
  semantic_input_hmac text not null
    check (semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'),
  submitted_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (payment_provider_id, provider_code)
    references app.payment_providers (id, code) on delete restrict,
  foreign key (player_account_id, submitting_customer_id, platform_id)
    references app.customer_platform_players (id, customer_id, platform_id)
    on delete restrict
);
create index receiver_sms_candidates_reference_idx
  on app.receiver_sms_deposit_candidates
  (provider_code, reference_fingerprint, submitted_at, id);
create index receiver_sms_candidates_customer_idx
  on app.receiver_sms_deposit_candidates (submitting_customer_id, submitted_at desc);
create trigger receiver_sms_deposit_candidates_immutable
before update or delete on app.receiver_sms_deposit_candidates
for each row execute function app.reject_provider_payment_evidence_mutation();
alter table app.receiver_sms_deposit_candidates enable row level security;
alter table app.receiver_sms_deposit_candidates force row level security;
alter table app.receiver_sms_deposit_candidates owner to postgres;
revoke all on app.receiver_sms_deposit_candidates
  from public, anon, authenticated, service_role;

create table app.receiver_sms_payment_matches (
  candidate_id uuid primary key
    references app.receiver_sms_deposit_candidates (id) on delete restrict,
  payment_event_id uuid not null unique
    references app.receiver_sms_payment_events (id) on delete restrict,
  disposition text not null
    check (disposition in ('ready', 'older_review', 'held_review')),
  matched_at timestamptz not null default pg_catalog.clock_timestamp()
);
create trigger receiver_sms_payment_matches_immutable
before update or delete on app.receiver_sms_payment_matches
for each row execute function app.reject_provider_payment_evidence_mutation();
alter table app.receiver_sms_payment_matches enable row level security;
alter table app.receiver_sms_payment_matches force row level security;
alter table app.receiver_sms_payment_matches owner to postgres;
revoke all on app.receiver_sms_payment_matches
  from public, anon, authenticated, service_role;

create function app.match_receiver_sms_payment(
  p_provider_code text, p_reference_fingerprint text
)
returns text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_control app.receiver_sms_route_control%rowtype;
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_event app.receiver_sms_payment_events%rowtype;
  v_disposition text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_provider_code not in ('telebirr', 'cbe_birr')
    or p_reference_fingerprint is null
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501',
      message = 'Receiver SMS matching is unavailable.';
  end if;
  select * into v_control from app.receiver_sms_route_control where singleton for share;
  if v_control.enabled is distinct from true then return 'disabled'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_provider_code || ':' || p_reference_fingerprint, 20261021));
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.provider_code = p_provider_code
      and candidate.reference_fingerprint = p_reference_fingerprint
      and candidate.submitted_at >= v_control.cutover_at
    order by candidate.submitted_at, candidate.id limit 1 for share;
  select * into v_event from app.receiver_sms_payment_events event
    where event.provider_code = p_provider_code
      and event.reference_fingerprint = p_reference_fingerprint
      and event.received_at >= v_control.cutover_at
      and event.recorded_at >= v_control.cutover_at
    for share;
  if v_candidate.id is null or v_event.id is null then return 'waiting'; end if;
  if exists (select 1 from app.receiver_sms_payment_matches match
      where match.candidate_id = v_candidate.id and match.payment_event_id = v_event.id) then
    return 'matched';
  end if;
  if exists (select 1 from app.receiver_sms_payment_matches match
      where match.candidate_id = v_candidate.id or match.payment_event_id = v_event.id) then
    raise exception 'The receiver SMS match is inconsistent.';
  end if;
  if exists (select 1 from app.receiver_sms_payment_conflicts conflict
      where conflict.existing_event_id = v_event.id)
    or v_event.amount_minor not between 2500 and 2500000
    or v_event.occurred_at > v_candidate.submitted_at + interval '5 minutes'
    or v_now > v_candidate.submitted_at + interval '5 minutes' then
    v_disposition := 'held_review';
  elsif v_event.occurred_at < v_candidate.submitted_at - interval '1 hour'
    or v_now >= v_event.occurred_at + interval '1 hour' then
    v_disposition := 'older_review';
  else
    v_disposition := 'ready';
  end if;
  insert into app.receiver_sms_payment_matches
    (candidate_id, payment_event_id, disposition)
    values (v_candidate.id, v_event.id, v_disposition);
  return v_disposition;
end;
$$;
alter function app.match_receiver_sms_payment(text,text) owner to postgres;
revoke all on function app.match_receiver_sms_payment(text,text)
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime,
    fetanagent_player_actions, fetanagent_player_actions_runtime;

create function app.match_receiver_sms_payment_after_event()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform app.match_receiver_sms_payment(new.provider_code, new.reference_fingerprint);
  return new;
end;
$$;
alter function app.match_receiver_sms_payment_after_event() owner to postgres;
revoke all on function app.match_receiver_sms_payment_after_event()
  from public, anon, authenticated, service_role;
create trigger receiver_sms_match_after_event
after insert on app.receiver_sms_payment_events
for each row execute function app.match_receiver_sms_payment_after_event();

create function app.capture_telegram_receiver_sms_candidate(
  p_origin_inbound_event_id uuid, p_player_id text, p_provider_code text,
  p_reference_ciphertext text, p_reference_fingerprint text,
  p_reference_masked text, p_reference_key_version smallint,
  p_reference_profile_version smallint, p_semantic_input_hmac text
)
returns table (
  candidate_id uuid, proof_status text, submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_control app.receiver_sms_route_control%rowtype;
  v_identity app.customer_identities%rowtype;
  v_customer app.customers%rowtype;
  v_inbound app.inbound_events%rowtype;
  v_prior app.receiver_sms_deposit_candidates%rowtype;
  v_existing app.receiver_sms_deposit_candidates%rowtype;
  v_provider_id uuid;
  v_platform_id uuid;
  v_player_account_id uuid;
  v_eligibility_id uuid;
  v_resolved_provider text;
  v_player_owner uuid;
  v_player_id text;
  v_captured_at timestamptz;
  v_switch_count integer;
  v_status text;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime')
    or p_origin_inbound_event_id is null
    or p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]'
    or p_provider_code not in ('telebirr', 'cbe_birr')
    or p_reference_key_version is distinct from 2
    or p_reference_profile_version is distinct from 2
    or p_reference_ciphertext is null
    or p_reference_ciphertext !~
      ('^v2\.' || p_provider_code || '\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$')
    or p_reference_fingerprint is null
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked !~ '^\*{3}[A-Z0-9]{4}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception using errcode = '42501',
      message = 'The receiver SMS candidate is unavailable.';
  end if;
  -- The Owner stop and paid intake serialize through the same financial lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select * into v_control from app.receiver_sms_route_control where singleton for share;
  if v_control.enabled is distinct from true then
    raise exception 'The receiver SMS route is disabled.';
  end if;
  perform feature.feature_key from app.feature_switches feature
    where feature.feature_key in ('payment_verification', 'deposit_execution',
      'cbe_birr_authoritative_verification')
    order by feature.feature_key for update;
  select pg_catalog.count(*)::integer into v_switch_count
    from app.feature_switches feature
    where (feature.feature_key in ('payment_verification', 'deposit_execution')
      and feature.mode = 'live')
      or (p_provider_code = 'cbe_birr'
        and feature.feature_key = 'cbe_birr_authoritative_verification'
        and feature.mode = 'live');
  if (p_provider_code = 'cbe_birr' and v_switch_count <> 3)
    or (p_provider_code = 'telebirr' and v_switch_count <> 2) then
    raise exception 'The receiver SMS deposit route is stopped.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select * into v_inbound from app.inbound_events inbound
    where inbound.id = p_origin_inbound_event_id and inbound.channel = 'telegram'
    for update;
  if v_inbound.id is null then raise exception 'The Telegram event is unavailable.'; end if;
  select * into v_identity from app.customer_identities identity
    where identity.id = v_inbound.customer_identity_id
      and identity.identity_kind = 'telegram' and identity.status = 'active'
    for share;
  select * into v_customer from app.customers customer
    where customer.id = v_identity.customer_id and customer.status = 'active'
    for share;
  if v_identity.id is null or v_customer.id is null or not exists (
    select 1 from app.telegram_identities telegram_identity
      where telegram_identity.customer_identity_id = v_identity.id
        and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
        and v_identity.external_subject = telegram_identity.telegram_user_id::text
  ) or not exists (
    select 1 from app.bot_conversations conversation
      where conversation.telegram_identity_id = v_identity.id
  ) then
    raise exception 'The Telegram customer is unavailable.';
  end if;
  select * into v_existing from app.receiver_sms_deposit_candidates candidate
    where candidate.origin_inbound_event_id = p_origin_inbound_event_id for share;
  if v_existing.id is not null then
    select player.customer_id, player.player_id into v_player_owner, v_player_id
      from app.customer_platform_players player
      where player.id = v_existing.player_account_id;
    if v_existing.origin_identity_id is distinct from v_identity.id
      or v_existing.submitting_customer_id is distinct from v_customer.id
      or v_existing.provider_code is distinct from p_provider_code
      or v_existing.reference_fingerprint is distinct from p_reference_fingerprint
      or v_existing.reference_masked is distinct from p_reference_masked
      or v_existing.semantic_input_hmac is distinct from p_semantic_input_hmac
      or v_player_owner is distinct from v_customer.id
      or v_player_id is distinct from p_player_id then
      raise exception 'The receiver SMS candidate replay conflicts.';
    end if;
    v_status := 'pending_sms';
    if exists (select 1 from app.receiver_sms_payment_matches match
      where match.candidate_id = v_existing.id) then
      select match.disposition into v_status
        from app.receiver_sms_payment_matches match
        where match.candidate_id = v_existing.id;
    elsif exists (select 1 from app.receiver_sms_deposit_candidates prior
      where prior.provider_code = p_provider_code
        and prior.reference_fingerprint = p_reference_fingerprint
        and (prior.submitted_at, prior.id) <
          (v_existing.submitted_at, v_existing.id)) then
      v_status := 'already_used';
    end if;
    return query select v_existing.id, v_status, v_existing.submitted_at, true;
    return;
  end if;
  if v_inbound.processed_at is not null
    or exists (select 1 from app.inbound_event_consumptions consumption
      where consumption.origin_inbound_event_id = p_origin_inbound_event_id)
    or (select pg_catalog.count(*) from app.receiver_sms_deposit_candidates candidate
      where candidate.origin_identity_id = v_identity.id
        and candidate.submitted_at > pg_catalog.clock_timestamp() - interval '1 minute') >= 5 then
    raise exception 'The Telegram payment submission is unavailable.';
  end if;
  select boundary.platform_id, boundary.player_account_id,
      boundary.player_deposit_eligibility_decision_id,
      boundary.payment_provider_id, boundary.normalized_provider_code
    into v_platform_id, v_player_account_id, v_eligibility_id,
      v_provider_id, v_resolved_provider
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, p_provider_code) boundary;
  select player.customer_id into v_player_owner
    from app.customer_platform_players player
    where player.id = v_player_account_id for share;
  if v_platform_id is null or v_player_account_id is null
    or v_eligibility_id is null or v_provider_id is null
    or v_resolved_provider is distinct from p_provider_code
    or v_player_owner is distinct from v_customer.id then
    raise exception 'The payment destination is unavailable.';
  end if;
  v_captured_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_captured_at < v_control.cutover_at then
    raise exception 'The receiver SMS cutover is unavailable.';
  end if;
  insert into app.receiver_sms_deposit_candidates (
    origin_inbound_event_id, origin_identity_id, submitting_customer_id,
    platform_id, player_account_id, player_deposit_eligibility_decision_id,
    payment_provider_id, provider_code, reference_ciphertext,
    reference_fingerprint, reference_masked, reference_key_version,
    reference_profile_version, semantic_input_hmac, submitted_at
  ) values (
    p_origin_inbound_event_id, v_identity.id, v_customer.id,
    v_platform_id, v_player_account_id, v_eligibility_id,
    v_provider_id, p_provider_code, p_reference_ciphertext,
    p_reference_fingerprint, p_reference_masked, p_reference_key_version,
    p_reference_profile_version, p_semantic_input_hmac, v_captured_at
  ) returning * into v_existing;
  update app.inbound_events inbound set processed_at = v_captured_at,
      processing_error_code = null
    where inbound.id = p_origin_inbound_event_id
      and inbound.processed_at is null;
  if not found then raise exception 'The Telegram event was not consumed.'; end if;
  perform app.match_receiver_sms_payment(p_provider_code, p_reference_fingerprint);
  v_status := 'pending_sms';
  if exists (select 1 from app.receiver_sms_payment_matches match
    where match.candidate_id = v_existing.id) then
    select match.disposition into v_status
      from app.receiver_sms_payment_matches match
      where match.candidate_id = v_existing.id;
  elsif exists (select 1 from app.receiver_sms_deposit_candidates prior
    where prior.provider_code = p_provider_code
      and prior.reference_fingerprint = p_reference_fingerprint
      and (prior.submitted_at, prior.id) <
        (v_existing.submitted_at, v_existing.id)) then
    v_status := 'already_used';
  end if;
  return query select v_existing.id, v_status, v_existing.submitted_at, false;
end;
$$;
alter function app.capture_telegram_receiver_sms_candidate(
  uuid,text,text,text,text,text,smallint,smallint,text
) owner to postgres;
revoke all on function app.capture_telegram_receiver_sms_candidate(
  uuid,text,text,text,text,text,smallint,smallint,text
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime;

-- Keep this ungranted until the old production API is stopped and an exact
-- release with the matching catalog preflight is ready for cutover.

comment on table app.receiver_sms_payment_matches is
  'One first-submission SMS match per payment. Ready is only a classification, never a claim or credit.';
comment on table app.receiver_sms_route_control is
  'Default-off cutover for new SMS submissions; activation requires a separate guarded production decision.';
commit;
