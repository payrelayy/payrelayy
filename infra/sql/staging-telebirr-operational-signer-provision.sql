\set ON_ERROR_STOP on

begin transaction isolation level serializable;
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

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:telebirr-operational-signer', 0)
);

with locked_feature_switches as materialized (
  select feature_switch.feature_key,
         feature_switch.mode
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
   for update
)
select count(*) = 7
    and pg_catalog.bool_and(locked_feature_switches.mode = 'disabled')
  as financial_features_disabled
from locked_feature_switches
\gset
\if :financial_features_disabled
\else
  \warn 'Every financial and provider feature must remain disabled.'
  select 1 / 0 as rejected;
\endif

with open_pilots as materialized (
  select pilot.id
    from app.private_live_deposit_pilot_revisions as pilot
   where pilot.status in ('draft', 'armed')
   for update
)
select count(*) = 0 as no_open_pilot
from open_pilots
\gset
\if :no_open_pilot
\else
  \warn 'Operational signer provisioning requires no draft or armed pilot.'
  select 1 / 0 as rejected;
\endif

select :'assignment_signer_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and :'assignment_signer_id' = (:'assignment_signer_id'::uuid)::text
    and :'assignment_signer_key_id' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    and :'assignment_signer_public_spki_sha256' ~ '^sha256:[0-9a-f]{64}$'
    and :'assignment_signer_valid_from'
      = pg_catalog.to_char(
          :'assignment_signer_valid_from'::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
    and :'assignment_signer_valid_until'
      = pg_catalog.to_char(
          :'assignment_signer_valid_until'::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
    and :'assignment_signer_valid_until'::timestamptz
      - :'assignment_signer_valid_from'::timestamptz between interval '700 days' and interval '740 days'
  as signer_inputs_canonical
\gset
\if :signer_inputs_canonical
\else
  \warn 'The assignment signer inputs are not canonical or bounded.'
  select 1 / 0 as rejected;
\endif

with related_signers as materialized (
  select signer.id
    from app.private_live_telebirr_assignment_signers as signer
   where signer.id = :'assignment_signer_id'::uuid
      or signer.signer_key_id = :'assignment_signer_key_id'
      or signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
   for key share
)
select count(*) = 0 as no_related_signer
from related_signers
\gset

\if :no_related_signer
  select :'assignment_signer_valid_from'::timestamptz
        between pg_catalog.clock_timestamp() - interval '7 days'
            and pg_catalog.clock_timestamp() + interval '5 minutes'
      and :'assignment_signer_valid_until'::timestamptz
        between pg_catalog.clock_timestamp() + interval '700 days'
            and pg_catalog.clock_timestamp() + interval '740 days'
    as new_signer_window_safe
  \gset
  \if :new_signer_window_safe
  \else
    \warn 'A new assignment signer must use a current, bounded validity window.'
    select 1 / 0 as rejected;
  \endif

  insert into app.private_live_telebirr_assignment_signers (
    id,
    signer_key_id,
    public_key_spki_sha256,
    signature_algorithm,
    signature_encoding,
    valid_from,
    valid_until
  ) values (
    :'assignment_signer_id'::uuid,
    :'assignment_signer_key_id',
    :'assignment_signer_public_spki_sha256',
    'ecdsa-p256-sha256',
    'ieee-p1363-base64url',
    :'assignment_signer_valid_from'::timestamptz,
    :'assignment_signer_valid_until'::timestamptz
  );
\else
  select count(*) = 1
      and pg_catalog.bool_and(
        signer.id = :'assignment_signer_id'::uuid
        and signer.signer_key_id = :'assignment_signer_key_id'
        and signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
        and signer.signature_algorithm = 'ecdsa-p256-sha256'
        and signer.signature_encoding = 'ieee-p1363-base64url'
        and signer.valid_from = :'assignment_signer_valid_from'::timestamptz
        and signer.valid_until = :'assignment_signer_valid_until'::timestamptz
        and signer.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
      ) as exact_safe_replay
    from app.private_live_telebirr_assignment_signers as signer
   where signer.id = :'assignment_signer_id'::uuid
      or signer.signer_key_id = :'assignment_signer_key_id'
      or signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
  \gset
  \if :exact_safe_replay
  \else
    \warn 'Existing assignment signer material conflicts with the requested immutable binding.'
    select 1 / 0 as rejected;
  \endif
\endif

select count(*) = 1
    and pg_catalog.bool_and(
      signer.valid_from <= pg_catalog.clock_timestamp()
      and signer.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
      and revocation.assignment_signer_id is null
    ) as signer_active_unrevoked
from app.private_live_telebirr_assignment_signers as signer
left join app.private_live_telebirr_assignment_signer_revocations as revocation
  on revocation.assignment_signer_id = signer.id
where signer.id = :'assignment_signer_id'::uuid
  and signer.signer_key_id = :'assignment_signer_key_id'
  and signer.public_key_spki_sha256 = :'assignment_signer_public_spki_sha256'
\gset
\if :signer_active_unrevoked
\else
  \warn 'The assignment signer postcondition is not active and unrevoked.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'trust_only',
  'assignmentSigner', 'active_unrevoked',
  'financialFeatures', 'disabled',
  'openPilot', 'absent'
)::text;

commit;
