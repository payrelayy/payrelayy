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
   ownership, mode, link-count, and namespace re-attestation.
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
   crash cannot turn an uncertain lookup into a second lookup. Amount and Transfer remain disabled, and no money-moving authority is introduced. H14
   appends completion evidence only after the existing recheck receipt and
   Owner completion marker are durable.

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
staging_root="/root/fetanagent-kemerbet-quarantine-recovery-v14-$release"
[[ ! -e "$staging_root" && ! -L "$staging_root" ]]
umask 077
install -d -o root -g root -m 0700 "$staging_root"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$staging_root/fetanagent-kemerbet-quarantine-recovery-v14.sh" \
  "https://raw.githubusercontent.com/payrelayy/payrelayy/$release/infra/operations/fetanagent-kemerbet-quarantine-recovery-v14.sh"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$staging_root/fetanagent-staging-deploy-helper.next" \
  "https://raw.githubusercontent.com/payrelayy/payrelayy/$release/infra/operations/fetanagent-staging-deploy-helper.sh"
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
after any incomplete mutation. The exact legacy crash prefix with an attested
disabled grant and no H14 root is allowed to create only that durable intent
before resuming. Re-running the exact same release resumes only a recognized prefix; a
symlink, hard link, foreign entry, wrong owner/mode, changed inode/hash, or
cross-device move fails closed and preserves all evidence for review.
