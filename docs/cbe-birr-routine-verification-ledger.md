# Routine CBE Birr verification ledger

`20261018090000_routine_cbe_birr_verification_ledger.sql` installs the dormant database boundary
for server-side CBE Birr receipt verification described in the
[routine deposit plan](cbe-birr-routine-deposit-plan.md). It cannot settle a payment, create a
claim or KemerBet job, or move money.

## What it adds

- `app.routine_cbe_birr_processing_control`: a CBE-only mode, `disabled` or `dry_run`. It starts
  `disabled`. Only a protected `postgres` administrator session can change it, through
  `app.set_routine_cbe_birr_processing_mode`, and every change is audited. `live` is not
  installed. The shared `cbe_birr_authoritative_verification` switch is not used because many
  TeleBirr and Companion boundaries require it to stay disabled.
- `app.routine_cbe_birr_candidates`: untrusted Telegram submissions. Each row stores the
  protected `v2.cbe_birr` reference, the Player and its current eligibility decision, the
  lookup-protected receiver revision snapshotted at submission, the server submission time, and
  the lease state. Identity columns are immutable and rows cannot be deleted.
- `app.routine_cbe_birr_verification_results`: one immutable outcome per candidate: `verified`,
  `rejected`, or `review`, with safe facts only (amount, time and precision, PDF digest, layout,
  parser version). No reference, phone number, name, or receipt bytes are stored.
- A `NOLOGIN` verifier group and runtime role. The runtime has no password and cannot log in. The
  group can execute exactly three security-definer functions and nothing else.

## Functions

| Function                                      | Caller                     | Purpose                                                                  |
| --------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `capture_routine_cbe_birr_candidate`          | none yet (`postgres` only) | Dry-run Telegram intake; granted later with the API catalog preflight    |
| `lease_routine_cbe_birr_verification`         | verifier group             | Lease one due candidate with its protected reference and lookup envelope |
| `record_routine_cbe_birr_verification`        | verifier group             | Record the outcome after rechecking every server-owned fact              |
| `release_routine_cbe_birr_verification`       | verifier group             | Return a candidate after a transient failure, with bounded backoff       |
| `set_routine_cbe_birr_processing_mode`        | `postgres` only            | Start or stop the dry run                                                |
| `close_routine_cbe_birr_candidate_for_review` | internal only              | Close an expired or exhausted candidate for Owner review                 |

## Rules enforced in PostgreSQL

- Intake requires the CBE control in `dry_run`, an admitted active Telegram customer, a currently
  deposit-eligible Player, and an active CBE Birr receiver that has a v2 lookup revision. A legacy
  v1-only receiver needs an Owner protection-upgrade revision first.
- At most 5 submissions per minute, 60 per hour, and 3 waiting candidates per Telegram identity.
- A verified result is downgraded to review when the amount is outside 25–25,000 ETB, the
  receipt time falls outside the one-hour freshness window or the five-minute clock allowance,
  the snapshotted receiver revision was not active at payment time or was retired before
  submission, or another candidate already verified the same reference. A minute-precision time
  must fit entirely inside the window.
- A candidate gets at most six provider attempts, with backoff from 30 seconds. A candidate that
  cannot finish within one hour of submission is closed for review, never credited late.
- Exact replays after a lost response return the stored outcome; a conflicting replay fails.

## Tests

`packages/sql-integration-tests/src/routine-cbe-birr-verification-ledger.suite.ts` covers the
catalog, ACLs, and forced RLS; dry-run-only intake, replay, rate limits, and the absence of any
money rows; every downgrade rule including minute-precision straddling; backoff, attempt
exhaustion, window expiry, and the disabled control.
