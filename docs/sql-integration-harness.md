# Disposable SQL integration harness

`pnpm test:sql` is an opt-in, local-only test harness for the checked-in PostgreSQL migrations.
It is not a deployment command and cannot use an application database URL.

The ordinary `pnpm test` path type-checks this package during its build step but explicitly excludes
its Docker-only Vitest command. The package's direct `test` script fails closed; `pnpm test:sql` is
the only supported command that may invoke the disposable Compose project.

The runner fails before Docker is invoked when a standard PostgreSQL connection environment
variable is present. It also rejects Docker host/context overrides and requires the verified local
default Docker context to resolve to a Unix socket or Windows named pipe. The test container
accepts only the internal Compose hostname `postgres`, uses no published host port, and receives
the migrations bundled into its image. Its synthetic bootstrap supplies the minimum `auth.users`,
`storage.buckets`, and Supabase role names needed to apply the migration history; it never contacts
Supabase or creates data outside the disposable container.

The host runner validates the static Compose boundary, generates a cryptographically unique Compose
project name for each run, starts that project only long enough to run Vitest, and always requests
teardown with anonymous data cleanup. The test process also requires a root-owned marker baked into
the runner image before it opens a PostgreSQL connection, so a direct host invocation fails before
synthetic bootstrap can modify anything. The current baseline verifies lexical migration application,
private-schema ACLs, no-login runtime roles, forced RLS, default function-execution hardening, exact
role memberships, and the absence of API-runtime grants for Player-ID action procedures. Invite-only
admission coverage additionally verifies that the retired generic inbox recorder is inaccessible,
the historical-Telegram-data cutover guard fails closed, invalid/expired/revoked/used/cross-user
invite attempts make zero writes, a valid redemption is idempotent for its bound user/chat, and
only an admitted identity can record a later inbound event. It also verifies that malformed stored
inbound rows cannot be adopted, and that exact stored receipts remain replayable after an
administrator deactivates their customer or identity; new updates remain rejected. Two independent
database sessions racing to redeem the same invite for different private Telegram users must settle
with exactly one admitted graph and one generic rejection.
A signal requests teardown rather than leaving the disposable Compose project running.

Do not add an external hostname, a published port, a mounted filesystem, an environment file,
secrets, or a Docker socket to this harness. Future invite/action integration coverage must remain
separate from this baseline until its migration and runtime authority are explicitly approved.
