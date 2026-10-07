-- Administrator-only, review-only read-back for a phone observation. The returned
-- reference remains encrypted; opening and signature checks belong to the private
-- server process. No runtime role or public API receives this function.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.load_routine_telebirr_no_money_enrollment(p_enrollment_id uuid)
returns table (
  enrollment_id uuid,
  device_id text,
  device_key_id text,
  device_public_key_spki_sha256 text,
  valid_from timestamptz,
  valid_until timestamptz,
  receiver_revision_id uuid,
  receiver_profile_digest text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user <> 'postgres' or p_enrollment_id is null then
    raise exception using errcode = '42501',
      message = 'The routine no-money enrollment is unavailable.';
  end if;
  return query
  select enrollment.id, enrollment.device_id, enrollment.device_key_id,
         enrollment.device_public_key_spki_sha256,
         enrollment.valid_from, enrollment.valid_until,
         receiver.id, enrollment.receiver_profile_digest
    from app.routine_telebirr_device_enrollments enrollment
    join app.receiver_accounts receiver
      on receiver.id = enrollment.receiver_account_id
     and receiver.version = enrollment.receiver_account_version
   where enrollment.id = p_enrollment_id
     and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
     and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
       where revoked.enrollment_id = enrollment.id)
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= v_now
     and case
       when receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
         and receiver.account_holder_name is not null
         and pg_catalog.char_length(receiver.account_holder_name) between 2 and 160
         and receiver.account_holder_name !~ '[[:cntrl:]]'
       then app.routine_telebirr_receiver_name_digest(receiver.account_holder_name) =
         enrollment.expected_receiver_name_digest
         and app.routine_telebirr_receiver_profile_digest(
           receiver.id, receiver.version, receiver.account_reference_fingerprint,
           receiver.account_holder_name) = enrollment.receiver_profile_digest
       else false
     end;
end;
$$;

create function app.load_routine_telebirr_no_money_observation_material(
  p_challenge_id uuid
)
returns table (
  challenge_id uuid,
  challenge_digest text,
  issued_at timestamptz,
  expires_at timestamptz,
  candidate_id uuid,
  candidate_submitted_at timestamptz,
  candidate_reference_ciphertext text,
  candidate_reference_fingerprint text,
  reference_encryption_key_version smallint,
  reference_profile_version smallint,
  receiver_revision_id uuid,
  receiver_version integer,
  receiver_reference_fingerprint text,
  receiver_profile_digest text,
  receiver_name text,
  expected_receiver_name_digest text,
  device_enrollment_id uuid,
  device_id text,
  device_key_id text,
  device_public_key_spki_sha256 text,
  device_valid_from timestamptz,
  device_valid_until timestamptz,
  assignment_signer_id uuid,
  assignment_signer_key_id text,
  assignment_signer_public_key_spki_sha256 text,
  signer_valid_from timestamptz,
  signer_valid_until timestamptz,
  source_profile text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
begin
  if session_user <> 'postgres' or p_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'The routine no-money observation material is unavailable.';
  end if;

  -- Match the existing no-money write boundaries. A read-back must not run once
  -- financial modes are enabled, even though this function cannot write money.
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count
    from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or v_disabled_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  return query
  select challenge.challenge_id,
         challenge.challenge_digest,
         challenge.issued_at,
         challenge.expires_at,
         candidate.id,
         pg_catalog.date_trunc('milliseconds', candidate.submitted_at),
         candidate.candidate_reference_ciphertext,
         candidate.candidate_reference_fingerprint,
         candidate.reference_encryption_key_version,
         candidate.reference_profile_version,
         receiver.id,
         receiver.version,
         receiver.account_reference_fingerprint,
         challenge.receiver_profile_digest,
         receiver.account_holder_name,
         challenge.expected_receiver_name_digest,
         enrollment.id,
         enrollment.device_id,
         enrollment.device_key_id,
         enrollment.device_public_key_spki_sha256,
         enrollment.valid_from,
         enrollment.valid_until,
         signer.id,
         signer.signer_key_id,
         signer.public_key_spki_sha256,
         signer.valid_from,
         signer.valid_until,
         challenge.source_profile
    from app.routine_telebirr_lookup_challenges challenge
    join app.routine_telebirr_untrusted_proof_requests candidate
      on candidate.id = challenge.candidate_id
     and candidate.candidate_reference_fingerprint =
       challenge.candidate_reference_fingerprint
     and candidate.submitted_at = challenge.candidate_submitted_at
     and candidate.receiver_account_id = challenge.receiver_account_id
     and candidate.receiver_account_version = challenge.receiver_account_version
    join app.receiver_accounts receiver
      on receiver.id = challenge.receiver_account_id
     and receiver.version = challenge.receiver_account_version
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
     and challenge.issued_at <= v_now and challenge.expires_at > v_now
     and candidate.provider_code = 'telebirr'
     and candidate.submitted_at + interval '7 days' > v_now
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= v_now
     and case
       when receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
         and receiver.account_holder_name is not null
         and pg_catalog.char_length(receiver.account_holder_name) between 2 and 160
         and receiver.account_holder_name !~ '[[:cntrl:]]'
       then app.routine_telebirr_receiver_name_digest(receiver.account_holder_name) =
         challenge.expected_receiver_name_digest
         and app.routine_telebirr_receiver_profile_digest(
           receiver.id, receiver.version, receiver.account_reference_fingerprint,
           receiver.account_holder_name) = challenge.receiver_profile_digest
       else false
     end
     and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
     and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
       where revoked.enrollment_id = enrollment.id)
     and signer.valid_from <= v_now and signer.valid_until > v_now
     and not exists (select 1 from app.routine_telebirr_lookup_signer_revocations revoked
       where revoked.signer_id = signer.id);
end;
$$;

alter function app.load_routine_telebirr_no_money_enrollment(uuid)
  owner to postgres;
alter function app.load_routine_telebirr_no_money_observation_material(uuid)
  owner to postgres;
revoke all on function app.load_routine_telebirr_no_money_enrollment(uuid),
  app.load_routine_telebirr_no_money_observation_material(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on function app.load_routine_telebirr_no_money_observation_material(uuid) is
  'Postgres-only encrypted candidate/challenge read-back for signed phone upload review. No public grant, plaintext reference, source authentication, payment claim, or financial action.';
comment on function app.load_routine_telebirr_no_money_enrollment(uuid) is
  'Postgres-only active routine phone binding for signed no-money poll verification. No public grant, private key, or financial action.';

commit;
