-- Consume one already-staged, cryptographically signed live TeleBirr observation after the
-- surrounding human-operated pilot window expired. This is a completion-only continuation: it
-- cannot stage a proof, create an assignment, lease execution, or authorize KemerBet. Every
-- financial row is still created by the existing trusted-verifier and settlement implementations.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.private_live_telebirr_historical_completion_authorities (
  request_key uuid primary key,
  verification_job_id uuid not null unique
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  private_live_deposit_pilot_proof_id uuid not null unique
    references app.private_live_deposit_pilot_proofs (id) on delete restrict,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  expired_activation_epoch bigint not null
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  observation_body_digest text not null unique
    references app.private_live_telebirr_device_evidence_staging (observation_body_digest)
      on delete restrict,
  source_document_digest text not null
    check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  reason_code text not null
    check (reason_code = 'expired_authority_staged_evidence_completion'),
  request_digest text not null unique
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  authorized_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_telebirr_historical_completion_request_key_v4 check (
    request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_telebirr_historical_completion_window check (
    expires_at > authorized_at + interval '8 minutes'
    and expires_at <= authorized_at + interval '20 minutes'
  )
);

create table app.private_live_telebirr_historical_completion_consumptions (
  request_key uuid primary key
    references app.private_live_telebirr_historical_completion_authorities (request_key)
      on delete restrict,
  verification_outcome_id uuid not null unique
    references app.private_live_telebirr_verification_outcomes (id) on delete restrict,
  settlement_created boolean not null,
  pilot_reservation_id uuid unique
    references app.private_live_deposit_pilot_reservations (id) on delete restrict,
  settlement_receipt_id uuid unique
    references app.private_live_telebirr_settlement_receipts (id) on delete restrict,
  execution_job_id uuid unique references app.deposit_jobs (id) on delete restrict,
  consumed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_telebirr_historical_consumption_shape check (
    (
      settlement_created
      and pilot_reservation_id is not null
      and settlement_receipt_id is not null
      and execution_job_id is not null
    ) or (
      not settlement_created
      and pilot_reservation_id is null
      and settlement_receipt_id is null
      and execution_job_id is null
    )
  )
);

create table app.private_live_telebirr_historical_completion_closures (
  request_key uuid primary key
    references app.private_live_telebirr_historical_completion_authorities (request_key)
      on delete restrict,
  reason_code text not null check (reason_code in ('completed', 'operator_stop')),
  closed_at timestamptz not null default pg_catalog.clock_timestamp()
);

create trigger private_live_telebirr_historical_authorities_immutable
before update or delete on app.private_live_telebirr_historical_completion_authorities
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_historical_authorities_no_truncate
before truncate on app.private_live_telebirr_historical_completion_authorities
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_historical_consumptions_immutable
before update or delete on app.private_live_telebirr_historical_completion_consumptions
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_historical_consumptions_no_truncate
before truncate on app.private_live_telebirr_historical_completion_consumptions
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_historical_closures_immutable
before update or delete on app.private_live_telebirr_historical_completion_closures
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_historical_closures_no_truncate
before truncate on app.private_live_telebirr_historical_completion_closures
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.private_live_telebirr_historical_completion_digest(
  p_request_key uuid,
  p_verification_job_id uuid,
  p_verification_attempt_id uuid,
  p_pilot_revision_id uuid,
  p_expired_activation_epoch bigint,
  p_observation_body_digest text,
  p_source_document_digest text,
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
    'fetanagent:telebirr:historical-completion-authority:v1'
      || '|request_key=' || p_request_key::text
      || '|job_id=' || p_verification_job_id::text
      || '|attempt_id=' || p_verification_attempt_id::text
      || '|pilot_revision_id=' || p_pilot_revision_id::text
      || '|expired_activation_epoch=' || p_expired_activation_epoch::text
      || '|observation_body_digest=' || p_observation_body_digest
      || '|source_document_digest=' || p_source_document_digest
      || '|authorized_at_us='
      || (pg_catalog.date_part('epoch', p_authorized_at) * 1000000)::bigint::text
      || '|expires_at_us='
      || (pg_catalog.date_part('epoch', p_expires_at) * 1000000)::bigint::text
      || '|reason_code=' || p_reason_code
  )
$$;

create function app.is_private_live_telebirr_historical_attempt_authorized(
  p_verification_attempt_id uuid,
  p_lease_token uuid default null,
  p_observation_body_digest text default null,
  p_source_document_digest text default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.bool_and(
    authority.verification_attempt_id = attempt.id
    and authority.verification_job_id = job.id
    and authority.private_live_deposit_pilot_proof_id = job.private_live_deposit_pilot_proof_id
    and authority.pilot_revision_id = job.pilot_revision_id
    and authority.receiver_profile_id = job.receiver_profile_id
    and authority.observation_body_digest = staged.observation_body_digest
    and authority.source_document_digest =
        staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'
    and (p_lease_token is null or attempt.lease_token = p_lease_token)
    and (
      p_observation_body_digest is null
      or staged.observation_body_digest = p_observation_body_digest
    )
    and (
      p_source_document_digest is null
      or authority.source_document_digest = p_source_document_digest
    )
    and pg_catalog.clock_timestamp() >= authority.authorized_at
    and pg_catalog.clock_timestamp() < authority.expires_at
    and activation_control.current_epoch = authority.expired_activation_epoch
    and activation_epoch.authority_state = 'active'
    and activation_epoch.revoked_at is null
    and activation_epoch.expires_at <= pg_catalog.clock_timestamp()
    and pilot.status = 'armed'
    and pilot.configuration_digest = activation_epoch.configuration_digest
    and job.pilot_configuration_digest = pilot.configuration_digest
    and proof.submitted_at + interval '24 hours' > pg_catalog.clock_timestamp()
    and attempt.issued_at >= pilot.active_from
    and attempt.expires_at <= pilot.expires_at
    and attempt.expires_at <= profile.valid_until
    and staged.observed_at >= attempt.issued_at
    and staged.observed_at < attempt.expires_at
    and staged.staged_at < attempt.expires_at
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = authority.request_key
    )
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_closures closure
       where closure.request_key = authority.request_key
    )
    and not exists (
      select 1 from app.private_live_telebirr_settlement_documents settled
       where settled.source_document_digest = authority.source_document_digest
    )
    and not exists (
      select 1 from app.private_live_telebirr_verifier_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = attempt.id
          or quarantine.observation_body_digest = staged.observation_body_digest
    )
    and (
      select pg_catalog.count(*) from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'deposit_execution', 'payment_verification',
         'private_live_deposit_pilot', 'telebirr_authoritative_verification'
       ) and feature_switch.mode = 'live'
    ) = 4
    and exists (
      select 1 from app.feature_switches feature_switch
       where feature_switch.feature_key = 'private_live_deposit_pilot'
         and feature_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    )
    and not exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       ) and role.rolcanlogin
    )
    and not exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       )
    )
    and exists (
      select 1 from pg_catalog.pg_authid role
       where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
         and role.rolcanlogin
         and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 1
         and role.rolvaliduntil is not distinct from authority.expires_at
         and role.rolpassword like 'SCRAM-SHA-256$%'
    )
  ), false)
  from app.private_live_telebirr_historical_completion_authorities authority
  join app.private_live_telebirr_verification_attempts attempt
    on attempt.id = authority.verification_attempt_id
  join app.private_live_telebirr_verification_jobs job
    on job.id = authority.verification_job_id
   and job.id = attempt.verification_job_id
  join app.private_live_deposit_pilot_proofs proof
    on proof.id = authority.private_live_deposit_pilot_proof_id
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = authority.pilot_revision_id
  join app.private_live_telebirr_receiver_profiles profile
    on profile.id = authority.receiver_profile_id
  join app.private_live_telebirr_device_evidence_staging staged
    on staged.verification_attempt_id = attempt.id
   and staged.observation_body_digest = authority.observation_body_digest
  join app.private_trusted_telebirr_activation_control activation_control
    on activation_control.control_key = 'trusted_telebirr_financial_authority'
  join app.private_trusted_telebirr_activation_epochs activation_epoch
    on activation_epoch.epoch = activation_control.current_epoch
   and activation_epoch.epoch = authority.expired_activation_epoch
  where authority.verification_attempt_id = p_verification_attempt_id
$$;

create function app.is_private_live_telebirr_historical_intent_authorized(
  p_deposit_intent_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.bool_and(
    outcome.deposit_intent_id = p_deposit_intent_id
    and outcome.verification_attempt_id = authority.verification_attempt_id
    and outcome.verification_job_id = authority.verification_job_id
    and outcome.private_live_deposit_pilot_proof_id =
        authority.private_live_deposit_pilot_proof_id
    and outcome.pilot_revision_id = authority.pilot_revision_id
    and outcome.receiver_profile_id = authority.receiver_profile_id
    and outcome.disposition = 'settlement_candidate'
    and outcome.reason_code = 'exact_proof_match'
    and pg_catalog.clock_timestamp() < authority.expires_at
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_consumptions consumption
       where consumption.request_key = authority.request_key
    )
    and not exists (
      select 1
        from app.private_live_telebirr_historical_completion_closures closure
       where closure.request_key = authority.request_key
    )
    and not exists (
      select 1 from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       ) and role.rolcanlogin
    )
    and not exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime'
       )
    )
  ), false)
  from app.private_live_telebirr_historical_completion_authorities authority
  join app.private_live_telebirr_verification_outcomes outcome
    on outcome.verification_attempt_id = authority.verification_attempt_id
   and outcome.verification_job_id = authority.verification_job_id
  where outcome.deposit_intent_id = p_deposit_intent_id
$$;

create function app.is_private_live_telebirr_historical_claim_authorized(
  p_deposit_payment_claim_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    app.is_private_live_telebirr_historical_intent_authorized(
      claim.deposit_intent_id
    ),
    false
  )
  from app.deposit_payment_claims claim
  where claim.id = p_deposit_payment_claim_id
$$;

create function app.arm_private_live_telebirr_historical_completion(
  p_verification_job_id uuid,
  p_pilot_revision_id uuid,
  p_expired_activation_epoch bigint,
  p_request_key uuid,
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
  authority app.private_live_telebirr_historical_completion_authorities%rowtype;
  activation_epoch app.private_trusted_telebirr_activation_epochs%rowtype;
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  staged app.private_live_telebirr_device_evidence_staging%rowtype;
  source_document_digest text;
  request_digest text;
  armed_at timestamptz;
  armed_until timestamptz;
begin
  if session_user <> 'postgres'
    or p_verification_job_id is null
    or p_pilot_revision_id is null
    or p_expired_activation_epoch is null
    or p_expired_activation_epoch <= 0
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_scram_verifier is null
    or p_scram_verifier
       !~ '^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$'
    or p_reason_code is distinct from
       'expired_authority_staged_evidence_completion' then
    raise exception 'The historical TeleBirr completion request is invalid.';
  end if;

  perform activation_control.current_epoch
    from app.private_trusted_telebirr_activation_control activation_control
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for share;

  select activation.*
    into activation_epoch
    from app.private_trusted_telebirr_activation_control activation_control
    join app.private_trusted_telebirr_activation_epochs activation
      on activation.epoch = activation_control.current_epoch
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
     and activation.epoch = p_expired_activation_epoch
     and activation.pilot_revision_id = p_pilot_revision_id
   for share of activation_control, activation;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for update;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = p_verification_job_id
     and verification_job.pilot_revision_id = p_pilot_revision_id
     and verification_job.network_retry_reason_code =
         'official_receipt_network_unavailable'
     and verification_job.network_binding_recovery_reason_code =
         'network_retry_reference_binding_registry'
   for update;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = job.private_live_deposit_pilot_proof_id
     and proof_row.pilot_revision_id = pilot.id
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id
     and receiver_profile.pilot_revision_id = pilot.id
   for share;

  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
    join app.private_live_telebirr_device_evidence_staging staged_evidence
      on staged_evidence.verification_attempt_id = verification_attempt.id
   where verification_attempt.verification_job_id = job.id
   order by staged_evidence.staged_at desc, verification_attempt.attempt_number desc
    limit 1
    for share of verification_attempt, staged_evidence;

  select staged_evidence.*
    into staged
    from app.private_live_telebirr_device_evidence_staging staged_evidence
   where staged_evidence.verification_attempt_id = attempt.id
   order by staged_evidence.staged_at desc
   limit 1
   for share;

  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = attempt.device_enrollment_id
   for share;

  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_transcripts transcript
    join app.private_live_telebirr_assignment_signers assignment_signer
      on assignment_signer.id = transcript.assignment_signer_id
   where transcript.verification_attempt_id = attempt.id
   for share of transcript, assignment_signer;

  source_document_digest :=
    staged.signed_observation -> 'body' ->> 'sourceDocumentDigest';
  armed_at := pg_catalog.clock_timestamp();
  armed_until := least(
    armed_at + interval '20 minutes',
    proof.submitted_at + interval '24 hours'
  );

  select existing.*
    into authority
    from app.private_live_telebirr_historical_completion_authorities existing
   where existing.request_key = p_request_key
      or existing.verification_job_id = job.id
      or existing.verification_attempt_id = attempt.id
   order by existing.created_at, existing.request_key
   limit 1
   for share;

  if authority.request_key is not null then
    if authority.request_key is distinct from p_request_key
      or authority.verification_job_id is distinct from job.id
      or authority.verification_attempt_id is distinct from attempt.id
      or authority.pilot_revision_id is distinct from pilot.id
      or authority.expired_activation_epoch is distinct from p_expired_activation_epoch
      or authority.observation_body_digest is distinct from staged.observation_body_digest
      or authority.source_document_digest is distinct from source_document_digest
      or authority.reason_code is distinct from p_reason_code
      or authority.expires_at <= armed_at + interval '5 minutes'
      or exists (
        select 1 from app.private_live_telebirr_historical_completion_consumptions consumption
         where consumption.request_key = authority.request_key
      )
      or exists (
        select 1 from app.private_live_telebirr_historical_completion_closures closure
         where closure.request_key = authority.request_key
      ) then
      raise exception 'The historical TeleBirr completion replay conflicts.';
    end if;

    return query select authority.authorized_at, authority.expires_at, true;
    return;
  end if;

  if activation_epoch.epoch is null
    or activation_epoch.authority_state <> 'active'
    or activation_epoch.revoked_at is not null
    or activation_epoch.expires_at > armed_at
    or pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from activation_epoch.configuration_digest
    or pilot.expires_at > armed_at
    or proof.id is null
    or profile.id is null
    or profile.valid_until > armed_at
    or attempt.id is null
    or staged.observation_body_digest is null
    or enrollment.id is null
    or signer.id is null
    or source_document_digest is null
    or source_document_digest !~ '^sha256:[0-9a-f]{64}$'
    or armed_until <= armed_at + interval '8 minutes'
    or attempt.expires_at > armed_at
    or attempt.issued_at < pilot.active_from
    or attempt.expires_at > pilot.expires_at
    or attempt.issued_at < profile.valid_from
    or attempt.expires_at > profile.valid_until
    or attempt.issued_at < enrollment.valid_from
    or attempt.expires_at > enrollment.valid_until
    or attempt.issued_at < signer.valid_from
    or attempt.expires_at > signer.valid_until
    or staged.observed_at < attempt.issued_at
    or staged.observed_at >= attempt.expires_at
    or staged.staged_at >= attempt.expires_at
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts candidate
         where candidate.verification_job_id = job.id) <> 4
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts candidate
          join app.private_live_telebirr_assignment_transcripts transcript
            on transcript.verification_attempt_id = candidate.id
         where candidate.verification_job_id = job.id) <> 2
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts candidate
          join app.private_live_telebirr_assignment_deliveries delivery
            on delivery.verification_attempt_id = candidate.id
         where candidate.verification_job_id = job.id) <> 2
    or (select pg_catalog.count(*)
          from app.private_live_telebirr_verification_attempts candidate
          join app.private_live_telebirr_device_evidence_staging evidence
            on evidence.verification_attempt_id = candidate.id
         where candidate.verification_job_id = job.id) <> 2
    or exists (
      select 1 from app.private_live_telebirr_verification_outcomes outcome
       where outcome.verification_job_id = job.id
    )
    or exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
       where reservation.private_live_deposit_pilot_proof_id = proof.id
    )
    or exists (
      select 1 from app.private_live_telebirr_verifier_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = attempt.id
          or quarantine.observation_body_digest = staged.observation_body_digest
    )
    or not exists (
      select 1
        from app.private_live_telebirr_source_document_bindings binding
        join app.private_live_telebirr_observation_transcripts prior_observation
          on prior_observation.source_document_digest = binding.source_document_digest
        join app.private_live_telebirr_verification_attempts prior_attempt
          on prior_attempt.id = prior_observation.verification_attempt_id
         and prior_attempt.verification_job_id <> job.id
       where binding.source_document_digest = source_document_digest
         and binding.payment_provider_id = job.payment_provider_id
         and binding.candidate_reference_fingerprint =
             job.candidate_reference_fingerprint
    )
    or exists (
      select 1 from app.private_live_telebirr_settlement_documents settled
       where settled.source_document_digest = source_document_digest
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
         and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 1
         and (
           not role.rolcanlogin
           or (
             role.rolvaliduntil is not null
             and role.rolvaliduntil <= armed_at
           )
         )
    )
    or not exists (
      select 1 from pg_catalog.pg_authid role
       where role.rolname = 'fetanagent_trusted_telebirr_verifier'
         and not role.rolcanlogin and not role.rolinherit and not role.rolsuper
         and not role.rolcreatedb and not role.rolcreaterole
         and not role.rolreplication and not role.rolbypassrls
         and role.rolconnlimit = 2
         and role.rolpassword is null
    )
    or (
      select pg_catalog.count(*)
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
         and granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
    ) <> 1
    or (
      select pg_catalog.count(*)
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
    ) <> 1
    or (
      select pg_catalog.count(*)
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
       where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
    ) <> 2
    or not exists (
      select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
         and member_role.rolname = 'postgres'
         and not membership.inherit_option
         and not membership.set_option
         and membership.admin_option
    ) then
    raise exception 'The expired TeleBirr evidence is not recoverable.';
  end if;

  request_digest := app.private_live_telebirr_historical_completion_digest(
    p_request_key,
    job.id,
    attempt.id,
    pilot.id,
    p_expired_activation_epoch,
    staged.observation_body_digest,
    source_document_digest,
    armed_at,
    armed_until,
    p_reason_code
  );

  insert into app.private_live_telebirr_historical_completion_authorities (
    request_key,
    verification_job_id,
    verification_attempt_id,
    private_live_deposit_pilot_proof_id,
    pilot_revision_id,
    receiver_profile_id,
    expired_activation_epoch,
    observation_body_digest,
    source_document_digest,
    reason_code,
    request_digest,
    authorized_at,
    expires_at
  ) values (
    p_request_key,
    job.id,
    attempt.id,
    proof.id,
    pilot.id,
    profile.id,
    p_expired_activation_epoch,
    staged.observation_body_digest,
    source_document_digest,
    p_reason_code,
    request_digest,
    armed_at,
    armed_until
  ) returning * into authority;

  execute pg_catalog.format(
    'alter role %I login password %L valid until %L',
    'fetanagent_trusted_telebirr_verifier_runtime',
    p_scram_verifier,
    authority.expires_at
  );

  if not exists (
    select 1 from pg_catalog.pg_authid role
     where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and role.rolcanlogin
       and not role.rolinherit and not role.rolsuper
       and not role.rolcreatedb and not role.rolcreaterole
       and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not distinct from authority.expires_at
       and role.rolpassword is not distinct from p_scram_verifier
  ) then
    raise exception 'The bounded historical TeleBirr verifier login was not provisioned exactly.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_label,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'worker',
    'historical-live-telebirr-completion',
    'deposit.live_telebirr_historical_completion_armed',
    'private_live_deposit_pilot',
    pilot.id,
    pg_catalog.jsonb_build_object(
      'reason_code', p_reason_code,
      'expires_at', authority.expires_at,
      'financial_rows_created', false,
      'execution_enabled', false
    )
  );

  return query select authority.authorized_at, authority.expires_at, false;
end;
$$;

create function app.consume_private_live_telebirr_historical_completion(
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
  if authority.request_key is null
    or outcome.id is null
    or consumed_at >= authority.expires_at
    or exists (
      select 1 from app.private_live_telebirr_historical_completion_closures closure
       where closure.request_key = authority.request_key
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

create function app.close_private_live_telebirr_historical_completion(
  p_request_key uuid,
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
  authority app.private_live_telebirr_historical_completion_authorities%rowtype;
  existing app.private_live_telebirr_historical_completion_closures%rowtype;
  terminated_count integer;
begin
  if session_user <> 'postgres'
    or p_request_key is null
    or p_reason_code not in ('completed', 'operator_stop') then
    raise exception 'The historical TeleBirr completion close request is invalid.';
  end if;

  select recovery.* into authority
    from app.private_live_telebirr_historical_completion_authorities recovery
   where recovery.request_key = p_request_key
   for share;

  if authority.request_key is null then
    raise exception 'The historical TeleBirr completion authority is unavailable.';
  end if;

  if p_reason_code = 'completed' and not exists (
    select 1 from app.private_live_telebirr_historical_completion_consumptions consumption
     where consumption.request_key = authority.request_key
  ) then
    raise exception 'The historical TeleBirr completion has not completed.';
  end if;

  select closure.* into existing
    from app.private_live_telebirr_historical_completion_closures closure
   where closure.request_key = p_request_key
   for share;

  if existing.request_key is null then
    insert into app.private_live_telebirr_historical_completion_closures (
      request_key, reason_code
    ) values (p_request_key, p_reason_code);
  elsif existing.reason_code is distinct from p_reason_code then
    raise exception 'The historical TeleBirr completion close replay conflicts.';
  end if;

  select disabled.terminated_session_count into terminated_count
    from app.disable_private_trusted_telebirr_verifier_login() disabled;

  return query select true, terminated_count;
end;
$$;

-- Patch only the clock predicates of the reviewed implementations. All cryptographic lineage,
-- current customer/player/provider facts, replay controls, caps, and settlement checks remain.
do $patch_live_authority_snapshot$
declare
  signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.load_private_live_telebirr_verification_authority_pre_epoch(uuid,uuid,timestamptz)'
  );
  old_marker constant text := $old$    and captured_at >= pilot.active_from
    and captured_at < pilot.expires_at
    and captured_at < job.expires_at
    and captured_at < attempted.expires_at$old$;
  new_marker constant text := $new$    and (
      (
        captured_at >= pilot.active_from
        and captured_at < pilot.expires_at
        and captured_at < job.expires_at
        and captured_at < attempted.expires_at
      ) or app.is_private_live_telebirr_historical_attempt_authorized(
        attempted.id, attempted.lease_token, null, null
      )
    )$new$;
  original_definition text;
  original_source text;
  original_owner oid;
  original_acl aclitem[];
  patched_definition text;
  patched_source text;
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl
    into original_definition, original_source, original_owner, original_acl
    from pg_catalog.pg_proc routine where routine.oid = signature;
  if signature is null
    or (pg_catalog.length(original_source) - pg_catalog.length(
          pg_catalog.replace(original_source, old_marker, '')
        )) / pg_catalog.length(old_marker) <> 1 then
    raise exception 'The trusted TeleBirr authority snapshot source does not match.';
  end if;
  patched_definition := pg_catalog.replace(original_definition, old_marker, new_marker);
  patched_source := pg_catalog.replace(original_source, old_marker, new_marker);
  execute patched_definition;
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = signature
       and routine.prosrc = patched_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prosecdef
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The trusted TeleBirr authority snapshot changed authority.';
  end if;
end;
$patch_live_authority_snapshot$;

do $patch_live_completion$
declare
  signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.complete_private_live_telebirr_verification_internal(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text,timestamptz,text,text,text,timestamptz,bigint,timestamptz,text)'
  );
  original_definition text;
  original_source text;
  original_owner oid;
  original_acl aclitem[];
  patched_definition text;
  patched_source text;
  marker text;
  replacement text;
  actual_count integer;
  marker_index integer;
  markers constant text[] := array[
    'or captured_at < pilot.active_from',
    'or captured_at >= pilot.expires_at',
    'or captured_at >= job.expires_at',
    'or captured_at >= attempt.expires_at',
    'or p_assessed_at >= attempt.expires_at'
  ];
  replacements constant text[] := array[
    'or (captured_at < pilot.active_from and not app.is_private_live_telebirr_historical_attempt_authorized(attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest))',
    'or (captured_at >= pilot.expires_at and not app.is_private_live_telebirr_historical_attempt_authorized(attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest))',
    'or (captured_at >= job.expires_at and not app.is_private_live_telebirr_historical_attempt_authorized(attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest))',
    'or (captured_at >= attempt.expires_at and not app.is_private_live_telebirr_historical_attempt_authorized(attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest))',
    'or (p_assessed_at >= attempt.expires_at and not app.is_private_live_telebirr_historical_attempt_authorized(attempt.id, p_lease_token, p_observation_body_digest, p_source_document_digest))'
  ];
  expected_counts constant integer[] := array[3, 3, 3, 2, 1];
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl
    into original_definition, original_source, original_owner, original_acl
    from pg_catalog.pg_proc routine where routine.oid = signature;
  if signature is null then
    raise exception 'The trusted TeleBirr completion implementation is unavailable.';
  end if;

  for marker_index in 1..pg_catalog.array_length(markers, 1) loop
    marker := markers[marker_index];
    replacement := replacements[marker_index];
    actual_count := (pg_catalog.length(original_source) - pg_catalog.length(
      pg_catalog.replace(original_source, marker, '')
    )) / pg_catalog.length(marker);
    if actual_count <> expected_counts[marker_index] then
      raise exception 'The trusted TeleBirr completion clock source does not match.';
    end if;
    original_source := pg_catalog.replace(original_source, marker, replacement);
    original_definition := pg_catalog.replace(original_definition, marker, replacement);
  end loop;

  patched_source := original_source;
  patched_definition := original_definition;
  execute patched_definition;
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = signature
       and routine.prosrc = patched_source
       and routine.proowner = original_owner
       and routine.proacl is not distinct from original_acl
       and routine.prosecdef
       and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The trusted TeleBirr completion implementation changed authority.';
  end if;
end;
$patch_live_completion$;

do $patch_private_pilot_reservation$
declare
  signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.reserve_private_live_deposit_pilot_claim(uuid)'
  );
  clock_marker constant text := $old$    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at$old$;
  clock_replacement constant text := $new$    or (
      (checked_at < pilot.active_from or checked_at >= pilot.expires_at)
      and not app.is_private_live_telebirr_historical_claim_authorized(
        p_deposit_payment_claim_id
      )
    )$new$;
  freshness_marker constant text :=
    'or proof_submitted_at < checked_at - interval ''1 hour''';
  freshness_replacement constant text :=
    'or (proof_submitted_at < checked_at - interval ''1 hour'' and not app.is_private_live_telebirr_historical_claim_authorized(p_deposit_payment_claim_id))';
  definition text;
  source text;
  owner_id oid;
  acl aclitem[];
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl
    into definition, source, owner_id, acl
    from pg_catalog.pg_proc routine where routine.oid = signature;
  if signature is null
    or (pg_catalog.length(source) - pg_catalog.length(
          pg_catalog.replace(source, clock_marker, '')
        )) / pg_catalog.length(clock_marker) <> 2
    or (pg_catalog.length(source) - pg_catalog.length(
          pg_catalog.replace(source, freshness_marker, '')
        )) / pg_catalog.length(freshness_marker) <> 1 then
    raise exception 'The private-pilot reservation source does not match.';
  end if;
  source := pg_catalog.replace(source, clock_marker, clock_replacement);
  definition := pg_catalog.replace(definition, clock_marker, clock_replacement);
  source := pg_catalog.replace(source, freshness_marker, freshness_replacement);
  definition := pg_catalog.replace(definition, freshness_marker, freshness_replacement);
  execute definition;
  if not exists (
    select 1 from pg_catalog.pg_proc routine where routine.oid = signature
      and routine.prosrc = source and routine.proowner = owner_id
      and routine.proacl is not distinct from acl and routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The private-pilot reservation changed authority.';
  end if;
end;
$patch_private_pilot_reservation$;

do $patch_private_pilot_authorization$
declare
  signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.require_private_live_deposit_pilot_authorization(uuid,uuid)'
  );
  old_marker constant text := $old$    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at$old$;
  new_marker constant text := $new$    or (
      (checked_at < pilot.active_from or checked_at >= pilot.expires_at)
      and not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
    )$new$;
  definition text;
  source text;
  owner_id oid;
  acl aclitem[];
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl
    into definition, source, owner_id, acl
    from pg_catalog.pg_proc routine where routine.oid = signature;
  if signature is null
    or (pg_catalog.length(source) - pg_catalog.length(
          pg_catalog.replace(source, old_marker, '')
        )) / pg_catalog.length(old_marker) <> 1 then
    raise exception 'The private-pilot authorization source does not match.';
  end if;
  source := pg_catalog.replace(source, old_marker, new_marker);
  definition := pg_catalog.replace(definition, old_marker, new_marker);
  execute definition;
  if not exists (
    select 1 from pg_catalog.pg_proc routine where routine.oid = signature
      and routine.prosrc = source and routine.proowner = owner_id
      and routine.proacl is not distinct from acl and routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The private-pilot authorization changed authority.';
  end if;
end;
$patch_private_pilot_authorization$;

do $patch_private_pilot_finalizer$
declare
  signature constant regprocedure := pg_catalog.to_regprocedure(
    'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'
  );
  old_or_marker constant text := $old$    or checked_at < pilot.active_from
    or checked_at >= pilot.expires_at$old$;
  new_or_marker constant text := $new$    or (
      (checked_at < pilot.active_from or checked_at >= pilot.expires_at)
      and not app.is_private_live_telebirr_historical_intent_authorized(
        p_deposit_intent_id
      )
    )$new$;
  old_if_marker constant text := $old$  if checked_at < pilot.active_from
    or checked_at >= pilot.expires_at$old$;
  new_if_marker constant text := $new$  if (
    (checked_at < pilot.active_from or checked_at >= pilot.expires_at)
    and not app.is_private_live_telebirr_historical_intent_authorized(
      p_deposit_intent_id
    )
  )$new$;
  definition text;
  source text;
  owner_id oid;
  acl aclitem[];
begin
  select pg_catalog.pg_get_functiondef(routine.oid), routine.prosrc,
         routine.proowner, routine.proacl
    into definition, source, owner_id, acl
    from pg_catalog.pg_proc routine where routine.oid = signature;
  if signature is null
    or (pg_catalog.length(source) - pg_catalog.length(
          pg_catalog.replace(source, old_or_marker, '')
        )) / pg_catalog.length(old_or_marker) <> 1
    or (pg_catalog.length(source) - pg_catalog.length(
          pg_catalog.replace(source, old_if_marker, '')
        )) / pg_catalog.length(old_if_marker) <> 1 then
    raise exception 'The private-pilot finalizer source does not match.';
  end if;
  source := pg_catalog.replace(source, old_or_marker, new_or_marker);
  source := pg_catalog.replace(source, old_if_marker, new_if_marker);
  definition := pg_catalog.replace(definition, old_or_marker, new_or_marker);
  definition := pg_catalog.replace(definition, old_if_marker, new_if_marker);
  execute definition;
  if not exists (
    select 1 from pg_catalog.pg_proc routine where routine.oid = signature
      and routine.prosrc = source and routine.proowner = owner_id
      and routine.proacl is not distinct from acl and routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    raise exception 'The private-pilot finalizer changed authority.';
  end if;
end;
$patch_private_pilot_finalizer$;

create or replace function app.load_next_private_live_telebirr_staged_evidence()
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  completion_request_key uuid,
  observation_body_digest text,
  signed_assignment jsonb,
  signed_observation jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_trusted_telebirr_verifier_session();

  if app.current_private_trusted_telebirr_activation_epoch() is not null then
    return query
    select staged.verification_attempt_id,
           staged.lease_token,
           staged.completion_request_key,
           staged.observation_body_digest,
           staged.signed_assignment,
           staged.signed_observation
      from app.load_next_private_live_telebirr_staged_evidence_pre_epoch() staged;
    return;
  end if;

  return query
  select attempt.id,
         attempt.lease_token,
         attempt.lease_request_key,
         staged.observation_body_digest,
         staged.signed_assignment,
         staged.signed_observation
    from app.private_live_telebirr_historical_completion_authorities authority
    join app.private_live_telebirr_verification_attempts attempt
      on attempt.id = authority.verification_attempt_id
    join app.private_live_telebirr_device_evidence_staging staged
      on staged.verification_attempt_id = attempt.id
     and staged.observation_body_digest = authority.observation_body_digest
   where app.is_private_live_telebirr_historical_attempt_authorized(
           attempt.id,
           attempt.lease_token,
           staged.observation_body_digest,
           authority.source_document_digest
         )
   order by authority.authorized_at, authority.request_key
   limit 1;
end;
$$;

create or replace function app.load_private_live_telebirr_verification_authority(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority jsonb;
  staged_at timestamptz;
  historical_recovery boolean;
begin
  perform app.require_trusted_telebirr_verifier_session();

  historical_recovery := app.is_private_live_telebirr_historical_attempt_authorized(
    p_verification_attempt_id, p_lease_token, null, null
  );
  if app.current_private_trusted_telebirr_activation_epoch() is null
    and not historical_recovery then
    raise exception using
      errcode = '42501',
      message = 'The trusted TeleBirr verification authority is not currently authorized.';
  end if;

  authority := app.load_private_live_telebirr_verification_authority_pre_epoch(
    p_verification_attempt_id,
    p_lease_token,
    p_occurred_at
  );
  if authority is null then
    return null;
  end if;

  if historical_recovery then
    select staged.staged_at into staged_at
      from app.private_live_telebirr_device_evidence_staging staged
     where staged.verification_attempt_id = p_verification_attempt_id;
    authority := authority || pg_catalog.jsonb_build_object(
      'historicalCompletionRecovery', true,
      'evidenceStagedAt', staged_at
    );
  end if;

  return authority;
end;
$$;

create or replace function app.complete_private_live_telebirr_verification(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_completion_request_key uuid,
  p_observation_body_digest text,
  p_observation_signature_digest text,
  p_replay_identity text,
  p_source_document_digest text,
  p_normalized_facts_digest text,
  p_observed_at timestamptz,
  p_protocol_disposition text,
  p_protocol_reason_code text,
  p_assessment_input_digest text,
  p_assessed_at timestamptz,
  p_disposition text,
  p_reason_code text,
  p_evidence_digest text,
  p_retrieved_at timestamptz,
  p_receipt_principal_amount_minor bigint,
  p_occurred_at timestamptz,
  p_receiver_identity_digest text
)
returns table (
  verification_outcome_id uuid,
  outcome_disposition text,
  outcome_reason_code text,
  deposit_intent_id uuid,
  deposit_payment_claim_id uuid,
  execution_job_id uuid,
  settlement_created boolean,
  already_completed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed record;
  recovery_request_key uuid;
begin
  perform app.require_trusted_telebirr_verifier_session();

  select authority.request_key into recovery_request_key
    from app.private_live_telebirr_historical_completion_authorities authority
   where authority.verification_attempt_id = p_verification_attempt_id
     and app.is_private_live_telebirr_historical_attempt_authorized(
       p_verification_attempt_id,
       p_lease_token,
       p_observation_body_digest,
       p_source_document_digest
     );

  if app.current_private_trusted_telebirr_activation_epoch() is null
    and recovery_request_key is null then
    raise exception using
      errcode = '42501',
      message = 'The trusted TeleBirr verification authority is not currently authorized.';
  end if;

  select result.* into completed
    from app.complete_private_live_telebirr_verification_pre_epoch(
      p_verification_attempt_id,
      p_lease_token,
      p_completion_request_key,
      p_observation_body_digest,
      p_observation_signature_digest,
      p_replay_identity,
      p_source_document_digest,
      p_normalized_facts_digest,
      p_observed_at,
      p_protocol_disposition,
      p_protocol_reason_code,
      p_assessment_input_digest,
      p_assessed_at,
      p_disposition,
      p_reason_code,
      p_evidence_digest,
      p_retrieved_at,
      p_receipt_principal_amount_minor,
      p_occurred_at,
      p_receiver_identity_digest
    ) result;

  if completed.verification_outcome_id is null then
    raise exception 'The trusted TeleBirr completion returned no outcome.';
  end if;

  if recovery_request_key is not null then
    perform app.consume_private_live_telebirr_historical_completion(
      recovery_request_key,
      completed.verification_outcome_id,
      completed.settlement_created
    );
  end if;

  return query select completed.verification_outcome_id,
                      completed.outcome_disposition,
                      completed.outcome_reason_code,
                      completed.deposit_intent_id,
                      completed.deposit_payment_claim_id,
                      completed.execution_job_id,
                      completed.settlement_created,
                      completed.already_completed;
end;
$$;

alter table app.private_live_telebirr_historical_completion_authorities
  enable row level security;
alter table app.private_live_telebirr_historical_completion_authorities
  force row level security;
alter table app.private_live_telebirr_historical_completion_consumptions
  enable row level security;
alter table app.private_live_telebirr_historical_completion_consumptions
  force row level security;
alter table app.private_live_telebirr_historical_completion_closures
  enable row level security;
alter table app.private_live_telebirr_historical_completion_closures
  force row level security;

alter table app.private_live_telebirr_historical_completion_authorities owner to postgres;
alter table app.private_live_telebirr_historical_completion_consumptions owner to postgres;
alter table app.private_live_telebirr_historical_completion_closures owner to postgres;

alter function app.private_live_telebirr_historical_completion_digest(
  uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, timestamptz, text
) owner to postgres;
alter function app.is_private_live_telebirr_historical_attempt_authorized(
  uuid, uuid, text, text
) owner to postgres;
alter function app.is_private_live_telebirr_historical_intent_authorized(uuid)
  owner to postgres;
alter function app.is_private_live_telebirr_historical_claim_authorized(uuid)
  owner to postgres;
alter function app.arm_private_live_telebirr_historical_completion(
  uuid, uuid, bigint, uuid, text, text
) owner to postgres;
alter function app.consume_private_live_telebirr_historical_completion(
  uuid, uuid, boolean
) owner to postgres;
alter function app.close_private_live_telebirr_historical_completion(uuid, text)
  owner to postgres;
alter function app.load_next_private_live_telebirr_staged_evidence() owner to postgres;
alter function app.load_private_live_telebirr_verification_authority(
  uuid, uuid, timestamptz
) owner to postgres;
alter function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) owner to postgres;

revoke all privileges on table
  app.private_live_telebirr_historical_completion_authorities,
  app.private_live_telebirr_historical_completion_consumptions,
  app.private_live_telebirr_historical_completion_closures
from public, anon, authenticated, service_role;

revoke all on function
  app.private_live_telebirr_historical_completion_digest(
    uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, timestamptz, text
  ),
  app.is_private_live_telebirr_historical_attempt_authorized(uuid, uuid, text, text),
  app.is_private_live_telebirr_historical_intent_authorized(uuid),
  app.is_private_live_telebirr_historical_claim_authorized(uuid),
  app.arm_private_live_telebirr_historical_completion(uuid, uuid, bigint, uuid, text, text),
  app.consume_private_live_telebirr_historical_completion(uuid, uuid, boolean),
  app.close_private_live_telebirr_historical_completion(uuid, text)
from public, anon, authenticated, service_role,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime;

revoke all on function
  app.load_next_private_live_telebirr_staged_evidence(),
  app.load_private_live_telebirr_verification_authority(uuid, uuid, timestamptz),
  app.complete_private_live_telebirr_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  )
from public, anon, authenticated, service_role,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime;

grant execute on function
  app.load_next_private_live_telebirr_staged_evidence(),
  app.load_private_live_telebirr_verification_authority(uuid, uuid, timestamptz),
  app.complete_private_live_telebirr_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  )
to fetanagent_trusted_telebirr_verifier;

comment on table app.private_live_telebirr_historical_completion_authorities is
  'Append-only, one-target authority for trusted verification of staged evidence captured before an expired pilot window.';
comment on function app.arm_private_live_telebirr_historical_completion(
  uuid, uuid, bigint, uuid, text, text
) is
  'Postgres-only one-use arming boundary for the exact expired live TeleBirr staged-evidence incident. It enables only the trusted verifier credential and never KemerBet execution.';
comment on function app.close_private_live_telebirr_historical_completion(uuid, text) is
  'Postgres-only fail-closed boundary that disables the trusted verifier login and terminates its sessions after historical completion or operator stop.';

commit;
