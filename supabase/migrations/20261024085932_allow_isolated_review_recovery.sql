-- An isolated routine Owner review is a terminal one-use payment case, not an
-- active execution attempt. Keep all other outstanding attempts blocking the
-- guarded CBE-stopped recovery path.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $isolated_review_recovery$
declare
  target pg_catalog.regprocedure :=
    'app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid)'::pg_catalog.regprocedure;
  previous_definition text := pg_catalog.pg_get_functiondef(target);
  previous_acl pg_catalog.aclitem[];
  previous_owner oid;
  old_guard text := $old$
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then$old$;
  new_guard text := $new$
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required')
        or (attempt.status = 'review_required'
          and not attempt.routine_review_isolated)) then$new$;
begin
  select routine.proacl, routine.proowner into previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if previous_owner is distinct from 'postgres'::pg_catalog.regrole
    or (select routine.prosecdef = false
        and routine.proconfig = array['search_path=pg_catalog']::text[]
        from pg_catalog.pg_proc routine where routine.oid = target) is not true
    or pg_catalog.has_function_privilege('public', target, 'execute')
    or pg_catalog.has_function_privilege('authenticated', target, 'execute')
    or pg_catalog.has_function_privilege('service_role', target, 'execute')
    or pg_catalog.length(previous_definition) -
      pg_catalog.length(pg_catalog.replace(previous_definition, old_guard, ''))
      <> pg_catalog.length(old_guard) then
    raise exception 'The stopped SMS recovery source changed before review isolation.';
  end if;
  execute pg_catalog.replace(previous_definition, old_guard, new_guard);
  if (select routine.proowner = previous_owner
      and routine.proacl is not distinct from previous_acl
      and not routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.strpos(routine.prosrc, new_guard) > 0
      from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'The stopped SMS recovery review-isolation postcondition failed.';
  end if;
end;
$isolated_review_recovery$;

comment on function app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid) is
  'One-use CBE-stopped signed-SMS recovery. Requires both paid receipt roles retired, current signed SMS and idle worker. Active or unisolated credit attempts block recovery; durable isolated Owner reviews retain their one-use claims without blocking other Players.';
commit;
