-- Private paid-phone observation inbox. A verified signed phone reading is not
-- yet a payment claim, deposit intent, execution job, or Player credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_paid_observation_staging (
  challenge_id uuid primary key
    references app.routine_telebirr_lookup_challenges (challenge_id) on delete cascade,
  candidate_id uuid not null unique
    references app.routine_telebirr_untrusted_proof_requests (id) on delete cascade,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  reference_fingerprint text not null
    check (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  source_document_digest text not null
    check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_body_digest text not null
    check (assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  observation_body_digest text not null unique
    check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  observation_signature_digest text not null
    check (observation_signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  replay_identity text not null unique
    check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  signed_observation jsonb not null,
  observed_at timestamptz not null,
  occurred_at timestamptz not null,
  amount_minor bigint not null check (amount_minor between 2500 and 2500000),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_paid_staging_provider_reference_unique
    unique (payment_provider_id, reference_fingerprint),
  constraint routine_paid_staging_provider_document_unique
    unique (payment_provider_id, source_document_digest),
  constraint routine_paid_staging_observation_check check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.octet_length(signed_observation::text) <= 16384
    and signed_observation ->> 'providerCode' = 'telebirr'
    and signed_observation ->> 'protocolMode' = 'routine_signed_observation_v1'
    and signed_observation ->> 'bodyDigest' = observation_body_digest
    and signed_observation #>> '{body,challengeId}' = challenge_id::text
    and signed_observation #>> '{body,candidateId}' = candidate_id::text
    and signed_observation #>> '{body,referenceFingerprint}' = reference_fingerprint
    and signed_observation #>> '{body,sourceDocumentDigest}' = source_document_digest
    and signed_observation #>> '{body,facts,amountMinor}' = amount_minor::text
    and signed_observation::text !~ '"rawReference"'
  ),
  constraint routine_paid_staging_time_check check (
    observed_at <= recorded_at + interval '5 seconds'
    and occurred_at <= observed_at
  )
);
create trigger routine_paid_staging_no_update
before update on app.routine_telebirr_paid_observation_staging
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
alter table app.routine_telebirr_paid_observation_staging owner to postgres;
alter table app.routine_telebirr_paid_observation_staging enable row level security;
alter table app.routine_telebirr_paid_observation_staging force row level security;
revoke all on table app.routine_telebirr_paid_observation_staging
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_routine_telebirr_paid_poll, fetanagent_routine_telebirr_paid_poll_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

-- The same material shape as the signed assignment, but only paid rows. The
-- encrypted reference is opened solely inside the private broker, never by SQL.
create function app.load_routine_telebirr_paid_observation_material(p_challenge_id uuid)
returns table (
  challenge_id uuid, challenge_digest text, issued_at timestamptz,
  expires_at timestamptz, candidate_id uuid, candidate_submitted_at timestamptz,
  candidate_reference_ciphertext text, candidate_reference_fingerprint text,
  reference_encryption_key_version smallint, reference_profile_version smallint,
  receiver_revision_id uuid, receiver_version integer,
  receiver_reference_fingerprint text, receiver_profile_digest text,
  receiver_name text, expected_receiver_name_digest text,
  device_enrollment_id uuid, device_id text, device_key_id text,
  device_public_key_spki_sha256 text, device_valid_from timestamptz,
  device_valid_until timestamptz, assignment_signer_id uuid,
  assignment_signer_key_id text, assignment_signer_public_key_spki_sha256 text,
  signer_valid_from timestamptz, signer_valid_until timestamptz,
  source_profile text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not app.routine_telebirr_paid_poll_session_allowed()
    or p_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'The routine paid observation material is unavailable.';
  end if;
  return query
  select challenge.challenge_id, challenge.challenge_digest,
         challenge.issued_at, challenge.expires_at,
         candidate.id, pg_catalog.date_trunc('milliseconds', candidate.submitted_at),
         candidate.candidate_reference_ciphertext,
         candidate.candidate_reference_fingerprint,
         candidate.reference_encryption_key_version,
         candidate.reference_profile_version,
         receiver.id, receiver.version, receiver.account_reference_fingerprint,
         challenge.receiver_profile_digest, receiver.account_holder_name,
         challenge.expected_receiver_name_digest,
         enrollment.id, enrollment.device_id, enrollment.device_key_id,
         enrollment.device_public_key_spki_sha256,
         enrollment.valid_from, enrollment.valid_until,
         signer.id, signer.signer_key_id, signer.public_key_spki_sha256,
         signer.valid_from, signer.valid_until, challenge.source_profile
    from app.routine_telebirr_lookup_challenges challenge
    join app.routine_telebirr_untrusted_proof_requests candidate
      on candidate.id = challenge.candidate_id
     and candidate.intake_mode = 'paid'
     and candidate.candidate_reference_fingerprint =
       challenge.candidate_reference_fingerprint
     and candidate.submitted_at = challenge.candidate_submitted_at
     and candidate.receiver_account_id = challenge.receiver_account_id
     and candidate.receiver_account_version = challenge.receiver_account_version
    join app.receiver_accounts receiver
      on receiver.id = challenge.receiver_account_id
     and receiver.version = challenge.receiver_account_version
     and receiver.provider_id = candidate.payment_provider_id
    join app.routine_telebirr_device_enrollments enrollment
      on enrollment.id = challenge.device_enrollment_id
     and enrollment.device_id = challenge.device_id
     and enrollment.device_key_id = challenge.device_key_id
     and enrollment.device_public_key_spki_sha256 =
       challenge.device_public_key_spki_sha256
     and enrollment.receiver_account_id = receiver.id
     and enrollment.receiver_account_version = receiver.version
     and enrollment.receiver_profile_digest = challenge.receiver_profile_digest
     and enrollment.expected_receiver_name_digest =
       challenge.expected_receiver_name_digest
    join app.routine_telebirr_lookup_signers signer
      on signer.id = challenge.assignment_signer_id
   where challenge.challenge_id = p_challenge_id
     and challenge.issuance_mode = 'paid'
     and challenge.issued_at <= v_now
     and challenge.expires_at + interval '15 minutes' > v_now
     and candidate.provider_code = 'telebirr'
     and candidate.submitted_at + interval '1 hour' > v_now
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= v_now
     and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
     and app.routine_telebirr_receiver_name_digest(receiver.account_holder_name) =
       challenge.expected_receiver_name_digest
     and app.routine_telebirr_receiver_profile_digest(
       receiver.id, receiver.version, receiver.account_reference_fingerprint,
       receiver.account_holder_name) = challenge.receiver_profile_digest
     and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
     and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
       where revoked.enrollment_id = enrollment.id)
     and signer.valid_from <= v_now and signer.valid_until > v_now
     and not exists (select 1 from app.routine_telebirr_lookup_signer_revocations revoked
       where revoked.signer_id = signer.id);
end;
$$;
alter function app.load_routine_telebirr_paid_observation_material(uuid) owner to postgres;
revoke all on function app.load_routine_telebirr_paid_observation_material(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_routine_telebirr_paid_poll, fetanagent_routine_telebirr_paid_poll_runtime;
grant execute on function app.load_routine_telebirr_paid_observation_material(uuid)
  to fetanagent_routine_telebirr_paid_poll;

create function app.stage_routine_telebirr_paid_signed_observation(
  p_challenge_id uuid, p_assignment_body_digest text,
  p_observation_body_digest text, p_observation_signature_digest text,
  p_replay_identity text, p_signed_observation jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_challenge app.routine_telebirr_lookup_challenges%rowtype;
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_existing app.routine_telebirr_paid_observation_staging%rowtype;
  v_now timestamptz;
  v_observed_at timestamptz;
  v_occurred_at timestamptz;
  v_amount_minor bigint;
  v_authorized_at timestamptz;
  v_switch_count integer;
  v_live_count integer;
  v_inserted integer;
begin
  if not app.routine_telebirr_paid_poll_session_allowed()
    or p_challenge_id is null or p_signed_observation is null
    or pg_catalog.jsonb_typeof(p_signed_observation) <> 'object'
    or pg_catalog.octet_length(p_signed_observation::text) > 16384
    or coalesce(p_assignment_body_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_observation_body_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_observation_signature_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_replay_identity, '') !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501',
      message = 'The routine paid observation is unavailable.';
  end if;

  -- A phone observation is not yet a claim, but the Owner's stop path must
  -- still make an in-flight paid upload fail closed before durable staging.
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
  select authority.authorized_at into v_authorized_at
    from app.routine_telebirr_processing_events event
    join app.routine_telebirr_processing_authorizations authority
      on authority.id = event.authorization_id
    join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    join app.platform_agent_accounts agent on agent.id = authority.platform_agent_account_id
    join app.platforms platform on platform.id = agent.platform_id
    join app.deposit_policy_versions policy
      on policy.id = authority.deposit_policy_version_id
   where event.event_sequence = (select pg_catalog.max(latest.event_sequence)
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
  if v_authorized_at is null then
    raise exception 'The current routine Owner authorization is unavailable.';
  end if;

  select challenge.* into v_challenge
    from app.routine_telebirr_lookup_challenges challenge
   where challenge.challenge_id = p_challenge_id for share;
  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.id = v_challenge.candidate_id for share;
  v_now := pg_catalog.clock_timestamp();
  if v_challenge.challenge_id is null or v_challenge.issuance_mode <> 'paid'
    or v_candidate.id is null or v_candidate.intake_mode <> 'paid'
    or v_candidate.provider_code <> 'telebirr'
    or v_candidate.id <> v_challenge.candidate_id
    or v_candidate.payment_provider_id is null
    or v_candidate.candidate_reference_fingerprint <>
      v_challenge.candidate_reference_fingerprint
    or v_candidate.submitted_at <> v_challenge.candidate_submitted_at
    or v_candidate.submitted_at < v_authorized_at
    or v_candidate.submitted_at + interval '1 hour' <= v_now
    or v_challenge.issued_at > v_now
    or v_challenge.expires_at + interval '15 minutes' <= v_now
    or v_challenge.issued_at < v_authorized_at
    or not exists (select 1 from app.routine_telebirr_device_enrollments enrollment
       where enrollment.id = v_challenge.device_enrollment_id
         and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
         and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
           where revoked.enrollment_id = enrollment.id))
    or not exists (select 1 from app.routine_telebirr_lookup_signers signer
       where signer.id = v_challenge.assignment_signer_id
         and signer.valid_from <= v_now and signer.valid_until > v_now
         and not exists (select 1 from app.routine_telebirr_lookup_signer_revocations revoked
           where revoked.signer_id = signer.id)) then
    return 'conflict';
  end if;

  if p_signed_observation ->> 'bodyDigest' is distinct from p_observation_body_digest
    or p_signed_observation #>> '{body,challengeId}' is distinct from p_challenge_id::text
    or p_signed_observation #>> '{body,challengeDigest}'
       is distinct from v_challenge.challenge_digest
    or p_signed_observation #>> '{body,candidateId}'
       is distinct from v_candidate.id::text
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
    or coalesce(p_signed_observation #>> '{body,sourceDocumentDigest}', '')
       !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_signed_observation ->> 'signature', '')
       !~ '^[A-Za-z0-9_-]{86}$'
    or 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(
         pg_catalog.translate(p_signed_observation ->> 'signature', '-_', '+/') || '==',
         'base64')), 'hex') is distinct from p_observation_signature_digest
    or p_signed_observation::text ~ '"rawReference"' then
    return 'conflict';
  end if;
  if coalesce(p_signed_observation #>> '{body,observedAt}', '')
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or coalesce(p_signed_observation #>> '{body,facts,occurredAt}', '')
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or coalesce(p_signed_observation #>> '{body,facts,amountMinor}', '')
       !~ '^[0-9]{1,7}$'
    or p_signed_observation #>> '{body,facts,currencyCode}' is distinct from 'ETB'
    or p_signed_observation #>> '{body,facts,evidenceSource}'
       is distinct from 'provider_receipt_lookup'
    or p_signed_observation #>> '{body,facts,providerFinalStatus}'
       is distinct from 'completed'
    or p_signed_observation #>> '{body,facts,providerIdentity}'
       is distinct from 'matched'
    or p_signed_observation #>> '{body,facts,receiverMatch}'
       is distinct from 'matched'
    or p_signed_observation #>> '{body,facts,referenceMatch}'
       is distinct from 'matched'
    or p_signed_observation #>> '{body,facts,sourceProfile}'
       is distinct from 'telebirr_official_receipt_v1' then
    return 'conflict';
  end if;
  v_observed_at := (p_signed_observation #>> '{body,observedAt}')::timestamptz;
  v_occurred_at := (p_signed_observation #>> '{body,facts,occurredAt}')::timestamptz;
  v_amount_minor := (p_signed_observation #>> '{body,facts,amountMinor}')::bigint;
  if v_observed_at < v_challenge.issued_at
    or v_observed_at >= v_challenge.expires_at
    or v_observed_at > v_now + interval '5 seconds'
    or v_observed_at + interval '15 minutes' <= v_now
    or v_occurred_at > v_observed_at
    or v_occurred_at < v_candidate.submitted_at - interval '1 hour'
    or v_occurred_at > v_candidate.submitted_at + interval '5 minutes'
    or v_occurred_at + interval '1 hour' <= v_now
    or v_amount_minor not between 2500 and 2500000 then
    return 'conflict';
  end if;

  insert into app.routine_telebirr_paid_observation_staging (
    challenge_id, candidate_id, payment_provider_id, reference_fingerprint,
    source_document_digest, assignment_body_digest, observation_body_digest,
    observation_signature_digest, replay_identity, signed_observation,
    observed_at, occurred_at, amount_minor, recorded_at
  ) values (
    p_challenge_id, v_candidate.id, v_candidate.payment_provider_id,
    v_challenge.candidate_reference_fingerprint,
    p_signed_observation #>> '{body,sourceDocumentDigest}',
    p_assignment_body_digest, p_observation_body_digest,
    p_observation_signature_digest, p_replay_identity, p_signed_observation,
    v_observed_at, v_occurred_at, v_amount_minor, v_now
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then return 'recorded'; end if;
  select staged.* into v_existing
    from app.routine_telebirr_paid_observation_staging staged
   where staged.challenge_id = p_challenge_id for share;
  if v_existing.challenge_id = p_challenge_id
    and v_existing.candidate_id = v_candidate.id
    and v_existing.assignment_body_digest = p_assignment_body_digest
    and v_existing.observation_body_digest = p_observation_body_digest
    and v_existing.observation_signature_digest = p_observation_signature_digest
    and v_existing.replay_identity = p_replay_identity
    and v_existing.signed_observation = p_signed_observation then
    return 'exact_replay';
  end if;
  return 'conflict';
end;
$$;
alter function app.stage_routine_telebirr_paid_signed_observation(
  uuid, text, text, text, text, jsonb) owner to postgres;
revoke all on function app.stage_routine_telebirr_paid_signed_observation(
  uuid, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_routine_telebirr_paid_poll, fetanagent_routine_telebirr_paid_poll_runtime;
grant execute on function app.stage_routine_telebirr_paid_signed_observation(
  uuid, text, text, text, text, jsonb)
  to fetanagent_routine_telebirr_paid_poll;

comment on table app.routine_telebirr_paid_observation_staging is
  'Seven-day paired-phone paid observation inbox. No public/table grant, payment claim, intent, job, or credit.';
comment on function app.load_routine_telebirr_paid_observation_material(uuid) is
  'Private paid challenge snapshot for the preflighted paid broker role. Never returns plaintext reference or a no-money challenge.';
comment on function app.stage_routine_telebirr_paid_signed_observation(
  uuid, text, text, text, text, jsonb) is
  'Private immutable, replay-safe paid phone observation staging after server signature review. No financial action.';

commit;
