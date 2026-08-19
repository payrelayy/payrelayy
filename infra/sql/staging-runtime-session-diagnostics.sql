\set ON_ERROR_STOP on

-- Count-only diagnostics for the four staging runtime identities.
-- Output is restricted to role, application name, state, and aggregate count.
select
  activity.usename as runtime_role,
  activity.application_name,
  activity.state as session_state,
  count(*)::integer as session_count
from pg_catalog.pg_stat_activity as activity
where activity.usename = any (array[
  'fetanagent_beta_admission_runtime',
  'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime',
  'fetanagent_player_actions_runtime'
])
group by activity.usename, activity.application_name, activity.state
order by activity.usename, activity.application_name, activity.state;
