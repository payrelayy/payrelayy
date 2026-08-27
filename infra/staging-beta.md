# Manual staging beta container contract

`compose.staging-beta.yaml` is a deployment artifact for private beta admission plus pending
Player-ID registration. It does not run under the default Compose profile and it does not include a
worker, long-lived executor, maintenance process, public API host port, Docker socket, production project
reference, Player-ID validation, or a live financial/provider action path. Owner control retains
its VM-loopback binding. A secret-free HTTPS gateway exists only in the separate
`public-domain` profile and is governed by [`public-domain.md`](public-domain.md).

The only services are:

- `owner-control`, the server-authenticated invite issuer/revoker on VM loopback port 3002;
- `customer-web`, the authenticated customer workspace and dry-run proof intake on container port
  3003;
- `api`, an internal action-only service on container port 3000 which records admitted menu/input
  events and creates pending Player-ID requests;
- `beta-admission`, an internal HTTP service on container port 3001 with a `/readyz` healthcheck;
  and
- `bot`, exactly one Telegram long-polling process which waits for `beta-admission` readiness.
- `gateway`, a separately selected Caddy edge which serves the static FetanAgent landing page and
  proxies only authenticated Owner control. It cannot reach the API or beta-admission bridge.
- `kemerbet-session-provision`, a normally absent, separately profile-gated private sign-in browser
  built from the reviewed executor image. Credential entry is limited to ten minutes; the exact
  locked, authenticated browser can remain for at most twelve hours. It has no database, manifest,
  amount, settlement, or execution authority. For its one-time readiness seal only, it receives one
  identity HMAC key, the exact-five one-use Player list, reviewed selector v2, and an isolated output
  directory. It shares a private Unix-socket volume with Owner and one isolated persistent browser
  profile. Its route guard always blocks the exact deposit endpoint, locks manual input after the
  signed-in `/agents` page appears, and permits the seal to issue read-only lookups in that same
  in-memory authenticated Chromium process. After the fifth strictly validated lookup, the terminal
  route latch remains installed while the exact BrowserContext closes; only a successful close and
  cleared retained session may precede the v3 stable-profile binding write.
- `kemerbet-no-transfer-readiness`, `kemerbet-readiness-browser`, and
  `kemerbet-readiness-egress-proxy`, three normally absent services in the explicit
  `kemerbet-no-transfer-readiness` profile. They are respectively UID/GID `10002`, `10001`, and
  `10003`; publish no port; and divide control, browser, and trusted Layer-7 egress authority. The
  root helper also creates short-lived UID/GID-`10004` authorization-premint and root profile
  snapshot-copy, strict snapshot-verify, and source-policy original-verify containers with network
  mode `none`; these are not long-running Compose services.

The private sign-in and seal are an explicitly trusted, supervised enrollment ceremony—not a
compromised-renderer containment boundary. The operator already trusts the live KemerBet page while
entering credentials; during enrollment, unsandboxed Chromium and trusted Node share UID `10001`
while the container holds the seal-only identity HMAC, exact-five Player input, selector, profile,
and output mounts. A compromised enrollment renderer is therefore outside the confidentiality
guarantee, although the route guard contains no financial endpoint and successful binding
installation requires terminal BrowserContext closure. Compromised-renderer containment begins
after that close, in the disposable snapshot and three-service recheck below.

The five application images use the immutable Linux/amd64 Node base in the repository `Dockerfile`;
the gateway uses a separately pinned official Caddy image. Ordinary application services run as
numeric UID/GID 10001; the readiness controller and proxy use their separate identities above. Each
Compose service uses a read-only root filesystem, prevents privilege escalation, and has PID, memory,
and CPU limits. Application services drop every Linux capability; the gateway adds only
`NET_BIND_SERVICE` so its non-root process can bind standard HTTPS ports. The two project-scoped bridges are IPv6-enabled
and permit outbound Internet access for the exact staging Supabase direct database endpoint and
Telegram HTTPS. The bot and admission service publish
no port; Owner control publishes only `127.0.0.1:3002`. The gateway publishes TCP 80/443 only after
the separate domain/firewall workflow is approved. Docker JSON logs are bounded to three 10 MiB
files per service.

## Locked feature boundary

Beta admission, the isolated Player-ID action channel, and the dedicated customer-web dry-run proof
intake are enabled. The action API may issue an "Add Player ID" capability and store a request with
status `pending`; the proof intake may store unverified provider-neutral v2 evidence for the staging
simulation. Neither path can verify a provider receipt, credit a Player ID, call KemerBet, collect a
withdrawal, or execute a payment. The older live customer-web deposit runtime, generic Telegram
ingress, nonce maintenance, the generic API PostgreSQL runtime, KemerBet execution, and final
KemerBet actions remain explicitly false. `FINANCIAL_ACTIONS_MODE` is fixed to `dry_run`.

This is not an authorization to start the profile. A later, explicit staging activation must first
review the commit, runtime credentials, startup preflight, and resulting rendered Compose model.

### Owner exact-five cohort import and claim freeze

The Owner-side readiness export is a one-use, exact-five bridge into the root helper. It creates the
fixed Player stage plus a fixed claim sidecar containing only a lowercase claim UUID. The root
helper never prints, logs, hashes into a receipt, or returns a Player ID. Its only app-readable
receipts are fixed aggregate UUID markers named `kemerbet-readiness-cohort-imported-v1`,
`kemerbet-readiness-cohort-completed-v1`, and retryable
`kemerbet-readiness-cohort-failed-v1`. These markers do not authorize a deposit, withdrawal, or
provider action. The recheck remains the existing lookup-only, transfer-blocked contract and does
not compare KemerBet balances or transaction history, so unrelated manual agent activity is not an
import failure signal.

The root helper requires Docker Engine 28 or newer before it creates any readiness artifact. It
first makes a fresh external snapshot volume, copies the exact account profile with a root,
network-`none` one-shot, remounts that completed volume read-only into a separate root,
network-`none` verifier, and re-attests its manifest before changing only the snapshot-volume root to
`10001:10001` mode `0700`. The long-lived `kemerbet_sessions` volume is never mounted into the
readiness browser. Each snapshot regular file is bounded to 256 MiB and the complete traversal is
bounded to 1 GiB of both logical and actually read bytes; a partial or oversized copy fails closed
and its disposable volume is removed. Only source traversal omits the exact top-level
`SingletonCookie`, `SingletonLock`, and `SingletonSocket` entries, and only after two stable `lstat`
checks prove each is a symlink; it never follows, copies, or hashes them. The same names as
files/directories, every nested or other symlink, and any such entry in the completed snapshot or
strict `verify` traversal fail closed. Post-run re-attestation of the original profile uses a
separate `verify-original` command with only the source omission rule. In parallel preparation, a UID/GID-`10004`, network-`none`
authorizer consumes the exact-five file and separate authorizer-only key/nonce inodes, atomically
writes exactly five ordered authorization tokens, and is removed before any networked service
starts. Its Player input and signing material are removed immediately after the token file is
verified and handed to the controller.

The networked proof then consists of exactly three stopped containers created from the same reviewed
image: a UID/GID-`10002` controller on the internal control bridge, a UID/GID-`10001` browser on the
internal control and proxy bridges, and a UID/GID-`10003` trusted Layer-7 proxy on the proxy and
egress bridges. Their reviewed dual-stack addresses are static; neither the controller nor browser
has a default route; no service publishes a port; and no network is attached dynamically. The host
installs exact IPv4/IPv6 namespace firewalls for the controller and browser before atomically
publishing their separate immutable release files. Every firewall command enters a network namespace
through a held `/proc/self/fd` descriptor that is opened and re-attested across two exact container
inspections, held through post-release firewall verification, and closed before cleanup; a recycled
PID or changed namespace fails closed. The controller receives the frozen identity binding,
exact-five input, RPC capability, pre-minted tokens, and its firewall gate—but no profile, selector,
browser, proxy key, or nonce. The browser receives only the disposable snapshot, selector,
file-based account UUID, RPC capability, and its firewall gate. The proxy receives only its key,
nonce, reviewed release SHA, separate proxy-only copies of the canonical agent-identity binding and
identity HMAC key, and write-only proof output—never the Player cohort.

Chromium maps only the three reviewed KemerBet hosts to the fixed proxy and resolves every other
hostname to `~NOTFOUND`; QUIC, WebRTC, DNS prefetch, preconnect, prediction, speculative prefetch,
and WebTransport are disabled. Before Compose may report the proxy healthy, the proxy sequentially
prefetches the exact `/agents` HTML plus seven pinned v84 assets using fixed headers. It requires
HTTP 200, no redirect, absent or exact `identity` encoding, no entry over 8 MiB, and no aggregate over
32 MiB. Renderer bootstrap requests are then served only from that private in-memory cache and never
produce further upstream bootstrap traffic. Only after the cache, listening socket, and post-listen
network attestation pass does the proxy atomically publish an exact UID/GID-`10003`, mode-`0600`
marker at `/tmp/fetanagent-kemerbet-readiness-layer7-proxy.ready` in its private tmpfs, containing
only `fetanagent-kemerbet-readiness-layer7-proxy-ready-v1` plus LF. Compose verifies its no-follow
inode, metadata, bytes, and EOF with a 90-second start period and 120 retries; the root helper allows
240 seconds and starts the browser only after exact application health.

The proxy accepts only the reviewed cached bootstrap GET/OPTIONS surface and the exact sequential
Player lookup. For the first lookup it accepts only a syntactically exact sanitized bearer and sends
it only to one independent read-only `GET /Account/Profile`; no Player lookup reaches KemerBet first.
It strictly validates HTTP/encoding/UTF-8/JSON plus `resultCode: 0` and bounded `value.userName`,
recomputes the account-scoped Profile HMAC, and timing-safely matches the stable Profile pin in the
exact 230-byte v3 binding. Only after that match does it pin the complete bearer digest in memory and
permit the first Player lookup. The same bearer must match for the remaining four lookups; wrong
identity, bearer drift, races, aborts, and malformed responses are sticky-fatal. A later run may
validate a fresh bearer for the same stable Profile because no bearer or refresh material is stored
in v3. The proxy validates
each lookup response against the requested Player and `ETB`, completes a token only after the browser
response finishes, and atomically publishes the canonical
`fetanagent-kemerbet-readiness-layer7-completion-v3` generic identifier-redacted completion receipt
with `version: 3` after all five. That receipt requires `sameAgentIdentityValidated: true`,
`stableAgentProfileValidated: true`, and the SHA-256 of the exact canonical binding-file bytes.
Controller and browser exit success is
insufficient without that exact receipt. Success and every failure path zero the proxy cache and
remove all seven transient containers, all three readiness networks, all runtime
capabilities/tokens/firewall files and output
directories, and the disposable snapshot volume. No endpoint, Amount field, Transfer action, or
financial switch is introduced by this proof.

#### Current v2-to-v3 stable-profile successor migration

The current runtime and recheck accept only this exact 230-byte binding, including LF:

```text
<canonical UUID> hmac-sha256-agent-identity-v1:<64-lowercase-hex> hmac-sha256-agent-profile-pin-v3:<same 64-lowercase-hex>
```

If the Droplet still holds the failed, never-committed v2 readiness source and completed historical
v1-to-v2 retirement, do not run ordinary deploy, helper replacement, rollback, a second v1
retirement, or a hand-edited conversion. Use only the reviewed root-console script
[`infra/operations/fetanagent-kemerbet-v2-v3-successor-migration.sh`](operations/fetanagent-kemerbet-v2-v3-successor-migration.sh).
The detailed invariants are also recorded in [`executor.md`](executor.md#current-v2-to-v3-stable-profile-successor-migration).

Independently review the predecessor and successor 40-character release SHAs, predecessor-helper
SHA-256, exact v2 binding SHA-256, successor-helper SHA-256, and the migration script itself. From
the exact successor commit, stage the script and
`fetanagent-staging-deploy-helper.next` in the root-owned mode-`0700` directory
`/root/fetanagent-v3-successor-<successor-release>/`; both files are public code artifacts, not
credentials, and the staged helper must be root-owned mode `0600`. Then use only the direct
DigitalOcean `root` console identity and the exact confirmation shown below:

```bash
bash "/root/fetanagent-v3-successor-$SUCCESSOR_RELEASE/fetanagent-kemerbet-v2-v3-successor-migration.sh" \
  "$PREDECESSOR_RELEASE" \
  "$SUCCESSOR_RELEASE" \
  "$PREDECESSOR_HELPER_SHA256" \
  "$V2_BINDING_SHA256" \
  "$SUCCESSOR_HELPER_SHA256" \
  I-UNDERSTAND-THIS-ARCHIVES-V2-AND-INSTALLS-THE-V3-SUCCESSOR
```

The script verifies the fixed Droplet and exact predecessor state, stops staging, takes the root
mutation lock, and disables the helper sudoers grant before creating or synchronizing any successor
namespace. It preserves the canonical root-owned v1 retirement
directory in place and creates a separate exact four-entry overlay that archives only the v2 binding
and predecessor helper with its intent/completion records. It deterministically replaces only the v2
bearer-digest field with the existing stable identity digest under the v3 Profile-pin label. It then
installs the exact successor helper, writes
durable intent/completion evidence under
`/var/lib/fetanagent/kemerbet-readiness-v2-v3-successor/`, reattests the exact v3 source, and restores
the sudoers grant. Transfer remains disabled and no money moves.

After migration, keep the executor stopped. `successor-installed` permits only the exact same-release
no-transfer deployment, private-sign-in, readiness-recheck, diagnostic, and safe-stop commands. Before
`install` may replace any sealed Compose, service-secret, or image input, the helper independently
requires a disarmed expiry guard, absent Telegram receipt, zero project containers and networks, no
recheck transient, exactly the two durable KemerBet volumes, and zero profile or session-control volume
holders; it reattests the same successor before and after that read-only preflight. Both install and
startup also require the `deposit-executor` image revision to match the reviewed release. Component
stops inspect v3 directly, use historical v1 state only when the successor overlay is absent, and
reattest the exact successor release and lifecycle state after teardown.

Perform a fresh private sign-in if the KemerBet session has expired, then run only the successor
release's exact-five no-transfer recheck. An interrupted promotion becomes
`successor-recheck-recoverable` and permits only exact-release recovery or safe teardown. Completion is
derived without writing a new overlay marker: the root-only `ready-v1` receipt, canonical root-owned v3
binding, and Owner completion record must agree, while the promotion journal, v3 source, one-use Player
file, candidate directory, and RPC directory must all be absent. This terminal `successor-completed`
proof no longer pins future helper upgrades to the historical successor-helper digest, but it
permanently blocks all legacy v1/v2 seal, retirement, and recovery commands. The script is resumable
only with the same six inputs. A no-prefix disabled-grant state is accepted only after exact
predecessor, stopped-project, retirement, and v2-source attestation; the script creates and
synchronizes its prefix only while the grant is disabled. After interruption, do not manually delete, rename, restore, or
rewrite anything; rerun the same reviewed script or inspect read-only. A completed rerun may reattest
only before the independent recheck consumes the v3 source and only while the original successor
helper remains installed. Do not rerun this migration after `successor-completed` or a later approved
helper rotation.

#### One-use installed-v3 helper/release rotation

While the v3 source is still `successor-installed`, an approved helper repair cannot use ordinary
deployment: the immutable base overlay pins release
`de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3` and helper SHA-256
`e94dfdcfe90ff6021446fc66e2850ae13198b03d9e2210f454181ab00177f97d`. Use only the reviewed
root-console operation
[`infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation.sh`](operations/fetanagent-kemerbet-v3-successor-helper-rotation.sh).
The script itself hard-pins the reviewed successor-helper SHA-256; the supplied digest must equal
that constant. The successor release remains an exact 40-character merged-`main` input because a
commit cannot contain its own Git SHA.

From the exact successor checkout, place the public script and the LF-exact successor helper in
root-owned mode-`0700` directory
`/root/fetanagent-v3-helper-rotation-<successor-release>/`; the helper filename must be
`fetanagent-staging-deploy-helper.next`, root-owned mode `0600`. Review its SHA-256 independently,
then run from the direct DigitalOcean root console:

```bash
bash "/root/fetanagent-v3-helper-rotation-$SUCCESSOR_RELEASE/fetanagent-kemerbet-v3-successor-helper-rotation.sh" \
  "$SUCCESSOR_RELEASE" \
  "$SUCCESSOR_HELPER_SHA256" \
  I-UNDERSTAND-THIS-APPENDS-ONE-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED
```

The operation verifies the fixed Droplet, frozen predecessor helper, complete immutable base
successor and retirement evidence, v2-to-v3 account/HMAC continuity, exact installed v3 source,
disarmed expiry guard, absent Telegram receipt and recheck transients, zero project containers and
networks, and exactly two holder-free Compose-5 durable volumes including their lower-case config
hashes. It uses the existing root mutation lock and disables the exact deployment sudoers grant
before publishing any rotation namespace or changing helper bytes.

The base four-entry successor directory and canonical retirement directory are never changed. One
new root-owned append-only record under
`/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation/<successor-release>/` contains exact
intent/completion files and a read-only archive of the frozen predecessor helper. The records bind
both releases, both helper digests, the SHA-256 of every base successor artifact, the exact durable
volume identity digest, both lower-case Compose config hashes, and the exact Compose version. The
operation freezes those volume values under the mutation lock, recomputes them at every later
checkpoint, and rejects recreated same-name volumes or changed volume metadata on same-input
resume. Only that exact completed chain changes the helper inspector's effective release and helper
identity. An absent record keeps the base identity; an intent-only, `.installing`, foreign, or
malformed record is invalid to the new helper.

The operation is resumable only with the same successor release, hard-pinned helper digest, and
staged bytes. Exact empty-parent and partial-record crash points are resumable only while the grant
remains disabled. Before completion, a failure can atomically restore only the archived frozen
helper, but it never restores sudo; rerun the same inputs. After the final record is published, any
self-attestation or grant-restoration failure also leaves sudo disabled and requires the same-input
rerun. Grant restoration prevalidates the disabled file and complete sudoers configuration; if
directory synchronization, active-file validation, or final `visudo` fails after the rename, it
atomically moves the same exact grant back to the disabled path. Do not delete a prefix, remove an
installer residue, restore sudo manually, or start the runtime while recovery is pending.

After completion, `successor-installed` returns the effective repair release so ordinary sealed
install, private sign-in, and exact-five recheck bind that release. If the recheck later becomes
`successor-completed`, `ready-v1` must also name this effective release. Terminal completion still
does not pin the live helper digest, so a later separately approved ordinary helper upgrade does not
invalidate durable completion; all legacy v1/v2 commands remain permanently forbidden. This
rotation never starts `deposit-executor`, enables a financial flag, invokes Transfer, or moves money.

#### One-use second installed-v3 helper/release rotation

The first helper-rotation record is immutable and remains the only child of
`/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation`. If a later approved repair is required
while the effective v3 state is still `successor-installed`, do not repin or rerun the first
rotation. Use only the reviewed root-console operation
[`infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v2.sh`](operations/fetanagent-kemerbet-v3-successor-helper-rotation-v2.sh).
It separately hard-pins the immutable base release/helper and the exact completed first-link
predecessor release `8fe693b51b5426c3f358bba67519459161a0ebf9` with its reviewed helper digest.
The second successor release remains the exact merged-`main` 40-character input, while the script
hard-pins the LF-exact reviewed successor-helper digest.

From the exact second-successor checkout, place the public script and LF-exact helper in root-owned
mode-`0700` directory `/root/fetanagent-v3-helper-rotation-v2-<successor-release>/`. Name the helper
`fetanagent-staging-deploy-helper.next`, root-owned mode `0600`, and run only from the direct
DigitalOcean root console:

```bash
bash "/root/fetanagent-v3-helper-rotation-v2-$SUCCESSOR_RELEASE/fetanagent-kemerbet-v3-successor-helper-rotation-v2.sh" \
  "$SUCCESSOR_RELEASE" \
  "$SUCCESSOR_HELPER_SHA256" \
  I-UNDERSTAND-THIS-APPENDS-SECOND-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED
```

This transaction validates the immutable base and the exact completed first link before it accepts
the current helper. It requires the stopped, disarmed, no-transient boundary, an absent Telegram
startup receipt, zero project containers and networks, and the same two holder-free durable volumes,
config hashes, and Compose version frozen by the first link. It also rejects every first-rotation
sudoers, installer, and rollback residue. The script moves and synchronizes the exact deployment
grant to its separate v2 disabled path before it creates the second namespace or publishes any
record.

The new append-only record lives only at
`/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v2/<successor-release>/`. Its intent and
completion bind both effective identities, every immutable base digest, the exact SHA-256 values of
the first intent, completion, and archived helper, and the unchanged durable-volume contract. The
new helper first validates the base, then the exact first link, and only then this second link; a v2
namespace without a complete first link, any `.installing` or foreign child, or any changed
predecessor/durable digest is invalid.

The installed first-link helper intentionally does not know the v2 namespace. Containment during a
pre-install interruption therefore depends on the already-stopped runtime and the durably disabled
deployment grant. Never restore sudo manually, call the old helper directly, delete or rename either
rotation prefix, or remove installer residue. An empty-parent or partial-record recovery accepts only
the same successor release, reviewed helper bytes, exact confirmation, and disabled grant. A failure
never restores sudo. Before completion it may atomically restore only the archived exact predecessor
helper; after completion it preserves the successor. Rerun the same operation until successor
self-attestation and the one final fail-closed grant restoration both succeed.

This second rotation does not start a service, enable the executor, invoke a KemerBet lookup or
Transfer, or move money. After it succeeds, use the new effective release for ordinary sealed deploy,
private sign-in, and the exact-five no-transfer recheck.

#### Current incident order: recover, rotate, deploy, then recheck

For the live `candidate_bound` incident pinned in the root-recovery subsection below, the order of
subsections in this historical runbook is not the execution order. Execute exactly these four steps:

1. Complete the one-use root-certified `candidate_bound` recovery. It leaves the runtime stopped.
2. While the runtime is still stopped, complete the one-use third installed-v3 helper/release
   rotation using the newly merged release.
3. Run the separately reviewed ordinary sealed deployment for core, Telegram Bot, and public HTTPS.
4. Only after those deployments pass their normal no-transfer health checks, open private KemerBet
   sign-in if needed and run the exact-five no-transfer recheck.

Do not run the third rotation before the root recovery, skip the third rotation after recovery, or
attempt sign-in/recheck while either one-use operation is incomplete.

#### One-use third installed-v3 helper/release rotation

The base successor and both completed helper-rotation records are immutable. For the reviewed
formatter-normalization repair, do not repin or rerun either consumed predecessor rotation. Use only
[`infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v3.sh`](operations/fetanagent-kemerbet-v3-successor-helper-rotation-v3.sh)
from the direct DigitalOcean root console. It hard-pins the exact second-link predecessor release
`4bb491943fb88c50b86166184b929bdbe2698dc4`, predecessor-helper SHA-256
`05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe`, and the LF-exact reviewed
successor-helper SHA-256. The successor release must be the exact 40-character merged-`main` commit.

From that checkout, place the public script and LF-exact helper in the root-owned mode-`0700`
directory `/root/fetanagent-v3-helper-rotation-v3-<successor-release>/`. Name the helper
`fetanagent-staging-deploy-helper.next`, root-owned mode `0600`, independently confirm its digest,
then run:

```bash
bash "/root/fetanagent-v3-helper-rotation-v3-$SUCCESSOR_RELEASE/fetanagent-kemerbet-v3-successor-helper-rotation-v3.sh" \
  "$SUCCESSOR_RELEASE" \
  "$SUCCESSOR_HELPER_SHA256" \
  I-UNDERSTAND-THIS-APPENDS-THIRD-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED
```

The operation validates the immutable base, exact first link, and exact second link before accepting
the installed predecessor helper. It requires the stopped, disarmed, no-transient boundary, absent
Telegram startup receipt, zero project containers and networks, and the same holder-free Compose-5
durable volumes, config hashes, and Compose version recorded by both prior links. It rejects all
first- and second-rotation sudoers, installer, and rollback residue. Only after taking the mutation lock and
rechecking that boundary does it move and synchronize the deployment grant to the distinct v3
disabled path; only then may it create the new parent or any record prefix.

The third append-only record lives only at
`/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v3/<successor-release>/`. It binds both
current identities, every immutable base digest, the exact SHA-256 values of the second-link intent,
completion, and archived helper, and the unchanged durable-volume contract. The successor helper
must validate the base, first link, second link, and third link in order before its effective release
or helper identity changes. A missing predecessor link, extra child, `.installing` prefix, changed
archive, changed durable field, or rewritten historical byte fails closed.

The installed second-link helper intentionally does not know the v3 namespace. Containment before
successor installation therefore depends on the already-stopped runtime and durably disabled grant.
Never restore sudo manually, call the predecessor helper directly, delete or rename any rotation prefix,
or remove installer residue. An empty-parent or partial-record resume accepts only the same successor
release, reviewed helper bytes, exact confirmation, and disabled grant. Cleanup never restores sudo;
before completion it may atomically restore only the archived predecessor helper. Rerun the exact same
operation until the successor independently validates the full chain and the single final grant
restoration succeeds.

This third rotation does not start a service, enable the executor, invoke a KemerBet lookup or Transfer, or move money.
After it succeeds, use its effective release for ordinary sealed deploy, private sign-in, and the
exact-five no-transfer recheck.

#### One-use fourth installed-v3 helper/release rotation

Docker 28 reports inspected capability names with the canonical `CAP_` prefix. The reviewed helper
normalizes only those three read-only capability attestations; it does not change the permitted
capabilities, provider requests, or financial boundary. The base successor and all three completed
helper-rotation records remain immutable. Do not repin or rerun any consumed predecessor rotation.
Use only
[`infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v4.sh`](operations/fetanagent-kemerbet-v3-successor-helper-rotation-v4.sh)
from the direct DigitalOcean root console. It hard-pins the exact third-link predecessor release
`9c83821b4959f5ac52b0d642e476063ca7f3590e`, its historical helper digest, and the LF-exact reviewed
successor-helper digest. The successor release is the exact 40-character merged-`main` commit.

Export both artifacts from that exact Git commit. Place the rotation script and LF-exact helper in
the root-owned mode-`0700` directory
`/root/fetanagent-v3-helper-rotation-v4-<successor-release>/`. The script is root-owned mode `0700`;
the helper is named `fetanagent-staging-deploy-helper.next`, root-owned mode `0600`. Independently
compare the Git-blob helper digest, the script's hard pin, and the staged helper digest, then run:

```bash
bash "/root/fetanagent-v3-helper-rotation-v4-$SUCCESSOR_RELEASE/fetanagent-kemerbet-v3-successor-helper-rotation-v4.sh" \
  "$SUCCESSOR_RELEASE" \
  "$SUCCESSOR_HELPER_SHA256" \
  I-UNDERSTAND-THIS-APPENDS-FOURTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED
```

A fresh invocation may begin while the predecessor runtime is live. Before any evidence, sudoers,
or helper mutation, the script verifies the exact installed predecessor helper/release, invokes its
guarded stop, and proves the stopped boundary: zero project containers and networks, disarmed expiry
guard, absent Telegram startup receipt, no recheck snapshot or RPC transient, and exactly the same
two holder-free durable Compose volumes, config hashes, and Compose version frozen by the third
link. Helper replacement is forbidden until this proof succeeds. If the predecessor is already
stopped, the same proof is still required.

The operation validates the immutable base and exact first, second, and third links in order. It
rejects every predecessor disabled-sudoers, installer, partial-installer, and rollback residue.
Under the root mutation lock it disables and synchronizes the exact deployment grant, revalidates
the full three-link chain and stopped durable boundary, then appends only
`/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v4/<successor-release>/`. The exact intent,
completion, and predecessor-helper archive bind the third-link artifact digests, every immutable
base digest, both effective identities, and the unchanged durable-volume contract. The successor
helper advances its effective identity only after validating the complete four-link chain.

The installed third-link helper intentionally does not know the v4 namespace. While a v4 prefix is
empty or interrupted, containment depends on the already-stopped runtime and durably disabled
deployment grant. Never restore sudo manually, call the predecessor helper directly, delete or
rename any rotation prefix, or remove transaction residue. Rerun only the exact same v4 command with
the same release, digest, confirmation, and staged bytes. Pre-completion rollback can restore only
the archived predecessor helper and never restores sudo. Completed recovery preserves the successor
and restores the exact grant once only after direct successor `verify` and
`kemerbet-v3-successor-ready` both pass.

The existing completed root-certified candidate recovery and the current retryable exact-five
recheck failure/source/stage evidence are outside this namespace and must remain unchanged. Do not
clean, replace, or consume them during rotation. A successful v4 rotation leaves the runtime stopped,
both durable volumes holder-free, Transfer and the executor disabled, and makes no KemerBet request,
Telegram request, or money movement.

#### Current Docker 28 repair order: rotate, deploy, publish, then recheck

1. Merge the reviewed capability-prefix correction, v4 helper parser, rotation script, verifier, and
   this runbook into `main`; use that exact merged commit as the successor release.
2. Stage exact Git-blob bytes and complete the one-use fourth rotation above. Confirm the full
   four-link chain and new helper attest successfully while the runtime remains stopped.
3. Run and wait for the ordinary core `deploy-and-smoke` workflow for that exact release.
4. Run and wait for Telegram `activate-and-smoke` for the same release.
5. Run public-domain `inspect`; only after it succeeds, run public-domain `publish` and verify public
   health. Manually serialize this after Telegram because public-edge uses a different concurrency
   group.
6. Only then retry the same exact-five FIND-only no-transfer recheck. If and only if the retained
   KemerBet session has expired, use private sign-in first. Never enter Amount or Notes, click
   Transfer, credit an account, enable the executor, or move money.

Any v4 rotation failure after the grant is disabled must be resumed before deployment. Any recheck
failure must use its guarded same-release retry/recovery; do not manually remove its journal,
failed marker, source, stages, candidate, receipt, profile volume, or Docker resources.

#### One-use fifth installed-v3 helper/release rotation

Docker Engine 29 renders an unset typed `netip.Prefix` as the literal `invalid Prefix` when the old
Go-template IPAM projection stringifies `.IPRange`. The reviewed helper no longer uses that
projection. It reads one bounded `{{json .IPAM.Config}}` value and validates the exact IPv4 and IPv6
Subnet/Gateway pairs order-independently. A missing, JSON `null`, or empty `IPRange` is the only
accepted unset representation; every nonempty value, including the Go-template `invalid Prefix`
sentinel, fails closed. Auxiliary addresses must be missing, JSON `null`, or an empty object. This
normalization changes no subnet, gateway, capability, provider request, financial, or cleanup
boundary.

The base successor and all four completed helper-rotation records are immutable. Do not repin,
rewrite, remove, or rerun a consumed predecessor rotation. Use only
[`infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v5.sh`](operations/fetanagent-kemerbet-v3-successor-helper-rotation-v5.sh)
from the direct DigitalOcean root console. It hard-pins the completed v4 release and helper as its
direct predecessor, preserves every historical v1-through-v4 release/helper pin, and hard-pins the
LF-exact reviewed successor helper. The successor release must be the exact 40-character merged
`main` commit containing the v5 script, helper, verifier, and this runbook.

Export both artifacts from that exact Git commit. Place the public script and LF-exact helper in the
root-owned mode-`0700` directory
`/root/fetanagent-v3-helper-rotation-v5-<successor-release>/`. The script is root-owned mode `0700`;
the staged helper is named `fetanagent-staging-deploy-helper.next`, root-owned mode `0600`.
Independently compare the Git-blob helper digest, the script's reviewed-successor hard pin, and the
staged helper digest, then run:

```bash
bash "/root/fetanagent-v3-helper-rotation-v5-$SUCCESSOR_RELEASE/fetanagent-kemerbet-v3-successor-helper-rotation-v5.sh" \
  "$SUCCESSOR_RELEASE" \
  "$SUCCESSOR_HELPER_SHA256" \
  I-UNDERSTAND-THIS-APPENDS-FIFTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED
```

A fresh invocation may begin while the completed-v4 runtime is live. Before any evidence, sudoers,
or helper mutation, the script verifies the exact v4 predecessor helper and effective release,
invokes its guarded stop, and proves the stopped boundary: zero project containers and networks,
disarmed expiry guard, absent Telegram startup receipt, no recheck snapshot or RPC transient, and
the same holder-free durable Compose volumes and frozen configuration values recorded by v4. It
then validates the immutable base plus the exact first, second, third, and fourth links in order.
Every historical disabled-sudoers, installer, partial-installer, rollback, and partial-rollback path
must be absent before the new append-only transaction begins.

Under the root mutation lock, v5 disables and synchronizes the exact deployment grant and rechecks
the stopped boundary and full predecessor chain before installing any bytes. Its only evidence
namespace is
`/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v5/<successor-release>/`, containing the
exact `intent-v1`, `completed-v1`, and archived `predecessor-helper`. The new intent and completion
bind the v4 intent, completion, and helper-archive digests, every immutable base digest, the v4 and
v5 effective identities, and the unchanged Compose durable contract. The successor helper advances
the effective identity only after validating the complete five-link chain.

The installed v4 helper intentionally does not know the v5 namespace. While the v5 prefix is empty
or interrupted, containment depends on the stopped runtime and durably disabled grant. Never
restore sudo manually, invoke the predecessor helper outside the rotation, delete or rename any
rotation prefix, or remove transaction residue. Resume only the exact same v5 command with the same
release, digest, confirmation, and staged bytes. Pre-completion rollback may atomically restore only
the archived v4 helper and never restores sudo. Completed recovery preserves the v5 successor and
restores the exact grant once only after direct successor `verify` and
`kemerbet-v3-successor-ready` both pass.

The existing completed root-certified candidate recovery and retryable exact-five recheck
failure/source/stage evidence are outside v5 and must remain byte-for-byte unchanged. The confirmed
post-failure aggregate state has no helper cleanup defect: recheck transients and networks are
absent, the profile volume is holder-free, and the retryable evidence is mutually consistent.
Do not perform broad cleanup. A successful v5 rotation leaves the runtime stopped, both durable
volumes holder-free, Transfer and the executor disabled, and makes no KemerBet request, Telegram
request, or money movement.

#### Current Docker 29 repair order: rotate, deploy, publish, then recheck

1. Merge the reviewed Docker 29 JSON IPAM normalization, optional fifth-link helper parser, v5
   rotation script, verifier, and this runbook into `main`; use that exact merged commit as the
   successor release.
2. Stage the exact Git-blob script/helper bytes and complete the one-use fifth rotation above.
   Confirm the full five-link chain and successor helper attest while the runtime remains stopped.
3. Run and wait for the core `deploy-and-smoke` workflow for that exact release.
4. Run and wait for Telegram `activate-and-smoke` for the same release.
5. Run public-domain `inspect`; only after it succeeds, run public-domain `publish`, then verify
   public health. Serialize this after Telegram because public edge has a separate concurrency
   group.
6. Only then retry the same exact-five FIND-only no-transfer recheck. If and only if the retained
   KemerBet session has expired, use private sign-in first. Never enter Amount or Notes, click
   Transfer, credit an account, enable the executor, or move money.

Any v5 failure after the deployment grant is disabled must be resumed before core deployment. Any
recheck failure must use its guarded same-release recovery. Never manually delete or alter its
journal, failed marker, one-use source, Player stages, candidate, receipt, profile volume, or exact
Docker resources.

#### Historical audit record: v1-to-v2 retirement and recovery

The following v1 retirement, v2 reseal, expiry recovery, and provider-token rules are preserved only
as historical audit evidence. They must not be used to operate or recreate the v3 successor.

The obsolete two-field v1 identity binding cannot be upgraded in place. Its one-time transition is
available only through the `retire-v1-for-v2-reseal` mode of the manual `Staging private KemerBet
sign-in` workflow. Before running it, the user must independently review the exact existing v1 file
SHA-256, supply it as `confirm_v1_binding_sha256`, and explicitly type
`I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL`. Normal deploy, start, inspect,
seal, recheck, bot, and public-edge paths never invoke retirement automatically. The command is
bound to the same exact reviewed commit and failed exact-five claim. It first publishes a durable
root-owned intent and exact root-only archive, then consumes the obsolete file; it neither rotates a
provider credential nor contacts a financial endpoint.

Run the retirement only after the exact old file digest has been independently reviewed; the
workflow never reads the target file to derive that expected value:

```bash
gh workflow run staging-kemerbet-session-provision.yml --ref main \
  -f mode=retire-v1-for-v2-reseal \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha='<exact-40-lowercase-reviewed-main-commit>' \
  -f confirm_droplet_id=593344964 \
  -f confirm_v1_binding_sha256='<independently-reviewed-64-lowercase-v1-file-sha256>' \
  -f confirm_v1_retirement=I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL
```

Once an intent and archive establish pending retirement, a global gate blocks helper or release
replacement and every unrelated state-expanding command. Only an explicit same-commit retirement
resume, the private-session start/readiness/seal sequence required to produce v2, and safe teardown
or diagnostics are allowed. Repeat the trusted supervised sign-in/seal ceremony on that same
commit. The seal accepts only a canonical 230-byte v2 binding whose UUID and identity fingerprint
project to the exact archived v1 SHA-256; it then publishes a distinct
`resealed-awaiting-recheck` state. That state still blocks install, fresh start, helper or release
replacement, bot/public-edge expansion, and every unrelated mutation. Only the same-release
independent recheck and safe teardown or diagnostics may proceed.

The retirement gate unlocks only after the recheck commits the immutable canonical v2 binding and
exact root-only success receipt and revalidates their release, binding, identity-key, selector, and
v1-projection continuity. An intent-only, archived, installing, malformed,
`resealed-awaiting-recheck`, or receipt-incomplete state blocks both helper replacement and rollback
in the root-console runbook. Migration from v1 does not by itself require changing the provider
token. Any later provider-token rotation safely requires a new supervised v2 seal before recheck.

If the host-local expiry boundary removes runtime secrets while the retirement is pending or
`resealed-awaiting-recheck`, normal `deploy-and-smoke`, image/artifact transfer, Compose replacement,
helper `install`, `fresh-start`, bot activation, and public-edge activation remain blocked. Recover
only the exact same reviewed release through `Staging beta deploy and smoke` mode
`recover-v1-retirement-after-expiry`, with all other mode-specific inputs empty and this exact typed
confirmation:

```text
I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE
```

Supply that job's separate `confirm_v1_retirement_release_sha` as the exact 40-character release
recorded in the durable retirement intent. `confirm_main_commit_sha` still names the current reviewed
protected-`main` workflow commit; the recovery release may be an older commit after `main` advances.
The job requires the explicit release to be an ancestor of the current `GITHUB_SHA`, then obtains the
expected helper, runtime-role provision SQL, and runtime-role disable SQL as canonical LF blobs with
`git show <release>:<fixed-path>`. It SHA-verifies the installed helper against that release blob and
passes the explicit release to every remote helper command, where the durable intent independently
requires exact equality. It never computes or substitutes the retirement release from the current
workflow commit.

Before creating the 23-file bundle, making any remote mutation, uploading a path, or enabling a
database role, the job verifies the installed helper against that historical helper SHA-256 and
calls only its read-only `kemerbet-v1-retirement-recovery-ready <explicit-release>` command. That
preflight independently requires the exact durable intent release and current context, the fully
expired zero-runtime boundary, pinned release assets, installed helper identity, and either a clean
initial boundary or an exact helper-recognized safe-to-reset crash residue. A wrong-but-ancestral
release, malformed residue, or foreign residue fails before any rollback flag is armed or staging
state changes. Only after a safe result does the job arm rollback, run the historical disable SQL,
invoke the SHA-verified helper `stop`, and call the same read-only preflight a second time. The second
result must be exactly clean before local bundle creation, remote staging, upload, or role
provisioning can begin. The stop discards only an incomplete temp-only binding prefix. A complete
230-byte temp must first project to the archived v1 identity; normalization atomically hard-links it
to the absent final name, removes the temp link, synchronizes the directory, and reattests the same
inode, single link, and content. For an exact final-plus-same-inode-temp crash, it removes only the
temp link and preserves the final v2 artifact. The preserved final is offline-finalized to
`resealed-awaiting-recheck` before the clean result.

```bash
gh workflow run staging-beta-deploy-smoke.yml --ref main \
  -f mode=recover-v1-retirement-after-expiry \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha='<exact-current-reviewed-main-workflow-commit>' \
  -f confirm_droplet_id=593344964 \
  -f confirm_v1_retirement_release_sha='<exact-40-character-release-from-retirement-intent>' \
  -f confirm_v1_retirement_recovery=I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE
```

The dedicated job has no build dependency and cannot transfer an image tar or Compose file. After
the two read-only preflights and safe reset, it validates the exact real `fetanagentbot` token and
approved token fingerprint, then creates only this 23-file bundle. It uploads the files only to a
run-unique deploy-user-owned mode-`0700` staging directory, captures that directory's device/inode,
and marks only that identity as owned by the run. A descriptor-relative atomic no-replace rename
publishes the exact
`/tmp/fetanagent-kemerbet-v1-retirement-secrets-<40-lowercase-hex-release>` path and synchronizes
`/tmp`; the fixed incoming path and `.consumed` successor must both have been absent. Every file is
mode `0600` and the helper accepts no extra name:

```text
api-action-capability-hmac
api-action-payload-hmac
api-action-semantic-hmac
api-action-transport-hmac
beta-database-url
beta-payload-hmac
beta-transport-hmac
bot-action-transport-hmac
bot-token
bot-transport-hmac
cbe-deposit-reference-encryption-key
cbe-deposit-reference-fingerprint-key
cbe-deposit-reference-key-profile.v1.json
customer-web-database-url
customer-web-publishable-key
customer-web-rate-limit-hmac
deposit-proof-reference-encryption-master
deposit-proof-reference-fingerprint-master
deposit-proof-reference-profile.v2.json
owner-database-url
player-action-database-url
publishable-key
supabase-ca.crt
```

After publication, the job provisions fresh 24-hour narrow database roles, then calls only
`reinstall-kemerbet-v1-retirement-secrets` for that release. Its required runtime order is exact
private-core `start`, `arm-expiry-stop` at the derived time, `start-bot` and `bot-ready`, then
`start-public-edge` and `public-edge-ready`. Any attempted upload or helper mutation arms an EXIT
guard first. Failure SHA-verifies the installed helper and calls `stop`; any attempted role
provision or reset also runs the disable SQL. Independent remote cleanup is disabled until the run
has captured the staging directory's device/inode. It thereafter accepts only that same identity at
the exact run-unique staging, incoming, or atomic `.consumed` path, validates a partial or complete
subset of those 23 regular mode-`0600` files without printing a name or value, removes the safe exact
directory, and attests all three paths absent. A preflight failure never deletes pre-existing
residue. Simultaneous paths, a different inode, symlink, extra name, wrong owner/mode/type, or
teardown failure makes the job fail closed.

Before secret reinstall, the helper accepts exactly two durable labeled project volumes:
`fetanagent-staging-beta_kemerbet_sessions` and
`fetanagent-staging-beta_kemerbet_session_control`. Both must use the exact `local` driver and scope,
null options, exactly the project/Compose-version/volume labels with one shared canonical Compose
version, canonical `/var/lib/docker/volumes/<exact-name>/_data` mount paths, UID/GID `10001:10001`
mode-`0700` roots, and zero container holders. The staged failed exact-five cohort and its
single-account profile identity are re-attested from those volumes. A third project volume, any
readiness snapshot/RPC/output volume, transient container or network, unexpected label/option,
noncanonical mount path, holder, or cohort/profile mismatch blocks recovery.

After recovery, exact pending retirement may resume the same-release private-session
start/readiness/seal sequence. `resealed-awaiting-recheck` must not start another private session;
it proceeds directly to only the same-release independent recheck and safe teardown/diagnostics.
Normal mutations unlock only after the immutable final v2 binding and exact success receipt prove
binding, key, selector, release, and v1-projection continuity.

#### Current shared readiness controls

The trusted Layer-7 proxy is part of the trusted computing base. A proxy RCE or proxy-process
compromise is outside this fail-closed guarantee: the proxy terminates KemerBet TLS, necessarily sees
the current bearer and Player identifier, and owns the only egress route, so compromise could bypass
the reviewed Layer-7 policy. Operation therefore depends on the pinned, reviewed image and source,
plus the documented privilege, network, mount, and lifecycle isolation around that proxy.

The two Owner stages and the private socket remain in the service-owned read/write
`kemerbet_session_control` volume. Aggregate finals and their hidden installers live only in the
fixed host directory `/var/lib/fetanagent/kemerbet-readiness-cohort-receipts`. Before the feature's
first installation, the parent and receipt root may both be genuinely absent. Read-only recovery-latch
inspection treats that exact non-symbolic absence as no latch only after proving `/`, `/var`, and
`/var/lib` are canonical `root:root` directories with exact mode `0755`; an absent receipt root below
an already installed safe parent has the same narrow meaning. A dangling symlink, regular file,
unexpected owner or mode, malformed directory, or any existing latch remains unsafe and fails closed.
Once installed, every directory through `/var/lib/fetanagent` and the receipt root is canonical,
non-symbolic `root:root` mode `0755`, so no service-writable ancestor can rename the boundary. Owner
sees that directory only at
`/run/fetanagent-kemerbet-readiness-cohort-receipts` through an exact read-only bind with implicit
host-path creation disabled. Host DAC and the read-only mount therefore prevent UID 10001 from
creating, unlinking, renaming, hard-linking, symlinking, or replacing a receipt or its directory;
the helper is the only receipt publisher. All six legacy aggregate final/installer names must be
absent from the Owner-writable session-control volume. The root-only detailed `ready-v1` receipt
and promotion journal are never mounted into Owner. The helper preserves the root directory inode
across stop/restart and never renames, removes, or recreates it while it can be bind-mounted.

The exact crash-recovery topology is:

- Before import, `kemerbet-readiness-player-ids.stage-v1` and
  `kemerbet-readiness-cohort-claim.stage-v1` are each UID/GID `10001:10001`, mode `0400`, and
  link-count one. The sidecar is exactly one lowercase UUID plus LF.
- The root journal `/var/lib/fetanagent/kemerbet-readiness-recheck-promotion/pending-v1` binds that
  UUID, both source device/inode identities, and the exact Player-stage SHA-256 before either source
  changes. That digest stays inside the root-only journal and helper process; it is never printed,
  logged, returned to the app, copied into an aggregate marker or public receipt, placed in a child
  process argument/environment, or exposed through `/proc/*/cmdline`. Descriptor helpers receive it
  only through an inherited root-process file descriptor. Import freezes
  both sources at `root:root`, mode `0444`, link-count one, durably prepares the private Player input,
  then publishes `kemerbet-readiness-cohort-imported-v1` as `root:10001`, mode `0440`, link-count
  one. Every freeze, promotion, restore, consume, and recovery step revalidates the journaled Player
  digest through an exact `O_NOFOLLOW` descriptor. During committed consumption recovery, imported
  may coexist with either frozen source already absent; it never makes a financial action live.
- A retryable failure restores both exact source inodes first to `10001:10001`, mode `0400`, removes
  imported, and publishes matching `kemerbet-readiness-cohort-failed-v1` last. The database claim
  stays active/exported and all claim source writes stay frozen; failed is not terminal.
- Success keeps the canonical candidate, sealed binding source, internal Player file, and both
  frozen Owner stages intact while it re-proves the reviewed release and image, exact profile digest,
  fresh no-transfer bot runtime, zero profile-volume holders, exactly one Owner-control stage
  producer, and no readiness controller/browser/proxy or offline helper container, static readiness
  network, runtime-input directory, completion-output directory, or disposable snapshot volume.
  Only then does it seal the root-only
  no-transfer receipt at `/var/lib/fetanagent/kemerbet-readiness-recheck/ready-v1`; that receipt plus
  the canonical binding and digest-bound journal is the durable success authority. Committed cleanup
  validates each exact open descriptor, unlinks its fixed pathname, synchronizes the parent
  directory, proves the pathname absent, and only afterward may best-effort wipe the already-unlinked
  descriptor. It never overwrites a reachable source. The helper re-proves the complete current
  release/image/profile/runtime/no-holder/singleton/no-transient boundary before publishing matching
  `kemerbet-readiness-cohort-completed-v1`, re-proves it again after publication, and retires the
  journal last. Completed therefore has no stage-file residue. If the host stops after any unlink,
  the receipt, canonical binding, journaled digest, and durable pathname absence reconstruct this
  same completed topology rather than retrying the browser probe.

Every aggregate marker contains only the same UUID plus LF and uses a fixed hidden installer that
the root journal can resume safely. On retry cleanup, the journal-authorized guard rejects any
completed installer/final, but normalizes an exact imported/failed crash prefix: an exact partial
single-link installer is removed durably, while an exact two-link installer/final pair is reduced to
its validated final before stage restoration continues. An installer conflict, foreign UUID,
non-prefix content, symlink, unexpected hard link, unexpected owner/mode, or conflicting final marker
fails closed. Operators must not print a stage file, marker UUID, journal digest, or binding digest
during recovery.

Every stop-family helper command (`stop`, systemd-only `expiry-stop`, `stop-bot`,
`stop-kemerbet-session-provision`, and `stop-public-edge`) first validates its own arguments under
the global mutation lock. Before any journal, candidate, stage, or aggregate-marker recovery
mutation—or even creation of the latch installer—the helper first proves the exact Owner container
is running with the protected receipt root mounted at the reviewed destination read-only and that no
foreign container bind overlaps any ancestor or descendant of that root. Only then does it
atomically publish and fsync the fixed root-owned
`kemerbet-readiness-recovery-in-progress-or-failed-v1` write-ahead latch in the protected receipt
root. The exact latch is `root:root`, mode `0400`, link count one, fixed non-sensitive content, and
has a fixed crash installer with the same contract. Only the creating process, bound to that exact
latch device/inode under the mutation lock, may call recovery marker transitions. The latch is
removed and the receipt root fsynced only after recovery returns success, the promotion root is
absent, and one explicit retired outcome is independently rechecked: the full committed receipt and
binding boundary, the exact journal-derived retryable stage/failed-marker/source/key boundary, or an
exact pre-journal/no-mutation boundary for an empty promotion root or one fixed journal temporary.
Immediately before the latch unlink transaction, the helper re-proves that same live Owner,
read-only mount, and no-overlapping-holder boundary; any liveness or holder change leaves the latch
in place for manual remediation. Retirement is invoked through a Bash `||` error boundary, so the
retirement function and every nested committed/retryable/pre-journal, control-volume, marker,
singleton, and service-access validator explicitly propagate nonzero status before the unlink
subprocess can start; they never rely on inherited `errexit` behavior.
A crash, recovery failure, unsafe latch, or latch-removal failure leaves the latch (or its fail-closed
installer) as a permanent manual-remediation guard. Explicit recheck, Owner
preparation/reconciliation, every marker entry point, and every state-expanding helper command refuse
a pre-existing or malformed latch.

Latch-path presence alone is not treated as durable. Before emergency teardown the helper either has
a successful file-and-directory-fsynced publisher result or descriptor-revalidates and fsyncs the
fixed root-owned residue and its protected directory. If the protected receipt latch cannot be
published or durably re-proved, the helper may create only the fixed
`recovery-in-progress-or-failed-v1` fallback through its fixed hidden installer inside the exact
unchanged root-owned promotion journal directory. That fallback publisher holds and rechecks the
fixed `pending-v1` inode/content while it fsyncs the fallback file and directory. A partial fallback
is durably re-proved by no-follow descriptor identity before teardown. Neither fallback name matches
the journal temporary namespace, and generic promotion cleanup rejects either fallback before any
delete. Every recovery and aggregate-marker entry point rejects any exact, partial, or malformed
fallback, and no ordinary helper path removes it. If neither protected namespace can retain a
durable block, recovery and teardown both stop before any additional mutation.

If guarded recovery fails, the helper never performs another aggregate-marker transition and does
not further mutate or delete the remaining aggregate markers, detailed receipt, candidate/stages, or
other recovery evidence; the promotion journal/root and write-ahead latch remain to block restart.
Regardless of which stop-family command was requested, it independently attempts full-project
emergency container/network removal and deletion of every disposable credential, token, and startup
receipt, then best-effort disarms expiry. It verifies the full project runtime and those disposable
secrets absent, emits a fixed redacted error, and returns nonzero after all cleanup attempts; cleanup
failures are accumulated so an early Docker error cannot skip credential deletion. Repeating any
stop-family command sees the durable latch before recovery, skips all readiness mutation, and repeats
only full-project emergency cleanup—even if a prior Docker failure left Owner running. This state is
not a resumable completion and must remain stopped for manual root-certified terminal remediation.
No ordinary helper, install, discard, stop, recheck, or rollback path clears the failed latch. No
stopped-runtime or zero-Owner exception may publish, remove, or reclassify a root receipt.

### One-use root-certified `candidate_bound` recovery for release `4bb4919`

This recovery is step 1 of the mandatory current-incident sequence above. After it succeeds, go to
the one-use third installed-v3 helper/release rotation while the runtime remains stopped; do not go
directly from recovery to ordinary deployment.

This subsection applies only to the independently audited emergency-stopped state for full release
`4bb491943fb88c50b86166184b929bdbe2698dc4` and installed helper SHA-256
`05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe`. It is not a generic latch
reset. Use the reviewed
`infra/operations/fetanagent-kemerbet-candidate-bound-root-recovery-v1.sh` and
`infra/operations/fetanagent-kemerbet-candidate-bound-root-recovery-v1.py` only from the DigitalOcean
root console. The operation adopts the exact existing latch device/inode into append-only root
evidence; it never deletes, replaces, or bypasses an unrecognized latch.

Before staging the two files, independently prove that the live state still matches the recorded
incident: the exact `candidate_bound` `pending-v1` journal and imported marker plus root latch exist;
the detailed recheck receipt, candidate, canonical binding, runtime, transient networks, RPC root,
bot startup receipt, expiry units, and disposable runtime secrets are absent; only the two exact
durable volumes and the one holder-free disposable readiness snapshot volume remain. Do not print a
Player ID, UUID, journal, binding, stage file, marker, digest derived from private content, secret,
balance, or transaction. Do not log in to KemerBet or attempt another lookup during recovery.

Stage exactly these two reviewed LF artifacts in the otherwise-empty root-owned mode-`0700`
directory
`/root/fetanagent-candidate-bound-recovery-4bb491943fb88c50b86166184b929bdbe2698dc4`.
Install the shell file as `root:root` mode `0700` and the Python file as `root:root` mode `0600`.
Before execution, compare their SHA-256 values with these reviewed values and run their local syntax
checks:

```text
fetanagent-kemerbet-candidate-bound-root-recovery-v1.sh  ede67ec49a82a87eb3298f0f93fe51a140fceebe673e2af5ddd868e772558552
fetanagent-kemerbet-candidate-bound-root-recovery-v1.py  206945947823be1db0657aa731a081dbbfdc349d3b76b8560ef2d6c5e94ce4ed
```

From that exact root directory, invoke only:

```bash
./fetanagent-kemerbet-candidate-bound-root-recovery-v1.sh \
  4bb491943fb88c50b86166184b929bdbe2698dc4 \
  05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe \
  I-UNDERSTAND-THIS-ADOPTS-THE-EXACT-FAILED-LATCH-AND-RECOVERS-NO-TRANSFER
```

Under the existing global mutation lock, the wrapper re-proves the exact Droplet, installed helper
and sudo grant, zero helper processes, stopped project, absent transient/runtime material, and exact
holder-free volumes. The Python transaction first archives the exact promotion journal and binds
the imported marker plus adopted latch identities. It then records the validated snapshot-volume
contract before the wrapper removes only
`fetanagent-staging-beta-kemerbet-readiness-profile-snapshot-once` through Docker. A retry after that
single removal is accepted only with this durable authorization record. No `prune`, project-wide
volume removal, filesystem deletion of Docker data, container start, network creation, provider
request, executor enablement, or Transfer action exists in this operation.

After snapshot removal, the filesystem transaction consumes only the journal-bound private Player
copy if it still exists, restores the exact key and two stage inodes, removes the exact imported
marker, and publishes the matching failed marker last. It independently proves that retryable
boundary before publishing `retryable-v1`, removes only the now-archived promotion journal/root,
re-proves the boundary, then retires only the adopted latch inode and publishes `completed-v1`.
The private archive and all authorization/completion evidence remain root-only at
`/var/lib/fetanagent/kemerbet-candidate-bound-root-recovery-v1/4bb491943fb88c50b86166184b929bdbe2698dc4`.
If any check fails, do not remove a latch, marker, journal, volume, stage, or evidence file manually;
keep the host stopped, diagnose read-only, and rerun these same reviewed bytes only after the exact
precondition is restored.

Successful recovery deliberately leaves the public/core containers stopped and all disposable
runtime secrets absent. It does not deploy or restart FetanAgent. Before any ordinary deployment,
complete the one-use third installed-v3 helper/release rotation from the newly merged release while
this stopped boundary is intact. Then run the separately reviewed ordinary deployment to restore the
public web/API/Owner/Bot runtime. That deployment must independently pass its normal no-transfer
preflights before any private sign-in or exact-five KemerBet readiness recheck.

An active database cohort claim intentionally freezes writes to every table from which its cohort
was derived, including otherwise unrelated customer/platform writes. That freeze begins before
export and remains through `prepared`/`exported`, an interrupted import, and retryable `failed-v1`.
It never auto-expires. Only reconciliation of the root-owned `completed-v1` marker may advance the
claim to success; only a separately reviewed root-certified terminal cleanup may release the frozen
membership. Operators must treat any active claim whose aggregate age exceeds the current
readiness-maintenance window as a stale-claim alert: check the authenticated Owner status card and
the root promotion journal/aggregate markers, then resume recovery. Never delete a claim, marker,
journal, or source-table lock merely because it is old, and never query or copy Player identifiers
for diagnosis.

The two singleton proofs are intentionally separate. Exactly one `owner-control` container is the
only accepted producer of the staged pair and the sole container allowed to hold the aggregate
receipt bind; the helper proves its exact host source, container destination, and `RW=false` before
every receipt transition. It resolves every inspected bind source to a canonical host path before
checking overlap, explicitly treating host `/`, every receipt-root ancestor, the root itself, and
every descendant as overlapping; an unresolved source or any overlapping non-Owner bind fails
closed. Docker mount inventories are inspected one exact container at a time so the CLI's per-object
separator newline—including for a container with no binds—can never become an ambiguous empty mount
record; only nonempty outputs reach the strict four-field classifier. While the private session
container is live, the helper
also proves that `/var/lib/fetanagent/kemerbet-sessions` is mounted from the exact
`fetanagent-staging-beta_kemerbet_sessions` volume and that this container is its sole holder; the
holder set must be empty before and after the isolated recheck. Chromium singleton artifacts are
checked only inside the exact account directory (`$profile_mountpoint/$account_id/Singleton*`),
never at the profile-volume root. The holder-free proof and both final root/profile metadata reads
explicitly propagate failure through command substitution before hashing; no blank metadata field or
failed holder inventory can still produce an accepted 64-hex identity digest. These checks do not
read balance or transaction history and do not change any provider state.

## External secret files

No secret value belongs in this repository, an `.env` file, a Compose environment value, an image,
or a command line. The operator must provide twenty service-separated secret files, two
independently approved immutable nonsecret profile files, and one verified public CA file outside
the checkout:

| Host-path selector                                                   | Mounted only into                | Container path                                                                            |
| -------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE`                 | owner-control                    | `/run/secrets/owner_control_database_url`                                                 |
| `FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE`     | owner-control                    | `/run/secrets/owner_control_supabase_publishable_key`                                     |
| `FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE`                | beta-admission                   | `/run/secrets/beta_admission_database_url`                                                |
| `FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE`              | beta-admission                   | `/run/secrets/beta_admission_bot_transport_hmac`                                          |
| `FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE`                | beta-admission                   | `/run/secrets/beta_admission_payload_hmac`                                                |
| `FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE`                 | api                              | `/run/secrets/player_action_database_url`                                                 |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE`           | api                              | `/run/secrets/api_player_action_transport_hmac`                                           |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE`             | api                              | `/run/secrets/api_player_action_payload_hmac`                                             |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE`          | api                              | `/run/secrets/api_player_action_capability_hmac`                                          |
| `FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE`            | api                              | `/run/secrets/api_player_action_semantic_hmac`                                            |
| `FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE`       | api                              | `/run/secrets/cbe_deposit_reference_encryption_key`                                       |
| `FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE`      | api                              | `/run/secrets/cbe_deposit_reference_fingerprint_key`                                      |
| `FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE`          | api                              | `/etc/fetanagent/cbe-deposit-reference-key-profile.v1.json`                               |
| `FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE`  | api, customer-web, owner-control | proof-v2 path; Owner target is `/run/secrets/owner_receiver_reference_encryption_master`  |
| `FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE` | api, customer-web, owner-control | proof-v2 path; Owner target is `/run/secrets/owner_receiver_reference_fingerprint_master` |
| `FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE`            | api, customer-web, owner-control | `/etc/fetanagent/deposit-proof-reference-profile.v2.json`                                 |
| `FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE`                    | all DB clients                   | `/run/configs/supabase_ca_certificate`                                                    |
| `FETANAGENT_STAGING_BOT_TOKEN_FILE`                                  | bot                              | `/run/secrets/telegram_bot_token`                                                         |
| `FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE`                         | bot                              | `/run/secrets/bot_beta_admission_transport_hmac`                                          |
| `FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE`           | bot                              | `/run/secrets/bot_player_action_transport_hmac`                                           |

The separately started `kemerbet-session-provision` profile uses four fixed, non-substitutable host
paths for its one-time no-transfer proof: mode-`0400` UID/GID-`10001` identity-key and exact-five
Player files under `/etc/fetanagent/executor-secrets`, the root-owned mode-`0444` reviewed selector
at `/etc/fetanagent/executor-config/kemerbet-selector-contract.v2.json`, and the UID/GID-`10001`
mode-`0700` output directory `/var/lib/fetanagent/kemerbet-readiness-seal-output`. The first three are
read-only mounts. The output directory is the only added writable bind, may contain only the
atomically created mode-`0600` binding file, and is never mounted into Owner control.

The two transport-HMAC files must contain the same independently generated 32-byte lowercase-hex
value, but they are intentionally separate host files and separate mounts. The bot cannot read the
beta service's copy and the beta service cannot read the bot's copy. Each database URL is visible
only to its owning service; the payload HMAC is beta-service-only, and the Telegram token is
bot-only. The CBE encryption and fingerprint files contain two distinct independently provisioned
32-byte lowercase-hex keys. Their version-1 profile is a separately approved nonsecret artifact
containing only the two `sha256:` key identities; ordinary deployment must never derive or replace
that profile from the current keys. Only the API receives the two version-1 key mounts and profile.
The provider-neutral v2 encryption and fingerprint roots are another two distinct independently
provisioned 32-byte lowercase-hex values. They must also differ from every password, HMAC, and v1
key. Their separately approved profile contains exactly `encryptionMasterFingerprint`,
`fingerprintMasterFingerprint`, and `version: 2`; ordinary deployment validates but never derives
or self-approves it. API and customer-web use the roots for proof v2. Owner control verifies the
same immutable root identities, then derives separate provider-bound receiver-account v1 keys; it
does not receive or use the proof-v2 protection routine.
Owner control is placed on a separate egress-capable bridge from the bot and admission service.

All four database URLs must use the staging project's exact IPv6 direct endpoint:
`db.spzpiyxheappsfyswewl.supabase.co:5432`, database `postgres`, and the bare dedicated username
`fetanagent_beta_admission_runtime`, `fetanagent_owner_control_runtime`, or
`fetanagent_player_actions_runtime`, or `fetanagent_customer_web_runtime`, with only
`sslmode=verify-full`. Session-pooler runtime URLs are rejected. GitHub workflows may continue using the IPv4 session pooler only for short-lived
administrator SQL because GitHub-hosted runners do not provide the VM's direct IPv6 path. Download
the staging project's CA from Supabase, verify its
fingerprint through the reviewed Supabase dashboard path, and provide that public certificate as
the CA file. Compose mounts it read-only and sets `NODE_EXTRA_CA_CERTS`; certificate verification
remains enabled.

Each secret source file must be owned by UID/GID 10001 and have mode `0400` before any container is
created. The public CA and both reference profiles must be owned by root, mode `0444`, and immutable
to the service account. All three configs are mounted as `0444`. The long Compose syntax repeats UID, GID, and
mode on every mount. Some non-Swarm Compose
implementations use a bind mount and may not enforce those attributes, so staging activation must
verify the source metadata and the mounted metadata rather than assuming the YAML changed it.

The application must support these exact file-valued variables before activation:

- beta-admission: `BETA_ADMISSION_DATABASE_URL_FILE`,
  `BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE`, and `BETA_ADMISSION_PAYLOAD_HMAC_SECRET_FILE`, with
  `NODE_EXTRA_CA_CERTS` fixed to the mounted verified CA path;
- bot: `TELEGRAM_BOT_TOKEN_FILE` and `BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE`;
- api: `PLAYER_ACTION_DATABASE_URL_FILE`, `BOT_TO_API_ACTION_HMAC_SECRET_FILE`,
  `API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET_FILE`,
  `API_TELEGRAM_CAPABILITY_HMAC_SECRET_FILE`, and
  `API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET_FILE`,
  `CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE`,
  `CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE`, and
  `CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE`, plus
  `DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE`,
  `DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE`, and
  `DEPOSIT_PROOF_REFERENCE_PROFILE_FILE` at their fixed production paths;
- bot additionally: `BOT_TO_API_ACTION_HMAC_SECRET_FILE`;
- owner-control: `OWNER_CONTROL_DATABASE_URL_FILE`,
  `OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE`,
  `OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER_FILE`,
  `OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER_FILE`, and
  `OWNER_RECEIVER_REFERENCE_PROFILE_FILE` at their fixed production paths. The Owner-specific
  names separate receiver rotation from the provider-proof runtime contract even though both
  domains are pinned to the same independently approved root profile. A Supabase service-role key
  is forbidden.
- customer-web: `CUSTOMER_WEB_DATABASE_URL_FILE`,
  `CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE`, and
  `CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE`, plus the same three provider-proof v2 file variables.
  `INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true` enables only the new proof
  intake; `INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false` keeps the older live deposit runtime
  disabled while Auth, workspace, and the durable limiter run against staging only.

If any adapter is absent or accepts both a direct value and file value simultaneously, deployment is
blocked. Do not work around that condition by copying secret contents into ordinary environment
variables.

## Static validation

The repository verifier reads only the Dockerfile and Compose YAML; it does not contact Docker,
Supabase, GitHub, Telegram, or the VM:

```powershell
node infra/verify-staging-beta.mjs
```

It enforces the five private-service topology, separately gated secret-free gateway, normally
absent no-transfer sign-in tool, pinned architecture and build targets, hardening settings,
isolated file-secret set and browser volumes, network separation, disabled generic action/provider
gates, and absence of the production ref.

Before any separately approved build, set `FETANAGENT_VCS_REF` to the reviewed full commit SHA and
`FETANAGENT_IMAGE_TAG` to a commit-derived immutable local tag. Render only from a sealed checkout
that contains no `.env`/`.env.*` file and from a cleared process environment with no inherited
direct secret variable. Supply only the two non-secret image selectors, twenty external secret-file
selectors, the two immutable profile selectors, and the verified public CA path selector explicitly.
The future render must disable Compose's implicit checkout `.env` loading:

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  FETANAGENT_VCS_REF=<reviewed-full-commit> \
  FETANAGENT_IMAGE_TAG=<commit-derived-tag> \
  FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE=<external-path> \
  FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE=<approved-immutable-profile-path> \
  FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE=<external-path> \
  FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE=<external-path> \
  FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=<approved-immutable-v2-profile-path> \
  FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE=<verified-external-path> \
  FETANAGENT_STAGING_BOT_TOKEN_FILE=<external-path> \
  FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE=<external-path> \
  FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE=<external-path> \
  docker compose --env-file /dev/null --profile staging-manual \
    -f infra/compose.staging-beta.yaml config
```

This renders configuration only. Do not use `docker compose up` without a new staging activation
approval.

## Guarded deployment workflow

Before the workflow can deploy, a separately approved maintenance window must enable DigitalOcean
IPv6 on the existing Droplet and configure the guest with its assigned address and default route.
That change requires a power cycle and is intentionally outside the deployment workflow; follow
[`operations/ipv6-direct-database-maintenance.md`](operations/ipv6-direct-database-maintenance.md).
The deployment helper fails before provisioning any runtime login unless the host has a global IPv6
address, an IPv6 default route, and resolves the exact direct staging database hostname.

An operator must also install the reviewed helper from the exact main
commit as `/usr/local/sbin/fetanagent-staging-deploy-helper` with `root:root` ownership and mode
`0755`. The dedicated `fetanagent-admin` account must be non-root, key-only, and granted
noninteractive sudo for that helper only. It must not receive `sudo bash`, direct `sudo docker`,
Docker-group membership, or Docker-socket access. The helper validates its own installed path,
ownership, invoking sudo identity, exact argument shapes, incoming file allowlist, image revision
labels, sealed service-file metadata, local Docker socket, and fixed Compose project. The workflow
checks its SHA-256 before every privileged operation, so an absent, stale, writable, or broader
helper fails closed.

An exact host that still carries the v2 successor-migration precondition is an exception to that
ordinary helper-install rule. Follow
[Current v2-to-v3 stable-profile successor migration](#current-v2-to-v3-stable-profile-successor-migration)
instead; the dedicated script installs the successor helper inside the same locked transaction that
archives v2 and creates v3.

### Historical audit record: exact v1/v2 helper replacement on the staging Droplet

This long-form replacement and rollback transcript is retained to explain the historical v1/v2
state and hashes. It is not the v3 migration runbook and must not be repinned or replayed for the v3
successor.

The VM-transition controller is permanently pinned to retired Droplet `590666364`; never run it on
current staging Droplet `593344964`. The current Droplet uses a separate, bounded root-console helper
replacement. Before publishing a commit that changes the helper, run `stop-and-disable` from the
currently deployed reviewed commit so the containers are stopped and all four disposable database
logins are disabled. Keep the runtime offline throughout replacement.

If that predecessor cleanup boundary was missed before `main` advanced, do not rotate over the
running project and do not make the successor helper accept the predecessor. The bounded recovery
mode `predecessor-stop-and-disable` remains pinned only to the historical `022a9f10` predecessor
deployment; do not broaden or repin that workflow recovery mode during the current helper rotation.
It requires the additional typed confirmation `stop-current-staging-predecessor-runtime`, verifies
the installed helper against the complete pinned predecessor SHA-256, stops the fixed staging
Compose project, discards only the safe predecessor incoming directory for
`8f58ff06425160835c94801e564fa6f9066d0930`, and then runs the exact checksum-pinned normal
database-login disablement. It does not transfer a release, replace a helper, start a container,
change a network ban, initiate a new claim or recheck, or authorize a transfer. The predecessor's
guarded `stop` still inspects and, when necessary, recovers interrupted KemerBet promotion state; a
nonzero result blocks replacement even if emergency teardown made the host appear offline. The
database cleanup is unreachable unless the remote non-root identity and exact predecessor helper are
first proven; therefore the mode cannot disable successor runtime roles after helper rotation.

```bash
gh workflow run staging-beta-deploy-smoke.yml --ref main \
  -f mode=predecessor-stop-and-disable \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha='<exact-current-reviewed-main-commit>' \
  -f confirm_droplet_id=593344964 \
  -f confirm_legacy_stop=stop-current-staging-predecessor-runtime
```

The current helper rotation has one separate cleanup-recovery boundary because the installed helper
is exactly
`ecd47f5d6aff8cd955ed8b68d7313b79fde5547a6827743e1e5f1b0d1fca04be`, installed by exact release
`594ce9656311feabd062b6b6360a90ba5d7ee576`, and its normal cleanup was also missed before `main`
advanced. Use only the digest-named mode `ecd47f5d-predecessor-stop-and-disable` with the distinct
typed confirmation `stop-exact-ecd47f5d-staging-predecessor-runtime`. This mode is permanently pinned
to that helper, release, and the exact reviewed runtime-disable SQL checksum. It first proves the
non-root remote identity and exact installed helper, then stops the fixed Compose project and
discards only that release's safe incoming directory. An identity or helper-verification failure
prevents database cleanup. A stop or discard failure still disables the four disposable staging
database logins and then returns the original remote failure for operator review. It does not
transfer or install a release, replace a helper, start any service, change a network ban, prepare a
claim or recheck, authorize Transfer, or move money.

This is a one-use recovery boundary: dispatch it only while the installed helper still has the exact
`ecd47f5d…` digest and before helper replacement. After a successful dispatch, proceed to the
separately reviewed root-console replacement; never repin or reuse this mode for a later helper or
release. The historical `predecessor-stop-and-disable` mode above remains independently frozen to
`022a9f10…` plus `8f58ff06425160835c94801e564fa6f9066d0930`.

```bash
gh workflow run staging-beta-deploy-smoke.yml --ref main \
  -f mode=ecd47f5d-predecessor-stop-and-disable \
  -f confirm_staging_project_ref=spzpiyxheappsfyswewl \
  -f confirm_main_commit_sha='<exact-current-reviewed-main-commit>' \
  -f confirm_droplet_id=593344964 \
  -f confirm_legacy_stop=stop-exact-ecd47f5d-staging-predecessor-runtime
```

The current Droplet follows only the fresh-host commands (`fresh-host-ready`, `fresh-start`, and
`start-fresh-public-edge`). Those commands do not consume the retired Droplet's
`helper-rotation-v1` receipt. Do not create, copy, or update VM-transition receipts on Droplet
`593344964`; helper replacement and rollback there operate only on the exact checksummed helper
file and its root-only backup.

For this replacement only, the accepted predecessor and successor LF SHA-256 values are:

```text
installed_predecessor=ecd47f5d6aff8cd955ed8b68d7313b79fde5547a6827743e1e5f1b0d1fca04be
reviewed_successor=43b09de7356bc6237264d8f0b162b237e74c1a59c175a2dccced7ad5b77d6619
```

Extract the successor from a clean checkout of the exact reviewed `main` commit, verify it before
transfer, and stage those public script bytes through the root-console channel as the regular
`root:root` mode-`0600` file
`/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.next`. Do not accept another
predecessor digest, fetch a moving branch, or put any credential in that directory.

```bash
C1='<exact-40-lowercase-reviewed-main-commit>'
NEXT_SHA='43b09de7356bc6237264d8f0b162b237e74c1a59c175a2dccced7ad5b77d6619'
[[ "$C1" =~ ^[0-9a-f]{40}$ ]]
git show "$C1:infra/operations/fetanagent-staging-deploy-helper.sh" > fetanagent-staging-deploy-helper.next
test "$(sha256sum fetanagent-staging-deploy-helper.next | awk '{ print $1 }')" = "$NEXT_SHA"
bash -n fetanagent-staging-deploy-helper.next
```

At the DigitalOcean root console, use only the fixed paths and hashes below. The installed
predecessor and successor share the same root-owned mutation-lock contract. The block atomically
moves the exact sudoers grant to an ignored same-filesystem name, validates sudoers with the grant
absent, proves no process has the helper path as an argument, and acquires that mutation lock before
the checked temporary file is atomically renamed. Under that lock, its independent retirement
preflight accepts either a genuinely absent retirement root or the exact canonical intent/completion
pair plus the immutable post-recheck binding and success receipt with matching installed-helper
device/inode and SHA-256, release, binding, identity-key, selector, and v1-projection continuity. It rejects an empty root, intent-only state,
archive, installer, source-only v2 seal, extra entry, malformed record, or incomplete receipt. Thus
`resealed-awaiting-recheck` cannot be used to rotate the helper. The rollback block is stricter: the
predecessor cannot understand this migration, so any retirement-root presence makes rollback
ineligible in addition to its existing pre-recheck guard. The grant remains absent throughout replacement.
The exact grant is restored only after the installed successor is verified; the held successor lock
then excludes a new privileged invocation until this root-console block exits. A mismatch or an
in-flight helper aborts without replacing the helper, and the EXIT trap restores the exact grant.
The backup is accepted only after proving it is the exact predecessor. The same block is resumable
after `SIGKILL` or host restart: it accepts exactly one validated enabled/disabled grant, only the
predecessor or successor TARGET hash, and only an absent or exact predecessor backup; it then
re-establishes quiescence and either completes or verifies the successor before restoring sudo.

```bash
bash -euo pipefail <<'FETANAGENT_HELPER_REPLACE'
TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
STAGING_ROOT='/root/fetanagent-helper-rotation'
STAGED="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-ecd47f5d"
RETAINED_022_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-022a9f10"
RETAINED_D9CD_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-d9cdcdec"
RETAINED_526_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-5267906f"
RETAINED_121E_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-121e3b36"
RETAINED_AF823_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-af823251"
RETAINED_B466_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-b4664efd"
RETAINED_33F4_BACKUP="$STAGING_ROOT/fetanagent-staging-deploy-helper.previous-33f4a5a4"
SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.rotation-disabled'
MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
PREVIOUS_SHA='ecd47f5d6aff8cd955ed8b68d7313b79fde5547a6827743e1e5f1b0d1fca04be'
NEXT_SHA='43b09de7356bc6237264d8f0b162b237e74c1a59c175a2dccced7ad5b77d6619'
RETAINED_022_BACKUP_SHA='022a9f10335fb570efb7638e2029ce663525ed742296268471b4c3a444ada714'
RETAINED_D9CD_BACKUP_SHA='d9cdcdec53e0a408bc15b205f161fd19e3204ed8e81a32e5921342c2bfa867f7'
RETAINED_526_BACKUP_SHA='5267906f1b0fe07c8d4a2da05f2e101240a39ee8ab73cf323d4b41d7a30b6795'
RETAINED_121E_BACKUP_SHA='121e3b360fc8e68aacd87a6d6a39611d2e6005c347a782798a1204d85b42b5b4'
RETAINED_AF823_BACKUP_SHA='af823251e2374b77898c813f5f7fe74e78280b69ba89d0b1dd0901b8851c8833'
RETAINED_B466_BACKUP_SHA='b4664efdbe3297b7b0ddee8122bf431608571e84dd0987892f58c20f48bdb663'
RETAINED_33F4_BACKUP_SHA='33f4a5a4ba56fa86aa34cdc9a899117d327ed06a58b3cb5d7e9453c28afad5ba'
METADATA='http://169.254.169.254/metadata/v1'
INSTALL_TMP=''
BACKUP_TMP=''
INSTALL_TMP_PATH='/usr/local/sbin/.fetanagent-staging-deploy-helper.installing-43b09de7'
BACKUP_TMP_PATH="$STAGING_ROOT/.fetanagent-staging-deploy-helper.previous-ecd47f5d.installing"
SUDOERS_STATE=''
TARGET_SHA=''
expected_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}
require_exact_sudoers_file() {
  local path="$1"
  test ! -L "$path" && test -f "$path" || return 1
  test "$(realpath -- "$path")" = "$path" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$path")" = 'root:root:440:1' || return 1
  cmp -s -- "$path" <(expected_sudoers) || return 1
}
require_no_helper_processes() {
  local arg cmdline found
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    found='false'
    while IFS= read -r -d '' arg; do
      if [[ "$arg" == "$TARGET" ]]; then
        found='true'
        break
      fi
    done <"$cmdline" || true
    [[ "$found" == 'false' ]] || return 1
  done
}
require_kemerbet_v1_retirement_rotation_ready() {
  env -i PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
    python3 -I - "$TARGET" <<'PY'
import hashlib
import os
import re
import stat
import sys

TARGET = sys.argv[1]
ROOT = '/var/lib/fetanagent/kemerbet-readiness-binding-v1-retirement'
ROOT_INSTALLING = f'{ROOT}.installing'
INTENT = f'{ROOT}/intent-v1'
COMPLETION = f'{ROOT}/completed-v1'
SOURCE = '/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
FINAL = '/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
KEY = '/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key'
SELECTOR = '/etc/fetanagent/executor-config/kemerbet-selector-contract.v2.json'
RECEIPT_ROOT = '/var/lib/fetanagent/kemerbet-readiness-recheck'
RECEIPT = f'{RECEIPT_ROOT}/ready-v1'
PROMOTION = '/var/lib/fetanagent/kemerbet-readiness-recheck-promotion'
CANDIDATE = '/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate'
PLAYERS = '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
HEX = r'[0-9a-f]{64}'
DEV_INO = r'[0-9]+:[0-9]+'
BINDING = re.compile(
    rf'{UUID} hmac-sha256-agent-identity-v1:{HEX} '
    rf'sha256-provider-authorization-v1:{HEX}'
)


def reject():
    raise RuntimeError('unsafe KemerBet v1 retirement state blocks helper rotation')


def identity(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
            value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def exact_directory(path, owner, mode):
    try:
        before = os.lstat(path)
    except OSError:
        reject()
    if (not stat.S_ISDIR(before.st_mode) or (before.st_uid, before.st_gid) != owner
            or stat.S_IMODE(before.st_mode) != mode or os.path.realpath(path) != path):
        reject()
    return identity(before)


def exact_file(path, allowed_metadata, maximum, exact_size=None):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        before = os.fstat(descriptor)
        named = os.lstat(path)
        metadata = (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode))
        if (not stat.S_ISREG(before.st_mode) or identity(before) != identity(named)
                or before.st_nlink != 1 or metadata not in allowed_metadata
                or before.st_size > maximum or os.path.realpath(path) != path
                or (exact_size is not None and before.st_size != exact_size)):
            reject()
        chunks = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(65536, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                reject()
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if identity(before) != identity(after) or identity(after) != identity(named_after):
            reject()
        return b''.join(chunks), f'{before.st_dev}:{before.st_ino}'
    except OSError:
        reject()
    finally:
        if descriptor is not None:
            os.close(descriptor)


def exact_lines(raw, count):
    if (not raw.endswith(b'\n') or b'\r' in raw or b'\0' in raw
            or raw.count(b'\n') != count):
        reject()
    try:
        values = raw[:-1].decode('ascii').split('\n')
    except UnicodeDecodeError:
        reject()
    if len(values) != count or ('\n'.join(values) + '\n').encode('ascii') != raw:
        reject()
    return values


if not os.path.lexists(ROOT):
    if os.path.lexists(ROOT_INSTALLING):
        reject()
    raise SystemExit(0)
if os.path.lexists(ROOT_INSTALLING):
    reject()

root_identity = exact_directory(ROOT, (0, 0), 0o700)
try:
    entries = sorted(os.listdir(ROOT))
except OSError:
    reject()
if entries != ['completed-v1', 'intent-v1']:
    reject()

intent_raw, _ = exact_file(INTENT, {(0, 0, 0o600)}, 4096)
completion_raw, _ = exact_file(COMPLETION, {(0, 0, 0o600)}, 4096)
intent = exact_lines(intent_raw, 14)
completion = exact_lines(completion_raw, 16)
intent_patterns = [
    r'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1',
    r'state=retirement-authorized', r'release=[0-9a-f]{40}',
    rf'helper_dev_ino={DEV_INO}', rf'helper_sha256={HEX}',
    rf'legacy_binding_dev_ino={DEV_INO}', rf'legacy_binding_sha256={HEX}',
    rf'identity_hmac_key_dev_ino={DEV_INO}', rf'identity_hmac_key_sha256={HEX}',
    rf'claim_sha256={HEX}', rf'owner_stage_player_ids_dev_ino={DEV_INO}',
    rf'owner_stage_player_ids_sha256={HEX}', rf'owner_stage_claim_dev_ino={DEV_INO}',
    rf'release_asset_sha256={HEX}',
]
if any(re.fullmatch(pattern, value) is None for pattern, value in zip(intent_patterns, intent)):
    reject()
if (completion[0] != intent[0] or completion[1] != 'state=resealed-v2'
        or completion[2:14] != intent[2:14]
        or re.fullmatch(rf'v2_binding_dev_ino={DEV_INO}', completion[14]) is None
        or re.fullmatch(rf'v2_binding_sha256={HEX}', completion[15]) is None):
    reject()

legacy_sha = intent[6].removeprefix('legacy_binding_sha256=')
helper_dev_ino = intent[3].removeprefix('helper_dev_ino=')
helper_sha = intent[4].removeprefix('helper_sha256=')
key_dev_ino = intent[7].removeprefix('identity_hmac_key_dev_ino=')
key_sha = intent[8].removeprefix('identity_hmac_key_sha256=')
release = intent[2].removeprefix('release=')
v2_sha = completion[15].removeprefix('v2_binding_sha256=')
helper_raw, observed_helper_dev_ino = exact_file(TARGET, {(0, 0, 0o755)}, 2 * 1024 * 1024)
if (observed_helper_dev_ino != helper_dev_ino
        or hashlib.sha256(helper_raw).hexdigest() != helper_sha):
    reject()
key_raw, observed_key_dev_ino = exact_file(KEY, {(10001, 10001, 0o400), (0, 0, 0o444)}, 4096)
if observed_key_dev_ino != key_dev_ino or hashlib.sha256(key_raw).hexdigest() != key_sha:
    reject()

if (os.path.lexists(SOURCE) or os.path.lexists(PROMOTION)
        or os.path.lexists(CANDIDATE) or os.path.lexists(PLAYERS)):
    reject()
binding_raw, _ = exact_file(FINAL, {(0, 0, 0o444)}, 230, 230)
receipt_root_identity = exact_directory(RECEIPT_ROOT, (0, 0), 0o700)
try:
    if os.listdir(RECEIPT_ROOT) != ['ready-v1']:
        reject()
except OSError:
    reject()
receipt_raw, _ = exact_file(RECEIPT, {(0, 0, 0o600)}, 4096)
receipt = exact_lines(receipt_raw, 8)
if (receipt[0] != 'version=1' or receipt[1] != f'release={release}'
        or receipt[2] != f'binding_sha256={v2_sha}'
        or receipt[3] != f'identity_hmac_key_sha256={key_sha}'
        or re.fullmatch(rf'selector_sha256={HEX}', receipt[4]) is None
        or re.fullmatch(rf'image_id=sha256:{HEX}', receipt[5]) is None
        or receipt[6] != 'profile_volume=fetanagent-staging-beta_kemerbet_sessions'
        or re.fullmatch(rf'profile_identity_sha256={HEX}', receipt[7]) is None):
    reject()
selector_raw, _ = exact_file(SELECTOR, {(0, 0, 0o444)}, 1024 * 1024)
if hashlib.sha256(selector_raw).hexdigest() != receipt[4].removeprefix('selector_sha256='):
    reject()
if exact_directory(RECEIPT_ROOT, (0, 0), 0o700) != receipt_root_identity:
    reject()

if hashlib.sha256(binding_raw).hexdigest() != v2_sha:
    reject()
try:
    binding_line = binding_raw[:-1].decode('ascii')
except UnicodeDecodeError:
    reject()
if (not binding_raw.endswith(b'\n') or binding_raw.count(b'\n') != 1
        or BINDING.fullmatch(binding_line) is None):
    reject()
account_id, fingerprint, authorization_digest = binding_line.split(' ')
projection = hashlib.sha256(f'{account_id} {fingerprint}\n'.encode('ascii')).hexdigest()
if projection != legacy_sha or not authorization_digest.startswith('sha256-provider-authorization-v1:'):
    reject()
if exact_directory(ROOT, (0, 0), 0o700) != root_identity:
    reject()
PY
}
require_allowed_helper_for_sudoers_restore() {
  local helper_sha
  test ! -L "$TARGET" && test -f "$TARGET" || return 1
  test "$(realpath -- "$TARGET")" = "$TARGET" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$TARGET")" = 'root:root:755:1' || return 1
  helper_sha="$(sha256sum "$TARGET" | awk '{ print $1 }')" || return 1
  [[ "$helper_sha" == "$PREVIOUS_SHA" || "$helper_sha" == "$NEXT_SHA" ]] || return 1
  bash -n "$TARGET" || return 1
}
restore_sudoers_grant() {
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]]; then
    require_allowed_helper_for_sudoers_restore || return 1
    sync -f /etc/sudoers.d || return 1
    require_exact_sudoers_file "$SUDOERS" || return 1
    visudo -cf /etc/sudoers >/dev/null || return 1
    return 0
  fi
  require_allowed_helper_for_sudoers_restore || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS" || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_exact_sudoers_file "$SUDOERS" || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
}
restore_sudoers_on_exit() {
  local status=$?
  trap - EXIT
  if [[ -n "$INSTALL_TMP" ]]; then
    rm -f -- "$INSTALL_TMP" || status=1
  fi
  if [[ -n "$BACKUP_TMP" ]]; then
    rm -f -- "$BACKUP_TMP" || status=1
  fi
  restore_sudoers_grant || status=1
  exit "$status"
}
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" = '593344964'
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  "$METADATA/interfaces/public/0/ipv4/address")" = '161.35.41.232'
test ! -L /etc/sudoers.d && test -d /etc/sudoers.d
test "$(realpath -- /etc/sudoers.d)" = '/etc/sudoers.d'
test "$(stat --format='%U:%G:%a' /etc/sudoers.d)" = 'root:root:750'
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  require_exact_sudoers_file "$SUDOERS"
  test ! -e "$SUDOERS_DISABLED" && test ! -L "$SUDOERS_DISABLED"
  SUDOERS_STATE='enabled'
elif [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
  require_exact_sudoers_file "$SUDOERS_DISABLED"
  SUDOERS_STATE='disabled'
else
  false
fi
visudo -cf /etc/sudoers >/dev/null
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$STAGING_ROOT" && test "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" = 'root:root:700'
test ! -L "$RETAINED_022_BACKUP" && test -f "$RETAINED_022_BACKUP"
test "$(realpath -- "$RETAINED_022_BACKUP")" = "$RETAINED_022_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_022_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_022_BACKUP" | awk '{ print $1 }')" = "$RETAINED_022_BACKUP_SHA"
test ! -L "$RETAINED_D9CD_BACKUP" && test -f "$RETAINED_D9CD_BACKUP"
test "$(realpath -- "$RETAINED_D9CD_BACKUP")" = "$RETAINED_D9CD_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_D9CD_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_D9CD_BACKUP" | awk '{ print $1 }')" = "$RETAINED_D9CD_BACKUP_SHA"
test ! -L "$RETAINED_526_BACKUP" && test -f "$RETAINED_526_BACKUP"
test "$(realpath -- "$RETAINED_526_BACKUP")" = "$RETAINED_526_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_526_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_526_BACKUP" | awk '{ print $1 }')" = "$RETAINED_526_BACKUP_SHA"
test ! -L "$RETAINED_121E_BACKUP" && test -f "$RETAINED_121E_BACKUP"
test "$(realpath -- "$RETAINED_121E_BACKUP")" = "$RETAINED_121E_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_121E_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_121E_BACKUP" | awk '{ print $1 }')" = "$RETAINED_121E_BACKUP_SHA"
test ! -L "$RETAINED_AF823_BACKUP" && test -f "$RETAINED_AF823_BACKUP"
test "$(realpath -- "$RETAINED_AF823_BACKUP")" = "$RETAINED_AF823_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_AF823_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_AF823_BACKUP" | awk '{ print $1 }')" = "$RETAINED_AF823_BACKUP_SHA"
test ! -L "$RETAINED_B466_BACKUP" && test -f "$RETAINED_B466_BACKUP"
test "$(realpath -- "$RETAINED_B466_BACKUP")" = "$RETAINED_B466_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_B466_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_B466_BACKUP" | awk '{ print $1 }')" = "$RETAINED_B466_BACKUP_SHA"
test ! -L "$RETAINED_33F4_BACKUP" && test -f "$RETAINED_33F4_BACKUP"
test "$(realpath -- "$RETAINED_33F4_BACKUP")" = "$RETAINED_33F4_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_33F4_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_33F4_BACKUP" | awk '{ print $1 }')" = "$RETAINED_33F4_BACKUP_SHA"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test ! -L "$STAGED" && test "$(stat --format='%U:%G:%a' "$STAGED")" = 'root:root:600'
test "$(sha256sum "$STAGED" | awk '{ print $1 }')" = "$NEXT_SHA"
bash -n "$STAGED"
if [[ -e "$BACKUP" || -L "$BACKUP" ]]; then
  test ! -L "$BACKUP" && test -f "$BACKUP"
  test "$(realpath -- "$BACKUP")" = "$BACKUP"
  test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
  test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
else
  test "$TARGET_SHA" = "$PREVIOUS_SHA"
fi
trap restore_sudoers_on_exit EXIT
if [[ "$SUDOERS_STATE" == 'enabled' ]]; then
  mv -- "$SUDOERS" "$SUDOERS_DISABLED"
fi
sync -f /etc/sudoers.d
require_exact_sudoers_file "$SUDOERS_DISABLED"
test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
visudo -cf /etc/sudoers >/dev/null
require_no_helper_processes
test ! -L /run && test -d /run && test "$(realpath -- /run)" = '/run'
test "$(stat --format='%U:%G:%a' /run)" = 'root:root:755'
if [[ ! -e "$MUTATION_LOCK_ROOT" && ! -L "$MUTATION_LOCK_ROOT" ]]; then
  (umask 077 && mkdir --mode=0700 -- "$MUTATION_LOCK_ROOT")
fi
test ! -L "$MUTATION_LOCK_ROOT" && test -d "$MUTATION_LOCK_ROOT"
test "$(realpath -- "$MUTATION_LOCK_ROOT")" = "$MUTATION_LOCK_ROOT"
test "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" = 'root:root:700'
if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
  (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
fi
test ! -L "$MUTATION_LOCK" && test -f "$MUTATION_LOCK"
test "$(realpath -- "$MUTATION_LOCK")" = "$MUTATION_LOCK"
test "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" = 'root:root:600:1'
exec 9<>"$MUTATION_LOCK"
path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
test "$fd_identity" = "$path_identity"
case "$fd_identity" in 0:0:600:1:*) ;; *) false ;; esac
flock --exclusive --nonblock 9
test "$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" = "$fd_identity"
require_no_helper_processes
require_kemerbet_v1_retirement_rotation_ready
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test "$(sha256sum "$STAGED" | awk '{ print $1 }')" = "$NEXT_SHA"
bash -n "$STAGED"
if [[ "$TARGET_SHA" == "$PREVIOUS_SHA" ]]; then
  if [[ ! -e "$BACKUP" && ! -L "$BACKUP" ]]; then
    if [[ -e "$BACKUP_TMP_PATH" || -L "$BACKUP_TMP_PATH" ]]; then
      test ! -L "$BACKUP_TMP_PATH" && test -f "$BACKUP_TMP_PATH"
      test "$(realpath -- "$BACKUP_TMP_PATH")" = "$BACKUP_TMP_PATH"
      test "$(stat --format='%U:%G:%h' "$BACKUP_TMP_PATH")" = 'root:root:1'
      rm -- "$BACKUP_TMP_PATH"
      sync -f "$STAGING_ROOT"
    fi
    test ! -e "$BACKUP_TMP_PATH" && test ! -L "$BACKUP_TMP_PATH"
    BACKUP_TMP="$BACKUP_TMP_PATH"
    install -o root -g root -m 0600 "$TARGET" "$BACKUP_TMP"
    test "$(stat --format='%U:%G:%a:%h' "$BACKUP_TMP")" = 'root:root:600:1'
    test "$(sha256sum "$BACKUP_TMP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
    sync -f "$BACKUP_TMP"
    test ! -e "$BACKUP" && test ! -L "$BACKUP"
    mv -- "$BACKUP_TMP" "$BACKUP"
    BACKUP_TMP=''
    sync -f "$BACKUP"
    sync -f "$STAGING_ROOT"
  fi
  test ! -L "$BACKUP" && test -f "$BACKUP"
  test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
  test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
  if [[ -e "$INSTALL_TMP_PATH" || -L "$INSTALL_TMP_PATH" ]]; then
    test ! -L "$INSTALL_TMP_PATH" && test -f "$INSTALL_TMP_PATH"
    test "$(realpath -- "$INSTALL_TMP_PATH")" = "$INSTALL_TMP_PATH"
    test "$(stat --format='%U:%G:%h' "$INSTALL_TMP_PATH")" = 'root:root:1'
    rm -- "$INSTALL_TMP_PATH"
    sync -f "$(dirname -- "$TARGET")"
  fi
  test ! -e "$INSTALL_TMP_PATH" && test ! -L "$INSTALL_TMP_PATH"
  INSTALL_TMP="$INSTALL_TMP_PATH"
  install -o root -g root -m 0755 "$STAGED" "$INSTALL_TMP"
  test "$(stat --format='%U:%G:%a:%h' "$INSTALL_TMP")" = 'root:root:755:1'
  test "$(sha256sum "$INSTALL_TMP" | awk '{ print $1 }')" = "$NEXT_SHA"
  sync -f "$INSTALL_TMP"
  mv -- "$INSTALL_TMP" "$TARGET"
  INSTALL_TMP=''
  sync -f "$(dirname -- "$TARGET")"
else
  test ! -L "$BACKUP" && test -f "$BACKUP"
  test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
  test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
fi
test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
test "$(sha256sum "$TARGET" | awk '{ print $1 }')" = "$NEXT_SHA"
require_no_helper_processes
restore_sudoers_grant
trap - EXIT
FETANAGENT_HELPER_REPLACE
```

Then dispatch only `transition-ssh-verify` from the same exact reviewed `main` commit. It must pass
against successor SHA `43b09de7…` before `deploy-and-smoke` is allowed. A transient SSH failure should
be diagnosed and the read-only verification retried while staging remains offline. Manual rollback
to `ecd47f5d…` is an exceptional pre-deploy path only: it is forbidden after `deploy-and-smoke` or
after any successor command other than exact checksum `verify`. It follows the same sudoers
revocation and exact process-quiescence boundary, verifies the restored predecessor before
re-enabling its grant, and makes no further mutation afterward. It is resumable with the exact
disabled grant and either allowed TARGET hash only while the strict rollback shape remains compatible
with predecessor `ecd47f5d`: the complete promotion and recheck receipt roots, recheck candidate,
canonical binding, fixed Player-ID import candidate, every Owner cohort stage/installer/aggregate
marker, and every profile singleton must all be absent. The root-anchored Owner aggregate receipt
parent and root must already exist as canonical `root:root` mode-`0755` directories, retain their
initial device/inode identities across every authority boundary, and the receipt root must be exactly
empty. The rollback block never creates, repairs, cleans, deletes, chmods, or chowns either directory.
If this predecessor-compatible namespace is absent, unsafe, replaced, or nonempty, leave the reviewed
successor installed, keep staging offline, and remediate forward. The identity key may be either the
exact service-readable file or the exact root-frozen file left by the bounded recheck. The predecessor
requires the exact service-readable one-use Player-ID file and exact still-sealed readiness
output/binding; absence is not a rollback-compatible pre-recheck state:

```bash
bash -euo pipefail <<'FETANAGENT_HELPER_RESTORE'
TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-ecd47f5d'
RETAINED_022_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-022a9f10'
RETAINED_D9CD_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-d9cdcdec'
RETAINED_526_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-5267906f'
RETAINED_121E_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-121e3b36'
RETAINED_AF823_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-af823251'
RETAINED_B466_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-b4664efd'
RETAINED_33F4_BACKUP='/root/fetanagent-helper-rotation/fetanagent-staging-deploy-helper.previous-33f4a5a4'
SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.rotation-disabled'
MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
RECHECK_PROMOTION_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck-promotion'
RECHECK_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck'
RECHECK_CANDIDATE_ROOT='/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate'
CANONICAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
IMPORT_CANDIDATE='/etc/fetanagent/executor-secrets/.kemerbet-readiness-player-ids.promote-v1'
IDENTITY_KEY='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key'
PLAYER_IDS='/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
READINESS_OUTPUT_ROOT='/var/lib/fetanagent/kemerbet-readiness-seal-output'
READINESS_BINDING="$READINESS_OUTPUT_ROOT/kemerbet_agent_identity_bindings"
OWNER_RECEIPT_PARENT='/var/lib/fetanagent'
OWNER_RECEIPT_ROOT="$OWNER_RECEIPT_PARENT/kemerbet-readiness-cohort-receipts"
SESSION_CONTROL_VOLUME='fetanagent-staging-beta_kemerbet_session_control'
PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'
PREVIOUS_SHA='ecd47f5d6aff8cd955ed8b68d7313b79fde5547a6827743e1e5f1b0d1fca04be'
NEXT_SHA='43b09de7356bc6237264d8f0b162b237e74c1a59c175a2dccced7ad5b77d6619'
RETAINED_022_BACKUP_SHA='022a9f10335fb570efb7638e2029ce663525ed742296268471b4c3a444ada714'
RETAINED_D9CD_BACKUP_SHA='d9cdcdec53e0a408bc15b205f161fd19e3204ed8e81a32e5921342c2bfa867f7'
RETAINED_526_BACKUP_SHA='5267906f1b0fe07c8d4a2da05f2e101240a39ee8ab73cf323d4b41d7a30b6795'
RETAINED_121E_BACKUP_SHA='121e3b360fc8e68aacd87a6d6a39611d2e6005c347a782798a1204d85b42b5b4'
RETAINED_AF823_BACKUP_SHA='af823251e2374b77898c813f5f7fe74e78280b69ba89d0b1dd0901b8851c8833'
RETAINED_B466_BACKUP_SHA='b4664efdbe3297b7b0ddee8122bf431608571e84dd0987892f58c20f48bdb663'
RETAINED_33F4_BACKUP_SHA='33f4a5a4ba56fa86aa34cdc9a899117d327ed06a58b3cb5d7e9453c28afad5ba'
METADATA='http://169.254.169.254/metadata/v1'
RESTORE_TMP=''
RESTORE_TMP_PATH='/usr/local/sbin/.fetanagent-staging-deploy-helper.restoring-ecd47f5d'
SUDOERS_STATE=''
TARGET_SHA=''
OWNER_RECEIPT_PARENT_IDENTITY=''
OWNER_RECEIPT_ROOT_IDENTITY=''
require_pre_recheck_rollback_state() {
  local account_id absent_path ancestor binding_fingerprint binding_line binding_residue control_mountpoint
  local current_parent_identity current_root_identity identity_key_metadata profile_mountpoint
  local profile_path provider_authorization_digest receipt_entry root_entries volume_name
  for absent_path in \
    "$RECHECK_PROMOTION_ROOT" \
    "$RECHECK_RECEIPT_ROOT" \
    "$RECHECK_CANDIDATE_ROOT" \
    "$CANONICAL_BINDING" \
    "$IMPORT_CANDIDATE"; do
    [[ ! -e "$absent_path" && ! -L "$absent_path" ]] || return 1
  done
  for ancestor in / /var /var/lib "$OWNER_RECEIPT_PARENT" "$OWNER_RECEIPT_ROOT"; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor")" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor")" == '0:0:755' ]] || return 1
  done
  receipt_entry="$(find -P "$OWNER_RECEIPT_ROOT" \
    -mindepth 1 -maxdepth 1 -printf 'present\n' -quit)" || return 1
  [[ -z "$receipt_entry" ]] || return 1
  current_parent_identity="$(stat --format='%u:%g:%a:%d:%i' "$OWNER_RECEIPT_PARENT")" || return 1
  current_root_identity="$(stat --format='%u:%g:%a:%d:%i' "$OWNER_RECEIPT_ROOT")" || return 1
  if [[ -z "$OWNER_RECEIPT_PARENT_IDENTITY" ]]; then
    OWNER_RECEIPT_PARENT_IDENTITY="$current_parent_identity"
  else
    [[ "$current_parent_identity" == "$OWNER_RECEIPT_PARENT_IDENTITY" ]] || return 1
  fi
  if [[ -z "$OWNER_RECEIPT_ROOT_IDENTITY" ]]; then
    OWNER_RECEIPT_ROOT_IDENTITY="$current_root_identity"
  else
    [[ "$current_root_identity" == "$OWNER_RECEIPT_ROOT_IDENTITY" ]] || return 1
  fi
  [[ ! -L "$IDENTITY_KEY" && -f "$IDENTITY_KEY" ]] || return 1
  [[ "$(realpath -- "$IDENTITY_KEY")" == "$IDENTITY_KEY" ]] || return 1
  identity_key_metadata="$(stat --format='%u:%g:%a:%h' "$IDENTITY_KEY")" || return 1
  [[ "$identity_key_metadata" == '10001:10001:400:1' ||
    "$identity_key_metadata" == '0:0:444:1' ]] || return 1
  [[ ! -L "$PLAYER_IDS" && -f "$PLAYER_IDS" && "$(realpath -- "$PLAYER_IDS")" == "$PLAYER_IDS" &&
    "$(stat --format='%u:%g:%a:%h' "$PLAYER_IDS")" == '10001:10001:400:1' ]] || return 1
  [[ ! -L "$READINESS_OUTPUT_ROOT" && -d "$READINESS_OUTPUT_ROOT" &&
    "$(realpath -- "$READINESS_OUTPUT_ROOT")" == "$READINESS_OUTPUT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$READINESS_OUTPUT_ROOT")" == '10001:10001:700' ]] || return 1
  [[ "$(find -P "$READINESS_OUTPUT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
    'kemerbet_agent_identity_bindings' ]] || return 1
  [[ ! -L "$READINESS_BINDING" && -f "$READINESS_BINDING" &&
    "$(realpath -- "$READINESS_BINDING")" == "$READINESS_BINDING" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$READINESS_BINDING")" == '10001:10001:600:1:230' ]] || return 1
  [[ "$(wc -l <"$READINESS_BINDING")" == '1' ]] || return 1
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64} sha256-provider-authorization-v1:[0-9a-f]{64}$' \
    "$READINESS_BINDING" || return 1
  binding_line="$(<"$READINESS_BINDING")"
  IFS=' ' read -r account_id binding_fingerprint provider_authorization_digest binding_residue \
    <<<"$binding_line"
  [[ -n "$account_id" && -n "$binding_fingerprint" &&
    -n "$provider_authorization_digest" && -z "$binding_residue" ]] || return 1
  volume_name="$(docker --host unix:///var/run/docker.sock volume ls --quiet \
    --filter 'label=com.docker.compose.project=fetanagent-staging-beta' \
    --filter 'label=com.docker.compose.volume=kemerbet_session_control')" || return 1
  [[ "$volume_name" == "$SESSION_CONTROL_VOLUME" ]] || return 1
  [[ "$(docker --host unix:///var/run/docker.sock volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}')" == \
    "$SESSION_CONTROL_VOLUME|local|local|fetanagent-staging-beta|kemerbet_session_control" ]] || return 1
  control_mountpoint="$(docker --host unix:///var/run/docker.sock volume inspect \
    "$volume_name" --format '{{.Mountpoint}}')" || return 1
  [[ "$control_mountpoint" == /* && ! -L "$control_mountpoint" && -d "$control_mountpoint" &&
    "$(realpath -- "$control_mountpoint")" == "$control_mountpoint" &&
    "$(stat --format='%u:%g:%a' "$control_mountpoint")" == '10001:10001:700' ]] || return 1
  for absent_path in \
    kemerbet-readiness-player-ids.stage-v1 \
    .kemerbet-readiness-player-ids.stage-v1.installing \
    kemerbet-readiness-cohort-claim.stage-v1 \
    .kemerbet-readiness-cohort-claim.stage-v1.installing \
    kemerbet-readiness-cohort-imported-v1 \
    .kemerbet-readiness-cohort-imported-v1.installing \
    kemerbet-readiness-cohort-completed-v1 \
    .kemerbet-readiness-cohort-completed-v1.installing \
    kemerbet-readiness-cohort-failed-v1 \
    .kemerbet-readiness-cohort-failed-v1.installing; do
    [[ ! -e "$control_mountpoint/$absent_path" && ! -L "$control_mountpoint/$absent_path" ]] || return 1
  done
  volume_name="$(docker --host unix:///var/run/docker.sock volume ls --quiet \
    --filter 'label=com.docker.compose.project=fetanagent-staging-beta' \
    --filter 'label=com.docker.compose.volume=kemerbet_sessions')" || return 1
  [[ "$volume_name" == "$PROFILE_VOLUME" ]] || return 1
  [[ "$(docker --host unix:///var/run/docker.sock volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}')" == \
    "$PROFILE_VOLUME|local|local|fetanagent-staging-beta|kemerbet_sessions" ]] || return 1
  profile_mountpoint="$(docker --host unix:///var/run/docker.sock volume inspect \
    "$volume_name" --format '{{.Mountpoint}}')" || return 1
  [[ "$profile_mountpoint" == /* && ! -L "$profile_mountpoint" && -d "$profile_mountpoint" &&
    "$(realpath -- "$profile_mountpoint")" == "$profile_mountpoint" &&
    "$(stat --format='%u:%g:%a' "$profile_mountpoint")" == '10001:10001:700' ]] || return 1
  root_entries="$(find -P "$profile_mountpoint" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  [[ "$root_entries" == "$account_id" ]] || return 1
  profile_path="$profile_mountpoint/$account_id"
  [[ ! -L "$profile_path" && -d "$profile_path" && "$(realpath -- "$profile_path")" == "$profile_path" &&
    "$(stat --format='%u:%g:%a' "$profile_path")" == '10001:10001:700' ]] || return 1
  for absent_path in SingletonCookie SingletonLock SingletonSocket; do
    [[ ! -e "$profile_path/$absent_path" && ! -L "$profile_path/$absent_path" ]] || return 1
  done
}
expected_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}
require_exact_sudoers_file() {
  local path="$1"
  test ! -L "$path" && test -f "$path" || return 1
  test "$(realpath -- "$path")" = "$path" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$path")" = 'root:root:440:1' || return 1
  cmp -s -- "$path" <(expected_sudoers) || return 1
}
require_no_helper_processes() {
  local arg cmdline found
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    found='false'
    while IFS= read -r -d '' arg; do
      if [[ "$arg" == "$TARGET" ]]; then
        found='true'
        break
      fi
    done <"$cmdline" || true
    [[ "$found" == 'false' ]] || return 1
  done
}
require_kemerbet_v1_retirement_rotation_ready() {
  local retirement_root='/var/lib/fetanagent/kemerbet-readiness-binding-v1-retirement'
  local retirement_root_installing="${retirement_root}.installing"
  [[ ! -e "$retirement_root" && ! -L "$retirement_root" &&
    ! -e "$retirement_root_installing" && ! -L "$retirement_root_installing" ]]
}
require_allowed_helper_for_sudoers_restore() {
  local helper_sha
  test ! -L "$TARGET" && test -f "$TARGET" || return 1
  test "$(realpath -- "$TARGET")" = "$TARGET" || return 1
  test "$(stat --format='%U:%G:%a:%h' "$TARGET")" = 'root:root:755:1' || return 1
  helper_sha="$(sha256sum "$TARGET" | awk '{ print $1 }')" || return 1
  [[ "$helper_sha" == "$PREVIOUS_SHA" || "$helper_sha" == "$NEXT_SHA" ]] || return 1
  bash -n "$TARGET" || return 1
}
restore_sudoers_grant() {
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]]; then
    require_allowed_helper_for_sudoers_restore || return 1
    require_pre_recheck_rollback_state || return 1
    sync -f /etc/sudoers.d || return 1
    require_exact_sudoers_file "$SUDOERS" || return 1
    visudo -cf /etc/sudoers >/dev/null || return 1
    return 0
  fi
  require_allowed_helper_for_sudoers_restore || return 1
  require_pre_recheck_rollback_state || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS" || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_exact_sudoers_file "$SUDOERS" || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
}
restore_sudoers_on_exit() {
  local status=$?
  trap - EXIT
  if [[ -n "$RESTORE_TMP" ]]; then
    rm -f -- "$RESTORE_TMP" || status=1
  fi
  restore_sudoers_grant || status=1
  exit "$status"
}
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" = '593344964'
test "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  "$METADATA/interfaces/public/0/ipv4/address")" = '161.35.41.232'
test ! -L /etc/sudoers.d && test -d /etc/sudoers.d
test "$(realpath -- /etc/sudoers.d)" = '/etc/sudoers.d'
test "$(stat --format='%U:%G:%a' /etc/sudoers.d)" = 'root:root:750'
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  require_exact_sudoers_file "$SUDOERS"
  test ! -e "$SUDOERS_DISABLED" && test ! -L "$SUDOERS_DISABLED"
  SUDOERS_STATE='enabled'
elif [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
  test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
  require_exact_sudoers_file "$SUDOERS_DISABLED"
  SUDOERS_STATE='disabled'
else
  false
fi
visudo -cf /etc/sudoers >/dev/null
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$RETAINED_022_BACKUP" && test -f "$RETAINED_022_BACKUP"
test "$(realpath -- "$RETAINED_022_BACKUP")" = "$RETAINED_022_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_022_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_022_BACKUP" | awk '{ print $1 }')" = "$RETAINED_022_BACKUP_SHA"
test ! -L "$RETAINED_D9CD_BACKUP" && test -f "$RETAINED_D9CD_BACKUP"
test "$(realpath -- "$RETAINED_D9CD_BACKUP")" = "$RETAINED_D9CD_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_D9CD_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_D9CD_BACKUP" | awk '{ print $1 }')" = "$RETAINED_D9CD_BACKUP_SHA"
test ! -L "$RETAINED_526_BACKUP" && test -f "$RETAINED_526_BACKUP"
test "$(realpath -- "$RETAINED_526_BACKUP")" = "$RETAINED_526_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_526_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_526_BACKUP" | awk '{ print $1 }')" = "$RETAINED_526_BACKUP_SHA"
test ! -L "$RETAINED_121E_BACKUP" && test -f "$RETAINED_121E_BACKUP"
test "$(realpath -- "$RETAINED_121E_BACKUP")" = "$RETAINED_121E_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_121E_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_121E_BACKUP" | awk '{ print $1 }')" = "$RETAINED_121E_BACKUP_SHA"
test ! -L "$RETAINED_AF823_BACKUP" && test -f "$RETAINED_AF823_BACKUP"
test "$(realpath -- "$RETAINED_AF823_BACKUP")" = "$RETAINED_AF823_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_AF823_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_AF823_BACKUP" | awk '{ print $1 }')" = "$RETAINED_AF823_BACKUP_SHA"
test ! -L "$RETAINED_B466_BACKUP" && test -f "$RETAINED_B466_BACKUP"
test "$(realpath -- "$RETAINED_B466_BACKUP")" = "$RETAINED_B466_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_B466_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_B466_BACKUP" | awk '{ print $1 }')" = "$RETAINED_B466_BACKUP_SHA"
test ! -L "$RETAINED_33F4_BACKUP" && test -f "$RETAINED_33F4_BACKUP"
test "$(realpath -- "$RETAINED_33F4_BACKUP")" = "$RETAINED_33F4_BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$RETAINED_33F4_BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$RETAINED_33F4_BACKUP" | awk '{ print $1 }')" = "$RETAINED_33F4_BACKUP_SHA"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test ! -L "$BACKUP" && test -f "$BACKUP"
test "$(realpath -- "$BACKUP")" = "$BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
require_pre_recheck_rollback_state
trap restore_sudoers_on_exit EXIT
if [[ "$SUDOERS_STATE" == 'enabled' ]]; then
  mv -- "$SUDOERS" "$SUDOERS_DISABLED"
fi
sync -f /etc/sudoers.d
require_exact_sudoers_file "$SUDOERS_DISABLED"
test ! -e "$SUDOERS" && test ! -L "$SUDOERS"
visudo -cf /etc/sudoers >/dev/null
require_no_helper_processes
test ! -L /run && test -d /run && test "$(realpath -- /run)" = '/run'
test "$(stat --format='%U:%G:%a' /run)" = 'root:root:755'
if [[ ! -e "$MUTATION_LOCK_ROOT" && ! -L "$MUTATION_LOCK_ROOT" ]]; then
  (umask 077 && mkdir --mode=0700 -- "$MUTATION_LOCK_ROOT")
fi
test ! -L "$MUTATION_LOCK_ROOT" && test -d "$MUTATION_LOCK_ROOT"
test "$(realpath -- "$MUTATION_LOCK_ROOT")" = "$MUTATION_LOCK_ROOT"
test "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" = 'root:root:700'
if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
  (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
fi
test ! -L "$MUTATION_LOCK" && test -f "$MUTATION_LOCK"
test "$(realpath -- "$MUTATION_LOCK")" = "$MUTATION_LOCK"
test "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" = 'root:root:600:1'
exec 9<>"$MUTATION_LOCK"
path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
test "$fd_identity" = "$path_identity"
case "$fd_identity" in 0:0:600:1:*) ;; *) false ;; esac
flock --exclusive --nonblock 9
test "$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" = "$fd_identity"
require_no_helper_processes
require_kemerbet_v1_retirement_rotation_ready
require_pre_recheck_rollback_state
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.timer)" = 'not-found'
test "$(systemctl show --property=LoadState --value \
  fetanagent-staging-runtime-expiry-stop.service)" = 'not-found'
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.timer
test ! -e /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service && \
  test ! -L /etc/systemd/system/fetanagent-staging-runtime-expiry-stop.service
test -z "$(docker --host unix:///var/run/docker.sock container ls --all --quiet \
  --filter 'label=com.docker.compose.project=fetanagent-staging-beta')"
test ! -L "$TARGET" && test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
TARGET_SHA="$(sha256sum "$TARGET" | awk '{ print $1 }')"
[[ "$TARGET_SHA" == "$PREVIOUS_SHA" || "$TARGET_SHA" == "$NEXT_SHA" ]]
test ! -L "$BACKUP" && test -f "$BACKUP"
test "$(realpath -- "$BACKUP")" = "$BACKUP"
test "$(stat --format='%U:%G:%a:%h' "$BACKUP")" = 'root:root:600:1'
test "$(sha256sum "$BACKUP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
if [[ "$TARGET_SHA" == "$NEXT_SHA" ]]; then
  if [[ -e "$RESTORE_TMP_PATH" || -L "$RESTORE_TMP_PATH" ]]; then
    test ! -L "$RESTORE_TMP_PATH" && test -f "$RESTORE_TMP_PATH"
    test "$(realpath -- "$RESTORE_TMP_PATH")" = "$RESTORE_TMP_PATH"
    test "$(stat --format='%U:%G:%h' "$RESTORE_TMP_PATH")" = 'root:root:1'
    rm -- "$RESTORE_TMP_PATH"
    sync -f "$(dirname -- "$TARGET")"
  fi
  test ! -e "$RESTORE_TMP_PATH" && test ! -L "$RESTORE_TMP_PATH"
  RESTORE_TMP="$RESTORE_TMP_PATH"
  install -o root -g root -m 0755 "$BACKUP" "$RESTORE_TMP"
  test "$(stat --format='%U:%G:%a:%h' "$RESTORE_TMP")" = 'root:root:755:1'
  test "$(sha256sum "$RESTORE_TMP" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
  sync -f "$RESTORE_TMP"
  mv -- "$RESTORE_TMP" "$TARGET"
  RESTORE_TMP=''
  sync -f "$(dirname -- "$TARGET")"
fi
test "$(stat --format='%U:%G:%a' "$TARGET")" = 'root:root:755'
test "$(sha256sum "$TARGET" | awk '{ print $1 }')" = "$PREVIOUS_SHA"
require_no_helper_processes
restore_sudoers_grant
trap - EXIT
FETANAGENT_HELPER_RESTORE
```

Do not hand-edit the installed helper or bypass its checksum gate. After read-only verification
succeeds, remove only the staged `.next` file. Retain all eight versioned predecessor backups: the new
`fetanagent-staging-deploy-helper.previous-ecd47f5d` backup and the independently verified existing
`fetanagent-staging-deploy-helper.previous-022a9f10`,
`fetanagent-staging-deploy-helper.previous-d9cdcdec`,
`fetanagent-staging-deploy-helper.previous-5267906f`,
`fetanagent-staging-deploy-helper.previous-121e3b36`,
`fetanagent-staging-deploy-helper.previous-af823251`,
`fetanagent-staging-deploy-helper.previous-b4664efd`, and
`fetanagent-staging-deploy-helper.previous-33f4a5a4` evidence. Never overwrite or delete any of the
seven older backups during this rotation. This is a one-successor replacement, not ongoing
credential rotation and not authority to enable financial actions.

The protected `staging` environment must hold these deploy inputs before `deploy-and-smoke` or
`stop-and-disable` is selected. The permanent read-only `transition-ssh-verify` mode and the guarded
`transition-stop-legacy` mode use only the three `STAGING_VM_*` SSH inputs. Never paste any
protected value into a task, repository file, workflow input, or VM command line.

| Protected environment input                         | Required boundary                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN`                             | Supabase Management API token; ban-list reads in deploy, and exact-IP removal only in explicit unban mode                      |
| `SUPABASE_DB_PASSWORD`                              | staging database administrator password                                                                                        |
| `SUPABASE_CA_CERTIFICATE_PEM`                       | verified staging database CA PEM                                                                                               |
| `BETA_ADMISSION_RUNTIME_PASSWORD`                   | independent 32-byte lowercase hex                                                                                              |
| `OWNER_CONTROL_RUNTIME_PASSWORD`                    | different independent 32-byte lowercase hex                                                                                    |
| `PLAYER_ACTION_RUNTIME_PASSWORD`                    | different independent 32-byte lowercase hex                                                                                    |
| `BOT_TO_BETA_ADMISSION_HMAC_SECRET`                 | independent 32-byte lowercase hex                                                                                              |
| `BETA_ADMISSION_PAYLOAD_HMAC_SECRET`                | different independent 32-byte lowercase hex                                                                                    |
| `BOT_TO_API_ACTION_HMAC_SECRET`                     | distinct 32-byte lowercase hex; shared bot/API value                                                                           |
| `API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET`    | distinct 32-byte lowercase hex                                                                                                 |
| `API_TELEGRAM_CAPABILITY_HMAC_SECRET`               | distinct 32-byte lowercase hex                                                                                                 |
| `API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET`          | distinct 32-byte lowercase hex                                                                                                 |
| `CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET`           | distinct 32-byte lowercase hex; retain for decrypts                                                                            |
| `CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET`          | distinct 32-byte lowercase hex; stable blind index                                                                             |
| `CBE_DEPOSIT_REFERENCE_KEY_PROFILE_V1_JSON`         | protected nonsecret variable; independently approved exact v1 profile                                                          |
| `DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET`  | distinct 32-byte lowercase hex provider-neutral v2 root; retain for decrypts                                                   |
| `DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET` | distinct 32-byte lowercase hex provider-neutral v2 blind-index root                                                            |
| `DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON`           | protected nonsecret variable; independently approved exact v2 profile                                                          |
| `STAGING_TELEGRAM_BOT_TOKEN`                        | reserved for the separate bot activation and smoke workflow; the fresh-host deploy writes an invalid disabled sentinel instead |
| `STAGING_TELEGRAM_BOT_TOKEN_SHA256`                 | protected nonsecret variable; SHA-256 fingerprint approved only after a fresh BotFather rotation                               |
| `STAGING_SUPABASE_PUBLISHABLE_KEY`                  | staging publishable key; never `service_role`                                                                                  |
| `STAGING_VM_HOST`                                   | exact approved staging VM host                                                                                                 |
| `STAGING_VM_KNOWN_HOSTS`                            | pinned OpenSSH known-hosts entry                                                                                               |
| `STAGING_VM_SSH_PRIVATE_KEY`                        | dedicated non-root deployment identity private key                                                                             |

The four runtime passwords, all independently purposed HMAC values, the two v1 keys, and the two v2
roots must differ. Keep each reference-protection pair and its separately approved profile stable
for records of that version; rotate only through a reviewed key-version migration. The workflow
validates and materializes both protected profile values without computing either from secret
material. API startup machine-checks both profiles, and customer-web startup machine-checks the v2
profile. The VM key must
authenticate only the non-root `fetanagent-admin` identity. The historical BotFather token shown in
an earlier screenshot is compromised and must never be reused.

`Staging beta deploy and smoke` starts only when manually dispatched from the exact reviewed `main`
commit with the staging project ref and DigitalOcean droplet ID typed back. `plan`
only builds the five commit-labelled images. `transition-ssh-verify` checks out that exact commit,
derives the reviewed helper SHA-256, and uses the protected private key and strict pinned
`known_hosts` entry to connect as non-root `fetanagent-admin`. It invokes only the helper's
checksum-verifying `verify` command: it does not stop a runtime, access the database, run Compose,
transfer a release, or alter VM state.

`transition-stop-legacy` is a one-way transition boundary. Freeze `main` at the final post-merge SHA
through this sequence: first the separate `transition-ssh-verify` run for that SHA must pass, then
the root-console transition `acknowledge` and `verify` commands for the same SHA must both pass.
Only then may the stop mode be dispatched.
The stop dispatch must repeat that full SHA, the staging project ref, and the staging Droplet ID, and
must type the exact irreversible confirmation `stop-legacy-staging-runtime`. In one strict,
pinned-host SSH session as the literal legacy non-root administrator named in the transition
runbook, it runs only the legacy helper's fixed-digest `verify` followed by `stop`. It does not access
the database, run Docker or Compose directly, transfer a release, impersonate root, use the
FetanAgent helper, or write the root-only transition receipt. A successful job means only that the
old helper reported a successful stop. Immediately return to the already-open root console and run
`mark-legacy-stopped` with the same SHA, then `verify`; keep staging offline until both pass. If the
workflow fails or the root-console checks do not pass, do not deploy, migrate, restore the old
runtime, or claim that the boundary is sealed.

`deploy-and-smoke` additionally requires the
protected `staging` environment, a dedicated `fetanagent-admin` SSH identity with noninteractive
sudo access only to the root-owned `/usr/local/sbin/fetanagent-staging-deploy-helper`, pinned
`known_hosts`, the public Supabase client key, and four distinct narrow database passwords. It does
not read the Telegram token; it always installs the invalid
`telegram-disabled-until-separate-smoke` sentinel and starts only Owner-control, customer-web, API,
and beta-admission. It rejects root SSH and fails if the installed helper checksum differs from the
reviewed repository helper.

`deploy-and-smoke` does not accept an operator-authored stop deadline. Immediately after provisioning,
it reads only the four exact staging roles' `rolvaliduntil` values through the protected administrator
connection. All four roles must exist, be login-enabled, have finite expiries within the expected
24-hour window, and differ by no more than ten seconds. The workflow derives one canonical UTC stop
time exactly two hours before the earliest expiry. It transfers no database password or administrator
credential to the VM for this control.

Before any long-lived container starts, the checksum-verified root helper installs and enables a
fixed, root-owned systemd service and persistent timer for that derived time. The timer survives a VM
reboot, stops only the exact `fetanagent-staging-beta` Compose project, removes its runtime secret
files, and retries once per minute without a start limit if the stop fails. The helper permits the
timer-only `expiry-stop` path only for a systemd service invocation with its fixed guard marker; the
deployment identity cannot invoke that path directly. Any ordinary helper `stop` also removes the
timer. If deriving or arming the timer fails, activation does not start and the workflow disables all
four logins. A cancellation after provisioning also runs the same bounded VM stop/disarm and database
login cleanup; cancellation before provisioning has no runtime login to remove. This is an automatic
stop-before-expiry boundary, not credential rotation or continuous availability: staging intentionally
goes offline about 22 hours after each successful deployment and must be redeployed with new
disposable credentials to resume.

DigitalOcean Droplet `593344964` has the exact current public IPv6 address
`2a03:b0c0:1:e0:0:1:a8b4:2001`. It is the only address this workflow may remove from Supabase's
temporary network-ban list. In deploy mode, the workflow first stops any prior staging project and
disables its old logins, proves the empty host and direct IPv6 route, and then reads the current ban
list without modifying it. An unavailable or malformed ban list fails closed. If the exact Droplet
address is listed, deployment stops before any new runtime password is provisioned; deploy mode does
not unban an address.

Use this stop/check/unban-before-redeploy process after that failure:

1. Keep staging stopped. Do not restore the old runtime, retry its database connection, or rerun
   `deploy-and-smoke` while the exact address remains banned.
2. Dispatch `unban-and-connectivity-check` from the same exact reviewed `main` commit, typing back the
   staging project ref and Droplet ID. That explicit mode validates the current list, removes only
   `2a03:b0c0:1:e0:0:1:a8b4:2001` when it is present, and performs one protected read-only
   administrator connectivity check. It never removes every ban or another address.
3. Only after that mode passes, dispatch `deploy-and-smoke` again. A successful unban check does not
   itself start staging or provision a runtime credential.

Deployment gives the beta-admission, customer-web, Owner-control, and Player-ID action roles 24-hour
staging LOGIN credentials, installs service-separated `0400` files, and then creates four disposable
`--no-deps` preflight containers. Each connects through the direct IPv6 endpoint and proves the
dedicated catalog and privilege contract before any long-lived container starts. The helper removes
each preflight container. A preflight may make at most three strict read-only attempts, 15 seconds
apart, to tolerate a transient direct-database connection failure; it never relaxes a catalog
assertion or starts another service during those attempts. Only after all four preflights pass does
it start the private Compose project without building on the VM. The post-start gate proves the
exact `dry_run`/false financial environment, the customer-web proof-only gate, fixed v2 file paths,
and the running API process's redacted in-memory v2 runtime contract through an exact-container,
loopback-only health request, plus health and readiness, without submitting a payment or provider
request. The gate does not depend on an aging startup-log tail. Missing, mismatched, or inline v2
material fails closed. Failure disables all four logins. If the administrator
cleanup connection is temporarily refused after a failed activation, the workflow makes at most
four cleanup attempts, 15 seconds apart, and then fails visibly rather than claiming cleanup.
`stop-and-disable` remains the explicit immediate cleanup mode. Independently, the host-local timer
stops the containers and deletes their runtime secret files two hours before the earliest 24-hour
login expiry, preventing expired-password reconnect loops from causing another temporary network
ban. The database roles remain unused until they expire naturally; an explicit stop disables them
immediately. The workflow does not support in-place runtime-password rotation. A successful
deployment is a time-bounded beta demo, not financial launch approval; all payment,
provider, validation, deposit, withdrawal, and KemerBet execution gates remain off.

`Staging Telegram bot activation and smoke` is the only supported fresh-host bot boundary. Run it
only after the private deployment passes on the same exact `main` commit. A fresh BotFather token
must replace the compromised historical token, and its independently recorded
`STAGING_TELEGRAM_BOT_TOKEN_SHA256` value must match before the workflow contacts Telegram. The
workflow accepts only the exact `fetanagentbot` identity, requires no webhook and zero pending
updates, and refuses to mutate or clear Telegram's queue. It then proves that exactly the four
reviewed private services are healthy and Telegram-disabled, transfers the token through the pinned
non-root SSH identity, installs it as a `10001:10001` mode-`0400` service file, and starts only the
bot container without dependencies or builds. Readiness requires the exact reviewed revision, zero
container restarts, genuine bot startup output, `FINANCIAL_ACTIONS_MODE=dry_run`, and both KemerBet
flags false. Successful immediate readiness atomically seals a root-owned receipt bound to the exact
reviewed commit, full bot container identity, start time, and zero restart count. Later public-edge
gates require that receipt to match the same running container, so they do not depend on an aging
startup-log tail and cannot accept a recreated or unverified bot. A failed activation removes the bot
and restores the invalid sentinel. The explicit
`stop-and-disable` mode performs the same fail-closed removal without stopping the four private
services.

If activation fails, the root-owned helper reports only the Owner-control container state and at
most 80 startup-log lines for the exact reviewed image before rollback removes the container. The
Owner-control logger redacts request headers, bodies, tokens, invite URLs, and passwords; this
diagnostic must remain bounded to the loopback-only Owner-control service and must run before the
count-only database session diagnostic. Rollback clears PostgreSQL's statistics snapshot after
terminating sessions so its final zero-session assertion observes the current catalog state rather
than a transaction-local stale snapshot.

## Private Owner page and first-Owner gate

The Owner-control service retains its existing VM-loopback binding. Before the public-domain stage,
use an approved SSH local-forward to `127.0.0.1:3002`. After the separately gated HTTPS workflow
passes, the only supported public route is `https://owner.fetanagent.com/owner` through the reviewed
gateway; port 3002 itself remains unpublished. The page has a fixed content-security policy, receives only the staging
publishable key as public configuration, signs in against the exact staging Auth origin, and keeps
the short-lived access token in memory only. A rotating refresh token and the fixed twelve-hour
deadline are kept only in tab-scoped session storage so a same-tab reload restores the session;
explicit sign-out or closing the tab removes that restorable session. The one-time invite receipt
is never persisted and is discarded by a reload.

Before sign-in can authorize an invite, one confirmed staging Supabase Auth user must be converted
to the first active Owner by the manual `Staging first Owner bootstrap` workflow. Create that Auth
user privately in Supabase; only its UUID belongs in the workflow input. Run `inspect` before
`bootstrap`, confirm the exact staging ref and `main` commit, and use the required one-time phrase.
The workflow must not receive an email, password, display name, access token, or service-role key.

## Synthetic deposit receiver

The manual `Staging synthetic receiver setup` workflow may configure only the fixed CBE Birr
simulation receiver `FETANAGENT STAGING SIMULATION - DO NOT PAY` with masked value `****TEST` and
the customer message `SIMULATION ONLY — DO NOT SEND MONEY.` Run `inspect` first, then use
`configure` only from the exact reviewed `main` commit with the staging ref, active Owner Auth UUID,
and confirmation phrase. The workflow rejects production, refuses to replace an unknown or real
active receiver, checks that all seven financial/provider/pilot feature switches remain disabled,
calls the ungranted legacy synthetic-only Owner procedure, and verifies the result afterward. It accepts no account
number, receiver name, transaction reference, provider credential, or payment secret.

This setup enables only the deposit-intake simulation and protected reference-storage demo. It does
not contact CBE Birr, verify a payment, submit anything to KemerBet, or authorize a tester to send
money.

## Protected runtime preflight

The manual `Staging beta runtime preflight` GitHub workflow is inspection-only. It uses the IPv4
session pooler as the PostgreSQL administrator solely to prove that the beta role remains disabled
and narrow; it cannot provision a password or invoke an application preflight. The guarded deploy
workflow is the only path that may provision the four time-limited staging logins, and their actual
read-only application preflights run on the IPv6-capable VM. Both workflows require the exact full
`main` commit and staging project reference and reject production. Neither inspection nor preflight
enables a payment/provider feature.
