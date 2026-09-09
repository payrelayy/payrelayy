-- Add an authenticated, no-money TeleBirr shadow-verification lineage for the armed dry-run
-- pilot. The shadow path deliberately does not reference or write the live proof, claim,
-- reservation, settlement, execution-job, or KemerBet-action ledgers. It reuses only the signed
-- assignment/observation wire contracts and the already-enrolled device/signer trust roots.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create role fetanagent_telebirr_shadow_verifier
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_telebirr_shadow_verifier_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant fetanagent_telebirr_shadow_verifier
  to fetanagent_telebirr_shadow_verifier_runtime
  with inherit true, set false, admin false;

create function app.require_telebirr_shadow_verifier_session()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  runtime_is_currently_authorized boolean;
begin
  if session_user = 'postgres' then
    return;
  end if;

  select exists (
    select 1
      from pg_catalog.pg_roles role
     where role.rolname = session_user
       and role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime'
       and role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not null
       and role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
       and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
  ) into runtime_is_currently_authorized;

  if runtime_is_currently_authorized is not true then
    raise exception 'The TeleBirr shadow verifier session is not currently authorized.';
  end if;
end;
$$;

create unique index private_live_telebirr_receiver_profiles_shadow_identity_idx
  on app.private_live_telebirr_receiver_profiles (id, pilot_revision_id, payment_provider_id);

create table app.private_telebirr_shadow_proof_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  verification_job_id uuid not null unique default pg_catalog.gen_random_uuid(),
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  submitting_customer_id uuid not null
    references app.customers (id) on delete restrict,
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  provider_code text not null default 'telebirr' check (provider_code = 'telebirr'),
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  pilot_configuration_digest text not null
    check (pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  origin_channel text not null default 'telegram' check (origin_channel = 'telegram'),
  input_kind text not null default 'direct_transaction_id'
    check (input_kind = 'direct_transaction_id'),
  candidate_reference_ciphertext text not null,
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_reference_masked text not null
    check (
      candidate_reference_masked = pg_catalog.btrim(candidate_reference_masked)
      and candidate_reference_masked ~ '^\*{3}[A-Z0-9]{4}$'
    ),
  reference_encryption_key_version smallint not null check (reference_encryption_key_version = 2),
  reference_profile_version smallint not null check (reference_profile_version = 2),
  proof_status text not null default 'verification_queued'
    check (proof_status = 'verification_queued'),
  submitted_at timestamptz not null default pg_catalog.clock_timestamp(),
  not_before timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_telebirr_shadow_proof_ciphertext_check check (
    candidate_reference_ciphertext = pg_catalog.btrim(candidate_reference_ciphertext)
    and pg_catalog.char_length(candidate_reference_ciphertext) between 50 and 512
    and candidate_reference_ciphertext
      ~ '^v2\.telebirr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
  ),
  constraint private_telebirr_shadow_proof_window_check check (
    not_before = submitted_at
    and expires_at > not_before
    and expires_at <= submitted_at + interval '5 minutes'
  ),
  constraint private_telebirr_shadow_proof_customer_fkey
    foreign key (pilot_revision_id, submitting_customer_id)
    references app.private_live_deposit_pilot_customers (pilot_revision_id, customer_id)
    on delete restrict,
  constraint private_telebirr_shadow_proof_player_fkey
    foreign key (pilot_revision_id, player_account_id)
    references app.private_live_deposit_pilot_players (pilot_revision_id, player_account_id)
    on delete restrict,
  constraint private_telebirr_shadow_proof_provider_fkey
    foreign key (pilot_revision_id, payment_provider_id)
    references app.private_live_deposit_pilot_providers (pilot_revision_id, payment_provider_id)
    on delete restrict,
  constraint private_telebirr_shadow_proof_profile_fkey
    foreign key (receiver_profile_id, pilot_revision_id, payment_provider_id)
    references app.private_live_telebirr_receiver_profiles (
      id, pilot_revision_id, payment_provider_id
    ) on delete restrict,
  constraint private_telebirr_shadow_proof_id_job_key
    unique (id, verification_job_id),
  constraint private_telebirr_shadow_provider_reference_key
    unique (payment_provider_id, candidate_reference_fingerprint)
);

create index private_telebirr_shadow_proofs_claimable_idx
  on app.private_telebirr_shadow_proof_requests (not_before, expires_at, submitted_at, id);
create index private_telebirr_shadow_proofs_pilot_idx
  on app.private_telebirr_shadow_proof_requests (pilot_revision_id, submitted_at, id);
create index private_telebirr_shadow_proofs_customer_idx
  on app.private_telebirr_shadow_proof_requests (submitting_customer_id, submitted_at desc, id);

create table app.telegram_telebirr_shadow_proof_receipts (
  origin_inbound_event_id uuid primary key
    references app.inbound_events (id) on delete restrict,
  customer_identity_id uuid not null,
  submitting_customer_id uuid not null,
  conversation_id uuid not null references app.bot_conversations (id) on delete restrict,
  shadow_proof_request_id uuid not null unique
    references app.private_telebirr_shadow_proof_requests (id) on delete restrict,
  semantic_input_hmac text not null check (
    semantic_input_hmac = pg_catalog.lower(pg_catalog.btrim(semantic_input_hmac))
    and semantic_input_hmac ~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$'
  ),
  conversation_version bigint not null check (conversation_version >= 0),
  created_at timestamptz not null,
  constraint telegram_telebirr_shadow_receipt_identity_customer_fkey
    foreign key (customer_identity_id, submitting_customer_id)
    references app.customer_identities (id, customer_id) on delete restrict
);

create table app.private_telebirr_shadow_verification_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  shadow_proof_request_id uuid not null
    references app.private_telebirr_shadow_proof_requests (id) on delete restrict,
  verification_job_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 100),
  lease_request_key uuid not null unique,
  lease_request_digest text not null unique check (lease_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  lease_token uuid not null unique,
  request_id uuid not null unique,
  assignment_id uuid not null unique,
  requested_lease_seconds integer not null check (requested_lease_seconds between 30 and 300),
  leased_by text not null check (
    leased_by = pg_catalog.btrim(leased_by)
    and leased_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  device_enrollment_id uuid not null
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  device_id_snapshot text not null,
  device_key_id_snapshot text not null,
  device_public_key_spki_sha256_snapshot text not null
    check (device_public_key_spki_sha256_snapshot ~ '^sha256:[0-9a-f]{64}$'),
  lease_nonce_digest text not null unique check (lease_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  challenge_id uuid not null unique,
  challenge_digest text not null unique check (challenge_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_telebirr_shadow_attempt_request_key_v4_check check (
    lease_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_telebirr_shadow_attempt_window_check check (
    expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'
  ),
  constraint private_telebirr_shadow_attempt_proof_job_fkey
    foreign key (shadow_proof_request_id, verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_telebirr_shadow_attempt_number_key
    unique (verification_job_id, attempt_number)
);

create index private_telebirr_shadow_attempts_job_idx
  on app.private_telebirr_shadow_verification_attempts (
    verification_job_id, expires_at desc, attempt_number desc
  );

create table app.private_telebirr_shadow_assignment_transcripts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  verification_attempt_id uuid not null unique
    references app.private_telebirr_shadow_verification_attempts (id) on delete restrict,
  assignment_signer_id uuid not null
    references app.private_live_telebirr_assignment_signers (id) on delete restrict,
  assignment_body_digest text not null unique
    check (assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_signature text not null check (assignment_signature ~ '^[A-Za-z0-9_-]{86}$'),
  assignment_signature_digest text not null unique
    check (assignment_signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  signer_key_id_snapshot text not null,
  signer_public_key_spki_sha256_snapshot text not null
    check (signer_public_key_spki_sha256_snapshot ~ '^sha256:[0-9a-f]{64}$'),
  reference_binding_digest text not null unique
    check (reference_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table app.private_telebirr_shadow_device_evidence_staging (
  observation_body_digest text primary key check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_body_digest text not null unique
    references app.private_telebirr_shadow_assignment_transcripts (assignment_body_digest)
      on delete restrict,
  verification_attempt_id uuid not null unique
    references app.private_telebirr_shadow_verification_attempts (id) on delete restrict,
  assignment_transcript_id uuid not null unique
    references app.private_telebirr_shadow_assignment_transcripts (id) on delete restrict,
  device_enrollment_id uuid not null
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  first_request_body_digest text not null check (first_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_assignment jsonb not null check (
    pg_catalog.jsonb_typeof(signed_assignment) = 'object'
    and pg_catalog.pg_column_size(signed_assignment) <= 131072
  ),
  signed_observation jsonb not null check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.pg_column_size(signed_observation) <= 131072
  ),
  observed_at timestamptz not null,
  staged_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index private_telebirr_shadow_evidence_pending_idx
  on app.private_telebirr_shadow_device_evidence_staging (staged_at, observation_body_digest);

create table app.private_telebirr_shadow_verification_outcomes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  verification_attempt_id uuid not null unique
    references app.private_telebirr_shadow_verification_attempts (id) on delete restrict,
  shadow_proof_request_id uuid not null unique
    references app.private_telebirr_shadow_proof_requests (id) on delete restrict,
  verification_job_id uuid not null unique,
  completion_request_key uuid not null unique,
  completion_request_digest text not null unique
    check (completion_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  observation_body_digest text not null unique
    references app.private_telebirr_shadow_device_evidence_staging (observation_body_digest)
      on delete restrict,
  observation_signature_digest text not null unique
    check (observation_signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  replay_identity text not null unique check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  source_document_digest text not null unique
    check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  normalized_facts_digest text not null check (normalized_facts_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  protocol_disposition text not null
    check (protocol_disposition in ('would_review', 'would_forward_signed_evidence')),
  protocol_reason_code text not null,
  assessment_input_digest text not null unique
    check (assessment_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  assessed_at timestamptz not null,
  disposition text not null
    check (disposition in ('definite_reject', 'review_required', 'settlement_candidate')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  evidence_digest text not null unique check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  retrieved_at timestamptz not null,
  principal_amount_minor bigint,
  occurred_at timestamptz,
  receiver_identity_digest text check (
    receiver_identity_digest is null or receiver_identity_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  would_verify boolean generated always as (disposition = 'settlement_candidate') stored,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_telebirr_shadow_outcome_request_key_v4_check check (
    completion_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_telebirr_shadow_outcome_proof_job_fkey
    foreign key (shadow_proof_request_id, verification_job_id)
    references app.private_telebirr_shadow_proof_requests (id, verification_job_id)
    on delete restrict,
  constraint private_telebirr_shadow_outcome_financial_facts_check check (
    (
      disposition = 'settlement_candidate'
      and reason_code = 'exact_proof_match'
      and principal_amount_minor is not null
      and principal_amount_minor > 0
      and occurred_at is not null
      and receiver_identity_digest is not null
    ) or (
      disposition <> 'settlement_candidate'
      and principal_amount_minor is null
      and occurred_at is null
      and receiver_identity_digest is null
    )
  )
);

create table app.private_telebirr_shadow_evidence_quarantine (
  observation_body_digest text primary key
    references app.private_telebirr_shadow_device_evidence_staging (observation_body_digest)
      on delete restrict,
  verification_attempt_id uuid not null unique
    references app.private_telebirr_shadow_verification_attempts (id) on delete restrict,
  reason_code text not null check (reason_code = 'trusted_evidence_invalid'),
  quarantined_at timestamptz not null default pg_catalog.clock_timestamp()
);

create function app.private_telebirr_shadow_mode_is_ready(p_pilot_revision_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  select p_pilot_revision_id is not null
    and (
      select pg_catalog.count(*) = 6
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'payment_verification',
         'deposit_execution',
         'withdrawal_validation',
         'withdrawal_collection',
         'cbe_birr_authoritative_verification',
         'telebirr_authoritative_verification'
       )
         and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb
    )
    and exists (
      select 1
        from app.feature_switches pilot_switch
        join app.private_live_deposit_pilot_revisions pilot
          on pilot.id = p_pilot_revision_id
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'dry_run'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
         and pilot.status = 'armed'
         and pilot.configuration_digest is not null
         and pg_catalog.clock_timestamp() >= pilot.active_from
         and pg_catalog.clock_timestamp() < pilot.expires_at
    );
$$;

create function app.require_private_telebirr_shadow_mode_ready(p_pilot_revision_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  locked_switch_count integer;
  locked_pilot_revision_id uuid;
begin
  if p_pilot_revision_id is null then
    raise exception 'The no-money TeleBirr shadow verification authority is unavailable.';
  end if;

  -- Every shadow writer holds the same seven feature rows until its transaction ends. The
  -- deterministic key order matches pilot arm/stop and makes an activating writer wait before any
  -- shadow row can be committed under stale gate state.
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection',
     'cbe_birr_authoritative_verification',
     'telebirr_authoritative_verification',
     'private_live_deposit_pilot'
   )
   order by feature_switch.feature_key
   for share;
  get diagnostics locked_switch_count = row_count;

  select pilot.id
    into locked_pilot_revision_id
    from app.private_live_deposit_pilot_revisions pilot
   where pilot.id = p_pilot_revision_id
   for share;

  if locked_switch_count <> 7
    or locked_pilot_revision_id is null
    or not app.private_telebirr_shadow_mode_is_ready(p_pilot_revision_id) then
    raise exception 'The no-money TeleBirr shadow verification authority is unavailable.';
  end if;
end;
$$;

create function app.get_owner_telebirr_shadow_verification_status(
  p_actor_auth_user_id uuid
)
returns table (
  contract_version smallint,
  verification_mode text,
  pilot_state text,
  switch_mode text,
  shadow_mode_ready boolean,
  proof_count bigint,
  claimable_proof_count bigint,
  active_assignment_count bigint,
  staged_evidence_count bigint,
  completed_count bigint,
  would_verify_count bigint,
  would_review_count bigint,
  would_reject_count bigint,
  quarantined_count bigint,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  now_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  current_switch_mode text;
begin
  perform app.require_owner_kemerbet_agent_profile_controller();

  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active';
  if actor_admin_id is null then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;

  select candidate.* into pilot
    from app.private_live_deposit_pilot_revisions candidate
   order by candidate.revision desc
   limit 1;

  select feature_switch.mode into current_switch_mode
    from app.feature_switches feature_switch
   where feature_switch.feature_key = 'private_live_deposit_pilot';

  return query
  select 1::smallint,
         'shadow_no_money'::text,
         coalesce(pilot.status::text, 'absent'),
         coalesce(current_switch_mode, 'absent'),
         coalesce(app.private_telebirr_shadow_mode_is_ready(pilot.id), false),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_proof_requests proof
            where proof.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_proof_requests proof
            where proof.pilot_revision_id = pilot.id
              and app.private_telebirr_shadow_mode_is_ready(pilot.id)
              and now_at >= proof.not_before
              and now_at < proof.expires_at
              and not exists (
                select 1 from app.private_telebirr_shadow_verification_outcomes outcome
                 where outcome.shadow_proof_request_id = proof.id
              )
              and not exists (
                select 1 from app.private_telebirr_shadow_verification_attempts attempt
                 where attempt.shadow_proof_request_id = proof.id
                   and now_at < attempt.expires_at
              )
              and (
                select pg_catalog.count(*)
                  from app.private_telebirr_shadow_verification_attempts attempt
                 where attempt.shadow_proof_request_id = proof.id
              ) < 100
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_verification_attempts attempt
             join app.private_telebirr_shadow_proof_requests proof
               on proof.id = attempt.shadow_proof_request_id
            where proof.pilot_revision_id = pilot.id
              and now_at < attempt.expires_at
              and not exists (
                select 1 from app.private_telebirr_shadow_verification_outcomes outcome
                 where outcome.verification_attempt_id = attempt.id
              )
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_device_evidence_staging staged
             join app.private_telebirr_shadow_verification_attempts attempt
               on attempt.id = staged.verification_attempt_id
             join app.private_telebirr_shadow_proof_requests proof
               on proof.id = attempt.shadow_proof_request_id
            where proof.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_verification_outcomes outcome
             join app.private_telebirr_shadow_proof_requests proof
               on proof.id = outcome.shadow_proof_request_id
            where proof.pilot_revision_id = pilot.id
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_verification_outcomes outcome
             join app.private_telebirr_shadow_proof_requests proof
               on proof.id = outcome.shadow_proof_request_id
            where proof.pilot_revision_id = pilot.id
              and outcome.would_verify
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_verification_outcomes outcome
             join app.private_telebirr_shadow_proof_requests proof
               on proof.id = outcome.shadow_proof_request_id
            where proof.pilot_revision_id = pilot.id
              and outcome.disposition = 'review_required'
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_verification_outcomes outcome
             join app.private_telebirr_shadow_proof_requests proof
               on proof.id = outcome.shadow_proof_request_id
            where proof.pilot_revision_id = pilot.id
              and outcome.disposition = 'definite_reject'
         ),
         (
           select pg_catalog.count(*)
             from app.private_telebirr_shadow_evidence_quarantine quarantine
             join app.private_telebirr_shadow_verification_attempts attempt
               on attempt.id = quarantine.verification_attempt_id
             join app.private_telebirr_shadow_proof_requests proof
               on proof.id = attempt.shadow_proof_request_id
            where proof.pilot_revision_id = pilot.id
         ),
         now_at;
end;
$$;

create function app.lease_private_telebirr_shadow_assignment(
  p_device_enrollment_id uuid,
  p_leased_by text,
  p_lease_request_key uuid,
  p_lease_seconds integer
)
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  job_id uuid,
  attempt_number integer,
  request_id uuid,
  assignment_id uuid,
  lease_nonce_digest text,
  challenge_id uuid,
  challenge_digest text,
  issued_at timestamptz,
  expires_at timestamptz,
  pilot_revision_id uuid,
  device_enrollment_id uuid,
  device_id text,
  device_key_id text,
  device_public_key_spki_sha256 text,
  receiver_revision_id uuid,
  receiver_profile_id uuid,
  receiver_profile_digest text,
  receiver_configuration_digest text,
  expected_receiver_name_digest text,
  receiver_name_normalizer_version text,
  source_profile text,
  adapter_version text,
  parser_version text,
  facts_normalizer_version text,
  candidate_reference_ciphertext text,
  candidate_reference_fingerprint text,
  reference_encryption_key_version smallint,
  reference_profile_version smallint,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  existing_attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  inserted_attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  attempt_count integer;
  request_digest text;
  nonce_material uuid;
  challenge_material uuid;
begin
  perform app.require_telebirr_assignment_broker_session();

  if p_device_enrollment_id is null
    or p_leased_by is null
    or p_leased_by <> pg_catalog.btrim(p_leased_by)
    or p_leased_by !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_lease_request_key is null
    or p_lease_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_lease_seconds not between 30 and 300 then
    raise exception 'The TeleBirr shadow assignment request is invalid.';
  end if;

  select device.* into enrollment
    from app.private_live_telebirr_device_enrollments device
   where device.id = p_device_enrollment_id
   for share;

  if enrollment.id is null then
    raise exception 'The TeleBirr shadow assignment authority is unavailable.';
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(enrollment.pilot_revision_id);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-assignment-lease-request:v1:'
        || p_lease_request_key::text,
      0::bigint
    )
  );

  select pilot_revision.* into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = enrollment.pilot_revision_id
   for share;

  select receiver_profile.* into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = enrollment.receiver_profile_id
     and receiver_profile.pilot_revision_id = pilot.id
   for share;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-assignment-lease:v1'
      || '|device_enrollment_id=' || enrollment.id::text
      || '|leased_by=' || p_leased_by
      || '|lease_request_key=' || p_lease_request_key::text
      || '|lease_seconds=' || p_lease_seconds::text
      || '|pilot_revision_id=' || pilot.id::text
      || '|pilot_configuration_digest=' || pilot.configuration_digest
  );

  select attempt.* into existing_attempt
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.lease_request_key = p_lease_request_key
   for share;

  -- The request-key and authority locks above can wait. Recheck the time-based authority only
  -- after every blocking lock needed by either the replay or new-lease branch is held.
  perform app.require_private_telebirr_shadow_mode_ready(enrollment.pilot_revision_id);
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  if pilot.id is null
    or profile.id is null
    or now_at < enrollment.valid_from
    or now_at >= enrollment.valid_until
    or now_at < profile.valid_from
    or now_at >= profile.valid_until
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The TeleBirr shadow assignment authority is unavailable.';
  end if;

  if existing_attempt.id is not null then
    if existing_attempt.device_enrollment_id is distinct from enrollment.id
      or existing_attempt.leased_by is distinct from p_leased_by
      or existing_attempt.requested_lease_seconds is distinct from p_lease_seconds
      or existing_attempt.lease_request_digest is distinct from request_digest
      or now_at >= existing_attempt.expires_at then
      raise exception 'The TeleBirr shadow assignment replay conflicts or expired.';
    end if;

    select candidate.* into proof
      from app.private_telebirr_shadow_proof_requests candidate
     where candidate.id = existing_attempt.shadow_proof_request_id
       and candidate.verification_job_id = existing_attempt.verification_job_id
       and candidate.pilot_revision_id = pilot.id;

    if proof.id is null then
      raise exception 'The TeleBirr shadow assignment replay is unavailable.';
    end if;

    return query
    select existing_attempt.id,
           existing_attempt.lease_token,
           proof.verification_job_id,
           existing_attempt.attempt_number,
           existing_attempt.request_id,
           existing_attempt.assignment_id,
           existing_attempt.lease_nonce_digest,
           existing_attempt.challenge_id,
           existing_attempt.challenge_digest,
           existing_attempt.issued_at,
           existing_attempt.expires_at,
           proof.pilot_revision_id,
           enrollment.id,
           enrollment.device_id,
           enrollment.key_id,
           enrollment.public_key_spki_sha256,
           profile.receiver_account_id,
           profile.id,
           profile.receiver_profile_digest,
           profile.receiver_configuration_digest,
           profile.expected_receiver_name_digest,
           profile.receiver_name_normalizer_version,
           profile.source_profile,
           profile.adapter_version,
           profile.parser_version,
           profile.facts_normalizer_version,
           proof.candidate_reference_ciphertext,
           proof.candidate_reference_fingerprint,
           proof.reference_encryption_key_version,
           proof.reference_profile_version,
           true;
    return;
  end if;

  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.pilot_revision_id = pilot.id
     and candidate.receiver_profile_id = profile.id
     and now_at >= candidate.not_before
     and now_at < candidate.expires_at
     and not exists (
       select 1 from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.shadow_proof_request_id = candidate.id
     )
     and not exists (
       select 1
         from app.private_telebirr_shadow_verification_attempts attempt
        where attempt.shadow_proof_request_id = candidate.id
          and now_at < attempt.expires_at
     )
   order by candidate.submitted_at, candidate.id
   limit 1
   for update of candidate skip locked;

  if proof.id is null then
    return;
  end if;

  -- SKIP LOCKED does not wait on another proof row, but the final gate check also makes natural
  -- pilot expiry fail closed immediately before the lease timestamp is minted.
  perform app.require_private_telebirr_shadow_mode_ready(enrollment.pilot_revision_id);
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if now_at < enrollment.valid_from
    or now_at >= enrollment.valid_until
    or now_at < profile.valid_from
    or now_at >= profile.valid_until
    or now_at >= proof.expires_at
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The TeleBirr shadow assignment authority is unavailable.';
  end if;

  select pg_catalog.count(*)::integer into attempt_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.shadow_proof_request_id = proof.id;
  if attempt_count >= 100 then
    raise exception 'The TeleBirr shadow assignment retry limit is exhausted.';
  end if;

  nonce_material := pg_catalog.gen_random_uuid();
  challenge_material := pg_catalog.gen_random_uuid();
  insert into app.private_telebirr_shadow_verification_attempts (
    shadow_proof_request_id,
    verification_job_id,
    attempt_number,
    lease_request_key,
    lease_request_digest,
    lease_token,
    request_id,
    assignment_id,
    requested_lease_seconds,
    leased_by,
    device_enrollment_id,
    device_id_snapshot,
    device_key_id_snapshot,
    device_public_key_spki_sha256_snapshot,
    lease_nonce_digest,
    challenge_id,
    challenge_digest,
    issued_at,
    expires_at
  ) values (
    proof.id,
    proof.verification_job_id,
    attempt_count + 1,
    p_lease_request_key,
    request_digest,
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    p_lease_seconds,
    p_leased_by,
    enrollment.id,
    enrollment.device_id,
    enrollment.key_id,
    enrollment.public_key_spki_sha256,
    app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:shadow-assignment-nonce:v1|' || nonce_material::text
    ),
    challenge_material,
    app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:shadow-assignment-challenge:v1|' || challenge_material::text
    ),
    now_at,
    least(
      now_at + pg_catalog.make_interval(secs => p_lease_seconds),
      proof.expires_at,
      pilot.expires_at,
      profile.valid_until,
      enrollment.valid_until
    )
  ) returning * into inserted_attempt;

  return query
  select inserted_attempt.id,
         inserted_attempt.lease_token,
         proof.verification_job_id,
         inserted_attempt.attempt_number,
         inserted_attempt.request_id,
         inserted_attempt.assignment_id,
         inserted_attempt.lease_nonce_digest,
         inserted_attempt.challenge_id,
         inserted_attempt.challenge_digest,
         inserted_attempt.issued_at,
         inserted_attempt.expires_at,
         proof.pilot_revision_id,
         enrollment.id,
         enrollment.device_id,
         enrollment.key_id,
         enrollment.public_key_spki_sha256,
         profile.receiver_account_id,
         profile.id,
         profile.receiver_profile_digest,
         profile.receiver_configuration_digest,
         profile.expected_receiver_name_digest,
         profile.receiver_name_normalizer_version,
         profile.source_profile,
         profile.adapter_version,
         profile.parser_version,
         profile.facts_normalizer_version,
         proof.candidate_reference_ciphertext,
         proof.candidate_reference_fingerprint,
         proof.reference_encryption_key_version,
         proof.reference_profile_version,
         false;
end;
$$;

alter function app.lease_private_live_telebirr_assignment_broker(uuid, text, uuid, integer)
  rename to lease_private_live_telebirr_assignment_broker_before_shadow;

revoke all on function app.lease_private_live_telebirr_assignment_broker_before_shadow(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role,
       fetanagent_telebirr_assignment_broker,
       fetanagent_telebirr_assignment_broker_runtime;

create function app.lease_private_live_telebirr_assignment_broker(
  p_device_enrollment_id uuid,
  p_leased_by text,
  p_lease_request_key uuid,
  p_lease_seconds integer
)
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  job_id uuid,
  attempt_number integer,
  request_id uuid,
  assignment_id uuid,
  lease_nonce_digest text,
  challenge_id uuid,
  challenge_digest text,
  issued_at timestamptz,
  expires_at timestamptz,
  pilot_revision_id uuid,
  device_enrollment_id uuid,
  device_id text,
  device_key_id text,
  device_public_key_spki_sha256 text,
  receiver_revision_id uuid,
  receiver_profile_id uuid,
  receiver_profile_digest text,
  receiver_configuration_digest text,
  expected_receiver_name_digest text,
  receiver_name_normalizer_version text,
  source_profile text,
  adapter_version text,
  parser_version text,
  facts_normalizer_version text,
  candidate_reference_ciphertext text,
  candidate_reference_fingerprint text,
  reference_encryption_key_version smallint,
  reference_profile_version smallint,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
begin
  perform app.require_telebirr_assignment_broker_session();

  -- Preserve the broker's pre-existing validation and safe idle-poll contract. A disabled or
  -- partially configured installation is an empty queue for an enrolled caller, never a retrying
  -- shadow-authority error and never a durable attempt.
  if p_device_enrollment_id is null
    or p_lease_request_key is null
    or p_lease_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_leased_by is null
    or p_leased_by <> pg_catalog.btrim(p_leased_by)
    or p_leased_by !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_lease_seconds not between 30 and 300 then
    raise exception 'The private live TeleBirr assignment request is invalid.';
  end if;

  select device_enrollment.* into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = p_device_enrollment_id
   for share;
  if enrollment.id is null then
    raise exception 'The private live TeleBirr device enrollment is unavailable.';
  end if;

  if app.is_private_live_deposit_pilot_enforced() then
    return query select *
      from app.lease_private_live_telebirr_assignment_broker_before_shadow(
        p_device_enrollment_id,
        p_leased_by,
        p_lease_request_key,
        p_lease_seconds
      );
    return;
  end if;

  if not app.private_telebirr_shadow_mode_is_ready(enrollment.pilot_revision_id) then
    return;
  end if;

  return query select *
    from app.lease_private_telebirr_shadow_assignment(
      p_device_enrollment_id,
      p_leased_by,
      p_lease_request_key,
      p_lease_seconds
    );
end;
$$;

create function app.persist_private_telebirr_shadow_assignment_signature(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_assignment_signer_id uuid,
  p_assignment_body_digest text,
  p_proposed_assignment_signature text,
  p_proposed_assignment_signature_digest text,
  p_reference_binding_digest text
)
returns table (
  assignment_signature text,
  assignment_signature_digest text,
  signed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  existing_transcript app.private_telebirr_shadow_assignment_transcripts%rowtype;
  inserted_transcript app.private_telebirr_shadow_assignment_transcripts%rowtype;
  computed_signature_digest text;
begin
  perform app.require_telebirr_assignment_broker_session();

  if p_verification_attempt_id is null
    or p_lease_token is null
    or p_assignment_signer_id is null
    or p_assignment_body_digest is null
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_proposed_assignment_signature is null
    or p_proposed_assignment_signature !~ '^[A-Za-z0-9_-]{86}$'
    or p_proposed_assignment_signature_digest is null
    or p_proposed_assignment_signature_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reference_binding_digest is null
    or p_reference_binding_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'The TeleBirr shadow assignment persistence request is invalid.';
  end if;

  computed_signature_digest := app.private_live_telebirr_assignment_signature_digest(
    p_proposed_assignment_signature
  );
  if computed_signature_digest is distinct from p_proposed_assignment_signature_digest then
    raise exception 'The TeleBirr shadow assignment signature digest does not match.';
  end if;

  select candidate.* into attempt
    from app.private_telebirr_shadow_verification_attempts candidate
   where candidate.id = p_verification_attempt_id
     and candidate.lease_token = p_lease_token
   for update;

  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = attempt.shadow_proof_request_id
     and candidate.verification_job_id = attempt.verification_job_id
   for share;

  select candidate.* into enrollment
    from app.private_live_telebirr_device_enrollments candidate
   where candidate.id = attempt.device_enrollment_id
     and candidate.pilot_revision_id = proof.pilot_revision_id
   for share;

  select candidate.* into signer
    from app.private_live_telebirr_assignment_signers candidate
   where candidate.id = p_assignment_signer_id
   for share;

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  if attempt.id is null
    or proof.id is null
    or enrollment.id is null
    or signer.id is null
    or signer.signer_key_id = enrollment.key_id
    or signer.public_key_spki_sha256 = enrollment.public_key_spki_sha256
    or now_at >= attempt.expires_at
    or attempt.issued_at < enrollment.valid_from
    or attempt.expires_at > enrollment.valid_until
    or attempt.issued_at < signer.valid_from
    or attempt.expires_at > signer.valid_until
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The TeleBirr shadow assignment persistence authority is unavailable.';
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(proof.pilot_revision_id);

  -- The locking gate can wait behind a pilot transition. Use a post-wait instant for the final
  -- lease and revocation check and for the persisted signature timestamp.
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if now_at >= attempt.expires_at
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The TeleBirr shadow assignment persistence authority is unavailable.';
  end if;

  select transcript.* into existing_transcript
    from app.private_telebirr_shadow_assignment_transcripts transcript
   where transcript.verification_attempt_id = attempt.id;

  if existing_transcript.id is not null then
    if existing_transcript.assignment_signer_id is distinct from signer.id
      or existing_transcript.assignment_body_digest is distinct from p_assignment_body_digest
      or existing_transcript.reference_binding_digest is distinct from p_reference_binding_digest
      or app.private_live_telebirr_assignment_signature_digest(
           existing_transcript.assignment_signature
         ) is distinct from existing_transcript.assignment_signature_digest then
      raise exception 'The TeleBirr shadow assignment persistence replay conflicts.';
    end if;

    return query select existing_transcript.assignment_signature,
                        existing_transcript.assignment_signature_digest,
                        existing_transcript.signed_at,
                        true;
    return;
  end if;

  insert into app.private_telebirr_shadow_assignment_transcripts (
    verification_attempt_id,
    assignment_signer_id,
    assignment_body_digest,
    assignment_signature,
    assignment_signature_digest,
    signer_key_id_snapshot,
    signer_public_key_spki_sha256_snapshot,
    reference_binding_digest,
    signed_at
  ) values (
    attempt.id,
    signer.id,
    p_assignment_body_digest,
    p_proposed_assignment_signature,
    p_proposed_assignment_signature_digest,
    signer.signer_key_id,
    signer.public_key_spki_sha256,
    p_reference_binding_digest,
    now_at
  ) returning * into inserted_transcript;

  return query select inserted_transcript.assignment_signature,
                      inserted_transcript.assignment_signature_digest,
                      inserted_transcript.signed_at,
                      false;
end;
$$;

alter function app.persist_private_live_telebirr_assignment_broker_signature(
  uuid, uuid, uuid, text, text, text, text
) rename to persist_live_tbirr_assignment_sig_internal;

revoke all on function app.persist_live_tbirr_assignment_sig_internal(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role,
       fetanagent_telebirr_assignment_broker,
       fetanagent_telebirr_assignment_broker_runtime;

create function app.persist_private_live_telebirr_assignment_broker_signature(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_assignment_signer_id uuid,
  p_assignment_body_digest text,
  p_proposed_assignment_signature text,
  p_proposed_assignment_signature_digest text,
  p_reference_binding_digest text
)
returns table (
  assignment_signature text,
  assignment_signature_digest text,
  signed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  shadow_count integer;
  live_count integer;
begin
  perform app.require_telebirr_assignment_broker_session();

  select pg_catalog.count(*)::integer into shadow_count
    from app.private_telebirr_shadow_verification_attempts attempt
   where attempt.id = p_verification_attempt_id
     and attempt.lease_token = p_lease_token;
  select pg_catalog.count(*)::integer into live_count
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.id = p_verification_attempt_id
     and attempt.lease_token = p_lease_token;

  if shadow_count + live_count <> 1 then
    raise exception 'The TeleBirr assignment lease is unavailable or ambiguous.';
  end if;

  if shadow_count = 1 then
    return query select *
      from app.persist_private_telebirr_shadow_assignment_signature(
        p_verification_attempt_id,
        p_lease_token,
        p_assignment_signer_id,
        p_assignment_body_digest,
        p_proposed_assignment_signature,
        p_proposed_assignment_signature_digest,
        p_reference_binding_digest
      );
    return;
  end if;

  return query select *
    from app.persist_live_tbirr_assignment_sig_internal(
      p_verification_attempt_id,
      p_lease_token,
      p_assignment_signer_id,
      p_assignment_body_digest,
      p_proposed_assignment_signature,
      p_proposed_assignment_signature_digest,
      p_reference_binding_digest
    );
end;
$$;

create function app.stage_private_telebirr_shadow_device_evidence(
  p_device_enrollment_id uuid,
  p_request_body_digest text,
  p_assignment_body_digest text,
  p_observation_body_digest text,
  p_signed_assignment jsonb,
  p_signed_observation jsonb
)
returns table (
  outcome text,
  reason_code text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  observed_at timestamptz;
  assignment_body jsonb;
  observation_body jsonb;
  transcript app.private_telebirr_shadow_assignment_transcripts%rowtype;
  attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  existing_stage app.private_telebirr_shadow_device_evidence_staging%rowtype;
begin
  perform app.require_telebirr_device_state_session();

  if p_device_enrollment_id is null
    or p_request_body_digest is null
    or p_request_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_assignment_body_digest is null
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observation_body_digest is null
    or p_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_signed_assignment is null
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.pg_column_size(p_signed_assignment) > 131072
    or p_signed_observation is null
    or pg_catalog.jsonb_typeof(p_signed_observation) <> 'object'
    or pg_catalog.pg_column_size(p_signed_observation) > 131072 then
    return query select 'rejected'::text, 'observation_rejected'::text, false;
    return;
  end if;

  assignment_body := p_signed_assignment -> 'body';
  observation_body := p_signed_observation -> 'body';
  if pg_catalog.jsonb_typeof(assignment_body) <> 'object'
    or pg_catalog.jsonb_typeof(observation_body) <> 'object'
    or p_signed_assignment ->> 'bodyDigest' <> p_assignment_body_digest
    or p_signed_assignment ->> 'signature' is null
    or p_signed_assignment ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_observation ->> 'bodyDigest' <> p_observation_body_digest
    or p_signed_observation ->> 'signature' is null
    or p_signed_observation ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or observation_body ->> 'assignmentBodyDigest' <> p_assignment_body_digest then
    return query select 'rejected'::text, 'observation_rejected'::text, false;
    return;
  end if;

  begin
    observed_at := pg_catalog.date_trunc(
      'milliseconds', (observation_body ->> 'observedAt')::timestamptz
    );
  exception when others then
    return query select 'rejected'::text, 'observation_rejected'::text, false;
    return;
  end;

  select candidate.* into transcript
    from app.private_telebirr_shadow_assignment_transcripts candidate
   where candidate.assignment_body_digest = p_assignment_body_digest
   for share;
  select candidate.* into attempt
    from app.private_telebirr_shadow_verification_attempts candidate
   where candidate.id = transcript.verification_attempt_id
   for update;
  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = attempt.shadow_proof_request_id
     and candidate.verification_job_id = attempt.verification_job_id
   for share;
  select candidate.* into enrollment
    from app.private_live_telebirr_device_enrollments candidate
   where candidate.id = p_device_enrollment_id
   for share;
  select candidate.* into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where candidate.id = proof.receiver_profile_id
   for share;

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  if transcript.id is null
    or attempt.id is null
    or proof.id is null
    or enrollment.id is null
    or profile.id is null
    or attempt.device_enrollment_id is distinct from enrollment.id
    or enrollment.pilot_revision_id is distinct from proof.pilot_revision_id
    or enrollment.receiver_profile_id is distinct from profile.id
    or not app.private_telebirr_shadow_mode_is_ready(proof.pilot_revision_id)
    or now_at < enrollment.valid_from
    or now_at >= enrollment.valid_until
    or now_at >= attempt.expires_at
    or observed_at < attempt.issued_at
    or observed_at >= attempt.expires_at
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    ) then
    return query select 'rejected'::text,
      case
        when proof.id is null
          or not app.private_telebirr_shadow_mode_is_ready(proof.pilot_revision_id)
          then 'pilot_stopped'::text
        when enrollment.id is null
          or now_at < enrollment.valid_from
          or now_at >= enrollment.valid_until
          or exists (
            select 1 from app.private_live_telebirr_device_revocations revocation
             where revocation.device_enrollment_id = enrollment.id
               and revocation.revoked_at <= now_at
          ) then 'device_revoked'::text
        else 'binding_mismatch'::text
      end,
      false;
    return;
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(proof.pilot_revision_id);

  -- A gate transition can hold the locking guard after the first typed validation. Refresh and
  -- repeat every wall-clock authority check before accepting the immutable staged evidence.
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if now_at < enrollment.valid_from
    or now_at >= enrollment.valid_until
    or now_at >= attempt.expires_at
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    ) then
    return query select 'rejected'::text,
      case
        when now_at < enrollment.valid_from
          or now_at >= enrollment.valid_until
          or exists (
            select 1 from app.private_live_telebirr_device_revocations revocation
             where revocation.device_enrollment_id = enrollment.id
               and revocation.revoked_at <= now_at
          ) then 'device_revoked'::text
        else 'binding_mismatch'::text
      end,
      false;
    return;
  end if;

  if p_signed_assignment ->> 'signerKeyId' is distinct from transcript.signer_key_id_snapshot
    or p_signed_assignment ->> 'signature' is distinct from transcript.assignment_signature
    or assignment_body ->> 'assignmentId' is distinct from attempt.assignment_id::text
    or assignment_body ->> 'requestId' is distinct from attempt.request_id::text
    or assignment_body ->> 'jobId' is distinct from proof.verification_job_id::text
    or assignment_body ->> 'attemptNumber' is distinct from attempt.attempt_number::text
    or assignment_body ->> 'pilotRevisionId' is distinct from proof.pilot_revision_id::text
    or assignment_body ->> 'deviceId' is distinct from enrollment.device_id
    or assignment_body ->> 'keyId' is distinct from enrollment.key_id
    or assignment_body ->> 'leaseNonceDigest' is distinct from attempt.lease_nonce_digest
    or assignment_body ->> 'challengeId' is distinct from attempt.challenge_id::text
    or assignment_body ->> 'challengeDigest' is distinct from attempt.challenge_digest
    or assignment_body ->> 'referenceFingerprint'
         is distinct from 'hmac-sha256:' || proof.candidate_reference_fingerprint
    or assignment_body ->> 'referenceBindingDigest'
         is distinct from transcript.reference_binding_digest
    or assignment_body ->> 'receiverRevisionId'
         is distinct from profile.receiver_account_id::text
    or assignment_body ->> 'receiverProfileId' is distinct from profile.id::text
    or assignment_body ->> 'receiverProfileDigest'
         is distinct from profile.receiver_profile_digest
    or assignment_body ->> 'receiverConfigurationDigest'
         is distinct from profile.receiver_configuration_digest
    or observation_body ->> 'assignmentId' is distinct from attempt.assignment_id::text
    or observation_body ->> 'requestId' is distinct from attempt.request_id::text
    or observation_body ->> 'jobId' is distinct from proof.verification_job_id::text
    or observation_body ->> 'attemptNumber' is distinct from attempt.attempt_number::text
    or observation_body ->> 'pilotRevisionId' is distinct from proof.pilot_revision_id::text
    or observation_body ->> 'deviceId' is distinct from enrollment.device_id
    or observation_body ->> 'keyId' is distinct from enrollment.key_id
    or observation_body ->> 'leaseNonceDigest' is distinct from attempt.lease_nonce_digest
    or observation_body ->> 'challengeId' is distinct from attempt.challenge_id::text
    or observation_body ->> 'challengeDigest' is distinct from attempt.challenge_digest
    or observation_body ->> 'referenceFingerprint'
         is distinct from 'hmac-sha256:' || proof.candidate_reference_fingerprint
    or observation_body ->> 'referenceBindingDigest'
         is distinct from transcript.reference_binding_digest
    or observation_body ->> 'receiverRevisionId'
         is distinct from profile.receiver_account_id::text
    or observation_body ->> 'receiverProfileId' is distinct from profile.id::text
    or observation_body ->> 'receiverProfileDigest'
         is distinct from profile.receiver_profile_digest
    or observation_body ->> 'receiverConfigurationDigest'
         is distinct from profile.receiver_configuration_digest then
    return query select 'rejected'::text, 'binding_mismatch'::text, false;
    return;
  end if;

  select staged.* into existing_stage
    from app.private_telebirr_shadow_device_evidence_staging staged
   where staged.observation_body_digest = p_observation_body_digest
      or staged.verification_attempt_id = attempt.id;

  if existing_stage.observation_body_digest is not null then
    if existing_stage.observation_body_digest = p_observation_body_digest
      and existing_stage.assignment_body_digest = p_assignment_body_digest
      and existing_stage.device_enrollment_id = enrollment.id
      and existing_stage.signed_assignment = p_signed_assignment
      and existing_stage.signed_observation = p_signed_observation then
      return query select 'accepted'::text, null::text, true;
      return;
    end if;
    return query select 'rejected'::text, 'binding_mismatch'::text, false;
    return;
  end if;

  insert into app.private_telebirr_shadow_device_evidence_staging (
    observation_body_digest,
    assignment_body_digest,
    verification_attempt_id,
    assignment_transcript_id,
    device_enrollment_id,
    first_request_body_digest,
    signed_assignment,
    signed_observation,
    observed_at,
    staged_at
  ) values (
    p_observation_body_digest,
    p_assignment_body_digest,
    attempt.id,
    transcript.id,
    enrollment.id,
    p_request_body_digest,
    p_signed_assignment,
    p_signed_observation,
    observed_at,
    now_at
  );

  return query select 'accepted'::text, null::text, false;
end;
$$;

alter function app.stage_private_telebirr_device_evidence(
  uuid, text, text, text, jsonb, jsonb
) rename to stage_live_tbirr_device_evidence_internal;

revoke all on function app.stage_live_tbirr_device_evidence_internal(
  uuid, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role,
       fetanagent_telebirr_device_state,
       fetanagent_telebirr_device_state_runtime;

create function app.stage_private_telebirr_device_evidence(
  p_device_enrollment_id uuid,
  p_request_body_digest text,
  p_assignment_body_digest text,
  p_observation_body_digest text,
  p_signed_assignment jsonb,
  p_signed_observation jsonb
)
returns table (
  outcome text,
  reason_code text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  shadow_count integer;
  live_count integer;
begin
  perform app.require_telebirr_device_state_session();

  select pg_catalog.count(*)::integer into shadow_count
    from app.private_telebirr_shadow_assignment_transcripts transcript
   where transcript.assignment_body_digest = p_assignment_body_digest;
  select pg_catalog.count(*)::integer into live_count
    from app.private_live_telebirr_assignment_transcripts transcript
   where transcript.assignment_body_digest = p_assignment_body_digest;

  if shadow_count + live_count <> 1 then
    return query select 'rejected'::text, 'binding_mismatch'::text, false;
    return;
  end if;

  if shadow_count = 1 then
    return query select *
      from app.stage_private_telebirr_shadow_device_evidence(
        p_device_enrollment_id,
        p_request_body_digest,
        p_assignment_body_digest,
        p_observation_body_digest,
        p_signed_assignment,
        p_signed_observation
      );
    return;
  end if;

  return query select *
    from app.stage_live_tbirr_device_evidence_internal(
      p_device_enrollment_id,
      p_request_body_digest,
      p_assignment_body_digest,
      p_observation_body_digest,
      p_signed_assignment,
      p_signed_observation
    );
end;
$$;

create function app.complete_private_telebirr_shadow_verification(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_completion_request_key uuid,
  p_observation_body_digest text,
  p_observation_signature_digest text,
  p_replay_identity text,
  p_source_document_digest text,
  p_normalized_facts_digest text,
  p_observed_at timestamptz,
  p_protocol_disposition text,
  p_protocol_reason_code text,
  p_assessment_input_digest text,
  p_assessed_at timestamptz,
  p_disposition text,
  p_reason_code text,
  p_evidence_digest text,
  p_retrieved_at timestamptz,
  p_receipt_principal_amount_minor bigint,
  p_occurred_at timestamptz,
  p_receiver_identity_digest text
)
returns table (
  verification_outcome_id uuid,
  outcome_disposition text,
  outcome_reason_code text,
  deposit_intent_id uuid,
  deposit_payment_claim_id uuid,
  execution_job_id uuid,
  settlement_created boolean,
  already_completed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  transcript app.private_telebirr_shadow_assignment_transcripts%rowtype;
  staged app.private_telebirr_shadow_device_evidence_staging%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  existing_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  inserted_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  completion_digest text;
begin
  perform app.require_telebirr_shadow_verifier_session();

  if p_verification_attempt_id is null
    or p_lease_token is null
    or p_completion_request_key is null
    or p_completion_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_observation_body_digest is null
    or p_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observation_signature_digest is null
    or p_observation_signature_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_source_document_digest is null
    or p_source_document_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_normalized_facts_digest is null
    or p_normalized_facts_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observed_at is null
    or p_protocol_disposition not in ('would_review', 'would_forward_signed_evidence')
    or p_protocol_reason_code is null
    or p_assessment_input_digest is null
    or p_assessment_input_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_assessed_at is null
    or p_disposition not in ('definite_reject', 'review_required', 'settlement_candidate')
    or p_reason_code is null
    or p_reason_code !~ '^[a-z][a-z0-9_]{2,127}$'
    or p_evidence_digest is null
    or p_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_retrieved_at is null
    or (
      p_disposition = 'settlement_candidate'
      and (
        p_protocol_disposition <> 'would_forward_signed_evidence'
        or p_protocol_reason_code <> 'signed_evidence_verified'
        or p_reason_code <> 'exact_proof_match'
        or p_receipt_principal_amount_minor is null
        or p_occurred_at is null
        or p_receiver_identity_digest is null
        or p_receiver_identity_digest !~ '^sha256:[0-9a-f]{64}$'
      )
    )
    or (
      p_disposition <> 'settlement_candidate'
      and (
        p_protocol_disposition <> 'would_review'
        or p_receipt_principal_amount_minor is not null
        or p_occurred_at is not null
        or p_receiver_identity_digest is not null
      )
    ) then
    raise exception 'The no-money TeleBirr shadow completion request is invalid.';
  end if;

  select candidate.* into attempt
    from app.private_telebirr_shadow_verification_attempts candidate
   where candidate.id = p_verification_attempt_id
     and candidate.lease_token = p_lease_token
   for update;
  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = attempt.shadow_proof_request_id
     and candidate.verification_job_id = attempt.verification_job_id
   for share;
  select candidate.* into transcript
    from app.private_telebirr_shadow_assignment_transcripts candidate
   where candidate.verification_attempt_id = attempt.id
   for share;
  select candidate.* into staged
    from app.private_telebirr_shadow_device_evidence_staging candidate
   where candidate.verification_attempt_id = attempt.id
     and candidate.observation_body_digest = p_observation_body_digest
   for share;
  select candidate.* into enrollment
    from app.private_live_telebirr_device_enrollments candidate
   where candidate.id = attempt.device_enrollment_id
   for share;
  select candidate.* into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where candidate.id = proof.receiver_profile_id
   for share;
  select candidate.* into signer
    from app.private_live_telebirr_assignment_signers candidate
   where candidate.id = transcript.assignment_signer_id
   for share;
  select outcome.* into existing_outcome
    from app.private_telebirr_shadow_verification_outcomes outcome
   where outcome.verification_attempt_id = attempt.id
      or outcome.completion_request_key = p_completion_request_key
   order by outcome.created_at, outcome.id
   limit 1
   for share;

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  if attempt.id is null
    or proof.id is null
    or transcript.id is null
    or staged.observation_body_digest is null
    or enrollment.id is null
    or profile.id is null
    or signer.id is null
    or p_completion_request_key is distinct from attempt.lease_request_key
    or staged.assignment_transcript_id is distinct from transcript.id
    or staged.assignment_body_digest is distinct from transcript.assignment_body_digest
    or staged.device_enrollment_id is distinct from enrollment.id
    or staged.observed_at is distinct from p_observed_at
    or staged.signed_observation ->> 'bodyDigest' is distinct from p_observation_body_digest
    or app.private_live_telebirr_assignment_signature_digest(
         staged.signed_observation ->> 'signature'
       ) is distinct from p_observation_signature_digest
    or staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'
         is distinct from p_source_document_digest
    or staged.signed_observation -> 'body' ->> 'normalizedFactsDigest'
         is distinct from p_normalized_facts_digest
    or now_at >= attempt.expires_at
    or now_at >= proof.expires_at
    or p_assessed_at < p_observed_at
    or p_retrieved_at > p_assessed_at
    or exists (
      select 1 from app.private_telebirr_shadow_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = attempt.id
          or quarantine.observation_body_digest = staged.observation_body_digest
    )
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    )
    or (
      p_disposition = 'settlement_candidate'
      and (
        p_receipt_principal_amount_minor < profile.minimum_principal_amount_minor
        or p_receipt_principal_amount_minor > profile.maximum_principal_amount_minor
        or p_receiver_identity_digest is distinct from profile.receiver_identity_digest
      )
    ) then
    raise exception 'The no-money TeleBirr shadow completion authority is unavailable.';
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(proof.pilot_revision_id);

  -- Attempt, device, signer, and gate locks can all wait. Re-evaluate the terminal authority at
  -- the post-wait instant before an advisory outcome can be recorded.
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if now_at >= attempt.expires_at
    or now_at >= proof.expires_at
    or exists (
      select 1 from app.private_telebirr_shadow_evidence_quarantine quarantine
       where quarantine.verification_attempt_id = attempt.id
          or quarantine.observation_body_digest = staged.observation_body_digest
    )
    or exists (
      select 1 from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    )
    or exists (
      select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The no-money TeleBirr shadow completion authority is unavailable.';
  end if;

  completion_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:shadow-completion:v1'
      || '|attempt_id=' || attempt.id::text
      || '|lease_token=' || attempt.lease_token::text
      || '|completion_request_key=' || p_completion_request_key::text
      || '|observation_body_digest=' || p_observation_body_digest
      || '|observation_signature_digest=' || p_observation_signature_digest
      || '|replay_identity=' || p_replay_identity
      || '|source_document_digest=' || p_source_document_digest
      || '|normalized_facts_digest=' || p_normalized_facts_digest
      || '|observed_at=' || p_observed_at::text
      || '|protocol_disposition=' || p_protocol_disposition
      || '|protocol_reason_code=' || p_protocol_reason_code
      || '|assessment_input_digest=' || p_assessment_input_digest
      || '|assessed_at=' || p_assessed_at::text
      || '|disposition=' || p_disposition
      || '|reason_code=' || p_reason_code
      || '|evidence_digest=' || p_evidence_digest
      || '|retrieved_at=' || p_retrieved_at::text
      || '|principal_amount_minor=' || coalesce(
           p_receipt_principal_amount_minor::text, '<null>'
         )
      || '|occurred_at=' || coalesce(p_occurred_at::text, '<null>')
      || '|receiver_identity_digest=' || coalesce(
           p_receiver_identity_digest, '<null>'
         )
  );

  if existing_outcome.id is not null then
    if existing_outcome.verification_attempt_id is distinct from attempt.id
      or existing_outcome.completion_request_key is distinct from p_completion_request_key
      or existing_outcome.completion_request_digest is distinct from completion_digest
      or existing_outcome.observation_body_digest is distinct from p_observation_body_digest then
      raise exception 'The no-money TeleBirr shadow completion replay conflicts.';
    end if;

    return query select existing_outcome.id,
                        case existing_outcome.disposition
                          when 'settlement_candidate' then 'would_verify'::text
                          when 'review_required' then 'would_review'::text
                          else 'would_reject'::text
                        end,
                        existing_outcome.reason_code,
                        null::uuid,
                        null::uuid,
                        null::uuid,
                        false,
                        true;
    return;
  end if;

  insert into app.private_telebirr_shadow_verification_outcomes (
    verification_attempt_id,
    shadow_proof_request_id,
    verification_job_id,
    completion_request_key,
    completion_request_digest,
    observation_body_digest,
    observation_signature_digest,
    replay_identity,
    source_document_digest,
    normalized_facts_digest,
    observed_at,
    protocol_disposition,
    protocol_reason_code,
    assessment_input_digest,
    assessed_at,
    disposition,
    reason_code,
    evidence_digest,
    retrieved_at,
    principal_amount_minor,
    occurred_at,
    receiver_identity_digest
  ) values (
    attempt.id,
    proof.id,
    proof.verification_job_id,
    p_completion_request_key,
    completion_digest,
    p_observation_body_digest,
    p_observation_signature_digest,
    p_replay_identity,
    p_source_document_digest,
    p_normalized_facts_digest,
    p_observed_at,
    p_protocol_disposition,
    p_protocol_reason_code,
    p_assessment_input_digest,
    p_assessed_at,
    p_disposition,
    p_reason_code,
    p_evidence_digest,
    p_retrieved_at,
    p_receipt_principal_amount_minor,
    p_occurred_at,
    p_receiver_identity_digest
  ) returning * into inserted_outcome;

  return query select inserted_outcome.id,
                      case inserted_outcome.disposition
                        when 'settlement_candidate' then 'would_verify'::text
                        when 'review_required' then 'would_review'::text
                        else 'would_reject'::text
                      end,
                      inserted_outcome.reason_code,
                      null::uuid,
                      null::uuid,
                      null::uuid,
                      false,
                      false;
end;
$$;

create function app.load_next_private_telebirr_shadow_staged_evidence()
returns table (
  verification_attempt_id uuid,
  lease_token uuid,
  completion_request_key uuid,
  observation_body_digest text,
  signed_assignment jsonb,
  signed_observation jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  captured_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  perform app.require_telebirr_shadow_verifier_session();

  return query
  select staged.verification_attempt_id,
         attempt.lease_token,
         attempt.lease_request_key,
         staged.observation_body_digest,
         staged.signed_assignment,
         staged.signed_observation
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = attempt.shadow_proof_request_id
     and proof.verification_job_id = attempt.verification_job_id
   where app.private_telebirr_shadow_mode_is_ready(proof.pilot_revision_id)
     and captured_at >= proof.not_before
     and captured_at < proof.expires_at
     and captured_at < attempt.expires_at
     and staged.observed_at >= attempt.issued_at
     and staged.observed_at < attempt.expires_at
     and not exists (
       select 1 from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.verification_attempt_id = attempt.id
           or outcome.completion_request_key = attempt.lease_request_key
     )
     and not exists (
       select 1 from app.private_telebirr_shadow_evidence_quarantine quarantine
        where quarantine.verification_attempt_id = attempt.id
           or quarantine.observation_body_digest = staged.observation_body_digest
     )
   order by staged.staged_at, staged.observation_body_digest
   limit 1;
end;
$$;

create function app.quarantine_private_telebirr_shadow_staged_evidence(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_observation_body_digest text,
  p_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_quarantine app.private_telebirr_shadow_evidence_quarantine%rowtype;
  staged_attempt_id uuid;
  staged_pilot_revision_id uuid;
begin
  perform app.require_telebirr_shadow_verifier_session();

  if p_verification_attempt_id is null
    or p_lease_token is null
    or p_observation_body_digest is null
    or p_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reason_code is distinct from 'trusted_evidence_invalid' then
    raise exception 'The trusted TeleBirr shadow quarantine request is invalid.';
  end if;

  -- The attempt row serializes first-quarantine and replay calls. Re-read the immutable quarantine
  -- row only after this lock so two identical calls cannot race into a unique-violation surface.
  select staged.verification_attempt_id, proof.pilot_revision_id
    into staged_attempt_id, staged_pilot_revision_id
    from app.private_telebirr_shadow_device_evidence_staging staged
    join app.private_telebirr_shadow_verification_attempts attempt
      on attempt.id = staged.verification_attempt_id
     and attempt.lease_token = p_lease_token
    join app.private_telebirr_shadow_proof_requests proof
      on proof.id = attempt.shadow_proof_request_id
     and proof.verification_job_id = attempt.verification_job_id
   where staged.observation_body_digest = p_observation_body_digest
     and staged.verification_attempt_id = p_verification_attempt_id
     and not exists (
       select 1 from app.private_telebirr_shadow_verification_outcomes outcome
        where outcome.verification_attempt_id = p_verification_attempt_id
     )
   for update of attempt;

  if staged_attempt_id is null then
    raise exception 'The trusted TeleBirr shadow staged evidence is unavailable.';
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(staged_pilot_revision_id);

  select quarantine.* into existing_quarantine
    from app.private_telebirr_shadow_evidence_quarantine quarantine
   where quarantine.observation_body_digest = p_observation_body_digest
      or quarantine.verification_attempt_id = p_verification_attempt_id
   for share;

  if existing_quarantine.observation_body_digest is not null then
    if existing_quarantine.observation_body_digest = p_observation_body_digest
      and existing_quarantine.verification_attempt_id = p_verification_attempt_id
      and existing_quarantine.reason_code = p_reason_code then
      return true;
    end if;
    raise exception 'The trusted TeleBirr shadow quarantine replay conflicts.';
  end if;

  insert into app.private_telebirr_shadow_evidence_quarantine (
    observation_body_digest, verification_attempt_id, reason_code
  ) values (p_observation_body_digest, p_verification_attempt_id, p_reason_code);
  return true;
end;
$$;

create function app.load_private_telebirr_shadow_verification_authority(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  captured_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  attempt app.private_telebirr_shadow_verification_attempts%rowtype;
  proof app.private_telebirr_shadow_proof_requests%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  submitter_member app.private_live_deposit_pilot_customers%rowtype;
  player_member app.private_live_deposit_pilot_players%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  transcript app.private_telebirr_shadow_assignment_transcripts%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  existing_outcome app.private_telebirr_shadow_verification_outcomes%rowtype;
  current_submitter app.customers%rowtype;
  current_owner app.customers%rowtype;
  current_player app.customer_platform_players%rowtype;
  current_eligibility app.player_deposit_eligibility_decisions%rowtype;
  current_provider app.payment_providers%rowtype;
  current_receiver app.receiver_accounts%rowtype;
  current_policy app.deposit_policy_versions%rowtype;
  is_device_revoked boolean;
  is_signer_revoked boolean;
  shadow_ready boolean;
  submitter_snapshot_state text;
  owner_snapshot_state text;
  eligibility_state text;
  receiver_fact_state text;
  duplicate_state text;
  replay_identities jsonb;
  state_material jsonb;
begin
  perform app.require_telebirr_shadow_verifier_session();

  if p_verification_attempt_id is null or p_lease_token is null then
    return null;
  end if;

  select candidate.* into attempt
    from app.private_telebirr_shadow_verification_attempts candidate
   where candidate.id = p_verification_attempt_id
     and candidate.lease_token = p_lease_token;
  select candidate.* into proof
    from app.private_telebirr_shadow_proof_requests candidate
   where candidate.id = attempt.shadow_proof_request_id
     and candidate.verification_job_id = attempt.verification_job_id;
  select candidate.* into pilot
    from app.private_live_deposit_pilot_revisions candidate
   where candidate.id = proof.pilot_revision_id;
  select candidate.* into submitter_member
    from app.private_live_deposit_pilot_customers candidate
   where candidate.pilot_revision_id = pilot.id
     and candidate.customer_id = proof.submitting_customer_id;
  select candidate.* into player_member
    from app.private_live_deposit_pilot_players candidate
   where candidate.pilot_revision_id = pilot.id
     and candidate.player_account_id = proof.player_account_id;
  select candidate.* into provider_member
    from app.private_live_deposit_pilot_providers candidate
   where candidate.pilot_revision_id = pilot.id
     and candidate.payment_provider_id = proof.payment_provider_id
     and candidate.provider_code_snapshot = 'telebirr';
  select candidate.* into profile
    from app.private_live_telebirr_receiver_profiles candidate
   where candidate.id = proof.receiver_profile_id
     and candidate.pilot_revision_id = pilot.id
     and candidate.payment_provider_id = proof.payment_provider_id;
  select candidate.* into enrollment
    from app.private_live_telebirr_device_enrollments candidate
   where candidate.id = attempt.device_enrollment_id
     and candidate.pilot_revision_id = pilot.id
     and candidate.receiver_profile_id = profile.id;
  select candidate.* into transcript
    from app.private_telebirr_shadow_assignment_transcripts candidate
   where candidate.verification_attempt_id = attempt.id;
  select candidate.* into signer
    from app.private_live_telebirr_assignment_signers candidate
   where candidate.id = transcript.assignment_signer_id;
  select candidate.* into existing_outcome
    from app.private_telebirr_shadow_verification_outcomes candidate
   where candidate.verification_attempt_id = attempt.id
     and candidate.shadow_proof_request_id = proof.id;
  select candidate.* into current_submitter
    from app.customers candidate where candidate.id = proof.submitting_customer_id;
  select candidate.* into current_owner
    from app.customers candidate
   where candidate.id = player_member.player_owner_customer_id_snapshot;
  select candidate.* into current_player
    from app.customer_platform_players candidate where candidate.id = proof.player_account_id;
  select candidate.* into current_eligibility
    from app.player_deposit_eligibility_decisions candidate
   where candidate.player_account_id = proof.player_account_id
   order by candidate.decision_version desc
   limit 1;
  select candidate.* into current_provider
    from app.payment_providers candidate where candidate.id = proof.payment_provider_id;
  select candidate.* into current_receiver
    from app.receiver_accounts candidate
   where candidate.id = profile.receiver_account_id
     and candidate.provider_id = proof.payment_provider_id
     and candidate.version = profile.receiver_account_version;
  select candidate.* into current_policy
    from app.deposit_policy_versions candidate where candidate.status = 'active';

  if attempt.id is null
    or proof.id is null
    or pilot.id is null
    or submitter_member.customer_id is null
    or player_member.player_account_id is null
    or provider_member.payment_provider_id is null
    or profile.id is null
    or enrollment.id is null
    or transcript.id is null
    or signer.id is null
    or signer.signer_key_id = enrollment.key_id
    or signer.public_key_spki_sha256 = enrollment.public_key_spki_sha256
    or current_submitter.id is null
    or current_owner.id is null
    or current_player.id is null
    or current_provider.id is null
    or current_receiver.id is null then
    return null;
  end if;

  shadow_ready := app.private_telebirr_shadow_mode_is_ready(pilot.id)
    and captured_at >= proof.not_before
    and captured_at < proof.expires_at
    and captured_at < attempt.expires_at
    and provider_member.provider_code_snapshot = 'telebirr'
    and current_provider.code = 'telebirr'
    and current_provider.status = 'active'
    and current_provider.updated_at = provider_member.provider_updated_at_snapshot
    and profile.provider_code = 'telebirr'
    and profile.pilot_configuration_digest = pilot.configuration_digest;

  select exists (
    select 1 from app.private_live_telebirr_device_revocations revocation
     where revocation.device_enrollment_id = enrollment.id
       and revocation.revoked_at <= captured_at
  ) into is_device_revoked;
  select exists (
    select 1 from app.private_live_telebirr_assignment_signer_revocations revocation
     where revocation.assignment_signer_id = signer.id
       and revocation.revoked_at <= captured_at
  ) into is_signer_revoked;

  submitter_snapshot_state := case
    when current_submitter.status is distinct from submitter_member.customer_status_snapshot
      or current_submitter.updated_at is distinct from submitter_member.customer_updated_at_snapshot
      then 'stale'
    else 'exact'
  end;
  owner_snapshot_state := case
    when current_owner.status is distinct from player_member.player_owner_customer_status_snapshot
      or current_owner.updated_at
           is distinct from player_member.player_owner_customer_updated_at_snapshot
      or current_player.updated_at is distinct from player_member.player_updated_at_snapshot
      then 'stale'
    else 'exact'
  end;
  eligibility_state := case
    when current_eligibility.id is null then 'unavailable'
    when current_eligibility.id is distinct from player_member.eligibility_decision_id_snapshot
      or current_eligibility.decision_version
           is distinct from player_member.eligibility_decision_version_snapshot
      or current_eligibility.decided_at is distinct from player_member.eligibility_decided_at_snapshot
      or current_eligibility.player_account_updated_at_snapshot
           is distinct from current_player.updated_at
      then 'ambiguous'
    when current_eligibility.decision = 'eligible'
      and current_player.status = 'active'
      and current_player.validation_status = 'valid' then 'eligible'
    else 'ineligible'
  end;
  receiver_fact_state := case
    when p_occurred_at is null then 'unavailable'
    when current_receiver.active_from > p_occurred_at
      or (current_receiver.retired_at is not null and p_occurred_at >= current_receiver.retired_at)
      then 'gap'
    when current_receiver.account_holder_name
           is distinct from provider_member.receiver_account_holder_name_snapshot
      or current_receiver.account_reference_masked
           is distinct from provider_member.receiver_account_masked_snapshot
      or current_receiver.active_from is distinct from provider_member.receiver_active_from_snapshot
      or current_receiver.updated_at is distinct from provider_member.receiver_updated_at_snapshot
      then 'unavailable'
    else 'exact'
  end;
  duplicate_state := case when exists (
    select 1
      from app.provider_payment_evidence evidence
     where evidence.payment_provider_id = proof.payment_provider_id
       and evidence.canonical_reference_fingerprint = proof.candidate_reference_fingerprint
  ) then 'reused' else 'unused' end;

  select coalesce(
    pg_catalog.jsonb_agg(outcome.replay_identity order by outcome.replay_identity),
    '[]'::jsonb
  ) into replay_identities
    from app.private_telebirr_shadow_verification_outcomes outcome
    join app.private_telebirr_shadow_proof_requests prior_proof
      on prior_proof.id = outcome.shadow_proof_request_id
   where prior_proof.pilot_revision_id = proof.pilot_revision_id
     and outcome.verification_attempt_id <> attempt.id;

  state_material := pg_catalog.jsonb_build_object(
    'verificationMode', 'shadow',
    'attempt', pg_catalog.to_jsonb(attempt),
    'proof', pg_catalog.to_jsonb(proof),
    'pilot', pg_catalog.to_jsonb(pilot),
    'submitterMember', pg_catalog.to_jsonb(submitter_member),
    'playerMember', pg_catalog.to_jsonb(player_member),
    'providerMember', pg_catalog.to_jsonb(provider_member),
    'profile', pg_catalog.to_jsonb(profile),
    'enrollment', pg_catalog.to_jsonb(enrollment),
    'transcript', pg_catalog.to_jsonb(transcript),
    'signer', pg_catalog.to_jsonb(signer),
    'existingOutcome', pg_catalog.to_jsonb(existing_outcome),
    'currentSubmitter', pg_catalog.to_jsonb(current_submitter),
    'currentOwner', pg_catalog.to_jsonb(current_owner),
    'currentPlayer', pg_catalog.to_jsonb(current_player),
    'currentEligibility', pg_catalog.to_jsonb(current_eligibility),
    'currentProvider', pg_catalog.to_jsonb(current_provider),
    'currentReceiver', pg_catalog.to_jsonb(current_receiver),
    'currentPolicy', pg_catalog.to_jsonb(current_policy),
    'deviceRevoked', is_device_revoked,
    'signerRevoked', is_signer_revoked,
    'shadowReady', shadow_ready,
    'submitterSnapshotState', submitter_snapshot_state,
    'ownerSnapshotState', owner_snapshot_state,
    'eligibilityState', eligibility_state,
    'receiverFactState', receiver_fact_state,
    'duplicateState', duplicate_state,
    'replayIdentities', replay_identities
  );

  return pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'verificationMode', 'shadow',
    'capturedAt', pg_catalog.to_jsonb(captured_at),
    'authorityStateDigest', app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:shadow-verifier:authority-state:v1|' || state_material::text
    ),
    'verificationAttemptId', attempt.id,
    'leaseTokenAccepted', true,
    'attempt', pg_catalog.jsonb_build_object(
      'assignmentId', attempt.assignment_id,
      'requestId', attempt.request_id,
      'jobId', attempt.verification_job_id,
      'attemptNumber', attempt.attempt_number,
      'leaseNonceDigest', attempt.lease_nonce_digest,
      'challengeId', attempt.challenge_id,
      'challengeDigest', attempt.challenge_digest,
      'issuedAt', pg_catalog.to_jsonb(attempt.issued_at),
      'expiresAt', pg_catalog.to_jsonb(attempt.expires_at)
    ),
    'trustedAssignmentSigner', pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'providerCode', 'telebirr',
      'protocolMode', 'live_private_pilot_v1',
      'signerKeyId', signer.signer_key_id,
      'publicKeySpkiSha256', signer.public_key_spki_sha256,
      'signatureAlgorithm', signer.signature_algorithm,
      'state', case when is_signer_revoked then 'revoked' else 'active' end,
      'validFrom', pg_catalog.to_jsonb(signer.valid_from),
      'validUntil', pg_catalog.to_jsonb(signer.valid_until)
    ),
    'deviceEnrollment', pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'providerCode', 'telebirr',
      'protocolMode', 'live_private_pilot_v1',
      'enrollmentId', enrollment.id,
      'deviceId', enrollment.device_id,
      'keyId', enrollment.key_id,
      'publicKeySpkiSha256', enrollment.public_key_spki_sha256,
      'signatureAlgorithm', enrollment.signature_algorithm,
      'state', case when is_device_revoked then 'revoked' else 'active' end,
      'validFrom', pg_catalog.to_jsonb(enrollment.valid_from),
      'validUntil', pg_catalog.to_jsonb(enrollment.valid_until),
      'pilotRevisionId', enrollment.pilot_revision_id,
      'receiverRevisionId', profile.receiver_account_id,
      'receiverProfileId', profile.id,
      'receiverProfileDigest', profile.receiver_profile_digest,
      'receiverConfigurationDigest', profile.receiver_configuration_digest
    ),
    'trustedRequestBinding', pg_catalog.jsonb_build_object(
      'assignmentId', attempt.assignment_id,
      'requestId', attempt.request_id,
      'jobId', attempt.verification_job_id,
      'attemptNumber', attempt.attempt_number,
      'pilotRevisionId', proof.pilot_revision_id,
      'deviceId', attempt.device_id_snapshot,
      'keyId', attempt.device_key_id_snapshot,
      'referenceFingerprint', 'hmac-sha256:' || proof.candidate_reference_fingerprint,
      'receiverRevisionId', profile.receiver_account_id,
      'receiverProfileId', profile.id,
      'receiverProfileDigest', profile.receiver_profile_digest,
      'receiverConfigurationDigest', profile.receiver_configuration_digest,
      'expectedReceiverNameDigest', profile.expected_receiver_name_digest
    ),
    'assignmentTranscript', pg_catalog.jsonb_build_object(
      'assignmentBodyDigest', transcript.assignment_body_digest,
      'assignmentSignatureDigest', transcript.assignment_signature_digest,
      'referenceBindingDigest', transcript.reference_binding_digest,
      'signedAt', pg_catalog.to_jsonb(transcript.signed_at)
    ),
    'replayIdentities', replay_identities,
    'existingCompletion', case when existing_outcome.id is null then null else
      pg_catalog.jsonb_build_object(
        'completionRequestKey', existing_outcome.completion_request_key,
        'observationBodyDigest', existing_outcome.observation_body_digest,
        'observationSignatureDigest', existing_outcome.observation_signature_digest,
        'replayIdentity', existing_outcome.replay_identity,
        'sourceDocumentDigest', existing_outcome.source_document_digest,
        'normalizedFactsDigest', existing_outcome.normalized_facts_digest,
        'observedAt', pg_catalog.to_jsonb(existing_outcome.observed_at),
        'protocolDisposition', existing_outcome.protocol_disposition,
        'protocolReasonCode', existing_outcome.protocol_reason_code,
        'assessmentInputDigest', existing_outcome.assessment_input_digest,
        'assessedAt', pg_catalog.to_jsonb(existing_outcome.assessed_at),
        'disposition', existing_outcome.disposition,
        'reasonCode', existing_outcome.reason_code,
        'evidenceDigest', existing_outcome.evidence_digest,
        'retrievedAt', pg_catalog.to_jsonb(existing_outcome.retrieved_at),
        'receiptPrincipalAmountMinor', case when existing_outcome.principal_amount_minor is null
          then null else existing_outcome.principal_amount_minor::text end,
        'occurredAt', pg_catalog.to_jsonb(existing_outcome.occurred_at),
        'receiverIdentityDigest', existing_outcome.receiver_identity_digest
      ) end,
    'trustedRequest', pg_catalog.jsonb_build_object(
      'proofRequestId', attempt.request_id,
      'submittingCustomerId', proof.submitting_customer_id,
      'submittingCustomerMembershipState', 'included',
      'submittingCustomerCurrentState',
        case when current_submitter.status = 'active' then 'active' else 'inactive' end,
      'submittingCustomerSnapshotState', submitter_snapshot_state,
      'playerAccountId', proof.player_account_id,
      'selectedPlayerId', player_member.player_id_snapshot,
      'providerCode', 'telebirr',
      'referenceFingerprint', proof.candidate_reference_fingerprint,
      'submittedAt', pg_catalog.to_jsonb(proof.submitted_at),
      'pilotRevisionId', pilot.id,
      'pilotConfigurationDigest', pilot.configuration_digest,
      'receiverRevisionId', profile.receiver_account_id,
      'policyVersion', profile.policy_version,
      'databaseSnapshotId', attempt.id
    ),
    'trustedPilot', pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'revisionId', pilot.id,
      'configurationDigest', pilot.configuration_digest,
      'state', case when shadow_ready then 'armed' else 'stopped' end,
      'validFrom', pg_catalog.to_jsonb(pilot.active_from),
      'validUntil', pg_catalog.to_jsonb(pilot.expires_at)
    ),
    'trustedPlayer', pg_catalog.jsonb_build_object(
      'ownerCustomerId', player_member.player_owner_customer_id_snapshot,
      'playerMembershipState', 'included',
      'ownerCustomerBindingState', case
        when current_player.customer_id = player_member.player_owner_customer_id_snapshot
          then 'exact' else 'mismatched' end,
      'ownerCustomerCurrentState',
        case when current_owner.status = 'active' then 'active' else 'inactive' end,
      'ownerCustomerSnapshotState', owner_snapshot_state,
      'playerAccountId', proof.player_account_id,
      'selectedPlayerId', player_member.player_id_snapshot,
      'eligibilityState', eligibility_state,
      'eligibilityDecisionVersion', case
        when eligibility_state in ('eligible', 'ineligible')
          then app.private_live_telebirr_eligibility_version(current_eligibility.decision_version)
        else null end
    ),
    'trustedProvider', pg_catalog.jsonb_build_object(
      'providerCode', 'telebirr',
      'state', case
        when current_provider.status = 'active'
          and current_provider.updated_at = provider_member.provider_updated_at_snapshot
          then 'active' else 'inactive' end,
      'source', 'telebirr_official_receipt',
      'sourceProfile', profile.source_profile,
      'adapterVersion', profile.adapter_version,
      'parserVersion', profile.parser_version,
      'normalizerVersion', profile.facts_normalizer_version
    ),
    'trustedReference', pg_catalog.jsonb_build_object(
      'providerCode', 'telebirr',
      'protectionProfileVersion', proof.reference_profile_version,
      'encryptionKeyVersion', proof.reference_encryption_key_version,
      'ciphertext', proof.candidate_reference_ciphertext,
      'fingerprint', proof.candidate_reference_fingerprint,
      'masked', proof.candidate_reference_masked
    ),
    'trustedReceiver', pg_catalog.jsonb_build_object(
      'providerCode', 'telebirr',
      'revisionId', profile.receiver_account_id,
      'revisionVersion', profile.receiver_account_version,
      'profileId', profile.id,
      'profileDigest', profile.receiver_profile_digest,
      'configurationDigest', profile.receiver_configuration_digest,
      'identityDigest', profile.receiver_identity_digest,
      'expectedReceiverNameDigest', profile.expected_receiver_name_digest,
      'matchBasis', profile.receiver_match_basis
    ),
    'trustedPolicy', pg_catalog.jsonb_build_object(
      'providerCode', 'telebirr',
      'policyVersion', profile.policy_version,
      'policyDigest', profile.policy_digest
    ),
    'databaseAuthority', pg_catalog.jsonb_build_object(
      'submittingCustomerId', proof.submitting_customer_id,
      'submittingCustomerMembershipState', 'included',
      'submittingCustomerCurrentState',
        case when current_submitter.status = 'active' then 'active' else 'inactive' end,
      'submittingCustomerSnapshotState', submitter_snapshot_state,
      'ownerCustomerId', player_member.player_owner_customer_id_snapshot,
      'playerAccountId', proof.player_account_id,
      'playerMembershipState', 'included',
      'ownerCustomerBindingState', case
        when current_player.customer_id = player_member.player_owner_customer_id_snapshot
          then 'exact' else 'mismatched' end,
      'ownerCustomerCurrentState',
        case when current_owner.status = 'active' then 'active' else 'inactive' end,
      'ownerCustomerSnapshotState', owner_snapshot_state
    ),
    'databaseFacts', pg_catalog.jsonb_build_object(
      'receiverAtOccurredAt', pg_catalog.jsonb_build_object(
        'state', receiver_fact_state,
        'providerCode', 'telebirr',
        'resolvedForOccurredAt', pg_catalog.to_jsonb(p_occurred_at),
        'revisionId', case when receiver_fact_state = 'exact' then current_receiver.id else null end,
        'identityDigest', case when receiver_fact_state = 'exact'
          then profile.receiver_identity_digest else null end,
        'matchBasis', case when receiver_fact_state = 'exact'
          then profile.receiver_match_basis else null end,
        'effectiveFrom', case when receiver_fact_state = 'exact'
          then pg_catalog.to_jsonb(current_receiver.active_from) else null end,
        'effectiveUntil', case when receiver_fact_state = 'exact'
          then pg_catalog.to_jsonb(current_receiver.retired_at) else null end
      ),
      'currentPolicy', pg_catalog.jsonb_build_object(
        'state', case
          when current_policy.id = profile.deposit_policy_version_id
            and current_policy.version = profile.deposit_policy_version
            and current_policy.freshness_window_seconds = profile.automatic_freshness_seconds
            then 'available' else 'unavailable' end,
        'providerCode', 'telebirr',
        'checkedAt', pg_catalog.to_jsonb(captured_at),
        'policyVersion', profile.policy_version,
        'currencyCode', 'ETB',
        'minimumPrincipalAmountMinor', profile.minimum_principal_amount_minor::text,
        'maximumPrincipalAmountMinor', profile.maximum_principal_amount_minor::text,
        'automaticFreshnessSeconds', profile.automatic_freshness_seconds,
        'maximumFutureSkewSeconds', profile.maximum_future_skew_seconds,
        'allowedTransactionType', 'send_money',
        'acceptedSource', 'telebirr_official_receipt',
        'acceptedSourceProfile', profile.source_profile,
        'acceptedAdapterVersion', profile.adapter_version,
        'acceptedParserVersion', profile.parser_version,
        'acceptedNormalizerVersion', profile.facts_normalizer_version
      ),
      'currentEligibility', pg_catalog.jsonb_build_object(
        'state', eligibility_state,
        'selectedPlayerId', player_member.player_id_snapshot,
        'checkedAt', pg_catalog.to_jsonb(captured_at),
        'decisionVersion', case
          when eligibility_state in ('eligible', 'ineligible')
            then app.private_live_telebirr_eligibility_version(current_eligibility.decision_version)
          else null end
      ),
      'duplicateState', pg_catalog.jsonb_build_object(
        'state', duplicate_state,
        'providerCode', 'telebirr',
        'canonicalReferenceFingerprint', proof.candidate_reference_fingerprint,
        'checkedAt', pg_catalog.to_jsonb(captured_at)
      )
    )
  );
end;
$$;

create function app.capture_telegram_telebirr_shadow_proof(
  p_origin_inbound_event_id uuid,
  p_player_id text,
  p_provider_code text,
  p_reference_ciphertext text,
  p_reference_fingerprint text,
  p_reference_masked text,
  p_reference_key_version smallint,
  p_reference_profile_version smallint,
  p_semantic_input_hmac text
)
returns table (
  shadow_proof_request_id uuid,
  shadow_verification_job_id uuid,
  provider_code text,
  proof_status text,
  submitted_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  captured_at timestamptz;
  conversation_id uuid;
  conversation_version bigint;
  customer_id uuid;
  customer_identity_id uuid;
  customer_status app.record_status;
  identity_status app.record_status;
  processed_at timestamptz;
  existing_receipt app.telegram_telebirr_shadow_proof_receipts%rowtype;
  existing_proof app.private_telebirr_shadow_proof_requests%rowtype;
  inserted_proof app.private_telebirr_shadow_proof_requests%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  player_member app.private_live_deposit_pilot_players%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  current_player app.customer_platform_players%rowtype;
  current_eligibility app.player_deposit_eligibility_decisions%rowtype;
  current_provider app.payment_providers%rowtype;
begin
  if p_origin_inbound_event_id is null
    or p_player_id is null
    or p_player_id <> pg_catalog.btrim(p_player_id)
    or p_provider_code is distinct from 'telebirr'
    or p_reference_key_version is distinct from 2
    or p_reference_profile_version is distinct from 2
    or p_reference_ciphertext is null
    or p_reference_ciphertext <> pg_catalog.btrim(p_reference_ciphertext)
    or p_reference_ciphertext
      !~ '^v2\.telebirr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$'
    or p_reference_fingerprint is null
    or p_reference_fingerprint <> pg_catalog.lower(p_reference_fingerprint)
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_masked is null
    or p_reference_masked !~ '^\*{3}[A-Z0-9]{4}$'
    or p_semantic_input_hmac is null
    or p_semantic_input_hmac <> pg_catalog.lower(pg_catalog.btrim(p_semantic_input_hmac))
    or p_semantic_input_hmac !~ '^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$' then
    raise exception 'The Telegram TeleBirr shadow proof request is invalid.';
  end if;

  perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id);

  select inbound_event.customer_identity_id, inbound_event.processed_at
    into customer_identity_id, processed_at
    from app.inbound_events inbound_event
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.channel = 'telegram'
   for update;

  if customer_identity_id is null then
    raise exception 'The Telegram inbound event is unavailable for shadow verification.';
  end if;

  select identity.customer_id,
         identity.status,
         customer.status,
         conversation.id,
         conversation.version
    into customer_id,
         identity_status,
         customer_status,
         conversation_id,
         conversation_version
    from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
    join app.bot_conversations conversation
      on conversation.telegram_identity_id = identity.id
   where identity.id = customer_identity_id
     and identity.identity_kind = 'telegram'
     and exists (
       select 1
         from app.telegram_beta_invites invite
        where invite.status = 'redeemed'
          and invite.redeemed_customer_id = identity.customer_id
          and invite.redeemed_customer_identity_id = identity.id
          and invite.redeemed_telegram_user_id = telegram_identity.telegram_user_id
          and invite.redeemed_private_chat_id = telegram_identity.private_chat_id
     )
   for update of identity, customer, telegram_identity, conversation;

  if customer_id is null then
    raise exception 'The Telegram customer is unavailable for shadow verification.';
  end if;

  select receipt.*
    into existing_receipt
    from app.telegram_telebirr_shadow_proof_receipts receipt
   where receipt.origin_inbound_event_id = p_origin_inbound_event_id;

  if existing_receipt.origin_inbound_event_id is not null then
    select proof.*
      into existing_proof
      from app.private_telebirr_shadow_proof_requests proof
      join app.private_live_deposit_pilot_players member
        on member.pilot_revision_id = proof.pilot_revision_id
       and member.player_account_id = proof.player_account_id
     where proof.id = existing_receipt.shadow_proof_request_id
       and proof.submitting_customer_id = customer_id
       and member.player_id_snapshot = p_player_id;

    if existing_proof.id is null
      or existing_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac
      or existing_receipt.customer_identity_id is distinct from customer_identity_id
      or existing_receipt.submitting_customer_id is distinct from customer_id
      or existing_receipt.conversation_id is distinct from conversation_id
      or existing_receipt.created_at is distinct from processed_at
      or existing_proof.candidate_reference_fingerprint is distinct from p_reference_fingerprint
      or existing_proof.candidate_reference_masked is distinct from p_reference_masked
      or existing_proof.reference_encryption_key_version is distinct from p_reference_key_version
      or existing_proof.reference_profile_version is distinct from p_reference_profile_version then
      raise exception 'The replayed Telegram TeleBirr shadow proof conflicts with its receipt.';
    end if;

    perform app.require_private_telebirr_shadow_mode_ready(existing_proof.pilot_revision_id);

    return query select existing_proof.id,
                        existing_proof.verification_job_id,
                        existing_proof.provider_code,
                        existing_proof.proof_status,
                        existing_proof.submitted_at,
                        true;
    return;
  end if;

  if processed_at is not null
    or identity_status <> 'active'
    or customer_status <> 'active'
    or exists (
      select 1 from app.inbound_event_consumptions consumption
       where consumption.origin_inbound_event_id = p_origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_live_deposit_request_receipts receipt
       where receipt.origin_inbound_event_id = p_origin_inbound_event_id
    )
    or exists (
      select 1 from app.telegram_dry_run_deposit_proof_receipts receipt
       where receipt.origin_inbound_event_id = p_origin_inbound_event_id
    ) then
    raise exception 'The Telegram event cannot capture a TeleBirr shadow proof.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'payment_verification',
     'deposit_execution',
     'withdrawal_validation',
     'withdrawal_collection',
     'cbe_birr_authoritative_verification',
     'telebirr_authoritative_verification',
     'private_live_deposit_pilot'
   )
   order by feature_switch.feature_key
   for update;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
    join app.feature_switches pilot_switch
      on pilot_switch.feature_key = 'private_live_deposit_pilot'
     and pilot_switch.mode = 'dry_run'
     and pilot_switch.settings = pg_catalog.jsonb_build_object(
       'contract_version', 1,
       'pilot_revision_id', pilot_revision.id,
       'configuration_digest', pilot_revision.configuration_digest
     )
   where pilot_revision.status = 'armed'
   for update of pilot_revision;

  if pilot.id is null then
    raise exception 'The no-money TeleBirr shadow verification authority is unavailable.';
  end if;

  perform app.require_private_telebirr_shadow_mode_ready(pilot.id);
  captured_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select member.*
    into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id
     and member.player_id_snapshot = p_player_id
   for share;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.provider_code_snapshot = 'telebirr'
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.pilot_revision_id = pilot.id
     and receiver_profile.payment_provider_id = provider_member.payment_provider_id
     and receiver_profile.pilot_configuration_digest = pilot.configuration_digest
     and captured_at >= receiver_profile.valid_from
     and captured_at < receiver_profile.valid_until
   for share;

  select player.* into current_player
    from app.customer_platform_players player
   where player.id = player_member.player_account_id
   for share;

  select decision.* into current_eligibility
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_member.player_account_id
   order by decision.decision_version desc
   limit 1
   for share;

  select provider.* into current_provider
    from app.payment_providers provider
   where provider.id = provider_member.payment_provider_id
   for share;

  if player_member.player_account_id is null
    or provider_member.payment_provider_id is null
    or profile.id is null
    or not exists (
      select 1 from app.private_live_deposit_pilot_customers member
       where member.pilot_revision_id = pilot.id
         and member.customer_id = customer_id
         and member.customer_status_snapshot = 'active'
    )
    or current_player.id is null
    or current_player.status <> 'active'
    or current_player.validation_status <> 'valid'
    or current_player.customer_id is distinct from player_member.player_owner_customer_id_snapshot
    or current_player.updated_at is distinct from player_member.player_updated_at_snapshot
    or current_eligibility.id is distinct from player_member.eligibility_decision_id_snapshot
    or current_eligibility.decision_version
         is distinct from player_member.eligibility_decision_version_snapshot
    or current_eligibility.decided_at is distinct from player_member.eligibility_decided_at_snapshot
    or current_eligibility.player_account_updated_at_snapshot is distinct from current_player.updated_at
    or current_eligibility.decision <> 'eligible'
    or current_provider.id is null
    or current_provider.code <> 'telebirr'
    or current_provider.status <> 'active'
    or current_provider.updated_at is distinct from provider_member.provider_updated_at_snapshot then
    raise exception 'The no-money TeleBirr shadow proof boundary is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:telebirr:shadow-proof:v1:'
        || provider_member.payment_provider_id::text || ':' || p_reference_fingerprint,
      0::bigint
    )
  );

  select proof.* into existing_proof
    from app.private_telebirr_shadow_proof_requests proof
   where proof.payment_provider_id = provider_member.payment_provider_id
     and proof.candidate_reference_fingerprint = p_reference_fingerprint
   for share;

  -- The per-reference advisory lock can outlive the first readiness check. Recheck the locked
  -- pilot and profile at a fresh instant before consuming the inbound event or minting a proof.
  perform app.require_private_telebirr_shadow_mode_ready(pilot.id);
  captured_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if captured_at < profile.valid_from or captured_at >= profile.valid_until then
    raise exception 'The no-money TeleBirr shadow proof boundary is unavailable.';
  end if;

  if existing_proof.id is not null then
    raise exception 'The TeleBirr shadow reference already belongs to another request.';
  end if;

  insert into app.private_telebirr_shadow_proof_requests (
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    receiver_profile_id,
    pilot_configuration_digest,
    candidate_reference_ciphertext,
    candidate_reference_fingerprint,
    candidate_reference_masked,
    reference_encryption_key_version,
    reference_profile_version,
    submitted_at,
    not_before,
    expires_at
  ) values (
    pilot.id,
    customer_id,
    player_member.player_account_id,
    provider_member.payment_provider_id,
    profile.id,
    pilot.configuration_digest,
    p_reference_ciphertext,
    p_reference_fingerprint,
    p_reference_masked,
    p_reference_key_version,
    p_reference_profile_version,
    captured_at,
    captured_at,
    least(captured_at + interval '5 minutes', pilot.expires_at, profile.valid_until)
  ) returning * into inserted_proof;

  insert into app.telegram_telebirr_shadow_proof_receipts (
    origin_inbound_event_id,
    customer_identity_id,
    submitting_customer_id,
    conversation_id,
    shadow_proof_request_id,
    semantic_input_hmac,
    conversation_version,
    created_at
  ) values (
    p_origin_inbound_event_id,
    customer_identity_id,
    customer_id,
    conversation_id,
    inserted_proof.id,
    p_semantic_input_hmac,
    conversation_version,
    captured_at
  );

  update app.inbound_events inbound_event
     set processed_at = captured_at,
         processing_error_code = null
   where inbound_event.id = p_origin_inbound_event_id
     and inbound_event.processed_at is null;
  if not found then
    raise exception 'The Telegram TeleBirr shadow proof receipt is unavailable.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_customer_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'customer',
    customer_id,
    'deposit.telebirr_shadow_proof_received',
    'private_telebirr_shadow_proof',
    inserted_proof.id,
    pg_catalog.jsonb_build_object(
      'channel', 'telegram',
      'provider_code', 'telebirr',
      'financial_mode', 'shadow_no_money',
      'reference_profile_version', p_reference_profile_version
    )
  );

  return query select inserted_proof.id,
                      inserted_proof.verification_job_id,
                      inserted_proof.provider_code,
                      inserted_proof.proof_status,
                      inserted_proof.submitted_at,
                      false;
end;
$$;

create trigger private_telebirr_shadow_proofs_immutable
before update or delete on app.private_telebirr_shadow_proof_requests
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_telebirr_shadow_proofs_no_truncate
before truncate on app.private_telebirr_shadow_proof_requests
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger telegram_telebirr_shadow_receipts_immutable
before update or delete on app.telegram_telebirr_shadow_proof_receipts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger telegram_telebirr_shadow_receipts_no_truncate
before truncate on app.telegram_telebirr_shadow_proof_receipts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger private_telebirr_shadow_attempts_immutable
before update or delete on app.private_telebirr_shadow_verification_attempts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_telebirr_shadow_attempts_no_truncate
before truncate on app.private_telebirr_shadow_verification_attempts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger private_telebirr_shadow_transcripts_immutable
before update or delete on app.private_telebirr_shadow_assignment_transcripts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_telebirr_shadow_transcripts_no_truncate
before truncate on app.private_telebirr_shadow_assignment_transcripts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger private_telebirr_shadow_staging_immutable
before update or delete on app.private_telebirr_shadow_device_evidence_staging
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_telebirr_shadow_staging_no_truncate
before truncate on app.private_telebirr_shadow_device_evidence_staging
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger private_telebirr_shadow_outcomes_immutable
before update or delete on app.private_telebirr_shadow_verification_outcomes
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_telebirr_shadow_outcomes_no_truncate
before truncate on app.private_telebirr_shadow_verification_outcomes
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger private_telebirr_shadow_quarantine_immutable
before update or delete on app.private_telebirr_shadow_evidence_quarantine
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_telebirr_shadow_quarantine_no_truncate
before truncate on app.private_telebirr_shadow_evidence_quarantine
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

alter table app.private_telebirr_shadow_proof_requests enable row level security;
alter table app.private_telebirr_shadow_proof_requests force row level security;
alter table app.telegram_telebirr_shadow_proof_receipts enable row level security;
alter table app.telegram_telebirr_shadow_proof_receipts force row level security;
alter table app.private_telebirr_shadow_verification_attempts enable row level security;
alter table app.private_telebirr_shadow_verification_attempts force row level security;
alter table app.private_telebirr_shadow_assignment_transcripts enable row level security;
alter table app.private_telebirr_shadow_assignment_transcripts force row level security;
alter table app.private_telebirr_shadow_device_evidence_staging enable row level security;
alter table app.private_telebirr_shadow_device_evidence_staging force row level security;
alter table app.private_telebirr_shadow_verification_outcomes enable row level security;
alter table app.private_telebirr_shadow_verification_outcomes force row level security;
alter table app.private_telebirr_shadow_evidence_quarantine enable row level security;
alter table app.private_telebirr_shadow_evidence_quarantine force row level security;

alter table app.private_telebirr_shadow_proof_requests owner to postgres;
alter table app.telegram_telebirr_shadow_proof_receipts owner to postgres;
alter table app.private_telebirr_shadow_verification_attempts owner to postgres;
alter table app.private_telebirr_shadow_assignment_transcripts owner to postgres;
alter table app.private_telebirr_shadow_device_evidence_staging owner to postgres;
alter table app.private_telebirr_shadow_verification_outcomes owner to postgres;
alter table app.private_telebirr_shadow_evidence_quarantine owner to postgres;

alter function app.require_telebirr_shadow_verifier_session() owner to postgres;
alter function app.private_telebirr_shadow_mode_is_ready(uuid) owner to postgres;
alter function app.require_private_telebirr_shadow_mode_ready(uuid) owner to postgres;
alter function app.get_owner_telebirr_shadow_verification_status(uuid) owner to postgres;
alter function app.capture_telegram_telebirr_shadow_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) owner to postgres;
alter function app.lease_private_telebirr_shadow_assignment(uuid, text, uuid, integer)
  owner to postgres;
alter function app.lease_private_live_telebirr_assignment_broker(uuid, text, uuid, integer)
  owner to postgres;
alter function app.persist_private_telebirr_shadow_assignment_signature(
  uuid, uuid, uuid, text, text, text, text
) owner to postgres;
alter function app.persist_private_live_telebirr_assignment_broker_signature(
  uuid, uuid, uuid, text, text, text, text
) owner to postgres;
alter function app.stage_private_telebirr_shadow_device_evidence(
  uuid, text, text, text, jsonb, jsonb
) owner to postgres;
alter function app.stage_private_telebirr_device_evidence(
  uuid, text, text, text, jsonb, jsonb
) owner to postgres;
alter function app.complete_private_telebirr_shadow_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) owner to postgres;
alter function app.load_next_private_telebirr_shadow_staged_evidence() owner to postgres;
alter function app.quarantine_private_telebirr_shadow_staged_evidence(
  uuid, uuid, text, text
) owner to postgres;
alter function app.load_private_telebirr_shadow_verification_authority(
  uuid, uuid, timestamptz
) owner to postgres;

revoke all privileges on table
  app.private_telebirr_shadow_proof_requests,
  app.telegram_telebirr_shadow_proof_receipts,
  app.private_telebirr_shadow_verification_attempts,
  app.private_telebirr_shadow_assignment_transcripts,
  app.private_telebirr_shadow_device_evidence_staging,
  app.private_telebirr_shadow_verification_outcomes,
  app.private_telebirr_shadow_evidence_quarantine
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.require_telebirr_shadow_verifier_session(),
  app.private_telebirr_shadow_mode_is_ready(uuid),
  app.require_private_telebirr_shadow_mode_ready(uuid),
  app.get_owner_telebirr_shadow_verification_status(uuid),
  app.capture_telegram_telebirr_shadow_proof(
    uuid, text, text, text, text, text, smallint, smallint, text
  ),
  app.lease_private_telebirr_shadow_assignment(uuid, text, uuid, integer),
  app.lease_private_live_telebirr_assignment_broker(uuid, text, uuid, integer),
  app.persist_private_telebirr_shadow_assignment_signature(
    uuid, uuid, uuid, text, text, text, text
  ),
  app.persist_private_live_telebirr_assignment_broker_signature(
    uuid, uuid, uuid, text, text, text, text
  ),
  app.stage_private_telebirr_shadow_device_evidence(
    uuid, text, text, text, jsonb, jsonb
  ),
  app.stage_private_telebirr_device_evidence(uuid, text, text, text, jsonb, jsonb),
  app.complete_private_telebirr_shadow_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  ),
  app.load_next_private_telebirr_shadow_staged_evidence(),
  app.quarantine_private_telebirr_shadow_staged_evidence(uuid, uuid, text, text),
  app.load_private_telebirr_shadow_verification_authority(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant usage on schema app
  to fetanagent_owner_control,
     fetanagent_player_actions,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_shadow_verifier;

grant execute on function app.get_owner_telebirr_shadow_verification_status(uuid)
  to fetanagent_owner_control;

grant execute on function app.capture_telegram_telebirr_shadow_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) to fetanagent_player_actions;
grant execute on function app.lease_private_live_telebirr_assignment_broker(
  uuid, text, uuid, integer
), app.persist_private_live_telebirr_assignment_broker_signature(
  uuid, uuid, uuid, text, text, text, text
) to fetanagent_telebirr_assignment_broker;
grant execute on function app.stage_private_telebirr_device_evidence(
  uuid, text, text, text, jsonb, jsonb
) to fetanagent_telebirr_device_state;
grant execute on function
  app.complete_private_telebirr_shadow_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  ),
  app.load_next_private_telebirr_shadow_staged_evidence(),
  app.quarantine_private_telebirr_shadow_staged_evidence(uuid, uuid, text, text),
  app.load_private_telebirr_shadow_verification_authority(uuid, uuid, timestamptz)
to fetanagent_telebirr_shadow_verifier;

comment on table app.private_telebirr_shadow_proof_requests is
  'Append-only fresh TeleBirr shadow inputs and opaque work IDs. This lineage is separate from both dry-run simulation proofs and live pilot proofs and has no money authority.';
comment on table app.private_telebirr_shadow_verification_outcomes is
  'Append-only authenticated advisory TeleBirr outcomes. Public shadow results are only would_verify, would_review, or would_reject; every financial identifier is structurally absent.';
comment on function app.get_owner_telebirr_shadow_verification_status(uuid) is
  'Returns only aggregate no-money TeleBirr shadow counts and gate state to the authenticated active Owner; no identifiers, references, evidence, digests, signatures, or financial authority are exposed.';
comment on function app.capture_telegram_telebirr_shadow_proof(
  uuid, text, text, text, text, text, smallint, smallint, text
) is
  'Consumes one intended Telegram event into the fresh no-money TeleBirr shadow lineage only while the exact armed dry-run pilot and all six disabled financial/provider switches remain current.';
comment on function app.lease_private_live_telebirr_assignment_broker(
  uuid, text, uuid, integer
) is
  'Existing exact broker surface: live authority delegates unchanged to the live lease; exact dry-run leases only fresh shadow work; every other valid poll observes the pre-existing safe empty-queue contract.';
comment on function app.complete_private_telebirr_shadow_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Records only a cryptographically authenticated advisory shadow outcome and always returns null claim, settlement, and execution identifiers with settlement_created=false.';

commit;
