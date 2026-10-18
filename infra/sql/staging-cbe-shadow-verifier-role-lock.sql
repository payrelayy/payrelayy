-- One-time staging prerequisite for migration 20260920090000. The reviewed
-- shadow verifier runtime credential is expired, but its role still has LOGIN.
-- This file only revokes that login capability; it does not enable a switch,
-- change a receiver, submit a payment, or credit a Player.
do $staging_shadow_role_lock$
declare
  target_role constant text := 'fetanagent_telebirr_shadow_verifier_runtime';
begin
  if session_user <> 'postgres'
    or (select pg_catalog.count(*) from supabase_migrations.schema_migrations) <> 87
    or (select pg_catalog.max(version) from supabase_migrations.schema_migrations)
         <> '20260915190000'
    or (select pg_catalog.count(*) from app.feature_switches
         where mode = 'disabled' and settings = '{}'::jsonb) <> 7
    or (select pg_catalog.count(*) from app.private_live_deposit_pilot_revisions
         where id = 'c833aa88-b315-404b-b86d-ac40ec79c50a'::uuid
           and status = 'stopped' and stop_reason_code = 'owner_stop') <> 1
    or (select pg_catalog.count(*) from app.private_live_deposit_pilot_revisions
         where status = 'armed') <> 0
    or (select pg_catalog.count(*) from app.audit_events
         where action = 'deposit.private_live_pilot_stopped'
           and resource_id = 'c833aa88-b315-404b-b86d-ac40ec79c50a'::uuid
           and metadata->>'reason_code' = 'owner_stop') <> 1
    or (select pg_catalog.count(*) from app.private_live_deposit_pilot_reservations) <> 0
    or (select pg_catalog.count(*) from app.deposit_jobs) <> 0
    or (select pg_catalog.count(*) from app.deposit_execution_attempts) <> 0 then
    raise exception 'Staging shadow role lock preconditions changed.';
  end if;

  if (select pg_catalog.count(*)
        from pg_catalog.pg_roles role
       where role.rolname = target_role
         and role.rolcanlogin
         and role.rolvaliduntil is not null
         and role.rolvaliduntil < pg_catalog.clock_timestamp()
         and not role.rolsuper
         and not role.rolcreatedb
         and not role.rolcreaterole
         and not role.rolreplication
         and not role.rolbypassrls) <> 1
    or exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename = target_role
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception 'The exact expired staging shadow runtime role is not idle and eligible.';
  end if;

  execute 'alter role fetanagent_telebirr_shadow_verifier_runtime nologin';
  if exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname = target_role and role.rolcanlogin
  ) then
    raise exception 'The staging shadow runtime role still has LOGIN.';
  end if;
end;
$staging_shadow_role_lock$;
