-- One-use retry of the SAME live proof after a reviewed public device-pin handoff.
-- Historical signed pairs and their quarantines remain immutable. A fresh phone assignment
-- is required; this migration never accepts old evidence or creates a financial row.

create function app.private_live_telebirr_pin_handoff_evidence_digest(p_job_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  attempt_count integer;
  valid_count integer;
  enrollment_count integer;
  evidence_material text;
begin
  select count(*)::integer,
         count(*) filter (
           where attempt.attempt_number in (1, 2)
             and attempt.expires_at <= pg_catalog.clock_timestamp()
             and transcript.verification_attempt_id is not null
             and delivery.verification_attempt_id is not null
             and delivery.assignment_transcript_id = transcript.id
             and staged.verification_attempt_id is not null
             and staged.signed_assignment is not null
             and staged.signed_observation is not null
             and staged.observed_at >= attempt.issued_at
             and staged.observed_at < attempt.expires_at
             and staged.staged_at < attempt.expires_at
             and quarantine.verification_attempt_id is not null
             and quarantine.observation_body_digest = staged.observation_body_digest
             and quarantine.reason_code = 'trusted_evidence_invalid'
             and quarantine.quarantined_at >= staged.staged_at
         )::integer,
         count(distinct attempt.device_enrollment_id)::integer,
         pg_catalog.string_agg(
           attempt.id::text || ':' || transcript.assignment_body_digest || ':'
             || staged.observation_body_digest || ':'
             || quarantine.quarantined_at::text,
           E'\n' order by attempt.attempt_number
         )
    into attempt_count, valid_count, enrollment_count, evidence_material
    from app.private_live_telebirr_verification_attempts attempt
    left join app.private_live_telebirr_assignment_transcripts transcript
      on transcript.verification_attempt_id = attempt.id
    left join app.private_live_telebirr_assignment_deliveries delivery
      on delivery.verification_attempt_id = attempt.id
    left join app.private_live_telebirr_device_evidence_staging staged
      on staged.verification_attempt_id = attempt.id
    left join app.private_live_telebirr_verifier_evidence_quarantine quarantine
      on quarantine.verification_attempt_id = attempt.id
   where attempt.verification_job_id = p_job_id;

  if attempt_count <> 2 or valid_count <> 2 or enrollment_count <> 1
    or exists (
      select 1 from app.private_live_telebirr_observation_transcripts observation
      join app.private_live_telebirr_verification_attempts attempt
        on attempt.id = observation.verification_attempt_id
      where attempt.verification_job_id = p_job_id
    ) then
    return null;
  end if;
  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:pin-handoff-evidence:v1|' || evidence_material
  );
end;
$$;

-- The existing first-recovery columns and five-minute window already provide a one-use slot.
-- Extend only its reason enum and the matching first-recovery window branch. The exact source
-- hashes prevent silently patching a different production definition.
do $patch_pin_handoff_constraints$
declare
  reason_definition text;
  window_definition text;
  reason_patched text;
  window_patched text;
  reason_old constant text :=
    $reason_old$recovery_reason_code = ANY (ARRAY['assignment_runtime_unavailable'::text, 'device_evidence_binding_mismatch'::text])$reason_old$;
  reason_new constant text :=
    $reason_new$recovery_reason_code = ANY (ARRAY['assignment_runtime_unavailable'::text, 'device_evidence_binding_mismatch'::text, 'device_pin_handoff_retry'::text])$reason_new$;
begin
  select pg_catalog.pg_get_constraintdef(oid) into reason_definition
    from pg_catalog.pg_constraint
   where conrelid = 'app.private_live_telebirr_verification_jobs'::regclass
     and conname = 'private_live_telebirr_job_recovery_reason_check';
  select pg_catalog.pg_get_constraintdef(oid) into window_definition
    from pg_catalog.pg_constraint
   where conrelid = 'app.private_live_telebirr_verification_jobs'::regclass
     and conname = 'private_live_telebirr_job_window_check';

  if pg_catalog.encode(extensions.digest(pg_catalog.convert_to(reason_definition,'UTF8'),'sha256'),'hex')
       <> 'f4ace8632d2ddfc8f2640631080bf706e8b35e6922891bdc795f58ed9b6ed790'
    or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(window_definition,'UTF8'),'sha256'),'hex')
       <> 'd91df7ac889562b0bcc478135877463335bd727c4d4c640107561342f94aefce'
    or pg_catalog.strpos(reason_definition, reason_old) = 0
    or pg_catalog.strpos(window_definition, reason_old) = 0 then
    raise exception 'The live TeleBirr job constraints differ from the reviewed baseline.';
  end if;

  reason_patched := pg_catalog.replace(reason_definition, reason_old, reason_new);
  window_patched := pg_catalog.replace(window_definition, reason_old, reason_new);
  if reason_patched = reason_definition or window_patched = window_definition then
    raise exception 'The pin-handoff constraint patch was not exact.';
  end if;
  alter table app.private_live_telebirr_verification_jobs
    drop constraint private_live_telebirr_job_recovery_reason_check;
  alter table app.private_live_telebirr_verification_jobs
    drop constraint private_live_telebirr_job_window_check;
  execute 'alter table app.private_live_telebirr_verification_jobs add constraint private_live_telebirr_job_recovery_reason_check '
    || reason_patched;
  execute 'alter table app.private_live_telebirr_verification_jobs add constraint private_live_telebirr_job_window_check '
    || window_patched;
end;
$patch_pin_handoff_constraints$;

do $patch_pin_handoff_guard$
declare
  routine constant regprocedure :=
    'app.enforce_private_live_telebirr_verification_job_recovery()'::regprocedure;
  old_definition text;
  old_source text;
  patched_definition text;
  original_marker constant text := E'  if old.original_expires_at is null\n';
  guard_branch constant text := $guard$
  if new.recovery_reason_code = 'device_pin_handoff_retry' then
    if old.original_expires_at is not null
      or old.recovered_at is not null
      or old.recovery_request_key is not null
      or old.recovery_request_digest is not null
      or old.recovery_reason_code is not null
      or old.retry_recovery_request_key is not null
      or old.broker_recovery_request_key is not null
      or old.network_retry_source_job_id is not null
      or old.expires_at > new.recovered_at
      or new.original_expires_at is distinct from old.expires_at
      or new.recovered_at is null
      or new.recovered_at >= old.submitted_at + interval '24 hours'
      or new.recovery_request_key is null
      or new.recovery_request_digest is null
      or new.expires_at <= new.recovered_at + interval '60 seconds'
      or new.expires_at > new.recovered_at + interval '5 minutes'
      or (pg_catalog.to_jsonb(new) - array[
           'expires_at', 'original_expires_at', 'recovered_at',
           'recovery_request_key', 'recovery_request_digest', 'recovery_reason_code'
         ]::text[]) is distinct from
         (pg_catalog.to_jsonb(old) - array[
           'expires_at', 'original_expires_at', 'recovered_at',
           'recovery_request_key', 'recovery_request_digest', 'recovery_reason_code'
         ]::text[])
      or app.private_live_telebirr_pin_handoff_evidence_digest(old.id) is null
      or exists (
        select 1 from app.private_live_telebirr_verification_outcomes outcome
        where outcome.verification_job_id = old.id
      )
      or exists (
        select 1 from app.private_live_deposit_pilot_reservations reservation
        where reservation.private_live_deposit_pilot_proof_id =
          old.private_live_deposit_pilot_proof_id
      ) then
      raise exception 'The device-pin-handoff retry mutation is invalid.';
    end if;
    expected_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:live-device-pin-handoff-retry:v1'
      || '|request_key=' || new.recovery_request_key::text
      || '|job_id=' || new.id::text
      || '|pilot_revision_id=' || new.pilot_revision_id::text
      || '|evidence_digest=' || app.private_live_telebirr_pin_handoff_evidence_digest(old.id)
      || '|original_expires_at_us=' ||
         (extract(epoch from new.original_expires_at) * 1000000)::bigint::text
      || '|recovered_at_us=' ||
         (extract(epoch from new.recovered_at) * 1000000)::bigint::text
      || '|recovered_expires_at_us=' ||
         (extract(epoch from new.expires_at) * 1000000)::bigint::text
    );
    if new.recovery_request_digest is distinct from expected_digest then
      raise exception 'The device-pin-handoff retry digest is invalid.';
    end if;
    return new;
  end if;

$guard$;
begin
  select p.prosrc, pg_catalog.pg_get_functiondef(p.oid)
    into old_source, old_definition
    from pg_catalog.pg_proc p
   where p.oid = routine
     and p.prosecdef
     and p.proowner = (select oid from pg_catalog.pg_roles where rolname='postgres')
     and p.proconfig = array['search_path=pg_catalog']::text[]
     and p.proacl = array['postgres=X/postgres']::aclitem[];
  if old_source is null
    or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(old_source,'UTF8'),'sha256'),'hex')
       <> 'fd355332c2f6a62a44df84aaea3d97a8feedcd2580e966e43a22569fcbf7d0e3'
    or pg_catalog.strpos(old_definition, original_marker) = 0 then
    raise exception 'The live TeleBirr job guard differs from the reviewed baseline.';
  end if;
  patched_definition := pg_catalog.replace(
    old_definition, original_marker, guard_branch || original_marker
  );
  if patched_definition = old_definition then
    raise exception 'The pin-handoff guard patch was not exact.';
  end if;
  execute patched_definition;
end;
$patch_pin_handoff_guard$;

create function app.recover_private_live_telebirr_after_device_pin_handoff(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_recovery_request_key uuid,
  p_expected_device_pin text
)
returns table (
  verification_job_id uuid,
  recovered_job_expires_at timestamptz,
  already_recovered boolean
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  authorized_at timestamptz;
  retry_until timestamptz;
  job app.private_live_telebirr_verification_jobs%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  activation app.private_trusted_telebirr_activation_epochs%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  evidence_digest text;
  request_digest text;
begin
  if session_user <> 'postgres'
    or pg_catalog.current_setting('transaction_isolation') <> 'read committed'
    or p_verification_job_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null or p_activation_epoch <= 0
    or p_recovery_request_key is null
    or p_recovery_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_expected_device_pin !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'The device-pin-handoff retry request is invalid.';
  end if;

  if app.current_private_trusted_telebirr_activation_epoch()
       is distinct from p_activation_epoch then
    raise exception 'The trusted TeleBirr activation is unavailable.';
  end if;
  select * into activation from app.private_trusted_telebirr_activation_epochs e
   where e.epoch = p_activation_epoch and e.pilot_revision_id = p_pilot_revision_id
     and e.authority_state = 'active' and e.revoked_at is null for share;
  select * into job from app.private_live_telebirr_verification_jobs j
   where j.id = p_verification_job_id and j.pilot_revision_id = p_pilot_revision_id
   for update;
  select * into pilot from app.private_live_deposit_pilot_revisions r
   where r.id = p_pilot_revision_id for share;
  select * into profile from app.private_live_telebirr_receiver_profiles r
   where r.id = job.receiver_profile_id for share;
  select * into proof from app.private_live_deposit_pilot_proofs p
   where p.id = job.private_live_deposit_pilot_proof_id for share;
  select e.* into enrollment from app.private_live_telebirr_device_enrollments e
   join app.private_live_telebirr_verification_attempts a
     on a.device_enrollment_id = e.id and a.verification_job_id = job.id
   where e.pilot_revision_id = p_pilot_revision_id
   order by a.attempt_number limit 1 for share of e;

  evidence_digest := app.private_live_telebirr_pin_handoff_evidence_digest(job.id);
  authorized_at := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  retry_until := pg_catalog.date_trunc('milliseconds',least(
    authorized_at + interval '5 minutes', activation.expires_at,
    pilot.expires_at, profile.valid_until, enrollment.valid_until
  ));

  if job.id is null or proof.id is null or pilot.id is null or profile.id is null
    or activation.epoch is null or enrollment.id is null or evidence_digest is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from job.pilot_configuration_digest
    or activation.configuration_digest is distinct from pilot.configuration_digest
    or authorized_at < pilot.active_from
    or pilot.expires_at <= authorized_at + interval '5 minutes'
    or profile.pilot_revision_id is distinct from pilot.id
    or profile.valid_from > authorized_at
    or enrollment.valid_from > authorized_at
    or enrollment.public_key_spki_sha256 is distinct from p_expected_device_pin
    or retry_until <= authorized_at + interval '60 seconds'
    or job.expires_at > authorized_at
    or proof.submitted_at + interval '24 hours' <= authorized_at
    or job.original_expires_at is not null
    or job.recovery_request_key is not null
    or job.network_retry_source_job_id is not null
    or exists (select 1 from app.private_live_telebirr_device_revocations r
               where r.device_enrollment_id = enrollment.id)
    or not exists (select 1 from app.private_live_telebirr_device_heartbeats h
                   where h.device_enrollment_id = enrollment.id
                     and h.runtime_state = 'ready' and h.status_code = 'no_assignment'
                     and h.last_seen_at > authorized_at - interval '5 minutes')
    or exists (select 1 from app.private_live_telebirr_verification_outcomes o
               where o.verification_job_id = job.id)
    or exists (select 1 from app.private_live_deposit_pilot_reservations r
               where r.private_live_deposit_pilot_proof_id = proof.id)
    or exists (select 1 from app.provider_payment_evidence e
               where e.payment_provider_id = job.payment_provider_id
                 and e.canonical_reference_fingerprint = job.candidate_reference_fingerprint)
    or exists (select 1 from app.deposit_jobs d
               where d.status::text in ('queued','leased','retry_wait'))
    or exists (select 1 from pg_catalog.pg_roles r
               where r.rolname in ('fetanagent_deposit_executor','fetanagent_deposit_executor_runtime')
                 and r.rolcanlogin)
    or exists (select 1 from pg_catalog.pg_stat_activity a
               where a.usename in ('fetanagent_deposit_executor','fetanagent_deposit_executor_runtime'))
    or not exists (select 1 from app.agent_platform_companion_execution_control c
                   where c.singleton and c.control_state = 'disabled')
    or (select count(*) from app.feature_switches s
        where s.feature_key in ('payment_verification','private_live_deposit_pilot',
          'telebirr_authoritative_verification','deposit_execution') and s.mode='live') <> 4
    or (select count(*) from app.feature_switches s
        where s.feature_key in ('cbe_birr_authoritative_verification',
          'withdrawal_collection','withdrawal_validation') and s.mode='disabled') <> 3 then
    raise exception 'The quarantined live proof is not safely retryable.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:live-device-pin-handoff-retry:v1'
    || '|request_key=' || p_recovery_request_key::text
    || '|job_id=' || job.id::text
    || '|pilot_revision_id=' || job.pilot_revision_id::text
    || '|evidence_digest=' || evidence_digest
    || '|original_expires_at_us=' ||
       (extract(epoch from job.expires_at) * 1000000)::bigint::text
    || '|recovered_at_us=' ||
       (extract(epoch from authorized_at) * 1000000)::bigint::text
    || '|recovered_expires_at_us=' ||
       (extract(epoch from retry_until) * 1000000)::bigint::text
  );

  update app.private_live_telebirr_verification_jobs j
     set original_expires_at = j.expires_at,
         recovered_at = authorized_at,
         recovery_request_key = p_recovery_request_key,
         recovery_request_digest = request_digest,
         recovery_reason_code = 'device_pin_handoff_retry',
         expires_at = retry_until
   where j.id = job.id and j.recovery_request_key is null;
  if not found then
    raise exception 'The one-use pin-handoff retry changed before commit.';
  end if;
  insert into app.audit_events(actor_kind,action,resource_type,resource_id,metadata)
  values ('system','verification.telebirr_device_pin_handoff_retry',
          'private_live_telebirr_verification_job',job.id,
          pg_catalog.jsonb_build_object('proof_id',proof.id,
            'pilot_revision_id',pilot.id,'evidence_digest',evidence_digest,
            'recovery_request_digest',request_digest,'financial_actions_enabled',false));
  return query select job.id,retry_until,false;
end;
$$;

alter function app.private_live_telebirr_pin_handoff_evidence_digest(uuid) owner to postgres;
alter function app.recover_private_live_telebirr_after_device_pin_handoff(
  uuid,uuid,bigint,uuid,text) owner to postgres;
revoke all on function app.private_live_telebirr_pin_handoff_evidence_digest(uuid),
  app.recover_private_live_telebirr_after_device_pin_handoff(uuid,uuid,bigint,uuid,text)
from public, anon, authenticated, service_role;

comment on function app.recover_private_live_telebirr_after_device_pin_handoff(
  uuid,uuid,bigint,uuid,text) is
  'Postgres-only, one-use extension of the original live proof after an externally verified public device-pin handoff. Prior quarantines remain; a new signed assignment and observation are required. No execution authority is granted.';
