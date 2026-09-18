\set ON_ERROR_STOP on
\getenv confirmed_project_ref PRODUCTION_PROJECT_REF
\getenv shadow_runtime_password TELEBIRR_SHADOW_VERIFIER_RUNTIME_PASSWORD
\getenv target_pilot_revision_id TARGET_PILOT_REVISION_ID
\getenv target_shadow_proof_request_id TARGET_SHADOW_PROOF_REQUEST_ID
\getenv source_live_verification_job_id SOURCE_LIVE_VERIFICATION_JOB_ID
\getenv recovery_request_key RECOVERY_REQUEST_KEY

select :'confirmed_project_ref' = 'xzztugbgtulptnbpoelr'
  as production_target_confirmed
\gset
\if :production_target_confirmed
\else
  \warn 'The workflow-supplied production project assertion is missing or incorrect; it does not identify the connected database.'
  select 1 / 0 as rejected;
\endif

begin transaction isolation level read committed;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';
set local password_encryption = 'scram-sha-256';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select :'shadow_runtime_password' ~ '^[0-9a-f]{64}$'
  as credential_canonical
\gset
\if :credential_canonical
\else
  \warn 'The shadow-verifier runtime credential is not canonical.'
  select 1 / 0 as rejected;
\endif

select :'target_pilot_revision_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and :'target_shadow_proof_request_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and (
     (
       :'source_live_verification_job_id' = 'not-applicable'
       and (
         :'recovery_request_key' = 'not-applicable'
         or :'recovery_request_key'
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
     )
     or (
       :'source_live_verification_job_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and :'target_shadow_proof_request_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and :'recovery_request_key'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
   )
  as exact_request_identifiers
\gset
\if :exact_request_identifiers
\else
  \warn 'The exact one-use production shadow request identifiers are invalid.'
  select 1 / 0 as rejected;
\endif

-- This transaction lock conflicts with disablement's session-scoped lock on the exact same key.
-- Provisioning therefore cannot interleave with either disablement transaction or its postconditions.
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:telebirr-shadow-verifier-runtime', 0)
);

select :'source_live_verification_job_id' = 'not-applicable'
  as review_direct_shadow_request
\gset

-- Review an exact direct shadow request without mutating it, create the first no-money recovery,
-- rebind an untouched expired recovery once, reopen it
-- after an infrastructure-only failure, or perform the final runtime-startup recovery while
-- retaining and binding every expired phone assignment. Every transition retains the original
-- protected reference, live proof/job lineage, and shadow request/job identities. None can enable
-- a switch, create a reservation, settle, enqueue execution, credit KemerBet, or move money.
\if :review_direct_shadow_request
  select count(*) = 1 as shadow_request_transition_ready
    from app.private_telebirr_shadow_proof_requests shadow_proof
   where shadow_proof.id = :'target_shadow_proof_request_id'::uuid
     and shadow_proof.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and shadow_proof.proof_status = 'verification_queued'
     and shadow_proof.source_live_verification_job_id is null
     and shadow_proof.source_live_proof_id is null
     and shadow_proof.source_pilot_revision_id is null
     and shadow_proof.source_receiver_profile_id is null
     and shadow_proof.recovery_request_key is null
     and shadow_proof.retry_request_key is null
     and shadow_proof.infrastructure_retry_request_key is null
     and shadow_proof.runtime_retry_request_key is null
     and pg_catalog.clock_timestamp()
           < shadow_proof.submitted_at + interval '12 hours'
     and (
       exists (
         select 1
           from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = shadow_proof.id
       )
       or app.private_telebirr_shadow_source_unavailable_retry_is_valid(
            shadow_proof.id,
            nullif(:'recovery_request_key', 'not-applicable')::uuid
          )
       or app.private_telebirr_shadow_observation_clock_retry_is_valid(
            shadow_proof.id,
            nullif(:'recovery_request_key', 'not-applicable')::uuid
          )
     )
      and exists (
        select 1
          from app.private_telebirr_shadow_device_evidence_staging staged
          join app.private_telebirr_shadow_verification_attempts attempt
            on attempt.id = staged.verification_attempt_id
         where attempt.shadow_proof_request_id = shadow_proof.id
           and staged.staged_at < shadow_proof.expires_at
           and staged.staged_at < attempt.expires_at
           and staged.observed_at >= attempt.issued_at
           and staged.observed_at < attempt.expires_at
           and not exists (
             select 1
               from app.private_telebirr_shadow_evidence_quarantine quarantine
              where quarantine.verification_attempt_id = attempt.id
                 or quarantine.observation_body_digest = staged.observation_body_digest
           )
           and (
             nullif(:'recovery_request_key', 'not-applicable')::uuid is null
             or exists (
               select 1
                 from app.private_telebirr_shadow_policy_recoveries recovery
                where recovery.recovery_request_key =
                      nullif(:'recovery_request_key', 'not-applicable')::uuid
                  and recovery.shadow_proof_request_id = shadow_proof.id
                  and recovery.shadow_verification_job_id = shadow_proof.verification_job_id
                  and recovery.pilot_revision_id = shadow_proof.pilot_revision_id
                  and recovery.retry_expires_at = shadow_proof.expires_at
                  and recovery.retry_expires_at > pg_catalog.clock_timestamp()
                  and recovery.reason_code = 'verifier_policy_fix_retry_no_credit'
                  and attempt.attempt_number = recovery.prior_attempt_count + 1
                  and staged.staged_at >= recovery.recovered_at
             )
             or (
               app.private_telebirr_shadow_source_unavailable_retry_is_valid(
                 shadow_proof.id,
                 nullif(:'recovery_request_key', 'not-applicable')::uuid
               )
               and exists (
                 select 1
                   from app.private_telebirr_shadow_source_unavailable_retries retry
                  where retry.retry_request_key =
                        nullif(:'recovery_request_key', 'not-applicable')::uuid
                    and retry.replacement_shadow_proof_request_id = shadow_proof.id
                    and staged.staged_at >= retry.authorized_at
               )
             )
             or (
               app.private_telebirr_shadow_observation_clock_retry_is_valid(
                 shadow_proof.id,
                  nullif(:'recovery_request_key', 'not-applicable')::uuid
                )
                and exists (
                  select 1
                    from app.private_telebirr_shadow_observation_clock_retries retry
                  where retry.retry_request_key =
                        nullif(:'recovery_request_key', 'not-applicable')::uuid
                    and retry.replacement_shadow_proof_request_id = shadow_proof.id
                    and staged.staged_at >= retry.authorized_at
                )
              )
           )
      )
     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id = shadow_proof.id
     )
      and (
        (
          nullif(:'recovery_request_key', 'not-applicable')::uuid is null
          and not exists (
            select 1
              from app.private_telebirr_shadow_policy_recoveries recovery
             where recovery.shadow_proof_request_id = shadow_proof.id
          )
          and not exists (
            select 1
              from app.private_telebirr_shadow_evidence_quarantine quarantine
              join app.private_telebirr_shadow_verification_attempts attempt
                on attempt.id = quarantine.verification_attempt_id
             where attempt.shadow_proof_request_id = shadow_proof.id
          )
        )
        or exists (
          select 1
            from app.private_telebirr_shadow_policy_recoveries recovery
            join app.private_telebirr_shadow_verification_attempts quarantined_attempt
              on quarantined_attempt.id = recovery.quarantined_verification_attempt_id
             and quarantined_attempt.shadow_proof_request_id = shadow_proof.id
            join app.private_telebirr_shadow_evidence_quarantine quarantine
              on quarantine.verification_attempt_id = quarantined_attempt.id
             and quarantine.observation_body_digest =
                 recovery.quarantined_observation_body_digest
           where recovery.recovery_request_key =
                 nullif(:'recovery_request_key', 'not-applicable')::uuid
             and recovery.shadow_proof_request_id = shadow_proof.id
             and recovery.shadow_verification_job_id = shadow_proof.verification_job_id
             and recovery.pilot_revision_id = shadow_proof.pilot_revision_id
             and recovery.retry_expires_at = shadow_proof.expires_at
             and recovery.recovery_request_digest =
                 app.private_telebirr_shadow_policy_recovery_digest(
                   recovery.recovery_request_key,
                   recovery.shadow_proof_request_id,
                   recovery.shadow_verification_job_id,
                   recovery.pilot_revision_id,
                   recovery.receiver_profile_id,
                   recovery.quarantined_verification_attempt_id,
                   recovery.quarantined_observation_body_digest,
                   recovery.prior_attempt_count,
                   recovery.prior_attempt_history_digest,
                   recovery.evidence_staged_at,
                   recovery.quarantined_at,
                   recovery.prior_expires_at,
                   recovery.recovered_at,
                   recovery.retry_expires_at,
                   recovery.reviewed_main_commit_sha,
                   recovery.reason_code
                 )
             and recovery.reason_code = 'verifier_policy_fix_retry_no_credit'
             and quarantine.reason_code = 'trusted_evidence_invalid'
             and quarantine.quarantined_at = recovery.quarantined_at
             and (
               select pg_catalog.count(*)
                 from app.private_telebirr_shadow_verification_attempts candidate
                where candidate.shadow_proof_request_id = shadow_proof.id
             ) >= recovery.prior_attempt_count + 1
             and (
               select pg_catalog.count(*)
                 from app.private_telebirr_shadow_evidence_quarantine held
                 join app.private_telebirr_shadow_verification_attempts candidate
                   on candidate.id = held.verification_attempt_id
                where candidate.shadow_proof_request_id = shadow_proof.id
             ) = 1
        )
        or app.private_telebirr_shadow_source_unavailable_retry_is_valid(
             shadow_proof.id,
             nullif(:'recovery_request_key', 'not-applicable')::uuid
           )
        or app.private_telebirr_shadow_observation_clock_retry_is_valid(
             shadow_proof.id,
             nullif(:'recovery_request_key', 'not-applicable')::uuid
           )
      )
  \gset
\else
  select count(*) = 0 as create_first_shadow_request
    from app.private_telebirr_shadow_proof_requests shadow_proof
   where shadow_proof.source_live_verification_job_id =
         nullif(:'source_live_verification_job_id', 'not-applicable')::uuid
  \gset
  \if :create_first_shadow_request
    select count(*) = 1 as create_terminal_source_unavailable_recovery
      from app.private_live_telebirr_verification_jobs job
      join app.private_live_telebirr_verification_outcomes outcome
        on outcome.verification_job_id = job.id
       and outcome.private_live_deposit_pilot_proof_id =
           job.private_live_deposit_pilot_proof_id
     where job.id = :'source_live_verification_job_id'::uuid
       and job.network_retry_source_job_id is not null
       and outcome.disposition = 'review_required'
       and outcome.reason_code = 'source_unavailable'
       and outcome.deposit_intent_id is null
       and outcome.deposit_submission_id is null
       and outcome.provider_payment_evidence_id is null
       and outcome.deposit_verification_attempt_id is null
    \gset
    \if :create_terminal_source_unavailable_recovery
      select count(*) = 1 as shadow_request_transition_ready
        from app.recover_private_live_telebirr_source_to_shadow(
          :'source_live_verification_job_id'::uuid,
          (
            select job.pilot_revision_id
              from app.private_live_telebirr_verification_jobs job
             where job.id = :'source_live_verification_job_id'::uuid
          ),
          :'target_pilot_revision_id'::uuid,
          :'target_shadow_proof_request_id'::uuid,
          :'recovery_request_key'::uuid,
          'terminal_source_unavailable_recovery_no_credit'
        )
      \gset
    \else
      select count(*) = 1 as shadow_request_transition_ready
        from app.recover_expired_private_live_telebirr_payment_to_shadow(
          nullif(:'source_live_verification_job_id', 'not-applicable')::uuid,
          (
            select job.pilot_revision_id
              from app.private_live_telebirr_verification_jobs job
             where job.id =
                   nullif(:'source_live_verification_job_id', 'not-applicable')::uuid
          ),
          :'target_pilot_revision_id'::uuid,
          nullif(:'recovery_request_key', 'not-applicable')::uuid,
          'expired_pilot_recovery_no_credit'
        )
      \gset
    \endif
\else
  select count(*) = 0 as no_terminal_source_unavailable_recovery,
         count(*) = 1 and pg_catalog.bool_and(
           recovery.recovery_request_key = :'recovery_request_key'::uuid
           and recovery.replacement_shadow_proof_request_id =
               :'target_shadow_proof_request_id'::uuid
           and recovery.target_pilot_revision_id = :'target_pilot_revision_id'::uuid
           and recovery.reason_code = 'terminal_source_unavailable_recovery_no_credit'
         ) as replay_terminal_source_unavailable_recovery
    from app.private_live_telebirr_source_recoveries recovery
   where recovery.terminal_live_verification_job_id =
         :'source_live_verification_job_id'::uuid
  \gset
  \if :replay_terminal_source_unavailable_recovery
    select count(*) = 1 as shadow_request_transition_ready
      from app.recover_private_live_telebirr_source_to_shadow(
        :'source_live_verification_job_id'::uuid,
        (
          select job.pilot_revision_id
            from app.private_live_telebirr_verification_jobs job
           where job.id = :'source_live_verification_job_id'::uuid
        ),
        :'target_pilot_revision_id'::uuid,
        :'target_shadow_proof_request_id'::uuid,
        :'recovery_request_key'::uuid,
        'terminal_source_unavailable_recovery_no_credit'
      )
    \gset
  \else
    \if :no_terminal_source_unavailable_recovery
      select count(*) = 1 and pg_catalog.bool_and(shadow_proof.retry_request_key is null)
          as create_first_shadow_retry
      from app.private_telebirr_shadow_proof_requests shadow_proof
     where shadow_proof.source_live_verification_job_id =
           :'source_live_verification_job_id'::uuid
    \gset
    \if :create_first_shadow_retry
      select count(*) = 1 as shadow_request_transition_ready
        from app.retry_expired_private_telebirr_shadow_request(
          (
            select shadow_proof.id
              from app.private_telebirr_shadow_proof_requests shadow_proof
             where shadow_proof.source_live_verification_job_id =
                   :'source_live_verification_job_id'::uuid
             order by shadow_proof.created_at, shadow_proof.id
             limit 1
          ),
          :'source_live_verification_job_id'::uuid,
          :'target_pilot_revision_id'::uuid,
          :'recovery_request_key'::uuid,
          'expired_shadow_retry_no_credit'
        )
      \gset
    \else
      select count(*) = 1
         and pg_catalog.bool_and(shadow_proof.infrastructure_retry_request_key is null)
          as create_infrastructure_retry
        from app.private_telebirr_shadow_proof_requests shadow_proof
       where shadow_proof.source_live_verification_job_id =
             :'source_live_verification_job_id'::uuid
      \gset
      \if :create_infrastructure_retry
        select count(*) = 1 as shadow_request_transition_ready
          from app.retry_expired_private_telebirr_shadow_after_infrastructure_failure(
            (
              select shadow_proof.id
                from app.private_telebirr_shadow_proof_requests shadow_proof
               where shadow_proof.source_live_verification_job_id =
                     :'source_live_verification_job_id'::uuid
               order by shadow_proof.created_at, shadow_proof.id
               limit 1
            ),
            :'source_live_verification_job_id'::uuid,
            :'target_pilot_revision_id'::uuid,
            :'recovery_request_key'::uuid,
            'expired_shadow_infrastructure_retry_no_credit'
          )
      \gset
      \else
        select count(*) = 1
           and pg_catalog.bool_and(
                 shadow_proof.runtime_retry_request_key =
                   :'recovery_request_key'::uuid
                 and shadow_proof.expires_at <= pg_catalog.clock_timestamp()
               ) as refresh_runtime_retry
          from app.private_telebirr_shadow_proof_requests shadow_proof
         where shadow_proof.source_live_verification_job_id =
               :'source_live_verification_job_id'::uuid
        \gset
        \if :refresh_runtime_retry
          select count(*) = 1 as shadow_request_transition_ready
            from app.refresh_private_telebirr_shadow_runtime_retry(
              (
                select shadow_proof.id
                  from app.private_telebirr_shadow_proof_requests shadow_proof
                 where shadow_proof.source_live_verification_job_id =
                       :'source_live_verification_job_id'::uuid
                 order by shadow_proof.created_at, shadow_proof.id
                 limit 1
              ),
              :'source_live_verification_job_id'::uuid,
              :'target_pilot_revision_id'::uuid,
              :'recovery_request_key'::uuid,
              'expired_shadow_runtime_startup_retry_no_credit'
            )
          \gset
        \else
          select count(*) = 1 as shadow_request_transition_ready
            from app.retry_expired_private_telebirr_shadow_after_runtime_startup_failure(
              (
                select shadow_proof.id
                  from app.private_telebirr_shadow_proof_requests shadow_proof
                 where shadow_proof.source_live_verification_job_id =
                       :'source_live_verification_job_id'::uuid
                 order by shadow_proof.created_at, shadow_proof.id
                 limit 1
              ),
              :'source_live_verification_job_id'::uuid,
              :'target_pilot_revision_id'::uuid,
              :'recovery_request_key'::uuid,
              'expired_shadow_runtime_startup_retry_no_credit'
            )
          \gset
        \endif
      \endif
    \endif
    \else
      select false as shadow_request_transition_ready
      \gset
    \endif
  \endif
  \endif
\endif
\if :shadow_request_transition_ready
\else
  \warn 'The one-use production shadow request transition did not complete.'
  select 1 / 0 as rejected;
\endif

-- Lock the complete seven-row boundary while provisioning. The runtime functions repeat this
-- no-money proof for every write, so a later switch transition stops shadow work fail closed.
with locked_feature_switches as materialized (
  select feature_switch.feature_key,
         feature_switch.mode,
         feature_switch.settings
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection',
     'cbe_birr_authoritative_verification',
     'telebirr_authoritative_verification',
     'private_live_deposit_pilot'
   )
   order by feature_switch.feature_key
   for share of feature_switch
), armed_shadow_pilot as (
  select pilot.id,
         pilot.configuration_digest
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = :'target_pilot_revision_id'::uuid
     and pilot.status = 'armed'
     and pilot.configuration_digest is not null
     and pilot.active_from <= pg_catalog.clock_timestamp()
     and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
), active_target_enrollment as (
  select enrollment.id
    from app.private_live_telebirr_device_enrollments enrollment
   where enrollment.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and enrollment.valid_from <= pg_catalog.clock_timestamp()
     and enrollment.valid_until > pg_catalog.clock_timestamp() + interval '5 minutes'
     and not exists (
       select 1
         from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
     )
   for share
), safe_direct_shadow as (
  select shadow_proof.id as shadow_proof_request_id
    from app.private_telebirr_shadow_proof_requests shadow_proof
   where :'source_live_verification_job_id' = 'not-applicable'
     and shadow_proof.id = :'target_shadow_proof_request_id'::uuid
     and shadow_proof.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and shadow_proof.proof_status = 'verification_queued'
     and shadow_proof.source_live_verification_job_id is null
     and shadow_proof.source_live_proof_id is null
     and shadow_proof.source_pilot_revision_id is null
     and shadow_proof.source_receiver_profile_id is null
     and shadow_proof.recovery_request_key is null
     and shadow_proof.retry_request_key is null
     and shadow_proof.infrastructure_retry_request_key is null
     and shadow_proof.runtime_retry_request_key is null
     and shadow_proof.submitted_at < pg_catalog.clock_timestamp()
     and pg_catalog.clock_timestamp()
           < shadow_proof.submitted_at + interval '12 hours'
     and (
       exists (
         select 1
           from app.telegram_telebirr_shadow_proof_receipts receipt
          where receipt.shadow_proof_request_id = shadow_proof.id
       )
       or app.private_telebirr_shadow_source_unavailable_retry_is_valid(
            shadow_proof.id,
            nullif(:'recovery_request_key', 'not-applicable')::uuid
          )
       or app.private_telebirr_shadow_observation_clock_retry_is_valid(
            shadow_proof.id,
            nullif(:'recovery_request_key', 'not-applicable')::uuid
          )
     )
      and exists (
        select 1
          from app.private_telebirr_shadow_device_evidence_staging staged
          join app.private_telebirr_shadow_verification_attempts attempt
            on attempt.id = staged.verification_attempt_id
         where attempt.shadow_proof_request_id = shadow_proof.id
           and staged.staged_at < shadow_proof.expires_at
           and staged.staged_at < attempt.expires_at
           and staged.observed_at >= attempt.issued_at
           and staged.observed_at < attempt.expires_at
           and not exists (
             select 1
               from app.private_telebirr_shadow_evidence_quarantine quarantine
              where quarantine.verification_attempt_id = attempt.id
                 or quarantine.observation_body_digest = staged.observation_body_digest
           )
           and (
             nullif(:'recovery_request_key', 'not-applicable')::uuid is null
             or exists (
               select 1
                 from app.private_telebirr_shadow_policy_recoveries recovery
                where recovery.recovery_request_key =
                      nullif(:'recovery_request_key', 'not-applicable')::uuid
                  and recovery.shadow_proof_request_id = shadow_proof.id
                  and recovery.shadow_verification_job_id = shadow_proof.verification_job_id
                  and recovery.pilot_revision_id = shadow_proof.pilot_revision_id
                  and recovery.retry_expires_at = shadow_proof.expires_at
                  and recovery.retry_expires_at > pg_catalog.clock_timestamp()
                  and recovery.reason_code = 'verifier_policy_fix_retry_no_credit'
                  and attempt.attempt_number = recovery.prior_attempt_count + 1
                  and staged.staged_at >= recovery.recovered_at
             )
             or (
               app.private_telebirr_shadow_source_unavailable_retry_is_valid(
                 shadow_proof.id,
                 nullif(:'recovery_request_key', 'not-applicable')::uuid
               )
               and exists (
                 select 1
                   from app.private_telebirr_shadow_source_unavailable_retries retry
                  where retry.retry_request_key =
                        nullif(:'recovery_request_key', 'not-applicable')::uuid
                    and retry.replacement_shadow_proof_request_id = shadow_proof.id
                    and staged.staged_at >= retry.authorized_at
               )
             )
             or (
               app.private_telebirr_shadow_observation_clock_retry_is_valid(
                 shadow_proof.id,
                  nullif(:'recovery_request_key', 'not-applicable')::uuid
                )
                and exists (
                  select 1
                    from app.private_telebirr_shadow_observation_clock_retries retry
                  where retry.retry_request_key =
                        nullif(:'recovery_request_key', 'not-applicable')::uuid
                    and retry.replacement_shadow_proof_request_id = shadow_proof.id
                    and staged.staged_at >= retry.authorized_at
                )
              )
           )
      )
     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id = shadow_proof.id
     )
      and (
        (
          nullif(:'recovery_request_key', 'not-applicable')::uuid is null
          and not exists (
            select 1
              from app.private_telebirr_shadow_policy_recoveries recovery
             where recovery.shadow_proof_request_id = shadow_proof.id
          )
          and not exists (
            select 1
              from app.private_telebirr_shadow_evidence_quarantine quarantine
              join app.private_telebirr_shadow_verification_attempts attempt
                on attempt.id = quarantine.verification_attempt_id
             where attempt.shadow_proof_request_id = shadow_proof.id
          )
        )
        or exists (
          select 1
            from app.private_telebirr_shadow_policy_recoveries recovery
            join app.private_telebirr_shadow_verification_attempts quarantined_attempt
              on quarantined_attempt.id = recovery.quarantined_verification_attempt_id
             and quarantined_attempt.shadow_proof_request_id = shadow_proof.id
            join app.private_telebirr_shadow_evidence_quarantine quarantine
              on quarantine.verification_attempt_id = quarantined_attempt.id
             and quarantine.observation_body_digest =
                 recovery.quarantined_observation_body_digest
           where recovery.recovery_request_key =
                 nullif(:'recovery_request_key', 'not-applicable')::uuid
             and recovery.shadow_proof_request_id = shadow_proof.id
             and recovery.shadow_verification_job_id = shadow_proof.verification_job_id
             and recovery.pilot_revision_id = shadow_proof.pilot_revision_id
             and recovery.retry_expires_at = shadow_proof.expires_at
             and recovery.recovery_request_digest =
                 app.private_telebirr_shadow_policy_recovery_digest(
                   recovery.recovery_request_key,
                   recovery.shadow_proof_request_id,
                   recovery.shadow_verification_job_id,
                   recovery.pilot_revision_id,
                   recovery.receiver_profile_id,
                   recovery.quarantined_verification_attempt_id,
                   recovery.quarantined_observation_body_digest,
                   recovery.prior_attempt_count,
                   recovery.prior_attempt_history_digest,
                   recovery.evidence_staged_at,
                   recovery.quarantined_at,
                   recovery.prior_expires_at,
                   recovery.recovered_at,
                   recovery.retry_expires_at,
                   recovery.reviewed_main_commit_sha,
                   recovery.reason_code
                 )
             and recovery.reason_code = 'verifier_policy_fix_retry_no_credit'
             and quarantine.reason_code = 'trusted_evidence_invalid'
             and quarantine.quarantined_at = recovery.quarantined_at
             and (
               select pg_catalog.count(*)
                 from app.private_telebirr_shadow_verification_attempts candidate
                where candidate.shadow_proof_request_id = shadow_proof.id
              ) >= recovery.prior_attempt_count + 1
             and (
               select pg_catalog.count(*)
                 from app.private_telebirr_shadow_evidence_quarantine held
                 join app.private_telebirr_shadow_verification_attempts candidate
                   on candidate.id = held.verification_attempt_id
                where candidate.shadow_proof_request_id = shadow_proof.id
             ) = 1
        )
        or app.private_telebirr_shadow_source_unavailable_retry_is_valid(
             shadow_proof.id,
             nullif(:'recovery_request_key', 'not-applicable')::uuid
           )
        or app.private_telebirr_shadow_observation_clock_retry_is_valid(
             shadow_proof.id,
             nullif(:'recovery_request_key', 'not-applicable')::uuid
           )
      )
), safe_source_and_open_shadow as (
  select job.id,
         shadow_proof.id as shadow_proof_request_id
    from app.private_live_telebirr_verification_jobs job
    join app.private_live_deposit_pilot_proofs proof
      on proof.id = job.private_live_deposit_pilot_proof_id
    join app.private_telebirr_shadow_proof_requests shadow_proof
      on shadow_proof.source_live_verification_job_id = job.id
     and shadow_proof.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and shadow_proof.id = :'target_shadow_proof_request_id'::uuid
   where job.id =
         nullif(:'source_live_verification_job_id', 'not-applicable')::uuid
     and job.expires_at <= pg_catalog.clock_timestamp()
     and proof.submitted_at < pg_catalog.clock_timestamp()
     and (
       pg_catalog.clock_timestamp() < proof.submitted_at + case
         when shadow_proof.runtime_retry_request_key =
              nullif(:'recovery_request_key', 'not-applicable')::uuid
           then interval '36 hours'
         else interval '24 hours'
       end
       or app.private_live_telebirr_source_recovery_is_valid(
            shadow_proof.id,
            nullif(:'recovery_request_key', 'not-applicable')::uuid
          )
     )
     and shadow_proof.expires_at > pg_catalog.clock_timestamp() + interval '60 seconds'
     and shadow_proof.proof_status = 'verification_queued'
     and (
       shadow_proof.recovery_request_key =
         nullif(:'recovery_request_key', 'not-applicable')::uuid
       or shadow_proof.retry_request_key =
         nullif(:'recovery_request_key', 'not-applicable')::uuid
       or shadow_proof.infrastructure_retry_request_key =
            nullif(:'recovery_request_key', 'not-applicable')::uuid
       or shadow_proof.runtime_retry_request_key =
            nullif(:'recovery_request_key', 'not-applicable')::uuid
     )
     and (
       (
         not exists (
           select 1 from app.private_live_telebirr_verification_attempts attempt
            where attempt.verification_job_id = job.id
         )
         and not exists (
           select 1 from app.private_live_telebirr_verification_outcomes outcome
            where outcome.verification_job_id = job.id
         )
       )
       or app.private_live_telebirr_source_recovery_is_valid(
            shadow_proof.id,
            nullif(:'recovery_request_key', 'not-applicable')::uuid
          )
     )
     and not exists (
       select 1 from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id = shadow_proof.id
     )
     and not exists (
       select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
        where receipt.shadow_proof_request_id = shadow_proof.id
     )
     and not exists (
       select 1
         from app.private_telebirr_shadow_device_evidence_staging staged
         join app.private_telebirr_shadow_verification_attempts attempt
           on attempt.id = staged.verification_attempt_id
        where attempt.shadow_proof_request_id = shadow_proof.id
     )
     and not exists (
       select 1
         from app.private_telebirr_shadow_evidence_quarantine quarantine
         join app.private_telebirr_shadow_verification_attempts attempt
           on attempt.id = quarantine.verification_attempt_id
        where attempt.shadow_proof_request_id = shadow_proof.id
     )
     and (
       (
         shadow_proof.runtime_retry_request_key is null
         and not exists (
           select 1 from app.private_telebirr_shadow_verification_attempts attempt
            where attempt.shadow_proof_request_id = shadow_proof.id
         )
       )
       or (
         shadow_proof.runtime_retry_request_key =
           nullif(:'recovery_request_key', 'not-applicable')::uuid
         and exists (
           select 1 from app.private_telebirr_shadow_verification_attempts attempt
            where attempt.shadow_proof_request_id = shadow_proof.id
         )
         and not exists (
           select 1 from app.private_telebirr_shadow_verification_attempts attempt
            where attempt.shadow_proof_request_id = shadow_proof.id
              and attempt.expires_at > pg_catalog.clock_timestamp()
         )
       )
     )
), safe_reviewable_source_recovery as (
  -- A terminal source-unavailable recovery keeps its original transfer submitted_at. Once the
  -- short proof/assignment lease has closed, admit only evidence that was immutably staged inside
  -- that lease and whose exact recovery lineage remains inside its separate twelve-hour review
  -- window. This grants the isolated verifier a login only; it does not reopen phone pickup or any
  -- financial path.
  select job.id,
         shadow_proof.id as shadow_proof_request_id
    from app.private_live_telebirr_verification_jobs job
    join app.private_live_deposit_pilot_proofs proof
      on proof.id = job.private_live_deposit_pilot_proof_id
    join app.private_telebirr_shadow_proof_requests shadow_proof
      on shadow_proof.source_live_verification_job_id = job.id
     and shadow_proof.pilot_revision_id = :'target_pilot_revision_id'::uuid
     and shadow_proof.id = :'target_shadow_proof_request_id'::uuid
   where job.id =
         nullif(:'source_live_verification_job_id', 'not-applicable')::uuid
     and shadow_proof.proof_status = 'verification_queued'
     and shadow_proof.recovery_request_key =
         nullif(:'recovery_request_key', 'not-applicable')::uuid
     and shadow_proof.recovery_reason_code = 'expired_pilot_recovery_no_credit'
     and shadow_proof.recovered_at is not null
     and shadow_proof.recovered_at <= pg_catalog.clock_timestamp()
     and pg_catalog.clock_timestamp() < shadow_proof.recovered_at + interval '12 hours'
     and app.private_live_telebirr_source_recovery_is_valid(
           shadow_proof.id,
           nullif(:'recovery_request_key', 'not-applicable')::uuid
         )
     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id = shadow_proof.id
     )
     and exists (
       select 1
         from app.private_telebirr_shadow_device_evidence_staging staged
         join app.private_telebirr_shadow_verification_attempts attempt
           on attempt.id = staged.verification_attempt_id
          and attempt.shadow_proof_request_id = shadow_proof.id
          and attempt.verification_job_id = shadow_proof.verification_job_id
        where staged.staged_at < shadow_proof.expires_at
          and staged.staged_at < attempt.expires_at
          and staged.observed_at >= attempt.issued_at
          and staged.observed_at < attempt.expires_at
          and not exists (
            select 1
              from app.private_telebirr_shadow_evidence_quarantine quarantine
             where quarantine.verification_attempt_id = attempt.id
                or quarantine.observation_body_digest = staged.observation_body_digest
          )
     )
), safe_exact_shadow as (
  select direct.shadow_proof_request_id
    from safe_direct_shadow direct
  union all
  select recovered.shadow_proof_request_id
    from safe_source_and_open_shadow recovered
  union all
  select reviewable.shadow_proof_request_id
    from safe_reviewable_source_recovery reviewable
)
select (select count(*) from locked_feature_switches) = 7
   and (select count(*) from locked_feature_switches
         where feature_key <> 'private_live_deposit_pilot'
           and mode = 'disabled'
           and settings = '{}'::jsonb) = 6
   and (select count(*) from armed_shadow_pilot) = 1
   and (select count(*) from active_target_enrollment) = 1
   and (select count(*) from safe_exact_shadow) = 1
   and pg_catalog.to_regprocedure(
         'app.recover_expired_private_live_telebirr_payment_to_shadow(uuid,uuid,uuid,uuid,text)'
       ) is not null
   and pg_catalog.to_regprocedure(
         'app.recover_private_live_telebirr_source_to_shadow(uuid,uuid,uuid,uuid,uuid,text)'
       ) is not null
   and pg_catalog.to_regprocedure(
         'app.private_live_telebirr_source_recovery_is_valid(uuid,uuid)'
       ) is not null
   and pg_catalog.to_regprocedure(
         'app.retry_expired_private_telebirr_shadow_request(uuid,uuid,uuid,uuid,text)'
       ) is not null
   and pg_catalog.to_regprocedure(
         'app.retry_expired_private_telebirr_shadow_after_infrastructure_failure(uuid,uuid,uuid,uuid,text)'
       ) is not null
    and pg_catalog.to_regprocedure(
          'app.retry_expired_private_telebirr_shadow_after_runtime_startup_failure(uuid,uuid,uuid,uuid,text)'
        ) is not null
    and pg_catalog.to_regprocedure(
          'app.refresh_private_telebirr_shadow_runtime_retry(uuid,uuid,uuid,uuid,text)'
        ) is not null
   and pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_source_unavailable_retry_is_valid(uuid,uuid)'
       ) is not null
   and pg_catalog.to_regprocedure(
         'app.private_telebirr_shadow_observation_clock_retry_is_valid(uuid,uuid)'
       ) is not null
   and (select count(*)
          from locked_feature_switches switch_state
          join armed_shadow_pilot pilot
            on switch_state.feature_key = 'private_live_deposit_pilot'
         where switch_state.mode = 'dry_run'
           and switch_state.settings = pg_catalog.jsonb_build_object(
             'contract_version', 1,
             'pilot_revision_id', pilot.id,
             'configuration_digest', pilot.configuration_digest
           )) = 1
  as shadow_no_money_boundary_ready
\gset
\if :shadow_no_money_boundary_ready
\else
  \warn 'The exact armed dry-run shadow pilot and disabled financial boundary are required.'
  select 1 / 0 as rejected;
\endif

do $fetanagent$
declare
  group_state record;
  runtime_state record;
begin
  select role.rolcanlogin,
         role.rolinherit,
         role.rolsuper,
         role.rolcreatedb,
         role.rolcreaterole,
         role.rolreplication,
         role.rolbypassrls,
         role.rolconnlimit
    into group_state
    from pg_catalog.pg_roles role
   where role.rolname = 'fetanagent_telebirr_shadow_verifier';
  if not found
    or group_state.rolcanlogin
    or group_state.rolinherit
    or group_state.rolsuper
    or group_state.rolcreatedb
    or group_state.rolcreaterole
    or group_state.rolreplication
    or group_state.rolbypassrls
    or group_state.rolconnlimit <> 2 then
    raise exception 'The shadow-verifier privilege role is outside its narrow scaffold.';
  end if;

  select role.rolcanlogin,
         role.rolinherit,
         role.rolsuper,
         role.rolcreatedb,
         role.rolcreaterole,
         role.rolreplication,
         role.rolbypassrls,
         role.rolconnlimit,
         role.rolvaliduntil,
         auth.rolpassword
    into runtime_state
    from pg_catalog.pg_roles role
    join pg_catalog.pg_authid auth on auth.oid = role.oid
   where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime';
  if not found
    or runtime_state.rolcanlogin
    or runtime_state.rolinherit
    or runtime_state.rolsuper
    or runtime_state.rolcreatedb
    or runtime_state.rolcreaterole
    or runtime_state.rolreplication
    or runtime_state.rolbypassrls
    or runtime_state.rolconnlimit <> 1
    or runtime_state.rolpassword is not null then
    raise exception 'The shadow-verifier runtime role is not disabled cleanly.';
  end if;

  if (select count(*)
        from pg_catalog.pg_auth_members membership
       where membership.member = (
         select role.oid from pg_catalog.pg_roles role
          where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
       )) <> 1
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_telebirr_shadow_verifier'
         and member_role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
    ) then
    raise exception 'The shadow-verifier runtime membership is not exact.';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_telebirr_shadow_verifier',
       'fetanagent_telebirr_shadow_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'A shadow-verifier session already exists.';
  end if;
end
$fetanagent$;

alter role fetanagent_telebirr_shadow_verifier_runtime with
  login noinherit nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 password :'shadow_runtime_password';

do $fetanagent$
begin
  execute pg_catalog.format(
    'alter role fetanagent_telebirr_shadow_verifier_runtime valid until %L',
    pg_catalog.clock_timestamp() + interval '20 minutes'
  );
end
$fetanagent$;

select count(*) = 1
   and pg_catalog.bool_and(
     role.rolcanlogin
     and not role.rolinherit
     and not role.rolsuper
     and not role.rolcreatedb
     and not role.rolcreaterole
     and not role.rolreplication
     and not role.rolbypassrls
     and role.rolconnlimit = 1
     and auth.rolpassword is not null
     and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '15 minutes'
     and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '25 minutes'
   ) as runtime_postcondition
from pg_catalog.pg_roles role
join pg_catalog.pg_authid auth on auth.oid = role.oid
where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
\gset
\if :runtime_postcondition
\else
  \warn 'The bounded shadow-verifier runtime postcondition was not installed.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'shadow_verifier_bounded_runtime_provision',
  'deploymentTarget', 'production',
  'financialBoundary', 'dry_run',
  'runtimeLogin', 'bounded_20_minutes'
)::text;

commit;
