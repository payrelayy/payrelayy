-- A separate, initially NOLOGIN role may call only the four no-money phone
-- functions. The private broker cannot inherit the pilot, deposit, wallet, or
-- payment roles. No credential, signer, transport, or financial mode is enabled.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create role fetanagent_routine_telebirr_no_money
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2;
create role fetanagent_routine_telebirr_no_money_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
grant fetanagent_routine_telebirr_no_money
  to fetanagent_routine_telebirr_no_money_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.routine_telebirr_no_money_session_allowed()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_allowed boolean;
begin
  -- Postgres remains the explicit migration/disposable-test maintenance identity.
  if session_user = 'postgres' then return true; end if;
  if session_user <> 'fetanagent_routine_telebirr_no_money_runtime' then
    return false;
  end if;

  select runtime.rolcanlogin and not runtime.rolinherit
         and not runtime.rolsuper and not runtime.rolcreatedb
         and not runtime.rolcreaterole and not runtime.rolreplication
         and not runtime.rolbypassrls and runtime.rolconnlimit = 1
         and runtime.rolvaliduntil is not null
         and runtime.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
         and runtime.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '30 days 5 minutes'
         and pg_catalog.pg_has_role(session_user,
               'fetanagent_routine_telebirr_no_money', 'USAGE')
         and not pg_catalog.pg_has_role(session_user,
               'fetanagent_routine_telebirr_no_money', 'SET')
         and (
           select pg_catalog.count(*) = 1
                  and pg_catalog.bool_and(
                    granted.rolname = 'fetanagent_routine_telebirr_no_money'
                    and membership.inherit_option
                    and not membership.set_option
                    and not membership.admin_option
                  )
             from pg_catalog.pg_auth_members membership
             join pg_catalog.pg_roles granted on granted.oid = membership.roleid
            where membership.member = runtime.oid
         )
    into v_allowed
    from pg_catalog.pg_roles runtime
   where runtime.rolname = 'fetanagent_routine_telebirr_no_money_runtime';
  return coalesce(v_allowed, false);
end;
$$;
alter function app.routine_telebirr_no_money_session_allowed() owner to postgres;
revoke all on function app.routine_telebirr_no_money_session_allowed()
  from public, anon, authenticated, service_role;

-- The seven installed SECURITY DEFINER routines already enforce the receiver,
-- candidate, device, signer, one-use poll, five-minute challenge, and all seven
-- disabled financial switches. Change only their exact session guard. Pin the
-- reviewed source bodies so a drifted production definition aborts atomically
-- instead of silently broadening an unknown function.
do $allow_only_reviewed_no_money_routines$
declare
  expected record;
  routine_oid oid;
  source_body text;
  definition text;
  patched_body text;
  old_guard constant text := 'session_user <> ''postgres''';
  new_guard constant text := 'not app.routine_telebirr_no_money_session_allowed()';
begin
  for expected in
    select * from (values
      ('app.claim_routine_telebirr_no_money_poll(uuid,uuid,text,timestamptz)',
       '5b84f2683e35ecaf20253831704f928f36ea8c811eaa4c37f973e626d544309f'),
      ('app.issue_routine_telebirr_lookup_assignment_material(uuid,uuid,uuid)',
       '85ec921b8fad266b4ae2d2b95cb499ab64ab33a26db8ad54d617ba46afbce59f'),
      ('app.issue_routine_telebirr_lookup_challenge(uuid,uuid,uuid)',
       'aaec70eec4ce78119275400db8a38193e7e2cf4eccca4e1757fb3bbcec542c16'),
      ('app.issue_routine_telebirr_no_money_poll_assignment(uuid,uuid,text,timestamptz,uuid)',
       '7b4926da0b27523d481129aff3f02708b7b57813853337ead037749383d31fd4'),
      ('app.load_routine_telebirr_no_money_enrollment(uuid)',
       '9eafb4ae8525945f916b5c3b323a49e734945137b49e747b22d512b814d92492'),
      ('app.load_routine_telebirr_no_money_observation_material(uuid)',
       '6d01d312f174638507debd452739fe24a9853a6c90aeb2add5821a17a58bca3a'),
      ('app.stage_routine_telebirr_no_money_observation_digest(uuid,text,text,text,text)',
       'f3750690816c3d8a84e80f3bf52c57933b05e1c11b306e663b9a89fd99d01f3e')
    ) as reviewed(signature, source_sha256)
  loop
    routine_oid := pg_catalog.to_regprocedure(expected.signature);
    if routine_oid is null then
      raise exception 'A reviewed routine no-money function is missing.';
    end if;
    select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
      into source_body, definition
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.proowner = 'postgres'::pg_catalog.regrole
       and routine.prosecdef and routine.prokind = 'f'
       and routine.proconfig = array['search_path=pg_catalog']::text[];
    if source_body is null or pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(source_body, 'UTF8')), 'hex'
      ) <> expected.source_sha256
      or (pg_catalog.length(source_body) -
          pg_catalog.length(pg_catalog.replace(source_body, old_guard, '')))
         <> pg_catalog.length(old_guard) then
      raise exception 'A reviewed routine no-money function has drifted.';
    end if;
    patched_body := pg_catalog.replace(source_body, old_guard, new_guard);
    execute pg_catalog.replace(definition, old_guard, new_guard);
    if (select pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8'))
          from pg_catalog.pg_proc routine where routine.oid = routine_oid)
       <> pg_catalog.sha256(pg_catalog.convert_to(patched_body, 'UTF8')) then
      raise exception 'The routine no-money guard replacement is incomplete.';
    end if;
  end loop;
end;
$allow_only_reviewed_no_money_routines$;

-- Explicitly remove any inherited grant before adding only the external entry
-- points. The three nested issuers and session guard stay owner-only.
do $$
begin
  execute pg_catalog.format(
    'revoke all privileges on database %I from fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime',
    pg_catalog.current_database()
  );
end;
$$;
revoke all privileges on schema app
  from fetanagent_routine_telebirr_no_money,
       fetanagent_routine_telebirr_no_money_runtime;
revoke all privileges on all tables in schema app
  from fetanagent_routine_telebirr_no_money,
       fetanagent_routine_telebirr_no_money_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_routine_telebirr_no_money,
       fetanagent_routine_telebirr_no_money_runtime;
revoke all privileges on all functions in schema app
  from fetanagent_routine_telebirr_no_money,
       fetanagent_routine_telebirr_no_money_runtime;
revoke all privileges on all procedures in schema app
  from fetanagent_routine_telebirr_no_money,
       fetanagent_routine_telebirr_no_money_runtime;

grant usage on schema app to fetanagent_routine_telebirr_no_money;
grant execute on function
  app.load_routine_telebirr_no_money_enrollment(uuid),
  app.issue_routine_telebirr_no_money_poll_assignment(uuid,uuid,text,timestamptz,uuid),
  app.load_routine_telebirr_no_money_observation_material(uuid),
  app.stage_routine_telebirr_no_money_observation_digest(uuid,text,text,text,text)
to fetanagent_routine_telebirr_no_money;

comment on function app.load_routine_telebirr_no_money_enrollment(uuid) is
  'Protected active routine-phone binding read; postgres or the exact provisioned no-money runtime only. No public key, payment claim, or financial action.';
comment on function app.issue_routine_telebirr_no_money_poll_assignment(uuid,uuid,text,timestamptz,uuid) is
  'Protected atomic signed-poll replay claim and encrypted lookup reservation; postgres or the exact provisioned no-money runtime only. No signer key or payment authority.';
comment on function app.load_routine_telebirr_no_money_observation_material(uuid) is
  'Protected same-challenge encrypted observation snapshot; postgres or the exact provisioned no-money runtime only. No source authentication or payment claim.';
comment on function app.stage_routine_telebirr_no_money_observation_digest(uuid,text,text,text,text) is
  'Protected digest-only one-observation review storage; postgres or the exact provisioned no-money runtime only. No amount, wallet, or financial action.';
comment on function app.claim_routine_telebirr_no_money_poll(uuid,uuid,text,timestamptz) is
  'Owner-only nested one-use poll claim; its session guard admits only postgres or the exact provisioned no-money runtime through the guarded outer issuer.';
comment on function app.issue_routine_telebirr_lookup_assignment_material(uuid,uuid,uuid) is
  'Owner-only nested encrypted assignment material; its session guard admits only postgres or the exact provisioned no-money runtime through the guarded outer issuer.';
comment on function app.issue_routine_telebirr_lookup_challenge(uuid,uuid,uuid) is
  'Owner-only nested five-minute challenge issuer; its session guard admits only postgres or the exact provisioned no-money runtime through the guarded outer issuer.';
comment on function app.routine_telebirr_no_money_session_allowed() is
  'Owner-only operation-time guard: postgres maintenance or exact bounded, separately provisioned no-money login. It grants no runtime permission itself.';
comment on role fetanagent_routine_telebirr_no_money is
  'NOLOGIN group for only four private phone rehearsal functions. No table, payment, wallet, or execution privileges.';
comment on role fetanagent_routine_telebirr_no_money_runtime is
  'Unprovisioned NOLOGIN one-connection scaffold for review-only TeleBirr phone lookup. No password, API exposure, or financial authority.';

commit;
