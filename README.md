# PayReplayy

PayReplayy is a Telegram-first payment-verification and betting-agent automation service.
Version 1 starts with KemerBet deposits through TeleBirr and CBE Birr. It is designed so
other payment providers and platforms can be added without changing the financial core.

## Current safety status

The current foundation is deliberately safe:

- all financial actions default to `dry_run`;
- the KemerBet executor cannot perform a final transfer action;
- Telegram polling is off until the bot is configured;
- no provider credential, Supabase key, account number, or customer evidence belongs in Git;
- reviewed private-schema migrations provide immutable deposit intents, provider evidence,
  duplicate-payment claims, expiry, manual-review, retention, and queue foundations;
- the current API and worker database roles have no direct ledger access until narrow procedures
  and runtime login roles are reviewed.

The private `app` database schema will use direct PostgreSQL connections only from the API and
worker. Their future `DATABASE_URL` belongs in the VM runtime secrets, never Git or the bot,
executor, dashboard, browser profile, or logs. A Supabase service-role key is not an `app` schema
credential; if later needed for private Storage/Auth administration, it remains API/worker-only.

## Planned services

| Service              | Responsibility                                                                |
| -------------------- | ----------------------------------------------------------------------------- |
| `apps/api`           | Transaction orchestration, validation, dashboard-facing API, audit boundaries |
| `apps/bot`           | Private Telegram chat transport only                                          |
| `apps/worker`        | Durable verification, retention, alert, and reconciliation jobs               |
| `apps/executor`      | Isolated, supervised KemerBet browser adapter; dry-run first                  |
| `packages/domain`    | Money rules, state machines, limits, idempotency reason codes                 |
| `packages/contracts` | Provider, executor, notifier, and storage interfaces                          |
| `packages/config`    | Safe environment parsing and feature switches                                 |
| `packages/i18n`      | Shared English and Amharic message keys                                       |

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

See [docs/architecture.md](docs/architecture.md), [docs/database-access.md](docs/database-access.md),
[docs/deposit-ledger.md](docs/deposit-ledger.md), and
[docs/provider-verification.md](docs/provider-verification.md) for the current implementation,
database-access, and provider-verification boundaries.
