-- Dormant, read-only, single-Player Companion state. No bridge role is granted these
-- functions until the complete bot/selection path has passed integration review.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.telegram_player_validation_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  validation_request_id uuid not null
    references app.telegram_player_validation_requests (id) on delete restrict,
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
      on delete restrict,
  server_signer_id uuid not null
    references app.agent_platform_companion_server_signers (id) on delete restrict,
  device_id text not null check (device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_key_id text not null check (device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  lease_nonce_digest text not null unique
    check (lease_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text not null default 'claimed'
    check (state in ('claimed', 'signed', 'completed', 'review_required',
                    'expired', 'superseded')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  claim_lease_expires_at timestamptz,
  assignment_body jsonb not null check (
    jsonb_typeof(assignment_body) = 'object' and pg_column_size(assignment_body) <= 32768
  ),
  assignment_body_digest text unique
    check (assignment_body_digest is null or assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_assignment jsonb check (
    signed_assignment is null or
    (jsonb_typeof(signed_assignment) = 'object' and pg_column_size(signed_assignment) <= 65536)
  ),
  signed_at timestamptz,
  completed_at timestamptz,
  constraint telegram_player_validation_assignment_window check (
    expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'
  ),
  constraint telegram_player_validation_assignment_state_shape check (
    (state = 'claimed' and claim_lease_expires_at is not null
      and assignment_body_digest is null and signed_assignment is null
      and signed_at is null and completed_at is null)
    or (state = 'signed' and claim_lease_expires_at is null
      and assignment_body_digest is not null and signed_assignment is not null
      and signed_at is not null and completed_at is null)
    or (state in ('completed', 'review_required') and claim_lease_expires_at is null
      and assignment_body_digest is not null and signed_assignment is not null
      and signed_at is not null and completed_at is not null)
    or (state in ('expired', 'superseded') and claim_lease_expires_at is null
      and completed_at is null)
  )
);
create unique index telegram_player_validation_one_active_assignment_idx
  on app.telegram_player_validation_assignments ((true))
  where state in ('claimed', 'signed');
create index telegram_player_validation_assignment_request_idx
  on app.telegram_player_validation_assignments (validation_request_id, issued_at desc);
create index telegram_player_validation_assignment_certificate_idx
  on app.telegram_player_validation_assignments (certificate_id, issued_at desc);

create table app.telegram_player_validation_http_replays (
  replay_identity text primary key check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  request_id text not null unique check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  request_body_digest text not null unique
    check (request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
      on delete restrict,
  canonical_path text not null check (canonical_path in (
    '/v1/companion/device/player-validations:poll',
    '/v1/companion/device/player-validations:submit'
  )),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  received_at timestamptz not null,
  constraint telegram_player_validation_http_window check (
    expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'
    and received_at >= issued_at and received_at < expires_at
  )
);

create table app.telegram_player_validation_results (
  result_id text primary key check (result_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  assignment_id uuid not null unique
    references app.telegram_player_validation_assignments (assignment_id) on delete restrict,
  validation_request_id uuid not null unique
    references app.telegram_player_validation_requests (id) on delete restrict,
  result_replay_identity text not null unique
    check (result_replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  result_body_digest text not null unique
    check (result_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_result jsonb not null check (
    jsonb_typeof(signed_result) = 'object' and pg_column_size(signed_result) <= 65536
  ),
  outcome text not null check (outcome in ('found', 'review_required')),
  observed_at timestamptz not null,
  accepted_at timestamptz not null
);

create function app.reject_telegram_player_validation_evidence_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  raise exception 'Telegram Player validation evidence is append-only.';
end;
$$;
create trigger telegram_player_validation_http_replays_immutable
  before update or delete on app.telegram_player_validation_http_replays
  for each row execute function app.reject_telegram_player_validation_evidence_mutation();
create trigger telegram_player_validation_results_immutable
  before update or delete on app.telegram_player_validation_results
  for each row execute function app.reject_telegram_player_validation_evidence_mutation();
create trigger telegram_player_validation_http_replays_no_truncate
  before truncate on app.telegram_player_validation_http_replays
  for each statement execute function app.reject_telegram_player_validation_evidence_mutation();
create trigger telegram_player_validation_results_no_truncate
  before truncate on app.telegram_player_validation_results
  for each statement execute function app.reject_telegram_player_validation_evidence_mutation();

-- Match the companion contract's length-prefixed, domain-separated Player-ID digest.
create function app.telegram_player_validation_player_digest(p_player_id text)
returns text language plpgsql immutable security definer set search_path = pg_catalog
as $$
declare
  v_domain constant text := 'fetanagent:agent-platform-companion:kemerbet-player-id:v1';
  v_bytes bytea;
  v_hex text;
begin
  if p_player_id is null or p_player_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    return null;
  end if;
  v_bytes :=
    pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(pg_catalog.octet_length(v_domain)), 8, '0'), 'hex')
      || pg_catalog.convert_to(v_domain, 'UTF8')
    || pg_catalog.decode('00000001', 'hex') || pg_catalog.convert_to('2', 'UTF8')
    || pg_catalog.decode('0000000c', 'hex') || pg_catalog.convert_to('platformCode', 'UTF8')
    || pg_catalog.decode('0000000f', 'hex') || pg_catalog.convert_to('string:kemerbet', 'UTF8')
    || pg_catalog.decode('00000008', 'hex') || pg_catalog.convert_to('playerId', 'UTF8')
    || pg_catalog.decode(pg_catalog.lpad(
         pg_catalog.to_hex(pg_catalog.octet_length('string:' || p_player_id)), 8, '0'), 'hex')
    || pg_catalog.convert_to('string:' || p_player_id, 'UTF8');
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute 'select pg_catalog.encode(extensions.digest($1, ''sha256''), ''hex'')'
      into v_hex using v_bytes;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute 'select pg_catalog.encode(public.digest($1, ''sha256''), ''hex'')'
      into v_hex using v_bytes;
  else
    raise exception 'Player validation digest is unavailable.';
  end if;
  return 'sha256:' || v_hex;
end;
$$;

-- The bridge will call this only after authenticating the HTTP signature. Keeping
-- it private now lets SQL tests exercise lease/replay behavior without activating
-- the production endpoint or expanding the bridge role's exact ACL preflight.
create function app.claim_telegram_player_validation_assignment(
  p_http_replay_identity text, p_http_body_digest text, p_http_request_id text,
  p_certificate_id text, p_device_id text, p_device_key_id text,
  p_request_issued_at timestamptz, p_request_expires_at timestamptz,
  p_assessed_at timestamptz, p_server_signer_key_id text
)
returns table (claim_state text, assignment_body jsonb, signed_assignment jsonb)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_certificate_id uuid;
  v_certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  v_assignment app.telegram_player_validation_assignments%rowtype;
  v_request app.telegram_player_validation_requests%rowtype;
  v_candidate_request_id uuid;
  v_identity_id uuid;
  v_body jsonb;
  v_assignment_id uuid;
  v_expires_at timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_http_replay_identity is null or p_http_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_http_body_digest is null or p_http_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_http_request_id is null
    or p_http_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_certificate_id is null or p_certificate_id
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_device_id is null or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id is null or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_server_signer_key_id is null
    or p_server_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_request_issued_at is null or p_request_expires_at is null or p_assessed_at is null
    or p_request_expires_at <= p_request_issued_at
    or p_request_expires_at > p_request_issued_at + interval '5 minutes'
    or p_assessed_at < p_request_issued_at or p_assessed_at >= p_request_expires_at
    or p_assessed_at <> pg_catalog.date_trunc('milliseconds', p_assessed_at)
    or p_assessed_at < v_now - interval '30 seconds'
    or p_assessed_at > v_now + interval '30 seconds' then
    return;
  end if;
  v_certificate_id := p_certificate_id::uuid;
  select certificate.* into v_certificate
    from app.agent_platform_companion_enrollment_certificates certificate
    join app.agent_platform_companion_server_signers signer
      on signer.id = certificate.server_signer_id
    left join app.agent_platform_companion_device_revocations device_revocation
      on device_revocation.certificate_id = certificate.certificate_id
    left join app.agent_platform_companion_server_signer_revocations signer_revocation
      on signer_revocation.server_signer_id = signer.id
   where certificate.certificate_id = v_certificate_id
     and certificate.device_id = p_device_id
     and certificate.device_key_id = p_device_key_id
     and certificate.certificate_signer_key_id = p_server_signer_key_id
     and certificate.valid_from <= p_assessed_at
     and certificate.valid_until > p_assessed_at + interval '30 seconds'
     and signer.signer_key_id = p_server_signer_key_id
     and signer.valid_from <= p_assessed_at
     and signer.valid_until > p_assessed_at
     and device_revocation.certificate_id is null
     and signer_revocation.server_signer_id is null;
  if v_certificate.certificate_id is null then return; end if;

  -- Serialize only this read-only assignment lane; the financial bridge remains separate.
  perform pg_catalog.pg_advisory_xact_lock(193747, 1);
  begin
    insert into app.telegram_player_validation_http_replays (
      replay_identity, request_id, request_body_digest, certificate_id,
      canonical_path, issued_at, expires_at, received_at
    ) values (
      p_http_replay_identity, p_http_request_id, p_http_body_digest, v_certificate_id,
      '/v1/companion/device/player-validations:poll',
      p_request_issued_at, p_request_expires_at, p_assessed_at
    );
  exception when unique_violation then
    return;
  end;

  select assignment.* into v_assignment
    from app.telegram_player_validation_assignments assignment
   where assignment.state in ('claimed', 'signed')
   order by assignment.issued_at
   limit 1;
  if v_assignment.assignment_id is not null then
    select request.telegram_identity_id into v_identity_id
      from app.telegram_player_validation_requests request
     where request.id = v_assignment.validation_request_id;
    perform 1 from app.customer_identities identity
     where identity.id = v_identity_id for update;
    select request.* into v_request
      from app.telegram_player_validation_requests request
     where request.id = v_assignment.validation_request_id for update;
    select assignment.* into v_assignment
      from app.telegram_player_validation_assignments assignment
     where assignment.assignment_id = v_assignment.assignment_id for update;
    if v_assignment.state in ('claimed', 'signed')
      and (v_request.status <> 'pending' or v_assignment.expires_at <= p_assessed_at) then
      update app.telegram_player_validation_assignments assignment
         set state = case when v_request.status = 'pending'
                          then 'expired' else 'superseded' end,
             claim_lease_expires_at = null
       where assignment.assignment_id = v_assignment.assignment_id;
    elsif v_assignment.state in ('claimed', 'signed') then
      if v_assignment.certificate_id <> v_certificate_id then
        return query select 'in_progress'::text, null::jsonb, null::jsonb;
      elsif v_assignment.state = 'signed' then
        return query select 'completed'::text,
          v_assignment.assignment_body, v_assignment.signed_assignment;
      elsif v_assignment.claim_lease_expires_at > p_assessed_at then
        return query select 'in_progress'::text, null::jsonb, null::jsonb;
      else
        update app.telegram_player_validation_assignments assignment
           set claim_lease_expires_at = pg_catalog.least(
             p_assessed_at + interval '30 seconds', assignment.expires_at)
         where assignment.assignment_id = v_assignment.assignment_id;
        return query select 'claimed'::text, v_assignment.assignment_body, null::jsonb;
      end if;
      return;
    end if;
  end if;

  select request.id, request.telegram_identity_id
    into v_candidate_request_id, v_identity_id
    from app.telegram_player_validation_requests request
   where request.status = 'pending'
   order by request.requested_at, request.id
   limit 1;
  if v_candidate_request_id is null then
    return query select 'none'::text, null::jsonb, null::jsonb;
    return;
  end if;
  perform 1 from app.customer_identities identity
    join app.customers customer on customer.id = identity.customer_id
    join app.telegram_identities telegram_identity
      on telegram_identity.customer_identity_id = identity.id
   where identity.id = v_identity_id and identity.status = 'active'
     and customer.status = 'active'
     and identity.identity_kind = 'telegram'
     and identity.external_subject = telegram_identity.telegram_user_id::text
     and telegram_identity.private_chat_id = telegram_identity.telegram_user_id
   for update of identity, customer, telegram_identity;
  if not found then
    return query select 'none'::text, null::jsonb, null::jsonb;
    return;
  end if;
  select request.* into v_request
    from app.telegram_player_validation_requests request
   where request.id = v_candidate_request_id for update;
  if v_request.status <> 'pending' or v_request.telegram_identity_id <> v_identity_id then
    return query select 'none'::text, null::jsonb, null::jsonb;
    return;
  end if;
  v_assignment_id := pg_catalog.gen_random_uuid();
  v_expires_at := pg_catalog.least(
    p_assessed_at + interval '5 minutes', v_certificate.valid_until);
  v_body := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'protocolMode', 'local_companion_no_transfer_v1',
    'assignmentId', v_assignment_id::text,
    'validationRequestId', v_request.id::text,
    'certificateId', v_certificate_id::text,
    'deviceId', p_device_id,
    'deviceKeyId', p_device_key_id,
    'platformCode', 'kemerbet',
    'assignmentKind', 'single_telegram_player_validation',
    'lookupMode', 'find_only',
    'playerId', v_request.player_id,
    'currencyCode', 'ETB',
    'leaseNonceDigest', app.agent_platform_companion_lookup_sha256(
      pg_catalog.gen_random_uuid()::text),
    'oneUse', true,
    'issuedAt', app.agent_platform_companion_timestamp(p_assessed_at),
    'expiresAt', app.agent_platform_companion_timestamp(v_expires_at),
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
  insert into app.telegram_player_validation_assignments (
    assignment_id, validation_request_id, certificate_id, server_signer_id,
    device_id, device_key_id, lease_nonce_digest, issued_at, expires_at,
    claim_lease_expires_at, assignment_body
  ) values (
    v_assignment_id, v_request.id, v_certificate_id, v_certificate.server_signer_id,
    p_device_id, p_device_key_id, v_body ->> 'leaseNonceDigest',
    p_assessed_at, v_expires_at,
    pg_catalog.least(p_assessed_at + interval '30 seconds', v_expires_at), v_body
  );
  return query select 'claimed'::text, v_body, null::jsonb;
end;
$$;

create function app.complete_telegram_player_validation_assignment(
  p_assignment_body_digest text, p_signed_assignment jsonb
)
returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_assignment_id uuid;
  v_identity_id uuid;
  v_request app.telegram_player_validation_requests%rowtype;
  v_assignment app.telegram_player_validation_assignments%rowtype;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_assignment_body_digest is null
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_signed_assignment is null
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.pg_column_size(p_signed_assignment) > 65536
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_assignment,
      array['contractVersion','protocolMode','transcriptVersion',
        'bodyDigestAlgorithm','bodyDigest','signatureAlgorithm',
        'signatureEncoding','signerKeyId','body','signature']::text[])
    or p_signed_assignment ->> 'contractVersion' <> '1'
    or p_signed_assignment ->> 'protocolMode' <> 'local_companion_no_transfer_v1'
    or p_signed_assignment ->> 'transcriptVersion'
       <> 'agent-platform-companion-player-validation-assignment-transcript-v1'
    or p_signed_assignment ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_assignment ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_assignment ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_assignment ->> 'signature' is null
    or p_signed_assignment ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_assignment ->> 'bodyDigest' is distinct from p_assignment_body_digest
    or p_signed_assignment #>> '{body,assignmentId}'
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_assignment_id := (p_signed_assignment #>> '{body,assignmentId}')::uuid;
  select request.telegram_identity_id into v_identity_id
    from app.telegram_player_validation_assignments assignment
    join app.telegram_player_validation_requests request
      on request.id = assignment.validation_request_id
   where assignment.assignment_id = v_assignment_id;
  if v_identity_id is null then return false; end if;
  perform 1 from app.customer_identities identity
   where identity.id = v_identity_id for update;
  select request.* into v_request
    from app.telegram_player_validation_requests request
    join app.telegram_player_validation_assignments assignment
      on assignment.validation_request_id = request.id
   where assignment.assignment_id = v_assignment_id
   for update of request;
  select assignment.* into v_assignment
    from app.telegram_player_validation_assignments assignment
   where assignment.assignment_id = v_assignment_id for update;
  if v_request.status <> 'pending'
    or v_assignment.validation_request_id <> v_request.id
    or v_assignment.assignment_body is distinct from (p_signed_assignment -> 'body')
    or v_assignment.expires_at <= v_now
    or p_signed_assignment ->> 'signerKeyId' is distinct from (
      select signer.signer_key_id
        from app.agent_platform_companion_server_signers signer
       where signer.id = v_assignment.server_signer_id)
    or not exists (
      select 1 from app.agent_platform_companion_enrollment_certificates certificate
        join app.agent_platform_companion_server_signers signer
          on signer.id = certificate.server_signer_id
        left join app.agent_platform_companion_device_revocations device_revocation
          on device_revocation.certificate_id = certificate.certificate_id
        left join app.agent_platform_companion_server_signer_revocations signer_revocation
          on signer_revocation.server_signer_id = signer.id
       where certificate.certificate_id = v_assignment.certificate_id
         and certificate.server_signer_id = v_assignment.server_signer_id
         and certificate.device_id = v_assignment.device_id
         and certificate.device_key_id = v_assignment.device_key_id
         and certificate.valid_from <= v_now and certificate.valid_until > v_now
         and signer.valid_from <= v_now and signer.valid_until > v_now
         and device_revocation.certificate_id is null
         and signer_revocation.server_signer_id is null
    ) then
    return false;
  end if;
  if v_assignment.state = 'signed' then
    return v_assignment.assignment_body_digest = p_assignment_body_digest
      and v_assignment.signed_assignment = p_signed_assignment;
  end if;
  if v_assignment.state <> 'claimed'
    or v_assignment.claim_lease_expires_at <= v_now then
    return false;
  end if;
  update app.telegram_player_validation_assignments assignment
     set state = 'signed', claim_lease_expires_at = null,
         assignment_body_digest = p_assignment_body_digest,
         signed_assignment = p_signed_assignment, signed_at = v_now
   where assignment.assignment_id = v_assignment_id;
  return true;
end;
$$;

create function app.release_telegram_player_validation_assignment(p_assignment_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_assignment_id is null or p_assignment_id
     !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  update app.telegram_player_validation_assignments assignment
     set state = 'expired', claim_lease_expires_at = null
   where assignment.assignment_id = p_assignment_id::uuid
     and assignment.state = 'claimed';
  return found;
end;
$$;

create function app.accept_telegram_player_validation_result(
  p_http_replay_identity text, p_http_body_digest text, p_http_request_id text,
  p_result_replay_identity text, p_assignment_id text, p_assignment_body_digest text,
  p_result_id text, p_result_body_digest text, p_certificate_id text,
  p_device_id text, p_device_key_id text,
  p_request_issued_at timestamptz, p_request_expires_at timestamptz,
  p_assessed_at timestamptz, p_signed_assignment jsonb, p_signed_result jsonb
)
returns table (accepted boolean, replayed boolean)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_assignment_id uuid;
  v_certificate_id uuid;
  v_identity_id uuid;
  v_selection_origin uuid;
  v_request app.telegram_player_validation_requests%rowtype;
  v_assignment app.telegram_player_validation_assignments%rowtype;
  v_existing app.telegram_player_validation_results%rowtype;
  v_observed_at timestamptz;
  v_outcome text;
  v_body jsonb;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_http_replay_identity is null or p_http_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_http_body_digest is null or p_http_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_http_request_id is null
    or p_http_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_result_replay_identity is null
    or p_result_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_assignment_body_digest is null
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_result_body_digest is null
    or p_result_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_assignment_id is null or p_assignment_id
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_certificate_id is null or p_certificate_id
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_result_id is null or p_result_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_id is null or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id is null or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_request_issued_at is null or p_request_expires_at is null or p_assessed_at is null
    or p_request_expires_at <= p_request_issued_at
    or p_request_expires_at > p_request_issued_at + interval '5 minutes'
    or p_assessed_at < p_request_issued_at or p_assessed_at >= p_request_expires_at
    or p_assessed_at <> pg_catalog.date_trunc('milliseconds', p_assessed_at)
    or p_assessed_at < v_now - interval '30 seconds'
    or p_assessed_at > v_now + interval '30 seconds'
    or p_signed_assignment is null or p_signed_result is null
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_result) <> 'object'
    or pg_catalog.pg_column_size(p_signed_assignment) > 65536
    or pg_catalog.pg_column_size(p_signed_result) > 65536 then
    return;
  end if;
  v_body := p_signed_result -> 'body';
  if not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_result, array['contractVersion','protocolMode','transcriptVersion',
        'bodyDigestAlgorithm','bodyDigest','signatureAlgorithm','signatureEncoding',
        'deviceKeyId','body','signature']::text[])
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      v_body, array['contractVersion','protocolMode','resultId','assignmentId',
        'assignmentBodyDigest','validationRequestId','certificateId','deviceId',
        'deviceKeyId','platformCode','assignmentKind','lookupMode','currencyCode',
        'playerIdDigest','outcome','evidenceKind','observedAt',
        'accountMutationAllowed','balanceMutationAllowed','providerMutationAllowed',
        'paymentAllowed','depositAllowed','withdrawAllowed','transferAllowed',
        'settlementAllowed','finalActionAllowed','financialActionAllowed',
        'moneyMovementAllowed','transferDisabled','identifiersRedacted',
        'moneyMoved']::text[])
    or p_signed_result ->> 'contractVersion' is distinct from '1'
    or p_signed_result ->> 'protocolMode' is distinct from 'local_companion_no_transfer_v1'
    or p_signed_result ->> 'transcriptVersion' is distinct from
       'agent-platform-companion-player-validation-result-transcript-v1'
    or p_signed_result ->> 'bodyDigestAlgorithm' is distinct from 'sha256'
    or p_signed_result ->> 'signatureAlgorithm' is distinct from 'ecdsa-p256-sha256'
    or p_signed_result ->> 'signatureEncoding' is distinct from 'ieee-p1363-base64url'
    or p_signed_result ->> 'signature' is null
    or p_signed_result ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_result ->> 'bodyDigest' is distinct from p_result_body_digest
    or p_signed_result ->> 'deviceKeyId' is distinct from p_device_key_id
    or v_body ->> 'contractVersion' is distinct from '1'
    or v_body ->> 'protocolMode' is distinct from 'local_companion_no_transfer_v1'
    or v_body ->> 'resultId' is distinct from p_result_id
    or v_body ->> 'assignmentId' is distinct from p_assignment_id
    or v_body ->> 'assignmentBodyDigest' is distinct from p_assignment_body_digest
    or v_body ->> 'certificateId' is distinct from p_certificate_id
    or v_body ->> 'deviceId' is distinct from p_device_id
    or v_body ->> 'deviceKeyId' is distinct from p_device_key_id
    or v_body ->> 'platformCode' is distinct from 'kemerbet'
    or v_body ->> 'assignmentKind' is distinct from 'single_telegram_player_validation'
    or v_body ->> 'lookupMode' is distinct from 'find_only'
    or v_body ->> 'currencyCode' is distinct from 'ETB'
    or v_body -> 'accountMutationAllowed' is distinct from 'false'::jsonb
    or v_body -> 'balanceMutationAllowed' is distinct from 'false'::jsonb
    or v_body -> 'providerMutationAllowed' is distinct from 'false'::jsonb
    or v_body -> 'paymentAllowed' is distinct from 'false'::jsonb
    or v_body -> 'depositAllowed' is distinct from 'false'::jsonb
    or v_body -> 'withdrawAllowed' is distinct from 'false'::jsonb
    or v_body -> 'transferAllowed' is distinct from 'false'::jsonb
    or v_body -> 'settlementAllowed' is distinct from 'false'::jsonb
    or v_body -> 'finalActionAllowed' is distinct from 'false'::jsonb
    or v_body -> 'financialActionAllowed' is distinct from 'false'::jsonb
    or v_body -> 'moneyMovementAllowed' is distinct from 'false'::jsonb
    or v_body -> 'transferDisabled' is distinct from 'true'::jsonb
    or v_body -> 'identifiersRedacted' is distinct from 'true'::jsonb
    or v_body -> 'moneyMoved' is distinct from 'false'::jsonb then
    return;
  end if;
  v_assignment_id := p_assignment_id::uuid;
  v_certificate_id := p_certificate_id::uuid;
  begin
    v_observed_at := (v_body ->> 'observedAt')::timestamptz;
  exception when others then
    return;
  end;
  v_outcome := v_body ->> 'outcome';
  if v_outcome is null or v_outcome not in ('found','review_required')
    or (v_outcome = 'found' and v_body ->> 'evidenceKind'
        is distinct from 'exact_id_empty_etb_form')
    or (v_outcome = 'review_required' and v_body ->> 'evidenceKind'
        is distinct from 'inconclusive') then
    return;
  end if;

  select request.telegram_identity_id into v_identity_id
    from app.telegram_player_validation_assignments assignment
    join app.telegram_player_validation_requests request
      on request.id = assignment.validation_request_id
   where assignment.assignment_id = v_assignment_id;
  if v_identity_id is null then return; end if;
  perform 1 from app.customer_identities identity
   where identity.id = v_identity_id for update;
  select request.* into v_request
    from app.telegram_player_validation_requests request
    join app.telegram_player_validation_assignments assignment
      on assignment.validation_request_id = request.id
   where assignment.assignment_id = v_assignment_id for update of request;
  select assignment.* into v_assignment
    from app.telegram_player_validation_assignments assignment
   where assignment.assignment_id = v_assignment_id for update;
  if v_request.id is null or v_assignment.assignment_id is null then return; end if;

  -- A fresh signed HTTP request is required even for an idempotent result retry.
  begin
    insert into app.telegram_player_validation_http_replays (
      replay_identity, request_id, request_body_digest, certificate_id,
      canonical_path, issued_at, expires_at, received_at
    ) values (
      p_http_replay_identity, p_http_request_id, p_http_body_digest, v_certificate_id,
      '/v1/companion/device/player-validations:submit',
      p_request_issued_at, p_request_expires_at, p_assessed_at
    );
  exception when unique_violation then
    return;
  end;
  select result.* into v_existing
    from app.telegram_player_validation_results result
   where result.result_replay_identity = p_result_replay_identity for share;
  if v_existing.result_id is not null then
    if v_existing.assignment_id = v_assignment_id
      and v_existing.result_id = p_result_id
      and v_existing.result_body_digest = p_result_body_digest
      and v_existing.signed_result = p_signed_result
      and v_assignment.signed_assignment = p_signed_assignment then
      return query select true, true;
    end if;
    return;
  end if;

  select selection.origin_inbound_event_id into v_selection_origin
    from app.telegram_player_selections selection
   where selection.telegram_identity_id = v_identity_id;
  if v_request.status <> 'pending'
    or v_assignment.state <> 'signed'
    or v_assignment.validation_request_id <> v_request.id
    or v_assignment.certificate_id <> v_certificate_id
    or v_assignment.device_id <> p_device_id
    or v_assignment.device_key_id <> p_device_key_id
    or v_assignment.assignment_body_digest <> p_assignment_body_digest
    or v_assignment.signed_assignment <> p_signed_assignment
    or v_assignment.expires_at <= p_assessed_at
    or v_selection_origin is distinct from v_request.selection_origin_inbound_event_id
    or v_body ->> 'validationRequestId' is distinct from v_request.id::text
    or v_body ->> 'playerIdDigest' is distinct from
       app.telegram_player_validation_player_digest(v_request.player_id)
    or v_observed_at < v_assignment.issued_at - interval '30 seconds'
    or v_observed_at >= v_assignment.expires_at + interval '30 seconds'
    or v_observed_at > p_assessed_at + interval '30 seconds'
    or not exists (
      select 1 from app.agent_platform_companion_enrollment_certificates certificate
        join app.agent_platform_companion_server_signers signer
          on signer.id = certificate.server_signer_id
        left join app.agent_platform_companion_device_revocations device_revocation
          on device_revocation.certificate_id = certificate.certificate_id
        left join app.agent_platform_companion_server_signer_revocations signer_revocation
          on signer_revocation.server_signer_id = signer.id
       where certificate.certificate_id = v_certificate_id
         and certificate.server_signer_id = v_assignment.server_signer_id
         and certificate.device_id = p_device_id
         and certificate.device_key_id = p_device_key_id
         and certificate.valid_from <= p_assessed_at
         and certificate.valid_until > p_assessed_at
         and signer.valid_from <= p_assessed_at
         and signer.valid_until > p_assessed_at
         and device_revocation.certificate_id is null
         and signer_revocation.server_signer_id is null
    ) then
    return;
  end if;
  insert into app.telegram_player_validation_results (
    result_id, assignment_id, validation_request_id, result_replay_identity,
    result_body_digest, signed_result, outcome, observed_at, accepted_at
  ) values (
    p_result_id, v_assignment_id, v_request.id, p_result_replay_identity,
    p_result_body_digest, p_signed_result, v_outcome, v_observed_at, p_assessed_at
  );
  update app.telegram_player_validation_assignments assignment
     set state = case when v_outcome = 'found' then 'completed' else 'review_required' end,
         completed_at = p_assessed_at
   where assignment.assignment_id = v_assignment_id;
  update app.telegram_player_validation_requests request
     set status = case when v_outcome = 'found' then 'validated' else 'review_required' end,
         completed_at = p_assessed_at
   where request.id = v_request.id and request.status = 'pending';
  if not found then raise exception 'The Player validation request changed concurrently.'; end if;
  return query select true, false;
end;
$$;

alter table app.telegram_player_validation_assignments owner to postgres;
alter table app.telegram_player_validation_http_replays owner to postgres;
alter table app.telegram_player_validation_results owner to postgres;
alter table app.telegram_player_validation_assignments enable row level security;
alter table app.telegram_player_validation_assignments force row level security;
alter table app.telegram_player_validation_http_replays enable row level security;
alter table app.telegram_player_validation_http_replays force row level security;
alter table app.telegram_player_validation_results enable row level security;
alter table app.telegram_player_validation_results force row level security;
alter function app.reject_telegram_player_validation_evidence_mutation() owner to postgres;
alter function app.telegram_player_validation_player_digest(text) owner to postgres;
alter function app.claim_telegram_player_validation_assignment(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text
) owner to postgres;
alter function app.complete_telegram_player_validation_assignment(text,jsonb) owner to postgres;
alter function app.release_telegram_player_validation_assignment(text) owner to postgres;
alter function app.accept_telegram_player_validation_result(
  text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,timestamptz,jsonb,jsonb
) owner to postgres;
revoke all on table app.telegram_player_validation_assignments,
  app.telegram_player_validation_http_replays, app.telegram_player_validation_results
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
revoke all on function app.reject_telegram_player_validation_evidence_mutation(),
  app.telegram_player_validation_player_digest(text),
  app.claim_telegram_player_validation_assignment(
    text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text),
  app.complete_telegram_player_validation_assignment(text,jsonb),
  app.release_telegram_player_validation_assignment(text),
  app.accept_telegram_player_validation_result(
    text,text,text,text,text,text,text,text,text,text,text,
    timestamptz,timestamptz,timestamptz,jsonb,jsonb)
  from public, anon, authenticated, service_role,
       fetanagent_player_actions, fetanagent_player_actions_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

comment on table app.telegram_player_validation_assignments is
  'Dormant read-only Player lookup lease state; no money or beneficiary selection authority.';
comment on table app.telegram_player_validation_results is
  'Immutable signed-result evidence; storing found never changes the saved Player ID.';
commit;
