-- The compatible Player-action release must be healthy before this exact no-money grant.
-- This does not expose the private table, enable the Telegram route, or arm a money switch.

begin;

do $$
declare
  v_function pg_catalog.regprocedure := pg_catalog.to_regprocedure(
    'app.capture_telegram_routine_telebirr_untrusted_proof(uuid,text,text,text,text,text,smallint,smallint,text)'
  );
begin
  if v_function is null or not exists (
    select 1
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_roles owner on owner.oid = routine.proowner
     where routine.oid = v_function
       and owner.rolname = 'postgres'
       and routine.prosecdef
       and routine.prokind = 'f'
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The private routine candidate function is not the reviewed function.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'fetanagent_player_actions' and not rolcanlogin
  ) or not pg_catalog.pg_has_role(
    'fetanagent_player_actions_runtime', 'fetanagent_player_actions', 'USAGE'
  ) then
    raise exception 'The reviewed Player-action role inheritance is unavailable.';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('fetanagent_api_runtime', v_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('fetanagent_customer_web_runtime', v_function, 'EXECUTE')
  then
    raise exception 'The routine candidate function has an unexpected application grant.';
  end if;
end;
$$;

grant execute on function app.capture_telegram_routine_telebirr_untrusted_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) to fetanagent_player_actions;

do $$
declare
  v_function pg_catalog.regprocedure :=
    'app.capture_telegram_routine_telebirr_untrusted_proof(uuid,text,text,text,text,text,smallint,smallint,text)'::pg_catalog.regprocedure;
begin
  if not pg_catalog.has_function_privilege(
    'fetanagent_player_actions_runtime', v_function, 'EXECUTE'
  ) or exists (
    select 1
      from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(
        coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) privilege
     where routine.oid = v_function
       and privilege.privilege_type = 'EXECUTE'
       and privilege.grantee not in (
         routine.proowner,
         (select oid from pg_catalog.pg_roles where rolname = 'fetanagent_player_actions')
       )
  ) then
    raise exception 'The routine candidate EXECUTE surface is not exact.';
  end if;
end;
$$;

commit;
