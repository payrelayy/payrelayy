# PayReplayy

PayReplayy is a Telegram-first payment-verification and betting-agent automation service.
The current launch-preparation scope is an English-only, invite-only CBE Birr **fixture-only
dry run**. It has no provider call, credential, database claim, Telegram payment instruction, or
KemerBet execution. TeleBirr and CBE bank are deferred until separately authorized, authoritative
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
- the staged migration retires the historical generic private Telegram inbox procedure. Its staged
  beta boundary is English-only and invite-only: only a separately reviewed invite redemption may
  create an identity, and it remains inactive until its dedicated admission runtime is provisioned.
- a signed bot-to-API transport scaffold is disabled by default and is not launchable in production
  until the dedicated invite-admission transport, durable nonce store, and runtime are reviewed.
- an inert, non-claiming Player-ID request schema is in place, but it is not wired to Telegram,
  KemerBet, deposit intake, or a validator.

The private `app` database schema will use direct PostgreSQL connections only from the API, worker,
a separately reviewed beta-admission runtime, and a nonce-retention maintenance process. Each future
credential belongs in its own VM runtime secret set, never Git or the bot, executor, dashboard,
browser profile, or logs. The maintenance identity is limited to a future bounded nonce-digest purge
and must never be reused by the API or worker. PayReplayy does not place a Supabase service-role key
in application configuration.

Each runtime has a dedicated configuration entry point. The API, worker, and executor do not
read or receive `TELEGRAM_BOT_TOKEN`; only the bot runtime reads it, and only when polling is
explicitly enabled. Deploy with separate per-process secret sets rather than a shared production
environment file.

## Planned services

| Service                      | Responsibility                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `apps/api`                   | Transaction orchestration, validation, dashboard-facing API, audit boundaries       |
| `apps/bot`                   | Private Telegram chat transport only                                                |
| `apps/worker`                | Durable verification, alert, and reconciliation jobs                                |
| `apps/maintenance`           | Manual read-only nonce-retention privilege preflight; no scheduler or purge command |
| `apps/executor`              | Isolated, supervised KemerBet browser adapter; dry-run first                        |
| `packages/domain`            | Money rules, state machines, limits, idempotency reason codes                       |
| `packages/cbe-birr-fixtures` | Strict local, redacted CBE Birr fixture parser and advisory dry-run decisions       |
| `packages/contracts`         | Provider, executor, notifier, and storage interfaces                                |
| `packages/config`            | Safe environment parsing and feature switches                                       |
| `packages/i18n`              | Shared English message keys and safe locale normalization                           |

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

PayReplayy-created customer, Owner/Admin, documentation, PDF, and exported-file content is English
only in version 1. Payment evidence and names may remain in the source language because they are
data, not interface copy. See [docs/language-policy.md](docs/language-policy.md).

See [docs/architecture.md](docs/architecture.md), [docs/database-access.md](docs/database-access.md),
[docs/deposit-ledger.md](docs/deposit-ledger.md), and
[docs/provider-verification.md](docs/provider-verification.md), and
[docs/reference-protection.md](docs/reference-protection.md) for the current implementation,
database-access, provider-verification, and reference-protection boundaries. See
[docs/cbe-birr-fixture-dry-run.md](docs/cbe-birr-fixture-dry-run.md) for the current CBE Birr-only
fixture scope and its explicit non-live limits. See
[docs/telegram-inbound.md](docs/telegram-inbound.md) for the private Telegram inbox boundary and
[docs/telegram-transport.md](docs/telegram-transport.md) for the separate signed transport boundary.
See [docs/player-registration.md](docs/player-registration.md) for the forthcoming non-claiming
Player-ID registration model and
[docs/telegram-conversation-actions.md](docs/telegram-conversation-actions.md) for the required
conversation/action gate.
