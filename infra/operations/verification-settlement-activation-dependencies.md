# Verification-settlement activation dependencies

## Current decision

The generic verification-settlement PostgreSQL adapter is intentionally not composed into a
runtime. It has no real producer outside its unit tests, opens no database connection, reads no
credential or environment value, and owns no delivery, acknowledgement, retry, or process
lifecycle.

This is a required safety boundary, not an incomplete deployment toggle:

- `AuthoritativeDepositProofOutcomeCandidate` is explicitly advisory-only. Its contract fixes
  `sqlAuthorizationAllowed`, `databaseWriteAllowed`, `settlementAllowed`, `enqueueAllowed`, and
  `financialActionAllowed` to `false`.
- the CBE authoritative path has no authenticated, durable, provider-neutral handoff that can mint
  the exact deposit-intent, verification-attempt, and provider-evidence lineage accepted by the
  private finalizer;
- after the trusted verifier authenticates signed TeleBirr evidence,
  `app.complete_private_live_telebirr_verification(...)` revalidates current database authority,
  constructs the receipt-derived legacy lineage, invokes
  `app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)` in the same
  database transaction, and records its settlement receipt. Sending that result through a generic
  settlement worker would be a duplicate settlement attempt and is forbidden;
- `apps/worker/src/verified-deposit-settlement-postgres-adapter.ts` remains an injected-database
  contract test for the exact least-privilege role surface. It is not imported by the worker
  entrypoint, and `@fetanagent/worker` has no PostgreSQL driver dependency.

There is intentionally no `INTERNAL_VERIFICATION_SETTLEMENT_RUNTIME_ENABLED` setting. The worker
does not read a settlement database URL, handoff secret, provider credential, or execution switch.

## Producer and consumer map

| Producer                                    | Trust and persistence boundary                                               | Permitted settlement consumer                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| TeleBirr live-pilot outcome adapter         | Pure advisory result; no SQL authority                                       | Trusted TeleBirr completion RPC only; that RPC settles atomically |
| CBE authoritative shadow/receipt components | Advisory-only and currently without an authenticated durable handoff         | None                                                              |
| Generic verified-deposit settlement adapter | Accepts only an exact database-minted lineage triple after catalog preflight | None until the dependencies below exist                           |

## Dependencies required before composition

All of the following require a separate review. They must land together or remain disabled.

1. **One authenticated authority producer.** Select a provider-neutral completion boundary that
   independently verifies source authenticity, current policy, customer, Player ID, receiver,
   amount, freshness, duplicate-reference state, and immutable pilot authorization before it emits
   the exact lineage triple. A database-transactional handoff is preferred. A cross-process
   handoff additionally requires a versioned canonical envelope, cryptographic sender
   authentication, audience and purpose binding, expiry, replay-protected nonce/idempotency key,
   durable delivery, and durable acknowledgement. A boolean `authenticated` field is not proof.
2. **Non-overlapping provider ownership.** TeleBirr must stay excluded while its completion RPC
   performs settlement. Moving TeleBirr to a generic settlement consumer would first require a
   forward-only migration that removes settlement from the completion RPC, preserves one atomic
   authority boundary, migrates replay semantics, and proves that old and new consumers can never
   run concurrently.
3. **Dedicated runtime package.** Create a service separate from `apps/admin`, the trusted verifier,
   the public API, and the shadow worker. It needs a pinned `pg` and `@types/pg` dependency, package
   manifest entries, and the corresponding `pnpm-lock.yaml` importer update. No manifest or lock
   change is justified until dependency 1 exists.
4. **Fail-closed configuration.** Keep the runtime gate default-off. When reviewed for activation,
   require an exact deployment target, the dedicated direct-database host and
   `fetanagent_verification_settlement_runtime` login, port 5432, database `postgres`,
   `sslmode=verify-full`, the fixed CA path, and an approved root/runtime-owned non-symlink secret
   file. Reject broad roles, poolers, direct environment secrets, query overrides, URLs, and
   production/staging target mismatches.
5. **Exact database privilege preflight.** Retain one connection, NOINHERIT/NOSET/NOADMIN role
   membership, no upstream role membership, schema USAGE without CREATE, no table, column, sequence,
   or view privileges, private default function ACLs, and exactly one executable function:
   `app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)`. The runtime
   must never receive the legacy finalizer, claim, enqueue, any execution lease/fence/cancellation
   or reconciliation routine, Owner-control, or base-table access. It must also never execute the
   TeleBirr stage, lease, assignment-transcript, completion, or authoritative-snapshot routines;
   those belong exclusively to the independently authenticated trusted TeleBirr verifier boundary.
6. **Bounded idempotent delivery.** Persist an attempt before invocation, reuse the identical
   authenticated lineage and idempotency identity for replay, accept only the finalizer's exact
   seven-column result, and treat `already_finalized=true` as the successful replay of that same
   lineage. Retry only a small reviewed number of transient connection failures with bounded
   backoff. Never retry malformed input, authentication failure, catalog drift, authority failure,
   a different lineage, or an indeterminate acknowledgement without reconciliation.
7. **Redacted observability and shutdown.** Logs and metrics may contain only fixed component,
   phase, disposition, attempt count, and bounded-delay fields. They must never include UUIDs,
   Player IDs, payment references, amounts, receiver data, evidence, connection material, SQL, or
   thrown backend text. Startup preflight failure, connection loss, or catalog drift must make the
   process unavailable; shutdown must stop intake, drain at most one in-flight request, and close
   the one-connection pool.
8. **Dormant infrastructure first.** Add a no-port, read-only, non-root, capability-dropped Compose
   service under an explicit inactive profile. Infra verification must prove the default staging
   service set cannot start it, only its database URL, CA, and any reviewed handoff-verification
   material are mounted, no provider network or KemerBet material is present, and all current
   finance/provider/executor gates remain dry-run or false. Provision and disable the runtime login
   through the guarded staging helper before any service activation.
9. **Verification evidence.** Add exact configuration, secret-file race/ownership, catalog drift,
   startup/connection-loss, authenticated-handoff, duplicate delivery, bounded retry, replay,
   redaction, graceful-shutdown, image, Compose, and disposable PostgreSQL integration tests. A
   real-money activation is a separate decision after those tests and reconciliation drills pass.

## Current schema and packaging impact

No migration is needed to preserve the current safe state. The private finalizer and its
least-privilege NOLOGIN role scaffold already exist. A future database-backed authenticated handoff
may need a forward-only migration for its durable inbox/outbox, replay ledger, and narrowly granted
procedures; that design must not reuse an advisory outcome as authority.

No package manifest or lockfile is changed by this safety hardening. A deployable dedicated service
will require both, plus Docker/Compose and guarded runtime-login provisioning changes. Those changes
must not be added independently of the authenticated producer and non-overlap proof.
