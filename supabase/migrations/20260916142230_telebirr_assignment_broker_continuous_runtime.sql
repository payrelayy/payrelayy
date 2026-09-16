begin;

create or replace function app.require_telebirr_assignment_broker_session()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  runtime_is_currently_authorized boolean;
begin
  -- The migration owner is the explicit disposable-test/maintenance bypass. SET ROLE to the group
  -- is insufficient: every operational call must originate from the exact runtime login.
  if session_user = 'postgres' then
    return;
  end if;

  select exists (
    select 1
      from pg_catalog.pg_roles role
     where role.rolname = session_user
       and role.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
       and role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not null
       and (
         role.rolvaliduntil = 'infinity'::timestamptz
         or (
           role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
           and role.rolvaliduntil
               <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
         )
       )
  ) into runtime_is_currently_authorized;

  if runtime_is_currently_authorized is not true then
    raise exception 'The TeleBirr assignment broker session is not currently authorized.';
  end if;
end;
$$;

alter function app.require_telebirr_assignment_broker_session() owner to postgres;

comment on function app.require_telebirr_assignment_broker_session() is
  'Owner-only server-time guard requiring the exact assignment-broker runtime login with either the bounded staging lifetime or the continuous production lifetime; postgres is the explicit migration-owner maintenance bypass.';

commit;
