# FetanAgent

FetanAgent's settled product direction is a standalone, responsive web/PWA-first
payment-verification and betting-agent service. Customers may create and use FetanAgent accounts
through the intended self-service email-and-password flow without Telegram, associate multiple
KemerBet Player IDs, and enter through the same generic public sign-in and neutral workspace used by
authorized team members. Email ownership confirmation is requested only for forgot-password
recovery, not account creation or routine sign-in. Product copy is English-only.

The repository currently implements an English-only, invite-only Telegram staging slice, a unified
default-off customer deposit intake/status boundary for web and Telegram, a disabled authoritative
CBE foundation, and a disabled-by-default customer web authentication/workspace foundation. The
customer source includes a responsive PWA shell, generic account creation and
sign-in, server-handled Supabase Auth cookies, sign-out, forgot-password recovery, an immutable Auth
UUID-to-customer mapping, Player-ID submit/list actions, and protected deposit-reference/status
routes. The customer workspace uses a dedicated direct-PostgreSQL BFF/runtime with six exact private
functions. It is not
deployment-wired or publicly enabled, and it has no Player-ID ownership proof, validated association,
eligibility writer, authoritative CBE transport, or live financial activation. The pure
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

The source also contains a reviewed, disabled-by-default KemerBet execution safety core. A private
SQL migration defines a consume-only executor role boundary with six callable transition commands
for execution leasing, pre-action cancellation, one-shot final-action fencing, reconciliation
handoff and leasing, and reconciliation recording. Direct execution enqueue is internal to
`app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)`; neither executor role can
execute the enqueue function directly. `apps/executor` provides the matching
direct-PostgreSQL adapter and catalog preflight, one-shot runtime orchestration, and a strict
KemerBet workflow adapter. It now also contains a concrete Playwright page driver, exact
account-bound persistent-session registry, separate HMAC providers, polling/health entrypoint, and
an explicit-profile-only hardened Docker/Compose boundary with an isolated manual session
provisioner. `apps/worker` contains an injection-only, uncomposed settlement adapter and exact
one-function catalog preflight; it opens no connection and reads no configuration or credential.
TeleBirr's trusted completion function already calls that private finalizer atomically, so its
outcomes must never be sent through a second generic settlement runtime. The remaining generic
adapter has no authenticated provider-neutral producer and is disabled by construction; its exact
activation dependency map is documented in
[`infra/operations/verification-settlement-activation-dependencies.md`](infra/operations/verification-settlement-activation-dependencies.md).
The path remains operationally disabled: no selector, binding, HMAC key, browser profile, runtime
login, live database switch, or authoritative-verifier service is deployed or provisioned with
runtime credentials by the repository.

## Current safety status

The current foundation is deliberately safe:

- `apps/customer-web` and `@fetanagent/customer-web-auth-runtime` implement a reviewed SSR/PWA Auth
  foundation. A pinned non-root Docker target and isolated image smoke now build the real service,
  prove its credential-free entrypoint fails closed, and probe only its inert health boundary. Its
  internal gates still default off, and no Compose, Caddy, DNS, firewall, secret, or live route
  enables it;
- the source provides self-service email/password account creation, generic sign-in, sign-out,
  ordered Supabase cookie refresh effects hardened to Secure/HttpOnly host-only cookies, CSRF
  protection, and a recovery operation that commits cookie effects only after code exchange and
  password update both succeed;
- `@fetanagent/customer-web-workspace-runtime` is the dedicated direct-PostgreSQL BFF boundary. It
  can ensure the server-verified Auth UUID's customer account, submit a non-claiming KemerBet Player
  ID, list that identity's web-origin requests, open an owned policy-bounded deposit, capture only a
  server-protected reference, and list customer-safe deposit statuses. Its exact role cannot read
  tables or call unrelated functions. A seventh private function provides a bounded, durable,
  HMAC-pseudonymous fixed-window throttle for sensitive public routes; production startup now
  requires its fixed secret mount and fails closed when PostgreSQL cannot decide. Deposit writes
  additionally require three locked live
  switches, including the new authoritative-CBE switch that is created disabled;
- customer Player-ID copy is limited to `Checking`, `Ready`, and `Could not confirm`. `Ready` is
  unreachable for a web-origin request until a later proof-bearing ownership boundary is reviewed
  and implemented and an Owner separately records deposit eligibility. The list
  projection now also requires the exact current `eligible` decision and fails closed for missing,
  revoked, stale, future-dated, or malformed histories. It remains advisory display only; the
  deposit-intent trigger is the financial authorization boundary, and submit/list does not make a
  Player ID eligible for deposits;
- `@fetanagent/customer-web-player-ownership-proof-prerequisite` records the exact nine unresolved
  ownership-proof blockers and returns only
  `blocked / customer_web_player_ownership_proof_prerequisites_incomplete` for its valid metadata.
  Contract version 3 records `owner_deposit_eligibility_decision_required` while keeping all 19
  capabilities false. It cannot
  represent proof success, `Ready`, association, or deposit eligibility; it adds no database, role,
  app, runtime, network, configuration, or infrastructure capability;
- the intended long-lived routine experience is not a claim of an infinite or irrevocable session:
  per-device visibility, remote sign-out, and explicit global session revocation after recovery are
  not implemented, and production enablement still requires exact hosted Auth, SMTP, proxy/deploy
  configuration, plus an audit of effective `anon` and `authenticated`
  grants, exposed RPC/PostgREST surfaces, and RLS before issuing customer principals;
- `@fetanagent/customer-web-access-foundation` remains a historical, pure, non-runtime record of the
  settled product intent. Its blocked result does not enable or configure either implemented runtime;
- the optional Telegram-history link is still unimplemented and cannot be inferred from either Auth
  or the existing Telegram admission flow;
- the implemented workspace is customer-only; capability-based staff routing through the generic
  public entry remains a future boundary and must precede any staff use of this app;
- all financial actions default to `dry_run`;
- private execution-attempt and reconciliation ledgers require one one-shot attempt per intent,
  serialize blocking work per agent account, and prevent `executed` without a positive
  reconciliation. A dedicated executor role has execute access to exactly six private transition
  commands and no base-table, sequence, or direct-enqueue access. Only the separate atomic
  verified-settlement function can create its execution job;
- `apps/executor` now contains the corresponding database adapter and privilege preflight, guarded
  execution/reconciliation orchestration, and an agent-workflow adapter. The adapter can express the
  only post-fence `Transfer` click and requires both the exact success-modal player-credit delta and
  one unique in-window `Approved` `EPOS` history row before confirmation;
- the concrete browser/runtime composition is fail-closed behind fixed production paths, exact
  identity binding, authenticated-session/CAPTCHA probes, two distinct HMAC keys, catalog preflight,
  private loopback health, and explicit deployment profiles. The repository supplies none of the
  operational secrets, profiles, selector asset, runtime LOGIN, live database switches, deployment,
  or authoritative-verifier caller, so it cannot currently produce or execute a live job;
- `@fetanagent/contracts` now includes only deterministic, advisory KemerBet attempt,
  reconciliation, and agent-lane planning. Its network, browser, final-action, database, and retry
  capabilities are all false;
- the reusable KemerBet agent-system workflow learned from a controlled test is documented without
  recording that test transaction. It preserves the exact success-modal player-credit-delta and
  unique `Approved` `EPOS` history workflow, does not supply the missing production integration, and
  does not change FetanAgent's configured amount policy;
- Telegram polling is off until the bot is configured;
- no provider credential, Supabase key, account number, or customer evidence belongs in Git;
- reviewed private-schema migrations provide immutable deposit intents, provider evidence,
  duplicate-payment claims, expiry, review, retention, and queue foundations;
- `app.player_deposit_eligibility_decisions` now isolates ownership from financial eligibility. Its
  append-only latest-decision guard snapshots the exact `eligible` decision on every new intent;
  only the authenticated Owner-control runtime can append an audited approval or revocation for an
  already associated KemerBet Player ID; ownership actions never promote one automatically;
- the current API and worker database roles have no direct ledger access until narrow procedures
  and runtime login roles are reviewed; and
- the reviewed Telegram and customer-web procedures derive the actor from an admitted private event
  or server-verified Auth session, require current player eligibility, return display-safe payment
  instructions, accept only server-protected references, and expose customer-safe status. Live
  capture can enqueue one private authoritative verification job only when all three switches are
  locked live; no API or web path can create the required eligibility decision or provider evidence;
- the historical generic private Telegram inbox procedure is retired. The staging beta boundary is
  English-only and invite-only: only a one-time authorized team invitation may create an identity.
- the staging bot can now show an admitted-user menu and record a non-claiming KemerBet Player-ID
  request as `pending` through a dedicated database role and durable action nonce store.
- pending or merely found Player IDs are not usable for deposits; the legacy audited ownership
  confirmation creates only the validated association and does not grant financial eligibility;
- the reviewed dry-run intake remains limited to `intake_received`/`received`, while the default-off
  live intake advances an exact protected submission to `verification_enqueued` and its intent to
  `verification_pending` atomically with one private verify job. Every new intent still requires a
  separate latest `eligible` decision; no current customer runtime can write that decision, and all
  financial feature switches remain disabled;
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
- the historical Stage 1F `@fetanagent/cbe-birr-authoritative-lookup-prerequisite` package remains a
  pure blocked inventory, not an activation switch. The submitted-reference path now has two
  distinct cross-process keys and a machine-checked immutable version-1 identity profile, but source
  permission, receiver lookup provenance, authoritative transport/worker credentials, normalization,
  and safe provider leasing remain unresolved; and
- no provider evidence, payment claim, KemerBet call, withdrawal, or financial execution is enabled.
  Authoritative verification-job creation exists only behind the disabled three-switch boundary and
  there is no worker with permission to consume it.

The private `app` database schema uses direct PostgreSQL connections only from reviewed server
runtimes. These include the API, worker, beta-admission runtime, narrow Telegram Player-ID action
runtime, dedicated customer-web workspace runtime, nonce-retention maintenance process, and the
source-level KemerBet deposit executor boundary. The executor migration creates separate
`fetanagent_deposit_executor` and `fetanagent_deposit_executor_runtime` `NOLOGIN` roles; production
login/password provisioning is deliberately outside Git and has not been deployed. Each database
credential belongs in its own VM runtime secret set, never Git, a browser page or session object,
the bot, dashboard, or logs. The maintenance identity is limited to a future bounded nonce-digest
purge and must never be reused by the API or worker. FetanAgent does not place a Supabase
service-role key in application configuration.

Each runtime has a dedicated configuration entry point. The API, worker, and executor do not
read or receive `TELEGRAM_BOT_TOKEN`; only the bot runtime reads it, and only when polling is
explicitly enabled. Deploy with separate per-process secret sets rather than a shared production
environment file.

## Current and planned components

| Component                                                   | Responsibility                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/customer-web`                                         | Disabled SSR/PWA workspace with a non-root image and fail-closed CI smoke           |
| `apps/api`                                                  | Private Telegram actions, protected deposit intake/status, and audit boundaries     |
| `apps/admin`                                                | Existing private staging operations service; not the public neutral workspace       |
| `apps/bot`                                                  | Optional private Telegram legacy transport; not customer authentication or recovery |
| `apps/worker`                                               | Disabled pure shadow planners; no provider transport or database runner             |
| `apps/maintenance`                                          | Internal nonce-retention privilege preflight; no scheduler or purge command         |
| `apps/executor`                                             | Guarded one-shot KemerBet executor/runtime; deployment remains unprovisioned        |
| `apps/trusted-telebirr-verifier`                            | Export-only trusted verifier foundation; uncomposed, unprovisioned, and default-off |
| `packages/domain`                                           | Money rules, state machines, limits, idempotency reason codes                       |
| `packages/cbe-birr-fixtures`                                | Strict local, redacted CBE Birr fixture parser and advisory dry-run decisions       |
| `packages/cbe-birr-authoritative-fixtures`                  | Offline provider-shaped normalization fixtures for the advisory shadow contract     |
| `packages/cbe-birr-official-source-policy`                  | Pure source-permission policy; fixed `unproven` and blocked                         |
| `packages/cbe-birr-authoritative-lookup-prerequisite`       | Pure blocked lookup-prerequisite inventory; every capability is false               |
| `packages/customer-web-access-foundation`                   | Historical pure web/PWA decision record; no runtime or authentication               |
| `packages/customer-web-auth-runtime`                        | Server-only Supabase Auth adapter; disabled by configuration                        |
| `packages/customer-web-workspace-runtime`                   | Seven-function account, Player-ID, deposit, status, and durable throttle BFF        |
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
