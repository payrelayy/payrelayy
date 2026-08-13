\set ON_ERROR_STOP on
\getenv owner_auth_user_id OWNER_AUTH_USER_ID

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '5s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '5s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:synthetic-cbe-birr-receiver', 0)
);

select admin_user.id as owner_admin_id
from app.admin_users as admin_user
where admin_user.auth_user_id = :'owner_auth_user_id'::uuid
  and admin_user.role = 'owner'
  and admin_user.status = 'active'
\gset

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

select payment_provider.id as cbe_birr_provider_id
from app.payment_providers as payment_provider
where payment_provider.code = 'cbe_birr'
  and payment_provider.status = 'active'
for update
\gset

select
  count(*) filter (where receiver_account.status = 'active') = 0 as no_active_receiver,
  count(*) filter (
    where receiver_account.status = 'active'
      and receiver_account.account_holder_name = 'FETANAGENT STAGING SIMULATION - DO NOT PAY'
      and receiver_account.account_reference_ciphertext = 'synthetic-staging-v1:do-not-pay'
      and receiver_account.account_reference_masked = '****TEST'
      and receiver_account.instructions = jsonb_build_object(
        'customer_message', 'SIMULATION ONLY — DO NOT SEND MONEY.',
        'simulation_only', true
      )
  ) = 1 as exact_synthetic_receiver_active
from app.receiver_accounts as receiver_account
where receiver_account.provider_id = :'cbe_birr_provider_id'::uuid
\gset

\if :no_active_receiver
  select app.replace_receiver_account(
    :'owner_admin_id'::uuid,
    :'cbe_birr_provider_id'::uuid,
    'FETANAGENT STAGING SIMULATION - DO NOT PAY',
    'synthetic-staging-v1:do-not-pay',
    null,
    '****TEST',
    jsonb_build_object(
      'customer_message', 'SIMULATION ONLY — DO NOT SEND MONEY.',
      'simulation_only', true
    )
  ) as synthetic_receiver_id
  \gset

  select count(*) = 1 as receiver_audit_recorded
  from app.audit_events as audit_event
  where audit_event.actor_kind = 'admin'
    and audit_event.actor_admin_id = :'owner_admin_id'::uuid
    and audit_event.action = 'configuration.receiver_account_replaced'
    and audit_event.resource_type = 'receiver_account'
    and audit_event.resource_id = :'synthetic_receiver_id'::uuid
  \gset
  \if :receiver_audit_recorded
  \else
    \warn 'The synthetic receiver audit postcondition was not satisfied.'
    select 1 / 0 as rejected;
  \endif
\else
  \if :exact_synthetic_receiver_active
    \echo 'The exact synthetic staging receiver is already active; no database write is needed.'
  \else
    \warn 'An unknown or real active CBE Birr receiver exists; refusing replacement.'
    select 1 / 0 as rejected;
  \endif
\endif

commit;
\echo 'The synthetic DO NOT PAY CBE Birr receiver is active in staging and audited.'
