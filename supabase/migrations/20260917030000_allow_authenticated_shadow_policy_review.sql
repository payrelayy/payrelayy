begin;

-- The protocol and the policy adapter answer different questions. Authenticated evidence may pass
-- the signed-evidence protocol while the independently pinned policy still requires review. Keep
-- settlement strict, but preserve that safe downgrade instead of rejecting the terminal outcome.
create or replace function app.complete_private_telebirr_shadow_verification(
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
declare
  authority_at timestamptz;
  attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  transcript app.private_telebirr_shadow_assignment_transcripts%rowtype;
  staged app.private_telebirr_shadow_device_evidence_staging%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  existing_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  inserted_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  completion_digest text;
begin
  perform app.require_telebirr_shadow_verifier_session();

  if p_verification_attempt_id is null
    or p_lease_token is null
    or p_completion_request_key is null
    or p_completion_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_observation_body_digest is null
    or p_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observation_signature_digest is null
    or p_observation_signature_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_source_document_digest is null
    or p_source_document_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_normalized_facts_digest is null
    or p_normalized_facts_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observed_at is null
    or p_protocol_disposition not in ('would_review', 'would_forward_signed_evidence')
    or p_protocol_reason_code is null
    or (
      p_protocol_disposition = 'would_forward_signed_evidence'
      and p_protocol_reason_code <> 'signed_evidence_verified'
    )
    or (
      p_protocol_disposition = 'would_review'
      and p_protocol_reason_code = 'signed_evidence_verified'
    )
    or p_assessment_input_digest is null
    or p_assessment_input_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_assessed_at is null
    or p_disposition not in ('definite_reject', 'review_required', 'settlement_candidate')
    or p_reason_code is null
    or p_reason_code !~ '^[a-z][a-z0-9_]{2,127}$'
    or p_evidence_digest is null
    or p_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_retrieved_at is null
    or (
      p_disposition = 'settlement_candidate'
      and (
        p_protocol_disposition <> 'would_forward_signed_evidence'
        or p_protocol_reason_code <> 'signed_evidence_verified'
        or p_reason_code <> 'exact_proof_match'
        or p_receipt_principal_amount_minor is null
        or p_occurred_at is null
        or p_receiver_identity_digest is null
        or p_receiver_identity_digest !~ '^sha256:[0-9a-f]{64}$'
      )
    )
    or (
      p_disposition <> 'settlement_candidate'
      and (
        p_reason_code = 'exact_proof_match'
        or p_receipt_principal_amount_minor is not null
        or p_occurred_at is not null
        or p_receiver_identity_digest is not null
      )
    ) then
    raise exception 'The no-money TeleBirr shadow completion request is invalid.';
  end if;

  select candidate.* into attempt
    from app.private_telebirr_shadow_verification_attempts candidate
   where candidate.id = p_verification_attempt_id
     and candidate.lease_token = p_lease_token
   for update;
  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = attempt.shadow_proof_request_id
     and candidate.verification_job_id = attempt.verification_job_id
   for share;
  select candidate.* into transcript
    from app.private_telebirr_shadow_assignment_transcripts candidate
   where candidate.verification_attempt_id = attempt.id
   for share;
  select candidate.* into staged
    from app.private_telebirr_shadow_device_evidence_staging candidate
   where candidate.verification_attempt_id = attempt.id
     and candidate.observation_body_digest = p_observation_body_digest
   for share;
  select candidate.* into enrollment
    from app.private_live_telebirr_device_enrollments candidate
   where candidate.id = attempt.device_enrollment_id
   for share;
  select candidate.* into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where candidate.id = proof.receiver_profile_id
   for share;
  select candidate.* into signer
    from app.private_live_telebirr_assignment_signers candidate
   where candidate.id = transcript.assignment_signer_id
   for share;
  select outcome.* into existing_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.verification_attempt_id = attempt.id
      or outcome.completion_request_key = p_completion_request_key
   order by outcome.created_at, outcome.id
   limit 1
   for share;

  authority_at := pg_catalog.clock_timestamp();

  if attempt.id is null
    or proof.id is null
    or transcript.id is null
    or staged.observation_body_digest is null
    or enrollment.id is null
    or profile.id is null
    or signer.id is null
    or p_completion_request_key is distinct from attempt.lease_request_key
    or staged.assignment_transcript_id is distinct from transcript.id
    or staged.assignment_body_digest is distinct from transcript.assignment_body_digest
    or staged.device_enrollment_id is distinct from enrollment.id
    or staged.observed_at is distinct from p_observed_at
    or staged.signed_observation ->> 'bodyDigest' is distinct from p_observation_body_digest
    or app.private_live_telebirr_assignment_signature_digest(
         staged.signed_observation ->> 'signature'
       ) is distinct from p_observation_signature_digest
    or staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'
         is distinct from p_source_document_digest
    or staged.signed_observation -> 'body' ->> 'normalizedFactsDigest'
         is distinct from p_normalized_facts_digest
    or staged.staged_at >= proof.expires_at
    or staged.staged_at >= attempt.expires_at
    or staged.observed_at < attempt.issued_at
    or staged.observed_at >= attempt.expires_at
    or authority_at >= proof.submitted_at + interval '12 hours'
    or authority_at < profile.valid_from
    or authority_at >= profile.valid_until
    or authority_at < enrollment.valid_from
    or authority_at >= enrollment.valid_until
    or authority_at < signer.valid_from
    or authority_at >= signer.valid_until
    or p_assessed_at < p_observed_at
    or p_retrieved_at > p_assessed_at
    or exists (
      select 1 from app.private_telebirr_shadow_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = attempt.id
          or quarantine.observation_body_digest = staged.observation_body_digest
    )
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= authority_at
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= authority_at
    )
    or (
      p_disposition = 'settlement_candidate'
      and (
        p_receipt_principal_amount_minor < profile.minimum_principal_amount_minor
        or p_receipt_principal_amount_minor > profile.maximum_principal_amount_minor
        or p_receiver_identity_digest is distinct from profile.receiver_identity_digest
      )
    ) then
    raise exception 'The no-money TeleBirr shadow completion authority is unavailable.';
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(proof.pilot_revision_id);

  -- Attempt, device, signer, and gate locks can all wait. Re-evaluate the terminal authority at
  -- the post-wait instant before an advisory outcome can be recorded.
  authority_at := pg_catalog.clock_timestamp();
  if staged.staged_at >= proof.expires_at
    or staged.staged_at >= attempt.expires_at
    or staged.observed_at < attempt.issued_at
    or staged.observed_at >= attempt.expires_at
    or authority_at >= proof.submitted_at + interval '12 hours'
    or authority_at < profile.valid_from
    or authority_at >= profile.valid_until
    or authority_at < enrollment.valid_from
    or authority_at >= enrollment.valid_until
    or authority_at < signer.valid_from
    or authority_at >= signer.valid_until
    or exists (
      select 1 from app.private_telebirr_shadow_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = attempt.id
          or quarantine.observation_body_digest = staged.observation_body_digest
    )
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= authority_at
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= authority_at
    ) then
    raise exception 'The no-money TeleBirr shadow completion authority is unavailable.';
  end if;

  completion_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-completion:v1'
      || '|attempt_id=' || attempt.id::text
      || '|lease_token=' || attempt.lease_token::text
      || '|completion_request_key=' || p_completion_request_key::text
      || '|observation_body_digest=' || p_observation_body_digest
      || '|observation_signature_digest=' || p_observation_signature_digest
      || '|replay_identity=' || p_replay_identity
      || '|source_document_digest=' || p_source_document_digest
      || '|normalized_facts_digest=' || p_normalized_facts_digest
      || '|observed_at=' || p_observed_at::text
      || '|protocol_disposition=' || p_protocol_disposition
      || '|protocol_reason_code=' || p_protocol_reason_code
      || '|assessment_input_digest=' || p_assessment_input_digest
      || '|assessed_at=' || p_assessed_at::text
      || '|disposition=' || p_disposition
      || '|reason_code=' || p_reason_code
      || '|evidence_digest=' || p_evidence_digest
      || '|retrieved_at=' || p_retrieved_at::text
      || '|principal_amount_minor=' || coalesce(
           p_receipt_principal_amount_minor::text, '<null>'
         )
      || '|occurred_at=' || coalesce(p_occurred_at::text, '<null>')
      || '|receiver_identity_digest=' || coalesce(
           p_receiver_identity_digest, '<null>'
         )
  );

  if existing_outcome.id is not null then
    if existing_outcome.verification_attempt_id is distinct from attempt.id
      or existing_outcome.completion_request_key is distinct from p_completion_request_key
      or existing_outcome.completion_request_digest is distinct from completion_digest
      or existing_outcome.observation_body_digest is distinct from p_observation_body_digest then
      raise exception 'The no-money TeleBirr shadow completion replay conflicts.';
    end if;

    return query select existing_outcome.id,
                        case existing_outcome.disposition
                          when 'settlement_candidate' then 'would_verify'::text
                          when 'review_required' then 'would_review'::text
                          else 'would_reject'::text
                        end,
                        existing_outcome.reason_code,
                        null::uuid,
                        null::uuid,
                        null::uuid,
                        false,
                        true;
    return;
  end if;

  insert into app.private_telebirr_shadow_verification_outcomes (
    verification_attempt_id,
    shadow_proof_request_id,
    verification_job_id,
    completion_request_key,
    completion_request_digest,
    observation_body_digest,
    observation_signature_digest,
    replay_identity,
    source_document_digest,
    normalized_facts_digest,
    observed_at,
    protocol_disposition,
    protocol_reason_code,
    assessment_input_digest,
    assessed_at,
    disposition,
    reason_code,
    evidence_digest,
    retrieved_at,
    principal_amount_minor,
    occurred_at,
    receiver_identity_digest
  ) values (
    attempt.id,
    proof.id,
    proof.verification_job_id,
    p_completion_request_key,
    completion_digest,
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
  ) returning * into inserted_outcome;

  return query select inserted_outcome.id,
                      case inserted_outcome.disposition
                        when 'settlement_candidate' then 'would_verify'::text
                        when 'review_required' then 'would_review'::text
                        else 'would_reject'::text
                      end,
                      inserted_outcome.reason_code,
                      null::uuid,
                      null::uuid,
                      null::uuid,
                      false,
                      false;
end;
$$;

comment on function app.complete_private_telebirr_shadow_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Records one advisory no-money TeleBirr shadow outcome. Authenticated signed evidence may be independently downgraded to review by policy; only an exact fully pinned match can become a settlement candidate, and this function never creates financial rows.';

commit;
