\set ON_ERROR_STOP on
\getenv beta_runtime_password BETA_ADMISSION_RUNTIME_PASSWORD
\getenv owner_runtime_password OWNER_CONTROL_RUNTIME_PASSWORD
\getenv player_action_runtime_password PLAYER_ACTION_RUNTIME_PASSWORD

begin;

do $payreplayy$
declare
  expected_role text;
begin
  foreach expected_role in array array[
    'payreplayy_beta_admission_runtime',
    'payreplayy_owner_control_runtime',
    'payreplayy_player_actions_runtime'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_roles as role
      where role.rolname = expected_role
        and not role.rolcanlogin
        and not role.rolinherit
        and not role.rolsuper
        and not role.rolcreatedb
        and not role.rolcreaterole
        and not role.rolreplication
        and not role.rolbypassrls
        and role.rolconnlimit = case expected_role
          when 'payreplayy_player_actions_runtime' then 2
          else 1
        end
    ) then
      raise exception 'A disabled staging runtime scaffold is not in the expected state.';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where granted_role.rolname = 'payreplayy_beta_admission'
      and member_role.rolname = 'payreplayy_beta_admission_runtime'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) or not exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where granted_role.rolname = 'payreplayy_owner_control'
      and member_role.rolname = 'payreplayy_owner_control_runtime'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) or not exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where granted_role.rolname = 'payreplayy_player_actions'
      and member_role.rolname = 'payreplayy_player_actions_runtime'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) then
    raise exception 'A staging runtime membership is not in the expected state.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where (member_role.rolname = 'payreplayy_beta_admission_runtime'
           and granted_role.rolname <> 'payreplayy_beta_admission')
       or (member_role.rolname = 'payreplayy_owner_control_runtime'
           and granted_role.rolname <> 'payreplayy_owner_control')
       or (member_role.rolname = 'payreplayy_player_actions_runtime'
           and granted_role.rolname <> 'payreplayy_player_actions')
  ) then
    raise exception 'A staging runtime has an unexpected role membership.';
  end if;
end
$payreplayy$;

alter role payreplayy_beta_admission_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'beta_runtime_password';

alter role payreplayy_owner_control_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'owner_runtime_password';

alter role payreplayy_player_actions_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2 password :'player_action_runtime_password';

do $payreplayy$
begin
  execute pg_catalog.format(
    'alter role payreplayy_beta_admission_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '24 hours'
  );
  execute pg_catalog.format(
    'alter role payreplayy_owner_control_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '24 hours'
  );
  execute pg_catalog.format(
    'alter role payreplayy_player_actions_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '24 hours'
  );
end
$payreplayy$;

commit;
