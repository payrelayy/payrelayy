# Production deploy-helper rotation v3 — no-money phone review

This one-use root operation updates only the checksum-pinned deploy helper and its restricted
sudoers grant on production Droplet `593344964`. It does not deploy a release, activate a database
login, enable a financial switch, or move money. The successor helper admits the separate
review-only TeleBirr credential and signer files in an inert-maintenance release.

| Reviewed item | Exact value |
| --- | --- |
| Installed predecessor helper SHA-256 | `4c50500ad040890ca639bac5423a86c7d8c0ee348b33a6999498c6257947bd79` |
| Successor helper SHA-256 | `cb23a2940f0cb6d523435ff98691b7ed06761e39b2161b1dd2e7e4c86c71c051` |
| Helper | `/usr/local/sbin/fetanagent-production-deploy-helper` |
| Sudoers grant | `/etc/sudoers.d/fetanagent-production-deploy-helper` |
| Rotation script | `infra/operations/fetanagent-production-helper-rotation-v3.sh` |

The staged successor must be the exact merged-main Git blob with the successor hash above. Do
not stage a locally edited helper, signing key, database URL, or password. Before touching the
host, confirm no deployment is active, all seven financial switches remain disabled, both
financial release markers are absent, and Owner and customer pages remain healthy. Run `bash -n`
on both scripts and `node infra/verify-production-helper-rotation.mjs` from the reviewed checkout.

As root, stage the merged helper blob as an ordinary mode-`0600` root-owned file at
`/root/fetanagent-production-helper-rotation-v3-input/fetanagent-production-deploy-helper.next`
inside a root-owned mode-`0700` directory. Compare its SHA-256 to the successor above. Run the
reviewed v3 script with `inspect` first; it must report
`predecessor-exact; no production runtime changed`. Any other result is a stop condition.

Then run the reviewed v3 script as root with the literal arguments
`rotate 'ROTATE EXACT PRODUCTION DEPLOY HELPER V3'`. The script takes the deployment lock,
archives and verifies the predecessor, disables its sudoers grant before installing the new
helper, verifies the new grant, and writes an idempotent completion record. If it stops midway,
preserve its state and rerun the same reviewed script after inspecting the failure; do not
hand-edit sudoers or call an unpinned helper.

Run `inspect` again; it must report
`successor-exact; rotation complete; no production runtime changed`. Recheck the public service
health and disabled financial switches. Only then may an exact-main `deploy-inert` workflow
install the review-only runtime. No Player credit is authorized by this rotation.
