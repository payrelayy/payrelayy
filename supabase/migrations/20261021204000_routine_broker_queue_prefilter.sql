-- A live SMS lease must not assess every historical deposit job. The Companion
-- shares its browser with Player ID Find, so a slow empty lease also delays Find.
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
  old_scan text := $old$
        from app.deposit_jobs job
        cross join lateral app.assess_routine_telebirr_execution_job(job.id) assessed
        where assessed.authorization_id = activation.authorization_id$old$;
  new_scan text := $new$
        from app.deposit_jobs job
        cross join lateral app.assess_routine_telebirr_execution_job(job.id) assessed
        where job.job_kind = 'execute_deposit' and job.status = 'queued'
          and assessed.authorization_id = activation.authorization_id$new$;
  updated_definition text;
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid),
    routine.proacl, routine.proowner
    into previous_source, previous_definition, previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if pg_catalog.md5(previous_source) <> '8d133ae7d9652d20371a4b909ea8075a'
    or previous_owner <> 'postgres'::pg_catalog.regrole
    or (select routine.prosecdef and routine.proconfig =
      array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc routine where routine.oid = target) is not true
    or pg_catalog.length(previous_source) -
      pg_catalog.length(pg_catalog.replace(previous_source, old_scan, ''))
      <> pg_catalog.length(old_scan)
    or (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in ('payment_verification', 'deposit_execution',
        'cbe_birr_authoritative_verification') and feature.mode = 'disabled') <> 3
    or (select control.enabled from app.receiver_sms_route_control control
      where control.singleton) is distinct from false
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then
    raise exception 'Routine broker repair preflight failed.';
  end if;
  updated_definition := pg_catalog.replace(previous_definition, old_scan, new_scan);
  if updated_definition = previous_definition then
    raise exception 'Routine broker scan was not replaced.';
  end if;
  execute updated_definition;
  if (select routine.proowner = previous_owner and
       routine.proacl is not distinct from previous_acl and routine.prosecdef and
       routine.proconfig = array['search_path=pg_catalog']::text[] and
       pg_catalog.strpos(routine.prosrc, new_scan) > 0
       from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'Routine broker repair postcondition failed.';
  end if;
end;
$repair$;
commit;
