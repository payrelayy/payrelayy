-- Expose only revision metadata to the Owner role after its catalog allowlist ships.
-- This grants no lookup material, worker access, CBE verification, or payment authority.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $$
begin
  if not exists (
    select 1
      from pg_proc routine
     where routine.oid = 'app.inspect_owner_cbe_birr_provisioning_snapshot(uuid)'::regprocedure
       and routine.prosecdef
       and routine.proowner = 'postgres'::regrole
       and routine.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
       and not exists (
         select 1
           from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) acl
          where acl.privilege_type = 'EXECUTE'
            and acl.grantee not in ('postgres'::regrole, 'fetanagent_owner_control'::regrole)
       )
  ) then
    raise exception 'CBE Birr provisioning snapshot catalog is not private and hardened.';
  end if;

  if not exists (
    select 1 from app.feature_switches
     where feature_key = 'cbe_birr_authoritative_verification'
       and mode = 'disabled'
  ) then
    raise exception 'CBE Birr verification must remain disabled for the Owner snapshot grant.';
  end if;
end;
$$;

grant execute on function app.inspect_owner_cbe_birr_provisioning_snapshot(uuid)
  to fetanagent_owner_control;

comment on function app.inspect_owner_cbe_birr_provisioning_snapshot(uuid) is
  'Owner-only metadata snapshot of the active immutable v2 CBE Birr receiver revision while CBE verification is disabled. No key or reference material; no worker access.';

commit;
