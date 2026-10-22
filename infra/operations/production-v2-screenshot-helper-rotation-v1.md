# Production v2 helper rotation for screenshot reading

This one-use root-only rotation updates the checksum-pinned v2 production deploy helper and its
sudoers grant so the guarded release can install the screenshot model key. It changes no running
container, database role, financial switch, or payment. It is a separate privileged action from
merging the application PR and from running the production deployment workflow.

| Reviewed item                               | Exact value                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Production Droplet ID                       | `593344964`                                                                  |
| Current release and routine-deposits marker | `906b5b6a6486a26450d302b9f911feb3e35d30e4`                                   |
| Current runtime mode                        | `inert-maintenance`                                                          |
| Installed predecessor helper SHA-256        | `8a4696f0bc2cf0a1d04761a293dceacd26408d7b0b2d43da4d0e79e66d6eafc3`           |
| Successor helper SHA-256                    | `467463fdc334a7d0d4463b6bd2212a42c3318e60c2e0537d70e3010a800bcfba`           |
| Installed helper                            | `/usr/local/sbin/fetanagent-production-deploy-helper-v2`                     |
| Installed sudoers grant                     | `/etc/sudoers.d/fetanagent-production-deploy-helper-v2`                      |
| Rotation script                             | `infra/operations/fetanagent-production-v2-screenshot-helper-rotation-v1.sh` |

The routine-deposits marker is present. The older no-money helper rotation scripts must not be used.
This script requires the exact current release, marker, predecessor helper and sudoers grant. It
holds the production deployment lock, checks live release health before and after replacement,
archives the predecessor, disables its sudoers grant before swapping the helper, and installs the
new digest-pinned grant. Any different production state is a stop condition.

After the PR is merged and the exact main commit passes CI, recheck the live release and all
financial/lease/job gates. Stage the exact merged-main successor helper as
`/root/fetanagent-production-v2-screenshot-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
in a root-owned mode-`0700` directory with the file root-owned mode `0600`. Verify its SHA-256
against the successor value above. Stage the reviewed script separately in the same root-only
directory and verify its Git blob against the merged commit.

Run the script as root with `inspect`; it must report
`predecessor-exact; no production runtime changed`. Then, with separate approval for the
privileged rotation, run it with the exact arguments
`rotate 'ROTATE EXACT PRODUCTION V2 SCREENSHOT HELPER V1'`. Re-run `inspect`; it must report
`successor-exact; rotation complete; no production runtime changed`. Do not hand-edit sudoers or
run a helper with an unreviewed digest. A partial rotation should be inspected and resumed only
after its exact state is reviewed; the script's `rotate` operation is designed to resume exact
intermediate states.
