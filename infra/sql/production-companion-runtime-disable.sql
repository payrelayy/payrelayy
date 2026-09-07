\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres' as production_session_ready
\gset
\if :production_session_ready
\else
  \warn 'The exact production administrator session is required.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local lock_timeout = '1s';
set local statement_timeout = '10s';
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:companion-bridge-runtime:v1', 0)
);
alter role fetanagent_companion_device_bridge_runtime nologin password null;
commit;
\echo 'Production companion login disabled; signing trust and other services preserved.'
