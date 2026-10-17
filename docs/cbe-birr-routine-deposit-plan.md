# CBE Birr routine deposit implementation plan

This is the delivery plan for routine CBE Birr → KemerBet deposits, following the approved
[CBE Birr deposit product contract](cbe-birr-deposit-product-contract.md). It describes work to be
reviewed in separate pull requests. It does not itself change a database, runtime, switch, or
deployment, and no step below moves money until the Owner performs the final activation.

## Why CBE Birr is simpler than TeleBirr

TeleBirr's official receipt is only reachable from an enrolled Android phone, so routine TeleBirr
needs a signed phone, a paid-poll bridge, staged phone observations, and a separate settlement
service. A bounded diagnostic has already shown that the FetanAgent server can fetch the official
CBE Birr receipt PDF directly from the fixed `cbepay1.cbe.com.et` route, and the existing parser
can read it. CBE Birr verification can therefore run as **one server-side verifier service**:
lease a candidate, open the protected reference, fetch and parse the receipt once, decide, and
record the result in one database transaction.

## What already exists (dormant)

| Piece                                                                  | Where                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| Product rules (amount, freshness, receiver, duplicates)                | `docs/cbe-birr-deposit-product-contract.md`         |
| Fixed-route, SSRF-safe one-request receipt transport                   | `packages/cbe-birr-authoritative-receipt-transport` |
| Isolated PDF parser for both observed receipt layouts                  | `packages/cbe-birr-authoritative-pdf-parser`        |
| Minute-precision time-window check                                     | `cbe-birr-authoritative-lookup-prerequisite`        |
| `v2.cbe_birr` protected submitted-reference envelopes                  | `packages/deposit-reference-protection`             |
| v2 receiver lookup envelopes and Owner rotation (PR #831)              | `cbe_birr_receiver_lookup_revisions`, Owner app     |
| Bot CBE receipt detection and reference extraction from text and links | `apps/bot/src/telegram-deposit-proof-input.ts`      |

## Target flow

1. The customer has a saved Player ID and chooses **CBE Birr** (or sends a CBE receipt/link/SMS
   directly). The bot shows the current CBE Birr receiver for one hour.
2. The customer pays and sends the transaction ID, link, SMS, screenshot, or PDF. The API protects
   the reference and records one **CBE Birr candidate** that snapshots the Player, the receiver
   revision, the instruction window, and the server submission time. No amount is accepted.
3. The **CBE Birr verifier** service leases the candidate, opens the reference with a CBE-scoped
   child key, opens the receiver lookup phone with its own key, fetches the official receipt
   once, parses it in the isolated child process, and applies the contract decision:
   - every fact proven and fresh → **verified**;
   - definite reference/receiver/currency mismatch or already-claimed reference → **rejected**;
   - anything else (unsupported type/status, stale, outside instruction, layout drift, provider
     outage after bounded retries) → **review**, never automatic credit.
4. A verified result is settled atomically inside PostgreSQL with the same ledger rows TeleBirr
   uses: intent, submission, evidence, verification attempt, global one-use payment claim, and
   one `execute_deposit` job.
5. The existing signed routine broker hands the job to the Windows Companion, which credits the
   exact Player and amount, records dispatch, and reconciles against KemerBet History exactly as
   it does for TeleBirr. The Companion code does not change for CBE Birr.
6. The customer receives the existing Telegram outcome messages (checking, credited, already used,
   invalid, being checked).

## Pull requests

Each pull request is independently reviewable, ships default-off, keeps the money path closed,
and must pass `pnpm test`, `pnpm lint`, and the disposable SQL integration suite.

1. **Plan** (this document).
2. **Candidate and verification ledger (database).** A CBE-only processing control that starts
   disabled, `app.routine_cbe_birr_candidates` (protected reference, Player, receiver revision
   snapshot, lease state), and immutable `app.routine_cbe_birr_verification_results`. A dedicated
   `NOLOGIN` verifier group and runtime role with exactly three security-definer functions:
   lease, record result, and release after a transient provider failure. Every server-owned
   fact is rechecked in PostgreSQL. In this pull request a verified result is a dry-run record
   only, never settled.
3. **Verifier service.** A new `apps/cbe-birr-verifier` that composes the existing transport,
   parser, and time-window check with a pure, exhaustively tested decision function. It holds
   only a CBE-scoped reference-opening child key and the receiver-lookup decryption key, has a
   one-connection database login, exact catalog preflight, no inbound port, bounded concurrency,
   and redacted logs. Docker target and a dormant Compose overlay; no deployment.
4. **Telegram intake.** API capture and CBE payment instructions behind new default-off flags;
   bot provider choice and direct CBE receipt/link/SMS/PDF submission; exact catalog-preflight
   update for the Player-action role.
5. **Owner visibility.** CBE Birr results and review queue, and a dashboard control for the
   lookup-protected receiver rotation from PR #831.
6. **Shadow run (no money).** With the CBE processing control in `dry_run`, real CBE receipts
   are verified end to end and recorded, but nothing is claimed or credited. The Owner compares
   each result with the CBE app before continuing.
7. **Settlement and execution lane.** A separate CBE Birr Owner processing authorization and stop,
   atomic claim-to-job settlement for verified results, a CBE execution binding, and a narrow
   broker change so the existing signed lease can also serve CBE Birr jobs. This is the only
   change that touches the shared routine broker, so it is sequenced **after** the current
   TeleBirr History-reconciliation repair is merged.
8. **Activation and stop.** Reviewed GitHub workflows and SQL for CBE Birr activation and stop,
   runtime credential creation, and an operator runbook. The Owner performs activation; Claude
   does not.

## Safety invariants

- Customer material only supplies a candidate transaction ID. Amount, receiver, time, and status
  come only from the freshly fetched official receipt.
- The `PH` lookup selector is never receiver evidence; the PDF `Credit Account` must equal the
  candidate's snapshotted receiver revision.
- One CBE Birr reference can fund at most one deposit, enforced by the existing global
  payment-claim boundary in PostgreSQL.
- Provider outages, layout drift, minute-precision times that straddle a cutoff, and every
  ambiguous field go to review, never to automatic credit or a blind retry.
- CBE Birr has its own processing control. It does not use the shared
  `cbe_birr_authoritative_verification` feature switch, because many existing TeleBirr and
  Companion boundaries require that switch to stay disabled.
- Stopping CBE Birr does not stop TeleBirr, and vice versa. Either provider's emergency stop
  leaves already-fenced KemerBet attempts in reconciliation.
- No raw reference, receiver phone, receipt bytes, or Player ID is logged.

## Coordination

The Windows Companion, KemerBet History reconciliation, and TeleBirr pipeline are being repaired
separately. CBE Birr pull requests 2–6 do not modify those areas. Pull request 7 changes the
shared broker function and is rebased onto the merged repair before review.
