-- Apply only after the replacement API is running and healthy. This restores
-- the exact runtime grant for immediate duplicate-submission replies.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
declare v_function oid;
begin
  v_function := pg_catalog.to_regprocedure(
    'app.telegram_receiver_sms_duplicate_state(uuid,uuid)');
  if v_function is null then
    raise exception 'The duplicate disposition function is absent.';
  end if;
  if pg_catalog.has_function_privilege(
      'fetanagent_player_actions_runtime', v_function, 'EXECUTE') then
    raise exception 'The runtime grant is already active; review migration order.';
  end if;
  if pg_catalog.has_function_privilege(
      'fetanagent_player_actions', v_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception 'The duplicate disposition function has an unexpected grant.';
  end if;
end;
$guard$;

grant execute on function app.telegram_receiver_sms_duplicate_state(uuid,uuid)
  to fetanagent_player_actions_runtime;

do $guard$
begin
  if not pg_catalog.has_function_privilege(
      'fetanagent_player_actions_runtime',
      'app.telegram_receiver_sms_duplicate_state(uuid,uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'fetanagent_player_actions',
      'app.telegram_receiver_sms_duplicate_state(uuid,uuid)', 'EXECUTE') then
    raise exception 'The exact runtime grant was not restored.';
  end if;
end;
$guard$;
commit;
