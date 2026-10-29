# Payment intake acknowledgement — guarded production rollout

This bot release removes the Deposit action from the interim “Payment details
received” acknowledgement on both payment routes. It keeps the action on final
credit and rejection outcomes, and keeps Check status on the legacy TeleBirr
verification route. The change does not alter verification, credit execution,
the database, or payment switches. Do not create a test payment for this rollout.

The reviewed predecessor on Droplet `593344964` is
`7d17b2c56f0583f96dbc2bacb15c2e0a54fa7732`, with the same routine-deposit
marker. The installed helper SHA-256 is
`2c6d86b14144149b75acb1bb46718b92bda4813e8351f94086f1fec5d44dc47c`.
The successor helper SHA-256 is
`37bfde8ed339a6ca911342458d0e954122d1e62fcc528b31b8b8fb2460575108`.

1. Require green CI for the exact merged `main` commit. Read the current release,
   routine marker, helper and sudoers digests, payment-switch profile, and
   unresolved deposit attempts. Stop if they differ from the reviewed state.
2. Stage the exact merged-main helper Git blob at
   `/root/fetanagent-production-v2-payment-intake-ack-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory with file mode `0600`. Stage
   `fetanagent-production-v2-payment-intake-ack-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify both digests and Bash syntax.
   Run `inspect`, then `rotate` with
   `ROTATE EXACT PRODUCTION V2 PAYMENT INTAKE ACK HELPER V1`. Require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing `main` SHA with
   `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, routine transport `enabled`, database route `pooler`, financial
   profile `cbe-live-v1`, and operation phrase
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Both TeleBirr pilot inputs are
   `not-applicable`. Stop on a failed guard; do not change a switch to pass.
4. Verify the new release SHA, bot polling health, public Owner page, unchanged
   financial-switch fingerprint, routine transport, and unresolved work.
