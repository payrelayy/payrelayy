-- Restore the old API's exact function surface while its replacement is
-- deployed. The replacement API accepts this function with or without its
-- direct runtime grant; a later migration restores the grant after cutover.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if pg_catalog.to_regprocedure('app.telegram_receiver_sms_duplicate_state(uuid,uuid)')
      is null then
    raise exception 'The duplicate disposition function is absent.';
  end if;
  if not pg_catalog.has_function_privilege(
      'fetanagent_player_actions_runtime',
      'app.telegram_receiver_sms_duplicate_state(uuid,uuid)', 'EXECUTE') then
    raise exception 'The expected direct runtime grant is absent.';
  end if;
  if pg_catalog.has_function_privilege(
      'fetanagent_player_actions',
      'app.telegram_receiver_sms_duplicate_state(uuid,uuid)', 'EXECUTE') then
    raise exception 'The duplicate disposition group unexpectedly has execution.';
  end if;
end;
$guard$;

revoke execute on function app.telegram_receiver_sms_duplicate_state(uuid,uuid)
  from fetanagent_player_actions_runtime;

do $guard$
begin
  if pg_catalog.has_function_privilege(
      'fetanagent_player_actions_runtime',
      'app.telegram_receiver_sms_duplicate_state(uuid,uuid)', 'EXECUTE') then
    raise exception 'The duplicate disposition runtime grant is still active.';
  end if;
end;
$guard$;
commit;
