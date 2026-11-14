# Registry read model production release

The read-only registry migration `20261114120000` is installed, but the running
Owner application is still release `d2d3064395b205e8cf3792f3167e0924f839d68c`.
The new `/v1/public/deposit-catalog` route therefore returns 404 until the
application release. The first guarded deployment attempt stopped before
installation because the deploy helper still pinned the preceding release.

This release changes only the deploy helper's exact predecessor pin and then
deploys the merged application. It does not change payment switches, receiver
accounts, payment claims, the Companion, or its one-shot final-action fence.

| Reviewed item                      | Exact value                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| Production Droplet ID              | `593344964`                                                                            |
| Running release and routine marker | `d2d3064395b205e8cf3792f3167e0924f839d68c`                                             |
| Installed helper SHA-256           | `a21c3838aef57cfa296a4fe3fb255bd288b90cb559ba100690644518bcac8b1a`                     |
| Successor helper SHA-256           | `745f6aba3a045dad41d3b1ccd83bce4c7518fa19a0553879072e04d71e534896`                     |
| Rotation script                    | `infra/operations/fetanagent-production-v2-registry-predecessor-helper-rotation-v1.sh` |

After the exact main commit passes CI, confirm the Droplet metadata ID, active
release, routine marker, helper digest, and current `cbe-live-v1` switch profile.
Stage the exact merged-main helper blob as root-owned mode `0600` at
`/root/fetanagent-production-v2-registry-predecessor-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
inside a root-owned mode `0700` directory. Stage the rotation script separately,
verify its Git blob and Bash syntax, and run `inspect`. Require
`predecessor-exact; no production runtime changed`. Run
`rotate 'ROTATE EXACT PRODUCTION V2 REGISTRY PREDECESSOR HELPER V1'`, then run
`inspect` again and require
`successor-exact; rotation complete; no production runtime changed`.
The one-use script checks the exact current release, helper and sudoers digests,
metadata, file ownership, and routine marker while holding the deployment lock.
If a check fails, inspect the state instead of editing the helper or sudoers.

Dispatch `production-runtime.yml` from the same passing main SHA with
`mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
`593344964`, routine transport `enabled`, financial profile `cbe-live-v1`,
database route `pooler`, both TeleBirr pilot fields `not-applicable`, and
operation `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Require all predecessor,
payment-state, drain, activation, and unchanged-switch guards to pass.

Finally, verify the public catalog returns only the existing implemented
TeleBirr and CBE Birr choices, Owner and bot readiness remain healthy, the
running release SHA and payment switches are unchanged except for the intended
application version, and no real payment was submitted to test this release.
