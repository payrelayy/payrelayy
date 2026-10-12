-- One-use, Owner-attested reconciliation of an already-dispatched, already-credited
-- self-funded TeleBirr test. KemerBet's history reports minute precision, whereas
-- the normal automatic reconciliation requires an exact second inside the fence.
-- This migration installs a private resolution only; it never invokes it, sends a
-- provider command, or changes a financial switch.
begin;
set local lock_timeout = '5s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.owner_confirmed_dispatched_test_credits (
  request_key uuid primary key check (
    request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  execution_attempt_id uuid not null unique
    references app.deposit_execution_attempts (id) on delete restrict,
  deposit_intent_id uuid not null unique
    references app.deposit_intents (id) on delete restrict,
  reconciliation_job_id uuid not null unique
    references app.deposit_jobs (id) on delete restrict,
  actor_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  history_transaction_id text not null unique
    check (history_transaction_id ~ '^[0-9]{6,20}$'),
  history_request_id text not null unique
    check (history_request_id ~ '^[0-9]{6,20}$'),
  history_minute_at timestamptz not null check (
    history_minute_at = pg_catalog.date_trunc('minute', history_minute_at)
  ),
  observed_player_id text not null,
  observed_amount_minor bigint not null check (observed_amount_minor = 10000),
  keyed_history_reference_fingerprint text not null unique check (
    keyed_history_reference_fingerprint ~ '^hmac-sha256-v1:[0-9a-f]{64}$'
  ),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create trigger owner_confirmed_dispatched_test_credits_immutable
before update or delete on app.owner_confirmed_dispatched_test_credits
for each row execute function app.reject_deposit_ledger_delete();
create trigger owner_confirmed_dispatched_test_credits_no_truncate
before truncate on app.owner_confirmed_dispatched_test_credits
for each statement execute function app.reject_execution_ledger_truncate();

-- Preserve the ordinary exact-second route. The new reason is recognized only
-- when an immutable Owner receipt for the same attempt and job already exists.
alter table app.execution_reconciliations
  drop constraint execution_reconciliations_reason_shape_check;
alter table app.execution_reconciliations
  add constraint execution_reconciliations_reason_shape_check check (
    (outcome = 'confirmed_executed' and reason_code in (
      'agent_deposit_history_in_window_and_player_credit_confirmed',
      'owner_confirmed_history_minute_and_signed_dispatch'
    ))
    or (outcome = 'ambiguous' and reason_code = 'agent_history_ambiguous')
    or (outcome = 'not_observed' and reason_code = 'agent_history_not_observed')
  );

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
   where attempt.id = new.deposit_execution_attempt_id
   for update;
  if not found then
    raise exception 'The execution reconciliation references an unknown attempt.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(attempt_row.deposit_intent_id::text, 20260815175508)
  );
  select intent.status into intent_status
    from app.deposit_intents intent
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
    if new.reason_code = 'owner_confirmed_history_minute_and_signed_dispatch' then
      if attempt_row.final_action_fenced_at is null
        or attempt_row.reconciliation_required_at is null
        or not exists (
          select 1
            from app.owner_confirmed_dispatched_test_credits receipt
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

  select job.* into reconciliation_job
    from app.deposit_jobs job
   where job.id = new.deposit_job_id
     and job.deposit_intent_id = new.deposit_intent_id;
  if not found
    or reconciliation_job.job_kind <> 'reconcile_execution'
    or reconciliation_job.status <> 'leased'
    or reconciliation_job.attempt_count < 1 then
    raise exception 'A reconciliation requires its leased reconciliation job.';
  end if;
  select count(*)::integer, coalesce(max(reconciliation.reconciliation_number), 0)
    into history_count, history_maximum
    from app.execution_reconciliations reconciliation
   where reconciliation.deposit_execution_attempt_id = new.deposit_execution_attempt_id;
  if history_count <> history_maximum then
    raise exception 'The execution-reconciliation history is malformed.';
  end if;
  if exists (
    select 1 from app.execution_reconciliations reconciliation
     where reconciliation.deposit_execution_attempt_id = new.deposit_execution_attempt_id
       and reconciliation.outcome in ('confirmed_executed', 'ambiguous')
  ) then
    raise exception 'A terminal execution reconciliation has already been recorded.';
  end if;
  if new.reconciliation_number <> history_maximum + 1 then
    raise exception 'Execution reconciliations require exact sequential numbers.';
  end if;
  new.created_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create function app.resolve_owner_confirmed_dispatched_test_credit(
  p_actor_admin_id uuid,
  p_execution_attempt_id uuid,
  p_request_key uuid,
  p_history_transaction_id text,
  p_history_request_id text,
  p_history_minute_at timestamptz,
  p_observed_player_id text,
  p_observed_amount_minor bigint,
  p_owner_attests_both_wallets boolean,
  p_owner_attests_success_and_approved_history boolean,
  p_owner_accepts_no_second_credit_or_refund boolean
)
returns table (resolution_state text, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  existing app.owner_confirmed_dispatched_test_credits%rowtype;
  attempt_row app.deposit_execution_attempts%rowtype;
  intent_row app.deposit_intents%rowtype;
  execution_job app.deposit_jobs%rowtype;
  reconciliation_job app.deposit_jobs%rowtype;
  dispatch_row app.routine_telebirr_dispatch_evidence%rowtype;
  broker_row app.routine_telebirr_broker_requests%rowtype;
  player_account app.customer_platform_players%rowtype;
  leased_reconciliation record;
  recorded_reconciliation app.execution_reconciliations%rowtype;
  keyed_fingerprint text;
  provider_code text;
  platform_code text;
  resolved_intent_id uuid;
  switch_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can resolve a credited Owner test.';
  end if;
  perform app.require_active_owner_for_private_live_deposit_pilot(p_actor_admin_id);
  if p_execution_attempt_id is null
    or p_request_key is null
    or p_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_history_transaction_id is null
    or p_history_transaction_id !~ '^[0-9]{6,20}$'
    or p_history_request_id is null
    or p_history_request_id !~ '^[0-9]{6,20}$'
    or p_history_minute_at is null
    or p_history_minute_at <> pg_catalog.date_trunc('minute', p_history_minute_at)
    or p_observed_player_id is null
    or p_observed_amount_minor is distinct from 10000
    or p_owner_attests_both_wallets is distinct from true
    or p_owner_attests_success_and_approved_history is distinct from true
    or p_owner_accepts_no_second_credit_or_refund is distinct from true then
    raise exception 'The credited Owner-test evidence or attestation is incomplete.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:owner-confirmed-dispatched-test:v1', 0)
  );
  select receipt.* into existing
    from app.owner_confirmed_dispatched_test_credits receipt
   where receipt.request_key = p_request_key
      or receipt.execution_attempt_id = p_execution_attempt_id
   for share;
  if existing.request_key is not null then
    if existing.request_key = p_request_key
      and existing.execution_attempt_id = p_execution_attempt_id
      and existing.actor_admin_id = p_actor_admin_id
      and existing.history_transaction_id = p_history_transaction_id
      and existing.history_request_id = p_history_request_id
      and existing.history_minute_at = p_history_minute_at
      and existing.observed_player_id = p_observed_player_id
      and existing.observed_amount_minor = p_observed_amount_minor
      and exists (
        select 1 from app.deposit_intents intent
         where intent.id = existing.deposit_intent_id
           and intent.status = 'executed'
      ) then
      return query select 'confirmed_executed'::text, true;
      return;
    end if;
    raise exception 'The credited Owner-test request conflicts with its immutable receipt.';
  end if;

  -- Match the financial activation/stop lock order. The command is dormant-only.
  perform authority.control_key
    from app.private_trusted_telebirr_activation_control authority
   where authority.control_key = 'trusted_telebirr_financial_authority'
   for share;
  if not found then
    raise exception 'The financial authority control is unavailable.';
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
   for share;
  get diagnostics switch_count = row_count;
  if switch_count <> 7 or exists (
    select 1 from app.feature_switches feature_switch
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     ) and (
       feature_switch.mode <> 'disabled'
       or feature_switch.settings <> '{}'::jsonb
     )
  ) or app.current_private_trusted_telebirr_activation_epoch() is not null then
    raise exception 'Credited Owner-test resolution requires dormant financial authority.';
  end if;
  perform control.singleton
    from app.agent_platform_companion_execution_control control
   where control.singleton and control.control_state = 'disabled'
   for share;
  if not found then
    raise exception 'Companion execution is not dormant.';
  end if;

  select attempt.deposit_intent_id into resolved_intent_id
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id;
  if not found then
    raise exception 'The credited execution attempt is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(resolved_intent_id::text, 20260815203606)
  );
  select attempt.* into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id
   for update;
  select intent.* into intent_row
    from app.deposit_intents intent
   where intent.id = attempt_row.deposit_intent_id
   for update;
  select job.* into execution_job
    from app.deposit_jobs job
   where job.id = attempt_row.deposit_job_id
   for share;
  select job.* into reconciliation_job
    from app.deposit_jobs job
   where job.deposit_intent_id = intent_row.id
     and job.job_kind = 'reconcile_execution'
   for update;
  select evidence.* into dispatch_row
    from app.routine_telebirr_dispatch_evidence evidence
   where evidence.execution_attempt_id = attempt_row.id
   for share;
  select broker.* into broker_row
    from app.routine_telebirr_broker_requests broker
   where broker.request_id = dispatch_row.broker_request_id
   for share;
  select player.* into player_account
    from app.customer_platform_players player
   where player.id = intent_row.player_account_id
   for key share;
  select provider.code::text into provider_code
    from app.payment_providers provider
   where provider.id = intent_row.payment_provider_id;
  select platform.code::text into platform_code
    from app.platforms platform
   where platform.id = intent_row.platform_id;

  if attempt_row.id is null
    or exists (select 1 from app.owner_confirmed_dispatched_test_credits)
    or attempt_row.status <> 'reconciliation_required'
    or attempt_row.exact_player_credit_match is distinct from true
    or attempt_row.final_action_fenced_at is null
    or attempt_row.reconciliation_required_at is null
    or p_history_minute_at is distinct from
      pg_catalog.date_trunc('minute', attempt_row.final_action_fenced_at)
    or attempt_row.reconciliation_required_at >=
      p_history_minute_at + interval '1 minute'
    or intent_row.id is null
    or intent_row.status <> 'execution_reconciliation'
    or intent_row.expected_amount_minor <> 10000
    or intent_row.currency_code <> 'ETB'
    or provider_code <> 'telebirr'
    or platform_code <> 'kemerbet'
    or player_account.id is null
    or player_account.player_id is distinct from p_observed_player_id
    or execution_job.id is null
    or execution_job.deposit_intent_id <> intent_row.id
    or execution_job.job_kind <> 'execute_deposit'
    or execution_job.status <> 'succeeded'
    or execution_job.attempt_count <> 1
    or execution_job.max_attempts <> 1
    or reconciliation_job.id is null
    or reconciliation_job.status <> 'queued'
    or reconciliation_job.attempt_count <> 0
    or reconciliation_job.max_attempts <> 8
    or dispatch_row.execution_attempt_id is null
    or dispatch_row.exact_player_credit_match is distinct from true
    or broker_row.request_id is null
    or broker_row.operation <> 'record_dispatch'
    or broker_row.result_body ->> 'attemptId' is distinct from attempt_row.id::text
    or broker_row.result_body ->> 'intentId' is distinct from intent_row.id::text
    or broker_row.result_body ->> 'playerId' is distinct from p_observed_player_id
    or broker_row.result_body ->> 'amountMinor' is distinct from '10000'
    or broker_row.result_body ->> 'currencyCode' is distinct from 'ETB'
    or (select pg_catalog.count(*) from app.deposit_execution_attempts other_attempt
         where other_attempt.deposit_intent_id = intent_row.id) <> 1
    or exists (
      select 1 from app.deposit_jobs other_job
       where other_job.job_kind in ('execute_deposit', 'reconcile_execution')
         and other_job.status in ('queued', 'leased', 'retry_wait')
         and other_job.id <> reconciliation_job.id
    )
    or exists (
      select 1 from app.deposit_execution_attempts other_attempt
       where other_attempt.id <> attempt_row.id
         and other_attempt.status in (
           'prepared', 'final_action_fenced',
           'reconciliation_required', 'review_required'
         )
    )
    or exists (
      select 1 from app.execution_reconciliations reconciliation
       where reconciliation.deposit_execution_attempt_id = attempt_row.id
    )
    or exists (
      select 1 from app.deposit_review_cases review_case
       where review_case.deposit_intent_id = intent_row.id
    ) then
    raise exception 'The protected credited Owner-test lineage is not eligible.';
  end if;

  -- A random v4 request UUID is the private HMAC key for this one-use history
  -- reference. The raw provider IDs remain only in the RLS-protected receipt.
  keyed_fingerprint := 'hmac-sha256-v1:' || pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to('kemerbet-deposit:' || p_history_transaction_id, 'UTF8'),
      pg_catalog.convert_to(p_request_key::text, 'UTF8'),
      'sha256'
    ), 'hex'
  );
  insert into app.owner_confirmed_dispatched_test_credits (
    request_key, execution_attempt_id, deposit_intent_id,
    reconciliation_job_id, actor_admin_id,
    history_transaction_id, history_request_id, history_minute_at,
    observed_player_id, observed_amount_minor,
    keyed_history_reference_fingerprint
  ) values (
    p_request_key, attempt_row.id, intent_row.id,
    reconciliation_job.id, p_actor_admin_id,
    p_history_transaction_id, p_history_request_id, p_history_minute_at,
    p_observed_player_id, p_observed_amount_minor,
    keyed_fingerprint
  );

  select * into leased_reconciliation
    from app.lease_next_deposit_execution_reconciliation(
      pg_catalog.gen_random_uuid(), 300
    );
  if leased_reconciliation.reconciliation_job_id is distinct from
      reconciliation_job.id
    or leased_reconciliation.execution_attempt_id is distinct from
      attempt_row.id then
    raise exception 'The exact Owner-test reconciliation lease was not obtained.';
  end if;
  insert into app.execution_reconciliations (
    deposit_execution_attempt_id, deposit_intent_id,
    platform_agent_account_id, deposit_job_id, reconciliation_number,
    outcome, reason_code, keyed_external_reference_fingerprint,
    approved_history_match_count, normalized_operation_type,
    matched_history_occurred_at, exact_player_match, exact_amount_match,
    exact_currency_match, exact_player_credit_match
  ) values (
    attempt_row.id, intent_row.id, attempt_row.platform_agent_account_id,
    reconciliation_job.id, 1, 'confirmed_executed',
    'owner_confirmed_history_minute_and_signed_dispatch',
    keyed_fingerprint, 1, 'deposit', p_history_minute_at,
    true, true, true, true
  ) returning * into recorded_reconciliation;
  update app.deposit_jobs job
     set status = 'succeeded', lease_token = null, leased_by = null,
         lease_expires_at = null, last_error_code = null
   where job.id = reconciliation_job.id
     and job.status = 'leased'
     and job.lease_token = leased_reconciliation.lease_token;
  if not found then
    raise exception 'The exact Owner-test reconciliation lease changed.';
  end if;
  update app.deposit_execution_attempts attempt
     set status = 'confirmed_executed'
   where attempt.id = attempt_row.id
     and attempt.status = 'reconciliation_required';
  if not found then
    raise exception 'The credited Owner-test attempt changed before resolution.';
  end if;
  update app.deposit_intents intent
     set status = 'executed'
   where intent.id = intent_row.id
     and intent.status = 'execution_reconciliation';
  if not found then
    raise exception 'The credited Owner-test intent changed before resolution.';
  end if;
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', p_actor_admin_id,
    'deposit.owner_confirmed_dispatched_test_reconciled',
    'deposit_intent', intent_row.id,
    pg_catalog.jsonb_build_object(
      'execution_attempt_id', attempt_row.id,
      'reconciliation_id', recorded_reconciliation.id,
      'resolution_request_key', p_request_key,
      'history_time_precision', 'minute',
      'owner_attested_both_wallets', true,
      'owner_attested_success_and_approved_history', true,
      'existing_provider_credit_recorded', true,
      'additional_credit_or_refund_performed', false
    )
  );
  return query select 'confirmed_executed'::text, false;
end;
$$;

alter table app.owner_confirmed_dispatched_test_credits
  enable row level security;
alter table app.owner_confirmed_dispatched_test_credits
  force row level security;
alter table app.owner_confirmed_dispatched_test_credits owner to postgres;
alter function app.resolve_owner_confirmed_dispatched_test_credit(
  uuid, uuid, uuid, text, text, timestamptz, text, bigint,
  boolean, boolean, boolean
) owner to postgres;

revoke all privileges on table app.owner_confirmed_dispatched_test_credits
  from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;
revoke all on function app.resolve_owner_confirmed_dispatched_test_credit(
  uuid, uuid, uuid, text, text, timestamptz, text, bigint,
  boolean, boolean, boolean
) from public, anon, authenticated, service_role,
  fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime;

comment on table app.owner_confirmed_dispatched_test_credits is
  'Immutable one-use Owner attestation for an already-credited own-account TeleBirr test, including exact KemerBet history IDs and minute-precision time. No second provider action occurs.';
comment on function app.resolve_owner_confirmed_dispatched_test_credit(
  uuid, uuid, uuid, text, text, timestamptz, text, bigint,
  boolean, boolean, boolean
) is
  'Postgres-only, gates-off, one-use reconciliation of a signed-dispatch 100 ETB own-account credit with one exact approved KemerBet history entry; no Transfer click, retry, or refund.';

commit;
