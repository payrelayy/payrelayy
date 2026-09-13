-- Supabase grants the project postgres administrator ADMIN-only membership in every role it
-- creates. Vanilla PostgreSQL does not. Normalize that administrative graph so disposable
-- PostgreSQL and managed projects enforce the same exact activation preflight. These grants do
-- not confer inherited privileges or SET ROLE capability and do not change login state.

begin;

do $trusted_telebirr_postgres_role_administration$
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'The trusted TeleBirr role administration migration requires postgres.';
  end if;

  if exists (
    select 1
      from app.private_trusted_telebirr_activation_requests
  ) or not exists (
    select 1
      from app.private_trusted_telebirr_activation_control activation_control
      join app.private_trusted_telebirr_activation_epochs activation_epoch
        on activation_epoch.epoch = activation_control.current_epoch
     where activation_control.control_key = 'trusted_telebirr_financial_authority'
       and activation_control.current_epoch = 0
       and activation_epoch.authority_state = 'disabled'
       and activation_epoch.revoked_at is null
  ) or (
    select pg_catalog.count(*)
      from pg_catalog.pg_authid role
     where role.rolname in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and not role.rolcanlogin
       and role.rolpassword is null
  ) <> 2 then
    raise exception 'Trusted TeleBirr role administration requires the inert epoch-zero boundary.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
       and member_role.rolname = 'postgres'
  ) then
    execute 'grant fetanagent_trusted_telebirr_verifier to postgres '
      || 'with inherit false, set false, admin true';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and member_role.rolname = 'postgres'
  ) then
    execute 'grant fetanagent_trusted_telebirr_verifier_runtime to postgres '
      || 'with inherit false, set false, admin true';
  end if;

  if (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
  ) <> 1
  or not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
       and member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and membership.inherit_option
       and not membership.set_option
       and not membership.admin_option
  )
  or (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
  ) <> 2
  or not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
       and member_role.rolname = 'postgres'
       and not membership.inherit_option
       and not membership.set_option
       and membership.admin_option
  )
  or (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where member_role.rolname = 'fetanagent_trusted_telebirr_verifier'
  ) <> 0
  or (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
  ) <> 1
  or not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and member_role.rolname = 'postgres'
       and not membership.inherit_option
       and not membership.set_option
       and membership.admin_option
  ) then
    raise exception 'The trusted TeleBirr verifier role administration graph is not exact.';
  end if;
end;
$trusted_telebirr_postgres_role_administration$;

commit;
