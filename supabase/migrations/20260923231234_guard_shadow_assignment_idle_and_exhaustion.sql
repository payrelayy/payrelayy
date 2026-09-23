-- An idle evidence-only phone must not consume bounded shadow attempts before
-- the one-time verifier runtime is provisioned. Preserve the live-pilot branch,
-- the shadow no-money gate, and the hard 100-attempt limit. An exhausted,
-- immutable proof stays reviewable but cannot starve a later eligible proof.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $guard_shadow_assignment_idle_and_exhaustion$
declare
  target record;
  routine_oid oid;
  original_definition text;
  original_source text;
  rewritten_source text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  original_volatility "char";
  original_parallel "char";
  original_leakproof boolean;
  original_security_definer boolean;
  original_returns_set boolean;
begin
  for target in
    select * from (values
      (
        'lease_private_live_telebirr_assignment_broker',
        4,
        '39daac1eeb1a821d416e934599b2eae8f276d6bcfde7da59c6d1b4e2fac49ce8',
        $old_wrapper$  return query select *
    from app.lease_private_telebirr_shadow_assignment($old_wrapper$,
        $new_wrapper$  -- Only the one-time, bounded no-money shadow verifier may open
  -- assignment leasing. Idle phone polling remains a signed no_assignment.
  if not exists (
    select 1
      from pg_catalog.pg_roles role
      join pg_catalog.pg_authid auth on auth.oid = role.oid
     where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
       and role.rolcanlogin
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and auth.rolpassword is not null
       and role.rolvaliduntil > pg_catalog.clock_timestamp()
       and role.rolvaliduntil <=
           pg_catalog.clock_timestamp() + interval '25 minutes'
  ) then
    return;
  end if;

  return query select *
    from app.lease_private_telebirr_shadow_assignment($new_wrapper$
      ),
      (
        'lease_private_telebirr_shadow_assignment',
        4,
        '9920b5985306be59c08b98a278586ce8727ee01300d5467acee73c3cfdcc8b0b',
        $old_inner$     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_attempts attempt
        where attempt.shadow_proof_request_id = candidate.id
          and authority_at < attempt.expires_at
     )
   order by candidate.submitted_at, candidate.id$old_inner$,
        $new_inner$     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_attempts attempt
        where attempt.shadow_proof_request_id = candidate.id
          and authority_at < attempt.expires_at
     )
     and (
       select pg_catalog.count(*)
         from app.private_telebirr_shadow_verification_attempts attempt
        where attempt.shadow_proof_request_id = candidate.id
          and attempt.verification_job_id = candidate.verification_job_id
     ) < 100
   order by candidate.submitted_at, candidate.id$new_inner$
      )
    ) as expected(proname, pronargs, source_sha256, old_fragment, new_fragment)
  loop
    select routine.oid, pg_catalog.pg_get_functiondef(routine.oid),
           routine.prosrc, routine.proowner, routine.proacl, routine.proconfig,
           routine.provolatile, routine.proparallel, routine.proleakproof,
           routine.prosecdef, routine.proretset
      into routine_oid, original_definition, original_source, original_owner,
           original_acl, original_config, original_volatility,
           original_parallel, original_leakproof, original_security_definer,
           original_returns_set
      from pg_catalog.pg_proc routine
     where routine.pronamespace = 'app'::regnamespace
       and routine.proname = target.proname
       and routine.pronargs = target.pronargs
       and routine.prokind = 'f';

    if routine_oid is null
      or original_owner is distinct from (
        select role.oid from pg_catalog.pg_roles role
         where role.rolname = 'postgres'
      )
      or original_config is distinct from array['search_path=pg_catalog']::text[]
      or original_volatility is distinct from 'v'
      or original_parallel is distinct from 'u'
      or original_leakproof
      or not original_security_definer
      or not original_returns_set
      or pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'
           ), 'hex'
         ) <> target.source_sha256
      or (pg_catalog.length(original_definition) -
          pg_catalog.length(pg_catalog.replace(
            original_definition, original_source, ''
          ))) / pg_catalog.length(original_source) <> 1
      or (pg_catalog.length(original_source) -
          pg_catalog.length(pg_catalog.replace(
            original_source, target.old_fragment, ''
          ))) / pg_catalog.length(target.old_fragment) <> 1
      or pg_catalog.has_function_privilege('anon', routine_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(
        'authenticated', routine_oid, 'EXECUTE'
      )
    then
      raise exception 'The reviewed no-money assignment lease contract changed.';
    end if;

    if target.proname = 'lease_private_live_telebirr_assignment_broker'
      and (pg_catalog.length(original_source) -
           pg_catalog.length(pg_catalog.replace(
             original_source,
             'if not app.private_telebirr_shadow_mode_is_ready(enrollment.pilot_revision_id) then',
             ''
           ))) / pg_catalog.length(
             'if not app.private_telebirr_shadow_mode_is_ready(enrollment.pilot_revision_id) then'
           ) <> 1
    then
      raise exception 'The reviewed shadow no-money gate changed.';
    end if;
    if target.proname = 'lease_private_telebirr_shadow_assignment'
      and (pg_catalog.length(original_source) -
           pg_catalog.length(pg_catalog.replace(
             original_source, 'if attempt_count >= 100 then', ''
           ))) / pg_catalog.length('if attempt_count >= 100 then') <> 1
    then
      raise exception 'The hard shadow attempt limit changed.';
    end if;

    rewritten_source := pg_catalog.replace(
      original_source, target.old_fragment, target.new_fragment
    );
    execute pg_catalog.replace(
      original_definition, original_source, rewritten_source
    );

    if not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = routine_oid
         and routine.prosrc = rewritten_source
         and routine.proowner = original_owner
         and routine.proacl is not distinct from original_acl
         and routine.proconfig is not distinct from original_config
         and routine.provolatile = original_volatility
         and routine.proparallel = original_parallel
         and routine.proleakproof = original_leakproof
         and routine.prosecdef = original_security_definer
         and routine.proretset = original_returns_set
         and not pg_catalog.has_function_privilege(
           'anon', routine.oid, 'EXECUTE'
         )
         and not pg_catalog.has_function_privilege(
           'authenticated', routine.oid, 'EXECUTE'
         )
    ) then
      raise exception 'The no-money assignment lease lost its ACL boundary.';
    end if;
  end loop;
end;
$guard_shadow_assignment_idle_and_exhaustion$;

commit;
