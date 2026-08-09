-- PayReplayy Stage 14B.1: prevent default PUBLIC execution on future postgres-created functions.
--
-- PostgreSQL default function EXECUTE is global. A per-schema REVOKE cannot remove that global
-- default, so private-schema routines must be protected by this owner-wide default before any
-- future caller receives schema USAGE. This does not change any existing function ACL.

begin;

alter default privileges for role postgres
  revoke execute on functions from public;

commit;
