-- Signed, twice-read official invalid-reference pages can close a paid candidate quickly.
-- Unknown layouts and transport errors remain review-only. No Player credit is issued here.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check check (outcome_code in (
    'checking', 'verified_waiting', 'credited', 'rejected',
    'not_credited', 'not_verified', 'already_used', 'wrong_receiver', 'invalid_reference'
  ));

alter table app.routine_telebirr_paid_terminal_rejections
  drop constraint routine_telebirr_paid_terminal_rejections_reason_code_check;
alter table app.routine_telebirr_paid_terminal_rejections
  add constraint routine_telebirr_paid_terminal_rejections_reason_code_check
  check (reason_code in ('receiver_mismatch', 'explicit_invalid_reference'));
alter table app.routine_telebirr_paid_terminal_rejections
  drop constraint routine_paid_terminal_signed_shape;
alter table app.routine_telebirr_paid_terminal_rejections
  add constraint routine_paid_terminal_signed_shape check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.octet_length(signed_observation::text) <= 16384
    and signed_observation ->> 'bodyDigest' = observation_body_digest
    and signed_observation #>> '{body,sourceDocumentDigest}' = source_document_digest
    and signed_observation #>> '{body,candidateId}' = candidate_id::text
    and signed_observation #>> '{body,challengeId}' = challenge_id::text
    and signed_observation #>> '{body,facts,sourceOriginAttestation}' = 'official_tls_origin'
    and signed_observation #>> '{body,facts,sourceProfile}' = 'telebirr_official_receipt_v1'
    and signed_observation::text !~ '"rawReference"'
    and (
      (reason_code = 'receiver_mismatch'
        and signed_observation #>> '{body,facts,referenceMatch}' = 'matched'
        and signed_observation #>> '{body,facts,receiverMatch}' = 'mismatched')
      or (reason_code = 'explicit_invalid_reference'
        and source_document_digest =
          'sha256:91afbccab306bb594b924b41b38a065c02e39e8ef89f97c2edd21b1b1006b3b2'
        and signed_observation #>> '{body,facts,amountMinor}' = '0'
        and signed_observation #>> '{body,facts,canonicalReferencePresent}' = 'false'
        and signed_observation #>> '{body,facts,creditedPartyNameDigest}' =
          'sha256:0000000000000000000000000000000000000000000000000000000000000000'
        and signed_observation #>> '{body,facts,currencyCode}' = 'unknown'
        and signed_observation #>> '{body,facts,evidenceSource}' = 'provider_receipt_lookup'
        and signed_observation #>> '{body,facts,occurredAt}' =
          signed_observation #>> '{body,facts,retrievedAt}'
        and signed_observation #>> '{body,facts,retrievedAt}' =
          signed_observation #>> '{body,observedAt}'
        and signed_observation #>> '{body,facts,paymentChannel}' = 'unknown'
        and signed_observation #>> '{body,facts,paymentMode}' = 'unknown'
        and signed_observation #>> '{body,facts,paymentReason}' = 'unknown'
        and signed_observation #>> '{body,facts,providerFinalStatus}' = 'unknown'
        and signed_observation #>> '{body,facts,providerIdentity}' = 'matched'
        and signed_observation #>> '{body,facts,receiverMatch}' = 'unknown'
        and signed_observation #>> '{body,facts,referenceMatch}' = 'unknown')
    )
  );

-- The old function has the correct root-only grant. Rename it in place so the
-- guarded runtime keeps exactly the same six reachable SQL entry points.
alter function app.record_routine_telebirr_paid_wrong_receiver(uuid,jsonb)
  rename to record_routine_telebirr_paid_terminal_result;

create or replace function app.record_routine_telebirr_paid_terminal_result(
  p_challenge_id uuid, p_signed_observation jsonb
) returns text language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_challenge app.routine_telebirr_lookup_challenges%rowtype;
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_existing app.routine_telebirr_paid_terminal_rejections%rowtype;
  v_chat_id bigint;
  v_cutover timestamptz;
  v_now timestamptz;
  v_reason text;
  v_observed_at timestamptz;
  v_retrieved_at timestamptz;
  v_switch_count integer;
  v_live_count integer;
begin
  if not app.routine_telebirr_paid_poll_session_allowed()
    or p_challenge_id is null or p_signed_observation is null
    or pg_catalog.jsonb_typeof(p_signed_observation) <> 'object'
    or pg_catalog.octet_length(p_signed_observation::text) > 16384 then
    raise exception using errcode = '42501',
      message = 'The routine paid receipt result is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  perform 1 from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine paid boundary is unavailable.'; end if;
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
    raise exception 'The routine paid upload is stopped.';
  end if;
  v_now := pg_catalog.clock_timestamp();
  select challenge.* into v_challenge
    from app.routine_telebirr_lookup_challenges challenge
   where challenge.challenge_id = p_challenge_id for share;
  if v_challenge.challenge_id is null or v_challenge.issuance_mode <> 'paid' then
    return 'conflict';
  end if;
  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.id = v_challenge.candidate_id for share;
  if v_candidate.id is null or v_candidate.intake_mode <> 'paid'
    or v_candidate.origin_channel <> 'telegram' or v_candidate.provider_code <> 'telebirr'
    or v_candidate.submitted_at <> v_challenge.candidate_submitted_at
    or v_candidate.candidate_reference_fingerprint <>
       v_challenge.candidate_reference_fingerprint
    or v_candidate.submitted_at + interval '1 hour' <= v_now
    or v_challenge.expires_at + interval '15 minutes' <= v_now
    or not exists (select 1 from app.routine_telebirr_device_enrollments enrollment
       where enrollment.id = v_challenge.device_enrollment_id
         and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
         and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
           where revoked.enrollment_id = enrollment.id))
    or not exists (select 1 from app.routine_telebirr_lookup_signers signer
       where signer.id = v_challenge.assignment_signer_id
         and signer.valid_from <= v_now and signer.valid_until > v_now
         and not exists (select 1 from app.routine_telebirr_lookup_signer_revocations revoked
           where revoked.signer_id = signer.id))
    or exists (select 1 from app.routine_telebirr_paid_intent_openings opening
       where opening.candidate_id = v_candidate.id)
    or exists (select 1 from app.routine_telebirr_paid_observation_staging staged
       where staged.candidate_id = v_candidate.id) then
    return 'conflict';
  end if;

  select terminal.* into v_existing
    from app.routine_telebirr_paid_terminal_rejections terminal
   where terminal.candidate_id = v_candidate.id for share;
  if v_existing.candidate_id is not null then
    return case when v_existing.challenge_id = p_challenge_id
      and v_existing.signed_observation = p_signed_observation
      then 'exact_replay' else 'conflict' end;
  end if;

  -- The bridge has verified both signatures against the protected assignment
  -- and enrollment. The narrow SQL role still rechecks the immutable bindings.
  if p_signed_observation ->> 'contractVersion' is distinct from '2'
    or p_signed_observation ->> 'providerCode' is distinct from 'telebirr'
    or p_signed_observation ->> 'protocolMode' is distinct from 'routine_signed_observation_v2'
    or p_signed_observation ->> 'transcriptVersion' is distinct from
       'telebirr-routine-observation-transcript-v2'
    or coalesce(p_signed_observation ->> 'bodyDigest', '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_signed_observation ->> 'signature', '') !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_observation #>> '{body,challengeId}' is distinct from p_challenge_id::text
    or p_signed_observation #>> '{body,challengeDigest}' is distinct from
       v_challenge.challenge_digest
    or p_signed_observation #>> '{body,candidateId}' is distinct from v_candidate.id::text
    or p_signed_observation #>> '{body,referenceFingerprint}' is distinct from
       v_challenge.candidate_reference_fingerprint
    or p_signed_observation #>> '{body,receiverRevisionId}' is distinct from
       v_challenge.receiver_account_id::text
    or p_signed_observation #>> '{body,receiverVersion}' is distinct from
       v_challenge.receiver_account_version::text
    or p_signed_observation #>> '{body,receiverProfileDigest}' is distinct from
       v_challenge.receiver_profile_digest
    or p_signed_observation #>> '{body,expectedReceiverNameDigest}' is distinct from
       v_challenge.expected_receiver_name_digest
    or p_signed_observation #>> '{body,deviceId}' is distinct from v_challenge.device_id
    or p_signed_observation #>> '{body,keyId}' is distinct from v_challenge.device_key_id
    or coalesce(p_signed_observation #>> '{body,sourceDocumentDigest}', '')
       !~ '^sha256:[0-9a-f]{64}$'
    or p_signed_observation #>> '{body,facts,sourceOriginAttestation}' is distinct from
       'official_tls_origin'
    or p_signed_observation #>> '{body,facts,sourceProfile}' is distinct from
       'telebirr_official_receipt_v1'
    or coalesce(p_signed_observation #>> '{body,observedAt}', '') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or coalesce(p_signed_observation #>> '{body,facts,retrievedAt}', '') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or p_signed_observation::text ~ '"rawReference"' then
    return 'conflict';
  end if;
  -- The signed V2 observation is either an actual completed receipt naming a different
  -- receiver, or the exact, twice-read official error page containing no receipt at all.
  -- Never infer invalidity from a 404, network error, unknown layout, or missing fields.
  if p_signed_observation #>> '{body,facts,providerFinalStatus}' = 'completed'
    and p_signed_observation #>> '{body,facts,canonicalReferencePresent}' = 'true'
    and p_signed_observation #>> '{body,facts,referenceMatch}' = 'matched'
    and p_signed_observation #>> '{body,facts,receiverMatch}' = 'mismatched'
    and p_signed_observation #>> '{body,facts,creditedPartyNameDigest}' is distinct from
      v_challenge.expected_receiver_name_digest then
    v_reason := 'receiver_mismatch';
  elsif p_signed_observation #>> '{body,sourceDocumentDigest}' =
      'sha256:91afbccab306bb594b924b41b38a065c02e39e8ef89f97c2edd21b1b1006b3b2'
    and p_signed_observation #>> '{body,facts,amountMinor}' = '0'
    and p_signed_observation #>> '{body,facts,canonicalReferencePresent}' = 'false'
    and p_signed_observation #>> '{body,facts,creditedPartyNameDigest}' =
      'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    and p_signed_observation #>> '{body,facts,currencyCode}' = 'unknown'
    and p_signed_observation #>> '{body,facts,evidenceSource}' = 'provider_receipt_lookup'
    and p_signed_observation #>> '{body,facts,occurredAt}' =
      p_signed_observation #>> '{body,facts,retrievedAt}'
    and p_signed_observation #>> '{body,facts,retrievedAt}' =
      p_signed_observation #>> '{body,observedAt}'
    and p_signed_observation #>> '{body,facts,paymentChannel}' = 'unknown'
    and p_signed_observation #>> '{body,facts,paymentMode}' = 'unknown'
    and p_signed_observation #>> '{body,facts,paymentReason}' = 'unknown'
    and p_signed_observation #>> '{body,facts,providerFinalStatus}' = 'unknown'
    and p_signed_observation #>> '{body,facts,providerIdentity}' = 'matched'
    and p_signed_observation #>> '{body,facts,receiverMatch}' = 'unknown'
    and p_signed_observation #>> '{body,facts,referenceMatch}' = 'unknown' then
    v_reason := 'explicit_invalid_reference';
  else
    return 'conflict';
  end if;
  v_observed_at := (p_signed_observation #>> '{body,observedAt}')::timestamptz;
  v_retrieved_at := (p_signed_observation #>> '{body,facts,retrievedAt}')::timestamptz;
  if v_observed_at < v_challenge.issued_at or v_observed_at >= v_challenge.expires_at
    or v_observed_at > v_now + interval '5 seconds'
    or v_observed_at + interval '15 minutes' <= v_now
    or v_retrieved_at > v_observed_at
    or v_retrieved_at < v_challenge.issued_at then return 'conflict'; end if;

  select cutover.enabled_at into v_cutover
    from app.telegram_deposit_outcome_cutover cutover where cutover.singleton = true;
  select telegram_identity.private_chat_id into v_chat_id
    from app.telegram_identities telegram_identity
    join app.inbound_events inbound_event
      on inbound_event.customer_identity_id = telegram_identity.customer_identity_id
     and inbound_event.id = v_candidate.origin_request_key
     and inbound_event.channel = 'telegram'
   where telegram_identity.customer_identity_id = v_candidate.origin_identity_id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id;
  if v_cutover is null or v_candidate.submitted_at < v_cutover or v_chat_id is null
    or exists (select 1 from app.telegram_deposit_outcome_deliveries delivery
       where delivery.candidate_id = v_candidate.id and delivery.notification_stage = 'final')
    then return 'conflict'; end if;

  insert into app.routine_telebirr_paid_terminal_rejections (
    candidate_id, challenge_id, submitted_at, reason_code, observation_body_digest,
    source_document_digest, signed_observation, observed_at, recorded_at
  ) values (
    v_candidate.id, p_challenge_id, v_candidate.submitted_at, v_reason,
    p_signed_observation ->> 'bodyDigest',
    p_signed_observation #>> '{body,sourceDocumentDigest}',
    p_signed_observation, v_observed_at, v_now
  );
  insert into app.telegram_deposit_outcome_deliveries (
    candidate_id, notification_stage, private_chat_id, reference_masked,
    outcome_code, amount_minor, next_attempt_at, created_at, updated_at
  ) values (
    v_candidate.id, 'final', v_chat_id, v_candidate.candidate_reference_masked,
    case when v_reason = 'explicit_invalid_reference' then 'invalid_reference'
      else 'wrong_receiver' end, null, v_now, v_now, v_now
  );
  return 'recorded';
end;
$$;
comment on function app.record_routine_telebirr_paid_terminal_result(uuid,jsonb) is
  'Root-guarded signed paid-phone terminal rejection for wrong receiver or exact official invalid page; no payment action.';
comment on table app.routine_telebirr_paid_terminal_rejections is
  'Immutable signed official-origin terminal negatives; no claim or Player credit.';
commit;
