# Production v2 helper guard rotation for screenshot SMS correction

The production application release is guarded by the exact running predecessor.
The previous guard still pins the 2026-11-08 release, while production now runs
the successful 2026-11-12 release. This root-only, one-use rotation changes only
the checksum-pinned deploy helper and its sudoers grant. It does not restart a
container, update a payment switch, or move money.

| Reviewed item                      | Exact value                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Droplet ID                         | `593344964`                                                                     |
| Running release and routine marker | `babb5169935e420d1b191420b604210423cb729d`                                      |
| Installed helper SHA-256           | `b1f235b9daf571884f466fa11c7eb9334ebe02df45deb7c9cbe65a8ae72c2379`              |
| Successor helper SHA-256           | `a21c3838aef57cfa296a4fe3fb255bd288b90cb559ba100690644518bcac8b1a`              |
| Rotation script                    | `infra/operations/fetanagent-production-v2-screenshot-sms-guard-rotation-v1.sh` |

After the exact main commit passes CI, verify the Droplet ID, current release,
routine marker, and helper digest independently. Stage the exact merged-main
helper Git blob as root-owned mode `0600` at
`/root/fetanagent-production-v2-screenshot-sms-guard-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
inside a root-owned mode `0700` directory. Stage the reviewed rotation script
separately and verify its Git blob and Bash syntax. The script itself checks
the metadata ID, release and marker, root-only modes, both SHA-256 values, and
the sudoers grant while holding the deployment lock.

Run `inspect`; require `predecessor-exact; no production runtime changed`.
Then run `rotate 'ROTATE EXACT PRODUCTION V2 SCREENSHOT SMS GUARD HELPER V1'`.
Run `inspect` again; require
`successor-exact; rotation complete; no production runtime changed`. If the
state differs, stop and inspect it rather than editing the helper or sudoers
directly. The rotation can resume an exact partial state.
