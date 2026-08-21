-- Dormant proof-first TeleBirr verification lineage for the private five-account pilot.
--
-- This migration deliberately grants no runtime role any new capability. It models the exact
-- receiver profile, signer, device enrollment, immutable job/lease/transcript/outcome lineage,
-- and the one atomic settlement boundary needed by a later reviewed wiring migration. Existing
-- dry-run proof rows are not referenced anywhere in this schema and can never be promoted.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- The composite key lets every verification job prove that all of its protected proof bindings
-- came from one private-live proof row. The leading id keeps the index bounded for the five-row
-- pilot while the remaining columns make drift impossible through a foreign key.
alter table app.private_live_deposit_pilot_proofs
  add constraint private_live_pilot_proofs_exact_lineage_key
  unique (
    id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    candidate_reference_fingerprint,
    reference_encryption_key_version,
    reference_profile_version
  );

-- The outcome adapter validates a dynamic policy fact (including checked_at), while this digest
-- intentionally binds the immutable policy fields shared by every assessment. The canonical
-- database-snapshot digest is derived separately and binds checked_at and the complete dynamic fact.
-- These policy-digest bytes are identical to deriveTelebirrLivePilotPolicyDigest in the TypeScript adapter.
create function app.private_live_telebirr_policy_digest(
  p_minimum_principal_amount_minor bigint,
  p_maximum_principal_amount_minor bigint
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  minimum_text text;
  maximum_text text;
  canonical_policy text;
  digest_input bytea;
  digest_hex text;
begin
  if p_minimum_principal_amount_minor is null
    or p_minimum_principal_amount_minor <= 0
    or p_maximum_principal_amount_minor is null
    or p_maximum_principal_amount_minor < p_minimum_principal_amount_minor then
    raise exception 'The private live TeleBirr policy digest input is invalid.';
  end if;

  minimum_text := p_minimum_principal_amount_minor::text;
  maximum_text := p_maximum_principal_amount_minor::text;
  canonical_policy :=
    'o14{'
    || 'k22:"acceptedAdapterVersion"s38:"telebirr-live-private-pilot-adapter-v1"'
    || 'k25:"acceptedNormalizerVersion"s47:"telebirr-live-private-pilot-facts-normalizer-v1"'
    || 'k21:"acceptedParserVersion"s46:"telebirr-official-receipt-live-pilot-parser-v1"'
    || 'k14:"acceptedSource"s25:"telebirr_official_receipt"'
    || 'k21:"acceptedSourceProfile"s28:"telebirr_official_receipt_v1"'
    || 'k22:"allowedTransactionType"s10:"send_money"'
    || 'k25:"automaticFreshnessSeconds"i3600'
    || 'k12:"currencyCode"s3:"ETB"'
    || 'k24:"maximumFutureSkewSeconds"i300'
    || 'k27:"maximumPrincipalAmountMinor"s'
    || pg_catalog.octet_length(maximum_text)::text || ':"' || maximum_text || '"'
    || 'k27:"minimumPrincipalAmountMinor"s'
    || pg_catalog.octet_length(minimum_text)::text || ':"' || minimum_text || '"'
    || 'k13:"policyVersion"s32:"telebirr_private_pilot_policy_v1"'
    || 'k12:"providerCode"s8:"telebirr"'
    || 'k5:"state"s9:"available"}';

  digest_input := pg_catalog.convert_to(
    'telebirr-live-pilot-policy-digest-v1',
    'UTF8'
  ) || pg_catalog.decode('00', 'hex') || pg_catalog.convert_to(canonical_policy, 'UTF8');

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(extensions.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using digest_input;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(public.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using digest_input;
  else
    raise exception 'The private live TeleBirr policy digest function is unavailable.';
  end if;

  if digest_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'The private live TeleBirr policy digest result is invalid.';
  end if;

  return 'sha256:' || digest_hex;
end;
$$;

create function app.private_live_telebirr_eligibility_version(
  p_decision_version integer
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
begin
  if p_decision_version is null or p_decision_version <= 0 then
    raise exception 'The private live TeleBirr eligibility version is invalid.';
  end if;
  return 'kemerbet_player_eligibility_v' || p_decision_version::text;
end;
$$;

create table app.private_live_telebirr_receiver_profiles (
  id uuid primary key,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  payment_provider_id uuid not null
    references app.payment_providers (id) on delete restrict,
  provider_code text not null default 'telebirr' check (provider_code = 'telebirr'),
  receiver_account_id uuid not null,
  receiver_account_version integer not null check (receiver_account_version > 0),
  pilot_configuration_digest text not null
    check (pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_profile_digest text not null
    check (receiver_profile_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_configuration_digest text not null
    check (receiver_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_identity_digest text not null
    check (receiver_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_receiver_name_digest text not null
    check (expected_receiver_name_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_match_basis text not null default 'exact_full_name'
    check (receiver_match_basis = 'exact_full_name'),
  source_profile text not null default 'telebirr_official_receipt_v1'
    check (source_profile = 'telebirr_official_receipt_v1'),
  receiver_name_normalizer_version text not null
    default 'telebirr-credited-party-name-normalizer-v1'
    check (
      receiver_name_normalizer_version = 'telebirr-credited-party-name-normalizer-v1'
    ),
  adapter_version text not null default 'telebirr-live-private-pilot-adapter-v1'
    check (adapter_version = 'telebirr-live-private-pilot-adapter-v1'),
  parser_version text not null default 'telebirr-official-receipt-live-pilot-parser-v1'
    check (parser_version = 'telebirr-official-receipt-live-pilot-parser-v1'),
  facts_normalizer_version text not null
    default 'telebirr-live-private-pilot-facts-normalizer-v1'
    check (
      facts_normalizer_version = 'telebirr-live-private-pilot-facts-normalizer-v1'
    ),
  policy_version text not null default 'telebirr_private_pilot_policy_v1'
    check (policy_version = 'telebirr_private_pilot_policy_v1'),
  deposit_policy_version_id uuid not null,
  deposit_policy_version integer not null check (deposit_policy_version > 0),
  minimum_principal_amount_minor bigint not null
    check (minimum_principal_amount_minor > 0),
  maximum_principal_amount_minor bigint not null
    check (maximum_principal_amount_minor >= minimum_principal_amount_minor),
  policy_digest text not null check (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  automatic_freshness_seconds integer not null default 3600
    check (automatic_freshness_seconds = 3600),
  maximum_future_skew_seconds integer not null default 300
    check (maximum_future_skew_seconds = 300),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint private_live_telebirr_receiver_profile_window_check
    check (valid_until > valid_from),
  constraint private_live_telebirr_receiver_profile_identity_name_check
    check (receiver_identity_digest = expected_receiver_name_digest),
  constraint private_live_telebirr_receiver_profile_provider_fkey
    foreign key (
      pilot_revision_id,
      payment_provider_id,
      receiver_account_id,
      receiver_account_version
    ) references app.private_live_deposit_pilot_providers (
      pilot_revision_id,
      payment_provider_id,
      receiver_account_id,
      receiver_account_version
    ) on delete restrict,
  constraint private_live_telebirr_receiver_profile_policy_fkey
    foreign key (deposit_policy_version_id, deposit_policy_version)
    references app.deposit_policy_versions (id, version) on delete restrict,
  constraint private_live_telebirr_receiver_profile_exact_key unique (
    id,
    pilot_revision_id,
    payment_provider_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    receiver_profile_digest,
    receiver_configuration_digest,
    receiver_identity_digest,
    expected_receiver_name_digest,
    deposit_policy_version_id,
    deposit_policy_version,
    minimum_principal_amount_minor,
    maximum_principal_amount_minor,
    policy_digest
  ),
  constraint private_live_telebirr_one_profile_per_receiver_key unique (
    pilot_revision_id,
    payment_provider_id,
    receiver_account_id,
    receiver_account_version
  )
);

create index private_live_telebirr_receiver_profiles_provider_idx
  on app.private_live_telebirr_receiver_profiles (payment_provider_id);
create index private_live_telebirr_receiver_profiles_receiver_idx
  on app.private_live_telebirr_receiver_profiles (receiver_account_id);
create index private_live_telebirr_receiver_profiles_policy_idx
  on app.private_live_telebirr_receiver_profiles (deposit_policy_version_id);

create table app.private_live_telebirr_assignment_signers (
  id uuid primary key,
  signer_key_id text not null unique
    check (
      signer_key_id = btrim(signer_key_id)
      and signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    ),
  public_key_spki_sha256 text not null unique
    check (public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature_algorithm text not null default 'ecdsa-p256-sha256'
    check (signature_algorithm = 'ecdsa-p256-sha256'),
  signature_encoding text not null default 'ieee-p1363-base64url'
    check (signature_encoding = 'ieee-p1363-base64url'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint private_live_telebirr_assignment_signer_window_check
    check (valid_until > valid_from)
);

create table app.private_live_telebirr_assignment_signer_revocations (
  assignment_signer_id uuid primary key
    references app.private_live_telebirr_assignment_signers (id) on delete restrict,
  revoked_at timestamptz not null,
  reason_code text not null
    check (reason_code in ('owner_revoked', 'key_compromise', 'key_rotation', 'pilot_stopped')),
  created_at timestamptz not null default clock_timestamp()
);

create table app.private_live_telebirr_device_enrollments (
  id uuid primary key,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  device_id text not null
    check (
      device_id = btrim(device_id)
      and device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    ),
  key_id text not null
    check (
      key_id = btrim(key_id)
      and key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    ),
  public_key_spki_sha256 text not null
    check (public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature_algorithm text not null default 'ecdsa-p256-sha256'
    check (signature_algorithm = 'ecdsa-p256-sha256'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint private_live_telebirr_device_enrollment_window_check
    check (valid_until > valid_from),
  constraint private_live_telebirr_device_enrollment_identity_key
    unique (pilot_revision_id, device_id, key_id),
  constraint private_live_telebirr_device_enrollment_key_fingerprint_key
    unique (pilot_revision_id, public_key_spki_sha256)
);

create index private_live_telebirr_device_enrollments_profile_idx
  on app.private_live_telebirr_device_enrollments (receiver_profile_id);

create table app.private_live_telebirr_device_revocations (
  device_enrollment_id uuid primary key
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  revoked_at timestamptz not null,
  reason_code text not null
    check (reason_code in ('owner_revoked', 'device_lost', 'key_compromise', 'pilot_stopped')),
  created_at timestamptz not null default clock_timestamp()
);

create table app.private_live_telebirr_verification_jobs (
  id uuid primary key default gen_random_uuid(),
  enqueue_request_key uuid not null unique,
  enqueue_request_digest text not null unique
    check (enqueue_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  private_live_deposit_pilot_proof_id uuid not null unique,
  pilot_revision_id uuid not null,
  submitting_customer_id uuid not null,
  player_account_id uuid not null,
  payment_provider_id uuid not null,
  provider_code text not null default 'telebirr' check (provider_code = 'telebirr'),
  receiver_profile_id uuid not null,
  receiver_account_id uuid not null,
  receiver_account_version integer not null check (receiver_account_version > 0),
  pilot_configuration_digest text not null
    check (pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_profile_digest text not null
    check (receiver_profile_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_configuration_digest text not null
    check (receiver_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_identity_digest text not null
    check (receiver_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_receiver_name_digest text not null
    check (expected_receiver_name_digest ~ '^sha256:[0-9a-f]{64}$'),
  deposit_policy_version_id uuid not null,
  deposit_policy_version integer not null check (deposit_policy_version > 0),
  minimum_principal_amount_minor bigint not null
    check (minimum_principal_amount_minor > 0),
  maximum_principal_amount_minor bigint not null
    check (maximum_principal_amount_minor >= minimum_principal_amount_minor),
  policy_digest text not null check (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  reference_encryption_key_version smallint not null check (reference_encryption_key_version = 2),
  reference_profile_version smallint not null check (reference_profile_version = 2),
  submitted_at timestamptz not null,
  not_before timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint private_live_telebirr_job_request_key_v4_check check (
    enqueue_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_telebirr_job_window_check check (
    not_before = submitted_at
    and expires_at > not_before
    and expires_at <= submitted_at + interval '5 minutes'
  ),
  constraint private_live_telebirr_job_proof_fkey
    foreign key (
      private_live_deposit_pilot_proof_id,
      pilot_revision_id,
      submitting_customer_id,
      player_account_id,
      payment_provider_id,
      candidate_reference_fingerprint,
      reference_encryption_key_version,
      reference_profile_version
    ) references app.private_live_deposit_pilot_proofs (
      id,
      pilot_revision_id,
      submitting_customer_id,
      player_account_id,
      payment_provider_id,
      candidate_reference_fingerprint,
      reference_encryption_key_version,
      reference_profile_version
    ) on delete restrict,
  constraint private_live_telebirr_job_profile_fkey
    foreign key (
      receiver_profile_id,
      pilot_revision_id,
      payment_provider_id,
      receiver_account_id,
      receiver_account_version,
      pilot_configuration_digest,
      receiver_profile_digest,
      receiver_configuration_digest,
      receiver_identity_digest,
      expected_receiver_name_digest,
      deposit_policy_version_id,
      deposit_policy_version,
      minimum_principal_amount_minor,
      maximum_principal_amount_minor,
      policy_digest
    ) references app.private_live_telebirr_receiver_profiles (
      id,
      pilot_revision_id,
      payment_provider_id,
      receiver_account_id,
      receiver_account_version,
      pilot_configuration_digest,
      receiver_profile_digest,
      receiver_configuration_digest,
      receiver_identity_digest,
      expected_receiver_name_digest,
      deposit_policy_version_id,
      deposit_policy_version,
      minimum_principal_amount_minor,
      maximum_principal_amount_minor,
      policy_digest
    ) on delete restrict
);

create index private_live_telebirr_jobs_claimable_idx
  on app.private_live_telebirr_verification_jobs (not_before, expires_at, submitted_at, id);
create index private_live_telebirr_jobs_pilot_idx
  on app.private_live_telebirr_verification_jobs (pilot_revision_id, created_at, id);
create index private_live_telebirr_jobs_customer_idx
  on app.private_live_telebirr_verification_jobs (submitting_customer_id);
create index private_live_telebirr_jobs_player_idx
  on app.private_live_telebirr_verification_jobs (player_account_id);
create index private_live_telebirr_jobs_provider_reference_idx
  on app.private_live_telebirr_verification_jobs (
    payment_provider_id,
    candidate_reference_fingerprint
  );

create table app.private_live_telebirr_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  verification_job_id uuid not null
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 100),
  lease_request_key uuid not null unique,
  lease_request_digest text not null unique
    check (lease_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  lease_token uuid not null unique,
  request_id uuid not null unique,
  assignment_id uuid not null unique,
  requested_lease_seconds integer not null check (requested_lease_seconds between 30 and 300),
  leased_by text not null
    check (
      leased_by = btrim(leased_by)
      and leased_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    ),
  device_enrollment_id uuid not null
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  device_id_snapshot text not null,
  device_key_id_snapshot text not null,
  device_public_key_spki_sha256_snapshot text not null
    check (device_public_key_spki_sha256_snapshot ~ '^sha256:[0-9a-f]{64}$'),
  lease_nonce_digest text not null unique
    check (lease_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  challenge_id uuid not null unique,
  challenge_digest text not null unique
    check (challenge_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint private_live_telebirr_attempt_request_key_v4_check check (
    lease_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_telebirr_attempt_window_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '5 minutes'
  ),
  constraint private_live_telebirr_attempt_number_key
    unique (verification_job_id, attempt_number)
);

create index private_live_telebirr_attempts_job_expiry_idx
  on app.private_live_telebirr_verification_attempts (
    verification_job_id,
    expires_at desc,
    attempt_number desc
  );
create index private_live_telebirr_attempts_enrollment_idx
  on app.private_live_telebirr_verification_attempts (device_enrollment_id);

create table app.private_live_telebirr_assignment_transcripts (
  id uuid primary key default gen_random_uuid(),
  verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  assignment_signer_id uuid not null
    references app.private_live_telebirr_assignment_signers (id) on delete restrict,
  transcript_version text not null
    default 'telebirr-live-private-pilot-assignment-transcript-v1'
    check (
      transcript_version = 'telebirr-live-private-pilot-assignment-transcript-v1'
    ),
  body_digest_algorithm text not null default 'sha256'
    check (body_digest_algorithm = 'sha256'),
  assignment_body_digest text not null unique
    check (assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signature_algorithm text not null default 'ecdsa-p256-sha256'
    check (signature_algorithm = 'ecdsa-p256-sha256'),
  signature_encoding text not null default 'ieee-p1363-base64url'
    check (signature_encoding = 'ieee-p1363-base64url'),
  signer_key_id_snapshot text not null,
  signer_public_key_spki_sha256_snapshot text not null
    check (signer_public_key_spki_sha256_snapshot ~ '^sha256:[0-9a-f]{64}$'),
  assignment_signature_digest text not null unique
    check (assignment_signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  reference_binding_profile text not null
    default 'telebirr-provider-reference-binding-v1'
    check (reference_binding_profile = 'telebirr-provider-reference-binding-v1'),
  reference_binding_digest text not null unique
    check (reference_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create index private_live_telebirr_assignment_transcripts_signer_idx
  on app.private_live_telebirr_assignment_transcripts (assignment_signer_id);

create table app.private_live_telebirr_observation_transcripts (
  id uuid primary key default gen_random_uuid(),
  verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  assignment_transcript_id uuid not null unique
    references app.private_live_telebirr_assignment_transcripts (id) on delete restrict,
  transcript_version text not null
    default 'telebirr-live-private-pilot-observation-transcript-v1'
    check (
      transcript_version = 'telebirr-live-private-pilot-observation-transcript-v1'
    ),
  body_digest_algorithm text not null default 'sha256'
    check (body_digest_algorithm = 'sha256'),
  observation_body_digest text not null unique
    check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signature_algorithm text not null default 'ecdsa-p256-sha256'
    check (signature_algorithm = 'ecdsa-p256-sha256'),
  signature_encoding text not null default 'ieee-p1363-base64url'
    check (signature_encoding = 'ieee-p1363-base64url'),
  observation_signature_digest text not null unique
    check (observation_signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  replay_identity text unique
    check (replay_identity is null or replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  source_document_digest text not null unique
    check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  normalized_facts_digest text not null
    check (normalized_facts_digest ~ '^sha256:[0-9a-f]{64}$'),
  protocol_disposition text not null
    check (
      protocol_disposition in (
        'invalid_request',
        'would_review',
        'would_forward_signed_evidence'
      )
    ),
  protocol_reason_code text not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create table app.private_live_telebirr_verification_outcomes (
  id uuid primary key default gen_random_uuid(),
  verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  verification_job_id uuid not null
    references app.private_live_telebirr_verification_jobs (id) on delete restrict,
  observation_transcript_id uuid not null unique
    references app.private_live_telebirr_observation_transcripts (id) on delete restrict,
  completion_request_key uuid not null unique,
  completion_request_digest text not null unique
    check (completion_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  private_live_deposit_pilot_proof_id uuid not null,
  pilot_revision_id uuid not null,
  submitting_customer_id uuid not null,
  player_account_id uuid not null,
  player_owner_customer_id_snapshot uuid not null,
  platform_id uuid not null,
  payment_provider_id uuid not null,
  provider_code text not null default 'telebirr' check (provider_code = 'telebirr'),
  receiver_profile_id uuid not null,
  receiver_account_id uuid not null,
  receiver_account_version integer not null check (receiver_account_version > 0),
  pilot_configuration_digest text not null
    check (pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_reference_fingerprint text not null
    check (candidate_reference_fingerprint ~ '^[0-9a-f]{64}$'),
  reference_encryption_key_version smallint not null
    check (reference_encryption_key_version = 2),
  reference_profile_version smallint not null check (reference_profile_version = 2),
  outcome_contract_version smallint not null default 1
    check (outcome_contract_version = 1),
  assessment_contract_version smallint not null default 1
    check (assessment_contract_version = 1),
  assessment_input_digest text not null
    check (assessment_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  assessed_at timestamptz not null,
  disposition text not null
    check (disposition in ('settlement_candidate', 'definite_reject', 'review_required')),
  reason_code text not null,
  source text not null default 'telebirr_official_receipt'
    check (source = 'telebirr_official_receipt'),
  source_profile text not null default 'telebirr_official_receipt_v1'
    check (source_profile = 'telebirr_official_receipt_v1'),
  observation_version smallint not null default 1 check (observation_version = 1),
  adapter_version text not null default 'telebirr-live-private-pilot-adapter-v1'
    check (adapter_version = 'telebirr-live-private-pilot-adapter-v1'),
  parser_version text not null default 'telebirr-official-receipt-live-pilot-parser-v1'
    check (parser_version = 'telebirr-official-receipt-live-pilot-parser-v1'),
  normalizer_version text not null
    default 'telebirr-live-private-pilot-facts-normalizer-v1'
    check (normalizer_version = 'telebirr-live-private-pilot-facts-normalizer-v1'),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  retrieved_at timestamptz not null,
  principal_amount_minor bigint,
  currency_code character(3),
  occurred_at timestamptz,
  receiver_identity_digest text,
  receiver_match_basis text,
  deposit_intent_id uuid,
  deposit_submission_id uuid,
  provider_payment_evidence_id uuid,
  deposit_verification_attempt_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint private_live_telebirr_outcome_request_key_v4_check check (
    completion_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_telebirr_outcome_reference_receiver_shapes check (
    receiver_identity_digest is null
    or receiver_identity_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint private_live_telebirr_outcome_settlement_shape check (
    (
      disposition = 'settlement_candidate'
      and reason_code = 'exact_proof_match'
      and principal_amount_minor is not null
      and principal_amount_minor > 0
      and currency_code = 'ETB'
      and occurred_at is not null
      and receiver_identity_digest is not null
      and receiver_match_basis = 'exact_full_name'
      and deposit_intent_id is not null
      and deposit_submission_id is not null
      and provider_payment_evidence_id is not null
      and deposit_verification_attempt_id is not null
    )
    or (
      disposition in ('definite_reject', 'review_required')
      and reason_code <> 'exact_proof_match'
      and principal_amount_minor is null
      and currency_code is null
      and occurred_at is null
      and receiver_identity_digest is null
      and receiver_match_basis is null
      and deposit_intent_id is null
      and deposit_submission_id is null
      and provider_payment_evidence_id is null
      and deposit_verification_attempt_id is null
    )
  ),
  constraint private_live_telebirr_outcome_legacy_ids_distinct_check check (
    deposit_intent_id is null
    or (
      deposit_intent_id <> deposit_submission_id
      and deposit_intent_id <> provider_payment_evidence_id
      and deposit_intent_id <> deposit_verification_attempt_id
      and deposit_submission_id <> provider_payment_evidence_id
      and deposit_submission_id <> deposit_verification_attempt_id
      and provider_payment_evidence_id <> deposit_verification_attempt_id
    )
  ),
  constraint private_live_telebirr_outcome_job_proof_fkey
    foreign key (
      private_live_deposit_pilot_proof_id,
      pilot_revision_id,
      submitting_customer_id,
      player_account_id,
      payment_provider_id,
      candidate_reference_fingerprint,
      reference_encryption_key_version,
      reference_profile_version
    ) references app.private_live_deposit_pilot_proofs (
      id,
      pilot_revision_id,
      submitting_customer_id,
      player_account_id,
      payment_provider_id,
      candidate_reference_fingerprint,
      reference_encryption_key_version,
      reference_profile_version
    ) on delete restrict,
  constraint private_live_telebirr_outcome_intent_fkey
    foreign key (deposit_intent_id)
    references app.deposit_intents (id) on delete restrict
    deferrable initially deferred,
  constraint private_live_telebirr_outcome_submission_fkey
    foreign key (deposit_submission_id)
    references app.deposit_submissions (id) on delete restrict
    deferrable initially deferred,
  constraint private_live_telebirr_outcome_evidence_fkey
    foreign key (provider_payment_evidence_id)
    references app.provider_payment_evidence (id) on delete restrict
    deferrable initially deferred,
  constraint private_live_telebirr_outcome_attempt_fkey
    foreign key (deposit_verification_attempt_id)
    references app.deposit_verification_attempts (id) on delete restrict
    deferrable initially deferred
);

create index private_live_telebirr_outcomes_job_idx
  on app.private_live_telebirr_verification_outcomes (verification_job_id);
create index private_live_telebirr_outcomes_proof_idx
  on app.private_live_telebirr_verification_outcomes (private_live_deposit_pilot_proof_id);
create index private_live_telebirr_outcomes_pilot_idx
  on app.private_live_telebirr_verification_outcomes (pilot_revision_id, created_at, id);
create index private_live_telebirr_outcomes_customer_idx
  on app.private_live_telebirr_verification_outcomes (submitting_customer_id);
create index private_live_telebirr_outcomes_player_idx
  on app.private_live_telebirr_verification_outcomes (player_account_id);
create unique index private_live_telebirr_outcomes_settlement_reference_idx
  on app.private_live_telebirr_verification_outcomes (
    payment_provider_id,
    candidate_reference_fingerprint
  )
  where disposition = 'settlement_candidate';

create table app.private_live_telebirr_settlement_receipts (
  id uuid primary key default gen_random_uuid(),
  verification_outcome_id uuid not null unique
    references app.private_live_telebirr_verification_outcomes (id) on delete restrict,
  deposit_intent_id uuid not null unique
    references app.deposit_intents (id) on delete restrict,
  deposit_payment_claim_id uuid not null unique
    references app.deposit_payment_claims (id) on delete restrict,
  execution_job_id uuid not null unique
    references app.deposit_jobs (id) on delete restrict,
  deposit_status text not null check (deposit_status = 'execution_pending'),
  execution_job_status text not null check (execution_job_status = 'queued'),
  settlement_replayed boolean not null check (settlement_replayed = false),
  settled_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

-- Existing legacy ledgers remain the retained financial record. These nullable, immutable links
-- distinguish the receipt-derived pilot path from every historical amount-first path.
alter table app.deposit_intents
  add column private_live_telebirr_outcome_id uuid unique
  references app.private_live_telebirr_verification_outcomes (id)
  on delete restrict deferrable initially deferred;
alter table app.deposit_submissions
  add column private_live_telebirr_outcome_id uuid unique
  references app.private_live_telebirr_verification_outcomes (id)
  on delete restrict deferrable initially deferred;
alter table app.provider_payment_evidence
  add column private_live_telebirr_outcome_id uuid unique
  references app.private_live_telebirr_verification_outcomes (id)
  on delete restrict deferrable initially deferred;
alter table app.deposit_verification_attempts
  add column private_live_telebirr_outcome_id uuid unique
  references app.private_live_telebirr_verification_outcomes (id)
  on delete restrict deferrable initially deferred;

alter table app.private_live_telebirr_verification_jobs
  add constraint private_live_telebirr_job_exact_outcome_key unique (
    id,
    private_live_deposit_pilot_proof_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    receiver_profile_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    candidate_reference_fingerprint,
    reference_encryption_key_version,
    reference_profile_version
  );
alter table app.private_live_telebirr_verification_attempts
  add constraint private_live_telebirr_attempt_job_key
  unique (id, verification_job_id);
alter table app.private_live_telebirr_assignment_transcripts
  add constraint private_live_telebirr_assignment_attempt_key
  unique (id, verification_attempt_id);
alter table app.private_live_telebirr_observation_transcripts
  add constraint private_live_telebirr_observation_attempt_key
  unique (id, verification_attempt_id);

alter table app.private_live_telebirr_observation_transcripts
  add constraint private_live_telebirr_observation_assignment_fkey
  foreign key (assignment_transcript_id, verification_attempt_id)
  references app.private_live_telebirr_assignment_transcripts (
    id,
    verification_attempt_id
  ) on delete restrict;
alter table app.private_live_telebirr_verification_outcomes
  add constraint private_live_telebirr_outcome_exact_job_fkey
  foreign key (
    verification_job_id,
    private_live_deposit_pilot_proof_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    receiver_profile_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    candidate_reference_fingerprint,
    reference_encryption_key_version,
    reference_profile_version
  ) references app.private_live_telebirr_verification_jobs (
    id,
    private_live_deposit_pilot_proof_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    receiver_profile_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    candidate_reference_fingerprint,
    reference_encryption_key_version,
    reference_profile_version
  ) on delete restrict;
alter table app.private_live_telebirr_verification_outcomes
  add constraint private_live_telebirr_outcome_exact_attempt_fkey
  foreign key (verification_attempt_id, verification_job_id)
  references app.private_live_telebirr_verification_attempts (
    id,
    verification_job_id
  ) on delete restrict;
alter table app.private_live_telebirr_verification_outcomes
  add constraint private_live_telebirr_outcome_exact_observation_fkey
  foreign key (observation_transcript_id, verification_attempt_id)
  references app.private_live_telebirr_observation_transcripts (
    id,
    verification_attempt_id
  ) on delete restrict;

alter table app.private_live_telebirr_observation_transcripts
  add constraint private_live_telebirr_observation_protocol_reason_check check (
    protocol_reason_code in (
      'invalid_request',
      'assignment_signer_revoked',
      'assignment_signer_expired',
      'assignment_signer_key_invalid',
      'assignment_signer_key_mismatch',
      'assignment_signature_invalid',
      'device_revoked',
      'device_enrollment_expired',
      'device_key_invalid',
      'device_key_mismatch',
      'device_signature_invalid',
      'assignment_expired',
      'observation_time_invalid',
      'binding_mismatch',
      'reference_binding_mismatch',
      'receiver_binding_mismatch',
      'source_profile_mismatch',
      'version_mismatch',
      'facts_digest_mismatch',
      'assignment_body_digest_mismatch',
      'observation_body_digest_mismatch',
      'replay_detected',
      'receipt_requires_review',
      'reference_mismatch',
      'receiver_mismatch',
      'provider_status_not_completed',
      'receipt_semantics_incomplete',
      'signed_evidence_verified'
    )
    and (
      (protocol_disposition = 'would_forward_signed_evidence'
        and protocol_reason_code = 'signed_evidence_verified'
        and replay_identity is not null)
      or (protocol_disposition <> 'would_forward_signed_evidence'
        and protocol_reason_code <> 'signed_evidence_verified')
    )
  );

alter table app.private_live_telebirr_verification_outcomes
  add constraint private_live_telebirr_outcome_reason_check check (
    (disposition = 'settlement_candidate' and reason_code = 'exact_proof_match')
    or (disposition = 'definite_reject' and reason_code in (
      'player_ineligible',
      'duplicate_reference_reused',
      'provider_mismatch',
      'reference_mismatch',
      'receipt_failed',
      'currency_not_etb',
      'receiver_mismatch'
    ))
    or (disposition = 'review_required' and reason_code in (
      'invalid_assessment_input',
      'database_facts_unbound',
      'policy_unavailable',
      'policy_contract_mismatch',
      'eligibility_unavailable',
      'eligibility_ambiguous',
      'duplicate_check_unavailable',
      'duplicate_check_ambiguous',
      'source_unavailable',
      'source_ambiguous',
      'source_uncertain',
      'source_unsupported',
      'observation_version_unsupported',
      'parser_uncertain',
      'receipt_pending',
      'receipt_status_unknown',
      'transaction_type_unsupported',
      'receiver_history_gap',
      'receiver_history_overlap',
      'receiver_history_unavailable',
      'receiver_match_basis_unsupported',
      'amount_out_of_range',
      'receipt_too_old',
      'receipt_after_submission',
      'future_skew_exceeded'
    ))
  );

create function app.reject_private_live_telebirr_lineage_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private live TeleBirr proof lineage is append-only.';
end;
$$;

create function app.reject_private_live_telebirr_lineage_truncate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Private live TeleBirr proof lineage cannot be truncated.';
end;
$$;

create function app.enforce_private_live_telebirr_legacy_link_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.private_live_telebirr_outcome_id
       is distinct from old.private_live_telebirr_outcome_id then
    raise exception 'Private live TeleBirr legacy lineage is immutable.';
  end if;
  return new;
end;
$$;

-- Every table in this slice, including enrollment/revocation material, is retained. Revocation is
-- itself an append-only event; no key or device row is ever rewritten to erase its history.
create trigger private_live_telebirr_receiver_profiles_immutable
before update or delete on app.private_live_telebirr_receiver_profiles
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_receiver_profiles_no_truncate
before truncate on app.private_live_telebirr_receiver_profiles
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_assignment_signers_immutable
before update or delete on app.private_live_telebirr_assignment_signers
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_assignment_signers_no_truncate
before truncate on app.private_live_telebirr_assignment_signers
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_signer_revocations_immutable
before update or delete on app.private_live_telebirr_assignment_signer_revocations
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_signer_revocations_no_truncate
before truncate on app.private_live_telebirr_assignment_signer_revocations
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_device_enrollments_immutable
before update or delete on app.private_live_telebirr_device_enrollments
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_device_enrollments_no_truncate
before truncate on app.private_live_telebirr_device_enrollments
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_device_revocations_immutable
before update or delete on app.private_live_telebirr_device_revocations
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_device_revocations_no_truncate
before truncate on app.private_live_telebirr_device_revocations
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_jobs_immutable
before update or delete on app.private_live_telebirr_verification_jobs
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_jobs_no_truncate
before truncate on app.private_live_telebirr_verification_jobs
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_attempts_immutable
before update or delete on app.private_live_telebirr_verification_attempts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_attempts_no_truncate
before truncate on app.private_live_telebirr_verification_attempts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_assignment_transcripts_immutable
before update or delete on app.private_live_telebirr_assignment_transcripts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_assignment_transcripts_no_truncate
before truncate on app.private_live_telebirr_assignment_transcripts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_observation_transcripts_immutable
before update or delete on app.private_live_telebirr_observation_transcripts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_observation_transcripts_no_truncate
before truncate on app.private_live_telebirr_observation_transcripts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_outcomes_immutable
before update or delete on app.private_live_telebirr_verification_outcomes
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_outcomes_no_truncate
before truncate on app.private_live_telebirr_verification_outcomes
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();
create trigger private_live_telebirr_settlement_receipts_immutable
before update or delete on app.private_live_telebirr_settlement_receipts
for each row execute function app.reject_private_live_telebirr_lineage_mutation();
create trigger private_live_telebirr_settlement_receipts_no_truncate
before truncate on app.private_live_telebirr_settlement_receipts
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create trigger deposit_intents_private_live_telebirr_link_immutable
before update on app.deposit_intents
for each row execute function app.enforce_private_live_telebirr_legacy_link_immutable();
create trigger deposit_submissions_private_live_telebirr_link_immutable
before update on app.deposit_submissions
for each row execute function app.enforce_private_live_telebirr_legacy_link_immutable();

create function app.enforce_private_live_telebirr_receiver_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  policy app.deposit_policy_versions%rowtype;
  expected_policy_digest text;
begin
  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = new.pilot_revision_id
   for share;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = new.pilot_revision_id
     and member.payment_provider_id = new.payment_provider_id
     and member.receiver_account_id = new.receiver_account_id
     and member.receiver_account_version = new.receiver_account_version
     and member.provider_code_snapshot = 'telebirr'
   for share;

  select policy_version.*
    into policy
    from app.deposit_policy_versions policy_version
   where policy_version.status = 'active'
   for share;

  expected_policy_digest := app.private_live_telebirr_policy_digest(
    greatest(pilot.minimum_amount_minor, policy.minimum_amount_minor),
    least(pilot.maximum_per_deposit_minor, policy.maximum_amount_minor)
  );

  if pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is null
    or new.pilot_configuration_digest is distinct from pilot.configuration_digest
    or provider_member.payment_provider_id is null
    or policy.id is null
    or policy.freshness_window_seconds <> 3600
    or new.deposit_policy_version_id is distinct from policy.id
    or new.deposit_policy_version is distinct from policy.version
    or new.minimum_principal_amount_minor is distinct from greatest(
      pilot.minimum_amount_minor,
      policy.minimum_amount_minor
    )
    or new.maximum_principal_amount_minor is distinct from least(
      pilot.maximum_per_deposit_minor,
      policy.maximum_amount_minor
    )
    or new.maximum_principal_amount_minor < new.minimum_principal_amount_minor
    or new.provider_code <> provider_member.provider_code_snapshot
    or new.valid_from < pilot.active_from
    or new.valid_until > pilot.expires_at
    or new.policy_digest is distinct from expected_policy_digest then
    raise exception 'The private live TeleBirr receiver profile binding is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_receiver_profiles_insert_guard
before insert on app.private_live_telebirr_receiver_profiles
for each row execute function app.enforce_private_live_telebirr_receiver_profile_insert();

create function app.enforce_private_live_telebirr_device_enrollment_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  profile app.private_live_telebirr_receiver_profiles%rowtype;
begin
  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = new.receiver_profile_id
   for key share;

  if profile.id is null
    or new.pilot_revision_id is distinct from profile.pilot_revision_id
    or new.valid_from < profile.valid_from
    or new.valid_until > profile.valid_until then
    raise exception 'The private live TeleBirr device enrollment binding is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_device_enrollments_insert_guard
before insert on app.private_live_telebirr_device_enrollments
for each row execute function app.enforce_private_live_telebirr_device_enrollment_insert();

create function app.enforce_private_live_telebirr_signer_revocation_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  signer app.private_live_telebirr_assignment_signers%rowtype;
begin
  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.id = new.assignment_signer_id
   for update;

  if signer.id is null or new.revoked_at < signer.valid_from then
    raise exception 'The private live TeleBirr signer revocation is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_signer_revocations_insert_guard
before insert on app.private_live_telebirr_assignment_signer_revocations
for each row execute function app.enforce_private_live_telebirr_signer_revocation_insert();

create function app.enforce_private_live_telebirr_device_revocation_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
begin
  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = new.device_enrollment_id
   for update;

  if enrollment.id is null or new.revoked_at < enrollment.valid_from then
    raise exception 'The private live TeleBirr device revocation is invalid.';
  end if;

  return new;
end;
$$;

create trigger private_live_telebirr_device_revocations_insert_guard
before insert on app.private_live_telebirr_device_revocations
for each row execute function app.enforce_private_live_telebirr_device_revocation_insert();

create function app.stage_private_live_telebirr_verification_job(
  p_private_live_deposit_pilot_proof_id uuid,
  p_enqueue_request_key uuid
)
returns table (
  verification_job_id uuid,
  pilot_revision_id uuid,
  private_live_deposit_pilot_proof_id uuid,
  expires_at timestamptz,
  already_staged boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  policy app.deposit_policy_versions%rowtype;
  existing_job app.private_live_telebirr_verification_jobs%rowtype;
  inserted_job app.private_live_telebirr_verification_jobs%rowtype;
  pilot_id uuid;
  request_digest text;
  staged_at timestamptz;
  switch_count integer;
begin
  if p_private_live_deposit_pilot_proof_id is null
    or p_enqueue_request_key is null
    or p_enqueue_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The private live TeleBirr verification staging request is invalid.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  select (pilot_switch.settings ->> 'pilot_revision_id')::uuid
    into pilot_id
    from app.feature_switches pilot_switch
   where pilot_switch.feature_key = 'private_live_deposit_pilot'
     and pilot_switch.mode = 'live'
     and pg_catalog.jsonb_typeof(pilot_switch.settings) = 'object'
     and pilot_switch.settings ? 'pilot_revision_id';

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = pilot_id
   for update;

  staged_at := clock_timestamp();

  if switch_count <> 5
    or pilot.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is null
    or staged_at < pilot.active_from
    or staged_at >= pilot.expires_at
    or not app.is_private_live_deposit_pilot_enforced()
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    ) then
    raise exception 'The private live TeleBirr verification staging authority is unavailable.';
  end if;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = p_private_live_deposit_pilot_proof_id
     and proof_row.pilot_revision_id = pilot.id
     and proof_row.provider_code_snapshot = 'telebirr'
   for key share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.pilot_revision_id = pilot.id
     and receiver_profile.payment_provider_id = proof.payment_provider_id
     and receiver_profile.pilot_configuration_digest = pilot.configuration_digest
     and staged_at >= receiver_profile.valid_from
     and staged_at < receiver_profile.valid_until
   for key share;

  select policy_version.*
    into policy
    from app.deposit_policy_versions policy_version
   where policy_version.status = 'active'
   for share;

  if proof.id is null
    or profile.id is null
    or policy.id is null
    or policy.freshness_window_seconds <> 3600
    or profile.deposit_policy_version_id is distinct from policy.id
    or profile.deposit_policy_version is distinct from policy.version
    or profile.minimum_principal_amount_minor is distinct from greatest(
      pilot.minimum_amount_minor,
      policy.minimum_amount_minor
    )
    or profile.maximum_principal_amount_minor is distinct from least(
      pilot.maximum_per_deposit_minor,
      policy.maximum_amount_minor
    )
    or profile.policy_digest is distinct from app.private_live_telebirr_policy_digest(
      profile.minimum_principal_amount_minor,
      profile.maximum_principal_amount_minor
    )
    or proof.submitted_at > staged_at + interval '5 minutes'
    or staged_at >= proof.submitted_at + interval '5 minutes' then
    raise exception 'The private live TeleBirr verification proof is unavailable.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:verification-job:v1'
      || '|request_key=' || p_enqueue_request_key::text
      || '|proof_id=' || proof.id::text
      || '|pilot_revision_id=' || pilot.id::text
      || '|pilot_configuration_digest=' || pilot.configuration_digest
      || '|submitting_customer_id=' || proof.submitting_customer_id::text
      || '|player_account_id=' || proof.player_account_id::text
      || '|payment_provider_id=' || proof.payment_provider_id::text
      || '|reference_fingerprint=' || proof.candidate_reference_fingerprint
      || '|receiver_profile_id=' || profile.id::text
      || '|receiver_profile_digest=' || profile.receiver_profile_digest
      || '|receiver_configuration_digest=' || profile.receiver_configuration_digest
      || '|receiver_identity_digest=' || profile.receiver_identity_digest
      || '|expected_receiver_name_digest=' || profile.expected_receiver_name_digest
      || '|deposit_policy_version_id=' || profile.deposit_policy_version_id::text
      || '|deposit_policy_version=' || profile.deposit_policy_version::text
      || '|minimum_principal_amount_minor='
      || profile.minimum_principal_amount_minor::text
      || '|maximum_principal_amount_minor='
      || profile.maximum_principal_amount_minor::text
      || '|policy_digest=' || profile.policy_digest
  );

  select job.*
    into existing_job
    from app.private_live_telebirr_verification_jobs job
   where job.private_live_deposit_pilot_proof_id = proof.id
      or job.enqueue_request_key = p_enqueue_request_key
   order by job.created_at, job.id
   limit 1
   for key share;

  if existing_job.id is not null then
    if existing_job.private_live_deposit_pilot_proof_id is distinct from proof.id
      or existing_job.enqueue_request_key is distinct from p_enqueue_request_key
      or existing_job.enqueue_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr verification staging replay conflicts.';
    end if;

    return query
    select existing_job.id,
           existing_job.pilot_revision_id,
           existing_job.private_live_deposit_pilot_proof_id,
           existing_job.expires_at,
           true;
    return;
  end if;

  insert into app.private_live_telebirr_verification_jobs (
    enqueue_request_key,
    enqueue_request_digest,
    private_live_deposit_pilot_proof_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    payment_provider_id,
    receiver_profile_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    receiver_profile_digest,
    receiver_configuration_digest,
    receiver_identity_digest,
    expected_receiver_name_digest,
    deposit_policy_version_id,
    deposit_policy_version,
    minimum_principal_amount_minor,
    maximum_principal_amount_minor,
    policy_digest,
    candidate_reference_fingerprint,
    reference_encryption_key_version,
    reference_profile_version,
    submitted_at,
    not_before,
    expires_at
  )
  values (
    p_enqueue_request_key,
    request_digest,
    proof.id,
    pilot.id,
    proof.submitting_customer_id,
    proof.player_account_id,
    proof.payment_provider_id,
    profile.id,
    profile.receiver_account_id,
    profile.receiver_account_version,
    pilot.configuration_digest,
    profile.receiver_profile_digest,
    profile.receiver_configuration_digest,
    profile.receiver_identity_digest,
    profile.expected_receiver_name_digest,
    profile.deposit_policy_version_id,
    profile.deposit_policy_version,
    profile.minimum_principal_amount_minor,
    profile.maximum_principal_amount_minor,
    profile.policy_digest,
    proof.candidate_reference_fingerprint,
    proof.reference_encryption_key_version,
    proof.reference_profile_version,
    proof.submitted_at,
    proof.submitted_at,
    least(
      proof.submitted_at + interval '5 minutes',
      pilot.expires_at,
      profile.valid_until
    )
  )
  returning * into inserted_job;

  return query
  select inserted_job.id,
         inserted_job.pilot_revision_id,
         inserted_job.private_live_deposit_pilot_proof_id,
         inserted_job.expires_at,
         false;
end;
$$;

create function app.lease_next_private_live_telebirr_verification(
  p_device_enrollment_id uuid,
  p_leased_by text,
  p_lease_request_key uuid,
  p_lease_seconds integer
)
returns table (
  verification_job_id uuid,
  verification_attempt_id uuid,
  attempt_number integer,
  lease_token uuid,
  request_id uuid,
  assignment_id uuid,
  lease_nonce_digest text,
  challenge_id uuid,
  challenge_digest text,
  issued_at timestamptz,
  expires_at timestamptz,
  pilot_revision_id uuid,
  pilot_configuration_digest text,
  private_live_deposit_pilot_proof_id uuid,
  submitting_customer_id uuid,
  player_account_id uuid,
  selected_player_id text,
  player_owner_customer_id uuid,
  eligibility_decision_id uuid,
  eligibility_decision_version integer,
  eligibility_contract_version text,
  payment_provider_id uuid,
  receiver_profile_id uuid,
  receiver_account_id uuid,
  receiver_account_version integer,
  receiver_profile_digest text,
  receiver_configuration_digest text,
  receiver_identity_digest text,
  expected_receiver_name_digest text,
  receiver_name_normalizer_version text,
  source_profile text,
  adapter_version text,
  parser_version text,
  facts_normalizer_version text,
  policy_version text,
  deposit_policy_version_id uuid,
  deposit_policy_version integer,
  minimum_principal_amount_minor bigint,
  maximum_principal_amount_minor bigint,
  automatic_freshness_seconds integer,
  maximum_future_skew_seconds integer,
  policy_digest text,
  candidate_reference_ciphertext text,
  candidate_reference_fingerprint text,
  candidate_reference_masked text,
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
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  policy app.deposit_policy_versions%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  player_member app.private_live_deposit_pilot_players%rowtype;
  existing_attempt app.private_live_telebirr_verification_attempts%rowtype;
  inserted_attempt app.private_live_telebirr_verification_attempts%rowtype;
  attempt_count integer;
  lease_at timestamptz;
  request_digest text;
  nonce_material uuid;
  challenge_material uuid;
  switch_count integer;
begin
  if p_device_enrollment_id is null
    or p_lease_request_key is null
    or p_lease_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_leased_by is null
    or p_leased_by <> btrim(p_leased_by)
    or p_leased_by !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_lease_seconds not between 30 and 300 then
    raise exception 'The private live TeleBirr verification lease request is invalid.';
  end if;

  -- Resolve only the immutable pilot identifier before taking locks. Every authoritative row is
  -- re-read below after the five-switch mutex and pilot lock.
  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = p_device_enrollment_id;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = enrollment.pilot_revision_id
   for update;

  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = p_device_enrollment_id
     and device_enrollment.pilot_revision_id = pilot.id
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = enrollment.receiver_profile_id
     and receiver_profile.pilot_revision_id = pilot.id
   for share;

  select policy_version.*
    into policy
    from app.deposit_policy_versions policy_version
   where policy_version.status = 'active'
   for share;

  lease_at := clock_timestamp();

  if switch_count <> 5
    or enrollment.id is null
    or profile.id is null
    or pilot.id is null
    or pilot.status <> 'armed'
    or lease_at < pilot.active_from
    or lease_at >= pilot.expires_at
    or pilot.configuration_digest is distinct from profile.pilot_configuration_digest
    or policy.id is null
    or policy.freshness_window_seconds <> 3600
    or profile.deposit_policy_version_id is distinct from policy.id
    or profile.deposit_policy_version is distinct from policy.version
    or profile.minimum_principal_amount_minor is distinct from greatest(
      pilot.minimum_amount_minor,
      policy.minimum_amount_minor
    )
    or profile.maximum_principal_amount_minor is distinct from least(
      pilot.maximum_per_deposit_minor,
      policy.maximum_amount_minor
    )
    or profile.policy_digest is distinct from app.private_live_telebirr_policy_digest(
      profile.minimum_principal_amount_minor,
      profile.maximum_principal_amount_minor
    )
    or lease_at < enrollment.valid_from
    or lease_at >= enrollment.valid_until
    or lease_at < profile.valid_from
    or lease_at >= profile.valid_until
    or exists (
      select 1
        from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= lease_at
    )
    or not app.is_private_live_deposit_pilot_enforced()
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    ) then
    raise exception 'The private live TeleBirr verification lease authority is unavailable.';
  end if;

  -- Re-read after the switch mutex. This turns concurrent uses of one request key into one exact
  -- replay instead of a unique-index race, and makes replay obey current expiry/revocation state.
  select attempt.*
    into existing_attempt
    from app.private_live_telebirr_verification_attempts attempt
   where attempt.lease_request_key = p_lease_request_key
   for share;

  if existing_attempt.id is not null then
    select verification_job.*
      into job
      from app.private_live_telebirr_verification_jobs verification_job
     where verification_job.id = existing_attempt.verification_job_id
     for share;
    select proof_row.*
      into proof
      from app.private_live_deposit_pilot_proofs proof_row
     where proof_row.id = job.private_live_deposit_pilot_proof_id
     for share;
    select member.*
      into player_member
      from app.private_live_deposit_pilot_players member
     where member.pilot_revision_id = job.pilot_revision_id
       and member.player_account_id = job.player_account_id
     for share;

    request_digest := app.private_live_deposit_pilot_sha256(
      'fetanagent:telebirr:private-live-pilot:lease-request:v1'
        || '|request_key=' || p_lease_request_key::text
        || '|job_id=' || job.id::text
        || '|attempt_number=' || existing_attempt.attempt_number::text
        || '|device_enrollment_id=' || enrollment.id::text
        || '|device_id=' || enrollment.device_id
        || '|key_id=' || enrollment.key_id
        || '|leased_by=' || p_leased_by
        || '|lease_seconds=' || p_lease_seconds::text
    );

    if existing_attempt.device_enrollment_id is distinct from p_device_enrollment_id
      or existing_attempt.leased_by is distinct from p_leased_by
      or existing_attempt.requested_lease_seconds is distinct from p_lease_seconds
      or existing_attempt.lease_request_digest is distinct from request_digest then
      raise exception 'The private live TeleBirr verification lease replay conflicts.';
    end if;

    if job.id is null
      or proof.id is null
      or player_member.player_account_id is null
      or job.pilot_revision_id is distinct from pilot.id
      or job.receiver_profile_id is distinct from profile.id
      or job.pilot_configuration_digest is distinct from pilot.configuration_digest
      or existing_attempt.expires_at <= lease_at
      or job.expires_at <= lease_at then
      raise exception 'The private live TeleBirr verification lease authority is unavailable.';
    end if;

    return query
    select job.id,
           existing_attempt.id,
           existing_attempt.attempt_number,
           existing_attempt.lease_token,
           existing_attempt.request_id,
           existing_attempt.assignment_id,
           existing_attempt.lease_nonce_digest,
           existing_attempt.challenge_id,
           existing_attempt.challenge_digest,
           existing_attempt.issued_at,
           existing_attempt.expires_at,
           job.pilot_revision_id,
           job.pilot_configuration_digest,
           job.private_live_deposit_pilot_proof_id,
           job.submitting_customer_id,
           job.player_account_id,
           player_member.player_id_snapshot,
           player_member.player_owner_customer_id_snapshot,
           player_member.eligibility_decision_id_snapshot,
           player_member.eligibility_decision_version_snapshot,
           app.private_live_telebirr_eligibility_version(
             player_member.eligibility_decision_version_snapshot
           ),
           job.payment_provider_id,
           job.receiver_profile_id,
           job.receiver_account_id,
           job.receiver_account_version,
           job.receiver_profile_digest,
           job.receiver_configuration_digest,
           job.receiver_identity_digest,
           job.expected_receiver_name_digest,
           profile.receiver_name_normalizer_version,
           profile.source_profile,
           profile.adapter_version,
           profile.parser_version,
           profile.facts_normalizer_version,
           profile.policy_version,
           job.deposit_policy_version_id,
           job.deposit_policy_version,
           job.minimum_principal_amount_minor,
           job.maximum_principal_amount_minor,
           profile.automatic_freshness_seconds,
           profile.maximum_future_skew_seconds,
           job.policy_digest,
           proof.candidate_reference_ciphertext,
           job.candidate_reference_fingerprint,
           proof.candidate_reference_masked,
           job.reference_encryption_key_version,
           job.reference_profile_version,
           true;
    return;
  end if;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.pilot_revision_id = pilot.id
     and verification_job.receiver_profile_id = profile.id
     and verification_job.pilot_configuration_digest = pilot.configuration_digest
     and verification_job.not_before <= lease_at
     and verification_job.expires_at > lease_at + interval '30 seconds'
     and not exists (
       select 1
         from app.private_live_telebirr_verification_outcomes outcome
        where outcome.verification_job_id = verification_job.id
     )
     and not exists (
       select 1
         from app.private_live_telebirr_verification_attempts active_attempt
        where active_attempt.verification_job_id = verification_job.id
          and active_attempt.expires_at > lease_at
     )
   order by verification_job.submitted_at, verification_job.created_at, verification_job.id
   limit 1
   for update skip locked;

  if job.id is null then
    return;
  end if;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = job.private_live_deposit_pilot_proof_id
   for key share;

  select member.*
    into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = job.pilot_revision_id
     and member.player_account_id = job.player_account_id
   for share;

  select pg_catalog.count(*)::integer
    into attempt_count
    from app.private_live_telebirr_verification_attempts prior_attempt
   where prior_attempt.verification_job_id = job.id;

  if proof.id is null or player_member.player_account_id is null or attempt_count >= 100 then
    raise exception 'The private live TeleBirr verification job lineage is invalid.';
  end if;

  inserted_attempt.id := gen_random_uuid();
  inserted_attempt.lease_token := gen_random_uuid();
  inserted_attempt.request_id := gen_random_uuid();
  inserted_attempt.assignment_id := gen_random_uuid();
  nonce_material := gen_random_uuid();
  challenge_material := gen_random_uuid();
  inserted_attempt.lease_nonce_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:lease-nonce:v1|'
      || nonce_material::text
  );
  inserted_attempt.challenge_id := gen_random_uuid();
  inserted_attempt.challenge_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:challenge:v1|'
      || challenge_material::text
  );
  inserted_attempt.issued_at := lease_at;
  inserted_attempt.expires_at := least(
    lease_at + pg_catalog.make_interval(secs => p_lease_seconds),
    job.expires_at,
    enrollment.valid_until
  );

  if inserted_attempt.expires_at <= lease_at + interval '30 seconds' then
    return;
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:lease-request:v1'
      || '|request_key=' || p_lease_request_key::text
      || '|job_id=' || job.id::text
      || '|attempt_number=' || (attempt_count + 1)::text
      || '|device_enrollment_id=' || enrollment.id::text
      || '|device_id=' || enrollment.device_id
      || '|key_id=' || enrollment.key_id
      || '|leased_by=' || p_leased_by
      || '|lease_seconds=' || p_lease_seconds::text
  );

  insert into app.private_live_telebirr_verification_attempts (
    id,
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
  )
  values (
    inserted_attempt.id,
    job.id,
    attempt_count + 1,
    p_lease_request_key,
    request_digest,
    inserted_attempt.lease_token,
    inserted_attempt.request_id,
    inserted_attempt.assignment_id,
    p_lease_seconds,
    p_leased_by,
    enrollment.id,
    enrollment.device_id,
    enrollment.key_id,
    enrollment.public_key_spki_sha256,
    inserted_attempt.lease_nonce_digest,
    inserted_attempt.challenge_id,
    inserted_attempt.challenge_digest,
    inserted_attempt.issued_at,
    inserted_attempt.expires_at
  )
  returning * into inserted_attempt;

  return query
  select job.id,
         inserted_attempt.id,
         inserted_attempt.attempt_number,
         inserted_attempt.lease_token,
         inserted_attempt.request_id,
         inserted_attempt.assignment_id,
         inserted_attempt.lease_nonce_digest,
         inserted_attempt.challenge_id,
         inserted_attempt.challenge_digest,
         inserted_attempt.issued_at,
         inserted_attempt.expires_at,
         job.pilot_revision_id,
         job.pilot_configuration_digest,
         job.private_live_deposit_pilot_proof_id,
         job.submitting_customer_id,
         job.player_account_id,
         player_member.player_id_snapshot,
         player_member.player_owner_customer_id_snapshot,
         player_member.eligibility_decision_id_snapshot,
         player_member.eligibility_decision_version_snapshot,
         app.private_live_telebirr_eligibility_version(
           player_member.eligibility_decision_version_snapshot
         ),
         job.payment_provider_id,
         job.receiver_profile_id,
         job.receiver_account_id,
         job.receiver_account_version,
         job.receiver_profile_digest,
         job.receiver_configuration_digest,
         job.receiver_identity_digest,
         job.expected_receiver_name_digest,
         profile.receiver_name_normalizer_version,
         profile.source_profile,
         profile.adapter_version,
         profile.parser_version,
         profile.facts_normalizer_version,
         profile.policy_version,
         job.deposit_policy_version_id,
         job.deposit_policy_version,
         job.minimum_principal_amount_minor,
         job.maximum_principal_amount_minor,
         profile.automatic_freshness_seconds,
         profile.maximum_future_skew_seconds,
         job.policy_digest,
         proof.candidate_reference_ciphertext,
         job.candidate_reference_fingerprint,
         proof.candidate_reference_masked,
         job.reference_encryption_key_version,
         job.reference_profile_version,
         false;
end;
$$;

-- Receipt-derived intents have no customer-provided amount and may be created after the receipt
-- occurred. This replacement preserves the historical path byte-for-byte in the ELSE branch,
-- while the pilot branch derives amount/time/receiver facts only from one immutable settlement
-- candidate. Its 65-minute legacy window is the exact one-hour receipt age plus five-minute skew.
create or replace function app.populate_deposit_intent_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  platform_row app.platforms%rowtype;
  agent_row app.platform_agent_accounts%rowtype;
  submitting_customer_member app.private_live_deposit_pilot_customers%rowtype;
  submitting_customer_row app.customers%rowtype;
  owner_customer_row app.customers%rowtype;
  player_row app.customer_platform_players%rowtype;
  eligibility_row app.player_deposit_eligibility_decisions%rowtype;
  payment_provider_row app.payment_providers%rowtype;
  receiver_row app.receiver_accounts%rowtype;
  policy_row app.deposit_policy_versions%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  player_member app.private_live_deposit_pilot_players%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  outcome app.private_live_telebirr_verification_outcomes%rowtype;
  intent_opened_at timestamptz;
begin
  if new.private_live_telebirr_outcome_id is not null then
    select verification_outcome.*
      into outcome
      from app.private_live_telebirr_verification_outcomes verification_outcome
     where verification_outcome.id = new.private_live_telebirr_outcome_id
       and verification_outcome.disposition = 'settlement_candidate'
       and verification_outcome.reason_code = 'exact_proof_match'
       and verification_outcome.deposit_intent_id = new.id
     for key share;

    select pilot_revision.*
      into pilot
      from app.private_live_deposit_pilot_revisions pilot_revision
     where pilot_revision.id = outcome.pilot_revision_id
     for share;

    select member.*
      into submitting_customer_member
      from app.private_live_deposit_pilot_customers member
     where member.pilot_revision_id = outcome.pilot_revision_id
       and member.customer_id = outcome.submitting_customer_id
     for share;

    select member.*
      into player_member
      from app.private_live_deposit_pilot_players member
     where member.pilot_revision_id = outcome.pilot_revision_id
       and member.player_account_id = outcome.player_account_id
     for share;

    select member.*
      into provider_member
      from app.private_live_deposit_pilot_providers member
     where member.pilot_revision_id = outcome.pilot_revision_id
       and member.payment_provider_id = outcome.payment_provider_id
       and member.receiver_account_id = outcome.receiver_account_id
       and member.receiver_account_version = outcome.receiver_account_version
       and member.provider_code_snapshot = 'telebirr'
     for share;

    select receiver_profile.*
      into profile
      from app.private_live_telebirr_receiver_profiles receiver_profile
     where receiver_profile.id = outcome.receiver_profile_id
       and receiver_profile.pilot_revision_id = outcome.pilot_revision_id
       and receiver_profile.payment_provider_id = outcome.payment_provider_id
       and receiver_profile.receiver_account_id = outcome.receiver_account_id
       and receiver_profile.receiver_account_version = outcome.receiver_account_version
     for share;

    -- Lock mutable policy rows in the same deterministic suffix used by private-pilot
    -- settlement: platform, agent, both customers sorted by UUID, Player, eligibility,
    -- provider, receiver, then the active legacy policy used to build the intent snapshot.
    select platform.*
      into platform_row
      from app.platforms platform
     where platform.id = outcome.platform_id
     for share;

    select agent.*
      into agent_row
      from app.platform_agent_accounts agent
     where agent.id = pilot.platform_agent_account_id
     for share;

    perform customer.id
      from app.customers customer
     where customer.id in (
       outcome.submitting_customer_id,
       outcome.player_owner_customer_id_snapshot
     )
     order by customer.id
     for share;

    select customer.*
      into submitting_customer_row
      from app.customers customer
     where customer.id = outcome.submitting_customer_id;

    select customer.*
      into owner_customer_row
      from app.customers customer
     where customer.id = outcome.player_owner_customer_id_snapshot;

    select player_account.*
      into player_row
      from app.customer_platform_players player_account
     where player_account.id = outcome.player_account_id
     for share;

    select decision.*
      into eligibility_row
      from app.player_deposit_eligibility_decisions decision
     where decision.id = player_member.eligibility_decision_id_snapshot
     for share;

    select payment_provider.*
      into payment_provider_row
      from app.payment_providers payment_provider
     where payment_provider.id = outcome.payment_provider_id
     for share;

    select receiver_account.*
      into receiver_row
      from app.receiver_accounts receiver_account
     where receiver_account.id = outcome.receiver_account_id
       and receiver_account.provider_id = outcome.payment_provider_id
       and receiver_account.version = outcome.receiver_account_version
       and receiver_account.active_from <= outcome.occurred_at
       and (
         receiver_account.retired_at is null
         or outcome.occurred_at < receiver_account.retired_at
       )
     for share;

    select deposit_policy.*
      into policy_row
      from app.deposit_policy_versions deposit_policy
     where deposit_policy.status = 'active'
     for share;

    if outcome.id is null
      or pilot.id is null
      or pilot.status <> 'armed'
      or pilot.configuration_digest is distinct from outcome.pilot_configuration_digest
      or submitting_customer_member.customer_id is null
      or player_member.player_account_id is null
      or provider_member.payment_provider_id is null
      or profile.id is null
      or platform_row.id is null
      or platform_row.status <> 'active'
      or platform_row.id is distinct from pilot.platform_id
      or agent_row.id is null
      or agent_row.platform_id is distinct from pilot.platform_id
      or agent_row.status <> 'active'
      or agent_row.label is distinct from pilot.platform_agent_label_snapshot
      or agent_row.updated_at is distinct from pilot.platform_agent_updated_at_snapshot
      or submitting_customer_row.id is null
      or submitting_customer_row.status <> 'active'
      or submitting_customer_row.status
           is distinct from submitting_customer_member.customer_status_snapshot
      or submitting_customer_row.updated_at
           is distinct from submitting_customer_member.customer_updated_at_snapshot
      or owner_customer_row.id is null
      or owner_customer_row.status <> 'active'
      or owner_customer_row.status
           is distinct from player_member.player_owner_customer_status_snapshot
      or owner_customer_row.updated_at
           is distinct from player_member.player_owner_customer_updated_at_snapshot
      or player_row.id is null
      or player_row.customer_id is distinct from outcome.player_owner_customer_id_snapshot
      or player_row.platform_id is distinct from outcome.platform_id
      or player_row.status <> 'active'
      or player_row.validation_status <> 'valid'
      or player_row.player_id is distinct from player_member.player_id_snapshot
      or player_row.updated_at is distinct from player_member.player_updated_at_snapshot
      or eligibility_row.id is null
      or eligibility_row.player_account_id is distinct from player_row.id
      or eligibility_row.decision_version
           is distinct from player_member.eligibility_decision_version_snapshot
      or eligibility_row.decision <> 'eligible'
      or eligibility_row.decided_at
           is distinct from player_member.eligibility_decided_at_snapshot
      or eligibility_row.player_account_updated_at_snapshot
           is distinct from player_row.updated_at
      or eligibility_row.id is distinct from (
        select latest.id
          from app.player_deposit_eligibility_decisions latest
         where latest.player_account_id = player_row.id
         order by latest.decision_version desc
         limit 1
      )
      or payment_provider_row.id is null
      or payment_provider_row.code <> 'telebirr'
      or payment_provider_row.status <> 'active'
      or payment_provider_row.updated_at
           is distinct from provider_member.provider_updated_at_snapshot
      or receiver_row.id is null
      or receiver_row.status <> 'active'
      or receiver_row.active_from
           is distinct from provider_member.receiver_active_from_snapshot
      or receiver_row.updated_at
           is distinct from provider_member.receiver_updated_at_snapshot
      or receiver_row.account_holder_name
           is distinct from provider_member.receiver_account_holder_name_snapshot
      or receiver_row.account_reference_masked
           is distinct from provider_member.receiver_account_masked_snapshot
      or profile.receiver_identity_digest is distinct from outcome.receiver_identity_digest
      or profile.pilot_configuration_digest is distinct from outcome.pilot_configuration_digest
      or profile.receiver_account_id is distinct from receiver_row.id
      or profile.receiver_account_version is distinct from receiver_row.version
      or policy_row.id is null
      or policy_row.freshness_window_seconds <> 3600
      or profile.deposit_policy_version_id is distinct from policy_row.id
      or profile.deposit_policy_version is distinct from policy_row.version
      or profile.minimum_principal_amount_minor is distinct from greatest(
        policy_row.minimum_amount_minor,
        pilot.minimum_amount_minor
      )
      or profile.maximum_principal_amount_minor is distinct from least(
        policy_row.maximum_amount_minor,
        pilot.maximum_per_deposit_minor
      )
      or profile.policy_digest is distinct from app.private_live_telebirr_policy_digest(
        profile.minimum_principal_amount_minor,
        profile.maximum_principal_amount_minor
      )
      or outcome.principal_amount_minor < greatest(
        policy_row.minimum_amount_minor,
        pilot.minimum_amount_minor
      )
      or outcome.principal_amount_minor > least(
        policy_row.maximum_amount_minor,
        pilot.maximum_per_deposit_minor
      )
      or new.customer_id is distinct from outcome.player_owner_customer_id_snapshot
      or new.platform_id is distinct from outcome.platform_id
      or new.player_account_id is distinct from outcome.player_account_id
      or new.payment_provider_id is distinct from outcome.payment_provider_id
      or new.receiver_account_id is distinct from outcome.receiver_account_id
      or new.expected_amount_minor is distinct from outcome.principal_amount_minor
      or new.origin_inbound_event_id is not null then
      raise exception 'The receipt-derived private live TeleBirr intent binding is invalid.';
    end if;

    intent_opened_at := outcome.occurred_at;
    new.receiver_account_version := receiver_row.version;
    new.receiver_account_holder_name_snapshot := receiver_row.account_holder_name;
    new.receiver_account_masked_snapshot := receiver_row.account_reference_masked;
    new.receiver_instructions_snapshot := receiver_row.instructions;
    new.deposit_policy_version_id := policy_row.id;
    new.deposit_policy_version := policy_row.version;
    new.minimum_amount_minor := greatest(
      policy_row.minimum_amount_minor,
      pilot.minimum_amount_minor
    );
    new.maximum_amount_minor := least(
      policy_row.maximum_amount_minor,
      pilot.maximum_per_deposit_minor
    );
    new.freshness_window_seconds := 3900;
    new.currency_code := 'ETB';
    new.opened_at := intent_opened_at;
    new.payment_deadline_at := intent_opened_at + interval '65 minutes';
    new.status := 'intake_received';
    new.status_changed_at := clock_timestamp();
    new.verified_at := null;
    new.rejection_reason_code := null;
    return new;
  end if;

  -- Historical non-pilot behavior.
  select player_account.*
    into player_row
    from app.customer_platform_players player_account
    join app.platforms platform on platform.id = player_account.platform_id
   where player_account.id = new.player_account_id
     and platform.status = 'active'
   for update of player_account, platform;

  if not found
    or player_row.status <> 'active'
    or player_row.validation_status <> 'valid' then
    raise exception 'A deposit intent requires an active, validated player account.';
  end if;

  if new.customer_id is distinct from player_row.customer_id
    or new.platform_id is distinct from player_row.platform_id then
    raise exception 'Deposit intent customer and platform must match its player account.';
  end if;

  perform 1
    from app.payment_providers payment_provider
   where payment_provider.id = new.payment_provider_id
     and payment_provider.status = 'active'
   for update;
  if not found then
    raise exception 'A deposit intent requires an active payment provider.';
  end if;

  select receiver_account.*
    into receiver_row
    from app.receiver_accounts receiver_account
   where receiver_account.id = new.receiver_account_id
     and receiver_account.provider_id = new.payment_provider_id
     and receiver_account.status = 'active'
   for update;
  if not found then
    raise exception 'A deposit intent requires an active receiver account for its payment provider.';
  end if;

  select deposit_policy.*
    into policy_row
    from app.deposit_policy_versions deposit_policy
   where deposit_policy.status = 'active'
   for update;
  if not found then
    raise exception 'An active deposit policy is required.';
  end if;

  if new.origin_inbound_event_id is not null and not exists (
    select 1
      from app.inbound_events inbound_event
      join app.customer_identities customer_identity
        on customer_identity.id = inbound_event.customer_identity_id
     where inbound_event.id = new.origin_inbound_event_id
       and customer_identity.customer_id = new.customer_id
  ) then
    raise exception 'The inbound event does not belong to the deposit customer.';
  end if;

  intent_opened_at := clock_timestamp();
  new.receiver_account_version := receiver_row.version;
  new.receiver_account_holder_name_snapshot := receiver_row.account_holder_name;
  new.receiver_account_masked_snapshot := receiver_row.account_reference_masked;
  new.receiver_instructions_snapshot := receiver_row.instructions;
  new.deposit_policy_version_id := policy_row.id;
  new.deposit_policy_version := policy_row.version;
  new.minimum_amount_minor := policy_row.minimum_amount_minor;
  new.maximum_amount_minor := policy_row.maximum_amount_minor;
  new.freshness_window_seconds := policy_row.freshness_window_seconds;
  new.currency_code := 'ETB';
  new.opened_at := intent_opened_at;
  new.payment_deadline_at := intent_opened_at
    + pg_catalog.make_interval(secs => policy_row.freshness_window_seconds);
  new.status := 'intake_received';
  new.status_changed_at := intent_opened_at;
  new.verified_at := null;
  new.rejection_reason_code := null;

  if new.expected_amount_minor < new.minimum_amount_minor
    or new.expected_amount_minor > new.maximum_amount_minor then
    raise exception 'The requested amount is outside the active deposit policy.';
  end if;

  return new;
end;
$$;

create function app.record_private_live_telebirr_assignment_transcript(
  p_verification_attempt_id uuid,
  p_lease_token uuid,
  p_assignment_signer_id uuid,
  p_assignment_body_digest text,
  p_assignment_signature_digest text,
  p_reference_binding_digest text
)
returns table (
  assignment_transcript_id uuid,
  verification_attempt_id uuid,
  signed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  initial_attempt app.private_live_telebirr_verification_attempts%rowtype;
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  existing_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  inserted_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  captured_at timestamptz;
  switch_count integer;
begin
  if p_verification_attempt_id is null
    or p_lease_token is null
    or p_assignment_signer_id is null
    or p_assignment_body_digest is null
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_assignment_signature_digest is null
    or p_assignment_signature_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_reference_binding_digest is null
    or p_reference_binding_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'The private live TeleBirr assignment transcript request is invalid.';
  end if;

  select verification_attempt.*
    into initial_attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = p_verification_attempt_id;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = initial_attempt.verification_job_id;

  if initial_attempt.id is null or job.id is null then
    raise exception 'The private live TeleBirr assignment transcript authority is unavailable.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = job.pilot_revision_id
   for update;

  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = p_verification_attempt_id
     and verification_attempt.lease_token = p_lease_token
   for share;

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = attempt.verification_job_id
     and verification_job.pilot_revision_id = pilot.id
   for share;

  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = attempt.device_enrollment_id
     and device_enrollment.pilot_revision_id = pilot.id
     and device_enrollment.receiver_profile_id = job.receiver_profile_id
   for share;

  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.id = p_assignment_signer_id
   for share;

  captured_at := clock_timestamp();

  if switch_count <> 5
    or attempt.id is null
    or job.id is null
    or pilot.id is null
    or enrollment.id is null
    or signer.id is null
    or pilot.status <> 'armed'
    or pilot.configuration_digest is distinct from job.pilot_configuration_digest
    or captured_at < pilot.active_from
    or captured_at >= pilot.expires_at
    or captured_at >= job.expires_at
    or captured_at < attempt.issued_at
    or captured_at >= attempt.expires_at
    or attempt.issued_at < enrollment.valid_from
    or attempt.expires_at > enrollment.valid_until
    or attempt.issued_at < signer.valid_from
    or attempt.expires_at > signer.valid_until
    or exists (
      select 1
        from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= captured_at
    )
    or exists (
      select 1
        from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= captured_at
    )
    or not app.is_private_live_deposit_pilot_enforced()
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    ) then
    raise exception 'The private live TeleBirr assignment transcript authority is unavailable.';
  end if;

  select transcript.*
    into existing_transcript
    from app.private_live_telebirr_assignment_transcripts transcript
   where transcript.verification_attempt_id = p_verification_attempt_id
   for share;

  if existing_transcript.id is not null then
    if existing_transcript.assignment_signer_id is distinct from p_assignment_signer_id
      or existing_transcript.assignment_body_digest is distinct from p_assignment_body_digest
      or existing_transcript.assignment_signature_digest
           is distinct from p_assignment_signature_digest
      or existing_transcript.reference_binding_digest
           is distinct from p_reference_binding_digest then
      raise exception 'The private live TeleBirr assignment transcript replay conflicts.';
    end if;

    return query
    select existing_transcript.id,
           existing_transcript.verification_attempt_id,
           existing_transcript.signed_at,
           true;
    return;
  end if;

  insert into app.private_live_telebirr_assignment_transcripts (
    verification_attempt_id,
    assignment_signer_id,
    assignment_body_digest,
    signer_key_id_snapshot,
    signer_public_key_spki_sha256_snapshot,
    assignment_signature_digest,
    reference_binding_digest,
    signed_at
  )
  values (
    attempt.id,
    signer.id,
    p_assignment_body_digest,
    signer.signer_key_id,
    signer.public_key_spki_sha256,
    p_assignment_signature_digest,
    p_reference_binding_digest,
    captured_at
  )
  returning * into inserted_transcript;

  return query
  select inserted_transcript.id,
         inserted_transcript.verification_attempt_id,
         inserted_transcript.signed_at,
         false;
end;
$$;

create function app.complete_private_live_telebirr_verification(
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
  initial_attempt app.private_live_telebirr_verification_attempts%rowtype;
  initial_job app.private_live_telebirr_verification_jobs%rowtype;
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  proof app.private_live_deposit_pilot_proofs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  submitting_customer_member app.private_live_deposit_pilot_customers%rowtype;
  player_member app.private_live_deposit_pilot_players%rowtype;
  provider_member app.private_live_deposit_pilot_providers%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  assignment_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  assignment_signer app.private_live_telebirr_assignment_signers%rowtype;
  platform_row app.platforms%rowtype;
  agent_row app.platform_agent_accounts%rowtype;
  submitting_customer_row app.customers%rowtype;
  owner_customer_row app.customers%rowtype;
  player_row app.customer_platform_players%rowtype;
  eligibility_row app.player_deposit_eligibility_decisions%rowtype;
  payment_provider_row app.payment_providers%rowtype;
  receiver_row app.receiver_accounts%rowtype;
  policy_row app.deposit_policy_versions%rowtype;
  existing_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  inserted_observation app.private_live_telebirr_observation_transcripts%rowtype;
  inserted_outcome app.private_live_telebirr_verification_outcomes%rowtype;
  existing_receipt app.private_live_telebirr_settlement_receipts%rowtype;
  inserted_receipt app.private_live_telebirr_settlement_receipts%rowtype;
  completion_digest text;
  captured_at timestamptz;
  new_intent_id uuid;
  new_submission_id uuid;
  new_evidence_id uuid;
  new_verification_attempt_id uuid;
  settled_intent_id uuid;
  settled_claim_id uuid;
  settled_execution_job_id uuid;
  settled_deposit_status text;
  settled_execution_job_status text;
  settlement_already_finalized boolean;
  settlement_updated_at timestamptz;
  switch_count integer;
begin
  if p_verification_attempt_id is null
    or p_lease_token is null
    or p_completion_request_key is null
    or p_completion_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_observation_body_digest is null
    or p_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observation_signature_digest is null
    or p_observation_signature_digest !~ '^sha256:[0-9a-f]{64}$'
    or (
      p_replay_identity is not null
      and p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    )
    or p_source_document_digest is null
    or p_source_document_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_normalized_facts_digest is null
    or p_normalized_facts_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_assessment_input_digest is null
    or p_assessment_input_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_evidence_digest is null
    or p_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observed_at is null
    or p_assessed_at is null
    or p_retrieved_at is null
    or p_protocol_disposition is null
    or p_protocol_disposition not in ('would_review', 'would_forward_signed_evidence')
    or p_protocol_reason_code is null
    or p_protocol_reason_code not in (
      'assignment_signer_revoked',
      'assignment_signer_expired',
      'assignment_signer_key_invalid',
      'assignment_signer_key_mismatch',
      'assignment_signature_invalid',
      'device_revoked',
      'device_enrollment_expired',
      'device_key_invalid',
      'device_key_mismatch',
      'device_signature_invalid',
      'assignment_expired',
      'observation_time_invalid',
      'binding_mismatch',
      'reference_binding_mismatch',
      'receiver_binding_mismatch',
      'source_profile_mismatch',
      'version_mismatch',
      'facts_digest_mismatch',
      'assignment_body_digest_mismatch',
      'observation_body_digest_mismatch',
      'replay_detected',
      'receipt_requires_review',
      'reference_mismatch',
      'receiver_mismatch',
      'provider_status_not_completed',
      'receipt_semantics_incomplete',
      'signed_evidence_verified'
    )
    or (
      p_protocol_disposition = 'would_forward_signed_evidence'
      and (
        p_protocol_reason_code <> 'signed_evidence_verified'
        or p_replay_identity is null
      )
    )
    or (
      p_protocol_disposition = 'would_review'
      and p_protocol_reason_code = 'signed_evidence_verified'
    )
    or p_disposition is null
    or p_disposition not in ('settlement_candidate', 'definite_reject', 'review_required')
    or p_reason_code is null
    or (
      p_disposition = 'settlement_candidate'
      and (
        p_reason_code <> 'exact_proof_match'
        or p_protocol_disposition <> 'would_forward_signed_evidence'
        or p_receipt_principal_amount_minor is null
        or p_receipt_principal_amount_minor <= 0
        or p_occurred_at is null
        or p_receiver_identity_digest is null
        or p_receiver_identity_digest !~ '^sha256:[0-9a-f]{64}$'
      )
    )
    or (
      p_disposition = 'definite_reject'
      and p_reason_code not in (
        'player_ineligible',
        'duplicate_reference_reused',
        'provider_mismatch',
        'reference_mismatch',
        'receipt_failed',
        'currency_not_etb',
        'receiver_mismatch'
      )
    )
    or (
      p_disposition = 'review_required'
      and p_reason_code not in (
        'invalid_assessment_input',
        'database_facts_unbound',
        'policy_unavailable',
        'policy_contract_mismatch',
        'eligibility_unavailable',
        'eligibility_ambiguous',
        'duplicate_check_unavailable',
        'duplicate_check_ambiguous',
        'source_unavailable',
        'source_ambiguous',
        'source_uncertain',
        'source_unsupported',
        'observation_version_unsupported',
        'parser_uncertain',
        'receipt_pending',
        'receipt_status_unknown',
        'transaction_type_unsupported',
        'receiver_history_gap',
        'receiver_history_overlap',
        'receiver_history_unavailable',
        'receiver_match_basis_unsupported',
        'amount_out_of_range',
        'receipt_too_old',
        'receipt_after_submission',
        'future_skew_exceeded'
      )
    )
    or (
      p_disposition <> 'settlement_candidate'
      and (
        p_reason_code = 'exact_proof_match'
        or p_receipt_principal_amount_minor is not null
        or p_occurred_at is not null
        or p_receiver_identity_digest is not null
      )
    ) then
    raise exception 'The private live TeleBirr verification completion request is invalid.';
  end if;

  completion_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:private-live-pilot:completion-request:v1'
      || '|request_key=' || p_completion_request_key::text
      || '|verification_attempt_id=' || p_verification_attempt_id::text
      || '|lease_token=' || p_lease_token::text
      || '|observation_body_digest=' || p_observation_body_digest
      || '|observation_signature_digest=' || p_observation_signature_digest
      || '|replay_identity=' || coalesce(p_replay_identity, '<null>')
      || '|source_document_digest=' || p_source_document_digest
      || '|normalized_facts_digest=' || p_normalized_facts_digest
      || '|observed_at_us=' || (
        extract(epoch from p_observed_at) * 1000000
      )::bigint::text
      || '|protocol_disposition=' || p_protocol_disposition
      || '|protocol_reason_code=' || p_protocol_reason_code
      || '|assessment_input_digest=' || p_assessment_input_digest
      || '|assessed_at_us=' || (
        extract(epoch from p_assessed_at) * 1000000
      )::bigint::text
      || '|disposition=' || p_disposition
      || '|reason_code=' || p_reason_code
      || '|evidence_digest=' || p_evidence_digest
      || '|retrieved_at_us=' || (
        extract(epoch from p_retrieved_at) * 1000000
      )::bigint::text
      || '|amount_minor=' || coalesce(
        p_receipt_principal_amount_minor::text,
        '<null>'
      )
      || '|occurred_at_us=' || case
        when p_occurred_at is null then '<null>'
        else (
          extract(epoch from p_occurred_at) * 1000000
        )::bigint::text
      end
      || '|receiver_identity_digest=' || coalesce(
        p_receiver_identity_digest,
        '<null>'
      )
  );

  -- Resolve immutable identifiers without locks, then acquire every mutable authority row in the
  -- same order as private settlement: switches, pilot, provider/reference advisory key, job.
  select verification_attempt.*
    into initial_attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = p_verification_attempt_id
     and verification_attempt.lease_token = p_lease_token;

  select verification_job.*
    into initial_job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = initial_attempt.verification_job_id;

  if initial_attempt.id is null or initial_job.id is null then
    raise exception 'The private live TeleBirr verification completion lineage is unavailable.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = initial_job.pilot_revision_id
   for update;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      initial_job.payment_provider_id::text || ':'
        || initial_job.candidate_reference_fingerprint,
      20260821151428
    )
  );

  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = initial_job.id
   for update;

  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = initial_attempt.id
     and verification_attempt.verification_job_id = job.id
     and verification_attempt.lease_token = p_lease_token
   for share;

  select proof_row.*
    into proof
    from app.private_live_deposit_pilot_proofs proof_row
   where proof_row.id = job.private_live_deposit_pilot_proof_id
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id
   for share;

  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = attempt.device_enrollment_id
   for share;

  select transcript.*
    into assignment_transcript
    from app.private_live_telebirr_assignment_transcripts transcript
   where transcript.verification_attempt_id = attempt.id
   for share;

  select signer.*
    into assignment_signer
    from app.private_live_telebirr_assignment_signers signer
   where signer.id = assignment_transcript.assignment_signer_id
   for share;

  select member.*
    into player_member
    from app.private_live_deposit_pilot_players member
   where member.pilot_revision_id = pilot.id
     and member.player_account_id = job.player_account_id
   for share;

  select member.*
    into submitting_customer_member
    from app.private_live_deposit_pilot_customers member
   where member.pilot_revision_id = pilot.id
     and member.customer_id = job.submitting_customer_id
   for share;

  select member.*
    into provider_member
    from app.private_live_deposit_pilot_providers member
   where member.pilot_revision_id = pilot.id
     and member.payment_provider_id = job.payment_provider_id
     and member.receiver_account_id = job.receiver_account_id
     and member.receiver_account_version = job.receiver_account_version
     and member.provider_code_snapshot = 'telebirr'
   for share;

  captured_at := clock_timestamp();

  if switch_count <> 5
    or pilot.id is null
    or job.id is null
    or attempt.id is null
    or proof.id is null
    or profile.id is null
    or enrollment.id is null
    or assignment_transcript.id is null
    or assignment_signer.id is null
    or submitting_customer_member.customer_id is null
    or player_member.player_account_id is null
    or provider_member.payment_provider_id is null
    or pilot.status <> 'armed'
    or captured_at < pilot.active_from
    or captured_at >= pilot.expires_at
    or captured_at >= job.expires_at
    or not app.is_private_live_deposit_pilot_enforced()
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    )
    or job.pilot_revision_id is distinct from pilot.id
    or job.pilot_configuration_digest is distinct from pilot.configuration_digest
    or job.submitting_customer_id is distinct from proof.submitting_customer_id
    or job.player_account_id is distinct from proof.player_account_id
    or job.payment_provider_id is distinct from proof.payment_provider_id
    or job.candidate_reference_fingerprint
         is distinct from proof.candidate_reference_fingerprint
    or job.reference_encryption_key_version
         is distinct from proof.reference_encryption_key_version
    or job.reference_profile_version is distinct from proof.reference_profile_version
    or enrollment.pilot_revision_id is distinct from pilot.id
    or enrollment.receiver_profile_id is distinct from profile.id
    or enrollment.device_id is distinct from attempt.device_id_snapshot
    or enrollment.key_id is distinct from attempt.device_key_id_snapshot
    or enrollment.public_key_spki_sha256
         is distinct from attempt.device_public_key_spki_sha256_snapshot
    or assignment_signer.signer_key_id
         is distinct from assignment_transcript.signer_key_id_snapshot
    or assignment_signer.public_key_spki_sha256
         is distinct from assignment_transcript.signer_public_key_spki_sha256_snapshot
    or p_observed_at < attempt.issued_at
    or p_observed_at >= attempt.expires_at
    or p_assessed_at < attempt.issued_at
    or p_assessed_at >= attempt.expires_at
    or p_observed_at > p_assessed_at + interval '5 minutes'
    or p_retrieved_at > p_assessed_at + interval '5 minutes'
    or captured_at >= attempt.expires_at
    or attempt.issued_at < enrollment.valid_from
    or attempt.expires_at > enrollment.valid_until
    or attempt.issued_at < assignment_signer.valid_from
    or attempt.expires_at > assignment_signer.valid_until
    or exists (
      select 1
        from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= captured_at
    )
    or exists (
      select 1
        from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = assignment_signer.id
         and revocation.revoked_at <= captured_at
    ) then
    raise exception 'The private live TeleBirr verification completion lineage is invalid.';
  end if;

  -- Re-read replay state only after the switch/pilot/job mutex and all current enrollment/signer
  -- checks. This binds replay to the exact lease token and makes a stopped, expired, or revoked
  -- authority fail closed. The global switch mutex also serializes request-key reuse across jobs.
  select outcome.*
    into existing_outcome
    from app.private_live_telebirr_verification_outcomes outcome
   where outcome.verification_attempt_id = p_verification_attempt_id
      or outcome.verification_job_id = job.id
      or outcome.completion_request_key = p_completion_request_key
   order by outcome.created_at, outcome.id
   limit 1
   for share;

  if existing_outcome.id is not null then
    if existing_outcome.verification_attempt_id is distinct from p_verification_attempt_id
      or existing_outcome.verification_job_id is distinct from job.id
      or existing_outcome.completion_request_key is distinct from p_completion_request_key
      or existing_outcome.completion_request_digest is distinct from completion_digest then
      raise exception 'The private live TeleBirr verification completion replay conflicts.';
    end if;

    select receipt.*
      into existing_receipt
      from app.private_live_telebirr_settlement_receipts receipt
     where receipt.verification_outcome_id = existing_outcome.id
     for share;

    return query
    select existing_outcome.id,
           existing_outcome.disposition,
           existing_outcome.reason_code,
           existing_outcome.deposit_intent_id,
           existing_receipt.deposit_payment_claim_id,
           existing_receipt.execution_job_id,
           existing_receipt.id is not null,
           true;
    return;
  end if;

  if p_disposition = 'settlement_candidate' then
    -- Hold every mutable policy row through the legacy construction and strict finalizer. The
    -- order is shared with private-pilot settlement; customer rows are UUID-sorted and Player
    -- precedes eligibility because eligibility writers serialize on the Player row.
    select platform.*
      into platform_row
      from app.platforms platform
     where platform.id = pilot.platform_id
     for share;

    select agent.*
      into agent_row
      from app.platform_agent_accounts agent
     where agent.id = pilot.platform_agent_account_id
     for share;

    perform customer.id
      from app.customers customer
     where customer.id in (
       submitting_customer_member.customer_id,
       player_member.player_owner_customer_id_snapshot
     )
     order by customer.id
     for share;

    select customer.*
      into submitting_customer_row
      from app.customers customer
     where customer.id = submitting_customer_member.customer_id;

    select customer.*
      into owner_customer_row
      from app.customers customer
     where customer.id = player_member.player_owner_customer_id_snapshot;

    select player.*
      into player_row
      from app.customer_platform_players player
     where player.id = player_member.player_account_id
     for share;

    select decision.*
      into eligibility_row
      from app.player_deposit_eligibility_decisions decision
     where decision.id = player_member.eligibility_decision_id_snapshot
     for share;

    select payment_provider.*
      into payment_provider_row
      from app.payment_providers payment_provider
     where payment_provider.id = provider_member.payment_provider_id
     for share;

    select receiver.*
      into receiver_row
      from app.receiver_accounts receiver
     where receiver.id = provider_member.receiver_account_id
       and receiver.provider_id = provider_member.payment_provider_id
       and receiver.version = provider_member.receiver_account_version
     for share;

    select policy.*
      into policy_row
      from app.deposit_policy_versions policy
     where policy.status = 'active'
     for share;

    -- Policy locks can block behind a concurrent stop/revocation/configuration writer. Refresh the
    -- authority clock only after the complete mutable lock suffix, then recheck every expiring or
    -- immediately revocable authority before any receipt-derived financial row is constructed.
    captured_at := clock_timestamp();

    if pilot.status <> 'armed'
      or captured_at < pilot.active_from
      or captured_at >= pilot.expires_at
      or captured_at >= job.expires_at
      or captured_at >= attempt.expires_at
      or not app.is_private_live_deposit_pilot_enforced()
      or not exists (
        select 1
          from app.feature_switches provider_switch
         where provider_switch.feature_key = 'telebirr_authoritative_verification'
           and provider_switch.mode = 'live'
      )
      or exists (
        select 1
          from app.private_live_telebirr_device_revocations revocation
         where revocation.device_enrollment_id = enrollment.id
           and revocation.revoked_at <= captured_at
      )
      or exists (
        select 1
          from app.private_live_telebirr_assignment_signer_revocations revocation
         where revocation.assignment_signer_id = assignment_signer.id
           and revocation.revoked_at <= captured_at
      ) then
      raise exception 'The private live TeleBirr settlement candidate authority expired.';
    end if;
  end if;

  if p_disposition = 'settlement_candidate' and (
    pilot.status <> 'armed'
    or captured_at < pilot.active_from
    or captured_at >= pilot.expires_at
    or captured_at >= job.expires_at
    or not app.is_private_live_deposit_pilot_enforced()
    or not exists (
      select 1
        from app.feature_switches provider_switch
       where provider_switch.feature_key = 'telebirr_authoritative_verification'
         and provider_switch.mode = 'live'
    )
    or p_receiver_identity_digest is distinct from profile.receiver_identity_digest
    or p_receipt_principal_amount_minor < pilot.minimum_amount_minor
    or p_receipt_principal_amount_minor > pilot.maximum_per_deposit_minor
    or p_occurred_at < proof.submitted_at - interval '1 hour'
    or p_occurred_at > proof.submitted_at + interval '5 minutes'
    or p_retrieved_at < p_occurred_at
    or platform_row.id is null
    or platform_row.id is distinct from player_member.platform_id_snapshot
    or platform_row.status <> 'active'
    or agent_row.id is null
    or agent_row.id is distinct from pilot.platform_agent_account_id
    or agent_row.platform_id is distinct from pilot.platform_id
    or agent_row.status <> 'active'
    or agent_row.label is distinct from pilot.platform_agent_label_snapshot
    or agent_row.updated_at is distinct from pilot.platform_agent_updated_at_snapshot
    or submitting_customer_row.id is null
    or submitting_customer_row.id is distinct from proof.submitting_customer_id
    or submitting_customer_row.status <> 'active'
    or submitting_customer_row.status
         is distinct from submitting_customer_member.customer_status_snapshot
    or submitting_customer_row.updated_at
         is distinct from submitting_customer_member.customer_updated_at_snapshot
    or owner_customer_row.id is null
    or owner_customer_row.id is distinct from player_member.player_owner_customer_id_snapshot
    or owner_customer_row.status <> 'active'
    or owner_customer_row.status
         is distinct from player_member.player_owner_customer_status_snapshot
    or owner_customer_row.updated_at
         is distinct from player_member.player_owner_customer_updated_at_snapshot
    or player_row.id is null
    or player_row.id is distinct from job.player_account_id
    or player_row.customer_id is distinct from player_member.player_owner_customer_id_snapshot
    or player_row.platform_id is distinct from player_member.platform_id_snapshot
    or player_row.player_id is distinct from player_member.player_id_snapshot
    or player_row.status <> 'active'
    or player_row.validation_status <> 'valid'
    or player_row.updated_at is distinct from player_member.player_updated_at_snapshot
    or eligibility_row.id is null
    or eligibility_row.id is distinct from player_member.eligibility_decision_id_snapshot
    or eligibility_row.player_account_id is distinct from player_row.id
    or eligibility_row.decision_version
         is distinct from player_member.eligibility_decision_version_snapshot
    or eligibility_row.decision <> 'eligible'
    or eligibility_row.decided_at
         is distinct from player_member.eligibility_decided_at_snapshot
    or eligibility_row.player_account_updated_at_snapshot is distinct from player_row.updated_at
    or eligibility_row.id is distinct from (
      select latest.id
        from app.player_deposit_eligibility_decisions latest
       where latest.player_account_id = player_row.id
       order by latest.decision_version desc
       limit 1
    )
    or payment_provider_row.id is null
    or payment_provider_row.id is distinct from job.payment_provider_id
    or payment_provider_row.code <> 'telebirr'
    or payment_provider_row.status <> 'active'
    or payment_provider_row.updated_at
         is distinct from provider_member.provider_updated_at_snapshot
    or receiver_row.id is null
    or receiver_row.status <> 'active'
    or receiver_row.active_from > p_occurred_at
    or (receiver_row.retired_at is not null and p_occurred_at >= receiver_row.retired_at)
    or receiver_row.account_holder_name
         is distinct from provider_member.receiver_account_holder_name_snapshot
    or receiver_row.account_reference_masked
         is distinct from provider_member.receiver_account_masked_snapshot
    or receiver_row.active_from
         is distinct from provider_member.receiver_active_from_snapshot
    or receiver_row.updated_at is distinct from provider_member.receiver_updated_at_snapshot
    or policy_row.id is null
    or policy_row.freshness_window_seconds <> 3600
    or job.deposit_policy_version_id is distinct from policy_row.id
    or job.deposit_policy_version is distinct from policy_row.version
    or job.minimum_principal_amount_minor is distinct from greatest(
      policy_row.minimum_amount_minor,
      pilot.minimum_amount_minor
    )
    or job.maximum_principal_amount_minor is distinct from least(
      policy_row.maximum_amount_minor,
      pilot.maximum_per_deposit_minor
    )
    or job.policy_digest is distinct from app.private_live_telebirr_policy_digest(
      job.minimum_principal_amount_minor,
      job.maximum_principal_amount_minor
    )
    or p_receipt_principal_amount_minor < greatest(
      policy_row.minimum_amount_minor,
      pilot.minimum_amount_minor
    )
    or p_receipt_principal_amount_minor > least(
      policy_row.maximum_amount_minor,
      pilot.maximum_per_deposit_minor
    )
    or exists (
      select 1
        from app.provider_payment_evidence evidence
       where evidence.payment_provider_id = job.payment_provider_id
         and evidence.canonical_reference_fingerprint
             = job.candidate_reference_fingerprint
    )
  ) then
    raise exception 'The private live TeleBirr settlement candidate is not authorized.';
  end if;

  insert into app.private_live_telebirr_observation_transcripts (
    verification_attempt_id,
    assignment_transcript_id,
    observation_body_digest,
    observation_signature_digest,
    replay_identity,
    source_document_digest,
    normalized_facts_digest,
    protocol_disposition,
    protocol_reason_code,
    observed_at,
    received_at
  )
  values (
    attempt.id,
    assignment_transcript.id,
    p_observation_body_digest,
    p_observation_signature_digest,
    p_replay_identity,
    p_source_document_digest,
    p_normalized_facts_digest,
    p_protocol_disposition,
    p_protocol_reason_code,
    p_observed_at,
    captured_at
  )
  returning * into inserted_observation;

  if p_disposition = 'settlement_candidate' then
    new_intent_id := gen_random_uuid();
    new_submission_id := gen_random_uuid();
    new_evidence_id := gen_random_uuid();
    new_verification_attempt_id := gen_random_uuid();
  end if;

  insert into app.private_live_telebirr_verification_outcomes (
    verification_attempt_id,
    verification_job_id,
    observation_transcript_id,
    completion_request_key,
    completion_request_digest,
    private_live_deposit_pilot_proof_id,
    pilot_revision_id,
    submitting_customer_id,
    player_account_id,
    player_owner_customer_id_snapshot,
    platform_id,
    payment_provider_id,
    receiver_profile_id,
    receiver_account_id,
    receiver_account_version,
    pilot_configuration_digest,
    candidate_reference_fingerprint,
    reference_encryption_key_version,
    reference_profile_version,
    assessment_input_digest,
    assessed_at,
    disposition,
    reason_code,
    evidence_digest,
    retrieved_at,
    principal_amount_minor,
    currency_code,
    occurred_at,
    receiver_identity_digest,
    receiver_match_basis,
    deposit_intent_id,
    deposit_submission_id,
    provider_payment_evidence_id,
    deposit_verification_attempt_id
  )
  values (
    attempt.id,
    job.id,
    inserted_observation.id,
    p_completion_request_key,
    completion_digest,
    proof.id,
    pilot.id,
    proof.submitting_customer_id,
    job.player_account_id,
    player_member.player_owner_customer_id_snapshot,
    player_member.platform_id_snapshot,
    job.payment_provider_id,
    profile.id,
    job.receiver_account_id,
    job.receiver_account_version,
    job.pilot_configuration_digest,
    job.candidate_reference_fingerprint,
    job.reference_encryption_key_version,
    job.reference_profile_version,
    p_assessment_input_digest,
    p_assessed_at,
    p_disposition,
    p_reason_code,
    p_evidence_digest,
    p_retrieved_at,
    p_receipt_principal_amount_minor,
    case when p_disposition = 'settlement_candidate' then 'ETB' else null end,
    p_occurred_at,
    p_receiver_identity_digest,
    case when p_disposition = 'settlement_candidate' then 'exact_full_name' else null end,
    new_intent_id,
    new_submission_id,
    new_evidence_id,
    new_verification_attempt_id
  )
  returning * into inserted_outcome;

  if p_disposition <> 'settlement_candidate' then
    return query
    select inserted_outcome.id,
           inserted_outcome.disposition,
           inserted_outcome.reason_code,
           null::uuid,
           null::uuid,
           null::uuid,
           false,
           false;
    return;
  end if;

  insert into app.deposit_intents (
    id,
    customer_id,
    platform_id,
    player_account_id,
    payment_provider_id,
    receiver_account_id,
    expected_amount_minor,
    origin_inbound_event_id,
    private_live_telebirr_outcome_id
  )
  values (
    new_intent_id,
    player_member.player_owner_customer_id_snapshot,
    player_member.platform_id_snapshot,
    job.player_account_id,
    job.payment_provider_id,
    job.receiver_account_id,
    p_receipt_principal_amount_minor,
    null,
    inserted_outcome.id
  );

  insert into app.deposit_submissions (
    id,
    deposit_intent_id,
    submission_number,
    submitted_reference_ciphertext,
    submitted_reference_fingerprint,
    submitted_reference_masked,
    reference_encryption_key_version,
    status,
    origin_inbound_event_id,
    submitted_at,
    private_live_telebirr_outcome_id
  )
  values (
    new_submission_id,
    new_intent_id,
    1,
    proof.candidate_reference_ciphertext,
    proof.candidate_reference_fingerprint,
    proof.candidate_reference_masked,
    proof.reference_encryption_key_version,
    'received',
    null,
    proof.submitted_at,
    inserted_outcome.id
  );

  update app.deposit_submissions submission
     set status = 'verification_enqueued'
   where submission.id = new_submission_id
     and submission.deposit_intent_id = new_intent_id
     and submission.status = 'received';
  if not found then
    raise exception 'The receipt-derived private live TeleBirr submission is inconsistent.';
  end if;

  update app.deposit_intents
     set status = 'verification_pending'
   where id = new_intent_id
     and status = 'intake_received';
  if not found then
    raise exception 'The receipt-derived private live TeleBirr intent is inconsistent.';
  end if;

  insert into app.provider_payment_evidence (
    id,
    payment_provider_id,
    canonical_reference_ciphertext,
    canonical_reference_fingerprint,
    canonical_reference_masked,
    reference_encryption_key_version,
    evidence_source,
    provider_final_status,
    amount_minor,
    currency_code,
    occurred_at,
    matched_receiver_account_id,
    matched_receiver_account_version,
    authoritative_locator_ciphertext,
    authoritative_locator_key_version,
    evidence_digest,
    adapter_version,
    normalization_version,
    retrieved_at,
    private_live_telebirr_outcome_id
  )
  values (
    new_evidence_id,
    job.payment_provider_id,
    proof.candidate_reference_ciphertext,
    proof.candidate_reference_fingerprint,
    proof.candidate_reference_masked,
    proof.reference_encryption_key_version,
    'provider_receipt_lookup',
    'completed',
    p_receipt_principal_amount_minor,
    'ETB',
    p_occurred_at,
    job.receiver_account_id,
    job.receiver_account_version,
    null,
    null,
    p_evidence_digest,
    profile.adapter_version,
    profile.facts_normalizer_version,
    p_retrieved_at,
    inserted_outcome.id
  );

  insert into app.deposit_verification_attempts (
    id,
    deposit_intent_id,
    deposit_submission_id,
    attempt_number,
    outcome,
    reason_code,
    provider_payment_evidence_id,
    adapter_version,
    response_digest,
    started_at,
    completed_at,
    private_live_telebirr_outcome_id
  )
  values (
    new_verification_attempt_id,
    new_intent_id,
    new_submission_id,
    1,
    'verified',
    'exact_proof_match',
    new_evidence_id,
    profile.adapter_version,
    completion_digest,
    attempt.issued_at,
    p_assessed_at,
    inserted_outcome.id
  );

  select settlement.deposit_intent_id,
         settlement.payment_claim_id,
         settlement.execution_job_id,
         settlement.deposit_status,
         settlement.execution_job_status,
         settlement.already_finalized,
         settlement.updated_at
    into settled_intent_id,
         settled_claim_id,
         settled_execution_job_id,
         settled_deposit_status,
         settled_execution_job_status,
         settlement_already_finalized,
         settlement_updated_at
    from app.finalize_private_live_verified_deposit_and_enqueue_execution(
      new_intent_id,
      new_verification_attempt_id,
      new_evidence_id
    ) settlement;

  if settled_intent_id is distinct from new_intent_id
    or settled_claim_id is null
    or settled_execution_job_id is null
    or settled_deposit_status <> 'execution_pending'
    or settled_execution_job_status <> 'queued'
    or settlement_already_finalized is not false then
    raise exception 'The receipt-derived private live TeleBirr settlement result is inconsistent.';
  end if;

  insert into app.private_live_telebirr_settlement_receipts (
    verification_outcome_id,
    deposit_intent_id,
    deposit_payment_claim_id,
    execution_job_id,
    deposit_status,
    execution_job_status,
    settlement_replayed,
    settled_at
  )
  values (
    inserted_outcome.id,
    settled_intent_id,
    settled_claim_id,
    settled_execution_job_id,
    settled_deposit_status,
    settled_execution_job_status,
    settlement_already_finalized,
    settlement_updated_at
  )
  returning * into inserted_receipt;

  return query
  select inserted_outcome.id,
         inserted_outcome.disposition,
         inserted_outcome.reason_code,
         inserted_outcome.deposit_intent_id,
         inserted_receipt.deposit_payment_claim_id,
         inserted_receipt.execution_job_id,
         true,
         false;
end;
$$;

alter table app.private_live_telebirr_receiver_profiles enable row level security;
alter table app.private_live_telebirr_receiver_profiles force row level security;
alter table app.private_live_telebirr_assignment_signers enable row level security;
alter table app.private_live_telebirr_assignment_signers force row level security;
alter table app.private_live_telebirr_assignment_signer_revocations enable row level security;
alter table app.private_live_telebirr_assignment_signer_revocations force row level security;
alter table app.private_live_telebirr_device_enrollments enable row level security;
alter table app.private_live_telebirr_device_enrollments force row level security;
alter table app.private_live_telebirr_device_revocations enable row level security;
alter table app.private_live_telebirr_device_revocations force row level security;
alter table app.private_live_telebirr_verification_jobs enable row level security;
alter table app.private_live_telebirr_verification_jobs force row level security;
alter table app.private_live_telebirr_verification_attempts enable row level security;
alter table app.private_live_telebirr_verification_attempts force row level security;
alter table app.private_live_telebirr_assignment_transcripts enable row level security;
alter table app.private_live_telebirr_assignment_transcripts force row level security;
alter table app.private_live_telebirr_observation_transcripts enable row level security;
alter table app.private_live_telebirr_observation_transcripts force row level security;
alter table app.private_live_telebirr_verification_outcomes enable row level security;
alter table app.private_live_telebirr_verification_outcomes force row level security;
alter table app.private_live_telebirr_settlement_receipts enable row level security;
alter table app.private_live_telebirr_settlement_receipts force row level security;

alter table app.private_live_telebirr_receiver_profiles owner to postgres;
alter table app.private_live_telebirr_assignment_signers owner to postgres;
alter table app.private_live_telebirr_assignment_signer_revocations owner to postgres;
alter table app.private_live_telebirr_device_enrollments owner to postgres;
alter table app.private_live_telebirr_device_revocations owner to postgres;
alter table app.private_live_telebirr_verification_jobs owner to postgres;
alter table app.private_live_telebirr_verification_attempts owner to postgres;
alter table app.private_live_telebirr_assignment_transcripts owner to postgres;
alter table app.private_live_telebirr_observation_transcripts owner to postgres;
alter table app.private_live_telebirr_verification_outcomes owner to postgres;
alter table app.private_live_telebirr_settlement_receipts owner to postgres;

alter function app.private_live_telebirr_policy_digest(bigint, bigint)
  owner to postgres;
alter function app.private_live_telebirr_eligibility_version(integer)
  owner to postgres;
alter function app.reject_private_live_telebirr_lineage_mutation() owner to postgres;
alter function app.reject_private_live_telebirr_lineage_truncate() owner to postgres;
alter function app.enforce_private_live_telebirr_legacy_link_immutable() owner to postgres;
alter function app.enforce_private_live_telebirr_receiver_profile_insert() owner to postgres;
alter function app.enforce_private_live_telebirr_device_enrollment_insert() owner to postgres;
alter function app.enforce_private_live_telebirr_signer_revocation_insert() owner to postgres;
alter function app.enforce_private_live_telebirr_device_revocation_insert() owner to postgres;
alter function app.stage_private_live_telebirr_verification_job(uuid, uuid)
  owner to postgres;
alter function app.lease_next_private_live_telebirr_verification(
  uuid, text, uuid, integer
) owner to postgres;
alter function app.record_private_live_telebirr_assignment_transcript(
  uuid, uuid, uuid, text, text, text
) owner to postgres;
alter function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) owner to postgres;
alter function app.populate_deposit_intent_snapshot() owner to postgres;

revoke all privileges on table
  app.private_live_telebirr_receiver_profiles,
  app.private_live_telebirr_assignment_signers,
  app.private_live_telebirr_assignment_signer_revocations,
  app.private_live_telebirr_device_enrollments,
  app.private_live_telebirr_device_revocations,
  app.private_live_telebirr_verification_jobs,
  app.private_live_telebirr_verification_attempts,
  app.private_live_telebirr_assignment_transcripts,
  app.private_live_telebirr_observation_transcripts,
  app.private_live_telebirr_verification_outcomes,
  app.private_live_telebirr_settlement_receipts
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function
  app.private_live_telebirr_policy_digest(bigint, bigint),
  app.private_live_telebirr_eligibility_version(integer),
  app.reject_private_live_telebirr_lineage_mutation(),
  app.reject_private_live_telebirr_lineage_truncate(),
  app.enforce_private_live_telebirr_legacy_link_immutable(),
  app.enforce_private_live_telebirr_receiver_profile_insert(),
  app.enforce_private_live_telebirr_device_enrollment_insert(),
  app.enforce_private_live_telebirr_signer_revocation_insert(),
  app.enforce_private_live_telebirr_device_revocation_insert(),
  app.stage_private_live_telebirr_verification_job(uuid, uuid),
  app.lease_next_private_live_telebirr_verification(uuid, text, uuid, integer),
  app.record_private_live_telebirr_assignment_transcript(
    uuid, uuid, uuid, text, text, text
  ),
  app.complete_private_live_telebirr_verification(
    uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
    text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
  )
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

-- CREATE OR REPLACE retains the historical trigger function's ACL. Repeat its least-privilege
-- revoke explicitly so this migration cannot accidentally broaden direct execution.
revoke all on function app.populate_deposit_intent_snapshot()
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

comment on table app.private_live_telebirr_receiver_profiles is
  'Immutable digest-only TeleBirr receiver profiles for one exact pilot receiver revision. No raw receiver name is copied into this table.';
comment on table app.private_live_telebirr_assignment_signers is
  'Immutable trusted-assignment signer metadata. No signer is provisioned and no registration path is granted by this dormant migration.';
comment on table app.private_live_telebirr_device_enrollments is
  'Immutable device/key enrollment metadata bound to one pilot and receiver profile. No device is enrolled by this migration.';
comment on table app.private_live_telebirr_verification_jobs is
  'Append-only amount-free jobs sourced exclusively from private_live_deposit_pilot_proofs; dry-run proof tables have no foreign-key path.';
comment on table app.private_live_telebirr_verification_attempts is
  'Append-only lease attempts with exact request replay, expiry, device enrollment, nonce, challenge, and lease-token metadata.';
comment on table app.private_live_telebirr_assignment_transcripts is
  'Append-only digest-only signed-assignment transcript metadata. Raw references and raw receiver names are not stored here.';
comment on table app.private_live_telebirr_observation_transcripts is
  'Append-only digest-only signed-observation and replay metadata. Raw receipt content, references, and receiver names are not stored here.';
comment on table app.private_live_telebirr_verification_outcomes is
  'Append-only authoritative-outcome candidates. Review/reject rows carry no amount or legacy settlement IDs; only exact settlement_candidate rows can enter the atomic completion branch.';
comment on table app.private_live_telebirr_settlement_receipts is
  'Append-only receipt proving that one exact settlement candidate atomically produced a claim and queued execution through the strict private-pilot finalizer.';
comment on function app.private_live_telebirr_policy_digest(bigint, bigint) is
  'Dormant, ungranted canonical policy-binding digest shared byte-for-byte with the TeleBirr outcome adapter; dynamic checked_at remains bound by the independent database-snapshot digest.';
comment on function app.private_live_telebirr_eligibility_version(integer) is
  'Dormant, ungranted version bridge from the database eligibility decision integer to the exact TeleBirr protocol contract string.';
comment on function app.stage_private_live_telebirr_verification_job(uuid, uuid) is
  'Dormant, ungranted proof-to-job boundary. It accepts only private live pilot proofs and creates no amount, claim, settlement, or execution authority.';
comment on function app.lease_next_private_live_telebirr_verification(
  uuid, text, uuid, integer
) is
  'Dormant, ungranted SKIP LOCKED lease boundary. Returns only protected proof material plus exact assignment bindings; no trusted verifier role is provisioned.';
comment on function app.record_private_live_telebirr_assignment_transcript(
  uuid, uuid, uuid, text, text, text
) is
  'Dormant, ungranted append-only assignment-transcript recorder. Signatures are represented by digests and externally verified trust remains unwired.';
comment on function app.complete_private_live_telebirr_verification(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, text, text,
  text, timestamptz, text, text, text, timestamptz, bigint, timestamptz, text
) is
  'Dormant, ungranted completion boundary. Only signed_evidence_verified plus exact_proof_match can atomically construct receipt-derived legacy lineage and call finalize_private_live_verified_deposit_and_enqueue_execution; review/reject cannot settle.';

commit;
