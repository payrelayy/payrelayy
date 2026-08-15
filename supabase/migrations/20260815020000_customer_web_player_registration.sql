-- FetanAgent customer-web identity and non-claiming Player-ID registration boundary.
--
-- The server-side customer web runtime supplies only a Supabase Auth user UUID that it has
-- independently verified with auth.getUser(). The database never accepts an email address,
-- customer UUID, Telegram identity, or financial input from this boundary. Web Player-ID
-- requests may receive the existing Owner existence review, but cannot be associated with a
-- deposit-eligible player account until a later proof-bearing migration explicitly permits it.

begin;

create role fetanagent_customer_web
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_customer_web_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

grant fetanagent_customer_web to fetanagent_customer_web_runtime
  with inherit true, set false, admin false;

alter table app.customer_identities
  add constraint customer_identities_id_customer_key unique (id, customer_id);

create table app.customer_auth_identities (
  customer_identity_id uuid primary key,
  customer_id uuid not null unique references app.customers (id) on delete restrict,
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint customer_auth_identities_identity_customer_fkey
    foreign key (customer_identity_id, customer_id)
    references app.customer_identities (id, customer_id) on delete restrict
);

create function app.enforce_customer_auth_identity_parent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if not exists (
    select 1
      from app.customer_identities customer_identity
     where customer_identity.id = new.customer_identity_id
       and customer_identity.customer_id = new.customer_id
       and customer_identity.identity_kind = 'supabase_auth'
       and customer_identity.external_subject = new.auth_user_id::text
  ) then
    raise exception 'The customer Auth identity binding is invalid.';
  end if;

  return new;
end;
$$;

create trigger customer_auth_identities_require_parent
before insert on app.customer_auth_identities
for each row
execute function app.enforce_customer_auth_identity_parent();

create function app.reject_customer_auth_identity_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Customer Auth identity bindings are append-only.';
end;
$$;

create trigger customer_auth_identities_immutable
before update or delete on app.customer_auth_identities
for each row
execute function app.reject_customer_auth_identity_mutation();

create trigger customer_auth_identities_no_truncate
before truncate on app.customer_auth_identities
for each statement
execute function app.reject_customer_auth_identity_mutation();

create table app.customer_web_player_registration_request_origins (
  customer_auth_identity_id uuid not null
    references app.customer_auth_identities (customer_identity_id) on delete restrict,
  request_key uuid not null,
  player_registration_request_id uuid not null unique
    references app.player_registration_requests (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint customer_web_player_request_origins_pkey
    primary key (customer_auth_identity_id, request_key)
);

create index customer_web_player_request_origins_identity_created_idx
  on app.customer_web_player_registration_request_origins (
    customer_auth_identity_id,
    created_at desc
  );

create function app.enforce_customer_web_player_registration_request_origin()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:customer-web-player-association-gate:v1:'
        || new.player_registration_request_id::text,
      0::bigint
    )
  );

  if not exists (
    select 1
      from app.customer_auth_identities customer_auth_identity
      join app.player_registration_requests registration_request
        on registration_request.id = new.player_registration_request_id
       and registration_request.customer_id = customer_auth_identity.customer_id
     where customer_auth_identity.customer_identity_id = new.customer_auth_identity_id
       and not exists (
         select 1
           from app.player_registration_request_associations association
          where association.player_registration_request_id = registration_request.id
       )
  ) then
    raise exception 'The customer-web Player ID request origin is invalid.';
  end if;

  return new;
end;
$$;

create trigger customer_web_player_request_origins_require_binding
before insert on app.customer_web_player_registration_request_origins
for each row
execute function app.enforce_customer_web_player_registration_request_origin();

create function app.reject_customer_web_player_registration_request_origin_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Customer-web Player ID request origins are append-only.';
end;
$$;

create trigger customer_web_player_request_origins_immutable
before update or delete on app.customer_web_player_registration_request_origins
for each row
execute function app.reject_customer_web_player_registration_request_origin_mutation();

create trigger customer_web_player_request_origins_no_truncate
before truncate on app.customer_web_player_registration_request_origins
for each statement
execute function app.reject_customer_web_player_registration_request_origin_mutation();

create function app.reject_customer_web_player_registration_association()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:customer-web-player-association-gate:v1:'
        || new.player_registration_request_id::text,
      0::bigint
    )
  );

  if exists (
    select 1
      from app.customer_web_player_registration_request_origins request_origin
     where request_origin.player_registration_request_id = new.player_registration_request_id
  ) then
    raise exception 'Customer-web Player ID ownership association is not available.';
  end if;

  return new;
end;
$$;

create trigger player_registration_associations_reject_customer_web
before insert or update of player_registration_request_id
on app.player_registration_request_associations
for each row
execute function app.reject_customer_web_player_registration_association();

create function app.ensure_customer_web_account(
  p_actor_auth_user_id uuid
)
returns table (
  account_status text,
  account_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_customer_identity_id uuid;
  resolved_customer_id uuid;
  resolved_customer_status app.record_status;
  resolved_identity_status app.record_status;
  resolved_identity_kind text;
  resolved_external_subject text;
begin
  if p_actor_auth_user_id is null then
    raise exception 'The customer-web account request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:customer-auth:v1:' || p_actor_auth_user_id::text,
      0::bigint
    )
  );

  perform 1
    from auth.users auth_user
   where auth_user.id = p_actor_auth_user_id
   for key share;

  if not found then
    raise exception 'The customer-web account request is unavailable.';
  end if;

  select customer_auth_identity.customer_identity_id,
         customer_auth_identity.customer_id,
         customer.status,
         customer_identity.status,
         customer_identity.identity_kind,
         customer_identity.external_subject
    into resolved_customer_identity_id,
         resolved_customer_id,
         resolved_customer_status,
         resolved_identity_status,
         resolved_identity_kind,
         resolved_external_subject
    from app.customer_auth_identities customer_auth_identity
    join app.customer_identities customer_identity
      on customer_identity.id = customer_auth_identity.customer_identity_id
     and customer_identity.customer_id = customer_auth_identity.customer_id
    join app.customers customer
      on customer.id = customer_auth_identity.customer_id
   where customer_auth_identity.auth_user_id = p_actor_auth_user_id
   for update of customer_auth_identity, customer_identity, customer;

  if found then
    if resolved_customer_status <> 'active'
      or resolved_identity_status <> 'active'
      or resolved_identity_kind <> 'supabase_auth'
      or resolved_external_subject <> p_actor_auth_user_id::text then
      raise exception 'The customer-web account request is unavailable.';
    end if;

    return query select 'active'::text, false;
    return;
  end if;

  if exists (
    select 1
      from app.customer_identities customer_identity
     where customer_identity.identity_kind = 'supabase_auth'
       and customer_identity.external_subject = p_actor_auth_user_id::text
  ) then
    raise exception 'The customer-web account request requires remediation.';
  end if;

  insert into app.customers (status)
  values ('active')
  returning id into resolved_customer_id;

  insert into app.customer_identities (
    customer_id,
    identity_kind,
    external_subject,
    status
  )
  values (
    resolved_customer_id,
    'supabase_auth',
    p_actor_auth_user_id::text,
    'active'
  )
  returning id into resolved_customer_identity_id;

  insert into app.customer_auth_identities (
    customer_identity_id,
    customer_id,
    auth_user_id
  )
  values (
    resolved_customer_identity_id,
    resolved_customer_id,
    p_actor_auth_user_id
  );

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
    'customer.web_account_created',
    'customer',
    resolved_customer_id,
    jsonb_build_object('channel', 'customer_web')
  );

  return query select 'active'::text, true;
end;
$$;

create function app.submit_customer_web_player_registration(
  p_actor_auth_user_id uuid,
  p_request_key uuid,
  p_player_id text
)
returns table (
  platform_code text,
  request_status text,
  existing_request_reused boolean,
  request_key_already_used boolean,
  request_created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  normalized_player_id text;
  resolved_customer_identity_id uuid;
  resolved_customer_id uuid;
  resolved_platform_id uuid;
  resolved_request_id uuid;
  resolved_request_internal_status text;
  resolved_request_reused boolean;
  resolved_request_created_at timestamptz;
  resolved_existing_origin_identity_id uuid;
  resolved_existing_origin_player_id text;
  recent_distinct_request_count integer;
  unresolved_request_count integer;
begin
  normalized_player_id := btrim(p_player_id);

  if p_actor_auth_user_id is null
    or p_request_key is null
    or p_player_id is null
    or normalized_player_id is null
    or char_length(normalized_player_id) not between 1 and 64
    or normalized_player_id ~ '[[:space:][:cntrl:]]' then
    raise exception 'The customer-web Player ID request is invalid.';
  end if;

  select customer_auth_identity.customer_identity_id,
         customer_auth_identity.customer_id
    into resolved_customer_identity_id,
         resolved_customer_id
    from app.customer_auth_identities customer_auth_identity
    join app.customer_identities customer_identity
      on customer_identity.id = customer_auth_identity.customer_identity_id
     and customer_identity.customer_id = customer_auth_identity.customer_id
    join app.customers customer
      on customer.id = customer_auth_identity.customer_id
   where customer_auth_identity.auth_user_id = p_actor_auth_user_id
     and customer_identity.identity_kind = 'supabase_auth'
     and customer_identity.external_subject = p_actor_auth_user_id::text
     and customer_identity.status = 'active'
     and customer.status = 'active'
   for update of customer_auth_identity, customer_identity, customer;

  if not found then
    raise exception 'The customer-web Player ID request is unavailable.';
  end if;

  -- Exact transport replay is resolved before quota checks. A changed Player ID paired with the
  -- same server-generated key is always a conflict and never discloses the prior value.
  select request_origin.customer_auth_identity_id,
         registration_request.player_id,
         registration_request.status::text,
         registration_request.created_at
    into resolved_existing_origin_identity_id,
         resolved_existing_origin_player_id,
         resolved_request_internal_status,
         resolved_request_created_at
    from app.customer_web_player_registration_request_origins request_origin
    join app.player_registration_requests registration_request
      on registration_request.id = request_origin.player_registration_request_id
     and registration_request.customer_id = resolved_customer_id
   where request_origin.customer_auth_identity_id = resolved_customer_identity_id
     and request_origin.request_key = p_request_key
   for update of request_origin, registration_request;

  if found then
    if resolved_existing_origin_player_id <> normalized_player_id then
      raise exception 'The customer-web Player ID request conflicts with its recorded receipt.';
    end if;

    return query
    select 'kemerbet'::text,
           case
             when resolved_request_internal_status in (
               'pending_validation',
               'exists',
               'review_required'
             ) then 'checking'
             else 'needs_attention'
           end,
           true,
           true,
           resolved_request_created_at;
    return;
  end if;

  select platform.id
    into resolved_platform_id
    from app.platforms platform
   where platform.code = 'kemerbet'
     and platform.status = 'active'
   for share;

  if not found then
    raise exception 'The customer-web Player ID request is unavailable.';
  end if;

  select registration_request.id,
         registration_request.status::text,
         registration_request.created_at
    into resolved_request_id,
         resolved_request_internal_status,
         resolved_request_created_at
    from app.player_registration_requests registration_request
   where registration_request.customer_id = resolved_customer_id
     and registration_request.platform_id = resolved_platform_id
     and registration_request.player_id = normalized_player_id
   for update;

  if found then
    if not exists (
      select 1
        from app.customer_web_player_registration_request_origins request_origin
       where request_origin.player_registration_request_id = resolved_request_id
         and request_origin.customer_auth_identity_id = resolved_customer_identity_id
    ) then
      raise exception 'The customer-web Player ID request is unavailable.';
    end if;

    -- A fresh request key for an already-known Player ID is a natural replay, not a new receipt.
    -- Return the existing safe projection without growing the origin or audit ledgers.
    return query
    select 'kemerbet'::text,
           case
             when resolved_request_internal_status in (
               'pending_validation',
               'exists',
               'review_required'
             ) then 'checking'
             else 'needs_attention'
           end,
           true,
           false,
           resolved_request_created_at;
    return;
  else
    select count(distinct request_origin.player_registration_request_id)::integer
      into recent_distinct_request_count
      from app.customer_web_player_registration_request_origins request_origin
      join app.player_registration_requests registration_request
        on registration_request.id = request_origin.player_registration_request_id
       and registration_request.customer_id = resolved_customer_id
     where request_origin.customer_auth_identity_id = resolved_customer_identity_id
       and registration_request.created_at >= clock_timestamp() - interval '24 hours';

    select count(*)::integer
      into unresolved_request_count
      from app.player_registration_requests registration_request
     where registration_request.customer_id = resolved_customer_id
       and registration_request.status in ('pending_validation', 'review_required', 'exists')
       and exists (
         select 1
           from app.customer_web_player_registration_request_origins request_origin
          where request_origin.player_registration_request_id = registration_request.id
            and request_origin.customer_auth_identity_id = resolved_customer_identity_id
       );

    if recent_distinct_request_count >= 5 or unresolved_request_count >= 10 then
      raise exception 'The customer-web Player ID request limit has been reached.';
    end if;
  end if;

  select registration_result.player_registration_request_id,
         registration_result.request_status,
         registration_result.existing_request_reused,
         registration_result.request_created_at
    into resolved_request_id,
         resolved_request_internal_status,
         resolved_request_reused,
         resolved_request_created_at
    from app.create_or_reuse_player_registration_request(
      resolved_customer_id,
      resolved_platform_id,
      normalized_player_id
    ) registration_result;

  if not found then
    raise exception 'The customer-web Player ID request is unavailable.';
  end if;

  if resolved_request_reused and not exists (
    select 1
      from app.customer_web_player_registration_request_origins request_origin
     where request_origin.player_registration_request_id = resolved_request_id
       and request_origin.customer_auth_identity_id = resolved_customer_identity_id
  ) then
    raise exception 'The customer-web Player ID request is unavailable.';
  end if;

  insert into app.customer_web_player_registration_request_origins (
    customer_auth_identity_id,
    request_key,
    player_registration_request_id
  )
  values (
    resolved_customer_identity_id,
    p_request_key,
    resolved_request_id
  );

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
    'customer.web_player_registration_requested',
    'player_registration_request',
    resolved_request_id,
    jsonb_build_object(
      'channel', 'customer_web',
      'platform_code', 'kemerbet',
      'request_reused', resolved_request_reused
    )
  );

  return query
  select 'kemerbet'::text,
         case
           when resolved_request_internal_status in (
             'pending_validation',
             'exists',
             'review_required'
           ) then 'checking'
           else 'needs_attention'
         end,
         resolved_request_reused,
         false,
         resolved_request_created_at;
end;
$$;

create function app.list_customer_web_player_registrations(
  p_actor_auth_user_id uuid,
  p_limit integer default 20
)
returns table (
  platform_code text,
  submitted_player_id text,
  request_status text,
  request_created_at timestamptz,
  request_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  resolved_customer_identity_id uuid;
  resolved_customer_id uuid;
begin
  if p_actor_auth_user_id is null
    or p_limit is null
    or p_limit not between 1 and 20 then
    raise exception 'The customer-web Player ID list request is invalid.';
  end if;

  select customer_auth_identity.customer_identity_id,
         customer_auth_identity.customer_id
    into resolved_customer_identity_id,
         resolved_customer_id
    from app.customer_auth_identities customer_auth_identity
    join app.customer_identities customer_identity
      on customer_identity.id = customer_auth_identity.customer_identity_id
     and customer_identity.customer_id = customer_auth_identity.customer_id
    join app.customers customer
      on customer.id = customer_auth_identity.customer_id
   where customer_auth_identity.auth_user_id = p_actor_auth_user_id
     and customer_identity.identity_kind = 'supabase_auth'
     and customer_identity.external_subject = p_actor_auth_user_id::text
     and customer_identity.status = 'active'
     and customer.status = 'active'
   for share of customer_auth_identity, customer_identity, customer;

  if not found then
    raise exception 'The customer-web Player ID list request is unavailable.';
  end if;

  return query
  select platform.code,
         registration_request.player_id,
         case
           when association.id is not null
             and player_account.status = 'active'
             and player_account.validation_status = 'valid' then 'ready'
           when registration_request.status in (
             'pending_validation',
             'exists',
             'review_required'
           ) then 'checking'
           else 'needs_attention'
         end,
         registration_request.created_at,
         registration_request.updated_at
    from app.player_registration_requests registration_request
    join app.platforms platform
      on platform.id = registration_request.platform_id
     and platform.code = 'kemerbet'
    left join app.player_registration_request_associations association
      on association.player_registration_request_id = registration_request.id
    left join app.customer_platform_players player_account
      on player_account.id = association.player_account_id
     and player_account.customer_id = resolved_customer_id
   where registration_request.customer_id = resolved_customer_id
     and exists (
       select 1
         from app.customer_web_player_registration_request_origins request_origin
        where request_origin.player_registration_request_id = registration_request.id
          and request_origin.customer_auth_identity_id = resolved_customer_identity_id
     )
   order by registration_request.created_at desc, registration_request.id desc
   limit p_limit;
end;
$$;

-- Preserve the current Owner existence-review queue, but do not advertise a web request as an
-- association candidate before a later migration introduces an explicit ownership-proof path.
create or replace function app.list_owner_player_registration_association_candidates(
  p_actor_auth_user_id uuid,
  p_limit integer default 25
)
returns table (
  registration_request_id uuid,
  platform_code text,
  submitted_player_id text,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
begin
  if p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'The Owner Player ID association request is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can associate Player IDs.';
  end if;

  return query
  select registration_request.id,
         platform.code,
         registration_request.player_id,
         review.created_at
    from app.player_registration_requests registration_request
    join app.platforms platform on platform.id = registration_request.platform_id
    join app.player_registration_request_reviews review
      on review.player_registration_request_id = registration_request.id
     and review.decision = 'exists'
     and review.reason_code = 'owner_platform_lookup'
    left join app.player_registration_request_associations association
      on association.player_registration_request_id = registration_request.id
   where platform.code = 'kemerbet'
     and registration_request.status = 'exists'
     and association.id is null
     and not exists (
       select 1
         from app.customer_web_player_registration_request_origins request_origin
        where request_origin.player_registration_request_id = registration_request.id
     )
   order by review.created_at asc, registration_request.id asc
   limit p_limit;
end;
$$;

alter table app.customer_auth_identities enable row level security;
alter table app.customer_auth_identities force row level security;
alter table app.customer_web_player_registration_request_origins enable row level security;
alter table app.customer_web_player_registration_request_origins force row level security;

-- Reset the two new roles before applying the exact private function surface.
revoke all privileges on schema app
  from fetanagent_customer_web, fetanagent_customer_web_runtime;
revoke all privileges on all tables in schema app
  from fetanagent_customer_web, fetanagent_customer_web_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_customer_web, fetanagent_customer_web_runtime;
revoke all privileges on all functions in schema app
  from fetanagent_customer_web, fetanagent_customer_web_runtime;

revoke all privileges on table
  app.customer_auth_identities,
  app.customer_web_player_registration_request_origins
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime;

revoke all on function app.enforce_customer_auth_identity_parent(),
  app.reject_customer_auth_identity_mutation(),
  app.enforce_customer_web_player_registration_request_origin(),
  app.reject_customer_web_player_registration_request_origin_mutation(),
  app.reject_customer_web_player_registration_association(),
  app.ensure_customer_web_account(uuid),
  app.submit_customer_web_player_registration(uuid, uuid, text),
  app.list_customer_web_player_registrations(uuid, integer)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime;

grant usage on schema app to fetanagent_customer_web;
grant execute on function app.ensure_customer_web_account(uuid)
  to fetanagent_customer_web;
grant execute on function app.submit_customer_web_player_registration(uuid, uuid, text)
  to fetanagent_customer_web;
grant execute on function app.list_customer_web_player_registrations(uuid, integer)
  to fetanagent_customer_web;

comment on table app.customer_auth_identities is
  'Immutable one-to-one bindings from a server-verified Supabase Auth UUID to a standalone FetanAgent customer. Email and Telegram identifiers are not accepted or stored.';
comment on table app.customer_web_player_registration_request_origins is
  'Append-only idempotency receipts for customer-web Player-ID requests. Request keys are scoped to one immutable Auth identity and never enable Player-ID ownership association.';
comment on function app.ensure_customer_web_account(uuid) is
  'Creates or replays one standalone customer binding for a server-verified Supabase Auth UUID. It never auto-links Telegram or accepts email.';
comment on function app.submit_customer_web_player_registration(uuid, uuid, text) is
  'Creates or reuses one non-claiming KemerBet Player-ID request with exact request-key replay and bounded customer quotas. It cannot validate, associate, or enable deposits.';
comment on function app.list_customer_web_player_registrations(uuid, integer) is
  'Returns only the caller mapping''s web-origin KemerBet Player-ID requests through a three-value customer-safe status projection.';
comment on role fetanagent_customer_web is
  'FetanAgent customer-web group. NOLOGIN; exact EXECUTE-only account and non-claiming Player-ID procedures with no base-object access.';
comment on role fetanagent_customer_web_runtime is
  'FetanAgent customer-web runtime scaffold. NOLOGIN until separately provisioned; inherits only fetanagent_customer_web and cannot SET ROLE.';

commit;
