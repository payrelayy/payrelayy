# Owner submitted-payment eligibility release

The Owner payment list currently calls the stopped-credit eligibility function
for every row, including Approved and Rejected payments. Production query
statistics show that this shape is much slower than the underlying listing and
has coincided with connection timeouts and `53300` role-slot errors. The runtime
change checks eligibility only for pending, signed-SMS rows in the two execution
review states. It changes no payment decision, credit, or database role.

The reviewed running release on production Droplet `593344964` is
`1d79ccbbafccaa5eddae01c56870aad3b6d983c5`. Its installed deploy helper
SHA-256 is `3448cf9b020dadb573a6433b970544d2c7727db13ad3ab89a0b20c3c896cd141`;
the successor helper SHA-256 is `fcb216521012936324e9af64e6c55f291ccd69090778cdcec1342c5960734fff`.
Recheck the exact live release, routine marker, helper digest, and payment state
immediately before rotation and activation. Stop on any difference.

1. Require green PR checks and exact merged-main CI. Confirm no active or
   unresolved deposit attempt, the current financial switch fingerprint, and
   the healthy running release. Do not retry a credit for deployment testing.
2. Stage the exact merged-main Git blob for
   `fetanagent-production-deploy-helper-v2.sh` as root-owned mode `0600` at
   `/root/fetanagent-production-v2-owner-submitted-eligibility-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`.
   Stage `fetanagent-production-v2-owner-submitted-eligibility-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify digests and Bash syntax.
   Run `inspect`; require `predecessor-exact; no production runtime changed`.
   Run `rotate` with `ROTATE EXACT PRODUCTION V2 OWNER SUBMITTED ELIGIBILITY HELPER V1`.
   Inspect again; require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA,
   with `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, both TeleBirr pilot inputs `not-applicable`, routine transport
   `enabled`, database route `pooler`, and the observed unchanged financial
   profile. For `cbe-live-v1`, the operation phrase is
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`.
4. Verify the exact active release and healthy services. In the signed-in
   Owner page, load Pending, Approved, and Rejected submitted payments. Repeat
   after an idle interval and check database logs for new timeouts or `53300`
   errors. If listings still fail, investigate the one-slot Owner role and
   session-pooler disconnect behavior before declaring the incident resolved.
