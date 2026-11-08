-- A stale worker heartbeat must not prevent the same worker from leasing its
-- next job or fencing a transfer already in progress. Keep all receiver,
-- phone, feature, and Owner checks in those financial transitions.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $repair$
declare
  v_readiness text;
  v_require text;
  v_trigger text;
  v_old text;
begin
  -- The incident repair was applied directly before migration history could be
  -- recorded. Reapplying this file must verify that exact repaired state.
  if (select pg_catalog.md5(p.prosrc) = 'ab22b006c4c5c91208b3eae913da1d31'
        and p.proowner = 'postgres'::pg_catalog.regrole and p.prosecdef
        and p.proconfig = array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc p
      where p.oid = 'app.enforce_owner_provider_deposit_pause()'::pg_catalog.regprocedure)
      and (select pg_catalog.md5(p.prosrc) = 'fd37bed90572df28202e8b3d74f8714c'
        and p.proowner = 'postgres'::pg_catalog.regrole and p.prosecdef
        and p.proconfig = array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc p
      where p.oid = 'app.owner_provider_deposit_transition_readiness(text)'::pg_catalog.regprocedure)
      and (select pg_catalog.md5(p.prosrc) = 'f26104961107b07a5451e5b5c475db4c'
        and p.proowner = 'postgres'::pg_catalog.regrole and p.prosecdef
        and p.proconfig = array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc p
      where p.oid = 'app.require_owner_provider_deposit_transition_enabled(uuid)'::pg_catalog.regprocedure)
  then
    return;
  end if;

  if (select pg_catalog.md5(p.prosrc) = '2f1e064e02473d3a4e38b98c66c4c7d2'
        and p.proowner = 'postgres'::pg_catalog.regrole and p.prosecdef
        and p.proconfig = array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc p
      where p.oid = 'app.owner_provider_deposit_readiness(text)'::pg_catalog.regprocedure)
      is not true then
    raise exception 'Owner provider readiness changed before recovery repair.';
  end if;
  if (select pg_catalog.md5(p.prosrc) = '9f792170226a2998dd79614b60ec8801'
        and p.proowner = 'postgres'::pg_catalog.regrole and p.prosecdef
        and p.proconfig = array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc p
      where p.oid = 'app.require_owner_provider_deposit_enabled(uuid)'::pg_catalog.regprocedure)
      is not true then
    raise exception 'Owner provider guard changed before recovery repair.';
  end if;
  if (select pg_catalog.md5(p.prosrc) = '6481a51497eb9e409827954ea2b06f66'
        and p.proowner = 'postgres'::pg_catalog.regrole and p.prosecdef
        and p.proconfig = array['search_path=pg_catalog']::text[]
      from pg_catalog.pg_proc p
      where p.oid = 'app.enforce_owner_provider_deposit_pause()'::pg_catalog.regprocedure)
      is not true then
    raise exception 'Owner provider trigger changed before recovery repair.';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid) into v_readiness
    from pg_catalog.pg_proc p
    where p.oid = 'app.owner_provider_deposit_readiness(text)'::pg_catalog.regprocedure;
  v_readiness := pg_catalog.replace(v_readiness,
    'FUNCTION app.owner_provider_deposit_readiness(p_provider_code text)',
    'FUNCTION app.owner_provider_deposit_transition_readiness(p_provider_code text)');
  v_old := $heartbeat$  if not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    return 'credit_worker_offline';
  end if;
$heartbeat$;
  if (pg_catalog.length(v_readiness) - pg_catalog.length(pg_catalog.replace(v_readiness,v_old,'')))
      / pg_catalog.length(v_old) <> 1 then
    raise exception 'Owner readiness heartbeat clause changed.';
  end if;
  v_readiness := pg_catalog.replace(v_readiness,v_old,'');
  execute v_readiness;
  revoke all on function app.owner_provider_deposit_transition_readiness(text)
    from public, anon, authenticated, service_role;

  select pg_catalog.pg_get_functiondef(p.oid) into v_require
    from pg_catalog.pg_proc p
    where p.oid = 'app.require_owner_provider_deposit_enabled(uuid)'::pg_catalog.regprocedure;
  v_require := pg_catalog.replace(v_require,
    'FUNCTION app.require_owner_provider_deposit_enabled(p_provider_id uuid)',
    'FUNCTION app.require_owner_provider_deposit_transition_enabled(p_provider_id uuid)');
  v_require := pg_catalog.replace(v_require,
    'app.owner_provider_deposit_readiness(v_provider_code)',
    'app.owner_provider_deposit_transition_readiness(v_provider_code)');
  execute v_require;
  revoke all on function app.require_owner_provider_deposit_transition_enabled(uuid)
    from public, anon, authenticated, service_role;

  select pg_catalog.pg_get_functiondef(p.oid) into v_trigger
    from pg_catalog.pg_proc p
    where p.oid = 'app.enforce_owner_provider_deposit_pause()'::pg_catalog.regprocedure;
  v_old := 'perform app.require_owner_provider_deposit_enabled(v_provider_id);';
  if (pg_catalog.length(v_trigger) - pg_catalog.length(pg_catalog.replace(v_trigger,v_old,'')))
      / pg_catalog.length(v_old) <> 2 then
    raise exception 'Owner guard transition call sites changed.';
  end if;
  v_trigger := pg_catalog.replace(v_trigger,v_old,
    'perform app.require_owner_provider_deposit_transition_enabled(v_provider_id);');
  execute v_trigger;

  if app.owner_provider_deposit_transition_readiness('telebirr') <> 'ready'
    or app.owner_provider_deposit_transition_readiness('cbe_birr') <> 'ready' then
    raise exception 'Receiver or phone readiness is not satisfied for recovery.';
  end if;
end;
$repair$;

comment on function app.owner_provider_deposit_transition_readiness(text) is
  'For an in-progress financial transition only: checks Owner, receiver, phone, and runtime readiness without a circular worker-heartbeat requirement.';
comment on function app.require_owner_provider_deposit_transition_enabled(uuid) is
  'Owner provider veto for deposit lease and final-action fence. A stale worker heartbeat cannot block its own recovery.';

commit;
