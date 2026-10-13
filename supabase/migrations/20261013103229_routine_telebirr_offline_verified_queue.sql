-- A missing Windows Companion must not turn off paid TeleBirr verification.
-- Verified receipts are already committed with a one-shot queued execution job;
-- the signed broker cannot claim one while the worker is absent. An uncertain
-- final action remains fenced for reconciliation before any later job.
-- Install only with financial gates off. This migration never turns them on.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
declare
  v_old_job_count integer;
  v_old_function oid;
begin
  if (
    select pg_catalog.count(*) from app.feature_switches switch
    where switch.feature_key in ('payment_verification', 'deposit_execution')
      and switch.mode = 'disabled' and switch.settings = '{}'::jsonb
  ) <> 2 then
    raise exception 'Install the offline verified queue only while the two financial gates are off.';
  end if;
  select routine.oid into v_old_function from pg_catalog.pg_proc routine
   where routine.oid =
     'app.stop_stale_routine_telebirr_financial_gates()'::pg_catalog.regprocedure
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and not routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if v_old_function is null then
    raise exception 'The reviewed routine worker watchdog is unavailable.';
  end if;
  if pg_catalog.to_regclass('cron.job') is not null then
    execute $job$
      select pg_catalog.count(*)::integer from cron.job job
       where job.jobname = 'fetanagent-routine-worker-liveness-v1'
         and job.active and job.username = 'postgres'
         and job.schedule = '15 seconds'
         and job.command = 'select app.stop_stale_routine_telebirr_financial_gates()'
    $job$ into v_old_job_count;
    if v_old_job_count <> 1 then
      raise exception 'The reviewed routine worker watchdog job is unavailable.';
    end if;
  elsif pg_catalog.to_regclass('sql_integration.applied_migrations') is null then
    raise exception 'The production routine worker watchdog requires pg_cron.';
  end if;
end;
$preflight$;

-- Keep a heartbeat probe for operations and for the activation preflight, but
-- no longer give the probe permission to stop paid intake. Explicit Owner and
-- incident stops remain available through the separate guarded stop command.
create function app.observe_routine_telebirr_worker_liveness()
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator may observe routine worker liveness.';
  end if;
  return app.routine_telebirr_signed_worker_recent(interval '90 seconds');
end;
$$;
alter function app.observe_routine_telebirr_worker_liveness() owner to postgres;
revoke all on function app.observe_routine_telebirr_worker_liveness()
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_routine_telebirr_paid_poll_runtime,
    fetanagent_routine_telebirr_paid_settlement_runtime;

do $replace_activation_preflight$
declare
  v_function oid := 'app.require_routine_telebirr_worker_at_activation()'
    ::pg_catalog.regprocedure;
  v_source text;
  v_definition text;
  v_old constant text := 'select app.stop_stale_routine_telebirr_financial_gates()';
  v_new constant text := 'select app.observe_routine_telebirr_worker_liveness()';
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into v_source, v_definition
    from pg_catalog.pg_proc routine
   where routine.oid = v_function
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if v_source is null
    or (pg_catalog.length(v_source) - pg_catalog.length(
      pg_catalog.replace(v_source, v_old, ''))) <> pg_catalog.length(v_old)
    or pg_catalog.strpos(v_source,
      'app.routine_telebirr_signed_worker_recent(interval ''45 seconds'')') = 0
    or pg_catalog.strpos(v_source,
      'fetanagent-routine-worker-liveness-v1') = 0 then
    raise exception 'The reviewed routine activation preflight has changed.';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
  if (select routine.prosrc from pg_catalog.pg_proc routine
      where routine.oid = v_function)
       is distinct from pg_catalog.replace(v_source, v_old, v_new) then
    raise exception 'The routine activation preflight replacement is incomplete.';
  end if;
end;
$replace_activation_preflight$;

do $replace_watchdog_job$
declare
  v_job_id bigint;
  v_job_count integer;
begin
  if pg_catalog.to_regclass('cron.job') is null then return; end if;
  select job.jobid into v_job_id from cron.job job
   where job.jobname = 'fetanagent-routine-worker-liveness-v1'
     and job.active and job.username = 'postgres'
     and job.schedule = '15 seconds'
     and job.command = 'select app.stop_stale_routine_telebirr_financial_gates()';
  if v_job_id is null then
    raise exception 'The routine worker watchdog job changed during migration.';
  end if;
  perform cron.alter_job(
    job_id := v_job_id,
    command := 'select app.observe_routine_telebirr_worker_liveness()'
  );
  select pg_catalog.count(*)::integer into v_job_count from cron.job job
   where job.jobid = v_job_id
     and job.jobname = 'fetanagent-routine-worker-liveness-v1'
     and job.active and job.username = 'postgres'
     and job.schedule = '15 seconds'
     and job.command = 'select app.observe_routine_telebirr_worker_liveness()';
  if v_job_count <> 1 then
    raise exception 'The routine worker liveness probe is incomplete.';
  end if;
end;
$replace_watchdog_job$;

drop function app.stop_stale_routine_telebirr_financial_gates();

comment on function app.observe_routine_telebirr_worker_liveness() is
  'Read-only postgres Cron probe: an absent Companion leaves verified TeleBirr payments queued and never changes a financial switch.';
commit;
