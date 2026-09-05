-- Bound client-forward timestamps while preserving strict expiry, certificate validity, and replay uniqueness.
alter table app.agent_platform_companion_http_request_replays
  drop constraint agent_platform_companion_http_request_window_check;

alter table app.agent_platform_companion_http_request_replays
  add constraint agent_platform_companion_http_request_window_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '5 minutes'
    and received_at >= issued_at - interval '30 seconds'
    and received_at < expires_at
  );

comment on constraint agent_platform_companion_http_request_window_check
  on app.agent_platform_companion_http_request_replays is
  'Allows at most 30 seconds of client-forward clock skew while keeping expiry strict.';

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
  perform app.require_private_owner_kemerbet_readiness_safe_boundary();

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

create or replace function app.accept_agent_platform_companion_lookup_result(
  p_http_replay_identity text,
  p_http_request_body_digest text,
  p_http_request_id text,
  p_result_replay_identity text,
  p_assignment_id text,
  p_assignment_body_digest text,
  p_result_id text,
  p_result_body_digest text,
  p_certificate_id text,
  p_device_id text,
  p_device_key_id text,
  p_request_issued_at timestamptz,
  p_request_expires_at timestamptz,
  p_assessed_at timestamptz,
  p_signed_assignment jsonb,
  p_signed_result jsonb
)
returns table (accepted boolean, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  assignment_uuid uuid;
  certificate_uuid uuid;
  selected_assignment app.agent_platform_companion_lookup_assignments%rowtype;
  existing_result app.agent_platform_companion_lookup_results%rowtype;
  observed_at timestamptz;
  found_total integer;
  not_found_total integer;
  review_total integer;
  item_count integer;
  distinct_digest_count integer;
  index_match boolean;
  now_at timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  if p_http_replay_identity is null
    or p_http_request_body_digest is null
    or p_http_request_id is null
    or p_result_replay_identity is null
    or p_assignment_id is null
    or p_assignment_body_digest is null
    or p_result_id is null
    or p_result_body_digest is null
    or p_certificate_id is null
    or p_device_id is null
    or p_device_key_id is null
    or p_request_issued_at is null
    or p_request_expires_at is null
    or p_assessed_at is null
    or p_signed_assignment is null
    or p_signed_result is null
    or p_http_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_http_request_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_http_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_result_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_result_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_result_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_assignment_id
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_certificate_id
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_device_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_device_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_request_expires_at <= p_request_issued_at
    or p_request_expires_at > p_request_issued_at + interval '5 minutes'
    or p_assessed_at < p_request_issued_at - interval '30 seconds'
    or p_assessed_at >= p_request_expires_at
    or p_assessed_at <> pg_catalog.date_trunc('milliseconds', p_assessed_at)
    or p_assessed_at < now_at - interval '30 seconds'
    or p_assessed_at > now_at + interval '30 seconds'
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.jsonb_typeof(p_signed_result) <> 'object'
    or pg_catalog.pg_column_size(p_signed_assignment) > 65536
    or pg_catalog.pg_column_size(p_signed_result) > 65536
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_result,
      array[
        'contractVersion', 'protocolMode', 'transcriptVersion', 'bodyDigestAlgorithm',
        'bodyDigest', 'signatureAlgorithm', 'signatureEncoding', 'deviceKeyId', 'body',
        'signature'
      ]::text[]
    )
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_result -> 'body',
      array[
        'contractVersion', 'protocolMode', 'resultId', 'assignmentId',
        'assignmentBodyDigest', 'requestId', 'certificateId', 'deviceId', 'deviceKeyId',
        'platformCode', 'assignmentKind', 'lookupMode', 'currencyCode', 'items',
        'foundCount', 'notFoundCount', 'reviewRequiredCount', 'observedAt',
        'accountMutationAllowed', 'balanceMutationAllowed', 'providerMutationAllowed',
        'paymentAllowed', 'depositAllowed', 'withdrawAllowed', 'transferAllowed',
        'settlementAllowed', 'finalActionAllowed', 'financialActionAllowed',
        'moneyMovementAllowed', 'transferDisabled', 'identifiersRedacted', 'moneyMoved'
      ]::text[]
    )
    or p_signed_result ->> 'contractVersion' <> '1'
    or p_signed_result ->> 'protocolMode' <> 'local_companion_no_transfer_v1'
    or p_signed_result ->> 'transcriptVersion'
      <> 'agent-platform-companion-lookup-result-transcript-v1'
    or p_signed_result ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_result ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_result ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_result ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$'
    or p_signed_result #>> '{body,contractVersion}' <> '1'
    or p_signed_result #>> '{body,protocolMode}' <> 'local_companion_no_transfer_v1'
    or p_signed_result #>> '{body,accountMutationAllowed}' <> 'false'
    or p_signed_result #>> '{body,balanceMutationAllowed}' <> 'false'
    or p_signed_result #>> '{body,providerMutationAllowed}' <> 'false'
    or p_signed_result #>> '{body,paymentAllowed}' <> 'false'
    or p_signed_result #>> '{body,depositAllowed}' <> 'false'
    or p_signed_result #>> '{body,withdrawAllowed}' <> 'false'
    or p_signed_result #>> '{body,transferAllowed}' <> 'false'
    or p_signed_result #>> '{body,settlementAllowed}' <> 'false'
    or p_signed_result #>> '{body,finalActionAllowed}' <> 'false'
    or p_signed_result #>> '{body,financialActionAllowed}' <> 'false'
    or p_signed_result #>> '{body,moneyMovementAllowed}' <> 'false'
    or p_signed_result #>> '{body,transferDisabled}' <> 'true'
    or p_signed_result #>> '{body,identifiersRedacted}' <> 'true'
    or p_signed_result #>> '{body,moneyMoved}' <> 'false' then
    return;
  end if;
  assignment_uuid := p_assignment_id::uuid;
  certificate_uuid := p_certificate_id::uuid;

  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then return; end if;
  perform app.require_private_owner_kemerbet_readiness_safe_boundary();

  begin
    insert into app.agent_platform_companion_http_request_replays (
      replay_identity, http_request_body_digest, request_id, certificate_id, canonical_path,
      issued_at, expires_at, received_at
    )
    values (
      p_http_replay_identity, p_http_request_body_digest, p_http_request_id,
      certificate_uuid, '/v1/companion/device/lookup-results:submit',
      p_request_issued_at, p_request_expires_at, p_assessed_at
    );
  exception when unique_violation then
    return;
  end;

  select result.* into existing_result
    from app.agent_platform_companion_lookup_results result
   where result.result_replay_identity = p_result_replay_identity
   for share;
  if existing_result.result_id is not null then
    if existing_result.assignment_id = assignment_uuid
      and existing_result.result_id = p_result_id
      and existing_result.result_body_digest = p_result_body_digest
      and existing_result.signed_result = p_signed_result then
      return query select true, true;
    end if;
    return;
  end if;

  select assignment.* into selected_assignment
    from app.agent_platform_companion_lookup_assignments assignment
   where assignment.assignment_id = assignment_uuid
   for update;
  if selected_assignment.assignment_id is null
    or selected_assignment.state <> 'signed'
    or selected_assignment.expires_at <= p_assessed_at
    or selected_assignment.certificate_id <> certificate_uuid
    or selected_assignment.device_id <> p_device_id
    or selected_assignment.device_key_id <> p_device_key_id
    or selected_assignment.assignment_body_digest <> p_assignment_body_digest
    or selected_assignment.signed_assignment <> p_signed_assignment
    or p_signed_result ->> 'bodyDigest' <> p_result_body_digest
    or p_signed_result ->> 'deviceKeyId' <> p_device_key_id
    or p_signed_result #>> '{body,resultId}' <> p_result_id
    or p_signed_result #>> '{body,assignmentId}' <> p_assignment_id
    or p_signed_result #>> '{body,assignmentBodyDigest}' <> p_assignment_body_digest
    or p_signed_result #>> '{body,requestId}' <> selected_assignment.owner_request_id::text
    or p_signed_result #>> '{body,certificateId}' <> p_certificate_id
    or p_signed_result #>> '{body,deviceId}' <> p_device_id
    or p_signed_result #>> '{body,deviceKeyId}' <> p_device_key_id
    or p_signed_result #>> '{body,platformCode}' <> 'kemerbet'
    or p_signed_result #>> '{body,assignmentKind}' <> 'exact_five_player_lookup'
    or p_signed_result #>> '{body,lookupMode}' <> 'find_only'
    or p_signed_result #>> '{body,currencyCode}' <> 'ETB'
    or p_signed_result #>> '{body,identifiersRedacted}' <> 'true'
    or p_signed_result #>> '{body,transferDisabled}' <> 'true'
    or p_signed_result #>> '{body,moneyMoved}' <> 'false' then
    return;
  end if;
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
       and certificate.server_signer_id = selected_assignment.server_signer_id
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

  begin
    observed_at := (p_signed_result #>> '{body,observedAt}')::timestamptz;
    found_total := (p_signed_result #>> '{body,foundCount}')::integer;
    not_found_total := (p_signed_result #>> '{body,notFoundCount}')::integer;
    review_total := (p_signed_result #>> '{body,reviewRequiredCount}')::integer;
  exception when others then
    return;
  end;
  if observed_at < selected_assignment.issued_at - interval '30 seconds'
    or observed_at >= selected_assignment.expires_at + interval '30 seconds'
    or observed_at > p_assessed_at + interval '30 seconds'
    or found_total not between 0 and 5
    or not_found_total not between 0 and 5
    or review_total not between 0 and 5
    or found_total + not_found_total + review_total <> 5
    or pg_catalog.jsonb_typeof(p_signed_result #> '{body,items}') <> 'array'
    or pg_catalog.jsonb_array_length(p_signed_result #> '{body,items}') <> 5 then
    return;
  end if;

  select count(*)::integer,
         count(distinct item ->> 'playerIdDigest')::integer,
         pg_catalog.bool_and(
           case when item ->> 'playerIndex' ~ '^[0-4]$'
             then (item ->> 'playerIndex')::integer = ordinal - 1
             else false
           end
         ),
         count(*) filter (where item ->> 'outcome' = 'found')::integer,
         count(*) filter (where item ->> 'outcome' = 'not_found')::integer,
         count(*) filter (where item ->> 'outcome' = 'review_required')::integer
    into item_count, distinct_digest_count, index_match,
         found_total, not_found_total, review_total
    from pg_catalog.jsonb_array_elements(p_signed_result #> '{body,items}')
         with ordinality as items(item, ordinal)
   where pg_catalog.jsonb_typeof(item) = 'object'
     and app.agent_platform_companion_lookup_jsonb_exact_keys(
       item, array['playerIndex', 'playerIdDigest', 'outcome']::text[]
     )
     and item ->> 'playerIdDigest' ~ '^sha256:[0-9a-f]{64}$'
     and item ->> 'outcome' in ('found', 'not_found', 'review_required')
     and item ->> 'playerIndex' ~ '^[0-4]$';
  if item_count <> 5 or distinct_digest_count <> 5 or not index_match
    or found_total <> (p_signed_result #>> '{body,foundCount}')::integer
    or not_found_total <> (p_signed_result #>> '{body,notFoundCount}')::integer
    or review_total <> (p_signed_result #>> '{body,reviewRequiredCount}')::integer then
    return;
  end if;

  insert into app.agent_platform_companion_lookup_results (
    result_id, assignment_id, certificate_id, result_replay_identity, result_body_digest,
    signed_result, found_count, not_found_count, review_required_count, observed_at, accepted_at
  ) values (
    p_result_id, assignment_uuid, certificate_uuid, p_result_replay_identity,
    p_result_body_digest, p_signed_result, found_total, not_found_total, review_total,
    observed_at, p_assessed_at
  );
  update app.agent_platform_companion_lookup_assignments assignment
     set state = case when review_total = 0 and not_found_total = 0
                        then 'completed' else 'review_required' end,
         found_count = found_total,
         not_found_count = not_found_total,
         review_required_count = review_total,
         completed_at = p_assessed_at
   where assignment.assignment_id = assignment_uuid;
  return query select true, false;
end;
$$;
