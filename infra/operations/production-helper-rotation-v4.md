# Production deploy-helper rotation v4 — no-money bundle allowlist

The first no-money release stopped before activation because the installed helper rejected its
reference-opening key. Automatic rollback and database-login disable succeeded. This one-use
root-only rotation changes only the checksum-pinned helper and sudoers grant on production
Droplet `593344964`; it does not restart a service, activate a login, or enable deposits.

| Reviewed item                        | Exact value                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| Installed predecessor helper SHA-256 | `cb23a2940f0cb6d523435ff98691b7ed06761e39b2161b1dd2e7e4c86c71c051` |
| Successor helper SHA-256             | `d3f8f285e410573e17968830ab5eb85fb9785497c4d58e876cb8a993b68ce792` |
| Helper                               | `/usr/local/sbin/fetanagent-production-deploy-helper`              |
| Sudoers grant                        | `/etc/sudoers.d/fetanagent-production-deploy-helper`               |
| Rotation script                      | `infra/operations/fetanagent-production-helper-rotation-v4.sh`     |

The successor adds an exact four-file allowlist only when the inert-maintenance overlay carries
`INTERNAL_ROUTINE_NO_MONEY_BROKER_ENABLED: 'true'`. It continues to reject the operational
assignment database URL, manifest, and signer in this mode. No financial switch changes.

Before rotation, require passing CI on the merged main commit, healthy Owner and customer pages,
all seven disabled financial switches, no money-capable release marker, and no active deployment.
Stage the exact merged-main helper blob at
`/root/fetanagent-production-helper-rotation-v4-input/fetanagent-production-deploy-helper.next`
in a root-owned mode-`0700` directory, with the file root-owned mode `0600`. Verify its SHA-256
matches the successor above. Stage the reviewed v4 script separately in that directory.

Run the reviewed script as root with `inspect`; it must report
`predecessor-exact; no production runtime changed`. Then run it with the literal arguments
`rotate 'ROTATE EXACT PRODUCTION DEPLOY HELPER V4'`. It takes the deployment lock, archives the
predecessor, disables the old sudoers grant before replacement, installs the exact successor,
validates the new grant, and records completion. Re-run `inspect`; it must report
`successor-exact; rotation complete; no production runtime changed`. A partial or unexpected
state is a stop condition. Do not hand-edit sudoers or call an unpinned helper.
