\set ON_ERROR_STOP on

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '5s';

select current_user = 'postgres' and session_user = 'postgres' as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:nonfinancial-runtimes', 0)
);

alter role fetanagent_beta_admission_runtime nologin password null;
alter role fetanagent_customer_web_runtime nologin password null;
alter role fetanagent_owner_control_runtime nologin password null;
alter role fetanagent_player_actions_runtime nologin password null;
alter role fetanagent_telebirr_assignment_broker_runtime nologin password null;
alter role fetanagent_telebirr_device_state_runtime nologin password null;
alter role fetanagent_companion_device_bridge_runtime nologin password null;

select count(*) = 7 and pg_catalog.bool_and(not rolcanlogin) as runtime_postcondition
from pg_catalog.pg_roles
where rolname in (
  'fetanagent_beta_admission_runtime', 'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime', 'fetanagent_player_actions_runtime',
  'fetanagent_telebirr_assignment_broker_runtime', 'fetanagent_telebirr_device_state_runtime',
  'fetanagent_companion_device_bridge_runtime'
)
\gset
\if :runtime_postcondition
\else
  \warn 'A production non-financial runtime login remained enabled.'
  select 1 / 0 as rejected;
\endif

commit;
\echo 'All seven production non-financial runtime logins are disabled.'
