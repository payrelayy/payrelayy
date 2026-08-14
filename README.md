# FetanAgent

FetanAgent's settled product direction is a standalone, responsive web/PWA-first
payment-verification and betting-agent service. Customers may create and use FetanAgent accounts
through the intended self-service email-and-password flow without Telegram, associate multiple
KemerBet Player IDs, and enter through the same generic public sign-in and neutral workspace used by
authorized team members. Email ownership confirmation is requested only for forgot-password
recovery, not account creation or routine sign-in. Product copy is English-only.

The repository currently implements an earlier English-only, invite-only Telegram staging slice for
a CBE Birr dry run plus a disabled authoritative-shadow foundation and offline attempt and settlement
planners. Stage 1E specifies a pure, blocked-by-default official-source policy whose current source
status is `unproven`; it neither selects nor permits a provider source. Stage 1F adds a pure
authoritative-lookup prerequisite contract that records the remaining P0 blockers and keeps every
lookup capability false. The current staging slice can model advisory outcomes, but it has no public
web/PWA customer account flow, provider call, payment verification or claim, KemerBet execution, or
live financial action. Telegram is optional in the settled product and requires a separately
reviewed legacy-history link rather than becoming web authentication or recovery.

## Current safety status

The current foundation is deliberately safe:

- the standalone customer web/PWA, generic sign-in, neutral workspace, persistent login,
  forgot-password recovery, and Telegram-history link are product decisions only and are not
  implemented or enabled;
- the requested persistent routine login and recovery-only email confirmation do not yet have a
  reviewed session or recovery boundary, so they must not be represented as safe capabilities;
- self-service account creation and email/password authentication are intent only; account creation,
  password acceptance, email handling, authentication, and session creation remain disabled;
- `@fetanagent/customer-web-access-foundation` records the settled intent only and returns
  `customer_web_access_runtime_not_implemented`; all web, PWA, authentication, email, session,
  Telegram-linking, persistence, platform-action, and financial capabilities remain false;
- all financial actions default to `dry_run`;
- the KemerBet executor cannot perform a final transfer action;
- Telegram polling is off until the bot is configured;
- no provider credential, Supabase key, account number, or customer evidence belongs in Git;
- reviewed private-schema migrations provide immutable deposit intents, provider evidence,
  duplicate-payment claims, expiry, review, retention, and queue foundations;
- the current API and worker database roles have no direct ledger access until narrow procedures
  and runtime login roles are reviewed; and
- the only current ledger procedures for the API are live-gated: one opens an unverified intent
  and returns frozen display-safe payment instructions, while the other records an already-encrypted
  customer transaction reference without verifying it or exposing ledger tables.
- the historical generic private Telegram inbox procedure is retired. The staging beta boundary is
  English-only and invite-only: only a one-time authorized team invitation may create an identity.
- the staging bot can now show an admitted-user menu and record a non-claiming KemerBet Player-ID
  request as `pending` through a dedicated database role and durable action nonce store.
- pending or merely found Player IDs are not usable for deposits; a distinct audited ownership
  confirmation is required to create the validated association;
- the reviewed dry-run intake may create only `intake_received` intents and `received` protected
  reference submissions while all four financial feature switches remain disabled;
- the private staging operations service may append a redacted local-fixture assessment and one
  advisory review decision, but neither record is provider evidence or a payment approval; and
- the Stage 1A CBE Birr shadow contract and private job/result boundary remain advisory and
  operationally inert: internal enqueue/list access accepts only normalized safe facts, processing
  remains disabled, existing intake/submission states stay unchanged, and the boundary cannot
  create authoritative evidence, claims, or financial jobs; and
- the Stage 1B authoritative-adapter fixtures are offline, synthetic normalization regressions
  only. They define no provider URL or private wire format and are not wired into the worker; and
- the Stage 1C attempt planner accepts only a validated intent snapshot and safe adapter result,
  treats duplicate-reference status as unavailable, and returns only an advisory completion or
  retry candidate without scheduling, persistence, approval, or execution; and
- the Stage 1D settlement planner can translate an exact safe lease receipt and Stage 1C result
  into a closed advisory completion or retry command, but emits no SQL and performs no database,
  network, job-acquisition, scheduling, persistence, approval, or execution work; and
- the Stage 1E `@fetanagent/cbe-birr-official-source-policy` boundary remains
  blocked-by-default: synthetic fixtures, browser visibility, known endpoints, and code flags are
  not permission, and the reserved `cbe_birr_official_receipt_lookup_v1` profile has no selected or
  permitted branch; and
- the Stage 1F `@fetanagent/cbe-birr-authoritative-lookup-prerequisite` package is also pure and
  blocked. Its 12 exact blockers cover five unresolved areas: source permission; receiver
  protection, provenance, and fresh immutable provisioning; submitted-reference key lifecycle;
  review of three distinct normalization profiles; and preflight-safe leasing. Every capability is
  false, and the package carries no protected material or runtime integration; and
- no provider evidence, payment claim, authoritative verification job, KemerBet call, withdrawal,
  or financial execution is enabled by this flow.

The private `app` database schema will use direct PostgreSQL connections only from the API, worker,
a separately reviewed beta-admission runtime, a narrow Player-ID action runtime, and a
nonce-retention maintenance process. Each future
credential belongs in its own VM runtime secret set, never Git or the bot, executor, dashboard,
browser profile, or logs. The maintenance identity is limited to a future bounded nonce-digest purge
and must never be reused by the API or worker. FetanAgent does not place a Supabase service-role key
in application configuration.

Each runtime has a dedicated configuration entry point. The API, worker, and executor do not
read or receive `TELEGRAM_BOT_TOKEN`; only the bot runtime reads it, and only when polling is
explicitly enabled. Deploy with separate per-process secret sets rather than a shared production
environment file.

## Current and planned components

| Component                                             | Responsibility                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Public responsive web/PWA                             | Canonical customer and neutral team workspace; not implemented                      |
| `apps/api`                                            | Transaction orchestration, validation, future web boundary, and audit boundaries    |
| `apps/admin`                                          | Existing private staging operations service; not the public neutral workspace       |
| `apps/bot`                                            | Optional private Telegram legacy transport; not customer authentication or recovery |
| `apps/worker`                                         | Disabled pure shadow planners; no provider transport or database runner             |
| `apps/maintenance`                                    | Internal nonce-retention privilege preflight; no scheduler or purge command         |
| `apps/executor`                                       | Isolated, supervised KemerBet browser adapter; dry-run first                        |
| `packages/domain`                                     | Money rules, state machines, limits, idempotency reason codes                       |
| `packages/cbe-birr-fixtures`                          | Strict local, redacted CBE Birr fixture parser and advisory dry-run decisions       |
| `packages/cbe-birr-authoritative-fixtures`            | Offline provider-shaped normalization fixtures for the advisory shadow contract     |
| `packages/cbe-birr-official-source-policy`            | Pure source-permission policy; fixed `unproven` and blocked                         |
| `packages/cbe-birr-authoritative-lookup-prerequisite` | Pure blocked lookup-prerequisite inventory; every capability is false               |
| `packages/customer-web-access-foundation`             | Pure blocked web/PWA product-decision record; no runtime or authentication          |
| `packages/contracts`                                  | Provider, executor, notifier, and storage interfaces                                |
| `packages/config`                                     | Safe environment parsing and feature switches                                       |
| `packages/i18n`                                       | Shared English message keys and safe locale normalization                           |

## Local development

Use Node.js 22 or later and pnpm 11 or later.

```powershell
pnpm install
pnpm build
pnpm test
```

Copy `.env.example` to `.env` only for local use. Do not add a real `.env` file to Git.

## Financial safety rules

1. Provider verification, KemerBet execution, and manual payout are separate states.
2. A provider result must be authoritative, fresh, receiver-matched, amount-matched, and
   uniquely recorded before it can reach execution.
3. Every uncertain provider or KemerBet outcome goes to review and reconciliation;
   it is never retried blindly.
4. The executor must reconcile wallet/history before retrying an uncertain collection.
5. External withdrawal payout remains manual in version 1.

## Language policy

FetanAgent-created customer, team-workspace, documentation, PDF, and exported-file content is
English only in version 1. Payment evidence and names may remain in the source language because they
are data, not interface copy. See [docs/language-policy.md](docs/language-policy.md).

See [docs/standalone-web-pwa.md](docs/standalone-web-pwa.md) for the settled customer product,
session/recovery safety status, optional Telegram-history link, PWA lifecycle, and canonical
vocabulary. See [docs/architecture.md](docs/architecture.md),
[docs/database-access.md](docs/database-access.md),
[docs/deposit-ledger.md](docs/deposit-ledger.md), and
[docs/provider-verification.md](docs/provider-verification.md), and
[docs/reference-protection.md](docs/reference-protection.md) for the current implementation,
database-access, provider-verification, and reference-protection boundaries. See
[docs/cbe-birr-authoritative-shadow.md](docs/cbe-birr-authoritative-shadow.md) for the disabled
Stage 1A safe-facts/queue boundary and offline Stage 1C/1D planners, and
[docs/cbe-birr-authoritative-adapter-fixtures.md](docs/cbe-birr-authoritative-adapter-fixtures.md)
for the offline-only Stage 1B normalization regressions. See
[docs/cbe-birr-official-source-policy.md](docs/cbe-birr-official-source-policy.md) for the
Stage 1E blocked-by-default source-permission contract and its P0 prerequisites, and
[docs/cbe-birr-authoritative-lookup-prerequisite.md](docs/cbe-birr-authoritative-lookup-prerequisite.md)
for the Stage 1F fail-closed prerequisite inventory. See
[docs/cbe-birr-fixture-dry-run.md](docs/cbe-birr-fixture-dry-run.md) for the current CBE Birr-only
fixture scope and its explicit non-live limits. See
[docs/telegram-inbound.md](docs/telegram-inbound.md) for the optional legacy Telegram boundary and
[docs/telegram-transport.md](docs/telegram-transport.md) for the separate signed transport boundary.
See [docs/player-registration.md](docs/player-registration.md) for the Player-ID request, review,
and explicit ownership-association boundary, and
[docs/telegram-conversation-actions.md](docs/telegram-conversation-actions.md) for the required
conversation/action gate.
