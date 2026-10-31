# Owner idle session production release

The Owner browser now expires after 12 hours without intentional activity, warns
five minutes before expiry, and requires a fresh sign-in after seven days. The
server checks the Auth session and the Owner activity record on every protected
Owner request. Existing Owner tabs must sign in once after deployment.

Migration `20261101013000_owner_browser_idle_session.sql` was applied to
production before this runtime release. It is the only migration added after
`20261031105752_owner_submitted_payments_fast_list.sql`.

The reviewed running release on production Droplet `593344964` is
`4b5833ff9c52f0cf65af54e8ee73d77ece74e6b0`. Its installed helper SHA-256
is `fcb216521012936324e9af64e6c55f291ccd69090778cdcec1342c5960734fff`.
The successor helper SHA-256 is
`2123dfdaeb6be99cec69cb3fb6d1207173508c0d53ec28313131fa3c79137854`.
Recheck all of these values immediately before rotation and deployment. Stop
if any differs.

1. Require successful CI for the exact merged `main` commit. Confirm the
   production migration, healthy running release, routine-deposit marker,
   `cbe-live-v1` financial switch profile, and no active or unresolved deposit
   job or execution attempt. Record the financial switch fingerprint. Do not
   make a payment or retry a credit for this release.
2. Stage the exact merged-main Git blob for
   `infra/operations/fetanagent-production-deploy-helper-v2.sh` as the root-owned
   mode-`0600` file
   `/root/fetanagent-production-v2-owner-idle-session-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned mode-`0700` directory. Stage
   `fetanagent-production-v2-owner-idle-session-helper-rotation-v1.sh` separately
   as a root-owned mode-`0700` file. Verify both against the merged blobs and
   run `bash -n` on both. Run the rotation script with `inspect` and require
   `predecessor-exact; no production runtime changed`. Run it with
   `rotate 'ROTATE EXACT PRODUCTION V2 OWNER IDLE SESSION HELPER V1'`. Inspect
   again and require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the same passing merged-main SHA with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   both TeleBirr pilot inputs `not-applicable`, routine transport `enabled`,
   financial profile `cbe-live-v1`, database route `pooler`, and operation phrase
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Require its predecessor check,
   last-moment idle check, unchanged switch fingerprint, activation, and service
   health checks to pass.
4. Inspect the exact active release, public Owner reachability, payment switch
   fingerprint, and active or unresolved deposit work. Verify a new Owner
   sign-in and that protected Owner requests require the browser session gate.
   The 12-hour idle expiry and seven-day limit are covered by automated clock
   tests; do not create a real payment to test them.
