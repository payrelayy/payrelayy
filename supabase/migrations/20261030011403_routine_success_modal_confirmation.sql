-- A fresh, exact KemerBet Transfer Successful result is the final routine credit signal.
-- Existing history confirmations remain auditable. No old dispatch is promoted by this migration.
begin;
set local lock_timeout = '5s';
alter default privileges for role postgres in schema app revoke execute on functions from public;

create table app.routine_telebirr_modal_cutover (
  singleton boolean primary key default true check (singleton),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into app.routine_telebirr_modal_cutover (singleton) values (true);

alter table app.execution_reconciliations
  add column modal_provider_response_digest text;
alter table app.execution_reconciliations
  drop constraint execution_reconciliations_reason_shape_check;
alter table app.execution_reconciliations
  add constraint execution_reconciliations_reason_shape_check check (
    (outcome = 'confirmed_executed' and reason_code in (
      'agent_deposit_history_in_window_and_player_credit_confirmed',
      'owner_confirmed_history_minute_and_signed_dispatch',
      'agent_transfer_success_modal_confirmed'
    ))
    or (outcome = 'ambiguous' and reason_code = 'agent_history_ambiguous')
    or (outcome = 'not_observed' and reason_code = 'agent_history_not_observed')
  );
alter table app.execution_reconciliations
  drop constraint execution_reconciliations_evidence_shape_check;
alter table app.execution_reconciliations
  add constraint execution_reconciliations_evidence_shape_check check (
    (outcome = 'confirmed_executed'
      and reason_code <> 'agent_transfer_success_modal_confirmed'
      and modal_provider_response_digest is null
      and keyed_external_reference_fingerprint is not null
      and keyed_external_reference_fingerprint ~ '^hmac-sha256-v1:[0-9a-f]{64}$'
      and approved_history_match_count is not null
      and approved_history_match_count = 1
      and normalized_operation_type is not null
      and normalized_operation_type = 'deposit'
      and matched_history_occurred_at is not null
      and exact_player_match is true and exact_amount_match is true
      and exact_currency_match is true and exact_player_credit_match is true)
    or (outcome = 'confirmed_executed'
      and reason_code = 'agent_transfer_success_modal_confirmed'
      and modal_provider_response_digest is not null
      and modal_provider_response_digest ~ '^sha256:[0-9a-f]{64}$'
      and keyed_external_reference_fingerprint is null
      and approved_history_match_count is null
      and normalized_operation_type is null
      and matched_history_occurred_at is null
      and exact_player_match is true and exact_amount_match is true
      and exact_currency_match is true and exact_player_credit_match is true)
    or (outcome in ('ambiguous', 'not_observed')
      and modal_provider_response_digest is null
      and keyed_external_reference_fingerprint is null
      and approved_history_match_count is null
      and normalized_operation_type is null
      and matched_history_occurred_at is null
      and exact_player_match is null and exact_amount_match is null
      and exact_currency_match is null and exact_player_credit_match is null)
  );

create table app.routine_telebirr_modal_confirmations (
  request_id uuid primary key,
  http_replay_identity text not null unique check (http_replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  http_request_body_digest text not null unique check (http_request_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  command_digest text not null unique check (command_digest ~ '^sha256:[0-9a-f]{64}$'),
  command_body jsonb not null check (pg_catalog.jsonb_typeof(command_body) = 'object'
    and pg_catalog.pg_column_size(command_body) <= 32768),
  certificate_id uuid not null references app.agent_platform_companion_enrollment_certificates
    (certificate_id) on delete restrict,
  execution_attempt_id uuid not null unique references app.deposit_execution_attempts (id)
    on delete restrict,
  dispatch_broker_request_id uuid not null unique references app.routine_telebirr_broker_requests
    (request_id) on delete restrict,
  modal_provider_response_digest text not null check
    (modal_provider_response_digest ~ '^sha256:[0-9a-f]{64}$'),
  reconciliation_id uuid not null unique references app.execution_reconciliations (id)
    on delete restrict deferrable initially deferred,
  result_body jsonb not null check (pg_catalog.pg_column_size(result_body) <= 32768),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table app.routine_telebirr_modal_cutover enable row level security;
alter table app.routine_telebirr_modal_cutover force row level security;
alter table app.routine_telebirr_modal_cutover owner to postgres;
alter table app.routine_telebirr_modal_confirmations enable row level security;
alter table app.routine_telebirr_modal_confirmations force row level security;
alter table app.routine_telebirr_modal_confirmations owner to postgres;
create trigger routine_telebirr_modal_cutover_immutable
  before update or delete on app.routine_telebirr_modal_cutover
  for each row execute function app.reject_deposit_ledger_delete();
create trigger routine_telebirr_modal_cutover_no_truncate
  before truncate on app.routine_telebirr_modal_cutover
  for each statement execute function app.reject_execution_ledger_truncate();
create trigger routine_telebirr_modal_confirmations_immutable
  before update or delete on app.routine_telebirr_modal_confirmations
  for each row execute function app.reject_deposit_ledger_delete();
create trigger routine_telebirr_modal_confirmations_no_truncate
  before truncate on app.routine_telebirr_modal_confirmations
  for each statement execute function app.reject_execution_ledger_truncate();
revoke all on app.routine_telebirr_modal_cutover, app.routine_telebirr_modal_confirmations from
  public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

-- The ledger trigger checks the immutable modal receipt rather than accepting a claimed history row.
create or replace function app.enforce_execution_reconciliation_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  attempt_row app.deposit_execution_attempts%rowtype;
  history_count integer;
  history_maximum integer;
  intent_status app.deposit_status;
  reconciliation_job app.deposit_jobs%rowtype;
begin
  if new.deposit_execution_attempt_id is null
    or new.deposit_intent_id is null
    or new.platform_agent_account_id is null
    or new.deposit_job_id is null
    or new.reconciliation_number is null then
    raise exception 'An execution reconciliation requires all internal ledger identifiers.';
  end if;
  select attempt.* into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.id = new.deposit_execution_attempt_id for update;
  if not found then
    raise exception 'The execution reconciliation references an unknown attempt.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(attempt_row.deposit_intent_id::text, 20260815175508)
  );
  select intent.status into intent_status from app.deposit_intents intent
   where intent.id = attempt_row.deposit_intent_id;
  if not found or intent_status <> 'execution_reconciliation' then
    raise exception 'An outcome may be recorded only while the intent is reconciling.';
  end if;
  if attempt_row.deposit_intent_id is distinct from new.deposit_intent_id
    or attempt_row.platform_agent_account_id is distinct from new.platform_agent_account_id
    or attempt_row.status <> 'reconciliation_required' then
    raise exception 'A reconciliation requires the same blocking reconciliation-required attempt.';
  end if;
  if new.outcome = 'confirmed_executed' then
    if new.reason_code = 'agent_transfer_success_modal_confirmed' then
      if attempt_row.final_action_fenced_at is null
        or attempt_row.reconciliation_required_at is null
        or attempt_row.exact_player_credit_match is distinct from true
        or not exists (
          select 1 from app.routine_telebirr_modal_confirmations receipt
          join app.routine_telebirr_dispatch_evidence dispatch
            on dispatch.broker_request_id = receipt.dispatch_broker_request_id
           and dispatch.execution_attempt_id = receipt.execution_attempt_id
          join app.routine_telebirr_modal_cutover cutover on cutover.singleton
          where receipt.reconciliation_id = new.id
            and receipt.execution_attempt_id = new.deposit_execution_attempt_id
            and receipt.modal_provider_response_digest = new.modal_provider_response_digest
            and dispatch.provider_response_digest = new.modal_provider_response_digest
            and dispatch.exact_player_credit_match
            and dispatch.recorded_at >= cutover.recorded_at
        ) then
        raise exception 'Modal confirmation lacks its exact protected dispatch receipt.';
      end if;
    elsif new.reason_code = 'owner_confirmed_history_minute_and_signed_dispatch' then
      if attempt_row.final_action_fenced_at is null
        or attempt_row.reconciliation_required_at is null
        or not exists (
          select 1 from app.owner_confirmed_dispatched_test_credits receipt
           where receipt.execution_attempt_id = new.deposit_execution_attempt_id
             and receipt.deposit_intent_id = new.deposit_intent_id
             and receipt.reconciliation_job_id = new.deposit_job_id
             and receipt.history_minute_at = new.matched_history_occurred_at
             and receipt.keyed_history_reference_fingerprint =
               new.keyed_external_reference_fingerprint
             and receipt.history_minute_at =
               pg_catalog.date_trunc('minute', attempt_row.final_action_fenced_at)
             and attempt_row.reconciliation_required_at <
               receipt.history_minute_at + interval '1 minute'
        ) then
        raise exception 'Owner-confirmed minute history lacks its exact protected receipt.';
      end if;
    elsif attempt_row.final_action_fenced_at is null
      or attempt_row.reconciliation_required_at is null
      or new.matched_history_occurred_at is null
      or new.matched_history_occurred_at < attempt_row.final_action_fenced_at
      or new.matched_history_occurred_at > attempt_row.reconciliation_required_at then
      raise exception 'Confirmed execution requires matched deposit history inside the server-authored execution window.';
    end if;
  end if;
  select job.* into reconciliation_job from app.deposit_jobs job
   where job.id = new.deposit_job_id and job.deposit_intent_id = new.deposit_intent_id;
  if not found or reconciliation_job.job_kind <> 'reconcile_execution'
    or reconciliation_job.status <> 'leased' or reconciliation_job.attempt_count < 1 then
    raise exception 'A reconciliation requires its leased reconciliation job.';
  end if;
  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.max(reconciliation.reconciliation_number), 0)
    into history_count, history_maximum
    from app.execution_reconciliations reconciliation
   where reconciliation.deposit_execution_attempt_id = new.deposit_execution_attempt_id;
  if history_count <> history_maximum then
    raise exception 'The execution-reconciliation history is malformed.';
  end if;
  if exists (select 1 from app.execution_reconciliations reconciliation
     where reconciliation.deposit_execution_attempt_id = new.deposit_execution_attempt_id
       and reconciliation.outcome in ('confirmed_executed', 'ambiguous')) then
    raise exception 'A terminal execution reconciliation has already been recorded.';
  end if;
  if new.reconciliation_number <> history_maximum + 1 then
    raise exception 'Execution reconciliations require exact sequential numbers.';
  end if;
  new.created_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create function app.execute_agent_platform_routine_deposit_modal_confirmation(
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
  intent app.deposit_intents%rowtype;
  dispatch app.routine_telebirr_dispatch_evidence%rowtype;
  dispatch_request app.routine_telebirr_broker_requests%rowtype;
  reconciliation_job app.deposit_jobs%rowtype;
  previous app.routine_telebirr_modal_confirmations%rowtype;
  cutover_at timestamptz;
  authoritative_binding jsonb;
  certificate_uuid uuid;
  command_request_id uuid;
  reconciliation_uuid uuid;
  decision_number integer;
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
    or p_command ->> 'operation' is distinct from 'confirm_modal'
    or coalesce(p_command ->> 'requestId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    or coalesce(p_command ->> 'workerInstanceId' !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', true)
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_command)) <> 7
    or not (p_command ?& array[
      'contractVersion', 'protocolMode', 'capability', 'requestId',
      'workerInstanceId', 'operation', 'binding'
    ])
    or pg_catalog.jsonb_typeof(p_command -> 'binding') <> 'object'
  then raise exception 'The routine modal command is invalid.';
  end if;
  certificate_uuid := p_certificate_id::uuid;
  command_request_id := (p_command ->> 'requestId')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(command_request_id::text, 20261030011403)
  );
  select receipt.* into previous from app.routine_telebirr_modal_confirmations receipt
   where receipt.request_id = command_request_id
      or receipt.http_replay_identity = p_http_replay_identity
      or receipt.http_request_body_digest = p_http_request_body_digest
      or receipt.command_digest = p_command_digest for share;
  if previous.request_id is not null then
    if previous.request_id <> command_request_id
      or previous.http_replay_identity <> p_http_replay_identity
      or previous.http_request_body_digest <> p_http_request_body_digest
      or previous.command_digest <> p_command_digest
      or previous.certificate_id <> certificate_uuid
      or previous.command_body <> p_command then
      raise exception 'The routine modal replay identity is already bound.';
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
    ) then raise exception 'The routine modal transport is unavailable.';
  end if;
  authoritative_binding := app.routine_telebirr_attempt_binding_json(
    (p_command #>> '{binding,attemptId}')::uuid
  );
  if authoritative_binding is null
    or authoritative_binding <> p_command -> 'binding'
    or (authoritative_binding ->> 'platformAgentAccountId')::uuid <>
      activation.platform_agent_account_id then
    raise exception 'The routine modal binding does not match.';
  end if;
  select current_attempt.* into attempt from app.deposit_execution_attempts current_attempt
    where current_attempt.id = (authoritative_binding ->> 'attemptId')::uuid for update;
  select receipt.* into previous from app.routine_telebirr_modal_confirmations receipt
    where receipt.execution_attempt_id = attempt.id for share;
  if previous.request_id is not null then
    if attempt.status <> 'confirmed_executed'
      or previous.certificate_id <> certificate_uuid
      or previous.result_body <> authoritative_binding then
      raise exception 'The prior modal confirmation conflicts with its attempt.';
    end if;
    return previous.result_body;
  end if;
  if attempt.status <> 'reconciliation_required'
    or attempt.exact_player_credit_match is distinct from true
    or attempt.final_action_fenced_at is null
    or attempt.reconciliation_required_at is null then
    raise exception 'The exact modal dispatch is unavailable for confirmation.';
  end if;
  select evidence.* into dispatch from app.routine_telebirr_dispatch_evidence evidence
    where evidence.execution_attempt_id = attempt.id for share;
  select request.* into dispatch_request from app.routine_telebirr_broker_requests request
    where request.request_id = dispatch.broker_request_id for share;
  select policy.recorded_at into cutover_at from app.routine_telebirr_modal_cutover policy
    where policy.singleton for share;
  if dispatch.execution_attempt_id is null
    or dispatch_request.request_id is null
    or cutover_at is null
    or dispatch.exact_player_credit_match is distinct from true
    or dispatch.provider_response_digest !~ '^sha256:[0-9a-f]{64}$'
    or dispatch.recorded_at < cutover_at
    or dispatch_request.operation <> 'record_dispatch'
    or dispatch_request.certificate_id <> certificate_uuid
    or dispatch_request.command_body -> 'binding' <> authoritative_binding
    or dispatch_request.command_body #>> '{dispatch,providerResponseDigest}' <>
      dispatch.provider_response_digest
    or dispatch_request.command_body #>> '{dispatch,exactPlayerCreditMatch}' <> 'true'
  then raise exception 'The exact signed modal dispatch is unavailable.';
  end if;
  select current_intent.* into intent from app.deposit_intents current_intent
    where current_intent.id = attempt.deposit_intent_id for update;
  if intent.status <> 'execution_reconciliation' then
    raise exception 'The modal attempt is not awaiting confirmation.';
  end if;
  select job.* into reconciliation_job from app.deposit_jobs job
    where job.deposit_intent_id = attempt.deposit_intent_id
      and job.job_kind = 'reconcile_execution'
      and job.status in ('queued', 'retry_wait')
      and job.run_after <= pg_catalog.clock_timestamp()
      and job.attempt_count < job.max_attempts
    order by job.created_at, job.id limit 1 for update;
  if reconciliation_job.id is null then
    raise exception 'The routine modal confirmation job is unavailable.';
  end if;
  update app.deposit_jobs job set
    status = 'leased', attempt_count = job.attempt_count + 1,
    lease_token = gen_random_uuid(),
    leased_by = (p_command ->> 'workerInstanceId'),
    lease_expires_at = pg_catalog.clock_timestamp() + interval '1 minute',
    last_error_code = null
    where job.id = reconciliation_job.id returning * into reconciliation_job;
  select coalesce(pg_catalog.max(reconciliation.reconciliation_number), 0) + 1
    into decision_number from app.execution_reconciliations reconciliation
    where reconciliation.deposit_execution_attempt_id = attempt.id;
  reconciliation_uuid := gen_random_uuid();
  insert into app.routine_telebirr_modal_confirmations (
    request_id, http_replay_identity, http_request_body_digest, command_digest,
    command_body, certificate_id, execution_attempt_id, dispatch_broker_request_id,
    modal_provider_response_digest, reconciliation_id, result_body
  ) values (
    command_request_id, p_http_replay_identity, p_http_request_body_digest, p_command_digest,
    p_command, certificate_uuid, attempt.id, dispatch.broker_request_id,
    dispatch.provider_response_digest, reconciliation_uuid, authoritative_binding
  );
  insert into app.execution_reconciliations (
    id, deposit_execution_attempt_id, deposit_intent_id, platform_agent_account_id,
    deposit_job_id, reconciliation_number, outcome, reason_code,
    modal_provider_response_digest, exact_player_match, exact_amount_match,
    exact_currency_match, exact_player_credit_match
  ) values (
    reconciliation_uuid, attempt.id, attempt.deposit_intent_id,
    attempt.platform_agent_account_id, reconciliation_job.id, decision_number,
    'confirmed_executed', 'agent_transfer_success_modal_confirmed',
    dispatch.provider_response_digest, true, true, true, true
  );
  update app.deposit_jobs job set
    status = 'succeeded', lease_token = null, leased_by = null,
    lease_expires_at = null, last_error_code = null
    where job.id = reconciliation_job.id;
  update app.deposit_execution_attempts current_attempt set status = 'confirmed_executed'
    where current_attempt.id = attempt.id;
  update app.deposit_intents current_intent set status = 'executed'
    where current_intent.id = intent.id;
  return authoritative_binding;
end;
$$;

alter function app.execute_agent_platform_routine_deposit_modal_confirmation(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) owner to postgres;
revoke all on function app.execute_agent_platform_routine_deposit_modal_confirmation(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge, fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker_runtime;
grant execute on function app.execute_agent_platform_routine_deposit_modal_confirmation(
  text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb
) to fetanagent_routine_deposit_broker;

commit;
