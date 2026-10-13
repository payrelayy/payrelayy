-- A paired phone's signed, official-origin receipt for the submitted reference
-- can conclusively show a different receiver. Persist that fact before retiring
-- the sealed upload and enqueue one final Telegram rejection, without a claim.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check
  check (outcome_code in (
    'checking', 'verified_waiting', 'credited', 'rejected',
    'not_credited', 'not_verified', 'already_used', 'wrong_receiver'
  ));

create table app.routine_telebirr_paid_terminal_rejections (
  candidate_id uuid primary key references app.routine_telebirr_untrusted_proof_requests(id)
    on delete cascade,
  challenge_id uuid not null unique references app.routine_telebirr_lookup_challenges(challenge_id)
    on delete cascade,
  submitted_at timestamptz not null,
  reason_code text not null check (reason_code = 'receiver_mismatch'),
  observation_body_digest text not null check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_document_digest text not null check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_observation jsonb not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_paid_terminal_signed_shape check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.octet_length(signed_observation::text) <= 16384
    and signed_observation ->> 'bodyDigest' = observation_body_digest
    and signed_observation #>> '{body,sourceDocumentDigest}' = source_document_digest
    and signed_observation #>> '{body,candidateId}' = candidate_id::text
    and signed_observation #>> '{body,challengeId}' = challenge_id::text
    and signed_observation #>> '{body,facts,sourceOriginAttestation}' = 'official_tls_origin'
    and signed_observation #>> '{body,facts,referenceMatch}' = 'matched'
    and signed_observation #>> '{body,facts,receiverMatch}' = 'mismatched'
    and signed_observation::text !~ '"rawReference"'
  )
);
create trigger routine_paid_terminal_rejection_immutable
before update or delete on app.routine_telebirr_paid_terminal_rejections
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
alter table app.routine_telebirr_paid_terminal_rejections owner to postgres;
alter table app.routine_telebirr_paid_terminal_rejections enable row level security;
alter table app.routine_telebirr_paid_terminal_rejections force row level security;
revoke all on table app.routine_telebirr_paid_terminal_rejections
  from public, anon, authenticated, service_role,
       fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime;

create function app.record_routine_telebirr_paid_wrong_receiver(
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
    or p_signed_observation #>> '{body,facts,providerFinalStatus}' is distinct from 'completed'
    or p_signed_observation #>> '{body,facts,providerIdentity}' is distinct from 'matched'
    or p_signed_observation #>> '{body,facts,canonicalReferencePresent}' is distinct from 'true'
    or p_signed_observation #>> '{body,facts,referenceMatch}' is distinct from 'matched'
    or p_signed_observation #>> '{body,facts,receiverMatch}' is distinct from 'mismatched'
    or p_signed_observation #>> '{body,facts,creditedPartyNameDigest}' is not distinct from
       v_challenge.expected_receiver_name_digest
    or coalesce(p_signed_observation #>> '{body,observedAt}', '') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or coalesce(p_signed_observation #>> '{body,facts,retrievedAt}', '') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or p_signed_observation::text ~ '"rawReference"' then
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
    v_candidate.id, p_challenge_id, v_candidate.submitted_at, 'receiver_mismatch',
    p_signed_observation ->> 'bodyDigest',
    p_signed_observation #>> '{body,sourceDocumentDigest}',
    p_signed_observation, v_observed_at, v_now
  );
  insert into app.telegram_deposit_outcome_deliveries (
    candidate_id, notification_stage, private_chat_id, reference_masked,
    outcome_code, amount_minor, next_attempt_at, created_at, updated_at
  ) values (
    v_candidate.id, 'final', v_chat_id, v_candidate.candidate_reference_masked,
    'wrong_receiver', null, v_now, v_now, v_now
  );
  return 'recorded';
end;
$$;
alter function app.record_routine_telebirr_paid_wrong_receiver(uuid,jsonb) owner to postgres;
revoke all on function app.record_routine_telebirr_paid_wrong_receiver(uuid,jsonb)
  from public, anon, authenticated, service_role,
       fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;
grant execute on function app.record_routine_telebirr_paid_wrong_receiver(uuid,jsonb)
  to fetanagent_routine_telebirr_paid_poll;

-- A final negative result must not be assigned to another phone lane.
do $migration$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'::pg_catalog.regprocedure
  ) into v_source;
  v_old := '     and not app.routine_telebirr_same_customer_credited_reference(candidate.id)';
  v_new := v_old || E'\n     and not exists (select 1 from app.routine_telebirr_paid_terminal_rejections terminal'
    || E'\n       where terminal.candidate_id = candidate.id)';
  if v_source is null or pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
     <> pg_catalog.length(v_old) then raise exception 'Paid poll issuer drifted.'; end if;
  execute pg_catalog.replace(v_source,v_old,v_new);

  select pg_catalog.pg_get_functiondef(
    'app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)'::pg_catalog.regprocedure
  ) into v_source;
  v_old := '    or app.routine_telebirr_same_customer_credited_reference(v_candidate.id) then';
  v_new := '    or app.routine_telebirr_same_customer_credited_reference(v_candidate.id)'
    || E'\n    or exists (select 1 from app.routine_telebirr_paid_terminal_rejections terminal'
    || E'\n      where terminal.candidate_id = v_candidate.id) then';
  if v_source is null or pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
     <> pg_catalog.length(v_old) then raise exception 'Paid challenge issuer drifted.'; end if;
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$migration$;

comment on table app.routine_telebirr_paid_terminal_rejections is
  'Immutable signed official-origin wrong-receiver outcomes for paid TeleBirr; no claim or Player credit.';
comment on function app.record_routine_telebirr_paid_wrong_receiver(uuid,jsonb) is
  'Narrow paid-phone wrong-receiver result and final Telegram rejection; no payment mutation.';
commit;
