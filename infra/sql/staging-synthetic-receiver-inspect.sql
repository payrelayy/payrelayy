\set ON_ERROR_STOP on
\getenv owner_auth_user_id OWNER_AUTH_USER_ID

begin transaction isolation level serializable read only;
set local search_path = pg_catalog;
set local statement_timeout = '5s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '5s';

select current_user = 'postgres' and session_user = 'postgres' as administrator_session_ready
\gset
\if :administrator_session_ready
\else
  \warn 'The staging administrator session identity is not exact.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as active_owner_ready
from app.admin_users as admin_user
where admin_user.auth_user_id = :'owner_auth_user_id'::uuid
  and admin_user.role = 'owner'
  and admin_user.status = 'active'
\gset
\if :active_owner_ready
\else
  \warn 'The confirmed staging Auth user is not the active Owner.'
  select 1 / 0 as rejected;
\endif

select count(*) = 4 as financial_features_disabled
from app.feature_switches as feature_switch
where feature_switch.feature_key in (
  'payment_verification',
  'deposit_execution',
  'withdrawal_validation',
  'withdrawal_collection'
)
  and feature_switch.mode = 'disabled'
\gset
\if :financial_features_disabled
\else
  \warn 'Every financial feature must remain disabled.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as cbe_birr_provider_ready
from app.payment_providers as payment_provider
where payment_provider.code = 'cbe_birr'
  and payment_provider.status = 'active'
\gset
\if :cbe_birr_provider_ready
\else
  \warn 'The exact active CBE Birr provider is unavailable.'
  select 1 / 0 as rejected;
\endif

select
  count(*) filter (where receiver_account.status = 'active') = 0
    or count(*) filter (
      where receiver_account.status = 'active'
        and receiver_account.account_holder_name = 'FETANAGENT STAGING SIMULATION - DO NOT PAY'
        and receiver_account.account_reference_ciphertext = 'synthetic-staging-v1:do-not-pay'
        and receiver_account.account_reference_masked = '****TEST'
        and receiver_account.instructions = jsonb_build_object(
          'customer_message', 'SIMULATION ONLY — DO NOT SEND MONEY.',
          'simulation_only', true
        )
    ) = 1 as receiver_state_safe
from app.receiver_accounts as receiver_account
join app.payment_providers as payment_provider
  on payment_provider.id = receiver_account.provider_id
where payment_provider.code = 'cbe_birr'
\gset
\if :receiver_state_safe
\else
  \warn 'An unknown or real active CBE Birr receiver exists; refusing synthetic configuration.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as replacement_contract_private
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'app'
  and procedure.proname = 'replace_receiver_account'
  and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
    'p_actor_admin_id uuid, p_provider_id uuid, p_account_holder_name text, p_account_reference_ciphertext text, p_verification_reference_ciphertext text, p_account_reference_masked text, p_instructions jsonb'
  and procedure.prosecdef
  and procedure.proowner = 'postgres'::regrole
  and procedure.proconfig = array['search_path=pg_catalog, app, pg_temp']::text[]
  and not exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as acl
    where acl.privilege_type = 'EXECUTE'
      and acl.grantee <> procedure.proowner
  )
\gset
\if :replacement_contract_private
\else
  \warn 'The audited receiver replacement contract is absent, altered, or broadly executable.'
  select 1 / 0 as rejected;
\endif

rollback;
\echo 'Staging synthetic receiver inspection passed without changing the database.'
