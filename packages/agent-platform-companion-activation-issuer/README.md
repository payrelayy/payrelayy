# Companion activation issuer database adapter

This operator-only package implements the issuer core's `loadDatabaseSnapshot`
capability as one parameterized PostgreSQL `SELECT`. It reads a single immutable,
unexpired request alongside current pilot/epoch/account identity and the active,
database-trusted paired certificate. It rejects missing or ambiguous rows. It has
no connection string, credential, application route, executable production entry
point, write query, or provider action.

The caller must inject an already-authenticated, short-lived `postgres`
administrator query connection from a protected operator workflow. Never give
that connection to an always-on app, the Windows companion, or a browser. The
query explicitly requires `session_user = 'postgres'`; no application/runtime
role receives access through this package. The SQL reads a single MVCC snapshot
without lock-bearing helpers, so it can run in a read-only transaction. The
issuer core calls it twice, before and after independent release and process
observation, and compares both results.

This snapshot adapter does **not** establish complete financial readiness. The
separate `retainCompanionActivationAttestationRow` adapter accepts only the
issuer core's digest-only witness and one injected short-lived `postgres`
administrator connection. Its single parameterized `INSERT ... SELECT`
rechecks current request, pilot, epoch, certificate, signer, Owner, and disabled
companion control before inserting one immutable row. It refuses extra fields,
including raw proof or handoff material, and preserves the handoff digest in
the append-only witness. It does not consume a request, arm execution, issue
credentials, lease a deposit job, or move money. The atomic database transition
still rechecks every money-capable state at consumption. No production caller
or credential is supplied by this package.

The package also implements `verifyPublishedCompanionReleaseAndInstalledTree` for a
protected Windows operator workflow. It invokes the repository's pinned,
read-only PowerShell preflight using an absolute PowerShell 7 path, not a PATH
lookup. That preflight verifies the immutable archive and checksum against the
request, exact published release asset set and source tag, GitHub build
attestation, and independently measured archive and installed file trees. A
successful run returns the verified digests with a trusted operator-side time;
it does not trust a companion-supplied release version, file digest, or clock.
The workflow must provide a reviewed source checkout and protected local
archive/installation paths. No archive download, credential, or production
invocation workflow is provided here.

The package now also exports a read-only guarded-process observation adapter on
the separate `./guarded-process-observation` subpath. The root SQL-only adapter
entry point does not eagerly load this Windows runtime dependency.
It reads the canonical local execution handoff, validates its production signer
and exact request/certificate/release binding, and checks a paired v2 launch
proof against a fresh operator challenge. A source-pinned PowerShell inspection
checks the live Windows PID, executable, command line, and OS creation time
without emitting the command line. The adapter returns only the fields needed
by the issuer core. It does **not** launch a process or receive a proof itself:
a separately reviewed protected process launcher must supply the fresh proof
and operator paths. The new, separate `./guarded-local-launch-channel` subpath
provides only the operator-side Windows named-pipe receiver for that v2 proof.
It accepts one size- and time-bounded proof for a caller-supplied fresh challenge
and never writes an execution permit. The caller must close it in `finally`;
closing the channel makes the companion's guarded launch fail before workers start. The receiver
does not authenticate the proof, attest the release, start a process, or provide
an activation entry point. The independent guarded-process observer must still
verify the proof, handoff, certificate, and operating-system process before any
future transition can be considered. Neither adapter issues the handoff, consumes the
request, arms execution, or replaces the atomic financial-state preflight. The v1
no-money launch diagnostic cannot satisfy the required v2 proof.

The separate operator-only `./guarded-handoff-publication` subpath can publish
one canonical signed local handoff into an **already existing, operator-protected**
companion data directory. It binds an authenticated database request and paired
certificate to a fresh independent release measurement, pins the production
signer, caps the local handoff at the certificate expiry and the reviewed runtime window,
and uses exclusive creation so an existing handoff is never overwritten. The
ten-minute request is an issuance deadline; the local handoff lasts no later
than that deadline plus the reviewed two-hour database window or certificate
expiry, whichever is earlier. It
returns only a digest and expiry; it does not log or return the signed document.
The protected operator workflow must supply the signer key as an in-memory key
object, verify the directory's Windows ACL and exclusive ownership, and handle
any failed or ambiguous publication as a stop requiring review. This module does
not provision that key, create the directory, consume the request, launch a
process, grant a permit, arm execution, or provide a production entry point.

The separate `./guarded-activation-preflight` subpath composes the read-only
database snapshot, independent release measurement, one-use signed handoff
publication, no-permit pipe, exact guarded child starter, and independent process
observer. It re-reads the request identity after observation and requires a clean
stop of that exact child before returning a fixed, identifier-free result. It
does not retain an attestation, invoke the database transition, send a permit,
or provide a production entry point. A failed publication or uncertain child
shutdown is terminal and requires operator review, not automatic retry. This
rehearsal is not the complete financial-state preflight for live activation.

The `./guarded-process-launch-rehearsal` subpath composes that receiver with the
independent observer around a caller-supplied, synchronous protected child-process
starter. It always closes the no-permit channel and attempts a bounded stop of the
exact returned child. It reports success only after the signed proof and OS process
are observed and child exit is confirmed. The operator-side
`./guarded-pre-permit-child` adapter binds an already-spawned Node IPC child to
this stop contract: it sends one challenge-bound pre-permit stop request and
requires a clean browser-shutdown acknowledgement followed by exit code zero.
It never substitutes a Windows `child.kill()` for clean shutdown. The companion
accepts this request only while it is still waiting for a guarded permit, aborts
that wait, closes its protected browser and profile lock, then acknowledges. A
parent IPC disconnect also closes the session without an acknowledgement. The
listener remains armed after a permit for a distinct challenge-bound runtime
stop. Its acknowledgement requires the browser, profile lock, and workers to
stop, and the operator adapter also requires exact child exit code zero. This
confirms host shutdown only; any in-flight provider action still requires
independent reconciliation.
The rehearsal requests this stop before closing its no-permit proof pipe.
Its fixed, identifier-free result is not an activation attestation and cannot arm execution.
The separate `./guarded-process-starter` subpath prepares a one-use synchronous starter
for this rehearsal. It requires a fresh independent published-release and installed-tree
attestation, rechecks the installed launch files and exact markers, launches only the
bundled Node executable and entry point without a shell, and gives the exact child an
IPC clean-stop channel. Its child environment is an explicit Windows runtime allowlist
plus the guarded account and local proof challenge; ambient credentials, pairing
packages, `NODE_OPTIONS`, and provider settings are not inherited. The returned child
is bound to the challenge-specific, stage-aware stop contract. The operator must still
run the independent live-process observer and confirm clean child exit. This starter
does not inspect loaded memory or close the disk-to-spawn race by itself, and it is
not a production invocation. The starter supplies no permit sender, database transition,
or production credential/host stop and provider reconciliation mechanism. A caller
must not treat rehearsal success as authority to run a deposit job or perform a
provider action.

An operator-only `./guarded-emergency-stop-rehearsal` subpath now composes that exact
post-permit child stop with the already-reviewed administrator-only database
emergency operation. It starts both independent stops once, waits for the
database operation's exact committed, session-drained result and the child's
clean-exit proof, and fails closed if either is missing or late. A disposable
PostgreSQL test runs the real emergency SQL through this composition and checks
that the execution roles are passwordless, logged out, and disabled. Even a
successful result explicitly requires separate provider-outcome reconciliation;
it is not a settlement result, a production entry point, or permission to
activate execution.

An internal, unexported `activation-transition` adapter now fixes the exact
parameterized invocation of the existing Postgres-only one-use function. It
validates the operator-supplied Owner identity, request key, and freshly generated
runtime password, returns only the database expiry, and treats any post-dispatch
failure or malformed result as an uncertain activation requiring independent
stop and reconciliation, never a retry. It is absent from the package exports,
root entry point, production workflows, and companion. It must not be exposed or
invoked until the protected operator workflow owns a short-deadline administrator
session, the lifecycle lock, host-wide stop, credential revocation, and in-flight
provider reconciliation together. This source addition neither deploys the
migration nor enables a production activation.

The unexported `guarded-local-activation-channel` now pairs one bounded local
v2 proof with the exact retained attestation digest, the existing one-use
database transition, and a proof-bound permit acknowledgement. Before a
transition it requires an independently bound database-and-exact-child stop;
any post-dispatch error invokes that stop once and still reports uncertainty.
The companion acknowledges only receipt of the permit, not worker startup or
provider outcome. This source-only channel has no production caller or provider
reconciliation. It must not be used for a production activation until those
pieces and the protected operator workflow are reviewed together; it changes
no current financial state.
The local permit now binds the database's exact expiry alongside the proof
digest. The companion rejects the older permit version, an expired or overlong
expiry, and any malformed frame. Its worker deadline is the earlier of that
database expiry (with a fixed safety margin) and the signed handoff expiry;
the protected browser is stopped when that local deadline fires. This is an
additional local fence, not database session revocation or an independent
watchdog. The production execution path remains disabled.

The internal `guarded-database-watchdog-lease` adapter checks the exact three
scheduled database stop jobs and their recent success before a transition. It
renews the exact activated epoch's short lease before the local channel sends
any permit, then renews periodically while the operator remains alive. A lost,
late, or malformed renewal fails closed and invokes the channel's separately
bound emergency stop. The database Cron jobs remain independent: if the
operator process dies, the lease expires and those jobs fence the credentials,
sessions, and financial authority. This adapter is not exported or invoked by
production, does not start a job, and is not a substitute for provider-outcome
reconciliation.

The internal `guarded-execution-supervisor` composes that lease with the exact
owned-child lifecycle fence and the reviewed database-and-host emergency stop.
The local activation channel can bind its readiness, post-transition renewal,
loss signal, and stop callback to this one supervisor. All expiry, child-exit,
operator-abort, renewal-failure, and permit-failure paths share one memoized
stop, so a race cannot repeat the emergency SQL or the host stop. Its tests
exercise the real local permit gate with a failed renewal and require no permit
and exactly one stop. The supervisor remains internal source-only code; it
does not authorize an Owner request, launch a child, activate production, or
decide the outcome of an in-flight KemerBet action.

The internal `guarded-one-job-outcome` adapter now reads one exact
Owner-approved job through its consumed activation request, pilot, epoch, and
agent account. It reports completion only when the database's execution job,
intent, attempt, signed companion result, separate reconciliation job, and
unique positive KemerBet history/Player/amount/currency/credit evidence all
agree. Ambiguity and terminal failure are review-only; malformed or missing
rows fail closed. Its bounded watcher polls only this read-only snapshot while
the independent supervisor remains alive and the activation window is valid.
The internal `guarded-one-job-lifecycle` composes one proof-bound permit, that
watcher, the exact database/host emergency stop, and a post-stop ledger re-read.
It never leases, retries, clicks, credits, settles, or executes a job. These
modules are not a production operator. The source-only
`guarded-operator-activation` module now connects the independently checked
database snapshot, release/tree measurement, signed handoff, exact Windows
child/proof observation, attestation retention, supervisor, and one-job
lifecycle while holding one nonblocking session-level advisory lock on a
dedicated administrator connection. It stops the exact pre-permit child and
closes the local channel if attestation fails, and never reports completion
if the lifecycle or lock release is uncertain. It is deliberately absent
from package exports and production workflows. Its local handoff publisher now
accepts a protected signing callback instead of a private key on Windows and
verifies the exact returned body, pinned signer, canonical signature, and
request deadline before create-once publication. This is only an interface:
there is no authenticated server signing endpoint or transport yet. A protected production entry
point, dedicated session-mode administrator connection, server-side signer,
host ownership checks, exact
Owner approval, and post-crash provider reconciliation are still required
before a one-job pilot can run. The caller must close the dedicated database
session on every outcome, including a failed lock acquisition.

The source-only server handoff signer now derives the handoff from an exact,
unconsumed database request rather than accepting body fields from the PC. It
requires a server-owned protected key and an independent published-release
verification callback, re-reads the request around signing, and refuses a
changed or expired binding. The local publisher uses the same validation when
checking the server reply. There is still no authenticated network endpoint,
production secret loader, or activation caller; installing this package alone
cannot sign a production handoff or enable money movement.

An internal source-only lifecycle monitor can now bind the exact owned child,
the database transition expiry, and the reviewed database-and-host emergency
stop constructed from the protected administrator callback. It invokes that
stop once on expiry, child exit, operator abort, or an
explicit stop request, and accepts only the complete redacted stop proof. It
does not survive its own process failure, is not exported as a production
activation API, and cannot resolve an in-flight provider outcome. The installed
independent database watchdog addresses process-loss fencing, while the
protected operator and provider reconciliation remain prerequisites.
