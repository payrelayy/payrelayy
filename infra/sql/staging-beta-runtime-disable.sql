\set ON_ERROR_STOP on

alter role payreplayy_beta_admission_runtime with
  nologin
  noinherit
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  password null
  valid until 'infinity';

do $payreplayy$
declare
  activity_pid integer;
  terminated_session_count integer := 0;
begin
  for activity_pid in
    select activity.pid
    from pg_catalog.pg_stat_activity as activity
    where activity.usename = 'payreplayy_beta_admission_runtime'
      and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      raise exception 'A staging beta-admission runtime session could not be terminated safely.';
    end if;
    terminated_session_count := terminated_session_count + 1;
  end loop;

  raise notice 'Terminated % staging beta-admission runtime session(s).', terminated_session_count;

  perform pg_catalog.pg_stat_clear_snapshot();

  if exists (
    select 1
    from pg_catalog.pg_stat_activity as activity
    where activity.usename = 'payreplayy_beta_admission_runtime'
      and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'A staging beta-admission runtime session remains after disablement.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_authid as role
    where role.rolname = 'payreplayy_beta_admission_runtime'
      and not role.rolcanlogin
      and not role.rolinherit
      and not role.rolsuper
      and not role.rolcreatedb
      and not role.rolcreaterole
      and not role.rolreplication
      and not role.rolbypassrls
      and role.rolconnlimit = 1
      and role.rolpassword is null
  ) then
    raise exception 'The staging beta-admission runtime login was not disabled safely.';
  end if;
end
$payreplayy$;
