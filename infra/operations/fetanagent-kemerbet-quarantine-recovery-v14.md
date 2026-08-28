# KemerBet quarantine recovery H14

H14 is a forward-only, fail-closed recovery for the single quarantined H13
KemerBet browser profile. It does not authorize a deposit, withdrawal, Amount
entry, Transfer click, executor, final action, lookup, or recheck. The only
permitted terminal action is one later exact-five, find-only recheck through the
existing no-transfer gate.

The reviewed user authorization is bound by SHA-256 to the exact UTF-8 text
from the Owner confirmation (without a trailing newline):

```text
6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874
```

## Durable phases

1. The root-console installer verifies the exact H13 release and helper,
   confirms that financial gates are disabled, and rejects a final binding or
   active/foreign mutation state. Before reading or changing either durable
   volume, it binds a retirement intent to the exact H13 coordinator and Owner
   container IDs and immutable configuration digests, proves that the
   coordinator contains no Chromium process, gracefully stops and removes that
   coordinator, stops the exact Owner container, rejects every foreign volume
   holder, and publishes a durable holder-free/no-Chromium retirement record.
   The Chromium process attestation requests `pid,comm,args` from Docker so
   Docker's mandatory PID column is present before the command and arguments
   are scanned. A missing header, missing process row, Docker error, or browser
   process fails closed.
2. It durably publishes separate redacted consume records containing no Player
   ID, provider credential, cookie, OTP, or HMAC token. Those records retain only
   the exact source inode and SHA-256 attestations plus root-only internal opaque
   claim/profile UUIDs needed for unambiguous recovery. A retry after either
   unlink accepts absence only
   when the corresponding byte-exact consume record already exists; pre-intent
   absence remains invalid. It consumes those raw stages without copying any
   Player ID into the redacted records. It atomically renames only the old
   profile, stale 230-byte v3 binding, and retryable failure marker into
   `/var/lib/fetanagent/kemerbet-quarantine-recovery-v14/<release>` on the same
   filesystem. The profile and binding are explicitly named root-only quarantine,
   not redacted records; they may contain quarantined session cookies or HMAC
   material but cannot be traversed by the service UID. The redacted digest/inode
   evidence is append-only and never deleted or rolled back.
3. It restarts and health-checks the same immutable H13 Owner container only
   after host retirement and terminal-marker publication, records that exact
   restoration, then finalizes the H14 namespace. It archives the predecessor
   helper, installs the release-reviewed H14 helper, and publishes
   `kemerbet-readiness-cohort-security-recovery-failed-terminal-v1`. Interrupted
   installer and record prefixes can only move forward after byte, inode,
   ownership, mode, link-count, and namespace re-attestation. Every deterministic
   ASCII evidence publisher and the exact staged helper use bounded
   append-completion: an existing temporary file must be a byte-for-byte prefix
   of the recomputed reviewed artifact, only the missing suffix may be appended,
   and the completed file and containing directory are fsynced before the atomic
   rename is trusted. A foreign, oversized, linked, wrongly owned, or wrongly
   moded prefix is preserved and rejected; it is never deleted, replaced, or
   normalized. The only metadata completion permitted is for an exact empty
   file left between exclusive creation, ownership assignment, and mode
   assignment; its owner/mode must match one of those narrowly enumerated
   initialization states. A valid already-final record is likewise
   directory-fsynced again before any later mutation. Exact already-renamed
   evidence, quarantined profile, consumed-stage absence, completed H14
   namespace, helper, and sudoers topology also re-fsync their containing
   directories on resume before the installer advances.
   A crash after the exact Owner-restored record is final but before the
   installing H14 root is renamed is an explicit complete-installing phase: it
   is accepted only with the disabled grant and predecessor helper, all forward
   evidence is revalidated, and the same root is finalized without repeating a
   financial or provider action.

4. The Owner application creates exactly one new `security_recovery` KemerBet
   profile and its exact nine-line database acknowledgment. The protected
   workflow mode `quarantine-recovery-finalize-profile` first creates the
   private eight-line, 389-byte recovery identity authorization and records
   private append-only terminal evidence while the old Owner-visible terminal
   marker remains in place. This authorization contains only the retired
   Profile UUID, its already-keyed identity digest, and the fresh Profile UUID;
   it is deliberately not a v3 binding and contains no username, credential,
   OTP, cookie, raw identity, Player ID, Amount, or Transfer authority. It
   then atomically renames that marker to the exact
   `security-recovery-profile-finalized` quarantine latch and fsyncs the receipt
   directory before consuming the acknowledgment. There is therefore no crash
   prefix in which the Owner sees an empty receipt namespace and unlocks
   ordinary mutations. The retired UUID-bound digest is preserved only as the
   continuity proof and is never relabeled as belonging to the fresh UUID.
5. After the Owner creates one new five-Player cohort, protected workflow mode
   `quarantine-recovery-record-cohort` first binds its claim, exact stage inodes,
   and digest in redacted durable evidence. It then freezes those same two
   inodes from Owner-only `0400` to root-owned `0444`, re-attests the frozen
   pair, and only then retires the Owner-visible profile-finalized latch into
   private evidence. A crash during the ownership-before-mode transition leaves
   root-owned `0400` files, which are recognized only as a resumable freeze
   prefix and can never be imported, sealed, or treated as prepared.
6. The ordinary protected `start` mode mounts the recovery-only authorization.
   For every signed-in DOM observation, the executor first recomputes and
   timing-safely verifies the retired UUID-bound digest, then returns a digest
   derived under the fresh UUID from that same transient raw observation. The
   raw identity is never logged or persisted. `seal` writes the ordinary
   230-byte v3 binding only after that continuity proof succeeds. Preview is
   blocked during an incomplete reseal publication; once resealed, `start`
   mounts only the fresh v3 binding. `recheck` then wraps exactly one find-only
   operation. Immediately before the controller firewall is released, the helper
   durably changes the one-use journal from `candidate_bound` to
   `execution_started`; after that boundary, any success, error, timeout, or
   unknown provider result is permanently non-retryable. It publishes an exact
   Owner-visible spent-terminal marker and consumes all reusable inputs, so a
   crash cannot turn an uncertain lookup into a second lookup. Amount and
   Transfer remain disabled, and no money-moving authority is introduced. H14
   appends completion evidence only after the existing recheck receipt and
   Owner completion marker are durable.

### Exact empty-checkpoint adoption

The first H14 attempt at release
`4239201b5496bd08912cce4b5581fe19b29a84d4` stopped before durable retirement
intent because its Docker `top` format omitted PID. Its only residue is the
exact root-owned mode-`0700`, empty
`.installing-4239201b5496bd08912cce4b5581fe19b29a84d4` directory, with the
deployment grant, helper, runtime, Amount, and Transfer state unchanged. A
later reviewed H14 release accepts only that exact singleton prefix. Under the
mutation lock it re-verifies the exact predecessor helper digest, the helper's
own verification, and H13 bridge readiness, then append-completes a bounded root-only
`empty-predecessor-checkpoint-adoption-v1` record containing the old and new
release names plus the checkpoint directory's device/inode. The record says
`state=adoption-prepared`, authorizes only the same-inode target rename, and
truthfully records that the namespace rename was still pending when the record
was published. H14 fsyncs that immutable pre-rename evidence and then renames
the same directory inode to the new `.installing-<release>` name; its current
namespace and recorded device/inode prove that the rename completed.
There is no recursive cleanup, unlink, replacement directory, or normalization
of any foreign prefix. A crash before or after the record rename can only
resume forward from the exact temporary record prefix, the exact prepared
record under the old namespace, or that same recorded inode under the new
installing/final namespace. A missing or empty H14 parent, or a successor
installing/final/helper state without this exact record, is rejected.

After the successor helper is installed, an idempotent rerun validates the exact
final or later helper-derived H14 state under the mutation lock and exits before
the installer-only retirement-intent path. It accepts no helper-install residue
and does not rewrite H14 evidence. If the exact deployment grant remained
disabled after an interrupted successful installation, it is restored only
after helper digest verification, recovery-state attestation, financial-gate
attestation, mutator exclusion, and Droplet identity verification all pass.

Every H14 workflow mode is restricted to protected `main`, the exact checked-out
commit, the staging Supabase project and DigitalOcean droplet, and the exact
authorization digest above. Credentials and OTPs belong only in the private
preview; never place them in GitHub inputs, logs, chat, or Supabase.

## Root-console installer input

Set `release` to the full reviewed, merged `main` commit SHA. Create the root-only
`/root/fetanagent-kemerbet-quarantine-recovery-v14-$release` directory, then use
HTTPS to fetch both files from the immutable, content-addressed GitHub commit—not
from `main`, a branch, a release asset, the local working tree, or a browser
download:

```bash
release='<full-reviewed-main-commit-sha>'
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
repository_owner='pay''relayy'
repository_name="$repository_owner"
staging_root="/root/fetanagent-kemerbet-quarantine-recovery-v14-$release"
[[ ! -e "$staging_root" && ! -L "$staging_root" ]]
umask 077
install -d -o root -g root -m 0700 "$staging_root"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14.sh" \
  "https://raw.githubusercontent.com/$repository_owner/$repository_name/$release/infra/operations/fetanagent-kemerbet-quarantine-recovery-v14.sh"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$staging_root/fetanagent-staging-deploy-helper.next" \
  "https://raw.githubusercontent.com/$repository_owner/$repository_name/$release/infra/operations/fetanagent-staging-deploy-helper.sh"
chown root:root "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14.sh" \
  "$staging_root/fetanagent-staging-deploy-helper.next"
chmod 0600 "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14.sh" \
  "$staging_root/fetanagent-staging-deploy-helper.next"
```

The full Git commit SHA is the non-circular content-addressed provenance anchor.
The installer additionally refuses to run unless its own real path, owner, mode,
and link count match that exact release staging directory; it independently
hard-pins and verifies the helper SHA-256 before mutation. Run that exact staged
installer with exactly:

```bash
successor_sha="$(awk -F"'" '/^readonly REVIEWED_SUCCESSOR_HELPER_SHA256=/{print $2}' \
  "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14.sh")"
[[ "$successor_sha" =~ ^[0-9a-f]{64}$ ]]
[[ "$(sha256sum "$staging_root/fetanagent-staging-deploy-helper.next" | awk '{print $1}')" == \
  "$successor_sha" ]]
bash "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14.sh" \
  "$release" "$successor_sha" \
  '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
```

The three positional arguments are:

1. the full H14 release commit SHA;
2. the hard-pinned reviewed helper SHA-256 from the installer; and
3. the authorization SHA-256 above.

The installer durably records the exact runtime retirement intent before any
container or volume mutation. It deliberately leaves the sudo grant disabled
after any incomplete mutation. The exact predecessor empty checkpoint described
above is the only admissible initial namespace; H14 never creates a missing
parent or a fresh successor prefix. Re-running the hotfix resumes only that exact
old prefix or its same-inode successor installing/final namespace carrying the
mandatory prepared-adoption record. A symlink, hard link, foreign entry, wrong
owner/mode, changed inode/hash, missing record, or cross-device move fails closed
and preserves all evidence for review. Preparing the record and same-filesystem
rename does not disable the grant, change the helper, stop a container, touch a
volume, enable Amount or Transfer, or move money.
