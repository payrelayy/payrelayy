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
  \warn 'The staging administrator session identity is not exact.'
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
  \warn 'Every real-money and provider feature must remain disabled.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as one_armed_pilot
from app.private_live_deposit_pilot_revisions pilot
join app.feature_switches pilot_switch
  on pilot_switch.feature_key = 'private_live_deposit_pilot'
where pilot.status = 'armed'
  and pilot.configuration_digest is not null
  and pilot.active_from <= pg_catalog.clock_timestamp()
  and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
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
\if :one_armed_pilot
\else
  \warn 'Exactly one current fixed five-Player dry-run pilot is required.'
  select 1 / 0 as rejected;
\endif

select count(*) = 5 as exact_player_cohort
from app.private_live_deposit_pilot_players pilot_player
join app.private_live_deposit_pilot_revisions pilot
  on pilot.id = pilot_player.pilot_revision_id
where pilot.status = 'armed'
\gset
\if :exact_player_cohort
\else
  \warn 'The armed pilot does not contain exactly five Players.'
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
left join app.private_live_telebirr_assignment_signer_revocations revocation
  on revocation.assignment_signer_id = signer.id
where pilot.status = 'armed'
  and pilot.active_from <= pg_catalog.clock_timestamp()
  and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  and pilot_switch.mode = 'dry_run'
  and pilot_switch.settings = pg_catalog.jsonb_build_object(
    'contract_version', 1,
    'pilot_revision_id', pilot.id,
    'configuration_digest', pilot.configuration_digest
  )
  and profile.provider_code = 'telebirr'
  and profile.valid_from <= pg_catalog.clock_timestamp()
  and profile.valid_until > pg_catalog.clock_timestamp() + interval '5 minutes'
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
  and revocation.assignment_signer_id is null
\gset
\if :exact_runtime_binding
\else
  \warn 'The armed pilot receiver and signer binding is not exact.'
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
where pilot.status = 'armed'
  and pilot.active_from <= pg_catalog.clock_timestamp()
  and pilot.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes';

rollback;
