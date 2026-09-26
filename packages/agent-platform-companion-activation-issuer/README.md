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
a separately reviewed protected local challenge-pipe launcher must supply the
fresh proof and operator paths. It also does not issue the handoff, consume the
request, arm execution, or replace the atomic financial-state preflight. The v1
no-money launch diagnostic cannot satisfy the required v2 proof.
