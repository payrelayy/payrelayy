# PayReplayy architecture — Stage 0

## Scope

PayReplayy is independent from QHash. QHash may be used as a product reference only; its
database, authentication, receipts, workers, and code are not a PayReplayy dependency.

Version 1 uses a private Telegram bot for customers, a private English-only Owner/Admin dashboard,
and a single KemerBet platform adapter. The current launch-preparation verification scope is CBE
Birr-only redacted fixture dry-run assessment. TeleBirr and CBE bank are deferred; neither has an
enabled adapter, provider credential, or runtime integration.

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
2. A future approved CBE Birr flow displays its configured receiver account and records an intake
   request with KemerBet's 25–25,000 ETB inclusive amount range for that one deposit.
   Customers may create unlimited separate deposits; PayReplayy has no customer, daily, or
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

The current code stops before Player-ID validation and deposit intake. A private, API-only
Telegram inbox boundary can create or find a customer identity, empty conversation, and
idempotent update record using only allowlisted metadata plus an API-generated keyed HMAC.
It does not receive raw Telegram messages or files, call KemerBet, validate a Player ID,
show receiver instructions, verify a payment, or change a financial state.

## Withdrawal boundary

PayReplayy validates a KemerBet withdrawal Player ID and code. Only an existing, valid,
uncompleted withdrawal becomes `awaiting_admin_approval`. An Owner or Administrator later
records the manual TeleBirr/CBE Birr payout; PayReplayy does not automate sending money in
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
