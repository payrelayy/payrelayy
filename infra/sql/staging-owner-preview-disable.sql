\set ON_ERROR_STOP on

begin;

alter role fetanagent_owner_control_runtime with
  nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password null valid until 'infinity';

do $fetanagent$
declare
  activity_pid integer;
begin
  for activity_pid in
    select activity.pid
    from pg_catalog.pg_stat_activity activity
    where activity.usename = 'fetanagent_owner_control_runtime'
      and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    perform pg_catalog.pg_terminate_backend(activity_pid);
  end loop;
end
$fetanagent$;

commit;
