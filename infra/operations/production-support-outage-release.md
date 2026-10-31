# Telegram support during deposit outages — guarded production release

This bot-only change keeps the last verified Owner support contact while the
Owner API is temporarily unavailable, adds a direct Support action when a
Deposit action disappears, and includes `/support` in the deposit-unavailable
reply. A verified Owner disable still clears the fallback. The public bot
Description now also contains an editable BotFather support link. This release
does not change payment verification, database state, payment switches, or
Player credit execution.

The reviewed running release on Droplet `593344964` is
`5db6bb64582ab1a1fc03d85cb5362b8fe7d7b932`. The installed helper SHA-256
is `415d6bc2a7565225bdb60e690f9655023ae7a0d73eb6a99c3660cc51f22a00d1`;
the successor is `25bacc11e4195c76e181b78cb800b69da286e42419aee64211f86e0484ff141a`.
These are stop guards: recheck them immediately before rotation.

1. Require green PR checks and exact merged-main CI. Recheck the running
   release, routine-deposit marker, installed helper and sudoers digests,
   payment switches, SMS route, and active or unresolved deposit attempts.
   Stop if any differs or a transfer is active or uncertain.
2. Stage the exact merged-main helper Git blob as root-owned mode `0600` at
   `/root/fetanagent-production-v2-support-outage-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned mode `0700` directory. Stage
   `fetanagent-production-v2-support-outage-helper-rotation-v1.sh` separately
   as root-owned mode `0700`. Verify both digests and Bash syntax. Run
   `inspect`; require `predecessor-exact; no production runtime changed`.
   Run `rotate` with `ROTATE EXACT PRODUCTION V2 SUPPORT OUTAGE HELPER V1`.
   Inspect again; require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA
   with `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`,
   Droplet `593344964`, both TeleBirr pilot inputs `not-applicable`, routine
   transport `enabled`, database route `pooler`, and the **observed**
   unchanged financial profile. For `cbe-live-v1`, the operation phrase is
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`; for `cbe-stopped-v1`, it is
   `DEPLOY CBE STOPPED PHONE PROOF`. Stop rather than change a switch to pass a
   guard.
4. Verify the exact release and healthy services, unchanged payment switches,
   Companion transport, and no unresolved work. Check `/support` and the
   public bot Description without sending a payment. The contact in BotFather
   remains editable independently of this code release.

Do not create or replay a payment as a release test.
