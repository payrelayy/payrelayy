-- Paired Windows-companion execution transport for the fixed private KemerBet pilot.
--
-- This migration is deliberately dormant. It installs a separate execution control, retained
-- assignment/result ledgers, and seven narrowly granted bridge procedures. The control is seeded
-- disabled and this migration exposes no procedure that can arm it. Consequently applying this
-- migration cannot lease a deposit, acquire a final-action fence, or move money.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.agent_platform_companion_execution_control (
  singleton boolean primary key default true check (singleton),
  control_state text not null default 'disabled'
    check (control_state in ('disabled', 'active')),
  certificate_id uuid
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  device_id text,
  device_key_id text,
  no_money_signer_key_id text,
  execution_signer_key_id text,
  execution_signer_public_key_spki text,
  execution_signer_public_key_spki_sha256 text,
  platform_agent_account_id uuid
    references app.platform_agent_accounts (id) on delete restrict,
  pilot_revision_id uuid
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  pilot_revision integer,
  pilot_configuration_digest text,
  activation_epoch bigint
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  active_from timestamptz,
  expires_at timestamptz,
  activated_by_admin_id uuid references app.admin_users (id) on delete restrict,
  activated_at timestamptz,
  disabled_at timestamptz,
  disable_reason_code text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint agent_platform_companion_execution_control_shape check (
    (
      control_state = 'disabled'
      and certificate_id is null
      and device_id is null
      and device_key_id is null
      and no_money_signer_key_id is null
      and execution_signer_key_id is null
      and execution_signer_public_key_spki is null
      and execution_signer_public_key_spki_sha256 is null
      and platform_agent_account_id is null
      and pilot_revision_id is null
      and pilot_revision is null
      and pilot_configuration_digest is null
      and activation_epoch is null
      and active_from is null
      and expires_at is null
      and activated_by_admin_id is null
      and activated_at is null
      and disabled_at is null
      and disable_reason_code is null
    ) or (
      control_state = 'active'
      and certificate_id is not null
      and device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and no_money_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and execution_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
      and execution_signer_key_id <> no_money_signer_key_id
      and pg_catalog.length(execution_signer_public_key_spki) between 1 and 684
      and execution_signer_public_key_spki ~ '^[A-Za-z0-9_-]+$'
      and execution_signer_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'
      and platform_agent_account_id is not null
      and pilot_revision_id is not null
      and pilot_revision > 0
      and pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'
      and activation_epoch > 0
      and active_from is not null
      and expires_at > active_from
      and expires_at <= active_from + interval '2 hours'
      and activated_by_admin_id is not null
      and activated_at is not null
      and activated_at < expires_at
      and disabled_at is null
      and disable_reason_code is null
    )
  )
);

insert into app.agent_platform_companion_execution_control (singleton)
values (true);

create table app.agent_platform_companion_execution_http_requests (
  replay_identity text primary key check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  http_request_body_digest text not null unique
    check (http_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_id text not null unique
    check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  canonical_path text not null check (
    canonical_path in (
      '/v2/companion/device/execution-assignments:poll',
      '/v2/companion/device/execution-authorities:consume',
      '/v2/companion/device/execution-results:submit',
      '/v2/companion/device/execution-status:query'
    )
  ),
  assignment_id uuid,
  response_state text not null default 'processing'
    check (response_state in ('processing', 'none', 'completed')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  received_at timestamptz not null,
  completed_at timestamptz,
  constraint agent_platform_companion_execution_http_window check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '5 minutes'
    and received_at >= issued_at - interval '30 seconds'
    and received_at < expires_at
  ),
  constraint agent_platform_companion_execution_http_completion check (
    (response_state = 'processing' and completed_at is null)
    or (response_state in ('none', 'completed') and completed_at is not null)
  )
);

create table app.agent_platform_companion_execution_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique default gen_random_uuid(),
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  device_id text not null check (device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_key_id text not null check (device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  no_money_signer_key_id text not null
    check (no_money_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  execution_signer_key_id text not null
    check (execution_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  execution_signer_public_key_spki text not null
    check (
      pg_catalog.length(execution_signer_public_key_spki) between 1 and 684
      and execution_signer_public_key_spki ~ '^[A-Za-z0-9_-]+$'
    ),
  execution_signer_public_key_spki_sha256 text not null
    check (execution_signer_public_key_spki_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  activation_epoch bigint not null
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  deposit_intent_id uuid not null references app.deposit_intents (id) on delete restrict,
  execution_job_id uuid not null references app.deposit_jobs (id) on delete restrict,
  execution_attempt_id uuid not null unique
    references app.deposit_execution_attempts (id) on delete restrict,
  platform_agent_account_id uuid not null
    references app.platform_agent_accounts (id) on delete restrict,
  player_id_snapshot text not null
    check (player_id_snapshot ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  amount_minor bigint not null check (amount_minor = 2500),
  currency_code text not null check (currency_code = 'ETB'),
  lease_token uuid not null unique,
  lease_expires_at timestamptz not null,
  pilot_contract_version smallint not null,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  pilot_revision integer not null check (pilot_revision > 0),
  pilot_reservation_id uuid not null unique
    references app.private_live_deposit_pilot_reservations (id) on delete restrict,
  pilot_configuration_digest text not null
    check (pilot_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  pilot_authorization_token uuid not null unique,
  pilot_reservation_digest text not null unique
    check (pilot_reservation_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_nonce_digest text not null unique
    check (assignment_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text not null default 'claimed'
    check (
      state in (
        'claimed', 'signed', 'authority_claimed', 'authority_signed', 'result_recorded'
      )
    ),
  claim_material jsonb not null
    check (pg_catalog.jsonb_typeof(claim_material) = 'object'),
  claim_lease_expires_at timestamptz,
  enrollment_body_digest text unique
    check (enrollment_body_digest is null or enrollment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_enrollment jsonb,
  assignment_body_digest text unique
    check (assignment_body_digest is null or assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_assignment jsonb,
  authority_id uuid unique,
  authority_request_nonce_digest text unique
    check (
      authority_request_nonce_digest is null
      or authority_request_nonce_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  fence_id uuid unique,
  fence_nonce_digest text unique
    check (fence_nonce_digest is null or fence_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_body jsonb,
  authority_body_digest text unique
    check (authority_body_digest is null or authority_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_authority jsonb,
  authority_claim_lease_expires_at timestamptz,
  execution_result_id text unique,
  execution_result_body_digest text unique
    check (
      execution_result_body_digest is null
      or execution_result_body_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  signed_result jsonb,
  result_outcome text check (
    result_outcome is null
    or result_outcome in (
      'submission_attempted', 'local_uncertain', 'post_fence_no_local_action'
    )
  ),
  provider_response_digest text
    check (
      provider_response_digest is null
      or provider_response_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  evidence_digest text
    check (evidence_digest is null or evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  result_reported_at timestamptz,
  issued_at timestamptz not null,
  not_before timestamptz not null,
  expires_at timestamptz not null,
  enrollment_valid_until timestamptz not null,
  signed_at timestamptz,
  database_fenced_at timestamptz,
  authority_issued_at timestamptz,
  authority_valid_until timestamptz,
  result_accepted_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint agent_platform_companion_execution_assignment_window check (
    not_before >= issued_at
    and expires_at > not_before
    and expires_at <= issued_at + interval '2 minutes'
    and lease_expires_at >= expires_at
    and enrollment_valid_until >= expires_at
  ),
  constraint agent_platform_companion_execution_assignment_signing_shape check (
    (state = 'claimed'
      and enrollment_body_digest is null and signed_enrollment is null
      and assignment_body_digest is null and signed_assignment is null
      and signed_at is null)
    or (state in ('signed', 'authority_claimed', 'authority_signed', 'result_recorded')
      and enrollment_body_digest is not null and signed_enrollment is not null
      and assignment_body_digest is not null and signed_assignment is not null
      and signed_at is not null)
  ),
  constraint agent_platform_companion_execution_authority_shape check (
    (state in ('claimed', 'signed')
      and authority_id is null and authority_request_nonce_digest is null
      and fence_id is null and fence_nonce_digest is null
      and authority_body is null and authority_body_digest is null
      and signed_authority is null and database_fenced_at is null
      and authority_issued_at is null and authority_valid_until is null)
    or (state = 'authority_claimed'
      and authority_id is not null and authority_request_nonce_digest is not null
      and fence_id is not null and fence_nonce_digest is not null
      and authority_body is not null and authority_body_digest is null
      and signed_authority is null and database_fenced_at is not null
      and authority_issued_at is not null and authority_valid_until is not null)
    or (state in ('authority_signed', 'result_recorded')
      and authority_id is not null and authority_request_nonce_digest is not null
      and fence_id is not null and fence_nonce_digest is not null
      and authority_body is not null and authority_body_digest is not null
      and signed_authority is not null and database_fenced_at is not null
      and authority_issued_at is not null and authority_valid_until is not null)
  ),
  constraint agent_platform_companion_execution_result_shape check (
    (state <> 'result_recorded'
      and execution_result_id is null and execution_result_body_digest is null
      and signed_result is null and result_outcome is null
      and provider_response_digest is null and evidence_digest is null
      and result_reported_at is null and result_accepted_at is null)
    or (state = 'result_recorded'
      and execution_result_id is not null and execution_result_body_digest is not null
      and signed_result is not null and result_outcome is not null
      and evidence_digest is not null and result_reported_at is not null
      and result_accepted_at is not null)
  )
);

alter table app.agent_platform_companion_execution_http_requests
  add constraint agent_platform_companion_execution_http_assignment_fkey
  foreign key (assignment_id)
  references app.agent_platform_companion_execution_assignments (assignment_id)
  on delete restrict;

create unique index agent_platform_companion_execution_one_open_assignment
  on app.agent_platform_companion_execution_assignments ((true))
  where state in ('claimed', 'signed', 'authority_claimed', 'authority_signed');
create index agent_platform_companion_execution_expiry_idx
  on app.agent_platform_companion_execution_assignments (expires_at, assignment_id);

create table app.agent_platform_companion_execution_statuses (
  status_id uuid primary key default gen_random_uuid(),
  status_sequence bigint generated always as identity unique,
  assignment_id uuid not null
    references app.agent_platform_companion_execution_assignments (assignment_id)
    on delete restrict,
  http_replay_identity text not null unique
    references app.agent_platform_companion_execution_http_requests (replay_identity)
    on delete restrict,
  query_nonce_digest text not null check (query_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  status_body jsonb not null check (pg_catalog.jsonb_typeof(status_body) = 'object'),
  status_body_digest text unique
    check (status_body_digest is null or status_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_status jsonb,
  claim_lease_expires_at timestamptz not null,
  observed_at timestamptz not null,
  issued_at timestamptz not null,
  valid_until timestamptz not null,
  signed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint agent_platform_companion_execution_status_window check (
    issued_at >= observed_at
    and valid_until > issued_at
    and valid_until <= issued_at + interval '10 seconds'
  ),
  constraint agent_platform_companion_execution_status_signing_shape check (
    (status_body_digest is null and signed_status is null and signed_at is null)
    or (status_body_digest is not null and signed_status is not null and signed_at is not null)
  )
);

create function app.agent_platform_companion_execution_valid_http_request(
  p_http_replay_identity text,
  p_http_request_body_digest text,
  p_http_request_id text,
  p_certificate_id text,
  p_device_id text,
  p_device_key_id text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    p_http_replay_identity ~ '^sha256:[0-9a-f]{64}$'
    and p_http_request_body_digest ~ '^sha256:[0-9a-f]{64}$'
    and p_http_request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    and p_certificate_id
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    and p_device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    and p_request_issued_at is not null
    and p_request_expires_at > p_request_issued_at
    and p_request_expires_at <= p_request_issued_at + interval '5 minutes'
    and p_assessed_at >= p_request_issued_at - interval '30 seconds'
    and p_assessed_at < p_request_expires_at
    and p_assessed_at = pg_catalog.date_trunc('milliseconds', p_assessed_at)
    and p_assessed_at >= pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
      - interval '30 seconds'
    and p_assessed_at <= pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
      + interval '30 seconds',
    false
  )
$$;

create function app.agent_platform_companion_execution_certificate_is_active(
  p_certificate_id uuid,
  p_device_id text,
  p_device_key_id text,
  p_no_money_signer_key_id text,
  p_assessed_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
      from app.agent_platform_companion_enrollment_certificates certificate
      join app.agent_platform_companion_server_signers signer
        on signer.id = certificate.server_signer_id
      left join app.agent_platform_companion_device_revocations device_revocation
        on device_revocation.certificate_id = certificate.certificate_id
      left join app.agent_platform_companion_server_signer_revocations signer_revocation
        on signer_revocation.server_signer_id = signer.id
     where certificate.certificate_id = p_certificate_id
       and certificate.device_id = p_device_id
       and certificate.device_key_id = p_device_key_id
       and certificate.certificate_signer_key_id = p_no_money_signer_key_id
       and certificate.valid_from <= p_assessed_at
       and certificate.valid_until > p_assessed_at
       and signer.signer_key_id = p_no_money_signer_key_id
       and signer.valid_from <= p_assessed_at
       and signer.valid_until > p_assessed_at
       and device_revocation.certificate_id is null
       and signer_revocation.server_signer_id is null
  )
$$;

create function app.agent_platform_companion_execution_encode_texts(p_values text[])
returns bytea
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  encoded bytea := ''::bytea;
  value text;
  value_bytes bytea;
begin
  if p_values is null or pg_catalog.cardinality(p_values) = 0 then
    return null;
  end if;
  foreach value in array p_values loop
    if value is null or pg_catalog.octet_length(value) > 4096 then
      return null;
    end if;
    value_bytes := pg_catalog.convert_to(value, 'UTF8');
    encoded := encoded || pg_catalog.int4send(pg_catalog.octet_length(value_bytes)) || value_bytes;
  end loop;
  return encoded;
end;
$$;

create function app.agent_platform_companion_execution_player_digest(p_player_id text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  canonical bytea;
  digest_hex text;
begin
  if p_player_id is null
    or p_player_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    return null;
  end if;
  canonical := app.agent_platform_companion_execution_encode_texts(array[
    'fetanagent:agent-platform-companion:execution-player-id:v2',
    '2',
    'platformCode',
    'string:kemerbet',
    'playerId',
    'string:' || p_player_id
  ]::text[]);
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(extensions.digest($1, 'sha256'), 'hex')
    $digest$ into digest_hex using canonical;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(public.digest($1, 'sha256'), 'hex')
    $digest$ into digest_hex using canonical;
  else
    raise exception 'The companion execution digest function is unavailable.';
  end if;
  return case when digest_hex ~ '^[0-9a-f]{64}$' then 'sha256:' || digest_hex else null end;
end;
$$;

-- The existing lease/fence implementations re-check this helper as session_user. Let the paired
-- bridge traverse those private implementations while retaining their original direct grants only
-- for the deposit executor. The bridge can reach them solely through the wrappers below.
create or replace function app.require_private_live_deposit_pilot_executor()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'fetanagent_deposit_executor', 'member')
    and not pg_catalog.pg_has_role(
      session_user,
      'fetanagent_companion_device_bridge',
      'member'
    ) then
    raise exception 'The private live-deposit pilot executor role is required.';
  end if;
end;
$$;

create function app.claim_agent_platform_companion_execution_assignment(
  p_http_replay_identity text,
  p_http_request_body_digest text,
  p_http_request_id text,
  p_certificate_id text,
  p_device_id text,
  p_device_key_id text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz,
  p_no_money_signer_key_id text,
  p_execution_signer_key_id text,
  p_execution_signer_public_key_spki text,
  p_execution_signer_public_key_spki_sha256 text
)
returns table (
  claim_state text,
  claim_material jsonb,
  signed_enrollment jsonb,
  signed_assignment jsonb,
  player_id text,
  signed_authority jsonb,
  signed_result jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  certificate_uuid uuid;
  control app.agent_platform_companion_execution_control%rowtype;
  existing_request app.agent_platform_companion_execution_http_requests%rowtype;
  selected_assignment app.agent_platform_companion_execution_assignments%rowtype;
  leased record;
  epoch_binding app.private_live_deposit_execution_epoch_bindings%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  issued_at timestamptz;
  assignment_valid_until timestamptz;
  enrollment_valid_until timestamptz;
  assignment_nonce uuid;
  reservation_digest text;
  built_material jsonb;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if not app.agent_platform_companion_execution_valid_http_request(
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id,
    p_certificate_id, p_device_id, p_device_key_id, p_request_issued_at,
    p_request_expires_at, p_assessed_at
  ) or p_no_money_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_execution_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_execution_signer_key_id = p_no_money_signer_key_id
    or p_execution_signer_public_key_spki !~ '^[A-Za-z0-9_-]+$'
    or pg_catalog.length(p_execution_signer_public_key_spki) not between 1 and 684
    or p_execution_signer_public_key_spki_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    return;
  end if;
  certificate_uuid := p_certificate_id::uuid;
  if not app.agent_platform_companion_execution_certificate_is_active(
    certificate_uuid, p_device_id, p_device_key_id, p_no_money_signer_key_id, p_assessed_at
  ) then
    return;
  end if;

  select request.* into existing_request
    from app.agent_platform_companion_execution_http_requests request
   where request.replay_identity = p_http_replay_identity
   for share;
  if existing_request.replay_identity is not null then
    if existing_request.http_request_body_digest <> p_http_request_body_digest
      or existing_request.request_id <> p_http_request_id
      or existing_request.certificate_id <> certificate_uuid
      or existing_request.canonical_path
        <> '/v2/companion/device/execution-assignments:poll' then
      return;
    end if;
    if existing_request.response_state = 'none' then
      return query select 'none'::text, null::jsonb, null::jsonb, null::jsonb,
                          null::text, null::jsonb, null::jsonb;
      return;
    end if;
    if existing_request.assignment_id is null then
      return query select 'in_progress'::text, null::jsonb, null::jsonb, null::jsonb,
                          null::text, null::jsonb, null::jsonb;
      return;
    end if;
    select assignment.* into selected_assignment
      from app.agent_platform_companion_execution_assignments assignment
     where assignment.assignment_id = existing_request.assignment_id;
    if selected_assignment.state = 'claimed' then
      return query select 'in_progress'::text, null::jsonb, null::jsonb, null::jsonb,
                          null::text, null::jsonb, null::jsonb;
    end if;
    return query
      select 'completed'::text, selected_assignment.claim_material,
             selected_assignment.signed_enrollment, selected_assignment.signed_assignment,
             selected_assignment.player_id_snapshot, selected_assignment.signed_authority,
             selected_assignment.signed_result;
    return;
  end if;

  insert into app.agent_platform_companion_execution_http_requests (
    replay_identity, http_request_body_digest, request_id, certificate_id, canonical_path,
    issued_at, expires_at, received_at
  ) values (
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id, certificate_uuid,
    '/v2/companion/device/execution-assignments:poll', p_request_issued_at,
    p_request_expires_at, p_assessed_at
  );

  select execution_control.* into control
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
   for update;
  if control.control_state <> 'active' then
    update app.agent_platform_companion_execution_http_requests request
       set response_state = 'none', completed_at = p_assessed_at
     where request.replay_identity = p_http_replay_identity;
    return query select 'none'::text, null::jsonb, null::jsonb, null::jsonb,
                        null::text, null::jsonb, null::jsonb;
    return;
  end if;
  if control.certificate_id <> certificate_uuid
    or control.device_id <> p_device_id
    or control.device_key_id <> p_device_key_id
    or control.no_money_signer_key_id <> p_no_money_signer_key_id
    or control.execution_signer_key_id <> p_execution_signer_key_id
    or control.execution_signer_public_key_spki <> p_execution_signer_public_key_spki
    or control.execution_signer_public_key_spki_sha256
      <> p_execution_signer_public_key_spki_sha256
    or p_assessed_at < control.active_from
    or p_assessed_at >= control.expires_at then
    return;
  end if;

  select assignment.* into selected_assignment
    from app.agent_platform_companion_execution_assignments assignment
   where assignment.state in ('claimed', 'signed', 'authority_claimed', 'authority_signed')
   order by assignment.created_at
   limit 1
   for update;
  if selected_assignment.assignment_id is not null then
    if selected_assignment.certificate_id <> certificate_uuid
      or selected_assignment.execution_signer_key_id <> p_execution_signer_key_id then
      return;
    end if;
    update app.agent_platform_companion_execution_http_requests request
       set assignment_id = selected_assignment.assignment_id,
           response_state = 'completed', completed_at = p_assessed_at
     where request.replay_identity = p_http_replay_identity;
    if selected_assignment.state = 'claimed' then
      return query
        select 'claimed'::text, selected_assignment.claim_material, null::jsonb, null::jsonb,
               selected_assignment.player_id_snapshot, null::jsonb, null::jsonb;
    else
      return query
        select 'completed'::text, selected_assignment.claim_material,
               selected_assignment.signed_enrollment, selected_assignment.signed_assignment,
               selected_assignment.player_id_snapshot, selected_assignment.signed_authority,
               selected_assignment.signed_result;
    end if;
    return;
  end if;

  select lease.* into leased
    from app.lease_next_private_live_deposit_execution(certificate_uuid, 60) lease;
  if not found then
    update app.agent_platform_companion_execution_http_requests request
       set response_state = 'none', completed_at = p_assessed_at
     where request.replay_identity = p_http_replay_identity;
    return query select 'none'::text, null::jsonb, null::jsonb, null::jsonb,
                        null::text, null::jsonb, null::jsonb;
    return;
  end if;
  if leased.lease_disposition <> 'execution'
    or leased.deposit_intent_id is null
    or leased.execution_job_id is null
    or leased.execution_attempt_id is null
    or leased.platform_agent_account_id <> control.platform_agent_account_id
    or leased.player_id is null
    or leased.amount_minor <> 2500
    or leased.currency_code <> 'ETB'
    or leased.lease_token is null
    or leased.lease_expires_at is null
    or leased.pilot_revision_id <> control.pilot_revision_id
    or leased.pilot_reservation_id is null
    or leased.pilot_configuration_digest <> control.pilot_configuration_digest
    or leased.pilot_authorization_token is null then
    raise exception 'The companion execution lease does not match its active control.';
  end if;

  select binding.* into epoch_binding
    from app.private_live_deposit_execution_epoch_bindings binding
   where binding.execution_attempt_id = leased.execution_attempt_id
   for share;
  select revision.* into pilot
    from app.private_live_deposit_pilot_revisions revision
   where revision.id = leased.pilot_revision_id
   for share;
  if epoch_binding.execution_attempt_id is null
    or epoch_binding.activation_epoch <> control.activation_epoch
    or pilot.id is null
    or pilot.revision <> control.pilot_revision
    or pilot.status <> 'armed'
    or pilot.configuration_digest <> control.pilot_configuration_digest then
    raise exception 'The companion execution activation lineage is unavailable.';
  end if;

  issued_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  assignment_valid_until := pg_catalog.least(
    issued_at + interval '60 seconds', leased.lease_expires_at, control.expires_at,
    pilot.expires_at
  );
  enrollment_valid_until := pg_catalog.least(
    issued_at + interval '24 hours', control.expires_at, pilot.expires_at
  );
  if assignment_valid_until <= issued_at
    or enrollment_valid_until < assignment_valid_until then
    raise exception 'The companion execution validity window is unavailable.';
  end if;
  assignment_nonce := gen_random_uuid();
  reservation_digest := app.agent_platform_companion_lookup_sha256(
    'fetanagent:companion-execution-pilot-reservation:v2:'
    || leased.pilot_reservation_id::text || ':' || leased.pilot_authorization_token::text
  );

  insert into app.agent_platform_companion_execution_assignments (
    certificate_id, device_id, device_key_id, no_money_signer_key_id,
    execution_signer_key_id, execution_signer_public_key_spki,
    execution_signer_public_key_spki_sha256, activation_epoch, deposit_intent_id, execution_job_id,
    execution_attempt_id, platform_agent_account_id, player_id_snapshot, amount_minor,
    currency_code, lease_token, lease_expires_at, pilot_contract_version,
    pilot_revision_id, pilot_revision, pilot_reservation_id, pilot_configuration_digest,
    pilot_authorization_token, pilot_reservation_digest, assignment_nonce_digest,
    claim_material, claim_lease_expires_at, issued_at, not_before, expires_at,
    enrollment_valid_until
  ) values (
    certificate_uuid, p_device_id, p_device_key_id, p_no_money_signer_key_id,
    p_execution_signer_key_id, p_execution_signer_public_key_spki,
    p_execution_signer_public_key_spki_sha256, control.activation_epoch, leased.deposit_intent_id,
    leased.execution_job_id, leased.execution_attempt_id, leased.platform_agent_account_id,
    leased.player_id, leased.amount_minor, leased.currency_code, leased.lease_token,
    leased.lease_expires_at, leased.pilot_contract_version, leased.pilot_revision_id,
    pilot.revision, leased.pilot_reservation_id, leased.pilot_configuration_digest,
    leased.pilot_authorization_token, reservation_digest,
    app.agent_platform_companion_lookup_sha256(
      'fetanagent:companion-execution-assignment-nonce:v2:' || assignment_nonce::text
    ),
    '{}'::jsonb, p_assessed_at + interval '30 seconds', issued_at, issued_at,
    assignment_valid_until, enrollment_valid_until
  ) returning * into selected_assignment;

  built_material := pg_catalog.jsonb_build_object(
    'activationEpoch', selected_assignment.activation_epoch::text,
    'assignmentId', selected_assignment.assignment_id::text,
    'assignmentNonceDigest', selected_assignment.assignment_nonce_digest,
    'attemptId', selected_assignment.execution_attempt_id::text,
    'enrollmentId', selected_assignment.enrollment_id::text,
    'enrollmentIssuedAt', app.agent_platform_companion_timestamp(issued_at),
    'enrollmentValidFrom', app.agent_platform_companion_timestamp(issued_at),
    'enrollmentValidUntil', app.agent_platform_companion_timestamp(enrollment_valid_until),
    'intentId', selected_assignment.deposit_intent_id::text,
    'jobId', selected_assignment.execution_job_id::text,
    'pilotConfigDigest', selected_assignment.pilot_configuration_digest,
    'pilotId', selected_assignment.pilot_revision_id::text,
    'pilotReservationDigest', selected_assignment.pilot_reservation_digest,
    'pilotReservationId', selected_assignment.pilot_reservation_id::text,
    'pilotRevision', selected_assignment.pilot_revision::text,
    'platformAgentAccountId', selected_assignment.platform_agent_account_id::text,
    'serverIssuedAt', app.agent_platform_companion_timestamp(issued_at),
    'serverNotBefore', app.agent_platform_companion_timestamp(issued_at),
    'serverValidUntil', app.agent_platform_companion_timestamp(assignment_valid_until)
  );
  update app.agent_platform_companion_execution_assignments assignment
     set claim_material = built_material
   where assignment.assignment_id = selected_assignment.assignment_id;
  update app.agent_platform_companion_execution_http_requests request
     set assignment_id = selected_assignment.assignment_id,
         response_state = 'completed', completed_at = p_assessed_at
   where request.replay_identity = p_http_replay_identity;
  return query select 'claimed'::text, built_material, null::jsonb, null::jsonb,
                      selected_assignment.player_id_snapshot, null::jsonb, null::jsonb;
end;
$$;

create function app.complete_agent_platform_companion_execution_assignment(
  p_enrollment_body_digest text,
  p_signed_enrollment jsonb,
  p_assignment_body_digest text,
  p_signed_assignment jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  assignment_uuid uuid;
  selected_assignment app.agent_platform_companion_execution_assignments%rowtype;
  certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  now_at timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_enrollment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_signed_enrollment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.pg_column_size(p_signed_enrollment) > 65536
    or pg_catalog.pg_column_size(p_signed_assignment) > 65536
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_enrollment,
      array[
        'contractVersion', 'protocolMode', 'transcriptVersion', 'bodyDigestAlgorithm',
        'bodyDigest', 'signatureAlgorithm', 'signatureEncoding', 'signerKeyId', 'body',
        'signature'
      ]::text[]
    )
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_assignment,
      array[
        'contractVersion', 'protocolMode', 'transcriptVersion', 'bodyDigestAlgorithm',
        'bodyDigest', 'signatureAlgorithm', 'signatureEncoding', 'signerKeyId', 'body',
        'signature'
      ]::text[]
    )
    or p_signed_enrollment ->> 'contractVersion' <> '2'
    or p_signed_enrollment ->> 'protocolMode'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_enrollment ->> 'transcriptVersion'
      <> 'agent-platform-companion-execution-enrollment-transcript-v2'
    or p_signed_enrollment ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_enrollment ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_enrollment ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_enrollment ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_assignment ->> 'contractVersion' <> '2'
    or p_signed_assignment ->> 'protocolMode'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_assignment ->> 'transcriptVersion'
      <> 'agent-platform-companion-execution-assignment-transcript-v2'
    or p_signed_assignment ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_assignment ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_assignment ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_assignment ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_assignment #>> '{body,assignmentId}'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  assignment_uuid := (p_signed_assignment #>> '{body,assignmentId}')::uuid;
  select assignment.* into selected_assignment
    from app.agent_platform_companion_execution_assignments assignment
   where assignment.assignment_id = assignment_uuid
   for update;
  if selected_assignment.assignment_id is null then return false; end if;
  if selected_assignment.state <> 'claimed' then
    return selected_assignment.enrollment_body_digest = p_enrollment_body_digest
      and selected_assignment.signed_enrollment = p_signed_enrollment
      and selected_assignment.assignment_body_digest = p_assignment_body_digest
      and selected_assignment.signed_assignment = p_signed_assignment;
  end if;
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  select enrolled.* into certificate
    from app.agent_platform_companion_enrollment_certificates enrolled
   where enrolled.certificate_id = selected_assignment.certificate_id
   for share;
  if selected_assignment.claim_lease_expires_at <= now_at
    or selected_assignment.expires_at <= now_at
    or p_signed_enrollment ->> 'bodyDigest' <> p_enrollment_body_digest
    or p_signed_assignment ->> 'bodyDigest' <> p_assignment_body_digest
    or p_signed_enrollment ->> 'signerKeyId' <> selected_assignment.execution_signer_key_id
    or p_signed_assignment ->> 'signerKeyId' <> selected_assignment.execution_signer_key_id
    or p_signed_enrollment #>> '{body,contractVersion}' <> '2'
    or p_signed_enrollment #>> '{body,protocolMode}'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_enrollment #>> '{body,capability}'
      <> 'kemerbet.deposit.submit.exact_2500_etb.one_use.v2'
    or p_signed_enrollment #>> '{body,enrollmentId}' <> selected_assignment.enrollment_id::text
    or p_signed_enrollment #>> '{body,noMoneyCertificateId}'
      <> selected_assignment.certificate_id::text
    or p_signed_enrollment #>> '{body,noMoneyCertificateBodyDigest}'
      <> certificate.certificate_body_digest
    or p_signed_enrollment #>> '{body,deviceId}' <> selected_assignment.device_id
    or p_signed_enrollment #>> '{body,deviceKeyId}' <> selected_assignment.device_key_id
    or p_signed_enrollment #>> '{body,devicePublicKeySpkiSha256}'
      <> certificate.device_public_key_spki_sha256
    or p_signed_enrollment #>> '{body,platformAgentAccountId}'
      <> selected_assignment.platform_agent_account_id::text
    or p_signed_enrollment #>> '{body,accountBindingCount}' <> '1'
    or p_signed_enrollment #>> '{body,platformCode}' <> 'kemerbet'
    or p_signed_enrollment #>> '{body,pilotId}' <> selected_assignment.pilot_revision_id::text
    or p_signed_enrollment #>> '{body,pilotRevision}' <> selected_assignment.pilot_revision::text
    or p_signed_enrollment #>> '{body,pilotConfigDigest}'
      <> selected_assignment.pilot_configuration_digest
    or p_signed_enrollment #>> '{body,amountMinorUnits}' <> '2500'
    or p_signed_enrollment #>> '{body,currencyCode}' <> 'ETB'
    or p_signed_enrollment #>> '{body,maxActionsPerAssignment}' <> '1'
    or p_signed_enrollment #>> '{body,maxAssignmentLifetimeMs}' <> '120000'
    or p_signed_enrollment #>> '{body,maxAuthorityLifetimeMs}' <> '10000'
    or p_signed_enrollment #>> '{body,maxStatusLifetimeMs}' <> '10000'
    or p_signed_enrollment #>> '{body,maxRoundTripTimeMs}' <> '10000'
    or p_signed_enrollment #>> '{body,executionSignerKeyId}'
      <> selected_assignment.execution_signer_key_id
    or p_signed_enrollment #>> '{body,executionSignerPublicKeySpki}'
      <> selected_assignment.execution_signer_public_key_spki
    or p_signed_enrollment #>> '{body,executionSignerPublicKeySpkiSha256}'
      <> selected_assignment.execution_signer_public_key_spki_sha256
    or p_signed_enrollment #>> '{body,capabilityState}' <> 'active'
    or p_signed_enrollment #>> '{body,issuedAt}'
      <> selected_assignment.claim_material ->> 'enrollmentIssuedAt'
    or p_signed_enrollment #>> '{body,validFrom}'
      <> selected_assignment.claim_material ->> 'enrollmentValidFrom'
    or p_signed_enrollment #>> '{body,validUntil}'
      <> selected_assignment.claim_material ->> 'enrollmentValidUntil'
    or p_signed_assignment #>> '{body,contractVersion}' <> '2'
    or p_signed_assignment #>> '{body,protocolMode}'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_assignment #>> '{body,capability}'
      <> 'kemerbet.deposit.submit.exact_2500_etb.one_use.v2'
    or p_signed_assignment #>> '{body,actionKind}' <> 'deposit_submission'
    or p_signed_assignment #>> '{body,assignmentNonceDigest}'
      <> selected_assignment.assignment_nonce_digest
    or p_signed_assignment #>> '{body,activationEpoch}'
      <> selected_assignment.activation_epoch::text
    or p_signed_assignment #>> '{body,intentId}' <> selected_assignment.deposit_intent_id::text
    or p_signed_assignment #>> '{body,jobId}' <> selected_assignment.execution_job_id::text
    or p_signed_assignment #>> '{body,attemptId}'
      <> selected_assignment.execution_attempt_id::text
    or p_signed_assignment #>> '{body,platformAgentAccountId}'
      <> selected_assignment.platform_agent_account_id::text
    or p_signed_assignment #>> '{body,enrollmentId}' <> selected_assignment.enrollment_id::text
    or p_signed_assignment #>> '{body,enrollmentBodyDigest}' <> p_enrollment_body_digest
    or p_signed_assignment #>> '{body,noMoneyCertificateId}'
      <> selected_assignment.certificate_id::text
    or p_signed_assignment #>> '{body,noMoneyCertificateBodyDigest}'
      <> certificate.certificate_body_digest
    or p_signed_assignment #>> '{body,deviceId}' <> selected_assignment.device_id
    or p_signed_assignment #>> '{body,deviceKeyId}' <> selected_assignment.device_key_id
    or p_signed_assignment #>> '{body,executionSignerKeyId}'
      <> selected_assignment.execution_signer_key_id
    or p_signed_assignment #>> '{body,platformCode}' <> 'kemerbet'
    or p_signed_assignment #>> '{body,pilotId}' <> selected_assignment.pilot_revision_id::text
    or p_signed_assignment #>> '{body,pilotRevision}' <> selected_assignment.pilot_revision::text
    or p_signed_assignment #>> '{body,pilotConfigDigest}'
      <> selected_assignment.pilot_configuration_digest
    or p_signed_assignment #>> '{body,pilotReservationId}'
      <> selected_assignment.pilot_reservation_id::text
    or p_signed_assignment #>> '{body,pilotReservationDigest}'
      <> selected_assignment.pilot_reservation_digest
    or p_signed_assignment #>> '{body,amountMinorUnits}' <> '2500'
    or p_signed_assignment #>> '{body,currencyCode}' <> 'ETB'
    or p_signed_assignment #>> '{body,playerIdDigest}'
      <> app.agent_platform_companion_execution_player_digest(
        selected_assignment.player_id_snapshot
      )
    or p_signed_assignment #>> '{body,oneUse}' <> 'true'
    or p_signed_assignment #>> '{body,serverIssuedAt}'
      <> selected_assignment.claim_material ->> 'serverIssuedAt'
    or p_signed_assignment #>> '{body,serverNotBefore}'
      <> selected_assignment.claim_material ->> 'serverNotBefore'
    or p_signed_assignment #>> '{body,serverValidUntil}'
      <> selected_assignment.claim_material ->> 'serverValidUntil' then
    return false;
  end if;
  update app.agent_platform_companion_execution_assignments assignment
     set state = 'signed', claim_lease_expires_at = null,
         enrollment_body_digest = p_enrollment_body_digest,
         signed_enrollment = p_signed_enrollment,
         assignment_body_digest = p_assignment_body_digest,
         signed_assignment = p_signed_assignment,
         signed_at = now_at
   where assignment.assignment_id = selected_assignment.assignment_id;
  return true;
end;
$$;

create function app.claim_agent_platform_companion_execution_authority(
  p_http_replay_identity text,
  p_http_request_body_digest text,
  p_http_request_id text,
  p_certificate_id text,
  p_device_id text,
  p_device_key_id text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz,
  p_request_nonce_digest text,
  p_signed_enrollment jsonb,
  p_signed_assignment jsonb
)
returns table (
  claim_state text,
  authority_body jsonb,
  signed_authority jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  certificate_uuid uuid;
  assignment_uuid uuid;
  existing_request app.agent_platform_companion_execution_http_requests%rowtype;
  selected_assignment app.agent_platform_companion_execution_assignments%rowtype;
  control app.agent_platform_companion_execution_control%rowtype;
  fenced record;
  authority_uuid uuid;
  fence_uuid uuid;
  fence_nonce uuid;
  now_at timestamptz;
  valid_until timestamptz;
  built_body jsonb;
  certificate_body_digest text;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if not app.agent_platform_companion_execution_valid_http_request(
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id,
    p_certificate_id, p_device_id, p_device_key_id, p_request_issued_at,
    p_request_expires_at, p_assessed_at
  ) or p_request_nonce_digest !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_signed_enrollment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or p_signed_assignment #>> '{body,assignmentId}'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return;
  end if;
  certificate_uuid := p_certificate_id::uuid;
  assignment_uuid := (p_signed_assignment #>> '{body,assignmentId}')::uuid;

  select request.* into existing_request
    from app.agent_platform_companion_execution_http_requests request
   where request.replay_identity = p_http_replay_identity
   for share;
  if existing_request.replay_identity is not null then
    if existing_request.http_request_body_digest <> p_http_request_body_digest
      or existing_request.request_id <> p_http_request_id
      or existing_request.certificate_id <> certificate_uuid
      or existing_request.canonical_path
        <> '/v2/companion/device/execution-authorities:consume'
      or existing_request.assignment_id <> assignment_uuid then
      return;
    end if;
    select assignment.* into selected_assignment
      from app.agent_platform_companion_execution_assignments assignment
     where assignment.assignment_id = assignment_uuid;
    if existing_request.response_state = 'processing'
      or selected_assignment.state = 'authority_claimed' then
      return query select 'in_progress'::text, null::jsonb, null::jsonb;
    elsif existing_request.response_state = 'completed'
      and selected_assignment.authority_request_nonce_digest = p_request_nonce_digest
      and selected_assignment.signed_authority is not null then
      return query select 'completed'::text, selected_assignment.authority_body,
                          selected_assignment.signed_authority;
    end if;
    return;
  end if;

  select assignment.* into selected_assignment
    from app.agent_platform_companion_execution_assignments assignment
   where assignment.assignment_id = assignment_uuid
   for update;
  if selected_assignment.assignment_id is null
    or selected_assignment.certificate_id <> certificate_uuid
    or selected_assignment.device_id <> p_device_id
    or selected_assignment.device_key_id <> p_device_key_id
    or selected_assignment.signed_enrollment <> p_signed_enrollment
    or selected_assignment.signed_assignment <> p_signed_assignment then
    return;
  end if;
  if selected_assignment.state in ('authority_signed', 'result_recorded') then
    if selected_assignment.authority_request_nonce_digest = p_request_nonce_digest then
      return query select 'completed'::text, selected_assignment.authority_body,
                          selected_assignment.signed_authority;
    end if;
    return;
  elsif selected_assignment.state = 'authority_claimed' then
    if selected_assignment.authority_request_nonce_digest <> p_request_nonce_digest then
      return;
    end if;
    if selected_assignment.authority_valid_until <= p_assessed_at then return; end if;
    return query select 'claimed'::text, selected_assignment.authority_body, null::jsonb;
    return;
  elsif selected_assignment.state <> 'signed'
    or selected_assignment.expires_at <= p_assessed_at then
    return;
  end if;

  select execution_control.* into control
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
   for update;
  if control.control_state <> 'active'
    or control.certificate_id <> certificate_uuid
    or control.device_id <> p_device_id
    or control.device_key_id <> p_device_key_id
    or control.execution_signer_key_id <> selected_assignment.execution_signer_key_id
    or control.platform_agent_account_id <> selected_assignment.platform_agent_account_id
    or control.pilot_revision_id <> selected_assignment.pilot_revision_id
    or control.pilot_configuration_digest <> selected_assignment.pilot_configuration_digest
    or control.activation_epoch <> selected_assignment.activation_epoch
    or p_assessed_at < control.active_from
    or p_assessed_at >= control.expires_at then
    return;
  end if;
  if not app.agent_platform_companion_execution_certificate_is_active(
    certificate_uuid, p_device_id, p_device_key_id,
    selected_assignment.no_money_signer_key_id, p_assessed_at
  ) then
    return;
  end if;

  insert into app.agent_platform_companion_execution_http_requests (
    replay_identity, http_request_body_digest, request_id, certificate_id, canonical_path,
    assignment_id, issued_at, expires_at, received_at
  ) values (
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id, certificate_uuid,
    '/v2/companion/device/execution-authorities:consume', assignment_uuid,
    p_request_issued_at, p_request_expires_at, p_assessed_at
  );

  select fence.* into fenced
    from app.fence_private_live_deposit_execution_final_action(
      selected_assignment.execution_attempt_id,
      selected_assignment.lease_token,
      selected_assignment.pilot_revision_id,
      selected_assignment.pilot_reservation_id,
      selected_assignment.pilot_authorization_token
    ) fence;
  if not found
    or fenced.execution_attempt_id <> selected_assignment.execution_attempt_id
    or fenced.deposit_intent_id <> selected_assignment.deposit_intent_id
    or fenced.first_fence_acquired is not true
    or fenced.final_action_fenced_at is null
    or fenced.pilot_revision_id <> selected_assignment.pilot_revision_id
    or fenced.pilot_reservation_id <> selected_assignment.pilot_reservation_id
    or fenced.pilot_configuration_digest <> selected_assignment.pilot_configuration_digest
    or fenced.pilot_authorization_token <> selected_assignment.pilot_authorization_token then
    raise exception 'The companion execution first-fence authority is unavailable.';
  end if;
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  valid_until := pg_catalog.least(
    fenced.final_action_fenced_at + interval '10 seconds',
    selected_assignment.expires_at,
    control.expires_at
  );
  if valid_until <= now_at then
    raise exception 'The companion execution authority window expired before issuance.';
  end if;
  authority_uuid := gen_random_uuid();
  fence_uuid := gen_random_uuid();
  fence_nonce := gen_random_uuid();
  select enrolled.certificate_body_digest into certificate_body_digest
    from app.agent_platform_companion_enrollment_certificates enrolled
   where enrolled.certificate_id = certificate_uuid;
  built_body := pg_catalog.jsonb_build_object(
    'contractVersion', 2,
    'protocolMode', 'windows_companion_financial_execution_contracts_v2_dormant',
    'capability', 'kemerbet.deposit.submit.exact_2500_etb.one_use.v2',
    'actionKind', 'deposit_submission',
    'authorityId', authority_uuid::text,
    'assignmentId', selected_assignment.assignment_id::text,
    'assignmentBodyDigest', selected_assignment.assignment_body_digest,
    'activationEpoch', selected_assignment.activation_epoch::text,
    'intentId', selected_assignment.deposit_intent_id::text,
    'jobId', selected_assignment.execution_job_id::text,
    'attemptId', selected_assignment.execution_attempt_id::text,
    'platformAgentAccountId', selected_assignment.platform_agent_account_id::text,
    'enrollmentId', selected_assignment.enrollment_id::text,
    'enrollmentBodyDigest', selected_assignment.enrollment_body_digest,
    'noMoneyCertificateId', selected_assignment.certificate_id::text,
    'noMoneyCertificateBodyDigest', certificate_body_digest,
    'deviceId', selected_assignment.device_id,
    'deviceKeyId', selected_assignment.device_key_id,
    'executionSignerKeyId', selected_assignment.execution_signer_key_id,
    'platformCode', 'kemerbet',
    'pilotId', selected_assignment.pilot_revision_id::text,
    'pilotRevision', selected_assignment.pilot_revision::text,
    'pilotConfigDigest', selected_assignment.pilot_configuration_digest,
    'pilotReservationId', selected_assignment.pilot_reservation_id::text,
    'pilotReservationDigest', selected_assignment.pilot_reservation_digest,
    'amountMinorUnits', 2500,
    'currencyCode', 'ETB',
    'playerIdDigest', app.agent_platform_companion_execution_player_digest(
      selected_assignment.player_id_snapshot
    ),
    'fenceId', fence_uuid::text,
    'fenceNonceDigest', app.agent_platform_companion_lookup_sha256(
      'fetanagent:companion-execution-fence-nonce:v2:' || fence_nonce::text
    ),
    'databaseFenceState', 'first_fence_acquired',
    'firstFenceAcquired', true,
    'requestNonceDigest', p_request_nonce_digest,
    'oneUse', true,
    'databaseFencedAt', app.agent_platform_companion_timestamp(
      fenced.final_action_fenced_at
    ),
    'databaseAuthorityIssuedAt', app.agent_platform_companion_timestamp(now_at),
    'serverValidUntil', app.agent_platform_companion_timestamp(valid_until)
  );
  update app.agent_platform_companion_execution_assignments assignment
     set state = 'authority_claimed',
         authority_id = authority_uuid,
         authority_request_nonce_digest = p_request_nonce_digest,
         fence_id = fence_uuid,
         fence_nonce_digest = built_body ->> 'fenceNonceDigest',
         authority_body = built_body,
         authority_claim_lease_expires_at = valid_until,
         database_fenced_at = fenced.final_action_fenced_at,
         authority_issued_at = now_at,
         authority_valid_until = valid_until
   where assignment.assignment_id = selected_assignment.assignment_id;
  return query select 'claimed'::text, built_body, null::jsonb;
end;
$$;

create function app.complete_agent_platform_companion_execution_authority(
  p_authority_body_digest text,
  p_signed_authority jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  assignment_uuid uuid;
  selected_assignment app.agent_platform_companion_execution_assignments%rowtype;
  now_at timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_authority_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_signed_authority) <> 'object'
    or pg_catalog.pg_column_size(p_signed_authority) > 65536
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_authority,
      array[
        'contractVersion', 'protocolMode', 'transcriptVersion', 'bodyDigestAlgorithm',
        'bodyDigest', 'signatureAlgorithm', 'signatureEncoding', 'signerKeyId', 'body',
        'signature'
      ]::text[]
    )
    or p_signed_authority ->> 'contractVersion' <> '2'
    or p_signed_authority ->> 'protocolMode'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_authority ->> 'transcriptVersion'
      <> 'agent-platform-companion-one-use-action-authority-transcript-v2'
    or p_signed_authority ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_authority ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_authority ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_authority ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_authority #>> '{body,assignmentId}'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  assignment_uuid := (p_signed_authority #>> '{body,assignmentId}')::uuid;
  select assignment.* into selected_assignment
    from app.agent_platform_companion_execution_assignments assignment
   where assignment.assignment_id = assignment_uuid
   for update;
  if selected_assignment.assignment_id is null then return false; end if;
  if selected_assignment.state in ('authority_signed', 'result_recorded') then
    return selected_assignment.authority_body_digest = p_authority_body_digest
      and selected_assignment.signed_authority = p_signed_authority;
  end if;
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if selected_assignment.state <> 'authority_claimed'
    or selected_assignment.authority_valid_until <= now_at
    or selected_assignment.authority_body <> p_signed_authority -> 'body'
    or p_signed_authority ->> 'bodyDigest' <> p_authority_body_digest
    or p_signed_authority ->> 'signerKeyId' <> selected_assignment.execution_signer_key_id
    or p_signed_authority #>> '{body,authorityId}' <> selected_assignment.authority_id::text
    or p_signed_authority #>> '{body,assignmentBodyDigest}'
      <> selected_assignment.assignment_body_digest
    or p_signed_authority #>> '{body,fenceId}' <> selected_assignment.fence_id::text
    or p_signed_authority #>> '{body,fenceNonceDigest}'
      <> selected_assignment.fence_nonce_digest
    or p_signed_authority #>> '{body,requestNonceDigest}'
      <> selected_assignment.authority_request_nonce_digest then
    return false;
  end if;
  update app.agent_platform_companion_execution_assignments assignment
     set state = 'authority_signed',
         authority_body_digest = p_authority_body_digest,
         signed_authority = p_signed_authority,
         authority_claim_lease_expires_at = null
   where assignment.assignment_id = selected_assignment.assignment_id;
  update app.agent_platform_companion_execution_http_requests request
     set response_state = 'completed', completed_at = now_at
   where request.assignment_id = selected_assignment.assignment_id
     and request.canonical_path = '/v2/companion/device/execution-authorities:consume'
     and request.response_state = 'processing';
  return true;
end;
$$;

create function app.accept_agent_platform_companion_execution_result(
  p_http_replay_identity text,
  p_http_request_body_digest text,
  p_http_request_id text,
  p_certificate_id text,
  p_device_id text,
  p_device_key_id text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz,
  p_signed_enrollment jsonb,
  p_signed_assignment jsonb,
  p_signed_authority jsonb,
  p_signed_result jsonb
)
returns table (accepted boolean, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  certificate_uuid uuid;
  assignment_uuid uuid;
  existing_request app.agent_platform_companion_execution_http_requests%rowtype;
  selected_assignment app.agent_platform_companion_execution_assignments%rowtype;
  v_result_id text;
  v_result_digest text;
  v_result_outcome text;
  v_provider_digest text;
  v_evidence_digest text;
  v_reported_at timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if not app.agent_platform_companion_execution_valid_http_request(
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id,
    p_certificate_id, p_device_id, p_device_key_id, p_request_issued_at,
    p_request_expires_at, p_assessed_at
  ) or pg_catalog.jsonb_typeof(p_signed_enrollment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_authority) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_result) <> 'object'
    or pg_catalog.pg_column_size(p_signed_result) > 65536
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_result,
      array[
        'contractVersion', 'protocolMode', 'transcriptVersion', 'bodyDigestAlgorithm',
        'bodyDigest', 'signatureAlgorithm', 'signatureEncoding', 'deviceKeyId', 'body',
        'signature'
      ]::text[]
    )
    or p_signed_result ->> 'contractVersion' <> '2'
    or p_signed_result ->> 'protocolMode'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_result ->> 'transcriptVersion'
      <> 'agent-platform-companion-execution-result-transcript-v2'
    or p_signed_result ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_result ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_result ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_result ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_result #>> '{body,assignmentId}'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_signed_result #>> '{body,resultId}' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_signed_result ->> 'bodyDigest' !~ '^sha256:[0-9a-f]{64}$'
    or p_signed_result #>> '{body,evidenceDigest}' !~ '^sha256:[0-9a-f]{64}$' then
    return;
  end if;
  certificate_uuid := p_certificate_id::uuid;
  assignment_uuid := (p_signed_result #>> '{body,assignmentId}')::uuid;
  v_result_id := p_signed_result #>> '{body,resultId}';
  v_result_digest := p_signed_result ->> 'bodyDigest';
  v_result_outcome := p_signed_result #>> '{body,outcome}';
  v_provider_digest := p_signed_result #>> '{body,providerResponseDigest}';
  v_evidence_digest := p_signed_result #>> '{body,evidenceDigest}';
  begin
    v_reported_at := (p_signed_result #>> '{body,reportedAt}')::timestamptz;
  exception when others then
    return;
  end;

  select request.* into existing_request
    from app.agent_platform_companion_execution_http_requests request
   where request.replay_identity = p_http_replay_identity
   for share;
  if existing_request.replay_identity is not null then
    if existing_request.http_request_body_digest = p_http_request_body_digest
      and existing_request.request_id = p_http_request_id
      and existing_request.certificate_id = certificate_uuid
      and existing_request.canonical_path
        = '/v2/companion/device/execution-results:submit'
      and existing_request.assignment_id = assignment_uuid
      and existing_request.response_state = 'completed'
      and exists (
        select 1
          from app.agent_platform_companion_execution_assignments assignment
         where assignment.assignment_id = assignment_uuid
           and assignment.execution_result_id = v_result_id
           and assignment.execution_result_body_digest = v_result_digest
           and assignment.signed_result = p_signed_result
      ) then
      return query select true, true;
    end if;
    return;
  end if;

  select assignment.* into selected_assignment
    from app.agent_platform_companion_execution_assignments assignment
   where assignment.assignment_id = assignment_uuid
   for update;
  if selected_assignment.assignment_id is null
    or selected_assignment.state <> 'authority_signed'
    or selected_assignment.certificate_id <> certificate_uuid
    or selected_assignment.device_id <> p_device_id
    or selected_assignment.device_key_id <> p_device_key_id
    or selected_assignment.signed_enrollment <> p_signed_enrollment
    or selected_assignment.signed_assignment <> p_signed_assignment
    or selected_assignment.signed_authority <> p_signed_authority
    or p_signed_result ->> 'deviceKeyId' <> selected_assignment.device_key_id
    or p_signed_result #>> '{body,contractVersion}' <> '2'
    or p_signed_result #>> '{body,protocolMode}'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_result #>> '{body,capability}'
      <> 'kemerbet.deposit.submit.exact_2500_etb.one_use.v2'
    or p_signed_result #>> '{body,actionKind}' <> 'deposit_submission'
    or p_signed_result #>> '{body,assignmentBodyDigest}'
      <> selected_assignment.assignment_body_digest
    or p_signed_result #>> '{body,authorityId}' <> selected_assignment.authority_id::text
    or p_signed_result #>> '{body,authorityBodyDigest}'
      <> selected_assignment.authority_body_digest
    or p_signed_result #>> '{body,activationEpoch}'
      <> selected_assignment.activation_epoch::text
    or p_signed_result #>> '{body,intentId}' <> selected_assignment.deposit_intent_id::text
    or p_signed_result #>> '{body,jobId}' <> selected_assignment.execution_job_id::text
    or p_signed_result #>> '{body,attemptId}'
      <> selected_assignment.execution_attempt_id::text
    or p_signed_result #>> '{body,platformAgentAccountId}'
      <> selected_assignment.platform_agent_account_id::text
    or p_signed_result #>> '{body,enrollmentId}' <> selected_assignment.enrollment_id::text
    or p_signed_result #>> '{body,enrollmentBodyDigest}'
      <> selected_assignment.enrollment_body_digest
    or p_signed_result #>> '{body,noMoneyCertificateId}'
      <> selected_assignment.certificate_id::text
    or p_signed_result #>> '{body,deviceId}' <> selected_assignment.device_id
    or p_signed_result #>> '{body,deviceKeyId}' <> selected_assignment.device_key_id
    or p_signed_result #>> '{body,executionSignerKeyId}'
      <> selected_assignment.execution_signer_key_id
    or p_signed_result #>> '{body,platformCode}' <> 'kemerbet'
    or p_signed_result #>> '{body,pilotId}' <> selected_assignment.pilot_revision_id::text
    or p_signed_result #>> '{body,pilotRevision}' <> selected_assignment.pilot_revision::text
    or p_signed_result #>> '{body,pilotConfigDigest}'
      <> selected_assignment.pilot_configuration_digest
    or p_signed_result #>> '{body,pilotReservationId}'
      <> selected_assignment.pilot_reservation_id::text
    or p_signed_result #>> '{body,pilotReservationDigest}'
      <> selected_assignment.pilot_reservation_digest
    or p_signed_result #>> '{body,amountMinorUnits}' <> '2500'
    or p_signed_result #>> '{body,currencyCode}' <> 'ETB'
    or p_signed_result #>> '{body,playerIdDigest}'
      <> app.agent_platform_companion_execution_player_digest(
        selected_assignment.player_id_snapshot
      )
    or p_signed_result #>> '{body,fenceId}' <> selected_assignment.fence_id::text
    or p_signed_result #>> '{body,fenceNonceDigest}'
      <> selected_assignment.fence_nonce_digest
    or p_signed_result #>> '{body,requestNonceDigest}'
      <> selected_assignment.authority_request_nonce_digest
    or v_result_outcome not in (
      'submission_attempted', 'local_uncertain', 'post_fence_no_local_action'
    )
    or v_reported_at < selected_assignment.authority_issued_at
    or v_reported_at > p_assessed_at + interval '2 seconds'
    or v_reported_at > selected_assignment.authority_issued_at + interval '5 minutes'
    or (v_result_outcome = 'submission_attempted' and (
      p_signed_result #>> '{body,finalActionStarted}' <> 'true'
      or p_signed_result #>> '{body,finalActionStartedAt}' is null
      or v_provider_digest !~ '^sha256:[0-9a-f]{64}$'
    ))
    or (v_result_outcome = 'local_uncertain' and (
      p_signed_result #>> '{body,finalActionStarted}' <> 'true'
      or p_signed_result #>> '{body,finalActionStartedAt}' is null
      or (v_provider_digest is not null and v_provider_digest !~ '^sha256:[0-9a-f]{64}$')
    ))
    or (v_result_outcome = 'post_fence_no_local_action' and (
      p_signed_result #>> '{body,finalActionStarted}' <> 'false'
      or p_signed_result #> '{body,finalActionStartedAt}' <> 'null'::jsonb
      or p_signed_result #> '{body,providerResponseDigest}' <> 'null'::jsonb
    )) then
    return;
  end if;

  insert into app.agent_platform_companion_execution_http_requests (
    replay_identity, http_request_body_digest, request_id, certificate_id, canonical_path,
    assignment_id, issued_at, expires_at, received_at
  ) values (
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id, certificate_uuid,
    '/v2/companion/device/execution-results:submit', assignment_uuid,
    p_request_issued_at, p_request_expires_at, p_assessed_at
  );

  perform * from app.require_deposit_execution_reconciliation(
    selected_assignment.execution_attempt_id,
    selected_assignment.lease_token,
    v_result_outcome = 'submission_attempted'
  );

  update app.agent_platform_companion_execution_assignments assignment
     set state = 'result_recorded',
         execution_result_id = v_result_id,
         execution_result_body_digest = v_result_digest,
         signed_result = p_signed_result,
         result_outcome = v_result_outcome,
         provider_response_digest = v_provider_digest,
         evidence_digest = v_evidence_digest,
         result_reported_at = v_reported_at,
         result_accepted_at = p_assessed_at
   where assignment.assignment_id = selected_assignment.assignment_id;
  update app.agent_platform_companion_execution_http_requests request
     set response_state = 'completed', completed_at = p_assessed_at
   where request.replay_identity = p_http_replay_identity;
  return query select true, false;
end;
$$;

create function app.claim_agent_platform_companion_execution_status(
  p_http_replay_identity text,
  p_http_request_body_digest text,
  p_http_request_id text,
  p_certificate_id text,
  p_device_id text,
  p_device_key_id text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz,
  p_query_nonce_digest text,
  p_signed_enrollment jsonb,
  p_signed_assignment jsonb,
  p_signed_authority jsonb,
  p_signed_result jsonb
)
returns table (
  claim_state text,
  status_body jsonb,
  signed_status jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  certificate_uuid uuid;
  assignment_uuid uuid;
  existing_request app.agent_platform_companion_execution_http_requests%rowtype;
  selected_assignment app.agent_platform_companion_execution_assignments%rowtype;
  existing_status app.agent_platform_companion_execution_statuses%rowtype;
  inserted_status app.agent_platform_companion_execution_statuses%rowtype;
  attempt_status text;
  reconciliation_outcome text;
  fence_state text;
  database_attempt_state text;
  reconciliation_state text;
  terminal_state text;
  now_at timestamptz;
  valid_until timestamptz;
  built_body jsonb;
  certificate_body_digest text;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if not app.agent_platform_companion_execution_valid_http_request(
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id,
    p_certificate_id, p_device_id, p_device_key_id, p_request_issued_at,
    p_request_expires_at, p_assessed_at
  ) or p_query_nonce_digest !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_signed_enrollment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_authority) <> 'object'
    or (p_signed_result <> 'null'::jsonb and pg_catalog.jsonb_typeof(p_signed_result) <> 'object')
    or p_signed_assignment #>> '{body,assignmentId}'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return;
  end if;
  certificate_uuid := p_certificate_id::uuid;
  assignment_uuid := (p_signed_assignment #>> '{body,assignmentId}')::uuid;

  select request.* into existing_request
    from app.agent_platform_companion_execution_http_requests request
   where request.replay_identity = p_http_replay_identity
   for share;
  if existing_request.replay_identity is not null then
    if existing_request.http_request_body_digest <> p_http_request_body_digest
      or existing_request.request_id <> p_http_request_id
      or existing_request.certificate_id <> certificate_uuid
      or existing_request.canonical_path <> '/v2/companion/device/execution-status:query'
      or existing_request.assignment_id <> assignment_uuid then
      return;
    end if;
    select status.* into existing_status
      from app.agent_platform_companion_execution_statuses status
     where status.http_replay_identity = p_http_replay_identity;
    if existing_status.status_id is null then return; end if;
    if existing_status.signed_status is not null then
      return query select 'completed'::text, existing_status.status_body,
                          existing_status.signed_status;
    elsif existing_status.claim_lease_expires_at <= p_assessed_at
      and existing_status.valid_until > p_assessed_at then
      update app.agent_platform_companion_execution_statuses status
         set claim_lease_expires_at = p_assessed_at + interval '5 seconds'
       where status.status_id = existing_status.status_id;
      return query select 'claimed'::text, existing_status.status_body, null::jsonb;
    end if;
    return;
  end if;

  select assignment.* into selected_assignment
    from app.agent_platform_companion_execution_assignments assignment
   where assignment.assignment_id = assignment_uuid
   for share;
  if selected_assignment.assignment_id is null
    or selected_assignment.certificate_id <> certificate_uuid
    or selected_assignment.device_id <> p_device_id
    or selected_assignment.device_key_id <> p_device_key_id
    or selected_assignment.signed_enrollment <> p_signed_enrollment
    or selected_assignment.signed_assignment <> p_signed_assignment
    or selected_assignment.signed_authority <> p_signed_authority
    or selected_assignment.state not in ('authority_signed', 'result_recorded')
    or (selected_assignment.state = 'authority_signed' and p_signed_result <> 'null'::jsonb)
    or (selected_assignment.state = 'result_recorded'
      and selected_assignment.signed_result <> p_signed_result)
    or not app.agent_platform_companion_execution_certificate_is_active(
      certificate_uuid, p_device_id, p_device_key_id,
      selected_assignment.no_money_signer_key_id, p_assessed_at
    ) then
    return;
  end if;

  select execution_attempt.status::text into attempt_status
    from app.deposit_execution_attempts execution_attempt
   where execution_attempt.id = selected_assignment.execution_attempt_id;
  select reconciliation.outcome::text into reconciliation_outcome
    from app.execution_reconciliations reconciliation
   where reconciliation.deposit_execution_attempt_id = selected_assignment.execution_attempt_id
   order by reconciliation.reconciliation_number desc
   limit 1;

  if selected_assignment.state = 'authority_signed' then
    fence_state := 'acquired';
    database_attempt_state := 'not_started';
    reconciliation_state := 'pending';
    terminal_state := 'non_terminal';
  elsif selected_assignment.result_outcome in ('local_uncertain', 'post_fence_no_local_action') then
    fence_state := 'consumed';
    database_attempt_state := 'local_uncertain';
    reconciliation_state := 'uncertain';
    terminal_state := 'uncertain';
  elsif attempt_status = 'confirmed_executed' or reconciliation_outcome = 'confirmed_executed' then
    fence_state := 'consumed';
    database_attempt_state := 'submission_attempted';
    reconciliation_state := 'succeeded';
    terminal_state := 'succeeded';
  elsif attempt_status = 'review_required'
    or reconciliation_outcome in ('ambiguous', 'not_observed') then
    fence_state := 'consumed';
    database_attempt_state := 'submission_attempted';
    reconciliation_state := 'failed';
    terminal_state := 'failed';
  else
    fence_state := 'consumed';
    database_attempt_state := 'submission_attempted';
    reconciliation_state := 'pending';
    terminal_state := 'non_terminal';
  end if;

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  valid_until := now_at + interval '8 seconds';
  insert into app.agent_platform_companion_execution_http_requests (
    replay_identity, http_request_body_digest, request_id, certificate_id, canonical_path,
    assignment_id, issued_at, expires_at, received_at
  ) values (
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id, certificate_uuid,
    '/v2/companion/device/execution-status:query', assignment_uuid,
    p_request_issued_at, p_request_expires_at, p_assessed_at
  );
  insert into app.agent_platform_companion_execution_statuses (
    assignment_id, http_replay_identity, query_nonce_digest, status_body,
    claim_lease_expires_at, observed_at, issued_at, valid_until
  ) values (
    assignment_uuid, p_http_replay_identity, p_query_nonce_digest, '{}'::jsonb,
    p_assessed_at + interval '5 seconds', now_at, now_at, valid_until
  ) returning * into inserted_status;
  select enrolled.certificate_body_digest into certificate_body_digest
    from app.agent_platform_companion_enrollment_certificates enrolled
   where enrolled.certificate_id = certificate_uuid;
  built_body := pg_catalog.jsonb_build_object(
    'contractVersion', 2,
    'protocolMode', 'windows_companion_financial_execution_contracts_v2_dormant',
    'statusKind', 'authoritative_execution_status',
    'grantsActionAuthority', false,
    'oneUseActionAuthority', false,
    'capability', 'kemerbet.deposit.submit.exact_2500_etb.one_use.v2',
    'actionKind', 'deposit_submission',
    'statusId', inserted_status.status_id::text,
    'statusSequence', inserted_status.status_sequence::text,
    'queryNonceDigest', p_query_nonce_digest,
    'assignmentId', selected_assignment.assignment_id::text,
    'assignmentBodyDigest', selected_assignment.assignment_body_digest,
    'authorityId', selected_assignment.authority_id::text,
    'authorityBodyDigest', selected_assignment.authority_body_digest,
    'activationEpoch', selected_assignment.activation_epoch::text,
    'intentId', selected_assignment.deposit_intent_id::text,
    'jobId', selected_assignment.execution_job_id::text,
    'attemptId', selected_assignment.execution_attempt_id::text,
    'platformAgentAccountId', selected_assignment.platform_agent_account_id::text,
    'enrollmentId', selected_assignment.enrollment_id::text,
    'enrollmentBodyDigest', selected_assignment.enrollment_body_digest,
    'noMoneyCertificateId', selected_assignment.certificate_id::text,
    'noMoneyCertificateBodyDigest', certificate_body_digest,
    'deviceId', selected_assignment.device_id,
    'deviceKeyId', selected_assignment.device_key_id,
    'executionSignerKeyId', selected_assignment.execution_signer_key_id,
    'platformCode', 'kemerbet',
    'pilotId', selected_assignment.pilot_revision_id::text,
    'pilotRevision', selected_assignment.pilot_revision::text,
    'pilotConfigDigest', selected_assignment.pilot_configuration_digest,
    'pilotReservationId', selected_assignment.pilot_reservation_id::text,
    'pilotReservationDigest', selected_assignment.pilot_reservation_digest,
    'amountMinorUnits', 2500,
    'currencyCode', 'ETB',
    'playerIdDigest', app.agent_platform_companion_execution_player_digest(
      selected_assignment.player_id_snapshot
    ),
    'fenceId', selected_assignment.fence_id::text,
    'databaseFenceState', fence_state,
    'databaseAttemptState', database_attempt_state,
    'databaseReconciliationState', reconciliation_state,
    'terminalState', terminal_state,
    'executionResultBodyDigest', selected_assignment.execution_result_body_digest,
    'providerResponseDigest', selected_assignment.provider_response_digest,
    'evidenceDigest', selected_assignment.evidence_digest,
    'databaseObservedAt', app.agent_platform_companion_timestamp(now_at),
    'serverIssuedAt', app.agent_platform_companion_timestamp(now_at),
    'serverValidUntil', app.agent_platform_companion_timestamp(valid_until)
  );
  update app.agent_platform_companion_execution_statuses status
     set status_body = built_body
   where status.status_id = inserted_status.status_id;
  return query select 'claimed'::text, built_body, null::jsonb;
end;
$$;

create function app.complete_agent_platform_companion_execution_status(
  p_status_body_digest text,
  p_signed_status jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  status_uuid uuid;
  selected_status app.agent_platform_companion_execution_statuses%rowtype;
  execution_signer_key_id text;
  now_at timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_status_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_signed_status) <> 'object'
    or pg_catalog.pg_column_size(p_signed_status) > 65536
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_status,
      array[
        'contractVersion', 'protocolMode', 'transcriptVersion', 'bodyDigestAlgorithm',
        'bodyDigest', 'signatureAlgorithm', 'signatureEncoding', 'signerKeyId', 'body',
        'signature'
      ]::text[]
    )
    or p_signed_status ->> 'contractVersion' <> '2'
    or p_signed_status ->> 'protocolMode'
      <> 'windows_companion_financial_execution_contracts_v2_dormant'
    or p_signed_status ->> 'transcriptVersion'
      <> 'agent-platform-companion-authoritative-execution-status-transcript-v2'
    or p_signed_status ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_status ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_status ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_status ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_status #>> '{body,statusId}'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  status_uuid := (p_signed_status #>> '{body,statusId}')::uuid;
  select status.* into selected_status
    from app.agent_platform_companion_execution_statuses status
   where status.status_id = status_uuid
   for update;
  if selected_status.status_id is null then return false; end if;
  if selected_status.signed_status is not null then
    return selected_status.status_body_digest = p_status_body_digest
      and selected_status.signed_status = p_signed_status;
  end if;
  select assignment.execution_signer_key_id into execution_signer_key_id
    from app.agent_platform_companion_execution_assignments assignment
   where assignment.assignment_id = selected_status.assignment_id;
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if selected_status.claim_lease_expires_at <= now_at
    or selected_status.valid_until <= now_at
    or selected_status.status_body <> p_signed_status -> 'body'
    or p_signed_status ->> 'bodyDigest' <> p_status_body_digest
    or p_signed_status ->> 'signerKeyId' <> execution_signer_key_id then
    return false;
  end if;
  update app.agent_platform_companion_execution_statuses status
     set status_body_digest = p_status_body_digest,
         signed_status = p_signed_status,
         signed_at = now_at,
         claim_lease_expires_at = now_at
   where status.status_id = selected_status.status_id;
  update app.agent_platform_companion_execution_http_requests request
     set response_state = 'completed', completed_at = now_at
   where request.replay_identity = selected_status.http_replay_identity;
  return true;
end;
$$;

alter table app.agent_platform_companion_execution_control enable row level security;
alter table app.agent_platform_companion_execution_control force row level security;
alter table app.agent_platform_companion_execution_http_requests enable row level security;
alter table app.agent_platform_companion_execution_http_requests force row level security;
alter table app.agent_platform_companion_execution_assignments enable row level security;
alter table app.agent_platform_companion_execution_assignments force row level security;
alter table app.agent_platform_companion_execution_statuses enable row level security;
alter table app.agent_platform_companion_execution_statuses force row level security;

alter table app.agent_platform_companion_execution_control owner to postgres;
alter table app.agent_platform_companion_execution_http_requests owner to postgres;
alter table app.agent_platform_companion_execution_assignments owner to postgres;
alter table app.agent_platform_companion_execution_statuses owner to postgres;

alter function app.agent_platform_companion_execution_valid_http_request(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz
) owner to postgres;
alter function app.agent_platform_companion_execution_certificate_is_active(
  uuid, text, text, text, timestamptz
) owner to postgres;
alter function app.agent_platform_companion_execution_encode_texts(text[]) owner to postgres;
alter function app.agent_platform_companion_execution_player_digest(text) owner to postgres;
alter function app.require_private_live_deposit_pilot_executor() owner to postgres;
alter function app.claim_agent_platform_companion_execution_assignment(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text, text, text, text
) owner to postgres;
alter function app.complete_agent_platform_companion_execution_assignment(
  text, jsonb, text, jsonb
) owner to postgres;
alter function app.claim_agent_platform_companion_execution_authority(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text, jsonb, jsonb
) owner to postgres;
alter function app.complete_agent_platform_companion_execution_authority(text, jsonb)
  owner to postgres;
alter function app.accept_agent_platform_companion_execution_result(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  jsonb, jsonb, jsonb, jsonb
) owner to postgres;
alter function app.claim_agent_platform_companion_execution_status(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text, jsonb, jsonb, jsonb, jsonb
) owner to postgres;
alter function app.complete_agent_platform_companion_execution_status(text, jsonb)
  owner to postgres;

revoke all privileges on table
  app.agent_platform_companion_execution_control,
  app.agent_platform_companion_execution_http_requests,
  app.agent_platform_companion_execution_assignments,
  app.agent_platform_companion_execution_statuses
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.agent_platform_companion_execution_valid_http_request(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz
  ),
  app.agent_platform_companion_execution_certificate_is_active(
    uuid, text, text, text, timestamptz
  ),
  app.agent_platform_companion_execution_encode_texts(text[]),
  app.agent_platform_companion_execution_player_digest(text),
  app.claim_agent_platform_companion_execution_assignment(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, text, text, text
  ),
  app.complete_agent_platform_companion_execution_assignment(text, jsonb, text, jsonb),
  app.claim_agent_platform_companion_execution_authority(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_authority(text, jsonb),
  app.accept_agent_platform_companion_execution_result(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    jsonb, jsonb, jsonb, jsonb
  ),
  app.claim_agent_platform_companion_execution_status(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_status(text, jsonb)
from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_beta_admission, fetanagent_beta_admission_runtime,
  fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_player_actions, fetanagent_player_actions_runtime,
  fetanagent_cbe_birr_shadow_worker,
  fetanagent_customer_web, fetanagent_customer_web_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant execute on function
  app.claim_agent_platform_companion_execution_assignment(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, text, text, text
  ),
  app.complete_agent_platform_companion_execution_assignment(text, jsonb, text, jsonb),
  app.claim_agent_platform_companion_execution_authority(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_authority(text, jsonb),
  app.accept_agent_platform_companion_execution_result(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    jsonb, jsonb, jsonb, jsonb
  ),
  app.claim_agent_platform_companion_execution_status(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
    text, jsonb, jsonb, jsonb, jsonb
  ),
  app.complete_agent_platform_companion_execution_status(text, jsonb)
to fetanagent_companion_device_bridge;

comment on table app.agent_platform_companion_execution_control is
  'Singleton execution transport control. Seeded disabled; this migration provides no arming function.';
comment on table app.agent_platform_companion_execution_assignments is
  'Private retained companion execution chain. Raw Player IDs and lease/pilot tokens never cross an untrusted or public boundary.';
comment on function app.claim_agent_platform_companion_execution_assignment(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text, text, text, text
) is
  'Authenticated paired-device poll. Returns no work while execution control is disabled; when active it leases exactly one fixed 25 ETB private-pilot command.';
comment on function app.claim_agent_platform_companion_execution_authority(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text, jsonb, jsonb
) is
  'Acquires the existing database final-action fence and returns one short-lived unsigned authority body for the separate execution signer.';
comment on function app.accept_agent_platform_companion_execution_result(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  jsonb, jsonb, jsonb, jsonb
) is
  'Accepts an exact device-signed post-fence result and atomically requires reconciliation. It never marks a deposit successful.';
comment on function app.claim_agent_platform_companion_execution_status(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz,
  text, jsonb, jsonb, jsonb, jsonb
) is
  'Builds a fresh database-derived non-authorizing recovery status for the exact signed execution chain.';

commit;
