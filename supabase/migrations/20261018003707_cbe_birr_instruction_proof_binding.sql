-- Default-off CBE Birr instruction and proof lineage. A proof can only name the exact
-- immutable receiver lookup revision snapshotted by its instruction. No runtime role may
-- write these tables, and the read-only preflight always blocks leasing and material access.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.receiver_accounts
  add constraint receiver_accounts_id_provider_id_key unique (id, provider_id);

alter table app.cbe_birr_receiver_lookup_revisions
  add constraint cbe_birr_receiver_lookup_revision_snapshot_key
  unique (receiver_revision_id, receiver_version, rotation_request_id);

alter table app.deposit_proof_requests
  add constraint deposit_proof_requests_instruction_binding_identity_key
  unique (
    id, submitting_customer_id, player_account_id, payment_provider_id, origin_channel
  );

create table app.cbe_birr_payment_instructions (
  id uuid primary key default gen_random_uuid(),
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  payment_provider_id uuid not null,
  provider_code text not null default 'cbe_birr'
    check (provider_code = 'cbe_birr'),
  origin_channel text not null
    check (origin_channel in ('telegram', 'customer_web')),
  receiver_revision_id uuid not null,
  receiver_version integer not null check (receiver_version > 0),
  receiver_rotation_request_id uuid not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint cbe_birr_payment_instructions_one_hour_check
    check (expires_at = issued_at + interval '1 hour'),
  constraint cbe_birr_payment_instructions_provider_fkey
    foreign key (payment_provider_id, provider_code)
    references app.payment_providers (id, code) on delete restrict,
  constraint cbe_birr_payment_instructions_receiver_provider_fkey
    foreign key (receiver_revision_id, payment_provider_id)
    references app.receiver_accounts (id, provider_id) on delete restrict,
  constraint cbe_birr_payment_instructions_lookup_snapshot_fkey
    foreign key (
      receiver_revision_id, receiver_version, receiver_rotation_request_id
    ) references app.cbe_birr_receiver_lookup_revisions (
      receiver_revision_id, receiver_version, rotation_request_id
    ) on delete restrict,
  constraint cbe_birr_payment_instructions_binding_identity_key
    unique (
      id, submitting_customer_id, player_account_id, payment_provider_id,
      origin_channel, receiver_revision_id, receiver_version,
      receiver_rotation_request_id
    )
);

create index cbe_birr_payment_instructions_customer_issued_idx
  on app.cbe_birr_payment_instructions (submitting_customer_id, issued_at desc, id);

create table app.cbe_birr_instruction_proof_bindings (
  proof_request_id uuid primary key,
  instruction_id uuid not null unique,
  submitting_customer_id uuid not null,
  player_account_id uuid not null,
  payment_provider_id uuid not null,
  origin_channel text not null
    check (origin_channel in ('telegram', 'customer_web')),
  receiver_revision_id uuid not null,
  receiver_version integer not null check (receiver_version > 0),
  receiver_rotation_request_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint cbe_birr_instruction_proof_bindings_proof_fkey
    foreign key (
      proof_request_id, submitting_customer_id, player_account_id,
      payment_provider_id, origin_channel
    ) references app.deposit_proof_requests (
      id, submitting_customer_id, player_account_id,
      payment_provider_id, origin_channel
    ) on delete restrict,
  constraint cbe_birr_instruction_proof_bindings_instruction_fkey
    foreign key (
      instruction_id, submitting_customer_id, player_account_id,
      payment_provider_id, origin_channel, receiver_revision_id,
      receiver_version, receiver_rotation_request_id
    ) references app.cbe_birr_payment_instructions (
      id, submitting_customer_id, player_account_id,
      payment_provider_id, origin_channel, receiver_revision_id,
      receiver_version, receiver_rotation_request_id
    ) on delete restrict
);

create index cbe_birr_instruction_proof_bindings_receiver_idx
  on app.cbe_birr_instruction_proof_bindings (
    receiver_revision_id, receiver_version, proof_request_id
  );

create function app.reject_cbe_birr_instruction_proof_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'CBE Birr instruction and proof bindings are immutable.';
end;
$$;

create trigger cbe_birr_payment_instructions_immutable
before update or delete on app.cbe_birr_payment_instructions
for each row execute function app.reject_cbe_birr_instruction_proof_mutation();

create trigger cbe_birr_payment_instructions_no_truncate
before truncate on app.cbe_birr_payment_instructions
for each statement execute function app.reject_cbe_birr_instruction_proof_mutation();

create trigger cbe_birr_instruction_proof_bindings_immutable
before update or delete on app.cbe_birr_instruction_proof_bindings
for each row execute function app.reject_cbe_birr_instruction_proof_mutation();

create trigger cbe_birr_instruction_proof_bindings_no_truncate
before truncate on app.cbe_birr_instruction_proof_bindings
for each statement execute function app.reject_cbe_birr_instruction_proof_mutation();

alter table app.cbe_birr_payment_instructions enable row level security;
alter table app.cbe_birr_payment_instructions force row level security;
alter table app.cbe_birr_instruction_proof_bindings enable row level security;
alter table app.cbe_birr_instruction_proof_bindings force row level security;

alter table app.cbe_birr_payment_instructions owner to postgres;
alter table app.cbe_birr_instruction_proof_bindings owner to postgres;
alter function app.reject_cbe_birr_instruction_proof_mutation() owner to postgres;

revoke all on app.cbe_birr_payment_instructions,
  app.cbe_birr_instruction_proof_bindings
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function app.reject_cbe_birr_instruction_proof_mutation()
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker, fetanagent_cbe_birr_proof_preflight,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

create or replace function app.preflight_cbe_birr_proof_request(p_proof_request_id uuid)
returns table (
  proof_request_id uuid,
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
  if p_proof_request_id is null then
    raise exception 'The CBE Birr proof preflight request is invalid.';
  end if;

  if not exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key = 'cbe_birr_authoritative_verification'
       and feature_switch.mode = 'disabled'
  ) then
    raise exception 'CBE Birr proof preflight requires verification to remain disabled.';
  end if;

  return query
  select proof.id,
         'cbe-birr-proof-preflight-v2'::text,
         'blocked'::text,
         case
           when binding.proof_request_id is null
             then 'instruction_binding_unavailable'::text
           when instruction.id is null or receiver.id is null
             then 'receiver_revision_unavailable'::text
           when proof.submitted_at < instruction.issued_at
             or proof.submitted_at < instruction.created_at
             or proof.submitted_at >= instruction.expires_at
             then 'instruction_time_window_review_required'::text
           when receiver.active_from > instruction.issued_at
             or (receiver.retired_at is not null
                 and receiver.retired_at <= proof.submitted_at)
             then 'receiver_revision_retired_at_submission'::text
           else 'receiver_v2_instruction_bound_metadata_only'::text
         end,
         false,
         false
    from app.deposit_proof_requests proof
    left join app.cbe_birr_instruction_proof_bindings binding
      on binding.proof_request_id = proof.id
    left join app.cbe_birr_payment_instructions instruction
      on instruction.id = binding.instruction_id
    left join app.receiver_accounts receiver
      on receiver.id = binding.receiver_revision_id
     and receiver.version = binding.receiver_version
     and receiver.rotation_request_id = binding.receiver_rotation_request_id
     and receiver.provider_id = binding.payment_provider_id
   where proof.id = p_proof_request_id
     and proof.provider_code = 'cbe_birr'
     and proof.status = 'proof_received'
     and proof.reference_profile_version = 2
     and proof.reference_encryption_key_version = 2;
end;
$$;

alter function app.preflight_cbe_birr_proof_request(uuid) owner to postgres;
revoke all on function app.preflight_cbe_birr_proof_request(uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;
grant execute on function app.preflight_cbe_birr_proof_request(uuid)
to fetanagent_cbe_birr_proof_preflight;

comment on table app.cbe_birr_payment_instructions is
  'Private, immutable CBE Birr instruction snapshots of a fresh receiver lookup revision. No runtime insert grant or payment authority.';
comment on table app.cbe_birr_instruction_proof_bindings is
  'Private one-to-one dry-run proof to instruction and exact receiver-revision lineage. No runtime insert grant or payment authority.';
comment on function app.preflight_cbe_birr_proof_request(uuid) is
  'Read-only, always-blocked v2 CBE Birr proof preflight. Checks exact instruction and receiver revision lineage without leasing, protected material, or payment authority.';

commit;
