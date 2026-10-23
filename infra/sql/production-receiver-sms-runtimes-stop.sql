\set ON_ERROR_STOP on

-- Full production shutdown only. The host services have already stopped.
-- Revoke SMS runtime access even if the SMS route had been enabled.
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

alter role fetanagent_receiver_sms_ingest_runtime
  nologin password null valid until '1970-01-01 00:00:00+00';
alter role fetanagent_receiver_sms_settlement_runtime
  nologin password null valid until '1970-01-01 00:00:00+00';
revoke execute on function app.capture_telegram_receiver_sms_candidate(
  uuid,text,text,text,text,text,smallint,smallint,text
) from fetanagent_player_actions;
revoke execute on function app.list_owner_receiver_sms_old_payments(uuid,integer)
  from fetanagent_owner_control;
commit;

select pg_catalog.pg_terminate_backend(activity.pid)
from pg_catalog.pg_stat_activity activity
where activity.usename in (
  'fetanagent_receiver_sms_ingest_runtime',
  'fetanagent_receiver_sms_settlement_runtime'
)
  and activity.pid <> pg_catalog.pg_backend_pid();
