-- An Owner's ordinary all-method pause closes new payment instructions. It does
-- not stop signed SMS ingestion, reconciliation, or already accepted credit work.
-- The guarded financial execution switches remain an independent emergency gate.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table app.owner_deposit_availability (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  changed_by_admin_id uuid references app.admin_users(id) on delete restrict
);
insert into app.owner_deposit_availability(singleton, enabled) values (true, true);
alter table app.owner_deposit_availability owner to postgres;
alter table app.owner_deposit_availability enable row level security;
alter table app.owner_deposit_availability force row level security;
revoke all on app.owner_deposit_availability from public, anon, authenticated, service_role;

create table app.owner_deposit_availability_requests (
  request_id uuid primary key,
  requested_enabled boolean not null,
  actor_admin_id uuid not null references app.admin_users(id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table app.owner_deposit_availability_requests owner to postgres;
alter table app.owner_deposit_availability_requests enable row level security;
alter table app.owner_deposit_availability_requests force row level security;
revoke all on app.owner_deposit_availability_requests
  from public, anon, authenticated, service_role;

create function app.require_owner_deposit_availability()
returns void language plpgsql security definer set search_path = pg_catalog
as $$
begin
  perform 1 from app.owner_deposit_availability control
    where control.singleton and control.enabled for share;
  if not found then
    raise exception 'Deposits are paused by the Owner.';
  end if;
end;
$$;
alter function app.require_owner_deposit_availability() owner to postgres;
revoke all on function app.require_owner_deposit_availability()
  from public, anon, authenticated, service_role;

create function app.get_owner_deposit_availability(p_actor_auth_user_id uuid)
returns table(enabled boolean, changed_at timestamptz)
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if session_user not in ('postgres', 'fetanagent_owner_control_runtime')
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query select control.enabled, control.changed_at
    from app.owner_deposit_availability control where control.singleton;
end;
$$;
alter function app.get_owner_deposit_availability(uuid) owner to postgres;
revoke all on function app.get_owner_deposit_availability(uuid)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.get_owner_deposit_availability(uuid)
  to fetanagent_owner_control;

create function app.set_owner_deposit_availability(
  p_actor_auth_user_id uuid, p_request_id uuid, p_enabled boolean
) returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_previous boolean;
  v_existing app.owner_deposit_availability_requests%rowtype;
begin
  if session_user not in ('postgres', 'fetanagent_owner_control_runtime')
    or p_actor_auth_user_id is null or p_request_id is null
    or p_request_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_enabled is null then
    raise exception using errcode = '42501', message = 'The deposit request is invalid.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active' for share;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select control.enabled into v_previous from app.owner_deposit_availability control
    where control.singleton for update;
  if not found then raise exception 'The deposit control is unavailable.'; end if;
  select * into v_existing from app.owner_deposit_availability_requests request
    where request.request_id = p_request_id for share;
  if v_existing.request_id is not null then
    if v_existing.requested_enabled is distinct from p_enabled
      or v_existing.actor_admin_id <> v_actor_id then
      raise exception 'The deposit request was already used differently.';
    end if;
    return v_previous;
  end if;
  if p_enabled then
    -- One Owner click resumes both methods atomically. A receiver rotation or
    -- stopped financial worker cannot be mistaken for a successful resume.
    perform 1 from app.owner_provider_deposit_controls control
      order by control.provider_code for update;
    if (select pg_catalog.count(*) from app.owner_provider_deposit_controls) <> 2
      or app.owner_provider_deposit_readiness('telebirr') <> 'ready'
      or app.owner_provider_deposit_readiness('cbe_birr') <> 'ready' then
      raise exception using errcode = 'P0001',
        message = 'A payment method is not ready to resume.';
    end if;
    update app.owner_provider_deposit_controls control
      set enabled = true, changed_at = pg_catalog.clock_timestamp(),
          changed_by_admin_id = v_actor_id
      where not control.enabled;
  end if;
  update app.owner_deposit_availability control
    set enabled = p_enabled, changed_at = pg_catalog.clock_timestamp(),
        changed_by_admin_id = v_actor_id where control.singleton;
  insert into app.owner_deposit_availability_requests
    (request_id, requested_enabled, actor_admin_id)
    values (p_request_id, p_enabled, v_actor_id);
  insert into app.audit_events
    (actor_kind, actor_admin_id, action, resource_type, metadata)
    values ('admin', v_actor_id, 'configuration.deposit_availability_changed',
      'payment_provider', pg_catalog.jsonb_build_object(
        'enabled', p_enabled, 'previousEnabled', v_previous,
        'requestId', p_request_id, 'providers',
        pg_catalog.jsonb_build_array('telebirr', 'cbe_birr')));
  return p_enabled;
end;
$$;
alter function app.set_owner_deposit_availability(uuid,uuid,boolean) owner to postgres;
revoke all on function app.set_owner_deposit_availability(uuid,uuid,boolean)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.set_owner_deposit_availability(uuid,uuid,boolean)
  to fetanagent_owner_control;

create or replace function app.public_provider_deposit_controls()
returns table(provider_code text, accepting boolean)
language sql security definer set search_path = pg_catalog
as $$
  select control.provider_code,
    control.enabled and coalesce((select all_methods.enabled
      from app.owner_deposit_availability all_methods where all_methods.singleton), false)
      and app.owner_provider_deposit_readiness(control.provider_code) = 'ready'
  from app.owner_provider_deposit_controls control
  order by control.provider_code
$$;

create or replace function app.prepare_telegram_live_telebirr_destination(
  p_origin_inbound_event_id uuid, p_player_id text, p_semantic_input_hmac text
)
returns table (
  provider_code text, receiver_revision_id uuid,
  receiver_account_holder_name text,
  receiver_account_reference_ciphertext text,
  receiver_account_reference_fingerprint text,
  receiver_account_masked text, payments_enabled boolean,
  request_replayed boolean
)
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_provider_id uuid;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'The live Telegram TeleBirr destination is unavailable.';
  end if;
  perform app.require_owner_deposit_availability();
  select provider.id into v_provider_id from app.payment_providers provider
    where provider.code = 'telebirr' and provider.status = 'active';
  perform app.require_owner_provider_deposit_enabled(v_provider_id);
  if (select pg_catalog.count(*) from app.feature_switches feature_switch
       where (feature_switch.feature_key in ('payment_verification', 'deposit_execution')
         and feature_switch.mode = 'live')
         or (feature_switch.feature_key in (
           'private_live_deposit_pilot','telebirr_authoritative_verification')
           and feature_switch.mode = 'disabled')) = 4 then
    return query select * from app.prepare_telegram_routine_telebirr_paid_destination_core(
      p_origin_inbound_event_id, p_player_id, p_semantic_input_hmac);
  else
    return query select * from app.prepare_telegram_live_telebirr_destination_pilot_core(
      p_origin_inbound_event_id, p_player_id, p_semantic_input_hmac);
  end if;
end;
$$;

create or replace function app.prepare_telegram_live_cbe_sms_destination(
  p_origin_inbound_event_id uuid, p_player_id text
)
returns table (
  provider_code text, receiver_revision_id uuid,
  receiver_account_holder_name text,
  receiver_account_reference_ciphertext text,
  receiver_account_reference_fingerprint text,
  receiver_account_masked text, payments_enabled boolean
)
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_selected_player text;
  v_player_account_id uuid;
  v_provider_id uuid;
  v_receiver app.receiver_accounts%rowtype;
  v_route_enabled boolean;
  v_live_switches integer;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime')
    or p_origin_inbound_event_id is null
    or p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]' then
    raise exception using errcode = '42501',
      message = 'The CBE Birr destination is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  perform app.require_owner_deposit_availability();
  select provider.id into v_provider_id from app.payment_providers provider
    where provider.code = 'cbe_birr' and provider.status = 'active';
  perform app.require_owner_provider_deposit_enabled(v_provider_id);
  select control.enabled into v_route_enabled
    from app.receiver_sms_route_control control where control.singleton for share;
  select pg_catalog.count(*)::integer into v_live_switches
    from app.feature_switches feature
   where feature.feature_key in (
     'payment_verification', 'deposit_execution',
     'cbe_birr_authoritative_verification') and feature.mode = 'live';
  if v_route_enabled is distinct from true or v_live_switches <> 3 then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;
  select selection.selected_player_id into v_selected_player
    from app.get_telegram_saved_player_selection(p_origin_inbound_event_id) selection;
  if v_selected_player is distinct from p_player_id then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;
  select boundary.player_account_id, boundary.payment_provider_id
    into v_player_account_id, v_provider_id
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'cbe_birr') boundary;
  if v_player_account_id is null or v_provider_id is null then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;
  select receiver.* into v_receiver
    from app.receiver_accounts receiver
   where receiver.provider_id = v_provider_id
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= pg_catalog.clock_timestamp()
   for share;
  if v_receiver.id is null
    or v_receiver.account_holder_name <> pg_catalog.btrim(v_receiver.account_holder_name)
    or pg_catalog.char_length(v_receiver.account_holder_name) not between 2 and 160
    or v_receiver.account_holder_name ~ '[[:cntrl:]]'
    or v_receiver.account_reference_ciphertext
       !~ '^receiver-v1[.]cbe_birr[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22}[.][A-Za-z0-9_-]{12,32}$'
    or v_receiver.account_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or v_receiver.account_reference_masked !~ '^\*{3}[0-9]{4}$'
    or v_receiver.protection_profile_version <> 1
    or v_receiver.encryption_key_version <> 1
    or v_receiver.fingerprint_key_version <> 1 then
    raise exception 'The CBE Birr destination is unavailable.';
  end if;
  return query select 'cbe_birr'::text, v_receiver.id,
    v_receiver.account_holder_name, v_receiver.account_reference_ciphertext,
    v_receiver.account_reference_fingerprint, v_receiver.account_reference_masked, true;
end;
$$;

comment on table app.owner_deposit_availability is
  'Owner ordinary pause of new payment instructions; existing SMS and credit work continue.';
comment on function app.set_owner_deposit_availability(uuid,uuid,boolean) is
  'Owner-only audited all-method pause and one-click safe resume, independent of guarded financial activation.';
commit;
