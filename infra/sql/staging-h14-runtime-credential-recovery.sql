\set ON_ERROR_STOP on
\getenv beta_runtime_password BETA_ADMISSION_RUNTIME_PASSWORD
\getenv customer_web_runtime_password CUSTOMER_WEB_RUNTIME_PASSWORD
\getenv player_action_runtime_password PLAYER_ACTION_RUNTIME_PASSWORD

begin;

do $fetanagent$
declare
  expected_role text;
begin
  foreach expected_role in array array[
    'fetanagent_beta_admission_runtime',
    'fetanagent_customer_web_runtime',
    'fetanagent_player_actions_runtime'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_roles as role
      where role.rolname = expected_role
        and role.rolinherit = false
        and role.rolsuper = false
        and role.rolcreatedb = false
        and role.rolcreaterole = false
        and role.rolreplication = false
        and role.rolbypassrls = false
        and role.rolconnlimit = case expected_role
          when 'fetanagent_beta_admission_runtime' then 1
          else 2
        end
    ) then
      raise exception 'A dedicated staging runtime role is not in the expected restricted state.';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    where granted_role.rolname = 'fetanagent_beta_admission'
      and member_role.rolname = 'fetanagent_beta_admission_runtime'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) or not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    where granted_role.rolname = 'fetanagent_customer_web'
      and member_role.rolname = 'fetanagent_customer_web_runtime'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) or not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    where granted_role.rolname = 'fetanagent_player_actions'
      and member_role.rolname = 'fetanagent_player_actions_runtime'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) then
    raise exception 'A dedicated staging runtime is missing its exact role membership.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    where (member_role.rolname = 'fetanagent_beta_admission_runtime'
           and granted_role.rolname <> 'fetanagent_beta_admission')
       or (member_role.rolname = 'fetanagent_customer_web_runtime'
           and granted_role.rolname <> 'fetanagent_customer_web')
       or (member_role.rolname = 'fetanagent_player_actions_runtime'
           and granted_role.rolname <> 'fetanagent_player_actions')
  ) then
    raise exception 'A dedicated staging runtime has an unexpected role membership.';
  end if;
end
$fetanagent$;

set local password_encryption = 'scram-sha-256';

alter role fetanagent_beta_admission_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'beta_runtime_password';

alter role fetanagent_customer_web_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password :'customer_web_runtime_password';

alter role fetanagent_player_actions_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password :'player_action_runtime_password';

do $fetanagent$
declare
  valid_until timestamptz := pg_catalog.clock_timestamp() + interval '24 hours';
begin
  execute pg_catalog.format(
    'alter role fetanagent_beta_admission_runtime valid until %L',
    valid_until
  );
  execute pg_catalog.format(
    'alter role fetanagent_customer_web_runtime valid until %L',
    valid_until
  );
  execute pg_catalog.format(
    'alter role fetanagent_player_actions_runtime valid until %L',
    valid_until
  );
end
$fetanagent$;

commit;

do $fetanagent$
declare
  observed pg_catalog.pg_authid%rowtype;
  expected_role text;
begin
  foreach expected_role in array array[
    'fetanagent_beta_admission_runtime',
    'fetanagent_customer_web_runtime',
    'fetanagent_player_actions_runtime'
  ]
  loop
    select * into strict observed
    from pg_catalog.pg_authid
    where rolname = expected_role;

    if not observed.rolcanlogin
       or observed.rolinherit
       or observed.rolsuper
       or observed.rolcreatedb
       or observed.rolcreaterole
       or observed.rolreplication
       or observed.rolbypassrls
       or observed.rolconnlimit <> case expected_role
         when 'fetanagent_beta_admission_runtime' then 1
         else 2
       end
       or observed.rolpassword not like 'SCRAM-SHA-256$%'
       or observed.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '23 hours 30 minutes'
       or observed.rolvaliduntil > pg_catalog.clock_timestamp() + interval '24 hours 5 minutes' then
      raise exception 'A dedicated staging runtime credential recovery did not satisfy its exact contract.';
    end if;
  end loop;
end
$fetanagent$;
