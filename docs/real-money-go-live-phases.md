# FetanAgent real-money go-live phases

This document is the single progress map for taking FetanAgent from the current public, financially
disabled release to a supervised five-account real-money pilot and, only after that pilot succeeds,
to a separate public real-money launch.

It is written for the Owner as well as engineers. Each phase has one purpose, concrete work, a
visible result, and an exit gate. A later phase must not be treated as complete because an earlier
screen, service, or database object merely exists.

## Status legend

- **COMPLETE** — implemented, deployed, and verified at the stated boundary.
- **NEXT** — the current critical-path phase.
- **PARALLEL NEXT** — may proceed alongside the current phase without enabling money.
- **BLOCKED** — deliberately unavailable until named prerequisites pass.
- **REPEATED** — an operational check that must run for every deployment or transaction.

## The whole path in one line

```text
Public product live
  -> KemerBet agent connected without transferring
  -> TeleBirr official receipt authority connected
  -> five-Player pilot prepared in dry-run
  -> provider shadow proof passes
  -> one 25 ETB payment is claimed and reserved
  -> one 25 ETB KemerBet transfer is fenced and reconciled
  -> four more Players pass sequentially
  -> separate production/public launch review
```

## Current truthful status — 2026-08-23

The current GitHub `main` source is
`de86ede3511b62332a6542fa60f571fcec8dc78e`. The currently visible public staging deployment may
still be an earlier exact reviewed release until the next bounded staging deployment; public
reachability must not be used as evidence that newer executor code is deployed.

| Capability                                          | Status                            | Current evidence                                                                                                   |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `fetanagent.com` public home and account entry      | **COMPLETE**                      | Public HTTPS home page responds and exposes Sign in/Create account                                                 |
| `@FetanAgentBot` reachability and public onboarding | **COMPLETE**                      | Bot is online; `/start`, menu, and Player-ID submission respond                                                    |
| Five private KemerBet test Player IDs               | **COMPLETE**                      | Latest aggregate database audit found exactly five active, valid, current, eligible Players                        |
| Owner fixed-pilot dashboard and server boundary     | **COMPLETE, financially dormant** | Merged, migration-applied, deployed; prepare/arm/status/stop cannot enable live money by themselves                |
| Private pilot database boundary                     | **COMPLETE, unprepared**          | Tables/RPCs are installed; no pilot revision, members, proof, reservation, job, or settlement exists               |
| Trusted TeleBirr backend foundation                 | **COMPLETE, unprovisioned**       | Least-privilege database boundary installed; runtime remains `NOLOGIN`, unconfigured, and unstarted                |
| Owner-adjustable TeleBirr/CBE receiver revisions    | **IMPLEMENTATION/DEPLOY NEXT**    | Authenticated Owner UI/API creates encrypted immutable revisions; source code contains no real account             |
| KemerBet executor safety foundation                 | **COMPLETE, unprovisioned**       | Consume-only database/one-shot fence/reconciliation boundary exists; runtime remains disabled                      |
| Real KemerBet portal workflow contract              | **NEXT**                          | Five lookup-only attempts: four resolved in ETB, one did not; no amount was entered and Transfer was never clicked |
| TeleBirr receiver/profile/signer/device             | **BLOCKED — not provisioned**     | No active TeleBirr receiver revision, profile, signer, or enrolled verifier device                                 |
| Payment verification, settlement, and execution     | **BLOCKED — disabled**            | All financial/provider/private-pilot switches remain disabled                                                      |
| Public real-money processing                        | **BLOCKED**                       | No public customer has authority to claim a payment or cause a KemerBet credit                                     |

The current public deployment is a time-boxed staging release. Its narrow database credentials and
host stop timer expire automatically. Until the separate production-launch phase, keeping the demo
visible requires a fresh exact-release staging deployment before each expiry. Public reachability is
not evidence of real-money readiness.

## Non-negotiable pilot contract

The first real-money pilot is fixed and cannot be expanded from an operator form:

- provider: TeleBirr only;
- cohort: exactly five approved KemerBet Player IDs;
- amount: exactly 25 ETB per transaction;
- per-Player cap: 25 ETB;
- aggregate cap: 125 ETB;
- immutable reservation count: five;
- duration: exactly two hours;
- execution: one transaction at a time;
- uncertainty: stop and reconcile; never blind-retry;
- public users outside the cohort: no real-money authority.

Changing the provider, amount, count, duration, or cohort model requires a new reviewed contract and
cannot be done by flipping an environment variable.

## Phase 0 — Keep the visible public product healthy

**Status: COMPLETE, then REPEATED for every deployment**

### Purpose

Keep the website and Telegram bot available so the Owner can see product progress while every money
action remains disabled.

### Required work

1. Deploy one exact reviewed GitHub `main` commit to the staging Supabase project and Droplet.
2. Start the API, customer web, Owner control, beta admission, Telegram bot, and HTTPS gateway.
3. Verify exact image revision, health, TLS, DNS, firewall, bot identity, zero bot restarts, and the
   dry-run runtime contract.
4. Confirm the executor, trusted verifier, and every financial switch remain disabled.
5. Refresh the bounded staging deployment before its automatic expiry when continued demo access is
   required.

### Owner-visible proof

- `https://fetanagent.com/` loads over valid HTTPS.
- Sign in and Create account are visible.
- `@FetanAgentBot` answers `/start` and `/menu`.
- Adding a Player ID produces a safe pending/validation response.

### Exit gate

Public product reachable; no payment lookup, claim, reservation, execution job, or KemerBet transfer
can be created by an ordinary user.

## Phase 1 — Correct and connect the KemerBet agent workflow

**Status: IN PROGRESS**

### Purpose

Connect the Owner's real KemerBet agent account to a no-money executor readiness probe before any
`Transfer` click is possible.

### Known live workflow

The controlled portal inspection established this sequence:

1. `/agents`;
2. financial-actions dropdown;
3. `Deposit` menu item;
4. `To Player` tile;
5. `Find By = Player ID`;
6. Player ID;
7. `Find`;
8. resolved account identity and `ETB`;
9. required Amount and optional Notes;
10. final `Transfer` button;
11. success result;
12. exact KemerBet history reconciliation.

No Amount or Notes value was entered and `Transfer` was never clicked during inspection. Four of
the five saved Player IDs advanced to an ETB account card; one stayed on the lookup form. The card
does not visibly render the submitted external Player ID, so a visible-card-only match is not an
acceptable authority boundary.

The current portal client uses one exact lookup contract:

- `GET https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=<Player ID>`;
- the structured response contains the submitted external Player ID and KemerBet's internal player
  ID;
- a later deposit request uses that returned internal player ID at
  `POST https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit`.

Player IDs and resolved identities remain private and must not be written to logs, documentation,
screenshots, or readiness output.

### Required engineering work

Progress recorded 2026-08-23:

1. **Merged to GitHub main:** the executor's exact deposit route is `/agents`; the old Payment
   Requests route is rejected.
2. **Merged to GitHub main:** the browser boundary now requires the real
   financial-actions trigger -> `Deposit` menu item -> `To Player` tile sequence. The controls are
   selected only through the exact reviewed contract; accessible-role or broad-text guesses are not
   allowed.
3. **Captured from the signed-in portal:** the financial trigger, `Deposit`, `To Player`, Find By
   selection, Player ID input, `Find`, Amount, Notes, and `Transfer` controls have exact CSS or
   accessible-name contracts. The real Find By control is an Ant Design combobox, not a native
   `<select>`.
4. **Implemented in the current publication branch:** start the exact lookup response wait before
   clicking `Find`; require the exact API origin, path, GET method, one exact `externalId` query,
   status 200, response external ID, positive internal player ID, ETB, and a response-bound visible
   identity. A hidden or swapped Player ID, identity, response, origin, method, path, or currency
   fails closed.
5. **Implemented in the current publication branch:** intercept the final deposit POST before it
   reaches the network and continue it only when its exact three-field body contains the
   response-bound internal player ID, the prepared amount, and empty Notes. Wrong/missing requests
   are aborted. This guard does not enable the executor or create authority to click Transfer.
6. Keep amount enforcement inside FetanAgent. The portal's Amount input exposes no trustworthy
   client-side minimum or maximum.
7. Verify the final success dialog and one unique matching `Approved`/`EPOS` history row.
8. Add regression tests for route drift, selector drift, swapped identity, logged-out session,
   CAPTCHA, wrong Player, wrong currency, wrong amount, missing success, ambiguous history, and
   response loss.

### Required provisioning work

1. **Complete:** use the authenticated Owner dashboard to prepare one private `platform_agent_accounts` revision
   with an opaque credential reference only. This control accepts no KemerBet password, OTP,
   cookie, session export, agent ID, username, or balance. Each adjustment creates a new immutable
   revision and retires the prior revision while all money/provider/pilot switches are disabled.
2. Build and pin one reviewed executor image digest.
3. Create one service-owned `0700` persistent browser-profile directory for the exact account UUID.
4. Run the transient headed session provisioner while the long-lived executor is stopped.
5. The Owner signs in manually. No password, OTP, cookie, or session export enters Git, chat,
   Supabase tables, or shared configuration.
6. Bind the visible signed-in agent identity to the account UUID with an independent HMAC key.
7. Install the reviewed selector contract, separate history-reference HMAC key, Supabase CA, and
   identity-binding map as root-managed fixed-path files.
8. Provision a short-lived dedicated executor database LOGIN outside Git, but do not start polling.

### Owner-visible proof

An internal readiness screen/log reports only:

```text
KemerBet agent connected
signed-in identity verified
ETB workflow found
test Player lookup verified
Transfer disabled
```

It must expose no agent identity, Player ID, cookie, password, or account balance.

### Exit gate

The exact real browser profile passes a no-transfer readiness probe on the target host. The
executor remains unable to lease work and no `Transfer` click has occurred.

The executor code exposes a dedicated no-transfer lookup operation that can return only an exact
response-bound Player/ETB match and `transferDisabled=true`; it does not fill Amount or click
Transfer. Its focused route/workflow/session/adapter suite currently passes 102 tests. The exit gate
is not yet satisfied because one of the five saved Player IDs did not resolve, the corrected code is
not yet published/deployed, and the fixed selector/profile files are not yet installed on the
executor host. The five-account pilot must not be prepared or activated until all five lookup-only
checks pass.

## Phase 2 — Provision official TeleBirr receipt authority

**Status: PARALLEL NEXT**

### Purpose

Make one official TeleBirr observation independently prove the payment reference, amount, time,
status, and intended receiver before any database settlement is possible.

### Required Owner inputs

- the exact receiving TeleBirr account, entered only through the authenticated Owner dashboard;
- the exact official credited-party name shown by TeleBirr;
- one dedicated Android phone under the Owner's control;
- the official TeleBirr app signed in on that phone.

Passwords, PINs, OTPs, cookies, raw receipts, and private keys must not be sent through chat, Git,
logs, screenshots, or ordinary database columns.

### Required engineering and provisioning work

1. Deploy the Owner receiver-control migration/UI, then create an immutable active TeleBirr
   receiver revision in that page. Never use chat, ad-hoc SQL, a copied bearer token, or Git.
2. Create the receiver profile binding the exact normalized credited-party name, parser version,
   policy, receiver revision, and configuration digest.
3. Generate a P-256 assignment-signing key; keep the private key in a root-owned secret file and
   store only the public key/fingerprint in PostgreSQL.
4. Finish the Android verifier's enrollment, lease, heartbeat, official-observation, signature,
   upload, replay, expiry, and revocation lifecycle.
5. Generate the device identity in Android Keystore and enroll only its public identity.
6. Compose the trusted backend as a dedicated service with its exact two-function database surface,
   pinned signer/device public keys, direct verify-full PostgreSQL connection, singleton behavior,
   bounded role validity, and no public ingress.
7. Provision its short-lived dedicated database LOGIN outside Git.
8. Prove the Android device and backend reject stale leases, revoked keys/devices, wrong receiver,
   wrong reference, unsupported layout, ambiguous status, unavailable provider, and replay.

### Owner-visible proof

```text
TeleBirr receiver configured
verifier phone enrolled
signatures valid
official observation authenticated
settlement disabled
```

### Exit gate

One fresh, real official TeleBirr observation is authenticated and manually compared with the
official app, but creates no payment claim, reservation, execution job, or KemerBet action.

## Phase 3 — Prepare the exact five-Player pilot in dry-run

**Status: BLOCKED until Phases 1 and 2 have their no-money proofs**

### Purpose

Freeze the exact cohort, receiver, provider, caps, and expiry without making any financial switch
live.

### Required work

1. Open the same-origin Owner dashboard; do not use copied bearer tokens, ad-hoc SQL, or terminal
   `curl` commands.
2. Select the exact five active, valid, currently eligible KemerBet Players.
3. Prepare the fixed TeleBirr pilot with its server-generated configuration digest.
4. Review the aggregate projection: five Players, 25 ETB per transaction/Player, 125 ETB aggregate,
   five reservations, two-hour window.
5. Arm it only with the explicit dry-run confirmation.
6. Test the always-visible emergency Stop control and idempotent recovery using a disposable dry-run
   revision before the real window.
7. Install the canonical root-managed pilot manifest on the executor host. It contains only contract
   version, pilot revision UUID, and configuration digest.

### Owner-visible proof

The dashboard reports:

```text
Pilot armed: dry-run only
Players: 5
Provider: TeleBirr
Per Player: 25 ETB
Total: 125 ETB
Reservations: 5
Financially active: No
Emergency stop: Available
```

### Exit gate

The pilot is armed and unexpired, its configuration digest matches the executor manifest, and every
provider/payment/execution/final-action switch remains non-live.

## Phase 4 — Run TeleBirr shadow verification

**Status: BLOCKED until Phase 3**

### Purpose

Exercise the complete provider path with real official observations while settlement and execution
remain impossible.

### Required work

1. Submit a fresh pilot proof through the intended website or Telegram flow.
2. Lease it only to the enrolled verifier device.
3. Retrieve and authenticate the official TeleBirr observation.
4. Recompute protected-reference, receiver, policy, database-snapshot, assignment, device, and
   outcome digests.
5. Compare the result manually with the official TeleBirr app.
6. Exercise rejected, review-required, provider-unavailable, duplicate, expired, and revoked-device
   paths.
7. Confirm no claim, reservation, job, or balance change can exist.

### Owner-visible proof

The customer sees a truthful non-financial status such as `verification under review` or
`payment observed`; the Owner sees an authenticated redacted result and a manual comparison record.
KemerBet history and balances are unchanged.

### Exit gate

The exact source/parser/receiver/signature/replay matrix passes on the real device and current
TeleBirr layout. Any unknown layout remains review-only.

## Phase 5 — Enable claim, reservation, and enqueue with execution disabled

**Status: BLOCKED until Phase 4**

### Purpose

Prove exactly-once financial accounting before permitting an external KemerBet click.

### Required work

1. Apply one reviewed forward-only staging activation migration for the exact pilot revision and
   configuration digest.
2. Enable only the minimum verification/claim/settlement gates needed for the pilot.
3. Keep KemerBet execution and final action disabled.
4. Submit one new 25 ETB proof for one allowlisted Player.
5. Authenticate the official observation.
6. Atomically create the receipt-derived intent, evidence, verification outcome, global claim,
   immutable 25 ETB reservation, settlement, and one execution job.
7. Replay the same completion and prove it returns the same records rather than creating duplicates.
8. Attempt a duplicate reference and prove it cannot create another claim or reservation.
9. Verify the Owner emergency stop prevents new work.

### Owner-visible proof

```text
Payment verified
Amount: 25 ETB
Reserved exactly once
KemerBet execution: Waiting / Disabled
```

KemerBet balance and history remain unchanged.

### Exit gate

One exact immutable job exists, all cap/duplicate/replay checks pass, and the executor cannot lease or
click it yet.

## Phase 6 — Execute and reconcile the first real 25 ETB transaction

**Status: BLOCKED until Phase 5**

### Purpose

Run the first genuine end-to-end transaction with a maximum external exposure of 25 ETB.

### Required work

1. Recheck current GitHub commit, Supabase migration ledger, pilot digest, remaining time, Player
   eligibility, receiver profile, verifier device/signer, agent session, and executor image digest.
2. Enable the exact private-pilot executor and final-action gates through the reviewed activation
   path.
3. Start one executor replica; acquire its singleton lock and pass catalog/profile readiness.
4. Lease only the one reserved job.
5. Prepare the KemerBet page and verify exact Player, ETB, and 25.00 amount without clicking.
6. Acquire the database final-action fence immediately before the irreversible action.
7. Click `Transfer` exactly once.
8. Capture the exact success response if available; absence is uncertainty, never permission to
   retry.
9. Reconcile one unique matching KemerBet `Approved`/`EPOS` history row in the bounded window.
10. Reconcile the official TeleBirr payment, database claim/reservation/job, KemerBet result/history,
    and customer-visible status.
11. Stop the pilot on any mismatch or uncertainty.

### Owner-visible proof

The website and Telegram status show one completed 25 ETB deposit for the intended test Player. The
Owner separately sees the matching official TeleBirr observation and KemerBet history entry.

### Exit gate

Exactly one payment was claimed, exactly one 25 ETB reservation was consumed, exactly one KemerBet
credit was observed, and no retry or duplicate exists. If the result is uncertain, this phase is not
complete until manual reconciliation resolves it.

## Phase 7 — Complete the remaining four supervised pilot transactions

**Status: BLOCKED until Phase 6**

### Purpose

Test each remaining Player independently without increasing per-transaction exposure.

### Required work

For each remaining Player, repeat Phase 6 sequentially. Before each transaction, recheck every live
authority and remaining pilot budget. Do not batch, queue, or pre-fence multiple transfers.

After each transaction record only redacted evidence:

- transaction sequence number 1–5;
- 25 ETB amount;
- provider/outcome state;
- reservation/job/reconciliation state;
- exact release/digest versions;
- whether emergency stop was exercised;
- no raw reference, receipt, Player ID, agent identity, account number, or credential.

### Owner-visible proof

The private pilot dashboard reports five consumed reservations, 125 ETB total, and five resolved
customer statuses. KemerBet history contains five unique matching credits.

### Exit gate

All five transactions are individually reconciled. Any unresolved uncertainty blocks advancement.
The Owner stops the pilot with reason `pilot_complete`.

## Phase 8 — Post-pilot defect and operations review

**Status: BLOCKED until Phase 7**

### Purpose

Decide whether the pilot evidence supports further testing. Five successes do not prove the system
is perfect.

### Required work

1. Review every timeout, retry refusal, UI drift, provider ambiguity, latency, and operator action.
2. Exercise stop, provider revocation, device revocation, signer rotation, expired pilot, expired
   runtime roles, executor crash after fence, response loss, and reconciliation recovery.
3. Verify redacted logs, alerts, backup/restore, evidence retention, and incident instructions.
4. Remove any manual/ad-hoc access used during development.
5. Complete current Ethiopian legal/licensing/compliance, age/eligibility, responsible-use,
   privacy, customer-support, dispute, refund, and accounting review.
6. Fix defects through reviewed code/migrations and repeat the affected pilot phase.

### Owner-visible proof

One go/no-go report classifies every issue as resolved, accepted with an explicit limit, or blocking.

### Exit gate

No unresolved money-loss, duplicate-credit, wrong-recipient, security, compliance, or recovery
blocker remains. The decision is still private-pilot-only unless Phase 9 is separately approved.

## Phase 9 — Separate production and public real-money launch

**Status: BLOCKED; not authorized by pilot success**

### Purpose

Move from a five-account staging pilot to a separately controlled production system.

### Required work

1. Create a new public-launch proposal defining eligibility, geography, age controls, limits,
   provider scope, support, disputes, monitoring, rollout percentage, and rollback.
2. Repeat all migrations, grants, advisors, credential provisioning, image builds, selector/profile
   proofs, device/signer enrollment, DNS/TLS/firewall checks, and recovery tests against the exact
   production project and runtime identities.
3. Do not copy staging passwords, browser profiles, role credentials, pilot manifests, or private
   keys into production.
4. Replace the five-account pilot with a production authorization model reviewed for public users.
5. Launch gradually with lower initial exposure, live monitoring, circuit breakers, and an
   always-available Owner stop.

### Owner-visible proof

The public product clearly distinguishes pending, verified, credited, rejected, and review states;
support and legal disclosures are published; monitored production transactions reconcile exactly.

### Exit gate

The Owner signs a separate production go/no-go after technical, operational, financial, security,
and legal evidence passes. This is the only phase that makes real-money processing available beyond
the fixed five-account cohort.

## Phase 10 — Continuous live operations

**Status: BLOCKED until Phase 9**

### Purpose

Keep the live system correct after launch rather than treating deployment as completion.

### Repeated controls

- monitor provider/device/signer/session health and role expiry;
- monitor claims, reservations, executions, uncertainty, and reconciliation age;
- rotate keys and credentials through reviewed procedures;
- review portal/provider layout changes before accepting them;
- stop automatically on duplicate, receiver mismatch, cap exhaustion, parser drift, or unresolved
  fenced action;
- reconcile financial totals daily;
- test restore and incident procedures regularly;
- redeploy only exact reviewed commits with green quality, disposable PostgreSQL, and image-smoke
  checks.

## Critical path and parallel work

To move quickly without skipping safety:

- Phase 1 (KemerBet connection) and Phase 2 (TeleBirr authority) should proceed in parallel.
- Phase 3 begins only after both no-money readiness proofs pass.
- Phases 4–7 are strictly sequential because each one adds financial authority.
- Public web/bot maintenance continues in parallel but never counts as financial progress.
- Compliance and operational preparation should begin during Phases 1–4; it remains a launch gate
  even if the technical pilot succeeds.

## Progress-update format

Every future progress update should use this compact format:

```text
Current phase:
What changed:
Visible proof:
Money moved: Yes/No — amount
What remains:
Next action:
Blocker requiring Owner input:
```

Do not describe a phase as complete without its exit-gate evidence. Do not report lines of code,
local tests, or a merged pull request as a live capability unless the exact release is also deployed
and its live postcondition is verified.

## Secret and evidence rules

Never put any of the following in this document, Git, chat, screenshots, analytics, or ordinary
logs:

- KemerBet or TeleBirr passwords, PINs, OTPs, cookies, or tokens;
- private keys or HMAC keys;
- raw transaction references or receipts;
- receiver account numbers;
- Player IDs, customer UUIDs, agent IDs, or raw signed-in identities;
- database passwords or Supabase secret/service-role keys.

Use aggregate counts, internal opaque IDs, fixed configuration digests, Git commit SHAs, workflow
run URLs, and redacted outcome states as evidence.

## Related technical contracts

- [`reference-protection.md`](reference-protection.md) — proof-reference and Owner receiver-account
  encryption, masking, immutable rotation, and remaining decrypt/source blockers.
- [`private-live-money-pilot.md`](private-live-money-pilot.md) — exact five-account financial and
  database authority contract.
- [`../infra/executor.md`](../infra/executor.md) — KemerBet executor deployment, session
  provisioning, and activation blockers.
- [`../infra/operations/verification-settlement-activation-dependencies.md`](../infra/operations/verification-settlement-activation-dependencies.md)
  — settlement composition and non-overlap requirements.
- [`../apps/trusted-telebirr-verifier/README.md`](../apps/trusted-telebirr-verifier/README.md) — trusted
  backend boundary and provisioning blockers.
- [`../android/telebirr-verifier/README.md`](../android/telebirr-verifier/README.md) — Android
  verifier status and operational gaps.
