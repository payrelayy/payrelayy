-- Owner-managed, non-financial website destinations keyed by platform.
-- A verified Player's platform chooses the route; a customer-provided URL never does.
-- Rollback: set the affected platform URL to null through the audited Owner route,
-- then roll back the HTTP/bot release. Leave this table and its revision history in
-- place so old Telegram buttons fail closed and no audit entry is discarded.
-- Reconciliation: this setting has no payment claim, credit, SMS, or financial
-- switch effect. Check the current URL and latest revision before restoring Play.
begin;

create table app.private_platform_play_destinations (
  platform_id uuid primary key references app.platforms (id) on delete restrict,
  destination_url text check (
    destination_url is null or
    (char_length(destination_url) between 12 and 2048 and
     destination_url like 'https://%' and
     destination_url !~ '[[:space:][:cntrl:]]')
  ),
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz,
  check ((revision = 0 and updated_at is null) or (revision > 0 and updated_at is not null))
);

create table app.private_platform_play_destination_revisions (
  platform_id uuid not null references app.platforms (id) on delete restrict,
  revision integer not null check (revision > 0),
  previous_url text,
  destination_url text,
  changed_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  changed_at timestamptz not null,
  primary key (platform_id, revision),
  check (previous_url is distinct from destination_url)
);

create index private_platform_play_destination_revisions_actor_idx
  on app.private_platform_play_destination_revisions (changed_by_admin_id);

alter table app.private_platform_play_destinations owner to postgres;
alter table app.private_platform_play_destination_revisions owner to postgres;
alter table app.private_platform_play_destinations enable row level security;
alter table app.private_platform_play_destinations force row level security;
alter table app.private_platform_play_destination_revisions enable row level security;
alter table app.private_platform_play_destination_revisions force row level security;
revoke all on table app.private_platform_play_destinations,
  app.private_platform_play_destination_revisions
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime;

-- The Owner supplied this launch destination. Revision zero is a migration baseline.
insert into app.private_platform_play_destinations
  (platform_id, destination_url, revision, updated_at)
select platform.id, 'https://kemer.co/', 0, null
  from app.platforms platform
 where platform.code = 'kemerbet';

create function app.reject_platform_play_destination_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501',
    message = 'Platform Play destination history is append-only.';
end;
$$;

create trigger platform_play_destination_history_immutable
before update or delete on app.private_platform_play_destination_revisions
for each row execute function app.reject_platform_play_destination_revision_mutation();
create trigger platform_play_destination_history_no_truncate
before truncate on app.private_platform_play_destination_revisions
for each statement execute function app.reject_platform_play_destination_revision_mutation();

create function app.get_owner_platform_play_destination(
  p_actor_auth_user_id uuid,
  p_platform_code text
)
returns table (platform_code text, destination_url text, revision integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  begin
    perform app.require_owner_kemerbet_agent_profile_controller();
  exception when raise_exception then
    raise exception using errcode = '42501', message = 'The Owner Play controller is required.';
  end;

  if not exists (
    select 1 from app.admin_users admin_user
     where admin_user.auth_user_id = p_actor_auth_user_id
       and admin_user.role = 'owner' and admin_user.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;

  return query
    select platform.code, destination.destination_url,
           coalesce(destination.revision, 0), destination.updated_at
      from app.platforms platform
      left join app.private_platform_play_destinations destination
        on destination.platform_id = platform.id
     where platform.code = p_platform_code and platform.status = 'active';
end;
$$;

create function app.set_owner_platform_play_destination(
  p_actor_auth_user_id uuid,
  p_platform_code text,
  p_destination_url text,
  p_expected_revision integer
)
returns table (platform_code text, destination_url text, revision integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  selected_platform_id uuid;
  current_destination app.private_platform_play_destinations%rowtype;
  next_changed_at timestamptz;
begin
  begin
    perform app.require_owner_kemerbet_agent_profile_controller();
  exception when raise_exception then
    raise exception using errcode = '42501', message = 'The Owner Play controller is required.';
  end;

  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner' and admin_user.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;
  if p_platform_code is null or
     p_platform_code collate "C" !~ '^[a-z0-9_]{1,64}$' or
     p_expected_revision is null or p_expected_revision < 0 or
     (p_destination_url is not null and
      (char_length(p_destination_url) not between 12 and 2048 or
       p_destination_url not like 'https://%' or
       p_destination_url ~ '[[:space:][:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'Invalid platform Play destination.';
  end if;

  select platform.id into selected_platform_id
    from app.platforms platform
   where platform.code = p_platform_code and platform.status = 'active'
   for share;
  if selected_platform_id is null then
    raise exception using errcode = '22023', message = 'Unknown active platform.';
  end if;

  insert into app.private_platform_play_destinations
    (platform_id, destination_url, revision, updated_at)
  values (selected_platform_id, null, 0, null)
  on conflict (platform_id) do nothing;

  select destination.* into strict current_destination
    from app.private_platform_play_destinations destination
   where destination.platform_id = selected_platform_id
   for update;
  if current_destination.revision <> p_expected_revision then
    raise exception using errcode = '40001',
      message = 'The platform Play destination changed. Reload before saving.';
  end if;
  if current_destination.destination_url is not distinct from p_destination_url then
    return query select p_platform_code, current_destination.destination_url,
      current_destination.revision, current_destination.updated_at;
    return;
  end if;
  if current_destination.revision = 2147483647 then
    raise exception using errcode = '22023', message = 'The Play revision limit was reached.';
  end if;

  next_changed_at := pg_catalog.clock_timestamp();
  insert into app.private_platform_play_destination_revisions
    (platform_id, revision, previous_url, destination_url, changed_by_admin_id, changed_at)
  values (selected_platform_id, current_destination.revision + 1,
    current_destination.destination_url, p_destination_url, actor_admin_id, next_changed_at);
  update app.private_platform_play_destinations destination
     set destination_url = p_destination_url,
         revision = current_destination.revision + 1,
         updated_at = next_changed_at
   where destination.platform_id = selected_platform_id;

  return query select p_platform_code, destination.destination_url,
    destination.revision, destination.updated_at
    from app.private_platform_play_destinations destination
   where destination.platform_id = selected_platform_id;
end;
$$;

-- The public HTTP handler uses this narrow read to redirect. No database role
-- used by a browser or customer can read the table or call this function.
create function app.get_public_platform_play_destination(p_platform_code text)
returns table (destination_url text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  begin
    perform app.require_owner_kemerbet_agent_profile_controller();
  exception when raise_exception then
    raise exception using errcode = '42501', message = 'The Owner Play controller is required.';
  end;

  return query
    select destination.destination_url
      from app.platforms platform
      left join app.private_platform_play_destinations destination
        on destination.platform_id = platform.id
     where platform.code = p_platform_code and platform.status = 'active';
end;
$$;

alter function app.reject_platform_play_destination_revision_mutation() owner to postgres;
alter function app.get_owner_platform_play_destination(uuid, text) owner to postgres;
alter function app.set_owner_platform_play_destination(uuid, text, text, integer) owner to postgres;
alter function app.get_public_platform_play_destination(text) owner to postgres;

revoke all on function app.reject_platform_play_destination_revision_mutation(),
  app.get_owner_platform_play_destination(uuid, text),
  app.set_owner_platform_play_destination(uuid, text, text, integer),
  app.get_public_platform_play_destination(text)
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime;
grant execute on function app.get_owner_platform_play_destination(uuid, text),
  app.set_owner_platform_play_destination(uuid, text, text, integer),
  app.get_public_platform_play_destination(text)
  to fetanagent_owner_control;

comment on function app.set_owner_platform_play_destination(uuid, text, text, integer) is
  'Owner-controlled, audited Play website per platform. No payment, claim, or credit authority.';

commit;
