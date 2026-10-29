# PDF receipt references — guarded production rollout

This release reads the reference from CBE Birr text PDFs and TeleBirr image-only
PDFs. The receipt supplies a candidate only; signed receiver-phone SMS remains
the payment authority. No SQL migration, payment-switch change, or test payment
is part of this rollout.

The reviewed predecessor on Droplet `593344964` is
`82b0ccc7c618c201e77d452967132e5bc23367f9`, with the same routine-deposit
marker. The installed helper SHA-256 is
`002766a2e8e8736bf21e7361ce33c3ef8686a55d0d27e72f870365f0e8979349`.
The successor helper SHA-256 is
`b0c9115f3b14d74c38356923cbc68e95de6223dce2dd5e5c0cb7e2c77b01feb2`.

1. Require green CI for the exact merged `main` commit. Read the current
   release, routine marker, helper and sudoers digests, payment-switch profile,
   and unresolved deposit attempts. Stop if they differ from this release's
   reviewed state.
2. Stage the exact merged-main helper Git blob at
   `/root/fetanagent-production-v2-pdf-receipt-reference-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory with file mode `0600`. Stage
   `fetanagent-production-v2-pdf-receipt-reference-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify both digests and Bash syntax.
   Run `inspect`, then `rotate` with
   `ROTATE EXACT PRODUCTION V2 PDF RECEIPT REFERENCE HELPER V1`. Require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing `main` SHA with
   `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, routine transport `enabled`, database route `pooler`, financial
   profile `cbe-live-v1`, and operation phrase
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Both TeleBirr pilot inputs are
   `not-applicable`. Stop on any failed guard; do not change a switch to pass.
4. Verify the new release SHA, bot polling health, public Owner page, unchanged
   financial-switch fingerprint, routine transport, and unresolved work. Do not
   create a test payment.
