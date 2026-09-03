-- Private, ingress-free TeleBirr assignment-broker database boundary.
--
-- This migration creates a NOLOGIN runtime scaffold and two guarded routines: one leases only the
-- exact protected-reference assignment material already authorized by the private pilot, and one
-- persists/replays the public ECDSA signature plus digests. It stores no plaintext reference,
-- provisions no key/device/pilot, opens no ingress, and changes no feature switch.

begin;

create role fetanagent_telebirr_assignment_broker
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_telebirr_assignment_broker_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant fetanagent_telebirr_assignment_broker
  to fetanagent_telebirr_assignment_broker_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.private_live_telebirr_assignment_transcripts
  add constraint private_live_telebirr_assignment_transcript_delivery_key
  unique (
    id,
    verification_attempt_id,
    assignment_signature_digest
  );

create table app.private_live_telebirr_assignment_deliveries (
  verification_attempt_id uuid primary key
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  assignment_transcript_id uuid not null unique,
  assignment_signature text not null unique
    check (
      assignment_signature = pg_catalog.btrim(assignment_signature)
      and assignment_signature ~ '^[A-Za-z0-9_-]{86}$'
    ),
  assignment_signature_digest text not null unique
    check (assignment_signature_digest ~ '^sha256:[0-9a-f]{64}$'),
  persisted_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_telebirr_assignment_delivery_transcript_fkey
    foreign key (
      assignment_transcript_id,
      verification_attempt_id,
      assignment_signature_digest
    ) references app.private_live_telebirr_assignment_transcripts (
      id,
      verification_attempt_id,
      assignment_signature_digest
    ) on delete restrict
);

create trigger private_live_telebirr_assignment_deliveries_immutable
before update or delete on app.private_live_telebirr_assignment_deliveries
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_telebirr_assignment_deliveries_no_truncate
before truncate on app.private_live_telebirr_assignment_deliveries
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.require_telebirr_assignment_broker_session()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  runtime_is_currently_authorized boolean;
begin
  -- The migration owner is the explicit disposable-test/maintenance bypass. SET ROLE to the group
  -- is insufficient: every operational call must originate from the exact bounded runtime login.
  if session_user = 'postgres' then
    return;
  end if;

  select exists (
    select 1
      from pg_catalog.pg_roles role
     where role.rolname = session_user
       and role.rolname = 'fetanagent_telebirr_assignment_broker_runtime'
       and role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not null
       and role.rolvaliduntil
           > pg_catalog.clock_timestamp() + interval '5 minutes'
       and role.rolvaliduntil
           <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
  ) into runtime_is_currently_authorized;

  if runtime_is_currently_authorized is not true then
    raise exception 'The TeleBirr assignment broker session is not currently authorized.';
  end if;
end;
$$;

create function app.private_live_telebirr_assignment_signature_digest(
  p_assignment_signature text
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  decoded_signature bytea;
  digest_hex text;
begin
  if p_assignment_signature is null
    or p_assignment_signature !~ '^[A-Za-z0-9_-]{86}$' then
    raise exception 'The TeleBirr assignment signature is invalid.';
  end if;

  begin
    decoded_signature := pg_catalog.decode(
      pg_catalog.translate(p_assignment_signature, '-_', '+/') || '==',
      'base64'
    );
  exception when others then
    raise exception 'The TeleBirr assignment signature is invalid.';
  end;

  if pg_catalog.octet_length(decoded_signature) <> 64
    or pg_catalog.rtrim(
         pg_catalog.translate(
           pg_catalog.replace(pg_catalog.encode(decoded_signature, 'base64'), E'\n', ''),
           '+/',
           '-_'
         ),
         '='
       ) <> p_assignment_signature then
    raise exception 'The TeleBirr assignment signature is invalid.';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(extensions.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using decoded_signature;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(public.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using decoded_signature;
  else
    raise exception 'The TeleBirr assignment signature digest is unavailable.';
  end if;

  if digest_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'The TeleBirr assignment signature digest is invalid.';
  end if;
  return 'sha256:' || digest_hex;
end;
$$;

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

  -- Device enrollments are append-only. Read the immutable public snapshot before invoking the
  -- leasing routine: a sibling table scan in the same RETURN QUERY statement would use the
  -- statement's pre-call snapshot and could not see the verification-attempt row created by the
  -- leasing routine.
  select device_enrollment.*
    into enrollment
    from app.private_live_telebirr_device_enrollments device_enrollment
   where device_enrollment.id = p_device_enrollment_id;

  if enrollment.id is null then
    raise exception 'The private live TeleBirr device enrollment is unavailable.';
  end if;

  return query
  select leased.verification_attempt_id,
         leased.lease_token,
         leased.verification_job_id,
         leased.attempt_number,
         leased.request_id,
         leased.assignment_id,
         leased.lease_nonce_digest,
         leased.challenge_id,
         leased.challenge_digest,
         leased.issued_at,
         leased.expires_at,
         leased.pilot_revision_id,
         enrollment.id,
         enrollment.device_id,
         enrollment.key_id,
         enrollment.public_key_spki_sha256,
         leased.receiver_account_id,
         leased.receiver_profile_id,
         leased.receiver_profile_digest,
         leased.receiver_configuration_digest,
         leased.expected_receiver_name_digest,
         leased.receiver_name_normalizer_version,
         leased.source_profile,
         leased.adapter_version,
         leased.parser_version,
         leased.facts_normalizer_version,
         leased.candidate_reference_ciphertext,
         leased.candidate_reference_fingerprint,
         leased.reference_encryption_key_version,
         leased.reference_profile_version,
         leased.replayed
    from app.lease_next_private_live_telebirr_verification(
      p_device_enrollment_id,
      p_leased_by,
      p_lease_request_key,
      p_lease_seconds
    ) leased;
end;
$$;

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
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  existing_delivery app.private_live_telebirr_assignment_deliveries%rowtype;
  existing_transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  recorded_transcript_id uuid;
  recorded_signed_at timestamptz;
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
    raise exception 'The TeleBirr assignment persistence request is invalid.';
  end if;

  computed_signature_digest :=
    app.private_live_telebirr_assignment_signature_digest(
      p_proposed_assignment_signature
    );
  if computed_signature_digest is distinct from p_proposed_assignment_signature_digest then
    raise exception 'The TeleBirr assignment signature digest does not match.';
  end if;

  -- Serialize the first signature for an attempt. ECDSA may produce a different valid signature on
  -- a retry, so an exact body replay returns the first stored signature instead of conflicting.
  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = p_verification_attempt_id
     and verification_attempt.lease_token = p_lease_token
   for update;

  if attempt.id is null then
    raise exception 'The TeleBirr assignment lease is unavailable.';
  end if;

  select delivery.*
    into existing_delivery
    from app.private_live_telebirr_assignment_deliveries delivery
   where delivery.verification_attempt_id = attempt.id;

  if existing_delivery.verification_attempt_id is not null then
    select transcript.*
      into existing_transcript
      from app.private_live_telebirr_assignment_transcripts transcript
     where transcript.id = existing_delivery.assignment_transcript_id
       and transcript.verification_attempt_id = existing_delivery.verification_attempt_id
       and transcript.assignment_signature_digest
           = existing_delivery.assignment_signature_digest;

    if existing_transcript.assignment_signer_id is distinct from p_assignment_signer_id
      or existing_transcript.assignment_body_digest is distinct from p_assignment_body_digest
      or existing_transcript.reference_binding_digest is distinct from p_reference_binding_digest
      or app.private_live_telebirr_assignment_signature_digest(
           existing_delivery.assignment_signature
         ) is distinct from existing_delivery.assignment_signature_digest then
      raise exception 'The TeleBirr assignment persistence replay conflicts.';
    end if;

    -- Re-enter the original authority guard with the stored signature digest. This makes an exact
    -- replay obey current pilot, lease, signer, and device revocation state.
    perform transcript.assignment_transcript_id
      from app.record_private_live_telebirr_assignment_transcript(
        attempt.id,
        attempt.lease_token,
        existing_transcript.assignment_signer_id,
        existing_transcript.assignment_body_digest,
        existing_transcript.assignment_signature_digest,
        existing_transcript.reference_binding_digest
      ) transcript;

    return query
    select existing_delivery.assignment_signature,
           existing_delivery.assignment_signature_digest,
           existing_transcript.signed_at,
           true;
    return;
  end if;

  select transcript.assignment_transcript_id,
         transcript.signed_at
    into recorded_transcript_id,
         recorded_signed_at
    from app.record_private_live_telebirr_assignment_transcript(
      attempt.id,
      attempt.lease_token,
      p_assignment_signer_id,
      p_assignment_body_digest,
      p_proposed_assignment_signature_digest,
      p_reference_binding_digest
    ) transcript;

  if recorded_transcript_id is null or recorded_signed_at is null then
    raise exception 'The TeleBirr assignment transcript was not recorded.';
  end if;

  insert into app.private_live_telebirr_assignment_deliveries (
    verification_attempt_id,
    assignment_transcript_id,
    assignment_signature,
    assignment_signature_digest
  )
  values (
    attempt.id,
    recorded_transcript_id,
    p_proposed_assignment_signature,
    p_proposed_assignment_signature_digest
  );

  return query
  select p_proposed_assignment_signature,
         p_proposed_assignment_signature_digest,
         recorded_signed_at,
         false;
end;
$$;

alter table app.private_live_telebirr_assignment_deliveries enable row level security;
alter table app.private_live_telebirr_assignment_deliveries force row level security;
alter table app.private_live_telebirr_assignment_deliveries owner to postgres;

alter function app.require_telebirr_assignment_broker_session() owner to postgres;
alter function app.private_live_telebirr_assignment_signature_digest(text) owner to postgres;
alter function app.lease_private_live_telebirr_assignment_broker(uuid, text, uuid, integer)
  owner to postgres;
alter function app.persist_private_live_telebirr_assignment_broker_signature(
  uuid, uuid, uuid, text, text, text, text
) owner to postgres;

revoke all privileges on table app.private_live_telebirr_assignment_deliveries
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
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime;

revoke all on function
  app.require_telebirr_assignment_broker_session(),
  app.private_live_telebirr_assignment_signature_digest(text),
  app.lease_private_live_telebirr_assignment_broker(uuid, text, uuid, integer),
  app.persist_private_live_telebirr_assignment_broker_signature(
    uuid, uuid, uuid, text, text, text, text
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
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier,
     fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime;

do $$
begin
  execute format(
    'revoke all privileges on database %I from fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime',
    current_database()
  );
end;
$$;

revoke all privileges on schema app
from fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime;
revoke all privileges on all tables in schema app
from fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime;
revoke all privileges on all sequences in schema app
from fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime;
revoke all privileges on all functions in schema app
from fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime;
revoke all privileges on all procedures in schema app
from fetanagent_telebirr_assignment_broker,
     fetanagent_telebirr_assignment_broker_runtime;

grant usage on schema app to fetanagent_telebirr_assignment_broker;
grant execute on function
  app.lease_private_live_telebirr_assignment_broker(uuid, text, uuid, integer),
  app.persist_private_live_telebirr_assignment_broker_signature(
    uuid, uuid, uuid, text, text, text, text
  )
to fetanagent_telebirr_assignment_broker;

comment on table app.private_live_telebirr_assignment_deliveries is
  'Append-only public-signature replay material for one exact TeleBirr assignment attempt. Contains no plaintext reference, receiver name, key, credential, receipt, claim, settlement, or execution authority.';
comment on function app.lease_private_live_telebirr_assignment_broker(
  uuid, text, uuid, integer
) is
  'Operation-time guarded assignment lease projection for the exact private broker runtime. Returns protected reference material and immutable bindings only; no plaintext or financial authority.';
comment on function app.persist_private_live_telebirr_assignment_broker_signature(
  uuid, uuid, uuid, text, text, text, text
) is
  'Operation-time guarded append/replay boundary. Stores one public P-256 signature and exact digests so ECDSA retries after a lost acknowledgement return the original assignment signature.';
comment on function app.require_telebirr_assignment_broker_session() is
  'Owner-only server-time guard requiring the exact bounded assignment-broker runtime login on every operational call; postgres is the explicit migration-owner maintenance bypass.';
comment on function app.private_live_telebirr_assignment_signature_digest(text) is
  'Owner-only canonical base64url P-256 signature decoder and SHA-256 digest helper; never granted to runtime or public roles.';
comment on role fetanagent_telebirr_assignment_broker is
  'Private TeleBirr assignment-broker group. NOLOGIN; may only lease protected assignment material and persist/replay one public signature.';
comment on role fetanagent_telebirr_assignment_broker_runtime is
  'Unconfigured NOLOGIN assignment-broker runtime scaffold with no SET ROLE, base-table, sequence, public API, settlement, or execution authority.';

commit;
