-- Extend only the signed, no-money Companion bridge's exact function surface.
-- The application preflight must move from seven to eleven procedures in the
-- same guarded release. No table access or Player-selection authority is granted.
begin;

revoke all on function
  app.claim_telegram_player_validation_assignment(
    text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text
  ),
  app.complete_telegram_player_validation_assignment(text,jsonb),
  app.release_telegram_player_validation_assignment(text),
  app.accept_telegram_player_validation_result(
    text,text,text,text,text,text,text,text,text,text,text,
    timestamptz,timestamptz,timestamptz,jsonb,jsonb
  )
from public, anon, authenticated, service_role,
  fetanagent_companion_device_bridge_runtime;

grant execute on function
  app.claim_telegram_player_validation_assignment(
    text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text
  ),
  app.complete_telegram_player_validation_assignment(text,jsonb),
  app.release_telegram_player_validation_assignment(text),
  app.accept_telegram_player_validation_result(
    text,text,text,text,text,text,text,text,text,text,text,
    timestamptz,timestamptz,timestamptz,jsonb,jsonb
  )
to fetanagent_companion_device_bridge;

-- The privileged finalizer remains completely separate and ungranted. A
-- signed Find result can only become stored validation evidence in this phase.
comment on function app.accept_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) is 'Signed no-money KemerBet Find evidence; does not select a Player ID or move money.';

commit;
