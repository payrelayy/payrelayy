-- A queued receiver-SMS job can otherwise spend the broker statement timeout
-- planning this many-table admission query. Keep the exact admission checks,
-- function identity and grants, while preserving the written join order.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $bound_assessor_planning$
declare
  target pg_catalog.regprocedure :=
    'app.assess_receiver_sms_execution_job(uuid)'::pg_catalog.regprocedure;
  previous_acl pg_catalog.aclitem[];
begin
  select routine.proacl into previous_acl
    from pg_catalog.pg_proc routine where routine.oid = target;

  if (select routine.proowner = 'postgres'::pg_catalog.regrole
      and routine.prosecdef
      and routine.proconfig = array['search_path=""']::text[]
      and pg_catalog.md5(routine.prosrc) = 'ec02831f62cc65074e605a11a4c34588'
      and not pg_catalog.has_function_privilege('public', target, 'execute')
      and not pg_catalog.has_function_privilege('anon', target, 'execute')
      and not pg_catalog.has_function_privilege('authenticated', target, 'execute')
      and not pg_catalog.has_function_privilege('service_role', target, 'execute')
      from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'Receiver-SMS admission assessor changed before planning repair.';
  end if;

  execute 'alter function app.assess_receiver_sms_execution_job(uuid) '
    || 'set join_collapse_limit = 1';

  if (select routine.proowner = 'postgres'::pg_catalog.regrole
      and routine.prosecdef
      and routine.proacl is not distinct from previous_acl
      and routine.proconfig @> array[
        'search_path=""', 'join_collapse_limit=1']::text[]
      and pg_catalog.cardinality(routine.proconfig) = 2
      and pg_catalog.md5(routine.prosrc) = 'ec02831f62cc65074e605a11a4c34588'
      from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'Receiver-SMS admission planning repair failed its postcondition.';
  end if;
end;
$bound_assessor_planning$;
commit;
