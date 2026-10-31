# Manual withdrawal contact production release

The Telegram menu adds **Withdraw** below **Deposit** after a Player ID is saved. The
button opens an Owner-configured Telegram contact through the stable Owner URL. It
does not create a withdrawal request, move money, or change financial switches.
The initial contact is `@balem18`.

The reviewed running release on production Droplet `593344964` is
`7aecb2ff0c51bcc0527eb60007d3dbbc9acbadd8`. Its installed helper SHA-256 is
`2123dfdaeb6be99cec69cb3fb6d1207173508c0d53ec28313131fa3c79137854`.
The reviewed successor helper SHA-256 is
`a2919bd701acd78c74a9e3296bf89828e045aa8525f41a9cebbfa845fb0a5171`.
Recheck these values immediately before rotation. Stop if any differs.

1. Require successful CI for the exact merged `main` commit. Confirm the healthy
   running release, routine-deposit marker, `cbe-live-v1` financial switch
   profile, and no active or unresolved deposit job or execution attempt. Record
   the financial switch fingerprint. Do not make a payment or retry a credit.
2. Stage the exact merged-main Git blob for
   `infra/operations/fetanagent-production-deploy-helper-v2.sh` as the root-owned
   mode-`0600` file
   `/root/fetanagent-production-v2-manual-withdrawal-contact-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned mode-`0700` directory. Stage
   `fetanagent-production-v2-manual-withdrawal-contact-helper-rotation-v1.sh`
   separately as a root-owned mode-`0700` file. Verify both against the merged
   blobs and run `bash -n` on both. Run the rotation script with `inspect` and
   require `predecessor-exact; no production runtime changed`. Run it with
   `rotate 'ROTATE EXACT PRODUCTION V2 MANUAL WITHDRAWAL CONTACT HELPER V1'`.
   Inspect again and require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the same passing merged-main SHA with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   both TeleBirr pilot inputs `not-applicable`, routine transport `enabled`,
   financial profile `cbe-live-v1`, database route `pooler`, and operation phrase
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Require its predecessor check,
   last-moment idle check, unchanged switch fingerprint, activation, and service
   health checks to pass. The new Owner server starts before the new migration;
   its withdrawal endpoint is unavailable until the next step.
4. Dispatch `supabase-production-release.yml` from the same merged-main SHA to
   apply `20261101013001_manual_withdrawal_contact.sql`. Confirm that it is the
   only pending migration. Its seed sets `@balem18`; its functions are limited
   to the Owner runtime role. The migration changes no financial switches.
5. Confirm the active release and healthy Owner and bot services. Check the
   public withdrawal URL returns a no-store Telegram redirect to `@balem18`,
   the Owner page shows the saved contact, and the Telegram menu presents the
   button only for a saved Player ID. Recheck the switch fingerprint and queue
   without making a payment.
