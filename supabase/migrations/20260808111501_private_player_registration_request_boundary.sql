-- PayReplayy Stage 6: dormant, non-claiming Player-ID registration boundary.
--
-- A registration request records only that a Telegram customer asked us to validate a platform
-- Player ID. It is not an ownership claim, does not call KemerBet, and cannot create a
-- deposit-usable customer_platform_players record. No runtime role receives EXECUTE. This helper
-- remains internal; a later conversation-aware wrapper must prove the customer's selected flow
-- before it invokes this helper.

begin;

create type app.player_registration_request_status as enum (
  'pending_validation',
  'exists',
  'not_found',
  'review_required',
  'cancelled'
);

create table app.player_registration_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references app.customers (id) on delete restrict,
  platform_id uuid not null references app.platforms (id) on delete restrict,
  player_id text not null check (
    player_id = btrim(player_id)
    and char_length(player_id) between 1 and 64
    and player_id !~ '[[:cntrl:]]'
    and player_id !~ '[[:space:]]'
  ),
  status app.player_registration_request_status not null default 'pending_validation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_registration_requests_customer_platform_player_key
    unique (customer_id, platform_id, player_id)
);

create index player_registration_requests_platform_status_created_idx
  on app.player_registration_requests (platform_id, status, created_at asc);

create index player_registration_requests_customer_created_idx
  on app.player_registration_requests (customer_id, created_at desc);

create function app.enforce_player_registration_request_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_validation' then
      raise exception 'A Player ID registration request must begin pending validation.';
    end if;

    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
    or new.platform_id is distinct from old.platform_id
    or new.player_id is distinct from old.player_id then
    raise exception 'Player ID registration request bindings are immutable.';
  end if;

  return new;
end;
$$;

create trigger player_registration_requests_enforce_binding
before insert or update on app.player_registration_requests
for each row
execute function app.enforce_player_registration_request_binding();

create trigger player_registration_requests_set_updated_at
before update on app.player_registration_requests
for each row
execute function app.set_updated_at();

create table app.player_registration_request_events (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  player_registration_request_id uuid not null
    references app.player_registration_requests (id) on delete restrict,
  request_reused boolean not null,
  created_at timestamptz not null default now()
);

create index player_registration_request_events_request_idx
  on app.player_registration_request_events (player_registration_request_id);

create function app.enforce_player_registration_request_event_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  inbound_customer_id uuid;
  request_customer_id uuid;
begin
  select customer_identity.customer_id
    into inbound_customer_id
    from app.inbound_events inbound_event
    join app.customer_identities customer_identity
      on customer_identity.id = inbound_event.customer_identity_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = customer_identity.id
    where inbound_event.id = new.origin_inbound_event_id
      and inbound_event.channel = 'telegram';

  select customer_id
    into request_customer_id
    from app.player_registration_requests
    where id = new.player_registration_request_id;

  if inbound_customer_id is null
    or request_customer_id is null
    or inbound_customer_id is distinct from request_customer_id then
    raise exception 'A Player ID registration request event must belong to its Telegram customer.';
  end if;

  return new;
end;
$$;

create trigger player_registration_request_events_require_customer_binding
before insert on app.player_registration_request_events
for each row
execute function app.enforce_player_registration_request_event_binding();

create function app.reject_player_registration_request_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Player ID registration request event links are append-only.';
end;
$$;

create trigger player_registration_request_events_immutable
before update or delete on app.player_registration_request_events
for each row
execute function app.reject_player_registration_request_event_mutation();

create function app.request_telegram_player_registration(
  p_origin_inbound_event_id uuid,
  p_platform_code text,
  p_player_id text
)
returns table (
  player_registration_request_id uuid,
  request_status text,
  origin_inbound_event_already_handled boolean,
  existing_request_reused boolean,
  request_created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  normalized_platform_code text;
  normalized_player_id text;
  resolved_inbound_identity_id uuid;
  resolved_inbound_processed_at timestamptz;
  resolved_customer_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_platform_id uuid;
  resolved_platform_status app.record_status;
  resolved_request_id uuid;
  resolved_request_customer_id uuid;
  resolved_request_platform_id uuid;
  resolved_request_player_id text;
  resolved_request_status app.player_registration_request_status;
  resolved_request_reused boolean;
  resolved_request_created_at timestamptz;
  request_lock_key bigint;
begin
  normalized_platform_code := lower(btrim(p_platform_code));
  normalized_player_id := btrim(p_player_id);

  if p_origin_inbound_event_id is null
    or p_platform_code is null
    or normalized_platform_code is null
    or char_length(normalized_platform_code) > 64
    or normalized_platform_code !~ '^[a-z0-9_]+$'
    or p_player_id is null
    or normalized_player_id is null
    or char_length(normalized_player_id) not between 1 and 64
    or normalized_player_id ~ '[[:cntrl:]]'
    or normalized_player_id ~ '[[:space:]]' then
    raise exception 'The Player ID registration request is invalid.';
  end if;

  -- Start with the immutable inbox row. This blocks another action from consuming the same
  -- Telegram update while this request is being resolved.
  select inbound_event.customer_identity_id, inbound_event.processed_at
    into resolved_inbound_identity_id, resolved_inbound_processed_at
    from app.inbound_events inbound_event
    where inbound_event.id = p_origin_inbound_event_id
      and inbound_event.channel = 'telegram'
    for update;

  if not found or resolved_inbound_identity_id is null then
    raise exception 'The Telegram inbound event is not available for Player ID registration.';
  end if;

  -- Use individual locks so the order is stable: identity, customer, then Telegram identity.
  select customer_identity.customer_id,
         customer_identity.status,
         customer_identity.identity_kind
    into resolved_customer_id,
         resolved_identity_status,
         resolved_identity_kind
    from app.customer_identities customer_identity
    where customer_identity.id = resolved_inbound_identity_id
    for update;

  if not found or resolved_identity_kind <> 'telegram' then
    raise exception 'The Telegram customer identity is not available for Player ID registration.';
  end if;

  select customer.status
    into resolved_customer_status
    from app.customers customer
    where customer.id = resolved_customer_id
    for update;

  if not found then
    raise exception 'The Telegram customer identity is not available for Player ID registration.';
  end if;

  perform 1
    from app.telegram_identities telegram_identity
    where telegram_identity.customer_identity_id = resolved_inbound_identity_id
    for update;

  if not found then
    raise exception 'The Telegram customer identity is not available for Player ID registration.';
  end if;

  select platform.id, platform.status
    into resolved_platform_id, resolved_platform_status
    from app.platforms platform
    where platform.code = normalized_platform_code
    for update;

  if not found then
    raise exception 'The requested platform is not available for Player ID registration.';
  end if;

  -- An exact retry returns its original safe result. A changed Player ID or platform paired with
  -- the same Telegram update is a conflict and never creates another request.
  select registration_request.id,
         registration_request.customer_id,
         registration_request.platform_id,
         registration_request.player_id,
         registration_request.status,
         request_event.request_reused,
         registration_request.created_at
    into resolved_request_id,
         resolved_request_customer_id,
         resolved_request_platform_id,
         resolved_request_player_id,
         resolved_request_status,
         resolved_request_reused,
         resolved_request_created_at
    from app.player_registration_request_events request_event
    join app.player_registration_requests registration_request
      on registration_request.id = request_event.player_registration_request_id
    where request_event.origin_inbound_event_id = p_origin_inbound_event_id
    for update of request_event, registration_request;

  if found then
    if resolved_request_customer_id <> resolved_customer_id
      or resolved_request_platform_id <> resolved_platform_id
      or resolved_request_player_id <> normalized_player_id then
      raise exception 'The Telegram inbound event conflicts with its recorded Player ID request.';
    end if;

    return query
    select resolved_request_id,
           resolved_request_status::text,
           true,
           resolved_request_reused,
           resolved_request_created_at;
    return;
  end if;

  if resolved_customer_status <> 'active'
    or resolved_identity_status <> 'active' then
    raise exception 'The Telegram customer is not available for Player ID registration.';
  end if;

  if resolved_inbound_processed_at is not null then
    raise exception 'The Telegram inbound event has already been handled.';
  end if;

  if resolved_platform_status <> 'active' then
    raise exception 'The requested platform is not available for Player ID registration.';
  end if;

  request_lock_key := pg_catalog.hashtextextended(
    'payreplayy:player-registration:v1:'
      || resolved_customer_id::text
      || ':' || resolved_platform_id::text
      || ':' || normalized_player_id,
    0::bigint
  );
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select registration_request.id,
         registration_request.status,
         registration_request.created_at
    into resolved_request_id,
         resolved_request_status,
         resolved_request_created_at
    from app.player_registration_requests registration_request
    where registration_request.customer_id = resolved_customer_id
      and registration_request.platform_id = resolved_platform_id
      and registration_request.player_id = normalized_player_id
    for update;

  if found then
    resolved_request_reused := true;
  else
    insert into app.player_registration_requests (
      customer_id,
      platform_id,
      player_id
    )
    values (
      resolved_customer_id,
      resolved_platform_id,
      normalized_player_id
    )
    returning id, status, created_at
      into resolved_request_id,
           resolved_request_status,
           resolved_request_created_at;
    resolved_request_reused := false;
  end if;

  insert into app.player_registration_request_events (
    origin_inbound_event_id,
    player_registration_request_id,
    request_reused
  )
  values (
    p_origin_inbound_event_id,
    resolved_request_id,
    resolved_request_reused
  );

  update app.inbound_events inbound_event
  set processed_at = clock_timestamp(),
      processing_error_code = null
  where inbound_event.id = p_origin_inbound_event_id
    and inbound_event.processed_at is null;

  if not found then
    raise exception 'The Telegram inbound event has already been handled.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'customer',
    resolved_customer_id,
    'customer.player_registration_requested',
    'player_registration_request',
    resolved_request_id,
    jsonb_build_object(
      'platform_code', normalized_platform_code,
      'request_status', resolved_request_status::text,
      'request_reused', resolved_request_reused
    )
  );

  return query
  select resolved_request_id,
         resolved_request_status::text,
         false,
         resolved_request_reused,
         resolved_request_created_at;
end;
$$;

alter table app.player_registration_requests enable row level security;
alter table app.player_registration_requests force row level security;
alter table app.player_registration_request_events enable row level security;
alter table app.player_registration_request_events force row level security;

revoke all on type app.player_registration_request_status
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all privileges on table
  app.player_registration_requests,
  app.player_registration_request_events
from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_player_registration_request_binding()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.enforce_player_registration_request_event_binding()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.reject_player_registration_request_event_mutation()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

revoke all on function app.request_telegram_player_registration(uuid, text, text)
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

comment on table app.player_registration_requests is
  'Non-claiming requests to validate a customer-submitted platform Player ID. A request is not ownership and is not deposit-usable.';

comment on table app.player_registration_request_events is
  'Append-only idempotency links from private Telegram inbound events to non-claiming Player ID registration requests.';

comment on function app.request_telegram_player_registration(uuid, text, text) is
  'Internal helper for non-claiming Player ID requests. It has no runtime EXECUTE grant; a reviewed conversation-aware wrapper must prove the customer-selected flow before invoking it.';

commit;
