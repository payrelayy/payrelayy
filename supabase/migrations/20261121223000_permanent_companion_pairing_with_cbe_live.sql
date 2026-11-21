-- Permit the permanent v2 no-money Companion to pair during a planned shared
-- deposit stop while the independent CBE Birr verification switch stays live.
-- The two shared financial gates and every legacy/withdrawal switch must still
-- be disabled. This does not change a switch or grant a financial capability.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $pairing$
declare
  v_target regprocedure := pg_catalog.to_regprocedure(
    'app.issue_agent_platform_companion_pairing(uuid,uuid,text,text)'
  );
  v_definition text;
  v_old text := $old$and (feature_switch.mode <> 'disabled' or feature_switch.settings <> '{}'::jsonb)$old$;
  v_new text := $new$and (
         feature_switch.settings <> '{}'::jsonb
         or (feature_switch.mode <> 'disabled' and not (
           feature_switch.feature_key = 'cbe_birr_authoritative_verification'
           and feature_switch.mode = 'live'
           and p_server_signer_key_id = 'companion-server-production-v2'
         ))
       )$new$;
  v_old_message text := 'Companion pairing requires every financial switch to remain disabled.';
  v_new_message text := 'Companion pairing requires the shared financial and legacy switches to remain disabled.';
begin
  if v_target is null then
    raise exception 'Companion pairing issuer is missing; migration stopped.';
  end if;
  select pg_catalog.pg_get_functiondef(v_target) into v_definition;
  if pg_catalog.strpos(v_definition, v_old) = 0
    or pg_catalog.strpos(
      pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
      v_old
    ) <> 0
    or pg_catalog.strpos(v_definition, v_old_message) = 0
    or pg_catalog.strpos(v_definition, '''paymentAllowed'', false') = 0
    or pg_catalog.strpos(v_definition, '''moneyMovementAllowed'', false') = 0
  then
    raise exception 'Companion pairing issuer changed; migration stopped.';
  end if;

  execute pg_catalog.replace(
    pg_catalog.replace(v_definition, v_old, v_new), v_old_message, v_new_message
  );
end;
$pairing$;

commit;
