-- An accepted signed Find and the resulting Player selection/review decision
-- must commit together. The bridge never gets direct finalizer authority.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.accept_and_finalize_telegram_player_validation_result(
  p_http_replay_identity text, p_http_body_digest text, p_http_request_id text,
  p_result_replay_identity text, p_assignment_id text, p_assignment_body_digest text,
  p_result_id text, p_result_body_digest text, p_certificate_id text,
  p_device_id text, p_device_key_id text,
  p_request_issued_at timestamptz, p_request_expires_at timestamptz,
  p_assessed_at timestamptz, p_signed_assignment jsonb, p_signed_result jsonb
)
returns table (accepted boolean, replayed boolean, finalization_state text)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_accept record;
  v_result app.telegram_player_validation_results%rowtype;
  v_request_status text;
  v_finalization_state text;
begin
  perform app.require_agent_platform_companion_bridge_session();
  select * into v_accept
    from app.accept_telegram_player_validation_result(
      p_http_replay_identity, p_http_body_digest, p_http_request_id,
      p_result_replay_identity, p_assignment_id, p_assignment_body_digest,
      p_result_id, p_result_body_digest, p_certificate_id,
      p_device_id, p_device_key_id,
      p_request_issued_at, p_request_expires_at, p_assessed_at,
      p_signed_assignment, p_signed_result
    );
  if v_accept.accepted is distinct from true then return; end if;
  select result.* into v_result
    from app.telegram_player_validation_results result
   where result.result_id = p_result_id
     and result.assignment_id = p_assignment_id::uuid
     and result.result_replay_identity = p_result_replay_identity
   for share;
  if v_result.result_id is null then
    raise exception 'Accepted Player validation evidence is unavailable.';
  end if;

  if v_result.outcome = 'found' then
    select selected.finalization_state into v_finalization_state
      from app.finalize_telegram_player_validation(v_result.validation_request_id) selected;
    if v_finalization_state not in ('selected', 'already_selected', 'review_required')
       or v_finalization_state is null then
      raise exception 'Accepted Player Find could not be finalized.';
    end if;
    finalization_state := v_finalization_state;
  else
    select request.status into v_request_status
      from app.telegram_player_validation_requests request
     where request.id = v_result.validation_request_id;
    if v_request_status <> 'review_required' then
      raise exception 'Inconclusive Player Find was not held for review.';
    end if;
    finalization_state := 'review_required';
  end if;
  accepted := true;
  replayed := v_accept.replayed;
  return next;
end;
$$;

alter function app.accept_and_finalize_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) owner to postgres;

revoke all on function app.accept_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) from fetanagent_companion_device_bridge,
       fetanagent_companion_device_bridge_runtime;
revoke all on function app.accept_and_finalize_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge_runtime;
grant execute on function app.accept_and_finalize_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) to fetanagent_companion_device_bridge;

comment on function app.accept_and_finalize_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) is 'Atomically accept signed read-only KemerBet Find evidence and select one Player ID or require review; never initiates a payment.';
commit;
