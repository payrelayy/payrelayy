# Paired Windows execution activation: current boundary

The production Windows companion has an opt-in one-use execution worker and a separate signed
execution transport. Both are deliberately dormant. The database execution control is disabled,
and the execution capability role has no runtime member. There is **no reviewed production arm
operation**. Setting a local environment flag, granting a role, or updating the control row by
hand is not an activation procedure.

## Current paid-proof state

The Owner stopped the last live TeleBirr pilot with `owner_stop`. Its existing reservation and
queued deposit job are preserved; the job was not leased or executed. A stopped pilot cannot be
re-armed or silently replaced for that job. The existing executor requires a current, matching
pilot and trusted activation epoch before it can lease a TeleBirr job. Do not submit the receipt
again or copy the reservation into a new pilot.

Migration `review_stopped_pilot_paid_execution_job` adds a **dormant, Postgres-only** disposition
for this state. Merely installing it leaves the job queued and changes no production row. A
separately authorized invocation requires an exact active Owner, stopped `owner_stop` pilot,
singular verified payment claim and reservation, untouched zero-attempt execution job, no
execution attempt, and every financial switch disabled. It atomically cancels only that job,
changes the deposit to `execution_review`, opens an execution review case, and records an immutable
one-use receipt. The claim, payment evidence, reservation, and deposit history remain retained.
This is **not a credit or a refund**: customer resolution remains a separate, explicit obligation.
The function has no application or runtime grant. Never invoke it as part of migration deployment.

Run `infra/sql/production-companion-execution-activation-status.sql` with a read-only production
administrator session to obtain one identifier-free status object. It reports bounded counts and
categorical states only. It performs no activation or queue mutation. The contract verifier is
`node infra/verify-production-companion-execution-activation-status.mjs`.

The **Inspect production companion execution readiness** workflow runs that same status query
against exact passing main with a read-only database session. Its output is a redacted snapshot,
not an activation authorization. `activationAvailable` deliberately stays `false` until a
separately reviewed activation operation exists. `nextAction` is one of these diagnostic classes:

- `safety_review`: a financial switch, execution control, capability role, or execution ledger
  is outside the dormant boundary; stop before any activation work.
- `paid_stopped_pilot_review`: one untouched queue item belongs to the stopped pilot and needs
  separate customer-resolution review. The workflow never invokes that disposition.
- `queue_reconciliation`: another queued or changed job requires independent review.
- `pilot_review`: there is no armed pilot available for a future activation.
- `trusted_activation_review`: the trusted TeleBirr epoch is not active for the armed pilot.
- `release_and_owner_review`: the database snapshot alone is insufficient; release, Owner,
  credential, and local Windows checks still must pass before activation can be considered.

No `nextAction` value is permission to arm a switch, lease a queue item, or move money.

## Missing activation implementation

Before any money-capable release, one separately reviewed change must provide all of the
following as one fail-closed operation, with disposable-PostgreSQL and end-to-end tests:

1. An Owner-authorized, one-use activation request tied to the exact pilot, current trusted
   TeleBirr epoch, paired certificate, platform agent account, execution signer, immutable release,
   and a short non-sliding expiry. A stopped or expired pilot must be rejected.
2. A database-owned activation transition that locks the epoch, sorted switch rows, pilot,
   certificate, and execution control in the established order; rechecks every lineage and
   financial invariant; and atomically arms only the exact companion control. No direct table
   write, broad grant, or request-key replay may substitute for this transition.
3. A dedicated execution-bridge runtime identity with exactly the seven execution procedures
   and no base-table access. Its membership and login must be created only inside the bounded
   activation, then revoked and sessions terminated at stop, expiry, failure, or uncertainty.
4. A checksum-bound production transport release with the pinned execution signer and the
   reviewed overlay. The default release must remain no-money. The paired Windows process must
   receive its account-bound opt-in through a reviewed local handoff, not a manually set flag.
5. A rehearsed independent emergency stop and reconciliation path. The final-action fence must
   be one-use, and any ambiguous provider response must stop without an automatic retry. The
   queue item must never be leased for a test of the activation plumbing.

Until all five are implemented and reviewed together, the executable path stays disabled. The
status query and dormant disposition do not make the Telegram bot able to credit KemerBet or
automatically resolve the already-paid proof.
