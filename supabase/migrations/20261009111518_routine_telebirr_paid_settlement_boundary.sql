-- An isolated, unprovisioned settlement capability for a staged, signed V2
-- official-origin observation. This migration does not provision a password,
-- permit login, change a financial switch, or run the claim producer.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create role fetanagent_routine_telebirr_paid_settlement
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2;
create role fetanagent_routine_telebirr_paid_settlement_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
grant fetanagent_routine_telebirr_paid_settlement
  to fetanagent_routine_telebirr_paid_settlement_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $$
begin
  execute pg_catalog.format(
    'revoke all privileges on database %I from fetanagent_routine_telebirr_paid_settlement, fetanagent_routine_telebirr_paid_settlement_runtime',
    pg_catalog.current_database());
end;
$$;
revoke all privileges on schema app
  from fetanagent_routine_telebirr_paid_settlement,
       fetanagent_routine_telebirr_paid_settlement_runtime;
revoke all privileges on all tables in schema app
  from fetanagent_routine_telebirr_paid_settlement,
       fetanagent_routine_telebirr_paid_settlement_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_routine_telebirr_paid_settlement,
       fetanagent_routine_telebirr_paid_settlement_runtime;
revoke all privileges on all functions in schema app
  from fetanagent_routine_telebirr_paid_settlement,
       fetanagent_routine_telebirr_paid_settlement_runtime;
revoke all privileges on all procedures in schema app
  from fetanagent_routine_telebirr_paid_settlement,
       fetanagent_routine_telebirr_paid_settlement_runtime;

create function app.routine_telebirr_paid_settlement_session_allowed()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_allowed boolean;
begin
  if session_user = 'postgres' then return true; end if;
  if session_user <> 'fetanagent_routine_telebirr_paid_settlement_runtime' then
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
               'fetanagent_routine_telebirr_paid_settlement', 'USAGE')
         and not pg_catalog.pg_has_role(session_user,
               'fetanagent_routine_telebirr_paid_settlement', 'SET')
         and exists (
           select 1 from pg_catalog.pg_roles group_role
            where group_role.rolname = 'fetanagent_routine_telebirr_paid_settlement'
              and not group_role.rolcanlogin and not group_role.rolinherit
              and not group_role.rolsuper and not group_role.rolcreatedb
              and not group_role.rolcreaterole and not group_role.rolreplication
              and not group_role.rolbypassrls and group_role.rolconnlimit = 2
              and not exists (
                select 1 from pg_catalog.pg_auth_members upstream
                 where upstream.member = group_role.oid))
         and (
           select pg_catalog.count(*) = 1
                  and pg_catalog.bool_and(
                    granted.rolname = 'fetanagent_routine_telebirr_paid_settlement'
                    and membership.inherit_option
                    and not membership.set_option
                    and not membership.admin_option)
             from pg_catalog.pg_auth_members membership
             join pg_catalog.pg_roles granted on granted.oid = membership.roleid
            where membership.member = runtime.oid)
    into v_allowed
    from pg_catalog.pg_roles runtime
   where runtime.rolname = 'fetanagent_routine_telebirr_paid_settlement_runtime';
  return coalesce(v_allowed, false);
end;
$$;
alter function app.routine_telebirr_paid_settlement_session_allowed()
  owner to postgres;
revoke all on function app.routine_telebirr_paid_settlement_session_allowed()
  from public, anon, authenticated, service_role;

-- Pin the entire reviewed claim producer before elevating it. Its validation,
-- locks, one-use claim, admission, and signed-origin checks remain unchanged.
do $settlement_boundary$
declare
  routine_oid oid :=
    'app.finalize_routine_telebirr_paid_observation(uuid)'::pg_catalog.regprocedure;
  source_body text;
  definition text;
  old_guard constant text := 'session_user <> ''postgres''';
  new_guard constant text :=
    'not app.routine_telebirr_paid_settlement_session_allowed()';
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into source_body, definition
    from pg_catalog.pg_proc routine
   where routine.oid = routine_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and not routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
      '04459e0407a856361fab0b42fcca3dab7d10c0c45376fdb1d3dee0805d862ced'
    or (pg_catalog.length(source_body) -
        pg_catalog.length(pg_catalog.replace(source_body, old_guard, '')))
       <> pg_catalog.length(old_guard)
    or exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
      where routine.oid = routine_oid
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee <> routine.proowner) then
    raise exception 'The paid claim producer is not the reviewed private definition.';
  end if;
  execute pg_catalog.replace(definition, old_guard, new_guard);
  execute 'alter function app.finalize_routine_telebirr_paid_observation(uuid) security definer';
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.prosecdef
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and routine.prosrc = pg_catalog.replace(source_body, old_guard, new_guard)) then
    raise exception 'The paid claim producer guard replacement is incomplete.';
  end if;
end;
$settlement_boundary$;

revoke all on function app.finalize_routine_telebirr_paid_observation(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_paid_poll,
    fetanagent_routine_telebirr_paid_poll_runtime;
grant usage on schema app to fetanagent_routine_telebirr_paid_settlement;
grant execute on function app.finalize_routine_telebirr_paid_observation(uuid)
  to fetanagent_routine_telebirr_paid_settlement;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(coalesce(
      routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
    where routine.oid =
      'app.finalize_routine_telebirr_paid_observation(uuid)'::pg_catalog.regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee not in (
        routine.proowner,
        'fetanagent_routine_telebirr_paid_settlement'::pg_catalog.regrole)) then
    raise exception 'The paid claim producer has an unexpected execute grant.';
  end if;
end;
$$;

comment on function app.routine_telebirr_paid_settlement_session_allowed() is
  'Private exact-login guard for the isolated paid settlement producer. No app runtime can call this helper.';
comment on function app.finalize_routine_telebirr_paid_observation(uuid) is
  'Guarded atomic signed-origin claim and one-shot job producer. Its only runtime identity is presently NOLOGIN and unprovisioned.';
comment on role fetanagent_routine_telebirr_paid_settlement is
  'NOLOGIN group with only the guarded atomic paid-phone claim capability.';
comment on role fetanagent_routine_telebirr_paid_settlement_runtime is
  'Unprovisioned NOLOGIN one-connection paid settlement scaffold; no credential or live switch.';
commit;
