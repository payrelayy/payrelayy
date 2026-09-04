# FetanAgent real-money go-live phases

This document is the single progress map for taking FetanAgent from the current financially
disabled release to a Telegram-first, supervised five-account real-money pilot and, only after that
pilot succeeds, to a separate public Telegram real-money launch.

It is written for the Owner as well as engineers. Each phase has one purpose, concrete work, a
visible result, and an exit gate. A later phase must not be treated as complete because an earlier
screen, service, or database object merely exists.

## Telegram-first release scope — 2026-09-03

The Owner has made Telegram the only customer channel for the initial release. Customers should
start, select a Player ID, submit payment references, track results, and get help inside
`@FetanAgentBot`. Customer website/PWA, app, email signup, and web-to-Telegram account linking are
deferred until the bot's agreed workflows are complete and reliable. Earlier web-first and
Telegram-as-legacy-only descriptions are future design history, not prerequisites for this release.

Use the existing backend, private Owner controls, local KemerBet companion, and verifier as the
bot's operational support. This scope change does not require shutting down existing services or
rebuilding Owner administration inside Telegram. Prioritize work that completes a customer
transaction or removes a demonstrated blocker to it.

The immediate milestone is one fully reconciled TeleBirr deposit initiated and completed through
Telegram, followed by the existing five-Player pilot. TeleBirr is the first integration to finish;
CBE Birr and withdrawals remain planned bot capabilities with their own completion requirements.
A working TeleBirr deposit pilot is not completion of the entire bot.

## Next delivery milestone — Telegram deposit from submission to confirmed result

Three workstreams can proceed together while the existing financial gates remain in force:

1. **Telegram deposit conversation and result tracking.** Build a guided Deposit flow, explicit
   Player-ID selection, TeleBirr receiver instructions, reference submission, cancellation before
   financial commitment, Help, and a customer-safe status view. The verified receipt supplies the
   amount; do not restore the historical customer-entered amount flow. Start with a direct
   transaction reference, then add the other agreed URL/SMS/file inputs. Keep one durable request
   identity from submission through verification and execution, and deliver the confirmed or
   review-required outcome back to the originating private chat.
2. **KemerBet account connection and execution.** Complete Phase 1's exact local-session validation,
   device pairing, and five sequential read-only Player lookups. Then connect the existing guarded
   execution/reconciliation core to the selected local companion path for the later pilot. A
   successful sign-in or lookup alone does not complete automatic execution.
3. **TeleBirr verification.** Complete Phase 2's receiver/profile/device provisioning and fresh
   official-receipt verification, then connect the validated result to the existing atomic
   settlement path. Receipt amount, receiver, freshness, and duplicate checks must decide the
   outcome before a KemerBet job can be created.

The first deployed slice is Telegram proof-request tracking. The implementation now returns
a `p1.` tracking reference and Check status button from proof intake, handles its command/callback
through an authenticated same-identity lookup, and reports the immutable simulation status after
runtime restarts. The migration and API's eleven-function preflight shipped together in release
`8e46eabb770680cd4885a09815df7f8e0aec73e1`. This remains simulation-only tracking, not live payment
processing. Details are in [`telegram-deposit-proof-tracking.md`](telegram-deposit-proof-tracking.md)
and the [cloud release evidence](telegram-deposit-cloud-release-2026-09-03.md).

The deployed release also accepts a TeleBirr receipt URL or pasted SMS after the explicit
`/deposit telebirr <Player ID>` prefix. It extracts one bounded candidate locally, preserves the
existing proof/tracking identity, and requires explicit resubmission when multiple IDs are found.
It does not fetch customer URLs, trust pasted amounts, add live verification, or change a financial
gate. CBE Birr still accepts only a direct reference. The delivered executor image additionally rejects stale
final-action authority after a delayed fence response or browser preparation and at the click/request
boundary; expired or uncertain fenced attempts remain reconciliation-only. The executor service
itself remains stopped. These release checks do not establish a completed pilot transaction.

The remaining guided-flow baseline is:
`apps/bot/src/index.ts` wires `/start`, `/menu`, Player-ID actions, the amount-free
`/deposit <provider> <Player ID> <transaction reference>` command (with the TeleBirr text-input
extension above), and `/deposit_status`.
`apps/bot/src/private-menu.ts` renders only Add KemerBet Player ID. The proof command reaches a
dry-run-only API capture; its new status operation is separate from the legacy deposit-intent
lookup. Preserve that explicit distinction when implementing live proof lineage, guided buttons,
and durable completion notifications. Do not promote old simulation records into live payments.
The guided draft/resume/cancel boundary must be durable and identity-bound; the existing
Player-ID registration action tables are registration-specific and must not be repurposed by merely
adding an enum value or storing deposit state in bot memory.

The milestone passes when a pilot customer uses Telegram to submit one fresh reference, sees its
progress, and receives completion only after exactly one verified payment and one matching KemerBet
credit reconcile. Duplicate updates/references must not create another credit; restart, session
expiry, and an uncertain browser outcome must preserve the request and show an honest pending or
review status. Exercise failure cases with fixtures or read-only checks, not deliberate real-money
faults. Continue to the remaining four pilot transactions using the existing bounded sequence.

Bot feature completion additionally requires the agreed CBE Birr path, receipt input formats,
saved Player-ID management, transaction history, support/review handling, and the separately
validated withdrawal workflow. Establish withdrawal completion evidence and distinguish the
KemerBet action from external payout. Any initial manual payout step must be visible to the Owner
and reflected honestly in customer status. Resume customer app/web work only after the agreed bot
scope is working and its operational defects are resolved.

## Settled KemerBet integration requirement — 2026-09-03

The Owner currently performs deposits and withdrawals manually through their own KemerBet agent
account. The intended product is for FetanAgent to perform those routine agent operations after
launch, within the workflows and limits the Owner enables. The Owner will authorize that use and
supply their KemerBet agent username and password through the private local sign-in flow. In this
document, **Owner means the FetanAgent operator who controls the agent account**, not the owner of
the KemerBet company.

The selected integration is automation of that existing agent-system workflow using the Owner's
authenticated local browser session. Contacting KemerBet's company, obtaining its owner's
involvement, or obtaining an official integration API is not a project prerequisite. An official
API is not needed to implement the demonstrated browser workflow. Payment-provider verification
below refers to checking incoming TeleBirr or CBE Birr payments; it is a separate part of the
deposit flow.

The earlier manual deposit demonstration is recorded in
[`kemerbet-agent-deposit-observation.md`](kemerbet-agent-deposit-observation.md). The production
deposit target is: verify the incoming payment, resolve the exact Player ID and ETB currency, enter
the verified amount, submit Transfer once, reconcile the exact player credit against agent history,
and update the customer's status automatically. Routine successful deposits should not require the
Owner to repeat those steps or approve each browser click. Reauthentication, changed pages, and
uncertain outcomes may still require the Owner's attention. The supervised pilot is a rollout
stage, not the permanent fulfillment model.

KemerBet agent-side withdrawal automation is also part of the intended product. The checked-in
observation currently records deposit mechanics and explicitly defers withdrawal testing; it does
not establish a tested withdrawal workflow. Recover or document the exact withdrawal steps and
their completion evidence before implementing that later phase. Agent-side withdrawal completion
and sending an external TeleBirr/CBE Birr payout are separate operations.

This records the product direction and the Owner's intent to provide runtime authorization. It does
not claim that the companion already executes transfers or that live processing has been activated.
The remaining connection, verification, pilot, and launch work below still applies.

## Status legend

- **COMPLETE** — implemented, deployed, and verified at the stated boundary.
- **NEXT** — the current critical-path phase.
- **PARALLEL NEXT** — may proceed alongside the current phase without enabling money.
- **BLOCKED** — deliberately unavailable until named prerequisites pass.
- **REPEATED** — an operational check that must run for every deployment or transaction.

## The whole path in one line

```text
Telegram bot reachable
  -> Telegram deposit flow + local KemerBet connection + TeleBirr verification prepared in parallel
  -> five-Player pilot prepared in dry-run
  -> provider shadow proof passes
  -> one 25 ETB payment is claimed and reserved
  -> one 25 ETB KemerBet transfer is fenced and reconciled
  -> four more Players pass sequentially
  -> remaining bot workflows and operations validated
  -> separate production/public Telegram launch review
  -> customer app/web later
```

## Current truthful status — 2026-09-04

The verified application/image baseline is
`8e46eabb770680cd4885a09815df7f8e0aec73e1`. The private proof-status migration is installed,
the API's eleven-function preflight passed, and Telegram's queue-preserving activation and public
HTTPS smoke checks passed. The operational workflow repair is
`920125e4f0c12a3e631645602b358d57f998b419`; its separate SHA does not change the installed images.
All six containers are running at the application SHA with zero restarts and all five health checks
passing. Public home, sign-in, and Owner entry returned HTTPS 200. The private Telegram command
menu now lists `/start`, `/menu`, `/deposit`, `/deposit_status`, and `/help` with simulation-only
deposit wording. See the [cloud release evidence](telegram-deposit-cloud-release-2026-09-03.md).

The Owner requested continuous availability on 2026-09-03. The former 2026-09-04 shutdown policy
is superseded by the [continuous-availability procedure](../infra/staging-continuous-availability.md):
four non-expiring application login lifetimes plus a disabled/absent expiry timer, verified together.
Continuous availability is separate from production and real-money readiness.

The Windows companion v0.1.2 release (Git tag `windows-companion-v0.1.2`),
built from `de960b4b63e4a832f8681aebb9537482ca6b0d42`, is published and installed on the Owner's
`D:` drive. Its earlier download check returned HTTP 200 and GitHub's uploaded digest matched the
local SHA-256; this cloud rollout did not replace that package. Public reachability and a working
local window remain separate from financial readiness.
The retired hosted preview's historical results are portal-contract evidence, not current authority
to operate a KemerBet account.

| Capability                                        | Status                             | Current evidence                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetanagent.com` public home and account entry    | **COMPLETE**                       | Public HTTPS home page responds and exposes Sign in/Create account                                                                                                                                                                                                                                                      |
| `@FetanAgentBot` deployment and runtime           | **COMPLETE**                       | Deployment smoke passed and the bot is running; this final runtime check did not send a fresh `/start`                                                                                                                                                                                                                  |
| Five private KemerBet test Player IDs             | **COMPLETE**                       | Latest aggregate database audit found exactly five active, valid, current, eligible Players                                                                                                                                                                                                                             |
| Owner fixed-pilot dashboard and server boundary   | **COMPLETE, financially dormant**  | Merged, migration-applied, deployed; prepare/arm/status/stop cannot enable live money by themselves                                                                                                                                                                                                                     |
| Private pilot database boundary                   | **COMPLETE, unprepared**           | Tables/RPCs are installed; no pilot revision, members, proof, reservation, job, or settlement exists                                                                                                                                                                                                                    |
| Trusted TeleBirr backend foundation               | **COMPLETE, unprovisioned**        | Deployed verifier boundary remains dormant; migrations are applied and source includes the authenticated bridge, private broker, local-only transport, guarded broker startup, and a no-port container target, but secrets, runtime LOGIN, and bridge deployment remain unprovisioned                                   |
| Owner-adjustable TeleBirr/CBE receiver revisions  | **DEPLOYED; REDACTED CHECK READY** | Owner reports both receivers saved through the authenticated UI; the exact-commit read-only TeleBirr broker readiness workflow is ready to verify active protected receiver and pilot/profile state without emitting private receiver data                                                                              |
| KemerBet executor safety foundation               | **COMPLETE, unprovisioned**        | Consume-only database/one-shot fence/reconciliation boundary exists; runtime remains disabled                                                                                                                                                                                                                           |
| Historical hosted KemerBet preview and seal       | **RETIRED / HIDDEN**               | Repeated headless, CAPTCHA, request-transition, and session-retention failures make the Droplet-hosted preview unsuitable as the production connection path                                                                                                                                                             |
| Windows companion v0.1.2 package and installation | **COMPLETE — NO-MONEY**            | Published exact-release package installed on D:; extracted-ZIP imports, 64 companion tests, 36 dependency tests, and all GitHub checks passed                                                                                                                                                                           |
| Local KemerBet session validation                 | **NEXT — PAGE CANDIDATE ONLY**     | Sandboxed dedicated Chrome displayed the agent page/account header and survived one refresh; the exact `/agents` main frame is only a candidate, not exact account or authenticated-session proof                                                                                                                       |
| Signed exact-five companion pairing and lookup    | **NEXT — NOT WIRED**               | Provider-neutral signed contracts exist, but Owner-device pairing, assignment execution, and signed-result acceptance are not wired into the companion/server path                                                                                                                                                      |
| TeleBirr receiver/profile/signer/device           | **NEXT — VERIFY/PROVISION**        | Pairing/command/ack codecs, both scoped PostgreSQL runtimes, both fixed Unix-socket adapters, guarded fail-closed lifecycles, and no-port images exist in source; verify the Owner-saved receiver, then provision the exact profile, scoped opening key, signer, broker credentials, bridge origin, and dedicated phone |
| Payment verification, settlement, and execution   | **BLOCKED — disabled**             | All financial/provider/private-pilot switches remain disabled                                                                                                                                                                                                                                                           |
| Public real-money processing                      | **BLOCKED**                        | No public customer has authority to claim a payment or cause a KemerBet credit                                                                                                                                                                                                                                          |

The current release is still financially disabled. In particular,
`FINANCIAL_ACTIONS_MODE=dry_run`, `KEMERBET_EXECUTOR_ENABLED=false`,
`KEMERBET_FINAL_ACTION_ENABLED=false`, `KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false`, and
`INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false` remain required. Public reachability, a visible
Owner screen, a launched companion, or a historical lookup is not evidence of real-money readiness.

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

## Phase 0 — Keep the Telegram bot and its supporting services healthy

**Status: COMPLETE, then REPEATED for every deployment**

### Purpose

Keep the Telegram bot and its existing backend/Owner controls available while every money action
remains disabled. Customer website/app development is deferred.

### Required work

1. Deploy one exact reviewed GitHub `main` commit to the staging Supabase project and Droplet.
2. Keep the API, Owner control, required admission service, Telegram bot, and HTTPS gateway healthy.
   The existing customer web service is not a new Telegram launch deliverable.
3. Verify exact image revision, health, TLS, DNS, firewall, bot identity, zero bot restarts, and the
   dry-run runtime contract.
4. Confirm the executor, trusted verifier, and every financial switch remain disabled.
5. Verify the four application login lifetimes have no expiry and the former shutdown timer is
   disabled/absent with no next trigger; preserve explicit emergency stop and financial controls.

### Owner-visible proof

- `@FetanAgentBot` answers `/start` and `/menu`.
- Adding a Player ID produces a safe pending/validation response.
- The existing private Owner controls remain accessible for provisioning and operations.

### Exit gate

Telegram is reachable; no payment lookup, claim, reservation, execution job, or KemerBet transfer can
be created by an ordinary user.

## Phase 1 — Correct and connect the KemerBet agent workflow

**Status: IN PROGRESS — v0.1.2 PUBLISHED/INSTALLED; EXACT SESSION PROOF AND PAIRING NEXT**

### Purpose

Connect the Owner's real KemerBet agent account through a stable, local, no-money companion before
any `Transfer` click is possible. The companion must use the Owner's normal Windows Chrome rather
than a headless browser running from a DigitalOcean datacenter.

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

No Amount or Notes value was entered and `Transfer` was never clicked during inspection. After the
Owner corrected the fifth saved Player ID, all five advanced to a response-bound ETB account card.
That was a local signed-in-browser proof only. The card does not visibly render the submitted
external Player ID, so a visible-card-only match is not an acceptable authority boundary.

The current portal client uses one exact lookup contract:

- `GET https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=<Player ID>`;
- the structured response contains the submitted external Player ID and KemerBet's internal player
  ID;
- a later deposit request uses that returned internal player ID at
  `POST https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit`.

Player IDs and resolved identities remain private and must not be written to logs, documentation,
screenshots, or readiness output.

### Root-cause finding and architecture decision

The repeated failures over the previous month were not one remaining selector or timeout defect.
The hosted preview combined a headless browser, a datacenter network identity, an embedded remote
view, reCAPTCHA, and a short credential-release state machine. It marked the login request as
released before the provider response had proved success and had no reliable response-failure
observer. Provider rejection, CAPTCHA/risk rejection, network failure, an alternate authentication
flow, and a hung response therefore collapsed into the same timeout or disappearing-preview
experience. Extending the timeout or adding another selector cannot make that architecture a
dependable account connection.

Observed historical failures included a non-responsive Start button, preview-start failures,
blocked bootstrap or reCAPTCHA requests, a credential-release transition deadline, a signed-in
candidate page that never completed verification, and a session that disappeared or returned to
login. Those failures are retained here to prevent repeating the same approach.

The production direction is now:

1. Run a FetanAgent Windows companion on the Owner's device using normal headed Chrome and a
   persistent local browser profile to automate the authorized agent workflow. This is the selected
   integration path and does not wait for an official KemerBet API or company involvement.
2. Keep passwords, OTPs, cookies, CAPTCHA interaction, and the signed-in session on that device.
3. Pair the companion cryptographically with FetanAgent and accept only server-signed, expiring,
   replay-protected, exact-scope assignments.
4. For this no-money connection phase, return only a signed, redacted aggregate lookup result. No
   raw Player ID, account identity, credential, cookie, or balance may enter normal logs or
   documentation.
5. Keep the old hosted preview hidden and retired from the Owner's operational path. It may be used
   only as explicit diagnostic evidence, never as production session authority.

### Historical portal work — evidence only

The August 2026 hosted-browser work captured the exact portal route, read-only lookup request, ETB
response binding, deposit endpoint, and final controls. One historical target-host seal reported
five read-only ETB lookups with Transfer disabled and `moneyMoved=false` on release
`f1ad2c94284cc5f4a70890af56f489e002b3dc1c`. It proved that run's narrow portal contract, but it does
not prove that the current account session is authenticated, that a profile remains usable, or that
the replacement companion is paired. It must not be reused as current authorization.

The old browser container, private Unix socket, profile revisions, HMAC bindings, and one-use
recovery cohorts belong to the retired hosted-preview path. They must not be presented as current
Phase 1 completion evidence. Any stale or quarantined hosted profile remains unusable for money and
must not be revived by another timeout, selector, or recovery-profile patch.

### Current engineering work

Released and observed on 2026-09-03:

1. A Windows-only companion launches normal headed Chrome with a dedicated persistent local
   profile, a single-instance lock, and explicit local data storage. It has no reason to send a
   password, OTP, cookie, CAPTCHA result, or browser storage to remote FetanAgent services, Git, or
   logs. Approved requests can pass through local Node process memory during forwarding.
2. Its provider request boundary allows ordinary reads, the exact interactive login request, and
   the exact non-financial session-refresh request. It blocks the exact KemerBet deposit endpoint
   and every other provider mutation. Chrome starts offline until context-wide routing is installed;
   local forwarding checks redirects before following them. Service workers and provider WebSockets
   are blocked, and HTTP caching is disabled while routing is active.
3. Its page-candidate state is based only on the exact `/agents` main-frame URL, not an
   `Account/Info` response. Neither that URL nor a displayed account header proves the exact account
   or authenticated session. No reviewed exact-identity validation is wired into this release.
4. The interactive login window is bounded to ten minutes; its login timer is cancelled at the
   page-candidate transition. The candidate has a non-sliding twelve-hour local lifetime, subject
   to an overall twelve-hour-ten-minute guarded-session cap. No twelve-hour session observation
   has been completed, and KemerBet can still end its own session earlier under provider policy or
   concurrent-device use. These timers are local ceilings, not provider-session guarantees.
5. v0.1.2 is published and installed from the exact release above. All 64 companion tests, 36
   dependency tests, and GitHub checks passed; imports from the extracted ZIP passed. The live
   dedicated Chrome window used `chromiumSandbox: true` without `--no-sandbox`, displayed the agent
   page/account header, and survived one refresh. The table displayed `No Data`. This is visible
   page-candidate evidence only; no lookup or money action occurred.
6. Provider-neutral P-256 pairing, signed-envelope, exact-five assignment, replay, expiry, and
   redacted-result contracts exist and pass tests, but they are not wired into a running
   companion/server connection.

Still NEXT / not yet proved:

- exact account/session validation is not yet implemented; the observed page candidate is not proof;
- authenticated persistence across the required validation interval, including twelve hours, has not
  passed;
- the local device has not yet been paired to the server with its public identity;
- no server-signed exact-five find-only assignment has been executed by the paired companion; and
- no device-signed, replay-protected, redacted exact-five result has been accepted by the server.

### Required provisioning and validation work

1. **COMPLETE:** v0.1.2 is published with its exact source revision, installed on D:, and its
   extracted package imports are verified. Repeat package and checksum verification for each release.
2. **CANDIDATE OBSERVED:** the separate dedicated Chrome window displayed the agent page/account
   header and survived one refresh. The Owner enters credentials and completes any provider
   challenge only in that window; FetanAgent must neither solve nor relay that challenge.
3. **NEXT:** implement and pass reviewed, local-only validation of the exact account and authenticated
   session. The `/agents` URL, account header, or HTTP 200 response alone must not pass. Return only
   a redacted outcome; never upload or log the raw response body or identity.
4. Demonstrate that the dedicated local profile resumes the authenticated provider session for the
   validation interval, while acknowledging that KemerBet can invalidate its own session.
5. Enroll one device-held P-256 identity and install only its public certificate and revocation
   metadata on the server. Keep the private key and browser profile on the Owner's device.
6. Issue one server-signed, expiring, replay-protected assignment for exactly the five currently
   eligible Players and find-only scope. It must contain no amount, transfer, settlement, or final
   action authority.
7. Run the five lookups sequentially and accept one device-signed redacted aggregate result proving
   five ETB lookups, `transferDisabled=true`, every money-authority field false, and
   `moneyMoved=false`.
8. Test refusal for an invalid signature, wrong device, replay, expiry, changed cohort, non-read
   method, deposit endpoint, external navigation, CAPTCHA uncertainty, logged-out session, wrong
   currency, missing response, and ambiguous response.
9. Keep the long-lived executor, its database LOGIN, payment verifier, settlement path, and every
   final-action switch unprovisioned and stopped.

### Owner-visible proof

An internal readiness screen/log reports only:

```text
Local KemerBet companion paired
exact account and signed-in session verified locally
exact-five find-only assignment verified
five ETB lookups accepted as one signed redacted result
Transfer disabled
Money moved: No
```

It must expose no agent identity, Player ID, cookie, password, or account balance.

### Exit gate

Phase 1 closes only when all of the following are true on the exact released Windows companion:

- the companion is paired to the server with a revocable device public identity;
- reviewed local-only validation proves the exact account and current KemerBet session, rather than
  relying on an HTTP 200 candidate response, without exposing raw response data or identity;
- the persistent local profile passes the agreed session-resume validation;
- one server-signed exact-five, find-only assignment is accepted once;
- five sequential ETB lookups produce one accepted device-signed redacted aggregate result;
- replay, expiry, wrong-device, changed-cohort, and every provider-mutation attempt fail closed; and
- the executor remains unable to lease work and no Amount, Notes, `Transfer`, settlement, final
  action, or money movement occurs.

The historical hosted seal does not satisfy any of these current companion gates. The exact
real-money flags listed in the current-status section remain disabled throughout Phase 1.

The Owner also uses the same KemerBet agent account manually from other devices. Those manual
deposits, withdrawals, balance updates, and history changes are expected concurrent external
activity and are not attributed to FetanAgent unless FetanAgent's own signed audit lineage proves
that it initiated the action. A balance or transaction-history change alone never passes or fails a
FetanAgent readiness check. If KemerBet invalidates the local retained browser session because of
concurrent device use, the required response is a fresh local private sign-in, not a financial
retry.

## Phase 2 — Provision official TeleBirr receipt authority

**Status: PARALLEL NEXT**

### Purpose

Make one official TeleBirr observation independently prove the payment reference, amount, time,
status, and intended receiver before any database settlement is possible.

The current source-level increment composes the authenticated device-bridge request into a private
assignment broker through one strict local-only wire contract. The broker leases only an
already-authorized proof, opens its `v2.telebirr` reference with a TeleBirr/purpose-scoped child key,
signs the exact short-lived assignment, verifies its own signature, and persists only the public
signature/digests needed for lost-ack replay. Its forward migration defines a dormant `NOLOGIN` role
with exactly two guarded routines and its follow-up migration installs the covering delivery
lineage key; both are applied on staging. The local transport accepts only one canonical bounded
poll on one fixed mode-`0600` Unix socket and exposes no TCP address or generic opening operation.
It does not receive either reference-protection master key, provision credentials, activate a
feature switch, create a claim, settle money, or execute a KemerBet action. The private broker now
has strict fixed-path guarded configuration, canonical manifest/key cross-binding, a non-root
fail-closed start lifecycle, and a container target with no exposed port. Secrets, runtime `LOGIN`,
bridge-side process deployment, and device enrollment remain intentionally unprovisioned in the
deployed baseline.

The durable Android device-state side now also exists in source as a separate exact nine-operation
PostgreSQL adapter and closed local wire contract. Its private process alone can claim/complete
one-use pairing, load signed enrollment, persist bounded replay, record redacted heartbeat health,
and stage signed evidence. The public bridge reaches it only through
`/run/fetanagent-telebirr-device-state/state.sock`; it still imports no PostgreSQL client or
credential. The guarded configuration accepts only the dedicated one-connection role URL and
Supabase CA from fixed read-only files, requires `sslmode=verify-full`, and rejects `service_role`,
inline credentials, broader keys, root execution, and live financial mode. Its lifecycle verifies
the catalog before and after creating the inode-checked mode-`0600` socket, closes in reverse
authority order, and has a non-root no-port image target. No runtime credential, deployment, public
ingress, pilot switch, settlement, or money capability is enabled by that source increment.

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
4. Derive the TeleBirr/reference-opening child key offline from the existing encryption master and
   provision only that scoped child key to the broker. Never provision the encryption master or
   fingerprint master to the broker.
5. The reviewed migrations, strict secret/config loader, singleton direct verify-full PostgreSQL
   composition, exact two-function catalog preflight, fail-closed application lifecycle, no-port
   image target, and redacted staging readiness inspection exist. Run that read-only inspection;
   only after it reports a protected active receiver plus a matching open pilot/profile, generate
   the bounded dedicated runtime `LOGIN` and provision only the guarded files outside Git.
6. The canonical fixed assignment and device-state Unix-socket servers, bridge adapters, guarded
   configs, fail-closed lifecycles, and no-port image targets exist in source. Provision and deploy
   both private brokers, then compose the database-free bridge as a separate process/container; do
   not add a public broker listener, database credential to the bridge, or exposed
   protected-reference opening operation.
7. Finish the Android verifier's enrollment, lease, heartbeat, official-observation, signature,
   upload, replay, expiry, and revocation lifecycle.
8. Generate the device identity in Android Keystore and enroll only its public identity.
9. Compose the trusted verifier as a separate dedicated service with its pinned signer/device public
   keys, direct verify-full PostgreSQL connection, singleton behavior, bounded role validity, and no
   public ingress.
10. Provision its short-lived dedicated database LOGIN outside Git.
11. Prove the Android device and backend reject stale leases, revoked keys/devices, wrong receiver,
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

1. Submit a fresh pilot proof through the intended Telegram flow and retain its customer tracking
   handle through the proof and deposit lifecycle.
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

The Telegram status and completion message show one completed 25 ETB deposit for the intended test
Player. The Owner separately sees the matching official TeleBirr observation and KemerBet history
entry.

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

Move from a five-account staging pilot to a separately controlled production Telegram service.

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

The Telegram bot clearly distinguishes pending, verified, credited, rejected, and review states;
support and legal disclosures are accessible from the bot; monitored production transactions
reconcile exactly. Customers do not need a web/PWA account to use the launched bot.

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

- Telegram proof/status continuity and guided deposit work, Phase 1 (KemerBet connection), and
  Phase 2 (TeleBirr authority) should proceed in parallel.
- Phase 3 begins only after both no-money readiness proofs pass.
- Phases 4–7 are strictly sequential and exercise the completed Telegram customer flow.
- Bot/backend maintenance continues in parallel but never counts as financial progress.
- Customer app/web work is deferred. CBE Birr, withdrawals, remaining input formats, history, and
  support must each have completion evidence before the bot is described as fully functional.
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
- [`../apps/telebirr-assignment-broker/README.md`](../apps/telebirr-assignment-broker/README.md) —
  private assignment lease/open/sign boundary and its remaining composition work.
- [`../apps/telebirr-device-state-broker/README.md`](../apps/telebirr-device-state-broker/README.md) —
  private Android pairing/replay/heartbeat/evidence persistence boundary and guarded lifecycle.
- [`../.github/workflows/staging-telebirr-broker-readiness.yml`](../.github/workflows/staging-telebirr-broker-readiness.yml)
  — manual exact-commit redacted Supabase readiness inspection with no provisioning mode.
- [`../.github/workflows/staging-telebirr-broker-emergency-disable.yml`](../.github/workflows/staging-telebirr-broker-emergency-disable.yml)
  — staging-only role de-credentialing, exact membership normalization, and session termination
  followed by the full redacted readiness postcondition; it cannot enable a financial feature or
  provision a runtime.
- [`../packages/telebirr-reference-opening/README.md`](../packages/telebirr-reference-opening/README.md)
  — provider/purpose-scoped protected-reference opening contract.
- [`../android/telebirr-verifier/README.md`](../android/telebirr-verifier/README.md) — Android
  verifier status and operational gaps.
