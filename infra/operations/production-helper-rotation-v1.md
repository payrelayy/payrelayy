# Production deploy-helper rotation v1

This one-use root operation changes only the production deploy helper and its checksum-pinned
`fetanagent-admin` sudoers rule on DigitalOcean Droplet `593344964`. It does not deploy a release,
change a container, activate a database login, pair a device, or enable a financial switch. It is
needed because the installed helper has the pre-routine-deposit digest while the merged release
requires the routine-aware helper. Never disable the helper verification in the production
workflow or substitute the old helper digest.

## Exact reviewed identities

| Item                                          | Identity                                                           |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Source commit containing the successor helper | `7d8c930d5a587967664f05c849ebdb85966c0fd3`                         |
| Installed predecessor helper SHA-256          | `d2f537641dacb1f01d8f6a00f4ab295ee145a1cc31bc27fcaa596f9031a04996` |
| Successor helper SHA-256                      | `7d144ca5c7a3524f5b6c17c9608737d70438c7261c2d44d10e6d597c9a902343` |
| Target helper                                 | `/usr/local/sbin/fetanagent-production-deploy-helper`              |
| Target sudoers rule                           | `/etc/sudoers.d/fetanagent-production-deploy-helper`               |

The source diff adds the dormant routine-deposit overlay and its protected marker/credential
checks. The helper source must remain byte-identical to the pinned Git blob. A later edit requires
a new reviewed rotation, not an adjustment to this one-use script.

## Before any mutation

1. Confirm the old pilot is stopped, all financial switches are disabled, the routine runtime
   role is `NOLOGIN`, and no execution attempt is open. Use the authenticated Owner and database
   operator channels; never copy credentials or Player identifiers into a ticket or chat.
2. Confirm there is no active production deployment run and no routine or execution-v2 release
   marker on the VM. The rotation script obtains the same production helper lock as deployment.
3. Review the exact merged source and this script. The following are no-write checks:

   ```bash
   git show 7d8c930d5a587967664f05c849ebdb85966c0fd3:infra/operations/fetanagent-production-deploy-helper.sh | sha256sum
   sha256sum infra/operations/fetanagent-production-deploy-helper.sh
   bash -n infra/operations/fetanagent-production-helper-rotation-v1.sh
   node infra/verify-production-helper-rotation.mjs
   ```

   Both helper hashes must equal the successor digest above. Stage the exact merged source from a
   clean checkout, not a locally edited working file.

## Stage and inspect

Create `/root/fetanagent-production-helper-rotation-v1-input` on the reviewed Droplet as root,
mode `0700`. Copy the reviewed Git-blob helper there as
`fetanagent-production-deploy-helper.next`, an ordinary root-owned mode-`0600` file, and compare
its SHA-256 with the successor digest. Do not stage a database URL, password, or signing key.

Run the reviewed rotation script as root with `inspect` before `rotate`. `inspect` is read-only and
must print `predecessor-exact; no production runtime changed`. It checks the metadata Droplet ID,
the installed predecessor helper, and the exact checksum-pinned sudoers rule. Stop on any other
result. The script refuses symlinks, hard links, wrong ownership or modes, unknown digests, and an
unexpected partial state.

## Rotate once

Only after the staged file and preflight pass, run the reviewed script as root with the literal
arguments:

```text
rotate 'ROTATE EXACT PRODUCTION DEPLOY HELPER V1'
```

The script locks out concurrent deployment, writes an immutable intent and predecessor archive,
moves the old sudoers rule out of `/etc/sudoers.d` **before** replacing the helper, installs the
successor atomically, validates the new sudoers syntax, verifies the restricted account can invoke
only the exact successor digest, then writes a completion record. A failure after disabling the
old grant leaves deployment unavailable. Do not restore or edit the sudoers rule by hand; preserve
the state and rerun the same reviewed script after inspecting the failure. It resumes only exact
intermediate files; a partial or changed file fails closed and needs a separate reviewed recovery.

Run `inspect` again. It must print `successor-exact; rotation complete; no production runtime
changed`. Verify that the production service set and financial switches remain unchanged. Only
then may an exact-main `deploy-inert` production workflow be attempted. Routine authorization,
credential installation, marker creation, phone pairing, and launching automatic deposits are
separate later gates; this rotation authorizes none of them.
