# Trusted TeleBirr verifier foundation

This directory is an export-only, uncomposed backend foundation. It does not start a process and
has no `start` entrypoint. Nothing in this package, its database migration, or its tests makes
TeleBirr verification, deposit settlement, or any other money movement live.

The package provides:

- a strict configuration loader for a future isolated staging runtime;
- a singleton PostgreSQL adapter with a fail-closed catalog preflight;
- exact signed-assignment and signed-observation verification against separately pinned P-256
  server-signer and enrolled-device keys, accepting only canonical P-256 SPKI encodings;
- the existing TeleBirr live-pilot protocol and outcome adapter, with a second authoritative
  database read immediately before completion;
- redacted fixed-key log projections; and
- no transport, public endpoint, Android bridge, uploader, scheduler, or generic-worker hook.

A replay identity already owned by another attempt is deliberately fail-closed and non-durable in
the new attempt: it is returned as invalid/non-settled and the verifier does not call completion,
because the append-only observation ledger globally forbids inserting that replay identity again.
This is distinct from a duplicate canonical payment reference, which follows the authenticated
review/reject assessment path while the existing evidence/reference uniqueness remains intact.

The forward migration creates a dedicated group role and runtime-role scaffold. Both remain
`NOLOGIN`, unconfigured, and unable to `SET ROLE`. The group receives only the exact authority
reader and operation-time guarded TeleBirr completion function; neither role receives tables,
sequences, or generic application routines. Both financial functions use server time to reject an
expired, less-than-five-minutes-from-expiry, or otherwise unsafe runtime login even on a connection
that authenticated before expiry.
Public, API, service, Android-facing player-action, customer-web, executor, settlement, and
generic-worker roles cannot call either verifier function. The migration does not change a
feature switch and does not create credentials, signer keys, device enrollments, receiver
profiles, pilots, proofs, or other runtime seeds.

The catalog contract audits the reachable schema, relation, column, sequence, and routine surface,
not only `app`: the runtime may use only `app` and the empty `public` schema, cannot create in a
non-system schema, cannot reach any user relation, column, or sequence, and can execute exactly the
two granted financial functions. The hosted database's inherited PUBLIC defaults deliberately
leave `CONNECT`, `TEMPORARY`, and `public` schema `USAGE` effective. Those residual capabilities are
treated as explicit, exact preflight facts rather than hidden assumptions. They are bounded by the
single direct connection, connection limit, finite login validity, no arbitrary-SQL or public
ingress surface, fully qualified queries, empty reachable `public` schema, and operation-time role
guard; changing any audited catalog fact makes the runtime unavailable.

There is deliberately no Compose service, deployment workflow, credential material, signer seed,
device seed, receiver-profile seed, ingress listener, or health endpoint in this slice. The pin
manifest, database URL, and CA paths are fixed contracts only; no real values are checked in. A
future process passes the guarded CA bytes directly to the PostgreSQL TLS client with full peer
verification; the fixed `NODE_EXTRA_CA_CERTS` path is an additional process-level invariant, not a
substitute for that per-connection trust anchor.

Before any separate activation can be considered, all of the following gates require their own
reviewed implementation and evidence:

1. A least-privilege provisioning helper must create a strong database password, change only the
   dedicated runtime scaffold to `LOGIN`, and apply a finite validity window no longer than the
   catalog preflight permits. Password state must be verified by that privileged helper because
   the runtime cannot read `pg_authid`.
2. A deployment change must compose only this isolated app, supply the fixed root/effective-user
   guarded files, retain a single direct PostgreSQL connection, and leave all public ingress
   closed.
3. A local-only health/readiness surface must prove the singleton advisory lock and complete
   catalog preflight without exposing identifiers, digests, tokens, keys, or references.
4. A reviewed ingress-free ingestion path must hand an already leased exact attempt plus signed
   assignment/observation to this verifier. Android, public APIs, uploaders, bots, and generic
   workers must never receive the completion capability.
5. Staging end-to-end evidence must cover real authority snapshots, exact lost-ack replay,
   cross-attempt replay/duplicate rejection, review/reject completion without settlement lineage,
   settlement idempotency, policy/snapshot drift, and zero-secret logs.
6. Operational stop, expiry, device revocation, assignment-signer revocation, credential rotation,
   CA rotation, and rollback drills must all fail closed and be independently observed.
7. Activation review must also inventory and either revoke, constrain, or explicitly accept every
   remaining effective PostgreSQL ACL class outside the current schema/relation/column/sequence/
   routine preflight, including user-defined types, procedural languages, foreign-data wrappers,
   large objects, and inherited PUBLIC capabilities.
8. Only after those gates pass may a separate Owner-authorized change provision pilot data and
   consider changing the required provider-specific switches. This foundation itself must remain
   dormant until that later decision.

The package's workspace-manifest importer must match `package.json` exactly whenever the repository
lockfile is integrated. This slice contains no runtime composition or activation consequence.
