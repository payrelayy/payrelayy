# Production deploy-helper rotation v5 — review-only paid receipt transport

The next inert release adds a separate paid-observation database URL to the protected bundle.
Production Droplet `593344964` currently has the v4 helper, which rejects that additional file.
This one-use root-only rotation changes only the checksum-pinned deployment helper and sudoers
grant. It does not deploy code, activate a database login, enable deposits, or move money.

| Reviewed item                        | Exact value                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| Installed predecessor helper SHA-256 | `d3f8f285e410573e17968830ab5eb85fb9785497c4d58e876cb8a993b68ce792` |
| Successor helper SHA-256             | `ed18df6909769489eb4b3b562dc8f50f4bfb144cce3bc89393bea97ae013aff8` |
| Helper                               | `/usr/local/sbin/fetanagent-production-deploy-helper`              |
| Sudoers grant                        | `/etc/sudoers.d/fetanagent-production-deploy-helper`               |
| Rotation script                      | `infra/operations/fetanagent-production-helper-rotation-v5.sh`     |

Before rotation, require passing CI on the merged main commit, healthy Owner and customer pages,
all seven disabled financial switches, no money-capable release marker, and no active deployment.
Stage the exact merged-main helper blob at
`/root/fetanagent-production-helper-rotation-v5-input/fetanagent-production-deploy-helper.next`
in a root-owned mode-`0700` directory, with the file root-owned mode `0600`. Verify its SHA-256
matches the successor above. Stage the reviewed v5 script separately in that directory.

Run the reviewed script as root with `inspect`; it must report
`predecessor-exact; no production runtime changed`. Then run it with the literal arguments
`rotate 'ROTATE EXACT PRODUCTION DEPLOY HELPER V5'`. It takes the deployment lock, archives the
predecessor, disables the old sudoers grant before replacement, installs the exact successor,
validates the new grant, and records completion. Re-run `inspect`; it must report
`successor-exact; rotation complete; no production runtime changed`. An unexpected state is a
stop condition. Do not hand-edit sudoers or call an unpinned helper.
