# KemerBet agent deposit workflow observation

This document records only the reusable interface workflow learned during a controlled,
user-authorized test using accounts owned by the operator. It deliberately does not record the test
transaction, its amount, balances, identifiers, or account details. It guides the reviewed executor
safety core and the missing production integration. It is an observation of the agent UI, not a
public API contract or evidence that the private interface will remain stable. The historical test
did not activate unattended processing.

The Owner clarified on 2026-09-03 that FetanAgent should automate the work they currently perform
manually through their own KemerBet agent account, using their authorization and privately supplied
login. Contacting KemerBet's company or obtaining an official API is not an implementation
prerequisite. The canonical
[`real-money-go-live-phases.md`](real-money-go-live-phases.md#settled-kemerbet-integration-requirement--2026-09-03)
records this product requirement, the local-session connection path, and the remaining launch work.
The deposit steps below are the automation reference for that requirement.

Account usernames, Player IDs, agent identifiers, transaction IDs, request IDs, and session data
are deliberately omitted. No credential, cookie, token, raw response body, or withdrawal code was
stored. Withdrawal testing is deferred until the deposit path is complete and reliable.

## Observed workflow

FetanAgent's configured product policy remains 25–25,000 ETB per deposit. The controlled test did
not change that range and is not a product fixture, seed, authorization, or ledger record.

The visible agent workflow was:

1. Open `Deposit` and choose `To Player`.
2. Keep `Find By` set to `Player ID`, enter the controlled Player ID, and select `Find`.
3. Confirm that the result resolves to the expected account and `ETB` currency.
4. Enter the exact requested ETB amount in `Amount`; leave the optional `Notes` field empty.
5. Select `Transfer` once.

The immediate result was a `Transfer Successful!` dialog. The reusable player-credit fact is the
dialog's exact `Player Balance +<requested amount with two decimals> ETB Success` line. FetanAgent
matches that delta to the intended Player ID and exact requested amount. It does not use the dialog's
other balance rows as accounting facts and does not treat the dialog alone as durable proof.

The reusable reconciliation workflow checks both of the following:

- The immediate success modal contains the exact player-credit delta for the intended Player ID and
  requested amount.
- Agent history contains exactly one matching deposit row for the intended Player ID, exact amount,
  `ETB` currency, and bounded time window, with payment method `EPOS`, transaction state `Approved`,
  and the observed operation label `Player Epos Deposit`. These labels are observations, not a
  stable integration contract.

The agent account was processing unrelated deposits concurrently. Its aggregate balance could
therefore change for reasons unrelated to this transfer and is not a safe correlation key.

## Evidence hierarchy

The future executor should evaluate evidence in this order:

1. A successful Player-ID lookup proves only that the form resolved an account.
2. The exact success-modal player-credit delta is provisional execution evidence and must be
   durably handed into reconciliation.
3. One uniquely matching `Approved` `EPOS` agent-history row is the durable external observation.
4. Confirmation requires both the exact modal delta and that unique history row; neither is
   sufficient alone.

An aggregate agent-balance delta, a resolved username, or a success toast by itself is insufficient.
The executor must correlate the intended Player ID, exact ETB amount, operation type, bounded time
window, and the provider's transaction/request identifiers. Those external identifiers are
sensitive execution material: store them only in the protected execution record and never in
ordinary logs, customer copy, fixtures, audit metadata, screenshots, or support exports.

The reviewed execution ledger records only the normalized operation fact `deposit`, never the
observed UI label. It durably carries the exact success-modal player-credit-match fact into
reconciliation. Its sanitized matched-history timestamp must fall inclusively between the attempt's
server-authored final-action fence and reconciliation-required timestamps. A non-deposit, unknown
operation, missing timestamp, or observation before or after that window cannot confirm execution
and never enables retry.

## Implemented safety core and remaining integration boundary

The source now contains a reviewed callable safety core: private one-shot execution/reconciliation
ledgers, a consume-only executor role boundary with six transition commands, a strict PostgreSQL
adapter and catalog preflight, guarded execution/reconciliation orchestration, and an agent-workflow
adapter. Neither executor role can enqueue work; direct enqueue is internal to the separate atomic
verified-settlement function.
The workflow adapter implements the observed lookup, target/amount validation, single post-fence
`Transfer` call, exact success-modal player-credit-delta check, and unique `Approved` `EPOS` history
reconciliation. A concrete Playwright page driver, exact account-bound persistent-session registry,
separate HMAC providers, serialized polling/health entrypoint, and hardened explicit-profile-only
container composition now bind that core together.

The composition remains operationally disabled. The repository does not provide the reviewed
selector, identity-binding map, keys, authenticated account profiles, dedicated runtime LOGIN,
live database switches, deployed process, or authoritative-verifier caller. Manual profile
provisioning is a separate no-database, no-selector, no-HMAC, no-action-gate command. The remaining
deployment gates are recorded in [`../infra/executor.md`](../infra/executor.md).

The implemented core enforces these controls:

- one durable execution attempt created before the final click;
- one lease and a serialized queue per agent account;
- an exact expected Player ID, currency, and amount fixed before lookup;
- validation that lookup returned the expected bound player before amount entry;
- a single final-click boundary with no automatic resubmission;
- durable capture of the exact success-modal player-credit-delta fact followed by agent-history
  reconciliation;
- a transition to `execution_uncertain` and then `execution_reconciliation` whenever the browser,
  session, response, or history outcome is missing or ambiguous;
- no retry in the current foundation; any future retry must require separately reviewed,
  authoritative proof of non-execution rather than a missing observation; and
- a feature switch, incident stop, redacted telemetry, and supervised rollout.

Login expiry, CAPTCHA, a changed label or layout, multiple matching history rows, a missing history
row, a non-`Approved` state, or a lost browser response must stop execution. The worker must never
guess whether a transfer failed.

The agent system is an undocumented private UI. Browser-observed routes and raw payloads do not
constitute a supported public API contract. Production integration must bind the Owner-authorized
agent account and workflow to the local session and establish session handling, host/TLS policy,
selector/version drift, timeouts, and incident recovery. This work does not depend on company
involvement or an official API.

## Remaining deposit tests

One controlled workflow observation proves only the basic UI mechanics, not launch readiness.
Before enabling real automatic deposits, the minimum useful additional live tests are:

1. An invalid Player-ID lookup that proves no transfer and no history row are created.
2. One controlled 25 ETB deposit at FetanAgent's configured minimum, reconciled through the same
   exact success-modal player-credit delta and unique `Approved` `EPOS` history evidence.

The pure deterministic fake contract now models the following cases without contacting the agent
system:

- exact request replay and duplicate suppression;
- two requests sharing one busy agent account, proving strict serialization and no target swap;
- browser timeout after the final click;
- session expiry or CAPTCHA before and after submission;
- delayed, missing, duplicated, non-`Approved`, or non-`EPOS` history records;
- non-deposit and unknown operation types;
- history observations before, after, or unknown relative to the bounded execution window; and
- reconciliation after the success modal is lost or its player-credit delta is not exact.

The pure contract cases are advisory fixtures, not browser transport or runtime integration; their
plans keep network, browser, final action, database, and retry disabled. Separate executor unit tests
exercise the guarded adapters with injected fake database/page dependencies, not live systems. The
fault cases must not be intentionally reproduced with real money. Any later positive live test still
requires separate bounded authorization plus the durable execution attempt, incident stop,
serialization, and reconciliation controls. Withdrawal automation remains a later phase after the
deposit workflow is complete.
