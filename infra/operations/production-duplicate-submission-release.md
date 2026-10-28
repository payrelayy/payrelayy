# Production duplicate-submission release

The duplicate-submission database migration is already applied. The bot and API
remain on release `20beb62d28aedc1e60873f9ad9ecec164fee9466` because the
guarded runtime deployment requires that exact predecessor. The routine-deposit
marker has the same SHA. The installed root deploy helper and its sudoers grant
have SHA-256 `843230c82f4a7fb1401e0a7e6277b041935b8ec3601867b2f083604845271d06`.
The successor helper pins the current release and has SHA-256
`2683e4c0a0f9c47ff6e3f4ae8dedcf439e6ac3d976baa523651f32621922477e`.

1. Require passing PR and exact-main CI. Confirm Droplet `593344964`, current
   release, routine marker, release mode, absent execution-v2 marker, installed
   helper digest, sudoers pin, and helper `status`. Confirm payment switches
   still match the `cbe-live-v1` profile and inspect active or unresolved credit
   attempts. Stop if any guard differs.
2. From the passing main commit, stage the successor helper as an ordinary
   root-owned mode-`0600` file at
   `/root/fetanagent-production-v2-duplicate-submission-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`.
   Stage `infra/operations/fetanagent-production-v2-duplicate-submission-helper-rotation-v1.sh`
   separately as a root-owned mode-`0700` file. Verify both against the merged
   Git blobs and run `bash -n` before execution.
3. Run the rotation script as root with `inspect`; require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 DUPLICATE SUBMISSION HELPER V1`. Run `inspect`
   again; require `successor-exact; rotation complete; no production runtime changed`.
4. Dispatch `production-runtime.yml` from that same passing main commit with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot inputs
   `not-applicable`, routine transport `enabled`, financial profile `cbe-live-v1`,
   and database route `pooler`. Require the workflow's exact predecessor,
   payment-switch fingerprint, activation, health, and routine-marker checks.
5. Verify the live release SHA and bot/API health. Use read-only production
   queries to check the duplicate-disposition function and existing row counts.
   Do not create a real payment to test a customer message.

Stop on a failed guard and inspect the reason. Do not change payment switches
to force a deployment.
