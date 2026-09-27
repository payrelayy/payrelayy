-- Independent, fail-closed companion execution lease. Installation is dormant: it
-- does not activate an epoch, grant a login, enable a switch, or execute a job.
-- Each stop phase is scheduled in its own transaction so a later failure cannot
-- undo an earlier committed credential, session, or financial fence.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.agent_platform_companion_execution_watchdog_leases (
  activation_epoch bigint primary key references
    app.agent_platform_companion_execution_activation_consumptions (activation_epoch)
    on delete restrict,
  activated_at timestamptz not null,
  hard_expires_at timestamptz not null,
  heartbeat_at timestamptz not null,
  lease_expires_at timestamptz not null,
  credential_fenced_at timestamptz,
  sessions_drained_at timestamptz,
  financial_fenced_at timestamptz,
  constraint companion_watchdog_lease_window check (
    heartbeat_at >= activated_at
    and lease_expires_at > heartbeat_at
    and lease_expires_at <= hard_expires_at
    and hard_expires_at <= activated_at + interval '2 hours'
  )
);

create function app.initialize_agent_platform_companion_execution_watchdog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  started_at timestamptz;
  scheduled_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production administrator may initialize the execution watchdog.';
  end if;
  if old.control_state <> 'disabled' or new.control_state <> 'active' then
    return new;
  end if;
  started_at := pg_catalog.clock_timestamp();
  if new.activation_epoch is null or new.expires_at <= started_at + interval '45 seconds' then
    raise exception 'The execution watchdog cannot cover this activation.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_available_extensions extension
     where extension.name = 'pg_cron'
  ) then
    if pg_catalog.to_regclass('cron.job') is null then
      raise exception 'The independent execution watchdog is not installed.';
    end if;
    execute 'select pg_catalog.count(*) from cron.job job '
      || 'where job.jobname in ('
      || '''fetanagent-companion-watchdog-credentials-v1'', '
      || '''fetanagent-companion-watchdog-sessions-v1'', '
      || '''fetanagent-companion-watchdog-financial-v1'') '
      || 'and job.active and job.username = ''postgres'' '
      || 'and job.schedule = ''15 seconds'' '
      || 'and job.command in ('
      || '''select app.watchdog_fence_companion_execution_credentials()'', '
      || '''select app.watchdog_drain_companion_execution_sessions()'', '
      || '''select app.watchdog_fence_companion_execution_financial_authority()'')'
      into scheduled_count;
    if scheduled_count <> 3 then
      raise exception 'The independent execution watchdog is not scheduled.';
    end if;
    execute 'select pg_catalog.count(*) from ('
      || 'select distinct on (job.jobname) job.jobname, run.status, run.end_time '
      || 'from cron.job job join cron.job_run_details run on run.jobid = job.jobid '
      || 'where job.jobname in ('
      || '''fetanagent-companion-watchdog-credentials-v1'', '
      || '''fetanagent-companion-watchdog-sessions-v1'', '
      || '''fetanagent-companion-watchdog-financial-v1'') '
      || 'order by job.jobname, run.start_time desc) recent '
      || 'where recent.status = ''succeeded'' '
      || 'and recent.end_time >= pg_catalog.clock_timestamp() - interval ''2 minutes'''
      into scheduled_count;
    if scheduled_count <> 3 then
      raise exception 'The independent execution watchdog is not running.';
    end if;
  end if;
  insert into app.agent_platform_companion_execution_watchdog_leases (
    activation_epoch, activated_at, hard_expires_at, heartbeat_at, lease_expires_at
  ) values (
    new.activation_epoch, new.activated_at, new.expires_at, started_at,
    started_at + interval '45 seconds'
  );
  return new;
end;
$$;

create trigger companion_execution_watchdog_on_activation
after update of control_state on app.agent_platform_companion_execution_control
for each row execute function app.initialize_agent_platform_companion_execution_watchdog();

-- A future protected operator must renew this lease from an independent health
-- path. Merely keeping a companion browser or database connection alive does not
-- renew it. An elapsed lease is irreversible for that activation epoch.
create function app.renew_agent_platform_companion_execution_watchdog(
  p_activation_epoch bigint
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  control app.agent_platform_companion_execution_control%rowtype;
  lease app.agent_platform_companion_execution_watchdog_leases%rowtype;
  checked_at timestamptz;
  next_deadline timestamptz;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production administrator may renew the execution watchdog.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
  );
  select execution_control.* into control
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton for share;
  select existing.* into lease
    from app.agent_platform_companion_execution_watchdog_leases existing
   where existing.activation_epoch = p_activation_epoch for update;
  checked_at := pg_catalog.clock_timestamp();
  if control.control_state <> 'active'
    or control.activation_epoch is distinct from p_activation_epoch
    or lease.activation_epoch is null
    or lease.credential_fenced_at is not null
    or lease.financial_fenced_at is not null
    or lease.lease_expires_at <= checked_at
    or control.expires_at <= checked_at + interval '45 seconds'
    or app.current_private_trusted_telebirr_activation_epoch()
       is distinct from p_activation_epoch then
    raise exception 'The execution watchdog lease is not renewable.';
  end if;
  next_deadline := checked_at + interval '45 seconds';
  update app.agent_platform_companion_execution_watchdog_leases existing
     set heartbeat_at = checked_at, lease_expires_at = next_deadline
   where existing.activation_epoch = p_activation_epoch;
  return next_deadline;
end;
$$;

-- Job 1: revoke both runtime passwords and capability membership, and fence
-- companion control. This call commits independently of the other two jobs.
create function app.watchdog_fence_companion_execution_credentials()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease app.agent_platform_companion_execution_watchdog_leases%rowtype;
  control app.agent_platform_companion_execution_control%rowtype;
  checked_at timestamptz;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production administrator may run the execution watchdog.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
  );
  select execution_control.* into control
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton for update;
  if control.control_state <> 'active' then
    return false;
  end if;
  select existing.* into lease
    from app.agent_platform_companion_execution_watchdog_leases existing
   where existing.activation_epoch = control.activation_epoch for update;
  checked_at := pg_catalog.clock_timestamp();
  if lease.activation_epoch is not null
    and lease.lease_expires_at > checked_at
    and control.expires_at > checked_at then
    return false;
  end if;
  perform app.disable_agent_platform_companion_execution_transport();
  if lease.activation_epoch is not null then
    update app.agent_platform_companion_execution_watchdog_leases existing
       set credential_fenced_at = checked_at
     where existing.activation_epoch = lease.activation_epoch;
  end if;
  return true;
end;
$$;

-- Job 2: drain only the two execution identities. A future activation cannot
-- begin while their old sessions remain, and this job keeps retrying on error.
create function app.watchdog_drain_companion_execution_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  control app.agent_platform_companion_execution_control%rowtype;
  lease app.agent_platform_companion_execution_watchdog_leases%rowtype;
  checked_at timestamptz;
  session_pid integer;
  terminated_count integer := 0;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production administrator may run the execution watchdog.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
  );
  select execution_control.* into control
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton for share;
  select existing.* into lease
    from app.agent_platform_companion_execution_watchdog_leases existing
   order by existing.activated_at desc limit 1 for update;
  checked_at := pg_catalog.clock_timestamp();
  if lease.activation_epoch is null
    or (lease.lease_expires_at > checked_at and control.expires_at > checked_at)
    or (control.control_state = 'active'
        and control.activation_epoch is distinct from lease.activation_epoch) then
    return 0;
  end if;
  for session_pid in
    select activity.pid from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     ) and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if pg_catalog.pg_terminate_backend(session_pid) then
      terminated_count := terminated_count + 1;
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     ) and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'The execution watchdog could not drain every execution session.';
  end if;
  update app.agent_platform_companion_execution_watchdog_leases existing
     set sessions_drained_at = coalesce(existing.sessions_drained_at, checked_at)
   where existing.activation_epoch = lease.activation_epoch;
  return terminated_count;
end;
$$;

-- Job 3: independently disable the matching live financial epoch. This must
-- not depend on the credential or session job having succeeded first.
create function app.watchdog_fence_companion_execution_financial_authority()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease app.agent_platform_companion_execution_watchdog_leases%rowtype;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  current_epoch bigint;
  actor_admin_id uuid;
  actor_count integer;
  checked_at timestamptz;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production administrator may run the execution watchdog.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
  );
  select existing.* into lease
    from app.agent_platform_companion_execution_watchdog_leases existing
   order by existing.activated_at desc limit 1 for update;
  checked_at := pg_catalog.clock_timestamp();
  if lease.activation_epoch is null or lease.lease_expires_at > checked_at then
    return false;
  end if;
  select control.current_epoch into current_epoch
    from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority'
   for update;
  select epoch.* into authority
    from app.private_trusted_telebirr_activation_epochs epoch
   where epoch.epoch = lease.activation_epoch for update;
  if current_epoch is distinct from lease.activation_epoch then
    if authority.authority_state = 'active' and authority.revoked_at is null then
      raise exception 'The watchdog epoch is not the current financial authority.';
    end if;
    return false;
  end if;
  if authority.authority_state <> 'active' or authority.revoked_at is not null then
    update app.agent_platform_companion_execution_watchdog_leases existing
       set financial_fenced_at = coalesce(existing.financial_fenced_at, checked_at)
     where existing.activation_epoch = lease.activation_epoch;
    return false;
  end if;
  select pg_catalog.count(*)::integer,
         (pg_catalog.array_agg(owner_user.id order by owner_user.id))[1]
    into actor_count, actor_admin_id
    from app.admin_users owner_user
   where owner_user.role = 'owner' and owner_user.status = 'active';
  if actor_count <> 1 or actor_admin_id is null then
    raise exception 'The execution watchdog cannot identify the exact active Owner.';
  end if;
  perform app.request_private_trusted_telebirr_emergency_disable(
    actor_admin_id, lease.activation_epoch, pg_catalog.gen_random_uuid(),
    'execution_uncertainty'
  );
  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'The execution watchdog financial fence is incomplete.';
  end if;
  update app.agent_platform_companion_execution_watchdog_leases existing
     set financial_fenced_at = checked_at
   where existing.activation_epoch = lease.activation_epoch;
  return true;
end;
$$;

alter table app.agent_platform_companion_execution_watchdog_leases
  enable row level security;
alter table app.agent_platform_companion_execution_watchdog_leases
  force row level security;
alter table app.agent_platform_companion_execution_watchdog_leases owner to postgres;

alter function app.initialize_agent_platform_companion_execution_watchdog()
  owner to postgres;
alter function app.renew_agent_platform_companion_execution_watchdog(bigint)
  owner to postgres;
alter function app.watchdog_fence_companion_execution_credentials()
  owner to postgres;
alter function app.watchdog_drain_companion_execution_sessions()
  owner to postgres;
alter function app.watchdog_fence_companion_execution_financial_authority()
  owner to postgres;

revoke all on table app.agent_platform_companion_execution_watchdog_leases
from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke all on function
  app.initialize_agent_platform_companion_execution_watchdog(),
  app.renew_agent_platform_companion_execution_watchdog(bigint),
  app.watchdog_fence_companion_execution_credentials(),
  app.watchdog_drain_companion_execution_sessions(),
  app.watchdog_fence_companion_execution_financial_authority()
from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

-- The disposable SQL-integration server has no pg_cron binary. On the managed
-- Supabase server the extension is available, and failure to install or schedule
-- any phase aborts the entire migration. No existing named Job is overwritten.
do $watchdog_cron_install$
declare
  scheduled_count integer;
begin
  if exists (
    select 1 from pg_catalog.pg_available_extensions extension
     where extension.name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';
    select pg_catalog.count(*)::integer into scheduled_count
      from cron.job job
     where job.jobname in (
       'fetanagent-companion-watchdog-credentials-v1',
       'fetanagent-companion-watchdog-sessions-v1',
       'fetanagent-companion-watchdog-financial-v1'
     );
    if scheduled_count <> 0 then
      raise exception 'An execution watchdog Cron job name already exists.';
    end if;
    perform cron.schedule(
      'fetanagent-companion-watchdog-credentials-v1', '15 seconds',
      'select app.watchdog_fence_companion_execution_credentials()'
    );
    perform cron.schedule(
      'fetanagent-companion-watchdog-sessions-v1', '15 seconds',
      'select app.watchdog_drain_companion_execution_sessions()'
    );
    perform cron.schedule(
      'fetanagent-companion-watchdog-financial-v1', '15 seconds',
      'select app.watchdog_fence_companion_execution_financial_authority()'
    );
    select pg_catalog.count(*)::integer into scheduled_count
      from cron.job job
     where job.jobname in (
       'fetanagent-companion-watchdog-credentials-v1',
       'fetanagent-companion-watchdog-sessions-v1',
       'fetanagent-companion-watchdog-financial-v1'
     ) and job.active and job.username = 'postgres';
    if scheduled_count <> 3 then
      raise exception 'The execution watchdog Cron installation is incomplete.';
    end if;
  elsif pg_catalog.to_regclass('sql_integration.applied_migrations') is null then
    raise exception 'The production execution watchdog requires pg_cron.';
  end if;
end;
$watchdog_cron_install$;

commit;
