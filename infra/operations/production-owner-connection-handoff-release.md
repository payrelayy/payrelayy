# Owner database connection handoff

On 2026-11-12, the Owner page returned 503 for submitted payments and system
status. PostgreSQL logged repeated `53300` failures for the one-connection
`fetanagent_owner_control_runtime` role at the same time. Supavisor session mode
can briefly retain the previous backend while the application reconnects. The
Owner application already caps its own pool at one active client; allow one
additional role slot for that handoff without changing role privileges.

1. Confirm the production role still has `rolconnlimit = 1`, has its reviewed
   least-privilege attributes, and the application pool remains `max: 1`.
2. Run `infra/sql/production-owner-runtime-connection-handoff.sql` against the
   exact production project with the DDL migration tool. This operational role
   change must not run in staging or the disposable migration suite. It accepts
   only the reviewed role shape and changes only its connection limit from one
   to two. Do not change any deposit switch or payment status.
3. Verify `rolconnlimit = 2`, then deploy the exact passing main application
   release through the guarded production runtime workflow. Its Owner preflight
   accepts the one-slot predecessor and two-slot successor during this handoff.
4. Refresh Submitted payments in Owner and confirm a 200 response with the
   expected list. Confirm system status and Owner activity load, and check that
   no new `53300` Owner-role failures appear while the pool reconnects.

If the application release cannot complete, do not revert the database role
while a two-slot connection is active. Restore the prior role limit only after
the Owner process is stopped and both sessions are drained, then follow the
normal application rollback guard.
