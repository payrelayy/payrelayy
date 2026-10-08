\set ON_ERROR_STOP on

begin;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
set local lock_timeout = '3s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

alter role fetanagent_routine_telebirr_paid_poll_runtime
  nologin password null valid until '1970-01-01 00:00:00+00';
commit;

select pg_catalog.pg_terminate_backend(activity.pid)
from pg_catalog.pg_stat_activity activity
where activity.usename = 'fetanagent_routine_telebirr_paid_poll_runtime'
  and activity.pid <> pg_catalog.pg_backend_pid();
