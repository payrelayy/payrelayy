\set ON_ERROR_STOP on

-- Operational policy change, not a schema migration. Passwords, memberships,
-- permissions, connection limits, and financial authority are not changed.
begin transaction isolation level read committed;
set local statement_timeout = '15s';
set local lock_timeout = '5s';
set local search_path = pg_catalog;

do $fetanagent$
declare
  expected record;
  locked_feature_switch_count integer;
  pilot_mode app.feature_mode;
  armed_pilot_count integer := 0;
  no_money_feature_boundary_safe boolean;
begin
  perform feature_switch.feature_key
    from app.feature_switches as feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection',
     'cbe_birr_authoritative_verification',
     'telebirr_authoritative_verification',
     'private_live_deposit_pilot'
   )
   order by feature_switch.feature_key
   for share;
  get diagnostics locked_feature_switch_count = row_count;
  if locked_feature_switch_count <> 7 then
    raise exception 'The exact seven-row no-money feature boundary is absent.';
  end if;

  select feature_switch.mode
    into pilot_mode
    from app.feature_switches as feature_switch
   where feature_switch.feature_key = 'private_live_deposit_pilot';

  if pilot_mode = 'dry_run' then
    perform pilot.id
      from app.private_live_deposit_pilot_revisions as pilot
     where pilot.status = 'armed'
       and pilot.configuration_digest is not null
     order by pilot.id
     for share;
    get diagnostics armed_pilot_count = row_count;
  end if;

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

  with feature_boundary as materialized (
    select feature_switch.feature_key,
           feature_switch.mode,
           feature_switch.settings
      from app.feature_switches as feature_switch
     where feature_switch.feature_key in (
       'payment_verification',
       'deposit_execution',
       'withdrawal_validation',
       'withdrawal_collection',
       'cbe_birr_authoritative_verification',
       'telebirr_authoritative_verification',
       'private_live_deposit_pilot'
     )
  ), armed_pilot as materialized (
    select pilot.id,
           pilot.configuration_digest
      from app.private_live_deposit_pilot_revisions as pilot
     where pilot.status = 'armed'
       and pilot.configuration_digest is not null
  )
  select (select count(*) from feature_boundary) = 7
     and (select count(*)
            from feature_boundary
           where feature_key <> 'private_live_deposit_pilot'
             and mode = 'disabled'
             and settings = '{}'::jsonb) = 6
     and (
       exists (
         select 1
           from feature_boundary
          where feature_key = 'private_live_deposit_pilot'
            and mode = 'disabled'
            and settings = '{}'::jsonb
       )
       or (
         armed_pilot_count = 1
         and (select count(*) from armed_pilot) = 1
         and (select count(*)
                from feature_boundary as switch_state
                join armed_pilot as pilot
                  on switch_state.feature_key = 'private_live_deposit_pilot'
               where switch_state.mode = 'dry_run'
                 and switch_state.settings = pg_catalog.jsonb_build_object(
                   'contract_version', 1,
                   'pilot_revision_id', pilot.id,
                   'configuration_digest', pilot.configuration_digest
                 )) = 1
       )
     )
    into no_money_feature_boundary_safe;

  if no_money_feature_boundary_safe is not true then
    raise exception 'Continuous availability requires six disabled real-money switches and only an exact disabled or armed dry-run pilot.';
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
