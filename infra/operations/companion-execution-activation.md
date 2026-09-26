# Paired Windows execution activation: current boundary

The production Windows companion has an opt-in one-use execution worker and a separate signed
execution transport. Both are deliberately dormant. The database execution control is disabled,
and the execution capability role has no runtime member. There is **no reviewed production arm
operation**. Setting a local environment flag, granting a role, or updating the control row by
hand is not an activation procedure.

## Current paid-proof state

The Owner stopped the last live TeleBirr pilot with `owner_stop`. A separately authorized,
one-use customer-resolution review then cancelled its untouched queued job and opened one
execution review case. The payment claim, evidence, reservation, and history remain preserved;
the job was never leased or executed. A stopped pilot cannot be re-armed or silently replaced for
that payment. Do not submit the receipt again or copy the reservation into a new pilot.

Migration `review_stopped_pilot_paid_execution_job` added a **Postgres-only** disposition
for this state. Merely installing it changed no production row. Its separately authorized,
completed invocation required an exact active Owner, stopped `owner_stop` pilot,
singular verified payment claim and reservation, untouched zero-attempt execution job, no
execution attempt, and every financial switch disabled. It atomically cancels only that job,
changes the deposit to `execution_review`, opens an execution review case, and records an immutable
one-use receipt. The claim, payment evidence, reservation, and deposit history remain retained.
This was **not a credit or a refund**: customer resolution remains a separate, explicit obligation.
The function has no application or runtime grant. Never invoke it as part of migration deployment,
and never invoke it again for the reviewed job.

Run `infra/sql/production-companion-execution-activation-status.sql` with a read-only production
administrator session to obtain one identifier-free status object. It reports bounded counts and
categorical states only. It performs no activation or queue mutation. The contract verifier is
`node infra/verify-production-companion-execution-activation-status.mjs`.
`cancelledUntouchedJobs` distinguishes the protected, never-leased paid job from a queued job;
`customerResolutionPending` requires the open case, immutable review receipt, retained payment
lineage, and no execution attempt. Neither field means the customer has been credited or refunded.

The **Inspect production companion execution readiness** workflow runs that same status query
against exact passing main with a read-only database session. Its output is a redacted snapshot,
not an activation authorization. `activationAvailable` deliberately stays `false` until a
separately reviewed activation operation exists. `nextAction` is one of these diagnostic classes:

- `safety_review`: a financial switch, execution control, capability role, or execution ledger
  is outside the dormant boundary; stop before any activation work.
- `paid_stopped_pilot_review`: one untouched queue item belongs to the stopped pilot and needs
  separate customer-resolution review. The workflow never invokes that disposition.
- `queue_reconciliation`: another queued or changed job requires independent review.
- `customer_resolution_pending`: the stopped-pilot paid job has one protected review receipt,
  its queue item is cancelled without an execution attempt, and one execution review case remains
  open. Do not infer a credit or refund.
- `pilot_review`: there is no armed pilot available for a future activation.
- `trusted_activation_review`: the trusted TeleBirr epoch is not active for the armed pilot.
- `release_and_owner_review`: the database snapshot alone is insufficient; release, Owner,
  credential, and local Windows checks still must pass before activation can be considered.

No `nextAction` value is permission to arm a switch, lease a queue item, or move money.

The Owner page's **Deposit execution readiness** panel is a smaller, authenticated projection of
this diagnosis. It shows bounded counts and a plain-language next step without job, Player,
receipt, or account identifiers. It has only a refresh control; `activationAvailable` is always
false. Its database function grants execute only to the Owner-control role and performs no
mutation. The current paid stopped-pilot case should display `customer_resolution_pending`,
not an executable job.

Roll out this additive preview in order: deploy the reviewed Owner image with its optional
function preflight first, then apply the reviewed append-only migration that grants the function.
The old Owner image's strict exact-grant preflight does not accept the new grant if it is applied
first. Confirm the Owner service remains healthy and the preview returns a redacted result after
the migration. Do not use a migration-only release before updating the Owner image, and do not
conflate either deployment with execution activation.

## Inert one-use request foundation

Migration `companion_execution_one_use_request` adds an immutable preparation record and an
administrator-only preparation routine. It binds one request to the current trusted epoch,
armed pilot, active Owner, Owner-paired Windows certificate, KemerBet agent account, pinned
execution signer, and claimed immutable companion release/archive digests. The routine refuses
preparation unless the financial epoch is already current and the companion control is still
disabled. At most one unexpired request can cover the same pilot/epoch; an exact replay changes
nothing. A later, separately authorized fresh request may replace an expired one without
requiring a new twelve-hour pilot.

This is **not** the activation transition. Release digests in a request are claims and must be
independently attested against the installed bundle and running runtime. The request expires in
at most ten minutes (separate from a twelve-hour pilot); expiry never slides on replay. There
is no application EXECUTE grant, no request consumer, no companion-control write, no runtime
credential, no local Windows opt-in, and no job lease in this migration. Do not invoke the
preparation routine in production until the remaining activation operation, transport, local
handoff, and emergency-stop pieces are reviewed together.

## Missing activation implementation

Before any money-capable release, one separately reviewed change must provide all of the
following as one fail-closed operation, with disposable-PostgreSQL and end-to-end tests:

1. Connect the inert one-use request to an authenticated Owner action and independently attest
   the exact installed release/archive. Recheck the pilot, epoch, certificate, and short
   non-sliding expiry at consumption; a stopped or expired pilot must be rejected.
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
