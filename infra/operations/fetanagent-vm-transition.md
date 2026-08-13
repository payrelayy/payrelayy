# FetanAgent staging VM transition

This runbook moves the existing staging Droplet from the sealed legacy deployment boundary to the
FetanAgent boundary without ever running two Telegram pollers. It is a one-Droplet, root-console
maintenance procedure for DigitalOcean Droplet `590666364` at `178.128.39.89`. It does not create a
Droplet, change DNS, open a firewall, publish HTTPS, or migrate production.

The repository script is intentionally not a deployment helper. Install the reviewed LF bytes as
`/usr/local/sbin/fetanagent-vm-transition`, owned by `root:root` with mode `0700`, and run it only
from a DigitalOcean root console. Never put this script in sudoers and never invoke it through the
legacy or new SSH identity.

## Safety boundary

The transition separates reversible access preparation from the one-way runtime cutover:

1. **Inspect** the fixed host and sealed legacy helper.
2. **Prepare** a separate `fetanagent-admin` identity while the legacy runtime remains untouched.
3. **Acknowledge** the exact reviewed `main` commit.
4. Stop the legacy project through its old, checksum-verified sudo helper.
5. **Mark legacy stopped** only after the old runtime, network, units, port, and live secrets are
   gone and the old SSH/sudo execution boundary has been sealed.
6. Apply the database role rename migration while both application runtimes are stopped.
7. Deploy and smoke the acknowledged FetanAgent commit.
8. **Retire** the old access boundary only after exact-commit private smoke succeeds.
9. Configure the firewall and public domain only after the retirement receipt exists.

Do not reverse steps 4-8 by restarting the old bot. After the role rename, restarting the old
runtime is not a safe rollback: it can create a second long poller, duplicate financial intake, or
run against role names that no longer exist. On a failed FetanAgent activation, use the current
`stop-and-disable` workflow and keep staging offline while fixing or retrying.

The script never removes legacy releases or images. They are retained as non-secret forensic
artifacts. A future purge requires a separate inventory, backup, approval, and exact-path/hash
procedure; broad recursive deletion and Docker image pruning are forbidden here.

## Immutable inputs

The script fixes these contracts:

- Droplet ID: `590666364`
- public IPv4: `178.128.39.89`
- legacy helper: `/usr/local/sbin/payreplayy-staging-deploy-helper`
- legacy LF SHA-256:
  `4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69`
- FetanAgent helper: `/usr/local/sbin/fetanagent-staging-deploy-helper`
- FetanAgent helper source staged by root:
  `/root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper`
- transition state: `/var/lib/fetanagent-vm-transition`, `root:root` mode `0700`

The `NEW_HELPER_SHA` constant in [`fetanagent-vm-transition.sh`](fetanagent-vm-transition.sh) is
pinned to the SHA-256 of the final LF Git blob of
`infra/operations/fetanagent-staging-deploy-helper.sh`. Do not hash a Windows checkout: CRLF
conversion produces a different digest. Verify the pin from the reviewed commit before installing:

```bash
git show '<reviewed-main-commit>:infra/operations/fetanagent-staging-deploy-helper.sh' |
  sha256sum
```

Stage the exact same LF blob at the fixed root input path before `prepare`. It must be a regular
`root:root` file with mode `0600`:

```bash
install -d -o root -g root -m 0700 /root/fetanagent-vm-transition-input
git show '<reviewed-main-commit>:infra/operations/fetanagent-staging-deploy-helper.sh' \
  > /root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper
chown root:root /root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper
chmod 0600 /root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper
sha256sum /root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper
```

Perform staging outside the application SSH identities. Never paste private keys, database URLs,
tokens, HMAC values, passwords, or secret contents into a task, command line, marker, or log.

## Phase 0: install and inspect from the root console

Install the transition script from the same exact reviewed commit using LF bytes and verify its
reviewed checksum out of band. The script validates its installed path, root ownership, mode,
DigitalOcean metadata ID, and public IPv4 before doing any work.

```bash
install -o root -g root -m 0700 \
  ./infra/operations/fetanagent-vm-transition.sh \
  /usr/local/sbin/fetanagent-vm-transition
/usr/local/sbin/fetanagent-vm-transition inspect
```

`inspect` is read-only. It proves the old account, old public-key file, and old helper SHA and prints
counts only for legacy containers, networks, and live-secret entries. It never prints key material
or secret values. Stop if the helper SHA, host metadata, path type, ownership, or account boundary
does not match. Do not overwrite an unexplained host difference.

Take or confirm a recent DigitalOcean snapshot before entering the maintenance window. Confirm the
protected GitHub staging inputs and the exact candidate `main` commit. A snapshot is recovery
evidence, not permission to restart two pollers or reverse database roles automatically.

## Phase 1: prepare a parallel SSH identity

`prepare` is idempotent only when the complete prepared receipt and every live check agree. A
partial or modified state aborts rather than silently repairing it. Its root-only receipt has an
exact, closed schema: fixed transition/droplet/helper fields, exactly one `authorized_keys_sha`,
exactly one non-root `new_admin_uid`, and `prepared=true`. Duplicate, reordered, missing, or unknown
fields are rejected; the live key digest and UID must match the receipt.

```bash
/usr/local/sbin/fetanagent-vm-transition prepare
```

It creates a new non-root, password-locked `fetanagent-admin` user with no supplementary groups and
copies only the existing public `authorized_keys` bytes. It installs:

- the checksum-pinned FetanAgent helper as `root:root` mode `0755`;
- a `root:root` mode `0440` sudoers fragment for only that helper;
- an SSH Match fragment that requires public keys, disables agent/X11/remote forwarding and TTY,
  and allows only local forwarding to `127.0.0.1:3002` for Owner control.

It validates `visudo -cf /etc/sudoers` and `sshd -t` before reloading SSH. The account is not added
to `docker` or `sudo` and cannot access the Docker socket directly. The old account, helper,
runtime, releases, and secrets remain untouched.

Before continuing, keep the root console open and prove a second independent SSH session works:

```bash
ssh -F /dev/null \
  -i '<dedicated-staging-private-key>' \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile='<pinned-known-hosts-file>' \
  fetanagent-admin@178.128.39.89 \
  'test "$(id -u)" -ne 0 && \
   sudo -n /usr/local/sbin/fetanagent-staging-deploy-helper verify \
   <final-new-helper-lf-sha256>'
```

If this check fails, do not stop the old runtime. From the root console run:

```bash
/usr/local/sbin/fetanagent-vm-transition rollback-prepare
```

`rollback-prepare` is permitted only before the legacy-stopped marker and only when no FetanAgent
container, network, sealed release, or secret exists. It handles both a completed receipt and an
interruption after any individual prepare step but before that receipt. Before deleting anything,
it validates the new account/home, any copied public key against the legacy source key, the staged
and installed helper against the fixed digest, and any sudoers/sshd fragments against their exact
contracts. Unknown or modified state aborts without deletion. Receipts are then removed first so
that a second run uses the strict partial-state path. The root-only staged helper source is retained.
It does not touch the old application runtime or legacy execution boundary.

## Phase 2: acknowledge the reviewed commit

Use the exact full lowercase SHA that GitHub shows on `main`. Do not use a branch name, local branch,
short SHA, or pull-request head:

```bash
REVIEWED_MAIN_COMMIT='<40-lowercase-hex-main-sha>'
/usr/local/sbin/fetanagent-vm-transition acknowledge "$REVIEWED_MAIN_COMMIT"
/usr/local/sbin/fetanagent-vm-transition verify
```

The commit is stored in root-only receipts and must be repeated exactly for later phases. This does
not stop or start anything.

## Phase 3: stop the legacy runtime through its own boundary

Open an SSH session as the existing legacy administrator. Do not execute the legacy helper directly
as root and do not spoof `SUDO_USER`; the helper requires its original sudo identity.

```bash
ssh -F /dev/null \
  -i '<dedicated-staging-private-key>' \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile='<pinned-known-hosts-file>' \
  payreplayy-admin@178.128.39.89 \
  'test "$(id -u)" -ne 0 && \
   sudo -n /usr/local/sbin/payreplayy-staging-deploy-helper verify \
   4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69 && \
   sudo -n /usr/local/sbin/payreplayy-staging-deploy-helper stop'
```

The old helper removes its exact Compose project and enumerated live secret files. Immediately from
the root console record the stopped boundary:

```bash
/usr/local/sbin/fetanagent-vm-transition \
  mark-legacy-stopped "$REVIEWED_MAIN_COMMIT"
```

This fails unless the old Compose containers and networks are absent, no legacy systemd unit or unit
file exists, the legacy live-secret directory is absent or empty, and TCP port 3002 is free. It then
validates and removes the exact allowlisted legacy sudoers fragment and legacy public key, locks the
old account, switches it to `/usr/sbin/nologin`, kills its sessions, and proves no already-authorized
legacy helper process remains. Only after repeating the runtime/port and disabled-access checks does
it atomically write `legacy-stopped-v1`. The legacy helper, releases, and images remain for retirement
and forensics. If interrupted during access sealing, rerun the same command: already absent exact
artifacts and an already locked account are accepted, while drift still fails closed. Once this
marker exists, `rollback-prepare` is blocked and the old bot must remain stopped.

## Phase 4: apply the database role rename while both runtimes are stopped

The canonical migration
`supabase/migrations/20260813115809_rename_runtime_roles_to_fetanagent.sql` renames the existing
staging roles by OID. Current provisioning and cleanup SQL expects the new `fetanagent_*` role
names. Therefore the migration must be proven applied before any current deploy-and-smoke run.

Use the reviewed Supabase staging bootstrap workflow from the acknowledged exact `main` commit:

1. run its read-only migration plan;
2. confirm this migration is pending or already canonical;
3. apply only through the approved workflow;
4. verify the canonical migration history and new runtime role names.

Keep both application runtimes stopped during this step. Do not manually recreate roles, rename
them back, edit migration history, or run production. If the migration fails, remain offline and
investigate; do not start either runtime.

## Phase 5: private FetanAgent deploy and smoke

Dispatch `Staging beta deploy and smoke` in `deploy-and-smoke` mode from exactly
`$REVIEWED_MAIN_COMMIT`. The workflow must first run the helper's `cutover-ready` check; that check
re-proves the legacy containers, networks, units, port 3002, and legacy live secrets are absent
before it provisions any 24-hour staging login.

The deployment must complete all of these before retirement:

- exact `fetanagent-staging-beta` private service set: `owner-control`, `api`, `beta-admission`, and
  exactly one Telegram `bot`;
- every container revision label equals `$REVIEWED_MAIN_COMMIT`;
- Owner control, API, and beta-admission are healthy and bot is running;
- Owner control listens only on `127.0.0.1:3002`;
- all three database preflights and readiness smoke pass;
- no public gateway is started and no DNS or firewall rule changes.

If it fails, run the current `stop-and-disable` mode before the 24-hour login expiry. Keep the old
runtime stopped, fix the reviewed code or environment, and retry from exact `main`. Database role
rollback or old-bot restart is a separate high-risk recovery decision and is never performed by
this procedure.

## Phase 6: retire legacy access and live secrets

After successful exact-commit private smoke, run from the root console:

```bash
/usr/local/sbin/fetanagent-vm-transition retire "$REVIEWED_MAIN_COMMIT"
/usr/local/sbin/fetanagent-vm-transition verify
```

`retire` rechecks the stopped legacy boundary, disabled old execution access, and the exact healthy
FetanAgent service set. It then:

- removes only legacy sudoers fragments found at the fixed allowlisted names and refuses unknown
  sudoers references;
- removes the old public `authorized_keys` file;
- locks the legacy password, sets `/usr/sbin/nologin`, and terminates old-user sessions;
- removes the old helper only if its checksum is still the reviewed legacy SHA;
- removes the legacy staging secret directory only when it is already empty;
- retains the old user record, home, `/srv/payreplayy/releases`, and Docker images for forensics.

It writes `/var/lib/fetanagent-vm-transition/retired-v1` atomically as a regular `root:root` mode
`0600` receipt containing:

```text
transition_version=1
droplet_id=590666364
legacy_helper_sha=4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69
new_helper_sha=<final-new-helper-lf-sha256>
acknowledged_commit=<reviewed-main-commit>
retired=true
```

Every rerun rechecks live state; markers are evidence, not substitutes for verification. Before the
receipt exists, `retire` is interruption-resumable: an already absent key, allowlisted sudoers
fragment, helper, or empty secret directory, and an already locked/nologin account are valid. Any
remaining artifact is validated exactly before removal. It never requires a removed sudoers fragment
to reappear. After the receipt exists, reruns are idempotent only when both the exact closed receipt
schema and live retired contract still agree.

## Phase 7: public edge only after retirement

The private deploy is the rollback and safety boundary. Only after `verify` reports `phase=retired`
may the separately guarded public-domain runbook proceed:

1. configure the reviewed UFW HTTP/HTTPS rules;
2. update only the reviewed Porkbun A/CNAME records while preserving mail records;
3. wait for exact DNS convergence;
4. run the public workflow in `inspect` mode;
5. publish `https://fetanagent.com`, `https://www.fetanagent.com`, and the authenticated
   `https://owner.fetanagent.com/owner` route.

Do not expose port 3002 publicly. Do not point DNS at the Droplet before private smoke and the
retirement receipt pass. Follow [`../public-domain.md`](../public-domain.md) for that separate phase.

## Recovery matrix

| Boundary                                          | Safe response                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Before `prepare`                                  | Fix inventory or helper hash; no application change occurred.                                             |
| After `prepare`, before legacy stop               | Run `rollback-prepare`; old runtime remains authoritative.                                                |
| During `mark-legacy-stopped` before its receipt   | Rerun the same command; it resumes exact legacy access sealing. Do not restore the old key/sudo boundary. |
| After legacy stop, before role rename             | Keep staging offline; fix residue and continue. Do not run both bots.                                     |
| After role rename, before successful new smoke    | Keep old runtime stopped; run current cleanup and fix/retry FetanAgent.                                   |
| During/after new smoke, before retirement receipt | Keep FetanAgent private; rerun `retire`, which resumes exact remaining legacy cleanup.                    |
| After `retire`, before public edge                | Continue private verification; do not recreate the retired legacy boundary.                               |
| After public edge                                 | Use the separate public-domain stop/inspect controls; do not use this transition as a public rollback.    |

At no point should an operator delete migration history, rotate the deposit-reference protection key
without its key-version migration, expose secrets in diagnostics, use general root SSH, grant Docker
socket access, or claim completion from a marker without the corresponding live verification.
