# Routine production TeleBirr deposits

This implements the Windows execution core for the approved
[TeleBirr product contract](telebirr-deposit-product-contract.md). It is not a go-live declaration.
The production database broker, signed routine authorization channel and deployment entry point
are not connected to this core yet. The existing v2 pilot and Owner-approved one-job path remain
unchanged, and merging this code does not start automatic deposits.

## Business rules

- TeleBirr, ETB, KemerBet deposits only.
- 25–25,000 ETB per deposit, inclusive, including valid cents. The amount comes from the verified
  official receipt's Settled Amount; payment fees and customer-entered amounts are not credited.
- Any currently active, validated, deposit-eligible Player ID, not a five-Player allowlist.
  TeleBirr payer-to-Player ownership matching is not required.
- No daily, lifetime, frequency or successful-deposit-count quota. Distinct accepted receipts
  for the same Player are permitted without a five-deposit limit.
- Persistent business authorization, rather than a twelve-hour testing policy. Revocation,
  emergency stop, one-use payment claims and per-action freshness still apply.
- One deposit at a time. Positive history and Player-credit reconciliation is required before
  the next deposit starts. An uncertain result holds the account lane; it is not retried.
- No per-deposit customer confirmation or Owner approval in routine automatic mode. The
  existing Owner-approved pilot mode is a separate path, not an automatic-approval workaround.

## Implemented code

`apps/windows-companion/src/local-kemerbet-deposit.ts` now has a separate
`executeRoutineOneUseLocalKemerBetDeposit` entry point. It validates integer minor units against
the existing domain limits, fills the exact two-decimal amount, resolves the requested Player
through the reviewed lookup response, and rechecks Player, ETB, amount and empty notes before
requesting a database fence. Final routine authority must bind the same Player and amount.

The provider route allowance is exact, single-use and remains occupied until its outcome settles.
An old/late callback cannot settle a later allowance. The existing `begin` and
`executeExactOneUseLocalKemerBetDeposit` APIs remain fixed at 25 ETB, as does the signed v2 capability.
Provider redirects, transport retries and arbitrary financial requests are still forbidden.

`local-kemerbet-session.ts` exposes the separate routine operation under the existing exclusive
browser-profile and operation locks. The read-only and v2 workers do not call it.

`routine-deposit-worker.ts` implements one complete execute → record dispatch → reconcile →
complete sequence. It checks an active routine policy and the exact job/intent/attempt/payment
claim/account/Player/amount binding. A ten-second one-use fence is requested only after UI
preparation. A submission response is not treated as successful credit. Pending reconciliation
retains the current job, and recovered fenced attempts reconcile without another submission.
Database failure, authority mismatch or uncertain credit pauses the worker instead of leasing
another job. The pause is set locally before any pause-notification I/O.

`routine-deposit-runner.ts` continuously invokes that worker, sequentially, without a count quota.
It has an abortable idle interval, stops on uncertainty and closes its browser session exactly once.
It is not imported or started by the production/read-only entry point.

## Remaining production integration

The `RoutineDepositExecutionStore` port is deliberately not a mock production adapter. Before
routine mode can be enabled, its real implementation must:

1. Persist the Owner's routine authorization separately from pilot/per-job approvals. Keep its
   policy/version binding current through revocation and emergency stop.
2. Select verified receipt-derived jobs outside the five-Player/fixed-25-ETB pilot boundary.
   Recheck the current Player eligibility, exact verified amount and global one-use payment claim.
3. Use the existing durable execution-attempt/agent-account blocking ledger, not just this process's
   `busy` flag. Claim, fence and complete operations must be atomic; multiple processes must not
   open parallel account lanes. A prepared/fenced/uncertain attempt must not become a fresh
   executable job merely because a worker lease or process expired.
4. Deliver an authenticated, distinctly versioned routine job/amount authority to the Windows
   worker. Never change the meaning of the fixed-25-ETB v2 signature, pretend that a routine job
   belongs to a pilot, or synthesize individual Owner approvals.
5. Bind confirmed reconciliation to the same attempt, exact Player/ETB/amount and unique provider
   history plus confirmed Player credit. `completeConfirmed` must re-read that durable result
   before releasing the lane. An HTTP 200 alone cannot release it.
6. Wire the routine runner into an explicitly authorized launcher, renewal/stop handling and
   production readiness projection. Verify the whole path without a live payment before rollout.

These are integration requirements, not new daily business limits. No migration, role grant,
production switch, phone enrollment, deployment or live financial action is performed by this PR.

## Verification

```powershell
pnpm -r run build
pnpm --filter @fetanagent/windows-companion test
node infra/verify-companion-execution-v2-deployment.mjs
```

Unit tests cover minimum/maximum amounts, cents, exact one-use payloads, v2 preservation, in-flight
serialization, mismatch/expiry/abort, ambiguous fence requests, recovery, reconciliation and more
than five distinct deposits for one Player. Isolated Windows Chrome tests exercise the real UI
adapter at 25.00, 25.01 and 25,000.00 ETB and reject wrong authority or UI tampering. All fixture
requests are fulfilled/aborted locally; they cannot reach KemerBet or move money. Those fixtures
do not prove a production deposit or production reconciliation has succeeded.
