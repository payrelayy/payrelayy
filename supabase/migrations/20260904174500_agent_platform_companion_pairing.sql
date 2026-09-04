-- Provider-neutral Windows companion pairing and revocation boundary.
--
-- This migration stores only public P-256 signer/device material, one-use challenge digests,
-- signed no-money enrollment certificates, and append-only revocations. It creates no amount,
-- transfer, settlement, execution, wallet, Player-ID, provider credential, or browser-session
-- authority. The public bridge receives a dedicated continuously available runtime role with
-- function-only access and no direct table access. It has no calendar shutdown; emergency disable
-- remains an explicit operator action.

begin;

create role fetanagent_companion_device_bridge
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_companion_device_bridge_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant fetanagent_companion_device_bridge
  to fetanagent_companion_device_bridge_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.agent_platform_companion_server_signers (
  id uuid primary key,
  signer_key_id text not null unique
    check (
      signer_key_id = pg_catalog.btrim(signer_key_id)
      and signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    ),
  public_key_spki text not null unique
    check (
      pg_catalog.length(public_key_spki) between 1 and 684
      and public_key_spki ~ '^[A-Za-z0-9_-]+$'
    ),
  public_key_spki_sha256 text not null unique
    check (public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature_algorithm text not null
    check (signature_algorithm = 'ecdsa-p256-sha256'),
  signature_encoding text not null
    check (signature_encoding = 'ieee-p1363-base64url'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint agent_platform_companion_server_signer_id_v4_check check (
    id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint agent_platform_companion_server_signer_window_check
    check (valid_until > valid_from + interval '1 day')
);

create table app.agent_platform_companion_server_signer_revocations (
  server_signer_id uuid primary key
    references app.agent_platform_companion_server_signers (id) on delete restrict,
  revoked_at timestamptz not null,
  reason text not null
    check (reason in ('key_compromise', 'security_rotation', 'operator_revocation')),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table app.agent_platform_companion_pairing_challenges (
  pairing_id uuid primary key,
  issue_request_key uuid not null unique,
  issue_request_digest text not null unique
    check (issue_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  server_signer_id uuid not null
    references app.agent_platform_companion_server_signers (id) on delete restrict,
  pairing_nonce_digest text not null unique
    check (pairing_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  minimum_companion_version text not null
    check (
      minimum_companion_version = pg_catalog.btrim(minimum_companion_version)
      and minimum_companion_version
        ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'
    ),
  issued_at timestamptz not null,
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
  reserved_certificate_id uuid unique,
  device_id text unique
    check (
      device_id is null
      or (
        device_id = pg_catalog.btrim(device_id)
        and device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      )
    ),
  device_key_id text unique
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
  device_public_key_spki_sha256 text unique
    check (
      device_public_key_spki_sha256 is null
      or device_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'
    ),
  companion_version text
    check (
      companion_version is null
      or companion_version
        ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'
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
        and pg_catalog.pg_column_size(certificate_body) <= 32768
      )
    ),
  first_claimed_at timestamptz,
  last_claimed_at timestamptz,
  claim_lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint agent_platform_companion_pairing_id_v4_check check (
    pairing_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint agent_platform_companion_pairing_request_key_v4_check check (
    issue_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint agent_platform_companion_reserved_certificate_id_v4_check check (
    reserved_certificate_id is null
    or reserved_certificate_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint agent_platform_companion_pairing_window_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '10 minutes'
  ),
  constraint agent_platform_companion_pairing_state_shape_check check (
    (
      state = 'open'
      and pairing_request_body_digest is null
      and reserved_certificate_id is null
      and device_id is null
      and device_key_id is null
      and device_public_key_spki is null
      and device_public_key_spki_sha256 is null
      and companion_version is null
      and pairing_request_issued_at is null
      and pairing_request_expires_at is null
      and certificate_issued_at is null
      and certificate_valid_from is null
      and certificate_valid_until is null
      and certificate_body is null
      and first_claimed_at is null
      and last_claimed_at is null
      and claim_lease_expires_at is null
      and completed_at is null
    ) or (
      state in ('claimed', 'bound', 'completed')
      and pairing_request_body_digest is not null
      and reserved_certificate_id is not null
      and device_id is not null
      and device_key_id is not null
      and device_public_key_spki is not null
      and device_public_key_spki_sha256 is not null
      and companion_version is not null
      and pairing_request_issued_at is not null
      and pairing_request_expires_at is not null
      and certificate_issued_at is not null
      and certificate_valid_from is not null
      and certificate_valid_until is not null
      and certificate_body is not null
      and first_claimed_at is not null
      and last_claimed_at is not null
      and (
        (state = 'claimed' and claim_lease_expires_at is not null and completed_at is null)
        or (state = 'bound' and claim_lease_expires_at is null and completed_at is null)
        or (state = 'completed' and claim_lease_expires_at is null and completed_at is not null)
      )
    )
  )
);

create index agent_platform_companion_pairing_signer_idx
  on app.agent_platform_companion_pairing_challenges (server_signer_id);
create index agent_platform_companion_pairing_owner_idx
  on app.agent_platform_companion_pairing_challenges (created_by_admin_id);
create index agent_platform_companion_pairing_claim_expiry_idx
  on app.agent_platform_companion_pairing_challenges (claim_lease_expires_at, pairing_id)
  where state = 'claimed';

create table app.agent_platform_companion_enrollment_certificates (
  certificate_id uuid primary key,
  pairing_id uuid not null unique
    references app.agent_platform_companion_pairing_challenges (pairing_id) on delete restrict,
  server_signer_id uuid not null
    references app.agent_platform_companion_server_signers (id) on delete restrict,
  pairing_request_body_digest text not null unique
    check (pairing_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  certificate_body_digest text not null unique
    check (certificate_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  certificate_signer_key_id text not null
    check (certificate_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  certificate_signature text not null
    check (certificate_signature ~ '^[A-Za-z0-9_-]{86}$'),
  device_id text not null unique
    check (
      device_id = pg_catalog.btrim(device_id)
      and device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    ),
  device_key_id text not null unique
    check (
      device_key_id = pg_catalog.btrim(device_key_id)
      and device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    ),
  device_public_key_spki_sha256 text not null unique
    check (device_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  certificate_body jsonb not null
    check (
      pg_catalog.jsonb_typeof(certificate_body) = 'object'
      and pg_catalog.pg_column_size(certificate_body) <= 32768
    ),
  signed_certificate jsonb not null
    check (
      pg_catalog.jsonb_typeof(signed_certificate) = 'object'
      and pg_catalog.pg_column_size(signed_certificate) <= 65536
    ),
  issued_at timestamptz not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  completed_at timestamptz not null,
  constraint agent_platform_companion_certificate_id_v4_check check (
    certificate_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint agent_platform_companion_certificate_window_check check (
    issued_at <= valid_from and valid_until > valid_from
  )
);

create table app.agent_platform_companion_device_revocations (
  certificate_id uuid primary key
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
      on delete restrict,
  revocation_request_key uuid not null unique,
  revoked_by_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  revoked_at timestamptz not null,
  reason text not null
    check (reason in ('owner_requested', 'device_lost', 'key_compromise', 'security_recovery')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint agent_platform_companion_revocation_request_key_v4_check check (
    revocation_request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

create function app.reject_agent_platform_companion_immutable_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Agent-platform companion public trust history is immutable.';
end;
$$;

create function app.reject_agent_platform_companion_immutable_truncate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'Agent-platform companion public trust history cannot be truncated.';
end;
$$;

create trigger agent_platform_companion_server_signers_immutable
before update or delete on app.agent_platform_companion_server_signers
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_server_signers_no_truncate
before truncate on app.agent_platform_companion_server_signers
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();
create trigger agent_platform_companion_server_signer_revocations_immutable
before update or delete on app.agent_platform_companion_server_signer_revocations
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_server_signer_revocations_no_truncate
before truncate on app.agent_platform_companion_server_signer_revocations
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();
create trigger agent_platform_companion_certificates_immutable
before update or delete on app.agent_platform_companion_enrollment_certificates
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_certificates_no_truncate
before truncate on app.agent_platform_companion_enrollment_certificates
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();
create trigger agent_platform_companion_device_revocations_immutable
before update or delete on app.agent_platform_companion_device_revocations
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_device_revocations_no_truncate
before truncate on app.agent_platform_companion_device_revocations
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();

create function app.require_agent_platform_companion_bridge_session()
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
       and role.rolname = 'fetanagent_companion_device_bridge_runtime'
       and role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil = 'infinity'::timestamptz
  ) into runtime_is_currently_authorized;

  if runtime_is_currently_authorized is not true then
    raise exception 'The companion bridge session is not currently authorized.';
  end if;
end;
$$;

create function app.agent_platform_companion_timestamp(p_value timestamptz)
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

create function app.agent_platform_companion_version_at_least(
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
    '^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})$'
  );
  minimum_match := pg_catalog.regexp_match(
    p_minimum,
    '^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})$'
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

create function app.agent_platform_companion_public_key_digest(p_public_key_spki text)
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
    $digest$ into digest_hex using decoded_key;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(public.digest($1, 'sha256'), 'hex')
    $digest$ into digest_hex using decoded_key;
  else
    raise exception 'The companion public-key digest is unavailable.';
  end if;
  if digest_hex !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  return 'sha256:' || digest_hex;
end;
$$;

create function app.issue_agent_platform_companion_pairing(
  p_actor_auth_user_id uuid,
  p_issue_request_key uuid,
  p_server_signer_key_id text,
  p_minimum_companion_version text
)
returns table (
  pairing_id uuid,
  pairing_nonce_digest text,
  issued_at timestamptz,
  expires_at timestamptz,
  signer_key_id text,
  server_signing_public_key_spki text,
  server_signing_public_key_spki_sha256 text,
  minimum_companion_version text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  now_at timestamptz;
  generated_pairing_id uuid;
  generated_nonce_digest text;
  generated_expiry timestamptz;
  switch_count integer;
  existing_challenge app.agent_platform_companion_pairing_challenges%rowtype;
  signer app.agent_platform_companion_server_signers%rowtype;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_actor_auth_user_id is null
    or p_issue_request_key is null
    or p_issue_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_server_signer_key_id is null
    or p_server_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_minimum_companion_version is null
    or p_minimum_companion_version
      !~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$' then
    raise exception 'The Owner companion pairing request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:owner:companion-device-pairing:v1:' || p_issue_request_key::text,
      0
    )
  );

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
    raise exception 'Only the active Owner can issue a companion pairing package.';
  end if;

  select challenge.*
    into existing_challenge
    from app.agent_platform_companion_pairing_challenges challenge
   where challenge.issue_request_key = p_issue_request_key
   for update;
  if existing_challenge.pairing_id is not null then
    select server_signer.*
      into signer
      from app.agent_platform_companion_server_signers server_signer
     where server_signer.id = existing_challenge.server_signer_id;
    if existing_challenge.created_by_admin_id is distinct from actor_admin_id
      or existing_challenge.minimum_companion_version
           is distinct from p_minimum_companion_version
      or signer.signer_key_id is distinct from p_server_signer_key_id then
      raise exception 'The Owner companion pairing replay conflicts.';
    end if;
    return query
    select existing_challenge.pairing_id,
           existing_challenge.pairing_nonce_digest,
           existing_challenge.issued_at,
           existing_challenge.expires_at,
           signer.signer_key_id,
           signer.public_key_spki,
           signer.public_key_spki_sha256,
           existing_challenge.minimum_companion_version,
           true;
    return;
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification',
     'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;
  if switch_count <> 7 or exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
       and (feature_switch.mode <> 'disabled' or feature_switch.settings <> '{}'::jsonb)
  ) or exists (
    select 1
      from app.feature_switches feature_switch
     where feature_switch.feature_key = 'private_live_deposit_pilot'
       and feature_switch.mode not in ('disabled', 'dry_run')
  ) then
    raise exception 'Companion pairing requires every financial switch to remain disabled.';
  end if;

  select server_signer.*
    into signer
    from app.agent_platform_companion_server_signers server_signer
   where server_signer.signer_key_id = p_server_signer_key_id
   for share;
  if signer.id is null
    or signer.signature_algorithm <> 'ecdsa-p256-sha256'
    or signer.signature_encoding <> 'ieee-p1363-base64url'
    or app.agent_platform_companion_public_key_digest(signer.public_key_spki)
         is distinct from signer.public_key_spki_sha256
    or now_at < signer.valid_from
    or now_at >= signer.valid_until
    or exists (
      select 1
        from app.agent_platform_companion_server_signer_revocations revocation
       where revocation.server_signer_id = signer.id
         and revocation.revoked_at <= now_at
    ) then
    raise exception 'The companion server signer is not ready.';
  end if;

  generated_expiry := pg_catalog.date_trunc(
    'milliseconds', least(now_at + interval '10 minutes', signer.valid_until)
  );
  if generated_expiry <= now_at + interval '30 seconds' then
    raise exception 'The companion pairing window is too short.';
  end if;
  generated_pairing_id := pg_catalog.gen_random_uuid();
  generated_nonce_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:owner:companion-device-pairing-nonce:v1' || E'\n'
    || p_issue_request_key::text || E'\n'
    || pg_catalog.gen_random_uuid()::text || E'\n'
    || pg_catalog.gen_random_uuid()::text
  );

  insert into app.agent_platform_companion_pairing_challenges (
    pairing_id,
    issue_request_key,
    issue_request_digest,
    server_signer_id,
    pairing_nonce_digest,
    minimum_companion_version,
    issued_at,
    expires_at,
    created_by_admin_id
  ) values (
    generated_pairing_id,
    p_issue_request_key,
    app.private_live_deposit_pilot_sha256(
      'fetanagent:owner:companion-device-pairing-request:v1' || E'\n'
      || actor_admin_id::text || E'\n' || p_issue_request_key::text
    ),
    signer.id,
    generated_nonce_digest,
    p_minimum_companion_version,
    now_at,
    generated_expiry,
    actor_admin_id
  );

  return query
  select generated_pairing_id,
         generated_nonce_digest,
         now_at,
         generated_expiry,
         signer.signer_key_id,
         signer.public_key_spki,
         signer.public_key_spki_sha256,
         p_minimum_companion_version,
         false;
end;
$$;

create function app.claim_agent_platform_companion_pairing(
  p_pairing_id uuid,
  p_pairing_nonce_digest text,
  p_pairing_request_body_digest text,
  p_device_id text,
  p_device_key_id text,
  p_device_public_key_spki text,
  p_device_public_key_spki_sha256 text,
  p_companion_version text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz,
  p_server_signer_key_id text
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
  challenge app.agent_platform_companion_pairing_challenges%rowtype;
  signer app.agent_platform_companion_server_signers%rowtype;
  certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  generated_certificate_id uuid;
  generated_certificate_body jsonb;
  valid_until timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
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
    or app.agent_platform_companion_public_key_digest(p_device_public_key_spki)
         is distinct from p_device_public_key_spki_sha256
    or p_companion_version is null
    or p_companion_version
      !~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'
    or p_request_issued_at is null
    or p_request_expires_at is null
    or p_request_expires_at <= p_request_issued_at
    or p_request_expires_at > p_request_issued_at + interval '10 minutes'
    or p_assessed_at is null
    or pg_catalog.date_trunc('milliseconds', p_assessed_at) <> p_assessed_at
    or p_assessed_at < p_request_issued_at
    or p_assessed_at >= p_request_expires_at
    or p_assessed_at < now_at - interval '30 seconds'
    or p_assessed_at > now_at + interval '30 seconds'
    or p_server_signer_key_id is null
    or p_server_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$' then
    return;
  end if;

  select pairing_challenge.*
    into challenge
    from app.agent_platform_companion_pairing_challenges pairing_challenge
   where pairing_challenge.pairing_id = p_pairing_id
     and pairing_challenge.pairing_nonce_digest = p_pairing_nonce_digest
   for update;
  if challenge.pairing_id is null then
    return;
  end if;

  if challenge.state <> 'open' and (
    challenge.pairing_request_body_digest is distinct from p_pairing_request_body_digest
    or challenge.device_id is distinct from p_device_id
    or challenge.device_key_id is distinct from p_device_key_id
    or challenge.device_public_key_spki is distinct from p_device_public_key_spki
    or challenge.device_public_key_spki_sha256 is distinct from p_device_public_key_spki_sha256
    or challenge.companion_version is distinct from p_companion_version
    or challenge.pairing_request_issued_at
         is distinct from pg_catalog.date_trunc('milliseconds', p_request_issued_at)
    or challenge.pairing_request_expires_at
         is distinct from pg_catalog.date_trunc('milliseconds', p_request_expires_at)
  ) then
    return;
  end if;

  select server_signer.*
    into signer
    from app.agent_platform_companion_server_signers server_signer
   where server_signer.id = challenge.server_signer_id
   for share;
  if signer.id is null
    or signer.signer_key_id <> p_server_signer_key_id
    or signer.signature_algorithm <> 'ecdsa-p256-sha256'
    or signer.signature_encoding <> 'ieee-p1363-base64url'
    or p_assessed_at < signer.valid_from
    or p_assessed_at >= signer.valid_until
    or exists (
      select 1
        from app.agent_platform_companion_server_signer_revocations revocation
       where revocation.server_signer_id = signer.id
         and revocation.revoked_at <= p_assessed_at
    ) then
    return;
  end if;

  if challenge.state = 'completed' then
    select certificate_row.*
      into certificate
      from app.agent_platform_companion_enrollment_certificates certificate_row
     where certificate_row.certificate_id = challenge.reserved_certificate_id;
    if certificate.certificate_id is null
      or p_assessed_at < certificate.valid_from
      or p_assessed_at >= certificate.valid_until
      or exists (
        select 1
          from app.agent_platform_companion_device_revocations revocation
         where revocation.certificate_id = certificate.certificate_id
           and revocation.revoked_at <= p_assessed_at
      ) then
      return;
    end if;
    return query
    select 'completed'::text, challenge.certificate_body, certificate.signed_certificate;
    return;
  end if;

  if challenge.expires_at <= p_assessed_at
    or p_request_issued_at is distinct from challenge.issued_at
    or p_request_expires_at is distinct from challenge.expires_at
    or not app.agent_platform_companion_version_at_least(
      p_companion_version, challenge.minimum_companion_version
    ) then
    return;
  end if;

  if challenge.state = 'claimed' and challenge.claim_lease_expires_at > p_assessed_at then
    return query select 'in_progress'::text, null::jsonb, null::jsonb;
    return;
  end if;

  if challenge.state = 'open' then
    if exists (
      select 1
        from app.agent_platform_companion_enrollment_certificates existing_certificate
       where existing_certificate.device_id = p_device_id
          or existing_certificate.device_key_id = p_device_key_id
          or existing_certificate.device_public_key_spki_sha256 = p_device_public_key_spki_sha256
    ) then
      return;
    end if;
    generated_certificate_id := pg_catalog.gen_random_uuid();
    valid_until := pg_catalog.date_trunc(
      'milliseconds', least(p_assessed_at + interval '90 days', signer.valid_until)
    );
    if valid_until <= p_assessed_at + interval '1 day' then
      return;
    end if;
    generated_certificate_body := pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'protocolMode', 'local_companion_no_transfer_v1',
      'certificateId', generated_certificate_id::text,
      'pairingId', challenge.pairing_id::text,
      'pairingRequestBodyDigest', p_pairing_request_body_digest,
      'pairingNonceDigest', challenge.pairing_nonce_digest,
      'pairingConsumed', true,
      'deviceId', p_device_id,
      'deviceKeyId', p_device_key_id,
      'devicePublicKeySpki', p_device_public_key_spki,
      'devicePublicKeySpkiSha256', p_device_public_key_spki_sha256,
      'signatureAlgorithm', 'ecdsa-p256-sha256',
      'devicePlatform', 'windows',
      'companionVersion', p_companion_version,
      'state', 'active',
      'issuedAt', app.agent_platform_companion_timestamp(p_assessed_at),
      'validFrom', app.agent_platform_companion_timestamp(p_assessed_at),
      'validUntil', app.agent_platform_companion_timestamp(valid_until),
      'accountMutationAllowed', false,
      'balanceMutationAllowed', false,
      'providerMutationAllowed', false,
      'paymentAllowed', false,
      'depositAllowed', false,
      'withdrawAllowed', false,
      'transferAllowed', false,
      'settlementAllowed', false,
      'finalActionAllowed', false,
      'financialActionAllowed', false,
      'moneyMovementAllowed', false,
      'transferDisabled', true,
      'identifiersRedacted', true,
      'moneyMoved', false
    );
    update app.agent_platform_companion_pairing_challenges pairing_challenge
       set state = 'claimed',
           pairing_request_body_digest = p_pairing_request_body_digest,
           reserved_certificate_id = generated_certificate_id,
           device_id = p_device_id,
           device_key_id = p_device_key_id,
           device_public_key_spki = p_device_public_key_spki,
           device_public_key_spki_sha256 = p_device_public_key_spki_sha256,
           companion_version = p_companion_version,
           pairing_request_issued_at = pg_catalog.date_trunc('milliseconds', p_request_issued_at),
           pairing_request_expires_at = pg_catalog.date_trunc('milliseconds', p_request_expires_at),
           certificate_issued_at = p_assessed_at,
           certificate_valid_from = p_assessed_at,
           certificate_valid_until = valid_until,
           certificate_body = generated_certificate_body,
           first_claimed_at = p_assessed_at,
           last_claimed_at = p_assessed_at,
           claim_lease_expires_at = least(p_request_expires_at, p_assessed_at + interval '30 seconds'),
           updated_at = p_assessed_at
     where pairing_challenge.pairing_id = challenge.pairing_id;
    return query select 'claimed'::text, generated_certificate_body, null::jsonb;
    return;
  end if;

  update app.agent_platform_companion_pairing_challenges pairing_challenge
     set state = 'claimed',
         last_claimed_at = p_assessed_at,
         claim_lease_expires_at = least(p_request_expires_at, p_assessed_at + interval '30 seconds'),
         updated_at = p_assessed_at
   where pairing_challenge.pairing_id = challenge.pairing_id;
  return query select 'claimed'::text, challenge.certificate_body, null::jsonb;
end;
$$;

create function app.complete_agent_platform_companion_pairing(
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
  challenge app.agent_platform_companion_pairing_challenges%rowtype;
  signer app.agent_platform_companion_server_signers%rowtype;
  existing_certificate app.agent_platform_companion_enrollment_certificates%rowtype;
begin
  perform app.require_agent_platform_companion_bridge_session();
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
    from app.agent_platform_companion_pairing_challenges pairing_challenge
   where pairing_challenge.pairing_request_body_digest = p_pairing_request_body_digest
   for update;
  if challenge.pairing_id is null then
    return false;
  end if;
  if challenge.state = 'completed' then
    select certificate.*
      into existing_certificate
      from app.agent_platform_companion_enrollment_certificates certificate
     where certificate.certificate_id = challenge.reserved_certificate_id;
    return existing_certificate.certificate_id is not null
      and existing_certificate.certificate_body_digest = p_certificate_body_digest
      and existing_certificate.certificate_signer_key_id = p_certificate_signer_key_id
      and existing_certificate.certificate_signature = p_certificate_signature
      and existing_certificate.signed_certificate = p_signed_certificate;
  end if;

  select server_signer.*
    into signer
    from app.agent_platform_companion_server_signers server_signer
   where server_signer.id = challenge.server_signer_id
   for share;
  if challenge.state not in ('claimed', 'bound')
    or challenge.certificate_valid_until <= now_at
    or signer.id is null
    or signer.signer_key_id <> p_certificate_signer_key_id
    or now_at < signer.valid_from
    or now_at >= signer.valid_until
    or exists (
      select 1
        from app.agent_platform_companion_server_signer_revocations revocation
       where revocation.server_signer_id = signer.id
         and revocation.revoked_at <= now_at
    )
    or p_signed_certificate ->> 'contractVersion' <> '1'
    or p_signed_certificate ->> 'protocolMode' <> 'local_companion_no_transfer_v1'
    or p_signed_certificate ->> 'transcriptVersion'
      <> 'agent-platform-companion-certificate-transcript-v1'
    or p_signed_certificate ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_certificate ->> 'bodyDigest' <> p_certificate_body_digest
    or p_signed_certificate ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_certificate ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_certificate ->> 'signerKeyId' <> p_certificate_signer_key_id
    or p_signed_certificate ->> 'signature' <> p_certificate_signature
    or p_signed_certificate -> 'body' is distinct from challenge.certificate_body then
    return false;
  end if;

  insert into app.agent_platform_companion_enrollment_certificates (
    certificate_id,
    pairing_id,
    server_signer_id,
    pairing_request_body_digest,
    certificate_body_digest,
    certificate_signer_key_id,
    certificate_signature,
    device_id,
    device_key_id,
    device_public_key_spki_sha256,
    certificate_body,
    signed_certificate,
    issued_at,
    valid_from,
    valid_until,
    completed_at
  ) values (
    challenge.reserved_certificate_id,
    challenge.pairing_id,
    challenge.server_signer_id,
    challenge.pairing_request_body_digest,
    p_certificate_body_digest,
    p_certificate_signer_key_id,
    p_certificate_signature,
    challenge.device_id,
    challenge.device_key_id,
    challenge.device_public_key_spki_sha256,
    challenge.certificate_body,
    p_signed_certificate,
    challenge.certificate_issued_at,
    challenge.certificate_valid_from,
    challenge.certificate_valid_until,
    now_at
  );
  update app.agent_platform_companion_pairing_challenges pairing_challenge
     set state = 'completed',
         claim_lease_expires_at = null,
         completed_at = now_at,
         updated_at = now_at
   where pairing_challenge.pairing_id = challenge.pairing_id;
  return true;
end;
$$;

create function app.release_agent_platform_companion_pairing(
  p_pairing_request_body_digest text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  released boolean;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_pairing_request_body_digest is null
    or p_pairing_request_body_digest !~ '^sha256:[0-9a-f]{64}$' then
    return false;
  end if;
  update app.agent_platform_companion_pairing_challenges pairing_challenge
     set state = 'bound',
         claim_lease_expires_at = null,
         updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
   where pairing_challenge.pairing_request_body_digest = p_pairing_request_body_digest
     and pairing_challenge.state = 'claimed';
  released := found;
  return released;
end;
$$;

create function app.revoke_agent_platform_companion_device(
  p_actor_auth_user_id uuid,
  p_certificate_id uuid,
  p_revocation_request_key uuid,
  p_reason text
)
returns table (
  certificate_id uuid,
  revoked_at timestamptz,
  reason text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  now_at timestamptz;
  existing_revocation app.agent_platform_companion_device_revocations%rowtype;
  certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  challenge app.agent_platform_companion_pairing_challenges%rowtype;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_actor_auth_user_id is null
    or p_certificate_id is null
    or p_revocation_request_key is null
    or p_revocation_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason not in ('owner_requested', 'device_lost', 'key_compromise', 'security_recovery') then
    raise exception 'The companion device revocation request is invalid.';
  end if;
  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can revoke a companion device.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:owner:companion-device-revocation:v1:' || p_revocation_request_key::text,
      0
    )
  );
  select revocation.* into existing_revocation
    from app.agent_platform_companion_device_revocations revocation
   where revocation.revocation_request_key = p_revocation_request_key
   for share;
  if existing_revocation.certificate_id is not null then
    if existing_revocation.certificate_id is distinct from p_certificate_id
      or existing_revocation.revoked_by_admin_id is distinct from actor_admin_id
      or existing_revocation.reason is distinct from p_reason then
      raise exception 'The companion device revocation replay conflicts.';
    end if;
    return query select existing_revocation.certificate_id,
                        existing_revocation.revoked_at,
                        existing_revocation.reason,
                        true;
    return;
  end if;
  select certificate_row.* into certificate
    from app.agent_platform_companion_enrollment_certificates certificate_row
   where certificate_row.certificate_id = p_certificate_id
   for share;
  select pairing_challenge.* into challenge
    from app.agent_platform_companion_pairing_challenges pairing_challenge
   where pairing_challenge.pairing_id = certificate.pairing_id
   for share;
  if certificate.certificate_id is null
    or challenge.created_by_admin_id is distinct from actor_admin_id then
    raise exception 'The companion device certificate is unavailable.';
  end if;
  insert into app.agent_platform_companion_device_revocations (
    certificate_id, revocation_request_key, revoked_by_admin_id, revoked_at, reason
  ) values (
    p_certificate_id, p_revocation_request_key, actor_admin_id, now_at, p_reason
  );
  return query select p_certificate_id, now_at, p_reason, false;
end;
$$;

alter table app.agent_platform_companion_server_signers enable row level security;
alter table app.agent_platform_companion_server_signers force row level security;
alter table app.agent_platform_companion_server_signer_revocations enable row level security;
alter table app.agent_platform_companion_server_signer_revocations force row level security;
alter table app.agent_platform_companion_pairing_challenges enable row level security;
alter table app.agent_platform_companion_pairing_challenges force row level security;
alter table app.agent_platform_companion_enrollment_certificates enable row level security;
alter table app.agent_platform_companion_enrollment_certificates force row level security;
alter table app.agent_platform_companion_device_revocations enable row level security;
alter table app.agent_platform_companion_device_revocations force row level security;

alter table app.agent_platform_companion_server_signers owner to postgres;
alter table app.agent_platform_companion_server_signer_revocations owner to postgres;
alter table app.agent_platform_companion_pairing_challenges owner to postgres;
alter table app.agent_platform_companion_enrollment_certificates owner to postgres;
alter table app.agent_platform_companion_device_revocations owner to postgres;

alter function app.reject_agent_platform_companion_immutable_mutation() owner to postgres;
alter function app.reject_agent_platform_companion_immutable_truncate() owner to postgres;
alter function app.require_agent_platform_companion_bridge_session() owner to postgres;
alter function app.agent_platform_companion_timestamp(timestamptz) owner to postgres;
alter function app.agent_platform_companion_version_at_least(text, text) owner to postgres;
alter function app.agent_platform_companion_public_key_digest(text) owner to postgres;
alter function app.issue_agent_platform_companion_pairing(uuid, uuid, text, text)
  owner to postgres;
alter function app.claim_agent_platform_companion_pairing(
  uuid, text, text, text, text, text, text, text, timestamptz, timestamptz,
  timestamptz, text
) owner to postgres;
alter function app.complete_agent_platform_companion_pairing(text, text, text, text, jsonb)
  owner to postgres;
alter function app.release_agent_platform_companion_pairing(text) owner to postgres;
alter function app.revoke_agent_platform_companion_device(uuid, uuid, uuid, text)
  owner to postgres;

revoke all privileges on table
  app.agent_platform_companion_server_signers,
  app.agent_platform_companion_server_signer_revocations,
  app.agent_platform_companion_pairing_challenges,
  app.agent_platform_companion_enrollment_certificates,
  app.agent_platform_companion_device_revocations
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker, fetanagent_cbe_birr_shadow_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.reject_agent_platform_companion_immutable_mutation(),
  app.reject_agent_platform_companion_immutable_truncate(),
  app.require_agent_platform_companion_bridge_session(),
  app.agent_platform_companion_timestamp(timestamptz),
  app.agent_platform_companion_version_at_least(text, text),
  app.agent_platform_companion_public_key_digest(text),
  app.issue_agent_platform_companion_pairing(uuid, uuid, text, text),
  app.claim_agent_platform_companion_pairing(
    uuid, text, text, text, text, text, text, text, timestamptz, timestamptz,
    timestamptz, text
  ),
  app.complete_agent_platform_companion_pairing(text, text, text, text, jsonb),
  app.release_agent_platform_companion_pairing(text),
  app.revoke_agent_platform_companion_device(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker, fetanagent_cbe_birr_shadow_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

do $$
begin
  execute pg_catalog.format(
    'revoke all privileges on database %I from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime',
    current_database()
  );
end;
$$;

revoke all privileges on schema app
from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all privileges on all tables in schema app
from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all privileges on all sequences in schema app
from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all privileges on all functions in schema app
from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all privileges on all procedures in schema app
from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant usage on schema app to fetanagent_companion_device_bridge;
grant execute on function
  app.claim_agent_platform_companion_pairing(
    uuid, text, text, text, text, text, text, text, timestamptz, timestamptz,
    timestamptz, text
  ),
  app.complete_agent_platform_companion_pairing(text, text, text, text, jsonb),
  app.release_agent_platform_companion_pairing(text)
to fetanagent_companion_device_bridge;

grant execute on function
  app.issue_agent_platform_companion_pairing(uuid, uuid, text, text),
  app.revoke_agent_platform_companion_device(uuid, uuid, uuid, text)
to fetanagent_owner_control;

comment on table app.agent_platform_companion_server_signers is
  'Append-only public P-256 companion server signer registry. Private keys never enter PostgreSQL.';
comment on table app.agent_platform_companion_pairing_challenges is
  'One-use Owner-issued Windows companion pairing state. Stores a bounded bearer digest and public device material only; no account identity, credential, Player ID, or money authority.';
comment on table app.agent_platform_companion_enrollment_certificates is
  'Append-only signed public no-money Windows companion certificates, retained for exact response-loss recovery and revocation.';
comment on table app.agent_platform_companion_device_revocations is
  'Append-only Owner device-certificate revocation metadata. Revocation cannot enable a replacement device or any financial action.';
comment on function app.issue_agent_platform_companion_pairing(uuid, uuid, text, text) is
  'Authenticated Owner-only, idempotent, ten-minute Windows companion pairing-package issuer. It leaves every financial switch unchanged and disabled.';
comment on function app.claim_agent_platform_companion_pairing(
  uuid, text, text, text, text, text, text, text, timestamptz, timestamptz,
  timestamptz, text
) is
  'Short-lived bridge-runtime claim for one verified public P-256 pairing request. First binding is permanent; exact retries recover the same body or signed certificate.';
comment on function app.complete_agent_platform_companion_pairing(text, text, text, text, jsonb) is
  'Atomic append-only completion for one server-signed no-money certificate; uncertain acknowledgements are recoverable by exact pairing replay.';
comment on role fetanagent_companion_device_bridge is
  'NOLOGIN function-only Windows companion bridge group with no base-table, Player-ID, provider, execution, settlement, or money authority.';
comment on role fetanagent_companion_device_bridge_runtime is
  'Unconfigured NOLOGIN continuously available runtime scaffold. Deployment may grant LOGIN without a calendar shutdown but not inheritance, SET ROLE, table access, or financial authority; explicit emergency disable remains available.';

commit;
