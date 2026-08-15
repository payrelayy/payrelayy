-- Dormant KemerBet execution and reconciliation ledgers.
--
-- This migration deliberately exposes no execution procedure or runtime privilege. It records one
-- fenced execution attempt per intent, keeps the agent account serialized while the outcome is
-- uncertain or ambiguous, and requires positive reconciliation before an intent can be executed.

begin;

create type app.deposit_execution_attempt_status as enum (
  'prepared',
  'cancelled_before_action',
  'final_action_fenced',
  'reconciliation_required',
  'confirmed_executed',
  'review_required'
);

create type app.execution_reconciliation_outcome as enum (
  'confirmed_executed',
  'ambiguous',
  'not_observed'
);

alter table app.deposit_jobs
  add constraint deposit_jobs_id_intent_key
  unique (id, deposit_intent_id);

create table app.deposit_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  deposit_intent_id uuid not null
    references app.deposit_intents (id) on delete restrict,
  deposit_job_id uuid not null,
  platform_agent_account_id uuid not null
    references app.platform_agent_accounts (id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  status app.deposit_execution_attempt_status not null default 'prepared',
  final_action_fenced_at timestamptz,
  reconciliation_required_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint deposit_execution_attempts_job_intent_fkey
    foreign key (deposit_job_id, deposit_intent_id)
    references app.deposit_jobs (id, deposit_intent_id) on delete restrict,
  constraint deposit_execution_attempts_job_key unique (deposit_job_id),
  constraint deposit_execution_attempts_intent_attempt_key
    unique (deposit_intent_id, attempt_number),
  constraint deposit_execution_attempts_id_intent_agent_key
    unique (id, deposit_intent_id, platform_agent_account_id),
  constraint deposit_execution_attempts_time_order_check check (
    final_action_fenced_at is null
    or final_action_fenced_at >= created_at
  ),
  constraint deposit_execution_attempts_reconciliation_time_order_check check (
    reconciliation_required_at is null
    or (
      final_action_fenced_at is not null
      and reconciliation_required_at >= final_action_fenced_at
    )
  ),
  constraint deposit_execution_attempts_resolution_time_order_check check (
    resolved_at is null
    or (
      resolved_at >= created_at
      and (
        reconciliation_required_at is null
        or resolved_at >= reconciliation_required_at
      )
    )
  ),
  constraint deposit_execution_attempts_status_shape_check check (
    (status = 'prepared'
      and final_action_fenced_at is null
      and reconciliation_required_at is null
      and resolved_at is null)
    or (status = 'cancelled_before_action'
      and final_action_fenced_at is null
      and reconciliation_required_at is null
      and resolved_at is not null)
    or (status = 'final_action_fenced'
      and final_action_fenced_at is not null
      and reconciliation_required_at is null
      and resolved_at is null)
    or (status = 'reconciliation_required'
      and final_action_fenced_at is not null
      and reconciliation_required_at is not null
      and resolved_at is null)
    or (status in ('confirmed_executed', 'review_required')
      and final_action_fenced_at is not null
      and reconciliation_required_at is not null
      and resolved_at is not null)
  )
);

create index deposit_execution_attempts_agent_idx
  on app.deposit_execution_attempts (platform_agent_account_id, created_at desc);

create unique index deposit_execution_attempts_one_blocking_intent_idx
  on app.deposit_execution_attempts (deposit_intent_id)
  where status in (
    'prepared',
    'final_action_fenced',
    'reconciliation_required',
    'review_required'
  );

create unique index deposit_execution_attempts_one_blocking_agent_idx
  on app.deposit_execution_attempts (platform_agent_account_id)
  where status in (
    'prepared',
    'final_action_fenced',
    'reconciliation_required',
    'review_required'
  );

create table app.execution_reconciliations (
  id uuid primary key default gen_random_uuid(),
  deposit_execution_attempt_id uuid not null,
  deposit_intent_id uuid not null,
  platform_agent_account_id uuid not null,
  deposit_job_id uuid not null,
  reconciliation_number integer not null check (reconciliation_number > 0),
  outcome app.execution_reconciliation_outcome not null,
  reason_code text not null,
  keyed_external_reference_fingerprint text,
  approved_history_match_count smallint,
  normalized_operation_type text,
  matched_history_occurred_at timestamptz,
  exact_player_match boolean,
  exact_amount_match boolean,
  exact_currency_match boolean,
  exact_player_credit_match boolean,
  created_at timestamptz not null default clock_timestamp(),
  constraint execution_reconciliations_attempt_binding_fkey
    foreign key (
      deposit_execution_attempt_id,
      deposit_intent_id,
      platform_agent_account_id
    ) references app.deposit_execution_attempts (
      id,
      deposit_intent_id,
      platform_agent_account_id
    ) on delete restrict,
  constraint execution_reconciliations_job_intent_fkey
    foreign key (deposit_job_id, deposit_intent_id)
    references app.deposit_jobs (id, deposit_intent_id) on delete restrict,
  constraint execution_reconciliations_job_key unique (deposit_job_id),
  constraint execution_reconciliations_attempt_number_key
    unique (deposit_execution_attempt_id, reconciliation_number),
  constraint execution_reconciliations_reason_shape_check check (
    (outcome = 'confirmed_executed'
      and reason_code = 'agent_deposit_history_in_window_and_player_credit_confirmed')
    or (outcome = 'ambiguous'
      and reason_code = 'agent_history_ambiguous')
    or (outcome = 'not_observed'
      and reason_code = 'agent_history_not_observed')
  ),
  constraint execution_reconciliations_evidence_shape_check check (
    (outcome = 'confirmed_executed'
      and keyed_external_reference_fingerprint is not null
      and keyed_external_reference_fingerprint
        ~ '^hmac-sha256-v1:[0-9a-f]{64}$'
      and approved_history_match_count is not null
      and approved_history_match_count = 1
      and normalized_operation_type is not null
      and normalized_operation_type = 'deposit'
      and matched_history_occurred_at is not null
      and exact_player_match is true
      and exact_amount_match is true
      and exact_currency_match is true
      and exact_player_credit_match is true)
    or (outcome in ('ambiguous', 'not_observed')
      and keyed_external_reference_fingerprint is null
      and approved_history_match_count is null
      and normalized_operation_type is null
      and matched_history_occurred_at is null
      and exact_player_match is null
      and exact_amount_match is null
      and exact_currency_match is null
      and exact_player_credit_match is null)
  )
);

create unique index execution_reconciliations_one_terminal_attempt_idx
  on app.execution_reconciliations (deposit_execution_attempt_id)
  where outcome in ('confirmed_executed', 'ambiguous');

create unique index execution_reconciliations_agent_reference_idx
  on app.execution_reconciliations (
    platform_agent_account_id,
    keyed_external_reference_fingerprint
  )
  where keyed_external_reference_fingerprint is not null;

create index execution_reconciliations_intent_created_idx
  on app.execution_reconciliations (deposit_intent_id, created_at desc);

create unique index deposit_jobs_one_active_execution_intent_idx
  on app.deposit_jobs (deposit_intent_id)
  where job_kind = 'execute_deposit'
    and status in ('queued', 'leased', 'retry_wait');

create unique index deposit_jobs_one_active_reconciliation_intent_idx
  on app.deposit_jobs (deposit_intent_id)
  where job_kind = 'reconcile_execution'
    and status in ('queued', 'leased', 'retry_wait');

create function app.reject_execution_ledger_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Execution-ledger records cannot be truncated.';
end;
$$;

create function app.enforce_deposit_execution_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  agent_platform_id uuid;
  agent_status app.record_status;
  execution_job app.deposit_jobs%rowtype;
  history_count integer;
  history_maximum integer;
  intent_platform_id uuid;
  intent_status app.deposit_status;
  latest_reconciliation app.execution_reconciliations%rowtype;
  platform_code text;
  platform_status app.record_status;
  transition_time timestamptz;
begin
  if new.deposit_intent_id is null then
    raise exception 'An execution attempt requires a deposit intent.';
  end if;

  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.deposit_intent_id::text, 20260815175508)
    );

    select intent.platform_id, intent.status
      into intent_platform_id, intent_status
      from app.deposit_intents intent
     where intent.id = new.deposit_intent_id;

    if not found or intent_status <> 'execution_pending' then
      raise exception 'An execution attempt requires an execution-pending deposit intent.';
    end if;

    select count(*)::integer, coalesce(max(attempt.attempt_number), 0)
      into history_count, history_maximum
      from app.deposit_execution_attempts attempt
     where attempt.deposit_intent_id = new.deposit_intent_id;

    if history_count <> history_maximum then
      raise exception 'The deposit execution-attempt history is malformed.';
    end if;

    if history_count <> 0 then
      raise exception 'A deposit intent permits one execution attempt; retry is not authorized.';
    end if;

    if new.attempt_number <> 1 then
      raise exception 'The only authorized execution attempt number is 1.';
    end if;

    select job.*
      into execution_job
      from app.deposit_jobs job
     where job.id = new.deposit_job_id
       and job.deposit_intent_id = new.deposit_intent_id;

    if not found
      or execution_job.job_kind <> 'execute_deposit'
      or execution_job.status <> 'leased'
      or execution_job.max_attempts <> 1
      or execution_job.attempt_count <> 1 then
      raise exception 'An execution attempt requires its one-shot leased execution job.';
    end if;

    select agent_account.platform_id,
           agent_account.status,
           platform.code,
           platform.status
      into agent_platform_id, agent_status, platform_code, platform_status
      from app.platform_agent_accounts agent_account
      join app.platforms platform on platform.id = agent_account.platform_id
     where agent_account.id = new.platform_agent_account_id
     for key share of agent_account, platform;

    if not found
      or agent_platform_id is distinct from intent_platform_id
      or agent_status <> 'active'
      or platform_status <> 'active'
      or platform_code <> 'kemerbet' then
      raise exception 'An execution attempt requires the active KemerBet agent for its platform.';
    end if;

    if new.status <> 'prepared'
      or new.final_action_fenced_at is not null
      or new.reconciliation_required_at is not null
      or new.resolved_at is not null then
      raise exception 'An execution attempt must begin prepared and unfenced.';
    end if;

    transition_time := clock_timestamp();
    new.created_at := transition_time;
    new.updated_at := transition_time;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.deposit_intent_id is distinct from old.deposit_intent_id
    or new.deposit_job_id is distinct from old.deposit_job_id
    or new.platform_agent_account_id is distinct from old.platform_agent_account_id
    or new.attempt_number is distinct from old.attempt_number
    or new.created_at is distinct from old.created_at then
    raise exception 'Execution-attempt identity is immutable.';
  end if;

  if new.status = old.status then
    if new.final_action_fenced_at is distinct from old.final_action_fenced_at
      or new.reconciliation_required_at is distinct from old.reconciliation_required_at
      or new.resolved_at is distinct from old.resolved_at
      or new.updated_at is distinct from old.updated_at then
      raise exception 'Execution-attempt timestamps change only with a valid transition.';
    end if;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.deposit_intent_id::text, 20260815175508)
  );

  if not (
    (old.status = 'prepared'
      and new.status in ('cancelled_before_action', 'final_action_fenced'))
    or (old.status = 'final_action_fenced'
      and new.status = 'reconciliation_required')
    or (old.status = 'reconciliation_required'
      and new.status in ('confirmed_executed', 'review_required'))
  ) then
    raise exception 'Invalid execution-attempt transition from % to %.', old.status, new.status;
  end if;

  select intent.platform_id, intent.status
    into intent_platform_id, intent_status
    from app.deposit_intents intent
   where intent.id = old.deposit_intent_id;

  if not found then
    raise exception 'The execution attempt references an unknown deposit intent.';
  end if;

  select job.*
    into execution_job
    from app.deposit_jobs job
   where job.id = old.deposit_job_id
     and job.deposit_intent_id = old.deposit_intent_id;

  if not found
    or execution_job.job_kind <> 'execute_deposit'
    or execution_job.max_attempts <> 1
    or execution_job.attempt_count <> 1 then
    raise exception 'The execution attempt lost its one-shot execution-job correspondence.';
  end if;

  transition_time := clock_timestamp();
  new.final_action_fenced_at := old.final_action_fenced_at;
  new.reconciliation_required_at := old.reconciliation_required_at;
  new.resolved_at := old.resolved_at;

  if new.status = 'cancelled_before_action' then
    if intent_status <> 'execution_pending'
      or execution_job.status <> 'leased' then
      raise exception 'Only a prepared leased attempt may be cancelled before action.';
    end if;
    new.resolved_at := transition_time;
  elsif new.status = 'final_action_fenced' then
    if intent_status <> 'execution_pending'
      or execution_job.status <> 'leased' then
      raise exception 'The final-action fence requires a leased job and execution-pending intent.';
    end if;

    select agent_account.platform_id,
           agent_account.status,
           platform.code,
           platform.status
      into agent_platform_id, agent_status, platform_code, platform_status
      from app.platform_agent_accounts agent_account
      join app.platforms platform on platform.id = agent_account.platform_id
     where agent_account.id = old.platform_agent_account_id
     for key share of agent_account, platform;

    if not found
      or agent_platform_id is distinct from intent_platform_id
      or agent_status <> 'active'
      or platform_status <> 'active'
      or platform_code <> 'kemerbet' then
      raise exception 'The final-action fence requires the active KemerBet agent.';
    end if;

    new.final_action_fenced_at := transition_time;
  elsif new.status = 'reconciliation_required' then
    if intent_status <> 'execution_in_progress'
      or execution_job.status <> 'leased' then
      raise exception 'Post-action uncertainty requires its in-progress intent and leased job.';
    end if;
    new.reconciliation_required_at := transition_time;
  else
    if intent_status <> 'execution_reconciliation' then
      raise exception 'An execution attempt can resolve only while its intent is reconciling.';
    end if;

    select reconciliation.*
      into latest_reconciliation
      from app.execution_reconciliations reconciliation
      join app.deposit_jobs reconciliation_job
        on reconciliation_job.id = reconciliation.deposit_job_id
       and reconciliation_job.deposit_intent_id = reconciliation.deposit_intent_id
     where reconciliation.deposit_execution_attempt_id = old.id
       and reconciliation.deposit_intent_id = old.deposit_intent_id
       and reconciliation.platform_agent_account_id = old.platform_agent_account_id
       and reconciliation_job.job_kind = 'reconcile_execution'
       and reconciliation_job.status = 'succeeded'
     order by reconciliation.reconciliation_number desc
     limit 1;

    if not found
      or (new.status = 'confirmed_executed'
        and latest_reconciliation.outcome <> 'confirmed_executed')
      or (new.status = 'review_required'
        and latest_reconciliation.outcome <> 'ambiguous') then
      raise exception 'Execution-attempt resolution requires a matching completed reconciliation.';
    end if;

    new.resolved_at := transition_time;
  end if;

  new.updated_at := transition_time;
  return new;
end;
$$;

create trigger deposit_execution_attempts_enforce
before insert or update on app.deposit_execution_attempts
for each row
execute function app.enforce_deposit_execution_attempt();

create trigger deposit_execution_attempts_no_delete
before delete on app.deposit_execution_attempts
for each row
execute function app.reject_deposit_ledger_delete();

create trigger deposit_execution_attempts_no_truncate
before truncate on app.deposit_execution_attempts
for each statement
execute function app.reject_execution_ledger_truncate();

create function app.enforce_execution_reconciliation_insert()
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

  select attempt.*
    into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.id = new.deposit_execution_attempt_id
   for update;

  if not found then
    raise exception 'The execution reconciliation references an unknown attempt.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(attempt_row.deposit_intent_id::text, 20260815175508)
  );

  select intent.status
    into intent_status
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

  if new.outcome = 'confirmed_executed'
    and (
      attempt_row.final_action_fenced_at is null
      or attempt_row.reconciliation_required_at is null
      or new.matched_history_occurred_at is null
      or new.matched_history_occurred_at < attempt_row.final_action_fenced_at
      or new.matched_history_occurred_at > attempt_row.reconciliation_required_at
    ) then
    raise exception 'Confirmed execution requires matched deposit history inside the server-authored execution window.';
  end if;

  select job.*
    into reconciliation_job
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
    select 1
      from app.execution_reconciliations reconciliation
     where reconciliation.deposit_execution_attempt_id = new.deposit_execution_attempt_id
       and reconciliation.outcome in ('confirmed_executed', 'ambiguous')
  ) then
    raise exception 'A terminal execution reconciliation has already been recorded.';
  end if;

  if new.reconciliation_number <> history_maximum + 1 then
    raise exception 'Execution reconciliations require exact sequential numbers.';
  end if;

  new.created_at := clock_timestamp();
  return new;
end;
$$;

create trigger execution_reconciliations_enforce_insert
before insert on app.execution_reconciliations
for each row
execute function app.enforce_execution_reconciliation_insert();

create trigger execution_reconciliations_immutable
before update or delete on app.execution_reconciliations
for each row
execute function app.reject_deposit_ledger_delete();

create trigger execution_reconciliations_no_truncate
before truncate on app.execution_reconciliations
for each statement
execute function app.reject_execution_ledger_truncate();

create function app.enforce_execution_deposit_job_safety()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  attempt_status app.deposit_execution_attempt_status;
  intent_status app.deposit_status;
begin
  if new.job_kind not in ('execute_deposit', 'reconcile_execution') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.deposit_intent_id::text, 20260815175508)
  );

  select intent.status
    into intent_status
    from app.deposit_intents intent
   where intent.id = new.deposit_intent_id;

  if not found then
    raise exception 'The execution job references an unknown deposit intent.';
  end if;

  if new.deposit_submission_id is not null then
    raise exception 'Execution and reconciliation jobs are intent-bound and carry no submission payload.';
  end if;

  if new.job_kind = 'execute_deposit' then
    if new.max_attempts <> 1 then
      raise exception 'Execution jobs are one-shot and require max_attempts = 1.';
    end if;

    if new.status = 'retry_wait' then
      raise exception 'Execution-job retry_wait is not authorized.';
    end if;

    if tg_op = 'INSERT' then
      if exists (
        select 1
          from app.deposit_jobs job
         where job.deposit_intent_id = new.deposit_intent_id
           and job.job_kind = 'execute_deposit'
      ) then
        raise exception 'A deposit intent permits one execution job; retry is not authorized.';
      end if;

      if intent_status <> 'execution_pending' then
        raise exception 'An execution job requires an execution-pending deposit intent.';
      end if;
    elsif old.status = 'leased' and new.status = 'succeeded' then
      select attempt.status
        into attempt_status
        from app.deposit_execution_attempts attempt
       where attempt.deposit_job_id = old.id
         and attempt.deposit_intent_id = old.deposit_intent_id;

      if not found or attempt_status <> 'reconciliation_required' then
        raise exception 'An execution job succeeds only after the fenced action requires reconciliation.';
      end if;
    elsif old.status = 'leased' and new.status in ('dead', 'cancelled') then
      select attempt.status
        into attempt_status
        from app.deposit_execution_attempts attempt
       where attempt.deposit_job_id = old.id
         and attempt.deposit_intent_id = old.deposit_intent_id;

      if found and attempt_status <> 'cancelled_before_action' then
        raise exception 'A leased execution job cannot terminate after the final-action fence.';
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if intent_status not in (
      'execution_uncertain',
      'execution_reconciliation',
      'execution_review'
    ) then
      raise exception 'A reconciliation job requires an uncertain or reviewing execution.';
    end if;

    select attempt.status
      into attempt_status
      from app.deposit_execution_attempts attempt
     where attempt.deposit_intent_id = new.deposit_intent_id
     order by attempt.attempt_number desc
     limit 1;

    if not found or attempt_status <> 'reconciliation_required' then
      raise exception 'A reconciliation job requires a reconciliation-required attempt.';
    end if;
  elsif new.status = 'leased'
    and old.status <> 'leased'
    and intent_status <> 'execution_reconciliation' then
    raise exception 'A reconciliation job may be leased only while the intent is reconciling.';
  elsif old.status = 'leased' and new.status = 'succeeded' and not exists (
    select 1
      from app.execution_reconciliations reconciliation
     where reconciliation.deposit_job_id = old.id
       and reconciliation.deposit_intent_id = old.deposit_intent_id
  ) then
    raise exception 'A reconciliation job cannot succeed without its immutable outcome.';
  end if;

  return new;
end;
$$;

create trigger deposit_jobs_enforce_execution_safety
before insert or update on app.deposit_jobs
for each row
execute function app.enforce_execution_deposit_job_safety();

create function app.require_deposit_execution_correspondence()
returns trigger
language plpgsql
set search_path = pg_catalog, app, pg_temp
as $$
declare
  attempt_row app.deposit_execution_attempts%rowtype;
  execution_job app.deposit_jobs%rowtype;
  latest_reconciliation app.execution_reconciliations%rowtype;
begin
  if new.status = old.status then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(old.id::text, 20260815175508)
  );

  select attempt.*
    into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.deposit_intent_id = old.id
   order by attempt.attempt_number desc
   limit 1;

  if old.status = 'execution_pending' and new.status = 'execution_in_progress' then
    if not found or attempt_row.status <> 'final_action_fenced' then
      raise exception 'Execution may begin only from its durable final-action fence.';
    end if;

    select job.*
      into execution_job
      from app.deposit_jobs job
     where job.id = attempt_row.deposit_job_id
       and job.deposit_intent_id = old.id;

    if not found
      or execution_job.job_kind <> 'execute_deposit'
      or execution_job.status <> 'leased'
      or execution_job.max_attempts <> 1
      or execution_job.attempt_count <> 1 then
      raise exception 'Execution may begin only from its one-shot leased job.';
    end if;
  elsif old.status = 'execution_pending' and new.status = 'execution_review' then
    if attempt_row.id is not null and attempt_row.status <> 'cancelled_before_action' then
      raise exception 'A prepared or fenced execution attempt must be resolved before review.';
    end if;
  elsif old.status = 'execution_pending' and new.status = 'execution_uncertain' then
    raise exception 'Execution-pending cannot bypass the durable in-progress fence.';
  elsif old.status = 'execution_in_progress' and new.status = 'execution_uncertain' then
    if not found or attempt_row.status <> 'reconciliation_required' then
      raise exception 'Post-action execution must enter uncertainty with reconciliation required.';
    end if;
  elsif old.status = 'execution_in_progress'
    and new.status in ('executed', 'execution_review') then
    raise exception 'A post-action execution must be reconciled before execution or review.';
  elsif old.status = 'execution_uncertain'
    and new.status = 'execution_reconciliation' then
    if not found
      or attempt_row.status <> 'reconciliation_required'
      or not exists (
        select 1
          from app.deposit_jobs job
         where job.deposit_intent_id = old.id
           and job.job_kind = 'reconcile_execution'
           and job.status in ('queued', 'leased', 'retry_wait')
      ) then
      raise exception 'Execution reconciliation requires its blocking attempt and active job.';
    end if;
  elsif old.status = 'execution_uncertain' and new.status = 'execution_review' then
    raise exception 'An uncertain execution requires reconciliation before review.';
  elsif old.status = 'execution_review' and new.status = 'execution_pending' then
    raise exception 'Execution retry is not authorized from review.';
  elsif old.status = 'execution_review' and new.status = 'rejected' then
    if attempt_row.id is not null
      and attempt_row.status <> 'cancelled_before_action' then
      raise exception 'A fenced or uncertain execution cannot be rejected from review.';
    end if;
  elsif old.status = 'execution_review' and new.status = 'execution_reconciliation' then
    if not found
      or attempt_row.status <> 'reconciliation_required'
      or not exists (
        select 1
          from app.deposit_jobs job
         where job.deposit_intent_id = old.id
           and job.job_kind = 'reconcile_execution'
           and job.status in ('queued', 'leased', 'retry_wait')
      ) then
      raise exception 'Review may enter reconciliation only for a blocking uncertain attempt.';
    end if;
  elsif old.status = 'execution_reconciliation' and new.status = 'execution_pending' then
    raise exception 'Execution retry is not authorized after reconciliation.';
  elsif old.status = 'execution_reconciliation'
    and new.status in ('executed', 'execution_review') then
    if not found
      or (new.status = 'executed' and attempt_row.status <> 'confirmed_executed')
      or (new.status = 'execution_review' and attempt_row.status <> 'review_required') then
      raise exception 'The execution outcome is not backed by its resolved attempt.';
    end if;

    select reconciliation.*
      into latest_reconciliation
      from app.execution_reconciliations reconciliation
      join app.deposit_jobs reconciliation_job
        on reconciliation_job.id = reconciliation.deposit_job_id
       and reconciliation_job.deposit_intent_id = reconciliation.deposit_intent_id
     where reconciliation.deposit_execution_attempt_id = attempt_row.id
       and reconciliation.deposit_intent_id = old.id
       and reconciliation.platform_agent_account_id = attempt_row.platform_agent_account_id
       and reconciliation_job.job_kind = 'reconcile_execution'
       and reconciliation_job.status = 'succeeded'
     order by reconciliation.reconciliation_number desc
     limit 1;

    if not found
      or (new.status = 'executed'
        and latest_reconciliation.outcome <> 'confirmed_executed')
      or (new.status = 'execution_review'
        and latest_reconciliation.outcome <> 'ambiguous') then
      raise exception 'The execution outcome requires its matching completed reconciliation.';
    end if;
  end if;

  return new;
end;
$$;

create trigger deposit_intents_require_execution_correspondence
before update of status on app.deposit_intents
for each row
execute function app.require_deposit_execution_correspondence();

alter table app.deposit_execution_attempts enable row level security;
alter table app.deposit_execution_attempts force row level security;
alter table app.execution_reconciliations enable row level security;
alter table app.execution_reconciliations force row level security;

revoke all privileges on table
  app.deposit_execution_attempts,
  app.execution_reconciliations
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime;

revoke all on function
  app.reject_execution_ledger_truncate(),
  app.enforce_deposit_execution_attempt(),
  app.enforce_execution_reconciliation_insert(),
  app.enforce_execution_deposit_job_safety(),
  app.require_deposit_execution_correspondence()
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime;

revoke usage on type
  app.deposit_execution_attempt_status,
  app.execution_reconciliation_outcome
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime;

comment on table app.deposit_execution_attempts is
  'Private dormant KemerBet execution fence. One intent gets one attempt; uncertain and ambiguous outcomes continue to serialize the agent account.';
comment on table app.execution_reconciliations is
  'Append-only execution observations. not_observed never authorizes retry; confirmed execution requires one exact normalized deposit inside the server-authored execution window plus exact player credit.';

commit;
