# FetanAgent architecture — Stage 0

## Scope

FetanAgent is independent from QHash. QHash may be used as a product reference only; its
database, authentication, receipts, workers, and code are not a FetanAgent dependency.

Version 1 uses a private Telegram bot for customers, a private English-only Owner/Admin dashboard,
and a single KemerBet platform adapter. The current launch-preparation verification scope is CBE
Birr-only redacted fixture dry-run assessment plus offline authoritative-shadow normalization
fixtures and fail-closed attempt and settlement planning. The Stage 1E official-source policy
is blocked with status `unproven`; no provider has a selected or permitted source, enabled adapter,
credential, or runtime integration. TeleBirr and CBE bank are deferred.

## Component boundary

```text
Telegram private chat ──> bot ──> API ──> PostgreSQL / Supabase Storage
                                       │
                                       ├──> durable jobs ──> worker ──> provider adapters
                                       │
                                       └──> supervised executor ──> KemerBet agent UI

Owner/Admin dashboard ───────────────> API
```

The bot, worker, dashboard, and executor do not own independent financial state. The API
and database constraints are the source of truth.

`app` is a private PostgreSQL schema rather than a Supabase Data API schema. When the database
layer is introduced, the API and worker will receive isolated direct PostgreSQL runtime credentials.
A separately reviewed maintenance-only identity is the sole narrow exception: it may eventually
invoke the bounded expired-nonce purge, but it must never be shared with the API or worker. The bot
and executor communicate with the API, not the database.

## Planned deposit flow

1. The bot validates the requested KemerBet Player ID.
2. The reviewed CBE Birr dry-run intake displays its configured masked receiver account and records
   request with KemerBet's 25–25,000 ETB inclusive amount range for that one deposit.
   Customers may create unlimited separate deposits; FetanAgent has no customer, daily, or
   lifetime deposit-count quota.
3. The customer submits a transaction ID and optional screenshot/PDF. Attachments assist
   extraction, but are never the sole approval evidence.
4. A provider adapter retrieves authoritative evidence and normalizes a canonical reference,
   amount, receiver, timestamp, and verification outcome.
5. The API enforces provider-reference uniqueness, amount/receiver/freshness checks, and a
   single execution lease. Uncertainty goes to manual review.
6. Only a confirmed record may be sent to the KemerBet executor. The executor reconciles
   before any retry. Stage 0 cannot perform the final KemerBet transfer.

## Current implementation boundary

The invite-only Telegram slice records a Player-ID request, allows the Owner to record a manual
KemerBet ownership confirmation, and then permits an explicit `/deposit PLAYER_ID AMOUNT` dry-run
intake for 25-25,000 ETB. A separate `/reference DEPOSIT_CODE TRANSACTION_REFERENCE` command sends
the raw reference only through the signed internal action channel; the API encrypts and blind-indexes
it before storage and returns no reference material. The ledger remains at `intake_received` and the
submission at `received`. All financial feature switches must remain disabled, so the flow cannot
contact CBE Birr, create provider evidence or a payment claim, enqueue verification, call KemerBet,
or execute a deposit. Screenshot/PDF intake and provider authority remain later reviewed stages.

The staging-only simulation uses a fixed synthetic receiver labelled `DO NOT PAY`. Its customer
instruction explicitly says `SIMULATION ONLY — DO NOT SEND MONEY`; no real payment destination is
configured by that workflow.

## Official-source policy boundary

The Stage 1E package is `@fetanagent/cbe-birr-official-source-policy`, with the
reserved source profile `cbe_birr_official_receipt_lookup_v1`. It is a pure policy boundary, not a
provider adapter or transport. Synthetic fixtures, browser visibility, known endpoints, and code
flags are not permission, so the current policy has no selected or permitted branch.

The policy contains no URL, host, credential, raw transaction reference, receiver phone,
ciphertext, key, decryptor, lease, job, network client, database client, payment claim, KemerBet
operation, or runtime wiring. It cannot change any financial switch or state.

P0 work before any positive source capability includes an independently reviewed permission
artifact and exact access rules; key-split/KMS envelope design that never shares the API master or
fingerprint key; receiver key-version and purpose metadata; an isolated callback-scoped decryptor;
a strict compiled host/TLS/redirect policy; redacted telemetry and a tested incident stop; and
deterministic fake-transport tests. Each later transport, adapter, database, duplicate-read, claim,
and rollout boundary remains a separate review. See
[cbe-birr-official-source-policy.md](cbe-birr-official-source-policy.md).

## Withdrawal boundary

FetanAgent validates a KemerBet withdrawal Player ID and code. Only an existing, valid,
uncompleted withdrawal becomes `awaiting_admin_approval`. An Owner or Administrator later
records the manual TeleBirr/CBE Birr payout; FetanAgent does not automate sending money in
version 1.

## Required safeguards

- Financial actions default to `dry_run`.
- A live action needs an explicit feature switch, a typed authorization boundary, an audit
  event, and a durable execution-attempt record.
- Provider evidence is unique by provider and canonical reference.
- Locks/leases prevent duplicate verification and execution jobs.
- Reconciliation precedes retries after timeout, session change, CAPTCHA, or UI ambiguity.
- Owner/Admin configuration, receipt files, and user data live in private Supabase resources
  protected by a private-schema boundary, least-privilege server roles, row-level security, and
  audit events.
- Logs redact tokens, passwords, authorization headers, and provider identifiers.

## Deployment path

The London DigitalOcean VM will run Docker Compose: API, bot, worker, executor, and nginx.
No public HTTP/HTTPS firewall rule is opened until a domain, TLS, reverse proxy, and a
staging health check are ready. Supabase remains in Ireland; London is the closest practical
DigitalOcean region and a good latency/security tradeoff for this deployment.
