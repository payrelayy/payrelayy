-- Production first received the reviewed operational change under hosted version 20260916134810.
-- This replay-safe canonical finalizer runs after the runtime-retry foundation on clean databases.
-- A runtime retry can be exhausted by infrastructure defects without producing provider evidence.
-- Permit the same idempotency key to refresh that no-money review window once the prior window and
-- every assignment have expired. The source payment remains immutable and every financial path
-- must still be disabled. The total evidence-review age remains bounded to 36 hours.

do $migration$
declare
  target regprocedure :=
    'app.enforce_private_telebirr_shadow_runtime_retry_only()'::regprocedure;
  definition text;
  needle constant text := E'  if tg_op <> ''UPDATE''\n';
  branch constant text := $branch$
  if pg_catalog.current_setting(
       'app.private_telebirr_shadow_runtime_retry', true
     ) = 'refresh' then
    if tg_op <> 'UPDATE'
      or session_user <> 'postgres'
      or old.runtime_retry_request_key is null
      or old.runtime_retry_request_digest is null
      or old.runtime_retry_reason_code is distinct from
         'expired_shadow_runtime_startup_retry_no_credit'
      or old.runtime_retry_original_expires_at is null
      or old.runtime_retry_prior_attempt_count is null
      or old.runtime_retry_prior_attempt_history_digest is null
      or old.runtime_retried_at is null
      or old.expires_at > pg_catalog.clock_timestamp()
      or new.runtime_retry_request_key is distinct from old.runtime_retry_request_key
      or new.runtime_retry_reason_code is distinct from old.runtime_retry_reason_code
      or new.runtime_retry_original_expires_at
           is distinct from old.runtime_retry_original_expires_at
      or new.runtime_retry_prior_attempt_count is distinct from prior_attempt_count
      or new.runtime_retry_prior_attempt_history_digest
           is distinct from prior_attempt_history_digest
      or new.runtime_retried_at <= old.runtime_retried_at
      or new.runtime_retried_at < old.expires_at
      or new.expires_at <= new.runtime_retried_at + interval '60 seconds'
      or new.expires_at > new.runtime_retried_at + interval '12 hours'
      or new.expires_at > new.submitted_at + interval '36 hours'
      or (
        pg_catalog.to_jsonb(new) - array[
          'expires_at',
          'runtime_retry_request_digest',
          'runtime_retry_prior_attempt_count',
          'runtime_retry_prior_attempt_history_digest',
          'runtime_retried_at'
        ]::text[]
      ) is distinct from (
        pg_catalog.to_jsonb(old) - array[
          'expires_at',
          'runtime_retry_request_digest',
          'runtime_retry_prior_attempt_count',
          'runtime_retry_prior_attempt_history_digest',
          'runtime_retried_at'
        ]::text[]
      )
      or prior_attempt_count not between 1 and 99
      or exists (
        select 1 from app.private_telebirr_shadow_verification_attempts attempt
         where attempt.shadow_proof_request_id = old.id
           and attempt.expires_at > new.runtime_retried_at
      )
      or exists (
        select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
         where receipt.shadow_proof_request_id = old.id
      )
      or exists (
        select 1 from app.private_telebirr_shadow_verification_outcomes outcome
         where outcome.shadow_proof_request_id = old.id
      )
      or exists (
        select 1
          from app.private_telebirr_shadow_device_evidence_staging staged
          join app.private_telebirr_shadow_verification_attempts attempt
            on attempt.id = staged.verification_attempt_id
         where attempt.shadow_proof_request_id = old.id
      )
      or exists (
        select 1
          from app.private_telebirr_shadow_evidence_quarantine quarantine
          join app.private_telebirr_shadow_verification_attempts attempt
            on attempt.id = quarantine.verification_attempt_id
         where attempt.shadow_proof_request_id = old.id
      ) then
      raise exception 'Private TeleBirr shadow runtime refresh is not immutable.';
    end if;

    expected_digest := app.private_telebirr_shadow_runtime_retry_digest(
      new.runtime_retry_request_key,
      new.id,
      new.verification_job_id,
      new.source_live_verification_job_id,
      new.source_live_proof_id,
      new.source_pilot_revision_id,
      new.source_receiver_profile_id,
      new.recovery_request_digest,
      new.retry_request_digest,
      new.infrastructure_retry_request_digest,
      new.pilot_revision_id,
      new.receiver_profile_id,
      new.pilot_configuration_digest,
      new.runtime_retry_original_expires_at,
      new.runtime_retried_at,
      new.expires_at,
      new.runtime_retry_prior_attempt_count,
      new.runtime_retry_prior_attempt_history_digest,
      new.runtime_retry_reason_code
    );
    if new.runtime_retry_request_digest is distinct from expected_digest then
      raise exception 'The shadow runtime refresh digest does not match.';
    end if;
    return new;
  end if;

$branch$;
begin
  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(
       definition,
       '''app.private_telebirr_shadow_runtime_retry'', true'
     ) > 0 then
    null;
  elsif (
    pg_catalog.length(definition) -
    pg_catalog.length(pg_catalog.replace(definition, needle, ''))
  ) / pg_catalog.length(needle) = 1 then
    execute pg_catalog.replace(definition, needle, branch || needle);
  else
    raise exception 'The TeleBirr shadow runtime retry trigger is not the reviewed shape.';
  end if;
end;
$migration$;

create or replace function app.refresh_private_telebirr_shadow_runtime_retry(
  p_shadow_proof_request_id uuid,
  p_source_live_verification_job_id uuid,
  p_target_pilot_revision_id uuid,
  p_runtime_retry_request_key uuid,
  p_reason_code text
)
returns table (
  shadow_proof_request_id uuid,
  shadow_verification_job_id uuid,
  retry_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authorized_at timestamptz;
  request app.private_telebirr_shadow_proof_requests%rowtype;
  updated_request app.private_telebirr_shadow_proof_requests%rowtype;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  locked_switch_count integer;
  prior_attempt_count integer;
  prior_attempt_history_digest text;
  retry_until timestamptz;
  retry_digest text;
begin
  if session_user <> 'postgres'
    or p_shadow_proof_request_id is null
    or p_source_live_verification_job_id is null
    or p_target_pilot_revision_id is null
    or p_runtime_retry_request_key is null
    or p_runtime_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from
       'expired_shadow_runtime_startup_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The shadow runtime refresh request is invalid.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();
  perform switch.feature_key
    from app.feature_switches switch
   where switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   )
   order by switch.feature_key
   for share;
  get diagnostics locked_switch_count = row_count;

  select candidate.* into request
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = p_shadow_proof_request_id
     and candidate.source_live_verification_job_id = p_source_live_verification_job_id
     and candidate.pilot_revision_id = p_target_pilot_revision_id
     and candidate.runtime_retry_request_key = p_runtime_retry_request_key
   for update;

  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  select job.* into source_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = p_source_live_verification_job_id
   for share;
  select proof.* into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = request.source_live_proof_id
   for key share;
  select pilot.* into target_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_target_pilot_revision_id;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = request.receiver_profile_id
   for share;
  select pg_catalog.count(*)::integer,
         app.private_telebirr_shadow_retry_attempt_history_digest(request.id)
    into prior_attempt_count, prior_attempt_history_digest
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = request.id;

  if locked_switch_count <> 7
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or not app.private_telebirr_shadow_mode_is_ready(target_pilot.id)
    or request.id is null
    or request.proof_status <> 'verification_queued'
    or request.expires_at > authorized_at
    or request.runtime_retry_reason_code is distinct from p_reason_code
    or source_job.id is null
    or source_proof.id is null
    or target_pilot.id is null
    or target_profile.id is null
    or source_job.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or target_pilot.status <> 'armed'
    or target_pilot.expires_at <= authorized_at + interval '10 minutes'
    or target_profile.valid_until <= authorized_at + interval '10 minutes'
    or source_proof.submitted_at + interval '36 hours'
         <= authorized_at + interval '10 minutes'
    or prior_attempt_count not between 1 and 99
    or prior_attempt_history_digest is null
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_device_enrollments enrollment
          join app.private_live_telebirr_device_enrollment_certificates certificate
            on certificate.device_enrollment_id = enrollment.id
         where enrollment.pilot_revision_id = target_pilot.id
           and enrollment.valid_from <= authorized_at
           and enrollment.valid_until > authorized_at + interval '10 minutes'
           and not exists (
             select 1 from app.private_live_telebirr_device_revocations revocation
              where revocation.device_enrollment_id = enrollment.id
           )) <> 1
    or exists (
      select 1 from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = request.id
         and attempt.expires_at > authorized_at
    )
    or exists (
      select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = request.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = request.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_device_evidence_staging staged
      join app.private_telebirr_shadow_verification_attempts attempt
        on attempt.id = staged.verification_attempt_id
       where attempt.shadow_proof_request_id = request.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_evidence_quarantine quarantine
      join app.private_telebirr_shadow_verification_attempts attempt
        on attempt.id = quarantine.verification_attempt_id
       where attempt.shadow_proof_request_id = request.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verification_attempts attempt
       where attempt.verification_job_id = source_job.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = source_job.id
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = source_proof.id
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = source_proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             source_proof.candidate_reference_fingerprint
    ) then
    raise exception 'The shadow runtime refresh is not safely review-only.';
  end if;

  retry_until := least(
    authorized_at + interval '12 hours',
    target_pilot.expires_at,
    target_profile.valid_until,
    source_proof.submitted_at + interval '36 hours'
  );
  retry_digest := app.private_telebirr_shadow_runtime_retry_digest(
    request.runtime_retry_request_key, request.id, request.verification_job_id,
    request.source_live_verification_job_id, request.source_live_proof_id,
    request.source_pilot_revision_id, request.source_receiver_profile_id,
    request.recovery_request_digest, request.retry_request_digest,
    request.infrastructure_retry_request_digest, request.pilot_revision_id,
    request.receiver_profile_id, request.pilot_configuration_digest,
    request.runtime_retry_original_expires_at, authorized_at, retry_until,
    prior_attempt_count, prior_attempt_history_digest,
    request.runtime_retry_reason_code
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_runtime_retry', 'refresh', true
  );
  update app.private_telebirr_shadow_proof_requests candidate
     set expires_at = retry_until,
         runtime_retry_request_digest = retry_digest,
         runtime_retry_prior_attempt_count = prior_attempt_count,
         runtime_retry_prior_attempt_history_digest = prior_attempt_history_digest,
         runtime_retried_at = authorized_at
   where candidate.id = request.id
     and candidate.runtime_retry_request_key = p_runtime_retry_request_key
     and candidate.expires_at <= authorized_at
  returning * into updated_request;
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_runtime_retry', 'off', true
  );

  if updated_request.id is null then
    raise exception 'The shadow runtime refresh changed before commit.';
  end if;
  return query select updated_request.id, updated_request.verification_job_id,
                      updated_request.expires_at;
end;
$$;

alter function app.refresh_private_telebirr_shadow_runtime_retry(
  uuid, uuid, uuid, uuid, text
) owner to postgres;
revoke all on function app.refresh_private_telebirr_shadow_runtime_retry(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

comment on function app.refresh_private_telebirr_shadow_runtime_retry(
  uuid, uuid, uuid, uuid, text
) is 'Refreshes only an expired, evidence-free, no-money TeleBirr shadow review with the same runtime idempotency key. It cannot create live attempts, outcomes, reservations, credits, settlement, execution, or money movement.';
