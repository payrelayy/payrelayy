# FetanAgent

FetanAgent is a Telegram-first payment-verification and betting-agent automation service.
The current product scope is an English-only, invite-only CBE Birr dry run plus a disabled
authoritative-shadow foundation and offline attempt planner. An admitted
customer with an Owner-confirmed KemerBet Player ID can open a 25-25,000 ETB intake, receive the
configured masked receiver instructions, and submit one protected transaction reference for Owner
review. A pure safe-facts evaluator, private shadow queue, and offline attempt planner can model
advisory outcomes, but no provider transport or worker runtime is configured. It has no provider call, payment verification
or claim, KemerBet execution, or live
financial action. TeleBirr and CBE bank are deferred until separately authorized, authoritative
adapters pass their own evidence, safety, and rollout gates.

## Current safety status

The current foundation is deliberately safe:

- all financial actions default to `dry_run`;
- the KemerBet executor cannot perform a final transfer action;
- Telegram polling is off until the bot is configured;
- no provider credential, Supabase key, account number, or customer evidence belongs in Git;
- reviewed private-schema migrations provide immutable deposit intents, provider evidence,
  duplicate-payment claims, expiry, manual-review, retention, and queue foundations;
- the current API and worker database roles have no direct ledger access until narrow procedures
  and runtime login roles are reviewed; and
- the only current ledger procedures for the API are live-gated: one opens an unverified intent
  and returns frozen display-safe payment instructions, while the other records an already-encrypted
  customer transaction reference without verifying it or exposing ledger tables.
- the historical generic private Telegram inbox procedure is retired. The staging beta boundary is
  English-only and invite-only: only a one-time Owner-issued invitation may create an identity.
- the staging bot can now show an admitted-user menu and record a non-claiming KemerBet Player-ID
  request as `pending` through a dedicated database role and durable action nonce store.
- pending or merely found Player IDs are not usable for deposits; a distinct audited Owner
  ownership confirmation is required to create the validated association;
- the reviewed dry-run intake may create only `intake_received` intents and `received` protected
  reference submissions while all four financial feature switches remain disabled;
- Owner Control may append a redacted local-fixture assessment and one advisory review decision,
  but neither record is provider evidence or a payment approval; and
- the Stage 1A CBE Birr shadow contract and private job/result boundary remain advisory and
  operationally inert: Owner enqueue/list access accepts only normalized safe facts, processing
  remains disabled, existing intake/submission states stay unchanged, and the boundary cannot
  create authoritative evidence, claims, or financial jobs; and
- the Stage 1B authoritative-adapter fixtures are offline, synthetic normalization regressions
  only. They define no provider URL or private wire format and are not wired into the worker; and
- the Stage 1C attempt planner accepts only a validated intent snapshot and safe adapter result,
  treats duplicate-reference status as unavailable, and returns only an advisory completion or
  retry candidate without scheduling, persistence, approval, or execution; and
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

## Planned services

| Service                                    | Responsibility                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `apps/api`                                 | Transaction orchestration, validation, dashboard-facing API, audit boundaries       |
| `apps/admin`                               | Owner-authenticated beta invite issue/revoke boundary; no browser database grant    |
| `apps/bot`                                 | Private Telegram chat transport only                                                |
| `apps/worker`                              | Disabled pure shadow evaluator/planner; no provider or database runner              |
| `apps/maintenance`                         | Manual read-only nonce-retention privilege preflight; no scheduler or purge command |
| `apps/executor`                            | Isolated, supervised KemerBet browser adapter; dry-run first                        |
| `packages/domain`                          | Money rules, state machines, limits, idempotency reason codes                       |
| `packages/cbe-birr-fixtures`               | Strict local, redacted CBE Birr fixture parser and advisory dry-run decisions       |
| `packages/cbe-birr-authoritative-fixtures` | Offline provider-shaped normalization fixtures for the advisory shadow contract     |
| `packages/contracts`                       | Provider, executor, notifier, and storage interfaces                                |
| `packages/config`                          | Safe environment parsing and feature switches                                       |
| `packages/i18n`                            | Shared English message keys and safe locale normalization                           |

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
3. Every uncertain provider or KemerBet outcome goes to manual review and reconciliation;
   it is never retried blindly.
4. The executor must reconcile wallet/history before retrying an uncertain collection.
5. External withdrawal payout remains manual in version 1.

## Language policy

FetanAgent-created customer, Owner/Admin, documentation, PDF, and exported-file content is English
only in version 1. Payment evidence and names may remain in the source language because they are
data, not interface copy. See [docs/language-policy.md](docs/language-policy.md).

See [docs/architecture.md](docs/architecture.md), [docs/database-access.md](docs/database-access.md),
[docs/deposit-ledger.md](docs/deposit-ledger.md), and
[docs/provider-verification.md](docs/provider-verification.md), and
[docs/reference-protection.md](docs/reference-protection.md) for the current implementation,
database-access, provider-verification, and reference-protection boundaries. See
[docs/cbe-birr-authoritative-shadow.md](docs/cbe-birr-authoritative-shadow.md) for the disabled
Stage 1A safe-facts/queue boundary and offline Stage 1C attempt planner, and
[docs/cbe-birr-authoritative-adapter-fixtures.md](docs/cbe-birr-authoritative-adapter-fixtures.md)
for the offline-only Stage 1B normalization regressions. See
[docs/cbe-birr-fixture-dry-run.md](docs/cbe-birr-fixture-dry-run.md) for the current CBE Birr-only
fixture scope and its explicit non-live limits. See
[docs/telegram-inbound.md](docs/telegram-inbound.md) for the private Telegram inbox boundary and
[docs/telegram-transport.md](docs/telegram-transport.md) for the separate signed transport boundary.
See [docs/player-registration.md](docs/player-registration.md) for the Player-ID request, review,
and explicit Owner association boundary, and
[docs/telegram-conversation-actions.md](docs/telegram-conversation-actions.md) for the required
conversation/action gate.
