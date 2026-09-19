\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_verification_job_id TARGET_VERIFICATION_JOB_ID
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_activation_epoch TARGET_ACTIVATION_EPOCH
\getenv retry_request_key SOURCE_BINDING_RETRY_REQUEST_KEY
\getenv trusted_telebirr_scram_verifier TRUSTED_TELEBIRR_SCRAM_VERIFIER

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'target_verification_job_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
   and :'retry_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'trusted_telebirr_scram_verifier'
         ~ '^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$'
  as exact_arm_contract
\gset
\if :exact_arm_contract
\else
  \warn 'The reviewed source-binding arm contract is invalid.'
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

select armed.authorized_at,
       armed.expires_at,
       armed.already_armed
  from app.arm_private_live_telebirr_source_binding_recovery(
    :'target_verification_job_id'::uuid,
    :'target_pilot_revision_id'::uuid,
    :'target_activation_epoch'::bigint,
    :'retry_request_key'::uuid,
    :'trusted_telebirr_scram_verifier',
    'source_binding_supersession_after_nonfinancial_review'
  ) armed
\gset armed_

\pset format unaligned
\pset tuples_only on
with runtime as materialized (
  select
    (select count(*)::integer
       from app.private_live_telebirr_source_binding_recovery_retries retry
      where retry.retry_request_key = :'retry_request_key'::uuid
        and retry.current_verification_job_id =
            :'target_verification_job_id'::uuid) as retries,
    (select count(*)::integer
       from app.private_live_telebirr_source_binding_recovery_closures closure
      where closure.retry_request_key = :'retry_request_key'::uuid) as retry_closures,
    (select count(*)::integer
       from app.private_live_telebirr_source_binding_recovery_retries retry
      where retry.retry_request_key = :'retry_request_key'::uuid
        and app.is_private_live_telebirr_source_binding_post_emergency_ready(
          retry.original_authority_request_key
        )) as post_emergency_boundaries,
    (select count(*)::integer from pg_catalog.pg_authid role
      where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
        and role.rolcanlogin
        and role.rolvaliduntil is not distinct from :'armed_expires_at'::timestamptz
        and role.rolpassword = :'trusted_telebirr_scram_verifier') as bounded_logins,
    (select count(*)::integer from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
      ) and role.rolcanlogin) as kemer_logins,
    (select count(*)::integer from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
      )) as kemer_sessions,
    (select count(*)::integer from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation'
      ) and feature_switch.mode = 'live') as live_financial_switches,
    (select count(*)::integer from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation'
      ) and feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb) as disabled_financial_switches,
    (select count(*)::integer
       from app.private_live_telebirr_verification_outcomes outcome
      where outcome.verification_job_id = :'target_verification_job_id'::uuid)
      as outcomes,
    (select count(*)::integer
       from app.private_live_deposit_pilot_reservations reservation
       join app.private_live_telebirr_verification_jobs job
         on job.private_live_deposit_pilot_proof_id =
            reservation.private_live_deposit_pilot_proof_id
      where job.id = :'target_verification_job_id'::uuid) as reservations
)
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_source_binding_recovery_arm',
  'deploymentTarget', 'production',
  'recoveryState', case when runtime.retries = 1
    and runtime.retry_closures = 0 and runtime.bounded_logins = 1
    and runtime.post_emergency_boundaries = 1
    and runtime.live_financial_switches = 0
    and runtime.disabled_financial_switches = 7
    then 'armed' else 'invalid' end,
  'authorityBoundary', case when runtime.post_emergency_boundaries = 1
    then 'post_emergency' else 'unavailable' end,
  'alreadyArmed', :'armed_already_armed'::boolean,
  'remainingSeconds', greatest(0, floor(extract(epoch from (
    :'armed_expires_at'::timestamptz - pg_catalog.clock_timestamp()
  )))::integer),
  'verifierLoginBounded', runtime.bounded_logins = 1,
  'financialRowsCreated', runtime.outcomes <> 0 or runtime.reservations <> 0,
  'financialSwitchesLive', runtime.live_financial_switches,
  'financialSwitchesDisabled', runtime.disabled_financial_switches,
  'kemerBetLoginRoles', runtime.kemer_logins,
  'kemerBetSessions', runtime.kemer_sessions,
  'executionEnabled', runtime.kemer_logins <> 0 or runtime.kemer_sessions <> 0
)::text from runtime;

commit;
