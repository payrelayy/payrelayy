# Withdraw on payment results production release

Saved-Player menus and eligible payment result messages show **Deposit** and **Withdraw** on the
same row. The message text and financial switches do not change. Withdraw remains a direct link
to the Owner-configured Telegram contact; it does not create a withdrawal request or move money.
There is no database migration in this release.

The reviewed running release on production Droplet `593344964` is
`6b7cbde53436037faf1c72af4fd589afb1a3122e`. Its installed helper SHA-256 is
`346ced64fdd0283bfcff414a52de3bc6787e544b118768343b3637efc2c5292f`.
The reviewed successor helper SHA-256 is
`497a900bb6bb7624cb9bca1a1fa0b262545dbfdd1b7b22a1048e54a02a288e22`.
Recheck these values immediately before rotation. Stop if any differs.

1. Require successful CI for the exact merged `main` commit. Confirm the healthy running release,
   routine-deposit marker, `cbe-live-v1` financial switch profile, and no active or unresolved
   deposit job or execution attempt. Record the financial switch fingerprint. Do not make a
   payment or retry a credit.
2. Stage the exact merged-main Git blob for
   `infra/operations/fetanagent-production-deploy-helper-v2.sh` as the root-owned mode-`0600`
   file
   `/root/fetanagent-production-v2-withdraw-payment-results-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned mode-`0700` directory. Stage
   `fetanagent-production-v2-withdraw-payment-results-helper-rotation-v1.sh` separately as a
   root-owned mode-`0700` file. Verify both against the merged blobs and run `bash -n` on both.
   Run the rotation script with `inspect` and require
   `predecessor-exact; no production runtime changed`. Run it with
   `rotate 'ROTATE EXACT PRODUCTION V2 WITHDRAW PAYMENT RESULTS HELPER V1'`. Inspect again and
   require `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the same passing merged-main SHA with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`, both TeleBirr
   pilot inputs `not-applicable`, routine transport `enabled`, financial profile `cbe-live-v1`,
   database route `pooler`, and operation phrase `DEPLOY SCREENSHOT READER WITH CBE LIVE`.
   Require predecessor, last-moment idle, unchanged switch fingerprint, activation, and health
   checks to pass.
4. Confirm the active release and healthy services. Confirm the public Owner contact redirects
   to the saved Telegram handler. Send `/start` in a test Telegram chat with a saved Player ID and
   verify Deposit and Withdraw share a row. Confirm a final payment notice has the same buttons
   without new message text. Earlier bot messages retain their original button layout. Recheck
   the queue and switch fingerprint without making a payment.
