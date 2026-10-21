\set ON_ERROR_STOP on

-- Roll back only a first SMS deployment whose exact previous grant/login
-- snapshot was fully disabled. The financial switches are never changed here.
begin;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select current_user = 'postgres' and session_user = 'postgres'
  and (select count(*) = 1 from app.receiver_sms_route_control control
    where control.singleton and not control.enabled)
  as rollback_safe
\gset
\if :rollback_safe
\else
  \warn 'The SMS route is not stopped for credential rollback.'
  select 1 / 0 as rejected;
\endif

alter role fetanagent_receiver_sms_ingest_runtime nologin;
alter role fetanagent_receiver_sms_settlement_runtime nologin;
revoke execute on function app.capture_telegram_receiver_sms_candidate(
  uuid,text,text,text,text,text,smallint,smallint,text
) from fetanagent_player_actions;
revoke execute on function app.list_owner_receiver_sms_old_payments(uuid,integer)
  from fetanagent_owner_control;
revoke execute on function app.decide_owner_receiver_sms_old_payment(uuid,uuid,text)
  from fetanagent_owner_control;

commit;
