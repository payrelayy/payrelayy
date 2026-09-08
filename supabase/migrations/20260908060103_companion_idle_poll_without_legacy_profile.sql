-- Accept authenticated, replay-protected idle polls before legacy profile setup.
-- No tables, credentials, grants, certificate validity, or financial switches change.
-- Every non-empty assignment response still requires the original full boundary.

create or replace function app.claim_agent_platform_companion_lookup_assignment(
  p_http_replay_identity text,
  p_http_request_body_digest text,
  p_http_request_id text,
  p_certificate_id text,
  p_device_id text,
  p_device_key_id text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz,
  p_server_signer_key_id text
)
returns table (
  claim_state text,
  assignment_body jsonb,
  signed_assignment jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  certificate_uuid uuid;
  selected_assignment app.agent_platform_companion_lookup_assignments%rowtype;
  built_body jsonb;
  now_at timestamptz;
  switch_count integer;
  switches_disabled boolean;
begin
  perform app.require_agent_platform_companion_bridge_session();
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_http_replay_identity is null
    or p_http_request_body_digest is null
    or p_http_request_id is null
    or p_certificate_id is null
    or p_device_id is null
    or p_device_key_id is null
    or p_request_issued_at is null
    or p_request_expires_at is null
    or p_assessed_at is null
    or p_server_signer_key_id is null
    or p_http_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_http_request_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_http_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_certificate_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_server_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_request_expires_at <= p_request_issued_at
    or p_request_expires_at > p_request_issued_at + interval '5 minutes'
    or p_assessed_at < p_request_issued_at - interval '30 seconds'
    or p_assessed_at >= p_request_expires_at
    or p_assessed_at <> pg_catalog.date_trunc('milliseconds', p_assessed_at)
    or p_assessed_at < now_at - interval '30 seconds'
    or p_assessed_at > now_at + interval '30 seconds' then
    return;
  end if;

  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then return; end if;
  -- An enrolled idle device has no legacy datacenter profile yet. Keep the
  -- no-money boundary here; require the full profile boundary only before
  -- returning or claiming a real assignment below.
  select count(*)::integer,
         coalesce(bool_and(feature.mode = 'disabled'), false)
    into switch_count, switches_disabled
    from app.feature_switches feature
   where feature.feature_key in (
     'cbe_birr_authoritative_verification',
     'deposit_execution',
     'payment_verification',
     'private_live_deposit_pilot',
     'telebirr_authoritative_verification'
   );
  if switch_count <> 5 or not switches_disabled then
    raise exception 'The companion idle poll requires every money switch to be disabled.';
  end if;
  if exists (
    select 1 from app.private_live_deposit_pilot_revisions pilot
     where pilot.status in ('draft', 'armed')
  ) then
    raise exception 'The companion idle poll requires no open private live-money pilot.';
  end if;

  begin
    certificate_uuid := p_certificate_id::uuid;
  exception when others then
    return;
  end;
  if not exists (
    select 1
      from app.agent_platform_companion_enrollment_certificates certificate
      join app.agent_platform_companion_server_signers signer
        on signer.id = certificate.server_signer_id
      left join app.agent_platform_companion_device_revocations device_revocation
        on device_revocation.certificate_id = certificate.certificate_id
      left join app.agent_platform_companion_server_signer_revocations signer_revocation
        on signer_revocation.server_signer_id = signer.id
     where certificate.certificate_id = certificate_uuid
       and certificate.device_id = p_device_id
       and certificate.device_key_id = p_device_key_id
       and certificate.certificate_signer_key_id = p_server_signer_key_id
       and certificate.valid_from <= p_assessed_at
       and certificate.valid_until > p_assessed_at
       and signer.signer_key_id = p_server_signer_key_id
       and signer.valid_from <= p_assessed_at
       and signer.valid_until > p_assessed_at
       and device_revocation.certificate_id is null
       and signer_revocation.server_signer_id is null
  ) then
    return;
  end if;

  begin
    insert into app.agent_platform_companion_http_request_replays (
      replay_identity, http_request_body_digest, request_id, certificate_id, canonical_path,
      issued_at, expires_at, received_at
    ) values (
      p_http_replay_identity, p_http_request_body_digest, p_http_request_id, certificate_uuid,
      '/v1/companion/device/lookup-assignments:poll', p_request_issued_at,
      p_request_expires_at, p_assessed_at
    );
  exception when unique_violation then
    return;
  end;

  update app.agent_platform_companion_lookup_assignments assignment
     set state = 'expired', claim_lease_expires_at = null
   where assignment.certificate_id = certificate_uuid
     and assignment.state in ('pending', 'claimed', 'signed')
     and assignment.expires_at <= p_assessed_at;

  select assignment.* into selected_assignment
    from app.agent_platform_companion_lookup_assignments assignment
   where assignment.certificate_id = certificate_uuid
     and assignment.state in ('pending', 'claimed', 'signed')
     and assignment.expires_at > p_assessed_at
   order by assignment.issued_at
   limit 1
   for update;

  if selected_assignment.assignment_id is null then
    return query select 'none'::text, null::jsonb, null::jsonb;
    return;
  end if;
  -- No profile, eligibility, assignment, or result authorization is relaxed.
  -- The preceding no-assignment response contains no Player IDs or command.
  perform app.require_private_owner_kemerbet_readiness_safe_boundary();
  if selected_assignment.state = 'signed' then
    return query select 'completed'::text,
                        selected_assignment.assignment_body,
                        selected_assignment.signed_assignment;
    return;
  end if;
  if selected_assignment.state = 'claimed'
    and selected_assignment.claim_lease_expires_at > p_assessed_at then
    return query select 'in_progress'::text, null::jsonb, null::jsonb;
    return;
  end if;
  if selected_assignment.state = 'claimed' then
    update app.agent_platform_companion_lookup_assignments assignment
       set state = 'pending',
           claim_lease_expires_at = null,
           assignment_body = null
     where assignment.assignment_id = selected_assignment.assignment_id
     returning * into selected_assignment;
  end if;

  select pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'protocolMode', 'local_companion_no_transfer_v1',
    'assignmentId', selected_assignment.assignment_id::text,
    'requestId', selected_assignment.owner_request_id::text,
    'certificateId', selected_assignment.certificate_id::text,
    'deviceId', selected_assignment.device_id,
    'deviceKeyId', selected_assignment.device_key_id,
    'platformCode', 'kemerbet',
    'assignmentKind', 'exact_five_player_lookup',
    'lookupMode', 'find_only',
    'playerIds', pg_catalog.jsonb_agg(member.player_id_snapshot order by member.member_ordinal),
    'currencyCode', 'ETB',
    'leaseNonceDigest', selected_assignment.lease_nonce_digest,
    'oneUse', true,
    'issuedAt', app.agent_platform_companion_timestamp(selected_assignment.issued_at),
    'expiresAt', app.agent_platform_companion_timestamp(selected_assignment.expires_at),
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
  ) into built_body
    from app.agent_platform_companion_lookup_members member
   where member.assignment_id = selected_assignment.assignment_id;

  if pg_catalog.jsonb_array_length(built_body -> 'playerIds') <> 5 then return; end if;
  update app.agent_platform_companion_lookup_assignments assignment
     set state = 'claimed',
         first_claimed_at = coalesce(assignment.first_claimed_at, p_assessed_at),
         last_claimed_at = p_assessed_at,
         claim_lease_expires_at = p_assessed_at + interval '30 seconds',
         assignment_body = built_body
   where assignment.assignment_id = selected_assignment.assignment_id;
  return query select 'claimed'::text, built_body, null::jsonb;
end;
$$;
