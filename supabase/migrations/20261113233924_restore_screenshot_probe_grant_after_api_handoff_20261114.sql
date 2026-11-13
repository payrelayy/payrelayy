-- Restore the optional read-only screenshot probe after every old API instance
-- has stopped and the replacement API has passed its catalog preflight.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

grant execute on function app.probe_receiver_sms_screenshot_reference(text,text[])
  to fetanagent_player_actions;

commit;
