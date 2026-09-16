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

select :'pilot_revision_id' ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  as deployment_binding_canonical
\gset
\if :deployment_binding_canonical
\else
  \warn 'The production TeleBirr shadow deployment binding is malformed.'
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
  \warn 'An active trusted TeleBirr epoch blocks a shadow-review runtime deployment.'
  select 1 / 0 as rejected;
\endif

select count(*) = 6 as financial_features_disabled
from app.feature_switches feature_switch
where feature_switch.feature_key in (
  'payment_verification',
  'deposit_execution',
  'withdrawal_validation',
  'withdrawal_collection',
  'cbe_birr_authoritative_verification',
  'telebirr_authoritative_verification'
)
  and feature_switch.mode = 'disabled'
  and feature_switch.settings = '{}'::jsonb
\gset
\if :financial_features_disabled
\else
  \warn 'Every production money and provider feature must remain disabled.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as exact_shadow_pilot
from app.private_live_deposit_pilot_revisions pilot
join app.feature_switches pilot_switch
  on pilot_switch.feature_key = 'private_live_deposit_pilot'
where pilot.id = :'pilot_revision_id'::uuid
  and pilot.status = 'armed'
  and pilot.configuration_digest is not null
  and pilot.active_from <= pg_catalog.clock_timestamp()
  and pilot.expires_at > pg_catalog.clock_timestamp() + interval '10 minutes'
  and pilot.minimum_amount_minor = 2500
  and pilot.maximum_per_deposit_minor = 2500
  and pilot.maximum_per_player_minor = 2500
  and pilot.maximum_aggregate_minor = 12500
  and pilot.maximum_reservation_count = 5
  and pilot_switch.mode = 'dry_run'
  and pilot_switch.settings = pg_catalog.jsonb_build_object(
    'contract_version', 1,
    'pilot_revision_id', pilot.id,
    'configuration_digest', pilot.configuration_digest
  )
\gset
\if :exact_shadow_pilot
\else
  \warn 'The exact fixed five-Player production dry-run pilot is unavailable.'
  select 1 / 0 as rejected;
\endif

select count(*) = 5 as exact_player_cohort
from app.private_live_deposit_pilot_players pilot_player
where pilot_player.pilot_revision_id = :'pilot_revision_id'::uuid
\gset
\if :exact_player_cohort
\else
  \warn 'The production shadow pilot does not contain exactly five Players.'
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

select count(*) = 1 as exact_runtime_binding
from app.private_live_deposit_pilot_revisions pilot
join app.feature_switches pilot_switch
  on pilot_switch.feature_key = 'private_live_deposit_pilot'
join app.private_live_deposit_pilot_providers pilot_provider
  on pilot_provider.pilot_revision_id = pilot.id
 and pilot_provider.provider_code_snapshot = 'telebirr'
join app.payment_providers provider
  on provider.id = pilot_provider.payment_provider_id
 and provider.code = 'telebirr'
 and provider.status = 'active'
join app.receiver_accounts receiver
  on receiver.id = pilot_provider.receiver_account_id
 and receiver.provider_id = pilot_provider.payment_provider_id
 and receiver.version = pilot_provider.receiver_account_version
 and receiver.status = 'active'
 and receiver.retired_at is null
join app.private_live_telebirr_receiver_profiles profile
  on profile.pilot_revision_id = pilot.id
 and profile.payment_provider_id = pilot_provider.payment_provider_id
 and profile.receiver_account_id = pilot_provider.receiver_account_id
 and profile.receiver_account_version = pilot_provider.receiver_account_version
 and profile.pilot_configuration_digest = pilot.configuration_digest
join app.private_live_telebirr_assignment_signers signer
  on signer.id = :'assignment_signer_id'::uuid
 and signer.signer_key_id = :'assignment_signer_key_id'
 and signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
left join app.private_live_telebirr_assignment_signer_revocations signer_revocation
  on signer_revocation.assignment_signer_id = signer.id
where pilot.id = :'pilot_revision_id'::uuid
  and pilot.status = 'armed'
  and pilot.active_from <= pg_catalog.clock_timestamp()
  and pilot.expires_at > pg_catalog.clock_timestamp() + interval '10 minutes'
  and pilot_switch.mode = 'dry_run'
  and pilot_switch.settings = pg_catalog.jsonb_build_object(
    'contract_version', 1,
    'pilot_revision_id', pilot.id,
    'configuration_digest', pilot.configuration_digest
  )
  and profile.provider_code = 'telebirr'
  and profile.valid_from <= pg_catalog.clock_timestamp()
  and profile.valid_until > pg_catalog.clock_timestamp() + interval '10 minutes'
  and profile.receiver_name_normalizer_version = 'telebirr-credited-party-name-normalizer-v1'
  and profile.receiver_identity_digest = profile.expected_receiver_name_digest
  and receiver.account_holder_name = pilot_provider.receiver_account_holder_name_snapshot
  and receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
  and receiver.account_reference_masked ~ '^[*][*][*][0-9]{4}$'
  and receiver.protection_profile_version = 1
  and receiver.encryption_key_version = 1
  and receiver.fingerprint_key_version = 1
  and signer.valid_from <= pg_catalog.clock_timestamp()
  and signer.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
  and signer_revocation.assignment_signer_id is null
\gset
\if :exact_runtime_binding
\else
  \warn 'The production shadow pilot receiver and assignment signer binding is not exact.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as exact_current_device
from app.private_live_telebirr_device_enrollments enrollment
join app.private_live_telebirr_device_enrollment_certificates certificate
  on certificate.device_enrollment_id = enrollment.id
left join app.private_live_telebirr_device_revocations revocation
  on revocation.device_enrollment_id = enrollment.id
where enrollment.pilot_revision_id = :'pilot_revision_id'::uuid
  and enrollment.valid_from <= pg_catalog.clock_timestamp()
  and enrollment.valid_until > pg_catalog.clock_timestamp() + interval '10 minutes'
  and revocation.device_enrollment_id is null
\gset
\if :exact_current_device
\else
  \warn 'Exactly one current production TeleBirr verifier device is required.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

select pg_catalog.json_build_object(
  'schemaVersion', 1,
  'pilotRevisionId', pilot.id,
  'receiverRevisionId', profile.receiver_account_id,
  'receiverProfileId', profile.id,
  'receiverProfileDigest', profile.receiver_profile_digest,
  'receiverConfigurationDigest', profile.receiver_configuration_digest,
  'receiverNameNormalizerVersion', profile.receiver_name_normalizer_version,
  'expectedReceiverNameDigest', profile.expected_receiver_name_digest,
  'receiverAccountHolderNameSnapshot', pilot_provider.receiver_account_holder_name_snapshot,
  'assignmentSignerId', signer.id,
  'assignmentSignerKeyId', signer.signer_key_id,
  'assignmentSignerPublicKeySpkiSha256', signer.public_key_spki_sha256
)::text
from app.private_live_deposit_pilot_revisions pilot
join app.private_live_deposit_pilot_providers pilot_provider
  on pilot_provider.pilot_revision_id = pilot.id
 and pilot_provider.provider_code_snapshot = 'telebirr'
join app.private_live_telebirr_receiver_profiles profile
  on profile.pilot_revision_id = pilot.id
 and profile.payment_provider_id = pilot_provider.payment_provider_id
 and profile.receiver_account_id = pilot_provider.receiver_account_id
 and profile.receiver_account_version = pilot_provider.receiver_account_version
 and profile.pilot_configuration_digest = pilot.configuration_digest
join app.private_live_telebirr_assignment_signers signer
  on signer.id = :'assignment_signer_id'::uuid
 and signer.signer_key_id = :'assignment_signer_key_id'
 and signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
where pilot.id = :'pilot_revision_id'::uuid;

rollback;
