-- Run only against the exact reviewed production project.
-- Allow a replacement Owner session while Supavisor releases the previous one.
-- The application pool remains limited to one active database client.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $owner_connection_handoff$
declare
  v_role pg_catalog.pg_roles%rowtype;
begin
  select * into v_role from pg_catalog.pg_roles
  where rolname = 'fetanagent_owner_control_runtime';

  if not found or not v_role.rolcanlogin or v_role.rolinherit
     or v_role.rolsuper or v_role.rolcreatedb or v_role.rolcreaterole
     or v_role.rolreplication or v_role.rolbypassrls
     or v_role.rolvaliduntil is distinct from 'infinity'::timestamptz
     or v_role.rolconnlimit not in (1, 2) then
    raise exception 'Owner runtime role is outside its reviewed connection shape.';
  end if;
end
$owner_connection_handoff$;

alter role fetanagent_owner_control_runtime connection limit 2;

do $owner_connection_handoff$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'fetanagent_owner_control_runtime'
      and rolconnlimit = 2
  ) then
    raise exception 'Owner runtime replacement slot was not established.';
  end if;
end
$owner_connection_handoff$;
commit;
