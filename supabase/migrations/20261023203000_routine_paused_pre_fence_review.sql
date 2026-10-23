-- A signed routine pause must not leave an unfenced lease in execution_pending.
-- The existing cancellation procedure preserves the payment claim and creates
-- an Owner review case. Fenced attempts remain untouched for reconciliation.
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
    elsif operation = 'pause' then
      select event.* into latest_policy from app.routine_telebirr_processing_events event
        order by event.event_sequence desc limit 1 for share;
      if latest_policy.id is null then raise exception 'The routine policy event is unavailable.'; end if;
      insert into app.routine_telebirr_runtime_pauses (
$old$;
  new_branch text := $new$
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
$new$;
  updated_definition text;
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid),
    routine.proacl, routine.proowner
    into previous_source, previous_definition, previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if pg_catalog.md5(previous_source) <> 'c3c43c2f3406387d05be688f6277c115'
    or previous_owner <> 'postgres'::pg_catalog.regrole
    or (select routine.prosecdef and routine.proconfig =
      array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc routine where routine.oid = target) is not true
    or pg_catalog.length(previous_source) -
      pg_catalog.length(pg_catalog.replace(previous_source, old_branch, ''))
      <> pg_catalog.length(old_branch)
    or (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in ('payment_verification', 'deposit_execution')
        and feature.mode = 'disabled') <> 2
    or exists (select 1 from app.deposit_jobs job
      where job.status::text in ('queued', 'leased'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then
    raise exception 'Routine pre-fence pause repair preflight failed.';
  end if;
  updated_definition := pg_catalog.replace(previous_definition, old_branch, new_branch);
  if updated_definition = previous_definition then
    raise exception 'The routine pause branch was not replaced.';
  end if;
  execute updated_definition;
  if (select routine.proowner = previous_owner and
       routine.proacl is not distinct from previous_acl and routine.prosecdef and
       routine.proconfig = array['search_path=pg_catalog']::text[] and
       pg_catalog.strpos(routine.prosrc, new_branch) > 0
       from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'Routine pre-fence pause repair postcondition failed.';
  end if;
end;
$repair$;
commit;
