# Routine Companion alert correction — production release

The Owner Home alert now uses authenticated routine deposit lease requests from
the active Companion. The older read-only lookup connection remains available in
Advanced tools. This release does not create or retry credits.

Production currently runs `0baab816c76f95c3a383cf7008d6cbbb77852561`
with its routine-deposit marker. Its protected helper SHA-256 is
`306708f9fd01370b625112742d15bab503098db9749d21b2a41cf9117bb0d730`.
The reviewed successor helper SHA-256 is
`c231e0efd97001728f0ba73a47ac6344f115348ff9e0e812c7736298069aa6ff`.

1. Require green CI on the exact merged main commit. Verify Droplet `593344964`,
   current release and routine marker, helper and sudoers digests, unchanged
   financial switches, and no active or unresolved Transfer.
2. Apply `20261029130522_owner_routine_companion_alert.sql` through the reviewed
   production migration workflow. Verify that only the Owner overview function
   changed and that the latest routine Companion timestamp is recent. Do not
   use the alert to infer KemerBet sign-in.
3. Stage the exact merged-main helper Git blob as root-owned mode `0600` at
   `/root/fetanagent-production-v2-routine-companion-alert-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned `0700` directory. Stage
   `fetanagent-production-v2-routine-companion-alert-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify both digests and Bash syntax.
   Run `inspect`, then `rotate` with
   `ROTATE EXACT PRODUCTION V2 ROUTINE COMPANION ALERT HELPER V1`. Require
   `successor-exact; rotation complete; no production runtime changed`.
4. Dispatch `production-runtime.yml` from the same passing main commit with
   `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, routine transport `enabled`, database route `pooler`, financial
   profile `cbe-live-v1`, and operation phrase
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Both TeleBirr pilot inputs are
   `not-applicable`. Stop if any preflight differs; do not change a payment
   switch to make deployment pass.
5. Confirm the exact new release SHA, healthy bot and Owner service, unchanged
   payment switches and routine transport, and a healthy Owner Home check-in
   without the false missing-Companion alert.
