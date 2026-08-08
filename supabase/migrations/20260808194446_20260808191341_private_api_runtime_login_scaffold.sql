-- PayReplayy Stage 13A: disabled direct-PostgreSQL API login scaffold.
--
-- This role deliberately cannot log in yet and has no password. A later, separate deployment
-- procedure may enable LOGIN and install a generated credential only in the API container's
-- runtime secret environment. Never connect application code as postgres or service_role.

begin;

create role payreplayy_api_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

-- PostgreSQL 17 membership options deliberately grant only inherited API-group privileges.
-- SET FALSE prevents this login from changing its effective role, and ADMIN FALSE prevents
-- membership administration. The API group owns no objects and has only reviewed privileges.
grant payreplayy_api to payreplayy_api_runtime
  with inherit true, set false, admin false;

-- Deny direct privileges explicitly. Any usable privilege must come solely through the one
-- constrained payreplayy_api membership above.
revoke all privileges on schema app from payreplayy_api_runtime;
revoke all privileges on all tables in schema app from payreplayy_api_runtime;
revoke all privileges on all sequences in schema app from payreplayy_api_runtime;
revoke all privileges on all functions in schema app from payreplayy_api_runtime;

comment on role payreplayy_api_runtime is
  'PayReplayy API runtime login scaffold. NOLOGIN until separately provisioned; inherits only payreplayy_api privileges and cannot SET ROLE.';

commit;
