-- Make one final, audited verification window available for the single TeleBirr proof whose
-- assignment-binding retry was recovered only after the long-lived assignment broker had already
-- failed closed. The broker runtime change in this release now checks its PostgreSQL authority
-- every five seconds and shuts down when that authority is unavailable, allowing Docker's
-- existing `unless-stopped` policy to restart it with a fresh singleton connection.
--
-- This migration does not target a production row, create an attempt, create evidence, produce an
-- outcome, claim a payment, reserve a proof, settle a payment, enqueue a deposit, enable an
-- executor, or change a feature switch. Its postgres-only recovery function can extend only the
-- exact two-attempt/pre-evidence state left by the already-audited binding repair.

begin;

do $guard_reviewed_predecessors$
declare
  job_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.enforce_private_live_telebirr_verification_job_recovery()'
  );
  retry_recovery_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.recover_private_live_telebirr_assignment_binding_retry(uuid,uuid,bigint,uuid,text)'
  );
  expected_job_guard_source_sha256 constant text :=
    'df17c714ff3ed197534442ab7aa0e5b5fa88226fdd88d478f7911e33611dc9e2';
  expected_retry_recovery_source_sha256 constant text :=
    '8b87768eeac5b4719cc4b2aa0752c418dd7233bf87940d0afc29837c83cec22a';
  actual_job_guard_source_sha256 text;
  actual_retry_recovery_source_sha256 text;
begin
  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into actual_job_guard_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = job_guard_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into actual_retry_recovery_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = retry_recovery_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 5
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  if job_guard_signature is null
    or retry_recovery_signature is null
    or actual_job_guard_source_sha256 is distinct from expected_job_guard_source_sha256
    or actual_retry_recovery_source_sha256 is distinct from
       expected_retry_recovery_source_sha256 then
    raise exception 'The reviewed TeleBirr broker-runtime recovery predecessors do not match.';
  end if;
end;
$guard_reviewed_predecessors$;

alter table app.private_live_telebirr_verification_jobs
  drop constraint private_live_telebirr_job_window_check;

alter table app.private_live_telebirr_verification_jobs
  add column broker_original_expires_at timestamptz,
  add column broker_recovered_at timestamptz,
  add column broker_recovery_request_key uuid,
  add column broker_recovery_request_digest text,
  add column broker_recovery_reason_code text,
  add constraint private_live_telebirr_job_broker_recovery_key_v4_check check (
    broker_recovery_request_key is null
    or broker_recovery_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint private_live_telebirr_job_broker_recovery_digest_check check (
    broker_recovery_request_digest is null
    or broker_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint private_live_telebirr_job_broker_recovery_reason_check check (
    broker_recovery_reason_code is null
    or broker_recovery_reason_code = 'assignment_broker_runtime_unavailable'
  ),
  add constraint private_live_telebirr_job_window_check check (
    not_before = submitted_at
    and expires_at > not_before
    and (
      (
        original_expires_at is null
        and recovered_at is null
        and recovery_request_key is null
        and recovery_request_digest is null
        and recovery_reason_code is null
        and retry_original_expires_at is null
        and retry_recovered_at is null
        and retry_recovery_request_key is null
        and retry_recovery_request_digest is null
        and retry_recovery_reason_code is null
        and broker_original_expires_at is null
        and broker_recovered_at is null
        and broker_recovery_request_key is null
        and broker_recovery_request_digest is null
        and broker_recovery_reason_code is null
        and expires_at <= submitted_at + interval '5 minutes'
      )
      or
      (
        original_expires_at is not null
        and recovered_at is not null
        and recovery_request_key is not null
        and recovery_request_digest is not null
        and recovery_reason_code in (
          'assignment_runtime_unavailable',
          'device_evidence_binding_mismatch'
        )
        and retry_original_expires_at is null
        and retry_recovered_at is null
        and retry_recovery_request_key is null
        and retry_recovery_request_digest is null
        and retry_recovery_reason_code is null
        and broker_original_expires_at is null
        and broker_recovered_at is null
        and broker_recovery_request_key is null
        and broker_recovery_request_digest is null
        and broker_recovery_reason_code is null
        and original_expires_at > not_before
        and original_expires_at <= submitted_at + interval '5 minutes'
        and recovered_at >= original_expires_at
        and recovered_at < submitted_at + interval '24 hours'
        and expires_at > recovered_at + interval '60 seconds'
        and expires_at <= recovered_at + interval '5 minutes'
      )
      or
      (
        original_expires_at is not null
        and recovered_at is not null
        and recovery_request_key is not null
        and recovery_request_digest is not null
        and recovery_reason_code = 'device_evidence_binding_mismatch'
        and retry_original_expires_at is not null
        and retry_recovered_at is not null
        and retry_recovery_request_key is not null
        and retry_recovery_request_digest is not null
        and retry_recovery_reason_code = 'assignment_reference_binding_uniqueness'
        and broker_original_expires_at is null
        and broker_recovered_at is null
        and broker_recovery_request_key is null
        and broker_recovery_request_digest is null
        and broker_recovery_reason_code is null
        and original_expires_at > not_before
        and original_expires_at <= submitted_at + interval '5 minutes'
        and recovered_at >= original_expires_at
        and recovered_at < submitted_at + interval '24 hours'
        and retry_original_expires_at > recovered_at + interval '60 seconds'
        and retry_original_expires_at <= recovered_at + interval '5 minutes'
        and retry_recovered_at >= retry_original_expires_at
        and retry_recovered_at < submitted_at + interval '24 hours'
        and expires_at > retry_recovered_at + interval '60 seconds'
        and expires_at <= retry_recovered_at + interval '5 minutes'
      )
      or
      (
        original_expires_at is not null
        and recovered_at is not null
        and recovery_request_key is not null
        and recovery_request_digest is not null
        and recovery_reason_code = 'device_evidence_binding_mismatch'
        and retry_original_expires_at is not null
        and retry_recovered_at is not null
        and retry_recovery_request_key is not null
        and retry_recovery_request_digest is not null
        and retry_recovery_reason_code = 'assignment_reference_binding_uniqueness'
        and broker_original_expires_at is not null
        and broker_recovered_at is not null
        and broker_recovery_request_key is not null
        and broker_recovery_request_digest is not null
        and broker_recovery_reason_code = 'assignment_broker_runtime_unavailable'
        and original_expires_at > not_before
        and original_expires_at <= submitted_at + interval '5 minutes'
        and recovered_at >= original_expires_at
        and recovered_at < submitted_at + interval '24 hours'
        and retry_original_expires_at > recovered_at + interval '60 seconds'
        and retry_original_expires_at <= recovered_at + interval '5 minutes'
        and retry_recovered_at >= retry_original_expires_at
        and retry_recovered_at < submitted_at + interval '24 hours'
        and broker_original_expires_at > retry_recovered_at + interval '60 seconds'
        and broker_original_expires_at <= retry_recovered_at + interval '5 minutes'
        and broker_recovered_at >= broker_original_expires_at
        and broker_recovered_at < submitted_at + interval '24 hours'
        and expires_at > broker_recovered_at + interval '60 seconds'
        and expires_at <= broker_recovered_at + interval '5 minutes'
      )
    )
  );

create unique index private_live_telebirr_jobs_broker_recovery_key_idx
  on app.private_live_telebirr_verification_jobs (broker_recovery_request_key)
  where broker_recovery_request_key is not null;

create unique index private_live_telebirr_jobs_broker_recovery_digest_idx
  on app.private_live_telebirr_verification_jobs (broker_recovery_request_digest)
  where broker_recovery_request_digest is not null;

-- Retain the second recovery's immutable replay after the broker-runtime recovery replaces its
-- expired window. The original second-window expiry is then broker_original_expires_at.
do $preserve_binding_retry_recovery_replay$
declare
  recovery_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.recover_private_live_telebirr_assignment_binding_retry(uuid,uuid,bigint,uuid,text)'
  );
  expected_source_sha256 constant text :=
    '8b87768eeac5b4719cc4b2aa0752c418dd7233bf87940d0afc29837c83cec22a';
  expected_corrected_source_sha256 constant text :=
    'c6d6caaf5987323df4709303e19bd710ddd626836d94c1579de7d1b0e2722747';
  old_digest_fragment constant text := $old_digest$        || '|retry_recovered_expires_at_us=' || (
          extract(epoch from job.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || job.retry_recovery_reason_code$old_digest$;
  new_digest_fragment constant text := $new_digest$        || '|retry_recovered_expires_at_us=' || (
          extract(
            epoch from coalesce(job.broker_original_expires_at, job.expires_at)
          ) * 1000000
        )::bigint::text
        || '|reason_code=' || job.retry_recovery_reason_code$new_digest$;
  old_return_fragment constant text := $old_return$    return query
    select job.id, job.retry_original_expires_at, job.expires_at, true;
    return;$old_return$;
  new_return_fragment constant text := $new_return$    return query
    select job.id,
           job.retry_original_expires_at,
           coalesce(job.broker_original_expires_at, job.expires_at),
           true;
    return;$new_return$;
  original_definition text;
  original_source text;
  corrected_definition text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
  original_source_sha256 text;
  corrected_source_sha256 text;
  digest_marker_count integer;
  return_marker_count integer;
begin
  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into original_source,
         original_owner,
         original_acl,
         original_definition,
         original_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = recovery_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 5
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  digest_marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_digest_fragment, ''))
  ) / pg_catalog.length(old_digest_fragment);
  return_marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_return_fragment, ''))
  ) / pg_catalog.length(old_return_fragment);

  if recovery_signature is null
    or original_definition is null
    or original_source is null
    or original_source_sha256 is distinct from expected_source_sha256
    or digest_marker_count <> 1
    or return_marker_count <> 1 then
    raise exception 'The reviewed assignment-binding retry recovery does not match.';
  end if;

  corrected_definition := pg_catalog.replace(
    pg_catalog.replace(original_definition, old_digest_fragment, new_digest_fragment),
    old_return_fragment,
    new_return_fragment
  );
  corrected_source := pg_catalog.replace(
    pg_catalog.replace(original_source, old_digest_fragment, new_digest_fragment),
    old_return_fragment,
    new_return_fragment
  );
  corrected_source_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(corrected_source, 'UTF8'), 'sha256'),
    'hex'
  );

  if corrected_source_sha256 is distinct from expected_corrected_source_sha256 then
    raise exception 'The corrected assignment-binding retry recovery source is not reviewed.';
  end if;

  execute corrected_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = recovery_signature
       and routine.prosrc = corrected_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.proretset
       and routine.pronargs = 5
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The assignment-binding retry replay repair changed function authority.';
  end if;
end;
$preserve_binding_retry_recovery_replay$;

-- Extend the immutable job trigger with exactly one transition from the expired two-attempt state.
do $extend_verification_job_recovery_guard$
declare
  recovery_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.enforce_private_live_telebirr_verification_job_recovery()'
  );
  expected_source_sha256 constant text :=
    'df17c714ff3ed197534442ab7aa0e5b5fa88226fdd88d478f7911e33611dc9e2';
  expected_corrected_source_sha256 constant text :=
    'fd355332c2f6a62a44df84aaea3d97a8feedcd2580e966e43a22569fcbf7d0e3';
  old_tail constant text := $old_tail$  raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
end;$old_tail$;
  new_tail constant text := $new_tail$  if old.original_expires_at is not null
    and old.recovered_at is not null
    and old.recovery_request_key is not null
    and old.recovery_request_digest is not null
    and old.recovery_reason_code = 'device_evidence_binding_mismatch'
    and old.retry_original_expires_at is not null
    and old.retry_recovered_at is not null
    and old.retry_recovery_request_key is not null
    and old.retry_recovery_request_digest is not null
    and old.retry_recovery_reason_code = 'assignment_reference_binding_uniqueness'
    and old.broker_original_expires_at is null
    and old.broker_recovered_at is null
    and old.broker_recovery_request_key is null
    and old.broker_recovery_request_digest is null
    and old.broker_recovery_reason_code is null then
    if new.original_expires_at is distinct from old.original_expires_at
      or new.recovered_at is distinct from old.recovered_at
      or new.recovery_request_key is distinct from old.recovery_request_key
      or new.recovery_request_digest is distinct from old.recovery_request_digest
      or new.recovery_reason_code is distinct from old.recovery_reason_code
      or new.retry_original_expires_at is distinct from old.retry_original_expires_at
      or new.retry_recovered_at is distinct from old.retry_recovered_at
      or new.retry_recovery_request_key is distinct from old.retry_recovery_request_key
      or new.retry_recovery_request_digest is distinct from old.retry_recovery_request_digest
      or new.retry_recovery_reason_code is distinct from old.retry_recovery_reason_code
      or new.broker_original_expires_at is distinct from old.expires_at
      or new.broker_recovered_at is null
      or new.broker_recovery_request_key is null
      or new.broker_recovery_request_digest is null
      or new.broker_recovery_reason_code is distinct from
         'assignment_broker_runtime_unavailable'
      or new.expires_at <= new.broker_recovered_at + interval '60 seconds'
      or new.expires_at > new.broker_recovered_at + interval '5 minutes'
      or old.expires_at > new.broker_recovered_at
      or new.broker_recovered_at >= old.submitted_at + interval '24 hours'
      or (
        pg_catalog.to_jsonb(new) - array[
          'expires_at',
          'broker_original_expires_at',
          'broker_recovered_at',
          'broker_recovery_request_key',
          'broker_recovery_request_digest',
          'broker_recovery_reason_code'
        ]::text[]
      ) is distinct from (
        pg_catalog.to_jsonb(old) - array[
          'expires_at',
          'broker_original_expires_at',
          'broker_recovered_at',
          'broker_recovery_request_key',
          'broker_recovery_request_digest',
          'broker_recovery_reason_code'
        ]::text[]
      ) then
      raise exception 'The private live TeleBirr broker-runtime recovery mutation is invalid.';
    end if;

    select pg_catalog.count(*)::integer
      into attempt_count
      from app.private_live_telebirr_verification_attempts attempt
     where attempt.verification_job_id = old.id;

    select attempt.*
      into failed_attempt
      from app.private_live_telebirr_verification_attempts attempt
     where attempt.verification_job_id = old.id
       and attempt.attempt_number = 1
     for share;

    select attempt.*
      into retry_attempt
      from app.private_live_telebirr_verification_attempts attempt
     where attempt.verification_job_id = old.id
       and attempt.attempt_number = 2
     for share;

    select transcript.*
      into assignment_transcript
      from app.private_live_telebirr_assignment_transcripts transcript
     where transcript.verification_attempt_id = failed_attempt.id
     for share;

    select delivery.*
      into assignment_delivery
      from app.private_live_telebirr_assignment_deliveries delivery
     where delivery.verification_attempt_id = failed_attempt.id
       and delivery.assignment_transcript_id = assignment_transcript.id
     for share;

    if attempt_count <> 2
      or failed_attempt.id is null
      or retry_attempt.id is null
      or retry_attempt.expires_at > new.broker_recovered_at
      or assignment_transcript.id is null
      or assignment_delivery.verification_attempt_id is null
      or exists (
        select 1
          from app.private_live_telebirr_assignment_transcripts transcript
         where transcript.verification_attempt_id = retry_attempt.id
      )
      or exists (
        select 1
          from app.private_live_telebirr_assignment_deliveries delivery
         where delivery.verification_attempt_id = retry_attempt.id
      )
      or exists (
        select 1
          from app.private_live_telebirr_device_evidence_staging staged
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = staged.verification_attempt_id
         where attempt.verification_job_id = old.id
      )
      or exists (
        select 1
          from app.private_live_telebirr_observation_transcripts observation
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = observation.verification_attempt_id
         where attempt.verification_job_id = old.id
      )
      or exists (
        select 1
          from app.private_live_telebirr_verification_outcomes outcome
         where outcome.verification_job_id = old.id
      )
      or exists (
        select 1
          from app.private_live_deposit_pilot_reservations reservation
         where reservation.private_live_deposit_pilot_proof_id =
               old.private_live_deposit_pilot_proof_id
      ) then
      raise exception 'The private live TeleBirr broker-runtime recovery mutation is invalid.';
    end if;

    expected_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:assignment-broker-runtime-recovery:v1'
        || '|request_key=' || new.broker_recovery_request_key::text
        || '|job_id=' || new.id::text
        || '|pilot_revision_id=' || new.pilot_revision_id::text
        || '|binding_retry_recovery_request_digest=' || new.retry_recovery_request_digest
        || '|stranded_retry_attempt_id=' || retry_attempt.id::text
        || '|stranded_retry_assignment_id=' || retry_attempt.assignment_id::text
        || '|stranded_retry_lease_request_digest=' || retry_attempt.lease_request_digest
        || '|stranded_retry_lease_nonce_digest=' || retry_attempt.lease_nonce_digest
        || '|stranded_retry_challenge_digest=' || retry_attempt.challenge_digest
        || '|runtime_repair_source_sha256='
        || 'sha256:911d05a9a40d047b849f0144eda6e1bb8f148569aff416de220e2a5ae4d05fff'
        || '|repair_migration=20260917171000'
        || '|broker_original_expires_at_us=' || (
          extract(epoch from new.broker_original_expires_at) * 1000000
        )::bigint::text
        || '|broker_recovered_at_us=' || (
          extract(epoch from new.broker_recovered_at) * 1000000
        )::bigint::text
        || '|broker_recovered_expires_at_us=' || (
          extract(epoch from new.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || new.broker_recovery_reason_code
    );

    if new.broker_recovery_request_digest is distinct from expected_digest then
      raise exception 'The private live TeleBirr broker-runtime recovery digest is invalid.';
    end if;

    return new;
  end if;

  raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
end;$new_tail$;
  original_definition text;
  original_source text;
  corrected_definition text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
  original_source_sha256 text;
  corrected_source_sha256 text;
  marker_count integer;
begin
  select routine.prosrc,
         routine.proowner,
         routine.proacl,
         pg_catalog.pg_get_functiondef(routine.oid),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into original_source,
         original_owner,
         original_acl,
         original_definition,
         original_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = recovery_guard_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_tail, ''))
  ) / pg_catalog.length(old_tail);

  if recovery_guard_signature is null
    or original_definition is null
    or original_source is null
    or original_source_sha256 is distinct from expected_source_sha256
    or marker_count <> 1 then
    raise exception 'The reviewed TeleBirr verification-job recovery guard does not match.';
  end if;

  corrected_definition := pg_catalog.replace(original_definition, old_tail, new_tail);
  corrected_source := pg_catalog.replace(original_source, old_tail, new_tail);
  corrected_source_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(corrected_source, 'UTF8'), 'sha256'),
    'hex'
  );

  if corrected_source_sha256 is distinct from expected_corrected_source_sha256 then
    raise exception 'The corrected TeleBirr verification-job recovery guard is not reviewed.';
  end if;

  execute corrected_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = recovery_guard_signature
       and routine.prosrc = corrected_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and not routine.proretset
       and routine.pronargs = 0
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The TeleBirr verification-job recovery repair changed function authority.';
  end if;
end;
$extend_verification_job_recovery_guard$;

create function app.recover_private_live_telebirr_assignment_broker_runtime(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_recovery_request_key uuid,
  p_reason_code text
)
returns table (
  verification_job_id uuid,
  stranded_broker_expires_at timestamptz,
  recovered_job_expires_at timestamptz,
  already_recovered boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  active_epoch bigint;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  failed_attempt app.private_live_telebirr_verification_attempts%rowtype;
  retry_attempt app.private_live_telebirr_verification_attempts%rowtype;
  assignment_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  assignment_delivery app.private_live_telebirr_assignment_deliveries%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  prior_recovery record;
  authorized_at timestamptz;
  recovered_expires_at timestamptz;
  request_digest text;
  attempt_count integer;
begin
  if session_user <> 'postgres'
    or p_verification_job_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null
    or p_activation_epoch <= 0
    or p_recovery_request_key is null
    or p_recovery_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from 'assignment_broker_runtime_unavailable' then
    raise exception 'The private live TeleBirr broker-runtime recovery request is invalid.';
  end if;

  active_epoch := app.current_private_trusted_telebirr_activation_epoch();
  if active_epoch is distinct from p_activation_epoch then
    raise exception 'The trusted TeleBirr activation epoch is not currently authorized.';
  end if;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = p_verification_job_id
     and verification_job.pilot_revision_id = p_pilot_revision_id
   for update;

  if job.id is null
    or job.retry_recovery_request_key is null
    or job.retry_recovery_reason_code is distinct from
       'assignment_reference_binding_uniqueness' then
    raise exception 'The private live TeleBirr broker-runtime recovery lineage is unavailable.';
  end if;

  select *
    into prior_recovery
    from app.recover_private_live_telebirr_assignment_binding_retry(
      job.id,
      p_pilot_revision_id,
      p_activation_epoch,
      job.retry_recovery_request_key,
      job.retry_recovery_reason_code
    );

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = active_epoch
     and activation_epoch.pilot_revision_id = p_pilot_revision_id
     and activation_epoch.authority_state = 'active'
     and activation_epoch.revoked_at is null
   for share;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id
     and receiver_profile.pilot_revision_id = p_pilot_revision_id
   for share;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = job.private_live_deposit_pilot_proof_id
     and proof_row.pilot_revision_id = p_pilot_revision_id
   for share;

  select attempt.*
    into failed_attempt
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.verification_job_id = job.id
     and attempt.attempt_number = 1
   for share;

  select attempt.*
    into retry_attempt
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.verification_job_id = job.id
     and attempt.attempt_number = 2
   for share;

  select transcript.*
    into assignment_transcript
    from app.private_live_telebirr_assignment_transcripts transcript
   where transcript.verification_attempt_id = failed_attempt.id
   for share;

  select delivery.*
    into assignment_delivery
    from app.private_live_telebirr_assignment_deliveries delivery
   where delivery.verification_attempt_id = failed_attempt.id
     and delivery.assignment_transcript_id = assignment_transcript.id
   for share;

  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = retry_attempt.device_enrollment_id
     and device_enrollment.pilot_revision_id = p_pilot_revision_id
     and device_enrollment.receiver_profile_id = profile.id
   for share;

  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.id = assignment_transcript.assignment_signer_id
   for share;

  if authority.epoch is null
    or pilot.id is null
    or profile.id is null
    or proof.id is null
    or failed_attempt.id is null
    or retry_attempt.id is null
    or assignment_transcript.id is null
    or assignment_delivery.verification_attempt_id is null
    or enrollment.id is null
    or signer.id is null
    or prior_recovery.already_recovered is distinct from true
    or prior_recovery.recovered_job_expires_at is distinct from
       coalesce(job.broker_original_expires_at, job.expires_at) then
    raise exception 'The private live TeleBirr broker-runtime recovery lineage is unavailable.';
  end if;

  if job.broker_recovery_request_key is not null then
    if job.broker_recovery_request_key is distinct from p_recovery_request_key
      or job.broker_recovery_reason_code is distinct from p_reason_code
      or job.broker_original_expires_at is null
      or job.broker_recovered_at is null
      or job.broker_recovery_request_digest is null then
      raise exception 'The private live TeleBirr broker-runtime recovery replay conflicts.';
    end if;

    request_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:assignment-broker-runtime-recovery:v1'
        || '|request_key=' || job.broker_recovery_request_key::text
        || '|job_id=' || job.id::text
        || '|pilot_revision_id=' || job.pilot_revision_id::text
        || '|binding_retry_recovery_request_digest=' || job.retry_recovery_request_digest
        || '|stranded_retry_attempt_id=' || retry_attempt.id::text
        || '|stranded_retry_assignment_id=' || retry_attempt.assignment_id::text
        || '|stranded_retry_lease_request_digest=' || retry_attempt.lease_request_digest
        || '|stranded_retry_lease_nonce_digest=' || retry_attempt.lease_nonce_digest
        || '|stranded_retry_challenge_digest=' || retry_attempt.challenge_digest
        || '|runtime_repair_source_sha256='
        || 'sha256:911d05a9a40d047b849f0144eda6e1bb8f148569aff416de220e2a5ae4d05fff'
        || '|repair_migration=20260917171000'
        || '|broker_original_expires_at_us=' || (
          extract(epoch from job.broker_original_expires_at) * 1000000
        )::bigint::text
        || '|broker_recovered_at_us=' || (
          extract(epoch from job.broker_recovered_at) * 1000000
        )::bigint::text
        || '|broker_recovered_expires_at_us=' || (
          extract(epoch from job.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || job.broker_recovery_reason_code
    );

    if job.broker_recovery_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr broker-runtime recovery replay is invalid.';
    end if;

    return query
    select job.id, job.broker_original_expires_at, job.expires_at, true;
    return;
  end if;

  select pg_catalog.count(*)::integer
    into attempt_count
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.verification_job_id = job.id;

  authorized_at := pg_catalog.clock_timestamp();
  recovered_expires_at := least(
    authorized_at + interval '5 minutes',
    authority.expires_at,
    pilot.expires_at,
    profile.valid_until,
    enrollment.valid_until,
    signer.valid_until
  );

  if pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or job.pilot_configuration_digest is distinct from pilot.configuration_digest
    or job.receiver_profile_id is distinct from profile.id
    or job.payment_provider_id is distinct from profile.payment_provider_id
    or job.provider_code <> 'telebirr'
    or proof.provider_code_snapshot <> 'telebirr'
    or job.submitted_at is distinct from proof.submitted_at
    or job.candidate_reference_fingerprint
         is distinct from proof.candidate_reference_fingerprint
    or job.original_expires_at is null
    or job.recovered_at is null
    or job.recovery_request_key is null
    or job.recovery_request_digest is null
    or job.recovery_reason_code is distinct from 'device_evidence_binding_mismatch'
    or job.retry_original_expires_at is null
    or job.retry_recovered_at is null
    or job.retry_recovery_request_key is null
    or job.retry_recovery_request_digest is null
    or job.retry_recovery_reason_code is distinct from
       'assignment_reference_binding_uniqueness'
    or job.broker_original_expires_at is not null
    or job.broker_recovered_at is not null
    or job.broker_recovery_request_key is not null
    or job.broker_recovery_request_digest is not null
    or job.broker_recovery_reason_code is not null
    or job.expires_at > authorized_at
    or authorized_at >= proof.submitted_at + interval '24 hours'
    or authorized_at < profile.valid_from
    or authorized_at >= profile.valid_until
    or authorized_at < enrollment.valid_from
    or authorized_at >= enrollment.valid_until
    or authorized_at < signer.valid_from
    or authorized_at >= signer.valid_until
    or recovered_expires_at <= authorized_at + interval '60 seconds'
    or attempt_count <> 2
    or failed_attempt.attempt_number <> 1
    or retry_attempt.attempt_number <> 2
    or retry_attempt.issued_at < job.recovered_at
    or retry_attempt.expires_at > job.expires_at
    or retry_attempt.expires_at > authorized_at
    or assignment_transcript.signed_at < failed_attempt.issued_at
    or assignment_transcript.signed_at > failed_attempt.expires_at
    or assignment_delivery.persisted_at < assignment_transcript.signed_at
    or not app.is_private_live_deposit_pilot_enforced()
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    )
    or exists (
      select 1
        from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= authorized_at
    )
    or exists (
      select 1
        from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= authorized_at
    )
    or exists (
      select 1
        from app.private_live_telebirr_assignment_transcripts transcript
       where transcript.verification_attempt_id = retry_attempt.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_assignment_deliveries delivery
       where delivery.verification_attempt_id = retry_attempt.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_device_evidence_staging staged
        join app.private_live_telebirr_verification_attempts attempt
          on attempt.id = staged.verification_attempt_id
       where attempt.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_observation_transcripts observation
        join app.private_live_telebirr_verification_attempts attempt
          on attempt.id = observation.verification_attempt_id
       where attempt.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = proof.id
    )
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
    ) then
    raise exception 'The private live TeleBirr verification job is not broker-recoverable.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:assignment-broker-runtime-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|job_id=' || job.id::text
      || '|pilot_revision_id=' || job.pilot_revision_id::text
      || '|binding_retry_recovery_request_digest=' || job.retry_recovery_request_digest
      || '|stranded_retry_attempt_id=' || retry_attempt.id::text
      || '|stranded_retry_assignment_id=' || retry_attempt.assignment_id::text
      || '|stranded_retry_lease_request_digest=' || retry_attempt.lease_request_digest
      || '|stranded_retry_lease_nonce_digest=' || retry_attempt.lease_nonce_digest
      || '|stranded_retry_challenge_digest=' || retry_attempt.challenge_digest
      || '|runtime_repair_source_sha256='
      || 'sha256:911d05a9a40d047b849f0144eda6e1bb8f148569aff416de220e2a5ae4d05fff'
      || '|repair_migration=20260917171000'
      || '|broker_original_expires_at_us=' || (
        extract(epoch from job.expires_at) * 1000000
      )::bigint::text
      || '|broker_recovered_at_us=' || (
        extract(epoch from authorized_at) * 1000000
      )::bigint::text
      || '|broker_recovered_expires_at_us=' || (
        extract(epoch from recovered_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );

  update app.private_live_telebirr_verification_jobs verification_job
     set broker_original_expires_at = verification_job.expires_at,
         broker_recovered_at = authorized_at,
         broker_recovery_request_key = p_recovery_request_key,
         broker_recovery_request_digest = request_digest,
         broker_recovery_reason_code = p_reason_code,
         expires_at = recovered_expires_at
   where verification_job.id = job.id
     and verification_job.broker_recovery_request_key is null
  returning verification_job.* into job;

  if job.broker_recovery_request_key is distinct from p_recovery_request_key
    or job.broker_recovery_request_digest is distinct from request_digest then
    raise exception 'The private live TeleBirr broker-runtime recovery did not persist.';
  end if;

  return query
  select job.id, job.broker_original_expires_at, job.expires_at, false;
end;
$$;

alter function app.recover_private_live_telebirr_assignment_broker_runtime(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function
  app.recover_private_live_telebirr_assignment_broker_runtime(
    uuid, uuid, bigint, uuid, text
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

comment on function app.recover_private_live_telebirr_assignment_broker_runtime(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, one-use recovery for the exact two-attempt TeleBirr verification job whose already-repaired binding retry expired behind a fail-closed broker connection. Opens one final five-minute verification window and requires the deposit executor to remain disabled.';

comment on function app.enforce_private_live_telebirr_verification_job_recovery() is
  'Allows the reviewed immutable recovery chain, including one postgres-only final window for the exact two-attempt assignment-broker runtime failure. Every recovery timestamp, reason, request key, digest, and replaced window remains immutable.';

comment on table app.private_live_telebirr_verification_jobs is
  'Private TeleBirr proof-bound verification jobs. Immutable except for the reviewed postgres-only replacement windows, including one final audited broker-runtime recovery for the exact two-attempt/pre-evidence failure.';

commit;
