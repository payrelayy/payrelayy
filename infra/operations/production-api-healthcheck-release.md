# API readiness healthcheck production release

The current API responds to `/readyz` but its three-second Docker probe can
time out while the catalog readiness query completes. The merged application
composition raises only the API probe timeout to ten seconds. The existing
three-second failure can block the guarded production deployment, so this
release rotates the helper to allow a narrow predecessor-only check: the exact
old API must be running, all recent Docker probe failures must be the known
three-second timeout, and a fresh read-only `/readyz` request must return 200
within nine seconds. The successor API must pass normal Docker health.

| Guard                              | Exact value                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| Production Droplet                 | `593344964`                                                                       |
| Running release and routine marker | `f1002058b451cba0dfd4f43cb016bb1b1ca0587e`                                        |
| Installed helper SHA-256           | `494ee66460c232969359fc7ba652b67fd589a0851ecb2feb8ea85b6fdf01594b`                |
| Successor helper SHA-256           | `c3262c332899a128840039e12c5e1b8f2c64df0df9ecec143ae137c85ff8a108`                |
| Rotation script                    | `infra/operations/fetanagent-production-v2-api-healthcheck-helper-rotation-v1.sh` |
| Rotation phrase                    | `ROTATE EXACT PRODUCTION V2 API HEALTHCHECK HELPER V1`                            |

1. Require passing PR and exact-main CI. Recheck the current release and routine
   marker, installed helper and sudoers digest, unchanged financial switches,
   and no active or unresolved deposit execution attempt. Confirm the API
   answers a fresh `/readyz` request with 200 and that any Docker failures are
   exclusively the three-second timeout. Do not send a payment as a test.
2. Stage the exact merged-main helper Git blob in the rotation script's
   root-only input directory as mode `0600`. Stage the exact rotation script as
   root-owned mode `0700`. Verify both digests and `bash -n`. Run `inspect`,
   then `rotate` with the exact phrase above, then `inspect` again. Rotation
   changes no application container, database role, or financial switch.
3. Dispatch `.github/workflows/production-runtime.yml` from the exact passing
   main SHA: `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr
   pilot fields `not-applicable`, routine transport `enabled`, financial profile
   `cbe-live-v1`, and database route `pooler`. Require the last-moment financial
   drain, unchanged switch fingerprint, rollback predecessor, and all successor
   health checks. Stop on any guard failure; never retry a credit.
4. Confirm the current release and API Docker health are the new exact SHA and
   `healthy`. Recheck both payment methods, recent Companion lease, receiver
   phone, public Owner/API routes, and open or unresolved credit work.

The helper rotation is safe to rerun with `inspect`; the deployment workflow
owns application rollback if a successor service fails its health gate.
