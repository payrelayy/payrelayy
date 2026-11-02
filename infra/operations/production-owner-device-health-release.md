# Owner deposit switch and device health production release

The Owner master deposit switch and the read-only Companion and receiver SMS
status are merged. Production migrations `20261102215837_owner_deposit_availability`
and `20261102220034_owner_device_health` are applied. The first application
deployment stopped before transfer because its workflow predecessor check was
stale. The workflow now checks the running release, but the installed helper
also needs an exact predecessor refresh before activation can carry the signed
routine transport.

| Boundary                                    | Exact value                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                           |
| Required running release and routine marker | `ba5c6e20b252cb9d7bf7d06248b2c2f5dede44b7`                                            |
| Installed helper SHA-256                    | `08e3e3271eb05a0954794c9d2b5c7b7d7ddec3bb8cfb5233a5b8deacefda399f`                    |
| Successor helper SHA-256                    | `cc3524c917dbaa72c13b79445d7ff1be8ae78fb2a8d1d6af46c670f737fb1ab7`                    |
| Rotation script                             | `infra/operations/fetanagent-production-v2-owner-device-health-helper-rotation-v1.sh` |

1. Require green PR and exact-main CI. Recheck the Droplet ID, running release,
   routine marker, installed helper and sudoers digest, `cbe-live-v1` financial
   switch profile, and zero active or unresolved deposit execution work. Stop if
   any value differs. Do not alter a payment switch to satisfy the release.
2. Stage the exact merged-main Git blob of
   `infra/operations/fetanagent-production-deploy-helper-v2.sh` as root-owned
   mode `0600` at
   `/root/fetanagent-production-v2-owner-device-health-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned mode `0700` directory. Stage the rotation script separately
   as root-owned mode `0700`. Verify the SHA-256 values and Bash syntax.
3. Run the rotation script as root with `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 OWNER DEVICE HEALTH HELPER V1`. Repeat `inspect`
   and require `successor-exact; rotation complete; no production runtime changed`.
   The script holds the deployment lock, archives the old helper, and updates
   its digest-pinned sudoers grant without changing containers or payment state.
4. Dispatch `production-runtime.yml` from the same passing main commit with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr pilot inputs
   `not-applicable`, routine transport `enabled`, financial profile
   `cbe-live-v1`, and database route `pooler`. Require the predecessor,
   last-moment idle, switch fingerprint, activation, and health checks.
5. Verify the exact server release, public Owner reachability, unchanged
   financial switches, empty active and unresolved work, and carried routine
   marker. Install the signed receiver SMS verifier on the paired phone and
   the same-commit Windows Companion on its host, then verify fresh signed
   status reports on Owner Home. No real payment is needed as a release test.
