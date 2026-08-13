\set ON_ERROR_STOP on
\getenv owner_auth_user_id OWNER_AUTH_USER_ID

begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '5s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '5s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:staging:first-owner-bootstrap', 0)
);

select count(*) = 1 as auth_user_ready
from auth.users as auth_user
where auth_user.id = :'owner_auth_user_id'::uuid
  and auth_user.email is not null
  and auth_user.email_confirmed_at is not null
  and auth_user.deleted_at is null
  and (auth_user.banned_until is null or auth_user.banned_until <= clock_timestamp())
\gset
\if :auth_user_ready
\else
  \warn 'The selected staging Auth user is not present, confirmed, and active.'
  select 1 / 0 as rejected;
\endif

select count(*) = 0 as active_owner_absent
from app.admin_users as admin_user
where admin_user.role = 'owner'
  and admin_user.status = 'active'
\gset
\if :active_owner_absent
\else
  \warn 'An active Owner already exists; first-Owner bootstrap is permanently closed.'
  select 1 / 0 as rejected;
\endif

select app.bootstrap_first_owner(:'owner_auth_user_id'::uuid, null) as new_admin_id
\gset

select
  count(*) = 1
  and count(*) filter (
    where admin_user.id = :'new_admin_id'::uuid
      and admin_user.auth_user_id = :'owner_auth_user_id'::uuid
      and admin_user.role = 'owner'
      and admin_user.status = 'active'
  ) = 1 as exact_owner_created
from app.admin_users as admin_user
where admin_user.role = 'owner'
  and admin_user.status = 'active'
\gset
\if :exact_owner_created
\else
  \warn 'The first-Owner postcondition was not satisfied.'
  select 1 / 0 as rejected;
\endif

select count(*) = 1 as bootstrap_audit_recorded
from app.audit_events as audit_event
where audit_event.actor_kind = 'system'
  and audit_event.actor_label = 'owner-bootstrap'
  and audit_event.action = 'admin.owner_bootstrapped'
  and audit_event.resource_type = 'admin_user'
  and audit_event.resource_id = :'new_admin_id'::uuid
\gset
\if :bootstrap_audit_recorded
\else
  \warn 'The first-Owner audit postcondition was not satisfied.'
  select 1 / 0 as rejected;
\endif

commit;
\echo 'Exactly one active staging Owner was bootstrapped and audited.'
