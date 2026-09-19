-- Recover one exact receipt whose immutable source digest was first recorded by an older,
-- nonfinancial review under a different provider-reference fingerprint. The original binding,
-- observation, and outcome remain append-only. A single 12-hour sidecar records the reviewed
-- supersession and reuses the already-closed verifier-only completion authority exactly once.
-- KemerBet login, settlement execution, feature switches, and money movement remain untouched.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $guard_reviewed_source_binding_recovery_predecessors$
begin
  if pg_catalog.to_regclass(
       'app.private_live_telebirr_source_document_bindings'
     ) is null
    or pg_catalog.to_regclass(
         'app.private_live_telebirr_historical_completion_authorities'
       ) is null
    or pg_catalog.to_regclass(
         'app.private_live_telebirr_historical_completion_closures'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.is_private_live_telebirr_historical_boundary_authorized(uuid)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.consume_private_live_telebirr_historical_completion(uuid,uuid,boolean)'
       ) is null
    or pg_catalog.to_regprocedure(
         'app.enforce_private_live_telebirr_source_document_binding()'
       ) is null
    or pg_catalog.to_regclass(
         'app.private_live_telebirr_source_binding_recovery_retries'
       ) is not null then
    raise exception 'The reviewed TeleBirr source-binding recovery predecessors do not match.';
  end if;
end;
$guard_reviewed_source_binding_recovery_predecessors$;

create table app.private_live_telebirr_source_binding_recovery_retries (
  retry_request_key uuid primary key,
  original_authority_request_key uuid not null unique
    references app.private_live_telebirr_historical_completion_authorities (request_key)
      on delete restrict,
  source_document_digest text not null unique
    references app.private_live_telebirr_source_document_bindings (
      source_document_digest
    ) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  prior_verification_job_id uuid not null unique
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  prior_verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  prior_verification_outcome_id uuid not null unique
    references app.private_live_telebirr_verification_outcomes (id) on delete restrict,
  current_verification_job_id uuid not null unique
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  current_verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  prior_candidate_reference_fingerprint text not null
    check (prior_candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  current_candidate_reference_fingerprint text not null
    check (current_candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  normalized_facts_digest text not null
    check (normalized_facts_digest ~ '^sha256:[0-9a-f]{64}$'),
  reason_code text not null check (
    reason_code = 'source_binding_supersession_after_nonfinancial_review'
  ),
  request_digest text not null unique
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  authorized_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_tbirr_source_binding_retry_request_v4 check (
    retry_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_tbirr_source_binding_retry_window check (
    expires_at >= authorized_at + interval '12 hours'
    and expires_at <= authorized_at + interval '12 hours 5 minutes'
  ),
  constraint private_live_tbirr_source_binding_retry_distinct check (
    prior_verification_job_id <> current_verification_job_id
    and prior_verification_attempt_id <> current_verification_attempt_id
    and prior_candidate_reference_fingerprint <>
        current_candidate_reference_fingerprint
  )
);

create table app.private_live_telebirr_source_binding_recovery_closures (
  retry_request_key uuid primary key
    references app.private_live_telebirr_source_binding_recovery_retries (
      retry_request_key
    ) on delete restrict,
  reason_code text not null check (reason_code in ('completed', 'operator_stop')),
  closed_at timestamptz not null default pg_catalog.clock_timestamp()
);

create trigger private_live_tbirr_source_binding_retries_immutable
before update or delete on app.private_live_telebirr_source_binding_recovery_retries
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_tbirr_source_binding_retries_no_truncate
before truncate on app.private_live_telebirr_source_binding_recovery_retries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger private_live_tbirr_source_binding_retry_closures_immutable
before update or delete on app.private_live_telebirr_source_binding_recovery_closures
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_tbirr_source_binding_retry_closures_no_truncate
before truncate on app.private_live_telebirr_source_binding_recovery_closures
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.private_live_telebirr_source_binding_recovery_digest(
  p_retry_request_key uuid,
  p_original_authority_request_key uuid,
  p_source_document_digest text,
  p_payment_provider_id uuid,
  p_prior_verification_job_id uuid,
  p_prior_verification_attempt_id uuid,
  p_prior_verification_outcome_id uuid,
  p_current_verification_job_id uuid,
  p_current_verification_attempt_id uuid,
  p_prior_candidate_reference_fingerprint text,
  p_current_candidate_reference_fingerprint text,
  p_normalized_facts_digest text,
  p_authorized_at timestamptz,
  p_expires_at timestamptz,
  p_reason_code text
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog
as $$
  select app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:source-binding-recovery:v1'
      || '|retry_request_key=' || p_retry_request_key::text
      || '|original_authority_request_key=' || p_original_authority_request_key::text
      || '|source_document_digest=' || p_source_document_digest
      || '|payment_provider_id=' || p_payment_provider_id::text
      || '|prior_job_id=' || p_prior_verification_job_id::text
      || '|prior_attempt_id=' || p_prior_verification_attempt_id::text
      || '|prior_outcome_id=' || p_prior_verification_outcome_id::text
      || '|current_job_id=' || p_current_verification_job_id::text
      || '|current_attempt_id=' || p_current_verification_attempt_id::text
      || '|prior_reference_fingerprint=' || p_prior_candidate_reference_fingerprint
      || '|current_reference_fingerprint=' || p_current_candidate_reference_fingerprint
      || '|normalized_facts_digest=' || p_normalized_facts_digest
      || '|authorized_at_us=' ||
         (pg_catalog.date_part('epoch', p_authorized_at) * 1000000)::bigint::text
      || '|expires_at_us=' ||
         (pg_catalog.date_part('epoch', p_expires_at) * 1000000)::bigint::text
      || '|reason_code=' || p_reason_code
  )
$$;

-- The shared boundary remains unchanged for every historical completion without a recovery
-- sidecar. The one reviewed sidecar is usable only after the original authority was closed with
-- operator_stop, before either a retry closure or a financial consumption exists, and while the
-- exact verifier login is bounded to the sidecar expiry.
create or replace function app.is_private_live_telebirr_historical_boundary_authorized(
  p_request_key uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.bool_and(
    authority.request_key = p_request_key
    and authority.verification_job_id = job.id
    and authority.private_live_deposit_pilot_proof_id = proof.id
    and authority.pilot_revision_id = pilot.id
    and authority.expired_activation_epoch = activation_epoch.epoch
    and activation_control.current_epoch = activation_epoch.epoch
    and activation_epoch.authority_state = 'active'
    and activation_epoch.pilot_revision_id = pilot.id
    and activation_epoch.configuration_digest = pilot.configuration_digest
    and job.pilot_revision_id = pilot.id
    and job.pilot_configuration_digest = pilot.configuration_digest
    and proof.pilot_revision_id = pilot.id
    and proof.submitted_at + interval '24 hours' > pg_catalog.clock_timestamp()
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = authority.request_key
    )
    and not exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       ) and role.rolcanlogin
    )
    and not exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       )
    )
    and (
      (
        retry.retry_request_key is null
        and original_closure.request_key is null
        and pg_catalog.clock_timestamp() >= authority.authorized_at
        and pg_catalog.clock_timestamp() < authority.expires_at
        and exists (
          select 1
            from pg_catalog.pg_authid role
           where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
             and role.rolcanlogin
             and not role.rolinherit and not role.rolsuper
             and not role.rolcreatedb and not role.rolcreaterole
             and not role.rolreplication and not role.rolbypassrls
             and role.rolconnlimit = 1
             and role.rolvaliduntil is not distinct from authority.expires_at
             and role.rolpassword like 'SCRAM-SHA-256$%'
        )
      )
      or (
        retry.retry_request_key is not null
        and authority.reason_code = 'expired_attempt_staged_evidence_completion'
        and retry.current_verification_job_id = authority.verification_job_id
        and retry.current_verification_attempt_id = authority.verification_attempt_id
        and retry.source_document_digest = authority.source_document_digest
        and retry.reason_code =
            'source_binding_supersession_after_nonfinancial_review'
        and original_closure.reason_code = 'operator_stop'
        and original_closure.closed_at <= retry.authorized_at
        and retry_closure.retry_request_key is null
        and pg_catalog.clock_timestamp() >= retry.authorized_at
        and pg_catalog.clock_timestamp() < retry.expires_at
        and exists (
          select 1
            from pg_catalog.pg_authid role
           where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
             and role.rolcanlogin
             and not role.rolinherit and not role.rolsuper
             and not role.rolcreatedb and not role.rolcreaterole
             and not role.rolreplication and not role.rolbypassrls
             and role.rolconnlimit = 1
             and role.rolvaliduntil is not distinct from retry.expires_at
             and role.rolpassword like 'SCRAM-SHA-256$%'
        )
      )
    )
    and (
      (
        authority.reason_code = 'expired_attempt_staged_evidence_completion'
        and activation_epoch.revoked_at is null
        and emergency_intent.request_key is null
        and coalesce(retry.authorized_at, authority.authorized_at) >= pilot.active_from
        and coalesce(retry.authorized_at, authority.authorized_at) < pilot.expires_at
        and pilot.status = 'armed'
        and (
          select pg_catalog.count(*)
            from app.feature_switches feature_switch
           where feature_switch.feature_key in (
             'deposit_execution', 'payment_verification',
             'private_live_deposit_pilot', 'telebirr_authoritative_verification'
           ) and feature_switch.mode = 'live'
        ) = 4
        and exists (
          select 1
            from app.feature_switches feature_switch
           where feature_switch.feature_key = 'private_live_deposit_pilot'
             and feature_switch.settings = pg_catalog.jsonb_build_object(
               'contract_version', 1,
               'pilot_revision_id', pilot.id,
               'configuration_digest', pilot.configuration_digest
             )
        )
      )
      or (
        authority.reason_code = 'expired_authority_staged_evidence_completion'
        and retry.retry_request_key is null
        and activation_epoch.expires_at <= pg_catalog.clock_timestamp()
        and (
          (
            activation_epoch.revoked_at is null
            and emergency_intent.request_key is null
            and pilot.status = 'armed'
            and (
              select pg_catalog.count(*)
                from app.feature_switches feature_switch
               where feature_switch.feature_key in (
                 'deposit_execution', 'payment_verification',
                 'private_live_deposit_pilot', 'telebirr_authoritative_verification'
               ) and feature_switch.mode = 'live'
            ) = 4
            and exists (
              select 1
                from app.feature_switches feature_switch
               where feature_switch.feature_key = 'private_live_deposit_pilot'
                 and feature_switch.settings = pg_catalog.jsonb_build_object(
                   'contract_version', 1,
                   'pilot_revision_id', pilot.id,
                   'configuration_digest', pilot.configuration_digest
                 )
            )
          )
          or (
            activation_epoch.revoked_at is not null
            and activation_epoch.revocation_reason_code = 'execution_uncertainty'
            and emergency_intent.request_key is not null
            and emergency_intent.expected_epoch = activation_epoch.epoch
            and emergency_intent.reason_code = activation_epoch.revocation_reason_code
            and emergency_intent.requested_at is not distinct from activation_epoch.revoked_at
            and activation_epoch.expires_at <= emergency_intent.requested_at
            and pilot.status = 'stopped'
            and pilot.stopped_at is not distinct from emergency_intent.requested_at
            and pilot.stopped_by_admin_id is not distinct from
                emergency_intent.requested_by_admin_id
            and pilot.stop_reason_code is not distinct from emergency_intent.reason_code
            and pilot.expires_at <= emergency_intent.requested_at
            and app.current_private_trusted_telebirr_activation_epoch() is null
            and (
              select pg_catalog.count(*)
                from app.feature_switches feature_switch
               where feature_switch.feature_key in (
                 'cbe_birr_authoritative_verification', 'deposit_execution',
                 'payment_verification', 'private_live_deposit_pilot',
                 'telebirr_authoritative_verification', 'withdrawal_collection',
                 'withdrawal_validation'
               ) and feature_switch.mode = 'disabled'
                 and feature_switch.settings = '{}'::jsonb
            ) = 7
          )
        )
      )
    )
  ), false)
  from app.private_live_telebirr_historical_completion_authorities authority
  join app.private_live_telebirr_verification_jobs job
    on job.id = authority.verification_job_id
  join app.private_live_deposit_pilot_proofs proof
    on proof.id = authority.private_live_deposit_pilot_proof_id
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = authority.pilot_revision_id
  join app.private_trusted_telebirr_activation_control activation_control
    on activation_control.control_key = 'trusted_telebirr_financial_authority'
  join app.private_trusted_telebirr_activation_epochs activation_epoch
    on activation_epoch.epoch = activation_control.current_epoch
   and activation_epoch.epoch = authority.expired_activation_epoch
  left join app.private_trusted_telebirr_emergency_disable_intents emergency_intent
    on emergency_intent.expected_epoch = activation_epoch.epoch
  left join app.private_live_telebirr_historical_completion_closures original_closure
    on original_closure.request_key = authority.request_key
  left join app.private_live_telebirr_source_binding_recovery_retries retry
    on retry.original_authority_request_key = authority.request_key
  left join app.private_live_telebirr_source_binding_recovery_closures retry_closure
    on retry_closure.retry_request_key = retry.retry_request_key
  where authority.request_key = p_request_key
$$;

create function app.is_private_live_telebirr_source_binding_recovery_authorized(
  p_verification_attempt_id uuid,
  p_source_document_digest text,
  p_normalized_facts_digest text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.bool_and(
    retry.current_verification_attempt_id = attempt.id
    and retry.current_verification_job_id = job.id
    and retry.payment_provider_id = job.payment_provider_id
    and retry.current_candidate_reference_fingerprint =
        job.candidate_reference_fingerprint
    and retry.source_document_digest = p_source_document_digest
    and retry.normalized_facts_digest = p_normalized_facts_digest
    and binding.source_document_digest = retry.source_document_digest
    and binding.payment_provider_id = retry.payment_provider_id
    and binding.candidate_reference_fingerprint =
        retry.prior_candidate_reference_fingerprint
    and binding.first_verification_attempt_id = retry.prior_verification_attempt_id
    and prior_observation.verification_attempt_id = retry.prior_verification_attempt_id
    and prior_observation.source_document_digest = retry.source_document_digest
    and prior_observation.normalized_facts_digest = retry.normalized_facts_digest
    and prior_outcome.id = retry.prior_verification_outcome_id
    and prior_outcome.disposition = 'review_required'
    and prior_outcome.reason_code = 'source_unavailable'
    and app.is_private_live_telebirr_historical_boundary_authorized(
      retry.original_authority_request_key
    )
    and not exists (
      select 1
        from app.private_live_telebirr_settlement_documents document
       where document.source_document_digest = retry.source_document_digest
    )
  ), false)
  from app.private_live_telebirr_source_binding_recovery_retries retry
  join app.private_live_telebirr_verification_attempts attempt
    on attempt.id = retry.current_verification_attempt_id
  join app.private_live_telebirr_verification_jobs job
    on job.id = retry.current_verification_job_id
   and job.id = attempt.verification_job_id
  join app.private_live_telebirr_source_document_bindings binding
    on binding.source_document_digest = retry.source_document_digest
  join app.private_live_telebirr_observation_transcripts prior_observation
    on prior_observation.verification_attempt_id = retry.prior_verification_attempt_id
  join app.private_live_telebirr_verification_outcomes prior_outcome
    on prior_outcome.id = retry.prior_verification_outcome_id
   and prior_outcome.observation_transcript_id = prior_observation.id
  where retry.current_verification_attempt_id = p_verification_attempt_id
$$;

create or replace function app.enforce_private_live_telebirr_source_document_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_provider_id uuid;
  resolved_reference_fingerprint text;
  registered_binding app.private_live_telebirr_source_document_bindings%rowtype;
begin
  select job.payment_provider_id, job.candidate_reference_fingerprint
    into resolved_provider_id, resolved_reference_fingerprint
    from app.private_live_telebirr_verification_attempts attempt
    join app.private_live_telebirr_verification_jobs job
      on job.id = attempt.verification_job_id
   where attempt.id = new.verification_attempt_id
   for share of attempt, job;

  if resolved_provider_id is null or resolved_reference_fingerprint is null then
    raise exception 'The TeleBirr source-document reference binding is unavailable.';
  end if;

  insert into app.private_live_telebirr_source_document_bindings (
    source_document_digest,
    payment_provider_id,
    candidate_reference_fingerprint,
    first_verification_attempt_id
  ) values (
    new.source_document_digest,
    resolved_provider_id,
    resolved_reference_fingerprint,
    new.verification_attempt_id
  )
  on conflict (source_document_digest) do nothing;

  select binding.*
    into registered_binding
    from app.private_live_telebirr_source_document_bindings binding
   where binding.source_document_digest = new.source_document_digest
   for update;

  if registered_binding.source_document_digest is null
    or registered_binding.payment_provider_id is distinct from resolved_provider_id
    or (
      registered_binding.candidate_reference_fingerprint
        is distinct from resolved_reference_fingerprint
      and not app.is_private_live_telebirr_source_binding_recovery_authorized(
        new.verification_attempt_id,
        new.source_document_digest,
        new.normalized_facts_digest
      )
    ) then
    raise exception
      'The TeleBirr source document belongs to another provider reference.';
  end if;

  return new;
end;
$$;

create function app.arm_private_live_telebirr_source_binding_recovery(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_retry_request_key uuid,
  p_scram_verifier text,
  p_reason_code text
)
returns table (
  authorized_at timestamptz,
  expires_at timestamptz,
  already_armed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  activation app.private_trusted_telebirr_activation_epochs%rowtype;
  authority app.private_live_telebirr_historical_completion_authorities%rowtype;
  authority_closure app.private_live_telebirr_historical_completion_closures%rowtype;
  binding app.private_live_telebirr_source_document_bindings%rowtype;
  current_attempt app.private_live_telebirr_verification_attempts%rowtype;
  current_job app.private_live_telebirr_verification_jobs%rowtype;
  current_proof app.private_live_deposit_pilot_proofs%rowtype;
  current_profile app.private_live_telebirr_receiver_profiles%rowtype;
  current_staged app.private_live_telebirr_device_evidence_staging%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  prior_attempt app.private_live_telebirr_verification_attempts%rowtype;
  prior_job app.private_live_telebirr_verification_jobs%rowtype;
  prior_observation app.private_live_telebirr_observation_transcripts%rowtype;
  prior_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  prior_proof app.private_live_deposit_pilot_proofs%rowtype;
  existing_retry app.private_live_telebirr_source_binding_recovery_retries%rowtype;
  exact_source_document_digest text;
  exact_normalized_facts_digest text;
  exact_request_digest text;
  armed_at timestamptz;
  armed_until timestamptz;
begin
  if session_user <> 'postgres'
    or p_verification_job_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null or p_activation_epoch <= 0
    or p_retry_request_key is null
    or p_retry_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_scram_verifier is null
    or p_scram_verifier
       !~ '^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$'
    or p_reason_code is distinct from
       'source_binding_supersession_after_nonfinancial_review' then
    raise exception 'The reviewed TeleBirr source-binding recovery request is invalid.';
  end if;

  perform control.current_epoch
    from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  select epoch.* into activation
    from app.private_trusted_telebirr_activation_control control
    join app.private_trusted_telebirr_activation_epochs epoch
      on epoch.epoch = control.current_epoch
   where control.control_key = 'trusted_telebirr_financial_authority'
     and epoch.epoch = p_activation_epoch
     and epoch.pilot_revision_id = p_pilot_revision_id
   for share of control, epoch;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   ) order by feature_switch.feature_key for update;

  select verification_job.* into current_job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = p_verification_job_id
     and verification_job.pilot_revision_id = p_pilot_revision_id
     and verification_job.recovery_reason_code = 'assignment_runtime_unavailable'
     and verification_job.recovered_at is not null
     and verification_job.recovery_request_key is not null
   for update;

  select revision.* into pilot
    from app.private_live_deposit_pilot_revisions revision
   where revision.id = p_pilot_revision_id
   for update;

  select proof.* into current_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = current_job.private_live_deposit_pilot_proof_id
     and proof.pilot_revision_id = pilot.id
   for share;

  select profile.* into current_profile
    from app.private_live_telebirr_receiver_profiles profile
   where profile.id = current_job.receiver_profile_id
     and profile.pilot_revision_id = pilot.id
   for share;

  select attempt.* into current_attempt
    from app.private_live_telebirr_verification_attempts attempt
    join app.private_live_telebirr_device_evidence_staging staged
      on staged.verification_attempt_id = attempt.id
   where attempt.verification_job_id = current_job.id
   order by staged.staged_at desc, attempt.attempt_number desc
   limit 1 for share of attempt, staged;

  select staged.* into current_staged
    from app.private_live_telebirr_device_evidence_staging staged
   where staged.verification_attempt_id = current_attempt.id
   order by staged.staged_at desc
   limit 1 for share;

  select recovery.* into authority
    from app.private_live_telebirr_historical_completion_authorities recovery
   where recovery.verification_job_id = current_job.id
     and recovery.verification_attempt_id = current_attempt.id
   for share;

  select closure.* into authority_closure
    from app.private_live_telebirr_historical_completion_closures closure
   where closure.request_key = authority.request_key
   for share;

  select device_enrollment.* into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = current_attempt.device_enrollment_id
   for share;

  select assignment_signer.* into signer
    from app.private_live_telebirr_assignment_transcripts transcript
    join app.private_live_telebirr_assignment_signers assignment_signer
      on assignment_signer.id = transcript.assignment_signer_id
   where transcript.verification_attempt_id = current_attempt.id
   for share of transcript, assignment_signer;

  exact_source_document_digest :=
    current_staged.signed_observation -> 'body' ->> 'sourceDocumentDigest';
  exact_normalized_facts_digest :=
    current_staged.signed_observation -> 'body' ->> 'normalizedFactsDigest';

  select registered.* into binding
    from app.private_live_telebirr_source_document_bindings registered
   where registered.source_document_digest = exact_source_document_digest
   for share;

  select attempt.* into prior_attempt
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.id = binding.first_verification_attempt_id
   for share;

  select verification_job.* into prior_job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = prior_attempt.verification_job_id
   for share;

  select proof.* into prior_proof
    from app.private_live_deposit_pilot_proofs proof
   where proof.id = prior_job.private_live_deposit_pilot_proof_id
   for share;

  select observation.* into prior_observation
    from app.private_live_telebirr_observation_transcripts observation
   where observation.verification_attempt_id = prior_attempt.id
     and observation.source_document_digest = exact_source_document_digest
   for share;

  select outcome.* into prior_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.observation_transcript_id = prior_observation.id
     and outcome.verification_attempt_id = prior_attempt.id
     and outcome.verification_job_id = prior_job.id
   for share;

  armed_at := pg_catalog.clock_timestamp();
  armed_until := armed_at + interval '12 hours';

  select retry.* into existing_retry
    from app.private_live_telebirr_source_binding_recovery_retries retry
   where retry.retry_request_key = p_retry_request_key
      or retry.original_authority_request_key = authority.request_key
      or retry.source_document_digest = exact_source_document_digest
      or retry.current_verification_job_id = current_job.id
      or retry.current_verification_attempt_id = current_attempt.id
   order by retry.created_at, retry.retry_request_key
   limit 1 for share;

  if existing_retry.retry_request_key is not null then
    if existing_retry.retry_request_key is distinct from p_retry_request_key
      or existing_retry.original_authority_request_key is distinct from authority.request_key
      or existing_retry.source_document_digest is distinct from exact_source_document_digest
      or existing_retry.prior_verification_job_id is distinct from prior_job.id
      or existing_retry.prior_verification_attempt_id is distinct from prior_attempt.id
      or existing_retry.prior_verification_outcome_id is distinct from prior_outcome.id
      or existing_retry.current_verification_job_id is distinct from current_job.id
      or existing_retry.current_verification_attempt_id is distinct from current_attempt.id
      or existing_retry.reason_code is distinct from p_reason_code
      or existing_retry.expires_at <= armed_at + interval '5 minutes'
      or exists (
        select 1
          from app.private_live_telebirr_source_binding_recovery_closures closure
         where closure.retry_request_key = existing_retry.retry_request_key
      )
      or not app.is_private_live_telebirr_historical_boundary_authorized(
        authority.request_key
      ) then
      raise exception 'The reviewed TeleBirr source-binding recovery replay conflicts.';
    end if;
    return query
      select existing_retry.authorized_at, existing_retry.expires_at, true;
    return;
  end if;

  perform disabled.verifier_login
    from app.disable_private_trusted_telebirr_verifier_login() disabled;

  if activation.epoch is null
    or activation.authority_state <> 'active'
    or activation.revoked_at is not null
    or activation.expires_at <= armed_at
    or pilot.id is null or pilot.status <> 'armed'
    or armed_at < pilot.active_from or armed_at >= pilot.expires_at
    or pilot.configuration_digest is distinct from activation.configuration_digest
    or current_job.id is null or current_proof.id is null or current_profile.id is null
    or current_proof.origin_channel <> 'telegram'
    or current_proof.input_kind <> 'direct_transaction_id'
    or current_proof.submitted_at + interval '24 hours' < armed_until
    or current_attempt.id is null or current_staged.observation_body_digest is null
    or enrollment.id is null or signer.id is null
    or exact_source_document_digest is null
    or exact_source_document_digest !~ '^sha256:[0-9a-f]{64}$'
    or exact_normalized_facts_digest is null
    or exact_normalized_facts_digest !~ '^sha256:[0-9a-f]{64}$'
    or current_job.expires_at > armed_at
    or current_attempt.expires_at > armed_at
    or current_attempt.issued_at < current_job.recovered_at
    or current_attempt.expires_at > current_job.expires_at
    or current_attempt.issued_at < pilot.active_from
    or current_attempt.expires_at > pilot.expires_at
    or current_attempt.issued_at < current_profile.valid_from
    or current_attempt.expires_at > current_profile.valid_until
    or current_attempt.issued_at < enrollment.valid_from
    or current_attempt.expires_at > enrollment.valid_until
    or current_attempt.issued_at < signer.valid_from
    or current_attempt.expires_at > signer.valid_until
    or current_staged.observed_at < current_attempt.issued_at
    or current_staged.observed_at >= current_attempt.expires_at
    or current_staged.staged_at >= current_attempt.expires_at
    or authority.request_key is null
    or authority.reason_code <> 'expired_attempt_staged_evidence_completion'
    or authority.verification_job_id is distinct from current_job.id
    or authority.verification_attempt_id is distinct from current_attempt.id
    or authority.private_live_deposit_pilot_proof_id is distinct from current_proof.id
    or authority.pilot_revision_id is distinct from pilot.id
    or authority.receiver_profile_id is distinct from current_profile.id
    or authority.expired_activation_epoch is distinct from activation.epoch
    or authority.observation_body_digest is distinct from
       current_staged.observation_body_digest
    or authority.source_document_digest is distinct from exact_source_document_digest
    or authority_closure.reason_code <> 'operator_stop'
    or authority_closure.closed_at < authority.authorized_at
    or exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = authority.request_key
    )
    or binding.source_document_digest is null
    or binding.payment_provider_id is distinct from current_job.payment_provider_id
    or binding.candidate_reference_fingerprint is not distinct from
       current_job.candidate_reference_fingerprint
    or binding.first_verification_attempt_id is distinct from prior_attempt.id
    or prior_job.id is null or prior_proof.id is null
    or prior_job.recovery_reason_code <> 'device_evidence_binding_mismatch'
    or prior_proof.origin_channel <> 'telegram'
    or prior_proof.input_kind <> 'direct_transaction_id'
    or prior_job.id = current_job.id
    or prior_proof.id = current_proof.id
    or prior_job.payment_provider_id is distinct from current_job.payment_provider_id
    or prior_job.submitting_customer_id is distinct from current_job.submitting_customer_id
    or prior_job.player_account_id is distinct from current_job.player_account_id
    or prior_job.receiver_account_id is distinct from current_job.receiver_account_id
    or prior_job.receiver_account_version is distinct from current_job.receiver_account_version
    or prior_job.receiver_identity_digest is distinct from current_job.receiver_identity_digest
    or prior_job.expected_receiver_name_digest is distinct from
       current_job.expected_receiver_name_digest
    or prior_job.candidate_reference_fingerprint is distinct from
       binding.candidate_reference_fingerprint
    or prior_job.candidate_reference_fingerprint is not distinct from
       current_job.candidate_reference_fingerprint
    or prior_observation.id is null
    or prior_observation.normalized_facts_digest is distinct from
       exact_normalized_facts_digest
    or prior_outcome.id is null
    or prior_outcome.disposition <> 'review_required'
    or prior_outcome.reason_code <> 'source_unavailable'
    or prior_outcome.deposit_intent_id is not null
    or prior_outcome.deposit_submission_id is not null
    or prior_outcome.provider_payment_evidence_id is not null
    or prior_outcome.deposit_verification_attempt_id is not null
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts attempt
         where attempt.verification_job_id = current_job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_assignment_transcripts transcript
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = transcript.verification_attempt_id
         where attempt.verification_job_id = current_job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_assignment_deliveries delivery
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = delivery.verification_attempt_id
         where attempt.verification_job_id = current_job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_device_evidence_staging evidence
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = evidence.verification_attempt_id
         where attempt.verification_job_id = current_job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts attempt
         where attempt.verification_job_id = prior_job.id) <> 3
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_assignment_transcripts transcript
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = transcript.verification_attempt_id
         where attempt.verification_job_id = prior_job.id) <> 2
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_assignment_deliveries delivery
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = delivery.verification_attempt_id
         where attempt.verification_job_id = prior_job.id) <> 2
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_device_evidence_staging evidence
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = evidence.verification_attempt_id
         where attempt.verification_job_id = prior_job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_observation_transcripts observation
          join app.private_live_telebirr_verification_attempts attempt
            on attempt.id = observation.verification_attempt_id
         where attempt.verification_job_id = prior_job.id) <> 1
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_outcomes outcome
         where outcome.verification_job_id = prior_job.id) <> 1
    or exists (
      select 1 from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = current_job.id
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id in (
         current_proof.id, prior_proof.id
       )
    )
    or exists (
      select 1 from app.private_live_telebirr_settlement_documents document
       where document.source_document_digest = exact_source_document_digest
    )
    or exists (
      select 1 from app.private_live_telebirr_settlement_receipts receipt
       where receipt.verification_outcome_id = prior_outcome.id
    )
    or exists (
      select 1 from app.provider_payment_evidence payment_evidence
       where payment_evidence.payment_provider_id = current_job.payment_provider_id
         and payment_evidence.canonical_reference_fingerprint in (
           prior_job.candidate_reference_fingerprint,
           current_job.candidate_reference_fingerprint
         )
    )
    or exists (
      select 1 from app.private_live_telebirr_verifier_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = current_attempt.id
          or quarantine.observation_body_digest = current_staged.observation_body_digest
    )
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
    )
    or (select pg_catalog.count(*) from app.feature_switches feature_switch
         where feature_switch.feature_key in (
           'deposit_execution', 'payment_verification',
           'private_live_deposit_pilot', 'telebirr_authoritative_verification'
         ) and feature_switch.mode = 'live') <> 4
    or not exists (
      select 1 from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    or (select pg_catalog.count(*) from app.feature_switches feature_switch
         where feature_switch.feature_key in (
           'cbe_birr_authoritative_verification', 'withdrawal_collection',
           'withdrawal_validation'
         ) and feature_switch.mode = 'disabled'
           and feature_switch.settings = '{}'::jsonb) <> 3
    or exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       ) and role.rolcanlogin
    )
    or exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime',
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
    )
    or not exists (
      select 1 from pg_catalog.pg_authid role
       where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
         and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 1 and role.rolpassword is null
    )
    or not exists (
      select 1 from pg_catalog.pg_authid role
       where role.rolname = 'fetanagent_trusted_telebirr_verifier'
         and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 2 and role.rolpassword is null
    )
    or (select pg_catalog.count(*)
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
          join pg_catalog.pg_roles member_role on member_role.oid = membership.member
         where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
           and granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
           and membership.inherit_option and not membership.set_option
           and not membership.admin_option) <> 1
    or (select pg_catalog.count(*)
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles member_role on member_role.oid = membership.member
         where member_role.rolname =
               'fetanagent_trusted_telebirr_verifier_runtime') <> 1
    or (select pg_catalog.count(*)
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
         where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier') <> 2
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
         and member_role.rolname = 'postgres'
         and not membership.inherit_option and not membership.set_option
         and membership.admin_option
    ) then
    raise exception 'The reviewed TeleBirr source binding is not recoverable.';
  end if;

  exact_request_digest := app.private_live_telebirr_source_binding_recovery_digest(
    p_retry_request_key,
    authority.request_key,
    exact_source_document_digest,
    current_job.payment_provider_id,
    prior_job.id,
    prior_attempt.id,
    prior_outcome.id,
    current_job.id,
    current_attempt.id,
    prior_job.candidate_reference_fingerprint,
    current_job.candidate_reference_fingerprint,
    exact_normalized_facts_digest,
    armed_at,
    armed_until,
    p_reason_code
  );

  insert into app.private_live_telebirr_source_binding_recovery_retries (
    retry_request_key,
    original_authority_request_key,
    source_document_digest,
    payment_provider_id,
    prior_verification_job_id,
    prior_verification_attempt_id,
    prior_verification_outcome_id,
    current_verification_job_id,
    current_verification_attempt_id,
    prior_candidate_reference_fingerprint,
    current_candidate_reference_fingerprint,
    normalized_facts_digest,
    reason_code,
    request_digest,
    authorized_at,
    expires_at
  ) values (
    p_retry_request_key,
    authority.request_key,
    exact_source_document_digest,
    current_job.payment_provider_id,
    prior_job.id,
    prior_attempt.id,
    prior_outcome.id,
    current_job.id,
    current_attempt.id,
    prior_job.candidate_reference_fingerprint,
    current_job.candidate_reference_fingerprint,
    exact_normalized_facts_digest,
    p_reason_code,
    exact_request_digest,
    armed_at,
    armed_until
  ) returning * into existing_retry;

  execute pg_catalog.format(
    'alter role %I login password %L valid until %L',
    'fetanagent_trusted_telebirr_verifier_runtime',
    p_scram_verifier,
    existing_retry.expires_at
  );

  if not exists (
    select 1 from pg_catalog.pg_authid role
     where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and role.rolcanlogin and not role.rolinherit and not role.rolsuper
       and not role.rolcreatedb and not role.rolcreaterole
       and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not distinct from existing_retry.expires_at
       and role.rolpassword is not distinct from p_scram_verifier
  ) then
    raise exception 'The bounded reviewed TeleBirr verifier login was not provisioned exactly.';
  end if;

  insert into app.audit_events (
    actor_kind, actor_label, action, resource_type, resource_id, metadata
  ) values (
    'worker', 'reviewed-live-telebirr-source-binding-recovery',
    'deposit.live_telebirr_source_binding_recovery_armed',
    'private_live_deposit_pilot', pilot.id,
    pg_catalog.jsonb_build_object(
      'reason_code', p_reason_code,
      'expires_at', existing_retry.expires_at,
      'original_binding_preserved', true,
      'financial_rows_created', false,
      'execution_enabled', false
    )
  );

  if not app.is_private_live_telebirr_historical_boundary_authorized(
    authority.request_key
  ) then
    raise exception 'The reviewed TeleBirr source-binding recovery did not arm exactly.';
  end if;

  return query
    select existing_retry.authorized_at, existing_retry.expires_at, false;
end;
$$;

create or replace function app.consume_private_live_telebirr_historical_completion(
  p_request_key uuid,
  p_verification_outcome_id uuid,
  p_settlement_created boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  authority app.private_live_telebirr_historical_completion_authorities%rowtype;
  retry app.private_live_telebirr_source_binding_recovery_retries%rowtype;
  existing app.private_live_telebirr_historical_completion_consumptions%rowtype;
  outcome app.private_live_telebirr_verification_outcomes%rowtype;
  receipt app.private_live_telebirr_settlement_receipts%rowtype;
  reservation app.private_live_deposit_pilot_reservations%rowtype;
  execution_job app.deposit_jobs%rowtype;
  consumed_at timestamptz;
begin
  if p_request_key is null
    or p_verification_outcome_id is null
    or p_settlement_created is null then
    raise exception 'The historical TeleBirr completion consumption is invalid.';
  end if;

  select recovery.* into authority
    from app.private_live_telebirr_historical_completion_authorities recovery
   where recovery.request_key = p_request_key
   for share;

  select source_retry.* into retry
    from app.private_live_telebirr_source_binding_recovery_retries source_retry
   where source_retry.original_authority_request_key = p_request_key
   for share;

  select consumption.* into existing
    from app.private_live_telebirr_historical_completion_consumptions consumption
   where consumption.request_key = p_request_key
   for share;

  if existing.request_key is not null then
    if existing.verification_outcome_id is distinct from p_verification_outcome_id
      or existing.settlement_created is distinct from p_settlement_created then
      raise exception 'The historical TeleBirr completion consumption replay conflicts.';
    end if;
    return;
  end if;

  select verification_outcome.* into outcome
    from app.private_live_telebirr_verification_outcomes verification_outcome
   where verification_outcome.id = p_verification_outcome_id
     and verification_outcome.verification_attempt_id = authority.verification_attempt_id
     and verification_outcome.verification_job_id = authority.verification_job_id
   for share;

  consumed_at := pg_catalog.clock_timestamp();
  if authority.request_key is null or outcome.id is null then
    raise exception 'The historical TeleBirr completion authority is unavailable.';
  end if;

  if retry.retry_request_key is null then
    if consumed_at >= authority.expires_at
      or exists (
        select 1
          from app.private_live_telebirr_historical_completion_closures closure
         where closure.request_key = authority.request_key
      ) then
      raise exception 'The historical TeleBirr completion authority is unavailable.';
    end if;
  elsif retry.current_verification_job_id is distinct from authority.verification_job_id
    or retry.current_verification_attempt_id is distinct from
       authority.verification_attempt_id
    or not app.is_private_live_telebirr_historical_boundary_authorized(
      authority.request_key
    ) then
    raise exception 'The historical TeleBirr completion authority is unavailable.';
  end if;

  if p_settlement_created then
    select settlement_receipt.* into receipt
      from app.private_live_telebirr_settlement_receipts settlement_receipt
     where settlement_receipt.verification_outcome_id = outcome.id
     for share;

    select pilot_reservation.* into reservation
      from app.private_live_deposit_pilot_reservations pilot_reservation
     where pilot_reservation.deposit_intent_id = outcome.deposit_intent_id
       and pilot_reservation.private_live_deposit_pilot_proof_id =
           authority.private_live_deposit_pilot_proof_id
     for share;

    select job.* into execution_job
      from app.deposit_jobs job
     where job.id = receipt.execution_job_id
       and job.deposit_intent_id = outcome.deposit_intent_id
       and job.job_kind = 'execute_deposit'
       and job.status = 'queued'
       and job.attempt_count = 0
       and job.lease_token is null
       and job.leased_by is null
       and job.lease_expires_at is null
       and job.last_error_code is null
       and job.completed_at is null
     for share;

    if outcome.disposition <> 'settlement_candidate'
      or outcome.reason_code <> 'exact_proof_match'
      or receipt.id is null
      or reservation.id is null
      or execution_job.id is null
      or receipt.deposit_payment_claim_id is distinct from
         reservation.deposit_payment_claim_id
      or receipt.execution_job_id is distinct from execution_job.id
      or not exists (
        select 1 from app.private_live_telebirr_settlement_documents settled
         where settled.source_document_digest = authority.source_document_digest
           and settled.verification_outcome_id = outcome.id
           and settled.observation_transcript_id = outcome.observation_transcript_id
           and settled.payment_provider_id = outcome.payment_provider_id
           and settled.candidate_reference_fingerprint =
               outcome.candidate_reference_fingerprint
      ) then
      raise exception 'The historical TeleBirr settlement result is inconsistent.';
    end if;
  else
    if outcome.disposition = 'settlement_candidate'
      or exists (
        select 1 from app.private_live_telebirr_settlement_receipts settlement_receipt
         where settlement_receipt.verification_outcome_id = outcome.id
      )
      or exists (
        select 1 from app.private_live_deposit_pilot_reservations pilot_reservation
         where pilot_reservation.private_live_deposit_pilot_proof_id =
               authority.private_live_deposit_pilot_proof_id
      ) then
      raise exception 'The historical TeleBirr non-settlement result is inconsistent.';
    end if;
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in (
       'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
     ) and role.rolcanlogin
  ) or exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
     )
  ) then
    raise exception 'KemerBet execution must remain disabled.';
  end if;

  insert into app.private_live_telebirr_historical_completion_consumptions (
    request_key,
    verification_outcome_id,
    settlement_created,
    pilot_reservation_id,
    settlement_receipt_id,
    execution_job_id,
    consumed_at
  ) values (
    authority.request_key,
    outcome.id,
    p_settlement_created,
    case when p_settlement_created then reservation.id else null end,
    case when p_settlement_created then receipt.id else null end,
    case when p_settlement_created then execution_job.id else null end,
    consumed_at
  );
end;
$$;

create function app.close_private_live_telebirr_source_binding_recovery(
  p_retry_request_key uuid,
  p_reason_code text
)
returns table (
  closed boolean,
  terminated_sessions integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  retry app.private_live_telebirr_source_binding_recovery_retries%rowtype;
  existing app.private_live_telebirr_source_binding_recovery_closures%rowtype;
  terminated_count integer;
begin
  if session_user <> 'postgres'
    or p_retry_request_key is null
    or p_reason_code not in ('completed', 'operator_stop') then
    raise exception 'The reviewed TeleBirr source-binding recovery close request is invalid.';
  end if;

  select recovery.* into retry
    from app.private_live_telebirr_source_binding_recovery_retries recovery
   where recovery.retry_request_key = p_retry_request_key
   for share;

  if retry.retry_request_key is null then
    raise exception 'The reviewed TeleBirr source-binding recovery is unavailable.';
  end if;

  if p_reason_code = 'completed' and not exists (
    select 1
      from app.private_live_telebirr_historical_completion_consumptions consumption
     where consumption.request_key = retry.original_authority_request_key
  ) then
    raise exception 'The reviewed TeleBirr source-binding recovery has not completed.';
  end if;

  select closure.* into existing
    from app.private_live_telebirr_source_binding_recovery_closures closure
   where closure.retry_request_key = p_retry_request_key
   for share;

  if existing.retry_request_key is null then
    insert into app.private_live_telebirr_source_binding_recovery_closures (
      retry_request_key, reason_code
    ) values (p_retry_request_key, p_reason_code);
  elsif existing.reason_code is distinct from p_reason_code then
    raise exception 'The reviewed TeleBirr source-binding recovery close replay conflicts.';
  end if;

  select disabled.terminated_session_count into terminated_count
    from app.disable_private_trusted_telebirr_verifier_login() disabled;

  return query select true, terminated_count;
end;
$$;

create index private_live_tbirr_source_binding_retry_current_idx
  on app.private_live_telebirr_source_binding_recovery_retries (
    current_verification_job_id,
    authorized_at
  );

alter table app.private_live_telebirr_source_binding_recovery_retries
  enable row level security;
alter table app.private_live_telebirr_source_binding_recovery_retries
  force row level security;
alter table app.private_live_telebirr_source_binding_recovery_closures
  enable row level security;
alter table app.private_live_telebirr_source_binding_recovery_closures
  force row level security;

alter table app.private_live_telebirr_source_binding_recovery_retries
  owner to postgres;
alter table app.private_live_telebirr_source_binding_recovery_closures
  owner to postgres;
alter function app.private_live_telebirr_source_binding_recovery_digest(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text
) owner to postgres;
alter function app.is_private_live_telebirr_historical_boundary_authorized(uuid)
  owner to postgres;
alter function app.is_private_live_telebirr_source_binding_recovery_authorized(
  uuid, text, text
) owner to postgres;
alter function app.enforce_private_live_telebirr_source_document_binding()
  owner to postgres;
alter function app.arm_private_live_telebirr_source_binding_recovery(
  uuid, uuid, bigint, uuid, text, text
) owner to postgres;
alter function app.consume_private_live_telebirr_historical_completion(
  uuid, uuid, boolean
) owner to postgres;
alter function app.close_private_live_telebirr_source_binding_recovery(
  uuid, text
) owner to postgres;

revoke all privileges on table
  app.private_live_telebirr_source_binding_recovery_retries,
  app.private_live_telebirr_source_binding_recovery_closures
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.private_live_telebirr_source_binding_recovery_digest(
    uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text,
    timestamptz, timestamptz, text
  ),
  app.is_private_live_telebirr_historical_boundary_authorized(uuid),
  app.is_private_live_telebirr_source_binding_recovery_authorized(
    uuid, text, text
  ),
  app.enforce_private_live_telebirr_source_document_binding(),
  app.arm_private_live_telebirr_source_binding_recovery(
    uuid, uuid, bigint, uuid, text, text
  ),
  app.consume_private_live_telebirr_historical_completion(
    uuid, uuid, boolean
  ),
  app.close_private_live_telebirr_source_binding_recovery(uuid, text)
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier,
     fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge,
     fetanagent_companion_device_bridge_runtime;

comment on table app.private_live_telebirr_source_binding_recovery_retries is
  'Append-only one-use 12-hour supersession for one source digest first bound by an exact nonfinancial review. The original binding is never changed.';

comment on table app.private_live_telebirr_source_binding_recovery_closures is
  'Append-only terminal closure for the one reviewed source-binding recovery retry.';

comment on function app.arm_private_live_telebirr_source_binding_recovery(
  uuid, uuid, bigint, uuid, text, text
) is
  'Postgres-only arming of one exact reviewed source-binding supersession and verifier-only 12-hour retry. KemerBet remains disabled.';

comment on function app.is_private_live_telebirr_source_binding_recovery_authorized(
  uuid, text, text
) is
  'Trigger-only predicate permitting the exact current reference after the same receipt facts ended in a prior nonfinancial source-unavailable review.';

comment on function app.close_private_live_telebirr_source_binding_recovery(
  uuid, text
) is
  'Postgres-only append-only close and verifier-login revocation for the reviewed source-binding recovery.';

commit;
