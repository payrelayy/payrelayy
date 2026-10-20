\set ON_ERROR_STOP on

begin read only;

do $fetanagent$
begin
  if (
    select count(*)
    from app.feature_switches
    where feature_key in (
      'cbe_birr_authoritative_verification',
      'deposit_execution',
      'payment_verification',
      'private_live_deposit_pilot',
      'telebirr_authoritative_verification',
      'withdrawal_collection',
      'withdrawal_validation'
    )
      and mode = 'disabled'
      and settings = '{}'::jsonb
  ) <> 7 then
    raise exception 'The staging financial switches are not all disabled.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'fetanagent_owner_control_runtime'
      and not rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
      and rolconnlimit = 1
  ) then
    raise exception 'The staging Owner runtime role is not disabled.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_stat_activity
    where usename = 'fetanagent_owner_control_runtime'
  ) then
    raise exception 'A staging Owner runtime session is still active.';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where member_role.rolname = 'fetanagent_owner_control_runtime'
      and granted_role.rolname = 'fetanagent_owner_control'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) <> 1 or (
    select count(*)
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where member_role.rolname = 'fetanagent_owner_control_runtime'
  ) <> 1 then
    raise exception 'The staging Owner runtime membership is not exact.';
  end if;

  if pg_catalog.to_regprocedure(
    'app.list_owner_routine_telebirr_transactions(uuid,text,date,date,text,integer,integer)'
  ) is null then
    raise exception 'The Owner Transactions query is not installed on staging.';
  end if;
end
$fetanagent$;

commit;

select 'STAGING_OWNER_PREVIEW_PLAN_READY' as result;
