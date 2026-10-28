# Review notice bot — guarded production rollout

PR #995 merged the bot's silent interim-review handling and immediate intake
acknowledgment. Its SQL migration is already live. This rollout updates the bot
runtime only; it must not change payment switches, receiving accounts, or
credit state. Do not submit a real payment to test it.

The reviewed predecessor on Droplet `593344964` is
`781fa538102a5b7d490438d75d285882a71a8e68`, with the same routine-deposit
marker. The installed helper SHA-256 is
`e9496ec77d38ad36ab3645e18e2ecccb0cd584db686f2b70693e03d98c9aa000`.
The successor helper SHA-256 is
`002766a2e8e8736bf21e7361ce33c3ef8686a55d0d27e72f870365f0e8979349`.

1. Require green CI for the exact merged `main` commit. Read the current
   release, routine marker, helper and sudoers digests, payment-switch profile,
   and unresolved deposit attempts. Stop if they differ from this release's
   reviewed state.
2. Stage the exact merged-main helper Git blob at
   `/root/fetanagent-production-v2-review-notice-bot-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory with file mode `0600`. Stage
   `fetanagent-production-v2-review-notice-bot-helper-rotation-v1.sh` separately
   as root-owned mode `0700`. Verify both digests and Bash syntax. Run `inspect`,
   then `rotate` with
   `ROTATE EXACT PRODUCTION V2 REVIEW NOTICE BOT HELPER V1`. Require
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
