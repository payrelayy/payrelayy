-- A committed lease can outlive a lost HTTP reply. Return its exact active binding
-- to the same worker instead of hiding the prepared attempt until it expires.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $repair$
declare
  target pg_catalog.regprocedure :=
    'app.execute_agent_platform_routine_deposit_command(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb)'::pg_catalog.regprocedure;
  previous_source text;
  previous_definition text;
  previous_acl pg_catalog.aclitem[];
  previous_owner oid;
  old_branch text := $old$
  if operation = 'lease' and attempt.id is not null and attempt.status = 'prepared' then
    select job.* into execution_job from app.deposit_jobs job
      where job.id = attempt.deposit_job_id for update;
    if execution_job.lease_expires_at <= p_assessed_at then
      perform * from app.cancel_deposit_execution_before_action(
        attempt.id, execution_job.lease_token, 'execution_lease_expired_before_action'
      );
      attempt := null;
    else
      result := 'null'::jsonb;
    end if;
  end if;$old$;
  new_branch text := $new$
  if operation = 'lease' and attempt.id is not null and attempt.status = 'prepared' then
    select job.* into execution_job from app.deposit_jobs job
      where job.id = attempt.deposit_job_id for update;
    if execution_job.lease_expires_at <= p_assessed_at then
      perform * from app.cancel_deposit_execution_before_action(
        attempt.id, execution_job.lease_token, 'execution_lease_expired_before_action'
      );
      attempt := null;
    else
      select event.* into latest_policy from app.routine_telebirr_processing_events event
        order by event.event_sequence desc limit 1 for share;
      perform feature_switch.feature_key from app.feature_switches feature_switch
        where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
        order by feature_switch.feature_key for share;
      select pg_catalog.count(*)::integer into switch_count from app.feature_switches feature_switch
        where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
          and feature_switch.mode = 'live';
      if execution_job.status = 'leased'
        and execution_job.lease_token is not null
        and execution_job.leased_by = worker_id::text
        and attempt.attempt_number = 1
        and latest_policy.event_kind = 'authorize'
        and latest_policy.authorization_id = activation.authorization_id
        and not exists (
          select 1 from app.routine_telebirr_runtime_pauses pause
          where pause.authorization_event_sequence = latest_policy.event_sequence
        )
        and switch_count = 2 then
        authoritative_binding := app.routine_telebirr_attempt_binding_json(attempt.id);
        result := authoritative_binding || pg_catalog.jsonb_build_object(
          'policy', app.routine_telebirr_runtime_policy_json(), 'phase', 'execute',
          'paymentVerified', true, 'playerActive', true, 'playerDepositEligible', true,
          'attemptNumber', 1, 'finalActionFenced', false
        );
      else
        result := 'null'::jsonb;
      end if;
    end if;
  end if;$new$;
  updated_definition text;
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid),
    routine.proacl, routine.proowner
    into previous_source, previous_definition, previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if pg_catalog.md5(previous_source) <> 'b39b42e2276dcfedfc82a365155bfc0e'
    or previous_owner <> 'postgres'::pg_catalog.regrole
    or (select routine.prosecdef and routine.proconfig =
      array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc routine where routine.oid = target) is not true
    or pg_catalog.length(previous_source) -
      pg_catalog.length(pg_catalog.replace(previous_source, old_branch, ''))
      <> pg_catalog.length(old_branch)
    or (select pg_catalog.count(*) from app.feature_switches feature
      where feature.mode = 'disabled') <> 7
    or (select control.enabled from app.receiver_sms_route_control control
      where control.singleton) is distinct from false
    or exists (select 1 from app.deposit_jobs job
      where job.status::text in ('queued', 'leased'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then
    raise exception 'Prepared lease recovery preflight failed.';
  end if;
  updated_definition := pg_catalog.replace(previous_definition, old_branch, new_branch);
  if updated_definition = previous_definition then
    raise exception 'Prepared lease branch was not replaced.';
  end if;
  execute updated_definition;
  if (select routine.proowner = previous_owner and
       routine.proacl is not distinct from previous_acl and routine.prosecdef and
       routine.proconfig = array['search_path=pg_catalog']::text[] and
       pg_catalog.strpos(routine.prosrc, new_branch) > 0
       from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'Prepared lease recovery postcondition failed.';
  end if;
end;
$repair$;
commit;
