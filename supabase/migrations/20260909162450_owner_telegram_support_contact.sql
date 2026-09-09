-- Owner-editable public support contact. This is configuration only: no payment,
-- player, deposit, credential, or Telegram message-sending authority is added.
begin;

create table app.private_support_contact (
  singleton boolean primary key default true check (singleton),
  telegram_username text check (
    telegram_username is null
    or telegram_username collate "C" ~ '^[a-z0-9_]{5,32}$'
  ),
  revision integer not null check (revision >= 0),
  updated_at timestamptz,
  check (
    (revision = 0 and telegram_username is null and updated_at is null)
    or (revision > 0 and updated_at is not null)
  )
);

create table app.private_support_contact_revisions (
  revision integer primary key check (revision > 0),
  previous_username text check (
    previous_username is null
    or previous_username collate "C" ~ '^[a-z0-9_]{5,32}$'
  ),
  telegram_username text check (
    telegram_username is null
    or telegram_username collate "C" ~ '^[a-z0-9_]{5,32}$'
  ),
  changed_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  changed_at timestamptz not null,
  check (previous_username is distinct from telegram_username)
);

create index private_support_contact_revisions_actor_idx
  on app.private_support_contact_revisions (changed_by_admin_id);

alter table app.private_support_contact owner to postgres;
alter table app.private_support_contact_revisions owner to postgres;
alter table app.private_support_contact enable row level security;
alter table app.private_support_contact force row level security;
alter table app.private_support_contact_revisions enable row level security;
alter table app.private_support_contact_revisions force row level security;
revoke all on table app.private_support_contact, app.private_support_contact_revisions
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime;

-- No invented contact or migration-time Owner attribution. Revision zero is the
-- disabled baseline; only actual Owner changes create history rows.
insert into app.private_support_contact (singleton, telegram_username, revision, updated_at)
values (true, null, 0, null);

create function app.reject_support_contact_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501', message = 'Support contact history is append-only.';
end;
$$;

create trigger support_contact_history_immutable
before update or delete on app.private_support_contact_revisions
for each row execute function app.reject_support_contact_revision_mutation();
create trigger support_contact_history_no_truncate
before truncate on app.private_support_contact_revisions
for each statement execute function app.reject_support_contact_revision_mutation();

create function app.get_owner_support_contact(p_actor_auth_user_id uuid)
returns table (telegram_username text, revision integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  begin
    perform app.require_owner_kemerbet_agent_profile_controller();
  exception when raise_exception then
    raise exception using errcode = '42501', message = 'The Owner support controller is required.';
  end;

  if not exists (
    select 1 from app.admin_users admin_user
     where admin_user.auth_user_id = p_actor_auth_user_id
       and admin_user.role = 'owner' and admin_user.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;

  return query select contact.telegram_username, contact.revision, contact.updated_at
    from app.private_support_contact contact where contact.singleton;
end;
$$;

create function app.set_owner_support_contact(
  p_actor_auth_user_id uuid,
  p_telegram_username text,
  p_expected_revision integer
)
returns table (telegram_username text, revision integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  current_contact app.private_support_contact%rowtype;
  next_changed_at timestamptz;
begin
  begin
    perform app.require_owner_kemerbet_agent_profile_controller();
  exception when raise_exception then
    raise exception using errcode = '42501', message = 'The Owner support controller is required.';
  end;

  -- Lock the Owner before the singleton, in a consistent order. A concurrent
  -- Owner deactivation must finish before authorization, or wait for this save.
  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner' and admin_user.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;

  if p_expected_revision is null or p_expected_revision < 0
    or (p_telegram_username is not null
        and p_telegram_username collate "C" !~ '^[a-z0-9_]{5,32}$') then
    raise exception using errcode = '22023', message = 'Invalid support contact configuration.';
  end if;

  select contact.* into strict current_contact
    from app.private_support_contact contact where contact.singleton
    for update;
  if current_contact.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'The support contact changed. Reload before saving.';
  end if;

  -- Stale requests are rejected above even if their proposed value now matches.
  if current_contact.telegram_username is not distinct from p_telegram_username then
    return query select current_contact.telegram_username, current_contact.revision, current_contact.updated_at;
    return;
  end if;
  if current_contact.revision = 2147483647 then
    raise exception using errcode = '22023', message = 'The support contact revision limit was reached.';
  end if;

  next_changed_at := pg_catalog.clock_timestamp();
  insert into app.private_support_contact_revisions (
    revision, previous_username, telegram_username, changed_by_admin_id, changed_at
  ) values (
    current_contact.revision + 1, current_contact.telegram_username,
    p_telegram_username, actor_admin_id, next_changed_at
  );
  update app.private_support_contact contact
     set telegram_username = p_telegram_username,
         revision = current_contact.revision + 1,
         updated_at = next_changed_at
   where contact.singleton;

  return query select contact.telegram_username, contact.revision, contact.updated_at
    from app.private_support_contact contact where contact.singleton;
end;
$$;

-- "Public" describes the redacted response, not database permissions. Only the
-- server's existing Owner-control role may fetch it for the unauthenticated UI.
create function app.get_public_support_contact()
returns table (telegram_username text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  begin
    perform app.require_owner_kemerbet_agent_profile_controller();
  exception when raise_exception then
    raise exception using errcode = '42501', message = 'The Owner support controller is required.';
  end;

  return query select contact.telegram_username
    from app.private_support_contact contact where contact.singleton;
end;
$$;

alter function app.reject_support_contact_revision_mutation() owner to postgres;
alter function app.get_owner_support_contact(uuid) owner to postgres;
alter function app.set_owner_support_contact(uuid, text, integer) owner to postgres;
alter function app.get_public_support_contact() owner to postgres;

revoke all on function app.reject_support_contact_revision_mutation(),
  app.get_owner_support_contact(uuid), app.set_owner_support_contact(uuid, text, integer),
  app.get_public_support_contact()
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime;
grant execute on function app.get_owner_support_contact(uuid),
  app.set_owner_support_contact(uuid, text, integer), app.get_public_support_contact()
  to fetanagent_owner_control;

comment on function app.set_owner_support_contact(uuid, text, integer) is
  'Active Owner support-contact configuration; row-locked expected revision and atomic immutable history, with no financial authority.';

commit;
