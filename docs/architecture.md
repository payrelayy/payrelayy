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
result is selected. A separate private eligibility ledger quarantines every new deposit intent
behind an explicit latest `eligible` decision. The authenticated Owner-control runtime now provides
the only reviewed approval/revocation command and UI; ownership never promotes eligibility
automatically. Private KemerBet execution-attempt and reconciliation ledgers plus a reviewed callable
SQL/runtime safety core now enforce a one-shot final-action fence, one blocking attempt per agent
account, and positive reconciliation before `executed`. A dedicated executor role boundary exposes
exactly six private consume-only transition commands, and `apps/executor` contains their database
adapter, catalog preflight, guarded orchestration, concrete Playwright agent page, exact
account-bound session registry, separate HMAC providers, polling/health entrypoint, and a hardened
explicit-profile Docker/Compose boundary. The repository does not provision the selector, identity
bindings, keys, profiles, runtime LOGIN, live database switches, deployed service, or
authoritative-verifier caller, so the executor remains operationally disabled. The separate pure
deterministic contract continues to model stop, uncertainty, reconciliation, review, and lane
serialization without I/O or retry. The Stage 1E official-source policy defines only an
`offline_profile_defined / live_transport_absent` CBE profile; no provider has an enabled live
adapter, credential, or runtime integration. The pure
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
with execute access to exactly seven private functions and no table access. Three cover account and
Player-ID projection; three cover default-off owned deposit intake, protected reference capture,
and customer-safe status. The seventh atomically consumes a bounded fixed-window throttle keyed by
a server HMAC of the client address and exact route; it stores no raw address or submitted value.
The browser never
connects to PostgreSQL. The API, worker, and other reviewed server processes keep isolated runtime
credentials. A separately reviewed maintenance-only identity is the sole narrow exception: it may
eventually invoke the bounded expired-nonce purge, but it must never be shared with the API or worker.
The bot communicates with the API. The source-level executor boundary instead uses a dedicated
direct-PostgreSQL runtime identity restricted to six private execution/reconciliation transition
commands and no base-table, sequence, or direct-enqueue access. The runner and page driver now exist
in source, but no production credential, reviewed session/profile bundle, live switch set, or
deployed process currently activates them.

## Product deposit flow

1. The signed-in customer selects one KemerBet Player ID with both proven ownership and a separate
   current deposit-eligibility decision. Only that combined state may eventually display `Ready`.
2. The reviewed CBE Birr dry-run intake displays its configured masked receiver account and records
   a request with FetanAgent's current 25–25,000 ETB inclusive amount range for that one deposit.
   Customers may create unlimited separate deposits; FetanAgent has no customer, daily, or
   lifetime deposit-count quota.
3. The customer submits a transaction ID and optional screenshot/PDF. Attachments assist
   extraction, but are never the sole approval evidence.
4. A provider adapter retrieves authoritative evidence and normalizes a canonical reference,
   amount, receiver, timestamp, and verification outcome.
5. The API and database enforce provider-reference uniqueness and the
   amount/receiver/freshness checks. The private
   `app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)` boundary additionally
   requires the customer submission and authoritative evidence to carry the same keyed canonical
   reference fingerprint. It atomically creates exactly one immutable payment claim and one
   execution command only while the current policy, player eligibility, and both financial switches
   remain valid. Exact complete replays return the same claim/job pair; partial or mismatched state
   is never repaired. No checked-in provider worker or provisioned login invokes this boundary.
6. Only a confirmed record may be enqueued for the KemerBet executor. The safety core permits one
   execution attempt, keeps uncertainty and review agent-blocking, and requires both the exact
   agent success-modal player-credit delta and one unique in-window `Approved` `EPOS` history row
   before `executed`. The guarded runtime contains the single post-fence `Transfer` action, but its
   fixed gates and missing operational inputs prevent startup in the checked-in state. No retry is
   authorized.

A controlled agent-system test established the reusable lookup, transfer, exact success-modal
player-credit-delta, and unique `Approved` `EPOS` history workflow without becoming a FetanAgent
transaction record or enabling a live executor. The workflow is sanitized in
[kemerbet-agent-deposit-observation.md](kemerbet-agent-deposit-observation.md). It does not make the
private UI a stable API or authorize an unattended transfer.

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

The disabled customer web slice keeps account and Player-ID ownership separate from financial
intake. After server-side Supabase Auth verification, its BFF supplies only the Auth UUID to
`app.ensure_customer_web_account(uuid)`,
`app.submit_customer_web_player_registration(uuid,uuid,text)`, and
`app.list_customer_web_player_registrations(uuid,integer)`. These functions create or replay the
immutable customer mapping, record a bounded non-claiming request, and return only that mapping's
web-origin requests. They cannot prove ownership, create a validated player association, promote a
Player ID to deposit eligibility or execute any financial action. Three additional default-off
functions may open an already-eligible customer's deposit intake, capture a protected reference,
and list customer-safe status only while the independent payment, execution, and authoritative CBE
switches are locked live. They cannot create ownership, eligibility, provider evidence, a payment
claim, or KemerBet execution.
The customer projection uses exactly `Checking`, `Ready`, and `Could not confirm`; `Ready` is
unreachable because web-origin association remains rejected. The list SQL nevertheless enforces the
complete future-facing display rule now: `Ready` additionally requires an active, validated,
same-customer association, an active platform, and a contiguous latest `eligible` decision whose
player-state snapshot still matches. Missing, revoked, stale, future-dated, or malformed eligibility
stays `Checking`. This projection is not financial authorization; the deposit-intent insert trigger
independently rechecks and snapshots eligibility.

The pure `@fetanagent/customer-web-player-ownership-proof-prerequisite` package does not change
that boundary. Its only valid disposition is
`blocked / customer_web_player_ownership_proof_prerequisites_incomplete`, with a fixed ordered
nine-item `remainingBlockers` inventory. Contract version 3 names the financial requirement
`owner_deposit_eligibility_decision_required` and keeps all 19 capabilities false. It cannot
represent proof success, associate a customer to a Player ID, create `Ready`, or grant deposit
eligibility. It has no database, schema, role, application, runtime, environment, network, or
infrastructure wiring.

The separate private `app.player_deposit_eligibility_decisions` ledger is an append-only financial
quarantine, not part of that package and not an ownership-proof system. The deposit-intent insert
guard locks the player row, requires the latest decision to be `eligible`, and snapshots that exact
decision ID. A later `revoked` row blocks later intents. There is no seed, backfill, promotion
procedure, writer grant, runtime adapter, or staff control. The customer list can only read the
ledger through its fixed security-definer projection to keep `Ready` fail-closed; it cannot expose
ledger fields or create a decision. The ledger therefore adds no positive eligibility, reachable
`Ready`, deposit UI, provider call, or financial runtime capability.

The reviewed execution safety core builds on `app.deposit_execution_attempts`, which records a
single prepared attempt, a durable final-action fence, and any subsequent reconciliation or review
requirement. Its partial unique indexes keep one intent and one agent account blocked throughout
prepared, fenced, uncertain, reconciling, or review-required work. `app.execution_reconciliations`
stores only closed outcomes and sanitized facts: a confirmed outcome requires the normalized
operation `deposit`, exactly one `Approved` `EPOS` history match, a sanitized history timestamp
inside the inclusive server-authored final-action/reconciliation window, exact player, amount, and
currency matches, the exact success-modal player-credit delta, and a keyed external-reference
fingerprint. Non-deposit, unknown, missing, or out-of-window facts cannot confirm execution.
`not_observed` is not evidence of non-execution and never authorizes retry.
Both tables are private, forced-RLS, policy-free, and ungranted. Reconciliation rows are append-only;
attempt identity is immutable, while its closed lifecycle changes and all delete/truncate attempts
are trigger-guarded. The migration adds the dedicated `fetanagent_deposit_executor` role boundary
and exactly six security-definer transition commands: execution lease, pre-action cancel, one-shot
final-action fence, reconciliation handoff, reconciliation lease, and reconciliation recording. The
role receives no direct table, sequence, enqueue-function, or unrelated-function access; its
separate runtime identity remains `NOLOGIN` until deployment provisioning.

The separate `fetanagent_verification_settlement` role receives schema usage and execute on only
`app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)`. The procedure holds the same
intent-scoped advisory lock as verified enqueue, verifies the exact intent/submission/attempt/
evidence/reference tuple, and calls the otherwise-ungranted claim and enqueue procedures inside one
statement transaction. The direct enqueue function is an internal implementation detail of this
atomic boundary and is not executable by either executor role. Any policy, eligibility, switch,
claim, or enqueue failure rolls back all state. The settlement runtime scaffold is `NOLOGIN`, has no
direct table, sequence, executor-transition, Data API, or Telegram access, and has no credential or
operational caller. `apps/worker` contains a dormant, injection-only adapter that pins this one RPC
and the exact future runtime-role catalog shape. It is not imported by worker startup, opens no
database connection, and reads no environment, configuration, or credential; it therefore cannot
make settlement reachable while the runtime role remains `NOLOGIN`.

`apps/executor` implements the matching PostgreSQL command adapter, a startup catalog preflight for
the exact role/function surface, guarded execution and reconciliation orchestration, and a strict
agent-workflow adapter. That adapter validates the target and amount, permits the `Transfer` click
only after the database returns the first fence, persists whether the immediate modal contained the
exact player-credit delta, and reconciles only one matching `Approved` `EPOS` history row. A concrete
Playwright implementation is bound through an exact-account persistent-session registry. It uses
fixed route/selector contracts, side-effect-free authenticated identity/CAPTCHA readiness probes,
separate keyed history and identity fingerprints, and a sandboxed persistent Chromium context.

The production entrypoint composes that driver, registry, database adapter, serialized polling loop,
private loopback health service, redacted logging, circuit opening, and graceful shutdown. A separate
explicit-profile-only Compose artifact supplies a hardened single-replica container shape and a
manual, no-database session provisioner. It supplies no selector, binding, HMAC key, profile,
runtime credential, live database switch, or trusted provider-verification caller; those remain
activation blockers documented in [`../infra/executor.md`](../infra/executor.md).

The pure KemerBet contract mirrors that boundary with deterministic fake observations for lookup
failure, selector drift, expired sessions, CAPTCHA, pre/post-action timeout, lost success feedback,
delayed/missing/duplicate/non-approved history, non-deposit/unknown operations,
before/after/unknown-window observations, other mismatches, and one exact in-window deposit with an
exact success-modal player-credit delta. It can return only advisory stop, reconciliation, review,
or lane-wait plans.
Every plan has `retryAllowed: false`; it performs no I/O, and no application runtime invokes or
composes these planners.

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
The separate `@fetanagent/customer-web-workspace-runtime` implements the three non-financial
account/Player-ID procedures described above plus three default-off deposit-intake/status
procedures. Neither runtime is deployment-wired; neither provides Player-ID ownership proof or
eligibility, and the deposit procedures remain unavailable unless all independent financial/source
gates are live.

## Customer-web ownership-proof prerequisite boundary

No reviewed authoritative KemerBet control signal exists for the customer-web flow. The challenge
profile, challenge delivery path, evidence profile, freshness/replay/attempt/abuse policy,
verification adapter, neutral staff proof-review capability, and ownership conflict/recovery policy
are also unselected or absent. The ninth blocker is
`owner_deposit_eligibility_decision_required`: proof success cannot promote financial eligibility;
an authenticated Owner must independently approve or revoke the associated Player ID through the
audited private command.

The prerequisite package is pure advisory metadata. It accepts no Player ID, identity, evidence,
credential, token, provider session, or financial input; performs no I/O; and exports no positive
proof state. It adds no migration, table, function, trigger, grant, role, RLS policy, route, UI,
worker, adapter, secret, feature switch, deployment component, or financial action. The original
three-function customer account/Player-ID surface and the database rejection of web-origin
association remain unchanged. Three separate default-off deposit-intake/status functions do not
create ownership proof or eligibility.

A future proof flow must first create a non-financial ownership fact independent from deposit
eligibility. The existing Owner-only financial boundary must then record a separate audited
eligibility decision; proof success must never silently enable deposits. See
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
revocation, hosted Auth/SMTP settings, and reviewed proxy/deploy configuration,
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

The Stage 1E package is `@fetanagent/cbe-birr-official-source-policy`, with source profile
`cbe_birr_official_receipt_lookup_v1`. Contract version 2 defines an offline-only compiled request:
HTTPS, fixed host/port/path, exact `TID` then `PH` order, and zero redirects. A parse5 parser runs
only against marked synthetic HTML supplied in an exact plain synthetic response data record. It
accepts no executable transport or callback and has no HTTP client, credential, protected input
integration, lease, database, payment claim, KemerBet
operation, or runtime wiring and cannot change a financial switch or state.

The Stage 1F package is
`@fetanagent/cbe-birr-authoritative-lookup-prerequisite`. It is another pure, metadata-only blocked
contract, not a provider adapter, decryptor, job runner, or transport. Its 13 exact blockers cover
the unattested live receipt contract and absent live transport; receiver protection, provenance, and fresh
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

P0 work before any positive source capability includes privacy-reviewed live response attestation
and a bounded transport for the compiled route; key-split/KMS envelope design that never shares the API master or
fingerprint key; receiver key-version and purpose metadata; an isolated callback-scoped decryptor;
a strict compiled host/TLS/redirect policy; redacted telemetry and a tested incident stop; and
deterministic offline-response tests. Each later transport, adapter, database, duplicate-read, claim,
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
- Timeout, session change, CAPTCHA, or UI ambiguity requires reconciliation. The current execution
  foundation exposes no retry path.
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
deployment. Adding them requires the reviewed customer-web image, runtime secret boundary, exact
one-hop trusted-proxy chain, durable limiter migration and secret, Compose/Caddy routing, and a
staging health check.
The London DigitalOcean VM otherwise continues to run the reviewed private services. Supabase
remains in Ireland; London is the closest practical DigitalOcean region and a good latency/security
tradeoff for this deployment.
