\set ON_ERROR_STOP on

alter role fetanagent_beta_admission_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

alter role fetanagent_owner_control_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

alter role fetanagent_player_actions_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password null valid until 'infinity';

do $fetanagent$
declare
  activity_pid integer;
  expected_role text;
  terminated_session_count integer := 0;
begin
  for activity_pid in
    select activity.pid
    from pg_catalog.pg_stat_activity as activity
    where activity.usename = any (array[
      'fetanagent_beta_admission_runtime',
      'fetanagent_owner_control_runtime',
      'fetanagent_player_actions_runtime'
    ])
      and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      raise exception 'A staging runtime session could not be terminated safely.';
    end if;
    terminated_session_count := terminated_session_count + 1;
  end loop;

  raise notice 'Terminated % staging runtime session(s).', terminated_session_count;

  perform pg_catalog.pg_stat_clear_snapshot();

  if exists (
    select 1
    from pg_catalog.pg_stat_activity as activity
    where activity.usename = any (array[
      'fetanagent_beta_admission_runtime',
      'fetanagent_owner_control_runtime',
      'fetanagent_player_actions_runtime'
    ])
      and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'A staging runtime session remains after disablement.';
  end if;

  foreach expected_role in array array[
    'fetanagent_beta_admission_runtime',
    'fetanagent_owner_control_runtime',
    'fetanagent_player_actions_runtime'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_authid as role
      where role.rolname = expected_role
        and not role.rolcanlogin
        and not role.rolinherit
        and not role.rolsuper
        and not role.rolcreatedb
        and not role.rolcreaterole
        and not role.rolreplication
        and not role.rolbypassrls
        and role.rolconnlimit = case expected_role
          when 'fetanagent_player_actions_runtime' then 2
          else 1
        end
        and role.rolpassword is null
    ) then
      raise exception 'A staging runtime login was not disabled safely.';
    end if;
  end loop;
end
$fetanagent$;
