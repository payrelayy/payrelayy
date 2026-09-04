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
  pg_catalog.hashtextextended('fetanagent:staging:companion-server-signer:v1', 0)
);

with locked_feature_switches as materialized (
  select feature_switch.feature_key, feature_switch.mode
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
    and pg_catalog.bool_and(
      case
        when locked_feature_switches.feature_key = 'private_live_deposit_pilot'
          then locked_feature_switches.mode in ('disabled', 'dry_run')
        else locked_feature_switches.mode = 'disabled'
      end
    ) as financial_features_safe
from locked_feature_switches
\gset
\if :financial_features_safe
\else
  \warn 'Financial/provider features must remain disabled; only a dry-run pilot may coexist.'
  select 1 / 0 as rejected;
\endif

select :'companion_signer_id'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and :'companion_signer_id' = (:'companion_signer_id'::uuid)::text
    and :'companion_signer_key_id' = 'companion-server-staging-v1'
    and :'companion_signer_public_spki' ~ '^[A-Za-z0-9_-]{122}$'
    and :'companion_signer_public_spki_sha256' ~ '^sha256:[0-9a-f]{64}$'
    and app.agent_platform_companion_public_key_digest(:'companion_signer_public_spki')
      = :'companion_signer_public_spki_sha256'
    and :'companion_signer_valid_from'
      = pg_catalog.to_char(
          :'companion_signer_valid_from'::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
    and :'companion_signer_valid_until'
      = pg_catalog.to_char(
          :'companion_signer_valid_until'::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
    and :'companion_signer_valid_until'::timestamptz
      - :'companion_signer_valid_from'::timestamptz between interval '700 days' and interval '740 days'
  as signer_inputs_canonical
\gset
\if :signer_inputs_canonical
\else
  \warn 'The companion signer inputs are not canonical, matching, or bounded.'
  select 1 / 0 as rejected;
\endif

with related_signers as materialized (
  select signer.id
    from app.agent_platform_companion_server_signers as signer
   where signer.id = :'companion_signer_id'::uuid
      or signer.signer_key_id = :'companion_signer_key_id'
      or signer.public_key_spki = :'companion_signer_public_spki'
      or signer.public_key_spki_sha256 = :'companion_signer_public_spki_sha256'
   for key share
)
select count(*) = 0 as no_related_signer
from related_signers
\gset

\if :no_related_signer
  select :'companion_signer_valid_from'::timestamptz
        between pg_catalog.clock_timestamp() - interval '7 days'
            and pg_catalog.clock_timestamp() + interval '5 minutes'
      and :'companion_signer_valid_until'::timestamptz
        between pg_catalog.clock_timestamp() + interval '700 days'
            and pg_catalog.clock_timestamp() + interval '740 days'
    as new_signer_window_safe
  \gset
  \if :new_signer_window_safe
  \else
    \warn 'A new companion signer must use a current bounded validity window.'
    select 1 / 0 as rejected;
  \endif

  insert into app.agent_platform_companion_server_signers (
    id,
    signer_key_id,
    public_key_spki,
    public_key_spki_sha256,
    signature_algorithm,
    signature_encoding,
    valid_from,
    valid_until
  ) values (
    :'companion_signer_id'::uuid,
    :'companion_signer_key_id',
    :'companion_signer_public_spki',
    :'companion_signer_public_spki_sha256',
    'ecdsa-p256-sha256',
    'ieee-p1363-base64url',
    :'companion_signer_valid_from'::timestamptz,
    :'companion_signer_valid_until'::timestamptz
  );
\else
  select count(*) = 1
      and pg_catalog.bool_and(
        signer.id = :'companion_signer_id'::uuid
        and signer.signer_key_id = :'companion_signer_key_id'
        and signer.public_key_spki = :'companion_signer_public_spki'
        and signer.public_key_spki_sha256 = :'companion_signer_public_spki_sha256'
        and signer.signature_algorithm = 'ecdsa-p256-sha256'
        and signer.signature_encoding = 'ieee-p1363-base64url'
        and signer.valid_from = :'companion_signer_valid_from'::timestamptz
        and signer.valid_until = :'companion_signer_valid_until'::timestamptz
        and signer.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
      ) as exact_safe_replay
    from app.agent_platform_companion_server_signers as signer
   where signer.id = :'companion_signer_id'::uuid
      or signer.signer_key_id = :'companion_signer_key_id'
      or signer.public_key_spki = :'companion_signer_public_spki'
      or signer.public_key_spki_sha256 = :'companion_signer_public_spki_sha256'
  \gset
  \if :exact_safe_replay
  \else
    \warn 'Existing companion signer material conflicts with the requested immutable binding.'
    select 1 / 0 as rejected;
  \endif
\endif

select count(*) = 1
    and pg_catalog.bool_and(
      signer.valid_from <= pg_catalog.clock_timestamp()
      and signer.valid_until > pg_catalog.clock_timestamp() + interval '30 days'
      and revocation.server_signer_id is null
      and app.agent_platform_companion_public_key_digest(signer.public_key_spki)
        = signer.public_key_spki_sha256
    ) as signer_active_unrevoked
from app.agent_platform_companion_server_signers as signer
left join app.agent_platform_companion_server_signer_revocations as revocation
  on revocation.server_signer_id = signer.id
where signer.id = :'companion_signer_id'::uuid
  and signer.signer_key_id = :'companion_signer_key_id'
  and signer.public_key_spki_sha256 = :'companion_signer_public_spki_sha256'
\gset
\if :signer_active_unrevoked
\else
  \warn 'The companion signer postcondition is not active and unrevoked.'
  select 1 / 0 as rejected;
\endif

\pset format unaligned
\pset tuples_only on

select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'companion_trust_only',
  'companionSigner', 'active_unrevoked',
  'financialFeatures', 'disabled_or_dry_run_only',
  'moneyMoved', false
)::text;

commit;
