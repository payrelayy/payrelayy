# Deposit outcome button — guarded production rollout

This bot release attaches the Deposit action to immediate payment intake, duplicate,
rejection, and status replies. The durable final credit and rejection notifier
already attaches it. The change does not alter verification, credit execution,
the database, or payment switches. Do not create a test payment for this rollout.

The reviewed predecessor on Droplet `593344964` is
`842f1fb301de9a479c558b06cbc20fd67e3e45fc`, with the same routine-deposit
marker. The installed helper SHA-256 is
`b0c9115f3b14d74c38356923cbc68e95de6223dce2dd5e5c0cb7e2c77b01feb2`.
The successor helper SHA-256 is
`2c6d86b14144149b75acb1bb46718b92bda4813e8351f94086f1fec5d44dc47c`.

1. Require green CI for the exact merged `main` commit. Read the current release,
   routine marker, helper and sudoers digests, payment-switch profile, and
   unresolved deposit attempts. Stop if they differ from the reviewed state.
2. Stage the exact merged-main helper Git blob at
   `/root/fetanagent-production-v2-deposit-outcome-button-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory with file mode `0600`. Stage
   `fetanagent-production-v2-deposit-outcome-button-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify both digests and Bash syntax.
   Run `inspect`, then `rotate` with
   `ROTATE EXACT PRODUCTION V2 DEPOSIT OUTCOME BUTTON HELPER V1`. Require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing `main` SHA with
   `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, routine transport `enabled`, database route `pooler`, financial
   profile `cbe-live-v1`, and operation phrase
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Both TeleBirr pilot inputs are
   `not-applicable`. Stop on a failed guard; do not change a switch to pass.
4. Verify the new release SHA, bot polling health, public Owner page, unchanged
   financial-switch fingerprint, routine transport, and unresolved work.
