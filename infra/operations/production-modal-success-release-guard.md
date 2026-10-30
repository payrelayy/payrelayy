# Transfer Successful release guard — guarded production release

The current production release is
`e4139b56da5c514e4be219cc751bf08cc2a3684a` on Droplet `593344964`.
Its installed deploy helper and restricted sudoers grant have SHA-256
`0f4afb50ac6a1f37b6afa8bc1e2026a2bd52af9a5bef6dc5dfc847d6979647df`.
The successor helper pins that exact running release and has SHA-256
`8c0d9f6f3583697908fe5d39dd6a4289ab105f4084597d27ee75070ee989f1a6`.
This helper rotation changes no running container, payment switch, or credit.

1. Require passing CI for the exact merged main commit. Verify the live release,
   routine marker, helper and sudoers digests, unchanged payment switches, and
   absence of active jobs or unresolved attempts. Stop on any mismatch.
2. Stage the merged-main helper Git blob as root-owned mode `0600` at
   `/root/fetanagent-production-v2-modal-success-release-guard-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned mode `0700` directory. Stage
   `fetanagent-production-v2-modal-success-release-guard-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify exact file digests and Bash
   syntax. Run `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 MODAL SUCCESS RELEASE GUARD HELPER V1`, then run
   `inspect` again and require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the same green main SHA with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   both TeleBirr pilot inputs `not-applicable`, routine transport `enabled`,
   database route `pooler`, financial profile `cbe-live-v1`, and confirmation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. The workflow must recheck the
   predecessor, payment fingerprint, idle cutover, health, and routine marker.
4. Verify the exact deployed release and public health. Do not submit a real
   payment as a test. Install the separately attested Windows Companion only
   after fresh action-time confirmation.
