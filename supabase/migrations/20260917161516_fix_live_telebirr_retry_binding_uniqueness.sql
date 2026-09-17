-- Permit a signed TeleBirr assignment retry to retain the same provider-reference binding as the
-- earlier attempt for the same verification job. The original global UNIQUE constraint made that
-- legitimate retry impossible. A new immutable registry keeps the replay boundary at the job: one
-- digest may be reused by that job's attempts, but can never be attached to a different job.
--
-- The postgres-only recovery routine opens one final bounded verification window for the exact
-- two-attempt production shape stranded by the old uniqueness constraint. It creates no evidence,
-- outcome, claim, reservation, settlement, deposit job, executor authority, or feature-switch
-- change. Normal broker, device, verification, duplicate, policy, and settlement guards remain in
-- force, and the KemerBet executor must have neither a login-capable role nor an active session.

begin;

do $guard_reviewed_predecessor$
declare
  recovery_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.enforce_private_live_telebirr_verification_job_recovery()'
  );
  expected_recovery_guard_source_sha256 constant text :=
    'add740d5b0efde9fa5b9f14b624340474a0bcc47618011469d230f82672a95be';
  actual_recovery_guard_source_sha256 text;
  binding_constraint_definition text;
begin
  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into actual_recovery_guard_source_sha256
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

  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    into binding_constraint_definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'app.private_live_telebirr_assignment_transcripts'::regclass
     and constraint_row.conname =
         'private_live_telebirr_assignment_t_reference_binding_digest_key'
     and constraint_row.contype = 'u';

  if recovery_guard_signature is null
    or actual_recovery_guard_source_sha256 is distinct from
       expected_recovery_guard_source_sha256
    or binding_constraint_definition is distinct from
       'UNIQUE (reference_binding_digest)' then
    raise exception 'The reviewed live TeleBirr retry predecessor does not match.';
  end if;
end;
$guard_reviewed_predecessor$;

lock table app.private_live_telebirr_assignment_transcripts
  in access exclusive mode;
lock table app.private_live_telebirr_verification_attempts
  in share mode;

create table app.private_live_telebirr_assignment_reference_bindings (
  reference_binding_digest text primary key
    check (reference_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  verification_job_id uuid not null
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  first_verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  registered_at timestamptz not null default clock_timestamp()
);

do $guard_reference_binding_backfill$
begin
  if exists (
    select transcript.reference_binding_digest
      from app.private_live_telebirr_assignment_transcripts transcript
      join app.private_live_telebirr_verification_attempts attempt
        on attempt.id = transcript.verification_attempt_id
     group by transcript.reference_binding_digest
    having pg_catalog.count(distinct attempt.verification_job_id) <> 1
  ) then
    raise exception 'An existing TeleBirr reference binding spans verification jobs.';
  end if;
end;
$guard_reference_binding_backfill$;

insert into app.private_live_telebirr_assignment_reference_bindings (
  reference_binding_digest,
  verification_job_id,
  first_verification_attempt_id,
  registered_at
)
select transcript.reference_binding_digest,
       attempt.verification_job_id,
       transcript.verification_attempt_id,
       transcript.created_at
  from app.private_live_telebirr_assignment_transcripts transcript
  join app.private_live_telebirr_verification_attempts attempt
    on attempt.id = transcript.verification_attempt_id;

create function app.enforce_private_live_telebirr_assignment_reference_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_job_id uuid;
  registered_job_id uuid;
begin
  select attempt.verification_job_id
    into resolved_job_id
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.id = new.verification_attempt_id
   for share;

  if resolved_job_id is null then
    raise exception 'The TeleBirr assignment reference-binding job is unavailable.';
  end if;

  insert into app.private_live_telebirr_assignment_reference_bindings (
    reference_binding_digest,
    verification_job_id,
    first_verification_attempt_id
  )
  values (
    new.reference_binding_digest,
    resolved_job_id,
    new.verification_attempt_id
  )
  on conflict (reference_binding_digest) do nothing;

  select binding.verification_job_id
    into registered_job_id
    from app.private_live_telebirr_assignment_reference_bindings binding
   where binding.reference_binding_digest = new.reference_binding_digest
   for update;

  if registered_job_id is distinct from resolved_job_id then
    raise exception 'The TeleBirr assignment reference binding belongs to another verification job.';
  end if;

  return new;
end;
$$;

alter function app.enforce_private_live_telebirr_assignment_reference_binding()
  owner to postgres;
revoke all on function app.enforce_private_live_telebirr_assignment_reference_binding()
from public;

create trigger private_live_telebirr_assignment_reference_binding_guard
before insert on app.private_live_telebirr_assignment_transcripts
for each row execute function app.enforce_private_live_telebirr_assignment_reference_binding();

alter table app.private_live_telebirr_assignment_transcripts
  drop constraint private_live_telebirr_assignment_t_reference_binding_digest_key;

create index private_live_tbirr_assignment_reference_binding_idx
  on app.private_live_telebirr_assignment_transcripts (reference_binding_digest);

alter table app.private_live_telebirr_assignment_transcripts
  add constraint private_live_tbirr_assignment_reference_binding_fkey
  foreign key (reference_binding_digest)
  references app.private_live_telebirr_assignment_reference_bindings (
    reference_binding_digest
  ) on delete restrict;

create trigger private_live_telebirr_assignment_reference_bindings_immutable
before update or delete on app.private_live_telebirr_assignment_reference_bindings
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_telebirr_assignment_reference_bindings_no_truncate
before truncate on app.private_live_telebirr_assignment_reference_bindings
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.private_live_telebirr_assignment_reference_bindings
  enable row level security;
alter table app.private_live_telebirr_assignment_reference_bindings
  force row level security;
alter table app.private_live_telebirr_assignment_reference_bindings
  owner to postgres;

revoke all privileges on table
  app.private_live_telebirr_assignment_reference_bindings
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

alter table app.private_live_telebirr_verification_jobs
  drop constraint private_live_telebirr_job_window_check;

alter table app.private_live_telebirr_verification_jobs
  add column retry_original_expires_at timestamptz,
  add column retry_recovered_at timestamptz,
  add column retry_recovery_request_key uuid,
  add column retry_recovery_request_digest text,
  add column retry_recovery_reason_code text,
  add constraint private_live_telebirr_job_retry_recovery_request_key_v4_check check (
    retry_recovery_request_key is null
    or retry_recovery_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint private_live_telebirr_job_retry_recovery_request_digest_check check (
    retry_recovery_request_digest is null
    or retry_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint private_live_telebirr_job_retry_recovery_reason_check check (
    retry_recovery_reason_code is null
    or retry_recovery_reason_code = 'assignment_reference_binding_uniqueness'
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
    )
  );

create unique index private_live_telebirr_jobs_retry_recovery_request_key_idx
  on app.private_live_telebirr_verification_jobs (retry_recovery_request_key)
  where retry_recovery_request_key is not null;

create unique index private_live_telebirr_jobs_retry_recovery_request_digest_idx
  on app.private_live_telebirr_verification_jobs (retry_recovery_request_digest)
  where retry_recovery_request_digest is not null;

-- Preserve the original binding-mismatch recovery's idempotent replay after the final window is
-- opened. Its immutable first-window expiry now lives in retry_original_expires_at rather than in
-- expires_at, so only the already-recovered digest and return projection need that fallback.
do $preserve_binding_mismatch_recovery_replay$
declare
  recovery_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.recover_attempted_private_live_telebirr_binding_mismatch_job(uuid,uuid,bigint,uuid,text)'
  );
  expected_source_sha256 constant text :=
    'e317bb957244136f17244d6b64716fc842c8eac5a18d7a5b576a7771187010d8';
  expected_corrected_source_sha256 constant text :=
    'db61cf239b113c97d95ef0ee589dd32702cdd4db2ab27d5d6d727cf277771f10';
  old_digest_fragment constant text := $old_digest$        || '|recovered_expires_at_us=' || (
          extract(epoch from job.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || job.recovery_reason_code$old_digest$;
  new_digest_fragment constant text := $new_digest$        || '|recovered_expires_at_us=' || (
          extract(
            epoch from coalesce(job.retry_original_expires_at, job.expires_at)
          ) * 1000000
        )::bigint::text
        || '|reason_code=' || job.recovery_reason_code$new_digest$;
  old_return_fragment constant text := $old_return$    return query
    select job.id, job.original_expires_at, job.expires_at, true;
    return;$old_return$;
  new_return_fragment constant text := $new_return$    return query
    select job.id,
           job.original_expires_at,
           coalesce(job.retry_original_expires_at, job.expires_at),
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
    raise exception 'The attempted TeleBirr binding-mismatch recovery does not match the reviewed source.';
  end if;

  corrected_definition := pg_catalog.replace(
    pg_catalog.replace(
      original_definition,
      old_digest_fragment,
      new_digest_fragment
    ),
    old_return_fragment,
    new_return_fragment
  );
  corrected_source := pg_catalog.replace(
    pg_catalog.replace(
      original_source,
      old_digest_fragment,
      new_digest_fragment
    ),
    old_return_fragment,
    new_return_fragment
  );
  corrected_source_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(corrected_source, 'UTF8'), 'sha256'),
    'hex'
  );

  if corrected_source_sha256 is distinct from expected_corrected_source_sha256 then
    raise exception 'The corrected attempted TeleBirr recovery source is not the reviewed repair.';
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
    raise exception 'The attempted TeleBirr recovery replay repair changed function authority.';
  end if;
end;
$preserve_binding_mismatch_recovery_replay$;

create or replace function app.enforce_private_live_telebirr_verification_job_recovery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  expected_digest text;
  repair_source_sha256 text;
  failed_attempt app.private_live_telebirr_verification_attempts%rowtype;
  retry_attempt app.private_live_telebirr_verification_attempts%rowtype;
  assignment_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  assignment_delivery app.private_live_telebirr_assignment_deliveries%rowtype;
  attempt_count integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'Private live TeleBirr verification jobs cannot be deleted.';
  end if;

  if session_user <> 'postgres' then
    raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
  end if;

  if old.original_expires_at is null
    and old.recovered_at is null
    and old.recovery_request_key is null
    and old.recovery_request_digest is null
    and old.recovery_reason_code is null
    and old.retry_original_expires_at is null
    and old.retry_recovered_at is null
    and old.retry_recovery_request_key is null
    and old.retry_recovery_request_digest is null
    and old.retry_recovery_reason_code is null then
    if new.original_expires_at is distinct from old.expires_at
      or new.recovered_at is null
      or new.recovery_request_key is null
      or new.recovery_request_digest is null
      or new.recovery_reason_code is null
      or new.recovery_reason_code not in (
        'assignment_runtime_unavailable',
        'device_evidence_binding_mismatch'
      )
      or new.retry_original_expires_at is not null
      or new.retry_recovered_at is not null
      or new.retry_recovery_request_key is not null
      or new.retry_recovery_request_digest is not null
      or new.retry_recovery_reason_code is not null
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
  end if;

  if old.original_expires_at is not null
    and old.recovered_at is not null
    and old.recovery_request_key is not null
    and old.recovery_request_digest is not null
    and old.recovery_reason_code = 'device_evidence_binding_mismatch'
    and old.retry_original_expires_at is null
    and old.retry_recovered_at is null
    and old.retry_recovery_request_key is null
    and old.retry_recovery_request_digest is null
    and old.retry_recovery_reason_code is null then
    if new.original_expires_at is distinct from old.original_expires_at
      or new.recovered_at is distinct from old.recovered_at
      or new.recovery_request_key is distinct from old.recovery_request_key
      or new.recovery_request_digest is distinct from old.recovery_request_digest
      or new.recovery_reason_code is distinct from old.recovery_reason_code
      or new.retry_original_expires_at is distinct from old.expires_at
      or new.retry_recovered_at is null
      or new.retry_recovery_request_key is null
      or new.retry_recovery_request_digest is null
      or new.retry_recovery_reason_code is distinct from
         'assignment_reference_binding_uniqueness'
      or new.expires_at <= new.retry_recovered_at + interval '60 seconds'
      or new.expires_at > new.retry_recovered_at + interval '5 minutes'
      or old.expires_at > new.retry_recovered_at
      or new.retry_recovered_at >= old.submitted_at + interval '24 hours'
      or (
        pg_catalog.to_jsonb(new) - array[
          'expires_at',
          'retry_original_expires_at',
          'retry_recovered_at',
          'retry_recovery_request_key',
          'retry_recovery_request_digest',
          'retry_recovery_reason_code'
        ]::text[]
      ) is distinct from (
        pg_catalog.to_jsonb(old) - array[
          'expires_at',
          'retry_original_expires_at',
          'retry_recovered_at',
          'retry_recovery_request_key',
          'retry_recovery_request_digest',
          'retry_recovery_reason_code'
        ]::text[]
      ) then
      raise exception 'The private live TeleBirr verification job retry recovery mutation is invalid.';
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

    select pg_catalog.encode(
             extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
             'hex'
           )
      into repair_source_sha256
      from pg_catalog.pg_proc routine
     where routine.oid = pg_catalog.to_regprocedure(
       'app.enforce_private_live_telebirr_assignment_reference_binding()'
     )
       and routine.prokind = 'f'
       and routine.prosecdef
       and not routine.proretset
       and routine.pronargs = 0
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and routine.proowner = (
         select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
       );

    if attempt_count <> 2
      or failed_attempt.id is null
      or failed_attempt.attempt_number <> 1
      or failed_attempt.expires_at > new.retry_recovered_at
      or retry_attempt.id is null
      or retry_attempt.attempt_number <> 2
      or retry_attempt.issued_at < old.recovered_at
      or retry_attempt.expires_at > old.expires_at
      or retry_attempt.expires_at > new.retry_recovered_at
      or assignment_transcript.id is null
      or assignment_delivery.verification_attempt_id is null
      or repair_source_sha256 is null
      or not exists (
        select 1
          from pg_catalog.pg_trigger trigger_row
         where trigger_row.tgrelid =
               'app.private_live_telebirr_assignment_transcripts'::regclass
           and trigger_row.tgname =
               'private_live_telebirr_assignment_reference_binding_guard'
           and trigger_row.tgfoid = pg_catalog.to_regprocedure(
             'app.enforce_private_live_telebirr_assignment_reference_binding()'
           )
           and trigger_row.tgenabled = 'O'
           and not trigger_row.tgisinternal
      )
      or exists (
        select 1
          from pg_catalog.pg_constraint constraint_row
         where constraint_row.conrelid =
               'app.private_live_telebirr_assignment_transcripts'::regclass
           and constraint_row.conname =
               'private_live_telebirr_assignment_t_reference_binding_digest_key'
      )
      or not exists (
        select 1
          from app.private_live_telebirr_assignment_reference_bindings binding
         where binding.reference_binding_digest =
               assignment_transcript.reference_binding_digest
           and binding.verification_job_id = old.id
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
      raise exception 'The private live TeleBirr verification job retry recovery mutation is invalid.';
    end if;

    expected_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:assignment-binding-retry-recovery:v1'
        || '|request_key=' || new.retry_recovery_request_key::text
        || '|job_id=' || new.id::text
        || '|pilot_revision_id=' || new.pilot_revision_id::text
        || '|first_recovery_request_digest=' || new.recovery_request_digest
        || '|failed_attempt_id=' || failed_attempt.id::text
        || '|failed_assignment_body_digest=' || assignment_transcript.assignment_body_digest
        || '|failed_reference_binding_digest=' || assignment_transcript.reference_binding_digest
        || '|stranded_retry_attempt_id=' || retry_attempt.id::text
        || '|stranded_retry_assignment_id=' || retry_attempt.assignment_id::text
        || '|stranded_retry_lease_request_digest=' || retry_attempt.lease_request_digest
        || '|stranded_retry_lease_nonce_digest=' || retry_attempt.lease_nonce_digest
        || '|stranded_retry_challenge_digest=' || retry_attempt.challenge_digest
        || '|replaced_unique_constraint='
        || 'private_live_telebirr_assignment_t_reference_binding_digest_key'
        || '|repair_migration=20260917161516'
        || '|repair_source_sha256=sha256:' || repair_source_sha256
        || '|retry_original_expires_at_us=' || (
          extract(epoch from new.retry_original_expires_at) * 1000000
        )::bigint::text
        || '|retry_recovered_at_us=' || (
          extract(epoch from new.retry_recovered_at) * 1000000
        )::bigint::text
        || '|retry_recovered_expires_at_us=' || (
          extract(epoch from new.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || new.retry_recovery_reason_code
    );

    if new.retry_recovery_request_digest is distinct from expected_digest then
      raise exception 'The private live TeleBirr verification job retry recovery digest is invalid.';
    end if;

    return new;
  end if;

  raise exception 'The private live TeleBirr verification job recovery mutation is invalid.';
end;
$$;

create function app.recover_private_live_telebirr_assignment_binding_retry(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_recovery_request_key uuid,
  p_reason_code text
)
returns table (
  verification_job_id uuid,
  stranded_retry_expires_at timestamptz,
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
  authorized_at timestamptz;
  recovered_expires_at timestamptz;
  request_digest text;
  staging_source_sha256 text;
  repair_source_sha256 text;
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
    or p_reason_code is distinct from
       'assignment_reference_binding_uniqueness' then
    raise exception 'The private live TeleBirr assignment-binding retry recovery request is invalid.';
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

  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into staging_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.stage_live_tbirr_device_evidence_internal(uuid,text,text,text,jsonb,jsonb)'
   );

  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into repair_source_sha256
    from pg_catalog.pg_proc routine
   where routine.oid = pg_catalog.to_regprocedure(
     'app.enforce_private_live_telebirr_assignment_reference_binding()'
   )
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  if job.id is null
    or authority.epoch is null
    or pilot.id is null
    or profile.id is null
    or proof.id is null
    or failed_attempt.id is null
    or retry_attempt.id is null
    or assignment_transcript.id is null
    or assignment_delivery.verification_attempt_id is null
    or enrollment.id is null
    or signer.id is null
    or repair_source_sha256 is null then
    raise exception 'The private live TeleBirr assignment-binding retry recovery lineage is unavailable.';
  end if;

  if job.retry_recovery_request_key is not null then
    if job.retry_recovery_request_key is distinct from p_recovery_request_key
      or job.retry_recovery_reason_code is distinct from p_reason_code
      or job.retry_original_expires_at is null
      or job.retry_recovered_at is null
      or job.retry_recovery_request_digest is null then
      raise exception 'The private live TeleBirr assignment-binding retry recovery replay conflicts.';
    end if;

    request_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:assignment-binding-retry-recovery:v1'
        || '|request_key=' || job.retry_recovery_request_key::text
        || '|job_id=' || job.id::text
        || '|pilot_revision_id=' || job.pilot_revision_id::text
        || '|first_recovery_request_digest=' || job.recovery_request_digest
        || '|failed_attempt_id=' || failed_attempt.id::text
        || '|failed_assignment_body_digest=' || assignment_transcript.assignment_body_digest
        || '|failed_reference_binding_digest=' || assignment_transcript.reference_binding_digest
        || '|stranded_retry_attempt_id=' || retry_attempt.id::text
        || '|stranded_retry_assignment_id=' || retry_attempt.assignment_id::text
        || '|stranded_retry_lease_request_digest=' || retry_attempt.lease_request_digest
        || '|stranded_retry_lease_nonce_digest=' || retry_attempt.lease_nonce_digest
        || '|stranded_retry_challenge_digest=' || retry_attempt.challenge_digest
        || '|replaced_unique_constraint='
        || 'private_live_telebirr_assignment_t_reference_binding_digest_key'
        || '|repair_migration=20260917161516'
        || '|repair_source_sha256=sha256:' || repair_source_sha256
        || '|retry_original_expires_at_us=' || (
          extract(epoch from job.retry_original_expires_at) * 1000000
        )::bigint::text
        || '|retry_recovered_at_us=' || (
          extract(epoch from job.retry_recovered_at) * 1000000
        )::bigint::text
        || '|retry_recovered_expires_at_us=' || (
          extract(epoch from job.expires_at) * 1000000
        )::bigint::text
        || '|reason_code=' || job.retry_recovery_reason_code
    );

    if job.retry_recovery_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr assignment-binding retry recovery replay is invalid.';
    end if;

    return query
    select job.id, job.retry_original_expires_at, job.expires_at, true;
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
    or job.original_expires_at is null
    or job.recovered_at is null
    or job.recovery_request_key is null
    or job.recovery_request_digest is null
    or job.recovery_reason_code is distinct from 'device_evidence_binding_mismatch'
    or job.retry_original_expires_at is not null
    or job.retry_recovered_at is not null
    or job.retry_recovery_request_key is not null
    or job.retry_recovery_request_digest is not null
    or job.retry_recovery_reason_code is not null
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
    or failed_attempt.expires_at > authorized_at
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
    or not exists (
      select 1
        from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'app.private_live_telebirr_assignment_transcripts'::regclass
         and trigger_row.tgname =
             'private_live_telebirr_assignment_reference_binding_guard'
         and trigger_row.tgfoid = pg_catalog.to_regprocedure(
           'app.enforce_private_live_telebirr_assignment_reference_binding()'
         )
         and trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
    )
    or not exists (
      select 1
        from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'app.private_live_telebirr_assignment_transcripts'::regclass
         and constraint_row.conname =
             'private_live_tbirr_assignment_reference_binding_fkey'
         and constraint_row.contype = 'f'
    )
    or exists (
      select 1
        from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'app.private_live_telebirr_assignment_transcripts'::regclass
         and constraint_row.conname =
             'private_live_telebirr_assignment_t_reference_binding_digest_key'
    )
    or not exists (
      select 1
        from app.private_live_telebirr_assignment_reference_bindings binding
       where binding.reference_binding_digest =
             assignment_transcript.reference_binding_digest
         and binding.verification_job_id = job.id
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
    raise exception 'The private live TeleBirr verification job is not retry-recoverable.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:assignment-binding-retry-recovery:v1'
      || '|request_key=' || p_recovery_request_key::text
      || '|job_id=' || job.id::text
      || '|pilot_revision_id=' || job.pilot_revision_id::text
      || '|first_recovery_request_digest=' || job.recovery_request_digest
      || '|failed_attempt_id=' || failed_attempt.id::text
      || '|failed_assignment_body_digest=' || assignment_transcript.assignment_body_digest
      || '|failed_reference_binding_digest=' || assignment_transcript.reference_binding_digest
      || '|stranded_retry_attempt_id=' || retry_attempt.id::text
      || '|stranded_retry_assignment_id=' || retry_attempt.assignment_id::text
      || '|stranded_retry_lease_request_digest=' || retry_attempt.lease_request_digest
      || '|stranded_retry_lease_nonce_digest=' || retry_attempt.lease_nonce_digest
      || '|stranded_retry_challenge_digest=' || retry_attempt.challenge_digest
      || '|replaced_unique_constraint='
      || 'private_live_telebirr_assignment_t_reference_binding_digest_key'
      || '|repair_migration=20260917161516'
      || '|repair_source_sha256=sha256:' || repair_source_sha256
      || '|retry_original_expires_at_us=' || (
        extract(epoch from job.expires_at) * 1000000
      )::bigint::text
      || '|retry_recovered_at_us=' || (
        extract(epoch from authorized_at) * 1000000
      )::bigint::text
      || '|retry_recovered_expires_at_us=' || (
        extract(epoch from recovered_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );

  update app.private_live_telebirr_verification_jobs verification_job
     set retry_original_expires_at = verification_job.expires_at,
         retry_recovered_at = authorized_at,
         retry_recovery_request_key = p_recovery_request_key,
         retry_recovery_request_digest = request_digest,
         retry_recovery_reason_code = p_reason_code,
         expires_at = recovered_expires_at
   where verification_job.id = job.id
     and verification_job.retry_recovery_request_key is null
  returning verification_job.* into job;

  if job.retry_recovery_request_key is distinct from p_recovery_request_key
    or job.retry_recovery_request_digest is distinct from request_digest then
    raise exception 'The private live TeleBirr assignment-binding retry recovery did not persist.';
  end if;

  return query
  select job.id, job.retry_original_expires_at, job.expires_at, false;
end;
$$;

alter function app.enforce_private_live_telebirr_verification_job_recovery()
  owner to postgres;
alter function app.recover_private_live_telebirr_assignment_binding_retry(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function
  app.enforce_private_live_telebirr_assignment_reference_binding(),
  app.enforce_private_live_telebirr_verification_job_recovery(),
  app.recover_private_live_telebirr_assignment_binding_retry(
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

comment on table app.private_live_telebirr_assignment_reference_bindings is
  'Append-only cross-attempt TeleBirr reference-binding registry. A digest is permanently scoped to one verification job so retries for that job remain possible without permitting cross-job replay.';

comment on function app.enforce_private_live_telebirr_assignment_reference_binding() is
  'Registers each signed assignment reference-binding digest to its verification job and rejects reuse by every other job. Runs as a postgres-owned insert trigger and has no callable runtime grant.';

comment on function app.recover_private_live_telebirr_assignment_binding_retry(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, one-use recovery for one first-recovered live TeleBirr job whose second expired attempt could not persist its assignment solely because reference bindings were globally unique. Opens at most one final five-minute verification window and requires the deposit executor to remain disabled.';

comment on function app.enforce_private_live_telebirr_verification_job_recovery() is
  'Allows the original one-use recovery paths unchanged plus one postgres-only final window for the exact two-attempt assignment-binding-uniqueness failure. Every recovery timestamp, reason, request key, digest, and replaced window remains immutable.';

comment on table app.private_live_telebirr_verification_jobs is
  'Private TeleBirr proof-bound verification jobs. Immutable except for the reviewed postgres-only replacement windows, including one final audited retry for the exact assignment-binding-uniqueness failure.';

comment on column app.private_live_telebirr_assignment_transcripts.reference_binding_digest is
  'Scheme-independent SHA-256 digest of the protected provider-reference binding. May repeat only among attempts belonging to the same verification job, enforced by the immutable reference-binding registry.';

commit;
