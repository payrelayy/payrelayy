-- A Telegram payer chooses one beneficiary at a time. The Player account itself is not
-- re-owned: any number of Telegram identities may select the same eligible Player.
-- This migration changes no payment switch, receipt, or execution authority.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_player_selections (
  telegram_identity_id uuid primary key
    references app.telegram_identities (customer_identity_id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  origin_inbound_event_id uuid not null unique
    references app.inbound_events (id) on delete restrict,
  selected_at timestamptz not null
);
create index telegram_player_selections_player_idx
  on app.telegram_player_selections (player_account_id);
alter table app.telegram_player_selections owner to postgres;
alter table app.telegram_player_selections enable row level security;
alter table app.telegram_player_selections force row level security;
revoke all on table app.telegram_player_selections
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime;

-- A read does not consume the inbound event. The private action transport already authenticates
-- its Telegram sender; this function re-resolves the identity rather than trusting a supplied ID.
create function app.get_telegram_saved_player_selection(p_origin_inbound_event_id uuid)
returns table (selected_player_id text)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_identity_id uuid;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram Player selection is unavailable.';
  end if;
  select inbound_event.customer_identity_id into v_identity_id
    from app.inbound_events inbound_event
    join app.customer_identities identity
      on identity.id = inbound_event.customer_identity_id
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
     and identity.external_subject = telegram_identity.telegram_user_id::text
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
     and identity.identity_kind = 'telegram'
     and identity.status = 'active'
     and customer.status = 'active';
  if v_identity_id is null then
    raise exception 'Telegram Player selection is unavailable.';
  end if;
  return query
    select player.player_id
      from app.telegram_player_selections selection
      join app.customer_platform_players player
        on player.id = selection.player_account_id
     where selection.telegram_identity_id = v_identity_id;
end;
$$;

-- Only a completed, currently eligible KemerBet Player can be selected. The existing proof
-- boundary supplies the same eligibility decision used by live intake. The selection is not a
-- payment instruction and is checked again before any later deposit.
create function app.save_telegram_player_selection(
  p_origin_inbound_event_id uuid,
  p_player_id text
)
returns table (selected_player_id text, request_replayed boolean)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_identity_id uuid;
  v_customer_id uuid;
  v_processed_at timestamptz;
  v_selected app.telegram_player_selections%rowtype;
  v_player_account_id uuid;
  v_platform_id uuid;
  v_now timestamptz;
begin
  if session_user not in ('postgres', 'fetanagent_player_actions_runtime') then
    raise exception using errcode = '42501',
      message = 'Telegram Player selection is unavailable.';
  end if;
  if p_player_id is null or p_player_id <> pg_catalog.btrim(p_player_id)
    or pg_catalog.char_length(p_player_id) not between 1 and 64
    or p_player_id ~ '[[:space:][:cntrl:]]' then
    raise exception 'The Player ID is invalid.';
  end if;
  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into v_identity_id, v_processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram' for update;
  if v_identity_id is null then
    raise exception 'Telegram Player selection is unavailable.';
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
    raise exception 'Telegram Player selection is unavailable.';
  end if;
  select selection.* into v_selected
    from app.telegram_player_selections selection
   where selection.telegram_identity_id = v_identity_id for update;
  if v_selected.origin_inbound_event_id = p_origin_inbound_event_id then
    select player.player_id into selected_player_id
      from app.customer_platform_players player
     where player.id = v_selected.player_account_id;
    if selected_player_id is distinct from p_player_id or v_processed_at is null then
      raise exception 'Telegram Player selection replay conflicts.';
    end if;
    request_replayed := true;
    return next;
    return;
  end if;
  if v_processed_at is not null
    or exists (select 1 from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id) then
    raise exception 'The Telegram event already has another action.';
  end if;

  select boundary.player_account_id, boundary.platform_id
    into v_player_account_id, v_platform_id
    from app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'telebirr') boundary;
  if v_player_account_id is null
    or not exists (
      select 1 from app.customer_platform_players player
      join app.customers beneficiary on beneficiary.id = player.customer_id
      join app.platforms platform on platform.id = player.platform_id
       where player.id = v_player_account_id and player.platform_id = v_platform_id
         and platform.code = 'kemerbet' and beneficiary.status = 'active'
    ) then
    raise exception 'The Player ID is not currently eligible.';
  end if;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  insert into app.telegram_player_selections (
    telegram_identity_id, player_account_id, origin_inbound_event_id, selected_at
  ) values (v_identity_id, v_player_account_id, p_origin_inbound_event_id, v_now)
  on conflict (telegram_identity_id) do update
    set player_account_id = excluded.player_account_id,
        origin_inbound_event_id = excluded.origin_inbound_event_id,
        selected_at = excluded.selected_at;
  update app.inbound_events inbound_event
     set processed_at = v_now, processing_error_code = null
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.processed_at is null;
  if not found then
    raise exception 'Telegram Player selection was not recorded.';
  end if;
  insert into app.audit_events (
    actor_kind, actor_customer_id, action, resource_type, resource_id, metadata
  ) values (
    'customer', v_customer_id, 'customer.telegram_player_selected',
    'customer_platform_player', v_player_account_id,
    pg_catalog.jsonb_build_object('channel', 'telegram', 'payment_started', false)
  );
  selected_player_id := p_player_id;
  request_replayed := false;
  return next;
end;
$$;

alter function app.get_telegram_saved_player_selection(uuid) owner to postgres;
alter function app.save_telegram_player_selection(uuid,text) owner to postgres;
revoke all on function app.get_telegram_saved_player_selection(uuid),
                       app.save_telegram_player_selection(uuid,text)
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime;
grant execute on function app.get_telegram_saved_player_selection(uuid),
                          app.save_telegram_player_selection(uuid,text)
  to fetanagent_player_actions;

comment on table app.telegram_player_selections is
  'One selected KemerBet beneficiary per private Telegram identity; no ownership or payment authority.';
commit;
