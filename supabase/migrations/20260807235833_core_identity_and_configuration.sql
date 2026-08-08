-- PayReplayy Stage 1: private identity, configuration, audit, and access foundation.
--
-- This schema is intentionally outside `public`. The customer bot and the future Owner/Admin
-- dashboard must call the PayReplayy API; they must not query financial base tables directly.

begin;

create schema app;

-- No Supabase Data API role receives access to this private schema. A later deployment
-- migration will create narrowly scoped direct-Postgres roles for the API and worker.
revoke all on schema app from public, anon, authenticated, service_role;

create type app.admin_role as enum ('owner', 'administrator');
create type app.record_status as enum ('active', 'inactive', 'blocked', 'archived');
create type app.actor_kind as enum ('customer', 'admin', 'system', 'worker');
create type app.feature_mode as enum ('disabled', 'dry_run', 'live');

create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table app.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  role app.admin_role not null,
  status app.record_status not null default 'active',
  display_name text,
  created_by_admin_id uuid references app.admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index admin_users_one_active_owner_idx
  on app.admin_users (role)
  where role = 'owner' and status = 'active';

create index admin_users_active_status_idx
  on app.admin_users (status, role)
  where status = 'active';

create function app.prevent_last_active_owner_removal()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  owner_is_being_removed boolean := false;
begin
  if current_setting('app.owner_transfer', true) = 'on' then
    if tg_op = 'delete' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'delete' then
    owner_is_being_removed := old.role = 'owner' and old.status = 'active';
  else
    owner_is_being_removed := old.role = 'owner'
      and old.status = 'active'
      and (new.role <> 'owner' or new.status <> 'active');
  end if;

  if owner_is_being_removed and not exists (
    select 1
    from app.admin_users
    where id <> old.id
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'PayReplayy must retain at least one active Owner.';
  end if;

  if tg_op = 'delete' then
    return old;
  end if;

  return new;
end;
$$;

create trigger admin_users_keep_an_owner
before update or delete on app.admin_users
for each row
execute function app.prevent_last_active_owner_removal();

create trigger admin_users_set_updated_at
before update on app.admin_users
for each row
execute function app.set_updated_at();

create table app.customers (
  id uuid primary key default gen_random_uuid(),
  status app.record_status not null default 'active',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_set_updated_at
before update on app.customers
for each row
execute function app.set_updated_at();

create table app.customer_identities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references app.customers (id) on delete restrict,
  identity_kind text not null check (identity_kind = lower(btrim(identity_kind))),
  external_subject text not null,
  status app.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_identities_kind_subject_key unique (identity_kind, external_subject)
);

create index customer_identities_customer_id_idx
  on app.customer_identities (customer_id);

create trigger customer_identities_set_updated_at
before update on app.customer_identities
for each row
execute function app.set_updated_at();

-- A Telegram identity depends on the parent identity kind and customer. Those fields cannot
-- be retargeted after creation; only lifecycle metadata such as status may change.
create function app.enforce_customer_identity_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.customer_id is distinct from old.customer_id
    or new.identity_kind is distinct from old.identity_kind
    or new.external_subject is distinct from old.external_subject then
    raise exception 'Customer identity bindings are immutable.';
  end if;

  return new;
end;
$$;

create trigger customer_identities_immutable_binding
before update on app.customer_identities
for each row
execute function app.enforce_customer_identity_immutable();

create table app.telegram_identities (
  customer_identity_id uuid primary key references app.customer_identities (id) on delete restrict,
  telegram_user_id bigint not null unique check (telegram_user_id > 0),
  private_chat_id bigint not null unique check (private_chat_id > 0),
  username text,
  first_name text,
  last_name text,
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'am')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function app.enforce_telegram_identity_parent()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if not exists (
    select 1
    from app.customer_identities
    where id = new.customer_identity_id
      and identity_kind = 'telegram'
  ) then
    raise exception 'Telegram identities must extend a telegram customer identity.';
  end if;

  return new;
end;
$$;

create trigger telegram_identities_require_telegram_parent
before insert or update of customer_identity_id on app.telegram_identities
for each row
execute function app.enforce_telegram_identity_parent();

create trigger telegram_identities_set_updated_at
before update on app.telegram_identities
for each row
execute function app.set_updated_at();

create table app.inbound_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel = lower(btrim(channel))),
  external_event_id text not null,
  customer_identity_id uuid references app.customer_identities (id) on delete restrict,
  payload_digest text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error_code text,
  constraint inbound_events_channel_external_event_key unique (channel, external_event_id)
);

create index inbound_events_customer_received_idx
  on app.inbound_events (customer_identity_id, received_at desc)
  where customer_identity_id is not null;

create table app.bot_conversations (
  id uuid primary key default gen_random_uuid(),
  telegram_identity_id uuid not null unique
    references app.telegram_identities (customer_identity_id) on delete restrict,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger bot_conversations_set_updated_at
before update on app.bot_conversations
for each row
execute function app.set_updated_at();

create table app.blocked_entities (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null check (entity_kind = lower(btrim(entity_kind))),
  entity_reference text not null,
  reason_code text not null,
  expires_at timestamptz,
  created_by_admin_id uuid references app.admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_admin_id uuid references app.admin_users (id) on delete set null
);

create index blocked_entities_active_lookup_idx
  on app.blocked_entities (entity_kind, entity_reference)
  where revoked_at is null;

create table app.platforms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = lower(btrim(code)) and code ~ '^[a-z0-9_]+$'),
  display_name text not null,
  status app.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger platforms_set_updated_at
before update on app.platforms
for each row
execute function app.set_updated_at();

create table app.platform_agent_accounts (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references app.platforms (id) on delete restrict,
  label text not null,
  credential_ref text not null,
  status app.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_agent_accounts_platform_label_key unique (platform_id, label)
);

create unique index platform_agent_accounts_one_active_platform_idx
  on app.platform_agent_accounts (platform_id)
  where status = 'active';

create trigger platform_agent_accounts_set_updated_at
before update on app.platform_agent_accounts
for each row
execute function app.set_updated_at();

create table app.payment_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = lower(btrim(code)) and code ~ '^[a-z0-9_]+$'),
  display_name text not null,
  adapter_key text not null,
  status app.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payment_providers_set_updated_at
before update on app.payment_providers
for each row
execute function app.set_updated_at();

create table app.receiver_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references app.payment_providers (id) on delete restrict,
  version integer not null check (version > 0),
  account_holder_name text not null,
  account_reference_ciphertext text not null,
  verification_reference_ciphertext text,
  account_reference_masked text not null,
  instructions jsonb not null default '{}'::jsonb check (jsonb_typeof(instructions) = 'object'),
  status app.record_status not null default 'active',
  active_from timestamptz not null default now(),
  retired_at timestamptz,
  created_by_admin_id uuid references app.admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receiver_accounts_provider_version_key unique (provider_id, version),
  constraint receiver_accounts_retirement_after_activation
    check (retired_at is null or retired_at >= active_from),
  constraint receiver_accounts_active_retirement_shape
    check ((status = 'active') = (retired_at is null))
);

create unique index receiver_accounts_one_active_provider_idx
  on app.receiver_accounts (provider_id)
  where status = 'active';

create index receiver_accounts_provider_status_idx
  on app.receiver_accounts (provider_id, status, active_from desc);

create trigger receiver_accounts_set_updated_at
before update on app.receiver_accounts
for each row
execute function app.set_updated_at();

create function app.enforce_receiver_account_revision_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.provider_id is distinct from old.provider_id
    or new.version is distinct from old.version
    or new.account_holder_name is distinct from old.account_holder_name
    or new.account_reference_ciphertext is distinct from old.account_reference_ciphertext
    or new.verification_reference_ciphertext is distinct from old.verification_reference_ciphertext
    or new.account_reference_masked is distinct from old.account_reference_masked
    or new.instructions is distinct from old.instructions
    or new.active_from is distinct from old.active_from then
    raise exception 'Receiver account revisions are immutable. Create a new version instead.';
  end if;

  if old.status <> 'active' and new.status = 'active' then
    raise exception 'A retired receiver account revision cannot be reactivated.';
  end if;

  return new;
end;
$$;

create trigger receiver_accounts_immutable_revision
before update on app.receiver_accounts
for each row
execute function app.enforce_receiver_account_revision_immutable();

create table app.deposit_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  minimum_amount_minor bigint not null check (minimum_amount_minor >= 0),
  maximum_amount_minor bigint not null check (maximum_amount_minor >= minimum_amount_minor),
  freshness_window_seconds integer not null check (freshness_window_seconds between 60 and 86400),
  status app.record_status not null default 'active',
  retired_at timestamptz,
  created_by_admin_id uuid references app.admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_policy_versions_active_retirement_shape
    check ((status = 'active') = (retired_at is null))
);

create unique index deposit_policy_versions_one_active_idx
  on app.deposit_policy_versions ((status))
  where status = 'active';

create function app.enforce_deposit_policy_revision_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if new.version is distinct from old.version
    or new.minimum_amount_minor is distinct from old.minimum_amount_minor
    or new.maximum_amount_minor is distinct from old.maximum_amount_minor
    or new.freshness_window_seconds is distinct from old.freshness_window_seconds then
    raise exception 'Deposit policy revisions are immutable. Create a new version instead.';
  end if;

  if old.status <> 'active' and new.status = 'active' then
    raise exception 'A retired deposit policy revision cannot be reactivated.';
  end if;

  return new;
end;
$$;

create trigger deposit_policy_versions_immutable_revision
before update on app.deposit_policy_versions
for each row
execute function app.enforce_deposit_policy_revision_immutable();

create trigger deposit_policy_versions_set_updated_at
before update on app.deposit_policy_versions
for each row
execute function app.set_updated_at();

create table app.feature_switches (
  feature_key text primary key check (feature_key = lower(btrim(feature_key))),
  mode app.feature_mode not null default 'disabled',
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by_admin_id uuid references app.admin_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger feature_switches_set_updated_at
before update on app.feature_switches
for each row
execute function app.set_updated_at();

insert into app.platforms (code, display_name)
values ('kemerbet', 'KemerBet');

insert into app.payment_providers (code, display_name, adapter_key)
values
  ('telebirr', 'TeleBirr', 'telebirr'),
  ('cbe_birr', 'CBE Birr', 'cbe_birr');

insert into app.deposit_policy_versions (
  version,
  minimum_amount_minor,
  maximum_amount_minor,
  freshness_window_seconds
)
values (1, 2500, 2500000, 3600);

insert into app.feature_switches (feature_key, mode)
values
  ('payment_verification', 'disabled'),
  ('deposit_execution', 'disabled'),
  ('withdrawal_validation', 'disabled'),
  ('withdrawal_collection', 'disabled');

create table app.audit_events (
  id bigint generated always as identity primary key,
  actor_kind app.actor_kind not null,
  actor_admin_id uuid references app.admin_users (id) on delete restrict,
  actor_customer_id uuid references app.customers (id) on delete restrict,
  actor_label text,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint audit_events_actor_shape_check check (
    (actor_kind = 'admin' and actor_admin_id is not null and actor_customer_id is null)
    or (actor_kind = 'customer' and actor_customer_id is not null and actor_admin_id is null)
    or (actor_kind in ('system', 'worker') and actor_admin_id is null and actor_customer_id is null)
  )
);

create index audit_events_resource_created_idx
  on app.audit_events (resource_type, resource_id, created_at desc);

create index audit_events_actor_created_idx
  on app.audit_events (actor_kind, created_at desc);

create function app.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Audit events are append-only.';
end;
$$;

create function app.reject_audit_event_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Audit events cannot be truncated.';
end;
$$;

create trigger audit_events_immutable
before update or delete on app.audit_events
for each row
execute function app.reject_audit_event_mutation();

create trigger audit_events_no_truncate
before truncate on app.audit_events
for each statement
execute function app.reject_audit_event_truncate();

create function app.bootstrap_first_owner(
  p_auth_user_id uuid,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, auth, pg_temp
as $$
declare
  new_admin_id uuid;
begin
  if exists (
    select 1 from app.admin_users where role = 'owner' and status = 'active'
  ) then
    raise exception 'An active Owner already exists.';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'The requested Supabase Auth user does not exist.';
  end if;

  insert into app.admin_users (auth_user_id, role, status, display_name)
  values (p_auth_user_id, 'owner', 'active', p_display_name)
  returning id into new_admin_id;

  insert into app.audit_events (
    actor_kind,
    actor_label,
    action,
    resource_type,
    resource_id
  )
  values ('system', 'owner-bootstrap', 'admin.owner_bootstrapped', 'admin_user', new_admin_id);

  return new_admin_id;
end;
$$;

create function app.transfer_owner(
  p_actor_admin_id uuid,
  p_from_admin_id uuid,
  p_to_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if p_from_admin_id = p_to_admin_id then
    raise exception 'Owner transfer requires two different administrators.';
  end if;

  perform 1
  from app.admin_users
  where id in (p_actor_admin_id, p_from_admin_id, p_to_admin_id)
  for update;

  if not exists (
    select 1
    from app.admin_users
    where id = p_actor_admin_id
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'Only an active Owner can transfer ownership.';
  end if;

  if not exists (
    select 1
    from app.admin_users
    where id = p_from_admin_id
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'The source administrator is not the active Owner.';
  end if;

  if not exists (
    select 1
    from app.admin_users
    where id = p_to_admin_id
      and role = 'administrator'
      and status = 'active'
  ) then
    raise exception 'The destination must be an active Administrator.';
  end if;

  perform set_config('app.owner_transfer', 'on', true);

  update app.admin_users
  set role = 'administrator'
  where id = p_from_admin_id;

  update app.admin_users
  set role = 'owner'
  where id = p_to_admin_id;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'admin',
    p_actor_admin_id,
    'admin.owner_transferred',
    'admin_user',
    p_to_admin_id,
    jsonb_build_object('from_admin_id', p_from_admin_id)
  );
end;
$$;

create function app.set_feature_switch(
  p_actor_admin_id uuid,
  p_feature_key text,
  p_mode app.feature_mode,
  p_settings jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Feature settings must be a JSON object.';
  end if;

  -- A database flag cannot turn on unreviewed money movement. The migration that introduces a
  -- live executor must replace this guard only after verification and reconciliation are proven.
  if p_mode = 'live' then
    raise exception 'Live feature switches are not available in this release.';
  end if;

  if not exists (
    select 1
    from app.admin_users
    where id = p_actor_admin_id
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'Only an active Owner can change a feature switch.';
  end if;

  update app.feature_switches
  set mode = p_mode,
      settings = p_settings,
      updated_by_admin_id = p_actor_admin_id
  where feature_key = lower(btrim(p_feature_key));

  if not found then
    raise exception 'The feature switch does not exist.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'admin',
    p_actor_admin_id,
    'configuration.feature_switch_changed',
    'feature_switch',
    null,
    jsonb_build_object('feature_key', lower(btrim(p_feature_key)), 'mode', p_mode)
  );
end;
$$;

create function app.replace_receiver_account(
  p_actor_admin_id uuid,
  p_provider_id uuid,
  p_account_holder_name text,
  p_account_reference_ciphertext text,
  p_verification_reference_ciphertext text,
  p_account_reference_masked text,
  p_instructions jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  next_version integer;
  new_receiver_id uuid;
begin
  if p_instructions is null or jsonb_typeof(p_instructions) <> 'object' then
    raise exception 'Receiver instructions must be a JSON object.';
  end if;

  if p_account_holder_name is null
    or p_account_reference_ciphertext is null
    or p_account_reference_masked is null
    or btrim(p_account_holder_name) = ''
    or btrim(p_account_reference_ciphertext) = ''
    or btrim(p_account_reference_masked) = '' then
    raise exception 'Receiver account details must not be empty.';
  end if;

  if not exists (
    select 1
    from app.admin_users
    where id = p_actor_admin_id
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'Only an active Owner can replace a receiver account.';
  end if;

  perform 1
  from app.payment_providers
  where id = p_provider_id
  for update;

  if not found then
    raise exception 'The payment provider does not exist.';
  end if;

  select coalesce(max(version), 0) + 1
  into next_version
  from app.receiver_accounts
  where provider_id = p_provider_id;

  update app.receiver_accounts
  set status = 'inactive',
      retired_at = now()
  where provider_id = p_provider_id
    and status = 'active';

  insert into app.receiver_accounts (
    provider_id,
    version,
    account_holder_name,
    account_reference_ciphertext,
    verification_reference_ciphertext,
    account_reference_masked,
    instructions,
    created_by_admin_id
  )
  values (
    p_provider_id,
    next_version,
    p_account_holder_name,
    p_account_reference_ciphertext,
    p_verification_reference_ciphertext,
    p_account_reference_masked,
    p_instructions,
    p_actor_admin_id
  )
  returning id into new_receiver_id;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'admin',
    p_actor_admin_id,
    'configuration.receiver_account_replaced',
    'receiver_account',
    new_receiver_id,
    jsonb_build_object('provider_id', p_provider_id, 'version', next_version)
  );

  return new_receiver_id;
end;
$$;

create function app.set_deposit_policy(
  p_actor_admin_id uuid,
  p_minimum_amount_minor bigint,
  p_maximum_amount_minor bigint,
  p_freshness_window_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  next_version integer;
  new_policy_id uuid;
begin
  if not exists (
    select 1
    from app.admin_users
    where id = p_actor_admin_id
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'Only an active Owner can change the deposit policy.';
  end if;

  perform 1
  from app.deposit_policy_versions
  where status = 'active'
  for update;

  select coalesce(max(version), 0) + 1
  into next_version
  from app.deposit_policy_versions;

  update app.deposit_policy_versions
  set status = 'inactive',
      retired_at = now()
  where status = 'active';

  insert into app.deposit_policy_versions (
    version,
    minimum_amount_minor,
    maximum_amount_minor,
    freshness_window_seconds,
    created_by_admin_id
  )
  values (
    next_version,
    p_minimum_amount_minor,
    p_maximum_amount_minor,
    p_freshness_window_seconds,
    p_actor_admin_id
  )
  returning id into new_policy_id;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'admin',
    p_actor_admin_id,
    'configuration.deposit_policy_replaced',
    'deposit_policy',
    new_policy_id,
    jsonb_build_object('version', next_version)
  );

  return new_policy_id;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-evidence',
  'payment-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
);

revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all sequences in schema app from public, anon, authenticated, service_role;
revoke all on all functions in schema app from public, anon, authenticated, service_role;

alter default privileges in schema app revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema app revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated, service_role;

alter table app.admin_users enable row level security;
alter table app.admin_users force row level security;
alter table app.customers enable row level security;
alter table app.customers force row level security;
alter table app.customer_identities enable row level security;
alter table app.customer_identities force row level security;
alter table app.telegram_identities enable row level security;
alter table app.telegram_identities force row level security;
alter table app.inbound_events enable row level security;
alter table app.inbound_events force row level security;
alter table app.bot_conversations enable row level security;
alter table app.bot_conversations force row level security;
alter table app.blocked_entities enable row level security;
alter table app.blocked_entities force row level security;
alter table app.platforms enable row level security;
alter table app.platforms force row level security;
alter table app.platform_agent_accounts enable row level security;
alter table app.platform_agent_accounts force row level security;
alter table app.payment_providers enable row level security;
alter table app.payment_providers force row level security;
alter table app.receiver_accounts enable row level security;
alter table app.receiver_accounts force row level security;
alter table app.deposit_policy_versions enable row level security;
alter table app.deposit_policy_versions force row level security;
alter table app.feature_switches enable row level security;
alter table app.feature_switches force row level security;
alter table app.audit_events enable row level security;
alter table app.audit_events force row level security;

revoke all on function app.set_updated_at() from public;
revoke all on function app.prevent_last_active_owner_removal() from public;
revoke all on function app.enforce_receiver_account_revision_immutable() from public;
revoke all on function app.enforce_deposit_policy_revision_immutable() from public;
revoke all on function app.reject_audit_event_mutation() from public;
revoke all on function app.reject_audit_event_truncate() from public;
revoke all on function app.enforce_telegram_identity_parent() from public;
revoke all on function app.enforce_customer_identity_immutable() from public;

comment on schema app is
  'PayReplayy private financial schema. It is deliberately not exposed through the Supabase Data API.';
comment on table app.receiver_accounts is
  'Receiver account revisions are immutable once used. Create a new version instead of replacing values.';
comment on table app.deposit_policy_versions is
  'Owner-configurable deposit policy revisions. Deposit intents must snapshot their selected revision.';
comment on table app.audit_events is
  'Append-only audit log. Do not store raw payment receipts, withdrawal codes, payout accounts, credentials, or tokens in metadata.';

commit;
