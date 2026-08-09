-- PayReplayy Stage 14B: disabled maintenance-only Telegram nonce-retention scaffold.
--
-- This migration assigns only the already-bounded purge helper to a dedicated NOLOGIN role pair.
-- It creates no password, runtime connection, scheduler, container, API wiring, Telegram polling,
-- customer data path, payment path, or feature-switch change. A later reviewed deployment must
-- provision the runtime credential outside Git and prove its exact narrow privilege boundary.

begin;

create role payreplayy_nonce_retention
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

create role payreplayy_nonce_retention_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

-- PostgreSQL 17 membership options deliberately grant only inherited cleanup-group privileges.
-- SET FALSE prevents the future login from changing its effective role, and ADMIN FALSE prevents
-- it from changing membership. Neither role owns application objects.
grant payreplayy_nonce_retention to payreplayy_nonce_retention_runtime
  with inherit true, set false, admin false;

-- PostgreSQL otherwise grants EXECUTE on newly created functions to PUBLIC. Every current app
-- function is owned by postgres, so make that existing private-schema intent durable for future
-- functions before granting schema usage to the narrowly scoped maintenance group.
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- Deny direct privileges explicitly. The group role gains only schema resolution and one bounded
-- SECURITY DEFINER cleanup procedure; the runtime scaffold receives that privilege by inheritance.
revoke all privileges on schema app
  from payreplayy_nonce_retention, payreplayy_nonce_retention_runtime;
revoke all privileges on all tables in schema app
  from payreplayy_nonce_retention, payreplayy_nonce_retention_runtime;
revoke all privileges on all sequences in schema app
  from payreplayy_nonce_retention, payreplayy_nonce_retention_runtime;
revoke all privileges on all functions in schema app
  from payreplayy_nonce_retention, payreplayy_nonce_retention_runtime;

revoke all on function app.purge_expired_telegram_private_ingress_nonce_reservations(integer)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_worker, payreplayy_api_runtime,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime;

grant usage on schema app to payreplayy_nonce_retention;
grant execute on function app.purge_expired_telegram_private_ingress_nonce_reservations(integer)
  to payreplayy_nonce_retention;

comment on role payreplayy_nonce_retention is
  'PayReplayy nonce-retention group role. NOLOGIN; only bounded cleanup of expired Telegram ingress nonce digests.';

comment on role payreplayy_nonce_retention_runtime is
  'PayReplayy nonce-retention runtime scaffold. NOLOGIN until separately provisioned; inherits only payreplayy_nonce_retention and cannot SET ROLE.';

commit;
