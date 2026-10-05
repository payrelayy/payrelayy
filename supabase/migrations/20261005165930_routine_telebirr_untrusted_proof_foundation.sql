-- Amount-free, non-pilot TeleBirr candidate lineage. This is deliberately inert:
-- no application role can write or read it, and no verifier, claim, settlement,
-- execution job, or financial switch is created or changed by this migration.
-- A later reviewed capture boundary must authenticate the origin identity and
-- recheck the Player and policy before inserting any customer submission.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_untrusted_proof_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  origin_identity_id uuid not null,
  origin_channel text not null
    check (origin_channel in ('telegram', 'customer_web')),
  origin_request_key uuid not null
    check (origin_request_key::text ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  semantic_input_hmac text not null
    check (semantic_input_hmac = pg_catalog.lower(pg_catalog.btrim(semantic_input_hmac))
      and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'),
  platform_id uuid not null
    references app.platforms (id) on delete restrict,
  player_account_id uuid not null,
  player_deposit_eligibility_decision_id uuid not null,
  payment_provider_id uuid not null,
  provider_code text not null default 'telebirr'
    check (provider_code = 'telebirr'),
  candidate_reference_ciphertext text not null
    check (candidate_reference_ciphertext = pg_catalog.btrim(candidate_reference_ciphertext)
      and pg_catalog.char_length(candidate_reference_ciphertext) between 50 and 512
      and candidate_reference_ciphertext
        ~ '^v2\.telebirr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'),
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_reference_masked text not null
    check (candidate_reference_masked = pg_catalog.btrim(candidate_reference_masked)
      and candidate_reference_masked ~ '^\*{3}[A-Z0-9]{4}$'),
  reference_encryption_key_version smallint not null check (reference_encryption_key_version = 2),
  reference_profile_version smallint not null check (reference_profile_version = 2),
  submitted_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_telebirr_untrusted_origin_customer_fkey
    foreign key (origin_identity_id, submitting_customer_id)
    references app.customer_identities (id, customer_id) on delete restrict,
  constraint routine_telebirr_untrusted_player_platform_fkey
    foreign key (player_account_id, platform_id)
    references app.customer_platform_players (id, platform_id) on delete restrict,
  constraint routine_telebirr_untrusted_eligibility_fkey
    foreign key (player_deposit_eligibility_decision_id, player_account_id)
    references app.player_deposit_eligibility_decisions (id, player_account_id) on delete restrict,
  constraint routine_telebirr_untrusted_provider_fkey
    foreign key (payment_provider_id, provider_code)
    references app.payment_providers (id, code) on delete restrict,
  constraint routine_telebirr_untrusted_proof_customer_key
    unique (id, submitting_customer_id),
  constraint routine_telebirr_untrusted_origin_key
    unique (origin_channel, origin_identity_id, origin_request_key)
);

-- A candidate reference is intentionally not globally unique: only a fresh,
-- authoritative provider observation may win the eventual one-use payment claim.
create index routine_telebirr_untrusted_customer_submitted_idx
  on app.routine_telebirr_untrusted_proof_requests
    (submitting_customer_id, submitted_at desc, id);
create index routine_telebirr_untrusted_origin_identity_idx
  on app.routine_telebirr_untrusted_proof_requests
    (origin_identity_id, submitting_customer_id);
create index routine_telebirr_untrusted_platform_idx
  on app.routine_telebirr_untrusted_proof_requests (platform_id);
create index routine_telebirr_untrusted_provider_reference_idx
  on app.routine_telebirr_untrusted_proof_requests
    (payment_provider_id, candidate_reference_fingerprint, submitted_at, id);
create index routine_telebirr_untrusted_player_submitted_idx
  on app.routine_telebirr_untrusted_proof_requests
    (player_account_id, submitted_at desc, id);
create index routine_telebirr_untrusted_eligibility_idx
  on app.routine_telebirr_untrusted_proof_requests
    (player_deposit_eligibility_decision_id, player_account_id);

create function app.reject_routine_telebirr_untrusted_proof_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Routine TeleBirr untrusted proof records are append-only.';
end;
$$;

create trigger routine_telebirr_untrusted_proof_immutable
before update or delete on app.routine_telebirr_untrusted_proof_requests
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();

create trigger routine_telebirr_untrusted_proof_no_truncate
before truncate on app.routine_telebirr_untrusted_proof_requests
for each statement execute function app.reject_routine_telebirr_untrusted_proof_mutation();

alter table app.routine_telebirr_untrusted_proof_requests enable row level security;
alter table app.routine_telebirr_untrusted_proof_requests force row level security;

revoke all on table app.routine_telebirr_untrusted_proof_requests
  from public, anon, authenticated, service_role,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_customer_web, fetanagent_customer_web_runtime,
    fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke all on function app.reject_routine_telebirr_untrusted_proof_mutation()
  from public, anon, authenticated, service_role;

comment on table app.routine_telebirr_untrusted_proof_requests is
  'Dormant, immutable non-pilot TeleBirr candidate boundary. References and destinations are untrusted; this table cannot establish amount, receiver match, payment claim, settlement, or execution.';

commit;
