-- A newly scheduled pg_cron run can be present as `connecting` with a NULL
-- start_time. PostgreSQL sorts NULL first for DESC, so the old activation
-- trigger could ignore a fresh successful run and fail closed at random.
do $guard$
begin
  if pg_catalog.to_regprocedure('app.require_routine_telebirr_worker_at_activation()') is null
    or pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'app.require_routine_telebirr_worker_at_activation()'::pg_catalog.regprocedure
      ),
      'order by run.start_time desc limit 1'
    ) = 0 then
    raise exception 'The routine worker activation trigger changed; review before patching.';
  end if;
end;
$guard$;

create or replace function app.require_routine_telebirr_worker_at_activation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
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
      and job.command = 'select app.observe_routine_telebirr_worker_liveness()'
  $job$ into job_count;
  execute $run$
    select pg_catalog.count(*)::integer from (
      select run.status, run.end_time
      from cron.job job
      join cron.job_run_details run on run.jobid = job.jobid
      where job.jobname = 'fetanagent-routine-worker-liveness-v1'
        and run.end_time is not null
      order by run.end_time desc, run.runid desc limit 1
    ) recent
    where recent.status = 'succeeded'
      and recent.end_time >= pg_catalog.clock_timestamp() - interval '2 minutes'
  $run$ into successful_run_count;
  if job_count <> 1 or successful_run_count <> 1 then
    raise exception 'The independent routine worker watchdog is not running.';
  end if;
  return new;
end;
$function$;
