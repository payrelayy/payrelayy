# Owner database session release

The Owner API uses one session-pooler database connection. Its 10-second idle
disconnect churned that session while the database role allowed one connection,
which caused intermittent `53300` failures and made Submitted payments appear
unavailable. The runtime change keeps the same one connection open across idle
periods. It does not change payment logic, switches, or database roles.

The reviewed running release on production Droplet `593344964` is
`83a93f54f6684f4ca22bfdaa3c715a64a12a1d6d`. Its installed deploy helper
SHA-256 is `25bacc11e4195c76e181b78cb800b69da286e42419aee64211f86e0484ff141a`;
the successor helper SHA-256 is `3448cf9b020dadb573a6433b970544d2c7727db13ad3ab89a0b20c3c896cd141`.
Recheck the exact live release, routine marker, helper digest, and payment state
immediately before rotation and activation. Stop on any difference.

1. Require green PR checks and exact merged-main CI. Confirm no active or
   unresolved deposit attempt, the current financial switch fingerprint, and
   the healthy running release. Do not retry a credit for deployment testing.
2. Stage the exact merged-main Git blob for
   `fetanagent-production-deploy-helper-v2.sh` as root-owned mode `0600` at
   `/root/fetanagent-production-v2-owner-db-session-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`.
   Stage `fetanagent-production-v2-owner-db-session-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify digests and Bash syntax.
   Run `inspect`; require `predecessor-exact; no production runtime changed`.
   Run `rotate` with `ROTATE EXACT PRODUCTION V2 OWNER DB SESSION HELPER V1`.
   Inspect again; require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA,
   with `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, both TeleBirr pilot inputs `not-applicable`, routine transport
   `enabled`, database route `pooler`, and the observed unchanged financial
   profile. For `cbe-live-v1`, the operation phrase is
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`.
4. Verify the exact active release and healthy services. In the signed-in
   Owner page, load Pending, Approved, and Rejected submitted payments. Check
   that the Owner database role stays on one backend connection through an idle
   interval and that no new `53300` burst appears in database logs.
