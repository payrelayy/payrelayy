begin;

-- The broker has already authenticated the signed reconcile command and its exact binding.
-- Expose only the immutable server-authored time fence to that same restricted runtime, so
-- the Companion can filter old History without widening its financial authority.
create function app.routine_telebirr_pending_history_window(
  p_attempt_id uuid,
  p_certificate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  activation app.routine_telebirr_runtime_events%rowtype;
  attempt app.deposit_execution_attempts%rowtype;
begin
  if session_user <> 'fetanagent_routine_deposit_broker_runtime'
    or not pg_catalog.pg_has_role(session_user, 'fetanagent_routine_deposit_broker', 'member')
  then raise exception using errcode = '42501', message = 'The routine broker session is required.';
  end if;
  select event.* into activation from app.routine_telebirr_runtime_events event
    order by event.event_sequence desc limit 1;
  if activation.id is null or activation.event_kind <> 'activate'
    or activation.valid_until <= pg_catalog.clock_timestamp()
    or activation.certificate_id <> p_certificate_id
  then raise exception 'The routine broker activation is unavailable.';
  end if;
  select current_attempt.* into attempt from app.deposit_execution_attempts current_attempt
    where current_attempt.id = p_attempt_id
      and current_attempt.platform_agent_account_id = activation.platform_agent_account_id
      and current_attempt.status = 'reconciliation_required';
  if attempt.id is null
    or attempt.final_action_fenced_at is null
    or attempt.reconciliation_required_at is null
    or attempt.reconciliation_required_at < attempt.final_action_fenced_at
    or attempt.reconciliation_required_at - attempt.final_action_fenced_at > interval '10 minutes'
    or attempt.reconciliation_required_at > pg_catalog.clock_timestamp()
  then raise exception 'The pending routine history fence is unavailable.';
  end if;
  return pg_catalog.jsonb_build_object(
    'from', pg_catalog.to_char(
      attempt.final_action_fenced_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'until', pg_catalog.to_char(
      attempt.reconciliation_required_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );
end;
$$;

alter function app.routine_telebirr_pending_history_window(uuid,uuid) owner to postgres;
revoke all on function app.routine_telebirr_pending_history_window(uuid,uuid)
  from public, anon, authenticated, service_role,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;
grant execute on function app.routine_telebirr_pending_history_window(uuid,uuid)
  to fetanagent_routine_deposit_broker;

commit;
