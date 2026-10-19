-- Allow only the deployed Owner runtime to read the current CBE Birr receiver
-- revision's nonsecret metadata. The function returns no phone or key material.
-- This grant is inert for verification, lookup, payment, and Player credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $preflight$
declare
  routine pg_catalog.pg_proc%rowtype;
begin
  select procedure.* into routine
    from pg_catalog.pg_proc procedure
   where procedure.oid = pg_catalog.to_regprocedure(
     'app.inspect_owner_cbe_birr_provisioning_snapshot(uuid)');
  if not found
    or routine.proowner is distinct from 'postgres'::pg_catalog.regrole
    or not routine.prosecdef
    or routine.prokind is distinct from 'f'
    or routine.proconfig is distinct from
      array['search_path=pg_catalog, pg_temp']::text[]
    or pg_catalog.pg_get_function_result(routine.oid) is distinct from
      'TABLE(receiver_revision_id uuid, receiver_version integer, protection_profile_version smallint, encryption_key_version smallint, fingerprint_key_version smallint)'
    or pg_catalog.md5(pg_catalog.replace(routine.prosrc, E'\r\n', E'\n'))
      is distinct from 'b632307db8def150be396690db96b4ed' then
    raise exception 'The reviewed CBE Birr Owner snapshot function is unavailable.';
  end if;

  if (select pg_catalog.count(*) from app.feature_switches switch
       where switch.feature_key = 'cbe_birr_authoritative_verification'
         and switch.mode = 'disabled' and switch.settings = '{}'::jsonb) <> 1
    or not exists (select 1 from pg_catalog.pg_roles role
       where role.rolname = 'fetanagent_owner_control' and not role.rolcanlogin)
    or exists (
      select 1 from pg_catalog.aclexplode(coalesce(routine.proacl,
        pg_catalog.acldefault('f', routine.proowner))) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee <> 'postgres'::pg_catalog.regrole
    ) then
    raise exception 'The CBE Birr Owner snapshot grant preconditions changed.';
  end if;
end;
$preflight$;

grant execute on function app.inspect_owner_cbe_birr_provisioning_snapshot(uuid)
  to fetanagent_owner_control;

do $postflight$
declare
  routine oid := 'app.inspect_owner_cbe_birr_provisioning_snapshot(uuid)'
    ::pg_catalog.regprocedure;
begin
  if not pg_catalog.has_function_privilege(
      'fetanagent_owner_control_runtime', routine, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'fetanagent_cbe_birr_shadow_worker', routine, 'EXECUTE')
    or exists (
      select 1 from pg_catalog.aclexplode((select procedure.proacl
          from pg_catalog.pg_proc procedure where procedure.oid = routine)) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee not in ('postgres'::pg_catalog.regrole,
           'fetanagent_owner_control'::pg_catalog.regrole)
    ) then
    raise exception 'The CBE Birr Owner snapshot grant is not exact.';
  end if;
end;
$postflight$;

comment on function app.inspect_owner_cbe_birr_provisioning_snapshot(uuid) is
  'Owner-only read of active CBE Birr v2 receiver revision metadata while CBE verification is disabled. Returns no receiver digits, key, reference, or payment authority.';

commit;
