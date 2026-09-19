\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv retry_request_key SOURCE_BINDING_RETRY_REQUEST_KEY
\getenv close_reason_code CLOSE_REASON_CODE

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'retry_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'close_reason_code' in ('completed', 'operator_stop')
  as exact_close_contract
\gset
\if :exact_close_contract
\else
  \warn 'The reviewed source-binding close contract is invalid.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select exists (
  select 1
    from app.private_live_telebirr_source_binding_recovery_retries retry
   where retry.retry_request_key = :'retry_request_key'::uuid
) as retry_exists
\gset recovery_

\if :recovery_retry_exists
  select closed.*
    from app.close_private_live_telebirr_source_binding_recovery(
      :'retry_request_key'::uuid,
      :'close_reason_code'
    ) closed
  \gset close_
\else
  select disabled.verifier_login, disabled.terminated_session_count
    from app.disable_private_trusted_telebirr_verifier_login() disabled
  \gset close_
\endif

\pset format unaligned
\pset tuples_only on
with runtime as materialized (
  select
    (select count(*)::integer from pg_catalog.pg_authid role
      where role.rolname in (
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime'
      ) and (role.rolcanlogin or role.rolpassword is not null)) as verifier_credentials,
    (select count(*)::integer from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_trusted_telebirr_verifier',
        'fetanagent_trusted_telebirr_verifier_runtime'
      )) as verifier_sessions,
    (select count(*)::integer from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
      ) and role.rolcanlogin) as kemer_logins,
    (select count(*)::integer from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
      )) as kemer_sessions
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_source_binding_recovery_close',
  'deploymentTarget', 'production',
  'retryRecorded', :'recovery_retry_exists'::boolean,
  'closeReasonCode', :'close_reason_code',
  'verifierLoginDisabled', runtime.verifier_credentials = 0,
  'trustedVerifierSessions', runtime.verifier_sessions,
  'kemerBetLoginRoles', runtime.kemer_logins,
  'kemerBetSessions', runtime.kemer_sessions,
  'executionEnabled', runtime.kemer_logins <> 0 or runtime.kemer_sessions <> 0
)::text from runtime;

commit;
