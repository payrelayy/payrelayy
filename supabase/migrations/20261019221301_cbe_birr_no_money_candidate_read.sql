-- A narrowly scoped, no-money read of one CBE candidate and its immutable instruction lineage.
-- The sole grantee is NOLOGIN. There is no lease, network call, result writer, claim or credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create role fetanagent_cbe_birr_no_money_reader
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;

create function app.read_cbe_birr_no_money_candidate(p_candidate_id uuid)
returns table (
  candidate_id uuid,
  proof_request_id uuid,
  reference_ciphertext text,
  reference_masked text,
  reference_profile_version smallint,
  reference_encryption_key_version smallint,
  receiver_revision_id uuid,
  receiver_version integer,
  receiver_rotation_request_id uuid,
  receiver_lookup_ciphertext text,
  receiver_lookup_masked text,
  receiver_lookup_profile_version smallint,
  receiver_lookup_encryption_key_version smallint,
  instruction_issued_at timestamptz,
  instruction_expires_at timestamptz,
  proof_submitted_at timestamptz,
  receiver_active_at_submission boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_candidate_id is null then
    raise exception 'The CBE Birr no-money candidate request is invalid.';
  end if;

  -- Serialize this read with any CBE activation or receiver rotation. TeleBirr may remain live.
  perform 1
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
     and feature_switch.mode = 'disabled'
   for share;
  if not found then
    raise exception 'CBE Birr no-money candidate reading requires verification disabled.';
  end if;

  return query
  select candidate.id,
         proof.id,
         proof.candidate_reference_ciphertext,
         proof.candidate_reference_masked,
         proof.reference_profile_version,
         proof.reference_encryption_key_version,
         receiver.id,
         receiver.version,
         receiver.rotation_request_id,
         lookup.lookup_ciphertext,
         lookup.lookup_masked,
         lookup.protection_profile_version,
         lookup.encryption_key_version,
         instruction.issued_at,
         instruction.expires_at,
         proof.submitted_at,
         true
    from app.routine_cbe_birr_candidates candidate
    join app.cbe_birr_instruction_proof_bindings binding
      on binding.proof_request_id = candidate.proof_request_id
    join app.deposit_proof_requests proof
      on proof.id = binding.proof_request_id
     and proof.submitting_customer_id = binding.submitting_customer_id
     and proof.player_account_id = binding.player_account_id
     and proof.payment_provider_id = binding.payment_provider_id
     and proof.origin_channel = binding.origin_channel
    join app.cbe_birr_payment_instructions instruction
      on instruction.id = binding.instruction_id
     and instruction.submitting_customer_id = binding.submitting_customer_id
     and instruction.player_account_id = binding.player_account_id
     and instruction.payment_provider_id = binding.payment_provider_id
     and instruction.origin_channel = binding.origin_channel
     and instruction.receiver_revision_id = binding.receiver_revision_id
     and instruction.receiver_version = binding.receiver_version
     and instruction.receiver_rotation_request_id = binding.receiver_rotation_request_id
    join app.receiver_accounts receiver
      on receiver.id = binding.receiver_revision_id
     and receiver.version = binding.receiver_version
     and receiver.rotation_request_id = binding.receiver_rotation_request_id
     and receiver.provider_id = binding.payment_provider_id
    join app.cbe_birr_receiver_lookup_revisions lookup
      on lookup.receiver_revision_id = receiver.id
     and lookup.receiver_version = receiver.version
     and lookup.rotation_request_id = receiver.rotation_request_id
   where candidate.id = p_candidate_id
     and candidate.contract_version = 1
     and proof.provider_code = 'cbe_birr'
     and proof.status = 'proof_received'
     and proof.reference_profile_version = 2
     and proof.reference_encryption_key_version = 2
     and instruction.provider_code = 'cbe_birr'
     and proof.submitted_at >= instruction.issued_at
     and proof.submitted_at >= instruction.created_at
     and proof.submitted_at < instruction.expires_at
     and receiver.status = 'active'
     and receiver.retired_at is null
     and receiver.active_from <= instruction.issued_at
     and lookup.protection_profile_version = 2
     and lookup.encryption_key_version = 2
     and lookup.fingerprint_key_version = 2
   for share of receiver;
end;
$$;

alter function app.read_cbe_birr_no_money_candidate(uuid) owner to postgres;
revoke all on function app.read_cbe_birr_no_money_candidate(uuid)
  from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
       fetanagent_cbe_birr_candidate_prelease,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;
grant usage on schema app to fetanagent_cbe_birr_no_money_reader;
grant execute on function app.read_cbe_birr_no_money_candidate(uuid)
  to fetanagent_cbe_birr_no_money_reader;

comment on role fetanagent_cbe_birr_no_money_reader is
  'NOLOGIN CBE-only, no-money proof and receiver reader; no table, job, claim, settlement or credit access.';
comment on function app.read_cbe_birr_no_money_candidate(uuid) is
  'Returns protected reference and receiver material for one exact bound, active CBE candidate while CBE verification is disabled. No lease, provider request, result, claim or credit.';

commit;
