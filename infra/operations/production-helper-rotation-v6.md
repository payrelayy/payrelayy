# Production deploy-helper rotation v6 — isolated paid settlement worker

The next inert release on production Droplet `593344964` adds a separate paid-settlement database URL and worker
service. The installed v5 helper rejects the extra protected file and does not
start that service. This one-use root-only rotation changes only the
checksum-pinned deployment helper and sudoers grant. It does not deploy code,
activate a database login, enable deposits, or move money.

| Reviewed item                        | Exact value                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| Installed predecessor helper SHA-256 | `ed18df6909769489eb4b3b562dc8f50f4bfb144cce3bc89393bea97ae013aff8` |
| Successor helper SHA-256             | `9cb11c2962d728355cc5884839cb12bde982726260925b2de220605b91673003` |
| Helper                               | `/usr/local/sbin/fetanagent-production-deploy-helper`              |
| Sudoers grant                        | `/etc/sudoers.d/fetanagent-production-deploy-helper`               |
| Rotation script                      | `infra/operations/fetanagent-production-helper-rotation-v6.sh`     |

Before rotation, require passing CI on the merged main commit, healthy Owner
and customer pages, all seven disabled financial switches, no money-capable
release marker, and no active deployment. Stage the exact merged-main helper
blob at
`/root/fetanagent-production-helper-rotation-v6-input/fetanagent-production-deploy-helper.next`
in a root-owned mode-`0700` directory, with the file root-owned mode `0600`.
Verify its SHA-256 matches the successor above. Stage the reviewed v6 script
separately in that directory.

Run the reviewed script as root with `inspect`; it must report
`predecessor-exact; no production runtime changed`. Then run it with the literal
arguments `rotate 'ROTATE EXACT PRODUCTION DEPLOY HELPER V6'`. It takes the
deployment lock, archives the predecessor, disables the old sudoers grant
before replacement, installs the exact successor, validates the new grant,
and records completion. Re-run `inspect`; it must report
`successor-exact; rotation complete; no production runtime changed`. An
unexpected state is a stop condition. Do not hand-edit sudoers or call an
unpinned helper.
