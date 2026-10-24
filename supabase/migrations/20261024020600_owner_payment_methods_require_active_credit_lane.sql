-- A signed worker heartbeat does not mean that it can lease a credit job. A
-- durable routine pause must also stop new deposit instructions for both
-- providers until the Owner reviews the stopped attempt and reauthorizes.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $repair$
declare
  target pg_catalog.regprocedure := 'app.owner_provider_deposit_readiness(text)'::pg_catalog.regprocedure;
  previous_source text;
  previous_definition text;
  previous_acl pg_catalog.aclitem[];
  previous_owner oid;
  old_branch text := $old$
  if not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    return 'credit_worker_offline';
  end if;
$old$;
  new_branch text := $new$
  if not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    return 'credit_worker_offline';
  end if;
  if not app.routine_telebirr_runtime_is_active() then
    return 'credit_worker_paused';
  end if;
$new$;
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid),
    routine.proacl, routine.proowner
    into previous_source, previous_definition, previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if pg_catalog.md5(previous_source) <> 'ee8d9c6765703b956bc46756e969be18'
    or previous_owner <> 'postgres'::pg_catalog.regrole
    or (select routine.prosecdef and routine.proconfig =
      array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc routine where routine.oid = target) is not true
    or pg_catalog.length(previous_source) -
      pg_catalog.length(pg_catalog.replace(previous_source, old_branch, ''))
      <> pg_catalog.length(old_branch) then
    raise exception 'Owner payment readiness preflight failed.';
  end if;
  execute pg_catalog.replace(previous_definition, old_branch, new_branch);
  if (select routine.proowner = previous_owner and
       routine.proacl is not distinct from previous_acl and routine.prosecdef and
       routine.proconfig = array['search_path=pg_catalog']::text[] and
       pg_catalog.strpos(routine.prosrc, new_branch) > 0
       from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'Owner payment readiness postcondition failed.';
  end if;
end;
$repair$;

comment on function app.owner_provider_deposit_readiness(text) is
  'Deposit instructions require both a recent signed credit worker and an active, unpaused routine execution lane.';
commit;
