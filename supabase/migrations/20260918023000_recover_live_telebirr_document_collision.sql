-- Open one final, audited verification window only for a network-retry job whose fresh signed
-- evidence was stranded by the former global source-document uniqueness constraint. The recovery
-- is PostgreSQL-only, requires the exact four-attempt/two-evidence collision shape, preserves all
-- prior attempts and evidence, and creates no observation, outcome, reservation, settlement, or
-- execution job itself. KemerBet must remain unable to log in and have no active session.

begin;

do $guard_reviewed_document_collision_predecessors$
declare
  mutation_guard_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.reject_private_live_telebirr_network_retry_mutation()'
  );
  expected_mutation_guard_sha constant text :=
    '4d93dceeff811a24ca7b2efb71d8739591e9e225baf2b4a45255837c68fdbe18';
  actual_mutation_guard_sha text;
begin
  select pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(routine.prosrc, 'UTF8'), 'sha256'),
           'hex'
         )
    into actual_mutation_guard_sha
    from pg_catalog.pg_proc routine
   where routine.oid = mutation_guard_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[]
     and routine.proowner = (
       select role.oid from pg_catalog.pg_roles role where role.rolname = 'postgres'
     )
     and routine.proacl = array['postgres=X/postgres']::aclitem[];

  if mutation_guard_signature is null
    or actual_mutation_guard_sha is distinct from expected_mutation_guard_sha
    or pg_catalog.to_regclass(
         'app.private_live_telebirr_source_document_bindings'
       ) is null
    or pg_catalog.to_regclass(
         'app.private_live_telebirr_settlement_documents'
       ) is null
    or exists (
      select 1
        from pg_catalog.pg_attribute attribute
       where attribute.attrelid =
             'app.private_live_telebirr_verification_jobs'::regclass
         and attribute.attname like 'source_document_retry_%'
         and not attribute.attisdropped
    ) then
    raise exception 'The reviewed TeleBirr document-collision predecessors do not match.';
  end if;
end;
$guard_reviewed_document_collision_predecessors$;

alter table app.private_live_telebirr_verification_jobs
  add column source_document_retry_original_expires_at timestamptz,
  add column source_document_retry_recovered_at timestamptz,
  add column source_document_retry_activation_epoch bigint,
  add column source_document_retry_request_key uuid,
  add column source_document_retry_request_digest text,
  add column source_document_retry_reason_code text;

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
      and source_document_retry_original_expires_at is null
      and source_document_retry_recovered_at is null
      and source_document_retry_activation_epoch is null
      and source_document_retry_request_key is null
      and source_document_retry_request_digest is null
      and source_document_retry_reason_code is null
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
          and source_document_retry_original_expires_at is null
          and source_document_retry_recovered_at is null
          and source_document_retry_activation_epoch is null
          and source_document_retry_request_key is null
          and source_document_retry_request_digest is null
          and source_document_retry_reason_code is null
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
          and (
            (
              source_document_retry_original_expires_at is null
              and source_document_retry_recovered_at is null
              and source_document_retry_activation_epoch is null
              and source_document_retry_request_key is null
              and source_document_retry_request_digest is null
              and source_document_retry_reason_code is null
              and expires_at > network_binding_recovered_at + interval '60 seconds'
              and expires_at <= network_binding_recovered_at + interval '5 minutes'
            )
            or
            (
              source_document_retry_original_expires_at is not null
              and source_document_retry_recovered_at is not null
              and source_document_retry_activation_epoch > 0
              and source_document_retry_request_key::text
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and source_document_retry_request_digest ~ '^sha256:[0-9a-f]{64}$'
              and source_document_retry_reason_code =
                  'source_document_digest_collision'
              and source_document_retry_original_expires_at >
                  network_binding_recovered_at + interval '60 seconds'
              and source_document_retry_original_expires_at <=
                  network_binding_recovered_at + interval '5 minutes'
              and source_document_retry_recovered_at >=
                  source_document_retry_original_expires_at
              and source_document_retry_recovered_at <
                  network_retry_authorized_at + interval '24 hours'
              and expires_at >
                  source_document_retry_recovered_at + interval '60 seconds'
              and expires_at <=
                  source_document_retry_recovered_at + interval '5 minutes'
            )
          )
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
            and source_document_retry_original_expires_at is null
            and source_document_retry_recovered_at is null
            and source_document_retry_activation_epoch is null
            and source_document_retry_request_key is null
            and source_document_retry_request_digest is null
            and source_document_retry_reason_code is null
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
                and source_document_retry_original_expires_at is null
                and source_document_retry_recovered_at is null
                and source_document_retry_activation_epoch is null
                and source_document_retry_request_key is null
                and source_document_retry_request_digest is null
                and source_document_retry_reason_code is null
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
                and network_binding_original_expires_at >
                    submitted_at + interval '60 seconds'
                and network_binding_original_expires_at <=
                    submitted_at + interval '5 minutes'
                and network_binding_recovered_at >= network_binding_original_expires_at
                and network_binding_recovered_at < submitted_at + interval '24 hours'
                and (
                  (
                    source_document_retry_original_expires_at is null
                    and source_document_retry_recovered_at is null
                    and source_document_retry_activation_epoch is null
                    and source_document_retry_request_key is null
                    and source_document_retry_request_digest is null
                    and source_document_retry_reason_code is null
                    and expires_at >
                        network_binding_recovered_at + interval '60 seconds'
                    and expires_at <=
                        network_binding_recovered_at + interval '5 minutes'
                  )
                  or
                  (
                    source_document_retry_original_expires_at is not null
                    and source_document_retry_recovered_at is not null
                    and source_document_retry_activation_epoch > 0
                    and source_document_retry_request_key is not null
                    and source_document_retry_request_digest is not null
                    and source_document_retry_reason_code =
                        'source_document_digest_collision'
                    and source_document_retry_original_expires_at >
                        network_binding_recovered_at + interval '60 seconds'
                    and source_document_retry_original_expires_at <=
                        network_binding_recovered_at + interval '5 minutes'
                    and source_document_retry_recovered_at >=
                        source_document_retry_original_expires_at
                    and source_document_retry_recovered_at <
                        submitted_at + interval '24 hours'
                    and expires_at >
                        source_document_retry_recovered_at + interval '60 seconds'
                    and expires_at <=
                        source_document_retry_recovered_at + interval '5 minutes'
                  )
                )
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
        and source_document_retry_original_expires_at is null
        and source_document_retry_recovered_at is null
        and source_document_retry_activation_epoch is null
        and source_document_retry_request_key is null
        and source_document_retry_request_digest is null
        and source_document_retry_reason_code is null
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
        and source_document_retry_original_expires_at is null
        and source_document_retry_recovered_at is null
        and source_document_retry_activation_epoch is null
        and source_document_retry_request_key is null
        and source_document_retry_request_digest is null
        and source_document_retry_reason_code is null
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
        and source_document_retry_original_expires_at is null
        and source_document_retry_recovered_at is null
        and source_document_retry_activation_epoch is null
        and source_document_retry_request_key is null
        and source_document_retry_request_digest is null
        and source_document_retry_reason_code is null
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

create unique index private_live_tbirr_jobs_source_doc_retry_key_uidx
  on app.private_live_telebirr_verification_jobs (
    source_document_retry_request_key
  ) where source_document_retry_request_key is not null;

create unique index private_live_tbirr_jobs_source_doc_retry_digest_uidx
  on app.private_live_telebirr_verification_jobs (
    source_document_retry_request_digest
  ) where source_document_retry_request_digest is not null;

create function app.private_live_telebirr_source_document_retry_digest(
  p_request_key uuid,
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_network_binding_recovery_digest text,
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
    or p_pilot_revision_id is null
    or p_activation_epoch is null
    or p_activation_epoch <= 0
    or p_network_binding_recovery_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_original_expires_at is null
    or p_recovered_at < p_original_expires_at
    or p_recovered_expires_at <= p_recovered_at + interval '60 seconds'
    or p_recovered_expires_at > p_recovered_at + interval '5 minutes'
    or p_reason_code is distinct from 'source_document_digest_collision' then
    raise exception 'The TeleBirr source-document retry digest input is invalid.';
  end if;

  return app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:source-document-retry:v1'
      || '|request_key=' || p_request_key::text
      || '|verification_job_id=' || p_verification_job_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|activation_epoch=' || p_activation_epoch::text
      || '|network_binding_recovery_digest=' || p_network_binding_recovery_digest
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
      || '|migration=20260918023000'
  );
end;
$$;

do $patch_network_retry_guard_for_document_collision$
declare
  routine_signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.reject_private_live_telebirr_network_retry_mutation()'
  );
  expected_source_sha constant text :=
    '4d93dceeff811a24ca7b2efb71d8739591e9e225baf2b4a45255837c68fdbe18';
  expected_patched_sha constant text :=
    'ca6ef3eb6c184a3017cfaa8c38ff7a02c121de8f7b56c85a5a9c00933c09bf45';
  old_marker constant text := $old$  if session_user <> 'postgres'
$old$;
  new_marker constant text := $new$  if old.source_document_retry_original_expires_at is not null
    or old.source_document_retry_recovered_at is not null
    or old.source_document_retry_activation_epoch is not null
    or old.source_document_retry_request_key is not null
    or old.source_document_retry_request_digest is not null
    or old.source_document_retry_reason_code is not null then
    raise exception 'Private live TeleBirr source-document recoveries are immutable.';
  end if;

  if new.source_document_retry_original_expires_at is not null
    or new.source_document_retry_recovered_at is not null
    or new.source_document_retry_activation_epoch is not null
    or new.source_document_retry_request_key is not null
    or new.source_document_retry_request_digest is not null
    or new.source_document_retry_reason_code is not null then
    if session_user <> 'postgres'
      or old.network_retry_source_job_id is null
      or old.network_binding_original_expires_at is null
      or old.network_binding_recovered_at is null
      or old.network_binding_recovery_request_key is null
      or old.network_binding_recovery_request_digest is null
      or old.network_binding_recovery_reason_code is distinct from
         'network_retry_reference_binding_registry'
      or new.source_document_retry_original_expires_at is distinct from old.expires_at
      or new.source_document_retry_recovered_at is null
      or new.source_document_retry_activation_epoch is null
      or new.source_document_retry_activation_epoch <= 0
      or new.source_document_retry_request_key is null
      or new.source_document_retry_request_digest is null
      or new.source_document_retry_reason_code is distinct from
         'source_document_digest_collision'
      or new.source_document_retry_recovered_at < old.expires_at
      or new.source_document_retry_recovered_at >= old.submitted_at + interval '24 hours'
      or new.expires_at <=
         new.source_document_retry_recovered_at + interval '60 seconds'
      or new.expires_at >
         new.source_document_retry_recovered_at + interval '5 minutes'
      or (
        pg_catalog.to_jsonb(new) - array[
          'expires_at',
          'source_document_retry_original_expires_at',
          'source_document_retry_recovered_at',
          'source_document_retry_activation_epoch',
          'source_document_retry_request_key',
          'source_document_retry_request_digest',
          'source_document_retry_reason_code'
        ]::text[]
      ) is distinct from (
        pg_catalog.to_jsonb(old) - array[
          'expires_at',
          'source_document_retry_original_expires_at',
          'source_document_retry_recovered_at',
          'source_document_retry_activation_epoch',
          'source_document_retry_request_key',
          'source_document_retry_request_digest',
          'source_document_retry_reason_code'
        ]::text[]
      )
      or (select pg_catalog.count(*)
            from app.private_live_telebirr_verification_attempts attempt
           where attempt.verification_job_id = old.id) <> 4
      or (select pg_catalog.count(*)
            from app.private_live_telebirr_verification_attempts attempt
           where attempt.verification_job_id = old.id
             and attempt.attempt_number between 1 and 4
             and attempt.expires_at <=
                 new.source_document_retry_recovered_at) <> 4
      or (select pg_catalog.count(*)
            from app.private_live_telebirr_verification_attempts attempt
            join app.private_live_telebirr_assignment_transcripts transcript
              on transcript.verification_attempt_id = attempt.id
           where attempt.verification_job_id = old.id) <> 2
      or (select pg_catalog.count(*)
            from app.private_live_telebirr_verification_attempts attempt
            join app.private_live_telebirr_assignment_deliveries delivery
              on delivery.verification_attempt_id = attempt.id
           where attempt.verification_job_id = old.id) <> 2
      or (select pg_catalog.count(*)
            from app.private_live_telebirr_verification_attempts attempt
            join app.private_live_telebirr_device_evidence_staging evidence
              on evidence.verification_attempt_id = attempt.id
           where attempt.verification_job_id = old.id) <> 2
      or exists (
        select 1
          from app.private_live_telebirr_verification_attempts attempt
          join app.private_live_telebirr_device_evidence_staging evidence
            on evidence.verification_attempt_id = attempt.id
         where attempt.verification_job_id = old.id
           and evidence.signed_observation -> 'body' ->> 'sourceDocumentDigest'
                 !~ '^sha256:[0-9a-f]{64}$'
      )
      or not exists (
        select 1
          from app.private_live_telebirr_verification_attempts attempt
          join app.private_live_telebirr_device_evidence_staging evidence
            on evidence.verification_attempt_id = attempt.id
          join app.private_live_telebirr_source_document_bindings binding
            on binding.source_document_digest =
               evidence.signed_observation -> 'body' ->> 'sourceDocumentDigest'
           and binding.payment_provider_id = old.payment_provider_id
           and binding.candidate_reference_fingerprint =
               old.candidate_reference_fingerprint
          join app.private_live_telebirr_observation_transcripts prior_observation
            on prior_observation.source_document_digest = binding.source_document_digest
          join app.private_live_telebirr_verification_attempts prior_attempt
            on prior_attempt.id = prior_observation.verification_attempt_id
           and prior_attempt.verification_job_id <> old.id
         where attempt.verification_job_id = old.id
      )
      or exists (
        select 1
          from app.private_live_telebirr_verification_attempts attempt
          join app.private_live_telebirr_device_evidence_staging evidence
            on evidence.verification_attempt_id = attempt.id
          join app.private_live_telebirr_settlement_documents settlement_document
            on settlement_document.source_document_digest =
               evidence.signed_observation -> 'body' ->> 'sourceDocumentDigest'
         where attempt.verification_job_id = old.id
      )
      or exists (
        select 1
          from app.private_live_telebirr_verification_attempts attempt
          join app.private_live_telebirr_observation_transcripts observation
            on observation.verification_attempt_id = attempt.id
         where attempt.verification_job_id = old.id
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
      raise exception 'The TeleBirr source-document recovery mutation is invalid.';
    end if;

    expected_digest := app.private_live_telebirr_source_document_retry_digest(
      new.source_document_retry_request_key,
      old.id,
      old.pilot_revision_id,
      new.source_document_retry_activation_epoch,
      old.network_binding_recovery_request_digest,
      new.source_document_retry_original_expires_at,
      new.source_document_retry_recovered_at,
      new.expires_at,
      new.source_document_retry_reason_code
    );

    if new.source_document_retry_request_digest is distinct from expected_digest then
      raise exception 'The TeleBirr source-document recovery digest is invalid.';
    end if;

    return new;
  end if;

  if session_user <> 'postgres'
$new$;
  original_source text;
  original_definition text;
  original_owner oid;
  original_acl aclitem[];
  patched_source text;
  patched_definition text;
  actual_patched_sha text;
begin
  select routine.prosrc,
         pg_catalog.pg_get_functiondef(routine.oid),
         routine.proowner,
         routine.proacl
    into original_source, original_definition, original_owner, original_acl
    from pg_catalog.pg_proc routine
   where routine.oid = routine_signature
     and routine.prokind = 'f'
     and routine.prosecdef
     and not routine.proretset
     and routine.pronargs = 0
     and routine.proconfig = array['search_path=pg_catalog']::text[];

  if original_source is null
    or original_definition is null
    or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(original_source, 'UTF8'), 'sha256'),
         'hex'
       ) is distinct from expected_source_sha
    or (
      pg_catalog.length(original_source)
        - pg_catalog.length(pg_catalog.replace(original_source, old_marker, ''))
    ) / pg_catalog.length(old_marker) <> 1 then
    raise exception 'The TeleBirr network-retry guard source does not match.';
  end if;

  patched_source := pg_catalog.replace(original_source, old_marker, new_marker);
  patched_definition := pg_catalog.replace(original_definition, old_marker, new_marker);
  actual_patched_sha := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(patched_source, 'UTF8'), 'sha256'),
    'hex'
  );

  if actual_patched_sha is distinct from expected_patched_sha then
    raise exception
      'The TeleBirr source-document recovery guard is not reviewed (expected %, actual %).',
      expected_patched_sha,
      actual_patched_sha;
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
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The TeleBirr source-document guard changed authority.';
  end if;
end;
$patch_network_retry_guard_for_document_collision$;

create function app.recover_private_live_telebirr_source_document_collision(
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
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
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
    or p_reason_code is distinct from 'source_document_digest_collision' then
    raise exception 'The TeleBirr source-document recovery request is invalid.';
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
     and verification_job.network_retry_source_job_id is not null
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

  if job.id is null
    or authority.epoch is null
    or pilot.id is null
    or profile.id is null
    or proof.id is null then
    raise exception 'The TeleBirr source-document recovery lineage is unavailable.';
  end if;

  if job.source_document_retry_request_key is not null then
    if job.source_document_retry_request_key is distinct from p_recovery_request_key
      or job.source_document_retry_activation_epoch is distinct from p_activation_epoch
      or job.source_document_retry_reason_code is distinct from p_reason_code
      or job.source_document_retry_original_expires_at is null
      or job.source_document_retry_recovered_at is null
      or job.source_document_retry_request_digest is null then
      raise exception 'The TeleBirr source-document recovery replay conflicts.';
    end if;

    request_digest := app.private_live_telebirr_source_document_retry_digest(
      job.source_document_retry_request_key,
      job.id,
      job.pilot_revision_id,
      job.source_document_retry_activation_epoch,
      job.network_binding_recovery_request_digest,
      job.source_document_retry_original_expires_at,
      job.source_document_retry_recovered_at,
      job.expires_at,
      job.source_document_retry_reason_code
    );

    if job.source_document_retry_request_digest is distinct from request_digest then
      raise exception 'The TeleBirr source-document recovery replay is invalid.';
    end if;

    return query
    select job.id,
           job.source_document_retry_original_expires_at,
           job.expires_at,
           true;
    return;
  end if;

  authorized_at := pg_catalog.clock_timestamp();
  recovered_expiry := pg_catalog.least(
    authorized_at + interval '5 minutes',
    authority.expires_at,
    pilot.expires_at,
    profile.valid_until
  );

  if pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from authority.configuration_digest
    or job.pilot_configuration_digest is distinct from pilot.configuration_digest
    or job.network_retry_reason_code is distinct from
       'official_receipt_network_unavailable'
    or job.network_binding_original_expires_at is null
    or job.network_binding_recovered_at is null
    or job.network_binding_recovery_request_key is null
    or job.network_binding_recovery_request_digest !~ '^sha256:[0-9a-f]{64}$'
    or job.network_binding_recovery_reason_code is distinct from
       'network_retry_reference_binding_registry'
    or job.expires_at > authorized_at
    or authorized_at >= proof.submitted_at + interval '24 hours'
    or authorized_at >= job.network_retry_authorized_at + interval '24 hours'
    or authorized_at < profile.valid_from
    or authorized_at >= profile.valid_until
    or recovered_expiry <= authorized_at + interval '60 seconds'
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts attempt
         where attempt.verification_job_id = job.id) <> 4
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts attempt
         where attempt.verification_job_id = job.id
           and attempt.attempt_number between 1 and 4
           and attempt.expires_at <= authorized_at) <> 4
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts attempt
          join app.private_live_telebirr_assignment_transcripts transcript
            on transcript.verification_attempt_id = attempt.id
         where attempt.verification_job_id = job.id) <> 2
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts attempt
          join app.private_live_telebirr_assignment_deliveries delivery
            on delivery.verification_attempt_id = attempt.id
         where attempt.verification_job_id = job.id) <> 2
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts attempt
          join app.private_live_telebirr_device_evidence_staging evidence
            on evidence.verification_attempt_id = attempt.id
         where attempt.verification_job_id = job.id) <> 2
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
        join app.private_live_telebirr_observation_transcripts observation
          on observation.verification_attempt_id = attempt.id
       where attempt.verification_job_id = job.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = job.id
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id =
             job.private_live_deposit_pilot_proof_id
    )
    or not exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
        join app.private_live_telebirr_device_evidence_staging evidence
          on evidence.verification_attempt_id = attempt.id
        join app.private_live_telebirr_source_document_bindings binding
          on binding.source_document_digest =
             evidence.signed_observation -> 'body' ->> 'sourceDocumentDigest'
         and binding.payment_provider_id = job.payment_provider_id
         and binding.candidate_reference_fingerprint =
             job.candidate_reference_fingerprint
        join app.private_live_telebirr_observation_transcripts prior_observation
          on prior_observation.source_document_digest = binding.source_document_digest
        join app.private_live_telebirr_verification_attempts prior_attempt
          on prior_attempt.id = prior_observation.verification_attempt_id
         and prior_attempt.verification_job_id <> job.id
       where attempt.verification_job_id = job.id
    )
    or exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
        join app.private_live_telebirr_device_evidence_staging evidence
          on evidence.verification_attempt_id = attempt.id
        join app.private_live_telebirr_settlement_documents settlement_document
          on settlement_document.source_document_digest =
             evidence.signed_observation -> 'body' ->> 'sourceDocumentDigest'
       where attempt.verification_job_id = job.id
    )
    or not exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
        join app.private_live_telebirr_device_evidence_staging evidence
          on evidence.verification_attempt_id = attempt.id
        join app.private_live_telebirr_device_enrollments enrollment
          on enrollment.id = attempt.device_enrollment_id
         and enrollment.pilot_revision_id = pilot.id
         and enrollment.receiver_profile_id = profile.id
        join app.private_live_telebirr_device_heartbeats heartbeat
          on heartbeat.device_enrollment_id = enrollment.id
       where attempt.verification_job_id = job.id
         and authorized_at >= enrollment.valid_from
         and authorized_at < enrollment.valid_until
         and heartbeat.runtime_state = 'ready'
         and heartbeat.status_code = 'no_assignment'
         and heartbeat.last_seen_at > authorized_at - interval '6 minutes'
         and not exists (
           select 1 from app.private_live_telebirr_device_revocations revocation
            where revocation.device_enrollment_id = enrollment.id
              and revocation.revoked_at <= authorized_at
         )
    )
    or not exists (
      select 1
        from app.private_live_telebirr_verification_attempts attempt
        join app.private_live_telebirr_assignment_transcripts transcript
          on transcript.verification_attempt_id = attempt.id
        join app.private_live_telebirr_assignment_signers signer
          on signer.id = transcript.assignment_signer_id
       where attempt.verification_job_id = job.id
         and authorized_at >= signer.valid_from
         and authorized_at < signer.valid_until
         and not exists (
           select 1
             from app.private_live_telebirr_assignment_signer_revocations revocation
            where revocation.assignment_signer_id = signer.id
              and revocation.revoked_at <= authorized_at
         )
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
    raise exception 'The TeleBirr source-document collision is not recoverable.';
  end if;

  request_digest := app.private_live_telebirr_source_document_retry_digest(
    p_recovery_request_key,
    job.id,
    job.pilot_revision_id,
    p_activation_epoch,
    job.network_binding_recovery_request_digest,
    job.expires_at,
    authorized_at,
    recovered_expiry,
    p_reason_code
  );

  update app.private_live_telebirr_verification_jobs verification_job
     set source_document_retry_original_expires_at = verification_job.expires_at,
         source_document_retry_recovered_at = authorized_at,
         source_document_retry_activation_epoch = p_activation_epoch,
         source_document_retry_request_key = p_recovery_request_key,
         source_document_retry_request_digest = request_digest,
         source_document_retry_reason_code = p_reason_code,
         expires_at = recovered_expiry
   where verification_job.id = job.id
     and verification_job.source_document_retry_request_key is null
  returning verification_job.* into job;

  if job.source_document_retry_request_key is distinct from p_recovery_request_key
    or job.source_document_retry_request_digest is distinct from request_digest then
    raise exception 'The TeleBirr source-document recovery did not persist.';
  end if;

  return query
  select job.id,
         job.source_document_retry_original_expires_at,
         job.expires_at,
         false;
end;
$$;

alter function app.private_live_telebirr_source_document_retry_digest(
  uuid, uuid, uuid, bigint, text, timestamptz, timestamptz, timestamptz, text
) owner to postgres;
alter function app.recover_private_live_telebirr_source_document_collision(
  uuid, uuid, bigint, uuid, text
) owner to postgres;

revoke all on function app.private_live_telebirr_source_document_retry_digest(
  uuid, uuid, uuid, bigint, text, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function app.recover_private_live_telebirr_source_document_collision(
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
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

comment on function app.private_live_telebirr_source_document_retry_digest(
  uuid, uuid, uuid, bigint, text, timestamptz, timestamptz, timestamptz, text
) is
  'Immutable audit digest for the one-use live TeleBirr source-document collision recovery.';

comment on function app.recover_private_live_telebirr_source_document_collision(
  uuid, uuid, bigint, uuid, text
) is
  'Postgres-only, one-use recovery of the exact expired four-attempt live job stranded by the former source-document uniqueness boundary. It creates no financial or evidence row and requires KemerBet to remain disabled.';

comment on column
  app.private_live_telebirr_verification_jobs.source_document_retry_request_digest is
  'Immutable audit digest for the exact recovery window opened after a same-reference source-document collision.';

commit;
