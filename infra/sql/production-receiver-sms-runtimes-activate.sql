\set ON_ERROR_STOP on

-- Called only by the guarded inert production deployment. This grants the
-- reviewed SMS functions and short-lived dedicated logins; it does not turn
-- on the SMS route or any financial switch.
begin;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select current_user = 'postgres' and session_user = 'postgres'
  and (select count(*) = 7 from app.feature_switches switch
    where switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution',
      'payment_verification', 'private_live_deposit_pilot',
      'telebirr_authoritative_verification', 'withdrawal_collection',
      'withdrawal_validation'
    ) and switch.mode = 'disabled' and switch.settings = '{}'::jsonb)
  and (select count(*) = 1 from app.receiver_sms_route_control control
    where control.singleton and not control.enabled)
  as stopped_boundary
\gset
\if :stopped_boundary
\else
  \warn 'The SMS route and financial switches are not exactly stopped.'
  select 1 / 0 as rejected;
\endif

select count(*) = 2 and pg_catalog.bool_and(
    not role.rolinherit and not role.rolsuper and not role.rolcreatedb
    and not role.rolcreaterole and not role.rolreplication
    and not role.rolbypassrls and role.rolconnlimit = 1
  ) as dedicated_roles_safe
from pg_catalog.pg_roles role
where role.rolname in (
  'fetanagent_receiver_sms_ingest_runtime',
  'fetanagent_receiver_sms_settlement_runtime'
)
\gset
\if :dedicated_roles_safe
\else
  \warn 'The SMS runtime roles are not exact.'
  select 1 / 0 as rejected;
\endif

select count(*) = 3 and pg_catalog.bool_and(
    routine.prosecdef and routine.prokind = 'f'
    and routine.proowner = 'postgres'::pg_catalog.regrole
    and routine.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
  ) as sms_functions_hardened
from pg_catalog.pg_proc routine
where routine.oid in (
  'app.load_receiver_sms_device_enrollment(text)'::pg_catalog.regprocedure,
  'app.record_receiver_sms_payment_event(text,text,text,bigint,timestamptz,timestamptz,timestamptz,text,text,text,text,text,integer)'::pg_catalog.regprocedure,
  'app.settle_next_receiver_sms_match()'::pg_catalog.regprocedure
)
\gset
\if :sms_functions_hardened
\else
  \warn 'The private SMS functions are not exact.'
  select 1 / 0 as rejected;
\endif

select :'valid_until'::timestamptz > pg_catalog.clock_timestamp() + interval '1 day'
  and :'valid_until'::timestamptz <= pg_catalog.clock_timestamp() + interval '30 days'
  and :'ingest_password' ~ '^[0-9a-f]{64}$'
  and :'settlement_password' ~ '^[0-9a-f]{64}$'
  and :'ingest_password' <> :'settlement_password'
  as bounded_distinct_credentials
\gset
\if :bounded_distinct_credentials
\else
  \warn 'The SMS runtime credentials are unavailable.'
  select 1 / 0 as rejected;
\endif

grant execute on function app.capture_telegram_receiver_sms_candidate(
  uuid,text,text,text,text,text,smallint,smallint,text
) to fetanagent_player_actions;
grant execute on function app.list_owner_receiver_sms_old_payments(uuid,integer)
  to fetanagent_owner_control;
grant execute on function app.decide_owner_receiver_sms_old_payment(uuid,uuid,text)
  to fetanagent_owner_control;

alter role fetanagent_receiver_sms_ingest_runtime
  login password :'ingest_password' valid until :'valid_until';
alter role fetanagent_receiver_sms_settlement_runtime
  login password :'settlement_password' valid until :'valid_until';

commit;
