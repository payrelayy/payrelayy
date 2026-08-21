-- Dedicated trusted TeleBirr verifier database boundary.
--
-- This migration creates only a NOLOGIN, unconfigured runtime scaffold. It neither enrolls a
-- signer/device nor changes a feature switch. The verifier receives one current, server-timed
-- authority snapshot and may complete only through the already fail-closed TeleBirr completion
-- procedure. It receives no base-table, sequence, generic worker, public API, or SET ROLE access.

begin;

create role fetanagent_trusted_telebirr_verifier
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_trusted_telebirr_verifier_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant fetanagent_trusted_telebirr_verifier
  to fetanagent_trusted_telebirr_verifier_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- Preserve the already reviewed completion implementation behind a non-granted internal name.
-- The public contract below adds an operation-time session-expiry gate without duplicating or
-- weakening the settlement implementation.
alter function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) rename to complete_private_live_telebirr_verification_internal;

create function app.require_trusted_telebirr_verifier_session()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  runtime_is_currently_authorized boolean;
begin
  -- The migration owner remains an explicit test/maintenance bypass. No other login, including
  -- a role that can SET ROLE to the verifier group, may cross the financial boundary.
  if session_user = 'postgres' then
    return;
  end if;

  select exists (
    select 1
      from pg_catalog.pg_roles role
     where role.rolname = session_user
       and role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not null
       and role.rolvaliduntil
           > pg_catalog.clock_timestamp() + interval '5 minutes'
       and role.rolvaliduntil
           <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
  ) into runtime_is_currently_authorized;

  if runtime_is_currently_authorized is not true then
    raise exception 'The trusted TeleBirr verifier session is not currently authorized.';
  end if;
end;
$$;

-- Preserve the generic settlement runtime's exact membership guard behind an owner-only name.
-- The finalizer continues calling the original name, which is recreated below as a router. Its
-- direct ACL remains settlement-only, so the trusted verifier can reach this route only through
-- the already guarded TeleBirr completion chain.
alter function app.require_private_live_deposit_pilot_settlement()
  rename to require_private_live_deposit_pilot_settlement_runtime_internal;

create function app.require_private_live_deposit_pilot_settlement()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if session_user = 'fetanagent_trusted_telebirr_verifier_runtime' then
    perform app.require_trusted_telebirr_verifier_session();
    return;
  end if;

  perform app.require_private_live_deposit_pilot_settlement_runtime_internal();
end;
$$;

create function app.complete_private_live_telebirr_verification(
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
set search_path = pg_catalog
as $$
begin
  perform app.require_trusted_telebirr_verifier_session();

  return query
  select completed.verification_outcome_id,
         completed.outcome_disposition,
         completed.outcome_reason_code,
         completed.deposit_intent_id,
         completed.deposit_payment_claim_id,
         completed.execution_job_id,
         completed.settlement_created,
         completed.already_completed
    from app.complete_private_live_telebirr_verification_internal(
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
    ) completed;
end;
$$;

create function app.load_private_live_telebirr_verification_authority(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  assignment_signer app.private_live_telebirr_assignment_signers%rowtype;
  assignment_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  attempted app.private_live_telebirr_verification_attempts%rowtype;
  captured_at timestamptz := clock_timestamp();
  current_owner app.customers%rowtype;
  current_player app.customer_platform_players%rowtype;
  current_policy app.deposit_policy_versions%rowtype;
  current_provider app.payment_providers%rowtype;
  current_receiver app.receiver_accounts%rowtype;
  current_submitter app.customers%rowtype;
  device_enrollment app.private_live_telebirr_device_enrollments%rowtype;
  duplicate_state text;
  eligibility app.player_deposit_eligibility_decisions%rowtype;
  eligibility_state text;
  existing_current_observation app.private_live_telebirr_observation_transcripts%rowtype;
  existing_current_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  is_device_revoked boolean;
  is_pilot_live boolean;
  is_signer_revoked boolean;
  job app.private_live_telebirr_verification_jobs%rowtype;
  owner_snapshot_state text;
  payload jsonb;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  private_pilot_switch_settings jsonb;
  player_member app.private_live_deposit_pilot_players%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  receiver_fact_state text;
  replay_identities jsonb;
  state_material jsonb;
  submitter_member app.private_live_deposit_pilot_customers%rowtype;
  submitter_snapshot_state text;
  switch_count integer;
  telebirr_switch_settings jsonb;
begin
  perform app.require_trusted_telebirr_verifier_session();

  if p_verification_attempt_id is null or p_lease_token is null then
    return null;
  end if;

  select verification_attempt.*
    into attempted
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = p_verification_attempt_id
     and verification_attempt.lease_token = p_lease_token;

  if attempted.id is null then
    return null;
  end if;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = attempted.verification_job_id;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = job.private_live_deposit_pilot_proof_id;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = job.pilot_revision_id;

  select member.*
    into submitter_member
    from app.private_live_deposit_pilot_customers member
   where member.pilot_revision_id = pilot.id
     and member.customer_id = job.submitting_customer_id;

  select member.*
    into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id
     and member.player_account_id = job.player_account_id;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.payment_provider_id = job.payment_provider_id
     and member.receiver_account_id = job.receiver_account_id
     and member.receiver_account_version = job.receiver_account_version;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id;

  select enrollment.*
    into device_enrollment
    from app.private_live_telebirr_device_enrollments enrollment
   where enrollment.id = attempted.device_enrollment_id;

  select transcript.*
    into assignment_transcript
    from app.private_live_telebirr_assignment_transcripts transcript
   where transcript.verification_attempt_id = attempted.id;

  select signer.*
    into assignment_signer
    from app.private_live_telebirr_assignment_signers signer
   where signer.id = assignment_transcript.assignment_signer_id;

  select outcome.*
    into existing_current_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_attempt_id = attempted.id
     and outcome.verification_job_id = job.id;

  select observation.*
    into existing_current_observation
    from app.private_live_telebirr_observation_transcripts observation
   where observation.id = existing_current_outcome.observation_transcript_id
     and observation.verification_attempt_id = attempted.id;

  select customer.*
    into current_submitter
    from app.customers customer
   where customer.id = job.submitting_customer_id;

  select customer.*
    into current_owner
    from app.customers customer
   where customer.id = player_member.player_owner_customer_id_snapshot;

  select player.*
    into current_player
    from app.customer_platform_players player
   where player.id = job.player_account_id;

  select decision.*
    into eligibility
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = job.player_account_id
   order by decision.decision_version desc
   limit 1;

  select payment_provider.*
    into current_provider
    from app.payment_providers payment_provider
   where payment_provider.id = job.payment_provider_id;

  select receiver.*
    into current_receiver
    from app.receiver_accounts receiver
   where receiver.id = job.receiver_account_id
     and receiver.provider_id = job.payment_provider_id
     and receiver.version = job.receiver_account_version;

  select policy.*
    into current_policy
    from app.deposit_policy_versions policy
   where policy.status = 'active';

  if job.id is null
    or proof.id is null
    or pilot.id is null
    or submitter_member.customer_id is null
    or player_member.player_account_id is null
    or provider_member.payment_provider_id is null
    or profile.id is null
    or device_enrollment.id is null
    or assignment_transcript.id is null
    or assignment_signer.id is null
    or assignment_signer.signer_key_id = device_enrollment.key_id
    or assignment_signer.public_key_spki_sha256
         = device_enrollment.public_key_spki_sha256
    or current_submitter.id is null
    or current_owner.id is null
    or current_player.id is null
    or current_provider.id is null
    or current_receiver.id is null then
    return null;
  end if;

  select count(*)::integer
    into switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
     and feature_switch.mode = 'live';

  select feature_switch.settings
    into private_pilot_switch_settings
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'private_live_deposit_pilot';

  select feature_switch.settings
    into telebirr_switch_settings
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'telebirr_authoritative_verification';

  -- TeleBirr authority is provider-specific. CBE Birr may and should remain disabled for a
  -- TeleBirr-only pilot; requiring its unrelated switch would couple independent providers.
  is_pilot_live := switch_count = 4
    and pilot.status = 'armed'
    and private_pilot_switch_settings = jsonb_build_object(
      'contract_version', 1,
      'pilot_revision_id', pilot.id::text,
      'configuration_digest', pilot.configuration_digest
    )
    and telebirr_switch_settings = '{}'::jsonb
    and captured_at >= pilot.active_from
    and captured_at < pilot.expires_at
    and captured_at < job.expires_at
    and captured_at < attempted.expires_at
    and app.is_private_live_deposit_pilot_enforced()
    and provider_member.provider_code_snapshot = 'telebirr'
    and current_provider.code = 'telebirr'
    and current_provider.status = 'active'
    and current_provider.updated_at = provider_member.provider_updated_at_snapshot
    and profile.provider_code = 'telebirr'
    and profile.pilot_revision_id = pilot.id
    and profile.payment_provider_id = current_provider.id;

  select exists (
    select 1
      from app.private_live_telebirr_device_revocations revocation
     where revocation.device_enrollment_id = device_enrollment.id
       and revocation.revoked_at <= captured_at
  ) into is_device_revoked;

  select exists (
    select 1
      from app.private_live_telebirr_assignment_signer_revocations revocation
     where revocation.assignment_signer_id = assignment_signer.id
       and revocation.revoked_at <= captured_at
  ) into is_signer_revoked;

  submitter_snapshot_state := case
    when current_submitter.status is distinct from submitter_member.customer_status_snapshot
      or current_submitter.updated_at is distinct from submitter_member.customer_updated_at_snapshot
      then 'stale'
    else 'exact'
  end;

  owner_snapshot_state := case
    when current_owner.status is distinct from player_member.player_owner_customer_status_snapshot
      or current_owner.updated_at
           is distinct from player_member.player_owner_customer_updated_at_snapshot
      or current_player.updated_at is distinct from player_member.player_updated_at_snapshot
      then 'stale'
    else 'exact'
  end;

  eligibility_state := case
    when eligibility.id is null then 'unavailable'
    when eligibility.id is distinct from player_member.eligibility_decision_id_snapshot
      or eligibility.decision_version
           is distinct from player_member.eligibility_decision_version_snapshot
      or eligibility.decided_at is distinct from player_member.eligibility_decided_at_snapshot
      or eligibility.player_account_updated_at_snapshot is distinct from current_player.updated_at
      then 'ambiguous'
    when eligibility.decision = 'eligible'
      and current_player.status = 'active'
      and current_player.validation_status = 'valid'
      then 'eligible'
    else 'ineligible'
  end;

  duplicate_state := case when exists (
    select 1
      from app.provider_payment_evidence evidence
      where evidence.payment_provider_id = job.payment_provider_id
        and evidence.canonical_reference_fingerprint = job.candidate_reference_fingerprint
        and (
          existing_current_outcome.id is null
          or evidence.private_live_telebirr_outcome_id
               is distinct from existing_current_outcome.id
        )
  ) then 'reused' else 'unused' end;

  receiver_fact_state := case
    when p_occurred_at is null then 'unavailable'
    when current_receiver.active_from > p_occurred_at
      or (current_receiver.retired_at is not null
          and p_occurred_at >= current_receiver.retired_at)
      then 'gap'
    when current_receiver.account_holder_name
           is distinct from provider_member.receiver_account_holder_name_snapshot
      or current_receiver.account_reference_masked
           is distinct from provider_member.receiver_account_masked_snapshot
      or current_receiver.active_from is distinct from provider_member.receiver_active_from_snapshot
      or current_receiver.updated_at is distinct from provider_member.receiver_updated_at_snapshot
      then 'unavailable'
    else 'exact'
  end;

  select coalesce(
           jsonb_agg(observation.replay_identity order by observation.replay_identity)
             filter (where observation.replay_identity is not null),
           '[]'::jsonb
         )
    into replay_identities
    from app.private_live_telebirr_observation_transcripts observation
    join app.private_live_telebirr_verification_attempts prior_attempt
      on prior_attempt.id = observation.verification_attempt_id
    join app.private_live_telebirr_verification_jobs prior_job
      on prior_job.id = prior_attempt.verification_job_id
   where prior_job.pilot_revision_id = job.pilot_revision_id
     and observation.verification_attempt_id <> attempted.id;

  state_material := jsonb_build_object(
    'attempt', to_jsonb(attempted),
    'assignmentSigner', to_jsonb(assignment_signer),
    'assignmentSignerRevoked', is_signer_revoked,
    'assignmentTranscript', to_jsonb(assignment_transcript),
    'currentEligibility', to_jsonb(eligibility),
    'currentOwner', to_jsonb(current_owner),
    'currentPlayer', to_jsonb(current_player),
    'currentPolicy', to_jsonb(current_policy),
    'currentProvider', to_jsonb(current_provider),
    'currentReceiver', to_jsonb(current_receiver),
    'currentSubmitter', to_jsonb(current_submitter),
    'deviceEnrollment', to_jsonb(device_enrollment),
    'deviceRevoked', is_device_revoked,
    'duplicateState', duplicate_state,
    'existingCurrentObservation', to_jsonb(existing_current_observation),
    'existingCurrentOutcome', to_jsonb(existing_current_outcome),
    'job', to_jsonb(job),
    'ownerSnapshotState', owner_snapshot_state,
    'pilot', to_jsonb(pilot),
    'pilotLive', is_pilot_live,
    'privatePilotSwitchSettings', private_pilot_switch_settings,
    'playerMember', to_jsonb(player_member),
    'profile', to_jsonb(profile),
    'proof', to_jsonb(proof),
    'providerMember', to_jsonb(provider_member),
    'receiverFactState', receiver_fact_state,
    'replayIdentities', replay_identities,
    'existingCompletion', case
      when existing_current_outcome.id is null
        or existing_current_observation.id is null then null
      else jsonb_build_object(
        'completionRequestKey', existing_current_outcome.completion_request_key,
        'observationBodyDigest', existing_current_observation.observation_body_digest,
        'observationSignatureDigest',
          existing_current_observation.observation_signature_digest,
        'replayIdentity', existing_current_observation.replay_identity,
        'sourceDocumentDigest', existing_current_observation.source_document_digest,
        'normalizedFactsDigest', existing_current_observation.normalized_facts_digest,
        'observedAt', to_jsonb(existing_current_observation.observed_at),
        'protocolDisposition', existing_current_observation.protocol_disposition,
        'protocolReasonCode', existing_current_observation.protocol_reason_code,
        'assessmentInputDigest', existing_current_outcome.assessment_input_digest,
        'assessedAt', to_jsonb(existing_current_outcome.assessed_at),
        'disposition', existing_current_outcome.disposition,
        'reasonCode', existing_current_outcome.reason_code,
        'evidenceDigest', existing_current_outcome.evidence_digest,
        'retrievedAt', to_jsonb(existing_current_outcome.retrieved_at),
        'receiptPrincipalAmountMinor', case
          when existing_current_outcome.principal_amount_minor is null then null
          else existing_current_outcome.principal_amount_minor::text
        end,
        'occurredAt', to_jsonb(existing_current_outcome.occurred_at),
        'receiverIdentityDigest', existing_current_outcome.receiver_identity_digest
      )
    end,
    'submitterMember', to_jsonb(submitter_member),
    'submitterSnapshotState', submitter_snapshot_state,
    'switchCount', switch_count,
    'telebirrSwitchSettings', telebirr_switch_settings
  );

  payload := jsonb_build_object(
    'contractVersion', 1,
    'capturedAt', to_jsonb(captured_at),
    'authorityStateDigest', app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:trusted-verifier:authority-state:v1|'
        || state_material::text
    ),
    'verificationAttemptId', attempted.id,
    'leaseTokenAccepted', true,
    'attempt', jsonb_build_object(
      'assignmentId', attempted.assignment_id,
      'requestId', attempted.request_id,
      'jobId', attempted.verification_job_id,
      'attemptNumber', attempted.attempt_number,
      'leaseNonceDigest', attempted.lease_nonce_digest,
      'challengeId', attempted.challenge_id,
      'challengeDigest', attempted.challenge_digest,
      'issuedAt', to_jsonb(attempted.issued_at),
      'expiresAt', to_jsonb(attempted.expires_at)
    ),
    'trustedAssignmentSigner', jsonb_build_object(
      'contractVersion', 1,
      'providerCode', 'telebirr',
      'protocolMode', 'live_private_pilot_v1',
      'signerKeyId', assignment_signer.signer_key_id,
      'publicKeySpkiSha256', assignment_signer.public_key_spki_sha256,
      'signatureAlgorithm', assignment_signer.signature_algorithm,
      'state', case when is_signer_revoked then 'revoked' else 'active' end,
      'validFrom', to_jsonb(assignment_signer.valid_from),
      'validUntil', to_jsonb(assignment_signer.valid_until)
    ),
    'deviceEnrollment', jsonb_build_object(
      'contractVersion', 1,
      'providerCode', 'telebirr',
      'protocolMode', 'live_private_pilot_v1',
      'enrollmentId', device_enrollment.id,
      'deviceId', device_enrollment.device_id,
      'keyId', device_enrollment.key_id,
      'publicKeySpkiSha256', device_enrollment.public_key_spki_sha256,
      'signatureAlgorithm', device_enrollment.signature_algorithm,
      'state', case when is_device_revoked then 'revoked' else 'active' end,
      'validFrom', to_jsonb(device_enrollment.valid_from),
      'validUntil', to_jsonb(device_enrollment.valid_until),
      'pilotRevisionId', device_enrollment.pilot_revision_id,
      'receiverRevisionId', job.receiver_account_id,
      'receiverProfileId', profile.id,
      'receiverProfileDigest', profile.receiver_profile_digest,
      'receiverConfigurationDigest', profile.receiver_configuration_digest
    ),
    'trustedRequestBinding', jsonb_build_object(
      'assignmentId', attempted.assignment_id,
      'requestId', attempted.request_id,
      'jobId', attempted.verification_job_id,
      'attemptNumber', attempted.attempt_number,
      'pilotRevisionId', job.pilot_revision_id,
      'deviceId', attempted.device_id_snapshot,
      'keyId', attempted.device_key_id_snapshot,
      'referenceFingerprint', 'hmac-sha256:' || job.candidate_reference_fingerprint,
      'receiverRevisionId', job.receiver_account_id,
      'receiverProfileId', profile.id,
      'receiverProfileDigest', profile.receiver_profile_digest,
      'receiverConfigurationDigest', profile.receiver_configuration_digest,
      'expectedReceiverNameDigest', profile.expected_receiver_name_digest
    ),
    'assignmentTranscript', jsonb_build_object(
      'assignmentBodyDigest', assignment_transcript.assignment_body_digest,
      'assignmentSignatureDigest', assignment_transcript.assignment_signature_digest,
      'referenceBindingDigest', assignment_transcript.reference_binding_digest,
      'signedAt', to_jsonb(assignment_transcript.signed_at)
    ),
    'replayIdentities', replay_identities,
    'existingCompletion', case
      when existing_current_outcome.id is null
        or existing_current_observation.id is null then null
      else jsonb_build_object(
        'completionRequestKey', existing_current_outcome.completion_request_key,
        'observationBodyDigest', existing_current_observation.observation_body_digest,
        'observationSignatureDigest',
          existing_current_observation.observation_signature_digest,
        'replayIdentity', existing_current_observation.replay_identity,
        'sourceDocumentDigest', existing_current_observation.source_document_digest,
        'normalizedFactsDigest', existing_current_observation.normalized_facts_digest,
        'observedAt', to_jsonb(existing_current_observation.observed_at),
        'protocolDisposition', existing_current_observation.protocol_disposition,
        'protocolReasonCode', existing_current_observation.protocol_reason_code,
        'assessmentInputDigest', existing_current_outcome.assessment_input_digest,
        'assessedAt', to_jsonb(existing_current_outcome.assessed_at),
        'disposition', existing_current_outcome.disposition,
        'reasonCode', existing_current_outcome.reason_code,
        'evidenceDigest', existing_current_outcome.evidence_digest,
        'retrievedAt', to_jsonb(existing_current_outcome.retrieved_at),
        'receiptPrincipalAmountMinor', case
          when existing_current_outcome.principal_amount_minor is null then null
          else existing_current_outcome.principal_amount_minor::text
        end,
        'occurredAt', to_jsonb(existing_current_outcome.occurred_at),
        'receiverIdentityDigest', existing_current_outcome.receiver_identity_digest
      )
    end,
    'trustedRequest', jsonb_build_object(
      'proofRequestId', attempted.request_id,
      'submittingCustomerId', job.submitting_customer_id,
      'submittingCustomerMembershipState', 'included',
      'submittingCustomerCurrentState',
        case when current_submitter.status = 'active' then 'active' else 'inactive' end,
      'submittingCustomerSnapshotState', submitter_snapshot_state,
      'playerAccountId', job.player_account_id,
      'selectedPlayerId', player_member.player_id_snapshot,
      'providerCode', 'telebirr',
      'referenceFingerprint', job.candidate_reference_fingerprint,
      'submittedAt', to_jsonb(proof.submitted_at),
      'pilotRevisionId', pilot.id,
      'pilotConfigurationDigest', pilot.configuration_digest,
      'receiverRevisionId', job.receiver_account_id,
      'policyVersion', profile.policy_version,
      'databaseSnapshotId', attempted.id
    ),
    'trustedPilot', jsonb_build_object(
      'contractVersion', 1,
      'revisionId', pilot.id,
      'configurationDigest', pilot.configuration_digest,
      'state', case when is_pilot_live then 'armed' else 'stopped' end,
      'validFrom', to_jsonb(pilot.active_from),
      'validUntil', to_jsonb(pilot.expires_at)
    ),
    'trustedPlayer', jsonb_build_object(
      'ownerCustomerId', player_member.player_owner_customer_id_snapshot,
      'playerMembershipState', 'included',
      'ownerCustomerBindingState',
        case when current_player.customer_id = player_member.player_owner_customer_id_snapshot
          then 'exact' else 'mismatched' end,
      'ownerCustomerCurrentState',
        case when current_owner.status = 'active' then 'active' else 'inactive' end,
      'ownerCustomerSnapshotState', owner_snapshot_state,
      'playerAccountId', job.player_account_id,
      'selectedPlayerId', player_member.player_id_snapshot,
      'eligibilityState', eligibility_state,
      'eligibilityDecisionVersion', case
        when eligibility_state in ('eligible', 'ineligible')
          then app.private_live_telebirr_eligibility_version(eligibility.decision_version)
        else null
      end
    ),
    'trustedProvider', jsonb_build_object(
      'providerCode', 'telebirr',
      'state', case
        when current_provider.status = 'active'
          and current_provider.updated_at = provider_member.provider_updated_at_snapshot
          then 'active' else 'inactive' end,
      'source', 'telebirr_official_receipt',
      'sourceProfile', profile.source_profile,
      'adapterVersion', profile.adapter_version,
      'parserVersion', profile.parser_version,
      'normalizerVersion', profile.facts_normalizer_version
    ),
    'trustedReference', jsonb_build_object(
      'providerCode', 'telebirr',
      'protectionProfileVersion', proof.reference_profile_version,
      'encryptionKeyVersion', proof.reference_encryption_key_version,
      'ciphertext', proof.candidate_reference_ciphertext,
      'fingerprint', proof.candidate_reference_fingerprint,
      'masked', proof.candidate_reference_masked
    ),
    'trustedReceiver', jsonb_build_object(
      'providerCode', 'telebirr',
      'revisionId', job.receiver_account_id,
      'revisionVersion', job.receiver_account_version,
      'profileId', profile.id,
      'profileDigest', profile.receiver_profile_digest,
      'configurationDigest', profile.receiver_configuration_digest,
      'identityDigest', profile.receiver_identity_digest,
      'expectedReceiverNameDigest', profile.expected_receiver_name_digest,
      'matchBasis', profile.receiver_match_basis
    ),
    'trustedPolicy', jsonb_build_object(
      'providerCode', 'telebirr',
      'policyVersion', profile.policy_version,
      'policyDigest', profile.policy_digest
    ),
    'databaseAuthority', jsonb_build_object(
      'submittingCustomerId', job.submitting_customer_id,
      'submittingCustomerMembershipState', 'included',
      'submittingCustomerCurrentState',
        case when current_submitter.status = 'active' then 'active' else 'inactive' end,
      'submittingCustomerSnapshotState', submitter_snapshot_state,
      'ownerCustomerId', player_member.player_owner_customer_id_snapshot,
      'playerAccountId', job.player_account_id,
      'playerMembershipState', 'included',
      'ownerCustomerBindingState',
        case when current_player.customer_id = player_member.player_owner_customer_id_snapshot
          then 'exact' else 'mismatched' end,
      'ownerCustomerCurrentState',
        case when current_owner.status = 'active' then 'active' else 'inactive' end,
      'ownerCustomerSnapshotState', owner_snapshot_state
    ),
    'databaseFacts', jsonb_build_object(
      'receiverAtOccurredAt', jsonb_build_object(
        'state', receiver_fact_state,
        'providerCode', 'telebirr',
        'resolvedForOccurredAt', to_jsonb(p_occurred_at),
        'revisionId', case when receiver_fact_state = 'exact' then current_receiver.id else null end,
        'identityDigest',
          case when receiver_fact_state = 'exact' then profile.receiver_identity_digest else null end,
        'matchBasis',
          case when receiver_fact_state = 'exact' then profile.receiver_match_basis else null end,
        'effectiveFrom',
          case when receiver_fact_state = 'exact' then to_jsonb(current_receiver.active_from)
            else null end,
        'effectiveUntil',
          case when receiver_fact_state = 'exact' then to_jsonb(current_receiver.retired_at)
            else null end
      ),
      'currentPolicy', jsonb_build_object(
        'state', case
          when current_policy.id = job.deposit_policy_version_id
            and current_policy.version = job.deposit_policy_version
            and current_policy.freshness_window_seconds = profile.automatic_freshness_seconds
            then 'available' else 'unavailable' end,
        'providerCode', 'telebirr',
        'checkedAt', to_jsonb(captured_at),
        'policyVersion', profile.policy_version,
        'currencyCode', 'ETB',
        'minimumPrincipalAmountMinor', job.minimum_principal_amount_minor::text,
        'maximumPrincipalAmountMinor', job.maximum_principal_amount_minor::text,
        'automaticFreshnessSeconds', profile.automatic_freshness_seconds,
        'maximumFutureSkewSeconds', profile.maximum_future_skew_seconds,
        'allowedTransactionType', 'send_money',
        'acceptedSource', 'telebirr_official_receipt',
        'acceptedSourceProfile', profile.source_profile,
        'acceptedAdapterVersion', profile.adapter_version,
        'acceptedParserVersion', profile.parser_version,
        'acceptedNormalizerVersion', profile.facts_normalizer_version
      ),
      'currentEligibility', jsonb_build_object(
        'state', eligibility_state,
        'selectedPlayerId', player_member.player_id_snapshot,
        'checkedAt', to_jsonb(captured_at),
        'decisionVersion', case
          when eligibility_state in ('eligible', 'ineligible')
            then app.private_live_telebirr_eligibility_version(eligibility.decision_version)
          else null
        end
      ),
      'duplicateState', jsonb_build_object(
        'state', duplicate_state,
        'providerCode', 'telebirr',
        'canonicalReferenceFingerprint', job.candidate_reference_fingerprint,
        'checkedAt', to_jsonb(captured_at)
      )
    )
  );

  return payload;
end;
$$;

alter function app.load_private_live_telebirr_verification_authority(uuid, uuid, timestamptz)
  owner to postgres;
alter function app.require_trusted_telebirr_verifier_session() owner to postgres;
alter function app.require_private_live_deposit_pilot_settlement_runtime_internal()
  owner to postgres;
alter function app.require_private_live_deposit_pilot_settlement() owner to postgres;
alter function app.complete_private_live_telebirr_verification_internal(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) owner to postgres;
alter function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) owner to postgres;

-- These roles are new and intentionally receive no direct user-database capabilities. Repeat the
-- revokes across every existing non-system schema so the migration is fail-closed even if a future
-- bootstrap changes role defaults. Inherited PUBLIC CONNECT/TEMP and public-schema USAGE are
-- catalog-audited by the runtime; only the exact app grant below is added by this migration.
do $$
declare
  schema_name text;
begin
  execute format(
    'revoke all privileges on database %I from fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime',
    current_database()
  );

  for schema_name in
    select namespace.nspname
     from pg_catalog.pg_namespace namespace
     where namespace.nspname not in ('pg_catalog', 'information_schema')
       and namespace.nspname !~ '^pg_(toast|temp)'
  loop
    execute format(
      'revoke all privileges on schema %I from fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime',
      schema_name
    );
    execute format(
      'revoke all privileges on all tables in schema %I from fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime',
      schema_name
    );
    execute format(
      'revoke all privileges on all sequences in schema %I from fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime',
      schema_name
    );
    execute format(
      'revoke all privileges on all functions in schema %I from fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime',
      schema_name
    );
    execute format(
      'revoke all privileges on all procedures in schema %I from fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime',
      schema_name
    );
  end loop;
end;
$$;

revoke all on function
  app.require_private_live_deposit_pilot_settlement(),
  app.require_private_live_deposit_pilot_settlement_runtime_internal()
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
     fetanagent_trusted_telebirr_verifier_runtime;

revoke all on function
  app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid, uuid, uuid)
from fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime;

revoke all on function
  app.load_private_live_telebirr_verification_authority(uuid, uuid, timestamptz),
  app.complete_private_live_telebirr_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime;

grant usage on schema app to fetanagent_trusted_telebirr_verifier;
grant execute on function
  app.load_private_live_telebirr_verification_authority(uuid, uuid, timestamptz),
  app.complete_private_live_telebirr_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  )
to fetanagent_trusted_telebirr_verifier;

comment on function app.load_private_live_telebirr_verification_authority(
  uuid, uuid, timestamptz
) is
  'Returns one server-timed, protected-reference-only authority snapshot for an exact TeleBirr attempt and lease token. It exposes no raw receipt, raw receiver name, credential, or base-table capability.';
comment on function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Operation-time guarded TeleBirr completion boundary. It checks the exact session login and server-time validity before delegating to the non-granted reviewed implementation.';
comment on function app.complete_private_live_telebirr_verification_internal(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Owner-only reviewed TeleBirr completion implementation behind the operation-time runtime guard; never granted to the verifier or public roles.';
comment on function app.require_trusted_telebirr_verifier_session() is
  'Owner-only server-time guard requiring the exact bounded trusted TeleBirr runtime login for every financial operation; postgres is the explicit migration-owner maintenance bypass.';
comment on function app.require_private_live_deposit_pilot_settlement() is
  'Owner-only settlement guard router. It preserves the generic settlement runtime membership gate and admits only the exact, currently valid trusted TeleBirr runtime when reached through the non-granted finalizer inside guarded completion.';
comment on function app.require_private_live_deposit_pilot_settlement_runtime_internal() is
  'Owner-only original generic settlement-runtime membership guard; never granted directly to public, API, generic worker, settlement, or trusted verifier roles.';

comment on role fetanagent_trusted_telebirr_verifier is
  'FetanAgent trusted TeleBirr verifier group. NOLOGIN; may read one exact authority snapshot and invoke only the guarded TeleBirr completion boundary.';

comment on role fetanagent_trusted_telebirr_verifier_runtime is
  'FetanAgent trusted TeleBirr verifier runtime scaffold. NOLOGIN and unconfigured; inherits only the trusted verifier group and cannot SET ROLE. A separately reviewed provisioning helper must set the password, LOGIN, and a bounded expiry before any future activation.';

commit;
