-- Read-only, aggregate-only preflight for the 18 October 2026 staging catch-up snapshot.
-- Run against the exact staging project before any Owner pilot stop or migration apply.
-- A matching snapshot is evidence for review, never authorization to change a switch or apply SQL.
with snapshot as (
  select
    (select pg_catalog.count(*)::integer
       from supabase_migrations.schema_migrations) as applied_migrations,
    (select pg_catalog.max(version)
       from supabase_migrations.schema_migrations) as latest_applied_version,
    (select pg_catalog.count(*)::integer
       from supabase_migrations.schema_migrations
      where version in (
        '20260912233000', '20260914030000',
        '20260914123000', '20260914165043'
      )) as older_gaps_applied,
    (select pg_catalog.count(*)::integer from app.feature_switches) as financial_switches,
    (select pg_catalog.count(*)::integer
       from app.feature_switches
      where feature_key <> 'private_live_deposit_pilot'
        and mode = 'disabled'
        and settings = '{}'::jsonb) as other_disabled_switches,
    (select pg_catalog.count(*)::integer
       from app.feature_switches
      where feature_key = 'private_live_deposit_pilot'
        and mode = 'dry_run'
        and settings <> '{}'::jsonb) as pilot_dry_run_switches,
    (select pg_catalog.count(*)::integer
       from app.private_live_deposit_pilot_revisions
      where status = 'armed'
        and expires_at <= pg_catalog.clock_timestamp()) as expired_armed_pilots,
    (select pg_catalog.count(*)::integer
       from app.private_live_deposit_pilot_reservations) as pilot_reservations,
    (app.current_private_trusted_telebirr_activation_epoch() is null)
      as activation_epoch_inactive,
    (select pg_catalog.count(*)::integer
       from app.deposit_intents intent
       join app.payment_providers provider on provider.id = intent.payment_provider_id
      where provider.code = 'cbe_birr') as cbe_intents,
    (select pg_catalog.count(*)::integer
       from app.deposit_intents intent
       join app.payment_providers provider on provider.id = intent.payment_provider_id
      where provider.code = 'cbe_birr' and intent.status = 'intake_received')
      as cbe_intake_received_intents,
    (select pg_catalog.count(*)::integer
       from app.deposit_submissions submission
       join app.deposit_intents intent on intent.id = submission.deposit_intent_id
       join app.payment_providers provider on provider.id = intent.payment_provider_id
      where provider.code = 'cbe_birr') as cbe_submissions,
    (select pg_catalog.count(*)::integer
       from app.deposit_submissions submission
       join app.deposit_intents intent on intent.id = submission.deposit_intent_id
       join app.payment_providers provider on provider.id = intent.payment_provider_id
      where provider.code = 'cbe_birr' and submission.status = 'received')
      as cbe_received_submissions,
    (select pg_catalog.count(*)::integer from app.deposit_jobs) as deposit_jobs,
    (select pg_catalog.count(*)::integer
       from app.deposit_execution_attempts) as execution_attempts,
    (select pg_catalog.count(*)::integer
       from app.receiver_accounts receiver
       join app.payment_providers provider on provider.id = receiver.provider_id
      where provider.code = 'cbe_birr' and receiver.status = 'active'
        and receiver.protection_profile_version = 1) as active_cbe_v1_receivers,
    (
      pg_catalog.to_regclass('app.agent_platform_companion_execution_control') is null
      and pg_catalog.to_regclass('app.agent_platform_companion_execution_http_requests') is null
      and pg_catalog.to_regclass('app.agent_platform_companion_execution_assignments') is null
      and pg_catalog.to_regclass('app.agent_platform_companion_execution_statuses') is null
      and not exists (
        select 1 from pg_catalog.pg_roles
         where rolname = 'fetanagent_companion_execution_bridge'
      )
    ) as older_gap_objects_absent,
    (
      pg_catalog.to_regprocedure('app.require_telebirr_device_state_session()') is not null
      and pg_catalog.to_regprocedure(
        'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)'
      ) is not null
    ) as older_gap_dependencies_present
)
select snapshot.*,
       (
         applied_migrations = 87
         and latest_applied_version = '20260915190000'
         and older_gaps_applied = 0
         and financial_switches = 7
         and other_disabled_switches = 6
         and pilot_dry_run_switches = 1
         and expired_armed_pilots = 1
         and pilot_reservations = 0
         and activation_epoch_inactive
         and cbe_intents = 3
         and cbe_intake_received_intents = 3
         and cbe_submissions = 2
         and cbe_received_submissions = 2
         and deposit_jobs = 0
         and execution_attempts = 0
         and active_cbe_v1_receivers = 1
         and older_gap_objects_absent
         and older_gap_dependencies_present
       ) as matches_reviewed_pre_stop_snapshot
  from snapshot;
