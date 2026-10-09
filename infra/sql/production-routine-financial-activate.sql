\set ON_ERROR_STOP on

-- Money-capable operator action. Never invoked by schema migration or deploy.
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv owner_auth_user_id FETANAGENT_ROUTINE_OWNER_AUTH_USER_ID
\getenv activation_request_key FETANAGENT_ROUTINE_FINANCIAL_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'owner_auth_user_id' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'activation_request_key' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_input
\gset
\if :exact_input
\else
  \warn 'The exact routine financial activation inputs are required.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '25s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '25s';

select app.activate_routine_telebirr_financial_gates(
  :'owner_auth_user_id'::uuid, :'activation_request_key'::uuid
) as activated
\gset
\if :activated
\else
  \warn 'The routine financial gates did not activate.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.count(*) = 7
  and pg_catalog.count(*) filter (where switch.feature_key in
    ('payment_verification', 'deposit_execution')
    and switch.mode = 'live' and switch.settings = '{}'::jsonb) = 2
  and pg_catalog.count(*) filter (where switch.feature_key not in
    ('payment_verification', 'deposit_execution')
    and switch.mode = 'disabled' and switch.settings = '{}'::jsonb) = 5
  as exact_switch_set
from app.feature_switches switch
where switch.feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation')
\gset
\if :exact_switch_set
\else
  \warn 'The routine financial switch set is not exact.'
  select 1 / 0 as rejected;
\endif
commit;

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1, 'operation', 'routine_telebirr_financial_activate',
  'deploymentTarget', 'production', 'moneyCapable', true,
  'livePaymentPerformed', false, 'legacyPilotEnabled', false,
  'cbeEnabled', false)::text;
