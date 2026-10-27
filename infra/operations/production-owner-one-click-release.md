# Owner one-click decisions release

This Owner UI release makes Reject in Submitted payments and Mark manually
credited in SMS one click. A matched signed SMS already makes Approve one click.
Submissions without a matching signed SMS still require the bank-confirmed amount,
receiving account, and Owner confirmation. The underlying payment checks,
automatic SMS settlement policy, and KemerBet Companion are unchanged.

The reviewed production Droplet is `593344964`. The running release and routine
marker must both be `8342305d6e4728dd3eccbbebaab3098509eb67ac`. Rotate the
restricted deploy helper from digest
`c94d3871386ac8f7b5a948468bc345841a1576a6b536029b43badfd0ddeacee6`
to `6bca4a0883bfea3bf538bf1cc8b10d3daba3e38c518f1da3bc6b69a3a4a40e18`
using `fetanagent-production-v2-owner-one-click-helper-rotation-v1.sh`.

1. Require passing PR and exact-main CI. Verify the running release, helper and
   sudoers digest, routine marker, unchanged `cbe-live-v1` financial switches,
   and no active or unresolved deposit execution. Stop on any mismatch.
2. Stage the exact merged-main Git blob of
   `fetanagent-production-deploy-helper-v2.sh` at the root-only path in the
   rotation script. Stage the rotation script separately, with owner root and
   restrictive modes. Verify SHA-256 and Bash syntax.
3. Run `inspect` and require `predecessor-exact; no production runtime changed`.
   Run `rotate 'ROTATE EXACT PRODUCTION V2 OWNER ONE CLICK HELPER V1'`, then
   `inspect` and require `successor-exact; rotation complete; no production
runtime changed`.
4. Dispatch `production-runtime.yml` from passing main with `deploy-inert`,
   project `xzztugbgtulptnbpoelr`, Droplet `593344964`, operation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`, routine transport `enabled`,
   profile `cbe-live-v1`, database route `pooler`, and both TeleBirr pilot inputs
   `not-applicable`. Require the predecessor check, unchanged switch fingerprint,
   healthy services, and carried routine marker.
5. In the signed-in Owner page, inspect a pending submission with matched SMS,
   one without SMS, and an eligible linked or unlinked SMS. Confirm the button
   layout and guidance. Do not click a live payment decision for a smoke test.

The automatic deposit policy remains 100–25,000 ETB with the current time
windows. Older stopped payments stay for separate review.
