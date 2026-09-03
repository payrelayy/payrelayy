\set ON_ERROR_STOP on

-- Operational policy change, not a schema migration. Passwords, memberships,
-- permissions, connection limits, and financial authority are not changed.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '5s';
set local search_path = pg_catalog;

lock table app.feature_switches in share mode;

do $fetanagent$
declare
  expected record;
begin
  for expected in
    select * from (values
      ('fetanagent_beta_admission_runtime', 'fetanagent_beta_admission', 1),
      ('fetanagent_customer_web_runtime', 'fetanagent_customer_web', 2),
      ('fetanagent_owner_control_runtime', 'fetanagent_owner_control', 1),
      ('fetanagent_player_actions_runtime', 'fetanagent_player_actions', 2)
    ) as roles(runtime_name, group_name, connection_limit)
  loop
    if not exists (
      select 1 from pg_catalog.pg_roles role
      where role.rolname = expected.runtime_name
        and role.rolcanlogin
        and not role.rolinherit
        and not role.rolsuper
        and not role.rolcreatedb
        and not role.rolcreaterole
        and not role.rolreplication
        and not role.rolbypassrls
        and role.rolconnlimit = expected.connection_limit
        and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
    ) then
      raise exception 'A continuous-availability runtime is absent, expired, disabled, or unsafe.';
    end if;

    if (select count(*) from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
        where member_role.rolname = expected.runtime_name) <> 1
      or not exists (
        select 1 from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
        join pg_catalog.pg_roles group_role on group_role.oid = membership.roleid
        where member_role.rolname = expected.runtime_name
          and group_role.rolname = expected.group_name
          and not group_role.rolcanlogin
          and not group_role.rolsuper
          and not group_role.rolcreatedb
          and not group_role.rolcreaterole
          and not group_role.rolreplication
          and not group_role.rolbypassrls
          and membership.inherit_option
          and not membership.set_option
          and not membership.admin_option
      ) then
      raise exception 'A continuous-availability runtime membership is unsafe.';
    end if;
  end loop;

  if (select count(*) from pg_catalog.pg_roles
      where rolname in ('fetanagent_deposit_executor_runtime',
        'fetanagent_trusted_telebirr_verifier_runtime') and not rolcanlogin) <> 2 then
    raise exception 'Continuous availability cannot activate or extend financial runtimes.';
  end if;

  if (select count(*) from app.feature_switches
      where feature_key in ('payment_verification', 'deposit_execution',
        'withdrawal_validation', 'withdrawal_collection', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'cbe_birr_authoritative_verification')
        and mode = 'disabled') <> 7
    or exists (select 1 from app.feature_switches where mode <> 'disabled') then
    raise exception 'Continuous availability requires every financial switch to remain disabled.';
  end if;
end
$fetanagent$;

alter role fetanagent_beta_admission_runtime valid until 'infinity';
alter role fetanagent_customer_web_runtime valid until 'infinity';
alter role fetanagent_owner_control_runtime valid until 'infinity';
alter role fetanagent_player_actions_runtime valid until 'infinity';

do $fetanagent$
begin
  if (select count(*) from pg_catalog.pg_roles
      where rolname in ('fetanagent_beta_admission_runtime',
        'fetanagent_customer_web_runtime', 'fetanagent_owner_control_runtime',
        'fetanagent_player_actions_runtime')
        and rolcanlogin and rolvaliduntil = 'infinity'::timestamptz) <> 4 then
    raise exception 'The four continuous-availability lifetimes were not installed.';
  end if;
end
$fetanagent$;
commit;

\echo 'Four non-financial application logins now have no scheduled expiry; credentials and privileges are unchanged.'
