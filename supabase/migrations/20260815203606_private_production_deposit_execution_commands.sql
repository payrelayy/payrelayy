-- Private production deposit execution commands.
--
-- The dormant ledgers remain the authoritative execution and reconciliation history. This layer
-- adds the smallest executable surface needed to move a real, already-verified deposit intent
-- through one one-shot KemerBet action and evidence-based reconciliation. The durable fence's
-- first_fence_acquired=true result is the only permission to perform the external final action.
-- A restart can discover a fenced attempt only through the reconciliation lease; it can never
-- reacquire execution permission or create a second execution job or attempt.

begin;

create role fetanagent_deposit_executor
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_deposit_executor_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant fetanagent_deposit_executor
  to fetanagent_deposit_executor_runtime
  with inherit true, set false, admin false;

alter table app.deposit_execution_attempts
  add column exact_player_credit_match boolean,
  add constraint deposit_execution_attempts_modal_fact_shape_check check (
    status not in ('prepared', 'cancelled_before_action', 'final_action_fenced')
    or exact_player_credit_match is null
  );

create function app.enforce_deposit_execution_modal_fact()
returns trigger
language plpgsql
set search_path = pg_catalog, app
as $$
begin
  if tg_relid = 'app.execution_reconciliations'::regclass then
    if new.outcome = 'confirmed_executed'
      and not exists (
        select 1
          from app.deposit_execution_attempts attempt
         where attempt.id = new.deposit_execution_attempt_id
           and attempt.deposit_intent_id = new.deposit_intent_id
           and attempt.platform_agent_account_id = new.platform_agent_account_id
           and attempt.exact_player_credit_match is true
      ) then
      raise exception 'Confirmed execution requires its persisted exact player-credit fact.';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.exact_player_credit_match is not null then
      raise exception 'The exact player-credit fact is unavailable before final action.';
    end if;
    return new;
  end if;

  if old.status = 'final_action_fenced'
    and new.status = 'reconciliation_required' then
    return new;
  end if;

  if new.exact_player_credit_match is distinct from old.exact_player_credit_match then
    raise exception 'The exact player-credit fact is immutable after handoff.';
  end if;

  return new;
end;
$$;

create trigger deposit_execution_attempts_modal_fact_immutable
before insert or update on app.deposit_execution_attempts
for each row
execute function app.enforce_deposit_execution_modal_fact();

create trigger execution_reconciliations_require_modal_fact
before insert on app.execution_reconciliations
for each row
execute function app.enforce_deposit_execution_modal_fact();

create function app.enqueue_verified_deposit_execution(
  p_deposit_intent_id uuid
)
returns table (
  deposit_intent_id uuid,
  execution_job_id uuid,
  deposit_status text,
  execution_job_status text,
  already_enqueued boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  active_policy app.deposit_policy_versions%rowtype;
  decision_count integer;
  decision_maximum integer;
  existing_job app.deposit_jobs%rowtype;
  execution_job app.deposit_jobs%rowtype;
  intent_row app.deposit_intents%rowtype;
  latest_decision app.player_deposit_eligibility_decisions%rowtype;
  payment_claim app.deposit_payment_claims%rowtype;
  payment_evidence app.provider_payment_evidence%rowtype;
  player_platform app.platforms%rowtype;
  player_row app.customer_platform_players%rowtype;
  switch_count integer;
  verification_attempt app.deposit_verification_attempts%rowtype;
begin
  if p_deposit_intent_id is null then
    raise exception 'The deposit execution enqueue request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_deposit_intent_id::text, 20260815203606)
  );

  select intent.*
    into intent_row
    from app.deposit_intents intent
   where intent.id = p_deposit_intent_id
   for update;

  if not found then
    raise exception 'The deposit intent is unavailable for execution.';
  end if;

  select job.*
    into existing_job
    from app.deposit_jobs job
   where job.deposit_intent_id = intent_row.id
     and job.job_kind = 'execute_deposit'
   order by job.created_at, job.id
   limit 1
   for update;

  if found then
    if existing_job.max_attempts <> 1
      or existing_job.deposit_submission_id is not null
      or existing_job.job_key <> 'deposit-execution:v1:' || intent_row.id::text then
      raise exception 'The existing deposit execution command is malformed.';
    end if;

    return query
    select intent_row.id,
           existing_job.id,
           intent_row.status::text,
           existing_job.status::text,
           true,
           intent_row.updated_at;
    return;
  end if;

  if exists (
    select 1
      from app.deposit_execution_attempts attempt
     where attempt.deposit_intent_id = intent_row.id
  ) then
    raise exception 'A deposit execution attempt exists without its one-shot command.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
   order by feature_switch.feature_key
   for share;

  select count(*)::integer
    into switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
     and feature_switch.mode = 'live';

  if switch_count <> 2 then
    raise exception 'Live payment verification and deposit execution must both be enabled.';
  end if;

  select policy.*
    into active_policy
    from app.deposit_policy_versions policy
   where policy.status = 'active'
   for share;

  if not found then
    raise exception 'The current deposit amount policy is unavailable.';
  end if;

  select player.*
    into player_row
    from app.customer_platform_players player
   where player.id = intent_row.player_account_id
     and player.customer_id = intent_row.customer_id
     and player.platform_id = intent_row.platform_id
   for update;

  if not found then
    raise exception 'The deposit execution player binding is unavailable.';
  end if;

  select platform.*
    into player_platform
    from app.platforms platform
   where platform.id = player_row.platform_id
   for share;

  select count(*)::integer, coalesce(max(decision.decision_version), 0)
    into decision_count, decision_maximum
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_row.id;

  select decision.*
    into latest_decision
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_row.id
   order by decision.decision_version desc
   limit 1;

  if active_policy.id is null
    or intent_row.status <> 'verified'
    or intent_row.verified_at is null
    or intent_row.currency_code <> 'ETB'
    or intent_row.expected_amount_minor < 2500
    or intent_row.expected_amount_minor > 2500000
    or intent_row.expected_amount_minor < intent_row.minimum_amount_minor
    or intent_row.expected_amount_minor > intent_row.maximum_amount_minor
    or intent_row.minimum_amount_minor < 2500
    or intent_row.maximum_amount_minor > 2500000
    or intent_row.deposit_policy_version_id is distinct from active_policy.id
    or intent_row.deposit_policy_version is distinct from active_policy.version
    or intent_row.minimum_amount_minor is distinct from active_policy.minimum_amount_minor
    or intent_row.maximum_amount_minor is distinct from active_policy.maximum_amount_minor
    or intent_row.freshness_window_seconds is distinct from active_policy.freshness_window_seconds
    or intent_row.expected_amount_minor > active_policy.maximum_amount_minor then
    raise exception 'The verified deposit does not satisfy the current immutable amount policy.';
  end if;

  if player_platform.id is null
    or player_platform.code <> 'kemerbet'
    or player_platform.status <> 'active'
    or player_row.status <> 'active'
    or player_row.validation_status <> 'valid'
    or intent_row.player_deposit_eligibility_decision_id is null
    or decision_count = 0
    or decision_count <> decision_maximum
    or latest_decision.decision_version <> decision_maximum
    or latest_decision.decision <> 'eligible'
    or latest_decision.decided_at > clock_timestamp()
    or latest_decision.player_account_updated_at_snapshot is distinct from player_row.updated_at then
    raise exception 'The verified deposit requires a current Player-ID deposit-eligibility decision.';
  end if;

  select claim.*
    into payment_claim
    from app.deposit_payment_claims claim
   where claim.deposit_intent_id = intent_row.id
   for share;

  if not found then
    raise exception 'The deposit execution requires its immutable verified payment claim.';
  end if;

  select attempt.*
    into verification_attempt
    from app.deposit_verification_attempts attempt
   where attempt.id = payment_claim.verification_attempt_id
     and attempt.deposit_intent_id = intent_row.id
     and attempt.provider_payment_evidence_id = payment_claim.provider_payment_evidence_id
   for share;

  select evidence.*
    into payment_evidence
    from app.provider_payment_evidence evidence
   where evidence.id = payment_claim.provider_payment_evidence_id
   for share;

  if verification_attempt.id is null
    or verification_attempt.outcome <> 'verified'
    or payment_evidence.id is null
    or payment_evidence.provider_final_status <> 'completed'
    or payment_evidence.payment_provider_id is distinct from intent_row.payment_provider_id
    or payment_evidence.amount_minor is distinct from intent_row.expected_amount_minor
    or payment_evidence.currency_code is distinct from intent_row.currency_code
    or payment_evidence.matched_receiver_account_id is distinct from intent_row.receiver_account_id
    or payment_evidence.matched_receiver_account_version
       is distinct from intent_row.receiver_account_version
    or payment_evidence.occurred_at < intent_row.opened_at
    or payment_evidence.occurred_at > intent_row.payment_deadline_at then
    raise exception 'The immutable payment claim does not prove this exact deposit intent.';
  end if;

  update app.deposit_intents intent
     set status = 'execution_pending'
   where intent.id = intent_row.id
   returning * into intent_row;

  insert into app.deposit_jobs (
    deposit_intent_id,
    deposit_submission_id,
    job_kind,
    job_key,
    max_attempts
  ) values (
    intent_row.id,
    null,
    'execute_deposit',
    'deposit-execution:v1:' || intent_row.id::text,
    1
  )
  returning * into execution_job;

  return query
  select intent_row.id,
         execution_job.id,
         intent_row.status::text,
         execution_job.status::text,
         false,
         intent_row.updated_at;
end;
$$;

create function app.lease_next_deposit_execution(
  p_worker_instance_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  deposit_intent_id uuid,
  execution_job_id uuid,
  execution_attempt_id uuid,
  platform_agent_account_id uuid,
  player_id text,
  amount_minor bigint,
  currency_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_disposition text
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
#variable_conflict use_column
declare
  claimed_attempt app.deposit_execution_attempts%rowtype;
  claimed_job app.deposit_jobs%rowtype;
  claimed_job_id uuid;
  claimed_player_id text;
  claimed_agent_id uuid;
  claimed_amount_minor bigint;
  claimed_currency_code text;
  expired_attempt_id uuid;
  expired_intent_id uuid;
  expired_job_id uuid;
  new_lease_token uuid;
  switch_count integer;
begin
  if p_worker_instance_id is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'The deposit execution lease request is invalid.';
  end if;

  -- A worker that disappears before the fence cannot be allowed to strand the serialized agent
  -- lane or silently retry the transfer. Adopt exactly one expired prepared lease using its
  -- server-held token, cancel it into review, and only then consider unrelated queued work.
  select attempt.id,
         job.id,
         intent.id
    into expired_attempt_id,
         expired_job_id,
         expired_intent_id
    from app.deposit_execution_attempts attempt
    join app.deposit_jobs job
      on job.id = attempt.deposit_job_id
     and job.deposit_intent_id = attempt.deposit_intent_id
    join app.deposit_intents intent on intent.id = attempt.deposit_intent_id
   where attempt.status = 'prepared'
     and intent.status = 'execution_pending'
     and job.job_kind = 'execute_deposit'
     and job.status = 'leased'
     and job.max_attempts = 1
     and job.attempt_count = 1
     and job.lease_token is not null
     and job.lease_expires_at <= clock_timestamp()
   order by job.lease_expires_at, attempt.created_at, attempt.id
   for update of attempt, job, intent skip locked
   limit 1;

  if found then
    update app.deposit_execution_attempts attempt
       set status = 'cancelled_before_action'
     where attempt.id = expired_attempt_id;

    update app.deposit_jobs job
       set status = 'cancelled',
           lease_token = null,
           leased_by = null,
           lease_expires_at = null,
           last_error_code = 'execution_lease_expired_before_action'
     where job.id = expired_job_id;

    update app.deposit_intents intent
       set status = 'execution_review'
     where intent.id = expired_intent_id;

    insert into app.deposit_review_cases (
      deposit_intent_id,
      review_kind,
      reason_code
    ) values (
      expired_intent_id,
      'execution',
      'execution_lease_expired_before_action'
    )
    on conflict (deposit_intent_id, review_kind)
      where status in ('open', 'assigned')
    do nothing;

    return query
    select expired_intent_id,
           null::uuid,
           expired_attempt_id,
           null::uuid,
           null::text,
           null::bigint,
           null::text,
           null::uuid,
           null::timestamptz,
           'recovered_expired_prepared'::text;
    return;
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
   order by feature_switch.feature_key
   for share;

  select count(*)::integer
    into switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
     and feature_switch.mode = 'live';

  if switch_count <> 2 then
    return;
  end if;

  select job.id,
         agent_account.id,
         player_account.player_id,
         intent.expected_amount_minor,
         intent.currency_code::text
    into claimed_job_id,
         claimed_agent_id,
         claimed_player_id,
         claimed_amount_minor,
         claimed_currency_code
    from app.deposit_jobs job
    join app.deposit_intents intent on intent.id = job.deposit_intent_id
    join app.customer_platform_players player_account
      on player_account.id = intent.player_account_id
     and player_account.customer_id = intent.customer_id
     and player_account.platform_id = intent.platform_id
    join app.platforms platform
      on platform.id = intent.platform_id
     and platform.code = 'kemerbet'
     and platform.status = 'active'
    join app.platform_agent_accounts agent_account
      on agent_account.platform_id = platform.id
     and agent_account.status = 'active'
    join app.deposit_policy_versions active_policy
      on active_policy.id = intent.deposit_policy_version_id
     and active_policy.version = intent.deposit_policy_version
     and active_policy.minimum_amount_minor = intent.minimum_amount_minor
     and active_policy.maximum_amount_minor = intent.maximum_amount_minor
     and active_policy.freshness_window_seconds = intent.freshness_window_seconds
     and active_policy.status = 'active'
   where job.job_kind = 'execute_deposit'
     and job.status = 'queued'
     and job.run_after <= clock_timestamp()
     and job.max_attempts = 1
     and job.attempt_count = 0
     and intent.status = 'execution_pending'
     and intent.currency_code = 'ETB'
     and intent.expected_amount_minor >= 2500
     and intent.expected_amount_minor <= 2500000
     and intent.expected_amount_minor between intent.minimum_amount_minor and intent.maximum_amount_minor
     and intent.minimum_amount_minor >= 2500
     and intent.maximum_amount_minor <= 2500000
     and player_account.status = 'active'
     and player_account.validation_status = 'valid'
     and exists (
       select 1
         from app.deposit_payment_claims claim
        where claim.deposit_intent_id = intent.id
     )
     and exists (
       select 1
         from app.player_deposit_eligibility_decisions latest_decision
        where latest_decision.id = (
          select decision.id
            from app.player_deposit_eligibility_decisions decision
           where decision.player_account_id = player_account.id
           order by decision.decision_version desc
           limit 1
        )
          and latest_decision.player_account_id = player_account.id
          and latest_decision.decision = 'eligible'
          and latest_decision.decided_at <= clock_timestamp()
          and latest_decision.player_account_updated_at_snapshot
              is not distinct from player_account.updated_at
     )
     and (
       select count(*)::integer
         from app.player_deposit_eligibility_decisions decision
        where decision.player_account_id = player_account.id
     ) = (
       select coalesce(max(decision.decision_version), 0)
         from app.player_deposit_eligibility_decisions decision
        where decision.player_account_id = player_account.id
     )
     and not exists (
       select 1
         from app.deposit_execution_attempts blocking_attempt
        where blocking_attempt.platform_agent_account_id = agent_account.id
          and blocking_attempt.status in (
            'prepared',
            'final_action_fenced',
            'reconciliation_required',
            'review_required'
          )
     )
   order by job.priority desc, job.run_after, job.created_at, job.id, agent_account.id
   for update of job, intent, player_account, agent_account skip locked
   limit 1;

  if not found then
    return;
  end if;

  new_lease_token := gen_random_uuid();

  update app.deposit_jobs job
     set status = 'leased',
         attempt_count = job.attempt_count + 1,
         lease_token = new_lease_token,
         leased_by = p_worker_instance_id::text,
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
         last_error_code = null
   where job.id = claimed_job_id
   returning * into claimed_job;

  insert into app.deposit_execution_attempts (
    deposit_intent_id,
    deposit_job_id,
    platform_agent_account_id,
    attempt_number
  ) values (
    claimed_job.deposit_intent_id,
    claimed_job.id,
    claimed_agent_id,
    1
  )
  returning * into claimed_attempt;

  return query
  select claimed_job.deposit_intent_id,
         claimed_job.id,
         claimed_attempt.id,
         claimed_agent_id,
         claimed_player_id,
         claimed_amount_minor,
         claimed_currency_code,
         claimed_job.lease_token,
         claimed_job.lease_expires_at,
         'execution'::text;
end;
$$;

create function app.cancel_deposit_execution_before_action(
  p_execution_attempt_id uuid,
  p_lease_token uuid,
  p_reason_code text
)
returns table (
  deposit_intent_id uuid,
  execution_job_id uuid,
  execution_attempt_id uuid,
  attempt_status text,
  deposit_status text,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
#variable_conflict use_column
declare
  attempt_row app.deposit_execution_attempts%rowtype;
  intent_row app.deposit_intents%rowtype;
  job_row app.deposit_jobs%rowtype;
  resolved_deposit_intent_id uuid;
begin
  if p_execution_attempt_id is null
    or p_lease_token is null
    or p_reason_code is null
    or p_reason_code not in (
      'preparation_failed',
      'agent_unavailable_before_action',
      'session_unavailable_before_action',
      'operator_stopped_before_action',
      'execution_lease_expired_before_action'
    ) then
    raise exception 'The deposit execution cancellation request is invalid.';
  end if;

  select attempt.deposit_intent_id
    into resolved_deposit_intent_id
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id;

  if not found then
    raise exception 'The deposit execution attempt is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(resolved_deposit_intent_id::text, 20260815203606)
  );

  select attempt.*
    into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id
   for update;

  if not found
    or attempt_row.deposit_intent_id is distinct from resolved_deposit_intent_id then
    raise exception 'The deposit execution attempt is unavailable.';
  end if;

  select job.*
    into job_row
    from app.deposit_jobs job
   where job.id = attempt_row.deposit_job_id
     and job.deposit_intent_id = attempt_row.deposit_intent_id
   for update;

  select intent.*
    into intent_row
    from app.deposit_intents intent
   where intent.id = attempt_row.deposit_intent_id
   for update;

  if attempt_row.status = 'cancelled_before_action' then
    insert into app.deposit_review_cases (
      deposit_intent_id,
      review_kind,
      reason_code
    ) values (
      attempt_row.deposit_intent_id,
      'execution',
      p_reason_code
    )
    on conflict (deposit_intent_id, review_kind)
      where status in ('open', 'assigned')
    do nothing;

    return query
    select intent_row.id,
           job_row.id,
           attempt_row.id,
           attempt_row.status::text,
           intent_row.status::text,
           attempt_row.resolved_at;
    return;
  end if;

  if job_row.id is null
    or intent_row.id is null
    or attempt_row.status <> 'prepared'
    or intent_row.status <> 'execution_pending'
    or job_row.status <> 'leased'
    or job_row.job_kind <> 'execute_deposit'
    or job_row.lease_token is distinct from p_lease_token then
    raise exception 'Only the matching unfenced execution lease can be cancelled.';
  end if;

  update app.deposit_execution_attempts attempt
     set status = 'cancelled_before_action'
   where attempt.id = attempt_row.id
   returning * into attempt_row;

  update app.deposit_jobs job
     set status = 'cancelled',
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         last_error_code = p_reason_code
   where job.id = job_row.id
   returning * into job_row;

  update app.deposit_intents intent
     set status = 'execution_review'
   where intent.id = intent_row.id
   returning * into intent_row;

  insert into app.deposit_review_cases (
    deposit_intent_id,
    review_kind,
    reason_code
  ) values (
    intent_row.id,
    'execution',
    p_reason_code
  )
  on conflict (deposit_intent_id, review_kind)
    where status in ('open', 'assigned')
  do nothing;

  return query
  select intent_row.id,
         job_row.id,
         attempt_row.id,
         attempt_row.status::text,
         intent_row.status::text,
         attempt_row.resolved_at;
end;
$$;

create function app.fence_deposit_execution_final_action(
  p_execution_attempt_id uuid,
  p_lease_token uuid
)
returns table (
  deposit_intent_id uuid,
  execution_attempt_id uuid,
  final_action_fenced_at timestamptz,
  first_fence_acquired boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  active_policy app.deposit_policy_versions%rowtype;
  attempt_row app.deposit_execution_attempts%rowtype;
  decision_count integer;
  decision_maximum integer;
  intent_row app.deposit_intents%rowtype;
  job_row app.deposit_jobs%rowtype;
  latest_decision app.player_deposit_eligibility_decisions%rowtype;
  player_platform app.platforms%rowtype;
  player_row app.customer_platform_players%rowtype;
  resolved_deposit_intent_id uuid;
  agent_row app.platform_agent_accounts%rowtype;
  switch_count integer;
begin
  if p_execution_attempt_id is null
    or p_lease_token is null then
    raise exception 'The deposit final-action fence request is invalid.';
  end if;

  select attempt.deposit_intent_id
    into resolved_deposit_intent_id
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id;

  if not found then
    raise exception 'The deposit execution attempt is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(resolved_deposit_intent_id::text, 20260815203606)
  );

  select attempt.*
    into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id
   for update;

  if not found
    or attempt_row.deposit_intent_id is distinct from resolved_deposit_intent_id then
    raise exception 'The deposit execution attempt is unavailable.';
  end if;

  if attempt_row.status in (
    'final_action_fenced',
    'reconciliation_required',
    'confirmed_executed',
    'review_required'
  ) then
    return query
    select attempt_row.deposit_intent_id,
           attempt_row.id,
           attempt_row.final_action_fenced_at,
           false;
    return;
  end if;

  select job.*
    into job_row
    from app.deposit_jobs job
   where job.id = attempt_row.deposit_job_id
     and job.deposit_intent_id = attempt_row.deposit_intent_id
   for update;

  select intent.*
    into intent_row
    from app.deposit_intents intent
   where intent.id = attempt_row.deposit_intent_id
   for update;

  if job_row.id is null
    or intent_row.id is null
    or attempt_row.status <> 'prepared'
    or intent_row.status <> 'execution_pending'
    or job_row.status <> 'leased'
    or job_row.job_kind <> 'execute_deposit'
    or job_row.max_attempts <> 1
    or job_row.attempt_count <> 1
    or job_row.lease_token is distinct from p_lease_token
    or job_row.lease_expires_at <= clock_timestamp() then
    raise exception 'The one-shot deposit execution lease is unavailable for fencing.';
  end if;

  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
   order by feature_switch.feature_key
   for share;

  select count(*)::integer
    into switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
     and feature_switch.mode = 'live';

  select policy.*
    into active_policy
    from app.deposit_policy_versions policy
   where policy.status = 'active'
   for share;

  select player.*
    into player_row
    from app.customer_platform_players player
   where player.id = intent_row.player_account_id
     and player.customer_id = intent_row.customer_id
     and player.platform_id = intent_row.platform_id
   for update;

  select platform.*
    into player_platform
    from app.platforms platform
   where platform.id = intent_row.platform_id
   for share;

  select agent.*
    into agent_row
    from app.platform_agent_accounts agent
   where agent.id = attempt_row.platform_agent_account_id
     and agent.platform_id = intent_row.platform_id
   for update;

  select count(*)::integer, coalesce(max(decision.decision_version), 0)
    into decision_count, decision_maximum
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_row.id;

  select decision.*
    into latest_decision
    from app.player_deposit_eligibility_decisions decision
   where decision.player_account_id = player_row.id
   order by decision.decision_version desc
   limit 1;

  if switch_count <> 2
    or active_policy.id is null
    or intent_row.currency_code <> 'ETB'
    or intent_row.expected_amount_minor < 2500
    or intent_row.expected_amount_minor > 2500000
    or intent_row.expected_amount_minor not between
       intent_row.minimum_amount_minor and intent_row.maximum_amount_minor
    or intent_row.minimum_amount_minor < 2500
    or intent_row.maximum_amount_minor > 2500000
    or intent_row.deposit_policy_version_id is distinct from active_policy.id
    or intent_row.deposit_policy_version is distinct from active_policy.version
    or intent_row.minimum_amount_minor is distinct from active_policy.minimum_amount_minor
    or intent_row.maximum_amount_minor is distinct from active_policy.maximum_amount_minor
    or intent_row.freshness_window_seconds is distinct from active_policy.freshness_window_seconds
    or player_row.id is null
    or player_row.status <> 'active'
    or player_row.validation_status <> 'valid'
    or player_platform.id is null
    or player_platform.code <> 'kemerbet'
    or player_platform.status <> 'active'
    or agent_row.id is null
    or agent_row.status <> 'active'
    or decision_count = 0
    or decision_count <> decision_maximum
    or latest_decision.decision_version <> decision_maximum
    or latest_decision.decision <> 'eligible'
    or latest_decision.decided_at > clock_timestamp()
    or latest_decision.player_account_updated_at_snapshot is distinct from player_row.updated_at
    or not exists (
      select 1
        from app.deposit_payment_claims claim
       where claim.deposit_intent_id = intent_row.id
    ) then
    raise exception 'The deposit is no longer eligible for a live final action.';
  end if;

  update app.deposit_execution_attempts attempt
     set status = 'final_action_fenced'
   where attempt.id = attempt_row.id
   returning * into attempt_row;

  update app.deposit_intents intent
     set status = 'execution_in_progress'
   where intent.id = intent_row.id
   returning * into intent_row;

  update app.deposit_jobs job
     set lease_expires_at = attempt_row.final_action_fenced_at + interval '10 seconds'
   where job.id = job_row.id
   returning * into job_row;

  return query
  select intent_row.id,
         attempt_row.id,
         attempt_row.final_action_fenced_at,
         true;
end;
$$;

create function app.require_deposit_execution_reconciliation(
  p_execution_attempt_id uuid,
  p_lease_token uuid,
  p_exact_player_credit_match boolean
)
returns table (
  deposit_intent_id uuid,
  execution_attempt_id uuid,
  reconciliation_job_id uuid,
  attempt_status text,
  deposit_status text,
  recovery_handoff boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  attempt_row app.deposit_execution_attempts%rowtype;
  execution_job app.deposit_jobs%rowtype;
  intent_row app.deposit_intents%rowtype;
  reconciliation_job app.deposit_jobs%rowtype;
  resolved_deposit_intent_id uuid;
  used_recovery boolean;
begin
  if p_execution_attempt_id is null
    or (p_lease_token is null and p_exact_player_credit_match is not null)
    or (p_lease_token is not null and p_exact_player_credit_match is null) then
    raise exception 'The deposit reconciliation requirement is invalid.';
  end if;

  select attempt.deposit_intent_id
    into resolved_deposit_intent_id
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id;

  if not found then
    raise exception 'The deposit execution attempt is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(resolved_deposit_intent_id::text, 20260815203606)
  );

  select attempt.*
    into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.id = p_execution_attempt_id
   for update;

  if not found
    or attempt_row.deposit_intent_id is distinct from resolved_deposit_intent_id then
    raise exception 'The deposit execution attempt is unavailable.';
  end if;

  select intent.*
    into intent_row
    from app.deposit_intents intent
   where intent.id = attempt_row.deposit_intent_id
   for update;

  if attempt_row.status in ('reconciliation_required', 'confirmed_executed', 'review_required') then
    if attempt_row.exact_player_credit_match
       is distinct from p_exact_player_credit_match then
      raise exception 'The exact player-credit handoff fact does not match.';
    end if;

    select job.*
      into reconciliation_job
      from app.deposit_jobs job
     where job.deposit_intent_id = attempt_row.deposit_intent_id
       and job.job_kind = 'reconcile_execution'
     order by job.created_at, job.id
     limit 1;

    if reconciliation_job.id is null then
      raise exception 'The reconciled execution attempt lost its reconciliation command.';
    end if;

    return query
    select intent_row.id,
           attempt_row.id,
           reconciliation_job.id,
           attempt_row.status::text,
           intent_row.status::text,
           false;
    return;
  end if;

  select job.*
    into execution_job
    from app.deposit_jobs job
   where job.id = attempt_row.deposit_job_id
     and job.deposit_intent_id = attempt_row.deposit_intent_id
   for update;

  if execution_job.id is null
    or intent_row.id is null
    or attempt_row.status <> 'final_action_fenced'
    or intent_row.status <> 'execution_in_progress'
    or execution_job.job_kind <> 'execute_deposit'
    or execution_job.status <> 'leased' then
    raise exception 'Only a fenced execution can require reconciliation.';
  end if;

  used_recovery := p_lease_token is null;

  if p_lease_token is not null
    and execution_job.lease_token is distinct from p_lease_token then
    raise exception 'The original deposit execution lease does not match.';
  elsif p_lease_token is null
    and execution_job.lease_expires_at > clock_timestamp() then
    raise exception 'The fenced execution handoff is not ready for crash recovery.';
  end if;

  update app.deposit_execution_attempts attempt
     set status = 'reconciliation_required',
         exact_player_credit_match = p_exact_player_credit_match
   where attempt.id = attempt_row.id
   returning * into attempt_row;

  update app.deposit_intents intent
     set status = 'execution_uncertain'
   where intent.id = intent_row.id
   returning * into intent_row;

  update app.deposit_jobs job
     set status = 'succeeded',
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         last_error_code = null
   where job.id = execution_job.id;

  insert into app.deposit_jobs (
    deposit_intent_id,
    deposit_submission_id,
    job_kind,
    job_key,
    run_after,
    max_attempts
  ) values (
    attempt_row.deposit_intent_id,
    null,
    'reconcile_execution',
    'deposit-reconciliation:v1:' || attempt_row.id::text || ':1',
    clock_timestamp(),
    8
  )
  returning * into reconciliation_job;

  update app.deposit_intents intent
     set status = 'execution_reconciliation'
   where intent.id = intent_row.id
   returning * into intent_row;

  return query
  select intent_row.id,
         attempt_row.id,
         reconciliation_job.id,
         attempt_row.status::text,
         intent_row.status::text,
         used_recovery;
end;
$$;

create function app.lease_next_deposit_execution_reconciliation(
  p_worker_instance_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  deposit_intent_id uuid,
  reconciliation_job_id uuid,
  execution_attempt_id uuid,
  platform_agent_account_id uuid,
  player_id text,
  amount_minor bigint,
  currency_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  final_action_fenced_at timestamptz,
  reconciliation_required_at timestamptz,
  exact_player_credit_match boolean
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
#variable_conflict use_column
declare
  adopt_attempt_id uuid;
  claimed_attempt app.deposit_execution_attempts%rowtype;
  claimed_attempt_id uuid;
  claimed_job app.deposit_jobs%rowtype;
  claimed_job_id uuid;
  claimed_player_id text;
  exhausted_agent_id uuid;
  exhausted_attempt_id uuid;
  exhausted_history_count integer;
  exhausted_history_maximum integer;
  exhausted_intent_id uuid;
  exhausted_job_id uuid;
  new_lease_token uuid;
begin
  if p_worker_instance_id is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'The deposit reconciliation lease request is invalid.';
  end if;

  -- A fenced worker crash is discovered here. This path can only move forward to observation and
  -- cannot return an execution lease or another first-fence permission.
  select attempt.id
    into adopt_attempt_id
    from app.deposit_execution_attempts attempt
    join app.deposit_jobs execution_job
      on execution_job.id = attempt.deposit_job_id
     and execution_job.deposit_intent_id = attempt.deposit_intent_id
    join app.deposit_intents intent on intent.id = attempt.deposit_intent_id
   where attempt.status = 'final_action_fenced'
     and intent.status = 'execution_in_progress'
     and execution_job.job_kind = 'execute_deposit'
     and execution_job.status = 'leased'
     and execution_job.lease_expires_at <= clock_timestamp()
   order by attempt.final_action_fenced_at, attempt.id
   for update of attempt, execution_job skip locked
   limit 1;

  if found then
    perform *
      from app.require_deposit_execution_reconciliation(
        adopt_attempt_id,
        null::uuid,
        null::boolean
      );
  end if;

  with expired_job as (
    select job.id
      from app.deposit_jobs job
     where job.job_kind = 'reconcile_execution'
       and job.status = 'leased'
       and job.lease_expires_at <= clock_timestamp()
       and job.attempt_count < job.max_attempts
     order by job.lease_expires_at, job.id
     for update skip locked
     limit 1
  )
  update app.deposit_jobs job
     set status = 'retry_wait',
         run_after = clock_timestamp(),
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         last_error_code = 'reconciliation_lease_expired'
    from expired_job
   where job.id = expired_job.id;

  select job.id,
         attempt.id,
         intent.id,
         attempt.platform_agent_account_id
    into exhausted_job_id,
         exhausted_attempt_id,
         exhausted_intent_id,
         exhausted_agent_id
    from app.deposit_jobs job
    join app.deposit_execution_attempts attempt
      on attempt.deposit_intent_id = job.deposit_intent_id
     and attempt.status = 'reconciliation_required'
    join app.deposit_intents intent
      on intent.id = job.deposit_intent_id
     and intent.status = 'execution_reconciliation'
   where job.job_kind = 'reconcile_execution'
     and job.status = 'leased'
     and job.lease_expires_at <= clock_timestamp()
     and job.attempt_count >= job.max_attempts
   order by job.lease_expires_at, job.id
   for update of job, attempt, intent skip locked
   limit 1;

  if found then
    select count(*)::integer,
           coalesce(max(reconciliation.reconciliation_number), 0)
      into exhausted_history_count,
           exhausted_history_maximum
      from app.execution_reconciliations reconciliation
     where reconciliation.deposit_execution_attempt_id = exhausted_attempt_id;

    if exhausted_history_count <> exhausted_history_maximum then
      raise exception 'The exhausted deposit reconciliation history is malformed.';
    end if;

    insert into app.execution_reconciliations (
      deposit_execution_attempt_id,
      deposit_intent_id,
      platform_agent_account_id,
      deposit_job_id,
      reconciliation_number,
      outcome,
      reason_code
    ) values (
      exhausted_attempt_id,
      exhausted_intent_id,
      exhausted_agent_id,
      exhausted_job_id,
      exhausted_history_maximum + 1,
      'ambiguous',
      'agent_history_ambiguous'
    );

    update app.deposit_jobs job
       set status = 'succeeded',
           lease_token = null,
           leased_by = null,
           lease_expires_at = null,
           last_error_code = null
     where job.id = exhausted_job_id;

    update app.deposit_execution_attempts attempt
       set status = 'review_required'
     where attempt.id = exhausted_attempt_id;

    update app.deposit_intents intent
       set status = 'execution_review'
     where intent.id = exhausted_intent_id;

    insert into app.deposit_review_cases (
      deposit_intent_id,
      review_kind,
      reason_code
    ) values (
      exhausted_intent_id,
      'execution',
      'reconciliation_lease_exhausted'
    )
    on conflict (deposit_intent_id, review_kind)
      where status in ('open', 'assigned')
    do nothing;
  end if;

  select job.id,
         attempt.id,
         player_account.player_id
    into claimed_job_id,
         claimed_attempt_id,
         claimed_player_id
    from app.deposit_jobs job
    join app.deposit_intents intent on intent.id = job.deposit_intent_id
    join app.deposit_execution_attempts attempt
      on attempt.deposit_intent_id = intent.id
     and attempt.status = 'reconciliation_required'
    join app.customer_platform_players player_account
      on player_account.id = intent.player_account_id
     and player_account.customer_id = intent.customer_id
     and player_account.platform_id = intent.platform_id
    join app.platforms platform
      on platform.id = intent.platform_id
     and platform.code = 'kemerbet'
    join app.platform_agent_accounts agent_account
      on agent_account.id = attempt.platform_agent_account_id
     and agent_account.platform_id = platform.id
   where job.job_kind = 'reconcile_execution'
     and job.status in ('queued', 'retry_wait')
     and job.run_after <= clock_timestamp()
     and job.attempt_count < job.max_attempts
     and intent.status = 'execution_reconciliation'
     and attempt.final_action_fenced_at is not null
     and attempt.reconciliation_required_at is not null
   order by job.priority desc, job.run_after, job.created_at, job.id
   for update of job, attempt skip locked
   limit 1;

  if not found then
    return;
  end if;

  select attempt.*
    into claimed_attempt
    from app.deposit_execution_attempts attempt
   where attempt.id = claimed_attempt_id;

  new_lease_token := gen_random_uuid();

  update app.deposit_jobs job
     set status = 'leased',
         attempt_count = job.attempt_count + 1,
         lease_token = new_lease_token,
         leased_by = p_worker_instance_id::text,
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
         last_error_code = null
   where job.id = claimed_job_id
   returning * into claimed_job;

  return query
  select claimed_job.deposit_intent_id,
         claimed_job.id,
         claimed_attempt.id,
         claimed_attempt.platform_agent_account_id,
         claimed_player_id,
         intent.expected_amount_minor,
         intent.currency_code::text,
         claimed_job.lease_token,
         claimed_job.lease_expires_at,
         claimed_attempt.final_action_fenced_at,
         claimed_attempt.reconciliation_required_at,
         claimed_attempt.exact_player_credit_match
    from app.deposit_intents intent
   where intent.id = claimed_job.deposit_intent_id;
end;
$$;

create function app.record_deposit_execution_reconciliation(
  p_reconciliation_job_id uuid,
  p_lease_token uuid,
  p_observation text,
  p_keyed_external_reference_fingerprint text default null,
  p_approved_history_match_count smallint default null,
  p_normalized_operation_type text default null,
  p_matched_history_occurred_at timestamptz default null,
  p_exact_player_credit_match boolean default null,
  p_exact_player_match boolean default null,
  p_exact_amount_match boolean default null,
  p_exact_currency_match boolean default null
)
returns table (
  deposit_intent_id uuid,
  reconciliation_job_id uuid,
  execution_attempt_id uuid,
  reconciliation_id uuid,
  outcome text,
  reason_code text,
  attempt_status text,
  deposit_status text,
  follow_up_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  attempt_row app.deposit_execution_attempts%rowtype;
  decision_count integer;
  decision_maximum integer;
  effective_outcome app.execution_reconciliation_outcome;
  effective_reason_code text;
  existing_reconciliation app.execution_reconciliations%rowtype;
  follow_up_job app.deposit_jobs%rowtype;
  intent_row app.deposit_intents%rowtype;
  job_row app.deposit_jobs%rowtype;
  reconciliation_row app.execution_reconciliations%rowtype;
begin
  if p_reconciliation_job_id is null
    or p_lease_token is null
    or p_observation is null
    or p_observation not in ('confirmed_executed', 'ambiguous', 'not_observed') then
    raise exception 'The deposit reconciliation observation is invalid.';
  end if;

  select job.*
    into job_row
    from app.deposit_jobs job
   where job.id = p_reconciliation_job_id
     and job.job_kind = 'reconcile_execution'
   for update;

  if not found then
    raise exception 'The deposit reconciliation command is unavailable.';
  end if;

  select reconciliation.*
    into existing_reconciliation
    from app.execution_reconciliations reconciliation
   where reconciliation.deposit_job_id = job_row.id;

  if found then
    select attempt.*
      into attempt_row
      from app.deposit_execution_attempts attempt
     where attempt.id = existing_reconciliation.deposit_execution_attempt_id;

    if p_exact_player_credit_match
       is distinct from attempt_row.exact_player_credit_match then
      raise exception 'The exact player-credit reconciliation fact does not match its handoff.';
    end if;

    select intent.*
      into intent_row
      from app.deposit_intents intent
     where intent.id = existing_reconciliation.deposit_intent_id;

    if existing_reconciliation.outcome = 'not_observed' then
      select job.*
        into follow_up_job
        from app.deposit_jobs job
       where job.job_key =
         'deposit-reconciliation:v1:' || attempt_row.id::text || ':'
         || (existing_reconciliation.reconciliation_number + 1)::text;
    end if;

    return query
    select intent_row.id,
           job_row.id,
           attempt_row.id,
           existing_reconciliation.id,
           existing_reconciliation.outcome::text,
           existing_reconciliation.reason_code,
           attempt_row.status::text,
           intent_row.status::text,
           follow_up_job.id;
    return;
  end if;

  select attempt.*
    into attempt_row
    from app.deposit_execution_attempts attempt
   where attempt.deposit_intent_id = job_row.deposit_intent_id
     and attempt.status = 'reconciliation_required'
   for update;

  select intent.*
    into intent_row
    from app.deposit_intents intent
   where intent.id = job_row.deposit_intent_id
   for update;

  if attempt_row.id is null
    or intent_row.id is null
    or intent_row.status <> 'execution_reconciliation'
    or job_row.status <> 'leased'
    or job_row.lease_token is distinct from p_lease_token
    or job_row.lease_expires_at <= clock_timestamp() then
    raise exception 'The matching deposit reconciliation lease is unavailable.';
  end if;

  if p_exact_player_credit_match
     is distinct from attempt_row.exact_player_credit_match then
    raise exception 'The exact player-credit reconciliation fact does not match its handoff.';
  end if;

  select count(*)::integer, coalesce(max(reconciliation.reconciliation_number), 0)
    into decision_count, decision_maximum
    from app.execution_reconciliations reconciliation
   where reconciliation.deposit_execution_attempt_id = attempt_row.id;

  if decision_count <> decision_maximum then
    raise exception 'The deposit reconciliation observation history is malformed.';
  end if;

  if p_observation = 'confirmed_executed'
    and p_keyed_external_reference_fingerprint
      ~ '^hmac-sha256-v1:[0-9a-f]{64}$'
    and p_approved_history_match_count = 1
    and p_normalized_operation_type = 'deposit'
    and p_matched_history_occurred_at between
      attempt_row.final_action_fenced_at and attempt_row.reconciliation_required_at
    and attempt_row.exact_player_credit_match is true
    and p_exact_player_match is true
    and p_exact_amount_match is true
    and p_exact_currency_match is true then
    effective_outcome := 'confirmed_executed';
    effective_reason_code :=
      'agent_deposit_history_in_window_and_player_credit_confirmed';
  elsif p_observation = 'not_observed'
    and p_keyed_external_reference_fingerprint is null
    and p_approved_history_match_count is null
    and p_normalized_operation_type is null
    and p_matched_history_occurred_at is null
    and p_exact_player_match is null
    and p_exact_amount_match is null
    and p_exact_currency_match is null
    and decision_maximum + 1 < 6 then
    effective_outcome := 'not_observed';
    effective_reason_code := 'agent_history_not_observed';
  else
    effective_outcome := 'ambiguous';
    effective_reason_code := 'agent_history_ambiguous';
  end if;

  insert into app.execution_reconciliations (
    deposit_execution_attempt_id,
    deposit_intent_id,
    platform_agent_account_id,
    deposit_job_id,
    reconciliation_number,
    outcome,
    reason_code,
    keyed_external_reference_fingerprint,
    approved_history_match_count,
    normalized_operation_type,
    matched_history_occurred_at,
    exact_player_match,
    exact_amount_match,
    exact_currency_match,
    exact_player_credit_match
  ) values (
    attempt_row.id,
    attempt_row.deposit_intent_id,
    attempt_row.platform_agent_account_id,
    job_row.id,
    decision_maximum + 1,
    effective_outcome,
    effective_reason_code,
    case when effective_outcome = 'confirmed_executed'
      then p_keyed_external_reference_fingerprint else null end,
    case when effective_outcome = 'confirmed_executed'
      then p_approved_history_match_count else null end,
    case when effective_outcome = 'confirmed_executed'
      then p_normalized_operation_type else null end,
    case when effective_outcome = 'confirmed_executed'
      then p_matched_history_occurred_at else null end,
    case when effective_outcome = 'confirmed_executed'
      then p_exact_player_match else null end,
    case when effective_outcome = 'confirmed_executed'
      then p_exact_amount_match else null end,
    case when effective_outcome = 'confirmed_executed'
      then p_exact_currency_match else null end,
    case when effective_outcome = 'confirmed_executed'
      then attempt_row.exact_player_credit_match else null end
  )
  returning * into reconciliation_row;

  update app.deposit_jobs job
     set status = 'succeeded',
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         last_error_code = null
   where job.id = job_row.id
   returning * into job_row;

  if effective_outcome = 'confirmed_executed' then
    update app.deposit_execution_attempts attempt
       set status = 'confirmed_executed'
     where attempt.id = attempt_row.id
     returning * into attempt_row;

    update app.deposit_intents intent
       set status = 'executed'
     where intent.id = intent_row.id
     returning * into intent_row;
  elsif effective_outcome = 'ambiguous' then
    update app.deposit_execution_attempts attempt
       set status = 'review_required'
     where attempt.id = attempt_row.id
     returning * into attempt_row;

    update app.deposit_intents intent
       set status = 'execution_review'
     where intent.id = intent_row.id
     returning * into intent_row;
  else
    insert into app.deposit_jobs (
      deposit_intent_id,
      deposit_submission_id,
      job_kind,
      job_key,
      run_after,
      max_attempts
    ) values (
      intent_row.id,
      null,
      'reconcile_execution',
      'deposit-reconciliation:v1:' || attempt_row.id::text || ':'
        || (reconciliation_row.reconciliation_number + 1)::text,
      clock_timestamp() + interval '2 seconds',
      8
    )
    returning * into follow_up_job;
  end if;

  return query
  select intent_row.id,
         job_row.id,
         attempt_row.id,
         reconciliation_row.id,
         reconciliation_row.outcome::text,
         reconciliation_row.reason_code,
         attempt_row.status::text,
         intent_row.status::text,
         follow_up_job.id;
end;
$$;

alter function app.enforce_deposit_execution_modal_fact()
  owner to postgres;
alter function app.enqueue_verified_deposit_execution(uuid)
  owner to postgres;
alter function app.lease_next_deposit_execution(uuid, integer)
  owner to postgres;
alter function app.cancel_deposit_execution_before_action(uuid, uuid, text)
  owner to postgres;
alter function app.fence_deposit_execution_final_action(uuid, uuid)
  owner to postgres;
alter function app.require_deposit_execution_reconciliation(uuid, uuid, boolean)
  owner to postgres;
alter function app.lease_next_deposit_execution_reconciliation(uuid, integer)
  owner to postgres;
alter function app.record_deposit_execution_reconciliation(
  uuid, uuid, text, text, smallint, text, timestamptz, boolean, boolean, boolean, boolean
) owner to postgres;

revoke all privileges on all tables in schema app
  from fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke all privileges on all functions in schema app
  from fetanagent_deposit_executor_runtime;
revoke all privileges on schema app from fetanagent_deposit_executor_runtime;

revoke all on function
  app.enforce_deposit_execution_modal_fact(),
  app.enqueue_verified_deposit_execution(uuid),
  app.lease_next_deposit_execution(uuid, integer),
  app.cancel_deposit_execution_before_action(uuid, uuid, text),
  app.fence_deposit_execution_final_action(uuid, uuid),
  app.require_deposit_execution_reconciliation(uuid, uuid, boolean),
  app.lease_next_deposit_execution_reconciliation(uuid, integer),
  app.record_deposit_execution_reconciliation(
    uuid, uuid, text, text, smallint, text, timestamptz, boolean, boolean, boolean, boolean
  )
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

revoke usage on type
  app.deposit_execution_attempt_status,
  app.execution_reconciliation_outcome
from fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

grant usage on schema app to fetanagent_deposit_executor;

grant execute on function
  app.enqueue_verified_deposit_execution(uuid),
  app.lease_next_deposit_execution(uuid, integer),
  app.cancel_deposit_execution_before_action(uuid, uuid, text),
  app.fence_deposit_execution_final_action(uuid, uuid),
  app.require_deposit_execution_reconciliation(uuid, uuid, boolean),
  app.lease_next_deposit_execution_reconciliation(uuid, integer),
  app.record_deposit_execution_reconciliation(
    uuid, uuid, text, text, smallint, text, timestamptz, boolean, boolean, boolean, boolean
  )
to fetanagent_deposit_executor;

comment on function app.enqueue_verified_deposit_execution(uuid) is
  'Idempotently enqueues one real KemerBet execution only for a claimed verified payment, current Player-ID eligibility, the current immutable amount policy, and live financial switches.';
comment on function app.fence_deposit_execution_final_action(uuid, uuid) is
  'Returns first_fence_acquired=true exactly once. Only true authorizes the external final action.';
comment on function app.lease_next_deposit_execution_reconciliation(uuid, integer) is
  'Leases observation-only work and atomically adopts expired fenced crash handoffs without restoring execution permission.';
comment on function app.record_deposit_execution_reconciliation(
  uuid, uuid, text, text, smallint, text, timestamptz, boolean, boolean, boolean, boolean
) is
  'Normalizes execution evidence, derives the exact player-credit outcome, never retries transfer, and sends the sixth absent observation to blocking review.';

commit;
