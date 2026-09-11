\set ON_ERROR_STOP on
begin transaction read only;
set local statement_timeout = '10s';
set local search_path = pg_catalog;

select rolname, rolcanlogin, rolvaliduntil::text,
       rolvaliduntil = 'infinity'::timestamptz as continuous_lifetime,
       not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
         as non_administrative
from pg_catalog.pg_roles
where rolname in ('fetanagent_beta_admission_runtime', 'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime', 'fetanagent_player_actions_runtime',
  'fetanagent_deposit_executor_runtime', 'fetanagent_trusted_telebirr_verifier_runtime')
order by rolname;

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
       (select count(*) from armed_pilot) = 1
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
   ) as no_money_feature_boundary_safe,
  (select count(*)
     from feature_boundary
    where feature_key <> 'private_live_deposit_pilot'
      and mode <> 'disabled') as non_disabled_real_money_switches,
  (select count(*)
     from feature_boundary
    where feature_key = 'private_live_deposit_pilot'
      and mode = 'dry_run') as dry_run_pilot_switches
\gset
\if :no_money_feature_boundary_safe
\else
  \warn 'The six real-money switches and the exact disabled or armed dry-run pilot boundary are unsafe.'
  select 1 / 0 as rejected;
\endif

select :'no_money_feature_boundary_safe'::boolean as no_money_feature_boundary_safe,
       :'non_disabled_real_money_switches'::integer as non_disabled_real_money_switches,
       :'dry_run_pilot_switches'::integer as dry_run_pilot_switches;
rollback;
