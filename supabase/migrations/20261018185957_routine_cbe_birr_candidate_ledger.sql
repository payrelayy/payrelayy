-- Inert CBE Birr candidate lineage for the new amount-free proof path. This ledger stores only
-- an opaque pointer to an immutable, instruction-bound proof. It has no verifier lease, result,
-- provider request, claim, execution, or runtime grant.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create table app.routine_cbe_birr_candidates (
  id uuid primary key default gen_random_uuid(),
  proof_request_id uuid not null unique
    references app.cbe_birr_instruction_proof_bindings (proof_request_id)
    on delete restrict,
  contract_version smallint not null default 1
    check (contract_version = 1),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create function app.reject_routine_cbe_birr_candidate_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'Routine CBE Birr candidate lineage is immutable.';
end;
$$;

create trigger routine_cbe_birr_candidates_immutable
before update or delete on app.routine_cbe_birr_candidates
for each row execute function app.reject_routine_cbe_birr_candidate_mutation();

create trigger routine_cbe_birr_candidates_no_truncate
before truncate on app.routine_cbe_birr_candidates
for each statement execute function app.reject_routine_cbe_birr_candidate_mutation();

create function app.enqueue_routine_cbe_birr_candidate(p_proof_request_id uuid)
returns table (candidate_id uuid, already_recorded boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_preflight record;
  v_candidate_id uuid;
begin
  if p_proof_request_id is null then
    raise exception 'The routine CBE Birr candidate request is invalid.';
  end if;

  -- This CBE-only, no-money boundary does not depend on TeleBirr's two live switches.
  -- A future verifier must have its own separately reviewed processing authorization.
  perform 1
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
     and feature_switch.mode = 'disabled'
   for share;
  if not found then
    raise exception 'Routine CBE Birr candidate intake requires CBE verification disabled.';
  end if;

  select decision.* into v_preflight
    from app.preflight_cbe_birr_proof_request(p_proof_request_id) decision;
  if not found then
    raise exception 'The routine CBE Birr candidate lineage is unavailable.';
  end if;
  if v_preflight.proof_request_id is distinct from p_proof_request_id
    or v_preflight.preflight_version is distinct from 'cbe-birr-proof-preflight-v2'
    or v_preflight.eligibility is distinct from 'blocked'
    or v_preflight.blocker_code is distinct from 'receiver_v2_instruction_bound_metadata_only'
    or v_preflight.lease_allowed is distinct from false
    or v_preflight.protected_material_allowed is distinct from false then
    raise exception 'The routine CBE Birr candidate lineage is unavailable.';
  end if;

  insert into app.routine_cbe_birr_candidates (proof_request_id)
  values (p_proof_request_id)
  on conflict (proof_request_id) do nothing
  returning id into v_candidate_id;
  if found then
    return query select v_candidate_id, false;
    return;
  end if;

  select candidate.id into v_candidate_id
    from app.routine_cbe_birr_candidates candidate
   where candidate.proof_request_id = p_proof_request_id;
  if not found then
    raise exception 'The routine CBE Birr candidate replay is unavailable.';
  end if;
  return query select v_candidate_id, true;
end;
$$;

alter table app.routine_cbe_birr_candidates enable row level security;
alter table app.routine_cbe_birr_candidates force row level security;
alter table app.routine_cbe_birr_candidates owner to postgres;
alter function app.reject_routine_cbe_birr_candidate_mutation() owner to postgres;
alter function app.enqueue_routine_cbe_birr_candidate(uuid) owner to postgres;

revoke all on app.routine_cbe_birr_candidates
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function app.reject_routine_cbe_birr_candidate_mutation(),
  app.enqueue_routine_cbe_birr_candidate(uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

comment on table app.routine_cbe_birr_candidates is
  'Inert, immutable opaque pointer to one instruction-bound CBE Birr proof. No runtime grant, lease, protected material, verification result, claim, or credit.';
comment on function app.enqueue_routine_cbe_birr_candidate(uuid) is
  'Ungranted, idempotent CBE-only no-money candidate enrollment. Requires the exact blocked v2 proof preflight and disabled CBE verification; returns only an opaque ID and replay flag.';

commit;
