\set ON_ERROR_STOP on

\if :{?expected_runtime_role}
\else
  \warn 'The expected staging runtime role was not supplied.'
  select 1 / 0 as rejected;
\endif

begin transaction read only;
set local search_path = pg_catalog;
set local statement_timeout = '5s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '5s';

select current_user = :'expected_runtime_role'
    and session_user = :'expected_runtime_role' as runtime_identity_ready
\gset
\if :runtime_identity_ready
\else
  \warn 'The staging runtime session identity is not exact.'
  select 1 / 0 as rejected;
\endif

rollback;
\echo 'Staging runtime login preflight passed without changing the database.'
