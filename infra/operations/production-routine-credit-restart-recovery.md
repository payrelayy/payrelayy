# Routine credit restart recovery

## Incident

On 2026-11-02 at 13:18:34 UTC, the production bridge restarted while the
Companion was requesting the final Transfer fence for a 200 ETB payment. The
local journal recorded `final_action_requested` and then `review_paused`, but
no `final_action_fenced` or `transfer_click_requested`. The prepared attempt
was cancelled before the action and the payment moved to Owner review. Do not
retry that payment automatically or use a fresh transfer as a release test.

The release race was possible because the deployment checked for idle work
before activation, while a new lease could be issued between that check and
the service restart.

## Change

- The broker takes a shared lock on the release gate before issuing a new
  lease. The deployment arms that gate with an exclusive update, waits for
  active and unresolved attempts to drain, activates the release, then clears
  the gate. Queued jobs resume under the new release. An abandoned gate expires
  after 20 minutes.
- If a final-action request fails, the Companion repeats only the signed,
  idempotent review handoff. Once the attempt is durably isolated, it leaves
  the old KemerBet form and immediately claims the next queued payment. It
  never repeats the Transfer action for the uncertain attempt.
- Read-only Player Find runs after an empty payment lease. A contained payment
  does not introduce a Find step before the next queued credit.

## Release checks

1. Require passing PR checks and production SQL migration approval. Apply the
   migration before deploying the server or installing the Companion.
2. Confirm the current broker function fingerprint matches the migration's
   expected source, and that the release gate is installed and inactive.
3. Check the live queue for leased jobs and unresolved attempts. Resolve any
   existing case separately; do not trigger a transfer for verification.
4. Deploy with the existing guarded financial switch profile. Confirm the
   release gate was armed before activation and disarmed afterward, and verify
   the same profile remains active.
5. Install the attested Companion build on Kamatera after a fresh install
   confirmation. Confirm the signed check-in, exact running version, and
   repeated empty leases or safe credit completion.
6. Review the 200 ETB Owner case with the actual KemerBet outcome. The migration
   and release do not make a credit or an Owner decision for it.

If the database or any required service is unhealthy, defer activation and
diagnose it before treating the release as verified.
