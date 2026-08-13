# Deposit ledger design

This is the longer-term design boundary for PayReplayy's automated-deposit workflow. It does not
expand the current launch-preparation scope: the only implemented verification code is the CBE
Birr redacted-fixture dry run. TeleBirr and CBE bank remain deferred. All platform and provider
identifiers stay database-backed so later approved adapters do not require a financial-core rewrite.

## Scope and safety boundary

- A customer may register multiple Player IDs for a platform.
- A deposit intent snapshots its payment provider, receiver-account revision, policy, expected
  amount, and one-hour expiry at intake time.
- KemerBet permits 25–25,000 ETB for each individual deposit. Customers may create unlimited
  distinct deposits; there is no PayReplayy customer, daily, lifetime, or frequency financial
  quota. Technical abuse and capacity controls remain allowed.
- Transaction IDs, screenshots, and PDFs are inputs for verification. Only authoritative provider
  evidence can approve a payment.
- An authoritative payment can fund exactly one deposit request, enforced by a provider-specific
  canonical-reference fingerprint.
- Verification, KemerBet execution, and external payout are separate workflows. This ledger does
  not create an automated wallet/bank payout.
- The initial executor remains dry-run and has no ability to complete a KemerBet transfer.

## Planned entities

| Entity                                | Purpose                                                   | Critical invariant                                                                                |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `customer_platform_players`           | A customer's validated Player ID for a platform           | A platform Player ID belongs to only one customer.                                                |
| `player_validation_attempts`          | Append-only KemerBet Player ID validation results         | A Player ID cannot become valid without its latest immutable successful attempt.                  |
| `deposit_intents`                     | The customer intent and immutable receipt/policy snapshot | Each KemerBet deposit is 25–25,000 ETB; no customer transaction-count cap exists.                 |
| `deposit_submissions`                 | A submitted transaction ID and its attempt number         | The raw ID is encrypted; a keyed fingerprint supports duplicate detection.                        |
| `deposit_submission_files`            | Private receipt image/PDF metadata                        | Object key only; private Storage bucket; exactly 90-day retention.                                |
| `deposit_dry_run_fixture_assessments` | Redacted local-fixture simulation results                 | Append-only and explicitly non-authoritative; never provider evidence or approval.                |
| `deposit_dry_run_fixture_reviews`     | Final Owner acknowledgement of a simulation               | Append-only; acknowledgement or manual-review routing only.                                       |
| `provider_payment_evidence`           | Normalized official-provider facts                        | Only provider API, receipt lookup, or account activity sources are allowed; OCR cannot create it. |
| `deposit_verification_attempts`       | Append-only verifier outcomes                             | No raw provider response or credential in the record.                                             |
| `deposit_payment_claims`              | Authoritative payment accepted for an intent              | Unique on `(provider, canonical-reference fingerprint)` and one claim per intent.                 |
| `deposit_review_cases`                | Verification or execution uncertainty                     | Only one open case per intent and stage.                                                          |
| `deposit_jobs`                        | Durable verification/reconciliation queue                 | A lease is required; the current Stage 2 payload is deliberately empty.                           |
| `deposit_state_events`                | Append-only intent transition history                     | Every insert or status transition produces a system event.                                        |
| `deposit_execution_attempts`          | Later KemerBet execution record                           | Must exist before execution; uncertain results require reconciliation.                            |
| `execution_reconciliations`           | Check wallet/history after an uncertain result            | Reconciliation precedes any execution retry.                                                      |

## Deposit state flow

```text
intake_received
  -> verification_pending
  -> verified
  -> execution_pending                (future, still dry-run)
  -> execution_in_progress            (future)
  -> executed

verification_pending -> verification_review -> verification_pending | verified | rejected
verification_pending -> rejected | expired
execution_in_progress -> execution_uncertain -> execution_reconciliation
execution_reconciliation -> execution_pending | executed | execution_review
```

No transition may move an uncertain execution directly to `executed`. A reconciliation record is
required first. A duplicate, stale, receiver-mismatched, incomplete, or non-authoritative payment
is rejected or routed to `verification_review`; it cannot reach execution.

## Privacy and retention

- Transaction IDs and canonical provider references are encrypted before storage. Their keyed
  fingerprints are used for uniqueness and duplicate detection; no raw reference belongs in logs
  or audit metadata. The current API capture function records a transaction ID only as an
  encrypted, untrusted submission.
- Screenshot/PDF object-key metadata is modeled in the database, but the runtime upload path is
  deferred until the API can validate private-storage ingestion. When enabled, the files will stay
  private in payment-evidence and expire after 90 days.
- Audit metadata allows IDs, versions, and reason codes only. It never carries raw receipts,
  withdrawal codes, account references, provider payloads, or credentials.
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

The current ledger ends at a verified payment claim. A later, separately reviewed migration will
atomically add the dry-run execution record and job; it will still not permit a real KemerBet
transfer until its reconciliation safeguards are proven.

## Operations model

The bot calls the API only. The signed Telegram action route uses the narrow
`payreplayy_player_actions` database role for Player-ID actions and the reviewed dry-run intake;
the generic API role does not receive these procedure grants. The verification worker will use
`payreplayy_worker` through reviewed database procedures. Neither role receives direct ledger-table
access. The action route can call `app.open_telegram_dry_run_deposit_intent`, which is idempotent by
inbound Telegram event, requires an active Owner-confirmed Player ID plus all four disabled financial
feature switches, and returns the frozen display-safe CBE Birr receiver snapshot. It can then call
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
