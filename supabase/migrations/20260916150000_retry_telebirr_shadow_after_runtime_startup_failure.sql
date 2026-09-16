-- One final recovery of the same retained no-money TeleBirr shadow request after the bounded
-- verifier runtime failed to become ready. Prior expired phone assignments are retained and
-- cryptographically bound. The transition can only extend the review-only request on the same
-- armed dry-run pilot; it cannot create evidence, credit, settlement, execution, or money authority.

begin;

alter table app.private_telebirr_shadow_proof_requests
  drop constraint private_telebirr_shadow_proof_window_check;

alter table app.private_telebirr_shadow_proof_requests
  add column runtime_retry_request_key uuid,
  add column runtime_retry_request_digest text,
  add column runtime_retry_reason_code text,
  add column runtime_retry_original_expires_at timestamptz,
  add column runtime_retry_prior_attempt_count integer,
  add column runtime_retry_prior_attempt_history_digest text,
  add column runtime_retried_at timestamptz,
  add constraint private_tbirr_shadow_runtime_retry_key_v4_check check (
    runtime_retry_request_key is null
    or runtime_retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint private_tbirr_shadow_runtime_retry_digest_check check (
    runtime_retry_request_digest is null
    or runtime_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint private_tbirr_shadow_runtime_retry_reason_check check (
    runtime_retry_reason_code is null
    or runtime_retry_reason_code = 'expired_shadow_runtime_startup_retry_no_credit'
  ),
  add constraint private_tbirr_shadow_runtime_attempt_count_check check (
    runtime_retry_prior_attempt_count is null
    or runtime_retry_prior_attempt_count between 1 and 99
  ),
  add constraint private_tbirr_shadow_runtime_attempt_digest_check check (
    runtime_retry_prior_attempt_history_digest is null
    or runtime_retry_prior_attempt_history_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint private_telebirr_shadow_proof_window_check check (
    not_before = submitted_at
    and expires_at > not_before
    and (
      (
        source_live_verification_job_id is null
        and source_live_proof_id is null
        and source_pilot_revision_id is null
        and source_receiver_profile_id is null
        and original_expires_at is null
        and recovered_at is null
        and recovery_request_key is null
        and recovery_request_digest is null
        and recovery_reason_code is null
        and retry_request_key is null
        and retry_request_digest is null
        and retry_reason_code is null
        and retry_prior_pilot_revision_id is null
        and retry_prior_receiver_profile_id is null
        and retry_prior_configuration_digest is null
        and retry_original_expires_at is null
        and retried_at is null
        and infrastructure_retry_request_key is null
        and infrastructure_retry_request_digest is null
        and infrastructure_retry_reason_code is null
        and infrastructure_retry_original_expires_at is null
        and infrastructure_retried_at is null
        and runtime_retry_request_key is null
        and runtime_retry_request_digest is null
        and runtime_retry_reason_code is null
        and runtime_retry_original_expires_at is null
        and runtime_retry_prior_attempt_count is null
        and runtime_retry_prior_attempt_history_digest is null
        and runtime_retried_at is null
        and expires_at <= submitted_at + interval '5 minutes'
      )
      or (
        source_live_verification_job_id is not null
        and source_live_proof_id is not null
        and source_pilot_revision_id is not null
        and source_receiver_profile_id is not null
        and original_expires_at is not null
        and recovered_at is not null
        and recovery_request_key is not null
        and recovery_request_digest is not null
        and recovery_reason_code = 'expired_pilot_recovery_no_credit'
        and source_pilot_revision_id <> pilot_revision_id
        and original_expires_at > submitted_at
        and original_expires_at <= submitted_at + interval '5 minutes'
        and recovered_at >= original_expires_at
        and recovered_at < submitted_at + interval '24 hours'
        and (
          (
            retry_request_key is null
            and retry_request_digest is null
            and retry_reason_code is null
            and retry_prior_pilot_revision_id is null
            and retry_prior_receiver_profile_id is null
            and retry_prior_configuration_digest is null
            and retry_original_expires_at is null
            and retried_at is null
            and infrastructure_retry_request_key is null
            and infrastructure_retry_request_digest is null
            and infrastructure_retry_reason_code is null
            and infrastructure_retry_original_expires_at is null
            and infrastructure_retried_at is null
            and runtime_retry_request_key is null
            and runtime_retry_request_digest is null
            and runtime_retry_reason_code is null
            and runtime_retry_original_expires_at is null
            and runtime_retry_prior_attempt_count is null
            and runtime_retry_prior_attempt_history_digest is null
            and runtime_retried_at is null
            and expires_at > recovered_at + interval '60 seconds'
            and expires_at <= recovered_at + interval '5 minutes'
          )
          or (
            retry_request_key is not null
            and retry_request_digest is not null
            and retry_reason_code = 'expired_shadow_retry_no_credit'
            and retry_prior_pilot_revision_id is not null
            and retry_prior_receiver_profile_id is not null
            and retry_prior_configuration_digest is not null
            and retry_prior_configuration_digest ~ '^sha256:[0-9a-f]{64}$'
            and retry_original_expires_at is not null
            and retried_at is not null
            and retry_prior_pilot_revision_id <> pilot_revision_id
            and retry_prior_receiver_profile_id <> receiver_profile_id
            and source_pilot_revision_id <> retry_prior_pilot_revision_id
            and retry_original_expires_at > recovered_at + interval '60 seconds'
            and retry_original_expires_at <= recovered_at + interval '5 minutes'
            and retried_at >= retry_original_expires_at
            and retried_at < submitted_at + interval '24 hours'
            and (
              (
                infrastructure_retry_request_key is null
                and infrastructure_retry_request_digest is null
                and infrastructure_retry_reason_code is null
                and infrastructure_retry_original_expires_at is null
                and infrastructure_retried_at is null
                and runtime_retry_request_key is null
                and runtime_retry_request_digest is null
                and runtime_retry_reason_code is null
                and runtime_retry_original_expires_at is null
                and runtime_retry_prior_attempt_count is null
                and runtime_retry_prior_attempt_history_digest is null
                and runtime_retried_at is null
                and expires_at > retried_at + interval '60 seconds'
                and expires_at <= retried_at + interval '5 minutes'
              )
              or (
                infrastructure_retry_request_key is not null
                and infrastructure_retry_request_digest is not null
                and infrastructure_retry_reason_code =
                    'expired_shadow_infrastructure_retry_no_credit'
                and infrastructure_retry_original_expires_at is not null
                and infrastructure_retried_at is not null
                and infrastructure_retry_original_expires_at >
                    retried_at + interval '60 seconds'
                and infrastructure_retry_original_expires_at <=
                    retried_at + interval '5 minutes'
                and infrastructure_retried_at >= infrastructure_retry_original_expires_at
                and infrastructure_retried_at < submitted_at + interval '24 hours'
                and (
                  (
                    runtime_retry_request_key is null
                    and runtime_retry_request_digest is null
                    and runtime_retry_reason_code is null
                    and runtime_retry_original_expires_at is null
                    and runtime_retry_prior_attempt_count is null
                    and runtime_retry_prior_attempt_history_digest is null
                    and runtime_retried_at is null
                    and expires_at > infrastructure_retried_at + interval '60 seconds'
                    and expires_at <= infrastructure_retried_at + interval '5 minutes'
                  )
                  or (
                    runtime_retry_request_key is not null
                    and runtime_retry_request_digest is not null
                    and runtime_retry_reason_code =
                        'expired_shadow_runtime_startup_retry_no_credit'
                    and runtime_retry_original_expires_at is not null
                    and runtime_retry_prior_attempt_count between 1 and 99
                    and runtime_retry_prior_attempt_history_digest is not null
                    and runtime_retried_at is not null
                    and runtime_retry_original_expires_at >
                        infrastructure_retried_at + interval '60 seconds'
                    and runtime_retry_original_expires_at <=
                        infrastructure_retried_at + interval '5 minutes'
                    and runtime_retried_at >= runtime_retry_original_expires_at
                    and runtime_retried_at < submitted_at + interval '24 hours'
                    and expires_at > runtime_retried_at + interval '60 seconds'
                    and expires_at <= runtime_retried_at + interval '12 hours'
                    and expires_at <= submitted_at + interval '24 hours'
                  )
                )
              )
            )
          )
        )
      )
    )
  );

create unique index private_tbirr_shadow_runtime_retry_key_idx
  on app.private_telebirr_shadow_proof_requests (runtime_retry_request_key)
  where runtime_retry_request_key is not null;
create unique index private_tbirr_shadow_runtime_retry_digest_idx
  on app.private_telebirr_shadow_proof_requests (runtime_retry_request_digest)
  where runtime_retry_request_digest is not null;

create function app.private_telebirr_shadow_retry_attempt_history_digest(
  p_shadow_proof_request_id uuid
)
returns text
language sql
security definer
set search_path = pg_catalog
as $$
  select case when pg_catalog.count(*) = 0 then null else
    app.private_live_deposit_pilot_sha256(
      pg_catalog.string_agg(
        'attempt_number=' || attempt.attempt_number::text
          || '|attempt_id=' || attempt.id::text
          || '|lease_request_digest=' || attempt.lease_request_digest
          || '|request_id=' || attempt.request_id::text
          || '|assignment_id=' || attempt.assignment_id::text
          || '|device_enrollment_id=' || attempt.device_enrollment_id::text
          || '|issued_at_us=' || (
            pg_catalog.extract(epoch from attempt.issued_at) * 1000000
          )::bigint::text
          || '|expires_at_us=' || (
            pg_catalog.extract(epoch from attempt.expires_at) * 1000000
          )::bigint::text,
        E'\n' order by attempt.attempt_number, attempt.id
      )
    )
  end
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = p_shadow_proof_request_id;
$$;

create function app.private_telebirr_shadow_runtime_retry_digest(
  p_runtime_retry_request_key uuid,
  p_shadow_proof_request_id uuid,
  p_shadow_verification_job_id uuid,
  p_source_live_verification_job_id uuid,
  p_source_live_proof_id uuid,
  p_source_pilot_revision_id uuid,
  p_source_receiver_profile_id uuid,
  p_recovery_request_digest text,
  p_retry_request_digest text,
  p_infrastructure_retry_request_digest text,
  p_target_pilot_revision_id uuid,
  p_target_receiver_profile_id uuid,
  p_target_configuration_digest text,
  p_original_retry_expires_at timestamptz,
  p_runtime_retried_at timestamptz,
  p_runtime_retry_expires_at timestamptz,
  p_prior_attempt_count integer,
  p_prior_attempt_history_digest text,
  p_reason_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_runtime_retry_request_key is null
    or p_shadow_proof_request_id is null
    or p_shadow_verification_job_id is null
    or p_source_live_verification_job_id is null
    or p_source_live_proof_id is null
    or p_source_pilot_revision_id is null
    or p_source_receiver_profile_id is null
    or p_recovery_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_retry_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_infrastructure_retry_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_target_pilot_revision_id is null
    or p_target_receiver_profile_id is null
    or p_target_configuration_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_original_retry_expires_at is null
    or p_runtime_retried_at is null
    or p_runtime_retry_expires_at is null
    or p_prior_attempt_count not between 1 and 99
    or p_prior_attempt_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reason_code is distinct from
       'expired_shadow_runtime_startup_retry_no_credit' then
    raise exception 'The shadow runtime-startup retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:expired-shadow:runtime-startup-retry:v1'
      || '|request_key=' || p_runtime_retry_request_key::text
      || '|shadow_proof_request_id=' || p_shadow_proof_request_id::text
      || '|shadow_verification_job_id=' || p_shadow_verification_job_id::text
      || '|source_live_job_id=' || p_source_live_verification_job_id::text
      || '|source_live_proof_id=' || p_source_live_proof_id::text
      || '|source_pilot_revision_id=' || p_source_pilot_revision_id::text
      || '|source_receiver_profile_id=' || p_source_receiver_profile_id::text
      || '|recovery_request_digest=' || p_recovery_request_digest
      || '|retry_request_digest=' || p_retry_request_digest
      || '|infrastructure_retry_request_digest=' || p_infrastructure_retry_request_digest
      || '|target_pilot_revision_id=' || p_target_pilot_revision_id::text
      || '|target_receiver_profile_id=' || p_target_receiver_profile_id::text
      || '|target_configuration_digest=' || p_target_configuration_digest
      || '|original_retry_expires_at_us=' || (
        pg_catalog.extract(epoch from p_original_retry_expires_at) * 1000000
      )::bigint::text
      || '|runtime_retried_at_us=' || (
        pg_catalog.extract(epoch from p_runtime_retried_at) * 1000000
      )::bigint::text
      || '|runtime_retry_expires_at_us=' || (
        pg_catalog.extract(epoch from p_runtime_retry_expires_at) * 1000000
      )::bigint::text
      || '|prior_attempt_count=' || p_prior_attempt_count::text
      || '|prior_attempt_history_digest=' || p_prior_attempt_history_digest
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.enforce_private_telebirr_shadow_runtime_retry_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  expected_digest text;
  prior_attempt_count integer;
  prior_attempt_history_digest text;
begin
  select pg_catalog.count(*)::integer,
         app.private_telebirr_shadow_retry_attempt_history_digest(old.id)
    into prior_attempt_count, prior_attempt_history_digest
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = old.id;

  if tg_op <> 'UPDATE'
    or session_user <> 'postgres'
    or pg_catalog.current_setting(
         'app.private_telebirr_shadow_runtime_retry', true
       ) is distinct from 'on'
    or old.source_live_verification_job_id is null
    or old.source_live_proof_id is null
    or old.source_pilot_revision_id is null
    or old.source_receiver_profile_id is null
    or old.recovery_request_key is null
    or old.recovery_request_digest is null
    or old.recovery_reason_code is distinct from 'expired_pilot_recovery_no_credit'
    or old.retry_request_key is null
    or old.retry_request_digest is null
    or old.retry_reason_code is distinct from 'expired_shadow_retry_no_credit'
    or old.infrastructure_retry_request_key is null
    or old.infrastructure_retry_request_digest is null
    or old.infrastructure_retry_reason_code is distinct from
       'expired_shadow_infrastructure_retry_no_credit'
    or old.runtime_retry_request_key is not null
    or old.runtime_retry_request_digest is not null
    or old.runtime_retry_reason_code is not null
    or old.runtime_retry_original_expires_at is not null
    or old.runtime_retry_prior_attempt_count is not null
    or old.runtime_retry_prior_attempt_history_digest is not null
    or old.runtime_retried_at is not null
    or old.expires_at > pg_catalog.clock_timestamp()
    or new.runtime_retry_request_key is null
    or new.runtime_retry_request_digest is null
    or new.runtime_retry_reason_code is distinct from
       'expired_shadow_runtime_startup_retry_no_credit'
    or new.runtime_retry_original_expires_at is distinct from old.expires_at
    or new.runtime_retry_prior_attempt_count is distinct from prior_attempt_count
    or new.runtime_retry_prior_attempt_history_digest
         is distinct from prior_attempt_history_digest
    or new.runtime_retried_at is null
    or new.runtime_retried_at < old.expires_at
    or new.expires_at <= new.runtime_retried_at + interval '60 seconds'
    or new.expires_at > new.runtime_retried_at + interval '12 hours'
    or new.expires_at > new.submitted_at + interval '24 hours'
    or (
      pg_catalog.to_jsonb(new) - array[
        'expires_at',
        'runtime_retry_request_key',
        'runtime_retry_request_digest',
        'runtime_retry_reason_code',
        'runtime_retry_original_expires_at',
        'runtime_retry_prior_attempt_count',
        'runtime_retry_prior_attempt_history_digest',
        'runtime_retried_at'
      ]::text[]
    ) is distinct from (
      pg_catalog.to_jsonb(old) - array[
        'expires_at',
        'runtime_retry_request_key',
        'runtime_retry_request_digest',
        'runtime_retry_reason_code',
        'runtime_retry_original_expires_at',
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
    raise exception 'Private TeleBirr shadow lineage is immutable.';
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
    raise exception 'The shadow runtime-startup retry digest does not match.';
  end if;

  return new;
end;
$$;

drop trigger private_telebirr_shadow_proofs_infrastructure_retry_only
  on app.private_telebirr_shadow_proof_requests;
create trigger private_telebirr_shadow_proofs_infrastructure_retry_only
before update on app.private_telebirr_shadow_proof_requests
for each row
when (
  old.retry_request_key is not null
  and old.infrastructure_retry_request_key is null
)
execute function app.enforce_private_telebirr_shadow_infrastructure_retry_only();
create trigger private_telebirr_shadow_proofs_runtime_retry_only
before update on app.private_telebirr_shadow_proof_requests
for each row
when (old.infrastructure_retry_request_key is not null)
execute function app.enforce_private_telebirr_shadow_runtime_retry_only();

create function app.retry_expired_private_telebirr_shadow_after_runtime_startup_failure(
  p_shadow_proof_request_id uuid,
  p_source_live_verification_job_id uuid,
  p_target_pilot_revision_id uuid,
  p_runtime_retry_request_key uuid,
  p_reason_code text
)
returns table (
  shadow_proof_request_id uuid,
  shadow_verification_job_id uuid,
  retry_expires_at timestamptz,
  already_retried boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authorized_at timestamptz;
  seed app.private_telebirr_shadow_proof_requests%rowtype;
  shadow_request app.private_telebirr_shadow_proof_requests%rowtype;
  updated_request app.private_telebirr_shadow_proof_requests%rowtype;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  source_proof app.private_live_deposit_pilot_proofs%rowtype;
  source_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_pilot app.private_live_deposit_pilot_revisions%rowtype;
  target_profile app.private_live_telebirr_receiver_profiles%rowtype;
  locked_switch_count integer;
  retry_until timestamptz;
  runtime_retry_digest text;
  initial_recovery_digest text;
  first_retry_digest text;
  infrastructure_retry_digest text;
  prior_attempt_count integer;
  prior_attempt_history_digest text;
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
    raise exception 'The shadow runtime-startup no-credit retry request is invalid.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification',
     'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for share;
  get diagnostics locked_switch_count = row_count;

  select candidate.*
    into seed
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = p_shadow_proof_request_id
      or candidate.runtime_retry_request_key = p_runtime_retry_request_key
   order by candidate.created_at, candidate.id
   limit 1;

  perform pilot_revision.id
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id in (
     seed.source_pilot_revision_id,
     seed.pilot_revision_id,
     p_target_pilot_revision_id
   )
   order by pilot_revision.id
   for share;

  select candidate.*
    into shadow_request
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = p_shadow_proof_request_id
      or candidate.runtime_retry_request_key = p_runtime_retry_request_key
   order by candidate.created_at, candidate.id
   limit 1
   for update;

  if shadow_request.id is null then
    raise exception 'The expired shadow request is unavailable.';
  end if;

  if shadow_request.runtime_retry_request_key is not null then
    runtime_retry_digest := app.private_telebirr_shadow_runtime_retry_digest(
      shadow_request.runtime_retry_request_key,
      shadow_request.id,
      shadow_request.verification_job_id,
      shadow_request.source_live_verification_job_id,
      shadow_request.source_live_proof_id,
      shadow_request.source_pilot_revision_id,
      shadow_request.source_receiver_profile_id,
      shadow_request.recovery_request_digest,
      shadow_request.retry_request_digest,
      shadow_request.infrastructure_retry_request_digest,
      shadow_request.pilot_revision_id,
      shadow_request.receiver_profile_id,
      shadow_request.pilot_configuration_digest,
      shadow_request.runtime_retry_original_expires_at,
      shadow_request.runtime_retried_at,
      shadow_request.expires_at,
      shadow_request.runtime_retry_prior_attempt_count,
      shadow_request.runtime_retry_prior_attempt_history_digest,
      shadow_request.runtime_retry_reason_code
    );

    if shadow_request.id is distinct from p_shadow_proof_request_id
      or shadow_request.source_live_verification_job_id
           is distinct from p_source_live_verification_job_id
      or shadow_request.pilot_revision_id is distinct from p_target_pilot_revision_id
      or shadow_request.runtime_retry_request_key
           is distinct from p_runtime_retry_request_key
      or shadow_request.runtime_retry_reason_code is distinct from p_reason_code
      or shadow_request.runtime_retry_request_digest
           is distinct from runtime_retry_digest then
      raise exception 'The shadow runtime-startup no-credit retry replay conflicts.';
    end if;

    return query
    select shadow_request.id,
           shadow_request.verification_job_id,
           shadow_request.expires_at,
           true;
    return;
  end if;

  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select job.* into source_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = p_source_live_verification_job_id
   for share;
  select proof.* into source_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = shadow_request.source_live_proof_id
   for key share;
  select pilot.* into source_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = shadow_request.source_pilot_revision_id;
  select pilot.* into target_pilot
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_target_pilot_revision_id;
  select profile.* into target_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = shadow_request.receiver_profile_id
   for share;

  initial_recovery_digest := app.private_telebirr_expired_pilot_shadow_recovery_digest(
    shadow_request.recovery_request_key,
    shadow_request.source_live_verification_job_id,
    shadow_request.source_live_proof_id,
    shadow_request.source_pilot_revision_id,
    shadow_request.source_receiver_profile_id,
    shadow_request.retry_prior_pilot_revision_id,
    shadow_request.retry_prior_receiver_profile_id,
    shadow_request.id,
    shadow_request.verification_job_id,
    shadow_request.original_expires_at,
    shadow_request.recovered_at,
    shadow_request.retry_original_expires_at,
    shadow_request.recovery_reason_code
  );

  first_retry_digest := app.private_telebirr_expired_shadow_retry_digest(
    shadow_request.retry_request_key,
    shadow_request.id,
    shadow_request.verification_job_id,
    shadow_request.source_live_verification_job_id,
    shadow_request.source_live_proof_id,
    shadow_request.source_pilot_revision_id,
    shadow_request.source_receiver_profile_id,
    shadow_request.retry_prior_pilot_revision_id,
    shadow_request.retry_prior_receiver_profile_id,
    shadow_request.retry_prior_configuration_digest,
    shadow_request.pilot_revision_id,
    shadow_request.receiver_profile_id,
    shadow_request.pilot_configuration_digest,
    shadow_request.retry_original_expires_at,
    shadow_request.retried_at,
    shadow_request.infrastructure_retry_original_expires_at,
    shadow_request.retry_reason_code
  );

  infrastructure_retry_digest := app.private_telebirr_shadow_infrastructure_retry_digest(
    shadow_request.infrastructure_retry_request_key,
    shadow_request.id,
    shadow_request.verification_job_id,
    shadow_request.source_live_verification_job_id,
    shadow_request.source_live_proof_id,
    shadow_request.source_pilot_revision_id,
    shadow_request.source_receiver_profile_id,
    shadow_request.recovery_request_digest,
    shadow_request.retry_request_digest,
    shadow_request.pilot_revision_id,
    shadow_request.receiver_profile_id,
    shadow_request.pilot_configuration_digest,
    shadow_request.infrastructure_retry_original_expires_at,
    shadow_request.infrastructure_retried_at,
    shadow_request.expires_at,
    shadow_request.infrastructure_retry_reason_code
  );

  select pg_catalog.count(*)::integer,
         app.private_telebirr_shadow_retry_attempt_history_digest(shadow_request.id)
    into prior_attempt_count, prior_attempt_history_digest
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = shadow_request.id;

  if locked_switch_count <> 7
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or not app.private_telebirr_shadow_mode_is_ready(target_pilot.id)
    or shadow_request.id is distinct from p_shadow_proof_request_id
    or shadow_request.source_live_verification_job_id
         is distinct from p_source_live_verification_job_id
    or shadow_request.pilot_revision_id is distinct from p_target_pilot_revision_id
    or shadow_request.recovery_reason_code
         is distinct from 'expired_pilot_recovery_no_credit'
    or shadow_request.retry_reason_code
         is distinct from 'expired_shadow_retry_no_credit'
    or shadow_request.infrastructure_retry_reason_code
         is distinct from 'expired_shadow_infrastructure_retry_no_credit'
    or shadow_request.recovery_request_digest is distinct from initial_recovery_digest
    or shadow_request.retry_request_digest is distinct from first_retry_digest
    or shadow_request.infrastructure_retry_request_digest
         is distinct from infrastructure_retry_digest
    or shadow_request.expires_at > authorized_at
    or prior_attempt_count not between 1 and 99
    or prior_attempt_history_digest is null
    or source_job.id is null
    or source_proof.id is null
    or source_pilot.id is null
    or target_pilot.id is null
    or target_profile.id is null
    or source_pilot.status <> 'stopped'
    or target_pilot.status <> 'armed'
    or authorized_at < target_pilot.active_from
    or target_pilot.expires_at <= authorized_at + interval '10 minutes'
    or target_profile.pilot_revision_id is distinct from target_pilot.id
    or target_profile.pilot_configuration_digest is distinct from
       target_pilot.configuration_digest
    or target_profile.valid_from > authorized_at
    or target_profile.valid_until <= authorized_at + interval '10 minutes'
    or authorized_at >= source_proof.submitted_at + interval '24 hours'
    or source_job.private_live_deposit_pilot_proof_id is distinct from source_proof.id
    or source_job.pilot_revision_id is distinct from source_pilot.id
    or source_job.receiver_profile_id is distinct from
       shadow_request.source_receiver_profile_id
    or source_job.submitting_customer_id is distinct from
       shadow_request.submitting_customer_id
    or source_job.player_account_id is distinct from shadow_request.player_account_id
    or source_job.payment_provider_id is distinct from shadow_request.payment_provider_id
    or source_job.candidate_reference_fingerprint is distinct from
       shadow_request.candidate_reference_fingerprint
    or source_proof.candidate_reference_ciphertext is distinct from
       shadow_request.candidate_reference_ciphertext
    or source_proof.candidate_reference_fingerprint is distinct from
       shadow_request.candidate_reference_fingerprint
    or source_proof.candidate_reference_masked is distinct from
       shadow_request.candidate_reference_masked
    or shadow_request.provider_code <> 'telebirr'
    or shadow_request.proof_status <> 'verification_queued'
    or not exists (
      select 1 from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = target_pilot.id
         and member.customer_id = shadow_request.submitting_customer_id
    )
    or not exists (
      select 1 from app.private_live_deposit_pilot_players member
       where member.pilot_revision_id = target_pilot.id
         and member.player_account_id = shadow_request.player_account_id
    )
    or not exists (
      select 1 from app.private_live_deposit_pilot_providers member
       where member.pilot_revision_id = target_pilot.id
         and member.payment_provider_id = shadow_request.payment_provider_id
         and member.receiver_account_id = source_job.receiver_account_id
         and member.receiver_account_version = source_job.receiver_account_version
         and member.provider_code_snapshot = 'telebirr'
    )
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
      select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = shadow_request.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = shadow_request.id
         and attempt.expires_at > authorized_at
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = shadow_request.id
    )
    or exists (
      select 1
        from app.private_telebirr_shadow_device_evidence_staging staged
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
       where attempt.shadow_proof_request_id = shadow_request.id
    )
    or exists (
      select 1
        from app.private_telebirr_shadow_evidence_quarantine quarantine
        join app.private_telebirr_shadow_verification_attempts attempt
          on attempt.id = quarantine.verification_attempt_id
       where attempt.shadow_proof_request_id = shadow_request.id
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
    raise exception 'The shadow request is not safely retryable after runtime startup failure.';
  end if;

  retry_until := pg_catalog.least(
    authorized_at + interval '12 hours',
    target_pilot.expires_at,
    target_profile.valid_until,
    source_proof.submitted_at + interval '24 hours'
  );
  if retry_until <= authorized_at + interval '10 minutes' then
    raise exception 'The shadow runtime-startup no-credit retry window is unavailable.';
  end if;

  runtime_retry_digest := app.private_telebirr_shadow_runtime_retry_digest(
    p_runtime_retry_request_key,
    shadow_request.id,
    shadow_request.verification_job_id,
    shadow_request.source_live_verification_job_id,
    shadow_request.source_live_proof_id,
    shadow_request.source_pilot_revision_id,
    shadow_request.source_receiver_profile_id,
    shadow_request.recovery_request_digest,
    shadow_request.retry_request_digest,
    shadow_request.infrastructure_retry_request_digest,
    shadow_request.pilot_revision_id,
    shadow_request.receiver_profile_id,
    shadow_request.pilot_configuration_digest,
    shadow_request.expires_at,
    authorized_at,
    retry_until,
    prior_attempt_count,
    prior_attempt_history_digest,
    p_reason_code
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_runtime_retry', 'on', true
  );
  update app.private_telebirr_shadow_proof_requests request
     set expires_at = retry_until,
         runtime_retry_request_key = p_runtime_retry_request_key,
         runtime_retry_request_digest = runtime_retry_digest,
         runtime_retry_reason_code = p_reason_code,
         runtime_retry_original_expires_at = shadow_request.expires_at,
         runtime_retry_prior_attempt_count = prior_attempt_count,
         runtime_retry_prior_attempt_history_digest = prior_attempt_history_digest,
         runtime_retried_at = authorized_at
   where request.id = shadow_request.id
     and request.runtime_retry_request_key is null
     and request.expires_at <= authorized_at
  returning * into updated_request;
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_runtime_retry', 'off', true
  );

  if updated_request.id is null then
    raise exception 'The shadow runtime-startup no-credit retry changed before commit.';
  end if;

  return query
  select updated_request.id,
         updated_request.verification_job_id,
         updated_request.expires_at,
         false;
end;
$$;

alter function app.private_telebirr_shadow_retry_attempt_history_digest(uuid)
  owner to postgres;
alter function app.private_telebirr_shadow_runtime_retry_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text,
  uuid, uuid, text, timestamptz, timestamptz, timestamptz,
  integer, text, text
) owner to postgres;
alter function app.enforce_private_telebirr_shadow_runtime_retry_only()
  owner to postgres;
alter function app.retry_expired_private_telebirr_shadow_after_runtime_startup_failure(
  uuid, uuid, uuid, uuid, text
) owner to postgres;

revoke all on function
  app.private_telebirr_shadow_retry_attempt_history_digest(uuid),
  app.private_telebirr_shadow_runtime_retry_digest(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text,
    uuid, uuid, text, timestamptz, timestamptz, timestamptz,
    integer, text, text
  ),
  app.enforce_private_telebirr_shadow_runtime_retry_only(),
  app.retry_expired_private_telebirr_shadow_after_runtime_startup_failure(
    uuid, uuid, uuid, uuid, text
  )
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

comment on function app.retry_expired_private_telebirr_shadow_after_runtime_startup_failure(
  uuid, uuid, uuid, uuid, text
) is
  'Postgres-only, exactly-once reopening of the same expired TeleBirr shadow request after a bounded runtime-startup failure. Prior expired assignments are retained and bound; no credit or money authority is created.';
comment on function app.private_telebirr_shadow_retry_attempt_history_digest(uuid) is
  'Private canonical digest of the immutable assignment history retained before the one-use runtime-startup recovery.';
comment on function app.private_telebirr_shadow_runtime_retry_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text,
  uuid, uuid, text, timestamptz, timestamptz, timestamptz,
  integer, text, text
) is
  'Private canonical digest binding complete retained live/shadow lineage, the prior retry digests, unchanged dry-run target, retained expired assignments, and the final review-only window.';
comment on function app.enforce_private_telebirr_shadow_runtime_retry_only() is
  'Keeps a twice-retried TeleBirr shadow request immutable except for one fully bound postgres-only runtime-startup recovery window on the unchanged dry-run pilot.';
comment on table app.private_telebirr_shadow_proof_requests is
  'Immutable no-money TeleBirr shadow requests. A request can retain and bind expired assignments for one final runtime-startup recovery only while every live money boundary remains disabled.';

commit;
