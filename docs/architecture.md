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
fixture assessment, offline authoritative-shadow normalization fixtures, fail-closed attempt and
settlement planning, and a disabled/unrouted customer-only SSR/PWA Auth and non-financial Player-ID
foundation. The customer web server can ensure one customer account for a server-verified Auth UUID
and submit/list that identity's web-origin KemerBet Player-ID requests through an exact
direct-PostgreSQL BFF boundary. Capability-based staff routing through the generic public entry is
not implemented. A pure customer-web ownership-proof prerequisite now records why that next phase
must remain dormant: no authoritative proof source, challenge, evidence protocol, or positive
result is selected, and no reviewed deposit-eligibility promotion boundary exists. A separate
private eligibility ledger now quarantines every new deposit intent behind an explicit latest
`eligible` decision, but no decision-writing procedure, writer grant, runtime, or UI can create that
decision. The Stage 1E
official-source policy is blocked with status `unproven`; no provider
has a selected or permitted source, enabled adapter, credential, or runtime integration. The pure
Stage 1F authoritative-lookup prerequisite inventory also remains blocked with every capability
false. TeleBirr and CBE bank are deferred.

## Component boundary

```text
Responsive web/PWA ──> customer web BFF ──> PostgreSQL / Supabase Auth
                                │
                                └──> future financial API
                                                │
Optional Telegram legacy link ──────────────────┤
                                                ├──> durable jobs ──> worker ──> provider adapters
                                                │
Neutral team workspace ─────────────────────────┤
                                                │
                                                └──> supervised executor ──> KemerBet agent UI

```

The web/PWA, optional bot, worker, workspace, and executor do not own independent financial state.
The API and database constraints remain the source of truth for financial workflows.

`app` is a private PostgreSQL schema rather than a Supabase Data API schema. The implemented customer
web BFF uses `@fetanagent/customer-web-workspace-runtime`, a dedicated direct-PostgreSQL identity
with execute access to exactly three private functions and no table access. The browser never
connects to PostgreSQL. The API, worker, and other reviewed server processes keep isolated runtime
credentials. A separately reviewed maintenance-only identity is the sole narrow exception: it may
eventually invoke the bounded expired-nonce purge, but it must never be shared with the API or worker.
The bot and executor communicate with the API, not the database.

## Product deposit flow

1. The signed-in customer selects one KemerBet Player ID with both proven ownership and a separate
   current deposit-eligibility decision. Only that combined state may eventually display `Ready`.
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

The invite-only Telegram slice records a Player-ID request and permits a private team member to
record the existing staged ownership-confirmation action. That action now records ownership only;
it neither inserts nor grants deposit eligibility. The historical explicit
`/deposit PLAYER_ID AMOUNT` dry-run intake remains in source for 25-25,000 ETB, but every new intent
also requires a separate latest `eligible` ledger decision and no application path can create one.
A separate
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

The disabled customer web slice has a separate non-financial boundary. After server-side Supabase
Auth verification, its BFF supplies only the Auth UUID to
`app.ensure_customer_web_account(uuid)`,
`app.submit_customer_web_player_registration(uuid,uuid,text)`, and
`app.list_customer_web_player_registrations(uuid,integer)`. These functions create or replay the
immutable customer mapping, record a bounded non-claiming request, and return only that mapping's
web-origin requests. They cannot prove ownership, create a validated player association, promote a
Player ID to deposit eligibility, open a deposit, or execute any financial action.
The customer projection uses exactly `Checking`, `Ready`, and `Could not confirm`; `Ready` is
unreachable because web-origin association remains rejected. The current list SQL does not join the
eligibility ledger. Any later implementation that can project `Ready` must additionally require a
separate current `eligible` decision.

The pure `@fetanagent/customer-web-player-ownership-proof-prerequisite` package does not change
that boundary. Its only valid disposition is
`blocked / customer_web_player_ownership_proof_prerequisites_incomplete`, with a fixed ordered
nine-item `remainingBlockers` inventory. Contract version 2 names the remaining financial blocker
`deposit_eligibility_promotion_boundary_absent` and keeps all 19 capabilities false. It cannot
represent proof success, associate a customer to a Player ID, create `Ready`, or grant deposit
eligibility. It has no database, schema, role, application, runtime, environment, network, or
infrastructure wiring.

The separate private `app.player_deposit_eligibility_decisions` ledger is an append-only financial
quarantine, not part of that package and not an ownership-proof system. The deposit-intent insert
guard locks the player row, requires the latest decision to be `eligible`, and snapshots that exact
decision ID. A later `revoked` row blocks later intents. There is no seed, backfill, promotion
procedure, writer grant, runtime adapter, customer projection, or staff control, so the ledger adds
no positive eligibility, `Ready`, deposit UI, provider call, or financial runtime capability.

## Account, session, and optional Telegram-link boundary

The pure `@fetanagent/customer-web-access-foundation` package is a historical, non-runtime record of
these product decisions only.
Its valid request returns `blocked / customer_web_access_runtime_not_implemented`, with every web,
PWA, account-creation, authentication, password, email, recovery, session, linking, persistence,
platform-action, and financial capability false. Self-service account creation and email/password
authentication are intent metadata in that pure package, not runtime permission. A separate
disabled-by-default `apps/customer-web` and `@fetanagent/customer-web-auth-runtime` source boundary
implements the SSR/PWA account shell, server-handled Auth cookies, current-session sign-out, and a
recovery operation whose cookie effects commit only after code exchange and password update succeed.
The separate `@fetanagent/customer-web-workspace-runtime` implements only the three non-financial
account/Player-ID procedures described above. Neither runtime is deployment-wired, and neither
provides Player-ID ownership proof, association/deposit eligibility, or financial capability.

## Customer-web ownership-proof prerequisite boundary

No reviewed authoritative KemerBet control signal exists for the customer-web flow. The challenge
profile, challenge delivery path, evidence profile, freshness/replay/attempt/abuse policy,
verification adapter, neutral staff proof-review capability, and ownership conflict/recovery policy
are also unselected or absent. The ninth blocker is
`deposit_eligibility_promotion_boundary_absent`: the database now separates ownership from
financial eligibility, but nothing is authorized to promote an association into an `eligible`
decision.

The prerequisite package is pure advisory metadata. It accepts no Player ID, identity, evidence,
credential, token, provider session, or financial input; performs no I/O; and exports no positive
proof state. It adds no migration, table, function, trigger, grant, role, RLS policy, route, UI,
worker, adapter, secret, feature switch, deployment component, or financial action. The current
three-function customer-web PostgreSQL surface and the database rejection of web-origin association
remain unchanged.

A future proof flow must first create a non-financial ownership fact independent from deposit
eligibility. Any later promotion to a financially usable player binding must write a separately
authorized and audited eligibility decision through a new reviewed boundary; proof success must
never silently enable deposits. See
[customer-web-player-ownership-proof.md](customer-web-player-ownership-proof.md).

The canonical public paths are generic `/sign-in`, `/create-account`, and `/workspace` paths. The
server resolves capabilities after authentication; a URL, page title, or client flag must not reveal
or grant an internal role. Customer-visible copy uses `FetanAgent team`, `Workspace`, `Being checked`,
and `Review required` rather than `Owner`, `Admin`, or `manual verification`. Exact internal roles
and reason codes remain available to authorization and audit systems.

Routine customer login is intended to persist across ordinary browser/PWA restarts without repeated
or step-up authentication, until explicit sign-out or a server-side security revocation. Email
confirmation is requested only for forgot-password recovery. The source implements a bounded,
server-handled session-cookie and short-lived recovery-code boundary, but it is disabled and must not
be called an infinite session. Per-device visibility, remote sign-out, explicit post-recovery global
revocation, hosted Auth/SMTP settings, exact trusted-proxy handling, shared fail-closed rate limiting,
and an audit of effective Data API grants, exposed RPCs, and RLS remain deployment gates. Private data
does not enter the service-worker cache. The decision against step-up prompts does not authorize an
unsafe account change or financial action.

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

The public responsive web/PWA and generic workspace exist in source but are not part of the current
deployment. Adding them requires a reviewed customer-web image, runtime secret boundary, exact
trusted-proxy chain, shared fail-closed limiter, Compose/Caddy routing, and a staging health check.
The London DigitalOcean VM otherwise continues to run the reviewed private services. Supabase
remains in Ireland; London is the closest practical DigitalOcean region and a good latency/security
tradeoff for this deployment.
