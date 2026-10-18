-- Atomic, ungranted CBE Birr dry-run proof-to-instruction capture candidate.
-- This does not issue customer instructions or grant any application role a new route.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function app.capture_telegram_cbe_birr_bound_dry_run_proof(
  p_instruction_id uuid,
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_reference_profile_version smallint,
  p_semantic_input_hmac text
)
returns table (
  deposit_proof_request_id uuid,
  provider_code text,
  proof_status text,
  submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  captured record;
  bound_instruction_id uuid;
  preflight record;
begin
  if p_instruction_id is null then
    raise exception 'The CBE Birr instruction token is invalid.';
  end if;

  perform app.require_dry_run_deposit_proof_switches_disabled();

  perform 1
    from app.cbe_birr_payment_instructions instruction
   where instruction.id = p_instruction_id
     and instruction.provider_code = 'cbe_birr'
   for key share;
  if not found then
    raise exception 'The CBE Birr instruction is unavailable.';
  end if;

  select proof.* into captured
    from app.capture_telegram_dry_run_deposit_proof(
      p_origin_inbound_event_id, p_player_id, 'cbe_birr',
      p_reference_ciphertext, p_reference_fingerprint, p_reference_masked,
      p_reference_key_version, p_reference_profile_version,
      p_semantic_input_hmac
    ) proof;
  if not found or captured.provider_code <> 'cbe_birr'
    or captured.proof_status <> 'proof_received' then
    raise exception 'The CBE Birr dry-run proof capture is unavailable.';
  end if;

  select binding.instruction_id into bound_instruction_id
    from app.cbe_birr_instruction_proof_bindings binding
   where binding.proof_request_id = captured.deposit_proof_request_id;
  if found then
    if bound_instruction_id is distinct from p_instruction_id then
      raise exception 'The replayed CBE Birr proof has a different instruction.';
    end if;
  else
    if captured.request_replayed then
      raise exception 'An earlier unbound CBE Birr proof cannot be attached later.';
    end if;

    insert into app.cbe_birr_instruction_proof_bindings (
      proof_request_id, instruction_id, submitting_customer_id,
      player_account_id, payment_provider_id, origin_channel,
      receiver_revision_id, receiver_version, receiver_rotation_request_id
    )
    select proof.id, instruction.id, proof.submitting_customer_id,
           proof.player_account_id, proof.payment_provider_id,
           proof.origin_channel, instruction.receiver_revision_id,
           instruction.receiver_version, instruction.receiver_rotation_request_id
      from app.deposit_proof_requests proof
      join app.cbe_birr_payment_instructions instruction
        on instruction.id = p_instruction_id
       and instruction.submitting_customer_id = proof.submitting_customer_id
       and instruction.player_account_id = proof.player_account_id
       and instruction.payment_provider_id = proof.payment_provider_id
       and instruction.origin_channel = proof.origin_channel
     where proof.id = captured.deposit_proof_request_id;
    if not found then
      raise exception 'The CBE Birr instruction does not match this proof.';
    end if;
  end if;

  select decision.* into preflight
    from app.preflight_cbe_birr_proof_request(captured.deposit_proof_request_id)
         decision;
  if not found
    or preflight.preflight_version <> 'cbe-birr-proof-preflight-v2'
    or preflight.eligibility <> 'blocked'
    or preflight.blocker_code <> 'receiver_v2_instruction_bound_metadata_only'
    or preflight.lease_allowed is distinct from false
    or preflight.protected_material_allowed is distinct from false then
    raise exception 'The CBE Birr instruction and proof lineage needs review.';
  end if;

  return query
  select captured.deposit_proof_request_id::uuid,
         captured.provider_code::text,
         captured.proof_status::text,
         captured.submitted_at::timestamptz,
         captured.request_replayed::boolean;
end;
$$;

alter function app.capture_telegram_cbe_birr_bound_dry_run_proof(
  uuid, uuid, text, text, text, text, smallint, smallint, text
) owner to postgres;

revoke all on function app.capture_telegram_cbe_birr_bound_dry_run_proof(
  uuid, uuid, text, text, text, text, smallint, smallint, text
) from public, anon, authenticated, service_role,
       fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
       fetanagent_customer_web, fetanagent_customer_web_runtime,
       fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
       fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

comment on function app.capture_telegram_cbe_birr_bound_dry_run_proof(
  uuid, uuid, text, text, text, text, smallint, smallint, text
) is
  'Ungranted atomic dry-run candidate: captures a Telegram CBE Birr proof and binds its exact previously issued v2 receiver instruction in the same transaction. Always requires all financial switches disabled and an always-blocked metadata preflight; no lease or credit.';

commit;
