-- Repair the live device-evidence wire contract and permit one tightly bounded retry for an
-- expired job that reached the signed-assignment boundary before this repair. Protocol payloads
-- carry a scheme-qualified fingerprint (hmac-sha256:<digest>); the encrypted proof and job rows
-- intentionally retain only the 64-character digest.
--
-- The recovery routine is postgres-only. It neither verifies a payment nor creates a claim,
-- reservation, settlement, deposit job, or executor session. It only replaces one expired job
-- window after proving that exactly one expired attempt and one delivered signed assignment exist,
-- while no evidence, observation, outcome, reservation, or executor authority exists.

begin;

do $repair_live_evidence_binding$
declare
  stage_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.stage_live_tbirr_device_evidence_internal(uuid,text,text,text,jsonb,jsonb)'
  );
  expected_source_sha256 constant text :=
    'dfe90415f8fa49a7de6f2034e07ebe081f26d1c066d734d74d0f0626617f65b9';
  expected_corrected_source_sha256 constant text :=
    'd9977107fbbe842758b1e09d917f7fbac66af2e31c68004386b81bcb842cbe2e';
  assignment_old_fragment constant text := $old_assignment$assignment_body ->> 'referenceFingerprint'
      is distinct from job.candidate_reference_fingerprint$old_assignment$;
  assignment_new_fragment constant text := $new_assignment$assignment_body ->> 'referenceFingerprint'
      is distinct from 'hmac-sha256:' || job.candidate_reference_fingerprint$new_assignment$;
  observation_old_fragment constant text := $old_observation$observation_body ->> 'referenceFingerprint'
      is distinct from job.candidate_reference_fingerprint$old_observation$;
  observation_new_fragment constant text := $new_observation$observation_body ->> 'referenceFingerprint'
      is distinct from 'hmac-sha256:' || job.candidate_reference_fingerprint$new_observation$;
  original_definition text;
  original_source text;
  corrected_definition text;
  corrected_source text;
  original_owner oid;
  original_acl aclitem[];
  original_source_sha256 text;
  corrected_source_sha256 text;
  assignment_marker_count integer;
  observation_marker_count integer;
begin
  if stage_signature is null then
    raise exception 'The live TeleBirr device-evidence staging function is unavailable.';
  end if;

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
   where routine.oid = stage_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 6
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     );

  assignment_marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, assignment_old_fragment, ''))
  ) / pg_catalog.length(assignment_old_fragment);
  observation_marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, observation_old_fragment, ''))
  ) / pg_catalog.length(observation_old_fragment);

  if original_definition is null
    or original_source is null
    or original_source_sha256 <> expected_source_sha256
    or assignment_marker_count <> 1
    or observation_marker_count <> 1 then
    raise exception 'The live TeleBirr device-evidence staging function does not match the reviewed source.';
  end if;

  corrected_definition := pg_catalog.replace(
    pg_catalog.replace(
      original_definition,
      assignment_old_fragment,
      assignment_new_fragment
    ),
    observation_old_fragment,
    observation_new_fragment
  );
  corrected_source := pg_catalog.replace(
    pg_catalog.replace(
      original_source,
      assignment_old_fragment,
      assignment_new_fragment
    ),
    observation_old_fragment,
    observation_new_fragment
  );
  corrected_source_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(corrected_source, 'UTF8'), 'sha256'),
    'hex'
  );

  if corrected_source_sha256 <> expected_corrected_source_sha256 then
    raise exception 'The corrected live TeleBirr device-evidence source is not the reviewed repair.';
  end if;

  execute corrected_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = stage_signature
       and routine.prosrc = corrected_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.proretset
       and routine.pronargs = 6
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The live TeleBirr device-evidence repair changed function authority.';
  end if;
end;
$repair_live_evidence_binding$;

do $guard_job_recovery_source$
declare
  guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.enforce_private_live_telebirr_verification_job_recovery()'
  );
  expected_source_sha256 constant text :=
    '77d3b77572b79f15e91394205c887c18f1cba44fb215db1efdd123c88f53ac0c';
  actual_source_sha256 text;
begin
  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into actual_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = guard_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  if guard_signature is null
    or actual_source_sha256 is distinct from expected_source_sha256 then
    raise exception 'The live TeleBirr job recovery guard does not match the reviewed source.';
  end if;
end;
$guard_job_recovery_source$;

alter table app.private_live_telebirr_verification_jobs
  drop constraint private_live_telebirr_job_recovery_reason_check,
  drop constraint private_live_telebirr_job_window_check;

alter table app.private_live_telebirr_verification_jobs
  add constraint private_live_telebirr_job_recovery_reason_check check (
    recovery_reason_code is null
    or recovery_reason_code in (
      'assignment_runtime_unavailable',
      'device_evidence_binding_mismatch'
    )
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
        and original_expires_at > not_before
        and original_expires_at <= submitted_at + interval '5 minutes'
        and recovered_at >= original_expires_at
        and recovered_at < submitted_at + interval '24 hours'
        and expires_at > recovered_at + interval '60 seconds'
        and expires_at <= recovered_at + interval '5 minutes'
      )
    )
  );

create or replace function app.enforce_private_live_telebirr_verification_job_recovery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  expected_digest text;
  failed_attempt app.private_live_telebirr_verification_attempts%rowtype;
  assignment_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  assignment_delivery app.private_live_telebirr_assignment_deliveries%rowtype;
  attempt_count integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'Private live TeleBirr verification jobs cannot be deleted.';
  end if;

  if session_user <> 'postgres'
    or old.original_expires_at is not null
    or old.recovered_at is not null
    or old.recovery_request_key is not null
    or old.recovery_request_digest is not null
    or old.recovery_reason_code is not null
    or new.original_expires_at is distinct from old.expires_at
    or new.recovered_at is null
    or new.recovery_request_key is null
    or new.recovery_request_digest is null
    or new.recovery_reason_code is null
    or new.recovery_reason_code not in (
      'assignment_runtime_unavailable',
      'device_evidence_binding_mismatch'
    )
    or new.expires_at <= new.recovered_at + interval '60 seconds'
    or new.expires_at > new.recovered_at + interval '5 minutes'
    or old.expires_at > new.recovered_at
    or new.recovered_at >= old.submitted_at + interval '24 hours'
    or (
      pg_catalog.to_jsonb(new) - array[
        'expires_at',
        'original_expires_at',
        'recovered_at',
        'recovery_request_key',
        'recovery_request_digest',
        'recovery_reason_code'
      ]::text[]
    ) is distinct from (
      pg_catalog.to_jsonb(old) - array[
        'expires_at',
        'original_expires_at',
        'recovered_at',
        'recovery_request_key',
        'recovery_request_digest',
        'recovery_reason_code'
      ]::text[]
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = old.id
    ) then
    raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
  end if;

  if new.recovery_reason_code = 'assignment_runtime_unavailable' then
    if exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
       where attempt.verification_job_id = old.id
    ) then
      raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
    end if;

    expected_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:job-recovery:v1'
        || '|request_key=' || new.recovery_request_key::text
        || '|job_id=' || new.id::text
        || '|pilot_revision_id=' || new.pilot_revision_id::text
        || '|original_expires_at_us=' || (
          extract(epoch from new.original_expires_at) * 1000000
        )::bigint::text
        || '|recovered_at_us=' || (
          extract(epoch from new.recovered_at) * 1000000
        )::bigint::text
        || '|recovered_expires_at_us=' || (
          extract(epoch from new.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || new.recovery_reason_code
    );
  else
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

    if attempt_count <> 1
      or failed_attempt.id is null
      or failed_attempt.expires_at > new.recovered_at
      or assignment_transcript.id is null
      or assignment_delivery.verification_attempt_id is null
      or exists (
        select 1
          from app.private_live_telebirr_device_evidence_staging staged
         where staged.verification_attempt_id = failed_attempt.id
      )
      or exists (
        select 1
          from app.private_live_telebirr_observation_transcripts observation
         where observation.verification_attempt_id = failed_attempt.id
      )
      or exists (
        select 1
          from app.private_live_deposit_pilot_reservations reservation
         where reservation.private_live_deposit_pilot_proof_id =
               old.private_live_deposit_pilot_proof_id
      ) then
      raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
    end if;

    expected_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:binding-mismatch-job-recovery:v1'
        || '|request_key=' || new.recovery_request_key::text
        || '|job_id=' || new.id::text
        || '|pilot_revision_id=' || new.pilot_revision_id::text
        || '|failed_attempt_id=' || failed_attempt.id::text
        || '|failed_assignment_body_digest=' || assignment_transcript.assignment_body_digest
        || '|failed_reference_binding_digest=' || assignment_transcript.reference_binding_digest
        || '|defect_source_sha256='
        || 'sha256:dfe90415f8fa49a7de6f2034e07ebe081f26d1c066d734d74d0f0626617f65b9'
        || '|original_expires_at_us=' || (
          extract(epoch from new.original_expires_at) * 1000000
        )::bigint::text
        || '|recovered_at_us=' || (
          extract(epoch from new.recovered_at) * 1000000
        )::bigint::text
        || '|recovered_expires_at_us=' || (
          extract(epoch from new.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || new.recovery_reason_code
    );
  end if;

  if new.recovery_request_digest is distinct from expected_digest then
    raise exception 'The private live TeleBirr verification job recovery digest is invalid.';
  end if;

  return new;
end;
$$;

create function app.recover_attempted_private_live_telebirr_binding_mismatch_job(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_recovery_request_key uuid,
  p_reason_code text
)
returns table (
  verification_job_id uuid,
  original_job_expires_at timestamptz,
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
  assignment_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  assignment_delivery app.private_live_telebirr_assignment_deliveries%rowtype;
  authorized_at timestamptz;
  recovered_expires_at timestamptz;
  request_digest text;
  staging_source_sha256 text;
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
    or p_reason_code is distinct from 'device_evidence_binding_mismatch' then
    raise exception 'The private live TeleBirr binding-mismatch recovery request is invalid.';
  end if;

  active_epoch := app.current_private_trusted_telebirr_activation_epoch();
  if active_epoch is distinct from p_activation_epoch then
    raise exception 'The trusted TeleBirr activation epoch is not currently authorized.';
  end if;

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_epochs activation_epoch
   where activation_epoch.epoch = active_epoch
     and activation_epoch.pilot_revision_id = p_pilot_revision_id
     and activation_epoch.authority_state = 'active'
     and activation_epoch.revoked_at is null
   for share;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = p_verification_job_id
     and verification_job.pilot_revision_id = p_pilot_revision_id
   for update;

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

  select pg_catalog.count(*)::integer
    into attempt_count
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.verification_job_id = job.id;

  select attempt.*
    into failed_attempt
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.verification_job_id = job.id
     and attempt.attempt_number = 1
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

  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into staging_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.stage_live_tbirr_device_evidence_internal(uuid,text,text,text,jsonb,jsonb)'
   );

  if job.id is null
    or authority.epoch is null
    or pilot.id is null
    or profile.id is null
    or proof.id is null
    or failed_attempt.id is null
    or assignment_transcript.id is null
    or assignment_delivery.verification_attempt_id is null then
    raise exception 'The private live TeleBirr binding-mismatch recovery lineage is unavailable.';
  end if;

  if job.recovery_request_key is not null then
    if job.recovery_request_key is distinct from p_recovery_request_key
      or job.recovery_reason_code is distinct from p_reason_code
      or job.original_expires_at is null
      or job.recovered_at is null
      or job.recovery_request_digest is null then
      raise exception 'The private live TeleBirr binding-mismatch recovery replay conflicts.';
    end if;

    request_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:binding-mismatch-job-recovery:v1'
        || '|request_key=' || job.recovery_request_key::text
        || '|job_id=' || job.id::text
        || '|pilot_revision_id=' || job.pilot_revision_id::text
        || '|failed_attempt_id=' || failed_attempt.id::text
        || '|failed_assignment_body_digest=' || assignment_transcript.assignment_body_digest
        || '|failed_reference_binding_digest=' || assignment_transcript.reference_binding_digest
        || '|defect_source_sha256='
        || 'sha256:dfe90415f8fa49a7de6f2034e07ebe081f26d1c066d734d74d0f0626617f65b9'
        || '|original_expires_at_us=' || (
          extract(epoch from job.original_expires_at) * 1000000
        )::bigint::text
        || '|recovered_at_us=' || (
          extract(epoch from job.recovered_at) * 1000000
        )::bigint::text
        || '|recovered_expires_at_us=' || (
          extract(epoch from job.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || job.recovery_reason_code
    );

    if job.recovery_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr binding-mismatch recovery replay is invalid.';
    end if;

    return query
    select job.id, job.original_expires_at, job.expires_at, true;
    return;
  end if;

  authorized_at := pg_catalog.clock_timestamp();
  recovered_expires_at := least(
    authorized_at + interval '5 minutes',
    authority.expires_at,
    pilot.expires_at,
    profile.valid_until
  );

  if staging_source_sha256 is distinct from
       'd9977107fbbe842758b1e09d917f7fbac66af2e31c68004386b81bcb842cbe2e'
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or job.pilot_configuration_digest is distinct from pilot.configuration_digest
    or job.receiver_profile_id is distinct from profile.id
    or job.payment_provider_id is distinct from profile.payment_provider_id
    or job.provider_code <> 'telebirr'
    or proof.provider_code_snapshot <> 'telebirr'
    or job.submitted_at is distinct from proof.submitted_at
    or job.candidate_reference_fingerprint
         is distinct from proof.candidate_reference_fingerprint
    or job.expires_at > authorized_at
    or authorized_at >= proof.submitted_at + interval '24 hours'
    or authorized_at < profile.valid_from
    or authorized_at >= profile.valid_until
    or recovered_expires_at <= authorized_at + interval '60 seconds'
    or attempt_count <> 1
    or failed_attempt.attempt_number <> 1
    or failed_attempt.expires_at > authorized_at
    or assignment_transcript.signed_at < failed_attempt.issued_at
    or assignment_transcript.signed_at > failed_attempt.expires_at
    or assignment_delivery.persisted_at < assignment_transcript.signed_at
    or exists (
      select 1
        from app.private_live_telebirr_device_evidence_staging staged
       where staged.verification_attempt_id = failed_attempt.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_observation_transcripts observation
       where observation.verification_attempt_id = failed_attempt.id
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
    raise exception 'The private live TeleBirr verification job is not recoverable.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:binding-mismatch-job-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|job_id=' || job.id::text
      || '|pilot_revision_id=' || job.pilot_revision_id::text
      || '|failed_attempt_id=' || failed_attempt.id::text
      || '|failed_assignment_body_digest=' || assignment_transcript.assignment_body_digest
      || '|failed_reference_binding_digest=' || assignment_transcript.reference_binding_digest
      || '|defect_source_sha256='
      || 'sha256:dfe90415f8fa49a7de6f2034e07ebe081f26d1c066d734d74d0f0626617f65b9'
      || '|original_expires_at_us=' || (
        extract(epoch from job.expires_at) * 1000000
      )::bigint::text
      || '|recovered_at_us=' || (
        extract(epoch from authorized_at) * 1000000
      )::bigint::text
      || '|recovered_expires_at_us=' || (
        extract(epoch from recovered_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );

  update app.private_live_telebirr_verification_jobs verification_job
     set original_expires_at = verification_job.expires_at,
         recovered_at = authorized_at,
         recovery_request_key = p_recovery_request_key,
         recovery_request_digest = request_digest,
         recovery_reason_code = p_reason_code,
         expires_at = recovered_expires_at
   where verification_job.id = job.id
     and verification_job.recovery_request_key is null
  returning verification_job.* into job;

  if job.recovery_request_key is distinct from p_recovery_request_key
    or job.recovery_request_digest is distinct from request_digest then
    raise exception 'The private live TeleBirr binding-mismatch recovery did not persist.';
  end if;

  return query
  select job.id, job.original_expires_at, job.expires_at, false;
end;
$$;

alter function app.enforce_private_live_telebirr_verification_job_recovery()
  owner to postgres;
alter function app.recover_attempted_private_live_telebirr_binding_mismatch_job(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function
  app.enforce_private_live_telebirr_verification_job_recovery(),
  app.recover_attempted_private_live_telebirr_binding_mismatch_job(
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

comment on function app.recover_attempted_private_live_telebirr_binding_mismatch_job(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, one-use recovery for one expired live TeleBirr job with exactly one expired attempt and one delivered signed assignment rejected before evidence staging by the reviewed scheme-qualified fingerprint defect. Opens at most one new five-minute verification window and requires the deposit executor to remain disabled.';

comment on function app.enforce_private_live_telebirr_verification_job_recovery() is
  'Allows only postgres-owned, one-use recovery of either a wholly unattempted assignment-runtime failure or an exact pre-evidence binding-mismatch failure. Retains the original expiry and immutable reason-specific request digest; all other updates and every delete remain rejected.';

comment on table app.private_live_telebirr_verification_jobs is
  'Private TeleBirr proof-bound verification jobs. Immutable except for one postgres-only, fully retained replacement window after either a wholly unattempted assignment-runtime failure or one exact pre-evidence binding-mismatch attempt.';

comment on function app.stage_live_tbirr_device_evidence_internal(
  uuid, text, text, text, jsonb, jsonb
) is
  'Internal live evidence staging path. Signed assignment and observation fingerprints are matched in their scheme-qualified wire form against the raw digest retained by the encrypted proof lineage.';

commit;
