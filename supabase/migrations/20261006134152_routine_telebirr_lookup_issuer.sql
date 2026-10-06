-- Administrator-only, no-money routine lookup issuer. This release installs no enrollment,
-- signer, transport, application grant, observation upload, provider claim, or money authority.
-- The five-account pilot enrollment is deliberately not accepted as routine device trust.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $routine_lookup_digest_preflight$
begin
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
    and pg_catalog.to_regprocedure('public.digest(bytea,text)') is null then
    raise exception 'Routine lookup issuance requires the pgcrypto SHA-256 digest function.';
  end if;
end;
$routine_lookup_digest_preflight$;

create function app.routine_telebirr_sha256_digest(p_bytes bytea)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare digest_hex text;
begin
  if p_bytes is null then raise exception 'A routine digest input is required.'; end if;
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute 'select pg_catalog.encode(extensions.digest($1, ''sha256''), ''hex'')'
      into digest_hex using p_bytes;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute 'select pg_catalog.encode(public.digest($1, ''sha256''), ''hex'')'
      into digest_hex using p_bytes;
  else
    raise exception 'The routine SHA-256 digest function is unavailable.';
  end if;
  if digest_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'The routine SHA-256 digest result is invalid.';
  end if;
  return 'sha256:' || digest_hex;
end;
$$;

-- Same NFC/ASCII-whitespace/case normalization and length-prefixed transcript as the
-- routine Android/TypeScript contract, with a domain separate from the old pilot.
create function app.routine_telebirr_receiver_name_digest(p_name text)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  normalized_name text;
  code_point integer;
  character_index integer;
  transcript_value text;
  digest_input bytea := pg_catalog.decode('', 'hex');
begin
  if p_name is null then raise exception 'The routine receiver name is unavailable.'; end if;
  for character_index in 1..pg_catalog.char_length(p_name) loop
    code_point := pg_catalog.ascii(pg_catalog.substr(p_name, character_index, 1));
    if code_point between 1 and 8 or code_point between 14 and 31
      or code_point between 127 and 159 then
      raise exception 'The routine receiver name is invalid.';
    end if;
  end loop;
  normalized_name := normalize(p_name, NFC);
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(9), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(10), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(11), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(12), ' ');
  normalized_name := pg_catalog.replace(normalized_name, pg_catalog.chr(13), ' ');
  normalized_name := pg_catalog.btrim(pg_catalog.regexp_replace(normalized_name, ' +', ' ', 'g'));
  normalized_name := pg_catalog.translate(
    normalized_name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  if pg_catalog.char_length(normalized_name) not between 2 and 160
    or pg_catalog.octet_length(normalized_name) > 320 then
    raise exception 'The normalized routine receiver name is invalid.';
  end if;
  foreach transcript_value in array array[
    'fetanagent:telebirr:routine:receiver-name:v1', '2',
    'normalizerVersion', 'string:telebirr-credited-party-name-normalizer-v1',
    'normalizedName', 'string:' || normalized_name
  ] loop
    digest_input := digest_input
      || pg_catalog.int4send(pg_catalog.octet_length(pg_catalog.convert_to(transcript_value, 'UTF8')))
      || pg_catalog.convert_to(transcript_value, 'UTF8');
  end loop;
  return app.routine_telebirr_sha256_digest(digest_input);
end;
$$;

create function app.routine_telebirr_receiver_profile_digest(
  p_receiver_id uuid, p_version integer, p_reference_fingerprint text, p_name text
)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  transcript_value text;
  digest_input bytea := pg_catalog.decode('', 'hex');
begin
  if p_receiver_id is null or p_version is null or p_version < 1
    or p_reference_fingerprint is null
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'The routine receiver profile input is invalid.';
  end if;
  foreach transcript_value in array array[
    'fetanagent:telebirr:routine:receiver-profile:v1',
    p_receiver_id::text, p_version::text, p_reference_fingerprint,
    app.routine_telebirr_receiver_name_digest(p_name)
  ] loop
    digest_input := digest_input
      || pg_catalog.int4send(pg_catalog.octet_length(pg_catalog.convert_to(transcript_value, 'UTF8')))
      || pg_catalog.convert_to(transcript_value, 'UTF8');
  end loop;
  return app.routine_telebirr_sha256_digest(digest_input);
end;
$$;

create table app.routine_telebirr_lookup_signers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  signer_key_id text not null unique
    check (signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  public_key_spki_sha256 text not null unique
    check (public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (valid_until > valid_from and valid_until <= valid_from + interval '30 days')
);

create table app.routine_telebirr_lookup_signer_revocations (
  signer_id uuid primary key references app.routine_telebirr_lookup_signers (id)
    on delete restrict,
  reason_code text not null check (reason_code in ('owner_revoked', 'key_compromise', 'rotation')),
  revoked_at timestamptz not null default pg_catalog.clock_timestamp()
);

-- Populated only by a future reviewed, authenticated routine pairing flow. The digest is
-- evidence identity, not a claim that this migration verifies a device or certificate.
create table app.routine_telebirr_device_enrollments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  pairing_evidence_digest text not null unique
    check (pairing_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  device_id text not null check (device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_key_id text not null
    check (device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_public_key_spki_sha256 text not null unique
    check (device_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  receiver_account_id uuid not null references app.receiver_accounts (id) on delete restrict,
  receiver_account_version integer not null check (receiver_account_version > 0),
  receiver_profile_digest text not null
    check (receiver_profile_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_receiver_name_digest text not null
    check (expected_receiver_name_digest ~ '^sha256:[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (device_id, device_key_id),
  check (valid_until > valid_from and valid_until <= valid_from + interval '30 days')
);
create index routine_telebirr_device_enrollments_receiver_idx
  on app.routine_telebirr_device_enrollments (receiver_account_id, receiver_account_version);

create table app.routine_telebirr_device_enrollment_revocations (
  enrollment_id uuid primary key references app.routine_telebirr_device_enrollments (id)
    on delete restrict,
  reason_code text not null
    check (reason_code in ('owner_revoked', 'device_lost', 'key_compromise', 'rotation')),
  revoked_at timestamptz not null default pg_catalog.clock_timestamp()
);

lock table app.routine_telebirr_lookup_challenges in access exclusive mode;
do $routine_lookup_empty_preflight$
begin
  if exists (select 1 from app.routine_telebirr_lookup_challenges) then
    raise exception 'Existing routine lookup challenges require enrollment review.';
  end if;
end;
$routine_lookup_empty_preflight$;

alter table app.routine_telebirr_lookup_challenges
  add column device_enrollment_id uuid not null
    references app.routine_telebirr_device_enrollments (id) on delete restrict,
  add column assignment_signer_id uuid not null
    references app.routine_telebirr_lookup_signers (id) on delete restrict,
  add column receiver_profile_digest text not null
    check (receiver_profile_digest ~ '^sha256:[0-9a-f]{64}$'),
  add column expected_receiver_name_digest text not null
    check (expected_receiver_name_digest ~ '^sha256:[0-9a-f]{64}$');

-- Cover the entire composite candidate FK for cascade cleanup and retain candidate lookup order.
drop index app.routine_telebirr_lookup_candidate_idx;
create index routine_telebirr_lookup_candidate_idx on app.routine_telebirr_lookup_challenges
  (candidate_id, receiver_account_id, receiver_account_version,
   candidate_reference_fingerprint, candidate_submitted_at, issued_at desc, challenge_id);
create index routine_telebirr_lookup_enrollment_idx
  on app.routine_telebirr_lookup_challenges (device_enrollment_id);
create index routine_telebirr_lookup_signer_idx
  on app.routine_telebirr_lookup_challenges (assignment_signer_id);

create function app.issue_routine_telebirr_lookup_challenge(
  p_candidate_id uuid, p_enrollment_id uuid, p_signer_id uuid
)
returns table (
  challenge_id uuid, challenge_digest text, issued_at timestamptz,
  expires_at timestamptz, receiver_profile_digest text,
  expected_receiver_name_digest text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_signer app.routine_telebirr_lookup_signers%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_boundary record;
  v_player_id text;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
  v_challenge_id uuid;
  v_challenge_digest text;
  v_profile_digest text;
  v_name_digest text;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Routine lookup issuance is administrator-only.';
  end if;
  if p_candidate_id is null or p_enrollment_id is null or p_signer_id is null then
    raise exception 'The routine lookup input is invalid.';
  end if;

  -- Same fixed no-money lock order as candidate capture. No provider or financial write follows.
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count
    from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or v_disabled_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;

  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
    where candidate.id = p_candidate_id for update;
  v_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if v_candidate.id is null or v_candidate.provider_code <> 'telebirr'
    or v_candidate.submitted_at > v_now
    or v_candidate.submitted_at + interval '7 days' < v_now + interval '5 minutes' then
    raise exception 'The routine candidate is unavailable.';
  end if;
  perform 1 from app.customers customer
    join app.customer_identities identity on identity.customer_id = customer.id
    where customer.id = v_candidate.submitting_customer_id
      and customer.status = 'active'
      and identity.id = v_candidate.origin_identity_id
      and identity.status = 'active' for share of customer, identity;
  if not found then raise exception 'The routine candidate owner is unavailable.'; end if;

  select player.player_id into v_player_id from app.customer_platform_players player
    where player.id = v_candidate.player_account_id for share;
  if v_player_id is null then raise exception 'The routine Player is unavailable.'; end if;
  select boundary.* into v_boundary
    from app.resolve_dry_run_deposit_proof_boundary(v_player_id, 'telebirr') boundary;
  if not found then raise exception 'The routine Player eligibility has changed.'; end if;
  if v_boundary.player_account_id <> v_candidate.player_account_id
    or v_boundary.platform_id <> v_candidate.platform_id
    or v_boundary.player_deposit_eligibility_decision_id
      <> v_candidate.player_deposit_eligibility_decision_id
    or v_boundary.payment_provider_id <> v_candidate.payment_provider_id then
    raise exception 'The routine Player eligibility has changed.';
  end if;

  select receiver.* into v_receiver from app.receiver_accounts receiver
    where receiver.id = v_candidate.receiver_account_id
      and receiver.provider_id = v_candidate.payment_provider_id
      and receiver.version = v_candidate.receiver_account_version
      and receiver.status = 'active' and receiver.retired_at is null
      and receiver.active_from <= v_now
      and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
    for share;
  if v_receiver.id is null then raise exception 'The routine receiver has rotated.'; end if;
  v_name_digest := app.routine_telebirr_receiver_name_digest(v_receiver.account_holder_name);
  v_profile_digest := app.routine_telebirr_receiver_profile_digest(
    v_receiver.id, v_receiver.version, v_receiver.account_reference_fingerprint,
    v_receiver.account_holder_name);

  select enrollment.* into v_enrollment from app.routine_telebirr_device_enrollments enrollment
    where enrollment.id = p_enrollment_id for share;
  if v_enrollment.id is null
    or v_enrollment.receiver_account_id <> v_receiver.id
    or v_enrollment.receiver_account_version <> v_receiver.version
    or v_enrollment.receiver_profile_digest <> v_profile_digest
    or v_enrollment.expected_receiver_name_digest <> v_name_digest
    or v_enrollment.valid_from > v_now
    or v_enrollment.valid_until < v_now + interval '5 minutes'
    or exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
      where revocation.enrollment_id = v_enrollment.id) then
    raise exception 'The routine device enrollment is unavailable.';
  end if;
  select signer.* into v_signer from app.routine_telebirr_lookup_signers signer
    where signer.id = p_signer_id for share;
  if v_signer.id is null or v_signer.valid_from > v_now
    or v_signer.valid_until < v_now + interval '5 minutes'
    or exists (select 1 from app.routine_telebirr_lookup_signer_revocations revocation
      where revocation.signer_id = v_signer.id) then
    raise exception 'The routine assignment signer is unavailable.';
  end if;
  if (select pg_catalog.count(*) from app.routine_telebirr_lookup_challenges challenge
        where challenge.candidate_id = v_candidate.id) >= 5 then
    raise exception 'The routine candidate lookup limit is reached.';
  end if;

  v_challenge_id := pg_catalog.gen_random_uuid();
  v_challenge_digest := app.routine_telebirr_sha256_digest(pg_catalog.convert_to(
    'fetanagent:telebirr:routine:lookup-challenge:v1:'
      || v_challenge_id::text || ':' || pg_catalog.gen_random_uuid()::text, 'UTF8'));
  insert into app.routine_telebirr_lookup_challenges (
    challenge_id, candidate_id, receiver_account_id, receiver_account_version,
    candidate_reference_fingerprint, candidate_submitted_at,
    device_id, device_key_id, device_public_key_spki_sha256,
    device_enrollment_id, assignment_signer_id,
    receiver_profile_digest, expected_receiver_name_digest,
    challenge_digest, issued_at, expires_at
  ) values (
    v_challenge_id, v_candidate.id, v_receiver.id, v_receiver.version,
    v_candidate.candidate_reference_fingerprint, v_candidate.submitted_at,
    v_enrollment.device_id, v_enrollment.device_key_id,
    v_enrollment.device_public_key_spki_sha256,
    v_enrollment.id, v_signer.id, v_profile_digest, v_name_digest,
    v_challenge_digest, v_now, v_now + interval '5 minutes'
  );
  return query select v_challenge_id, v_challenge_digest, v_now,
    v_now + interval '5 minutes', v_profile_digest, v_name_digest;
end;
$$;

do $protect_routine_lookup_trust$
declare ledger text;
begin
  foreach ledger in array array[
    'routine_telebirr_lookup_signers', 'routine_telebirr_lookup_signer_revocations',
    'routine_telebirr_device_enrollments', 'routine_telebirr_device_enrollment_revocations'
  ] loop
    execute pg_catalog.format('alter table app.%I owner to postgres', ledger);
    execute pg_catalog.format('alter table app.%I enable row level security', ledger);
    execute pg_catalog.format('alter table app.%I force row level security', ledger);
    execute pg_catalog.format('create trigger %I before update or delete on app.%I '
      || 'for each row execute function app.reject_deposit_ledger_delete()',
      ledger || '_immutable', ledger);
    execute pg_catalog.format('create trigger %I before truncate on app.%I '
      || 'for each statement execute function app.reject_execution_ledger_truncate()',
      ledger || '_no_truncate', ledger);
    execute pg_catalog.format('revoke all on table app.%I from public, anon, authenticated, '
      || 'service_role, fetanagent_api, fetanagent_api_runtime, '
      || 'fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime, '
      || 'fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime, '
      || 'fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime, '
      || 'fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime',
      ledger);
  end loop;
end;
$protect_routine_lookup_trust$;

alter function app.issue_routine_telebirr_lookup_challenge(uuid, uuid, uuid) owner to postgres;
revoke all on function app.routine_telebirr_sha256_digest(bytea),
  app.routine_telebirr_receiver_name_digest(text),
  app.routine_telebirr_receiver_profile_digest(uuid, integer, text, text),
  app.issue_routine_telebirr_lookup_challenge(uuid, uuid, uuid)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime;

comment on function app.issue_routine_telebirr_lookup_challenge(uuid, uuid, uuid) is
  'Postgres-only, five-minute, no-money challenge reservation. No routine enrollment or signer can be created by an application role; not a signed assignment or provider payment claim.';
comment on table app.routine_telebirr_device_enrollments is
  'Empty, private routine-only enrollment trust store. A future authenticated pairing flow must populate it; pilot enrollment is not accepted.';

commit;
