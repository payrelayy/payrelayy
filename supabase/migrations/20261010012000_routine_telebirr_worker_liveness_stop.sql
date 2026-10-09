-- Stop routine financial intake when the paired Windows credit worker disappears.
-- This migration is inert while the two financial gates are disabled. It neither
-- authorizes a payment nor retries an already-fenced KemerBet Transfer.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $require_dormant_gates$
begin
  if (
    select pg_catalog.count(*) from app.feature_switches feature_switch
    where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb
  ) <> 2 then
    raise exception 'Install the routine worker liveness boundary only while deposits are off.';
  end if;
end;
$require_dormant_gates$;

create index routine_telebirr_broker_recent_lease
  on app.routine_telebirr_broker_requests (certificate_id, completed_at desc)
  where operation = 'lease';

-- Every row considered here was accepted by the signed, replay-protected broker.
-- A browser window, an ordinary Companion, and a database role being LOGIN are
-- deliberately insufficient evidence that the serial credit worker is present.
create function app.routine_telebirr_signed_worker_recent(p_max_age interval)
returns boolean
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select p_max_age in (interval '45 seconds', interval '90 seconds', interval '5 minutes')
    and exists (
      select 1
      from app.routine_telebirr_runtime_events activation
      join app.routine_telebirr_broker_requests request
        on request.certificate_id = activation.certificate_id
       and request.operation = 'lease'
       and request.completed_at >= activation.recorded_at
       and request.completed_at > pg_catalog.clock_timestamp() - p_max_age
      where activation.event_sequence = (
        select pg_catalog.max(latest.event_sequence)
        from app.routine_telebirr_runtime_events latest
      )
        and activation.event_kind = 'activate'
        and activation.valid_until > pg_catalog.clock_timestamp()
    )
$$;

-- The existing activation procedure supplies the exact Owner/cohort/switch
-- serialization context. Require a fresh signed lease and a running independent
-- database watchdog before either shared gate can become live in that context.
create function app.require_routine_telebirr_worker_at_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  gate_mode text;
  job_count integer;
  successful_run_count integer;
begin
  if old.feature_key not in ('payment_verification', 'deposit_execution')
    or old.mode <> 'disabled' or new.mode <> 'live' then
    return new;
  end if;
  select gate.pilot_mutation_mode into gate_mode
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id();
  if gate_mode is distinct from 'routine_activate' then return new; end if;
  if session_user <> 'postgres'
    or not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    raise exception 'A recent signed Windows credit-worker lease is required.';
  end if;
  if pg_catalog.to_regclass('cron.job') is null then
    if pg_catalog.to_regclass('sql_integration.applied_migrations') is not null then
      return new;
    end if;
    raise exception 'The independent routine worker watchdog is unavailable.';
  end if;
  execute $job$
    select pg_catalog.count(*)::integer
    from cron.job job
    where job.jobname = 'fetanagent-routine-worker-liveness-v1'
      and job.active and job.username = 'postgres'
      and job.schedule = '15 seconds'
      and job.command = 'select app.stop_stale_routine_telebirr_financial_gates()'
  $job$ into job_count;
  execute $run$
    select pg_catalog.count(*)::integer from (
      select run.status, run.end_time
      from cron.job job
      join cron.job_run_details run on run.jobid = job.jobid
      where job.jobname = 'fetanagent-routine-worker-liveness-v1'
      order by run.start_time desc limit 1
    ) recent
    where recent.status = 'succeeded'
      and recent.end_time >= pg_catalog.clock_timestamp() - interval '2 minutes'
  $run$ into successful_run_count;
  if job_count <> 1 or successful_run_count <> 1 then
    raise exception 'The independent routine worker watchdog is not running.';
  end if;
  return new;
end;
$$;

create trigger feature_switches_routine_worker_activation
before update of mode on app.feature_switches
for each row execute function app.require_routine_telebirr_worker_at_activation();

-- An idle worker polls about once per second. Allow 90 seconds for transient
-- network delay; an already-open execution/reconciliation attempt can occupy the
-- serial worker, so use five minutes for that case. Stopping gates never clears
-- that durable attempt, retries a Transfer, or claims another job.
create function app.stop_stale_routine_telebirr_financial_gates()
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  live_count integer;
  max_age interval;
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator may stop stale routine gates.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  select pg_catalog.count(*)::integer into live_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
     and feature_switch.mode = 'live';
  if live_count = 0 then return false; end if;
  max_age := case when exists (
    select 1 from app.deposit_execution_attempts attempt
    join app.routine_telebirr_execution_bindings binding
      on binding.execution_job_id = attempt.deposit_job_id
    where attempt.status in (
      'prepared', 'final_action_fenced', 'reconciliation_required', 'review_required'
    )
  ) then interval '5 minutes' else interval '90 seconds' end;
  if app.routine_telebirr_signed_worker_recent(max_age) then return false; end if;
  return app.stop_routine_telebirr_financial_gates(
    pg_catalog.gen_random_uuid(), 'incident_stop');
end;
$$;

alter function app.routine_telebirr_signed_worker_recent(interval) owner to postgres;
alter function app.require_routine_telebirr_worker_at_activation() owner to postgres;
alter function app.stop_stale_routine_telebirr_financial_gates() owner to postgres;
revoke all on function
  app.routine_telebirr_signed_worker_recent(interval),
  app.require_routine_telebirr_worker_at_activation(),
  app.stop_stale_routine_telebirr_financial_gates()
from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_routine_telebirr_no_money_runtime,
  fetanagent_routine_telebirr_paid_poll_runtime,
  fetanagent_routine_telebirr_paid_settlement_runtime;

do $install_routine_worker_watchdog$
declare
  job_count integer;
begin
  if exists (
    select 1 from pg_catalog.pg_available_extensions extension
    where extension.name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';
    select pg_catalog.count(*)::integer into job_count from cron.job job
     where job.jobname = 'fetanagent-routine-worker-liveness-v1';
    if job_count <> 0 then
      raise exception 'A routine worker watchdog Cron job name already exists.';
    end if;
    perform cron.schedule(
      'fetanagent-routine-worker-liveness-v1', '15 seconds',
      'select app.stop_stale_routine_telebirr_financial_gates()'
    );
    select pg_catalog.count(*)::integer into job_count from cron.job job
     where job.jobname = 'fetanagent-routine-worker-liveness-v1'
       and job.active and job.username = 'postgres'
       and job.schedule = '15 seconds'
       and job.command = 'select app.stop_stale_routine_telebirr_financial_gates()';
    if job_count <> 1 then
      raise exception 'The routine worker watchdog Cron installation is incomplete.';
    end if;
  elsif pg_catalog.to_regclass('sql_integration.applied_migrations') is null then
    raise exception 'The production routine worker watchdog requires pg_cron.';
  end if;
end;
$install_routine_worker_watchdog$;

comment on function app.stop_stale_routine_telebirr_financial_gates() is
  'Independent postgres-only Cron stop for absent signed Windows credit-worker leases; preserves any fenced attempt for reconciliation.';
commit;
