-- A single ambiguous credit is a one-use Owner review, not a transport-wide stop.
-- Apply only with both shared payment gates off and no in-flight attempt. Existing
-- reviewed claims remain immutable; only the KemerBet account lane is released.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $preflight$
declare
  broker pg_catalog.regprocedure :=
    'app.execute_agent_platform_routine_deposit_command(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb)'::pg_catalog.regprocedure;
  assessor pg_catalog.regprocedure :=
    'app.assess_routine_telebirr_execution_job(uuid)'::pg_catalog.regprocedure;
  activation pg_catalog.regprocedure :=
    'app.activate_routine_telebirr_execution_transport(uuid,uuid,uuid,text)'::pg_catalog.regprocedure;
begin
  if (select pg_catalog.md5(prosrc) = '938c311fcca44f09ede14c066de090f5'
       and proowner = 'postgres'::pg_catalog.regrole and prosecdef
       and proconfig = array['search_path=pg_catalog']::text[]
       from pg_catalog.pg_proc where oid = broker) is not true
    or (select pg_catalog.md5(prosrc) = '3a336bf22aad6b3757df07e4d557bf40'
       and proowner = 'postgres'::pg_catalog.regrole and prosecdef
       from pg_catalog.pg_proc where oid = assessor) is not true
    or (select pg_catalog.md5(prosrc) = '2ec4a783480d249e27ba78196639e178'
       and proowner = 'postgres'::pg_catalog.regrole and prosecdef
       and proconfig = array['search_path=pg_catalog']::text[]
       from pg_catalog.pg_proc where oid = activation) is not true
    or (select pg_catalog.count(*) from app.feature_switches feature
        where feature.feature_key in ('payment_verification', 'deposit_execution')
          and feature.mode = 'disabled') <> 2
    or exists (select 1 from app.deposit_execution_attempts attempt
        where attempt.status in ('prepared', 'final_action_fenced',
          'reconciliation_required')) then
    raise exception 'Uncertain-credit isolation preflight failed.';
  end if;
end;
$preflight$;

-- Keep the unique per-intent fence. Only a routine attempt that has completed
-- the signed case-review handoff releases the KemerBet account lane. Other
-- execution modes and historical review rows retain the old blocking behavior.
alter table app.deposit_execution_attempts
  add column routine_review_isolated boolean not null default false,
  add constraint deposit_execution_attempts_isolated_review_shape check (
    not routine_review_isolated or status = 'review_required'
  );
drop index app.deposit_execution_attempts_one_blocking_agent_idx;
create unique index deposit_execution_attempts_one_blocking_agent_idx
  on app.deposit_execution_attempts (platform_agent_account_id)
  where status in ('prepared', 'final_action_fenced', 'reconciliation_required')
    or (status = 'review_required' and not routine_review_isolated);

create function app.route_routine_deposit_uncertainty_to_review(
  p_attempt_id uuid,
  p_worker_id uuid,
  p_reason_code text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  attempt app.deposit_execution_attempts%rowtype;
  execution_job app.deposit_jobs%rowtype;
  reconciliation_job app.deposit_jobs%rowtype;
  recorded record;
  disposition text;
begin
  if p_attempt_id is null or p_worker_id is null
    or p_reason_code not in ('execution_uncertain', 'reconciliation_uncertain') then
    raise exception 'The routine review request is invalid.';
  end if;

  select current_attempt.* into attempt
    from app.deposit_execution_attempts current_attempt
    where current_attempt.id = p_attempt_id for update;
  if attempt.id is null then
    raise exception 'The routine execution attempt is unavailable.';
  end if;
  if not exists (select 1 from app.routine_telebirr_execution_bindings binding
      where binding.execution_job_id = attempt.deposit_job_id
        and binding.deposit_intent_id = attempt.deposit_intent_id) then
    raise exception 'The attempt is not a routine Companion credit.';
  end if;
  if attempt.status = 'confirmed_executed' then
    return 'already_confirmed';
  end if;
  if attempt.status in ('review_required', 'cancelled_before_action') then
    disposition := 'owner_review';
  elsif attempt.status = 'prepared' then
    select job.* into execution_job from app.deposit_jobs job
      where job.id = attempt.deposit_job_id for update;
    if execution_job.status <> 'leased'
      or execution_job.lease_token is null
      or execution_job.leased_by is distinct from p_worker_id::text then
      raise exception 'The unfenced routine lease cannot be reviewed by this worker.';
    end if;
    perform * from app.cancel_deposit_execution_before_action(
      attempt.id, execution_job.lease_token, 'preparation_failed'
    );
    disposition := 'owner_review';
  else
    if attempt.status = 'final_action_fenced' then
      select job.* into execution_job from app.deposit_jobs job
        where job.id = attempt.deposit_job_id for update;
      if execution_job.status <> 'leased'
        or execution_job.lease_token is null
        or execution_job.leased_by is distinct from p_worker_id::text then
        raise exception 'The fenced routine lease cannot be reviewed by this worker.';
      end if;
      -- No exact credit fact can be asserted after a lost fence/dispatch reply.
      perform * from app.require_deposit_execution_reconciliation(
        attempt.id, execution_job.lease_token, false
      );
      select current_attempt.* into attempt
        from app.deposit_execution_attempts current_attempt
        where current_attempt.id = p_attempt_id for update;
    end if;
    if attempt.status <> 'reconciliation_required' then
      raise exception 'The routine uncertainty cannot be isolated.';
    end if;
    select job.* into reconciliation_job from app.deposit_jobs job
      where job.deposit_intent_id = attempt.deposit_intent_id
        and job.job_kind = 'reconcile_execution'
        and job.status in ('queued', 'retry_wait', 'leased')
      order by job.created_at desc, job.id desc limit 1 for update;
    if reconciliation_job.id is null
      or (reconciliation_job.status = 'leased'
        and reconciliation_job.lease_expires_at > pg_catalog.clock_timestamp()
        and reconciliation_job.leased_by is distinct from p_worker_id::text) then
      raise exception 'The routine reconciliation is owned by another worker.';
    end if;
    if reconciliation_job.status <> 'leased'
      or reconciliation_job.lease_expires_at <= pg_catalog.clock_timestamp() then
      update app.deposit_jobs job set
        status = 'leased',
        attempt_count = least(job.max_attempts, job.attempt_count + 1),
        lease_token = gen_random_uuid(),
        leased_by = p_worker_id::text,
        lease_expires_at = pg_catalog.clock_timestamp() + interval '1 minute',
        last_error_code = null
      where job.id = reconciliation_job.id returning * into reconciliation_job;
    end if;
    select * into recorded from app.record_deposit_execution_reconciliation(
      reconciliation_job.id, reconciliation_job.lease_token, 'ambiguous',
      null, null, null, null, attempt.exact_player_credit_match
    );
    if recorded.outcome is distinct from 'ambiguous'
      or recorded.attempt_status is distinct from 'review_required'
      or recorded.deposit_status is distinct from 'execution_review'
      or recorded.execution_attempt_id is distinct from attempt.id then
      raise exception 'The routine uncertainty review was not recorded.';
    end if;
    disposition := 'owner_review';
  end if;

  insert into app.deposit_review_cases (deposit_intent_id, review_kind, reason_code)
    values (attempt.deposit_intent_id, 'execution', p_reason_code)
    on conflict (deposit_intent_id, review_kind)
      where status in ('open', 'assigned') do nothing;
  if not exists (select 1 from app.deposit_review_cases review
      where review.deposit_intent_id = attempt.deposit_intent_id
        and review.review_kind = 'execution'
        and review.status in ('open', 'assigned')) then
    raise exception 'The routine Owner review is unavailable.';
  end if;
  if (select current_attempt.status = 'review_required'
      from app.deposit_execution_attempts current_attempt
      where current_attempt.id = attempt.id) then
    update app.deposit_execution_attempts current_attempt
      set routine_review_isolated = true
      where current_attempt.id = attempt.id
        and current_attempt.status = 'review_required';
  end if;
  return disposition;
end;
$$;
alter function app.route_routine_deposit_uncertainty_to_review(uuid,uuid,text)
  owner to postgres;
revoke all on function app.route_routine_deposit_uncertainty_to_review(uuid,uuid,text)
  from public, anon, authenticated, service_role,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

-- Admission rechecks this under the same lease transaction. An unresolved
-- possible credit to a Player must be resolved before another payment to that
-- same Player can be automatically credited, even across providers.
create or replace function app.assess_routine_telebirr_execution_job(p_execution_job_id uuid)
returns table (
  authorization_id uuid, platform_agent_account_id uuid, deposit_intent_id uuid,
  deposit_payment_claim_id uuid, player_id text, amount_minor bigint,
  currency_code text
)
language sql stable security definer
set search_path = ''
as $$
  select assessed.* from (
    select * from app.assess_routine_telebirr_execution_job_legacy(p_execution_job_id)
      where not exists (select 1 from app.receiver_sms_route_control control
        where control.singleton and control.enabled)
    union all
    select * from app.assess_receiver_sms_execution_job(p_execution_job_id)
      where exists (select 1 from app.receiver_sms_route_control control
        where control.singleton and control.enabled)
  ) assessed
  where not exists (
    select 1 from app.deposit_intents current_intent
    join app.deposit_intents previous_intent
      on previous_intent.player_account_id = current_intent.player_account_id
    join app.deposit_execution_attempts previous_attempt
      on previous_attempt.deposit_intent_id = previous_intent.id
      and previous_attempt.platform_agent_account_id = assessed.platform_agent_account_id
      and previous_attempt.status = 'review_required'
    where current_intent.id = assessed.deposit_intent_id
      and (exists (select 1 from app.deposit_review_cases review
          where review.deposit_intent_id = previous_intent.id
            and review.review_kind = 'execution'
            and review.status in ('open', 'assigned'))
        or not exists (select 1 from app.deposit_review_cases review
          where review.deposit_intent_id = previous_intent.id
            and review.review_kind = 'execution'))
  )
$$;
alter function app.assess_routine_telebirr_execution_job(uuid) owner to postgres;
revoke all on function app.assess_routine_telebirr_execution_job(uuid)
  from public, anon, authenticated, service_role;

do $broker_patch$
declare
  target pg_catalog.regprocedure :=
    'app.execute_agent_platform_routine_deposit_command(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb)'::pg_catalog.regprocedure;
  previous_definition text := pg_catalog.pg_get_functiondef(target);
  previous_acl pg_catalog.aclitem[];
  previous_owner oid;
  old_lane text := $old$
  where existing.platform_agent_account_id = activation.platform_agent_account_id
    and existing.status in ('prepared', 'final_action_fenced', 'reconciliation_required', 'review_required')
  order by existing.created_at, existing.id limit 1 for update of existing;$old$;
  new_lane text := $new$
  where operation = 'lease'
    and existing.platform_agent_account_id = activation.platform_agent_account_id
    and (existing.status in ('prepared', 'final_action_fenced', 'reconciliation_required')
      or (existing.status = 'review_required' and not existing.routine_review_isolated))
  order by existing.created_at, existing.id limit 1 for update of existing;$new$;
  old_pause text := $old$
    elsif operation = 'pause' then
      select event.* into latest_policy from app.routine_telebirr_processing_events event
        order by event.event_sequence desc limit 1 for share;
      if latest_policy.id is null then raise exception 'The routine policy event is unavailable.'; end if;
      if attempt.id is not null and attempt.status = 'prepared' then
        select job.* into execution_job from app.deposit_jobs job
          where job.id = attempt.deposit_job_id for update;
        if execution_job.status <> 'leased'
          or execution_job.lease_token is null
          or execution_job.leased_by is distinct from worker_id::text then
          raise exception 'The unfenced routine lease cannot be closed by this worker.';
        end if;
        perform * from app.cancel_deposit_execution_before_action(
          attempt.id, execution_job.lease_token, 'preparation_failed'
        );
      end if;
      insert into app.routine_telebirr_runtime_pauses (
        authorization_event_sequence, broker_request_id, execution_attempt_id,
        reason_code, certificate_id
      ) values (
        latest_policy.event_sequence, command_request_id, attempt.id,
        p_command ->> 'reason', certificate_uuid
      ) on conflict (authorization_event_sequence) do nothing;
      result := 'null'::jsonb;$old$;
  new_pause text := $new$
    elsif operation = 'pause' then
      select event.* into latest_policy from app.routine_telebirr_processing_events event
        order by event.event_sequence desc limit 1 for share;
      if latest_policy.id is null then raise exception 'The routine policy event is unavailable.'; end if;
      if p_command ->> 'reason' in ('execution_uncertain', 'reconciliation_uncertain') then
        if attempt.id is null then
          raise exception 'A bound attempt is required for isolated routine review.';
        end if;
        perform app.route_routine_deposit_uncertainty_to_review(
          attempt.id, worker_id, p_command ->> 'reason'
        );
      else
        if attempt.id is not null and attempt.status = 'prepared' then
          select job.* into execution_job from app.deposit_jobs job
            where job.id = attempt.deposit_job_id for update;
          if execution_job.status <> 'leased'
            or execution_job.lease_token is null
            or execution_job.leased_by is distinct from worker_id::text then
            raise exception 'The unfenced routine lease cannot be closed by this worker.';
          end if;
          perform * from app.cancel_deposit_execution_before_action(
            attempt.id, execution_job.lease_token, 'preparation_failed'
          );
        end if;
        insert into app.routine_telebirr_runtime_pauses (
          authorization_event_sequence, broker_request_id, execution_attempt_id,
          reason_code, certificate_id
        ) values (
          latest_policy.event_sequence, command_request_id, attempt.id,
          p_command ->> 'reason', certificate_uuid
        ) on conflict (authorization_event_sequence) do nothing;
      end if;
      result := 'null'::jsonb;$new$;
  updated_definition text;
begin
  select routine.proacl, routine.proowner into previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if pg_catalog.md5((select prosrc from pg_catalog.pg_proc where oid = target))
       <> '938c311fcca44f09ede14c066de090f5'
    or pg_catalog.length(previous_definition) -
      pg_catalog.length(pg_catalog.replace(previous_definition, old_lane, ''))
      <> pg_catalog.length(old_lane)
    or pg_catalog.length(previous_definition) -
      pg_catalog.length(pg_catalog.replace(previous_definition, old_pause, ''))
      <> pg_catalog.length(old_pause) then
    raise exception 'The routine broker source changed before review isolation.';
  end if;
  updated_definition := pg_catalog.replace(previous_definition, old_lane, new_lane);
  updated_definition := pg_catalog.replace(updated_definition, old_pause, new_pause);
  execute updated_definition;
  if (select routine.proowner = previous_owner
      and routine.proacl is not distinct from previous_acl
      and routine.prosecdef and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.strpos(routine.prosrc, new_lane) > 0
      and pg_catalog.strpos(routine.prosrc, new_pause) > 0
      from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'The routine broker review isolation postcondition failed.';
  end if;
end;
$broker_patch$;

-- A past reviewed claim remains bound to its original authorization. It must
-- not block certificate or policy renewal after the active lane is clear.
do $activation_patch$
declare
  target pg_catalog.regprocedure :=
    'app.activate_routine_telebirr_execution_transport(uuid,uuid,uuid,text)'::pg_catalog.regprocedure;
  previous_definition text := pg_catalog.pg_get_functiondef(target);
  previous_acl pg_catalog.aclitem[];
  previous_owner oid;
  old_guard text := $old$
    where attempt.status in ('prepared', 'final_action_fenced', 'reconciliation_required', 'review_required')
      and (binding.authorization_id <> authority.id
        or attempt.platform_agent_account_id <> authority.platform_agent_account_id)$old$;
  new_guard text := $new$
    where (attempt.status in ('prepared', 'final_action_fenced', 'reconciliation_required')
      or (attempt.status = 'review_required' and not attempt.routine_review_isolated))
      and (binding.authorization_id <> authority.id
        or attempt.platform_agent_account_id <> authority.platform_agent_account_id)$new$;
begin
  select routine.proacl, routine.proowner into previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if pg_catalog.md5((select prosrc from pg_catalog.pg_proc where oid = target))
       <> '2ec4a783480d249e27ba78196639e178'
    or pg_catalog.length(previous_definition) -
      pg_catalog.length(pg_catalog.replace(previous_definition, old_guard, ''))
      <> pg_catalog.length(old_guard) then
    raise exception 'The routine activation source changed before review isolation.';
  end if;
  execute pg_catalog.replace(previous_definition, old_guard, new_guard);
  if (select routine.proowner = previous_owner
      and routine.proacl is not distinct from previous_acl
      and routine.prosecdef and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.strpos(routine.prosrc, new_guard) > 0
      from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'The routine activation review isolation postcondition failed.';
  end if;
end;
$activation_patch$;
commit;
