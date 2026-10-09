# Production deploy-helper rotation v7 — readable routine container secrets

The next inert release on production Droplet `593344964` requires a separate copy of the execution
signer and routine database URL that the non-root bridge can read after Docker Compose bind mounts
them. The original signer remains root-only. This one-use, root-only rotation changes only the
checksum-pinned deployment helper and sudoers grant; it does not deploy code, activate a login,
enable deposits, or move money.

| Reviewed item                        | Exact value                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| Installed predecessor helper SHA-256 | `9cb11c2962d728355cc5884839cb12bde982726260925b2de220605b91673003` |
| Successor helper SHA-256             | `38a8f424fa92d39805bfb8d8fe45e94dff547379d1940af976f35c15e1e6b8da` |
| Helper                               | `/usr/local/sbin/fetanagent-production-deploy-helper`              |
| Sudoers grant                        | `/etc/sudoers.d/fetanagent-production-deploy-helper`               |
| Rotation script                      | `infra/operations/fetanagent-production-helper-rotation-v7.sh`     |

Before rotation, require passing CI on the merged main commit, all seven financial switches
disabled, no money-capable release marker, and no active deployment. Stage the exact merged-main
helper blob at
`/root/fetanagent-production-helper-rotation-v7-input/fetanagent-production-deploy-helper.next`
in a root-owned mode-`0700` directory, with the file root-owned mode `0600`. Verify its SHA-256
matches the successor above. Stage the reviewed v7 script separately in that directory.

Run the reviewed script as root with `inspect`; it must report
`predecessor-exact; no production runtime changed`. Then run it with the literal arguments
`rotate 'ROTATE EXACT PRODUCTION DEPLOY HELPER V7'`. It takes the deployment lock, archives the
predecessor, disables the old sudoers grant before replacement, installs the exact successor,
validates the new grant, and records completion. Re-run `inspect`; it must report
`successor-exact; rotation complete; no production runtime changed`. An unexpected state is a stop
condition. Do not hand-edit sudoers or call an unpinned helper.
