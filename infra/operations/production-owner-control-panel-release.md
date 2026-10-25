# Owner control panel — guarded production release

PR #960 adds a directory of existing Owner controls. It changes no payment
decision, receiver, or financial switch. This release rotates the exact
production helper pin before deploying the merged Owner UI.

| Boundary                                    | Exact value                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                           |
| Required running release and routine marker | `0d3d6dafc55e1ae8d1fb4ff6ae74e089b9a39dbe`                                            |
| Installed helper and sudoers pin            | `bf9f012fc93e16f8b4be7fe92a372751d56d69a0198e6c4679a57c10a612d6ad`                    |
| Successor helper and sudoers pin            | `238b1068123b434128def98334c01e367df2edb4912684b7cd57d8d7cb6932b7`                    |
| Rotation script                             | `infra/operations/fetanagent-production-v2-owner-control-panel-helper-rotation-v1.sh` |

1. Require passing PR and exact-main CI. Recheck Droplet identity, public health,
   current release, routine marker, helper and sudoers digests, all payment
   switches, signed receiving transport, active jobs, and unresolved attempts.
   Stop on any changed predecessor or payment profile. Do not alter a switch or
   receiver to satisfy a guard.
2. Stage the exact merged-main Git blobs on the Droplet in the root-owned mode
   `0700` directory
   `/root/fetanagent-production-v2-owner-control-panel-helper-rotation-v1-input`.
   Stage the successor helper there as `fetanagent-production-deploy-helper-v2.next`
   with mode `0600`, and stage the rotation script separately with mode `0700`.
   Verify their hashes and Bash syntax. Run `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 OWNER CONTROL PANEL HELPER V1`, then repeat
   `inspect` and require
   `successor-exact; rotation complete; no production runtime changed`.
   This rotates only the helper and checksum-pinned sudoers grant.
3. Dispatch `.github/workflows/production-runtime.yml` from the exact passing
   merged `main` commit with `mode=deploy-inert`, the production project
   `xzztugbgtulptnbpoelr`, Droplet `593344964`, both TeleBirr pilot inputs
   `not-applicable`, routine transport `enabled`, and database route `pooler`.
   Select only the live payment profile observed in step 1. For `cbe-live-v1`,
   use `DEPLOY SCREENSHOT READER WITH CBE LIVE`; for `cbe-stopped-v1`, use
   `DEPLOY CBE STOPPED PHONE PROOF`. The workflow must recheck the predecessor,
   idle cutover, and unchanged financial-switch fingerprint before and after
   activation. Stop on any guard failure.
4. Verify the exact running release and routine marker, healthy containers and
   public HTTPS, unchanged payment switches and receiver settings, signed
   Companion transport, and no newly unresolved work. Open the Owner Home page
   and confirm its grouped controls link to the expected sections. Do not submit
   or replay a payment for this UI release.
