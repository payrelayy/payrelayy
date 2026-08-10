\set ON_ERROR_STOP on

do $payreplayy$
declare
  runtime_role pg_catalog.pg_roles%rowtype;
begin
  select role.*
  into strict runtime_role
  from pg_catalog.pg_roles as role
  where role.rolname = 'payreplayy_beta_admission_runtime';

  if runtime_role.rolsuper
    or runtime_role.rolcreatedb
    or runtime_role.rolcreaterole
    or runtime_role.rolreplication
    or runtime_role.rolbypassrls
    or runtime_role.rolinherit
    or runtime_role.rolconnlimit <> 1
  then
    raise exception 'The staging beta-admission runtime role attributes are unsafe.';
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
  ) then
    raise exception 'The staging beta-admission runtime membership is unsafe.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    where member_role.rolname = 'payreplayy_beta_admission_runtime'
      and granted_role.rolname <> 'payreplayy_beta_admission'
  ) then
    raise exception 'The staging beta-admission runtime has an unexpected membership.';
  end if;
end
$payreplayy$;

select
  role.rolcanlogin as runtime_login_enabled,
  role.rolconnlimit = 1 as connection_limit_is_safe,
  not role.rolsuper
    and not role.rolcreatedb
    and not role.rolcreaterole
    and not role.rolreplication
    and not role.rolbypassrls
    and not role.rolinherit as runtime_role_is_non_admin
from pg_catalog.pg_roles as role
where role.rolname = 'payreplayy_beta_admission_runtime';
