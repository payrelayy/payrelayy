# CBE Birr authoritative-shadow foundation

Stage 1A introduces a fail-closed foundation for comparing normalized CBE Birr provider facts with
an existing dry-run deposit intake. It is an advisory shadow only. It cannot verify or credit a
payment, create authoritative provider evidence, change a deposit or submission state, enqueue a
live financial job, or call KemerBet.

## Implemented boundary

- The shared TypeScript contract accepts only normalized, allowlisted facts. Raw transaction
  references, receiver identifiers, holder names, receipt URLs, provider payloads, and credentials
  cannot be represented by the contract or its log projection.
- The pure evaluator returns only `would_verify`, `would_reject`, or `would_review` with one
  allowlisted reason code. An unknown field, unsupported version, missing fact, changed shape, or
  uncertain provider result fails closed to `would_review`.
- The worker scaffold is disabled by default. Enabling its contract gate composes only the pure
  evaluator; it does not compose a provider transport, credential, database pool, queue runner,
  payment claim, or KemerBet executor.
- Private PostgreSQL tables provide a bounded lease and append-only result ledger for a future
  separately deployed shadow worker. A dedicated `NOLOGIN` group role receives only the narrow
  shadow procedures and no direct table access. This repository creates no worker login, password,
  runtime secret, or role membership.
- An active Owner can enqueue an eligible CBE Birr dry-run intake and read a display-safe projection
  through private database procedures. There is deliberately no Owner HTTP/UI mutation in this
  phase, and the existing synthetic-fixture review ledger is not reused.

The only eligible current state is an `intake_received` CBE Birr intent with its exact `received`
protected-reference submission. Shadow processing does not move either state. Every database
operation rechecks that `payment_verification`, `deposit_execution`, `withdrawal_validation`, and
`withdrawal_collection` are all disabled.

## Advisory outcomes

`would_verify` means only that every normalized shadow check passed. It is not a payment approval.
Conclusive not-found, receiver-mismatch, provider-failed, and reused-reference facts may produce
`would_reject`. Missing, pending, stale, future, malformed, unavailable, duplicate-check-uncertain,
or otherwise ambiguous facts produce `would_review`.

Stored shadow rows contain only internal IDs, allowlisted outcomes and reason codes, version labels,
keyed fingerprints or decision digests, counters, lease UUIDs, and timestamps. Owner list output and
audit metadata exclude fingerprints, digests, ciphertext, key versions, provider payloads, and
receiver data. Worker-only lease output may contain the already-protected reference material and
immutable intent snapshot needed by a future adapter; it must never be logged.

## Still disabled

Stage 1A does not provide or authorize:

- a CBE Birr URL, HTTP client, account credential, browser session, or provider request;
- a worker runtime login, container, scheduler, or queue runner;
- screenshot, PDF, SMS, QR, or OCR ingestion;
- writes to authoritative provider evidence, verification-attempt, payment-claim, or live deposit-job
  tables;
- a verified deposit state, customer credit, KemerBet collection, withdrawal validation, collection,
  or payout; or
- any live financial feature switch.

Stage 1B supplies only versioned synthetic normalization fixtures; it does not select or contact an
official source. Before a provider transport can be added, a separate review must prove permitted
official-source access, TLS and host allowlisting, bounded redirects/responses/retries, credential
isolation, anomaly and outage behavior, safe telemetry, and an incident stop procedure. See
[cbe-birr-authoritative-adapter-fixtures.md](cbe-birr-authoritative-adapter-fixtures.md).
Before any payment claim can be enabled, the dormant claim boundary must remain live-only, receive
an explicit least-privilege review, and pass reconciliation and duplicate-reference tests.
