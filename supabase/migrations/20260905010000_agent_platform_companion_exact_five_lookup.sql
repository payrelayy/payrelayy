-- Signed, exact-five, read-only KemerBet lookup assignment and result boundary.
--
-- Raw Player IDs exist only in the private assignment-member snapshot and the server-signed
-- assignment delivered to the paired Windows companion. Accepted results contain only Player-ID
-- digests, bounded outcomes, and aggregate counts. Every money switch must remain disabled; this
-- migration creates no amount, note, transfer, settlement, execution, wallet, or provider-credential
-- authority.

begin;

create table app.agent_platform_companion_lookup_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  owner_request_id uuid not null unique,
  created_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  server_signer_id uuid not null
    references app.agent_platform_companion_server_signers (id) on delete restrict,
  device_id text not null,
  device_key_id text not null,
  platform_code text not null default 'kemerbet' check (platform_code = 'kemerbet'),
  assignment_kind text not null default 'exact_five_player_lookup'
    check (assignment_kind = 'exact_five_player_lookup'),
  lookup_mode text not null default 'find_only' check (lookup_mode = 'find_only'),
  currency_code character(3) not null default 'ETB' check (currency_code = 'ETB'),
  lease_nonce_digest text not null unique
    check (lease_nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  one_use boolean not null default true check (one_use),
  state text not null default 'pending'
    check (state in ('pending', 'claimed', 'signed', 'completed', 'review_required', 'expired')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  first_claimed_at timestamptz,
  last_claimed_at timestamptz,
  claim_lease_expires_at timestamptz,
  assignment_body jsonb,
  assignment_body_digest text unique
    check (assignment_body_digest is null or assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_signer_key_id text,
  assignment_signature text,
  signed_assignment jsonb,
  signed_at timestamptz,
  found_count smallint check (found_count between 0 and 5),
  not_found_count smallint check (not_found_count between 0 and 5),
  review_required_count smallint check (review_required_count between 0 and 5),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint agent_platform_companion_lookup_assignment_id_v4_check check (
    assignment_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint agent_platform_companion_lookup_owner_request_v4_check check (
    owner_request_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint agent_platform_companion_lookup_device_shape_check check (
    device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    and device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
  ),
  constraint agent_platform_companion_lookup_window_check check (
    expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'
  ),
  constraint agent_platform_companion_lookup_state_shape_check check (
    (
      state = 'pending'
      and claim_lease_expires_at is null
      and assignment_body is null
      and assignment_body_digest is null
      and assignment_signer_key_id is null
      and assignment_signature is null
      and signed_assignment is null
      and signed_at is null
      and found_count is null
      and not_found_count is null
      and review_required_count is null
      and completed_at is null
    ) or (
      state = 'claimed'
      and first_claimed_at is not null
      and last_claimed_at is not null
      and claim_lease_expires_at is not null
      and assignment_body is not null
      and assignment_body_digest is null
      and assignment_signer_key_id is null
      and assignment_signature is null
      and signed_assignment is null
      and signed_at is null
      and found_count is null
      and not_found_count is null
      and review_required_count is null
      and completed_at is null
    ) or (
      state = 'signed'
      and first_claimed_at is not null
      and last_claimed_at is not null
      and claim_lease_expires_at is null
      and assignment_body is not null
      and assignment_body_digest is not null
      and assignment_signer_key_id is not null
      and assignment_signature is not null
      and signed_assignment is not null
      and signed_at is not null
      and found_count is null
      and not_found_count is null
      and review_required_count is null
      and completed_at is null
    ) or (
      state in ('completed', 'review_required')
      and claim_lease_expires_at is null
      and assignment_body is not null
      and assignment_body_digest is not null
      and assignment_signer_key_id is not null
      and assignment_signature is not null
      and signed_assignment is not null
      and signed_at is not null
      and found_count is not null
      and not_found_count is not null
      and review_required_count is not null
      and found_count + not_found_count + review_required_count = 5
      and completed_at is not null
    ) or (
      state = 'expired'
      and completed_at is null
      and found_count is null
      and not_found_count is null
      and review_required_count is null
    )
  ),
  constraint agent_platform_companion_lookup_json_size_check check (
    (assignment_body is null or (
      jsonb_typeof(assignment_body) = 'object' and pg_column_size(assignment_body) <= 32768
    ))
    and (signed_assignment is null or (
      jsonb_typeof(signed_assignment) = 'object' and pg_column_size(signed_assignment) <= 65536
    ))
  )
);

create unique index agent_platform_companion_lookup_one_active_idx
  on app.agent_platform_companion_lookup_assignments ((true))
  where state in ('pending', 'claimed', 'signed');
create index agent_platform_companion_lookup_certificate_idx
  on app.agent_platform_companion_lookup_assignments (certificate_id, issued_at desc);
create index agent_platform_companion_lookup_expiry_idx
  on app.agent_platform_companion_lookup_assignments (expires_at, assignment_id)
  where state in ('pending', 'claimed', 'signed');

create table app.agent_platform_companion_lookup_members (
  assignment_id uuid not null
    references app.agent_platform_companion_lookup_assignments (assignment_id) on delete restrict,
  member_ordinal smallint not null check (member_ordinal between 1 and 5),
  player_account_id uuid not null
    references app.customer_platform_players (id) on delete restrict,
  player_id_snapshot text not null
    check (
      player_id_snapshot collate pg_catalog."C"
        ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  eligibility_decision_id uuid not null,
  eligibility_decision_version integer not null check (eligibility_decision_version > 0),
  player_account_updated_at_snapshot timestamptz not null,
  decision_decided_at_snapshot timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (assignment_id, member_ordinal),
  unique (assignment_id, player_account_id),
  unique (assignment_id, player_id_snapshot),
  unique (assignment_id, eligibility_decision_id),
  foreign key (eligibility_decision_id, player_account_id)
    references app.player_deposit_eligibility_decisions (id, player_account_id)
    on delete restrict
);

create table app.agent_platform_companion_http_request_replays (
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
      '/v1/companion/device/lookup-assignments:poll',
      '/v1/companion/device/lookup-results:submit'
    )
  ),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  received_at timestamptz not null,
  constraint agent_platform_companion_http_request_window_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '5 minutes'
    and received_at >= issued_at
    and received_at < expires_at
  )
);

create table app.agent_platform_companion_lookup_results (
  result_id text primary key
    check (result_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  assignment_id uuid not null unique
    references app.agent_platform_companion_lookup_assignments (assignment_id) on delete restrict,
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  result_replay_identity text not null unique
    check (result_replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  result_body_digest text not null unique
    check (result_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_result jsonb not null check (
    jsonb_typeof(signed_result) = 'object' and pg_column_size(signed_result) <= 65536
  ),
  found_count smallint not null check (found_count between 0 and 5),
  not_found_count smallint not null check (not_found_count between 0 and 5),
  review_required_count smallint not null check (review_required_count between 0 and 5),
  observed_at timestamptz not null,
  accepted_at timestamptz not null,
  identifiers_redacted boolean not null default true check (identifiers_redacted),
  transfer_disabled boolean not null default true check (transfer_disabled),
  money_moved boolean not null default false check (not money_moved),
  created_at timestamptz not null default clock_timestamp(),
  constraint agent_platform_companion_lookup_result_counts_check check (
    found_count + not_found_count + review_required_count = 5
  )
);

create function app.agent_platform_companion_lookup_sha256(p_value text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  digest_hex text;
begin
  if p_value is null or pg_catalog.octet_length(p_value) > 4096 then
    return null;
  end if;
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(extensions.digest(pg_catalog.convert_to($1, 'UTF8'), 'sha256'), 'hex')
    $digest$ into digest_hex using p_value;
  elsif pg_catalog.to_regprocedure('public.digest(bytea,text)') is not null then
    execute $digest$
      select pg_catalog.encode(public.digest(pg_catalog.convert_to($1, 'UTF8'), 'sha256'), 'hex')
    $digest$ into digest_hex using p_value;
  else
    raise exception 'The companion lookup digest function is unavailable.';
  end if;
  if digest_hex !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  return 'sha256:' || digest_hex;
end;
$$;

create function app.agent_platform_companion_lookup_jsonb_exact_keys(
  p_value jsonb,
  p_expected_keys text[]
)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and pg_catalog.cardinality(p_expected_keys) > 0
    and pg_catalog.cardinality(p_expected_keys) = (
      select count(distinct expected_key)::integer
        from pg_catalog.unnest(p_expected_keys) expected_key
    )
    and (
      select pg_catalog.array_agg(actual_key order by actual_key)
        from pg_catalog.jsonb_object_keys(p_value) actual_key
    ) = (
      select pg_catalog.array_agg(expected_key order by expected_key)
        from pg_catalog.unnest(p_expected_keys) expected_key
    ),
    false
  )
$$;

create function app.agent_platform_companion_current_exact_five_players()
returns table (
  player_account_id uuid,
  player_id text,
  eligibility_decision_id uuid,
  eligibility_decision_version integer,
  player_account_updated_at timestamptz,
  decision_decided_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select player_account.id,
         player_account.player_id,
         latest_decision.id,
         latest_decision.decision_version,
         player_account.updated_at,
         latest_decision.decided_at
    from app.player_registration_request_associations association
    join app.customer_platform_players player_account
      on player_account.id = association.player_account_id
    join app.customers customer on customer.id = player_account.customer_id
    join app.platforms platform on platform.id = player_account.platform_id
    join lateral (
      select decision.*
        from app.player_deposit_eligibility_decisions decision
       where decision.player_account_id = player_account.id
       order by decision.decision_version desc
       limit 1
    ) latest_decision on true
   where platform.code = 'kemerbet'
     and platform.status = 'active'
     and customer.status = 'active'
     and player_account.status = 'active'
     and player_account.validation_status = 'valid'
     and player_account.player_id collate pg_catalog."C"
       ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     and latest_decision.decision = 'eligible'
     and latest_decision.reason_code = 'financial_eligibility_approved'
     and latest_decision.player_account_updated_at_snapshot is not distinct from player_account.updated_at
     and latest_decision.decided_at <= pg_catalog.clock_timestamp()
     and (
       select count(*)::integer = latest_decision.decision_version
         and max(history.decision_version) = latest_decision.decision_version
         and min(history.decision_version) = 1
         and count(distinct history.decision_version)::integer = latest_decision.decision_version
         from app.player_deposit_eligibility_decisions history
        where history.player_account_id = player_account.id
     )
   order by player_account.id
$$;

create function app.enforce_agent_platform_companion_lookup_assignment_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.assignment_id is distinct from old.assignment_id
    or new.owner_request_id is distinct from old.owner_request_id
    or new.created_by_admin_id is distinct from old.created_by_admin_id
    or new.certificate_id is distinct from old.certificate_id
    or new.server_signer_id is distinct from old.server_signer_id
    or new.device_id is distinct from old.device_id
    or new.device_key_id is distinct from old.device_key_id
    or new.platform_code is distinct from old.platform_code
    or new.assignment_kind is distinct from old.assignment_kind
    or new.lookup_mode is distinct from old.lookup_mode
    or new.currency_code is distinct from old.currency_code
    or new.lease_nonce_digest is distinct from old.lease_nonce_digest
    or new.one_use is distinct from old.one_use
    or new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at then
    raise exception 'The companion lookup assignment identity is immutable.';
  end if;

  if not (
    (old.state = 'pending' and new.state in ('claimed', 'expired'))
    or (old.state = 'claimed' and new.state in ('pending', 'signed', 'expired'))
    or (old.state = 'signed' and new.state in ('completed', 'review_required', 'expired'))
  ) then
    raise exception 'The companion lookup assignment transition is invalid.';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger agent_platform_companion_lookup_assignment_transition
before update on app.agent_platform_companion_lookup_assignments
for each row execute function app.enforce_agent_platform_companion_lookup_assignment_transition();
create trigger agent_platform_companion_lookup_assignment_no_delete
before delete on app.agent_platform_companion_lookup_assignments
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_lookup_assignment_no_truncate
before truncate on app.agent_platform_companion_lookup_assignments
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();

create trigger agent_platform_companion_lookup_members_immutable
before update or delete on app.agent_platform_companion_lookup_members
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_lookup_members_no_truncate
before truncate on app.agent_platform_companion_lookup_members
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();
create trigger agent_platform_companion_http_replays_immutable
before update or delete on app.agent_platform_companion_http_request_replays
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_http_replays_no_truncate
before truncate on app.agent_platform_companion_http_request_replays
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();
create trigger agent_platform_companion_lookup_results_immutable
before update or delete on app.agent_platform_companion_lookup_results
for each row execute function app.reject_agent_platform_companion_immutable_mutation();
create trigger agent_platform_companion_lookup_results_no_truncate
before truncate on app.agent_platform_companion_lookup_results
for each statement execute function app.reject_agent_platform_companion_immutable_truncate();

create function app.require_agent_platform_companion_lookup_exact_members()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if (
    select count(*)::integer
      from app.agent_platform_companion_lookup_members member
     where member.assignment_id = new.assignment_id
  ) <> 5 then
    raise exception 'A companion lookup assignment requires exactly five immutable members.';
  end if;
  return null;
end;
$$;

create constraint trigger agent_platform_companion_lookup_exact_members
after insert on app.agent_platform_companion_lookup_assignments
deferrable initially deferred
for each row execute function app.require_agent_platform_companion_lookup_exact_members();

create function app.issue_agent_platform_companion_exact_five_lookup(
  p_actor_auth_user_id uuid,
  p_owner_request_id uuid,
  p_server_signer_key_id text
)
returns table (
  assignment_id uuid,
  assignment_state text,
  issued_at timestamptz,
  expires_at timestamptz,
  found_count smallint,
  not_found_count smallint,
  review_required_count smallint,
  completed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  now_at timestamptz;
  eligible_count integer;
  certificate_count integer;
  selected_certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  selected_assignment app.agent_platform_companion_lookup_assignments%rowtype;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();
  if p_actor_auth_user_id is null
    or p_owner_request_id is null
    or p_owner_request_id::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_server_signer_key_id is null
    or p_server_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$' then
    raise exception 'The Owner companion lookup request is invalid.';
  end if;

  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then
    raise exception 'The companion lookup serialization gate is unavailable.';
  end if;
  perform app.require_private_owner_kemerbet_readiness_safe_boundary();
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active';
  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active';
  end if;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can issue a companion lookup.';
  end if;

  update app.agent_platform_companion_lookup_assignments assignment
     set state = 'expired',
         claim_lease_expires_at = null
   where assignment.state in ('pending', 'claimed', 'signed')
     and assignment.expires_at <= now_at;

  select assignment.* into selected_assignment
    from app.agent_platform_companion_lookup_assignments assignment
   where assignment.owner_request_id = p_owner_request_id
   for update;
  if selected_assignment.assignment_id is not null then
    if selected_assignment.created_by_admin_id <> actor_admin_id then
      raise exception 'The Owner companion lookup request conflicts with its receipt.';
    end if;
    return query select selected_assignment.assignment_id,
                        selected_assignment.state,
                        selected_assignment.issued_at,
                        selected_assignment.expires_at,
                        selected_assignment.found_count,
                        selected_assignment.not_found_count,
                        selected_assignment.review_required_count,
                        selected_assignment.completed_at,
                        true;
    return;
  end if;

  select count(*)::integer into eligible_count
    from app.agent_platform_companion_current_exact_five_players();
  if eligible_count <> 5 then
    raise exception 'The companion lookup requires exactly five current eligible KemerBet Players.';
  end if;

  select count(*)::integer into certificate_count
    from app.agent_platform_companion_enrollment_certificates certificate
    join app.agent_platform_companion_server_signers signer
      on signer.id = certificate.server_signer_id
    left join app.agent_platform_companion_device_revocations device_revocation
      on device_revocation.certificate_id = certificate.certificate_id
    left join app.agent_platform_companion_server_signer_revocations signer_revocation
      on signer_revocation.server_signer_id = signer.id
   where certificate.valid_from <= now_at
     and certificate.valid_until > now_at
     and certificate.certificate_signer_key_id = p_server_signer_key_id
     and signer.signer_key_id = p_server_signer_key_id
     and signer.valid_from <= now_at
     and signer.valid_until > now_at
     and device_revocation.certificate_id is null
     and signer_revocation.server_signer_id is null;
  if certificate_count <> 1 then
    raise exception 'The companion lookup requires exactly one active paired device certificate.';
  end if;

  select certificate.* into selected_certificate
    from app.agent_platform_companion_enrollment_certificates certificate
    join app.agent_platform_companion_server_signers signer
      on signer.id = certificate.server_signer_id
    left join app.agent_platform_companion_device_revocations device_revocation
      on device_revocation.certificate_id = certificate.certificate_id
    left join app.agent_platform_companion_server_signer_revocations signer_revocation
      on signer_revocation.server_signer_id = signer.id
   where certificate.valid_from <= now_at
     and certificate.valid_until > now_at
     and certificate.certificate_signer_key_id = p_server_signer_key_id
     and signer.signer_key_id = p_server_signer_key_id
     and signer.valid_from <= now_at
     and signer.valid_until > now_at
     and device_revocation.certificate_id is null
     and signer_revocation.server_signer_id is null;
  insert into app.agent_platform_companion_lookup_assignments (
    owner_request_id,
    created_by_admin_id,
    certificate_id,
    server_signer_id,
    device_id,
    device_key_id,
    lease_nonce_digest,
    issued_at,
    expires_at
  ) values (
    p_owner_request_id,
    actor_admin_id,
    selected_certificate.certificate_id,
    selected_certificate.server_signer_id,
    selected_certificate.device_id,
    selected_certificate.device_key_id,
    app.agent_platform_companion_lookup_sha256(
      'fetanagent:companion:lookup-lease:v1:' || gen_random_uuid()::text || ':' ||
      p_owner_request_id::text || ':' || app.agent_platform_companion_timestamp(now_at)
    ),
    now_at,
    now_at + interval '10 minutes'
  ) returning * into selected_assignment;

  insert into app.agent_platform_companion_lookup_members (
    assignment_id,
    member_ordinal,
    player_account_id,
    player_id_snapshot,
    eligibility_decision_id,
    eligibility_decision_version,
    player_account_updated_at_snapshot,
    decision_decided_at_snapshot
  )
  select selected_assignment.assignment_id,
         row_number() over (order by eligible.player_account_id)::smallint,
         eligible.player_account_id,
         eligible.player_id,
         eligible.eligibility_decision_id,
         eligible.eligibility_decision_version,
         eligible.player_account_updated_at,
         eligible.decision_decided_at
    from app.agent_platform_companion_current_exact_five_players() eligible;

  if (
    select count(*)::integer
      from app.agent_platform_companion_lookup_members member
     where member.assignment_id = selected_assignment.assignment_id
  ) <> 5 then
    raise exception 'The companion lookup member snapshot is incomplete.';
  end if;

  insert into app.audit_events (
    actor_kind, actor_admin_id, actor_label, action, resource_type, resource_id, metadata
  ) values (
    'admin',
    actor_admin_id,
    'owner-companion-lookup-v1',
    'companion_lookup.assignment_issued',
    'companion_lookup_assignment',
    selected_assignment.assignment_id,
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'players_assigned', 5,
      'lookup_mode', 'find_only',
      'transfer_disabled', true,
      'money_moved', false,
      'identifiers_redacted', true
    )
  );

  return query select selected_assignment.assignment_id,
                      selected_assignment.state,
                      selected_assignment.issued_at,
                      selected_assignment.expires_at,
                      selected_assignment.found_count,
                      selected_assignment.not_found_count,
                      selected_assignment.review_required_count,
                      selected_assignment.completed_at,
                      false;
end;
$$;

create function app.get_agent_platform_companion_exact_five_lookup_status(
  p_actor_auth_user_id uuid
)
returns table (
  assignment_id uuid,
  assignment_state text,
  issued_at timestamptz,
  expires_at timestamptz,
  found_count smallint,
  not_found_count smallint,
  review_required_count smallint,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();
  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active';
  if actor_admin_id is null and session_user = 'postgres' then
    select admin_user.id into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active';
  end if;
  if actor_admin_id is null then
    raise exception 'Only the active Owner can read companion lookup status.';
  end if;
  return query
  select assignment.assignment_id,
         case
           when assignment.state in ('pending', 'claimed', 'signed')
             and assignment.expires_at <= pg_catalog.clock_timestamp()
             then 'expired'
           else assignment.state
         end,
         assignment.issued_at,
         assignment.expires_at,
         assignment.found_count,
         assignment.not_found_count,
         assignment.review_required_count,
         assignment.completed_at
    from app.agent_platform_companion_lookup_assignments assignment
   where assignment.created_by_admin_id = actor_admin_id
   order by assignment.created_at desc
   limit 1;
end;
$$;

create function app.claim_agent_platform_companion_lookup_assignment(
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
    or p_assessed_at < p_request_issued_at
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

create function app.complete_agent_platform_companion_lookup_assignment(
  p_assignment_body_digest text,
  p_signer_key_id text,
  p_signature text,
  p_signed_assignment jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  assignment_uuid uuid;
  selected_assignment app.agent_platform_companion_lookup_assignments%rowtype;
  now_at timestamptz;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_assignment_body_digest is null
    or p_signer_key_id is null
    or p_signature is null
    or p_signed_assignment is null
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_signer_key_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_signature !~ '^[A-Za-z0-9_-]{86}$'
    or pg_catalog.jsonb_typeof(p_signed_assignment) <> 'object'
    or pg_catalog.pg_column_size(p_signed_assignment) > 65536
    or not app.agent_platform_companion_lookup_jsonb_exact_keys(
      p_signed_assignment,
      array[
        'contractVersion', 'protocolMode', 'transcriptVersion', 'bodyDigestAlgorithm',
        'bodyDigest', 'signatureAlgorithm', 'signatureEncoding', 'signerKeyId', 'body',
        'signature'
      ]::text[]
    )
    or p_signed_assignment ->> 'contractVersion' <> '1'
    or p_signed_assignment ->> 'protocolMode' <> 'local_companion_no_transfer_v1'
    or p_signed_assignment ->> 'transcriptVersion'
      <> 'agent-platform-companion-lookup-assignment-transcript-v1'
    or p_signed_assignment ->> 'bodyDigestAlgorithm' <> 'sha256'
    or p_signed_assignment ->> 'signatureAlgorithm' <> 'ecdsa-p256-sha256'
    or p_signed_assignment ->> 'signatureEncoding' <> 'ieee-p1363-base64url'
    or p_signed_assignment #>> '{body,assignmentId}'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  assignment_uuid := (p_signed_assignment #>> '{body,assignmentId}')::uuid;
  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then return false; end if;
  perform app.require_private_owner_kemerbet_readiness_safe_boundary();
  select assignment.* into selected_assignment
    from app.agent_platform_companion_lookup_assignments assignment
   where assignment.assignment_id = assignment_uuid
   for update;
  if selected_assignment.assignment_id is null then return false; end if;
  if selected_assignment.state in ('signed', 'completed', 'review_required') then
    return selected_assignment.assignment_body_digest = p_assignment_body_digest
      and selected_assignment.assignment_signer_key_id = p_signer_key_id
      and selected_assignment.assignment_signature = p_signature
      and selected_assignment.signed_assignment = p_signed_assignment;
  end if;
  if selected_assignment.state <> 'claimed'
    or selected_assignment.claim_lease_expires_at <= now_at
    or selected_assignment.expires_at <= now_at
    or selected_assignment.assignment_body <> (p_signed_assignment -> 'body')
    or p_signed_assignment ->> 'bodyDigest' <> p_assignment_body_digest
    or p_signed_assignment ->> 'signerKeyId' <> p_signer_key_id
    or p_signed_assignment ->> 'signature' <> p_signature
    or not exists (
      select 1
        from app.agent_platform_companion_enrollment_certificates certificate
        join app.agent_platform_companion_server_signers signer
          on signer.id = certificate.server_signer_id
        left join app.agent_platform_companion_device_revocations device_revocation
          on device_revocation.certificate_id = certificate.certificate_id
        left join app.agent_platform_companion_server_signer_revocations signer_revocation
          on signer_revocation.server_signer_id = signer.id
       where certificate.certificate_id = selected_assignment.certificate_id
         and certificate.server_signer_id = selected_assignment.server_signer_id
         and certificate.device_id = selected_assignment.device_id
         and certificate.device_key_id = selected_assignment.device_key_id
         and certificate.certificate_signer_key_id = p_signer_key_id
         and certificate.valid_from <= now_at
         and certificate.valid_until > now_at
         and signer.id = selected_assignment.server_signer_id
         and signer.signer_key_id = p_signer_key_id
         and signer.valid_from <= now_at
         and signer.valid_until > now_at
         and device_revocation.certificate_id is null
         and signer_revocation.server_signer_id is null
    ) then
    return false;
  end if;
  update app.agent_platform_companion_lookup_assignments assignment
     set state = 'signed',
         claim_lease_expires_at = null,
         assignment_body_digest = p_assignment_body_digest,
         assignment_signer_key_id = p_signer_key_id,
         assignment_signature = p_signature,
         signed_assignment = p_signed_assignment,
         signed_at = now_at
   where assignment.assignment_id = assignment_uuid;
  return true;
end;
$$;

create function app.release_agent_platform_companion_lookup_assignment(
  p_assignment_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  assignment_uuid uuid;
begin
  perform app.require_agent_platform_companion_bridge_session();
  if p_assignment_id is null
    or p_assignment_id
    !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  assignment_uuid := p_assignment_id::uuid;
  update app.agent_platform_companion_lookup_assignments assignment
     set state = 'pending',
         claim_lease_expires_at = null,
         assignment_body = null
   where assignment.assignment_id = assignment_uuid
     and assignment.state = 'claimed'
     and assignment.assignment_body_digest is null
     and assignment.signed_assignment is null;
  return found;
end;
$$;

create function app.accept_agent_platform_companion_lookup_result(
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
    or p_assessed_at < p_request_issued_at
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
  if observed_at < selected_assignment.issued_at
    or observed_at >= selected_assignment.expires_at
    or observed_at > p_assessed_at
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

alter table app.agent_platform_companion_lookup_assignments enable row level security;
alter table app.agent_platform_companion_lookup_assignments force row level security;
alter table app.agent_platform_companion_lookup_members enable row level security;
alter table app.agent_platform_companion_lookup_members force row level security;
alter table app.agent_platform_companion_http_request_replays enable row level security;
alter table app.agent_platform_companion_http_request_replays force row level security;
alter table app.agent_platform_companion_lookup_results enable row level security;
alter table app.agent_platform_companion_lookup_results force row level security;

alter table app.agent_platform_companion_lookup_assignments owner to postgres;
alter table app.agent_platform_companion_lookup_members owner to postgres;
alter table app.agent_platform_companion_http_request_replays owner to postgres;
alter table app.agent_platform_companion_lookup_results owner to postgres;

alter function app.agent_platform_companion_lookup_sha256(text) owner to postgres;
alter function app.agent_platform_companion_lookup_jsonb_exact_keys(jsonb, text[]) owner to postgres;
alter function app.agent_platform_companion_current_exact_five_players() owner to postgres;
alter function app.enforce_agent_platform_companion_lookup_assignment_transition() owner to postgres;
alter function app.require_agent_platform_companion_lookup_exact_members() owner to postgres;
alter function app.issue_agent_platform_companion_exact_five_lookup(uuid, uuid, text)
  owner to postgres;
alter function app.get_agent_platform_companion_exact_five_lookup_status(uuid) owner to postgres;
alter function app.claim_agent_platform_companion_lookup_assignment(
  text, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text
) owner to postgres;
alter function app.complete_agent_platform_companion_lookup_assignment(text, text, text, jsonb)
  owner to postgres;
alter function app.release_agent_platform_companion_lookup_assignment(text) owner to postgres;
alter function app.accept_agent_platform_companion_lookup_result(
  text, text, text, text, text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, jsonb
) owner to postgres;

revoke all privileges on table
  app.agent_platform_companion_lookup_assignments,
  app.agent_platform_companion_lookup_members,
  app.agent_platform_companion_http_request_replays,
  app.agent_platform_companion_lookup_results
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
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.agent_platform_companion_lookup_sha256(text),
  app.agent_platform_companion_lookup_jsonb_exact_keys(jsonb, text[]),
  app.agent_platform_companion_current_exact_five_players(),
  app.enforce_agent_platform_companion_lookup_assignment_transition(),
  app.require_agent_platform_companion_lookup_exact_members(),
  app.issue_agent_platform_companion_exact_five_lookup(uuid, uuid, text),
  app.get_agent_platform_companion_exact_five_lookup_status(uuid),
  app.claim_agent_platform_companion_lookup_assignment(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text
  ),
  app.complete_agent_platform_companion_lookup_assignment(text, text, text, jsonb),
  app.release_agent_platform_companion_lookup_assignment(text),
  app.accept_agent_platform_companion_lookup_result(
    text, text, text, text, text, text, text, text, text, text, text,
    timestamptz, timestamptz, timestamptz, jsonb, jsonb
  )
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
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

grant execute on function
  app.issue_agent_platform_companion_exact_five_lookup(uuid, uuid, text),
  app.get_agent_platform_companion_exact_five_lookup_status(uuid)
to fetanagent_owner_control;

grant execute on function
  app.claim_agent_platform_companion_lookup_assignment(
    text, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text
  ),
  app.complete_agent_platform_companion_lookup_assignment(text, text, text, jsonb),
  app.release_agent_platform_companion_lookup_assignment(text),
  app.accept_agent_platform_companion_lookup_result(
    text, text, text, text, text, text, text, text, text, text, text,
    timestamptz, timestamptz, timestamptz, jsonb, jsonb
  )
to fetanagent_companion_device_bridge;

comment on table app.agent_platform_companion_lookup_members is
  'Private immutable exact-five assignment members. Raw Player IDs never enter the Owner UI, bridge logs, or accepted result ledger.';
comment on table app.agent_platform_companion_lookup_results is
  'Immutable device-signed read-only results containing Player-ID digests and aggregate outcomes only; no amount, note, transfer, or money authority exists.';
comment on function app.issue_agent_platform_companion_exact_five_lookup(uuid, uuid, text) is
  'Owner-only exact-five assignment issuer. It locks the readiness gate and requires every money switch disabled, no open live-money pilot, exactly five current eligible KemerBet Players, and exactly one active paired certificate.';

commit;
