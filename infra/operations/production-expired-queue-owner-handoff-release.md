# Expired unattempted SMS queue — guarded production release

PR #1012 gives each verified SMS match 60 minutes for an unstarted automatic
credit. After that, a Postgres cron job cancels only a queued, zero-attempt job
and opens Owner review. The migration-time pass includes already stranded jobs.
The migration makes no KemerBet transfer and does not retry any payment.

The latest successful guarded production runtime deployment was
`4145ac2771ce5c10b47e356301e476c1c5da0766` on Droplet `593344964`.
Its reviewed deploy helper digest is
`8c0d9f6f3583697908fe5d39dd6a4289ab105f4084597d27ee75070ee989f1a6`.
The successor helper digest is
`0efa14c6f0cf5e73952e3cd6e66a5c3750b18931ec410a83b63042d90247efe6`.
These are release guards, not a claim that the live host still matches: check
the host again immediately before rotation and activation.

1. Require green PR checks and exact merged-main CI. Read the live release,
   routine-deposit marker, helper and sudoers digests, unchanged payment
   switches, signed SMS route, queued job counts, and unresolved attempts.
   Stop if the predecessor differs or a transfer is active or uncertain.
2. Stage the merged-main helper Git blob in the root-owned mode `0700` folder
   `/root/fetanagent-production-v2-expired-queue-owner-handoff-helper-rotation-v1-input`
   as `fetanagent-production-deploy-helper-v2.next`, mode `0600`. Stage
   `fetanagent-production-v2-expired-queue-owner-handoff-helper-rotation-v1.sh`
   separately, root-owned mode `0700`. Verify both Git blob digests and Bash
   syntax. Run the script as root with `inspect`; require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 EXPIRED QUEUE OWNER HANDOFF HELPER V1`, then
   inspect again and require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `supabase-production-release.yml` on that exact passing main SHA,
   confirming production project `xzztugbgtulptnbpoelr` and
   `APPLY PRODUCTION MIGRATIONS`. Require migration
   `20261030202601_receiver_sms_expired_queue_owner_handoff.sql` exactly once,
   the one-minute cron job active as `postgres`, and a migration-time handoff
   for any still-eligible stranded zero-attempt job. No credit is created.
4. Dispatch `production-runtime.yml` from the same main SHA with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   both TeleBirr pilot inputs `not-applicable`, routine transport `enabled`,
   database route `pooler`, financial profile `cbe-live-v1`, and confirmation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Require exact predecessor,
   idle cutover, healthy app and bot, carried routine marker, and unchanged
   switch fingerprint.
5. Verify the release and migration ledger, cron, healthy services, unchanged
   payment switches, and Owner Submitted payments. A handoff card must offer
   Approve, Reject, and Record outside credit. Owner actions still require the
   Owner to verify whether any outside KemerBet credit already happened.
   Do not submit or replay a payment to test this release.

Stop on a failed guard. After the migration is applied, deploy the matching
Owner application before using its expired-queue controls; the older page does
not understand their combined flags. Do not change financial switches or
retry a payment to force a release check to pass.
