# Owner submitted payment list production release

The live SQL hotfix skips the expensive duplicate lookup for terminal payment
submissions. The Owner database runtime role now allows two sessions so a
Supavisor session handoff cannot reject the next Owner request. The currently
running application was built before that role change, so the guarded release
installs the already merged Owner startup preflight that accepts one or two
sessions. This procedure does not change payment decisions or financial switches.

| Guard | Exact value |
| --- | --- |
| Production project | `xzztugbgtulptnbpoelr` |
| Production Droplet | `593344964` |
| Running release and routine marker | `12947ddd49dd14b4e54720395ed9f1686f14ed77` |
| Installed helper SHA-256 | `c3262c332899a128840039e12c5e1b8f2c64df0df9ecec143ae137c85ff8a108` |
| Successor helper SHA-256 | `b1f235b9daf571884f466fa11c7eb9334ebe02df45deb7c9cbe65a8ae72c2379` |
| Rotation script | `infra/operations/fetanagent-production-v2-owner-payment-list-helper-rotation-v1.sh` |
| Rotation phrase | `ROTATE EXACT PRODUCTION V2 OWNER PAYMENT LIST HELPER V1` |

1. Require passing PR and exact main CI. Verify the current release, routine
   marker, helper digest, Owner runtime role limit of two, CBE live financial
   profile, and no active or unresolved credit attempt. Never create a test
   payment for this release.
2. Stage the exact merged helper Git blob as root-owned mode `0600` at the
   rotation script's `STAGED_HELPER` path. Stage the exact rotation script as
   root-owned mode `0700`. Verify both digests and `bash -n`; run `inspect`,
   `rotate` with the phrase above, then `inspect` again. The rotation changes
   no application container, database role, or financial switch.
3. Dispatch `.github/workflows/production-runtime.yml` from the exact passing
   main SHA: `mode=deploy-inert`, operation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`, TeleBirr pilot and activation epoch
   `not-applicable`, routine transport `enabled`, financial profile
   `cbe-live-v1`, and database route `pooler`. The workflow drains active credit
   leases, checks the unchanged switch fingerprint, and rolls back a failed
   release.
4. Verify the new exact release is healthy, the Owner Pending, Approved, and
   Rejected lists load, the Owner activity check succeeds, and no new database
   connection rejection or Owner payment list timeout appears.
