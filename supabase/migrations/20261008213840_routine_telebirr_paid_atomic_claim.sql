-- Dormant atomic promotion of one signed, staged paid-phone observation into the
-- existing one-use payment claim and execution queue. This is deliberately
-- postgres-only: no runtime receives EXECUTE, no login/switch is changed, and
-- migration alone cannot process a deposit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.finalize_routine_telebirr_paid_observation(p_challenge_id uuid)
returns table (
  deposit_intent_id uuid, payment_claim_id uuid, execution_job_id uuid,
  already_finalized boolean
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_staged app.routine_telebirr_paid_observation_staging%rowtype;
  v_challenge app.routine_telebirr_lookup_challenges%rowtype;
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_opening app.routine_telebirr_paid_intent_openings%rowtype;
  v_authority app.routine_telebirr_processing_authorizations%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_intent_id uuid;
  v_submission_id uuid;
  v_evidence_id uuid;
  v_attempt_id uuid;
  v_claim_id uuid;
  v_job_id uuid;
  v_retrieved_at timestamptz;
  v_now timestamptz;
  v_switch_count integer;
  v_live_count integer;
  v_settled record;
begin
  if session_user <> 'postgres' or p_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'The routine paid settlement is unavailable.';
  end if;

  -- The Owner stop/save operation and paid poll/upload use this same lock.
  -- Switches are then locked in the order used by the existing settlement.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine paid authority is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification'
    ) order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_live_count
    from app.feature_switches feature_switch
    where (feature_switch.feature_key in ('deposit_execution', 'payment_verification')
      and feature_switch.mode = 'live')
      or (feature_switch.feature_key in (
        'private_live_deposit_pilot', 'telebirr_authoritative_verification')
        and feature_switch.mode = 'disabled');
  if v_switch_count <> 4 or v_live_count <> 4 then
    raise exception 'The routine paid settlement is stopped.';
  end if;

  select staged.* into v_staged
    from app.routine_telebirr_paid_observation_staging staged
    where staged.challenge_id = p_challenge_id for share;
  if v_staged.challenge_id is null then
    raise exception 'A staged paid-phone observation is required.';
  end if;

  -- An exact replay can retrieve the existing immutable result, never create a
  -- second claim or job. A partial or inconsistent historical lineage fails.
  select opening.* into v_opening
    from app.routine_telebirr_paid_intent_openings opening
    where opening.challenge_id = p_challenge_id for share;
  if v_opening.challenge_id is not null then
    select intent.id, claim.id, job.id
      into v_intent_id, v_claim_id, v_job_id
      from app.deposit_intents intent
      join app.deposit_payment_claims claim on claim.deposit_intent_id = intent.id
      join app.deposit_jobs job on job.deposit_intent_id = intent.id
        and job.job_kind = 'execute_deposit'
      join app.routine_telebirr_paid_observation_lineages lineage
        on lineage.deposit_intent_id = intent.id
       and lineage.deposit_payment_claim_id = claim.id
       and lineage.execution_job_id = job.id
       and lineage.challenge_id = v_opening.challenge_id
       and lineage.candidate_id = v_staged.candidate_id
       and lineage.observation_body_digest = v_staged.observation_body_digest
       and lineage.source_document_digest = v_staged.source_document_digest
       and lineage.reference_fingerprint = v_staged.reference_fingerprint
       and lineage.signed_observation = v_staged.signed_observation
      join app.routine_telebirr_execution_bindings binding
        on binding.execution_job_id = job.id
       and binding.deposit_payment_claim_id = claim.id
       and binding.authorization_id = v_opening.authorization_id
      where intent.id = v_opening.deposit_intent_id
        and intent.routine_telebirr_paid_opening_challenge_id = p_challenge_id
        and claim.provider_payment_evidence_id = lineage.provider_payment_evidence_id
        and job.max_attempts = 1
        and job.job_key = 'deposit-execution:v1:' || intent.id::text;
    if v_intent_id is null or v_claim_id is null or v_job_id is null then
      raise exception 'The existing routine paid settlement lineage is incomplete.';
    end if;
    return query select v_intent_id, v_claim_id, v_job_id, true;
    return;
  end if;

  select authority.* into v_authority
    from app.routine_telebirr_processing_events event
    join app.routine_telebirr_processing_authorizations authority
      on authority.id = event.authorization_id
    join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    join app.platform_agent_accounts agent on agent.id = authority.platform_agent_account_id
    join app.platforms platform on platform.id = agent.platform_id
    join app.deposit_policy_versions policy on policy.id = authority.deposit_policy_version_id
    where event.event_sequence = (
      select pg_catalog.max(latest.event_sequence)
        from app.routine_telebirr_processing_events latest)
      and event.event_kind = 'authorize'
      and owner_user.role = 'owner' and owner_user.status = 'active'
      and agent.status = 'active'
      and platform.code = 'kemerbet' and platform.status = 'active'
      and policy.status = 'active'
      and policy.minimum_amount_minor = authority.minimum_amount_minor
      and policy.maximum_amount_minor = authority.maximum_amount_minor
      and policy.freshness_window_seconds = authority.freshness_window_seconds
      and policy.minimum_amount_minor = 2500
      and policy.maximum_amount_minor = 2500000
      and policy.freshness_window_seconds = 3600
    for share of authority, owner_user, agent, platform, policy;
  if v_authority.id is null then
    raise exception 'The current routine Owner authorization is unavailable.';
  end if;

  select challenge.* into v_challenge
    from app.routine_telebirr_lookup_challenges challenge
    where challenge.challenge_id = p_challenge_id for share;
  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
    where candidate.id = v_staged.candidate_id for share;
  select receiver.* into v_receiver
    from app.receiver_accounts receiver
    where receiver.id = v_challenge.receiver_account_id for share;
  v_now := pg_catalog.clock_timestamp();

  if v_challenge.challenge_id is null or v_challenge.issuance_mode <> 'paid'
    or v_candidate.id is null or v_candidate.intake_mode <> 'paid'
    or v_candidate.provider_code <> 'telebirr'
    or v_candidate.origin_channel <> 'telegram'
    or v_candidate.reference_encryption_key_version <> 2
    or v_candidate.reference_profile_version <> 2
    or v_candidate.payment_provider_id <> v_staged.payment_provider_id
    or v_candidate.id <> v_challenge.candidate_id
    or v_candidate.candidate_reference_fingerprint <> v_staged.reference_fingerprint
    or v_candidate.candidate_reference_fingerprint <> v_challenge.candidate_reference_fingerprint
    or v_candidate.submitted_at <> v_challenge.candidate_submitted_at
    or v_candidate.receiver_account_id <> v_challenge.receiver_account_id
    or v_candidate.receiver_account_version <> v_challenge.receiver_account_version
    or v_candidate.submitted_at < v_authority.authorized_at
    or v_candidate.submitted_at > v_now
    or not exists (
      select 1 from app.inbound_events inbound_event
      join app.customer_identities identity
        on identity.id = inbound_event.customer_identity_id
      join app.customers customer on customer.id = identity.customer_id
      where inbound_event.id = v_candidate.origin_request_key
        and inbound_event.channel = 'telegram'
        and inbound_event.customer_identity_id = v_candidate.origin_identity_id
        and inbound_event.processed_at = v_candidate.submitted_at
        and identity.customer_id = v_candidate.submitting_customer_id
        and identity.status = 'active' and customer.status = 'active')
    or v_challenge.issued_at < v_authority.authorized_at
    or v_challenge.source_profile <> 'telebirr_official_receipt_v1'
    or v_challenge.issued_at > v_staged.observed_at
    or v_staged.observed_at >= v_challenge.expires_at
    or v_staged.recorded_at < v_staged.observed_at - interval '5 minutes'
    or v_staged.recorded_at > v_now + interval '5 seconds'
    or v_staged.occurred_at < v_authority.authorized_at
    or v_staged.occurred_at < v_candidate.submitted_at - interval '1 hour'
    or v_staged.occurred_at > v_candidate.submitted_at + interval '5 minutes'
    or v_now >= v_staged.occurred_at + interval '1 hour'
    or v_receiver.id is null or v_receiver.provider_id <> v_candidate.payment_provider_id
    or v_receiver.version <> v_candidate.receiver_account_version
    or v_receiver.status <> 'active' or v_receiver.retired_at is not null
    or v_receiver.active_from > v_staged.occurred_at
    or app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name)
       is distinct from v_challenge.expected_receiver_name_digest
    or app.routine_telebirr_receiver_profile_digest(
       v_receiver.id, v_receiver.version, v_receiver.account_reference_fingerprint,
       v_receiver.account_holder_name) is distinct from v_challenge.receiver_profile_digest
    or not exists (
      select 1 from app.routine_telebirr_device_enrollments enrollment
      where enrollment.id = v_challenge.device_enrollment_id
        and enrollment.device_id = v_challenge.device_id
        and enrollment.device_key_id = v_challenge.device_key_id
        and enrollment.device_public_key_spki_sha256 =
          v_challenge.device_public_key_spki_sha256
        and enrollment.receiver_account_id = v_receiver.id
        and enrollment.receiver_account_version = v_receiver.version
        and enrollment.receiver_profile_digest = v_challenge.receiver_profile_digest
        and enrollment.expected_receiver_name_digest =
          v_challenge.expected_receiver_name_digest
        and enrollment.valid_from <= v_staged.observed_at
        and enrollment.valid_until > v_staged.observed_at
        and enrollment.valid_until > v_now
        and not exists (
          select 1 from app.routine_telebirr_device_enrollment_revocations revocation
          where revocation.enrollment_id = enrollment.id))
    or not exists (
      select 1 from app.routine_telebirr_lookup_signers signer
      where signer.id = v_challenge.assignment_signer_id
        and signer.valid_from <= v_challenge.issued_at
        and signer.valid_until > v_staged.observed_at
        and signer.valid_until > v_now
        and not exists (
          select 1 from app.routine_telebirr_lookup_signer_revocations revocation
          where revocation.signer_id = signer.id))
    or v_staged.amount_minor not between 2500 and 2500000 then
    raise exception 'The paid phone observation is not eligible for settlement.';
  end if;

  -- Recheck the exact normalized receipt facts from the immutable staged body.
  -- The paid bridge verified the enrolled phone signature, but the current
  -- observation protocol is review-only and has not independently authenticated
  -- the receipt source. Keep this producer ungranted until that separate source
  -- boundary and its runtime caller are reviewed.
  if v_staged.signed_observation ->> 'bodyDigest' is distinct from v_staged.observation_body_digest
    or v_staged.signed_observation #>> '{body,challengeId}' is distinct from p_challenge_id::text
    or v_staged.signed_observation #>> '{body,challengeDigest}' is distinct from
       v_challenge.challenge_digest
    or v_staged.signed_observation #>> '{body,candidateId}' is distinct from v_candidate.id::text
    or v_staged.signed_observation #>> '{body,referenceFingerprint}' is distinct from
       v_staged.reference_fingerprint
    or v_staged.signed_observation #>> '{body,receiverRevisionId}' is distinct from
       v_receiver.id::text
    or v_staged.signed_observation #>> '{body,receiverVersion}' is distinct from
       v_receiver.version::text
    or v_staged.signed_observation #>> '{body,receiverProfileDigest}' is distinct from
       v_challenge.receiver_profile_digest
    or v_staged.signed_observation #>> '{body,expectedReceiverNameDigest}' is distinct from
       v_challenge.expected_receiver_name_digest
    or v_staged.signed_observation #>> '{body,deviceId}' is distinct from
       v_challenge.device_id
    or v_staged.signed_observation #>> '{body,keyId}' is distinct from
       v_challenge.device_key_id
    or v_staged.signed_observation #>> '{body,sourceDocumentDigest}' is distinct from
       v_staged.source_document_digest
    or v_staged.signed_observation #>> '{body,facts,sourceProfile}' is distinct from
       'telebirr_official_receipt_v1'
    or v_staged.signed_observation #>> '{body,facts,evidenceSource}' is distinct from
       'provider_receipt_lookup'
    or v_staged.signed_observation #>> '{body,facts,providerFinalStatus}' is distinct from 'completed'
    or v_staged.signed_observation #>> '{body,facts,providerIdentity}' is distinct from 'matched'
    or v_staged.signed_observation #>> '{body,facts,canonicalReferencePresent}' is distinct from 'true'
    or v_staged.signed_observation #>> '{body,facts,referenceMatch}' is distinct from 'matched'
    or v_staged.signed_observation #>> '{body,facts,receiverMatch}' is distinct from 'matched'
    or v_staged.signed_observation #>> '{body,facts,creditedPartyNameDigest}' is distinct from
       v_challenge.expected_receiver_name_digest
    or v_staged.signed_observation #>> '{body,facts,currencyCode}' is distinct from 'ETB'
    or v_staged.signed_observation #>> '{body,facts,amountMinor}' is distinct from
       v_staged.amount_minor::text
    or v_staged.signed_observation #>> '{body,facts,paymentMode}' is distinct from 'telebirr'
    or v_staged.signed_observation #>> '{body,facts,paymentReason}' is distinct from
       'send_money_to_registered_customer'
    or v_staged.signed_observation #>> '{body,facts,paymentChannel}' is distinct from 'api_app'
    or v_staged.signed_observation #>> '{body,observedAt}' is distinct from
       pg_catalog.to_char(v_staged.observed_at at time zone 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or v_staged.signed_observation #>> '{body,facts,occurredAt}' is distinct from
       pg_catalog.to_char(v_staged.occurred_at at time zone 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or v_staged.signed_observation::text ~ '"rawReference"' then
    raise exception 'The paid receipt facts are not exact.';
  end if;
  if coalesce(v_staged.signed_observation #>> '{body,facts,retrievedAt}', '')
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
    raise exception 'The paid receipt retrieval time is invalid.';
  end if;
  v_retrieved_at := (v_staged.signed_observation #>> '{body,facts,retrievedAt}')::timestamptz;
  if v_retrieved_at < v_staged.occurred_at
    or v_retrieved_at > v_staged.observed_at
    or v_retrieved_at > v_now + interval '5 seconds' then
    raise exception 'The paid receipt retrieval time is inconsistent.';
  end if;

  v_intent_id := pg_catalog.gen_random_uuid();
  insert into app.routine_telebirr_paid_intent_openings (
    challenge_id, candidate_id, deposit_intent_id, authorization_id,
    player_account_id, payment_provider_id, receiver_account_id,
    receiver_account_version, reference_fingerprint, observation_body_digest,
    source_document_digest, submitted_at, challenge_issued_at, observed_at,
    occurred_at, amount_minor
  ) values (
    p_challenge_id, v_candidate.id, v_intent_id, v_authority.id,
    v_candidate.player_account_id, v_candidate.payment_provider_id,
    v_receiver.id, v_receiver.version, v_staged.reference_fingerprint,
    v_staged.observation_body_digest, v_staged.source_document_digest,
    v_candidate.submitted_at, v_challenge.issued_at, v_staged.observed_at,
    v_staged.occurred_at, v_staged.amount_minor
  );

  insert into app.deposit_intents (
    id, customer_id, platform_id, player_account_id, payment_provider_id,
    receiver_account_id, expected_amount_minor,
    routine_telebirr_paid_opening_challenge_id
  ) values (
    v_intent_id, v_candidate.submitting_customer_id, v_candidate.platform_id,
    v_candidate.player_account_id, v_candidate.payment_provider_id,
    v_receiver.id, v_staged.amount_minor, p_challenge_id
  );
  update app.deposit_intents set status = 'verification_pending'
    where id = v_intent_id and status = 'intake_received';
  if not found then raise exception 'The paid intent did not enter verification.'; end if;

  insert into app.deposit_submissions (
    deposit_intent_id, submission_number, submitted_reference_ciphertext,
    submitted_reference_fingerprint, submitted_reference_masked,
    reference_encryption_key_version, submitted_at, created_at
  ) values (
    v_intent_id, 1, v_candidate.candidate_reference_ciphertext,
    v_candidate.candidate_reference_fingerprint, v_candidate.candidate_reference_masked,
    v_candidate.reference_encryption_key_version, v_candidate.submitted_at,
    v_candidate.submitted_at
  ) returning id into v_submission_id;
  update app.deposit_submissions set status = 'verification_enqueued'
    where id = v_submission_id and status = 'received';
  if not found then raise exception 'The paid submission did not enter verification.'; end if;

  insert into app.provider_payment_evidence (
    payment_provider_id, canonical_reference_ciphertext,
    canonical_reference_fingerprint, canonical_reference_masked,
    reference_encryption_key_version, evidence_source, provider_final_status,
    amount_minor, currency_code, occurred_at, matched_receiver_account_id,
    matched_receiver_account_version, evidence_digest, adapter_version,
    normalization_version, retrieved_at
  ) values (
    v_candidate.payment_provider_id, v_candidate.candidate_reference_ciphertext,
    v_staged.reference_fingerprint, v_candidate.candidate_reference_masked,
    v_candidate.reference_encryption_key_version, 'provider_receipt_lookup',
    'completed', v_staged.amount_minor, 'ETB', v_staged.occurred_at,
    v_receiver.id, v_receiver.version, v_staged.source_document_digest,
    'telebirr-routine-paid-phone-v1', 'telebirr-routine-receipt-v1', v_retrieved_at
  ) returning id into v_evidence_id;

  insert into app.deposit_verification_attempts (
    deposit_intent_id, deposit_submission_id, attempt_number, outcome,
    provider_payment_evidence_id, adapter_version, response_digest,
    started_at, completed_at
  ) values (
    v_intent_id, v_submission_id, 1, 'verified', v_evidence_id,
    'telebirr-routine-paid-phone-v1', v_staged.observation_body_digest,
    v_challenge.issued_at, v_staged.observed_at
  ) returning id into v_attempt_id;

  select settled.* into v_settled
    from app.finalize_verified_deposit_and_enqueue_execution(
      v_intent_id, v_attempt_id, v_evidence_id) settled;
  if v_settled.deposit_intent_id is distinct from v_intent_id
    or v_settled.payment_claim_id is null or v_settled.execution_job_id is null
    or v_settled.deposit_status <> 'execution_pending'
    or v_settled.execution_job_status <> 'queued'
    or v_settled.already_finalized is not false then
    raise exception 'The paid claim-to-execution transaction is incomplete.';
  end if;
  v_claim_id := v_settled.payment_claim_id;
  v_job_id := v_settled.execution_job_id;

  insert into app.routine_telebirr_paid_observation_lineages (
    challenge_id, candidate_id, payment_provider_id, reference_fingerprint,
    observation_body_digest, source_document_digest, signed_observation,
    submitted_at, challenge_issued_at, observed_at, occurred_at, amount_minor,
    provider_payment_evidence_id, deposit_intent_id, deposit_submission_id,
    deposit_payment_claim_id, execution_job_id
  ) values (
    p_challenge_id, v_candidate.id, v_candidate.payment_provider_id,
    v_staged.reference_fingerprint, v_staged.observation_body_digest,
    v_staged.source_document_digest, v_staged.signed_observation,
    v_candidate.submitted_at, v_challenge.issued_at, v_staged.observed_at,
    v_staged.occurred_at, v_staged.amount_minor, v_evidence_id, v_intent_id,
    v_submission_id, v_claim_id, v_job_id
  );
  if app.admit_routine_telebirr_execution_job(v_job_id) is distinct from v_job_id then
    raise exception 'The routine paid job admission is incomplete.';
  end if;
  return query select v_intent_id, v_claim_id, v_job_id, false;
end;
$$;

alter function app.finalize_routine_telebirr_paid_observation(uuid) owner to postgres;
revoke all on function app.finalize_routine_telebirr_paid_observation(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_paid_poll,
    fetanagent_routine_telebirr_paid_poll_runtime,
    fetanagent_routine_deposit_broker,
    fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor,
    fetanagent_deposit_executor_runtime,
    fetanagent_trusted_telebirr_verifier,
    fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_verification_settlement,
    fetanagent_verification_settlement_runtime;
comment on function app.finalize_routine_telebirr_paid_observation(uuid) is
  'Dormant postgres-only atomic signed-phone paid claim/queue producer. No runtime grant, login, live switch, or execution activation.';
commit;
