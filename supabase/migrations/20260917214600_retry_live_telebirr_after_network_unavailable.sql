-- Preserve the terminal live verification outcome while permitting one separately-audited retry
-- job when the signed device observation proves that the official receipt lookup failed only
-- because the phone's network path was unavailable. The retry remains PostgreSQL-only, creates
-- no financial row, and is impossible while either KemerBet executor role can log in or is
-- connected.

alter table app.private_live_telebirr_verification_jobs
  add column network_retry_source_job_id uuid;

alter table app.private_live_telebirr_verification_jobs
  add column network_retry_request_key uuid;

alter table app.private_live_telebirr_verification_jobs
  add column network_retry_request_digest text;

alter table app.private_live_telebirr_verification_jobs
  add column network_retry_reason_code text;

alter table app.private_live_telebirr_verification_jobs
  add column network_retry_authorized_at timestamptz;

alter table app.private_live_telebirr_verification_jobs
  add constraint private_live_telebirr_job_network_retry_shape_check check (
    (
      network_retry_source_job_id is null
      and network_retry_request_key is null
      and network_retry_request_digest is null
      and network_retry_reason_code is null
      and network_retry_authorized_at is null
    )
    or
    (
      network_retry_source_job_id is not null
      and network_retry_source_job_id <> id
      and network_retry_request_key is not null
      and network_retry_request_key::text
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and network_retry_request_digest
        ~ '^sha256:[0-9a-f]{64}$'
      and network_retry_reason_code = 'official_receipt_network_unavailable'
      and network_retry_authorized_at is not null
      and submitted_at = network_retry_authorized_at
      and not_before = network_retry_authorized_at
      and expires_at > network_retry_authorized_at + interval '60 seconds'
      and expires_at <= network_retry_authorized_at + interval '5 minutes'
    )
  );

alter table app.private_live_telebirr_verification_jobs
  add constraint private_live_telebirr_job_network_retry_source_fkey
  foreign key (network_retry_source_job_id)
  references app.private_live_telebirr_verification_jobs (id)
  on delete restrict;

alter table app.private_live_telebirr_verification_jobs
  drop constraint private_live_telebirr_verific_private_live_deposit_pilot_pr_key;

create unique index private_live_telebirr_jobs_original_proof_uidx
  on app.private_live_telebirr_verification_jobs (private_live_deposit_pilot_proof_id)
  where network_retry_source_job_id is null;

create unique index private_live_telebirr_jobs_network_retry_proof_uidx
  on app.private_live_telebirr_verification_jobs (private_live_deposit_pilot_proof_id)
  where network_retry_source_job_id is not null;

create unique index private_live_telebirr_jobs_network_retry_source_uidx
  on app.private_live_telebirr_verification_jobs (network_retry_source_job_id)
  where network_retry_source_job_id is not null;

create unique index private_live_telebirr_jobs_network_retry_key_uidx
  on app.private_live_telebirr_verification_jobs (network_retry_request_key)
  where network_retry_request_key is not null;

create unique index private_live_telebirr_jobs_network_retry_digest_uidx
  on app.private_live_telebirr_verification_jobs (network_retry_request_digest)
  where network_retry_request_digest is not null;

-- Keep the customer-visible Telegram status bound to the latest authorized job while retaining
-- the immutable intake receipt's original job id. Patch only the exact reviewed production source
-- and preserve the function owner, ACL, security-definer flag, and fixed search path.
do $patch_live_telebirr_status$
declare
  routine_signature constant regprocedure :=
    pg_catalog.to_regprocedure('app.get_telegram_customer_live_telebirr_proof(uuid,uuid)');
  expected_source_sha256 constant text :=
    '8da3d728ae7fef5b6db54408cb410af448a63e5c0d84df14127b430ba881382f';
  expected_patched_source_sha256 constant text :=
    '37531e5f4e5f21b9477a663661e4049d1c420540ebd16c24cb2f975c7c90b12d';
  old_fragment constant text := $old$
    join app.private_live_telebirr_verification_jobs job
      on job.id = receipt.live_verification_job_id
     and job.private_live_deposit_pilot_proof_id = proof.id
    left join app.private_live_telebirr_verification_outcomes outcome
      on outcome.verification_job_id = job.id
     and outcome.private_live_deposit_pilot_proof_id = proof.id
$old$;
  new_fragment constant text := $new$
    join app.private_live_telebirr_verification_jobs source_job
      on source_job.id = receipt.live_verification_job_id
     and source_job.private_live_deposit_pilot_proof_id = proof.id
    left join app.private_live_telebirr_verification_jobs retry_job
      on retry_job.network_retry_source_job_id = source_job.id
     and retry_job.private_live_deposit_pilot_proof_id = proof.id
    join app.private_live_telebirr_verification_jobs job
      on job.id = coalesce(retry_job.id, source_job.id)
    left join app.private_live_telebirr_verification_outcomes outcome
      on outcome.verification_job_id = job.id
     and outcome.private_live_deposit_pilot_proof_id = proof.id
$new$;
  original_source text;
  original_definition text;
  original_owner oid;
  original_acl aclitem[];
  patched_source text;
  patched_definition text;
  source_marker_count integer;
  definition_marker_count integer;
begin
  select routine.prosrc,
         pg_catalog.pg_get_functiondef(routine.oid),
         routine.proowner,
         routine.proacl
    into original_source,
         original_definition,
         original_owner,
         original_acl
    from pg_catalog.pg_proc routine
   where routine.oid = routine_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and routine.proretset
     and routine.pronargs = 2
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array[
       'postgres=X/postgres',
       'fetanagent_player_actions=X/postgres'
     ]::aclitem[];

  source_marker_count := (
    pg_catalog.length(original_source)
      - pg_catalog.length(pg_catalog.replace(original_source, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);
  definition_marker_count := (
    pg_catalog.length(original_definition)
      - pg_catalog.length(pg_catalog.replace(original_definition, old_fragment, ''))
  ) / pg_catalog.length(old_fragment);

  if original_source is null
    or original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) is distinct from expected_source_sha256
    or source_marker_count <> 1
    or definition_marker_count <> 1 then
    raise exception 'The Telegram live TeleBirr status function does not match the reviewed source.';
  end if;

  patched_source := pg_catalog.replace(original_source, old_fragment, new_fragment);
  patched_definition := pg_catalog.replace(original_definition, old_fragment, new_fragment);

  if pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(patched_source, 'UTF8'), 'sha256'),
       'hex'
     ) is distinct from expected_patched_source_sha256 then
    raise exception 'The Telegram live TeleBirr status patch is not the reviewed replacement.';
  end if;

  execute patched_definition;

  if not exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.oid = routine_signature
       and routine.prosrc = patched_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prokind = 'f'
       and routine.prosecdef
       and routine.proretset
       and routine.pronargs = 2
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The Telegram live TeleBirr status patch changed function authority.';
  end if;
end;
$patch_live_telebirr_status$;

create function app.private_live_telebirr_network_retry_digest(
  p_request_key uuid,
  p_source_job_id uuid,
  p_source_outcome_id uuid,
  p_replacement_job_id uuid,
  p_proof_id uuid,
  p_pilot_revision_id uuid,
  p_authorized_at timestamptz,
  p_expires_at timestamptz,
  p_reason_code text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
begin
  if p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_source_job_id is null
    or p_source_outcome_id is null
    or p_replacement_job_id is null
    or p_source_job_id = p_replacement_job_id
    or p_proof_id is null
    or p_pilot_revision_id is null
    or p_authorized_at is null
    or p_expires_at <= p_authorized_at + interval '60 seconds'
    or p_expires_at > p_authorized_at + interval '5 minutes'
    or p_reason_code is distinct from 'official_receipt_network_unavailable' then
    raise exception 'The private live TeleBirr network retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:official-receipt-network-retry:v1'
      || '|request_key=' || p_request_key::text
      || '|source_job_id=' || p_source_job_id::text
      || '|source_outcome_id=' || p_source_outcome_id::text
      || '|replacement_job_id=' || p_replacement_job_id::text
      || '|proof_id=' || p_proof_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|authorized_at_us=' || (
        extract(epoch from p_authorized_at) * 1000000
      )::bigint::text
      || '|expires_at_us=' || (
        extract(epoch from p_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create function app.enforce_private_live_telebirr_network_retry_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  expected_digest text;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  source_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  source_outcome_count integer;
begin
  if new.network_retry_source_job_id is null
    and new.network_retry_request_key is null
    and new.network_retry_request_digest is null
    and new.network_retry_reason_code is null
    and new.network_retry_authorized_at is null then
    return new;
  end if;

  if session_user <> 'postgres'
    or new.network_retry_source_job_id is null
    or new.network_retry_request_key is null
    or new.network_retry_request_digest is null
    or new.network_retry_reason_code is distinct from
       'official_receipt_network_unavailable'
    or new.network_retry_authorized_at is null
    or new.id is null
    or new.id = new.network_retry_source_job_id
    or new.enqueue_request_key is distinct from new.network_retry_request_key
    or new.submitted_at is distinct from new.network_retry_authorized_at
    or new.not_before is distinct from new.network_retry_authorized_at
    or new.original_expires_at is not null
    or new.recovered_at is not null
    or new.recovery_request_key is not null
    or new.recovery_request_digest is not null
    or new.recovery_reason_code is not null
    or new.retry_original_expires_at is not null
    or new.retry_recovered_at is not null
    or new.retry_recovery_request_key is not null
    or new.retry_recovery_request_digest is not null
    or new.retry_recovery_reason_code is not null
    or new.broker_original_expires_at is not null
    or new.broker_recovered_at is not null
    or new.broker_recovery_request_key is not null
    or new.broker_recovery_request_digest is not null
    or new.broker_recovery_reason_code is not null then
    raise exception 'The private live TeleBirr network retry job insert is invalid.';
  end if;

  select job.*
    into source_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = new.network_retry_source_job_id
   for share;

  select pg_catalog.count(*)::integer
    into source_outcome_count
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = source_job.id;

  select outcome.*
    into source_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_job_id = source_job.id
     and outcome.disposition = 'review_required'
     and outcome.reason_code = 'source_unavailable'
   order by outcome.created_at, outcome.id
   limit 1
   for share;

  if source_job.id is null
    or source_job.network_retry_source_job_id is not null
    or source_outcome_count <> 1
    or source_outcome.id is null
    or source_outcome.private_live_deposit_pilot_proof_id is distinct from
       source_job.private_live_deposit_pilot_proof_id
    or (
      pg_catalog.to_jsonb(new) - array[
        'id',
        'enqueue_request_key',
        'enqueue_request_digest',
        'submitted_at',
        'not_before',
        'expires_at',
        'created_at',
        'original_expires_at',
        'recovered_at',
        'recovery_request_key',
        'recovery_request_digest',
        'recovery_reason_code',
        'retry_original_expires_at',
        'retry_recovered_at',
        'retry_recovery_request_key',
        'retry_recovery_request_digest',
        'retry_recovery_reason_code',
        'broker_original_expires_at',
        'broker_recovered_at',
        'broker_recovery_request_key',
        'broker_recovery_request_digest',
        'broker_recovery_reason_code',
        'network_retry_source_job_id',
        'network_retry_request_key',
        'network_retry_request_digest',
        'network_retry_reason_code',
        'network_retry_authorized_at'
      ]::text[]
    ) is distinct from (
      pg_catalog.to_jsonb(source_job) - array[
        'id',
        'enqueue_request_key',
        'enqueue_request_digest',
        'submitted_at',
        'not_before',
        'expires_at',
        'created_at',
        'original_expires_at',
        'recovered_at',
        'recovery_request_key',
        'recovery_request_digest',
        'recovery_reason_code',
        'retry_original_expires_at',
        'retry_recovered_at',
        'retry_recovery_request_key',
        'retry_recovery_request_digest',
        'retry_recovery_reason_code',
        'broker_original_expires_at',
        'broker_recovered_at',
        'broker_recovery_request_key',
        'broker_recovery_request_digest',
        'broker_recovery_reason_code',
        'network_retry_source_job_id',
        'network_retry_request_key',
        'network_retry_request_digest',
        'network_retry_reason_code',
        'network_retry_authorized_at'
      ]::text[]
    )
    or exists (
      select 1
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id =
             source_job.private_live_deposit_pilot_proof_id
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
    raise exception 'The private live TeleBirr network retry job insert is invalid.';
  end if;

  expected_digest := app.private_live_telebirr_network_retry_digest(
    new.network_retry_request_key,
    source_job.id,
    source_outcome.id,
    new.id,
    new.private_live_deposit_pilot_proof_id,
    new.pilot_revision_id,
    new.network_retry_authorized_at,
    new.expires_at,
    new.network_retry_reason_code
  );

  if new.network_retry_request_digest is distinct from expected_digest
    or new.enqueue_request_digest is distinct from expected_digest then
    raise exception 'The private live TeleBirr network retry job digest is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_network_retry_insert_guard
before insert on app.private_live_telebirr_verification_jobs
for each row execute function app.enforce_private_live_telebirr_network_retry_insert();

create function app.reject_private_live_telebirr_network_retry_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private live TeleBirr network retry jobs are immutable.';
end;
$$;

create trigger private_live_telebirr_network_retry_immutable
before update or delete on app.private_live_telebirr_verification_jobs
for each row
when (old.network_retry_source_job_id is not null)
execute function app.reject_private_live_telebirr_network_retry_mutation();

create function app.retry_private_live_telebirr_after_network_unavailable(
  p_source_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_retry_request_key uuid,
  p_reason_code text
)
returns table (
  source_verification_job_id uuid,
  replacement_verification_job_id uuid,
  replacement_expires_at timestamptz,
  already_retried boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  active_epoch bigint;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  replacement_job app.private_live_telebirr_verification_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  delivery app.private_live_telebirr_assignment_deliveries%rowtype;
  staged app.private_live_telebirr_device_evidence_staging%rowtype;
  observation app.private_live_telebirr_observation_transcripts%rowtype;
  outcome app.private_live_telebirr_verification_outcomes%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  heartbeat app.private_live_telebirr_device_heartbeats%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  attempt_count integer;
  outcome_count integer;
  authorized_at timestamptz;
  replacement_id uuid;
  replacement_expiry timestamptz;
  request_digest text;
begin
  if session_user <> 'postgres'
    or p_source_verification_job_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null
    or p_activation_epoch <= 0
    or p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from 'official_receipt_network_unavailable' then
    raise exception 'The private live TeleBirr network retry request is invalid.';
  end if;

  active_epoch := app.current_private_trusted_telebirr_activation_epoch();
  if active_epoch is distinct from p_activation_epoch then
    raise exception 'The trusted TeleBirr activation epoch is not currently authorized.';
  end if;

  select job.*
    into source_job
    from app.private_live_telebirr_verification_jobs job
   where job.id = p_source_verification_job_id
     and job.pilot_revision_id = p_pilot_revision_id
   for update;

  select pg_catalog.count(*)::integer
    into outcome_count
    from app.private_live_telebirr_verification_outcomes source_outcome
   where source_outcome.verification_job_id = source_job.id;

  select source_outcome.*
    into outcome
    from app.private_live_telebirr_verification_outcomes source_outcome
   where source_outcome.verification_job_id = source_job.id
     and source_outcome.disposition = 'review_required'
     and source_outcome.reason_code = 'source_unavailable'
   order by source_outcome.created_at, source_outcome.id
   limit 1
   for share;

  select job.*
    into replacement_job
    from app.private_live_telebirr_verification_jobs job
   where job.network_retry_source_job_id = source_job.id
      or job.network_retry_request_key = p_retry_request_key
   order by job.created_at, job.id
   limit 1
   for share;

  if replacement_job.id is not null then
    request_digest := app.private_live_telebirr_network_retry_digest(
      replacement_job.network_retry_request_key,
      source_job.id,
      outcome.id,
      replacement_job.id,
      replacement_job.private_live_deposit_pilot_proof_id,
      replacement_job.pilot_revision_id,
      replacement_job.network_retry_authorized_at,
      replacement_job.expires_at,
      replacement_job.network_retry_reason_code
    );

    if replacement_job.network_retry_source_job_id is distinct from source_job.id
      or replacement_job.network_retry_request_key is distinct from p_retry_request_key
      or replacement_job.network_retry_reason_code is distinct from p_reason_code
      or replacement_job.network_retry_request_digest is distinct from request_digest
      or replacement_job.enqueue_request_key is distinct from p_retry_request_key
      or replacement_job.enqueue_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr network retry replay conflicts.';
    end if;

    return query
    select source_job.id, replacement_job.id, replacement_job.expires_at, true;
    return;
  end if;

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
   where pilot_revision.id = p_pilot_revision_id
   for share;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = source_job.private_live_deposit_pilot_proof_id
     and proof_row.pilot_revision_id = p_pilot_revision_id
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = source_job.receiver_profile_id
     and receiver_profile.pilot_revision_id = p_pilot_revision_id
   for share;

  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = outcome.verification_attempt_id
     and verification_attempt.verification_job_id = source_job.id
     and verification_attempt.attempt_number = 3
   for share;

  select pg_catalog.count(*)::integer
    into attempt_count
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = source_job.id;

  select assignment_transcript.*
    into transcript
    from app.private_live_telebirr_assignment_transcripts assignment_transcript
   where assignment_transcript.verification_attempt_id = attempt.id
   for share;

  select assignment_delivery.*
    into delivery
    from app.private_live_telebirr_assignment_deliveries assignment_delivery
   where assignment_delivery.verification_attempt_id = attempt.id
     and assignment_delivery.assignment_transcript_id = transcript.id
   for share;

  select evidence.*
    into staged
    from app.private_live_telebirr_device_evidence_staging evidence
   where evidence.verification_attempt_id = attempt.id
     and evidence.assignment_transcript_id = transcript.id
   for share;

  select observation_transcript.*
    into observation
    from app.private_live_telebirr_observation_transcripts observation_transcript
   where observation_transcript.id = outcome.observation_transcript_id
     and observation_transcript.verification_attempt_id = attempt.id
     and observation_transcript.assignment_transcript_id = transcript.id
   for share;

  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = attempt.device_enrollment_id
     and device_enrollment.pilot_revision_id = p_pilot_revision_id
     and device_enrollment.receiver_profile_id = profile.id
   for share;

  select device_heartbeat.*
    into heartbeat
    from app.private_live_telebirr_device_heartbeats device_heartbeat
   where device_heartbeat.device_enrollment_id = enrollment.id
   for share;

  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.id = transcript.assignment_signer_id
   for share;

  authorized_at := pg_catalog.clock_timestamp();
  replacement_id := pg_catalog.gen_random_uuid();
  replacement_expiry := least(
    authorized_at + interval '5 minutes',
    authority.expires_at,
    pilot.expires_at,
    profile.valid_until,
    enrollment.valid_until,
    signer.valid_until
  );

  if source_job.id is null
    or source_job.network_retry_source_job_id is not null
    or source_job.recovery_reason_code is distinct from 'device_evidence_binding_mismatch'
    or source_job.retry_recovery_reason_code is distinct from
       'assignment_reference_binding_uniqueness'
    or source_job.broker_recovery_reason_code is distinct from
       'assignment_broker_runtime_unavailable'
    or outcome_count <> 1
    or outcome.id is null
    or outcome.private_live_deposit_pilot_proof_id is distinct from proof.id
    or outcome.pilot_revision_id is distinct from p_pilot_revision_id
    or outcome.disposition is distinct from 'review_required'
    or outcome.reason_code is distinct from 'source_unavailable'
    or outcome.deposit_intent_id is not null
    or outcome.deposit_submission_id is not null
    or outcome.provider_payment_evidence_id is not null
    or outcome.deposit_verification_attempt_id is not null
    or attempt_count <> 3
    or attempt.id is null
    or transcript.id is null
    or delivery.verification_attempt_id is null
    or staged.verification_attempt_id is null
    or observation.id is null
    or observation.id is distinct from outcome.observation_transcript_id
    or staged.observation_body_digest is distinct from observation.observation_body_digest
    or staged.signed_observation #>> '{body,facts,lookupOutcome}'
       is distinct from 'review_required'
    or staged.signed_observation #>> '{body,facts,reviewReason}'
       is distinct from 'network_unavailable'
    or authority.epoch is null
    or pilot.id is null
    or profile.id is null
    or proof.id is null
    or enrollment.id is null
    or heartbeat.device_enrollment_id is null
    or signer.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or source_job.pilot_configuration_digest is distinct from pilot.configuration_digest
    or source_job.provider_code <> 'telebirr'
    or proof.provider_code_snapshot <> 'telebirr'
    or authorized_at >= proof.submitted_at + interval '24 hours'
    or authorized_at < profile.valid_from
    or authorized_at >= profile.valid_until
    or authorized_at < enrollment.valid_from
    or authorized_at >= enrollment.valid_until
    or authorized_at < signer.valid_from
    or authorized_at >= signer.valid_until
    or replacement_expiry <= authorized_at + interval '60 seconds'
    or heartbeat.runtime_state <> 'ready'
    or heartbeat.status_code <> 'no_assignment'
    or heartbeat.last_seen_at < outcome.created_at
    or heartbeat.last_seen_at <= authorized_at - interval '6 minutes'
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
        from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = proof.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id = outcome.id
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
    )
    or (
      select pg_catalog.count(*)
        from pg_catalog.pg_stat_activity activity
       where activity.usename = 'fetanagent_telebirr_assignment_broker_runtime'
    ) <> 1
    or (
      select pg_catalog.count(*)
        from pg_catalog.pg_stat_activity activity
       where activity.usename = 'fetanagent_telebirr_assignment_broker_runtime'
         and activity.query_start > authorized_at - interval '15 seconds'
         and exists (
           select 1
             from pg_catalog.pg_locks advisory_lock
            where advisory_lock.pid = activity.pid
              and advisory_lock.locktype = 'advisory'
              and advisory_lock.database = (
                select database.oid
                  from pg_catalog.pg_database database
                 where database.datname = pg_catalog.current_database()
              )
              and advisory_lock.classid = 1178948673::integer
              and advisory_lock.objid = 1413632594::integer
              and advisory_lock.objsubid = 2
              and advisory_lock.granted
         )
    ) <> 1 then
    raise exception 'The private live TeleBirr network retry authority is unavailable.';
  end if;

  request_digest := app.private_live_telebirr_network_retry_digest(
    p_retry_request_key,
    source_job.id,
    outcome.id,
    replacement_id,
    proof.id,
    p_pilot_revision_id,
    authorized_at,
    replacement_expiry,
    p_reason_code
  );

  insert into app.private_live_telebirr_verification_jobs (
    id,
    enqueue_request_key,
    enqueue_request_digest,
    private_live_deposit_pilot_proof_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    provider_code,
    receiver_profile_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    receiver_profile_digest,
    receiver_configuration_digest,
    receiver_identity_digest,
    expected_receiver_name_digest,
    deposit_policy_version_id,
    deposit_policy_version,
    minimum_principal_amount_minor,
    maximum_principal_amount_minor,
    policy_digest,
    candidate_reference_fingerprint,
    reference_encryption_key_version,
    reference_profile_version,
    submitted_at,
    not_before,
    expires_at,
    created_at,
    network_retry_source_job_id,
    network_retry_request_key,
    network_retry_request_digest,
    network_retry_reason_code,
    network_retry_authorized_at
  ) values (
    replacement_id,
    p_retry_request_key,
    request_digest,
    source_job.private_live_deposit_pilot_proof_id,
    source_job.pilot_revision_id,
    source_job.submitting_customer_id,
    source_job.player_account_id,
    source_job.payment_provider_id,
    source_job.provider_code,
    source_job.receiver_profile_id,
    source_job.receiver_account_id,
    source_job.receiver_account_version,
    source_job.pilot_configuration_digest,
    source_job.receiver_profile_digest,
    source_job.receiver_configuration_digest,
    source_job.receiver_identity_digest,
    source_job.expected_receiver_name_digest,
    source_job.deposit_policy_version_id,
    source_job.deposit_policy_version,
    source_job.minimum_principal_amount_minor,
    source_job.maximum_principal_amount_minor,
    source_job.policy_digest,
    source_job.candidate_reference_fingerprint,
    source_job.reference_encryption_key_version,
    source_job.reference_profile_version,
    authorized_at,
    authorized_at,
    replacement_expiry,
    authorized_at,
    source_job.id,
    p_retry_request_key,
    request_digest,
    p_reason_code,
    authorized_at
  )
  returning * into replacement_job;

  return query
  select source_job.id, replacement_job.id, replacement_job.expires_at, false;
end;
$$;

alter function app.private_live_telebirr_network_retry_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text
) owner to postgres;
alter function app.enforce_private_live_telebirr_network_retry_insert() owner to postgres;
alter function app.reject_private_live_telebirr_network_retry_mutation() owner to postgres;
alter function app.retry_private_live_telebirr_after_network_unavailable(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function app.private_live_telebirr_network_retry_digest(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function app.enforce_private_live_telebirr_network_retry_insert()
  from public, anon, authenticated, service_role;
revoke all on function app.reject_private_live_telebirr_network_retry_mutation()
  from public, anon, authenticated, service_role;
revoke all on function app.retry_private_live_telebirr_after_network_unavailable(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated, service_role,
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
  fetanagent_telebirr_assignment_broker,
  fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_telebirr_device_state,
  fetanagent_telebirr_device_state_runtime;

comment on column app.private_live_telebirr_verification_jobs.network_retry_source_job_id is
  'Immutable source job for the single live retry after signed official-receipt network unavailability.';
comment on function app.retry_private_live_telebirr_after_network_unavailable(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, idempotent creation of one five-minute replacement verification job after an immutable review_required/source_unavailable outcome whose signed device evidence says network_unavailable. Creates no attempt, evidence, outcome, reservation, settlement, or execution job itself.';
