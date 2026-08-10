\set ON_ERROR_STOP on
\getenv runtime_password BETA_ADMISSION_RUNTIME_PASSWORD

begin;

do $payreplayy$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'payreplayy_beta_admission_runtime'
      and not role.rolcanlogin
      and not role.rolinherit
      and not role.rolsuper
      and not role.rolcreatedb
      and not role.rolcreaterole
      and not role.rolreplication
      and not role.rolbypassrls
      and role.rolconnlimit = 1
  ) then
    raise exception 'The disabled staging beta-admission runtime scaffold is not in the expected state.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    where granted_role.rolname = 'payreplayy_beta_admission'
      and member_role.rolname = 'payreplayy_beta_admission_runtime'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) or exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    where member_role.rolname = 'payreplayy_beta_admission_runtime'
      and granted_role.rolname <> 'payreplayy_beta_admission'
  ) then
    raise exception 'The staging beta-admission runtime membership is not in the expected state.';
  end if;
end
$payreplayy$;

alter role payreplayy_beta_admission_runtime with
  login
  noinherit
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  password :'runtime_password';

do $payreplayy$
begin
  execute pg_catalog.format(
    'alter role payreplayy_beta_admission_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '1 hour'
  );
end
$payreplayy$;

commit;
