-- Apply only after the API release with the optional probe catalog check has
-- replaced every old API instance. The bot correction flag remains default-off.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

grant execute on function app.probe_receiver_sms_screenshot_reference(text,text[])
  to fetanagent_player_actions;

commit;
