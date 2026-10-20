\set ON_ERROR_STOP on
\getenv owner_runtime_password OWNER_CONTROL_RUNTIME_PASSWORD

begin;
set transaction isolation level serializable;

do $fetanagent$
declare
  membership_count integer;
  disabled_switch_count integer;
begin
  perform 1
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
  for update;

  select count(*) into disabled_switch_count
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
    and settings = '{}'::jsonb;
  if disabled_switch_count <> 7 then
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
    raise exception 'The staging Owner runtime role is not in its disabled scaffold state.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_stat_activity
    where usename = 'fetanagent_owner_control_runtime'
  ) then
    raise exception 'A staging Owner runtime session is still active.';
  end if;

  select count(*) into membership_count
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
  join pg_catalog.pg_roles member_role on member_role.oid = membership.member
  where member_role.rolname = 'fetanagent_owner_control_runtime'
    and granted_role.rolname = 'fetanagent_owner_control'
    and membership.inherit_option
    and not membership.set_option
    and not membership.admin_option;
  if membership_count <> 1 or (
    select count(*)
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where member_role.rolname = 'fetanagent_owner_control_runtime'
  ) <> 1 then
    raise exception 'The staging Owner runtime membership is not exact.';
  end if;
end
$fetanagent$;

alter role fetanagent_owner_control_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'owner_runtime_password';

do $fetanagent$
begin
  execute pg_catalog.format(
    'alter role fetanagent_owner_control_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '2 hours'
  );
end
$fetanagent$;

commit;
