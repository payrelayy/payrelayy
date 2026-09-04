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

select count(*) = 7
    and pg_catalog.bool_and(feature_switch.mode = 'disabled')
  as financial_features_disabled
from app.feature_switches as feature_switch
where feature_switch.feature_key in (
  'payment_verification',
  'deposit_execution',
  'withdrawal_validation',
  'withdrawal_collection',
  'cbe_birr_authoritative_verification',
  'telebirr_authoritative_verification',
  'private_live_deposit_pilot'
)
\gset
\if :financial_features_disabled
\else
  \warn 'Every financial and provider feature must remain disabled.'
  select 1 / 0 as rejected;
\endif

select count(*) = 0 as no_open_pilot
from app.private_live_deposit_pilot_revisions as pilot
where pilot.status in ('draft', 'armed')
\gset
\if :no_open_pilot
\else
  \warn 'The trust-only signer inspection requires no draft or armed pilot.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1
    and pg_catalog.bool_and(
      signer.id = :'assignment_signer_id'::uuid
      and signer.signer_key_id = :'assignment_signer_key_id'
      and signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
      and signer.signature_algorithm = 'ecdsa-p256-sha256'
      and signer.signature_encoding = 'ieee-p1363-base64url'
      and signer.valid_from = :'assignment_signer_valid_from'::timestamptz
      and signer.valid_until = :'assignment_signer_valid_until'::timestamptz
      and signer.valid_from <= pg_catalog.clock_timestamp()
      and signer.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
      and revocation.assignment_signer_id is null
    ) as signer_active_unrevoked
from app.private_live_telebirr_assignment_signers as signer
left join app.private_live_telebirr_assignment_signer_revocations as revocation
  on revocation.assignment_signer_id = signer.id
where signer.id = :'assignment_signer_id'::uuid
   or signer.signer_key_id = :'assignment_signer_key_id'
   or signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
\gset
\if :signer_active_unrevoked
\else
  \warn 'The reviewed assignment signer is absent, conflicting, expired, or revoked.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'inspect_only',
  'assignmentSigner', 'active_unrevoked',
  'financialFeatures', 'disabled',
  'openPilot', 'absent'
)::text;

rollback;
