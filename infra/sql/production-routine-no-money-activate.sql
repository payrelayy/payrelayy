\set ON_ERROR_STOP on

-- Runs only after production-inert-runtime-preflight.sql, using the exact
-- production postgres session. These credentials authorize four no-money
-- lookup/review functions only; they do not activate any financial switch.
begin;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select current_user = 'postgres' and session_user = 'postgres'
  and exists (
    select 1 from pg_catalog.pg_roles role
    where role.rolname = 'fetanagent_routine_telebirr_no_money_runtime'
      and not role.rolinherit
      and not role.rolsuper and not role.rolcreatedb and not role.rolcreaterole
      and not role.rolreplication and not role.rolbypassrls
      and role.rolconnlimit = 1
  ) as exact_limited_runtime
\gset
\if :exact_limited_runtime
\else
  \warn 'The separate no-money runtime is not limited as reviewed.'
  select 1 / 0 as rejected;
\endif

select count(*) = 7 as financial_switches_disabled
from app.feature_switches switch
where switch.feature_key in (
  'cbe_birr_authoritative_verification', 'deposit_execution',
  'payment_verification', 'private_live_deposit_pilot',
  'telebirr_authoritative_verification', 'withdrawal_collection',
  'withdrawal_validation'
)
  and switch.mode = 'disabled' and switch.settings = '{}'::jsonb
\gset
\if :financial_switches_disabled
\else
  \warn 'The seven financial switches are not all disabled.'
  select 1 / 0 as rejected;
\endif

insert into app.routine_telebirr_lookup_signers (
  id, signer_key_id, public_key_spki_sha256, valid_from, valid_until
) values (
  :'signer_id'::uuid, 'telebirr-routine-lookup-production-v1',
  :'public_spki_digest', :'valid_from'::timestamptz,
  :'valid_until'::timestamptz
) on conflict (id) do nothing;

select count(*) = 1 and pg_catalog.bool_and(
  signer.signer_key_id = 'telebirr-routine-lookup-production-v1'
  and signer.public_key_spki_sha256 = :'public_spki_digest'
  and signer.valid_from = :'valid_from'::timestamptz
  and signer.valid_until = :'valid_until'::timestamptz
  and signer.valid_from <= pg_catalog.clock_timestamp()
  and signer.valid_until > pg_catalog.clock_timestamp() + interval '10 minutes'
  and not exists (
    select 1 from app.routine_telebirr_lookup_signer_revocations revocation
    where revocation.signer_id = signer.id
  )
) as exact_active_signer
from app.routine_telebirr_lookup_signers signer
where signer.id = :'signer_id'::uuid
\gset
\if :exact_active_signer
\else
  \warn 'The independent lookup signer is not exact and active.'
  select 1 / 0 as rejected;
\endif

alter role fetanagent_routine_telebirr_no_money_runtime
  login password :'runtime_password' valid until :'valid_until';

commit;
