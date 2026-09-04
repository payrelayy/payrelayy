\set ON_ERROR_STOP on

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
set local lock_timeout = '1s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:companion-bridge-runtime:v1', 0)
);

alter role fetanagent_companion_device_bridge_runtime with
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  password null
  valid until 'infinity';

do $fetanagent$
begin
  execute pg_catalog.format(
    'revoke connect, temporary on database %I from fetanagent_companion_device_bridge_runtime',
    pg_catalog.current_database()
  );
end
$fetanagent$;

select count(*) = 1
    and pg_catalog.bool_and(
      not role.rolcanlogin and not role.rolinherit and not role.rolsuper
      and not role.rolcreatedb and not role.rolcreaterole
      and not role.rolreplication and not role.rolbypassrls
      and role.rolconnlimit = 1
    ) as runtime_disabled
from pg_catalog.pg_roles role
where role.rolname = 'fetanagent_companion_device_bridge_runtime'
\gset
\if :runtime_disabled
\else
  \warn 'The companion bridge runtime was not disabled.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'companion_runtime_disable',
  'runtime', 'disabled',
  'calendarShutdown', false,
  'moneyMoved', false
)::text;

commit;
