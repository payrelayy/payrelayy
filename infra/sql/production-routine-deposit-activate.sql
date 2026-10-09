\set ON_ERROR_STOP on
-- This operator-only procedure provisions the one-connection Windows execution transport.
-- It does not enable payment verification or deposit execution, create a paid claim, or
-- start the Windows worker. The separate, signed-origin paid claim producer and bounded
-- settlement runtime must already be deployed and verified before this can proceed.

\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv owner_auth_user_id FETANAGENT_ROUTINE_OWNER_AUTH_USER_ID
\getenv certificate_id FETANAGENT_ROUTINE_COMPANION_CERTIFICATE_ID
\getenv activation_request_key FETANAGENT_ROUTINE_ACTIVATION_REQUEST_KEY
\getenv runtime_password FETANAGENT_ROUTINE_RUNTIME_PASSWORD

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  and current_user = 'postgres' and session_user = 'postgres'
  and :'owner_auth_user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'certificate_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'activation_request_key' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and :'runtime_password' ~ '^[0-9a-f]{64}$'
  as exact_activation_input
\gset
\if :exact_activation_input
\else
  \warn 'The exact production routine-deposit activation inputs are required.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '20s';

-- Fail closed on the exact production path, not the retired pilot lineage. A recent
-- no-money signed V2 official-origin observation proves the paired-phone source route;
-- disposable SQL tests prove the one-use claim/job path. Keep every financial switch
-- disabled while provisioning this separate Windows transport credential.
select (
  select pg_catalog.count(*) = 7
    and pg_catalog.bool_and(feature_switch.mode = 'disabled')
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   )
) and exists (
  select 1 from app.routine_telebirr_signed_observation_payloads observation
  join app.routine_telebirr_lookup_challenges challenge
    on challenge.challenge_id = observation.challenge_id
  join app.routine_telebirr_device_enrollments enrollment
    on enrollment.id = challenge.device_enrollment_id
   where observation.recorded_at >= pg_catalog.clock_timestamp() - interval '24 hours'
     and observation.server_policy_result = 'signed_evidence_matches_policy'
     and observation.signed_observation ->> 'contractVersion' = '2'
     and observation.signed_observation #>> '{body,facts,sourceOriginAttestation}'
       = 'official_tls_origin'
     and challenge.issuance_mode = 'no_money'
     and enrollment.valid_until > pg_catalog.clock_timestamp() + interval '1 hour'
     and not exists (
       select 1 from app.routine_telebirr_device_enrollment_revocations revocation
        where revocation.enrollment_id = enrollment.id
     )
) and (
  select pg_catalog.count(*) = 3
    and pg_catalog.bool_and(runtime.rolcanlogin
      and runtime.rolvaliduntil > pg_catalog.clock_timestamp() + interval '1 hour')
    from pg_catalog.pg_roles runtime
   where runtime.rolname in (
     'fetanagent_routine_telebirr_no_money_runtime',
     'fetanagent_routine_telebirr_paid_poll_runtime',
     'fetanagent_routine_telebirr_paid_settlement_runtime'
   )
) and exists (
  select 1 from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.finalize_routine_telebirr_paid_observation(uuid)')
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef
     and pg_catalog.strpos(routine.prosrc, 'sourceOriginAttestation') > 0
     and pg_catalog.strpos(routine.prosrc,
       'routine_telebirr_paid_settlement_session_allowed') > 0
) and pg_catalog.to_regprocedure(
  'app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)'
) is not null and not exists (
  select 1 from app.routine_telebirr_execution_bindings binding
  join app.deposit_execution_attempts attempt
    on attempt.deposit_job_id = binding.execution_job_id
   where attempt.status in (
     'prepared', 'final_action_fenced', 'reconciliation_required', 'review_required'
   )
) as routine_activation_readiness
\gset
\if :routine_activation_readiness
\else
  \warn 'Routine deposit activation preflight failed; financial switches and runtime remain unchanged.'
  select 1 / 0 as routine_activation_preflight_rejected;
\endif

select app.activate_routine_telebirr_execution_transport(
  :'owner_auth_user_id'::uuid,
  :'certificate_id'::uuid,
  :'activation_request_key'::uuid,
  :'runtime_password'::text
) as valid_until
\gset

select app.routine_telebirr_runtime_is_active(null) as routine_runtime_active
\gset
\if :routine_runtime_active
\else
  \warn 'The routine-deposit runtime did not become active.'
  select 1 / 0 as rejected;
\endif
commit;
\unset runtime_password

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'routine_deposit_activate',
  'deploymentTarget', 'production',
  'runtimeLogin', 'active',
  'validUntil', :'valid_until'::timestamptz,
  'livePaymentPerformed', false
)::text;
