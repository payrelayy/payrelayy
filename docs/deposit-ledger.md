# Deposit ledger design

This is the longer-term design boundary for FetanAgent's automated-deposit workflow. It does not
expand the current launch-preparation scope: the only implemented provider-verification code is the
CBE Birr redacted-fixture dry run. The KemerBet side now has private execution/reconciliation
ledgers, a consume-only executor role boundary with six callable transition commands, and matching
guarded database/runtime, concrete Playwright, account-bound session, HMAC, polling/health, and
explicit-profile container composition. It still has no provisioned selector/binding/key/session,
runtime LOGIN, live database switches, deployed service, or authoritative provider-verification
caller. TeleBirr and CBE bank remain deferred. All platform and provider identifiers stay
database-backed so later approved integrations do not require a financial-core rewrite.

## Scope and safety boundary

- A customer may register multiple Player IDs for a platform.
- A deposit intent snapshots its payment provider, receiver-account revision, policy, expected
  amount, and one-hour expiry at intake time.
- FetanAgent currently permits 25–25,000 ETB for each individual deposit. Customers may create
  unlimited distinct deposits; there is no FetanAgent customer, daily, lifetime, or frequency
  financial quota. Technical abuse and capacity controls remain allowed.
- Transaction IDs, screenshots, and PDFs are inputs for verification. Only authoritative provider
  evidence can approve a payment.
- An authoritative payment can fund exactly one deposit request, enforced by a provider-specific
  canonical-reference fingerprint.
- Verification, KemerBet execution, and external payout are separate workflows. This ledger does
  not create an automated wallet/bank payout.
- Financial actions default to `dry_run`. Although the abstract workflow adapter contains the
  single post-fence `Transfer` call, no checked-in production entrypoint can currently reach it.

## Ledger entities

| Entity                                 | Purpose                                                   | Critical invariant                                                                                |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `customer_platform_players`            | A customer's validated Player ID for a platform           | A platform Player ID belongs to only one customer.                                                |
| `player_validation_attempts`           | Append-only KemerBet Player ID validation results         | A Player ID cannot become valid without its latest immutable successful attempt.                  |
| `player_deposit_eligibility_decisions` | Versioned financial eligibility decisions per player      | New intents require the latest decision to be `eligible`; ownership alone is insufficient.        |
| `deposit_intents`                      | The customer intent and immutable receipt/policy snapshot | FetanAgent permits 25–25,000 ETB per deposit; no customer transaction-count cap exists.           |
| `deposit_submissions`                  | A submitted transaction ID and its attempt number         | The raw ID is encrypted; a keyed fingerprint supports duplicate detection.                        |
| `deposit_submission_files`             | Private receipt image/PDF metadata                        | Object key only; private Storage bucket; exactly 90-day retention.                                |
| `deposit_dry_run_fixture_assessments`  | Redacted local-fixture simulation results                 | Append-only and explicitly non-authoritative; never provider evidence or approval.                |
| `deposit_dry_run_fixture_reviews`      | Final Owner acknowledgement of a simulation               | Append-only; acknowledgement or manual-review routing only.                                       |
| `provider_payment_evidence`            | Normalized official-provider facts                        | Only provider API, receipt lookup, or account activity sources are allowed; OCR cannot create it. |
| `deposit_verification_attempts`        | Append-only verifier outcomes                             | No raw provider response or credential in the record.                                             |
| `deposit_payment_claims`               | Authoritative payment accepted for an intent              | Unique on `(provider, canonical-reference fingerprint)` and one claim per intent.                 |
| `deposit_review_cases`                 | Verification or execution uncertainty                     | Only one open case per intent and stage.                                                          |
| `deposit_jobs`                         | Durable verification/reconciliation queue                 | Execution jobs are one-shot; the payload is deliberately empty.                                   |
| `deposit_state_events`                 | Append-only intent transition history                     | Every insert or status transition produces a system event.                                        |
| `deposit_execution_attempts`           | One-shot KemerBet final-action fence                      | One intent and agent lane stay blocked through uncertainty and review.                            |
| `execution_reconciliations`            | Sanitized Approved-EPOS/modal-credit observations         | Only exact positive evidence can support `executed`; no outcome authorizes retry.                 |

## Player eligibility quarantine

Ownership and deposit eligibility are separate records. A legacy
`app.customer_platform_players` association does not authorize a new deposit intent. The private
`app.player_deposit_eligibility_decisions` ledger stores sequential, append-only `eligible` or
`revoked` decisions with fixed paired reason codes and controlled actor attribution. Its insert
trigger `player_deposit_eligibility_decisions_enforce_insert` calls
`app.enforce_player_deposit_eligibility_decision_insert()`, locks the player row, and requires the
caller-supplied `decision_version` to be the exact next version. The immutable triggers use
`app.reject_player_deposit_eligibility_decision_mutation()` to reject updates, deletes, and
truncation.

The `app.deposit_intents.player_deposit_eligibility_decision_id` column snapshots the decision used
for a new intent. `app.require_player_deposit_eligibility_for_intent()` locks the selected player,
requires its latest decision to be `eligible`, and overwrites the snapshot with that exact decision
ID. A same-player composite foreign key and an update guard make the snapshot immutable. A later
`app.enforce_deposit_intent_eligibility_snapshot_immutable()` rejects snapshot changes. A later
`revoked` decision blocks later intents without rewriting historical ones. Existing legacy intents
may retain a null snapshot only for compatibility; null is not current eligibility.

This is fail-closed financial quarantine, not an eligibility-promotion feature. The migration adds
no seed, backfill, view, enum, decision-writing procedure, policy, runtime grant, feature-switch
change, route, UI, or provider adapter. The fixed customer list projection can read only enough
private state to keep `Ready` aligned with a well-formed current `eligible` decision; it returns no
ledger fields and cannot write one. Consequently there is no supported way for an application to
create an `eligible` decision, no reachable customer `Ready`, and ownership confirmation cannot
silently enable deposit intake. The deposit-intent trigger remains the financial authorization and
serialization boundary.

## Deposit state flow

```text
intake_received
  -> verification_pending
  -> verified
  -> execution_pending
  -> execution_in_progress
  -> execution_uncertain
  -> execution_reconciliation
  -> executed | execution_review

verification_pending -> verification_review -> verification_pending | verified | rejected
verification_pending -> rejected | expired
execution_pending -> execution_review
execution_review -> execution_reconciliation | rejected
```

No transition may move an in-progress or uncertain execution directly to `executed`, return review
or reconciliation to `execution_pending`, or retry an execution job. A matching positive
reconciliation record and resolved attempt are required first. Review may become `rejected` only
when no final action was fenced. A duplicate, stale, receiver-mismatched, incomplete, or
non-authoritative payment is rejected or routed to `verification_review`; it cannot reach execution.

## Execution and reconciliation safety core

The claim-to-execution handoff is one private atomic command:
`app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)`. Before it calls either
legacy transition, it binds the supplied intent, verification attempt, provider evidence, and
submission and requires the protected submitted-reference fingerprint to equal the authoritative
canonical-reference fingerprint. A new success creates one payment claim and one queued one-shot
execution job in the same statement transaction. Exact replays require the same immutable triple
and one already-complete, well-formed claim/job pair. A partial historical state is an error and is
not repaired. The dedicated `fetanagent_verification_settlement` role has execute access to only
this command and no ledger tables, sequences, executor commands, Data API, or Telegram functions;
its runtime scaffold remains `NOLOGIN` and unprovisioned. The atomic command alone calls the private
`app.enqueue_verified_deposit_execution(uuid)` helper; neither executor role can execute that helper
directly.

`app.deposit_execution_attempts` is a private one-shot ledger. An attempt starts `prepared`, may be
cancelled only before the final-action fence, and otherwise moves through
`final_action_fenced -> reconciliation_required`. Only a completed positive reconciliation may
resolve it as `confirmed_executed`; ambiguity resolves it as `review_required`, which continues to
block the shared agent account. Partial unique indexes enforce one blocking attempt per intent and
per agent account.

`app.execution_reconciliations` is append-only and sequential per attempt. A positive outcome
requires the normalized operation type `deposit`, exactly one `Approved` `EPOS` history match, a
sanitized matched-history timestamp inside the inclusive server-authored window from
`final_action_fenced_at` through `reconciliation_required_at`, exact player, amount, and currency
matches, the exact agent success-modal player-credit delta, and a versioned keyed
external-reference fingerprint. It stores no raw UI operation label, Player ID, reference, username,
balance, route, selector, response, payload, credential, cookie, or session. Non-deposit, unknown,
before-window, after-window, and missing facts cannot confirm execution or authorize retry.
`ambiguous` and `not_observed` retain no asserted operation or matched timestamp; `not_observed`
leaves the attempt reconciliation-required and is not proof that no transfer occurred.

The canonical intent and job triggers enforce the same correspondence. Execution jobs require one
attempt and `max_attempts = 1`; `retry_wait` is rejected. An intent can enter execution only behind
the durable fence, and can become `executed` only after its reconciliation job, immutable positive
outcome, and attempt all agree. Both tables have forced RLS and zero policies. The reviewed command
migration creates `fetanagent_deposit_executor` and `fetanagent_deposit_executor_runtime` as
`NOLOGIN` roles, grants the executor boundary no base-table or sequence access, and grants exactly
these six private transition commands:

1. `app.lease_next_deposit_execution(uuid, integer)`
2. `app.cancel_deposit_execution_before_action(uuid, uuid, text)`
3. `app.fence_deposit_execution_final_action(uuid, uuid)`
4. `app.require_deposit_execution_reconciliation(uuid, uuid, boolean)`
5. `app.lease_next_deposit_execution_reconciliation(uuid, integer)`
6. `app.record_deposit_execution_reconciliation(...)`

This is a consume-only authority surface: the executor leases and advances work that already exists.
It cannot create an execution job. Direct enqueue remains ungranted to both executor roles and is
used only inside the separately granted atomic verified-settlement function.

The corresponding `apps/executor` source provides a direct-PostgreSQL adapter, a catalog-only
startup privilege preflight, the execution/reconciliation orchestration, and a strict KemerBet
workflow adapter. The workflow adapter validates the target and amount, permits only the first
post-fence `Transfer` call, carries the exact success-modal player-credit-delta fact into durable
reconciliation, and evaluates a unique matching `Approved` `EPOS` history row. The activation
composition binds it to a concrete Playwright driver, an exact account-bound persistent-session
registry, separate identity/history HMAC providers, a serialized polling loop, private health
listener, one immutable image digest, an explicit staging/production database target, and a
lifetime database-session singleton acquired before browser probing.

The repository still provisions no selector asset, identity-binding map, HMAC key, browser profile,
runtime LOGIN credential, live database switch, deployed process, or provider-verification runtime
that calls the atomic settlement/enqueue command. Every missing input fails startup closed; the
manual session provisioner receives none of the database, selector, binding, HMAC, or action-gate
inputs. See [`../infra/executor.md`](../infra/executor.md).

`@fetanagent/contracts` supplies a pure deterministic fake boundary for development. Its closed
scenarios cover lookup mismatch, selector/session/CAPTCHA failures, pre/post-action timeout, lost
success feedback, delayed/missing/duplicate/non-approved history, non-deposit or unknown operation,
before/after/unknown execution-window correlation, player/amount/currency mismatch, modal
player-credit-delta mismatch, and one exact approved in-window deposit with the exact modal delta. It
performs no I/O, final action, persistence, scheduling, or retry; its log projections omit
identifiers, amounts, timestamps, and observations.

## Privacy and retention

- Transaction IDs and canonical provider references are encrypted before storage. Their keyed
  fingerprints are used for uniqueness and duplicate detection; no raw reference belongs in logs
  or audit metadata. The current API capture function records a transaction ID only as an
  encrypted, untrusted submission.
- Screenshot/PDF object-key metadata is modeled in the database, but the runtime upload path is
  deferred until the API can validate private-storage ingestion. When enabled, the files will stay
  private in payment-evidence and expire after 90 days.
- Audit metadata allows internal surrogate UUIDs, versions, and reason codes only. It never carries
  transaction IDs, Player IDs, usernames, raw receipts, withdrawal codes, account references,
  provider payloads, credentials, authenticated screenshots, or live account balances.
- Customer-bot flow state holds deposit IDs and expiry only, never a transaction ID or file body.

## Verification acceptance rule

An automatic approval requires all of the following in one database transaction:

1. The claim happens before the snapshot expiry window closes, and the provider timestamp is inside it.
2. The provider result is authoritative and has all required fields.
3. The amount matches the request exactly in ETB minor units.
4. The configured receiver account/revision matches.
5. The provider timestamp is within the request freshness rule and is no more than five minutes in
   the future relative to the verifier clock.
6. The provider canonical reference fingerprint has never funded another request.
7. The intent is still `verification_pending` with no open verification review. An expired or
   reviewed intent must wait for a separately audited administrator decision.

The private atomic settlement command now joins authoritative verification to verified enqueue,
but no provider-verification runtime invokes it and its dedicated runtime role has no login or
credential. A real KemerBet transfer remains unavailable from the current environment until
authoritative enqueue wiring, reviewed external selector/binding/key and session inputs, runtime
credentials, live database gates, sandbox proof, incident stop, and an approved deployment prove the
same invariants.

One controlled agent-system test established the visible lookup, transfer, exact success-modal
player-credit-delta, and unique `Approved` `EPOS` history workflow without becoming a FetanAgent
ledger record or product fixture. The observation did not change the configured 25–25,000 ETB
amount policy or enable a live executor. See
[kemerbet-agent-deposit-observation.md](kemerbet-agent-deposit-observation.md) for the sanitized
evidence, stop rules, and remaining test matrix.

## Operations model

The bot calls the API only. The signed Telegram action route uses the narrow
`fetanagent_player_actions` database role for Player-ID actions and the reviewed dry-run intake;
the generic API role does not receive these procedure grants. The verification worker will use
`fetanagent_worker` through reviewed database procedures. Neither role receives direct ledger-table
access. The action route can call `app.open_telegram_dry_run_deposit_intent`, which is idempotent by
inbound Telegram event and still requires an active legacy ownership association plus all four
disabled financial feature switches. Any new intent insert is additionally rejected unless the
latest separate eligibility decision is `eligible`; this runtime has no path to write that
decision. A successful, separately enabled future call would return the frozen display-safe CBE
Birr receiver snapshot. The action route can then call
`app.capture_telegram_dry_run_deposit_reference`, which idempotently records only the API-protected
reference for that exact intake. The capture procedure leaves the intent at `intake_received` and
the submission at `received`; it cannot upload a file, enqueue verification, create evidence,
verify or claim a payment, or start KemerBet execution. Owner Control receives a separate masked,
read-only projection that excludes ciphertext and fingerprints. Owner Control can additionally
run a redacted local fixture against a received intake, append the advisory result, and record one
final acknowledgement or manual-review requirement. Those procedures require every financial
feature switch to remain disabled and do not change the intent or authoritative ledger. The claim
procedure remains ungranted. No browser, Telegram client, or public Supabase Data API role can
query the private ledger.
