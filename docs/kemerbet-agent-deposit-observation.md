# KemerBet agent deposit observation

This document records one controlled, user-authorized deposit observation completed on
2026-08-15 using accounts owned by the operator. It exists to guide the future supervised KemerBet
executor. It is not a public API contract, permission for unattended automation, or evidence that
the private agent UI will remain stable.

Account usernames, Player IDs, agent identifiers, transaction IDs, request IDs, and session data
are deliberately omitted. No credential, cookie, token, raw response body, or withdrawal code was
stored. Withdrawal testing is deferred until the deposit path is complete and reliable.

## Controlled result

The operator authorized exactly one 10 ETB transfer to a controlled player account. The amount was
chosen for a bounded live test and is below FetanAgent's current 25 ETB product minimum; the result
does not change the configured 25–25,000 ETB per-deposit policy.

The visible agent workflow was:

1. Open `Deposit` and choose `To Player`.
2. Keep `Find By` set to `Player ID`, enter the controlled Player ID, and select `Find`.
3. Confirm that the result resolves to the expected account and `ETB` currency.
4. Enter `10` in `Amount`; leave the optional `Notes` field empty.
5. Select `Transfer` once.

The immediate result was a `Transfer Successful!` dialog. The dialog reported successful balance
entries for the player, the agent, and the platform. Those rows are useful immediate evidence, but
FetanAgent must not interpret the platform row as an accounting contract or treat the dialog alone
as durable proof.

Reconciliation then established both of the following:

- Agent history contained exactly one matching 10 ETB deposit row for the intended Player ID and
  time window, with payment method `EPOS`, transaction state `Approved`, and the observed deposit
  note `Player Epos Deposit`. These labels are observations, not a stable integration contract.
- The controlled player balance increased independently by exactly 10 ETB. The live starting and
  ending balances are intentionally excluded from this repository.

The agent account was processing unrelated deposits concurrently. Its aggregate balance could
therefore change for reasons unrelated to this transfer and is not a safe correlation key.

## Evidence hierarchy

The future executor should evaluate evidence in this order:

1. A successful Player-ID lookup proves only that the form resolved an account.
2. A success dialog is provisional execution evidence.
3. One uniquely matching agent-history row with state `Approved` is the primary durable external
   observation.
4. The intended player's exact balance credit is independent corroboration when it can be read
   without ambiguity.

An aggregate agent-balance delta, a resolved username, or a success toast by itself is insufficient.
The executor must correlate the intended Player ID, exact ETB amount, operation type, bounded time
window, and the provider's transaction/request identifiers. Those external identifiers are
sensitive execution material: store them only in the protected execution record and never in
ordinary logs, customer copy, fixtures, audit metadata, screenshots, or support exports.

The dormant ledger records only the normalized operation fact `deposit`, never the observed UI
label. Its sanitized matched-history timestamp must fall inclusively between the attempt's
server-authored final-action fence and reconciliation-required timestamps. A non-deposit, unknown
operation, missing timestamp, or observation before or after that window cannot confirm execution
and never enables retry.

## Automation boundary

The checked-in executor remains unable to perform a live transfer. The database now contains a
private dormant one-shot attempt/reconciliation ledger, and the shared contracts package contains a
pure deterministic fake planner. Neither has a writer, runner, browser, network, credential, final
action, or retry capability. This observation supports a later supervised adapter only after the
remaining runtime controls are separately reviewed:

- one durable execution attempt created before the final click;
- one lease and a serialized queue per agent account;
- an exact expected Player ID, currency, and amount fixed before lookup;
- validation that lookup returned the expected bound player before amount entry;
- a single final-click boundary with no automatic resubmission;
- capture of the immediate result followed by platform-side history reconciliation;
- a transition to `execution_uncertain` and then `execution_reconciliation` whenever the browser,
  session, response, or history outcome is missing or ambiguous;
- no retry in the current foundation; any future retry must require separately reviewed,
  authoritative proof of non-execution rather than a missing observation; and
- a feature switch, incident stop, redacted telemetry, and supervised rollout.

Login expiry, CAPTCHA, a changed label or layout, multiple matching history rows, a missing history
row, a non-`Approved` state, or a lost browser response must stop execution. The worker must never
guess whether a transfer failed.

The agent system is an undocumented private UI. Browser-observed routes and raw payloads are not a
supported provider contract and are not copied into this repository. A later adapter review must
separately establish allowed access, session handling, host/TLS policy, selector/version drift,
timeouts, and incident recovery.

## Remaining deposit tests

One successful transfer proves the basic UI mechanics, not launch readiness. Before enabling real
automatic deposits, the minimum useful additional live tests are:

1. An invalid Player-ID lookup that proves no transfer and no history row are created.
2. One controlled 25 ETB deposit at FetanAgent's configured minimum, reconciled through the same
   success-dialog, unique-history, and player-balance evidence.

The pure deterministic fake contract now models the following cases without contacting the agent
system:

- exact request replay and duplicate suppression;
- two requests sharing one busy agent account, proving strict serialization and no target swap;
- browser timeout after the final click;
- session expiry or CAPTCHA before and after submission;
- delayed, missing, duplicated, or non-`Approved` history records;
- non-deposit and unknown operation types;
- history observations before, after, or unknown relative to the bounded execution window; and
- reconciliation after a success dialog is lost.

These are advisory contract fixtures, not a browser transport or runtime integration. Their plans
always keep network, browser, final action, database, and retry disabled. The fault cases must not be
intentionally reproduced with real money. Any later positive live test still requires a separate
bounded authorization plus the durable execution attempt, incident stop, serialization, and
reconciliation controls. Withdrawal automation remains a later phase after the deposit workflow is
complete.
