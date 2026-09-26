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

This adapter does **not** establish complete financial readiness. It does not
retain an attestation, consume a request, arm execution, issue credentials,
lease a deposit job, or move money. The atomic database transition still
rechecks every money-capable state at consumption.

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
invocation workflow is provided here. The OS-observed process proof and
attestation-retention adapters remain separate work.
