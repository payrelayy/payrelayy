-- Disabled runtime identity for a future independently reviewed execution activation.
-- No login, password, capability membership, function grant, or execution control is enabled.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create role fetanagent_companion_execution_bridge_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  valid until 'infinity';

do $fetanagent$
begin
  if not exists (
    select 1
      from pg_catalog.pg_authid role
     where role.rolname = 'fetanagent_companion_execution_bridge_runtime'
       and not role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolpassword is null
       and role.rolvaliduntil = 'infinity'::timestamptz
  ) or exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member on member.oid = membership.member
     where member.rolname = 'fetanagent_companion_execution_bridge_runtime'
  ) then
    raise exception 'The companion execution runtime must remain disabled and memberless.';
  end if;
end
$fetanagent$;

-- A future arm must use this same lifecycle advisory key. Credential removal and control
-- fencing commit together; an independent operator script then drains existing sessions.
create function app.disable_agent_platform_companion_execution_transport()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  control app.agent_platform_companion_execution_control%rowtype;
  was_active boolean;
  non_admin_member text;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can disable companion execution.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
  );

  execute 'alter role fetanagent_companion_execution_bridge_runtime with '
    || 'nologin noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password null valid until ''infinity''';
  execute 'alter role fetanagent_companion_execution_bridge with '
    || 'nologin noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password null valid until ''infinity''';
  for non_admin_member in
    select member.rolname
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
     where granted.rolname = 'fetanagent_companion_execution_bridge'
       and member.rolname <> 'postgres'
  loop
    execute pg_catalog.format(
      'revoke fetanagent_companion_execution_bridge from %I', non_admin_member
    );
  end loop;

  select execution_control.* into control
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
   for update;
  if control.singleton is null then
    raise exception 'The companion execution control is unavailable.';
  end if;
  was_active := control.control_state = 'active';

  if was_active then
    update app.agent_platform_companion_execution_control execution_control
       set control_state = 'disabled',
           certificate_id = null,
           device_id = null,
           device_key_id = null,
           no_money_signer_key_id = null,
           execution_signer_key_id = null,
           execution_signer_public_key_spki = null,
           execution_signer_public_key_spki_sha256 = null,
           platform_agent_account_id = null,
           pilot_revision_id = null,
           pilot_revision = null,
           pilot_configuration_digest = null,
           activation_epoch = null,
           active_from = null,
           expires_at = null,
           activated_by_admin_id = null,
           activated_at = null,
           disabled_at = null,
           disable_reason_code = null,
           updated_at = pg_catalog.clock_timestamp()
     where execution_control.singleton;
  end if;

  if exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
     where granted.rolname = 'fetanagent_companion_execution_bridge'
       and member.rolname <> 'postgres'
  ) or (
    select pg_catalog.count(*)
      from pg_catalog.pg_authid role
     where role.rolname in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     )
       and not role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolpassword is null
  ) <> 2 or not exists (
    select 1
      from app.agent_platform_companion_execution_control execution_control
     where execution_control.singleton
       and execution_control.control_state = 'disabled'
       and execution_control.activation_epoch is null
       and execution_control.pilot_revision_id is null
  ) then
    raise exception 'The companion execution transport disablement is incomplete.';
  end if;

  return was_active;
end;
$$;

alter function app.disable_agent_platform_companion_execution_transport() owner to postgres;
revoke all on function app.disable_agent_platform_companion_execution_transport()
  from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on role fetanagent_companion_execution_bridge_runtime is
  'Dormant Windows companion execution transport runtime. NOLOGIN, passwordless, and memberless until a separately reviewed activation.';
comment on function app.disable_agent_platform_companion_execution_transport() is
  'Postgres-only emergency transport fence. Removes runtime login, password, capability membership, and active control; the independent operator runbook drains sessions and stops financial authority after this transaction commits.';

commit;
