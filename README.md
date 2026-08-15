# FetanAgent

FetanAgent's settled product direction is a standalone, responsive web/PWA-first
payment-verification and betting-agent service. Customers may create and use FetanAgent accounts
through the intended self-service email-and-password flow without Telegram, associate multiple
KemerBet Player IDs, and enter through the same generic public sign-in and neutral workspace used by
authorized team members. Email ownership confirmation is requested only for forgot-password
recovery, not account creation or routine sign-in. Product copy is English-only.

The repository currently implements an earlier English-only, invite-only Telegram staging slice for
a CBE Birr dry run, a disabled authoritative-shadow foundation with offline attempt and settlement
planners, and a disabled-by-default customer web authentication and non-financial workspace
foundation. The customer source now includes a responsive PWA shell, generic account creation and
sign-in, server-handled Supabase Auth cookies, sign-out, forgot-password recovery, an immutable Auth
UUID-to-customer mapping, and non-claiming Player-ID submit/list actions. The customer workspace uses
a dedicated direct-PostgreSQL BFF/runtime with only three exact private functions. It is not
deployment-wired or publicly enabled, and it has no Player-ID ownership proof, validated association,
deposit eligibility, or financial capability. The pure
`@fetanagent/customer-web-player-ownership-proof-prerequisite` package freezes the next web
ownership-proof boundary as advisory-only and blocked: no authoritative proof source, challenge,
delivery path, evidence protocol, or positive result has been selected, and it adds no runtime or
deployment wiring. A separate private, append-only eligibility ledger now makes every new deposit
intent require an explicit latest `eligible` decision, but no seed, backfill, promotion procedure,
runtime grant, route, UI, or customer status can create one. It is a fail-closed financial
quarantine, not proof or deposit enablement. Stage 1E specifies a pure, blocked-by-default
official-source policy whose current source status is `unproven`; it neither selects nor permits a
provider source. Stage 1F records the remaining authoritative-lookup blockers and keeps every lookup
capability false. Telegram is optional in the settled product and requires a separately reviewed
legacy-history link rather than becoming web authentication or recovery.

## Current safety status

The current foundation is deliberately safe:

- `apps/customer-web` and `@fetanagent/customer-web-auth-runtime` implement a reviewed SSR/PWA Auth
  foundation, but its internal gate defaults off and no Compose, Caddy, DNS, firewall, secret, or
  live route enables it;
- the source provides self-service email/password account creation, generic sign-in, sign-out,
  ordered Supabase cookie refresh effects hardened to Secure/HttpOnly host-only cookies, CSRF
  protection, and a recovery operation that commits cookie effects only after code exchange and
  password update both succeed;
- `@fetanagent/customer-web-workspace-runtime` is the dedicated direct-PostgreSQL BFF boundary. It
  can ensure the server-verified Auth UUID's customer account, submit a non-claiming KemerBet Player
  ID, and list only that identity's web-origin requests. Its exact role cannot read tables or call
  unrelated functions, and the web slice has no financial operation;
- customer Player-ID copy is limited to `Checking`, `Ready`, and `Could not confirm`. `Ready` is
  unreachable for a web-origin request until both a later proof-bearing ownership boundary and a
  separate financial eligibility-promotion boundary are reviewed and implemented. The list
  projection now also requires the exact current `eligible` decision and fails closed for missing,
  revoked, stale, future-dated, or malformed histories. It remains advisory display only; the
  deposit-intent trigger is the financial authorization boundary, and submit/list does not make a
  Player ID eligible for deposits;
- `@fetanagent/customer-web-player-ownership-proof-prerequisite` records the exact nine unresolved
  ownership-proof blockers and returns only
  `blocked / customer_web_player_ownership_proof_prerequisites_incomplete` for its valid metadata.
  Contract version 2 replaces the resolved coupling blocker with
  `deposit_eligibility_promotion_boundary_absent` while keeping all 19 capabilities false. It cannot
  represent proof success, `Ready`, association, or deposit eligibility; it adds no database, role,
  app, runtime, network, configuration, or infrastructure capability;
- the intended long-lived routine experience is not a claim of an infinite or irrevocable session:
  per-device visibility, remote sign-out, and explicit global session revocation after recovery are
  not implemented, and production enablement still requires exact hosted Auth, SMTP, trusted-proxy,
  shared fail-closed rate-limit configuration, plus an audit of effective `anon` and `authenticated`
  grants, exposed RPC/PostgREST surfaces, and RLS before issuing customer principals;
- `@fetanagent/customer-web-access-foundation` remains a historical, pure, non-runtime record of the
  settled product intent. Its blocked result does not enable or configure either implemented runtime;
- the optional Telegram-history link is still unimplemented and cannot be inferred from either Auth
  or the existing Telegram admission flow;
- the implemented workspace is customer-only; capability-based staff routing through the generic
  public entry remains a future boundary and must precede any staff use of this app;
- all financial actions default to `dry_run`;
- the KemerBet executor cannot perform a final transfer action;
- private dormant execution-attempt and reconciliation ledgers now require one one-shot attempt per
  intent, serialize blocking work per agent account, and prevent `executed` without a positive
  reconciliation; no runtime role can write those ledgers and no runner is wired;
- `@fetanagent/contracts` now includes only deterministic, advisory KemerBet attempt,
  reconciliation, and agent-lane planning. Its network, browser, final-action, database, and retry
  capabilities are all false;
- one sanitized manual KemerBet agent-system deposit is documented as an external-interface
  observation, but it does not enable the executor or change FetanAgent's configured amount policy;
- Telegram polling is off until the bot is configured;
- no provider credential, Supabase key, account number, or customer evidence belongs in Git;
- reviewed private-schema migrations provide immutable deposit intents, provider evidence,
  duplicate-payment claims, expiry, review, retention, and queue foundations;
- `app.player_deposit_eligibility_decisions` now isolates ownership from financial eligibility. Its
  append-only latest-decision guard snapshots the exact `eligible` decision on every new intent;
  no existing runtime can write a decision, and no ownership action promotes one;
- the current API and worker database roles have no direct ledger access until narrow procedures
  and runtime login roles are reviewed; and
- the only current ledger procedures for the API are live-gated: one can open an unverified intent
  only after the separate latest-eligibility guard passes and then returns frozen display-safe
  payment instructions, while the other records an already-encrypted customer transaction reference
  without verifying it or exposing ledger tables. No API path can create the required eligibility
  decision;
- the historical generic private Telegram inbox procedure is retired. The staging beta boundary is
  English-only and invite-only: only a one-time authorized team invitation may create an identity.
- the staging bot can now show an admitted-user menu and record a non-claiming KemerBet Player-ID
  request as `pending` through a dedicated database role and durable action nonce store.
- pending or merely found Player IDs are not usable for deposits; the legacy audited ownership
  confirmation creates only the validated association and does not grant financial eligibility;
- the reviewed dry-run intake remains limited to `intake_received` intents and `received` protected
  reference submissions, but every new intent also requires a separate latest `eligible` decision.
  No runtime can write that decision, and all four financial feature switches remain disabled;
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

The private `app` database schema uses direct PostgreSQL connections only from reviewed server
runtimes. These include the API, worker, beta-admission runtime, narrow Telegram Player-ID action
runtime, dedicated customer-web workspace runtime, and nonce-retention maintenance process. Each
credential belongs in its own VM runtime secret set, never Git or the bot, executor, dashboard,
browser profile, or logs. The maintenance identity is limited to a future bounded nonce-digest purge
and must never be reused by the API or worker. FetanAgent does not place a Supabase service-role key
in application configuration.

Each runtime has a dedicated configuration entry point. The API, worker, and executor do not
read or receive `TELEGRAM_BOT_TOKEN`; only the bot runtime reads it, and only when polling is
explicitly enabled. Deploy with separate per-process secret sets rather than a shared production
environment file.

## Current and planned components

| Component                                                   | Responsibility                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/customer-web`                                         | Disabled SSR/PWA account and non-financial Player-ID shell                          |
| `apps/api`                                                  | Transaction orchestration, validation, future web boundary, and audit boundaries    |
| `apps/admin`                                                | Existing private staging operations service; not the public neutral workspace       |
| `apps/bot`                                                  | Optional private Telegram legacy transport; not customer authentication or recovery |
| `apps/worker`                                               | Disabled pure shadow planners; no provider transport or database runner             |
| `apps/maintenance`                                          | Internal nonce-retention privilege preflight; no scheduler or purge command         |
| `apps/executor`                                             | Isolated, supervised KemerBet browser adapter; dry-run first                        |
| `packages/domain`                                           | Money rules, state machines, limits, idempotency reason codes                       |
| `packages/cbe-birr-fixtures`                                | Strict local, redacted CBE Birr fixture parser and advisory dry-run decisions       |
| `packages/cbe-birr-authoritative-fixtures`                  | Offline provider-shaped normalization fixtures for the advisory shadow contract     |
| `packages/cbe-birr-official-source-policy`                  | Pure source-permission policy; fixed `unproven` and blocked                         |
| `packages/cbe-birr-authoritative-lookup-prerequisite`       | Pure blocked lookup-prerequisite inventory; every capability is false               |
| `packages/customer-web-access-foundation`                   | Historical pure web/PWA decision record; no runtime or authentication               |
| `packages/customer-web-auth-runtime`                        | Server-only Supabase Auth adapter; disabled by configuration                        |
| `packages/customer-web-workspace-runtime`                   | Exact direct-PostgreSQL account and Player-ID BFF; disabled by configuration        |
| `packages/customer-web-player-ownership-proof-prerequisite` | Pure blocked ownership-proof inventory; no positive result or runtime               |
| `packages/contracts`                                        | Provider contracts plus pure advisory KemerBet fake planners                        |
| `packages/config`                                           | Safe environment parsing and feature switches                                       |
| `packages/i18n`                                             | Shared English message keys and safe locale normalization                           |

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
4. The current execution foundation authorizes no retry. Any later retry boundary must first prove
   non-execution through a separately reviewed reconciliation policy.
5. External withdrawal payout remains manual in version 1.

## Language policy

FetanAgent-created customer, team-workspace, documentation, PDF, and exported-file content is
English only in version 1. Payment evidence and names may remain in the source language because they
are data, not interface copy. See [docs/language-policy.md](docs/language-policy.md).

See [docs/standalone-web-pwa.md](docs/standalone-web-pwa.md) for the settled customer product,
session/recovery safety status, optional Telegram-history link, PWA lifecycle, and canonical
vocabulary. See [docs/architecture.md](docs/architecture.md),
[docs/database-access.md](docs/database-access.md),
[docs/deposit-ledger.md](docs/deposit-ledger.md),
[docs/kemerbet-agent-deposit-observation.md](docs/kemerbet-agent-deposit-observation.md),
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
explicit ownership-association boundary, and separate deposit-eligibility quarantine,
[docs/customer-web-player-ownership-proof.md](docs/customer-web-player-ownership-proof.md) for the
dormant nine-blocker ownership-proof prerequisite, and
[docs/telegram-conversation-actions.md](docs/telegram-conversation-actions.md) for the required
conversation/action gate.
