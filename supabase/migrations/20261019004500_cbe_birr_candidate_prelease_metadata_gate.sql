-- Metadata-only prelease gate for one opaque, instruction-bound CBE Birr candidate.
-- It always blocks leasing and protected material. No runtime role receives this grant.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create role fetanagent_cbe_birr_candidate_prelease
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

create function app.preflight_routine_cbe_birr_candidate(p_candidate_id uuid)
returns table (
  candidate_id uuid,
  preflight_version text,
  eligibility text,
  blocker_code text,
  lease_allowed boolean,
  protected_material_allowed boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_candidate_id is null then
    raise exception 'The routine CBE Birr candidate prelease request is invalid.';
  end if;

  if not exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
       and feature_switch.mode = 'disabled'
  ) then
    raise exception 'Routine CBE Birr candidate prelease requires verification disabled.';
  end if;

  return query
  select candidate.id,
         'cbe-birr-candidate-prelease-v1'::text,
         'blocked'::text,
         case
           when proof_gate.proof_request_id = candidate.proof_request_id
             and proof_gate.preflight_version = 'cbe-birr-proof-preflight-v2'
             and proof_gate.eligibility = 'blocked'
             and proof_gate.blocker_code = 'receiver_v2_instruction_bound_metadata_only'
             and proof_gate.lease_allowed = false
             and proof_gate.protected_material_allowed = false
             and receiver.status = 'active'
             and receiver.retired_at is null
             and lookup.protection_profile_version = 2
             and lookup.encryption_key_version = 2
             and lookup.fingerprint_key_version = 2
             then 'receiver_v2_candidate_bound_metadata_only'::text
           else 'candidate_lineage_review_required'::text
         end,
         false,
         false
    from app.routine_cbe_birr_candidates candidate
    left join lateral app.preflight_cbe_birr_proof_request(candidate.proof_request_id)
      proof_gate on true
    left join app.cbe_birr_instruction_proof_bindings binding
      on binding.proof_request_id = candidate.proof_request_id
    left join app.receiver_accounts receiver
      on receiver.id = binding.receiver_revision_id
     and receiver.version = binding.receiver_version
     and receiver.rotation_request_id = binding.receiver_rotation_request_id
     and receiver.provider_id = binding.payment_provider_id
    left join app.cbe_birr_receiver_lookup_revisions lookup
      on lookup.receiver_revision_id = binding.receiver_revision_id
     and lookup.receiver_version = binding.receiver_version
     and lookup.rotation_request_id = binding.receiver_rotation_request_id
   where candidate.id = p_candidate_id
     and candidate.contract_version = 1;
end;
$$;

alter function app.preflight_routine_cbe_birr_candidate(uuid) owner to postgres;
revoke all on function app.preflight_routine_cbe_birr_candidate(uuid) from public;
grant usage on schema app to fetanagent_cbe_birr_candidate_prelease;
grant execute on function app.preflight_routine_cbe_birr_candidate(uuid)
  to fetanagent_cbe_birr_candidate_prelease;

comment on role fetanagent_cbe_birr_candidate_prelease is
  'NOLOGIN, metadata-only CBE candidate prelease role. No table, lease, material, provider, or financial access.';
comment on function app.preflight_routine_cbe_birr_candidate(uuid) is
  'Rechecks one opaque CBE candidate against its bound proof and currently active v2 receiver revision. Always blocks leasing and material; no runtime grant.';

commit;
