-- Read-only gate for the exact reviewed staging catch-up starting ledger.
-- This observation does not authorize migration apply.
with snapshot as (
  select
    (select pg_catalog.count(*)::integer
       from supabase_migrations.schema_migrations) as applied_migrations,
    (select pg_catalog.max(version)
       from supabase_migrations.schema_migrations) as latest_applied_version,
    (select pg_catalog.encode(
              extensions.digest(pg_catalog.string_agg(version, E'\n' order by version), 'sha256'),
              'hex')
       from supabase_migrations.schema_migrations) as ledger_sha256,
    (select pg_catalog.count(*)::integer
       from supabase_migrations.schema_migrations
      where version in (
        '20260912233000', '20260914030000',
        '20260914123000', '20260914165043'
      )) as older_gaps_applied,
    (select pg_catalog.count(*)::integer from app.feature_switches) as financial_switches,
    (select pg_catalog.count(*)::integer
       from app.feature_switches
      where mode = 'disabled' and settings = '{}'::jsonb) as disabled_switches,
    (select pg_catalog.count(*)::integer
       from app.private_live_deposit_pilot_revisions
      where status = 'armed') as armed_pilots,
    (select pg_catalog.count(*)::integer
       from app.private_live_deposit_pilot_revisions
      where id = 'c833aa88-b315-404b-b86d-ac40ec79c50a'::uuid
        and status = 'stopped'
        and stop_reason_code = 'owner_stop'
        and stopped_at is not null) as exact_owner_stopped_pilots,
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
    (select pg_catalog.count(*)::integer
       from app.audit_events
      where action = 'deposit.private_live_pilot_stopped'
        and resource_id = 'c833aa88-b315-404b-b86d-ac40ec79c50a'::uuid
        and metadata->>'reason_code' = 'owner_stop') as matching_stop_audits,
    (select not role.rolcanlogin and role.rolvaliduntil < pg_catalog.now()
       from pg_catalog.pg_roles role
      where role.rolname = 'fetanagent_telebirr_shadow_verifier_runtime')
      as expired_shadow_role_locked,
    (select pg_catalog.count(*)::integer
       from pg_catalog.pg_stat_activity activity
      where activity.usename = 'fetanagent_telebirr_shadow_verifier_runtime')
      as shadow_role_sessions
)
select snapshot.*,
       (
         applied_migrations = 87
         and latest_applied_version = '20260915190000'
         and ledger_sha256 = 'e8299d777d05872f1cc6f2588ca3ca1d2eb15fe2c2e419970e63701149d74427'
         and older_gaps_applied = 0
         and financial_switches = 7
         and disabled_switches = 7
         and armed_pilots = 0
         and exact_owner_stopped_pilots = 1
         and pilot_reservations = 0
         and activation_epoch_inactive
         and cbe_intents = 3
         and cbe_intake_received_intents = 3
         and cbe_submissions = 2
         and cbe_received_submissions = 2
         and deposit_jobs = 0
         and execution_attempts = 0
         and active_cbe_v1_receivers = 1
         and matching_stop_audits = 1
         and expired_shadow_role_locked
         and shadow_role_sessions = 0
       ) as matches_reviewed_catch_up_start
  from snapshot;
