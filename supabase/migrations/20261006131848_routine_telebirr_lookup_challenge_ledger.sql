-- Inert, non-pilot lookup challenge lineage. The composite FK pins the exact untrusted
-- candidate reference fingerprint, receiver revision, and intake timestamp. It does not
-- attest device enrollment, authenticate a TeleBirr source, or create a payment claim.
-- No application role can access either table. The 7-day candidate purge cascades these
-- digest-only rows so the untrusted reference fingerprint does not outlive its candidate.

begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table app.routine_telebirr_untrusted_proof_requests
  add constraint routine_telebirr_candidate_lookup_snapshot_key
    unique (id, receiver_account_id, receiver_account_version,
            candidate_reference_fingerprint, submitted_at);

create table app.routine_telebirr_lookup_challenges (
  challenge_id uuid primary key default pg_catalog.gen_random_uuid()
    check (challenge_id::text ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  candidate_id uuid not null,
  receiver_account_id uuid not null,
  receiver_account_version integer not null check (receiver_account_version > 0),
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_submitted_at timestamptz not null,
  device_id text not null
    check (device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_key_id text not null
    check (device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_public_key_spki_sha256 text not null
    check (device_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  challenge_digest text not null unique
    check (challenge_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_profile text not null default 'telebirr_official_receipt_v1'
    check (source_profile = 'telebirr_official_receipt_v1'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  constraint routine_telebirr_lookup_candidate_snapshot_fkey
    foreign key (candidate_id, receiver_account_id, receiver_account_version,
                 candidate_reference_fingerprint, candidate_submitted_at)
    references app.routine_telebirr_untrusted_proof_requests
      (id, receiver_account_id, receiver_account_version,
       candidate_reference_fingerprint, submitted_at)
    on delete cascade,
  constraint routine_telebirr_lookup_challenge_window_check
    check (issued_at >= candidate_submitted_at
      and issued_at < candidate_submitted_at + interval '7 days'
      and expires_at > issued_at
      and expires_at <= issued_at + interval '5 minutes'
      and expires_at <= candidate_submitted_at + interval '7 days')
);

create index routine_telebirr_lookup_candidate_idx
  on app.routine_telebirr_lookup_challenges (candidate_id, issued_at desc, challenge_id);

-- This is a one-observation-per-challenge receipt, NOT a one-use provider payment claim.
-- Future upload code must verify the device signature and independently authenticate the
-- official source before using it for any decision. No caller is granted INSERT today.
create table app.routine_telebirr_observation_receipts (
  challenge_id uuid primary key
    references app.routine_telebirr_lookup_challenges (challenge_id) on delete cascade,
  observation_body_digest text not null
    check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  observation_signature_digest text not null
    check (observation_signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  received_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table app.routine_telebirr_lookup_challenges owner to postgres;
alter table app.routine_telebirr_observation_receipts owner to postgres;
alter table app.routine_telebirr_lookup_challenges enable row level security;
alter table app.routine_telebirr_lookup_challenges force row level security;
alter table app.routine_telebirr_observation_receipts enable row level security;
alter table app.routine_telebirr_observation_receipts force row level security;

revoke all on table app.routine_telebirr_lookup_challenges,
                    app.routine_telebirr_observation_receipts
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_customer_web, fetanagent_customer_web_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on table app.routine_telebirr_lookup_challenges is
  'Dormant no-money routine lookup ledger. Its composite FK pins an untrusted candidate snapshot; device enrollment, signer, source, and payment are not authenticated here.';
comment on table app.routine_telebirr_observation_receipts is
  'Dormant digest-only one-observation-per-challenge receipt, not a provider payment claim or financial decision.';

commit;
