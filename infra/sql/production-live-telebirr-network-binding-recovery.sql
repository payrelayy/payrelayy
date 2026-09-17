\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_activation_epoch TARGET_ACTIVATION_EPOCH
\getenv recovery_request_key NETWORK_BINDING_RECOVERY_REQUEST_KEY
\getenv reviewed_main_commit_sha REVIEWED_MAIN_COMMIT_SHA

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
   and :'reviewed_main_commit_sha' ~ '^[0-9a-f]{40}$'
  as exact_production_contract
\gset
\if :exact_production_contract
\else
  \warn 'The exact production target or reviewed commit assertion is invalid.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '45s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '45s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_activation_epoch' ~ '^[1-9][0-9]{0,18}$'
   and :'recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as exact_recovery_identifiers
\gset
\if :exact_recovery_identifiers
\else
  \warn 'The live TeleBirr recovery identifiers are invalid.'
  select 1 / 0 as rejected;
\endif

with binding_guard as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.enforce_private_live_telebirr_assignment_reference_binding()'
   )
), mutation_guard as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.reject_private_live_telebirr_network_retry_mutation()'
   )
), recovery_function as materialized (
  select routine.*
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.recover_private_live_telebirr_network_retry_binding(uuid,uuid,bigint,uuid,text)'
   )
)
select (select count(*) from supabase_migrations.schema_migrations migration
         where migration.version = '20260917220932') = 1
   and (select count(*) from binding_guard) = 1
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and not routine.proretset
          and routine.pronargs = 0
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'),
                  'sha256'
                ),
                'hex'
              ) = '23809205c5d3e85e26d9909236b83bd153622b3704d48022095ef73f6ecbe70e'
        ) from binding_guard routine)
   and (select count(*) from mutation_guard) = 1
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and not routine.proretset
          and routine.pronargs = 0
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'),
                  'sha256'
                ),
                'hex'
              ) = '71fe68f4d142b8cb84fdb52f174fc2e7fc782d7d707bf01bf24778e165142651'
        ) from mutation_guard routine)
   and (select count(*) from recovery_function) = 1
   and (select pg_catalog.bool_and(
          routine.prokind = 'f'
          and routine.prosecdef
          and routine.proretset
          and routine.pronargs = 5
          and routine.proconfig = array['search_path=pg_catalog']::text[]
          and routine.proowner = (
            select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
          )
          and routine.proacl = array['postgres=X/postgres']::aclitem[]
          and pg_catalog.encode(
                extensions.digest(
                  pg_catalog.convert_to(routine.prosrc, 'UTF8'),
                  'sha256'
                ),
                'hex'
              ) = '237330eccfa5dfde5dd6c26de8694d32d1fd701964eeb65d5ef1d9049d1584d6'
        ) from recovery_function routine)
   and (select count(*)
          from pg_catalog.pg_trigger trigger_row
         where trigger_row.tgrelid =
               'app.private_live_telebirr_verification_jobs'::regclass
           and trigger_row.tgname = 'private_live_telebirr_network_retry_immutable'
           and trigger_row.tgfoid = pg_catalog.to_regprocedure(
             'app.reject_private_live_telebirr_network_retry_mutation()'
           )
           and trigger_row.tgenabled = 'O'
           and not trigger_row.tgisinternal) = 1
  as reviewed_catalog_ready
\gset
\if :reviewed_catalog_ready
\else
  \warn 'The reviewed production recovery catalog does not match.'
  select 1 / 0 as rejected;
\endif

with candidates as materialized (
  select job.id
    from app.private_live_telebirr_verification_jobs job
    join app.private_live_telebirr_verification_jobs source_job
      on source_job.id = job.network_retry_source_job_id
     and source_job.network_retry_source_job_id is null
   where job.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and job.network_retry_reason_code = 'official_receipt_network_unavailable'
     and job.network_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
     and (
       job.network_binding_recovery_request_key = :'recovery_request_key'::uuid
       or (
         job.network_binding_recovery_request_key is null
         and job.network_binding_original_expires_at is null
         and job.network_binding_recovered_at is null
         and job.network_binding_recovery_request_digest is null
         and job.network_binding_recovery_reason_code is null
         and job.expires_at <= pg_catalog.clock_timestamp()
         and (select count(*)
                from app.private_live_telebirr_verification_attempts attempt
               where attempt.verification_job_id = job.id) = 1
         and exists (
           select 1
             from app.private_live_telebirr_verification_attempts attempt
            where attempt.verification_job_id = job.id
              and attempt.attempt_number = 1
              and attempt.expires_at <= pg_catalog.clock_timestamp()
         )
         and not exists (
           select 1
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_transcripts transcript
               on transcript.verification_attempt_id = attempt.id
            where attempt.verification_job_id = job.id
         )
         and not exists (
           select 1
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_deliveries delivery
               on delivery.verification_attempt_id = attempt.id
            where attempt.verification_job_id = job.id
         )
         and not exists (
           select 1
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_device_evidence_staging evidence
               on evidence.verification_attempt_id = attempt.id
            where attempt.verification_job_id = job.id
         )
         and not exists (
           select 1
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_observation_transcripts observation
               on observation.verification_attempt_id = attempt.id
            where attempt.verification_job_id = job.id
         )
         and not exists (
           select 1 from app.private_live_telebirr_verification_outcomes outcome
            where outcome.verification_job_id = job.id
         )
       )
     )
     and (select count(*)
            from app.private_live_telebirr_verification_outcomes source_outcome
           where source_outcome.verification_job_id = source_job.id
             and source_outcome.disposition = 'review_required'
             and source_outcome.reason_code = 'source_unavailable') = 1
     and exists (
       select 1
         from app.private_live_telebirr_verification_outcomes source_outcome
         join app.private_live_telebirr_assignment_transcripts source_transcript
           on source_transcript.verification_attempt_id =
              source_outcome.verification_attempt_id
         join app.private_live_telebirr_assignment_reference_bindings binding
           on binding.reference_binding_digest =
              source_transcript.reference_binding_digest
          and binding.verification_job_id = source_job.id
        where source_outcome.verification_job_id = source_job.id
          and source_outcome.disposition = 'review_required'
          and source_outcome.reason_code = 'source_unavailable'
     )
)
select count(*) = 1 as exact_target_ready,
       (pg_catalog.array_agg(id))[1] as verification_job_id
  from candidates
\gset target_
\if :target_exact_target_ready
\else
  \warn 'Exactly one eligible live TeleBirr network retry was not found.'
  select 1 / 0 as rejected;
\endif

select pg_catalog.jsonb_build_object(
         'attempts', (
           select count(*) from app.private_live_telebirr_verification_attempts attempt
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'transcripts', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_transcripts transcript
               on transcript.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'deliveries', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_deliveries delivery
               on delivery.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'evidence', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_device_evidence_staging staged
               on staged.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'observations', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_observation_transcripts observation
               on observation.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'outcomes', (
           select count(*) from app.private_live_telebirr_verification_outcomes outcome
            where outcome.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'reservations', (
           select count(*)
             from app.private_live_deposit_pilot_reservations reservation
             join app.private_live_telebirr_verification_jobs job
               on job.private_live_deposit_pilot_proof_id =
                  reservation.private_live_deposit_pilot_proof_id
            where job.id = :'target_verification_job_id'::uuid
         ),
         'settlements', (
           select count(*)
             from app.private_live_telebirr_verification_outcomes outcome
             join app.private_live_telebirr_settlement_receipts receipt
               on receipt.verification_outcome_id = outcome.id
            where outcome.verification_job_id = :'target_verification_job_id'::uuid
         )
       )::text as scoped_ledger_before
\gset

select *
  from app.recover_private_live_telebirr_network_retry_binding(
    :'target_verification_job_id'::uuid,
    :'target_pilot_revision_id'::uuid,
    :'target_activation_epoch'::bigint,
    :'recovery_request_key'::uuid,
    'network_retry_reference_binding_registry'
  )
\gset recovery_

select pg_catalog.jsonb_build_object(
         'attempts', (
           select count(*) from app.private_live_telebirr_verification_attempts attempt
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'transcripts', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_transcripts transcript
               on transcript.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'deliveries', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_assignment_deliveries delivery
               on delivery.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'evidence', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_device_evidence_staging staged
               on staged.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'observations', (
           select count(*)
             from app.private_live_telebirr_verification_attempts attempt
             join app.private_live_telebirr_observation_transcripts observation
               on observation.verification_attempt_id = attempt.id
            where attempt.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'outcomes', (
           select count(*) from app.private_live_telebirr_verification_outcomes outcome
            where outcome.verification_job_id = :'target_verification_job_id'::uuid
         ),
         'reservations', (
           select count(*)
             from app.private_live_deposit_pilot_reservations reservation
             join app.private_live_telebirr_verification_jobs job
               on job.private_live_deposit_pilot_proof_id =
                  reservation.private_live_deposit_pilot_proof_id
            where job.id = :'target_verification_job_id'::uuid
         ),
         'settlements', (
           select count(*)
             from app.private_live_telebirr_verification_outcomes outcome
             join app.private_live_telebirr_settlement_receipts receipt
               on receipt.verification_outcome_id = outcome.id
            where outcome.verification_job_id = :'target_verification_job_id'::uuid
         )
       )::text as scoped_ledger_after
\gset

select :'recovery_verification_job_id'::uuid = :'target_verification_job_id'::uuid
   and :'recovery_stranded_expires_at'::timestamptz <
       :'recovery_recovered_expires_at'::timestamptz
   and exists (
     select 1
       from app.private_live_telebirr_verification_jobs job
      where job.id = :'target_verification_job_id'::uuid
        and job.network_binding_recovery_request_key = :'recovery_request_key'::uuid
        and job.network_binding_recovery_reason_code =
            'network_retry_reference_binding_registry'
        and job.network_binding_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
        and job.network_binding_original_expires_at =
            :'recovery_stranded_expires_at'::timestamptz
        and job.expires_at = :'recovery_recovered_expires_at'::timestamptz
   )
   and :'scoped_ledger_before'::jsonb = :'scoped_ledger_after'::jsonb
   and not exists (
     select 1 from pg_catalog.pg_roles role
      where role.rolname in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime'
      ) and role.rolcanlogin
   )
   and not exists (
     select 1 from pg_catalog.pg_stat_activity activity
      where activity.usename in (
        'fetanagent_deposit_executor',
        'fetanagent_deposit_executor_runtime'
      )
   )
  as exact_recovery_postcondition
\gset
\if :exact_recovery_postcondition
\else
  \warn 'The live TeleBirr network-binding recovery postcondition failed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'live_telebirr_network_binding_recovery',
  'deploymentTarget', 'production',
  'recoveryState', case
    when :'recovery_recovered_expires_at'::timestamptz > pg_catalog.clock_timestamp()
      then 'armed'
    else 'replayed'
  end,
  'alreadyRecovered', :'recovery_already_recovered'::boolean,
  'remainingSeconds', greatest(
    0,
    floor(extract(epoch from (
      :'recovery_recovered_expires_at'::timestamptz - pg_catalog.clock_timestamp()
    )))::integer
  ),
  'kemerBetLoginRoles', 0,
  'kemerBetSessions', 0,
  'financialRowsCreated', false,
  'executionEnabled', false
)::text;

commit;
