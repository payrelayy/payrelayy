-- One-purpose, no-money recovery for a direct TeleBirr shadow proof whose first signed
-- observation was quarantined only because the production verifier assessed an otherwise
-- on-time observation against the later review clock. The quarantine and its signed staging
-- row remain immutable. Recovery only extends the same proof long enough for the paired device
-- to create a fresh attempt under the corrected verifier policy.

create table app.private_telebirr_shadow_policy_recoveries (
  recovery_request_key uuid primary key,
  recovery_request_digest text not null unique
    check (recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  shadow_proof_request_id uuid not null unique,
  shadow_verification_job_id uuid not null,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  quarantined_verification_attempt_id uuid not null unique
    references app.private_telebirr_shadow_verification_attempts (id) on delete restrict,
  quarantined_observation_body_digest text not null unique
    references app.private_telebirr_shadow_evidence_quarantine (observation_body_digest)
      on delete restrict,
  prior_attempt_count integer not null check (prior_attempt_count = 1),
  prior_attempt_history_digest text not null
    check (prior_attempt_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_staged_at timestamptz not null,
  quarantined_at timestamptz not null,
  prior_expires_at timestamptz not null,
  recovered_at timestamptz not null,
  retry_expires_at timestamptz not null,
  reviewed_main_commit_sha text not null
    check (reviewed_main_commit_sha ~ '^[0-9a-f]{40}$'),
  reason_code text not null
    check (reason_code = 'verifier_policy_fix_retry_no_credit'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_tbirr_shadow_policy_recovery_request_v4_check check (
    recovery_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_tbirr_shadow_policy_recovery_window_check check (
    evidence_staged_at <= prior_expires_at
    and quarantined_at >= evidence_staged_at
    and recovered_at >= quarantined_at
    and retry_expires_at > recovered_at + interval '10 minutes'
    and retry_expires_at <= recovered_at + interval '12 hours'
  ),
  constraint private_tbirr_shadow_policy_recovery_proof_job_fkey
    foreign key (shadow_proof_request_id, shadow_verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict
);

create function app.private_telebirr_shadow_policy_recovery_digest(
  p_recovery_request_key uuid,
  p_shadow_proof_request_id uuid,
  p_shadow_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_receiver_profile_id uuid,
  p_quarantined_verification_attempt_id uuid,
  p_quarantined_observation_body_digest text,
  p_prior_attempt_count integer,
  p_prior_attempt_history_digest text,
  p_evidence_staged_at timestamptz,
  p_quarantined_at timestamptz,
  p_prior_expires_at timestamptz,
  p_recovered_at timestamptz,
  p_retry_expires_at timestamptz,
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_recovery_request_key is null
    or p_recovery_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_shadow_proof_request_id is null
    or p_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_receiver_profile_id is null
    or p_quarantined_verification_attempt_id is null
    or p_quarantined_observation_body_digest is null
    or p_quarantined_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_prior_attempt_count is distinct from 1
    or p_prior_attempt_history_digest is null
    or p_prior_attempt_history_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_evidence_staged_at is null
    or p_quarantined_at is null
    or p_prior_expires_at is null
    or p_recovered_at is null
    or p_retry_expires_at is null
    or p_reviewed_main_commit_sha is null
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from 'verifier_policy_fix_retry_no_credit' then
    raise exception 'The TeleBirr shadow policy-recovery digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-policy-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|shadow_proof_request_id=' || p_shadow_proof_request_id::text
      || '|shadow_verification_job_id=' || p_shadow_verification_job_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|receiver_profile_id=' || p_receiver_profile_id::text
      || '|quarantined_verification_attempt_id='
      || p_quarantined_verification_attempt_id::text
      || '|quarantined_observation_body_digest='
      || p_quarantined_observation_body_digest
      || '|prior_attempt_count=' || p_prior_attempt_count::text
      || '|prior_attempt_history_digest=' || p_prior_attempt_history_digest
      || '|evidence_staged_at_us='
      || (extract(epoch from p_evidence_staged_at) * 1000000)::bigint::text
      || '|quarantined_at_us='
      || (extract(epoch from p_quarantined_at) * 1000000)::bigint::text
      || '|prior_expires_at_us='
      || (extract(epoch from p_prior_expires_at) * 1000000)::bigint::text
      || '|recovered_at_us='
      || (extract(epoch from p_recovered_at) * 1000000)::bigint::text
      || '|retry_expires_at_us='
      || (extract(epoch from p_retry_expires_at) * 1000000)::bigint::text
      || '|reviewed_main_commit_sha=' || p_reviewed_main_commit_sha
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.reject_private_telebirr_shadow_policy_recovery_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private TeleBirr shadow policy-recovery lineage is immutable.';
end;
$$;

create trigger private_tbirr_shadow_policy_recoveries_immutable
before update or delete on app.private_telebirr_shadow_policy_recoveries
for each row execute function app.reject_private_telebirr_shadow_policy_recovery_mutation();
create trigger private_tbirr_shadow_policy_recoveries_no_truncate
before truncate on app.private_telebirr_shadow_policy_recoveries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

-- Preserve every pre-existing retry branch byte-for-byte after the early, narrowly scoped
-- policy-recovery branch. The trigger still rejects deletes and every unrecognized mutation.
create or replace function app.enforce_private_telebirr_shadow_proof_retry_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  expected_digest text;
  policy_recovery app.private_telebirr_shadow_policy_recoveries%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'Private TeleBirr shadow lineage is immutable.';
  end if;

  if pg_catalog.current_setting(
       'app.private_telebirr_shadow_policy_recovery', true
     ) = 'on' then
    select recovery.*
      into policy_recovery
      from app.private_telebirr_shadow_policy_recoveries recovery
     where recovery.shadow_proof_request_id = old.id
     for share;

    if tg_op <> 'UPDATE'
      or session_user <> 'postgres'
      or policy_recovery.shadow_proof_request_id is null
      or old.source_live_verification_job_id is not null
      or old.source_live_proof_id is not null
      or old.source_pilot_revision_id is not null
      or old.source_receiver_profile_id is not null
      or old.recovery_request_key is not null
      or old.retry_request_key is not null
      or old.infrastructure_retry_request_key is not null
      or old.runtime_retry_request_key is not null
      or old.expires_at > policy_recovery.recovered_at
      or new.expires_at is distinct from policy_recovery.retry_expires_at
      or policy_recovery.shadow_verification_job_id is distinct from old.verification_job_id
      or policy_recovery.pilot_revision_id is distinct from old.pilot_revision_id
      or policy_recovery.receiver_profile_id is distinct from old.receiver_profile_id
      or policy_recovery.prior_expires_at is distinct from old.expires_at
      or policy_recovery.recovered_at > pg_catalog.clock_timestamp()
      or policy_recovery.retry_expires_at <= policy_recovery.recovered_at + interval '10 minutes'
      or policy_recovery.retry_expires_at > policy_recovery.recovered_at + interval '12 hours'
      or policy_recovery.retry_expires_at > old.submitted_at + interval '12 hours'
      or (pg_catalog.to_jsonb(new) - 'expires_at')
           is distinct from (pg_catalog.to_jsonb(old) - 'expires_at')
      or (select pg_catalog.count(*)
            from app.private_telebirr_shadow_verification_attempts attempt
           where attempt.shadow_proof_request_id = old.id) <> 1
      or not exists (
        select 1
          from app.private_telebirr_shadow_verification_attempts attempt
          join app.private_telebirr_shadow_device_evidence_staging staged
            on staged.verification_attempt_id = attempt.id
          join app.private_telebirr_shadow_evidence_quarantine quarantine
            on quarantine.verification_attempt_id = attempt.id
           and quarantine.observation_body_digest = staged.observation_body_digest
         where attempt.id = policy_recovery.quarantined_verification_attempt_id
           and attempt.shadow_proof_request_id = old.id
           and staged.observation_body_digest =
               policy_recovery.quarantined_observation_body_digest
           and staged.staged_at = policy_recovery.evidence_staged_at
           and quarantine.quarantined_at = policy_recovery.quarantined_at
           and quarantine.reason_code = 'trusted_evidence_invalid'
      )
      or exists (
        select 1 from app.private_telebirr_shadow_verification_outcomes outcome
         where outcome.shadow_proof_request_id = old.id
      ) then
      raise exception 'Private TeleBirr shadow policy recovery is not immutable.';
    end if;

    expected_digest := app.private_telebirr_shadow_policy_recovery_digest(
      policy_recovery.recovery_request_key,
      policy_recovery.shadow_proof_request_id,
      policy_recovery.shadow_verification_job_id,
      policy_recovery.pilot_revision_id,
      policy_recovery.receiver_profile_id,
      policy_recovery.quarantined_verification_attempt_id,
      policy_recovery.quarantined_observation_body_digest,
      policy_recovery.prior_attempt_count,
      policy_recovery.prior_attempt_history_digest,
      policy_recovery.evidence_staged_at,
      policy_recovery.quarantined_at,
      policy_recovery.prior_expires_at,
      policy_recovery.recovered_at,
      policy_recovery.retry_expires_at,
      policy_recovery.reviewed_main_commit_sha,
      policy_recovery.reason_code
    );
    if policy_recovery.recovery_request_digest is distinct from expected_digest then
      raise exception 'The TeleBirr shadow policy-recovery digest does not match.';
    end if;

    return new;
  end if;

  if session_user <> 'postgres'
    or pg_catalog.current_setting('app.private_telebirr_shadow_retry', true)
         is distinct from 'on'
    or old.source_live_verification_job_id is null
    or old.source_live_proof_id is null
    or old.source_pilot_revision_id is null
    or old.source_receiver_profile_id is null
    or old.original_expires_at is null
    or old.recovered_at is null
    or old.recovery_request_key is null
    or old.recovery_request_digest is null
    or old.recovery_reason_code is distinct from 'expired_pilot_recovery_no_credit'
    or old.retry_request_key is not null
    or old.retry_request_digest is not null
    or old.retry_reason_code is not null
    or old.retry_prior_pilot_revision_id is not null
    or old.retry_prior_receiver_profile_id is not null
    or old.retry_prior_configuration_digest is not null
    or old.retry_original_expires_at is not null
    or old.retried_at is not null
    or old.expires_at > pg_catalog.clock_timestamp()
    or new.retry_request_key is null
    or new.retry_request_digest is null
    or new.retry_reason_code is distinct from 'expired_shadow_retry_no_credit'
    or new.retry_prior_pilot_revision_id is distinct from old.pilot_revision_id
    or new.retry_prior_receiver_profile_id is distinct from old.receiver_profile_id
    or new.retry_prior_configuration_digest
         is distinct from old.pilot_configuration_digest
    or new.retry_original_expires_at is distinct from old.expires_at
    or new.retried_at is null
    or new.retried_at < old.expires_at
    or new.expires_at <= new.retried_at + interval '60 seconds'
    or new.expires_at > new.retried_at + interval '5 minutes'
    or new.pilot_revision_id = old.pilot_revision_id
    or new.receiver_profile_id = old.receiver_profile_id
    or (
      pg_catalog.to_jsonb(new) - array[
        'pilot_revision_id',
        'receiver_profile_id',
        'pilot_configuration_digest',
        'expires_at',
        'retry_request_key',
        'retry_request_digest',
        'retry_reason_code',
        'retry_prior_pilot_revision_id',
        'retry_prior_receiver_profile_id',
        'retry_prior_configuration_digest',
        'retry_original_expires_at',
        'retried_at'
      ]::text[]
    ) is distinct from (
      pg_catalog.to_jsonb(old) - array[
        'pilot_revision_id',
        'receiver_profile_id',
        'pilot_configuration_digest',
        'expires_at',
        'retry_request_key',
        'retry_request_digest',
        'retry_reason_code',
        'retry_prior_pilot_revision_id',
        'retry_prior_receiver_profile_id',
        'retry_prior_configuration_digest',
        'retry_original_expires_at',
        'retried_at'
      ]::text[]
    )
    or exists (
      select 1 from app.telegram_telebirr_shadow_proof_receipts receipt
       where receipt.shadow_proof_request_id = old.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_attempts attempt
       where attempt.shadow_proof_request_id = old.id
    )
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = old.id
    ) then
    raise exception 'Private TeleBirr shadow lineage is immutable.';
  end if;

  expected_digest := app.private_telebirr_expired_shadow_retry_digest(
    new.retry_request_key,
    new.id,
    new.verification_job_id,
    new.source_live_verification_job_id,
    new.source_live_proof_id,
    new.source_pilot_revision_id,
    new.source_receiver_profile_id,
    new.retry_prior_pilot_revision_id,
    new.retry_prior_receiver_profile_id,
    new.retry_prior_configuration_digest,
    new.pilot_revision_id,
    new.receiver_profile_id,
    new.pilot_configuration_digest,
    new.retry_original_expires_at,
    new.retried_at,
    new.expires_at,
    new.retry_reason_code
  );

  if new.retry_request_digest is distinct from expected_digest then
    raise exception 'The expired-shadow retry digest does not match.';
  end if;

  return new;
end;
$$;

create function app.retry_quarantined_private_telebirr_shadow_after_policy_fix(
  p_shadow_proof_request_id uuid,
  p_shadow_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_quarantined_verification_attempt_id uuid,
  p_recovery_request_key uuid,
  p_reviewed_main_commit_sha text,
  p_reason_code text
)
returns table (
  shadow_proof_request_id uuid,
  shadow_verification_job_id uuid,
  retry_expires_at timestamptz,
  already_recovered boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authorized_at timestamptz;
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  staged app.private_telebirr_shadow_device_evidence_staging%rowtype;
  quarantine app.private_telebirr_shadow_evidence_quarantine%rowtype;
  existing_recovery app.private_telebirr_shadow_policy_recoveries%rowtype;
  updated_proof app.private_telebirr_shadow_proof_requests%rowtype;
  locked_switch_count integer;
  active_enrollment_count integer;
  active_enrollment_valid_until timestamptz;
  prior_attempt_count integer;
  prior_attempt_history_digest text;
  recovery_digest text;
  retry_until timestamptz;
begin
  if session_user <> 'postgres'
    or p_shadow_proof_request_id is null
    or p_shadow_verification_job_id is null
    or p_pilot_revision_id is null
    or p_quarantined_verification_attempt_id is null
    or p_recovery_request_key is null
    or p_recovery_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reviewed_main_commit_sha is null
    or p_reviewed_main_commit_sha !~ '^[0-9a-f]{40}$'
    or p_reason_code is distinct from 'verifier_policy_fix_retry_no_credit'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The TeleBirr shadow policy-recovery request is invalid.';
  end if;

  perform app.lock_private_trusted_telebirr_activation_authority();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-policy-recovery:v1:'
        || p_shadow_proof_request_id::text,
      0::bigint
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-policy-recovery-request:v1:'
        || p_recovery_request_key::text,
      0::bigint
    )
  );

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

  select recovery.* into existing_recovery
    from app.private_telebirr_shadow_policy_recoveries recovery
   where recovery.recovery_request_key = p_recovery_request_key
      or recovery.shadow_proof_request_id = p_shadow_proof_request_id
   order by recovery.created_at, recovery.recovery_request_key
   limit 1
   for share;

  if existing_recovery.recovery_request_key is not null then
    select candidate.* into proof
      from app.private_telebirr_shadow_proof_requests candidate
     where candidate.id = existing_recovery.shadow_proof_request_id
     for share;

    recovery_digest := app.private_telebirr_shadow_policy_recovery_digest(
      existing_recovery.recovery_request_key,
      existing_recovery.shadow_proof_request_id,
      existing_recovery.shadow_verification_job_id,
      existing_recovery.pilot_revision_id,
      existing_recovery.receiver_profile_id,
      existing_recovery.quarantined_verification_attempt_id,
      existing_recovery.quarantined_observation_body_digest,
      existing_recovery.prior_attempt_count,
      existing_recovery.prior_attempt_history_digest,
      existing_recovery.evidence_staged_at,
      existing_recovery.quarantined_at,
      existing_recovery.prior_expires_at,
      existing_recovery.recovered_at,
      existing_recovery.retry_expires_at,
      existing_recovery.reviewed_main_commit_sha,
      existing_recovery.reason_code
    );

    if existing_recovery.recovery_request_key is distinct from p_recovery_request_key
      or existing_recovery.shadow_proof_request_id
           is distinct from p_shadow_proof_request_id
      or existing_recovery.shadow_verification_job_id
           is distinct from p_shadow_verification_job_id
      or existing_recovery.pilot_revision_id is distinct from p_pilot_revision_id
      or existing_recovery.quarantined_verification_attempt_id
           is distinct from p_quarantined_verification_attempt_id
      or existing_recovery.reviewed_main_commit_sha
           is distinct from p_reviewed_main_commit_sha
      or existing_recovery.reason_code is distinct from p_reason_code
      or existing_recovery.recovery_request_digest is distinct from recovery_digest
      or proof.expires_at is distinct from existing_recovery.retry_expires_at then
      raise exception 'The TeleBirr shadow policy-recovery replay conflicts.';
    end if;

    return query select proof.id, proof.verification_job_id, proof.expires_at, true;
    return;
  end if;

  authorized_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = p_shadow_proof_request_id
   for update;
  select revision.* into pilot
    from app.private_live_deposit_pilot_revisions revision
   where revision.id = p_pilot_revision_id
   for share;
  select receiver_profile.* into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = proof.receiver_profile_id
   for share;
  select candidate.* into attempt
    from app.private_telebirr_shadow_verification_attempts candidate
   where candidate.id = p_quarantined_verification_attempt_id
   for share;
  select evidence.* into staged
    from app.private_telebirr_shadow_device_evidence_staging evidence
   where evidence.verification_attempt_id = attempt.id
   for share;
  select held.* into quarantine
    from app.private_telebirr_shadow_evidence_quarantine held
   where held.verification_attempt_id = attempt.id
   for share;

  select pg_catalog.count(*)::integer,
         app.private_telebirr_shadow_retry_attempt_history_digest(proof.id)
    into prior_attempt_count, prior_attempt_history_digest
    from app.private_telebirr_shadow_verification_attempts candidate
   where candidate.shadow_proof_request_id = proof.id;

  select pg_catalog.count(*)::integer, pg_catalog.max(enrollment.valid_until)
    into active_enrollment_count, active_enrollment_valid_until
    from app.private_live_telebirr_device_enrollments enrollment
    join app.private_live_telebirr_device_enrollment_certificates certificate
      on certificate.device_enrollment_id = enrollment.id
   where enrollment.pilot_revision_id = pilot.id
     and enrollment.receiver_profile_id = profile.id
     and enrollment.valid_from <= authorized_at
     and enrollment.valid_until > authorized_at + interval '10 minutes'
     and not exists (
       select 1 from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
     );

  if locked_switch_count <> 7
    or app.current_private_trusted_telebirr_activation_epoch() is not null
    or proof.id is null
    or proof.id is distinct from p_shadow_proof_request_id
    or proof.verification_job_id is distinct from p_shadow_verification_job_id
    or proof.pilot_revision_id is distinct from p_pilot_revision_id
    or proof.provider_code <> 'telebirr'
    or proof.proof_status <> 'verification_queued'
    or proof.source_live_verification_job_id is not null
    or proof.source_live_proof_id is not null
    or proof.source_pilot_revision_id is not null
    or proof.source_receiver_profile_id is not null
    or proof.recovery_request_key is not null
    or proof.retry_request_key is not null
    or proof.infrastructure_retry_request_key is not null
    or proof.runtime_retry_request_key is not null
    or proof.expires_at > authorized_at
    or proof.submitted_at + interval '12 hours' <= authorized_at + interval '10 minutes'
    or pilot.id is null
    or pilot.status <> 'armed'
    or authorized_at < pilot.active_from
    or pilot.expires_at <= authorized_at + interval '10 minutes'
    or not app.private_telebirr_shadow_mode_is_ready(pilot.id)
    or profile.id is null
    or profile.pilot_revision_id is distinct from pilot.id
    or profile.pilot_configuration_digest is distinct from pilot.configuration_digest
    or profile.valid_from > authorized_at
    or profile.valid_until <= authorized_at + interval '10 minutes'
    or active_enrollment_count <> 1
    or active_enrollment_valid_until is null
    or attempt.id is null
    or attempt.shadow_proof_request_id is distinct from proof.id
    or attempt.verification_job_id is distinct from proof.verification_job_id
    or attempt.attempt_number <> 1
    or attempt.expires_at > authorized_at
    or prior_attempt_count <> 1
    or prior_attempt_history_digest is null
    or staged.verification_attempt_id is distinct from attempt.id
    or staged.observed_at < attempt.issued_at
    or staged.observed_at > attempt.expires_at
    or staged.staged_at > attempt.expires_at
    or staged.staged_at > proof.expires_at
    or quarantine.verification_attempt_id is distinct from attempt.id
    or quarantine.observation_body_digest is distinct from staged.observation_body_digest
    or quarantine.reason_code <> 'trusted_evidence_invalid'
    or quarantine.quarantined_at < staged.staged_at
    or (select pg_catalog.count(*)
          from app.telegram_telebirr_shadow_proof_receipts receipt
         where receipt.shadow_proof_request_id = proof.id) <> 1
    or exists (
      select 1 from app.private_telebirr_shadow_verification_outcomes outcome
       where outcome.shadow_proof_request_id = proof.id
    )
    or exists (
      select 1 from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = proof.payment_provider_id
         and evidence.canonical_reference_fingerprint =
             proof.candidate_reference_fingerprint
    ) then
    raise exception 'The quarantined TeleBirr shadow proof is not safely policy-recoverable.';
  end if;

  retry_until := pg_catalog.date_trunc(
    'milliseconds',
    least(
      authorized_at + interval '12 hours',
      proof.submitted_at + interval '12 hours',
      pilot.expires_at,
      profile.valid_until,
      active_enrollment_valid_until
    )
  );
  if retry_until <= authorized_at + interval '10 minutes' then
    raise exception 'The TeleBirr shadow policy-recovery window is unavailable.';
  end if;

  recovery_digest := app.private_telebirr_shadow_policy_recovery_digest(
    p_recovery_request_key,
    proof.id,
    proof.verification_job_id,
    proof.pilot_revision_id,
    proof.receiver_profile_id,
    attempt.id,
    staged.observation_body_digest,
    prior_attempt_count,
    prior_attempt_history_digest,
    staged.staged_at,
    quarantine.quarantined_at,
    proof.expires_at,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code
  );

  insert into app.private_telebirr_shadow_policy_recoveries (
    recovery_request_key,
    recovery_request_digest,
    shadow_proof_request_id,
    shadow_verification_job_id,
    pilot_revision_id,
    receiver_profile_id,
    quarantined_verification_attempt_id,
    quarantined_observation_body_digest,
    prior_attempt_count,
    prior_attempt_history_digest,
    evidence_staged_at,
    quarantined_at,
    prior_expires_at,
    recovered_at,
    retry_expires_at,
    reviewed_main_commit_sha,
    reason_code,
    created_at
  ) values (
    p_recovery_request_key,
    recovery_digest,
    proof.id,
    proof.verification_job_id,
    proof.pilot_revision_id,
    proof.receiver_profile_id,
    attempt.id,
    staged.observation_body_digest,
    prior_attempt_count,
    prior_attempt_history_digest,
    staged.staged_at,
    quarantine.quarantined_at,
    proof.expires_at,
    authorized_at,
    retry_until,
    p_reviewed_main_commit_sha,
    p_reason_code,
    authorized_at
  );

  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_policy_recovery', 'on', true
  );
  update app.private_telebirr_shadow_proof_requests candidate
     set expires_at = retry_until
   where candidate.id = proof.id
     and candidate.verification_job_id = proof.verification_job_id
     and candidate.expires_at = proof.expires_at
  returning * into updated_proof;
  perform pg_catalog.set_config(
    'app.private_telebirr_shadow_policy_recovery', 'off', true
  );

  if updated_proof.id is null then
    raise exception 'The TeleBirr shadow policy recovery changed before commit.';
  end if;

  insert into app.audit_events (
    actor_kind,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'system',
    'verification.telebirr_shadow_policy_recovery_armed',
    'telebirr_shadow_proof_request',
    proof.id,
    pg_catalog.jsonb_build_object(
      'recovery_request_key', p_recovery_request_key,
      'verification_job_id', proof.verification_job_id,
      'pilot_revision_id', proof.pilot_revision_id,
      'quarantined_verification_attempt_id', attempt.id,
      'prior_attempt_count', prior_attempt_count,
      'prior_attempt_history_digest', prior_attempt_history_digest,
      'prior_expires_at', proof.expires_at,
      'retry_expires_at', retry_until,
      'reviewed_main_commit_sha', p_reviewed_main_commit_sha,
      'reason_code', p_reason_code,
      'financial_actions_enabled', false
    )
  );

  return query
  select updated_proof.id,
         updated_proof.verification_job_id,
         updated_proof.expires_at,
         false;
end;
$$;

alter table app.private_telebirr_shadow_policy_recoveries enable row level security;
alter table app.private_telebirr_shadow_policy_recoveries force row level security;
alter table app.private_telebirr_shadow_policy_recoveries owner to postgres;
alter function app.private_telebirr_shadow_policy_recovery_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, text, integer, text,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text, text
) owner to postgres;
alter function app.reject_private_telebirr_shadow_policy_recovery_mutation()
  owner to postgres;
alter function app.enforce_private_telebirr_shadow_proof_retry_only()
  owner to postgres;
alter function app.retry_quarantined_private_telebirr_shadow_after_policy_fix(
  uuid, uuid, uuid, uuid, uuid, text, text
) owner to postgres;

revoke all on table app.private_telebirr_shadow_policy_recoveries
from public, anon, authenticated, service_role;
revoke all on function
  app.private_telebirr_shadow_policy_recovery_digest(
    uuid, uuid, uuid, uuid, uuid, uuid, text, integer, text,
    timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text, text
  ),
  app.reject_private_telebirr_shadow_policy_recovery_mutation(),
  app.retry_quarantined_private_telebirr_shadow_after_policy_fix(
    uuid, uuid, uuid, uuid, uuid, text, text
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

comment on table app.private_telebirr_shadow_policy_recoveries is
  'Immutable, no-money recovery ledger for one direct TeleBirr shadow proof quarantined by a corrected verifier-policy defect. The original signed staging and quarantine rows are preserved.';
comment on function app.retry_quarantined_private_telebirr_shadow_after_policy_fix(
  uuid, uuid, uuid, uuid, uuid, text, text
) is
  'Postgres-only, idempotent recovery of one exact expired direct TeleBirr shadow proof after trusted evidence was quarantined by a reviewed verifier-policy defect. It only extends review authority, retains all prior evidence, and cannot create credit, settlement, execution, or money movement.';
