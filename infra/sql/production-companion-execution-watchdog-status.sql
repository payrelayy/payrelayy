-- Read-only, redacted production installation check. Run only with the
-- production administrator in a read-only transaction after migration release.
begin transaction read only;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

select pg_catalog.jsonb_build_object(
  'readOnly', true,
  'identifiersRedacted', true,
  'adminSessionExact', session_user = 'postgres' and current_user = 'postgres',
  'cronInstalled', exists (
    select 1 from pg_catalog.pg_extension extension
     where extension.extname = 'pg_cron'
  ),
  'watchdogJobsExact', (
    select pg_catalog.count(*) = 3
      from cron.job job
     where job.jobname in (
       'fetanagent-companion-watchdog-credentials-v1',
       'fetanagent-companion-watchdog-sessions-v1',
       'fetanagent-companion-watchdog-financial-v1'
     ) and job.active and job.username = 'postgres'
       and job.schedule = '15 seconds'
       and job.command in (
         'select app.watchdog_fence_companion_execution_credentials()',
         'select app.watchdog_drain_companion_execution_sessions()',
         'select app.watchdog_fence_companion_execution_financial_authority()'
       )
  ),
  'recentSuccessfulJobs', (
    select pg_catalog.count(*)
      from (
        select distinct on (job.jobname)
          job.jobname, run.status, run.end_time
          from cron.job job
          join cron.job_run_details run on run.jobid = job.jobid
         where job.jobname in (
           'fetanagent-companion-watchdog-credentials-v1',
           'fetanagent-companion-watchdog-sessions-v1',
           'fetanagent-companion-watchdog-financial-v1'
         )
         order by job.jobname, run.start_time desc
      ) recent
     where recent.status = 'succeeded'
       and recent.end_time >= pg_catalog.clock_timestamp() - interval '2 minutes'
  ),
  'companionControlDisabled', (
    select control.control_state = 'disabled'
      from app.agent_platform_companion_execution_control control
     where control.singleton
  ),
  'executionRolesDormant', (
    select pg_catalog.count(*) = 2
      from pg_catalog.pg_authid role
     where role.rolname in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     ) and not role.rolcanlogin and role.rolpassword is null
  ),
  'executionSessionsZero', not exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     )
  ),
  'noLiveFinancialSwitch', not exists (
    select 1 from app.feature_switches switch
     where switch.feature_key in (
       'cbe_birr_authoritative_verification', 'deposit_execution',
       'payment_verification', 'private_live_deposit_pilot',
       'telebirr_authoritative_verification', 'withdrawal_collection',
       'withdrawal_validation'
     ) and switch.mode = 'live'
  ),
  'activeLeaseCount', (
    select pg_catalog.count(*)
      from app.agent_platform_companion_execution_watchdog_leases lease
     where lease.lease_expires_at > pg_catalog.clock_timestamp()
  )
)::text;

commit;
