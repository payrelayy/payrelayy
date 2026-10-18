-- Prepare only the exact Player-action RPCs for the default-off staging simulation.
-- Both functions independently require every financial switch to remain disabled.
-- The API gate is also restricted to the staging database target and dry-run mode.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

grant execute on function app.issue_telegram_cbe_birr_dry_run_instruction(
  uuid, text, text
) to fetanagent_player_actions;

grant execute on function app.capture_telegram_cbe_birr_bound_dry_run_proof(
  uuid, uuid, text, text, text, text, smallint, smallint, text
) to fetanagent_player_actions;

commit;
