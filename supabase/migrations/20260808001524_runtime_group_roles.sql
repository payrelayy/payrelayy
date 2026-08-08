-- PayReplayy Stage 1: non-login roles for direct PostgreSQL runtime access.
--
-- These group roles are deliberately unable to log in. A later secure deployment procedure will
-- create separate login roles, grant each membership in exactly one group, and store credentials
-- only in the corresponding VM container secret. Do not connect application code as `postgres`.

begin;

create role payreplayy_api
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;

create role payreplayy_worker
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;

grant usage on schema app to payreplayy_api, payreplayy_worker;

-- The API owns Telegram identity and conversation lifecycle. Column-level UPDATE privileges
-- prevent retargeting an identity, changing a Telegram ID/chat, or mutating inbound dedupe data.
grant select, insert on table app.customers to payreplayy_api;
grant update (display_name) on table app.customers to payreplayy_api;

grant select, insert on table app.customer_identities to payreplayy_api;

grant select, insert on table app.telegram_identities to payreplayy_api;
grant update (username, first_name, last_name, preferred_locale)
  on table app.telegram_identities to payreplayy_api;

grant select, insert on table app.inbound_events to payreplayy_api;
grant update (processed_at, processing_error_code)
  on table app.inbound_events to payreplayy_api;

grant select, insert on table app.bot_conversations to payreplayy_api;
grant update (state, version) on table app.bot_conversations to payreplayy_api;

-- Audit events are append-only by both privilege and trigger. Dashboard/audit reading is deferred
-- to a distinct future admin runtime role rather than the customer-facing API role.
grant insert on table app.audit_events to payreplayy_api;
grant usage on sequence app.audit_events_id_seq to payreplayy_api;

-- Runtime configuration is readable by the API. All configuration mutation, Owner bootstrap, and
-- dashboard access remain unavailable until a separately isolated admin role is introduced.
grant select (entity_kind, entity_reference, reason_code, expires_at, revoked_at)
  on table app.blocked_entities to payreplayy_api;
grant select (id, code, display_name, status, created_at, updated_at)
  on table app.platforms to payreplayy_api;
grant select (id, code, display_name, adapter_key, status, created_at, updated_at)
  on table app.payment_providers to payreplayy_api;
grant select (
  id,
  provider_id,
  version,
  account_holder_name,
  account_reference_masked,
  instructions,
  status,
  active_from,
  retired_at,
  created_at,
  updated_at
) on table app.receiver_accounts to payreplayy_api;
grant select (
  id,
  version,
  minimum_amount_minor,
  maximum_amount_minor,
  freshness_window_seconds,
  status,
  retired_at,
  created_at,
  updated_at
) on table app.deposit_policy_versions to payreplayy_api;
grant select (feature_key, mode, created_at, updated_at)
  on table app.feature_switches to payreplayy_api;

-- The worker currently reads only the verification configuration it will need in the next stage.
grant select (entity_kind, entity_reference, reason_code, expires_at, revoked_at)
  on table app.blocked_entities to payreplayy_worker;
grant select (id, code, display_name, status)
  on table app.platforms to payreplayy_worker;
grant select (id, code, display_name, adapter_key, status)
  on table app.payment_providers to payreplayy_worker;
grant select (
  id,
  provider_id,
  version,
  account_holder_name,
  account_reference_ciphertext,
  verification_reference_ciphertext,
  status,
  active_from,
  retired_at
) on table app.receiver_accounts to payreplayy_worker;
grant select (
  id,
  version,
  minimum_amount_minor,
  maximum_amount_minor,
  freshness_window_seconds,
  status,
  retired_at
) on table app.deposit_policy_versions to payreplayy_worker;
grant select (feature_key, mode) on table app.feature_switches to payreplayy_worker;

-- API RLS policies. They are scoped to the private application role; browser/Data API roles keep
-- their deny-by-default behavior from the first migration.
create policy api_select_customers on app.customers
  for select to payreplayy_api using (true);
create policy api_insert_customers on app.customers
  for insert to payreplayy_api with check (true);
create policy api_update_customers on app.customers
  for update to payreplayy_api using (true) with check (true);

create policy api_select_customer_identities on app.customer_identities
  for select to payreplayy_api using (true);
create policy api_insert_customer_identities on app.customer_identities
  for insert to payreplayy_api with check (true);

create policy api_select_telegram_identities on app.telegram_identities
  for select to payreplayy_api using (true);
create policy api_insert_telegram_identities on app.telegram_identities
  for insert to payreplayy_api with check (true);
create policy api_update_telegram_identities on app.telegram_identities
  for update to payreplayy_api using (true) with check (true);

create policy api_select_inbound_events on app.inbound_events
  for select to payreplayy_api using (true);
create policy api_insert_inbound_events on app.inbound_events
  for insert to payreplayy_api with check (true);
create policy api_update_inbound_events on app.inbound_events
  for update to payreplayy_api using (true) with check (true);

create policy api_select_bot_conversations on app.bot_conversations
  for select to payreplayy_api using (true);
create policy api_insert_bot_conversations on app.bot_conversations
  for insert to payreplayy_api with check (true);
create policy api_update_bot_conversations on app.bot_conversations
  for update to payreplayy_api using (true) with check (true);

create policy api_insert_audit_events on app.audit_events
  for insert to payreplayy_api with check (
    actor_kind = 'customer'
    and actor_customer_id is not null
    and actor_admin_id is null
  );

create policy api_select_blocked_entities on app.blocked_entities
  for select to payreplayy_api using (
    revoked_at is null and (expires_at is null or expires_at > now())
  );
create policy api_select_platforms on app.platforms
  for select to payreplayy_api using (status in ('active', 'inactive'));
create policy api_select_payment_providers on app.payment_providers
  for select to payreplayy_api using (status in ('active', 'inactive'));
create policy api_select_receiver_accounts on app.receiver_accounts
  for select to payreplayy_api using (status in ('active', 'inactive'));
create policy api_select_deposit_policy_versions on app.deposit_policy_versions
  for select to payreplayy_api using (status in ('active', 'inactive'));
create policy api_select_feature_switches on app.feature_switches
  for select to payreplayy_api using (true);

-- Worker RLS policies. It has no identity, conversation, audit, or configuration-mutation access.
create policy worker_select_blocked_entities on app.blocked_entities
  for select to payreplayy_worker using (
    revoked_at is null and (expires_at is null or expires_at > now())
  );
create policy worker_select_platforms on app.platforms
  for select to payreplayy_worker using (status in ('active', 'inactive'));
create policy worker_select_payment_providers on app.payment_providers
  for select to payreplayy_worker using (status in ('active', 'inactive'));
create policy worker_select_receiver_accounts on app.receiver_accounts
  for select to payreplayy_worker using (status in ('active', 'inactive'));
create policy worker_select_deposit_policy_versions on app.deposit_policy_versions
  for select to payreplayy_worker using (status in ('active', 'inactive'));
create policy worker_select_feature_switches on app.feature_switches
  for select to payreplayy_worker using (true);

comment on role payreplayy_api is
  'PayReplayy API group role. NOLOGIN; use only through a dedicated server login role.';
comment on role payreplayy_worker is
  'PayReplayy worker group role. NOLOGIN; use only through a dedicated server login role.';

commit;
