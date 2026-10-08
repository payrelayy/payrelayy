-- Separate paid candidates and challenges from historical no-money rehearsals.
-- Issuance is private and cannot yet create a payment, claim, job, or credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.routine_telebirr_untrusted_proof_requests
  add column intake_mode text not null default 'no_money'
  check (intake_mode in ('no_money', 'paid'));

-- The existing no-money capture keeps its historical mode. A trigger, rather than
-- an issuer-only check, also prevents a privileged direct INSERT from linking a
-- rehearsed reference to a paid challenge (or vice versa).
create function app.require_routine_telebirr_challenge_candidate_mode()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_mode text;
begin
  select candidate.intake_mode into v_mode
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.id = new.candidate_id for share;
  if v_mode is null or v_mode is distinct from new.issuance_mode then
    raise exception 'The routine TeleBirr candidate and challenge modes differ.';
  end if;
  return new;
end;
$$;
alter function app.require_routine_telebirr_challenge_candidate_mode() owner to postgres;
revoke all on function app.require_routine_telebirr_challenge_candidate_mode()
  from public, anon, authenticated, service_role;
create trigger routine_telebirr_challenge_candidate_mode
before insert on app.routine_telebirr_lookup_challenges
for each row execute function app.require_routine_telebirr_challenge_candidate_mode();

-- No-money observation receipts are never a paid evidence store, even if all
-- financial switches are subsequently disabled after a paid challenge was issued.
create function app.require_routine_telebirr_no_money_observation_mode()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform 1 from app.routine_telebirr_lookup_challenges challenge
   where challenge.challenge_id = new.challenge_id
     and challenge.issuance_mode = 'no_money' for share;
  if not found then
    raise exception 'The no-money observation requires a no-money challenge.';
  end if;
  return new;
end;
$$;
alter function app.require_routine_telebirr_no_money_observation_mode() owner to postgres;
revoke all on function app.require_routine_telebirr_no_money_observation_mode()
  from public, anon, authenticated, service_role;
create trigger routine_telebirr_no_money_observation_mode
before insert on app.routine_telebirr_observation_receipts
for each row execute function app.require_routine_telebirr_no_money_observation_mode();

create function app.issue_routine_telebirr_paid_lookup_challenge(
  p_candidate_id uuid, p_enrollment_id uuid, p_signer_id uuid
)
returns table (
  challenge_id uuid, challenge_digest text, issued_at timestamptz,
  expires_at timestamptz, receiver_profile_digest text,
  expected_receiver_name_digest text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_signer app.routine_telebirr_lookup_signers%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_boundary record;
  v_player_id text;
  v_now timestamptz;
  v_switch_count integer;
  v_live_count integer;
  v_authorization_id uuid;
  v_challenge_id uuid;
  v_challenge_digest text;
  v_profile_digest text;
  v_name_digest text;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Paid routine lookup issuance is administrator-only.';
  end if;
  if p_candidate_id is null or p_enrollment_id is null or p_signer_id is null then
    raise exception 'The paid routine lookup input is invalid.';
  end if;

  -- Serialize with Owner stop/save before taking the established financial
  -- authority, ordered feature-switch, customer, and Player locks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004)
  );
  perform 1 from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The paid routine lookup is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'deposit_execution', 'payment_verification',
     'private_live_deposit_pilot', 'telebirr_authoritative_verification'
   ) order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_live_count
    from app.feature_switches feature_switch
   where (feature_switch.feature_key in (
       'deposit_execution', 'payment_verification')
     and feature_switch.mode = 'live')
      or (feature_switch.feature_key in (
          'private_live_deposit_pilot', 'telebirr_authoritative_verification')
        and feature_switch.mode = 'disabled');
  if v_switch_count <> 4 or v_live_count <> 4 then
    raise exception 'The paid routine lookup requires live generic deposit gates and no legacy TeleBirr pilot.';
  end if;

  select authority.id into v_authorization_id
    from app.routine_telebirr_processing_events event
    join app.routine_telebirr_processing_authorizations authority
      on authority.id = event.authorization_id
    join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    join app.platform_agent_accounts agent
      on agent.id = authority.platform_agent_account_id
    join app.platforms platform on platform.id = agent.platform_id
    join app.deposit_policy_versions policy
      on policy.id = authority.deposit_policy_version_id
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
  if v_authorization_id is null then
    raise exception 'The current Owner routine authorization is unavailable.';
  end if;

  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.id = p_candidate_id for update;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_candidate.id is null or v_candidate.provider_code <> 'telebirr'
    or v_candidate.intake_mode <> 'paid'
    or v_candidate.origin_channel <> 'telegram'
    or not exists (
      select 1 from app.inbound_events inbound_event
       where inbound_event.id = v_candidate.origin_request_key
         and inbound_event.channel = 'telegram'
         and inbound_event.customer_identity_id = v_candidate.origin_identity_id
         and inbound_event.processed_at = v_candidate.submitted_at
    )
    or v_candidate.submitted_at < (
      select authority.authorized_at
        from app.routine_telebirr_processing_authorizations authority
       where authority.id = v_authorization_id)
    or v_candidate.submitted_at > v_now
    or v_candidate.submitted_at + interval '1 hour 5 minutes' <= v_now then
    raise exception 'The paid routine candidate is unavailable.';
  end if;
  perform 1 from app.customers customer
    join app.customer_identities identity on identity.customer_id = customer.id
   where customer.id = v_candidate.submitting_customer_id
     and customer.status = 'active'
     and identity.id = v_candidate.origin_identity_id
     and identity.status = 'active' for share of customer, identity;
  if not found then raise exception 'The paid routine candidate owner is unavailable.'; end if;

  select player.player_id into v_player_id
    from app.customer_platform_players player
   where player.id = v_candidate.player_account_id for share;
  if v_player_id is null then raise exception 'The routine Player is unavailable.'; end if;
  select boundary.* into v_boundary
    from app.resolve_dry_run_deposit_proof_boundary(v_player_id, 'telebirr') boundary;
  if not found
    or v_boundary.player_account_id is distinct from v_candidate.player_account_id
    or v_boundary.platform_id is distinct from v_candidate.platform_id
    or v_boundary.player_deposit_eligibility_decision_id
       is distinct from v_candidate.player_deposit_eligibility_decision_id
    or v_boundary.payment_provider_id is distinct from v_candidate.payment_provider_id then
    raise exception 'The paid routine Player eligibility has changed.';
  end if;

  select receiver.* into v_receiver from app.receiver_accounts receiver
   where receiver.id = v_candidate.receiver_account_id
     and receiver.provider_id = v_candidate.payment_provider_id
     and receiver.version = v_candidate.receiver_account_version
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= v_now
     and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
   for share;
  if v_receiver.id is null then raise exception 'The routine receiver has rotated.'; end if;
  v_name_digest := app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name);
  v_profile_digest := app.routine_telebirr_receiver_profile_digest(
    v_receiver.id, v_receiver.version, v_receiver.account_reference_fingerprint,
    v_receiver.account_holder_name);

  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
   where enrollment.id = p_enrollment_id for share;
  if v_enrollment.id is null
    or v_enrollment.receiver_account_id <> v_receiver.id
    or v_enrollment.receiver_account_version <> v_receiver.version
    or v_enrollment.receiver_profile_digest <> v_profile_digest
    or v_enrollment.expected_receiver_name_digest <> v_name_digest
    or v_enrollment.valid_from > v_now
    or v_enrollment.valid_until < v_now + interval '5 minutes'
    or exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
      where revocation.enrollment_id = v_enrollment.id) then
    raise exception 'The routine device enrollment is unavailable.';
  end if;
  select signer.* into v_signer from app.routine_telebirr_lookup_signers signer
   where signer.id = p_signer_id for share;
  if v_signer.id is null or v_signer.valid_from > v_now
    or v_signer.valid_until < v_now + interval '5 minutes'
    or exists (select 1 from app.routine_telebirr_lookup_signer_revocations revocation
      where revocation.signer_id = v_signer.id) then
    raise exception 'The routine assignment signer is unavailable.';
  end if;
  if v_enrollment.device_key_id = v_signer.signer_key_id
    or v_enrollment.device_public_key_spki_sha256 = v_signer.public_key_spki_sha256
    or (select pg_catalog.count(*) from app.routine_telebirr_lookup_challenges challenge
          where challenge.candidate_id = v_candidate.id) >= 5 then
    raise exception 'The paid routine lookup trust or limit is unavailable.';
  end if;

  v_challenge_id := pg_catalog.gen_random_uuid();
  v_challenge_digest := app.routine_telebirr_sha256_digest(pg_catalog.convert_to(
    'fetanagent:telebirr:routine:paid-lookup-challenge:v1:'
      || v_challenge_id::text || ':' || pg_catalog.gen_random_uuid()::text, 'UTF8'));
  insert into app.routine_telebirr_lookup_challenges (
    challenge_id, candidate_id, receiver_account_id, receiver_account_version,
    candidate_reference_fingerprint, candidate_submitted_at,
    device_id, device_key_id, device_public_key_spki_sha256,
    device_enrollment_id, assignment_signer_id,
    receiver_profile_digest, expected_receiver_name_digest,
    challenge_digest, issued_at, expires_at, issuance_mode
  ) values (
    v_challenge_id, v_candidate.id, v_receiver.id, v_receiver.version,
    v_candidate.candidate_reference_fingerprint, v_candidate.submitted_at,
    v_enrollment.device_id, v_enrollment.device_key_id,
    v_enrollment.device_public_key_spki_sha256,
    v_enrollment.id, v_signer.id, v_profile_digest, v_name_digest,
    v_challenge_digest, v_now, v_now + interval '5 minutes', 'paid'
  );
  return query select v_challenge_id, v_challenge_digest, v_now,
    v_now + interval '5 minutes', v_profile_digest, v_name_digest;
end;
$$;
alter function app.issue_routine_telebirr_paid_lookup_challenge(uuid, uuid, uuid)
  owner to postgres;
revoke all on function app.issue_routine_telebirr_paid_lookup_challenge(uuid, uuid, uuid)
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

-- Match the existing no-money assignment shape so the signature protocol can
-- be reused, while the protected challenge row remains the trusted mode source.
create function app.issue_routine_telebirr_paid_lookup_assignment_material(
  p_candidate_id uuid, p_enrollment_id uuid, p_signer_id uuid
)
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
declare
  v_issued record;
  v_returned integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Paid routine assignment material is administrator-only.';
  end if;
  select issued.* into strict v_issued
    from app.issue_routine_telebirr_paid_lookup_challenge(
      p_candidate_id, p_enrollment_id, p_signer_id) issued;
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
    join app.receiver_accounts receiver
      on receiver.id = challenge.receiver_account_id
     and receiver.version = challenge.receiver_account_version
    join app.routine_telebirr_device_enrollments enrollment
      on enrollment.id = challenge.device_enrollment_id
     and enrollment.device_id = challenge.device_id
     and enrollment.device_key_id = challenge.device_key_id
     and enrollment.device_public_key_spki_sha256 =
       challenge.device_public_key_spki_sha256
     and enrollment.receiver_profile_digest = challenge.receiver_profile_digest
     and enrollment.expected_receiver_name_digest =
       challenge.expected_receiver_name_digest
    join app.routine_telebirr_lookup_signers signer
      on signer.id = challenge.assignment_signer_id
   where challenge.challenge_id = v_issued.challenge_id
     and challenge.challenge_digest = v_issued.challenge_digest
     and challenge.issued_at = v_issued.issued_at
     and challenge.expires_at = v_issued.expires_at
     and challenge.issuance_mode = 'paid'
     and candidate.id = p_candidate_id
     and enrollment.id = p_enrollment_id
     and signer.id = p_signer_id;
  get diagnostics v_returned = row_count;
  if v_returned <> 1 then
    raise exception 'Paid routine assignment material is unavailable.';
  end if;
end;
$$;
alter function app.issue_routine_telebirr_paid_lookup_assignment_material(uuid, uuid, uuid)
  owner to postgres;
revoke all on function app.issue_routine_telebirr_paid_lookup_assignment_material(uuid, uuid, uuid)
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

comment on column app.routine_telebirr_untrusted_proof_requests.intake_mode is
  'Historical captures are no_money. Only a separate reviewed paid intake may stamp paid; a no-money reference cannot be promoted.';
comment on function app.issue_routine_telebirr_paid_lookup_challenge(uuid, uuid, uuid) is
  'Private five-minute paid lookup reservation requiring current Owner policy, paired device, signer, live generic deposit gates, and disabled legacy TeleBirr pilot. No capture/runtime grant, signature, payment, or credit.';
comment on function app.issue_routine_telebirr_paid_lookup_assignment_material(uuid, uuid, uuid) is
  'Private paid challenge and exact encrypted assignment material. No runtime grant, signed assignment, phone transport, or credit.';

commit;
