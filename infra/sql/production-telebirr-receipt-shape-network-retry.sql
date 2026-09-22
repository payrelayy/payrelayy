\set ON_ERROR_STOP on
\set QUIET on

begin isolation level read committed;
set local lock_timeout = '5s';
set local statement_timeout = '45s';

create temp table reviewed_network_source on commit drop as
select proof.id as source_proof_id,
       proof.pilot_revision_id,
       pg_catalog.gen_random_uuid() as retry_request_key
  from app.private_telebirr_shadow_receipt_shape_diag_retries shape_retry
  join app.private_telebirr_shadow_proof_requests proof
    on proof.id = shape_retry.replacement_shadow_proof_request_id
   and proof.verification_job_id =
       shape_retry.replacement_shadow_verification_job_id
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = proof.pilot_revision_id
 where app.private_telebirr_receipt_shape_network_source_is_valid(proof.id)
   and pilot.status = 'armed'
   and pilot.expires_at > pg_catalog.clock_timestamp() + interval '1 hour'
   and not exists (
     select 1 from app.private_telebirr_shadow_source_unavailable_retries retry
      where retry.source_shadow_proof_request_id = proof.id
   );

do $require_one_reviewed_network_source$
begin
  if (select pg_catalog.count(*) from reviewed_network_source) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_deposit_pilot_revisions
         where status = 'armed') <> 1
    or (select pg_catalog.count(*) from app.private_live_deposit_pilot_reservations) <> 0
    or (select pg_catalog.count(*) from app.private_live_telebirr_settlement_receipts) <> 0
    or (select pg_catalog.count(*) from app.deposit_jobs) <> 0
    or (select pg_catalog.count(*) from app.provider_payment_evidence) <> 0
    or (select pg_catalog.count(*) from app.deposit_execution_attempts) <> 0
    or (select pg_catalog.count(*)
          from app.agent_platform_companion_execution_control
         where control_state <> 'disabled') <> 0
    or (select pg_catalog.count(*)
          from app.feature_switches
         where feature_key in (
           'cbe_birr_authoritative_verification', 'deposit_execution',
           'payment_verification', 'telebirr_authoritative_verification',
           'withdrawal_collection', 'withdrawal_validation'
         ) and mode = 'disabled') <> 6
    or (select pg_catalog.count(*)
          from app.feature_switches
         where feature_key = 'private_live_deposit_pilot'
           and mode = 'dry_run') <> 1 then
    raise exception 'The reviewed network child has no exact no-money authority.';
  end if;
end;
$require_one_reviewed_network_source$;

create temp table reviewed_network_retry_result on commit drop as
select result.*
  from reviewed_network_source source
  cross join lateral app.retry_private_telebirr_shadow_after_source_unavailable(
    source.source_proof_id,
    source.pilot_revision_id,
    source.retry_request_key,
    'source_unavailable_review_retry_no_credit'
  ) result;

do $verify_one_reviewed_network_child$
begin
  if (select pg_catalog.count(*) from reviewed_network_retry_result) <> 1
    or not exists (
      select 1
        from reviewed_network_source source
        join reviewed_network_retry_result result on not result.already_retried
        join app.private_telebirr_shadow_source_unavailable_retries retry
          on retry.retry_request_key = source.retry_request_key
         and retry.source_shadow_proof_request_id = source.source_proof_id
         and retry.replacement_shadow_proof_request_id =
             result.shadow_proof_request_id
         and retry.replacement_shadow_verification_job_id =
             result.shadow_verification_job_id
        join app.private_telebirr_shadow_proof_requests replacement
          on replacement.id = result.shadow_proof_request_id
         and replacement.verification_job_id =
             result.shadow_verification_job_id
       where replacement.pilot_revision_id = source.pilot_revision_id
         and replacement.proof_status = 'verification_queued'
         and replacement.expires_at = result.retry_expires_at
         and replacement.expires_at >
             pg_catalog.clock_timestamp() + interval '1 hour'
         and app.private_telebirr_shadow_source_unavailable_retry_is_valid(
               replacement.id, retry.retry_request_key
             )
         and not exists (
           select 1 from app.private_telebirr_shadow_verification_attempts attempt
            where attempt.shadow_proof_request_id = replacement.id
         )
         and not exists (
           select 1 from app.private_telebirr_shadow_verification_outcomes outcome
            where outcome.shadow_proof_request_id = replacement.id
         )
    )
    or (select pg_catalog.count(*) from app.private_live_deposit_pilot_reservations) <> 0
    or (select pg_catalog.count(*) from app.private_live_telebirr_settlement_receipts) <> 0
    or (select pg_catalog.count(*) from app.deposit_jobs) <> 0
    or (select pg_catalog.count(*) from app.provider_payment_evidence) <> 0
    or (select pg_catalog.count(*) from app.deposit_execution_attempts) <> 0 then
    raise exception 'The reviewed network child failed the append-only no-money boundary.';
  end if;
end;
$verify_one_reviewed_network_child$;

select pg_catalog.json_build_object(
  'schemaVersion', 1,
  'operation', 'reviewed_receipt_shape_network_retry',
  'deploymentTarget', 'production',
  'created', true,
  'sourceCount', (select pg_catalog.count(*) from reviewed_network_source),
  'replacementCount', (select pg_catalog.count(*) from reviewed_network_retry_result),
  'remainingSeconds', (
    select pg_catalog.floor(
      pg_catalog.extract(epoch from result.retry_expires_at -
        pg_catalog.clock_timestamp())
    )::integer from reviewed_network_retry_result result
  ),
  'reservations', (select pg_catalog.count(*) from app.private_live_deposit_pilot_reservations),
  'settlementReceipts', (select pg_catalog.count(*) from app.private_live_telebirr_settlement_receipts),
  'depositJobs', (select pg_catalog.count(*) from app.deposit_jobs),
  'providerEvidence', (select pg_catalog.count(*) from app.provider_payment_evidence),
  'executionAttempts', (select pg_catalog.count(*) from app.deposit_execution_attempts),
  'moneyMoved', false,
  'identifiersRedacted', true
);

commit;
