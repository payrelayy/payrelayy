# FetanAgent architecture

## Scope

FetanAgent is independent from QHash. QHash may be used as a product reference only; its
database, authentication, receipts, workers, and code are not a FetanAgent dependency.

Version 1's settled customer surface is an English-only, standalone responsive website/PWA with a
single generic sign-in and neutral workspace for customers and authorized team members. Customer
account creation is intended to be self-service with email/password authentication, and customer use
does not require Telegram. Email ownership confirmation is requested only for forgot-password
recovery, not account creation or routine sign-in. Customers may associate multiple KemerBet Player
IDs, and Telegram may only be added through a controlled optional legacy-history link. Team
credential requirements remain a separate security boundary even though the public entry path is
shared.

The current implementation is narrower and must not be confused with that product target. It has an
invite-only Telegram staging slice, a private internal operations page, CBE Birr-only redacted
fixture assessment, offline authoritative-shadow normalization fixtures, and fail-closed attempt and
settlement planning. The Stage 1E official-source policy is blocked with status `unproven`; no
provider has a selected or permitted source, enabled adapter, credential, or runtime integration.
The pure Stage 1F authoritative-lookup prerequisite inventory also remains blocked with every
capability false. TeleBirr and CBE bank are deferred.

## Component boundary

```text
Responsive web/PWA ───────────────> API ──> PostgreSQL / Supabase Storage
                                      │
Optional Telegram legacy link ────────┤
                                      ├──> durable jobs ──> worker ──> provider adapters
                                      │
Neutral team workspace ───────────────┤
                                      │
                                      └──> supervised executor ──> KemerBet agent UI

```

The web/PWA, optional bot, worker, workspace, and executor do not own independent financial state.
The API and database constraints are the source of truth.

`app` is a private PostgreSQL schema rather than a Supabase Data API schema. When the database
layer is introduced, the API and worker will receive isolated direct PostgreSQL runtime credentials.
A separately reviewed maintenance-only identity is the sole narrow exception: it may eventually
invoke the bounded expired-nonce purge, but it must never be shared with the API or worker. The bot
and executor communicate with the API, not the database.

## Product deposit flow

1. The signed-in customer selects one `Ready to use` KemerBet Player ID association.
2. The reviewed CBE Birr dry-run intake displays its configured masked receiver account and records
   request with KemerBet's 25–25,000 ETB inclusive amount range for that one deposit.
   Customers may create unlimited separate deposits; FetanAgent has no customer, daily, or
   lifetime deposit-count quota.
3. The customer submits a transaction ID and optional screenshot/PDF. Attachments assist
   extraction, but are never the sole approval evidence.
4. A provider adapter retrieves authoritative evidence and normalizes a canonical reference,
   amount, receiver, timestamp, and verification outcome.
5. The API enforces provider-reference uniqueness, amount/receiver/freshness checks, and a
   single execution lease. Uncertainty becomes `Being checked` for the customer and `Review
required` in the team workspace.
6. Only a confirmed record may be sent to the KemerBet executor. The executor reconciles
   before any retry. The current implementation cannot perform the final KemerBet transfer.

## Current implementation boundary

The invite-only Telegram slice records a Player-ID request, permits a private team member to record
the existing staged ownership-confirmation action, and then accepts an explicit
`/deposit PLAYER_ID AMOUNT` dry-run intake for 25-25,000 ETB. A separate
`/reference DEPOSIT_CODE TRANSACTION_REFERENCE` command sends the raw reference only through the
signed internal action channel; the API encrypts and blind-indexes it before storage and returns no
reference material. This is legacy staging behavior, not the canonical web/PWA flow or customer
copy. The ledger remains at `intake_received` and the submission at `received`. All financial
feature switches must remain disabled, so the flow cannot contact CBE Birr, create provider evidence
or a payment claim, enqueue verification, call KemerBet, or execute a deposit. Screenshot/PDF intake
and provider authority remain separately reviewed boundaries.

The staging-only simulation uses a fixed synthetic receiver labelled `DO NOT PAY`. Its customer
instruction explicitly says `SIMULATION ONLY — DO NOT SEND MONEY`; no real payment destination is
configured by that workflow.

## Account, session, and optional Telegram-link boundary

The pure `@fetanagent/customer-web-access-foundation` package records these product decisions only.
Its valid request returns `blocked / customer_web_access_runtime_not_implemented`, with every web,
PWA, account-creation, authentication, password, email, recovery, session, linking, persistence,
platform-action, and financial capability false. Self-service account creation and email/password
authentication are intent metadata only, not runtime readiness.

The canonical public paths are generic `/sign-in`, `/create-account`, and `/workspace` paths. The
server resolves capabilities after authentication; a URL, page title, or client flag must not reveal
or grant an internal role. Customer-visible copy uses `FetanAgent team`, `Workspace`, `Being checked`,
and `Review required` rather than `Owner`, `Admin`, or `manual verification`. Exact internal roles
and reason codes remain available to authorization and audit systems.

Routine customer login is intended to persist across ordinary browser/PWA restarts without repeated
or step-up authentication, until explicit sign-out or a server-side security revocation. Email
confirmation is requested only for forgot-password recovery. Those behaviors are not implemented or
enabled: no reviewed session or recovery boundary currently makes them safe. Ordinary bounded
session expiry conflicts with the selected no-repeated-authentication experience, and no reviewed
alternative or precise security-revocation policy resolves that conflict. Private data must not enter
a service-worker cache. Recovery needs a separately reviewed recovery-address binding and
one-time-token design. The decision against step-up prompts does not authorize an unsafe account
change or financial action.

Telegram is not sign-in, recovery, or transaction authority. A future optional history link must
begin from an authenticated web account, prove the exact legacy Telegram identity with a one-time
challenge, reject ambiguity without disclosure, and create a controlled reference without merging
identities, reparenting customer records, or copying history. It must record a redacted audit event.
No such link exists today. See
[standalone-web-pwa.md](standalone-web-pwa.md).

## Official-source and lookup-prerequisite boundary

The Stage 1E package is `@fetanagent/cbe-birr-official-source-policy`, with the
reserved source profile `cbe_birr_official_receipt_lookup_v1`. It is a pure policy boundary, not a
provider adapter or transport. Synthetic fixtures, browser visibility, known endpoints, and code
flags are not permission, so the current policy has no selected or permitted branch.

The policy contains no URL, host, credential, raw transaction reference, receiver phone,
ciphertext, key, decryptor, lease, job, network client, database client, payment claim, KemerBet
operation, or runtime wiring. It cannot change any financial switch or state.

The Stage 1F package is
`@fetanagent/cbe-birr-authoritative-lookup-prerequisite`. It is another pure, metadata-only blocked
contract, not a provider adapter, decryptor, job runner, or transport. Its 12 exact blockers cover
five unresolved areas: official-source permission; receiver protection, provenance, and fresh
immutable provisioning; submitted-reference key lifecycle; a joint review of the three distinct
normalization profiles; and preflight-safe acquisition. Its only valid-request disposition is
`blocked`, every capability is false, and it cannot carry raw or protected lookup material,
cryptographic or KMS values, a URL or credential, a lease, runtime or schema wiring, a payment
claim, or a KemerBet action.

The receiver and submitted-reference findings remain separately blocked. The receiver ciphertext
lacks protection metadata and provenance, so a fresh new immutable receiver-account revision must
be provisioned without inferring or backfilling facts onto an existing revision. The
submitted-reference encryption and fingerprint subkeys are domain-separated but share one API
master provisioning and rotation root and have no independent worker decrypt lifecycle. The current
lease operation also mutates and returns protected material before preflight, so it must be replaced
by a non-mutating metadata preflight and a separately reviewed opaque-handle payload design.

P0 work before any positive source capability includes an independently reviewed permission
artifact and exact access rules; key-split/KMS envelope design that never shares the API master or
fingerprint key; receiver key-version and purpose metadata; an isolated callback-scoped decryptor;
a strict compiled host/TLS/redirect policy; redacted telemetry and a tested incident stop; and
deterministic fake-transport tests. Each later transport, adapter, database, duplicate-read, claim,
and rollout boundary remains a separate review. See
[cbe-birr-official-source-policy.md](cbe-birr-official-source-policy.md) and
[cbe-birr-authoritative-lookup-prerequisite.md](cbe-birr-authoritative-lookup-prerequisite.md).

## Withdrawal boundary

FetanAgent validates a KemerBet withdrawal Player ID and code. Only an existing, valid,
uncompleted withdrawal becomes the internal `awaiting_admin_approval` state. Customer copy uses
`Being reviewed`; an authorized team member later records the external TeleBirr/CBE Birr payout.
FetanAgent does not automate sending money in version 1.

## Required safeguards

- Financial actions default to `dry_run`.
- A live action needs an explicit feature switch, a typed authorization boundary, an audit
  event, and a durable execution-attempt record.
- Provider evidence is unique by provider and canonical reference.
- Locks/leases prevent duplicate verification and execution jobs.
- Reconciliation precedes retries after timeout, session change, CAPTCHA, or UI ambiguity.
- Team configuration, receipt files, and user data live in private Supabase resources
  protected by a private-schema boundary, least-privilege server roles, row-level security, and
  audit events.
- Sensitive team actions require two distinct eligible approvers; the selected product behavior does
  not add a repeated or step-up prompt for either routine customer use or those approvals. This
  generic approval boundary is not implemented, so those actions remain disabled.
- The responsive web/PWA must not cache authenticated or financial data or queue identity or
  financial mutations while offline.
- Logs redact tokens, passwords, authorization headers, and provider identifiers.

## Deployment path

The public responsive web/PWA and generic workspace are not implemented by the current deployment.
The London DigitalOcean VM will run Docker Compose: API, optional bot, worker, executor, and nginx.
No public HTTP/HTTPS firewall rule is opened until a domain, TLS, reverse proxy, and a
staging health check are ready. Supabase remains in Ireland; London is the closest practical
DigitalOcean region and a good latency/security tradeoff for this deployment.
