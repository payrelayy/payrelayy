# Production deploy-helper rotation v2 — routine receipt signer

This one-use root operation updates only the checksum-pinned production deploy helper and its
restricted sudoers grant on Droplet `593344964`. The new helper admits one separately validated
Owner-only receipt-signing secret to an otherwise unchanged `deploy-inert` release. Rotation does
not deploy a release, register a signer, change a phone, enable a financial switch, or move money.

| Reviewed item                        | Exact value                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| Installed predecessor helper SHA-256 | `7d144ca5c7a3524f5b6c17c9608737d70438c7261c2d44d10e6d597c9a902343` |
| Successor helper SHA-256             | `4c50500ad040890ca639bac5423a86c7d8c0ee348b33a6999498c6257947bd79` |
| Helper                               | `/usr/local/sbin/fetanagent-production-deploy-helper`              |
| Sudoers grant                        | `/etc/sudoers.d/fetanagent-production-deploy-helper`               |
| Rotation script                      | `infra/operations/fetanagent-production-helper-rotation-v2.sh`     |

The reviewed source must be the merged main-branch Git blob whose helper SHA-256 equals the
successor value above. Do not stage a locally edited helper, signing key, database URL, or password.

Before touching the host, verify the production runtime workflow has completed and no other
deployment is active. Confirm all seven financial switches are disabled, the routine-deposit and
execution-v2 release markers are absent, and the current Owner and customer pages are healthy.
Run `bash -n` on both the helper and rotation script and run
`node infra/verify-production-helper-rotation.mjs` from the reviewed checkout.

On the production Droplet, root must stage the exact merged helper Git blob as an ordinary
root-owned mode-`0600` file at
`/root/fetanagent-production-helper-rotation-v2-input/fetanagent-production-deploy-helper.next`,
inside a root-owned mode-`0700` directory. Compare its SHA-256 to the successor value. Run the
reviewed v2 script as root with `inspect` first. It must report
`predecessor-exact; no production runtime changed`. Any other result is a stop condition.

Only after those checks pass, run the reviewed v2 script as root with the literal arguments
`rotate 'ROTATE EXACT PRODUCTION DEPLOY HELPER V2'`. The script locks the deployment helper,
archives and verifies the predecessor, disables the predecessor sudoers grant before installing
the successor, verifies the new restricted grant, and writes an idempotent completion record.
If it stops after disabling the grant, preserve the state and rerun the same reviewed script after
inspecting the failure; do not hand-edit sudoers or invoke an unpinned helper.

Run `inspect` again. It must report
`successor-exact; rotation complete; no production runtime changed`. Confirm production health
and all seven disabled financial switches again. Only then may an exact-main `deploy-inert`
workflow deliver the independent signer secret. Provisioning the signer registry and installing
the evidence-only Android app are separate later steps.
