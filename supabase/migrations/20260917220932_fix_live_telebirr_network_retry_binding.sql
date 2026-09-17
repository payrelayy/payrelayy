-- The one-use live network retry intentionally creates a replacement verification job for the
-- same immutable proof. The assignment reference-binding registry correctly rejected that new
-- job because it previously allowed reuse only inside one job. Permit the digest only when the
-- replacement job's immutable network_retry_source_job_id is the registry owner, then provide one
-- postgres-only recovery window for the exact already-stranded attempt. No evidence, outcome,
-- reservation, settlement, execution job, executor login, or feature switch is created here.

begin;

do $guard_reviewed_network_retry_predecessors$
declare
  binding_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.enforce_private_live_telebirr_assignment_reference_binding()'
  );
  network_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.reject_private_live_telebirr_network_retry_mutation()'
  );
  expected_binding_guard_sha constant text :=
    '0d55bd12f3a2a4e0da69a82bbbc3b0b7a94a4afa698f57bdd36b298e2a35c883';
  expected_network_guard_sha constant text :=
    'cb12a7f4e812682ba79b7a1790680f55ce9ba9e9dd832cbe863e096c7cfce0c8';
  binding_guard_sha text;
  network_guard_sha text;
  recovery_trigger_definition text;
begin
  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into binding_guard_sha
    from pg_catalog.pg_proc routine
   where routine.oid = binding_guard_signature
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
    into network_guard_sha
    from pg_catalog.pg_proc routine
   where routine.oid = network_guard_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  select pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
    into recovery_trigger_definition
    from pg_catalog.pg_trigger trigger_row
   where trigger_row.tgrelid =
         'app.private_live_telebirr_verification_jobs'::regclass
     and trigger_row.tgname = 'private_live_telebirr_jobs_immutable'
     and trigger_row.tgfoid = pg_catalog.to_regprocedure(
       'app.enforce_private_live_telebirr_verification_job_recovery()'
     )
     and not trigger_row.tgisinternal;

  if binding_guard_signature is null
    or network_guard_signature is null
    or binding_guard_sha is distinct from expected_binding_guard_sha
    or network_guard_sha is distinct from expected_network_guard_sha
    or recovery_trigger_definition is distinct from
       'CREATE TRIGGER private_live_telebirr_jobs_immutable BEFORE DELETE OR UPDATE ON app.private_live_telebirr_verification_jobs FOR EACH ROW EXECUTE FUNCTION app.enforce_private_live_telebirr_verification_job_recovery()'
    or exists (
      select 1
        from pg_catalog.pg_attribute attribute
       where attribute.attrelid =
             'app.private_live_telebirr_verification_jobs'::regclass
         and attribute.attname like 'network_binding_%'
         and not attribute.attisdropped
    ) then
    raise exception 'The reviewed live TeleBirr network-retry predecessors do not match.';
  end if;
end;
$guard_reviewed_network_retry_predecessors$;

-- Patch only the exact reviewed binding guard and preserve its owner, ACL, and authority shape.
do $patch_network_retry_reference_binding$
declare
  routine_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.enforce_private_live_telebirr_assignment_reference_binding()'
  );
  expected_source_sha constant text :=
    '0d55bd12f3a2a4e0da69a82bbbc3b0b7a94a4afa698f57bdd36b298e2a35c883';
  expected_patched_sha constant text :=
    '23809205c5d3e85e26d9909236b83bd153622b3704d48022095ef73f6ecbe70e';
  old_declaration constant text := $old$  resolved_job_id uuid;
  registered_job_id uuid;$old$;
  new_declaration constant text := $new$  resolved_job_id uuid;
  authorized_source_job_id uuid;
  registered_job_id uuid;$new$;
  old_resolution constant text := $old$  select attempt.verification_job_id
    into resolved_job_id
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.id = new.verification_attempt_id
   for share;$old$;
  new_resolution constant text := $new$  select attempt.verification_job_id, job.network_retry_source_job_id
    into resolved_job_id, authorized_source_job_id
    from app.private_live_telebirr_verification_attempts attempt
    join app.private_live_telebirr_verification_jobs job
      on job.id = attempt.verification_job_id
   where attempt.id = new.verification_attempt_id
   for share of attempt, job;$new$;
  old_condition constant text :=
    '  if registered_job_id is distinct from resolved_job_id then';
  new_condition constant text := $new$  if registered_job_id is distinct from resolved_job_id
    and registered_job_id is distinct from authorized_source_job_id then$new$;
  original_source text;
  original_definition text;
  original_owner oid;
  original_acl aclitem[];
  patched_source text;
  patched_definition text;
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
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  if original_source is null
    or original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) is distinct from expected_source_sha
    or (
      pg_catalog.length(original_source)
        - pg_catalog.length(pg_catalog.replace(original_source, old_declaration, ''))
    ) / pg_catalog.length(old_declaration) <> 1
    or (
      pg_catalog.length(original_source)
        - pg_catalog.length(pg_catalog.replace(original_source, old_resolution, ''))
    ) / pg_catalog.length(old_resolution) <> 1
    or (
      pg_catalog.length(original_source)
        - pg_catalog.length(pg_catalog.replace(original_source, old_condition, ''))
    ) / pg_catalog.length(old_condition) <> 1 then
    raise exception 'The TeleBirr reference-binding guard does not match the reviewed source.';
  end if;

  patched_source := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(original_source, old_declaration, new_declaration),
      old_resolution,
      new_resolution
    ),
    old_condition,
    new_condition
  );
  patched_definition := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(original_definition, old_declaration, new_declaration),
      old_resolution,
      new_resolution
    ),
    old_condition,
    new_condition
  );

  if pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(patched_source, 'UTF8'), 'sha256'),
       'hex'
     ) is distinct from expected_patched_sha then
    raise exception 'The TeleBirr reference-binding patch is not the reviewed replacement.';
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
       and not routine.proretset
       and routine.pronargs = 0
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The TeleBirr reference-binding patch changed function authority.';
  end if;
end;
$patch_network_retry_reference_binding$;

alter table app.private_live_telebirr_verification_jobs
  add column network_binding_original_expires_at timestamptz,
  add column network_binding_recovered_at timestamptz,
  add column network_binding_recovery_request_key uuid,
  add column network_binding_recovery_request_digest text,
  add column network_binding_recovery_reason_code text;

alter table app.private_live_telebirr_verification_jobs
  drop constraint private_live_telebirr_job_network_retry_shape_check;

alter table app.private_live_telebirr_verification_jobs
  add constraint private_live_telebirr_job_network_retry_shape_check check (
    (
      network_retry_source_job_id is null
      and network_retry_request_key is null
      and network_retry_request_digest is null
      and network_retry_reason_code is null
      and network_retry_authorized_at is null
      and network_binding_original_expires_at is null
      and network_binding_recovered_at is null
      and network_binding_recovery_request_key is null
      and network_binding_recovery_request_digest is null
      and network_binding_recovery_reason_code is null
    )
    or
    (
      network_retry_source_job_id is not null
      and network_retry_source_job_id <> id
      and network_retry_request_key is not null
      and network_retry_request_key::text
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and network_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
      and network_retry_reason_code = 'official_receipt_network_unavailable'
      and network_retry_authorized_at is not null
      and submitted_at = network_retry_authorized_at
      and not_before = network_retry_authorized_at
      and (
        (
          network_binding_original_expires_at is null
          and network_binding_recovered_at is null
          and network_binding_recovery_request_key is null
          and network_binding_recovery_request_digest is null
          and network_binding_recovery_reason_code is null
          and expires_at > network_retry_authorized_at + interval '60 seconds'
          and expires_at <= network_retry_authorized_at + interval '5 minutes'
        )
        or
        (
          network_binding_original_expires_at is not null
          and network_binding_recovered_at is not null
          and network_binding_recovery_request_key::text
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and network_binding_recovery_request_digest ~ '^sha256:[0-9a-f]{64}$'
          and network_binding_recovery_reason_code =
              'network_retry_reference_binding_registry'
          and network_binding_original_expires_at >
              network_retry_authorized_at + interval '60 seconds'
          and network_binding_original_expires_at <=
              network_retry_authorized_at + interval '5 minutes'
          and network_binding_recovered_at >= network_binding_original_expires_at
          and network_binding_recovered_at <
              network_retry_authorized_at + interval '24 hours'
          and expires_at > network_binding_recovered_at + interval '60 seconds'
          and expires_at <= network_binding_recovered_at + interval '5 minutes'
        )
      )
    )
  );

alter table app.private_live_telebirr_verification_jobs
  drop constraint private_live_telebirr_job_window_check;

alter table app.private_live_telebirr_verification_jobs
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
        and (
          (
            network_retry_source_job_id is null
            and network_binding_original_expires_at is null
            and network_binding_recovered_at is null
            and network_binding_recovery_request_key is null
            and network_binding_recovery_request_digest is null
            and network_binding_recovery_reason_code is null
            and expires_at <= submitted_at + interval '5 minutes'
          )
          or
          (
            network_retry_source_job_id is not null
            and (
              (
                network_binding_original_expires_at is null
                and network_binding_recovered_at is null
                and network_binding_recovery_request_key is null
                and network_binding_recovery_request_digest is null
                and network_binding_recovery_reason_code is null
                and expires_at <= submitted_at + interval '5 minutes'
              )
              or
              (
                network_binding_original_expires_at is not null
                and network_binding_recovered_at is not null
                and network_binding_recovery_request_key is not null
                and network_binding_recovery_request_digest is not null
                and network_binding_recovery_reason_code =
                    'network_retry_reference_binding_registry'
                and network_binding_original_expires_at > submitted_at + interval '60 seconds'
                and network_binding_original_expires_at <= submitted_at + interval '5 minutes'
                and network_binding_recovered_at >= network_binding_original_expires_at
                and network_binding_recovered_at < submitted_at + interval '24 hours'
                and expires_at > network_binding_recovered_at + interval '60 seconds'
                and expires_at <= network_binding_recovered_at + interval '5 minutes'
              )
            )
          )
        )
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

create unique index private_live_telebirr_jobs_network_binding_key_uidx
  on app.private_live_telebirr_verification_jobs (
    network_binding_recovery_request_key
  ) where network_binding_recovery_request_key is not null;

create unique index private_live_telebirr_jobs_network_binding_digest_uidx
  on app.private_live_telebirr_verification_jobs (
    network_binding_recovery_request_digest
  ) where network_binding_recovery_request_digest is not null;

create function app.private_live_telebirr_network_binding_recovery_digest(
  p_request_key uuid,
  p_verification_job_id uuid,
  p_source_job_id uuid,
  p_network_retry_digest text,
  p_stranded_attempt_id uuid,
  p_stranded_assignment_id uuid,
  p_lease_request_digest text,
  p_lease_nonce_digest text,
  p_challenge_digest text,
  p_reference_binding_digest text,
  p_original_expires_at timestamptz,
  p_recovered_at timestamptz,
  p_recovered_expires_at timestamptz,
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
    or p_verification_job_id is null
    or p_source_job_id is null
    or p_verification_job_id = p_source_job_id
    or p_network_retry_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_stranded_attempt_id is null
    or p_stranded_assignment_id is null
    or p_lease_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_lease_nonce_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_challenge_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reference_binding_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_original_expires_at is null
    or p_recovered_at < p_original_expires_at
    or p_recovered_expires_at <= p_recovered_at + interval '60 seconds'
    or p_recovered_expires_at > p_recovered_at + interval '5 minutes'
    or p_reason_code is distinct from 'network_retry_reference_binding_registry' then
    raise exception 'The private live TeleBirr network-binding recovery digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:network-retry-binding-recovery:v1'
      || '|request_key=' || p_request_key::text
      || '|job_id=' || p_verification_job_id::text
      || '|source_job_id=' || p_source_job_id::text
      || '|network_retry_digest=' || p_network_retry_digest
      || '|stranded_attempt_id=' || p_stranded_attempt_id::text
      || '|stranded_assignment_id=' || p_stranded_assignment_id::text
      || '|lease_request_digest=' || p_lease_request_digest
      || '|lease_nonce_digest=' || p_lease_nonce_digest
      || '|challenge_digest=' || p_challenge_digest
      || '|reference_binding_digest=' || p_reference_binding_digest
      || '|binding_guard_source_sha256='
      || 'sha256:23809205c5d3e85e26d9909236b83bd153622b3704d48022095ef73f6ecbe70e'
      || '|repair_migration=20260917220932'
      || '|original_expires_at_us=' || (
        extract(epoch from p_original_expires_at) * 1000000
      )::bigint::text
      || '|recovered_at_us=' || (
        extract(epoch from p_recovered_at) * 1000000
      )::bigint::text
      || '|recovered_expires_at_us=' || (
        extract(epoch from p_recovered_expires_at) * 1000000
      )::bigint::text
      || '|reason_code=' || p_reason_code
  );
end;
$$;

create or replace function app.reject_private_live_telebirr_network_retry_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  attempt_count integer;
  binding app.private_live_telebirr_assignment_reference_bindings%rowtype;
  expected_digest text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Private live TeleBirr network retry jobs are immutable.';
  end if;

  if session_user <> 'postgres'
    or old.network_retry_source_job_id is null
    or old.network_binding_original_expires_at is not null
    or old.network_binding_recovered_at is not null
    or old.network_binding_recovery_request_key is not null
    or old.network_binding_recovery_request_digest is not null
    or old.network_binding_recovery_reason_code is not null
    or new.network_binding_original_expires_at is distinct from old.expires_at
    or new.network_binding_recovered_at is null
    or new.network_binding_recovery_request_key is null
    or new.network_binding_recovery_request_digest is null
    or new.network_binding_recovery_reason_code is distinct from
       'network_retry_reference_binding_registry'
    or new.network_binding_recovered_at < old.expires_at
    or new.network_binding_recovered_at >= old.submitted_at + interval '24 hours'
    or new.expires_at <= new.network_binding_recovered_at + interval '60 seconds'
    or new.expires_at > new.network_binding_recovered_at + interval '5 minutes'
    or (
      pg_catalog.to_jsonb(new) - array[
        'expires_at',
        'network_binding_original_expires_at',
        'network_binding_recovered_at',
        'network_binding_recovery_request_key',
        'network_binding_recovery_request_digest',
        'network_binding_recovery_reason_code'
      ]::text[]
    ) is distinct from (
      pg_catalog.to_jsonb(old) - array[
        'expires_at',
        'network_binding_original_expires_at',
        'network_binding_recovered_at',
        'network_binding_recovery_request_key',
        'network_binding_recovery_request_digest',
        'network_binding_recovery_reason_code'
      ]::text[]
    ) then
    raise exception 'The private live TeleBirr network retry recovery mutation is invalid.';
  end if;

  select pg_catalog.count(*)::integer
    into attempt_count
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = old.id;

  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = old.id
     and verification_attempt.attempt_number = 1
   for share;

  select registered_binding.*
    into binding
    from app.private_live_telebirr_assignment_reference_bindings registered_binding
   where registered_binding.verification_job_id = old.network_retry_source_job_id
   for share;

  if attempt_count <> 1
    or attempt.id is null
    or attempt.expires_at > new.network_binding_recovered_at
    or binding.reference_binding_digest is null
    or exists (
      select 1 from app.private_live_telebirr_assignment_transcripts transcript
       where transcript.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_deliveries delivery
       where delivery.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_device_evidence_staging staged
       where staged.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_observation_transcripts observation
       where observation.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = old.id
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id =
             old.private_live_deposit_pilot_proof_id
    )
    or exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       ) and role.rolcanlogin
    )
    or exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
    ) then
    raise exception 'The private live TeleBirr network retry recovery mutation is invalid.';
  end if;

  expected_digest := app.private_live_telebirr_network_binding_recovery_digest(
    new.network_binding_recovery_request_key,
    old.id,
    old.network_retry_source_job_id,
    old.network_retry_request_digest,
    attempt.id,
    attempt.assignment_id,
    attempt.lease_request_digest,
    attempt.lease_nonce_digest,
    attempt.challenge_digest,
    binding.reference_binding_digest,
    new.network_binding_original_expires_at,
    new.network_binding_recovered_at,
    new.expires_at,
    new.network_binding_recovery_reason_code
  );

  if new.network_binding_recovery_request_digest is distinct from expected_digest then
    raise exception 'The private live TeleBirr network retry recovery digest is invalid.';
  end if;

  return new;
end;
$$;

-- The retained generic recovery trigger continues to protect every original job. Replacement
-- jobs are protected by the stricter network-retry trigger above.
drop trigger private_live_telebirr_jobs_immutable
  on app.private_live_telebirr_verification_jobs;

create trigger private_live_telebirr_jobs_immutable
before update or delete on app.private_live_telebirr_verification_jobs
for each row
when (old.network_retry_source_job_id is null)
execute function app.enforce_private_live_telebirr_verification_job_recovery();

create function app.recover_private_live_telebirr_network_retry_binding(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_recovery_request_key uuid,
  p_reason_code text
)
returns table (
  verification_job_id uuid,
  stranded_expires_at timestamptz,
  recovered_expires_at timestamptz,
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
  source_job app.private_live_telebirr_verification_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  source_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  source_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  heartbeat app.private_live_telebirr_device_heartbeats%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  binding app.private_live_telebirr_assignment_reference_bindings%rowtype;
  attempt_count integer;
  source_outcome_count integer;
  authorized_at timestamptz;
  recovered_expiry timestamptz;
  request_digest text;
begin
  if session_user <> 'postgres'
    or p_verification_job_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null
    or p_activation_epoch <= 0
    or p_recovery_request_key is null
    or p_recovery_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason_code is distinct from 'network_retry_reference_binding_registry' then
    raise exception 'The private live TeleBirr network retry recovery request is invalid.';
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
     and verification_job.network_retry_source_job_id is not null
   for update;

  select verification_job.*
    into source_job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = job.network_retry_source_job_id
     and verification_job.pilot_revision_id = p_pilot_revision_id
   for share;

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
   where proof_row.id = job.private_live_deposit_pilot_proof_id
     and proof_row.pilot_revision_id = p_pilot_revision_id
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id
     and receiver_profile.pilot_revision_id = p_pilot_revision_id
   for share;

  select pg_catalog.count(*)::integer
    into attempt_count
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = job.id;

  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.verification_job_id = job.id
     and verification_attempt.attempt_number = 1
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

  select transcript.*
    into source_transcript
    from app.private_live_telebirr_assignment_transcripts transcript
   where transcript.verification_attempt_id = source_outcome.verification_attempt_id
   for share;

  select registered_binding.*
    into binding
    from app.private_live_telebirr_assignment_reference_bindings registered_binding
   where registered_binding.reference_binding_digest =
         source_transcript.reference_binding_digest
     and registered_binding.verification_job_id = source_job.id
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
   where assignment_signer.id = source_transcript.assignment_signer_id
   for share;

  if job.network_binding_recovery_request_key is not null then
    request_digest := app.private_live_telebirr_network_binding_recovery_digest(
      job.network_binding_recovery_request_key,
      job.id,
      source_job.id,
      job.network_retry_request_digest,
      attempt.id,
      attempt.assignment_id,
      attempt.lease_request_digest,
      attempt.lease_nonce_digest,
      attempt.challenge_digest,
      binding.reference_binding_digest,
      job.network_binding_original_expires_at,
      job.network_binding_recovered_at,
      job.expires_at,
      job.network_binding_recovery_reason_code
    );

    if job.network_binding_recovery_request_key is distinct from p_recovery_request_key
      or job.network_binding_recovery_reason_code is distinct from p_reason_code
      or job.network_binding_recovery_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr network retry recovery replay conflicts.';
    end if;

    return query
    select job.id, job.network_binding_original_expires_at, job.expires_at, true;
    return;
  end if;

  authorized_at := pg_catalog.clock_timestamp();
  recovered_expiry := least(
    authorized_at + interval '5 minutes',
    authority.expires_at,
    pilot.expires_at,
    profile.valid_until,
    enrollment.valid_until,
    signer.valid_until
  );

  if job.id is null
    or source_job.id is null
    or job.network_retry_reason_code is distinct from
       'official_receipt_network_unavailable'
    or job.network_binding_original_expires_at is not null
    or source_outcome_count <> 1
    or source_outcome.id is null
    or source_outcome.private_live_deposit_pilot_proof_id is distinct from proof.id
    or source_outcome.pilot_revision_id is distinct from p_pilot_revision_id
    or source_outcome.disposition is distinct from 'review_required'
    or source_outcome.reason_code is distinct from 'source_unavailable'
    or attempt_count <> 1
    or attempt.id is null
    or attempt.expires_at > authorized_at
    or binding.reference_binding_digest is null
    or authority.epoch is null
    or pilot.id is null
    or profile.id is null
    or proof.id is null
    or enrollment.id is null
    or heartbeat.device_enrollment_id is null
    or signer.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or job.pilot_configuration_digest is distinct from pilot.configuration_digest
    or job.provider_code <> 'telebirr'
    or proof.provider_code_snapshot <> 'telebirr'
    or authorized_at >= proof.submitted_at + interval '24 hours'
    or authorized_at >= job.network_retry_authorized_at + interval '24 hours'
    or authorized_at < profile.valid_from
    or authorized_at >= profile.valid_until
    or authorized_at < enrollment.valid_from
    or authorized_at >= enrollment.valid_until
    or authorized_at < signer.valid_from
    or authorized_at >= signer.valid_until
    or recovered_expiry <= authorized_at + interval '60 seconds'
    or heartbeat.runtime_state <> 'ready'
    or heartbeat.status_code <> 'no_assignment'
    or heartbeat.last_seen_at <= authorized_at - interval '6 minutes'
    or not app.is_private_live_deposit_pilot_enforced()
    or not exists (
      select 1 from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_transcripts transcript
       where transcript.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_deliveries delivery
       where delivery.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_device_evidence_staging staged
       where staged.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_observation_transcripts observation
       where observation.verification_attempt_id = attempt.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = job.id
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = proof.id
    )
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= authorized_at
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= authorized_at
    )
    or exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       ) and role.rolcanlogin
    )
    or exists (
      select 1 from pg_catalog.pg_stat_activity activity
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
           select 1 from pg_catalog.pg_locks advisory_lock
            where advisory_lock.pid = activity.pid
              and advisory_lock.locktype = 'advisory'
              and advisory_lock.database = (
                select database.oid from pg_catalog.pg_database database
                 where database.datname = pg_catalog.current_database()
              )
              and advisory_lock.classid = 1178948673::integer
              and advisory_lock.objid = 1413632594::integer
              and advisory_lock.objsubid = 2
              and advisory_lock.granted
         )
    ) <> 1 then
    raise exception 'The private live TeleBirr network retry recovery authority is unavailable.';
  end if;

  request_digest := app.private_live_telebirr_network_binding_recovery_digest(
    p_recovery_request_key,
    job.id,
    source_job.id,
    job.network_retry_request_digest,
    attempt.id,
    attempt.assignment_id,
    attempt.lease_request_digest,
    attempt.lease_nonce_digest,
    attempt.challenge_digest,
    binding.reference_binding_digest,
    job.expires_at,
    authorized_at,
    recovered_expiry,
    p_reason_code
  );

  update app.private_live_telebirr_verification_jobs verification_job
     set network_binding_original_expires_at = verification_job.expires_at,
         network_binding_recovered_at = authorized_at,
         network_binding_recovery_request_key = p_recovery_request_key,
         network_binding_recovery_request_digest = request_digest,
         network_binding_recovery_reason_code = p_reason_code,
         expires_at = recovered_expiry
   where verification_job.id = job.id
     and verification_job.network_binding_recovery_request_key is null
  returning verification_job.* into job;

  if job.network_binding_recovery_request_key is distinct from p_recovery_request_key
    or job.network_binding_recovery_request_digest is distinct from request_digest then
    raise exception 'The private live TeleBirr network retry recovery did not persist.';
  end if;

  return query
  select job.id, job.network_binding_original_expires_at, job.expires_at, false;
end;
$$;

alter function app.private_live_telebirr_network_binding_recovery_digest(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  timestamptz, timestamptz, timestamptz, text
) owner to postgres;
alter function app.reject_private_live_telebirr_network_retry_mutation() owner to postgres;
alter function app.recover_private_live_telebirr_network_retry_binding(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function app.private_live_telebirr_network_binding_recovery_digest(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text, text,
  timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function app.reject_private_live_telebirr_network_retry_mutation()
  from public, anon, authenticated, service_role;
revoke all on function app.recover_private_live_telebirr_network_retry_binding(
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

comment on function app.recover_private_live_telebirr_network_retry_binding(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, idempotent final five-minute recovery for the exact one-attempt live network-retry job stranded by the reference-binding registry. Creates no attempt, evidence, outcome, reservation, settlement, or execution job itself.';

commit;
