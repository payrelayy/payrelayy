-- Owner-controlled KemerBet agent browser-profile revisions.
--
-- This boundary creates only an opaque profile reference for later host-local, supervised sign-in.
-- It never accepts a password, OTP, cookie, session export, agent identifier, or username. It does
-- not provision LOGIN credentials, start the executor, change a feature switch, or move money.

begin;

create table app.private_owner_kemerbet_agent_profile_revisions (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references app.platforms (id) on delete restrict,
  platform_agent_account_id uuid not null unique
    references app.platform_agent_accounts (id) on delete restrict,
  revision integer not null check (revision > 0),
  configuration_request_id uuid not null unique,
  configuration_reason text not null check (configuration_reason in (
    'initial_configuration',
    'agent_rotation',
    'security_recovery',
    'owner_correction'
  )),
  configured_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  profile_contract_version smallint not null check (profile_contract_version = 1),
  configured_at timestamptz not null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint private_owner_kemerbet_agent_profile_revision_key unique (platform_id, revision),
  constraint private_owner_kemerbet_agent_profile_retirement_shape check (
    retired_at is null or retired_at >= configured_at
  )
);

alter table app.private_owner_kemerbet_agent_profile_revisions enable row level security;
alter table app.private_owner_kemerbet_agent_profile_revisions force row level security;

create function app.enforce_owner_kemerbet_agent_profile_revision_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KemerBet agent-profile revisions cannot be deleted.';
  end if;
  if new.id is distinct from old.id
    or new.platform_id is distinct from old.platform_id
    or new.platform_agent_account_id is distinct from old.platform_agent_account_id
    or new.revision is distinct from old.revision
    or new.configuration_request_id is distinct from old.configuration_request_id
    or new.configuration_reason is distinct from old.configuration_reason
    or new.configured_by_admin_id is distinct from old.configured_by_admin_id
    or new.profile_contract_version is distinct from old.profile_contract_version
    or new.configured_at is distinct from old.configured_at
    or new.created_at is distinct from old.created_at then
    raise exception 'KemerBet agent-profile revisions are immutable.';
  end if;
  if old.retired_at is not null or new.retired_at is null then
    raise exception 'A KemerBet agent-profile revision can be retired exactly once.';
  end if;
  return new;
end;
$$;

create trigger private_owner_kemerbet_agent_profile_revision_immutable
before update or delete on app.private_owner_kemerbet_agent_profile_revisions
for each row execute function app.enforce_owner_kemerbet_agent_profile_revision_immutable();

create function app.enforce_owner_configured_kemerbet_agent_account_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
      from app.private_owner_kemerbet_agent_profile_revisions profile
     where profile.platform_agent_account_id = old.id
  ) then
    return new;
  end if;
  if new.id is distinct from old.id
    or new.platform_id is distinct from old.platform_id
    or new.label is distinct from old.label
    or new.credential_ref is distinct from old.credential_ref
    or new.created_at is distinct from old.created_at then
    raise exception 'Owner-configured KemerBet agent accounts are immutable.';
  end if;
  if old.status = 'active' and new.status = 'inactive' then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'The KemerBet agent-profile retirement transition is invalid.';
  end if;
  return new;
end;
$$;

create trigger platform_agent_accounts_owner_configured_immutable
before update on app.platform_agent_accounts
for each row execute function app.enforce_owner_configured_kemerbet_agent_account_immutable();

create function app.require_owner_kemerbet_agent_profile_controller()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if session_user = 'postgres' then
    return;
  end if;
  if session_user <> 'fetanagent_owner_control_runtime'
    or pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member') is not true then
    raise exception 'The Owner KemerBet agent-profile controller is unavailable.';
  end if;
end;
$$;

create function app.list_owner_kemerbet_agent_profiles(p_actor_auth_user_id uuid)
returns table (
  platform_agent_account_id uuid,
  platform_code text,
  profile_label text,
  profile_revision integer,
  profile_status text,
  configured_at timestamptz,
  retired_at timestamptz,
  configuration_reason text,
  profile_contract_version smallint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
begin
  perform app.require_owner_kemerbet_agent_profile_controller();
  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;
  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can inspect KemerBet agent profiles.';
  end if;

  return query
  select agent.id,
         platform.code,
         agent.label,
         profile.revision,
         agent.status::text,
         profile.configured_at,
         profile.retired_at,
         profile.configuration_reason,
         profile.profile_contract_version
    from app.private_owner_kemerbet_agent_profile_revisions profile
    join app.platforms platform on platform.id = profile.platform_id
    join app.platform_agent_accounts agent on agent.id = profile.platform_agent_account_id
   where platform.code = 'kemerbet'
   order by profile.revision desc;
end;
$$;

create function app.prepare_owner_kemerbet_agent_profile(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_configuration_reason text
)
returns table (
  platform_agent_account_id uuid,
  platform_code text,
  profile_label text,
  profile_revision integer,
  profile_status text,
  configured_at timestamptz,
  retired_at timestamptz,
  configuration_reason text,
  profile_contract_version smallint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  configured_at_value timestamptz;
  current_agent app.platform_agent_accounts%rowtype;
  existing_profile app.private_owner_kemerbet_agent_profile_revisions%rowtype;
  kemerbet_platform app.platforms%rowtype;
  new_agent app.platform_agent_accounts%rowtype;
  new_agent_id uuid;
  new_profile app.private_owner_kemerbet_agent_profile_revisions%rowtype;
  next_revision integer;
  switch_count integer;
  switches_disabled boolean;
begin
  perform app.require_owner_kemerbet_agent_profile_controller();
  if p_actor_auth_user_id is null
    or p_request_id is null
    or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_configuration_reason not in (
      'initial_configuration', 'agent_rotation', 'security_recovery', 'owner_correction'
    ) then
    raise exception 'The KemerBet agent-profile preparation request is invalid.';
  end if;

  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for update;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can prepare a KemerBet agent profile.';
  end if;

  perform feature.feature_key
    from app.feature_switches feature
   where feature.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature.feature_key
   for update;
  select count(*)::integer, coalesce(bool_and(feature.mode = 'disabled'), false)
    into switch_count, switches_disabled
    from app.feature_switches feature
   where feature.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   );
  if switch_count <> 5 or not switches_disabled then
    raise exception 'KemerBet agent-profile preparation requires every money switch to be disabled.';
  end if;

  select platform.* into kemerbet_platform
    from app.platforms platform
   where platform.code = 'kemerbet' and platform.status = 'active'
   for update;
  if not found then
    raise exception 'The active KemerBet platform does not exist.';
  end if;
  if exists (
    select 1 from app.private_live_deposit_pilot_revisions pilot
     where pilot.status in ('draft', 'armed')
  ) then
    raise exception 'Stop or discard the private live-money pilot before changing the KemerBet agent profile.';
  end if;

  select profile.* into existing_profile
    from app.private_owner_kemerbet_agent_profile_revisions profile
   where profile.configuration_request_id = p_request_id
   for share;
  if found then
    if existing_profile.configured_by_admin_id <> actor_admin_id
      or existing_profile.platform_id <> kemerbet_platform.id
      or existing_profile.configuration_reason <> p_configuration_reason then
      raise exception 'The KemerBet agent-profile request conflicts with its original use.';
    end if;
    return query
    select agent.id, 'kemerbet'::text, agent.label, existing_profile.revision,
           agent.status::text, existing_profile.configured_at, existing_profile.retired_at,
           existing_profile.configuration_reason, existing_profile.profile_contract_version
      from app.platform_agent_accounts agent
     where agent.id = existing_profile.platform_agent_account_id;
    return;
  end if;

  select agent.* into current_agent
    from app.platform_agent_accounts agent
   where agent.platform_id = kemerbet_platform.id and agent.status = 'active'
   for update;

  select coalesce(max(profile.revision), 0) + 1 into next_revision
    from app.private_owner_kemerbet_agent_profile_revisions profile
   where profile.platform_id = kemerbet_platform.id;
  configured_at_value := pg_catalog.clock_timestamp();

  if current_agent.id is not null then
    update app.private_owner_kemerbet_agent_profile_revisions profile
       set retired_at = configured_at_value
     where profile.platform_agent_account_id = current_agent.id
       and profile.retired_at is null;
    update app.platform_agent_accounts agent
       set status = 'inactive'
     where agent.id = current_agent.id;
  end if;

  new_agent_id := gen_random_uuid();
  insert into app.platform_agent_accounts (
    id, platform_id, label, credential_ref, status, created_at, updated_at
  ) values (
    new_agent_id,
    kemerbet_platform.id,
    'Primary KemerBet agent revision ' || next_revision::text,
    'kemerbet-browser-profile-v1:' || new_agent_id::text,
    'active',
    configured_at_value,
    configured_at_value
  ) returning * into new_agent;

  insert into app.private_owner_kemerbet_agent_profile_revisions (
    platform_id, platform_agent_account_id, revision, configuration_request_id,
    configuration_reason, configured_by_admin_id, profile_contract_version, configured_at
  ) values (
    kemerbet_platform.id, new_agent.id, next_revision, p_request_id,
    p_configuration_reason, actor_admin_id, 1, configured_at_value
  ) returning * into new_profile;

  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', actor_admin_id, 'configuration.kemerbet_agent_profile_prepared',
    'platform_agent_account', new_agent.id,
    pg_catalog.jsonb_build_object(
      'platform_code', 'kemerbet',
      'profile_revision', next_revision,
      'configuration_reason', p_configuration_reason,
      'replaced_profile_id', current_agent.id,
      'profile_contract_version', 1
    )
  );

  return query select new_agent.id, 'kemerbet'::text, new_agent.label, new_profile.revision,
    new_agent.status::text, new_profile.configured_at, new_profile.retired_at,
    new_profile.configuration_reason, new_profile.profile_contract_version;
end;
$$;

alter table app.private_owner_kemerbet_agent_profile_revisions owner to postgres;
alter function app.enforce_owner_kemerbet_agent_profile_revision_immutable() owner to postgres;
alter function app.enforce_owner_configured_kemerbet_agent_account_immutable() owner to postgres;
alter function app.require_owner_kemerbet_agent_profile_controller() owner to postgres;
alter function app.list_owner_kemerbet_agent_profiles(uuid) owner to postgres;
alter function app.prepare_owner_kemerbet_agent_profile(uuid, uuid, text) owner to postgres;

revoke all on table app.private_owner_kemerbet_agent_profile_revisions from public, anon,
  authenticated, service_role, fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime, fetanagent_owner_control,
  fetanagent_owner_control_runtime, fetanagent_player_actions,
  fetanagent_player_actions_runtime, fetanagent_customer_web,
  fetanagent_customer_web_runtime, fetanagent_deposit_executor,
  fetanagent_deposit_executor_runtime, fetanagent_verification_settlement,
  fetanagent_verification_settlement_runtime, fetanagent_trusted_telebirr_verifier,
  fetanagent_trusted_telebirr_verifier_runtime;

revoke all on function
  app.enforce_owner_kemerbet_agent_profile_revision_immutable(),
  app.enforce_owner_configured_kemerbet_agent_account_immutable(),
  app.require_owner_kemerbet_agent_profile_controller(),
  app.list_owner_kemerbet_agent_profiles(uuid),
  app.prepare_owner_kemerbet_agent_profile(uuid, uuid, text)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

grant usage on schema app to fetanagent_owner_control;
grant execute on function
  app.list_owner_kemerbet_agent_profiles(uuid),
  app.prepare_owner_kemerbet_agent_profile(uuid, uuid, text)
to fetanagent_owner_control;

comment on function app.list_owner_kemerbet_agent_profiles(uuid) is
  'Authenticated Owner-only redacted KemerBet browser-profile history. Never returns credential references, browser identity, cookies, passwords, OTPs, usernames, or session material.';
comment on function app.prepare_owner_kemerbet_agent_profile(uuid, uuid, text) is
  'Authenticated Owner-only opaque KemerBet browser-profile revision. Requires all money switches disabled and never enables login, polling, execution, final action, or money movement.';

commit;
