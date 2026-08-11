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

select count(*) = 1 as bootstrap_contract_private
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'app'
  and procedure.proname = 'bootstrap_first_owner'
  and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_auth_user_id uuid, p_display_name text'
  and procedure.prosecdef
  and procedure.proowner = 'postgres'::regrole
  and procedure.proconfig = array['search_path=pg_catalog, app, auth, pg_temp']::text[]
  and not exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as acl
    where acl.privilege_type = 'EXECUTE'
      and acl.grantee <> procedure.proowner
  )
\gset
\if :bootstrap_contract_private
\else
  \warn 'The first-Owner bootstrap procedure is absent, altered, or broadly executable.'
  select 1 / 0 as rejected;
\endif

rollback;
\echo 'Staging first-Owner inspection passed without changing the database.'
