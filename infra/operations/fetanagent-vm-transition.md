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
9. Rotate the retired deploy helper through an exact pending overlay, deploy the next reviewed
   commit privately, and finalize the overlay only after exact-commit smoke succeeds.
10. Configure the firewall and public domain only after the finalized helper overlay exists.

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
- legacy sudoers fragment: `/etc/sudoers.d/payreplayy-staging-deploy`, `root:root` mode `0440`
- exact legacy sudoers one-line contract:
  `payreplayy-admin ALL=(root) NOPASSWD: /usr/local/sbin/payreplayy-staging-deploy-helper`
- legacy sudoers LF SHA-256:
  `34d408b7139c64888700ccd48f9b95dbe8ec5bfbae58d904ad2d10ffaaf2b928`
- FetanAgent helper: `/usr/local/sbin/fetanagent-staging-deploy-helper`
- FetanAgent helper source staged by root:
  `/root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper`
- transition state: `/var/lib/fetanagent-vm-transition`, `root:root` mode `0700`

The historical `NEW_HELPER_SHA` constant in
[`fetanagent-vm-transition.sh`](fetanagent-vm-transition.sh) remains pinned to the helper installed by
the immutable retirement receipts. `ROTATED_HELPER_SHA` is pinned to the SHA-256 of the next final LF
Git blob of `infra/operations/fetanagent-staging-deploy-helper.sh`; for this reviewed rotation it is
`b4664efdbe3297b7b0ddee8122bf431608571e84dd0987892f58c20f48bdb663`. Do not hash a Windows checkout:
CRLF conversion produces a different digest. Verify each pin from its reviewed commit before
installing:

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

The SSH Match fragment intentionally omits `PermitUserEnvironment`: OpenSSH keeps its secure `no`
default, but rejects that keyword inside a `Match` block on the staging host. Local forwarding
remains restricted to `127.0.0.1:3002` by `AllowTcpForwarding local` and the exact `PermitOpen`.
Before writing or accepting the prepared receipt, the transition runs `sshd -t` and then queries the
effective user policy with
`sshd -T -C user=fetanagent-admin,host=localhost,addr=127.0.0.1`. It fails closed unless OpenSSH
reports public-key-only authentication; disabled password, keyboard-interactive, empty-password,
agent, stream-local, tunnel, TTY, X11, gateway, and user-environment access; and local TCP forwarding
restricted to only `127.0.0.1:3002`. It also requires public-key authentication to remain enabled
and the global `DisableForwarding` override to remain off. These effective-policy checks run before
the SSH reload and again after it; the prepared receipt is never written if either check fails.

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

One previously reviewed transition could strand an exact `root:root` mode `0644` owned SSH drop-in
after OpenSSH rejected `PermitUserEnvironment no` inside its `Match` block and before the prepared
receipt was written. `rollback-prepare` recognizes only that exact historical fragment (or the
current exact fragment), completes all other partial-state validation, removes only the fixed owned
drop-in, and then requires `sshd -t` to pass before reloading SSH. Any other fragment bytes or
metadata still fail closed.

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
validates and removes the one exact legacy sudoers fragment and legacy public key, locks the
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

1. dispatch its read-only migration plan from `$REVIEWED_MAIN_COMMIT` and enter that same full SHA
   in `confirm_main_commit_sha`;
2. confirm this migration is pending or already canonical;
3. apply only through the approved workflow from the unchanged `$REVIEWED_MAIN_COMMIT`, entering
   that same full SHA again;
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

- exact `fetanagent-staging-beta` private service set: `owner-control`, `customer-web`, `api`,
  `beta-admission`, and exactly one Telegram `bot`;
- every container revision label equals `$REVIEWED_MAIN_COMMIT`;
- Owner control, customer web, API, and beta-admission are healthy and bot is running;
- Owner control listens only on `127.0.0.1:3002`;
- all four database preflights and readiness smoke pass;
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

- removes only the one exact fixed legacy sudoers fragment and refuses unknown sudoers references;
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
receipt exists, `retire` is interruption-resumable: an already absent key, exact fixed sudoers
fragment, helper, or empty secret directory, and an already locked/nologin account are valid. Any
remaining artifact is validated exactly before removal. It never requires a removed sudoers fragment
to reappear. After the receipt exists, reruns are idempotent only when both the exact closed receipt
schema and live retired contract still agree.

## Phase 6A: rotate the retired helper and advance private staging

This one-time overlay advances the retired staging boundary without rewriting any historical
receipt. The fixed base and helper pins are:

```text
old_reviewed_commit=e636de89be179514af3aae3972ee0b086cd8c816
old_helper_sha=e530efcc0781be8d298c0527f1a27bf1b7c97f9e0c9584adc0dd6ced0a7770af
new_helper_sha=4d3442cf79fe7c1648b1a31a57b308cc3cbc9806f15505d93284ba314dc1449e
new_reviewed_commit=<exact-40-lowercase-C1-from-reviewed-main>
```

Do not substitute another old commit, helper digest, state directory, source path, or installed
path. On a trusted clean checkout of exact C1, extract the normalized LF blobs and verify H1 before
transferring them through the root-console staging channel:

```bash
bash -euo pipefail <<'FETANAGENT_EXTRACT'
C1='<exact-40-lowercase-C1-from-reviewed-main>'
TRANSITION_SHA='<out-of-band-reviewed-LF-C1-transition-sha256>'
[[ "$C1" =~ ^[0-9a-f]{40}$ ]]
[[ "$TRANSITION_SHA" =~ ^[0-9a-f]{64}$ ]]
git show "$C1:infra/operations/fetanagent-staging-deploy-helper.sh" > fetanagent-staging-deploy-helper
git show "$C1:infra/operations/fetanagent-vm-transition.sh" > fetanagent-vm-transition
test "$(sha256sum fetanagent-staging-deploy-helper | awk '{ print $1 }')" = \
  '4d3442cf79fe7c1648b1a31a57b308cc3cbc9806f15505d93284ba314dc1449e'
test "$(sha256sum fetanagent-vm-transition | awk '{ print $1 }')" = "$TRANSITION_SHA"
bash -n fetanagent-staging-deploy-helper
bash -n fetanagent-vm-transition
FETANAGENT_EXTRACT
```

At the DigitalOcean root console, place only those reviewed LF bytes at these fixed staging paths,
verify their out-of-band reviewed hashes, then install only the transition controller:

```bash
bash -euo pipefail <<'FETANAGENT_INSTALL'
install -d -o root -g root -m 0700 /root/fetanagent-vm-transition-input
install -o root -g root -m 0600 ./fetanagent-staging-deploy-helper \
  /root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper
install -o root -g root -m 0600 ./fetanagent-vm-transition \
  /root/fetanagent-vm-transition-input/fetanagent-vm-transition.next
TRANSITION_SHA='<out-of-band-reviewed-LF-C1-transition-sha256>'
[[ "$TRANSITION_SHA" =~ ^[0-9a-f]{64}$ ]]
test "$(sha256sum /root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper | awk '{ print $1 }')" = \
  '4d3442cf79fe7c1648b1a31a57b308cc3cbc9806f15505d93284ba314dc1449e'
test "$(sha256sum /root/fetanagent-vm-transition-input/fetanagent-vm-transition.next | awk '{ print $1 }')" = \
  "$TRANSITION_SHA"
bash -n /root/fetanagent-vm-transition-input/fetanagent-vm-transition.next
TRANSITION_INSTALL_TMP="$(mktemp /usr/local/sbin/.fetanagent-vm-transition.XXXXXX)"
install -o root -g root -m 0700 \
  /root/fetanagent-vm-transition-input/fetanagent-vm-transition.next \
  "$TRANSITION_INSTALL_TMP"
test "$(stat --format='%U:%G:%a' "$TRANSITION_INSTALL_TMP")" = 'root:root:700'
test "$(sha256sum "$TRANSITION_INSTALL_TMP" | awk '{ print $1 }')" = "$TRANSITION_SHA"
mv -f -- "$TRANSITION_INSTALL_TMP" /usr/local/sbin/fetanagent-vm-transition
test "$(stat --format='%U:%G:%a' /usr/local/sbin/fetanagent-vm-transition)" = 'root:root:700'
test "$(sha256sum /usr/local/sbin/fetanagent-vm-transition | awk '{ print $1 }')" = \
  "$TRANSITION_SHA"
FETANAGENT_INSTALL
```

Set C1 to the exact reviewed `main` commit and run the rotation only from that root console:

```bash
BASE_REVIEWED_MAIN_COMMIT='e636de89be179514af3aae3972ee0b086cd8c816'
NEXT_REVIEWED_MAIN_COMMIT='<exact-40-lowercase-C1-from-reviewed-main>'
[[ "$NEXT_REVIEWED_MAIN_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$NEXT_REVIEWED_MAIN_COMMIT" != "$BASE_REVIEWED_MAIN_COMMIT" ]]
/usr/local/sbin/fetanagent-vm-transition rotate-retired-helper \
  "$BASE_REVIEWED_MAIN_COMMIT" "$NEXT_REVIEWED_MAIN_COMMIT"
/usr/local/sbin/fetanagent-vm-transition verify
```

The command exact-validates the four immutable base receipts, live retired access, H0/C0 private
runtime, staged H1, and the absence of a gateway, gateway state root, and listeners on 80/443. It
removes only the exact deploy sudoers fragment, rechecks that no helper process exists, installs H1,
then writes `/var/lib/fetanagent-vm-transition/helper-rotation-v1` atomically as `root:root` mode
`0600`:

```text
transition_version=1
droplet_id=590666364
old_helper_sha=e530efcc0781be8d298c0527f1a27bf1b7c97f9e0c9584adc0dd6ced0a7770af
new_helper_sha=4d3442cf79fe7c1648b1a31a57b308cc3cbc9806f15505d93284ba314dc1449e
old_reviewed_commit=e636de89be179514af3aae3972ee0b086cd8c816
new_reviewed_commit=<exact-40-lowercase-C1-from-reviewed-main>
rotation_pending=true
```

Pending authorizes only the exact H1 helper to deploy C1 privately; public-edge commands reject it.
Dispatch the main-only staging deploy-and-smoke workflow for exact C1. After it reports the exact
four-service C1 runtime healthy and no public edge, finalize from the root console:

```bash
/usr/local/sbin/fetanagent-vm-transition finalize-retired-helper \
  "$BASE_REVIEWED_MAIN_COMMIT" "$NEXT_REVIEWED_MAIN_COMMIT"
/usr/local/sbin/fetanagent-vm-transition verify
```

Finalization seals the exact sudo boundary again, rechecks the private C1 runtime and unpublished
edge, and changes only the overlay's last line to `rotation_complete=true`. It restores and validates
the exact deploy sudoers fragment only after the complete live boundary passes. The immutable
`prepared-v1`, `acknowledged-v1`, `legacy-stopped-v1`, and `retired-v1` receipts remain byte-for-byte
unchanged. A complete overlay authorizes the separately guarded public phase.

Rotation is interruption-resumable only for these exact prefixes:

| Exact prefix                                                           | Safe root-console response                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| H0, no overlay                                                         | Rerun `rotate-retired-helper C0 C1`.                                                           |
| H1, no overlay, deploy sudo absent                                     | Rerun the same rotate command; it recognizes only `helper-installed`.                          |
| Exact pending overlay, deploy sudo absent or present, runtime C0 or C1 | Rerun the same rotate command; sudo is restored only after the unpublished boundary validates. |
| Exact pending overlay and exact C1 runtime                             | Run `finalize-retired-helper C0 C1`.                                                           |
| Exact complete overlay, deploy sudo absent, before publication         | Rerun the finalize command; it validates complete state before restoring sudo.                 |
| Exact complete overlay and deploy sudo present                         | `verify` reports `phase=retired`; proceed to the public runbook.                               |

Any failed mutation after sudo sealing deliberately leaves deploy sudo absent. Never restore it by
hand. Rerun the matching exact command. An unknown helper digest, overlay schema, commit pair,
runtime revision, extra service, public listener, gateway artifact, legacy residue, or sudoers
reference is not resumable: stop and investigate without editing receipts.

## Phase 7: public edge only after retirement

The private deploy is the rollback and safety boundary. Only after `verify` reports `phase=retired`
with `helper_rotation=complete` may the separately guarded public-domain runbook proceed:

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
