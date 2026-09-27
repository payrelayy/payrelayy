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
signer, caps the local handoff at the earlier of request or certificate expiry,
and uses exclusive creation so an existing handoff is never overwritten. It
returns only a digest and expiry; it does not log or return the signed document.
The protected operator workflow must supply the signer key as an in-memory key
object, verify the directory's Windows ACL and exclusive ownership, and handle
any failed or ambiguous publication as a stop requiring review. This module does
not provision that key, create the directory, consume the request, launch a
process, grant a permit, arm execution, or provide a production entry point.

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
