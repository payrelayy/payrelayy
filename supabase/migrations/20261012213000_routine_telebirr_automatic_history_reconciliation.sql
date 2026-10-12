-- Dormant, signed Companion-only reconciliation of a previously fenced routine credit.
-- This migration never enables a switch, submits a provider transfer, or processes old attempts.
begin;
set local lock_timeout = '5s';

alter default privileges for role postgres in schema app revoke execute on functions from public;

create table app.routine_telebirr_history_confirmations (
  request_id uuid primary key,
  http_replay_identity text not null unique check (http_replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  http_request_body_digest text not null unique
    check (http_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  command_digest text not null unique check (command_digest ~ '^sha256:[0-9a-f]{64}$'),
  certificate_id uuid not null references app.agent_platform_companion_enrollment_certificates
    (certificate_id) on delete restrict,
  execution_attempt_id uuid not null unique references app.deposit_execution_attempts (id)
    on delete restrict,
  history_transaction_id text not null unique check (history_transaction_id ~ '^[0-9]{6,20}$'),
  history_request_id text not null unique check (history_request_id ~ '^[0-9]{6,20}$'),
  history_occurred_at timestamptz not null,
  keyed_history_reference_fingerprint text not null unique
    check (keyed_history_reference_fingerprint ~ '^hmac-sha256-v1:[0-9a-f]{64}$'),
  reconciliation_id uuid not null unique references app.execution_reconciliations (id)
    on delete restrict deferrable initially deferred,
  result_body jsonb not null check (pg_catalog.pg_column_size(result_body) <= 32768),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table app.routine_telebirr_history_confirmations enable row level security;
alter table app.routine_telebirr_history_confirmations force row level security;
alter table app.routine_telebirr_history_confirmations owner to postgres;
create trigger routine_telebirr_history_confirmations_immutable
  before update or delete on app.routine_telebirr_history_confirmations
  for each row execute function app.reject_deposit_ledger_delete();
create trigger routine_telebirr_history_confirmations_no_truncate
  before truncate on app.routine_telebirr_history_confirmations
  for each statement execute function app.reject_execution_ledger_truncate();
revoke all on app.routine_telebirr_history_confirmations from
  public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

create function app.execute_agent_platform_routine_deposit_history_confirmation(
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
  certificate_uuid uuid;
  command_request_id uuid;
  history_time timestamptz;
  job app.deposit_jobs%rowtype;
  keyed_fingerprint text;
  observed app.routine_telebirr_history_confirmations%rowtype;
  recorded record;
  result jsonb;
begin
  if session_user <> 'fetanagent_routine_deposit_broker_runtime'
    or not pg_catalog.pg_has_role(session_user, 'fetanagent_routine_deposit_broker', 'member')
  then raise exception using errcode = '42501', message = 'The routine broker session is required.';
  end if;
  if app.agent_platform_companion_execution_valid_http_request(
    p_http_replay_identity, p_http_request_body_digest, p_http_request_id,
    p_certificate_id, p_device_id, p_device_key_id, p_request_issued_at,
    p_request_expires_at, p_assessed_at
  ) is distinct from true
    or p_command_digest is null or p_command_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_command is null or pg_catalog.jsonb_typeof(p_command) <> 'object'
    or pg_catalog.pg_column_size(p_command) > 32768
    or p_command ->> 'contractVersion' is distinct from '1'
    or p_command ->> 'protocolMode' is distinct from
      'windows_companion_routine_deposit_execution_v1'
    or p_command ->> 'capability' is distinct from
      'kemerbet.deposit.submit.verified_receipt_amount.routine.v1'
    or p_command ->> 'operation' is distinct from 'confirm_history'
    or coalesce(p_command ->> 'requestId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    or coalesce(p_command ->> 'workerInstanceId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) <> 8
    or not (p_command ?& array[
      'contractVersion', 'protocolMode', 'capability', 'requestId',
      'workerInstanceId', 'operation', 'binding', 'observation'
    ])
    or pg_catalog.jsonb_typeof(p_command -> 'binding') <> 'object'
    or pg_catalog.jsonb_typeof(p_command -> 'observation') <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(
      p_command -> 'observation')) <> 7
    or not ((p_command -> 'observation') ?& array[
      'transactionId', 'requestId', 'occurredAt', 'playerId',
      'amountMinor', 'currencyCode', 'approvedHistoryMatchCount'
    ])
    or coalesce(p_command #>> '{observation,transactionId}' !~ '^[0-9]{6,20}$', true)
    or coalesce(p_command #>> '{observation,requestId}' !~ '^[0-9]{6,20}$', true)
    or coalesce(p_command #>> '{observation,occurredAt}' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$', true)
    or p_command #>> '{observation,currencyCode}' is distinct from 'ETB'
    or p_command #>> '{observation,approvedHistoryMatchCount}' is distinct from '1'
  then raise exception 'The routine history command is invalid.';
  end if;

  certificate_uuid := p_certificate_id::uuid;
  command_request_id := (p_command ->> 'requestId')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(command_request_id::text, 20261012213000)
  );
  select receipt.* into observed from app.routine_telebirr_history_confirmations receipt
    where receipt.request_id = command_request_id
       or receipt.http_replay_identity = p_http_replay_identity
       or receipt.http_request_body_digest = p_http_request_body_digest
       or receipt.command_digest = p_command_digest
    for share;
  if observed.request_id is not null then
    if observed.request_id <> command_request_id
      or observed.http_replay_identity <> p_http_replay_identity
      or observed.http_request_body_digest <> p_http_request_body_digest
      or observed.command_digest <> p_command_digest
      or observed.certificate_id <> certificate_uuid
      or observed.history_transaction_id <>
        p_command #>> '{observation,transactionId}'
      or observed.history_request_id <> p_command #>> '{observation,requestId}'
    then raise exception 'The routine history replay identity is already bound.';
    end if;
    return observed.result_body;
  end if;

  select event.* into activation from app.routine_telebirr_runtime_events event
    order by event.event_sequence desc limit 1 for share;
  if activation.id is null or activation.event_kind <> 'activate'
    or activation.valid_until <= p_assessed_at
    or activation.certificate_id <> certificate_uuid
    or activation.device_id <> p_device_id
    or activation.device_key_id <> p_device_key_id
    or activation.no_money_signer_key_id <> p_no_money_signer_key_id
    or activation.execution_signer_key_id <> p_execution_signer_key_id
    or not app.agent_platform_companion_execution_certificate_is_active(
      certificate_uuid, p_device_id, p_device_key_id,
      p_no_money_signer_key_id, p_assessed_at
    )
  then raise exception 'The routine history transport is unavailable.';
  end if;

  authoritative_binding := app.routine_telebirr_attempt_binding_json(
    (p_command #>> '{binding,attemptId}')::uuid
  );
  if authoritative_binding is null
    or authoritative_binding <> p_command -> 'binding'
    or (authoritative_binding ->> 'platformAgentAccountId')::uuid <>
      activation.platform_agent_account_id
    or p_command #>> '{observation,playerId}' <>
      authoritative_binding ->> 'playerId'
    or (p_command #>> '{observation,amountMinor}')::bigint <>
      (authoritative_binding ->> 'amountMinor')::bigint
  then raise exception 'The routine history binding does not match.';
  end if;
  select current_attempt.* into attempt from app.deposit_execution_attempts current_attempt
    where current_attempt.id = (authoritative_binding ->> 'attemptId')::uuid for update;
  if attempt.status <> 'reconciliation_required'
    or attempt.exact_player_credit_match is distinct from true
    or not exists (
      select 1 from app.routine_telebirr_dispatch_evidence dispatch
        where dispatch.execution_attempt_id = attempt.id
          and dispatch.exact_player_credit_match
    )
  then raise exception 'The routine history observation lacks its signed dispatch.';
  end if;
  history_time := (p_command #>> '{observation,occurredAt}')::timestamptz;
  if history_time < attempt.final_action_fenced_at
    or history_time > attempt.reconciliation_required_at
  then raise exception 'The history timestamp is outside the server-authored final action.';
  end if;

  select candidate.* into job from app.deposit_jobs candidate
    where candidate.deposit_intent_id = attempt.deposit_intent_id
      and candidate.job_kind = 'reconcile_execution'
      and candidate.status in ('queued', 'retry_wait')
      and candidate.run_after <= pg_catalog.clock_timestamp()
      and candidate.attempt_count < candidate.max_attempts
    order by candidate.created_at, candidate.id limit 1 for update;
  if job.id is null then raise exception 'The routine reconciliation job is unavailable.';
  end if;
  update app.deposit_jobs candidate set
    status = 'leased', attempt_count = candidate.attempt_count + 1,
    lease_token = gen_random_uuid(),
    leased_by = (p_command ->> 'workerInstanceId'),
    lease_expires_at = pg_catalog.clock_timestamp() + interval '1 minute',
    last_error_code = null
    where candidate.id = job.id returning * into job;

  -- A random one-use request UUID is the HMAC key. The raw provider IDs stay only in this
  -- private immutable receipt, whose transaction/request uniqueness blocks reuse across jobs.
  keyed_fingerprint := 'hmac-sha256-v1:' || pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to('kemerbet-deposit:' ||
        (p_command #>> '{observation,transactionId}'), 'UTF8'),
      pg_catalog.convert_to(command_request_id::text, 'UTF8'), 'sha256'
    ), 'hex'
  );
  select * into recorded from app.record_deposit_execution_reconciliation(
    job.id, job.lease_token, 'confirmed_executed', keyed_fingerprint,
    1::smallint, 'deposit', history_time, true, true, true, true
  );
  if recorded.outcome <> 'confirmed_executed'
    or recorded.execution_attempt_id <> attempt.id
    or recorded.deposit_intent_id <> attempt.deposit_intent_id
  then raise exception 'The exact routine history reconciliation was not confirmed.';
  end if;
  result := authoritative_binding || pg_catalog.jsonb_build_object(
    'outcome', 'confirmed_executed',
    'reconciliationId', recorded.reconciliation_id::text,
    'evidenceDigest', app.agent_platform_companion_lookup_sha256(
      'fetanagent:routine-reconciliation:v1:' || recorded.reconciliation_id::text || ':'
      || keyed_fingerprint || ':' || history_time::text
    ),
    'exactHistoryMatchCount', 1,
    'playerCreditConfirmed', true
  );
  insert into app.routine_telebirr_history_confirmations (
    request_id, http_replay_identity, http_request_body_digest,
    command_digest, certificate_id, execution_attempt_id,
    history_transaction_id, history_request_id, history_occurred_at,
    keyed_history_reference_fingerprint, reconciliation_id, result_body
  ) values (
    command_request_id, p_http_replay_identity, p_http_request_body_digest,
    p_command_digest, certificate_uuid, attempt.id,
    p_command #>> '{observation,transactionId}',
    p_command #>> '{observation,requestId}', history_time,
    keyed_fingerprint, recorded.reconciliation_id, result
  );
  return result;
end;
$$;

alter function app.execute_agent_platform_routine_deposit_history_confirmation(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) owner to postgres;
revoke all on function app.execute_agent_platform_routine_deposit_history_confirmation(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) from public, anon, authenticated, service_role;
grant execute on function app.execute_agent_platform_routine_deposit_history_confirmation(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) to fetanagent_routine_deposit_broker;

commit;
