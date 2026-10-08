\set ON_ERROR_STOP on

-- A separately scoped login can stage signed receipt observations only while
-- production remains inert. This is not a payment-verification or credit grant.
begin;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select current_user = 'postgres' and session_user = 'postgres'
  and exists (
    select 1 from pg_catalog.pg_roles role
    where role.rolname = 'fetanagent_routine_telebirr_paid_poll_runtime'
      and not role.rolinherit
      and not role.rolsuper and not role.rolcreatedb and not role.rolcreaterole
      and not role.rolreplication and not role.rolbypassrls
      and role.rolconnlimit = 1
  ) as exact_limited_runtime
\gset
\if :exact_limited_runtime
\else
  \warn 'The separate paid observation runtime is not limited as reviewed.'
  select 1 / 0 as rejected;
\endif

select count(*) = 7 as financial_switches_disabled
from app.feature_switches switch
where switch.feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation'
)
  and switch.mode = 'disabled' and switch.settings = '{}'::jsonb
\gset
\if :financial_switches_disabled
\else
  \warn 'The seven financial switches are not all disabled.'
  select 1 / 0 as rejected;
\endif

select count(*) = 4 and pg_catalog.bool_and(
  routine.prosecdef and routine.prokind = 'f'
  and routine.proowner = 'postgres'::pg_catalog.regrole
  and routine.proconfig = array['search_path=pg_catalog']::text[]
  and pg_catalog.has_function_privilege(
    'fetanagent_routine_telebirr_paid_poll', routine.oid, 'EXECUTE'
  )
  and not exists (
    select 1 from pg_catalog.aclexplode(
      coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) privilege
    where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
  )
) as exact_review_functions
from pg_catalog.pg_proc routine
where routine.oid in (
  'app.load_routine_telebirr_paid_poll_enrollment(uuid)'::pg_catalog.regprocedure,
  'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'::pg_catalog.regprocedure,
  'app.load_routine_telebirr_paid_observation_material(uuid)'::pg_catalog.regprocedure,
  'app.stage_routine_telebirr_paid_signed_observation(uuid,text,text,text,text,jsonb)'::pg_catalog.regprocedure
)
\gset
\if :exact_review_functions
\else
  \warn 'The private paid observation function grants are unavailable.'
  select 1 / 0 as rejected;
\endif

select :'valid_until'::timestamptz > pg_catalog.clock_timestamp() + interval '10 minutes'
  and :'valid_until'::timestamptz <= pg_catalog.clock_timestamp() + interval '30 days'
  as bounded_login_lifetime
\gset
\if :bounded_login_lifetime
\else
  \warn 'The paid observation login lifetime is not bounded.'
  select 1 / 0 as rejected;
\endif

alter role fetanagent_routine_telebirr_paid_poll_runtime
  login password :'runtime_password' valid until :'valid_until';

commit;
