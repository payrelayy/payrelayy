-- Dormant, non-financial intake for an automatic KemerBet Player-ID Find. The selected
-- beneficiary is intentionally untouched until a separate signed Companion result is accepted.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_player_validation_requests (
  id uuid primary key default gen_random_uuid(),
  telegram_identity_id uuid not null
    references app.telegram_identities (customer_identity_id) on delete restrict,
  origin_inbound_event_id uuid not null unique
    references app.inbound_events (id) on delete restrict,
  player_id text not null
    check (player_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  selection_origin_inbound_event_id uuid
    references app.inbound_events (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'superseded', 'validated', 'review_required')),
  requested_at timestamptz not null,
  completed_at timestamptz,
  constraint telegram_player_validation_requests_completion_check check (
    (status = 'pending' and completed_at is null)
    or (status <> 'pending' and completed_at is not null)
  )
);
create unique index telegram_player_validation_requests_one_pending_idx
  on app.telegram_player_validation_requests (telegram_identity_id)
  where status = 'pending';
create index telegram_player_validation_requests_identity_time_idx
  on app.telegram_player_validation_requests (telegram_identity_id, requested_at desc);
create index telegram_player_validation_requests_pending_time_idx
  on app.telegram_player_validation_requests (requested_at, id)
  where status = 'pending';
create index telegram_player_validation_requests_selected_event_idx
  on app.telegram_player_validation_requests (selection_origin_inbound_event_id)
  where selection_origin_inbound_event_id is not null;
alter table app.telegram_player_validation_requests owner to postgres;
alter table app.telegram_player_validation_requests enable row level security;
alter table app.telegram_player_validation_requests force row level security;
revoke all on table app.telegram_player_validation_requests
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

create function app.request_telegram_player_validation(
  p_origin_inbound_event_id uuid,
  p_player_id text
)
returns table (request_id uuid, request_replayed boolean)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_identity_id uuid;
  v_customer_id uuid;
  v_processed_at timestamptz;
  v_existing app.telegram_player_validation_requests%rowtype;
  v_previous_selection_event_id uuid;
  v_now timestamptz;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram Player validation is unavailable.';
  end if;
  if p_player_id is null
    or p_player_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    raise exception 'The Player ID is invalid.';
  end if;
  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into v_identity_id, v_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;
  if v_identity_id is null then
    raise exception 'Telegram Player validation is unavailable.';
  end if;
  select identity.customer_id into v_customer_id
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
   where identity.id = v_identity_id
     and identity.identity_kind = 'telegram'
     and identity.status = 'active' and customer.status = 'active'
   for update of identity, customer, telegram_identity;
  if v_customer_id is null then
    raise exception 'Telegram Player validation is unavailable.';
  end if;

  select request.* into v_existing
    from app.telegram_player_validation_requests request
   where request.origin_inbound_event_id = p_origin_inbound_event_id;
  if v_existing.id is not null then
    if v_existing.telegram_identity_id <> v_identity_id
      or v_existing.player_id <> p_player_id or v_processed_at is null then
      raise exception 'Telegram Player validation replay conflicts.';
    end if;
    request_id := v_existing.id;
    request_replayed := true;
    return next;
    return;
  end if;
  if v_processed_at is not null
    or exists (select 1 from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id) then
    raise exception 'The Telegram event already has another action.';
  end if;

  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if (select count(*) from app.telegram_player_validation_requests request
       where request.telegram_identity_id = v_identity_id
         and request.requested_at > v_now - interval '1 hour') >= 20 then
    raise exception 'Too many Player ID checks; try again later.';
  end if;
  select selection.origin_inbound_event_id into v_previous_selection_event_id
    from app.telegram_player_selections selection
   where selection.telegram_identity_id = v_identity_id;
  update app.telegram_player_validation_requests request
     set status = 'superseded', completed_at = v_now
   where request.telegram_identity_id = v_identity_id and request.status = 'pending';
  insert into app.telegram_player_validation_requests (
    telegram_identity_id, origin_inbound_event_id, player_id,
    selection_origin_inbound_event_id, requested_at
  ) values (
    v_identity_id, p_origin_inbound_event_id, p_player_id,
    v_previous_selection_event_id, v_now
  ) returning id into request_id;
  update app.inbound_events inbound_event
     set processed_at = v_now, processing_error_code = null
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.processed_at is null;
  if not found then
    raise exception 'Telegram Player validation was not recorded.';
  end if;
  insert into app.audit_events (
    actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
  ) values (
    'customer', v_customer_id, 'customer.telegram_player_validation_requested',
    'telegram_player_validation_request', request_id,
    pg_catalog.jsonb_build_object('channel', 'telegram', 'payment_started', false)
  );
  request_replayed := false;
  return next;
end;
$$;

alter function app.request_telegram_player_validation(uuid,text) owner to postgres;
revoke all on function app.request_telegram_player_validation(uuid,text)
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.request_telegram_player_validation(uuid,text)
  to fetanagent_player_actions;

comment on table app.telegram_player_validation_requests is
  'Pending Telegram beneficiary changes; never itself a validation, selection, ownership claim, or payment authority.';
comment on function app.request_telegram_player_validation(uuid,text) is
  'Private authenticated Telegram request intake. Preserves the selected beneficiary pending a signed read-only KemerBet Find.';
commit;
