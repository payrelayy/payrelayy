-- Private, durable TeleBirr Android device-state boundary.
--
-- This migration stores only one-use pairing state, signed public enrollment certificates,
-- bounded command replay responses, redacted heartbeat health, and signed evidence awaiting the
-- isolated verifier. It creates a NOLOGIN runtime scaffold, opens no ingress, provisions no
-- credential, changes no feature switch, and cannot claim, settle, enqueue, execute, or move money.

begin;

create role fetanagent_telebirr_device_state
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_telebirr_device_state_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant fetanagent_telebirr_device_state
  to fetanagent_telebirr_device_state_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.private_live_telebirr_device_pairing_challenges (
  pairing_id uuid primary key,
  issue_request_key uuid not null unique,
  issue_request_digest text not null unique
    check (issue_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  assignment_signer_id uuid not null
    references app.private_live_telebirr_assignment_signers (id) on delete restrict,
  pairing_nonce_digest text not null unique
    check (pairing_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  minimum_app_version text not null
    check (
      minimum_app_version = pg_catalog.btrim(minimum_app_version)
      and minimum_app_version
        ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
    ),
  valid_from timestamptz not null,
  expires_at timestamptz not null,
  created_by_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  state text not null default 'open'
    check (state in ('open', 'claimed', 'bound', 'completed')),
  pairing_request_body_digest text unique
    check (
      pairing_request_body_digest is null
      or pairing_request_body_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  reserved_enrollment_id uuid unique,
  device_id text
    check (
      device_id is null
      or (
        device_id = pg_catalog.btrim(device_id)
        and device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      )
    ),
  device_key_id text
    check (
      device_key_id is null
      or (
        device_key_id = pg_catalog.btrim(device_key_id)
        and device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      )
    ),
  device_public_key_spki text
    check (
      device_public_key_spki is null
      or (
        pg_catalog.length(device_public_key_spki) between 1 and 684
        and device_public_key_spki ~ '^[A-Za-z0-9_-]+$'
      )
    ),
  device_public_key_spki_sha256 text
    check (
      device_public_key_spki_sha256 is null
      or device_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'
    ),
  device_app_version text
    check (
      device_app_version is null
      or (
        device_app_version = pg_catalog.btrim(device_app_version)
        and device_app_version
          ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
      )
    ),
  pairing_request_issued_at timestamptz,
  pairing_request_expires_at timestamptz,
  certificate_issued_at timestamptz,
  certificate_valid_from timestamptz,
  certificate_valid_until timestamptz,
  certificate_body jsonb
    check (
      certificate_body is null
      or (
        pg_catalog.jsonb_typeof(certificate_body) = 'object'
        and pg_catalog.pg_column_size(certificate_body) <= 65536
      )
    ),
  first_claimed_at timestamptz,
  last_claimed_at timestamptz,
  claim_lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_telebirr_device_pairing_id_v4_check check (
    pairing_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_telebirr_device_pairing_request_key_v4_check check (
    issue_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint private_live_telebirr_device_pairing_window_check check (
    expires_at > valid_from
    and expires_at <= valid_from + interval '30 minutes'
  ),
  constraint private_live_telebirr_device_pairing_claim_window_check check (
    pairing_request_issued_at is null
    or (
      pairing_request_expires_at > pairing_request_issued_at
      and pairing_request_expires_at <= pairing_request_issued_at + interval '10 minutes'
      and certificate_issued_at >= pairing_request_issued_at
      and certificate_issued_at < pairing_request_expires_at
      and certificate_valid_from = certificate_issued_at
      and certificate_valid_until > certificate_valid_from
    )
  ),
  constraint private_live_telebirr_device_pairing_state_shape_check check (
    (state = 'open'
      and pairing_request_body_digest is null
      and reserved_enrollment_id is null
      and device_id is null
      and device_key_id is null
      and device_public_key_spki is null
      and device_public_key_spki_sha256 is null
      and device_app_version is null
      and pairing_request_issued_at is null
      and pairing_request_expires_at is null
      and certificate_issued_at is null
      and certificate_valid_from is null
      and certificate_valid_until is null
      and certificate_body is null
      and first_claimed_at is null
      and last_claimed_at is null
      and claim_lease_expires_at is null
      and completed_at is null)
    or (state in ('claimed', 'bound', 'completed')
      and pairing_request_body_digest is not null
      and reserved_enrollment_id is not null
      and device_id is not null
      and device_key_id is not null
      and device_public_key_spki is not null
      and device_public_key_spki_sha256 is not null
      and device_app_version is not null
      and pairing_request_issued_at is not null
      and pairing_request_expires_at is not null
      and certificate_issued_at is not null
      and certificate_valid_from is not null
      and certificate_valid_until is not null
      and certificate_body is not null
      and first_claimed_at is not null
      and last_claimed_at is not null
      and ((state = 'claimed' and claim_lease_expires_at is not null and completed_at is null)
        or (state = 'bound' and claim_lease_expires_at is null and completed_at is null)
        or (state = 'completed' and claim_lease_expires_at is null and completed_at is not null)))
  )
);

create index private_live_telebirr_device_pairings_pilot_idx
  on app.private_live_telebirr_device_pairing_challenges (pilot_revision_id);
create index private_live_telebirr_device_pairings_profile_idx
  on app.private_live_telebirr_device_pairing_challenges (receiver_profile_id);
create index private_live_telebirr_device_pairings_signer_idx
  on app.private_live_telebirr_device_pairing_challenges (assignment_signer_id);
create index private_live_telebirr_device_pairings_admin_idx
  on app.private_live_telebirr_device_pairing_challenges (created_by_admin_id);
create index private_live_telebirr_device_pairings_claim_expiry_idx
  on app.private_live_telebirr_device_pairing_challenges (claim_lease_expires_at, pairing_id)
  where state = 'claimed';

create table app.private_live_telebirr_device_enrollment_certificates (
  device_enrollment_id uuid primary key
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  pairing_id uuid not null unique
    references app.private_live_telebirr_device_pairing_challenges (pairing_id) on delete restrict,
  pairing_request_body_digest text not null unique
    check (pairing_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  certificate_body_digest text not null unique
    check (certificate_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  certificate_signer_key_id text not null
    check (
      certificate_signer_key_id = pg_catalog.btrim(certificate_signer_key_id)
      and certificate_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    ),
  certificate_signature text not null unique
    check (certificate_signature ~ '^[A-Za-z0-9_-]{86}$'),
  signed_certificate jsonb not null
    check (
      pg_catalog.jsonb_typeof(signed_certificate) = 'object'
      and pg_catalog.pg_column_size(signed_certificate) <= 65536
    ),
  completed_at timestamptz not null default pg_catalog.clock_timestamp()
);

create trigger private_live_telebirr_device_certificates_immutable
before update or delete on app.private_live_telebirr_device_enrollment_certificates
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_telebirr_device_certificates_no_truncate
before truncate on app.private_live_telebirr_device_enrollment_certificates
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create table app.private_live_telebirr_device_command_replays (
  replay_identity text primary key
    check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  request_expires_at timestamptz not null,
  state text not null default 'claimed'
    check (state in ('claimed', 'completed')),
  claim_lease_expires_at timestamptz,
  response jsonb
    check (
      response is null
      or (
        pg_catalog.jsonb_typeof(response) = 'object'
        and pg_catalog.pg_column_size(response) <= 262144
      )
    ),
  claimed_at timestamptz not null,
  last_claimed_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_telebirr_device_replay_window_check check (
    request_expires_at > claimed_at
  ),
  constraint private_live_telebirr_device_replay_state_shape_check check (
    (state = 'claimed'
      and claim_lease_expires_at is not null
      and response is null
      and completed_at is null)
    or (state = 'completed'
      and claim_lease_expires_at is null
      and response is not null
      and completed_at is not null)
  )
);

create index private_live_telebirr_device_replays_expiry_idx
  on app.private_live_telebirr_device_command_replays (request_expires_at, replay_identity);
create index private_live_telebirr_device_replays_claim_expiry_idx
  on app.private_live_telebirr_device_command_replays (claim_lease_expires_at, replay_identity)
  where state = 'claimed';

create table app.private_live_telebirr_device_heartbeats (
  device_enrollment_id uuid primary key
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  last_request_body_digest text not null
    check (last_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  runtime_state text not null
    check (runtime_state in ('enrollment_required', 'ready', 'busy', 'upload_pending', 'attention')),
  status_code text not null
    check (
      status_code = pg_catalog.btrim(status_code)
      and status_code ~ '^[a-z][a-z0-9_]{2,63}$'
    ),
  app_version text not null
    check (
      app_version = pg_catalog.btrim(app_version)
      and app_version
        ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
    ),
  reported_at timestamptz not null,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_live_telebirr_device_heartbeat_time_check check (
    reported_at <= last_seen_at + interval '5 seconds'
  )
);

create index private_live_telebirr_device_heartbeats_seen_idx
  on app.private_live_telebirr_device_heartbeats (last_seen_at desc, device_enrollment_id);

create table app.private_live_telebirr_device_evidence_staging (
  observation_body_digest text primary key
    check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_body_digest text not null unique
    check (assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  verification_attempt_id uuid not null unique
    references app.private_live_telebirr_verification_attempts (id) on delete restrict,
  assignment_transcript_id uuid not null unique
    references app.private_live_telebirr_assignment_transcripts (id) on delete restrict,
  device_enrollment_id uuid not null
    references app.private_live_telebirr_device_enrollments (id) on delete restrict,
  first_request_body_digest text not null
    check (first_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_assignment jsonb not null
    check (
      pg_catalog.jsonb_typeof(signed_assignment) = 'object'
      and pg_catalog.pg_column_size(signed_assignment) <= 131072
    ),
  signed_observation jsonb not null
    check (
      pg_catalog.jsonb_typeof(signed_observation) = 'object'
      and pg_catalog.pg_column_size(signed_observation) <= 131072
    ),
  observed_at timestamptz not null,
  staged_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index private_live_telebirr_device_evidence_enrollment_idx
  on app.private_live_telebirr_device_evidence_staging (device_enrollment_id, staged_at);
create index private_live_telebirr_device_evidence_pending_idx
  on app.private_live_telebirr_device_evidence_staging (staged_at, observation_body_digest);

create trigger private_live_telebirr_device_evidence_immutable
before update or delete on app.private_live_telebirr_device_evidence_staging
for each row execute function app.reject_private_live_telebirr_lineage_mutation();

create trigger private_live_telebirr_device_evidence_no_truncate
before truncate on app.private_live_telebirr_device_evidence_staging
for each statement execute function app.reject_private_live_telebirr_lineage_truncate();

create function app.require_telebirr_device_state_session()
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
       and role.rolname = 'fetanagent_telebirr_device_state_runtime'
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
    raise exception 'The TeleBirr device-state session is not currently authorized.';
  end if;
end;
$$;

create function app.private_telebirr_device_timestamp(p_value timestamptz)
returns text
language sql
immutable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.to_char(
    pg_catalog.date_trunc('milliseconds', p_value) at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

create function app.private_telebirr_device_app_version_at_least(
  p_candidate text,
  p_minimum text
)
returns boolean
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  candidate_match text[];
  minimum_match text[];
  candidate_core integer[];
  minimum_core integer[];
begin
  candidate_match := pg_catalog.regexp_match(
    p_candidate,
    '^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
  );
  minimum_match := pg_catalog.regexp_match(
    p_minimum,
    '^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
  );
  if candidate_match is null or minimum_match is null then
    return false;
  end if;

  candidate_core := array[
    candidate_match[1]::integer,
    candidate_match[2]::integer,
    candidate_match[3]::integer
  ];
  minimum_core := array[
    minimum_match[1]::integer,
    minimum_match[2]::integer,
    minimum_match[3]::integer
  ];

  return p_candidate = p_minimum or candidate_core > minimum_core;
end;
$$;

create function app.private_telebirr_device_public_key_digest(p_public_key_spki text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  decoded_key bytea;
  digest_hex text;
  padding_length integer;
begin
  if p_public_key_spki is null
    or pg_catalog.length(p_public_key_spki) not between 1 and 684
    or p_public_key_spki !~ '^[A-Za-z0-9_-]+$' then
    return null;
  end if;

  padding_length := (4 - pg_catalog.length(p_public_key_spki) % 4) % 4;
  begin
    decoded_key := pg_catalog.decode(
      pg_catalog.translate(p_public_key_spki, '-_', '+/')
        || pg_catalog.repeat('=', padding_length),
      'base64'
    );
  exception when others then
    return null;
  end;

  if pg_catalog.rtrim(
       pg_catalog.translate(
         pg_catalog.replace(pg_catalog.encode(decoded_key, 'base64'), E'\n', ''),
         '+/',
         '-_'
       ),
       '='
     ) <> p_public_key_spki then
    return null;
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(extensions.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using decoded_key;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(public.digest($1, 'sha256'), 'hex')
    $digest$
      into digest_hex
      using decoded_key;
  else
    raise exception 'The TeleBirr device public-key digest is unavailable.';
  end if;

  if digest_hex !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  return 'sha256:' || digest_hex;
end;
$$;

create function app.issue_private_telebirr_device_pairing(
  p_actor_auth_user_id uuid,
  p_issue_request_key uuid,
  p_pairing_id uuid,
  p_pilot_revision_id uuid,
  p_receiver_profile_id uuid,
  p_assignment_signer_id uuid,
  p_pairing_nonce_digest text,
  p_minimum_app_version text,
  p_expires_at timestamptz
)
returns table (
  pairing_id uuid,
  pairing_nonce_digest text,
  expires_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  now_at timestamptz;
  request_digest text;
  existing_challenge app.private_live_telebirr_device_pairing_challenges%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_actor_auth_user_id is null
    or p_issue_request_key is null
    or p_issue_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_pairing_id is null
    or p_pairing_id::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_pilot_revision_id is null
    or p_receiver_profile_id is null
    or p_assignment_signer_id is null
    or p_pairing_nonce_digest is null
    or p_pairing_nonce_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_minimum_app_version is null
    or p_minimum_app_version
      !~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
    or p_expires_at is null
    or p_expires_at <= now_at + interval '30 seconds'
    or p_expires_at > now_at + interval '30 minutes' then
    raise exception 'The TeleBirr device pairing challenge request is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can issue a TeleBirr device pairing challenge.';
  end if;

  request_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:telebirr:device-pairing-issue:v1' || E'\n'
    || p_pairing_id::text || E'\n'
    || p_pilot_revision_id::text || E'\n'
    || p_receiver_profile_id::text || E'\n'
    || p_assignment_signer_id::text || E'\n'
    || p_pairing_nonce_digest || E'\n'
    || p_minimum_app_version || E'\n'
    || app.private_telebirr_device_timestamp(p_expires_at)
  );

  select challenge.*
    into existing_challenge
    from app.private_live_telebirr_device_pairing_challenges challenge
   where challenge.issue_request_key = p_issue_request_key
   for update;

  if existing_challenge.pairing_id is not null then
    if existing_challenge.issue_request_digest is distinct from request_digest then
      raise exception 'The TeleBirr device pairing challenge replay conflicts.';
    end if;
    return query
    select existing_challenge.pairing_id,
           existing_challenge.pairing_nonce_digest,
           existing_challenge.expires_at,
           true;
    return;
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for share;

  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = p_receiver_profile_id
   for share;

  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.id = p_assignment_signer_id
   for share;

  if pilot.id is null
    or profile.id is null
    or signer.id is null
    or pilot.status <> 'armed'
    or now_at < pilot.active_from
    or now_at >= pilot.expires_at
    or profile.pilot_revision_id is distinct from pilot.id
    or now_at < profile.valid_from
    or now_at >= profile.valid_until
    or now_at < signer.valid_from
    or now_at >= signer.valid_until
    or p_expires_at > pilot.expires_at
    or p_expires_at > profile.valid_until
    or p_expires_at > signer.valid_until
    or exists (
      select 1
        from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The TeleBirr device pairing challenge authority is unavailable.';
  end if;

  insert into app.private_live_telebirr_device_pairing_challenges (
    pairing_id,
    issue_request_key,
    issue_request_digest,
    pilot_revision_id,
    receiver_profile_id,
    assignment_signer_id,
    pairing_nonce_digest,
    minimum_app_version,
    valid_from,
    expires_at,
    created_by_admin_id,
    created_at,
    updated_at
  ) values (
    p_pairing_id,
    p_issue_request_key,
    request_digest,
    pilot.id,
    profile.id,
    signer.id,
    p_pairing_nonce_digest,
    p_minimum_app_version,
    now_at,
    pg_catalog.date_trunc('milliseconds', p_expires_at),
    actor_admin_id,
    now_at,
    now_at
  );

  return query
  select p_pairing_id,
         p_pairing_nonce_digest,
         pg_catalog.date_trunc('milliseconds', p_expires_at),
         false;
end;
$$;

create function app.claim_private_telebirr_device_pairing(
  p_pairing_id uuid,
  p_pairing_nonce_digest text,
  p_pairing_request_body_digest text,
  p_device_id text,
  p_device_key_id text,
  p_device_public_key_spki text,
  p_device_public_key_spki_sha256 text,
  p_app_version text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz
)
returns table (
  claim_state text,
  certificate_body jsonb,
  signed_certificate jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  challenge app.private_live_telebirr_device_pairing_challenges%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  certificate app.private_live_telebirr_device_enrollment_certificates%rowtype;
  generated_enrollment_id uuid;
  generated_certificate_body jsonb;
  valid_until timestamptz;
begin
  perform app.require_telebirr_device_state_session();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_pairing_id is null
    or p_pairing_nonce_digest is null
    or p_pairing_nonce_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_pairing_request_body_digest is null
    or p_pairing_request_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_device_id is null
    or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id is null
    or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_public_key_spki is null
    or pg_catalog.length(p_device_public_key_spki) not between 1 and 684
    or p_device_public_key_spki !~ '^[A-Za-z0-9_-]+$'
    or p_device_public_key_spki_sha256 is null
    or p_device_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$'
    or app.private_telebirr_device_public_key_digest(p_device_public_key_spki)
      is distinct from p_device_public_key_spki_sha256
    or p_app_version is null
    or p_app_version
      !~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
    or p_request_issued_at is null
    or p_request_expires_at is null
    or p_request_expires_at <= p_request_issued_at
    or p_request_expires_at > p_request_issued_at + interval '10 minutes' then
    return;
  end if;

  select pairing_challenge.*
    into challenge
    from app.private_live_telebirr_device_pairing_challenges pairing_challenge
   where pairing_challenge.pairing_id = p_pairing_id
     and pairing_challenge.pairing_nonce_digest = p_pairing_nonce_digest
   for update;
  if challenge.pairing_id is null then
    return;
  end if;

  if challenge.state <> 'open'
    and (
      challenge.pairing_request_body_digest is distinct from p_pairing_request_body_digest
      or challenge.device_id is distinct from p_device_id
      or challenge.device_key_id is distinct from p_device_key_id
      or challenge.device_public_key_spki is distinct from p_device_public_key_spki
      or challenge.device_public_key_spki_sha256
           is distinct from p_device_public_key_spki_sha256
      or challenge.device_app_version is distinct from p_app_version
      or challenge.pairing_request_issued_at
           is distinct from pg_catalog.date_trunc('milliseconds', p_request_issued_at)
      or challenge.pairing_request_expires_at
           is distinct from pg_catalog.date_trunc('milliseconds', p_request_expires_at)
    ) then
    return;
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = challenge.pilot_revision_id
   for share;
  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = challenge.receiver_profile_id
   for share;
  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.id = challenge.assignment_signer_id
   for share;

  if challenge.state = 'completed' then
    select enrollment_row.*
      into enrollment
      from app.private_live_telebirr_device_enrollments enrollment_row
     where enrollment_row.id = challenge.reserved_enrollment_id
     for share;
    select certificate_row.*
      into certificate
      from app.private_live_telebirr_device_enrollment_certificates certificate_row
     where certificate_row.device_enrollment_id = challenge.reserved_enrollment_id;

    if enrollment.id is null
      or certificate.device_enrollment_id is null
      or pilot.id is null
      or profile.id is null
      or signer.id is null
      or pilot.status <> 'armed'
      or now_at < enrollment.valid_from
      or now_at >= enrollment.valid_until
      or now_at >= pilot.expires_at
      or now_at >= profile.valid_until
      or now_at >= signer.valid_until
      or exists (
        select 1
          from app.private_live_telebirr_device_revocations revocation
         where revocation.device_enrollment_id = enrollment.id
           and revocation.revoked_at <= now_at
      )
      or exists (
        select 1
          from app.private_live_telebirr_assignment_signer_revocations revocation
         where revocation.assignment_signer_id = signer.id
           and revocation.revoked_at <= now_at
      ) then
      return;
    end if;

    return query
    select 'completed'::text, challenge.certificate_body, certificate.signed_certificate;
    return;
  end if;

  if challenge.expires_at <= now_at
    or now_at < challenge.valid_from
    or p_request_issued_at > now_at
    or p_request_expires_at <= now_at
    or p_request_expires_at > challenge.expires_at
    or pilot.id is null
    or profile.id is null
    or signer.id is null
    or pilot.status <> 'armed'
    or now_at < pilot.active_from
    or now_at >= pilot.expires_at
    or profile.pilot_revision_id is distinct from pilot.id
    or now_at < profile.valid_from
    or now_at >= profile.valid_until
    or now_at < signer.valid_from
    or now_at >= signer.valid_until
    or not app.private_telebirr_device_app_version_at_least(
      p_app_version,
      challenge.minimum_app_version
    )
    or exists (
      select 1
        from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    return;
  end if;

  if challenge.state = 'claimed'
    and challenge.claim_lease_expires_at > now_at then
    return query
    select 'in_progress'::text, null::jsonb, null::jsonb;
    return;
  end if;

  if challenge.state = 'open' then
    if exists (
      select 1
        from app.private_live_telebirr_device_enrollments existing_enrollment
       where existing_enrollment.pilot_revision_id = pilot.id
         and (
           (existing_enrollment.device_id = p_device_id
             and existing_enrollment.key_id = p_device_key_id)
           or existing_enrollment.public_key_spki_sha256 = p_device_public_key_spki_sha256
         )
    ) then
      return;
    end if;

    generated_enrollment_id := pg_catalog.gen_random_uuid();
    valid_until := pg_catalog.date_trunc(
      'milliseconds',
      least(pilot.expires_at, profile.valid_until, signer.valid_until)
    );
    if valid_until <= now_at + interval '30 seconds' then
      return;
    end if;

    generated_certificate_body := pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'providerCode', 'telebirr',
      'protocolMode', 'device_bridge_no_money_v1',
      'enrollmentId', generated_enrollment_id::text,
      'pairingId', challenge.pairing_id::text,
      'pairingRequestBodyDigest', p_pairing_request_body_digest,
      'pairingNonceDigest', challenge.pairing_nonce_digest,
      'pairingConsumed', true,
      'deviceId', p_device_id,
      'keyId', p_device_key_id,
      'devicePublicKeySpki', p_device_public_key_spki,
      'devicePublicKeySpkiSha256', p_device_public_key_spki_sha256,
      'signatureAlgorithm', 'ecdsa-p256-sha256',
      'devicePlatform', 'android',
      'minimumAppVersion', challenge.minimum_app_version,
      'pilotRevisionId', pilot.id::text,
      'receiverRevisionId', profile.receiver_account_id::text,
      'receiverProfileId', profile.id::text,
      'receiverProfileDigest', profile.receiver_profile_digest,
      'receiverConfigurationDigest', profile.receiver_configuration_digest,
      'assignmentSignerKeyId', signer.signer_key_id,
      'assignmentSignerPublicKeySpkiSha256', signer.public_key_spki_sha256,
      'state', 'active',
      'issuedAt', app.private_telebirr_device_timestamp(now_at),
      'validFrom', app.private_telebirr_device_timestamp(now_at),
      'validUntil', app.private_telebirr_device_timestamp(valid_until),
      'evidenceOnly', true,
      'databaseAccessAllowed', false,
      'claimAllowed', false,
      'settlementAllowed', false,
      'enqueueAllowed', false,
      'executionAllowed', false,
      'financialActionAllowed', false,
      'moneyMovementAllowed', false,
      'rawReceiptUploadAllowed', false,
      'sensitiveLoggingAllowed', false
    );

    update app.private_live_telebirr_device_pairing_challenges pairing_challenge
       set state = 'claimed',
           pairing_request_body_digest = p_pairing_request_body_digest,
           reserved_enrollment_id = generated_enrollment_id,
           device_id = p_device_id,
           device_key_id = p_device_key_id,
           device_public_key_spki = p_device_public_key_spki,
           device_public_key_spki_sha256 = p_device_public_key_spki_sha256,
           device_app_version = p_app_version,
           pairing_request_issued_at = pg_catalog.date_trunc(
             'milliseconds', p_request_issued_at
           ),
           pairing_request_expires_at = pg_catalog.date_trunc(
             'milliseconds', p_request_expires_at
           ),
           certificate_issued_at = now_at,
           certificate_valid_from = now_at,
           certificate_valid_until = valid_until,
           certificate_body = generated_certificate_body,
           first_claimed_at = now_at,
           last_claimed_at = now_at,
           claim_lease_expires_at = least(
             pg_catalog.date_trunc('milliseconds', p_request_expires_at),
             now_at + interval '30 seconds'
           ),
           updated_at = now_at
     where pairing_challenge.pairing_id = challenge.pairing_id;

    return query
    select 'claimed'::text, generated_certificate_body, null::jsonb;
    return;
  end if;

  update app.private_live_telebirr_device_pairing_challenges pairing_challenge
     set state = 'claimed',
         last_claimed_at = now_at,
         claim_lease_expires_at = least(
           challenge.pairing_request_expires_at,
           now_at + interval '30 seconds'
         ),
         updated_at = now_at
   where pairing_challenge.pairing_id = challenge.pairing_id;

  return query
  select 'claimed'::text, challenge.certificate_body, null::jsonb;
end;
$$;

create function app.complete_private_telebirr_device_pairing(
  p_pairing_request_body_digest text,
  p_certificate_body_digest text,
  p_certificate_signer_key_id text,
  p_certificate_signature text,
  p_signed_certificate jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  challenge app.private_live_telebirr_device_pairing_challenges%rowtype;
  existing_certificate app.private_live_telebirr_device_enrollment_certificates%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  signer app.private_live_telebirr_assignment_signers%rowtype;
begin
  perform app.require_telebirr_device_state_session();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_pairing_request_body_digest is null
    or p_pairing_request_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_certificate_body_digest is null
    or p_certificate_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_certificate_signer_key_id is null
    or p_certificate_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_certificate_signature is null
    or p_certificate_signature !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_certificate is null
    or pg_catalog.jsonb_typeof(p_signed_certificate) <> 'object'
    or pg_catalog.pg_column_size(p_signed_certificate) > 65536 then
    return false;
  end if;

  select pairing_challenge.*
    into challenge
    from app.private_live_telebirr_device_pairing_challenges pairing_challenge
   where pairing_challenge.pairing_request_body_digest = p_pairing_request_body_digest
   for update;
  if challenge.pairing_id is null then
    return false;
  end if;

  if challenge.state = 'completed' then
    select certificate.*
      into existing_certificate
      from app.private_live_telebirr_device_enrollment_certificates certificate
     where certificate.device_enrollment_id = challenge.reserved_enrollment_id;
    return existing_certificate.device_enrollment_id is not null
      and existing_certificate.certificate_body_digest = p_certificate_body_digest
      and existing_certificate.certificate_signer_key_id = p_certificate_signer_key_id
      and existing_certificate.certificate_signature = p_certificate_signature
      and existing_certificate.signed_certificate = p_signed_certificate;
  end if;

  if challenge.state not in ('claimed', 'bound')
    or challenge.certificate_valid_until <= now_at
    or p_signed_certificate ->> 'contractVersion' <> '1'
    or p_signed_certificate ->> 'providerCode' <> 'telebirr'
    or p_signed_certificate ->> 'protocolMode' <> 'device_bridge_no_money_v1'
    or p_signed_certificate ->> 'transcriptVersion'
      <> 'telebirr-device-bridge-certificate-transcript-v1'
    or p_signed_certificate ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_certificate ->> 'bodyDigest' <> p_certificate_body_digest
    or p_signed_certificate ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_certificate ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_certificate ->> 'signerKeyId' <> p_certificate_signer_key_id
    or p_signed_certificate ->> 'signature' <> p_certificate_signature
    or p_signed_certificate -> 'body' is distinct from challenge.certificate_body then
    return false;
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = challenge.pilot_revision_id
   for share;
  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = challenge.receiver_profile_id
   for share;
  select assignment_signer.*
    into signer
    from app.private_live_telebirr_assignment_signers assignment_signer
   where assignment_signer.id = challenge.assignment_signer_id
   for share;

  if pilot.id is null
    or profile.id is null
    or signer.id is null
    or pilot.status <> 'armed'
    or now_at < pilot.active_from
    or now_at >= pilot.expires_at
    or profile.pilot_revision_id is distinct from pilot.id
    or now_at < profile.valid_from
    or now_at >= profile.valid_until
    or now_at < signer.valid_from
    or now_at >= signer.valid_until
    or exists (
      select 1
        from app.private_live_telebirr_assignment_signer_revocations revocation
       where revocation.assignment_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    return false;
  end if;

  insert into app.private_live_telebirr_device_enrollments (
    id,
    pilot_revision_id,
    receiver_profile_id,
    device_id,
    key_id,
    public_key_spki_sha256,
    valid_from,
    valid_until
  ) values (
    challenge.reserved_enrollment_id,
    challenge.pilot_revision_id,
    challenge.receiver_profile_id,
    challenge.device_id,
    challenge.device_key_id,
    challenge.device_public_key_spki_sha256,
    challenge.certificate_valid_from,
    challenge.certificate_valid_until
  );

  insert into app.private_live_telebirr_device_enrollment_certificates (
    device_enrollment_id,
    pairing_id,
    pairing_request_body_digest,
    certificate_body_digest,
    certificate_signer_key_id,
    certificate_signature,
    signed_certificate,
    completed_at
  ) values (
    challenge.reserved_enrollment_id,
    challenge.pairing_id,
    challenge.pairing_request_body_digest,
    p_certificate_body_digest,
    p_certificate_signer_key_id,
    p_certificate_signature,
    p_signed_certificate,
    now_at
  );

  update app.private_live_telebirr_device_pairing_challenges pairing_challenge
     set state = 'completed',
         claim_lease_expires_at = null,
         completed_at = now_at,
         updated_at = now_at
   where pairing_challenge.pairing_id = challenge.pairing_id;

  return true;
end;
$$;

create function app.release_private_telebirr_device_pairing(
  p_pairing_request_body_digest text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform app.require_telebirr_device_state_session();

  if p_pairing_request_body_digest is null
    or p_pairing_request_body_digest !~ '^sha256:[0-9a-f]{64}$' then
    return;
  end if;

  update app.private_live_telebirr_device_pairing_challenges pairing_challenge
     set state = 'bound',
         claim_lease_expires_at = null,
         updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
   where pairing_challenge.pairing_request_body_digest = p_pairing_request_body_digest
     and pairing_challenge.state = 'claimed';
end;
$$;

create function app.load_private_telebirr_device_enrollment(
  p_device_enrollment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  signed_certificate jsonb;
begin
  perform app.require_telebirr_device_state_session();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  select certificate.signed_certificate
    into signed_certificate
    from app.private_live_telebirr_device_enrollment_certificates certificate
    join app.private_live_telebirr_device_pairing_challenges challenge
      on challenge.pairing_id = certificate.pairing_id
     and challenge.state = 'completed'
    join app.private_live_telebirr_device_enrollments enrollment
      on enrollment.id = certificate.device_enrollment_id
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = enrollment.pilot_revision_id
    join app.private_live_telebirr_receiver_profiles profile
      on profile.id = enrollment.receiver_profile_id
    join app.private_live_telebirr_assignment_signers signer
      on signer.id = challenge.assignment_signer_id
   where certificate.device_enrollment_id = p_device_enrollment_id
     and pilot.status = 'armed'
     and now_at >= pilot.active_from
     and now_at < pilot.expires_at
     and now_at >= enrollment.valid_from
     and now_at < enrollment.valid_until
     and now_at >= profile.valid_from
     and now_at < profile.valid_until
     and now_at >= signer.valid_from
     and now_at < signer.valid_until
     and not exists (
       select 1
         from app.private_live_telebirr_device_revocations revocation
        where revocation.device_enrollment_id = enrollment.id
          and revocation.revoked_at <= now_at
     )
     and not exists (
       select 1
         from app.private_live_telebirr_assignment_signer_revocations revocation
        where revocation.assignment_signer_id = signer.id
          and revocation.revoked_at <= now_at
     );

  return signed_certificate;
end;
$$;

create function app.claim_private_telebirr_device_replay(
  p_replay_identity text,
  p_request_expires_at timestamptz
)
returns table (
  claim_state text,
  response jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  replay app.private_live_telebirr_device_command_replays%rowtype;
begin
  perform app.require_telebirr_device_state_session();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_request_expires_at is null
    or p_request_expires_at <= now_at
    or p_request_expires_at > now_at + interval '2 minutes 5 seconds' then
    raise exception 'The TeleBirr device replay claim is invalid.';
  end if;

  select command_replay.*
    into replay
    from app.private_live_telebirr_device_command_replays command_replay
   where command_replay.replay_identity = p_replay_identity
   for update;

  if replay.replay_identity is null then
    insert into app.private_live_telebirr_device_command_replays (
      replay_identity,
      request_expires_at,
      state,
      claim_lease_expires_at,
      claimed_at,
      last_claimed_at,
      updated_at
    ) values (
      p_replay_identity,
      pg_catalog.date_trunc('milliseconds', p_request_expires_at),
      'claimed',
      least(
        pg_catalog.date_trunc('milliseconds', p_request_expires_at),
        now_at + interval '30 seconds'
      ),
      now_at,
      now_at,
      now_at
    );
    return query select 'claimed'::text, null::jsonb;
    return;
  end if;

  if replay.request_expires_at
      is distinct from pg_catalog.date_trunc('milliseconds', p_request_expires_at) then
    raise exception 'The TeleBirr device replay claim conflicts.';
  end if;

  if replay.state = 'completed' then
    return query select 'completed'::text, replay.response;
    return;
  end if;

  if replay.claim_lease_expires_at > now_at then
    return query select 'in_progress'::text, null::jsonb;
    return;
  end if;

  update app.private_live_telebirr_device_command_replays command_replay
     set claim_lease_expires_at = least(
           replay.request_expires_at,
           now_at + interval '30 seconds'
         ),
         last_claimed_at = now_at,
         updated_at = now_at
   where command_replay.replay_identity = replay.replay_identity;
  return query select 'claimed'::text, null::jsonb;
end;
$$;

create function app.complete_private_telebirr_device_replay(
  p_replay_identity text,
  p_response jsonb,
  p_request_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  replay app.private_live_telebirr_device_command_replays%rowtype;
  response_key_count integer;
begin
  perform app.require_telebirr_device_state_session();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_request_expires_at is null
    or p_response is null
    or pg_catalog.jsonb_typeof(p_response) <> 'object'
    or pg_catalog.pg_column_size(p_response) > 262144 then
    return false;
  end if;

  select pg_catalog.count(*)::integer
    into response_key_count
    from pg_catalog.jsonb_object_keys(p_response);
  if response_key_count <> 2
    or not p_response ? 'acknowledgement'
    or not p_response ? 'assignment'
    or pg_catalog.jsonb_typeof(p_response -> 'acknowledgement') <> 'object'
    or (
      p_response -> 'assignment' <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_response -> 'assignment') <> 'object'
    ) then
    return false;
  end if;

  select command_replay.*
    into replay
    from app.private_live_telebirr_device_command_replays command_replay
   where command_replay.replay_identity = p_replay_identity
   for update;
  if replay.replay_identity is null
    or replay.request_expires_at
      is distinct from pg_catalog.date_trunc('milliseconds', p_request_expires_at) then
    return false;
  end if;

  if replay.state = 'completed' then
    return replay.response = p_response;
  end if;
  if now_at >= replay.request_expires_at then
    return false;
  end if;

  update app.private_live_telebirr_device_command_replays command_replay
     set state = 'completed',
         claim_lease_expires_at = null,
         response = p_response,
         completed_at = now_at,
         updated_at = now_at
   where command_replay.replay_identity = replay.replay_identity;
  return true;
end;
$$;

create function app.release_private_telebirr_device_replay(
  p_replay_identity text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform app.require_telebirr_device_state_session();
  if p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$' then
    return;
  end if;

  delete from app.private_live_telebirr_device_command_replays command_replay
   where command_replay.replay_identity = p_replay_identity
     and command_replay.state = 'claimed';
end;
$$;

create function app.record_private_telebirr_device_heartbeat(
  p_device_enrollment_id uuid,
  p_request_body_digest text,
  p_runtime_state text,
  p_status_code text,
  p_app_version text,
  p_reported_at timestamptz
)
returns table (
  outcome text,
  reason_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  now_at timestamptz;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  minimum_app_version text;
begin
  perform app.require_telebirr_device_state_session();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_device_enrollment_id is null
    or p_request_body_digest is null
    or p_request_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_runtime_state not in (
      'enrollment_required', 'ready', 'busy', 'upload_pending', 'attention'
    )
    or p_status_code is null
    or p_status_code !~ '^[a-z][a-z0-9_]{2,63}$'
    or p_app_version is null
    or p_app_version
      !~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
    or p_reported_at is null
    or p_reported_at > now_at + interval '5 seconds' then
    return query select 'retry'::text, null::text;
    return;
  end if;

  select enrollment_row.*
    into enrollment
    from app.private_live_telebirr_device_enrollments enrollment_row
   where enrollment_row.id = p_device_enrollment_id
   for share;
  if enrollment.id is null then
    return query select 'rejected'::text, 'device_revoked'::text;
    return;
  end if;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = enrollment.pilot_revision_id
   for share;
  select challenge.minimum_app_version
    into minimum_app_version
    from app.private_live_telebirr_device_enrollment_certificates certificate
    join app.private_live_telebirr_device_pairing_challenges challenge
      on challenge.pairing_id = certificate.pairing_id
   where certificate.device_enrollment_id = enrollment.id;

  if pilot.id is null
    or pilot.status <> 'armed'
    or now_at < pilot.active_from
    or now_at >= pilot.expires_at then
    return query select 'rejected'::text, 'pilot_stopped'::text;
    return;
  end if;
  if now_at < enrollment.valid_from
    or now_at >= enrollment.valid_until
    or minimum_app_version is null
    or not app.private_telebirr_device_app_version_at_least(
      p_app_version,
      minimum_app_version
    )
    or p_reported_at < enrollment.valid_from
    or exists (
      select 1
        from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    ) then
    return query select 'rejected'::text, 'device_revoked'::text;
    return;
  end if;

  insert into app.private_live_telebirr_device_heartbeats (
    device_enrollment_id,
    last_request_body_digest,
    runtime_state,
    status_code,
    app_version,
    reported_at,
    last_seen_at,
    updated_at
  ) values (
    enrollment.id,
    p_request_body_digest,
    p_runtime_state,
    p_status_code,
    p_app_version,
    pg_catalog.date_trunc('milliseconds', p_reported_at),
    now_at,
    now_at
  )
  on conflict (device_enrollment_id) do update
    set last_request_body_digest = excluded.last_request_body_digest,
        runtime_state = excluded.runtime_state,
        status_code = excluded.status_code,
        app_version = excluded.app_version,
        reported_at = excluded.reported_at,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    where excluded.reported_at
      >= app.private_live_telebirr_device_heartbeats.reported_at;

  return query select 'accepted'::text, null::text;
end;
$$;

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
  now_at timestamptz;
  observed_at timestamptz;
  transcript app.private_live_telebirr_assignment_transcripts%rowtype;
  delivery app.private_live_telebirr_assignment_deliveries%rowtype;
  attempt app.private_live_telebirr_verification_attempts%rowtype;
  job app.private_live_telebirr_verification_jobs%rowtype;
  enrollment app.private_live_telebirr_device_enrollments%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  profile app.private_live_telebirr_receiver_profiles%rowtype;
  existing_stage app.private_live_telebirr_device_evidence_staging%rowtype;
  assignment_body jsonb;
  observation_body jsonb;
begin
  perform app.require_telebirr_device_state_session();

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
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
      'milliseconds',
      (observation_body ->> 'observedAt')::timestamptz
    );
  exception when others then
    return query select 'rejected'::text, 'observation_rejected'::text, false;
    return;
  end;

  select assignment_transcript.*
    into transcript
    from app.private_live_telebirr_assignment_transcripts assignment_transcript
   where assignment_transcript.assignment_body_digest = p_assignment_body_digest
   for share;
  if transcript.id is null then
    return query select 'rejected'::text, 'binding_mismatch'::text, false;
    return;
  end if;

  select verification_attempt.*
    into attempt
    from app.private_live_telebirr_verification_attempts verification_attempt
   where verification_attempt.id = transcript.verification_attempt_id
   for update;
  select assignment_delivery.*
    into delivery
    from app.private_live_telebirr_assignment_deliveries assignment_delivery
   where assignment_delivery.assignment_transcript_id = transcript.id;
  select verification_job.*
    into job
    from app.private_live_telebirr_verification_jobs verification_job
   where verification_job.id = attempt.verification_job_id
   for share;
  select enrollment_row.*
    into enrollment
    from app.private_live_telebirr_device_enrollments enrollment_row
   where enrollment_row.id = p_device_enrollment_id
   for share;
  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = job.pilot_revision_id
   for share;
  select receiver_profile.*
    into profile
    from app.private_live_telebirr_receiver_profiles receiver_profile
   where receiver_profile.id = job.receiver_profile_id
   for share;

  if attempt.id is null
    or delivery.verification_attempt_id is null
    or job.id is null
    or enrollment.id is null
    or pilot.id is null
    or profile.id is null
    or attempt.device_enrollment_id is distinct from enrollment.id
    or transcript.verification_attempt_id is distinct from attempt.id
    or delivery.verification_attempt_id is distinct from attempt.id
    or pilot.status <> 'armed'
    or now_at < pilot.active_from
    or now_at >= pilot.expires_at
    or now_at < enrollment.valid_from
    or now_at >= enrollment.valid_until
    or now_at >= attempt.expires_at
    or observed_at < attempt.issued_at
    or observed_at >= attempt.expires_at
    or exists (
      select 1
        from app.private_live_telebirr_device_revocations revocation
       where revocation.device_enrollment_id = enrollment.id
         and revocation.revoked_at <= now_at
    ) then
    return query
    select 'rejected'::text,
           case
             when pilot.id is null or pilot.status <> 'armed' or now_at >= pilot.expires_at
               then 'pilot_stopped'::text
             when enrollment.id is null
               or now_at < enrollment.valid_from
               or now_at >= enrollment.valid_until
               or exists (
                 select 1
                   from app.private_live_telebirr_device_revocations revocation
                  where revocation.device_enrollment_id = enrollment.id
                    and revocation.revoked_at <= now_at
               ) then 'device_revoked'::text
             else 'binding_mismatch'::text
           end,
           false;
    return;
  end if;

  if p_signed_assignment ->> 'signerKeyId'
      is distinct from transcript.signer_key_id_snapshot
    or p_signed_assignment ->> 'signature'
      is distinct from delivery.assignment_signature
    or assignment_body ->> 'assignmentId' is distinct from attempt.assignment_id::text
    or assignment_body ->> 'requestId' is distinct from attempt.request_id::text
    or assignment_body ->> 'jobId' is distinct from job.id::text
    or assignment_body ->> 'attemptNumber' is distinct from attempt.attempt_number::text
    or assignment_body ->> 'pilotRevisionId' is distinct from job.pilot_revision_id::text
    or assignment_body ->> 'deviceId' is distinct from enrollment.device_id
    or assignment_body ->> 'keyId' is distinct from enrollment.key_id
    or assignment_body ->> 'leaseNonceDigest' is distinct from attempt.lease_nonce_digest
    or assignment_body ->> 'challengeId' is distinct from attempt.challenge_id::text
    or assignment_body ->> 'challengeDigest' is distinct from attempt.challenge_digest
    or assignment_body ->> 'referenceFingerprint'
      is distinct from job.candidate_reference_fingerprint
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
    or observation_body ->> 'jobId' is distinct from job.id::text
    or observation_body ->> 'attemptNumber' is distinct from attempt.attempt_number::text
    or observation_body ->> 'pilotRevisionId' is distinct from job.pilot_revision_id::text
    or observation_body ->> 'deviceId' is distinct from enrollment.device_id
    or observation_body ->> 'keyId' is distinct from enrollment.key_id
    or observation_body ->> 'leaseNonceDigest' is distinct from attempt.lease_nonce_digest
    or observation_body ->> 'challengeId' is distinct from attempt.challenge_id::text
    or observation_body ->> 'challengeDigest' is distinct from attempt.challenge_digest
    or observation_body ->> 'referenceFingerprint'
      is distinct from job.candidate_reference_fingerprint
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

  select staged.*
    into existing_stage
    from app.private_live_telebirr_device_evidence_staging staged
   where staged.observation_body_digest = p_observation_body_digest
      or staged.verification_attempt_id = attempt.id;

  if existing_stage.observation_body_digest is not null then
    if existing_stage.observation_body_digest = p_observation_body_digest
      and existing_stage.assignment_body_digest = p_assignment_body_digest
      and existing_stage.device_enrollment_id = enrollment.id
      and existing_stage.signed_assignment = p_signed_assignment
      and existing_stage.signed_observation = p_signed_observation then
      return query select 'accepted'::text, null::text, true;
    else
      return query select 'rejected'::text, 'binding_mismatch'::text, false;
    end if;
    return;
  end if;

  insert into app.private_live_telebirr_device_evidence_staging (
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

alter table app.private_live_telebirr_device_pairing_challenges enable row level security;
alter table app.private_live_telebirr_device_pairing_challenges force row level security;
alter table app.private_live_telebirr_device_enrollment_certificates enable row level security;
alter table app.private_live_telebirr_device_enrollment_certificates force row level security;
alter table app.private_live_telebirr_device_command_replays enable row level security;
alter table app.private_live_telebirr_device_command_replays force row level security;
alter table app.private_live_telebirr_device_heartbeats enable row level security;
alter table app.private_live_telebirr_device_heartbeats force row level security;
alter table app.private_live_telebirr_device_evidence_staging enable row level security;
alter table app.private_live_telebirr_device_evidence_staging force row level security;

alter table app.private_live_telebirr_device_pairing_challenges owner to postgres;
alter table app.private_live_telebirr_device_enrollment_certificates owner to postgres;
alter table app.private_live_telebirr_device_command_replays owner to postgres;
alter table app.private_live_telebirr_device_heartbeats owner to postgres;
alter table app.private_live_telebirr_device_evidence_staging owner to postgres;

alter function app.require_telebirr_device_state_session() owner to postgres;
alter function app.private_telebirr_device_timestamp(timestamptz) owner to postgres;
alter function app.private_telebirr_device_app_version_at_least(text, text) owner to postgres;
alter function app.private_telebirr_device_public_key_digest(text) owner to postgres;
alter function app.issue_private_telebirr_device_pairing(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz
) owner to postgres;
alter function app.claim_private_telebirr_device_pairing(
  uuid, text, text, text, text, text, text, text, timestamptz, timestamptz
) owner to postgres;
alter function app.complete_private_telebirr_device_pairing(
  text, text, text, text, jsonb
) owner to postgres;
alter function app.release_private_telebirr_device_pairing(text) owner to postgres;
alter function app.load_private_telebirr_device_enrollment(uuid) owner to postgres;
alter function app.claim_private_telebirr_device_replay(text, timestamptz) owner to postgres;
alter function app.complete_private_telebirr_device_replay(text, jsonb, timestamptz)
  owner to postgres;
alter function app.release_private_telebirr_device_replay(text) owner to postgres;
alter function app.record_private_telebirr_device_heartbeat(
  uuid, text, text, text, text, timestamptz
) owner to postgres;
alter function app.stage_private_telebirr_device_evidence(
  uuid, text, text, text, jsonb, jsonb
) owner to postgres;

revoke all privileges on table
  app.private_live_telebirr_device_pairing_challenges,
  app.private_live_telebirr_device_enrollment_certificates,
  app.private_live_telebirr_device_command_replays,
  app.private_live_telebirr_device_heartbeats,
  app.private_live_telebirr_device_evidence_staging
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
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;

revoke all on function
  app.require_telebirr_device_state_session(),
  app.private_telebirr_device_timestamp(timestamptz),
  app.private_telebirr_device_app_version_at_least(text, text),
  app.private_telebirr_device_public_key_digest(text),
  app.issue_private_telebirr_device_pairing(
    uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz
  ),
  app.claim_private_telebirr_device_pairing(
    uuid, text, text, text, text, text, text, text, timestamptz, timestamptz
  ),
  app.complete_private_telebirr_device_pairing(text, text, text, text, jsonb),
  app.release_private_telebirr_device_pairing(text),
  app.load_private_telebirr_device_enrollment(uuid),
  app.claim_private_telebirr_device_replay(text, timestamptz),
  app.complete_private_telebirr_device_replay(text, jsonb, timestamptz),
  app.release_private_telebirr_device_replay(text),
  app.record_private_telebirr_device_heartbeat(
    uuid, text, text, text, text, timestamptz
  ),
  app.stage_private_telebirr_device_evidence(uuid, text, text, text, jsonb, jsonb)
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
     fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;

do $$
begin
  execute format(
    'revoke all privileges on database %I from fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime',
    current_database()
  );
end;
$$;

revoke all privileges on schema app
from fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;
revoke all privileges on all tables in schema app
from fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;
revoke all privileges on all sequences in schema app
from fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;
revoke all privileges on all functions in schema app
from fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;
revoke all privileges on all procedures in schema app
from fetanagent_telebirr_device_state,
     fetanagent_telebirr_device_state_runtime;

grant usage on schema app to fetanagent_telebirr_device_state;
grant execute on function
  app.claim_private_telebirr_device_pairing(
    uuid, text, text, text, text, text, text, text, timestamptz, timestamptz
  ),
  app.complete_private_telebirr_device_pairing(text, text, text, text, jsonb),
  app.release_private_telebirr_device_pairing(text),
  app.load_private_telebirr_device_enrollment(uuid),
  app.claim_private_telebirr_device_replay(text, timestamptz),
  app.complete_private_telebirr_device_replay(text, jsonb, timestamptz),
  app.release_private_telebirr_device_replay(text),
  app.record_private_telebirr_device_heartbeat(
    uuid, text, text, text, text, timestamptz
  ),
  app.stage_private_telebirr_device_evidence(uuid, text, text, text, jsonb, jsonb)
to fetanagent_telebirr_device_state;

grant execute on function app.issue_private_telebirr_device_pairing(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz
) to fetanagent_owner_control;

comment on table app.private_live_telebirr_device_pairing_challenges is
  'One-use Owner-issued TeleBirr Android pairing state. Stores only the nonce digest, never the raw pairing secret, and binds the first verified request permanently.';
comment on table app.private_live_telebirr_device_enrollment_certificates is
  'Append-only exact signed public enrollment certificates for response-loss recovery. Contains no private key, raw pairing secret, claim, settlement, execution, or money authority.';
comment on table app.private_live_telebirr_device_command_replays is
  'Bounded exact command-response replay state for authenticated Android requests. Runtime access is only through guarded claim, complete, and release routines.';
comment on table app.private_live_telebirr_device_heartbeats is
  'One redacted current health snapshot per enrolled Android device; no receipt, reference, receiver name, key, credential, or financial data.';
comment on table app.private_live_telebirr_device_evidence_staging is
  'Append-only signed assignment and redacted observation staging for the future isolated verifier. It is evidence-only and cannot claim, settle, enqueue, execute, or move money.';
comment on function app.issue_private_telebirr_device_pairing(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz
) is
  'Authenticated Owner-only idempotent challenge issuance. The caller shows the raw nonce once; PostgreSQL receives and stores only its SHA-256 digest.';
comment on function app.claim_private_telebirr_device_pairing(
  uuid, text, text, text, text, text, text, text, timestamptz, timestamptz
) is
  'Operation-time guarded one-use pairing claim. The first verified request is permanently bound; exact retries recover the same body or completed certificate.';
comment on function app.complete_private_telebirr_device_pairing(
  text, text, text, text, jsonb
) is
  'Operation-time guarded atomic enrollment and certificate completion. An uncertain acknowledgement is recoverable by exact pairing replay.';
comment on function app.load_private_telebirr_device_enrollment(uuid) is
  'Returns one exact active signed certificate only while its pilot, receiver, signer, enrollment, and revocation state remain valid.';
comment on function app.stage_private_telebirr_device_evidence(
  uuid, text, text, text, jsonb, jsonb
) is
  'Stages one database-bound signed assignment/observation pair idempotently by observation digest. It performs no verifier completion or financial transition.';
comment on function app.require_telebirr_device_state_session() is
  'Owner-only server-time guard requiring the exact bounded device-state runtime login on every operational call; postgres is the explicit migration-owner maintenance bypass.';
comment on function app.private_telebirr_device_public_key_digest(text) is
  'Owner-only canonical base64url decoder and SHA-256 helper used to rebind a verified Android public key to its claimed digest inside PostgreSQL.';
comment on role fetanagent_telebirr_device_state is
  'Private TeleBirr device-state group. NOLOGIN; may execute only guarded pairing, certificate, replay, heartbeat, and evidence-staging routines.';
comment on role fetanagent_telebirr_device_state_runtime is
  'Unconfigured NOLOGIN device-state runtime scaffold with no SET ROLE, base-table, sequence, public API, settlement, execution, or money authority.';

commit;
