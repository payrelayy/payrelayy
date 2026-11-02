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
   migration before deploying the server or installing the Companion. Confirm
   that the gate row is inactive and that the broker has the migrated source.
2. Confirm production Droplet `593344964` is healthy and still runs release
   `50129afcee54c65eabc193260bb16ffb9da071a5` with its routine marker.
   Confirm the installed helper SHA-256 is
   `7227d02fc9eee8e5ce4189e955ea32a2971ff76b3d330602e5536c9ef908bc19`.
   The successor helper SHA-256 is
   `08e3e3271eb05a0954794c9d2b5c7b7d7ddec3bb8cfb5233a5b8deacefda399f`.
   Stop if any value differs.
3. With separate production runtime approval, stage the exact passing main
   Git blob of `fetanagent-production-deploy-helper-v2.sh` as root-owned mode
   `0600` at
   `/root/fetanagent-production-v2-routine-drain-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`.
   Stage `fetanagent-production-v2-routine-drain-helper-rotation-v1.sh` as
   root-owned mode `0700`. Verify both digests and Bash syntax. Run `inspect`
   and require `predecessor-exact; no production runtime changed`, then run
   `rotate` with `ROTATE EXACT PRODUCTION V2 ROUTINE DRAIN HELPER V1`.
   Inspect again and require `successor-exact; rotation complete; no production
runtime changed`. Do not change a financial switch during rotation.
4. Check the live queue for leased jobs and unresolved attempts. Resolve any
   existing case separately; do not trigger a transfer for verification.
5. Dispatch `production-runtime.yml` from the passing main commit with
   `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, routine transport `enabled`, database route `pooler`, the
   observed financial switch profile, and both TeleBirr pilot inputs
   `not-applicable`. For `cbe-live-v1`, use operation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Stop if the observed profile
   differs from the reviewed one. Confirm the
   release gate was armed before activation and disarmed afterward, and verify
   the same profile remains active.
6. Install the attested Companion build on Kamatera after a fresh install
   confirmation. Confirm the signed check-in, exact running version, and
   repeated empty leases or safe credit completion.
7. Review the 200 ETB Owner case with the actual KemerBet outcome. The migration
   and release do not make a credit or an Owner decision for it.

If the database or any required service is unhealthy, defer activation and
diagnose it before treating the release as verified.
