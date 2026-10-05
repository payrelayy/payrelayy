-- Authenticated routine TeleBirr execution broker. This is a separate capability from the fixed
-- 25 ETB v2 pilot. Applying the migration leaves the runtime NOLOGIN and cannot move money;
-- postgres must explicitly bind one current Owner authorization and paired certificate.
begin;

alter default privileges for role postgres in schema app revoke execute on functions from public;

create role fetanagent_routine_deposit_broker
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
create role fetanagent_routine_deposit_broker_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1 valid until 'infinity';
-- PostgreSQL 17 automatically gives the non-superuser CREATEROLE creator an ADMIN-only
-- membership in each new role. Re-granting that option to the grantor fails on Supabase.

create table app.routine_telebirr_runtime_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  request_key uuid not null unique,
  event_kind text not null check (event_kind in ('activate', 'disable')),
  authorization_id uuid not null
    references app.routine_telebirr_processing_authorizations (id) on delete restrict,
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  device_id text not null check (device_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  device_key_id text not null check (device_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  no_money_signer_key_id text not null
    check (no_money_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  execution_signer_key_id text not null
    check (execution_signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  platform_agent_account_id uuid not null
    references app.platform_agent_accounts (id) on delete restrict,
  valid_until timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  reason_code text,
  check (execution_signer_key_id <> no_money_signer_key_id),
  check (valid_until > recorded_at),
  check (
    (event_kind = 'activate' and reason_code is null)
    or (event_kind = 'disable' and reason_code in ('operator_requested', 'incident_stop', 'rotation'))
  )
);

create table app.routine_telebirr_broker_requests (
  request_id uuid primary key,
  http_replay_identity text not null unique check (http_replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  http_request_body_digest text not null unique
    check (http_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  command_digest text not null unique check (command_digest ~ '^sha256:[0-9a-f]{64}$'),
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  operation text not null
    check (operation in ('lease', 'fence', 'record_dispatch', 'reconcile', 'complete', 'pause')),
  command_body jsonb not null check (
    pg_catalog.jsonb_typeof(command_body) = 'object'
    and pg_catalog.pg_column_size(command_body) <= 32768
  ),
  result_body jsonb not null check (pg_catalog.pg_column_size(result_body) <= 32768),
  assessed_at timestamptz not null,
  completed_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table app.routine_telebirr_dispatch_evidence (
  execution_attempt_id uuid primary key
    references app.deposit_execution_attempts (id) on delete restrict,
  broker_request_id uuid not null unique
    references app.routine_telebirr_broker_requests (request_id) deferrable initially deferred,
  provider_response_digest text not null check (provider_response_digest ~ '^sha256:[0-9a-f]{64}$'),
  exact_player_credit_match boolean not null check (exact_player_credit_match),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table app.routine_telebirr_runtime_pauses (
  id uuid primary key default gen_random_uuid(),
  authorization_event_sequence bigint not null
    references app.routine_telebirr_processing_events (event_sequence) on delete restrict,
  broker_request_id uuid not null unique
    references app.routine_telebirr_broker_requests (request_id) deferrable initially deferred,
  execution_attempt_id uuid references app.deposit_execution_attempts (id) on delete restrict,
  reason_code text not null check (reason_code in (
    'invalid_policy_or_lease', 'database_unavailable', 'execution_uncertain',
    'reconciliation_uncertain', 'confirmation_mismatch', 'operator_stopped'
  )),
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (authorization_event_sequence)
);

do $protect_ledgers$
declare ledger text;
begin
  foreach ledger in array array[
    'routine_telebirr_runtime_events', 'routine_telebirr_broker_requests',
    'routine_telebirr_dispatch_evidence', 'routine_telebirr_runtime_pauses'
  ] loop
    execute pg_catalog.format('alter table app.%I enable row level security', ledger);
    execute pg_catalog.format('alter table app.%I force row level security', ledger);
    execute pg_catalog.format('alter table app.%I owner to postgres', ledger);
    execute pg_catalog.format(
      'create trigger %I before update or delete on app.%I for each row '
      || 'execute function app.reject_deposit_ledger_delete()', ledger || '_immutable', ledger
    );
    execute pg_catalog.format(
      'create trigger %I before truncate on app.%I for each statement '
      || 'execute function app.reject_execution_ledger_truncate()', ledger || '_no_truncate', ledger
    );
    execute pg_catalog.format(
      'revoke all on app.%I from public, anon, authenticated, service_role, '
      || 'fetanagent_owner_control, fetanagent_owner_control_runtime, '
      || 'fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime, '
      || 'fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime, '
      || 'fetanagent_deposit_executor, fetanagent_deposit_executor_runtime, '
      || 'fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime', ledger
    );
  end loop;
end;
$protect_ledgers$;

create function app.routine_telebirr_attempt_binding_json(p_execution_attempt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'jobId', job.id::text,
    'intentId', intent.id::text,
    'attemptId', attempt.id::text,
    'paymentClaimId', binding.deposit_payment_claim_id::text,
    'platformAgentAccountId', attempt.platform_agent_account_id::text,
    'playerId', player.player_id,
    'amountMinor', intent.expected_amount_minor,
    'currencyCode', intent.currency_code::text
  )
  from app.deposit_execution_attempts attempt
  join app.deposit_jobs job on job.id = attempt.deposit_job_id
    and job.deposit_intent_id = attempt.deposit_intent_id
  join app.deposit_intents intent on intent.id = attempt.deposit_intent_id
  join app.customer_platform_players player on player.id = intent.player_account_id
  join app.routine_telebirr_execution_bindings binding
    on binding.execution_job_id = job.id and binding.deposit_intent_id = intent.id
  where attempt.id = p_execution_attempt_id
$$;

create function app.routine_telebirr_runtime_policy_json()
returns jsonb
language sql
immutable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'mode', 'routine_production', 'status', 'active', 'version', 1,
    'provider', 'telebirr', 'platformCode', 'kemerbet', 'currencyCode', 'ETB',
    'minimumAmountMinor', 2500, 'maximumAmountMinor', 2500000,
    'playerScope', 'all_active_deposit_eligible', 'playerOwnershipRequired', false,
    'dailyQuotaMinor', null, 'successfulDepositQuota', null,
    'maxConcurrentDeposits', 1, 'amountSource', 'official_receipt_settled_amount'
  )
$$;

create function app.routine_telebirr_runtime_is_active(p_authorization_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from app.routine_telebirr_runtime_events runtime_event
    join app.routine_telebirr_processing_authorizations authority
      on authority.id = runtime_event.authorization_id
    join app.routine_telebirr_processing_events policy_event
      on policy_event.authorization_id = authority.id
    join pg_catalog.pg_roles runtime_role
      on runtime_role.rolname = 'fetanagent_routine_deposit_broker_runtime'
    where runtime_event.event_sequence = (
      select pg_catalog.max(latest.event_sequence) from app.routine_telebirr_runtime_events latest
    )
      and runtime_event.event_kind = 'activate'
      and (p_authorization_id is null or authority.id = p_authorization_id)
      and runtime_event.valid_until > pg_catalog.clock_timestamp()
      and policy_event.event_sequence = (
        select pg_catalog.max(latest.event_sequence)
        from app.routine_telebirr_processing_events latest
      )
      and policy_event.event_kind = 'authorize'
      and not exists (
        select 1 from app.routine_telebirr_runtime_pauses pause
        where pause.authorization_event_sequence = policy_event.event_sequence
      )
      and runtime_role.rolcanlogin
      and pg_catalog.pg_has_role(
        'fetanagent_routine_deposit_broker_runtime',
        'fetanagent_routine_deposit_broker', 'member'
      )
      and app.agent_platform_companion_execution_certificate_is_active(
        runtime_event.certificate_id, runtime_event.device_id, runtime_event.device_key_id,
        runtime_event.no_money_signer_key_id, pg_catalog.clock_timestamp()
      )
  )
$$;

create function app.activate_routine_telebirr_execution_transport(
  p_actor_auth_user_id uuid,
  p_certificate_id uuid,
  p_request_key uuid,
  p_runtime_password text
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid;
  authority app.routine_telebirr_processing_authorizations%rowtype;
  certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  latest_policy app.routine_telebirr_processing_events%rowtype;
  latest_runtime app.routine_telebirr_runtime_events%rowtype;
  previous app.routine_telebirr_runtime_events%rowtype;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can activate routine deposits.';
  end if;
  if p_actor_auth_user_id is null or p_certificate_id is null or p_request_key is null
    or p_runtime_password is null or p_runtime_password !~ '^[0-9a-f]{64}$' then
    raise exception 'The routine deposit activation input is invalid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:routine-telebirr-runtime', 20261005)
  );
  select event.* into previous from app.routine_telebirr_runtime_events event
    where event.request_key = p_request_key;
  if previous.id is not null then
    if previous.event_kind <> 'activate' or previous.certificate_id <> p_certificate_id then
      raise exception 'The routine runtime request key has already been used.';
    end if;
    return previous.valid_until;
  end if;
  select event.* into latest_runtime from app.routine_telebirr_runtime_events event
    order by event.event_sequence desc limit 1 for share;
  if latest_runtime.id is not null and latest_runtime.event_kind = 'activate' then
    raise exception 'Routine deposit transport is already active.';
  end if;
  select event.* into latest_policy from app.routine_telebirr_processing_events event
    order by event.event_sequence desc limit 1 for share;
  if latest_policy.id is null or latest_policy.event_kind <> 'authorize' then
    raise exception 'The current routine Owner authorization is required.';
  end if;
  select saved.* into authority from app.routine_telebirr_processing_authorizations saved
    where saved.id = latest_policy.authorization_id for share;
  select owner_user.id into actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.id = authority.authorized_by_admin_id
      and owner_user.role = 'owner' and owner_user.status = 'active' for share;
  if actor_id is null then raise exception 'The active authorizing Owner is required.'; end if;
  select enrolled.* into certificate from app.agent_platform_companion_enrollment_certificates enrolled
    where enrolled.certificate_id = p_certificate_id for share;
  if certificate.certificate_id is null
    or certificate.valid_until <= pg_catalog.clock_timestamp() + interval '10 minutes'
    or not app.agent_platform_companion_execution_certificate_is_active(
      certificate.certificate_id, certificate.device_id, certificate.device_key_id,
      certificate.certificate_signer_key_id, pg_catalog.clock_timestamp()
    ) then
    raise exception 'The active paired companion certificate is required.';
  end if;
  if exists (
    select 1 from app.routine_telebirr_execution_bindings binding
    join app.deposit_execution_attempts attempt on attempt.deposit_job_id = binding.execution_job_id
    where attempt.status in ('prepared', 'final_action_fenced', 'reconciliation_required', 'review_required')
      and (binding.authorization_id <> authority.id
        or attempt.platform_agent_account_id <> authority.platform_agent_account_id)
  ) then
    raise exception 'Resolve the previous routine account lane before activation.';
  end if;
  perform pg_catalog.set_config('password_encryption', 'scram-sha-256', true);
  execute 'grant fetanagent_routine_deposit_broker '
    || 'to fetanagent_routine_deposit_broker_runtime '
    || 'with inherit true, set false, admin false';
  execute pg_catalog.format(
    'alter role fetanagent_routine_deposit_broker_runtime with '
    || 'login noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password %L valid until %L',
    p_runtime_password, certificate.valid_until
  );
  insert into app.routine_telebirr_runtime_events (
    request_key, event_kind, authorization_id, certificate_id, device_id, device_key_id,
    no_money_signer_key_id, execution_signer_key_id, platform_agent_account_id, valid_until
  ) values (
    p_request_key, 'activate', authority.id, certificate.certificate_id,
    certificate.device_id, certificate.device_key_id, certificate.certificate_signer_key_id,
    'companion-execution-production-v1', authority.platform_agent_account_id,
    certificate.valid_until
  );
  return certificate.valid_until;
end;
$$;

create function app.disable_routine_telebirr_execution_transport(
  p_request_key uuid,
  p_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  latest app.routine_telebirr_runtime_events%rowtype;
  previous app.routine_telebirr_runtime_events%rowtype;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can disable routine deposits.';
  end if;
  if p_request_key is null
    or p_reason_code not in ('operator_requested', 'incident_stop', 'rotation') then
    raise exception 'The routine deposit disable input is invalid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:routine-telebirr-runtime', 20261005)
  );
  select event.* into previous from app.routine_telebirr_runtime_events event
    where event.request_key = p_request_key;
  if previous.id is not null then
    if previous.event_kind <> 'disable' or previous.reason_code <> p_reason_code then
      raise exception 'The routine runtime request key has already been used.';
    end if;
    return true;
  end if;
  select event.* into latest from app.routine_telebirr_runtime_events event
    order by event.event_sequence desc limit 1 for share;
  if latest.id is null then return true; end if;
  execute 'alter role fetanagent_routine_deposit_broker_runtime with '
    || 'nologin noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password null valid until ''infinity''';
  execute 'revoke fetanagent_routine_deposit_broker '
    || 'from fetanagent_routine_deposit_broker_runtime';
  insert into app.routine_telebirr_runtime_events (
    request_key, event_kind, authorization_id, certificate_id, device_id, device_key_id,
    no_money_signer_key_id, execution_signer_key_id, platform_agent_account_id,
    valid_until, reason_code
  ) values (
    p_request_key, 'disable', latest.authorization_id, latest.certificate_id,
    latest.device_id, latest.device_key_id, latest.no_money_signer_key_id,
    latest.execution_signer_key_id, latest.platform_agent_account_id,
    greatest(latest.valid_until, pg_catalog.clock_timestamp() + interval '1 minute'),
    p_reason_code
  );
  return true;
end;
$$;

-- Preserve the one-job approval path, while allowing only this new role to lease an admitted,
-- current routine binding. No other caller gains a TeleBirr bypass.
create or replace function app.require_owner_approved_telebirr_execution_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare provider_code text;
begin
  if old.job_kind <> 'execute_deposit'
    or old.status not in ('queued', 'retry_wait') or new.status <> 'leased' then
    return new;
  end if;
  select provider.code into provider_code
    from app.deposit_intents intent
    join app.payment_providers provider on provider.id = intent.payment_provider_id
   where intent.id = old.deposit_intent_id;
  if provider_code is null then raise exception 'The execution provider is unavailable.'; end if;
  if provider_code = 'telebirr' and not exists (
    select 1 from app.deposit_execution_owner_approvals approval
    join app.private_live_deposit_pilot_reservations reservation
      on reservation.pilot_revision_id = approval.pilot_revision_id
     and reservation.deposit_intent_id = approval.deposit_intent_id
    where approval.execution_job_id = old.id
      and approval.deposit_intent_id = old.deposit_intent_id
      and approval.activation_epoch = (
        select control.current_epoch from app.private_trusted_telebirr_activation_control control
        where control.control_key = 'trusted_telebirr_financial_authority'
      )
      and approval.approved_at <= pg_catalog.clock_timestamp()
      and approval.expires_at > pg_catalog.clock_timestamp()
  ) and not (
    session_user = 'fetanagent_routine_deposit_broker_runtime'
    and pg_catalog.pg_has_role(session_user, 'fetanagent_routine_deposit_broker', 'member')
    and exists (
      select 1 from app.routine_telebirr_execution_bindings binding
      join app.routine_telebirr_processing_events policy_event
        on policy_event.authorization_id = binding.authorization_id
      where binding.execution_job_id = old.id
        and binding.deposit_intent_id = old.deposit_intent_id
        and policy_event.event_sequence = (
          select pg_catalog.max(latest.event_sequence)
          from app.routine_telebirr_processing_events latest
        )
        and policy_event.event_kind = 'authorize'
    )
  ) then
    raise exception 'TeleBirr execution requires current one-job Owner approval or routine authority.';
  end if;
  return new;
end;
$$;

create function app.execute_agent_platform_routine_deposit_command(
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
  p_command_digest text,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  activation app.routine_telebirr_runtime_events%rowtype;
  attempt app.deposit_execution_attempts%rowtype;
  authoritative_binding jsonb;
  candidate_job_id uuid;
  certificate_uuid uuid;
  command_request_id uuid;
  execution_job app.deposit_jobs%rowtype;
  fence record;
  latest_policy app.routine_telebirr_processing_events%rowtype;
  operation text;
  previous app.routine_telebirr_broker_requests%rowtype;
  reconciliation app.execution_reconciliations%rowtype;
  result jsonb;
  worker_id uuid;
  switch_count integer;
begin
  if session_user <> 'fetanagent_routine_deposit_broker_runtime'
    or not pg_catalog.pg_has_role(session_user, 'fetanagent_routine_deposit_broker', 'member') then
    raise exception using errcode = '42501', message = 'The routine broker session is required.';
  end if;
  if app.agent_platform_companion_execution_valid_http_request(
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id,
    p_certificate_id, p_device_id, p_device_key_id, p_request_issued_at,
    p_request_expires_at, p_assessed_at
  ) is distinct from true
    or p_command_digest is null or p_command_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_certificate_id is null
    or p_certificate_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command is null or pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or pg_catalog.pg_column_size(p_command) > 32768
    or p_command ->> 'contractVersion' is distinct from '1'
    or p_command ->> 'protocolMode'
      is distinct from 'windows_companion_routine_deposit_execution_v1'
    or p_command ->> 'capability'
      is distinct from 'kemerbet.deposit.submit.verified_receipt_amount.routine.v1'
    or coalesce(p_command ->> 'requestId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    or coalesce(p_command ->> 'workerInstanceId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    or p_command ->> 'operation' is null
    or p_command ->> 'operation'
      not in ('lease', 'fence', 'record_dispatch', 'reconcile', 'complete', 'pause')
    or not (p_command ?& array[
      'contractVersion', 'protocolMode', 'capability', 'requestId',
      'workerInstanceId', 'operation'
    ]) then
    raise exception 'The routine broker command is invalid.';
  end if;
  certificate_uuid := p_certificate_id::uuid;
  command_request_id := (p_command ->> 'requestId')::uuid;
  worker_id := (p_command ->> 'workerInstanceId')::uuid;
  operation := p_command ->> 'operation';
  if (operation = 'lease' and (
      (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) <> 7
      or not (p_command ? 'expectedPlatformAgentAccountId')
      or coalesce(p_command ->> 'expectedPlatformAgentAccountId' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    )) or (operation in ('fence', 'reconcile') and (
      (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) <> 7
      or pg_catalog.jsonb_typeof(p_command -> 'binding') is distinct from 'object'
    )) or (operation = 'record_dispatch' and (
      (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) <> 8
      or pg_catalog.jsonb_typeof(p_command -> 'binding') is distinct from 'object'
      or pg_catalog.jsonb_typeof(p_command -> 'dispatch') is distinct from 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command -> 'dispatch')) <> 3
      or p_command #>> '{dispatch,outcome}' is distinct from 'submission_attempted'
      or coalesce(p_command #>> '{dispatch,providerResponseDigest}' !~
        '^sha256:[0-9a-f]{64}$', true)
      or p_command #>> '{dispatch,exactPlayerCreditMatch}' is distinct from 'true'
    )) or (operation = 'complete' and (
      (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) <> 8
      or pg_catalog.jsonb_typeof(p_command -> 'binding') is distinct from 'object'
      or coalesce(p_command ->> 'reconciliationId' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    )) or (operation = 'pause' and (
      (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) <> 8
      or (pg_catalog.jsonb_typeof(p_command -> 'binding') is distinct from 'object'
        and pg_catalog.jsonb_typeof(p_command -> 'binding') is distinct from 'null')
      or p_command ->> 'reason' is null
      or p_command ->> 'reason' not in (
        'invalid_policy_or_lease', 'database_unavailable', 'execution_uncertain',
        'reconciliation_uncertain', 'confirmation_mismatch', 'operator_stopped'
      )
    )) then
    raise exception 'The routine broker command shape is invalid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(command_request_id::text, 20261005)
  );
  select request.* into previous from app.routine_telebirr_broker_requests request
    where request.request_id = command_request_id
       or request.http_replay_identity = p_http_replay_identity
       or request.http_request_body_digest = p_http_request_body_digest
       or request.command_digest = p_command_digest
    for share;
  if previous.request_id is not null then
    if previous.request_id <> command_request_id
      or previous.http_replay_identity <> p_http_replay_identity
      or previous.http_request_body_digest <> p_http_request_body_digest
      or previous.command_digest <> p_command_digest
      or previous.certificate_id <> certificate_uuid
      or previous.operation <> operation
      or previous.command_body <> p_command then
      raise exception 'The routine broker replay identity is already bound.';
    end if;
    return previous.result_body;
  end if;
  select event.* into activation from app.routine_telebirr_runtime_events event
    order by event.event_sequence desc limit 1 for share;
  if activation.id is null or activation.event_kind <> 'activate'
    or activation.valid_until <= p_assessed_at
    or activation.certificate_id <> certificate_uuid
    or activation.device_id <> p_device_id or activation.device_key_id <> p_device_key_id
    or activation.no_money_signer_key_id <> p_no_money_signer_key_id
    or activation.execution_signer_key_id <> p_execution_signer_key_id
    or not app.agent_platform_companion_execution_certificate_is_active(
      certificate_uuid, p_device_id, p_device_key_id, p_no_money_signer_key_id, p_assessed_at
    ) then
    raise exception 'The routine broker activation is unavailable.';
  end if;
  if operation = 'lease' and (
    p_command ->> 'expectedPlatformAgentAccountId' is null
    or (p_command ->> 'expectedPlatformAgentAccountId')::uuid
      <> activation.platform_agent_account_id
  ) then raise exception 'The routine account binding does not match.'; end if;

  -- Existing post-fence work is always observable, even after a policy stop or local pause.
  select existing.* into attempt from app.deposit_execution_attempts existing
  join app.routine_telebirr_execution_bindings binding
    on binding.execution_job_id = existing.deposit_job_id
  where existing.platform_agent_account_id = activation.platform_agent_account_id
    and existing.status in ('prepared', 'final_action_fenced', 'reconciliation_required', 'review_required')
  order by existing.created_at, existing.id limit 1 for update of existing;

  if operation = 'lease' and attempt.id is not null and attempt.status = 'prepared' then
    select job.* into execution_job from app.deposit_jobs job
      where job.id = attempt.deposit_job_id for update;
    if execution_job.lease_expires_at <= p_assessed_at then
      perform * from app.cancel_deposit_execution_before_action(
        attempt.id, execution_job.lease_token, 'execution_lease_expired_before_action'
      );
      attempt := null;
    else
      result := 'null'::jsonb;
    end if;
  end if;
  if operation = 'lease' and attempt.id is not null and attempt.status = 'final_action_fenced' then
    select job.* into execution_job from app.deposit_jobs job
      where job.id = attempt.deposit_job_id for update;
    if execution_job.lease_expires_at <= p_assessed_at then
      perform * from app.require_deposit_execution_reconciliation(attempt.id, null, null);
      select current_attempt.* into attempt from app.deposit_execution_attempts current_attempt
        where current_attempt.id = attempt.id;
    else
      result := 'null'::jsonb;
    end if;
  end if;
  if operation = 'lease' and attempt.id is not null
    and attempt.status in ('reconciliation_required', 'review_required') then
    authoritative_binding := app.routine_telebirr_attempt_binding_json(attempt.id);
    result := authoritative_binding || pg_catalog.jsonb_build_object(
      'policy', app.routine_telebirr_runtime_policy_json(), 'phase', 'reconcile',
      'paymentVerified', true, 'playerActive', true, 'playerDepositEligible', true,
      'attemptNumber', 1, 'finalActionFenced', true
    );
  end if;

  if operation = 'lease' and result is null then
    select event.* into latest_policy from app.routine_telebirr_processing_events event
      order by event.event_sequence desc limit 1 for share;
    if latest_policy.id is null or latest_policy.event_kind <> 'authorize'
      or latest_policy.authorization_id <> activation.authorization_id
      or exists (
        select 1 from app.routine_telebirr_runtime_pauses pause
        where pause.authorization_event_sequence = latest_policy.event_sequence
      ) then
      result := 'null'::jsonb;
    else
      perform feature_switch.feature_key from app.feature_switches feature_switch
        where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
        order by feature_switch.feature_key for share;
      select pg_catalog.count(*)::integer into switch_count from app.feature_switches feature_switch
        where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
          and feature_switch.mode = 'live';
      if switch_count <> 2 then
        result := 'null'::jsonb;
      else
        select job.id into candidate_job_id
        from app.deposit_jobs job
        cross join lateral app.assess_routine_telebirr_execution_job(job.id) assessed
        where assessed.authorization_id = activation.authorization_id
          and assessed.platform_agent_account_id = activation.platform_agent_account_id
        order by job.priority desc, job.run_after, job.created_at, job.id
        for update of job skip locked limit 1;
        if candidate_job_id is null then
          result := 'null'::jsonb;
        else
          perform app.admit_routine_telebirr_execution_job(candidate_job_id);
          update app.deposit_jobs job set
            status = 'leased', attempt_count = 1, lease_token = gen_random_uuid(),
            leased_by = worker_id::text,
            lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
            last_error_code = null
          where job.id = candidate_job_id returning * into execution_job;
          insert into app.deposit_execution_attempts (
            deposit_intent_id, deposit_job_id, platform_agent_account_id, attempt_number
          ) values (
            execution_job.deposit_intent_id, execution_job.id,
            activation.platform_agent_account_id, 1
          ) returning * into attempt;
          authoritative_binding := app.routine_telebirr_attempt_binding_json(attempt.id);
          result := authoritative_binding || pg_catalog.jsonb_build_object(
            'policy', app.routine_telebirr_runtime_policy_json(), 'phase', 'execute',
            'paymentVerified', true, 'playerActive', true, 'playerDepositEligible', true,
            'attemptNumber', 1, 'finalActionFenced', false
          );
        end if;
      end if;
    end if;
  elsif operation <> 'lease' then
    if p_command -> 'binding' is not null and p_command -> 'binding' <> 'null'::jsonb then
      authoritative_binding := app.routine_telebirr_attempt_binding_json(
        (p_command #>> '{binding,attemptId}')::uuid
      );
      if authoritative_binding is null or authoritative_binding <> p_command -> 'binding'
        or (authoritative_binding ->> 'platformAgentAccountId')::uuid
          <> activation.platform_agent_account_id then
        raise exception 'The routine command binding does not match.';
      end if;
      select current_attempt.* into attempt from app.deposit_execution_attempts current_attempt
        where current_attempt.id = (p_command #>> '{binding,attemptId}')::uuid for update;
    end if;

    if operation = 'fence' then
      select event.* into latest_policy from app.routine_telebirr_processing_events event
        order by event.event_sequence desc limit 1 for share;
      if latest_policy.event_kind <> 'authorize'
        or latest_policy.authorization_id <> activation.authorization_id
        or exists (
          select 1 from app.routine_telebirr_runtime_pauses pause
          where pause.authorization_event_sequence = latest_policy.event_sequence
        ) then raise exception 'Routine processing is stopped or paused.'; end if;
      select job.* into execution_job from app.deposit_jobs job
        where job.id = attempt.deposit_job_id and job.leased_by = worker_id::text for update;
      if execution_job.id is null then raise exception 'The routine lease owner does not match.'; end if;
      select * into fence from app.fence_deposit_execution_final_action(
        attempt.id, execution_job.lease_token
      );
      if fence.first_fence_acquired is distinct from true then
        raise exception 'The routine final-action fence is not first-use.';
      end if;
      result := authoritative_binding || pg_catalog.jsonb_build_object(
        'firstFenceAcquired', true,
        'issuedAtMs', pg_catalog.floor(extract(epoch from fence.final_action_fenced_at) * 1000)::bigint,
        'validUntilMs', pg_catalog.floor(extract(epoch from fence.final_action_fenced_at + interval '10 seconds') * 1000)::bigint
      );
    elsif operation = 'record_dispatch' then
      if p_command #>> '{dispatch,outcome}' <> 'submission_attempted'
        or p_command #>> '{dispatch,providerResponseDigest}' !~ '^sha256:[0-9a-f]{64}$'
        or p_command #>> '{dispatch,exactPlayerCreditMatch}' <> 'true' then
        raise exception 'The routine dispatch evidence is invalid.';
      end if;
      select job.* into execution_job from app.deposit_jobs job
        where job.id = attempt.deposit_job_id and job.leased_by = worker_id::text for update;
      if execution_job.id is null then raise exception 'The routine lease owner does not match.'; end if;
      insert into app.routine_telebirr_dispatch_evidence (
        execution_attempt_id, broker_request_id, provider_response_digest,
        exact_player_credit_match
      ) values (
        attempt.id, command_request_id,
        p_command #>> '{dispatch,providerResponseDigest}', true
      );
      perform * from app.require_deposit_execution_reconciliation(
        attempt.id, execution_job.lease_token, true
      );
      result := authoritative_binding;
    elsif operation = 'reconcile' then
      select observed.* into reconciliation from app.execution_reconciliations observed
        where observed.deposit_execution_attempt_id = attempt.id
          and observed.outcome = 'confirmed_executed'
        order by observed.reconciliation_number desc limit 1;
      if reconciliation.id is not null then
        result := authoritative_binding || pg_catalog.jsonb_build_object(
          'outcome', 'confirmed_executed', 'reconciliationId', reconciliation.id::text,
          'evidenceDigest', app.agent_platform_companion_lookup_sha256(
            'fetanagent:routine-reconciliation:v1:' || reconciliation.id::text || ':'
            || reconciliation.keyed_external_reference_fingerprint || ':'
            || reconciliation.matched_history_occurred_at::text
          ),
          'exactHistoryMatchCount', reconciliation.approved_history_match_count,
          'playerCreditConfirmed', reconciliation.exact_player_credit_match
        );
      elsif attempt.status = 'review_required' then
        result := pg_catalog.jsonb_build_object('outcome', 'uncertain');
      else
        result := pg_catalog.jsonb_build_object('outcome', 'pending');
      end if;
    elsif operation = 'complete' then
      select observed.* into reconciliation from app.execution_reconciliations observed
        where observed.id = (p_command ->> 'reconciliationId')::uuid
          and observed.deposit_execution_attempt_id = attempt.id
          and observed.outcome = 'confirmed_executed'
          and observed.approved_history_match_count = 1
          and observed.exact_player_match and observed.exact_amount_match
          and observed.exact_currency_match and observed.exact_player_credit_match;
      if reconciliation.id is null or attempt.status <> 'confirmed_executed' then
        raise exception 'The exact durable reconciliation is not complete.';
      end if;
      result := authoritative_binding;
    elsif operation = 'pause' then
      select event.* into latest_policy from app.routine_telebirr_processing_events event
        order by event.event_sequence desc limit 1 for share;
      if latest_policy.id is null then raise exception 'The routine policy event is unavailable.'; end if;
      insert into app.routine_telebirr_runtime_pauses (
        authorization_event_sequence, broker_request_id, execution_attempt_id,
        reason_code, certificate_id
      ) values (
        latest_policy.event_sequence, command_request_id, attempt.id,
        p_command ->> 'reason', certificate_uuid
      ) on conflict (authorization_event_sequence) do nothing;
      result := 'null'::jsonb;
    end if;
  end if;
  if result is null then raise exception 'The routine broker command produced no result.'; end if;
  insert into app.routine_telebirr_broker_requests (
    request_id, http_replay_identity, http_request_body_digest, command_digest,
    certificate_id, operation, command_body, result_body, assessed_at
  ) values (
    command_request_id, p_http_replay_identity, p_http_request_body_digest, p_command_digest,
    certificate_uuid, operation, p_command, result, p_assessed_at
  );
  return result;
end;
$$;

-- The Owner projection now distinguishes an authorized policy from an actually live, bound lane.
create or replace function app.get_owner_routine_telebirr_processing(p_actor_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest app.routine_telebirr_processing_events%rowtype;
  authority app.routine_telebirr_processing_authorizations%rowtype;
begin
  perform app.require_routine_telebirr_owner(p_actor_auth_user_id);
  select event.* into latest from app.routine_telebirr_processing_events event
    order by event.event_sequence desc limit 1;
  select saved.* into authority from app.routine_telebirr_processing_authorizations saved
    where saved.id = latest.authorization_id;
  return pg_catalog.jsonb_build_object(
    'configurationState', case when latest.id is null then 'not_configured'
      when latest.event_kind = 'authorize' then 'authorized' else 'stopped' end,
    'executionEnabled', case when latest.event_kind = 'authorize'
      then app.routine_telebirr_runtime_is_active(authority.id) else false end,
    'authorizationId', authority.id, 'revision', authority.revision::text,
    'platformAgentAccountId', authority.platform_agent_account_id,
    'authorizedAt', authority.authorized_at, 'changedAt', latest.recorded_at,
    'policy', app.routine_telebirr_processing_policy_json(authority.id)
  );
end;
$$;

alter function app.routine_telebirr_attempt_binding_json(uuid) owner to postgres;
alter function app.routine_telebirr_runtime_policy_json() owner to postgres;
alter function app.routine_telebirr_runtime_is_active(uuid) owner to postgres;
alter function app.activate_routine_telebirr_execution_transport(uuid,uuid,uuid,text) owner to postgres;
alter function app.disable_routine_telebirr_execution_transport(uuid,text) owner to postgres;
alter function app.require_owner_approved_telebirr_execution_lease() owner to postgres;
alter function app.execute_agent_platform_routine_deposit_command(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) owner to postgres;
alter function app.get_owner_routine_telebirr_processing(uuid) owner to postgres;

revoke all on function
  app.routine_telebirr_attempt_binding_json(uuid),
  app.routine_telebirr_runtime_policy_json(),
  app.routine_telebirr_runtime_is_active(uuid),
  app.activate_routine_telebirr_execution_transport(uuid,uuid,uuid,text),
  app.disable_routine_telebirr_execution_transport(uuid,text),
  app.execute_agent_platform_routine_deposit_command(
    text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
  )
from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;
grant usage on schema app to fetanagent_routine_deposit_broker;
grant execute on function app.execute_agent_platform_routine_deposit_command(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) to fetanagent_routine_deposit_broker;

revoke all on sequence
  app.routine_telebirr_runtime_events_event_sequence_seq
from public, anon, authenticated, service_role,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

comment on role fetanagent_routine_deposit_broker_runtime is
  'Explicitly activated, one-connection routine TeleBirr broker. Dormant NOLOGIN after migration or emergency disable.';
comment on function app.execute_agent_platform_routine_deposit_command(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) is
  'Authenticated replay-safe routine lease/fence/dispatch/reconciliation broker. It cannot create payment claims and never treats a provider response as durable credit confirmation.';

commit;
