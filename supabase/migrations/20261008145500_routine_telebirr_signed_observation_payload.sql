-- Retain the exact signed phone observation behind the existing seven-day no-money
-- candidate boundary. The old digest receipt remains the replay lock; this payload
-- permits later independent signature/policy re-verification, not a payment claim.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.routine_telebirr_observation_receipts
  add constraint routine_telebirr_observation_exact_payload_key
    unique (challenge_id, observation_body_digest, replay_identity);

create table app.routine_telebirr_signed_observation_payloads (
  challenge_id uuid primary key,
  observation_body_digest text not null
    check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  replay_identity text not null
    check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  signed_observation jsonb not null
    check (pg_catalog.jsonb_typeof(signed_observation) = 'object'
      and pg_catalog.octet_length(signed_observation::text) <= 16384),
  server_policy_result text not null
    check (server_policy_result in (
      'signed_evidence_matches_policy', 'receipt_policy_review'
    )),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_telebirr_signed_payload_receipt_fkey
    foreign key (challenge_id, observation_body_digest, replay_identity)
    references app.routine_telebirr_observation_receipts
      (challenge_id, observation_body_digest, replay_identity)
    on delete cascade,
  constraint routine_telebirr_signed_payload_digest_check
    check (signed_observation ->> 'bodyDigest' = observation_body_digest
      and signed_observation #>> '{body,challengeId}' = challenge_id::text
      and signed_observation ? 'signature'
      and signed_observation ? 'body')
);

create trigger routine_telebirr_signed_payload_no_update
before update on app.routine_telebirr_signed_observation_payloads
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();

alter table app.routine_telebirr_signed_observation_payloads owner to postgres;
alter table app.routine_telebirr_signed_observation_payloads enable row level security;
alter table app.routine_telebirr_signed_observation_payloads force row level security;
revoke all on table app.routine_telebirr_signed_observation_payloads
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime;

create function app.stage_routine_telebirr_no_money_signed_observation(
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
    or p_signed_observation ->> 'protocolMode'
         is distinct from 'routine_signed_observation_v1'
    or pg_catalog.coalesce(p_signed_observation #>> '{body,sourceDocumentDigest}', '')
         !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.coalesce(p_signed_observation #>> '{body,normalizedFactsDigest}', '')
         !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.coalesce(p_signed_observation ->> 'signature', '')
         !~ '^[A-Za-z0-9_-]{86}$'
    or 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(
         pg_catalog.translate(p_signed_observation ->> 'signature', '-_', '+/') || '==',
         'base64')), 'hex') is distinct from p_observation_signature_digest
    or p_signed_observation::text ~ '"rawReference"' then
    return 'conflict';
  end if;

  -- The existing protected routine locks all seven financial switches, checks
  -- the lease, and inserts the one-observation replay marker in this transaction.
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

comment on table app.routine_telebirr_signed_observation_payloads is
  'Seven-day signed phone observations for repeatable independent review. Cascades with the untrusted candidate; not provider authentication or a payment claim.';
comment on function app.stage_routine_telebirr_no_money_signed_observation(
  uuid, text, text, text, text, jsonb, text) is
  'No-money exact-replay archive after server-side signature and policy review. Financial switches must remain disabled; this function cannot credit a Player.';

commit;
