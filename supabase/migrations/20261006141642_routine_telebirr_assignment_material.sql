-- Admin-only no-money bridge between a reserved challenge and an exact signed assignment.
-- It provides protected material for a future private signer, but grants no runtime caller,
-- enrolls no phone, transports no assignment, and confers no payment authority.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- A signer must never also be the enrolled phone key, even if a privileged caller
-- attempts to insert a challenge directly instead of using the issuer.
create function app.require_routine_telebirr_lookup_distinct_keys()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_signer app.routine_telebirr_lookup_signers%rowtype;
begin
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
    where enrollment.id = new.device_enrollment_id for share;
  select signer.* into v_signer
    from app.routine_telebirr_lookup_signers signer
    where signer.id = new.assignment_signer_id for share;
  if v_enrollment.id is null or v_signer.id is null
    or v_enrollment.device_key_id = v_signer.signer_key_id
    or v_enrollment.device_public_key_spki_sha256 = v_signer.public_key_spki_sha256 then
    raise exception 'Routine assignment signer and device trust must be distinct.';
  end if;
  return new;
end;
$$;

create trigger routine_telebirr_lookup_distinct_keys
before insert on app.routine_telebirr_lookup_challenges
for each row execute function app.require_routine_telebirr_lookup_distinct_keys();

create function app.issue_routine_telebirr_lookup_assignment_material(
  p_candidate_id uuid, p_enrollment_id uuid, p_signer_id uuid
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
  v_issued record;
  v_returned integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Routine assignment material is administrator-only.';
  end if;

  -- The issuer locks and rechecks the current candidate, Player, receiver, enrollment,
  -- signer, seven disabled switches, and five-minute lease. Its row locks remain held
  -- until this whole function's transaction commits; a failed join rolls back issuance.
  select issued.* into strict v_issued
    from app.issue_routine_telebirr_lookup_challenge(
      p_candidate_id, p_enrollment_id, p_signer_id) issued;

  return query
  select challenge.challenge_id,
         challenge.challenge_digest,
         challenge.issued_at,
         challenge.expires_at,
         candidate.id,
         -- The signed cross-runtime timestamp is canonical milliseconds; the challenge
         -- ledger still pins the candidate's full-precision submitted_at exactly.
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
     and candidate.id = p_candidate_id
     and enrollment.id = p_enrollment_id
     and signer.id = p_signer_id;
  get diagnostics v_returned = row_count;
  if v_returned <> 1 then
    raise exception 'Routine assignment material is unavailable.';
  end if;
end;
$$;

alter function app.issue_routine_telebirr_lookup_assignment_material(uuid, uuid, uuid)
  owner to postgres;
revoke all on function app.require_routine_telebirr_lookup_distinct_keys(),
  app.issue_routine_telebirr_lookup_assignment_material(uuid, uuid, uuid)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

comment on function app.issue_routine_telebirr_lookup_assignment_material(uuid, uuid, uuid) is
  'Postgres-only no-money challenge and exact encrypted assignment material. Not an assignment signature, phone transport, provider observation, or payment claim.';

commit;
