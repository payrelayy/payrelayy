# Non-executing companion activation diagnosis

Status: prepared for review and testing only. This is not a production release,
installation, execution request, or permission to retry a deposit.

The protected operator image has a separate `--diagnose-activation` CLI mode. It
accepts the existing stdin-only launch document, selecting exactly its stored
request. The release tag must be the release recorded for that historical
request, not a newer Windows download. No request is created or consumed.

It requires a direct, verified-TLS administrator connection inside `BEGIN READ
ONLY`, all seven financial switches disabled, disabled companion execution
control, and no executor login/session. Queries use the exact request key as a
parameter. They do not read receipt contents, Player IDs, jobs, or OS files through
SQL, take row/advisory locks, or call any financial transition.

The diagnostic checks database representation and identity/time bindings at the
stored request's creation, independently verifies its public release metadata,
validates the same handoff body **in memory only**, checks the existing execution
key's format and pinned public identity without signing, then rereads the request
to detect changes. It opens no listener or HTTP handler, spawns no subprocess,
publishes no handoff, enables no authority, and always rolls back/closes.

Only a fixed JSON report leaves the process. `stage` identifies the first failed
check; no underlying exception, identifier, digest, URL, credential, private key,
or reconstructed body is reported. Cleanup uncertainty overrides other outcomes.
`inspectionMode` is always `historical_reconstruction` and `liveReadinessProven`
is always false. A passed result is not proof that the original SSH/HTTP request
succeeded, nor permission to execute an expired/stopped pilot. Historical public
release checks inspect current immutable metadata; they do not claim an original
network observation or verify the Windows installation tree anew.

No production workflow, launcher, release marker, database migration, permission,
or financial control is changed by this preparation. A reviewed production image
installation and one non-executing diagnostic run require separate authorization.

The separately approved delivery workflow reads the sole untouched queued job's
existing request inside a verified-TLS read-only transaction. It verifies that
request's historical public release, then sends the original launch document
through private SSH stdin into an ephemeral memory-only pipe. It creates no
request, role, login, execution grant, or approval. No launch document is saved to
a file or artifact.

The local coordinator starts only the separate diagnostic receiver, using the
already staged checked diagnostic image. The existing image tag, live launcher,
and sudo rule remain untouched. The receiver holds the existing host operation
lock, invokes only --diagnose-activation once, closes its pipe, removes its
temporary signer copy and diagnostic container, and verifies the original image
and launcher are unchanged. A failed or uncertain run is never automatically
retried. A historical pass does not prove present live readiness or authorize the
stopped pilot's job to execute.

The separately approved connectivity repair first validates the existing
administrator credential and the same read-only job boundary through the
production session pooler. Over the existing verified SSH connection it reads
only this host's native IPv6 source for the pinned direct database endpoint.
Using the existing protected management access, it removes at most that one
source from the current network-ban list, only if it is already banned. No
network restrictions, firewall rules, credentials, or financial authority are
created or changed. The direct endpoint must select the identical existing
request before delivery proceeds. A failed repair or delivery is not repeated.

The session-pooler preflight verifies client TLS with explicit libpq
`sslmode=verify-full` and the pinned Supabase CA. PostgreSQL's `pg_stat_ssl` reports
the pooler's separate database backend connection, so it cannot attest the
client-to-pooler TLS connection. The pooler-only selector retains every original
administrator, read-only, sole untouched job, no-approval, and no-execution
condition. The direct selector is unchanged: it still requires backend TLS and
must select the identical request before delivery. Neither selector is a runtime
activation or authorization to execute the job.

References: [PostgreSQL backend SSL statistics](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-SSL-VIEW),
[libpq certificate and hostname verification](https://www.postgresql.org/docs/current/libpq-ssl.html),
and [Supabase pooler SSL configuration](https://supabase.com/docs/guides/platform/ssl-enforcement).

Delivery now reports its first failed preparation guard as a fixed public stage,
including failures before any temporary directory exists. The report never
contains a failing command, underlying exception, private input, or identifier.
Unknown stage values are replaced with `unknown_guard`; cleanup failures override
the stage with `cleanup`. `deliveryAttempted` means the stdin writer was invoked,
while `deliveryConfirmed` means its fixed acknowledgement was validated. Neither
flag claims that the separate historical diagnostic passed or proves live readiness.

## Installed operator startup probe

The separate startup diagnostic invokes the already-installed image's existing
`--diagnose` mode. It checks independent verified-TLS psql access, the Node database
connection, the current public signer, the existing private key format and public
identity, and a briefly bound **handler-free** loopback listener. It does not open
the real bootstrap or handoff handler, sign anything, create/consume a request,
approve a job, or enable execution. Its launch-document nonce is syntax-only and
never stored or queried. No image, launcher, role, or migration is installed.

The workflow revision still requires exact passing main, but the image revision
comes from the reviewed session workflow's installed-image pin. New workflow code
must not be mistaken for a deployed image. The empty-queue scope remains the
default. An explicitly selected recovery scope may instead preserve exactly one
untouched paid job on a stopped pilot, with no open review, effective trusted
authority, Owner approval, execution attempt, executor login/session, or companion
execution login/session. All seven financial switches and companion control must
remain disabled. Historical records are not authority to execute the job.

The same no-money boundary is checked before and after the probe. A private
SHA-256 fingerprint of the entire queued job row must remain identical; neither
that fingerprint nor the row is printed or saved. Only fixed failure categories
are reported. The existing container, temporary signer copy, certificate, and
credentials are cleaned up, and the listener must be absent. A failure is not
retried automatically. A successful startup probe proves dependency readiness,
not live execution readiness, a valid new pilot, or permission for a Transfer.
