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

select count(*) as enabled_financial_switches
from app.feature_switches where mode <> 'disabled';
rollback;
