# KemerBet H14 live mount-order repair

This runbook is for one observed, interrupted H14 quarantine recovery on the
staging DigitalOcean Droplet. It is not a general recovery procedure. It does
not create a new H14 release, supersede H14 evidence, authorize a provider
action, or authorize money movement.

The canonical H14 recovery release remains exactly:

```text
06459511d9330a0e1d956c42529b81aa9970e7a2
```

The repair implementation commit is separate code provenance only. The repair
must preserve the canonical H14 release name, its directory inode, its two
already-published records, and every predecessor artifact. It may add only the
reviewed root-only Docker-contract bridge evidence and then resume the existing
H14 state machine.

The reviewed user authorization is represented by this SHA-256 digest of the
exact approved text:

```text
6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874
```

No username, password, CAPTCHA, OTP, cookie, Player ID, receiving-account
identifier, or other secret belongs in this runbook, a shell command, GitHub,
Supabase, a log, or chat.

## Exact observed checkpoint

The live repair must admit only all of the following facts together. A mismatch
is not something to normalize; it is a hard stop for a new read-only review.

- `/var/lib/fetanagent/kemerbet-quarantine-recovery-v14` is root-owned mode
  `0700` and contains exactly
  `.installing-06459511d9330a0e1d956c42529b81aa9970e7a2`.
- That installing directory is the same inode adopted from the older exact
  empty-checkpoint release. It is root-owned mode `0700` and contains exactly
  `empty-predecessor-checkpoint-adoption-v1` and
  `runtime-retirement-intent-v1`, both root-owned, single-link, regular mode
  `0600` files with their reviewed byte-exact contents.
- The immutable retirement intent names the exact H13 runtime release
  `306818ca812bd2abce8479396c4eea8383ea00f9`, one exact coordinator container,
  and one exact Owner container. Their IDs and contract digests remain private
  live evidence and must not be copied into this document or an operator log.
- The coordinator named by the intent has already been removed, no replacement
  coordinator exists, and the KemerBet profile volume has no holder.
- The exact Owner named by the intent still exists, is running and healthy, and
  retains the reviewed H13 image revision, service identity, read-only root,
  dropped capabilities, no-new-privileges policy, restart policy, environment,
  labels, command, and complete mount set. It is the only control-volume holder.
- The active sudoers grant is absent. The exact disabled grant exists at
  `/etc/sudoers.d/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-disabled`
  as a root-owned, single-link, regular mode `0440` file. `visudo` accepts the
  complete sudoers configuration.
- `/usr/local/sbin/fetanagent-staging-deploy-helper` is still the exact H13
  predecessor helper with SHA-256
  `3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa`.
  There is no helper-install temporary residue.
- The final KemerBet identity binding is absent. Every project container is in
  `FINANCIAL_ACTIONS_MODE=dry_run`; executor, final-action, internal execution,
  private live-deposit, Amount-entry, and Transfer gates are disabled. No host
  or container Chromium process exists.
- No runtime-retired, consume, quarantine, host-retired, Owner-restored, helper
  promotion, replacement-profile, replacement-cohort, seal, or recheck result
  has been published by this interrupted attempt.

The failure was caused by the legacy digest serializing Docker's map-backed
`Mounts` projection in an unstable order. Repeated read-only inspections of the
same unchanged container produced different legacy digests. The repair must
not wait for a coincidental order match. It parses one raw inspect response,
retains every field of every mount, sorts mounts only by their complete
canonical JSON representation, leaves every other array order-sensitive, and
binds the deterministic semantic digest to the immutable legacy intent in a
separate root-only repair ledger.

## Release and pull-request boundary

Run the repair from the exact reviewed pull-request head commit **before the
repair pull request is merged**. This ordering is mandatory, not a convenience:
all later H14 workflows are deliberately bound to `main` and to the canonical
H14 commit above. `main` must remain at that exact commit until the Owner-only
runtime bridge, replacement profile, exact-five cohort, deployment, private
preview, seal, and one recheck have all completed successfully.

Before any live command:

1. Record the full 40-character repair pull-request head SHA. The branch must
   not move after review.
2. Require all pull-request checks and the independent security review to pass
   for that exact SHA.
3. Confirm through the GitHub API that `main` still resolves to the canonical
   H14 SHA and that the repair SHA is the pull request's current head SHA.
4. Review the repair script and its verifier from that immutable commit. Do not
   fetch either artifact from a branch name, `main`, a release asset, a local
   working tree, or a browser download.
5. Do not merge the repair pull request yet. If `main` moves, the pull-request
   head moves, a check is rerun against another SHA, or any live checkpoint
   fact changes, stop.

The repair pull request may be merged only after the one authorized find-only
recheck has reached its durable successful terminal state and all postconditions
below are valid.

## Stage and run the exact repair

Use a fresh DigitalOcean root console. Set `repair_release` to the immutable,
fully reviewed pull-request head SHA. This is the only placeholder in the
commands below.

```bash
repair_release='<full-reviewed-repair-pr-head-sha>'
canonical_h14='06459511d9330a0e1d956c42529b81aa9970e7a2'
authorization_sha='6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
repository_owner='pay''relayy'
repository_name="$repository_owner"
staging_root="/root/fetanagent-kemerbet-quarantine-recovery-v14-live-repair-$repair_release"

[[ "$repair_release" =~ ^[0-9a-f]{40}$ ]]
[[ "$repair_release" != "$canonical_h14" ]]
[[ ! -e "$staging_root" && ! -L "$staging_root" ]]
umask 077
install -d -o root -g root -m 0700 "$staging_root"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh" \
  "https://raw.githubusercontent.com/$repository_owner/$repository_name/$repair_release/infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$staging_root/fetanagent-staging-deploy-helper.next" \
  "https://raw.githubusercontent.com/$repository_owner/$repository_name/$canonical_h14/infra/operations/fetanagent-staging-deploy-helper.sh"
chown root:root \
  "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh" \
  "$staging_root/fetanagent-staging-deploy-helper.next"
chmod 0600 \
  "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh" \
  "$staging_root/fetanagent-staging-deploy-helper.next"

successor_sha="$(awk -F"'" \
  '/^readonly REVIEWED_SUCCESSOR_HELPER_SHA256=/{print $2}' \
  "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh")"
[[ "$successor_sha" == \
  'c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58' ]]
[[ "$(sha256sum "$staging_root/fetanagent-staging-deploy-helper.next" | awk '{print $1}')" == \
  "$successor_sha" ]]

bash "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh" \
  "$repair_release" "$successor_sha" "$authorization_sha"
```

Do not retry an uncertain terminal submission. First perform a new read-only
checkpoint review. A normal fail-closed error preserves evidence and leaves the
grant disabled; it does not authorize a cleanup command, a new namespace, a
different release, or a broader retry.

The only acceptable first-install success line is:

```text
KemerBet H14 live repair installed: canonical evidence preserved; Amount and Transfer disabled; no money moved.
```

On an exact idempotent resume after the repair had already reached its terminal
state, the only acceptable success line is:

```text
KemerBet H14 live repair already valid: canonical evidence preserved; Amount and Transfer disabled; no money moved.
```

## Verify the repair before continuing

Verification is read-only. It must prove all of these postconditions without
printing container IDs, profile IDs, claim IDs, Player IDs, or record bodies:

- The canonical H14 directory is now
  `/var/lib/fetanagent/kemerbet-quarantine-recovery-v14/06459511d9330a0e1d956c42529b81aa9970e7a2`.
  The old `.installing-06459511...` name is absent. The original adoption and
  retirement-intent records are byte-for-byte unchanged.
- The separate live-repair ledger is final, root-owned, mode `0700`, bound to
  the exact repair implementation SHA, canonical H14 release, original H14
  directory device/inode, immutable legacy intent digest, exact Owner
  container, and deterministic semantic contract digest. It records that only
  Docker mount serialization order was bridged and that money did not move.
- The canonical H14 root contains its exact terminal installer evidence: both
  source-stage consumption records, retired binding, quarantined profile,
  retired failure marker, runtime-retired, host-retired, Owner-restored, and
  predecessor-helper evidence in addition to the two original records. No
  temporary record or helper-install residue remains.
- The old KemerBet browser profile and stale one-use v3 binding are no longer in
  their active source locations. They exist only in the root-only canonical
  quarantine namespace.
- The exact H13 coordinator remains absent. The exact Owner is running and
  healthy, the KemerBet profile volume has no holder, and the Owner is the only
  control-volume holder.
- The installed helper has SHA-256
  `c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58`.
  The active exact sudoers grant is restored and the disabled grant is absent.
- The Owner-visible terminal security-recovery marker is the only authorized
  next KemerBet mutation. No replacement profile, replacement cohort, browser,
  seal, lookup receipt, completion receipt, or final binding exists yet.
- Every financial gate is still disabled, the final binding is absent, no
  Chromium process exists, and no money moved.

Run the protected `quarantine-recovery-inspect` workflow from `main` with the
canonical H14 SHA, staging project, staging Droplet, and exact authorization
digest. It must report `host-retired` with Transfer and Amount disabled. Do not
use the repair SHA as `confirm_main_commit_sha`.

```bash
gh workflow run staging-kemerbet-session-provision.yml --ref main \
  -f mode=quarantine-recovery-inspect \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_quarantine_recovery_authorization_sha256=6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874 \
  -f confirm_droplet_id=593344964
```

Record and watch the exact dispatched run. Do not continue unless it concludes
successfully for the canonical H14 SHA.

## Complete the one authorized recovery while `main` is canonical H14

The order below is strict. At every boundary, use only `main` at
`06459511d9330a0e1d956c42529b81aa9970e7a2`. Never target the production
Supabase ref `xzztugbgtulptnbpoelr`.

### 1. Apply the reviewed Supabase migration to staging

```bash
gh workflow run supabase-staging-bootstrap.yml --ref main \
  -f mode=apply \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2
```

Require a successful run and its post-apply schema verification before the
Owner creates anything. This migration adds the claim-bound, idempotent
security-recovery path; it does not store a credential, Player ID, Amount, or
Transfer instruction and does not contact KemerBet.

### 2. Install the canonical-H14 Owner-only runtime bridge

This step is mandatory. The mount-order repair deliberately restores the exact
H13 Owner container so that the canonical H14 recovery evidence remains true.
That H13 Owner does not implement H14's claim-bound security-recovery request.
The staging migration rejects its ordinary profile request. Therefore **do not
click Prepare new KemerBet agent profile while the Owner is still H13**. A
failed ordinary request is not authorization to retry, weaken the database
guard, or bypass the bridge.

The bridge is release-neutral repair plumbing, not a new H14 recovery release.
It must be reviewed in the same repair pull request and staged through the
already-existing `staging-beta-deploy-smoke.yml` workflow before that pull
request is merged. The workflow mode is exactly
`h14-owner-runtime-bridge-stage`. The root installer is exactly
`infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh`,
and its verifier is the matching `.mjs` file.

Record both the immutable repair pull-request head SHA and its exact branch
ref. Re-read the ref immediately before dispatch and require it to resolve to
the reviewed SHA. The workflow itself must independently prove that `main`
still resolves to canonical H14, that the repair SHA is its own running commit,
and that the target is the one staging project and Droplet. Dispatch the
reviewed PR-head workflow with these inputs:

```bash
repair_release='<full-reviewed-repair-pr-head-sha>'
repair_ref='<exact-reviewed-repair-pr-branch-ref>'

[[ "$repair_release" =~ ^[0-9a-f]{40}$ ]]
[[ -n "$repair_ref" ]]
[[ "$(gh api "repos/payrelayy/payrelayy/commits/$repair_ref" --jq .sha)" == \
  "$repair_release" ]]

gh workflow run staging-beta-deploy-smoke.yml --ref "$repair_ref" \
  -f mode=h14-owner-runtime-bridge-stage \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_repair_implementation_sha="$repair_release" \
  -f confirm_quarantine_recovery_authorization_sha256=6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874 \
  -f confirm_droplet_id=593344964 \
  -f confirm_owner_only_no_provider_action=owner-only-no-provider-action-no-money
```

The stage workflow must check out canonical H14 in a separate clean worktree,
build only its `admin` image target with the image revision fixed to
`06459511d9330a0e1d956c42529b81aa9970e7a2`, and verify that image's user,
command, and revision. It stages exactly three files through the unprivileged
deployment identity: that one image archive, the canonical compose definition,
and a bounded manifest. The root installer is not accepted from the remote
bundle; the root console downloads it from the immutable repair commit and
requires its SHA-256 to equal the digest sealed into the manifest. The staging
workflow must not invoke Docker on the Droplet, run the root installer, apply
Supabase, start a provider browser, create a profile or cohort, or touch any
financial gate. The staging directory must be a new absent
`fetanagent-admin`-owned path bound to the exact repair SHA and workflow run; it
contains no credential or Player ID.

The reviewed root installer CLI is fixed at exactly five arguments, in this
order:

1. the immutable repair pull-request head SHA;
2. canonical H14 SHA `06459511d9330a0e1d956c42529b81aa9970e7a2`;
3. the exact `/tmp/fetanagent-h14-owner-runtime-bridge-...` bundle path emitted
   by the successful staging workflow;
4. that workflow's exact manifest SHA-256; and
5. authorization digest
   `6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874`.

Do not reconstruct or guess any of those values. Open the successful workflow
run, copy its **Exact fresh root-console invocation** block byte-for-byte, and
run that block once in a fresh DigitalOcean root console. Its reviewed shape is
shown below only to make the boundary auditable; every angle-bracket value must
come from that exact successful run:

```bash
repair_release='<full-reviewed-repair-pr-head-sha>'
canonical_h14='06459511d9330a0e1d956c42529b81aa9970e7a2'
authorization_sha='6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
remote_bundle='<exact-workflow-emitted-/tmp-bundle-path>'
manifest_sha='<exact-workflow-emitted-manifest-sha256>'
script_sha='<exact-workflow-emitted-installer-sha256>'
script_root="/root/fetanagent-h14-owner-runtime-bridge-$repair_release"
root_script="$script_root/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh"

[[ "$repair_release" =~ ^[0-9a-f]{40}$ ]]
[[ "$remote_bundle" =~ ^/tmp/fetanagent-h14-owner-runtime-bridge-[1-9][0-9]*-[1-9][0-9]*-$repair_release$ ]]
[[ "$manifest_sha" =~ ^[0-9a-f]{64}$ && "$script_sha" =~ ^[0-9a-f]{64}$ ]]
[[ ! -e "$script_root" && ! -L "$script_root" ]]
umask 077
install -d -o root -g root -m 0700 "$script_root"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$root_script" \
  "https://raw.githubusercontent.com/payrelayy/payrelayy/$repair_release/infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh"
chown root:root "$root_script"
chmod 0600 "$root_script"
[[ "$(sha256sum "$root_script" | awk '{print $1}')" == "$script_sha" ]]
bash "$root_script" "$repair_release" "$canonical_h14" "$remote_bundle" \
  "$manifest_sha" "$authorization_sha"
```

If the emitted block, script download, digest check, or installer result is
uncertain, stop for a read-only checkpoint review. Do not delete a staging
directory, choose a different bundle, or submit another root mutation command
merely because the first console response is unclear.

The root installer must acquire the shared mutation lock and publish a separate
append-only root-owned intent before stopping anything. It may stop and remove
only the exact recorded H13 Owner, load the one canonical-H14 `admin` image,
and create and start only `owner-control` with canonical H14's compose
contract. It must never create or start `kemerbet-session-provision` or any
other service. It must adopt only the exact stopped H14 Owner on a crash, never
perform a broad cleanup or rollback, and never alter the canonical H14 recovery
directory or the H14 helper.

Do not continue until read-only verification proves all of the following:

- The separate bridge ledger is final and binds the repair SHA, canonical H14
  SHA, staged-image digest, old exact Owner identity, and new exact Owner
  identity. No temporary bridge record remains.
- There is exactly one `owner-control` container. It uses the canonical H14
  image revision, is running and healthy, preserves the reviewed read-only
  root, non-root user, dropped capabilities, no-new-privileges policy,
  no-restart policy, command, networks, mounts, and loopback-only exposure.
- The old exact H13 Owner is absent; the coordinator remains absent; the
  profile volume has no holder; and the new Owner is the only control-volume
  holder.
- The canonical H14 recovery directory, its inode and records, the installed
  H14 helper, terminal recovery marker, and active grant are unchanged.
- The final binding remains absent. Every project container has exactly one
  `FINANCIAL_ACTIONS_MODE=dry_run`; executor, final-action, internal execution,
  private live-provider, Amount, Transfer, withdrawal, and settlement gates are
  disabled. No Chromium exists and no provider request or money movement
  occurred.

Only this verified canonical-H14 Owner may create the recovery profile below.

### 3. Create and finalize exactly one security-recovery profile

Open the authenticated Owner page. Refresh until it shows that KemerBet
security recovery is required. Under **KemerBet agent browser profile**, the
reason must be **Security recovery** and must not be editable to an ordinary
reason. Check the profile confirmation, click **Prepare new KemerBet agent
profile** once, accept the browser confirmation once, and wait for the success
notice. Do not enter a KemerBet username, password, CAPTCHA, or OTP at this
stage.

Then run exactly:

```bash
gh workflow run staging-kemerbet-session-provision.yml --ref main \
  -f mode=quarantine-recovery-finalize-profile \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_quarantine_recovery_authorization_sha256=6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874 \
  -f confirm_droplet_id=593344964
```

Require the exact successful result saying the replacement profile was
prepared with Transfer and Amount disabled. Repeating the Owner action or
creating another profile is forbidden.

### 4. Prepare and record exactly one five-Player cohort

Refresh the Owner page. It must show that only the security-recovery cohort is
available and exactly `5/5` currently eligible Players are present. No live
pilot may be draft or armed. Check the cohort confirmation and click **Prepare
one-use readiness cohort** once. Do not reveal or copy any Player ID.

Then run exactly:

```bash
gh workflow run staging-kemerbet-session-provision.yml --ref main \
  -f mode=quarantine-recovery-record-cohort \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_quarantine_recovery_authorization_sha256=6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874 \
  -f confirm_droplet_id=593344964
```

Require the exact successful result saying the exact-five cohort was recorded,
with no lookup and no money moved. Do not prepare a second cohort.

### 5. Deploy and smoke-test canonical H14

Only after the cohort is durably recorded, run:

```bash
gh workflow run staging-beta-deploy-smoke.yml --ref main \
  -f mode=deploy-and-smoke \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_droplet_id=593344964
```

Require every build, target, deploy, health, bot, public-edge, and no-money smoke
check to pass. Confirm again that all financial gates are disabled before
opening the preview.

### 6. Open the private preview and pause for the Owner

Run exactly:

```bash
gh workflow run staging-kemerbet-session-provision.yml --ref main \
  -f mode=start \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_droplet_id=593344964 \
  -f confirm_no_transfer=private-sign-in-no-transfer
```

After the workflow succeeds, the human Owner must check the private-preview
confirmation and click **Start private sign-in**. **Pause here.** Only the
human Owner may type the KemerBet username, password, CAPTCHA, or OTP, and only
inside the private preview. Do not request, observe, copy, log, or relay those
values. Do not continue until the Owner explicitly confirms that KemerBet is
signed in through this recovery preview.

### 7. Seal the fresh binding

After that explicit confirmation, run exactly:

```bash
gh workflow run staging-kemerbet-session-provision.yml --ref main \
  -f mode=seal \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_droplet_id=593344964 \
  -f confirm_no_transfer=seal-five-player-no-transfer
```

Require the exact aggregate success line `KemerBet readiness sealed: 5 of 5
Players, Transfer disabled.` Record the successful seal workflow run ID. Do not
run `seal` again and do not substitute another commit or run ID.

### 8. Run exactly one find-only recheck

Use the exact successful seal run ID as the only placeholder:

```bash
seal_run_id='<exact-successful-seal-workflow-run-id>'
[[ "$seal_run_id" =~ ^[1-9][0-9]{7,19}$ ]]
gh workflow run staging-kemerbet-session-provision.yml --ref main \
  -f mode=recheck \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_prior_seal_commit_sha=06459511d9330a0e1d956c42529b81aa9970e7a2 \
  -f confirm_prior_seal_run_id="$seal_run_id" \
  -f confirm_droplet_id=593344964 \
  -f confirm_no_transfer=independent-five-player-no-transfer-recheck
```

This dispatch is the one authorized find-only recheck. Its durable journal
becomes non-retryable when execution starts. A timeout, unknown provider result,
failure, lost GitHub response, or partial terminal publication does **not**
authorize a second dispatch. Recover or inspect the exact durable first attempt;
never run another provider lookup.

Success requires the exact result `KemerBet server readiness passed: 5 of 5
Players, Transfer disabled.`, the durable completion receipt, the final fresh
binding, consumption of every reusable stage, the Owner completion marker, and
absence of any retryable input. Only after those facts are independently
verified may the repair pull request be merged.

## No-money guarantees

Throughout this runbook:

- Amount fields and Transfer controls remain disabled; never type an Amount or
  note and never click Transfer.
- `FINANCIAL_ACTIONS_MODE` stays `dry_run`; executor, final-action, internal
  KemerBet execution, private live-deposit pilot, settlement, and payment
  verification remain disabled.
- Profile rotation and cohort preparation are configuration/evidence actions.
  They do not contact KemerBet or move money.
- The private preview accepts credentials only from the human Owner and blocks
  Transfer. It introduces no payment authority.
- The seal and the single recheck are find-only readiness operations. Their
  accepted receipts require `transferDisabled=true`, `moneyMoved=false`, five
  Players, and redacted identifiers.
- A failure stops forward progress. It never widens authorization, permits a
  retry after the one-use execution boundary, or justifies cleanup of preserved
  evidence.
