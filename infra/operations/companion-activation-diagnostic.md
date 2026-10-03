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

Delivery now reports its first failed preparation guard as a fixed public stage,
including failures before any temporary directory exists. The report never
contains a failing command, underlying exception, private input, or identifier.
Unknown stage values are replaced with `unknown_guard`; cleanup failures override
the stage with `cleanup`. `deliveryAttempted` means the stdin writer was invoked,
while `deliveryConfirmed` means its fixed acknowledgement was validated. Neither
flag claims that the separate historical diagnostic passed or proves live readiness.
