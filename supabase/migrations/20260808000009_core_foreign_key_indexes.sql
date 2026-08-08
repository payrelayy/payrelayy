-- PayReplayy Stage 1: indexes for foreign-key lifecycle operations.
--
-- Every foreign key that is not already covered by a primary, unique, or existing lookup index
-- receives a leading-column index. This keeps administrative lifecycle actions from scanning
-- growing audit/configuration tables.

begin;

create index admin_users_created_by_admin_id_idx
  on app.admin_users (created_by_admin_id)
  where created_by_admin_id is not null;

create index audit_events_actor_admin_id_idx
  on app.audit_events (actor_admin_id)
  where actor_admin_id is not null;

create index audit_events_actor_customer_id_idx
  on app.audit_events (actor_customer_id)
  where actor_customer_id is not null;

create index blocked_entities_created_by_admin_id_idx
  on app.blocked_entities (created_by_admin_id)
  where created_by_admin_id is not null;

create index blocked_entities_revoked_by_admin_id_idx
  on app.blocked_entities (revoked_by_admin_id)
  where revoked_by_admin_id is not null;

create index deposit_policy_versions_created_by_admin_id_idx
  on app.deposit_policy_versions (created_by_admin_id)
  where created_by_admin_id is not null;

create index feature_switches_updated_by_admin_id_idx
  on app.feature_switches (updated_by_admin_id)
  where updated_by_admin_id is not null;

create index receiver_accounts_created_by_admin_id_idx
  on app.receiver_accounts (created_by_admin_id)
  where created_by_admin_id is not null;

commit;
