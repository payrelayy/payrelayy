\set ON_ERROR_STOP on

begin transaction isolation level serializable read only;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '10s';

select current_user = 'postgres' and session_user = 'postgres'
  as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The production administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select not exists (
  select 1
  from app.private_trusted_telebirr_activation_control activation_control
  join app.private_trusted_telebirr_activation_epochs authority
    on authority.epoch = activation_control.current_epoch
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = authority.pilot_revision_id
  where activation_control.control_key = 'trusted_telebirr_financial_authority'
    and authority.authority_state = 'active'
    and authority.revoked_at is null
    and authority.active_from <= pg_catalog.clock_timestamp()
    and authority.expires_at > pg_catalog.clock_timestamp()
    and pilot.status = 'armed'
    and pilot.configuration_digest = authority.configuration_digest
    and pilot.active_from = authority.active_from
    and pilot.expires_at = authority.expires_at
    and not exists (
      select 1
      from app.private_trusted_telebirr_emergency_disable_intents emergency_intent
      where emergency_intent.expected_epoch = authority.epoch
    )
) as trusted_telebirr_authority_absent
\gset
\if :trusted_telebirr_authority_absent
\else
  \warn 'An active trusted TeleBirr epoch blocks an inert runtime deployment.'
  select 1 / 0 as rejected;
\endif

select count(*) = 7 as exact_inert_feature_switches
from app.feature_switches feature_switch
where (
    feature_switch.feature_key in (
      'cbe_birr_authoritative_verification',
      'deposit_execution',
      'payment_verification',
      'telebirr_authoritative_verification',
      'withdrawal_collection',
      'withdrawal_validation'
    )
    and feature_switch.mode = 'disabled'
    and feature_switch.settings = '{}'::jsonb
  )
  or (
    feature_switch.feature_key = 'private_live_deposit_pilot'
    and feature_switch.mode in ('disabled', 'dry_run')
  )
\gset
\if :exact_inert_feature_switches
\else
  \warn 'The complete inert production feature-switch boundary is unavailable.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as companion_execution_disabled
from app.agent_platform_companion_execution_control execution_control
where execution_control.singleton
  and execution_control.control_state = 'disabled'
  and execution_control.certificate_id is null
  and execution_control.device_id is null
  and execution_control.device_key_id is null
  and execution_control.no_money_signer_key_id is null
  and execution_control.execution_signer_key_id is null
  and execution_control.execution_signer_public_key_spki is null
  and execution_control.execution_signer_public_key_spki_sha256 is null
  and execution_control.platform_agent_account_id is null
  and execution_control.pilot_revision_id is null
  and execution_control.pilot_revision is null
  and execution_control.pilot_configuration_digest is null
  and execution_control.activation_epoch is null
  and execution_control.active_from is null
  and execution_control.expires_at is null
  and execution_control.activated_by_admin_id is null
  and execution_control.activated_at is null
  and execution_control.disabled_at is null
  and execution_control.disable_reason_code is null
\gset
\if :companion_execution_disabled
\else
  \warn 'The companion execution authority is not exactly disabled.'
  select 1 / 0 as rejected;
\endif

select count(*) = 2 and not pg_catalog.bool_or(role.rolcanlogin)
  as financial_runtime_logins_disabled
from pg_catalog.pg_roles role
where role.rolname in (
  'fetanagent_trusted_telebirr_verifier_runtime',
  'fetanagent_deposit_executor_runtime'
)
\gset
\if :financial_runtime_logins_disabled
\else
  \warn 'A production financial runtime login is available.'
  select 1 / 0 as rejected;
\endif

select count(*) = 0 as financial_runtime_sessions_absent
from pg_catalog.pg_stat_activity activity
where activity.usename in (
  'fetanagent_trusted_telebirr_verifier_runtime',
  'fetanagent_deposit_executor_runtime'
)
  and activity.pid <> pg_catalog.pg_backend_pid()
\gset
\if :financial_runtime_sessions_absent
\else
  \warn 'A production financial runtime session is still present.'
  select 1 / 0 as rejected;
\endif

rollback;
