# Expired payment-card menu removal — guarded production release

PR #957 removes the bot message and menu sent when an old payment instruction expires. The
existing card is still deleted and acknowledged; buttons remain attached to real Player ID and
deposit outcomes. This release does not change payment decisions, receivers, or credit logic.

The reviewed production predecessor on Droplet `593344964` is
`2fb198cf9a4f2a7a2ac8a3b22d3ad43130f02943`, with the routine-deposit marker at the same
SHA. The installed helper and sudoers pin are
`64e976802d4f6719a4589ffe47e3029dba772d3690fa1f6762642d01cfb65e0e`.
The successor helper SHA-256 is
`bf9f012fc93e16f8b4be7fe92a372751d56d69a0198e6c4679a57c10a612d6ad`.

1. Require green checks on the exact merged main commit. Recheck the active release, routine
   marker, helper and sudoers pin, public health, seven payment switches, receiver settings,
   and deposit jobs and execution attempts. Stop unless the CBE-live payment profile remains
   exact and there are no active jobs or unresolved attempts. Do not change switches or
   receivers to satisfy a guard.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-bot-expiry-menu-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned mode-`0700` directory, with the file root-owned mode `0600`.
   Stage `fetanagent-production-v2-bot-expiry-menu-helper-rotation-v1.sh` separately as
   root-owned mode `0700`. Verify both SHA-256 digests and Bash syntax. Run `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 BOT EXPIRY MENU HELPER V1`, then repeat `inspect` and require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing main SHA with `mode=deploy-inert`,
   project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot inputs
   `not-applicable`, routine transport `enabled`, payment profile `cbe-live-v1`, and database
   route `pooler`. Require its last-moment idle check, financial-switch fingerprint check,
   post-activation health, and successful finalization. Stop on any guard failure.
4. Confirm the active runtime SHA and routine marker, bot polling health, unchanged payment
   switches and receivers, and no unresolved credit work. Inspect `/menu` and a Deposit card
   without submitting a payment. Do not make or retry a payment as a release test.
