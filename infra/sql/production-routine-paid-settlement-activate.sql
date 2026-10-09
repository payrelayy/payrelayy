\set ON_ERROR_STOP on

-- Provision only the isolated claim producer's short-lived login. This is
-- permitted solely while every production financial switch remains disabled.
begin;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select current_user = 'postgres' and session_user = 'postgres'
  and exists (
    select 1 from pg_catalog.pg_roles role
    where role.rolname = 'fetanagent_routine_telebirr_paid_settlement_runtime'
      and not role.rolinherit
      and not role.rolsuper and not role.rolcreatedb and not role.rolcreaterole
      and not role.rolreplication and not role.rolbypassrls
      and role.rolconnlimit = 1
  ) as exact_limited_runtime
\gset
\if :exact_limited_runtime
\else
  \warn 'The separate paid settlement runtime is not limited as reviewed.'
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

select count(*) = 2 and pg_catalog.bool_and(
  routine.prosecdef and routine.prokind = 'f'
  and routine.proowner = 'postgres'::pg_catalog.regrole
  and routine.proconfig = array['search_path=pg_catalog']::text[]
  and pg_catalog.strpos(routine.prosrc,
    'not app.routine_telebirr_paid_settlement_session_allowed()') > 0
  and pg_catalog.has_function_privilege(
    'fetanagent_routine_telebirr_paid_settlement', routine.oid, 'EXECUTE'
  )
  and not exists (
    select 1 from pg_catalog.aclexplode(
      coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) privilege
    where privilege.privilege_type = 'EXECUTE'
      and privilege.grantee not in (
        routine.proowner,
        'fetanagent_routine_telebirr_paid_settlement'::pg_catalog.regrole
      )
  )
) as exact_settlement_functions
from pg_catalog.pg_proc routine
where routine.oid in (
  'app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)'::pg_catalog.regprocedure,
  'app.finalize_routine_telebirr_paid_observation(uuid)'::pg_catalog.regprocedure
)
\gset
\if :exact_settlement_functions
\else
  \warn 'The private paid settlement function grants are unavailable.'
  select 1 / 0 as rejected;
\endif

select :'valid_until'::timestamptz > pg_catalog.clock_timestamp() + interval '10 minutes'
  and :'valid_until'::timestamptz <= pg_catalog.clock_timestamp() + interval '30 days'
  as bounded_login_lifetime
\gset
\if :bounded_login_lifetime
\else
  \warn 'The paid settlement login lifetime is not bounded.'
  select 1 / 0 as rejected;
\endif

alter role fetanagent_routine_telebirr_paid_settlement_runtime
  login password :'runtime_password' valid until :'valid_until';

commit;
