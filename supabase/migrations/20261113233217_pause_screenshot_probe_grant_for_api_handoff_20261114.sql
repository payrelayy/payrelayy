-- Operational handoff: the grant was applied before the replacement API was
-- deployed, which made the old API's exact catalog readiness check fail.
-- Revoke only this optional read-only probe grant until the new API is healthy.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

revoke execute on function app.probe_receiver_sms_screenshot_reference(text,text[])
  from fetanagent_player_actions;

commit;
