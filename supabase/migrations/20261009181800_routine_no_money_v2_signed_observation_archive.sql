-- The phone now signs official-origin receipts with the v2 transcript. Permit
-- that exact envelope in the no-money archive while retaining v1 compatibility.
-- This only stores signed evidence: the existing seven-switch-off digest stage
-- and replay lock remain the sole path to insertion.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create or replace function app.stage_routine_telebirr_no_money_signed_observation(
  p_challenge_id uuid, p_assignment_body_digest text,
  p_observation_body_digest text, p_observation_signature_digest text,
  p_replay_identity text, p_signed_observation jsonb, p_server_policy_result text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_challenge app.routine_telebirr_lookup_challenges%rowtype;
  v_existing app.routine_telebirr_signed_observation_payloads%rowtype;
  v_digest_status text;
  v_inserted integer;
begin
  if not app.routine_telebirr_no_money_session_allowed()
    or p_challenge_id is null or p_signed_observation is null
    or pg_catalog.jsonb_typeof(p_signed_observation) <> 'object'
    or pg_catalog.octet_length(p_signed_observation::text) > 16384
    or p_server_policy_result not in (
      'signed_evidence_matches_policy', 'receipt_policy_review'
    ) then
    raise exception using errcode = '42501',
      message = 'The routine signed observation is unavailable.';
  end if;

  select challenge.* into v_challenge
    from app.routine_telebirr_lookup_challenges challenge
   where challenge.challenge_id = p_challenge_id for share;
  if v_challenge.challenge_id is null
    or pg_catalog.clock_timestamp() < v_challenge.issued_at
    or pg_catalog.clock_timestamp() >= v_challenge.expires_at
    or p_signed_observation ->> 'bodyDigest' is distinct from p_observation_body_digest
    or p_signed_observation #>> '{body,challengeId}' is distinct from p_challenge_id::text
    or p_signed_observation #>> '{body,challengeDigest}'
         is distinct from v_challenge.challenge_digest
    or p_signed_observation #>> '{body,candidateId}'
         is distinct from v_challenge.candidate_id::text
    or p_signed_observation #>> '{body,referenceFingerprint}'
         is distinct from v_challenge.candidate_reference_fingerprint
    or p_signed_observation #>> '{body,receiverRevisionId}'
         is distinct from v_challenge.receiver_account_id::text
    or p_signed_observation #>> '{body,receiverVersion}'
         is distinct from v_challenge.receiver_account_version::text
    or p_signed_observation #>> '{body,receiverProfileDigest}'
         is distinct from v_challenge.receiver_profile_digest
    or p_signed_observation #>> '{body,expectedReceiverNameDigest}'
         is distinct from v_challenge.expected_receiver_name_digest
    or p_signed_observation #>> '{body,deviceId}'
         is distinct from v_challenge.device_id
    or p_signed_observation #>> '{body,keyId}'
         is distinct from v_challenge.device_key_id
    or p_signed_observation ->> 'providerCode' is distinct from 'telebirr'
    or p_signed_observation #>> '{body,providerCode}' is distinct from 'telebirr'
    or not coalesce((
      (
        p_signed_observation ->> 'contractVersion' = '1'
        and p_signed_observation ->> 'protocolMode' = 'routine_signed_observation_v1'
        and p_signed_observation ->> 'transcriptVersion' = 'telebirr-routine-observation-transcript-v1'
        and p_signed_observation #>> '{body,contractVersion}' = '1'
        and p_signed_observation #>> '{body,protocolMode}' = 'routine_signed_observation_v1'
        and p_signed_observation #>> '{body,facts,sourceOriginAttestation}' is null
      ) or (
        p_signed_observation ->> 'contractVersion' = '2'
        and p_signed_observation ->> 'protocolMode' = 'routine_signed_observation_v2'
        and p_signed_observation ->> 'transcriptVersion' = 'telebirr-routine-observation-transcript-v2'
        and p_signed_observation #>> '{body,contractVersion}' = '2'
        and p_signed_observation #>> '{body,protocolMode}' = 'routine_signed_observation_v2'
        and p_signed_observation #>> '{body,facts,sourceOriginAttestation}' = 'official_tls_origin'
      )
    ), false)
    or coalesce(p_signed_observation #>> '{body,sourceDocumentDigest}', '')
         !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_signed_observation #>> '{body,normalizedFactsDigest}', '')
         !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_signed_observation ->> 'signature', '')
         !~ '^[A-Za-z0-9_-]{86}$'
    or 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(
         pg_catalog.translate(p_signed_observation ->> 'signature', '-_', '+/') || '==',
         'base64')), 'hex') is distinct from p_observation_signature_digest
    or p_signed_observation::text ~ '"rawReference"' then
    return 'conflict';
  end if;

  v_digest_status := app.stage_routine_telebirr_no_money_observation_digest(
    p_challenge_id, p_assignment_body_digest, p_observation_body_digest,
    p_observation_signature_digest, p_replay_identity
  );
  if v_digest_status = 'conflict' then return 'conflict'; end if;
  if v_digest_status not in ('recorded', 'exact_replay') then
    raise exception 'The routine observation digest state is invalid.';
  end if;

  insert into app.routine_telebirr_signed_observation_payloads (
    challenge_id, observation_body_digest, replay_identity,
    signed_observation, server_policy_result
  ) values (
    p_challenge_id, p_observation_body_digest, p_replay_identity,
    p_signed_observation, p_server_policy_result
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then return 'recorded'; end if;

  select payload.* into v_existing
    from app.routine_telebirr_signed_observation_payloads payload
   where payload.challenge_id = p_challenge_id for share;
  if v_existing.challenge_id = p_challenge_id
    and v_existing.observation_body_digest = p_observation_body_digest
    and v_existing.replay_identity = p_replay_identity
    and v_existing.signed_observation = p_signed_observation
    and v_existing.server_policy_result = p_server_policy_result then
    return 'exact_replay';
  end if;
  raise exception 'The routine signed observation replay conflicts.';
end;
$$;

alter function app.stage_routine_telebirr_no_money_signed_observation(
  uuid, text, text, text, text, jsonb, text) owner to postgres;
revoke all on function app.stage_routine_telebirr_no_money_signed_observation(
  uuid, text, text, text, text, jsonb, text)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime;
grant execute on function app.stage_routine_telebirr_no_money_signed_observation(
  uuid, text, text, text, text, jsonb, text)
  to fetanagent_routine_telebirr_no_money;

comment on function app.stage_routine_telebirr_no_money_signed_observation(
  uuid, text, text, text, text, jsonb, text) is
  'No-money exact-replay archive for v1 and official-origin v2 signed observations after server-side signature and policy review. Financial switches must remain disabled; this function cannot credit a Player.';

commit;
