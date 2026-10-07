-- One-use, no-money phone poll handoff. The caller must first verify the device's
-- signed poll; this administrator-only function then claims that exact replay ID
-- and reserves at most one matching candidate in the same transaction. It does
-- not sign an assignment, contact TeleBirr, accept an observation, or move money.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.issue_routine_telebirr_no_money_poll_assignment(
  p_enrollment_id uuid, p_request_id uuid, p_replay_identity text,
  p_request_expires_at timestamptz, p_signer_id uuid
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
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_candidate_id uuid;
  v_claimed boolean;
  v_returned integer;
  v_now timestamptz;
begin
  if session_user <> 'postgres' or p_signer_id is null then
    raise exception using errcode = '42501',
      message = 'The routine no-money assignment is unavailable.';
  end if;

  -- The claim locks and rechecks all seven disabled financial switches before
  -- any candidate is locked. An issuer failure rolls this claim back as well.
  select app.claim_routine_telebirr_no_money_poll(
    p_enrollment_id, p_request_id, p_replay_identity, p_request_expires_at
  ) into v_claimed;
  if v_claimed is not true then
    raise exception using errcode = '42501',
      message = 'The routine no-money poll was already used.';
  end if;

  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
   where enrollment.id = p_enrollment_id for share;
  if v_enrollment.id is null then
    raise exception 'The routine no-money device is unavailable.';
  end if;
  v_now := pg_catalog.clock_timestamp();

  -- A signer ID is supplied by the protected process holding that key. If no
  -- current matching candidate exists, the signed poll remains spent and the
  -- caller receives no assignment. SKIP LOCKED avoids two polls reserving the
  -- same candidate; the issuer repeats all eligibility and trust checks.
  select candidate.id into v_candidate_id
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.receiver_account_id = v_enrollment.receiver_account_id
     and candidate.receiver_account_version = v_enrollment.receiver_account_version
     and candidate.provider_code = 'telebirr'
     and candidate.submitted_at <= v_now
     and candidate.submitted_at + interval '7 days' > v_now + interval '5 minutes'
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
        where challenge.candidate_id = candidate.id
          and challenge.expires_at > v_now
     )
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
         join app.routine_telebirr_observation_receipts receipt
           on receipt.challenge_id = challenge.challenge_id
        where challenge.candidate_id = candidate.id
     )
     and (
       select pg_catalog.count(*)
         from app.routine_telebirr_lookup_challenges challenge
        where challenge.candidate_id = candidate.id
     ) < 5
   order by candidate.submitted_at, candidate.id
   limit 1 for update of candidate skip locked;
  if v_candidate_id is null then return; end if;

  return query
  select material.*
    from app.issue_routine_telebirr_lookup_assignment_material(
      v_candidate_id, p_enrollment_id, p_signer_id
    ) material;
  get diagnostics v_returned = row_count;
  if v_returned <> 1 then
    raise exception 'The routine no-money assignment is unavailable.';
  end if;
end;
$$;

alter function app.issue_routine_telebirr_no_money_poll_assignment(
  uuid, uuid, text, timestamptz, uuid
) owner to postgres;
revoke all on function app.issue_routine_telebirr_no_money_poll_assignment(
  uuid, uuid, text, timestamptz, uuid
) from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on function app.issue_routine_telebirr_no_money_poll_assignment(
  uuid, uuid, text, timestamptz, uuid
) is 'Postgres-only atomic signed-poll claim and encrypted lookup reservation. No signer key, phone transport, provider claim, Player credit, or financial authority.';

commit;
