# Deposit number copy hint release

This bot copy update adds one Amharic hint after the TeleBirr and CBE Birr
receiver numbers in the combined deposit card. The amount range, receiver
selection, saved Player ID, and payment processing are unchanged. Replies to
cards sent before this update remain recognized.

The reviewed production Droplet is `593344964`. The running release and routine
marker must both be `bc6905f906850a61230837ef5b7ed2303fb3f001`. Rotate the
restricted deploy helper from digest
`6bca4a0883bfea3bf538bf1cc8b10d3daba3e38c518f1da3bc6b69a3a4a40e18`
to `4041da029ce206492d8de5da3cb08add6e1ec85683705a21f8fc8fdc464c9888`
using `fetanagent-production-v2-deposit-copy-hint-helper-rotation-v1.sh`.

1. Require passing PR and exact-main CI. Verify the running release, helper and
   sudoers digest, routine marker, unchanged `cbe-live-v1` financial switches,
   and no active or unresolved deposit execution. Stop on any mismatch.
2. Stage the exact merged-main Git blob of
   `fetanagent-production-deploy-helper-v2.sh` at the root-only path in the
   rotation script. Stage the rotation script separately with root ownership
   and restrictive modes. Verify SHA-256 and Bash syntax.
3. Run `inspect` and require `predecessor-exact; no production runtime changed`.
   Run `rotate 'ROTATE EXACT PRODUCTION V2 DEPOSIT COPY HINT HELPER V1'`, then
   `inspect` and require a `successor-exact` result with no production runtime change.
4. Dispatch `production-runtime.yml` from passing main with `deploy-inert`,
   project `xzztugbgtulptnbpoelr`, Droplet `593344964`, operation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`, routine transport `enabled`,
   profile `cbe-live-v1`, database route `pooler`, and both TeleBirr pilot inputs
   `not-applicable`. Require the predecessor check, unchanged switch fingerprint,
   healthy services, and carried routine marker.
5. Inspect the running bot release and a newly generated deposit instruction.
   Confirm the hint is between the number sections and Saved Player ID without
   submitting a real payment for a smoke test.
