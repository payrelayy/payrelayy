# Deposit executor deployment boundary

## Status

[`compose.executor.yaml`](compose.executor.yaml) is the dedicated, disabled-by-default activation
composition for FetanAgent's behind-the-scenes KemerBet deposit executor. It supports only an
explicit `staging` or `production` database target and is not part of the ordinary staging Compose
inventory. The first supervised activation must target `staging`; production is a later, separate
go/no-go. All three Compose services require an explicit profile, publish no port, and have no
inbound action endpoint. The image also contains a separate one-time readiness-seal command; it is
not a long-running service and is never started by an ordinary deployment.

This artifact does not deploy anything, provision a database login, change either database feature
switch, install credentials, or authorize a transfer. The database `payment_verification` and
`deposit_execution` switches remain unchanged. Starting the long-lived executor is blocked until
every item in [Activation blockers](#activation-blockers) is independently satisfied.

The three services have deliberately different capabilities:

| Service                 | Profile                          | Capability                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executor`              | `executor`                       | One non-root, single-replica execution/reconciliation loop with the exact database, binding, selector, HMAC, and browser-profile inputs                                                                                                                                                                        |
| `session-provision`     | `executor-session-provision`     | One transient, headed manual browser with one account UUID, X11 authorization, the profile volume, and—only for the supervised one-time seal—the reviewed selector, identity HMAC key, exact-five Player file, and empty output; no database URL, binding map, manifest, history key, or financial-action gate |
| `no-transfer-readiness` | `executor-no-transfer-readiness` | One transient, headless, exact-five lookup probe with one bound profile, the identity key/binding, selector v2, and a one-use Player-ID file; no database credential, pilot manifest, history key, Amount operation, transfer method, or action loop                                                           |

The long-lived service is consume-only at the database boundary. Its executor group/runtime can
execute exactly six transitions: the private-pilot lease and final-action fence plus four recovery
transitions for pre-action cancellation, reconciliation handoff, reconciliation leasing, and
reconciliation recording. The legacy unscoped lease and final-action fence are not granted. The
executor cannot execute `app.enqueue_verified_deposit_execution(uuid)` or create work. Enqueue is
internal to the separate atomic private-pilot settlement boundary, which must be called by an
independently provisioned authoritative-verifier boundary.

The executor also requires one exact, externally approved pilot manifest. It contains only the
contract version, pilot-revision UUID, and configuration digest—never a Player ID, customer ID,
KemerBet agent-account ID, or credential. The database-issued lease and fence must repeat the exact
manifest values and the same immutable reservation and authorization token before the browser can
perform a Transfer action.

The executor image uses the distribution Chromium at `/usr/bin/chromium`; Playwright downloads no
browser. The long-lived executor and headed manual provisioner require Chromium's nested sandbox
and do not add a `--no-sandbox` argument. The separately hardened private-preview and one-time
readiness-seal containers use the host-verified outer container sandbox because Chromium's nested
namespace sandbox cannot initialize inside their read-only, capability-free boundary. Activation
Compose has no build section and accepts only the same reviewed
`repository@sha256:<64 lowercase hex>` image reference for every service.

Manual sign-in and the one-time seal are an explicitly trusted, supervised enrollment ceremony.
The operator already trusts the live KemerBet page while typing the credential; during that ceremony
the enrollment container's unsandboxed Chromium renderer and trusted Node process share UID `10001`
and the seal-only selector, identity HMAC, exact-five Player input, profile, and output mounts.
Therefore a compromised enrollment renderer is outside the confidentiality/containment guarantee,
even though the route guard exposes no financial endpoint and the v3 binding cannot be installed
until the exact BrowserContext has closed. Compromised-renderer containment begins only after that
terminal close, when the retained profile enters the isolated snapshot/recheck architecture below.

## Validation only

These commands inspect or build the artifacts. They do not start a service:

```powershell
node infra/verify-executor-deployment.mjs
pnpm --filter @fetanagent/executor build
pnpm --filter @fetanagent/executor test
docker build --target executor --build-arg VCS_REF=<reviewed-full-commit> `
  --build-arg FETANAGENT_CHROMIUM_PACKAGE_VERSION=<reviewed-exact-debian-version> `
  --tag <reviewed-registry>/fetanagent-deposit-executor:<reviewed-commit-tag> .
docker compose -f infra/compose.executor.yaml --profile executor config
docker compose -f infra/compose.executor.yaml --profile executor-session-provision config
docker compose -f infra/compose.executor.yaml --profile executor-no-transfer-readiness config
```

Building is separate from activation. Push the reviewed image through the approved registry path,
record its resulting manifest digest, and set `FETANAGENT_EXECUTOR_IMAGE_REFERENCE` to the complete
`repository@sha256:<64 lowercase hex>` value. Never substitute a tag, image ID, or abbreviated
digest. Set `FETANAGENT_EXECUTOR_DEPLOYMENT_TARGET=staging` for the first supervised activation.
With those two non-secret values set, rerun `node infra/verify-executor-deployment.mjs` and both
Compose projection commands. Account/display values safely default to empty and external inputs
safely default to fixed host paths, so rendering one inactive profile does not require the other
profile's data. Do not use a real secret merely to render the configuration. Docker is not available
in every local development environment; the checked-in static verifier remains mandatory even when
Docker-based validation is also performed.

## Manual session provisioning

The provisioner creates or reuses exactly
`/var/lib/fetanagent/kemerbet-sessions/<platform-agent-account-uuid>` with mode `0700`, opens one
headed browser, and then waits for the browser to close or for `SIGINT`/`SIGTERM`. It does not
navigate, read a page, or perform any financial action. The operator controls the visible browser
manually. It must run while the long-lived executor is stopped.

Prepare the host profile root once with the container service identity:

```bash
sudo install -d -o 10001 -g 10001 -m 0700 /var/lib/fetanagent/kemerbet-sessions
```

Use a dedicated local X11 display and a copied, least-privilege Xauthority file owned by UID/GID
`10001` with mode `0400`. Do not mount a general credential directory or share a browser profile
between accounts. After the reviewed image exists, the transient command is:

```bash
docker compose -f infra/compose.executor.yaml \
  --profile executor-session-provision run --rm session-provision
```

The required non-secret Compose inputs are the reviewed immutable image reference, one canonical
platform-agent-account UUID, and the dedicated display name. The Xauthority source is an external
file input. The Compose file mounts the X11 socket read-only and gives this service no executor
secret or configuration object.

## External executor inputs

Nothing below belongs in Git or a shared `.env` file. Production paths inside the container are
fixed by `@fetanagent/config`:

| Container path                                                                    | Required content                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/run/secrets/kemerbet_executor_database_url`                                     | Exact target-matched direct-PostgreSQL URL for only `fetanagent_deposit_executor_runtime`, database `postgres`, port `5432`, and `sslmode=verify-full`                                                                |
| `/run/secrets/kemerbet_agent_identity_bindings`                                   | Unique v3 lines of `<canonical UUID> hmac-sha256-agent-identity-v1:<64-lowercase-hex> hmac-sha256-agent-profile-pin-v3:<same 64-lowercase-hex>`; the one-account readiness artifact is exactly 230 bytes including LF |
| `/run/secrets/kemerbet_history_reference_hmac_key`                                | Exactly 64 lowercase hexadecimal characters encoding an independently generated 32-byte key                                                                                                                           |
| `/run/secrets/kemerbet_agent_identity_hmac_key`                                   | Exactly 64 lowercase hexadecimal characters encoding a different independently generated 32-byte key                                                                                                                  |
| `/run/secrets/kemerbet_no_transfer_readiness_player_ids`                          | Exactly five distinct canonical Player IDs, one per line; one-use Phase 1 input, never logged, committed, retained as a pilot manifest, or mounted into the long-lived executor                                       |
| `/run/fetanagent-kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings` | One-time, atomically created mode-`0600` identity-binding output; the command refuses to overwrite an existing file                                                                                                   |
| `/run/configs/private_live_deposit_pilot.v1.json`                                 | Canonical one-line JSON with exact ordered keys `contractVersion`, `pilotRevisionId`, `configurationDigest`; no Player, customer, or account identifiers                                                              |
| `/etc/fetanagent/kemerbet-selector-contract.v2.json`                              | Separately reviewed selector contract v2                                                                                                                                                                              |
| `/run/configs/supabase_ca_certificate`                                            | Public Supabase CA downloaded and fingerprint-verified through the reviewed operator path                                                                                                                             |
| `/var/lib/fetanagent/kemerbet-sessions`                                           | Service-owned `0700` root with one service-owned `0700` child per bound account                                                                                                                                       |

The executor rejects symlinks, path substitution, unsafe owner/mode metadata, file replacement while
reading, equal HMAC keys, malformed or duplicate bindings, missing profiles, unauthenticated or
CAPTCHA sessions, and a visible agent identity that does not match its externally supplied binding.
Errors and health responses contain no account, player, reference, key, or credential material.

## Five-Player no-transfer readiness

### One-time identity binding and target-host seal

The first target-host proof uses the same `readiness:seal` boundary inside the private sign-in
service. KemerBet keeps this account's authenticated state in the running Chromium process, so the
Owner preview must report a successful KemerBet sign-in and remain open while the one-time private
Unix-socket endpoint starts. The seal adds a stricter route for its lifetime: only `GET`, `HEAD`, and
`OPTIONS` are permitted, the only main-frame destination is exact `/agents`, and every POST—including
the deposit endpoint—is blocked before it reaches the network. The serialized service lane prevents
preview input, stop, or another seal request from interleaving with the proof. After the fifth
validated lookup, that route enters a terminal latch and the service must successfully close the
exact BrowserContext, clear the retained page/account/timer state, and become inactive before any
binding can be written; close failure produces no binding.

The seal receives only one canonical platform-account UUID, the identity HMAC key, the reviewed
selector v2 file, the exact-five one-use Player-ID file, the persistent profile volume, and an empty
service-owned mode-`0700` output directory. It receives no database URL, existing binding, pilot
manifest, history-reference key, Amount operation, settlement authority, or action loop. For every
one of the exact five actual GETs, it reads the transport-visible duplicate-preserving headers,
requires exactly one canonical bearer, and timing-safely pins the SHA-256 of the exact `Bearer …`
bytes. It accepts each observation only after that request's HTTP 200, non-redirected, bounded raw
Player/ETB response passes the strict validator. Raw authorization and response buffers are cleared;
only an in-memory digest survives between observations, and that digest is destroyed after the
five-request consistency proof. After all five validations and the confirmed BrowserContext close,
the seal atomically writes the exact 230-byte v3 UUID, identity-HMAC fingerprint, and stable Profile
pin. The two labeled HMAC fields contain the same 64-lowercase-hex digest; no bearer-derived value is
written. Its only successful log projection is:

```text
KemerBet readiness sealed: 5 of 5 Players, Transfer disabled.
```

Use the reviewed executor image and the target's existing profile volume. Mount the key and Player
file read-only at their fixed paths, the checked-in
`infra/config/kemerbet-selector-contract.v2.json` read-only at the fixed selector path, and an empty
UID/GID `10001`, mode-`0700` directory at the fixed output root. Set only these inert runtime values:

```text
NODE_ENV=production
FINANCIAL_ACTIONS_MODE=dry_run
KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true
KEMERBET_AGENT_IDENTITY_BINDING_ACCOUNT_ID=<one canonical UUID>
KEMERBET_EXECUTOR_ENABLED=false
KEMERBET_FINAL_ACTION_ENABLED=false
KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false
INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false
```

On the staging host, invoke `POST /v1/readiness/seal` with only a fresh UUID request ID through the
mode-`0600` Unix socket shared by Owner control and the sign-in service. The service itself runs as
UID/GID `10001:10001` in a read-only, capability-free, no-new-privileges container with a
`noexec,nosuid` temporary filesystem and bounded CPU, memory, PID, and shared-memory limits. A
successful response is aggregate-only: five Players checked, ETB, Transfer disabled, no money moved,
and identifiers redacted. After success, install the atomically produced binding as the fixed
Owner-managed identity-binding secret without printing its contents. Securely delete the one-use
Player file after the later independent recheck no longer needs it.

### Current v2-to-v3 stable-profile successor migration

The runtime and recheck accept only the exact v3 stable-profile binding above. An existing 230-byte
v2 source binding is migration evidence, not a runtime credential: do not edit it, copy its bearer
digest into v3, run an ordinary helper replacement, or repeat the v1 retirement ceremony. Use only
the reviewed, one-use root-console migration
[`infra/operations/fetanagent-kemerbet-v2-v3-successor-migration.sh`](operations/fetanagent-kemerbet-v2-v3-successor-migration.sh).
It is intentionally separate from the deployment helper because the predecessor retirement gate
blocks ordinary release and helper replacement.

Before opening the DigitalOcean root console, independently approve all six positional inputs: the
40-lowercase-hex predecessor release, 40-lowercase-hex successor release, predecessor-helper
SHA-256, exact v2 binding SHA-256, successor-helper SHA-256, and this exact confirmation:

```text
I-UNDERSTAND-THIS-ARCHIVES-V2-AND-INSTALLS-THE-V3-SUCCESSOR
```

From the exact reviewed successor commit, stage the migration script and successor helper in the
root-owned mode-`0700` directory
`/root/fetanagent-v3-successor-<successor-release>/`. The helper must be the root-owned mode-`0600`
file `fetanagent-staging-deploy-helper.next`. Independently SHA-verify both staged files against that
commit before continuing; never fetch a moving branch or print the binding. Then run exactly once as
the direct `root` console identity, without `sudo`, `DOCKER_HOST`, or `DOCKER_CONTEXT` overrides:

```bash
bash "/root/fetanagent-v3-successor-$SUCCESSOR_RELEASE/fetanagent-kemerbet-v2-v3-successor-migration.sh" \
  "$PREDECESSOR_RELEASE" \
  "$SUCCESSOR_RELEASE" \
  "$PREDECESSOR_HELPER_SHA256" \
  "$V2_BINDING_SHA256" \
  "$SUCCESSOR_HELPER_SHA256" \
  I-UNDERSTAND-THIS-ARCHIVES-V2-AND-INSTALLS-THE-V3-SUCCESSOR
```

The script verifies the fixed Droplet, stops the staging project through the exact predecessor
helper, reattests the completed v1-to-v2 evidence and exact v2 source, acquires the root mutation
lock, and disables the helper sudoers grant before it creates or synchronizes any successor
namespace. The canonical root-owned v1 retirement directory remains
in place as immutable continuity evidence; the separate four-entry successor overlay archives only
the exact v2 binding and predecessor helper alongside its intent and completion records. The script
derives v3 only by replacing the bearer-digest field with
`hmac-sha256-agent-profile-pin-v3:<identity-HMAC-digest>`, preserving the exact UUID, stable identity
digest, 230-byte size, and LF. It installs the reviewed successor helper, writes durable intent and
completion records below `/var/lib/fetanagent/kemerbet-readiness-v2-v3-successor/`, reattests the v3
source, and restores the exact sudoers grant. It does not contact a financial endpoint, enable
Transfer, or move money.

After success, do not start the long-lived executor or use an ordinary deployment as a substitute
for proof. Use only the reviewed successor release to perform a fresh private KemerBet sign-in when
needed and the independent exact-five no-transfer recheck. The first candidate bearer may reach only
the fixed read-only Profile request until its stable Profile HMAC matches the v3 pin; only then may a
Player lookup proceed. A later fresh bearer for that same stable Profile can be validated in a new
run without resealing.

The helper derives three fail-closed lifecycle states from existing artifacts. `successor-installed`
requires the exact four-entry overlay, service-owned one-use v3 source, and the historical successor
helper bytes, and permits only the bounded same-release no-transfer deployment/sign-in/recheck path.
Before its `install` handler may replace a sealed Compose file, service secret, or image, the helper
requires a disarmed expiry guard, no Telegram startup receipt, zero project containers and networks,
no recheck transients, the exact two durable KemerBet volumes, and no profile or session-control volume
holders. It reattests `successor-installed` before and after that read-only preflight, and both install
and startup require the `deposit-executor` image revision to match the reviewed release. A retryable
existing Player-ID service copy returns only after exact v3 binding and same-release successor
reattestation. Component stops use the successor state directly, consult historical v1 state only when
the successor overlay is absent, and preserve the exact successor release/state across teardown.
`successor-recheck-recoverable` additionally requires a canonical root-owned promotion boundary;
the recheck-recovery handler then validates its exact journal and artifact topology before any
mutation. This state permits only exact-release recheck recovery or safe teardown.
`successor-completed` is derived only
after the promotion journal, one-use source, one-use Player file, candidate directory, and RPC
directory are absent and the durable root-only `ready-v1` receipt, canonical root-owned v3 binding,
and exact Owner completion record agree. No additional overlay completion marker is written. Once
that durable terminal state exists, ordinary future helper/release changes may resume without being
bound to the historical successor-helper digest, but every legacy v1/v2 seal, retirement, and
recovery command remains permanently forbidden.

The migration is resumable only by rerunning the same reviewed script with the same six inputs. An
exact disabled-grant state with no prefix is accepted only as a bounded `fresh-disabled` recovery;
the script then creates the durable prefix while the grant remains disabled. If the script leaves an
`.installing` directory or reports any continuity error, do not manually restore, rename, delete, or
rewrite an artifact. Leave staging offline and rerun the exact migration or investigate read-only.
Before the independent recheck consumes the one-use v3 source, a completed rerun with the original
successor helper only reattests the installed successor. After `successor-completed` is derived—or
after a later approved helper rotation—do not rerun the migration; use the normal helper path.

### Historical audit record: v1-to-v2 retirement and recovery

The remainder of this section records the superseded v1-to-v2 transition and its recovery controls.
It is retained for evidence continuity only. Do not use its v2 seal, provider-token rotation, helper
replacement, or recovery commands to operate the v3 successor.

The former two-field v1 binding is deliberately incompatible with this boundary and cannot be
upgraded in place. Its one-time transition is an explicit, user-confirmed retirement and same-claim
reseal ceremony; normal deploy, start, and seal commands never retire it automatically. The
operator must submit the previously reviewed v1 file SHA-256 and the exact retirement confirmation,
`I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL`, through only the manual
`retire-v1-for-v2-reseal` workflow mode, then resume only on the same reviewed commit. A durable root-owned intent and archive preserve the
old UUID/fingerprint projection while the old file is consumed. While that retirement is pending,
the global helper gate blocks helper/release replacement and unrelated state-expanding commands; it
allows only the explicit same-commit retirement resume, private-session start/readiness/seal needed
to create v2, and safe teardown or diagnostics. The seal accepts only a new 230-byte v2 binding
whose UUID/fingerprint projection matches the archived v1 artifact, then records a distinct
`resealed-awaiting-recheck` state. That state still blocks install, fresh start, helper or release
replacement, and every unrelated mutation; only the same-release independent recheck plus safe
teardown or diagnostics may proceed. The gate unlocks only after that recheck commits the immutable
canonical binding and exact success receipt and revalidates their release, binding, key, and v1
projection continuity. This migration alone does not require rotating the provider token; any later
provider-token rotation does require a new supervised v2 seal before another recheck.

If automatic staging expiry removes the disposable runtime secrets while this migration is still
pending or `resealed-awaiting-recheck`, do not run ordinary deploy, helper install, fresh start,
image transfer, Compose replacement, or provider-token rotation. Dispatch only the dedicated
`recover-v1-retirement-after-expiry` mode from the current reviewed protected-`main` workflow and type
`I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE`. That recovery surface validates the
separate explicit `confirm_v1_retirement_release_sha`, requires that exact 40-character retirement
release to be an ancestor of the current workflow commit, and derives the expected helper plus role
provision/disable SQL as canonical LF blobs with `git show <release>:<fixed-path>`. It verifies the
installed helper against that historical release and passes the explicit release to the durable
intent gate; it never substitutes the current `GITHUB_SHA`. The surface validates the real staging
bot identity. Before bundle creation, upload, database-role provisioning, or any remote mutation, it
SHA-verifies the installed historical helper and calls only the read-only
`kemerbet-v1-retirement-recovery-ready <explicit-release>` preflight. That command attests the exact
intent release/current context, full-expiry zero-runtime boundary, pinned release assets, helper
identity, and either a clean initial boundary or an exact helper-recognized safe-to-reset crash
residue; malformed or foreign residue fails while every mutation flag remains false. Only after
that proof does the job arm rollback, disable stale roles, run the SHA-verified helper `stop`, and
call the read-only preflight again. The second result must be exactly clean before a local bundle is
created. During that stop, an incomplete temp-only binding prefix is discarded. An exact complete
230-byte temp must first project to the archived v1 identity; normalization atomically hard-links it
to the absent final name, removes the temp link, synchronizes the directory, and reattests the same
inode, single link, and content. A final-plus-same-inode temp likewise removes only the temp link and
preserves the final v2 artifact. The preserved final artifact is then offline-finalized to exact
`resealed-awaiting-recheck` continuity. Recovery uploads the exact 23-file bundle only into a
run-unique mode-`0700` staging
directory, captures that directory's device/inode, marks only that identity as run-owned, and uses
an atomic no-replace rename plus parent-directory synchronization to publish the fixed
`/tmp/fetanagent-kemerbet-v1-retirement-secrets-<40-hex-release>` input. It then provisions fresh
24-hour database roles, invokes only `reinstall-kemerbet-v1-retirement-secrets`, starts the exact
private core, arms its derived expiry, then starts and verifies the bot and public edge in order.
Before reinstalling, the helper accepts exactly the two durable project volumes
`fetanagent-staging-beta_kemerbet_sessions` and
`fetanagent-staging-beta_kemerbet_session_control`, with their exact local driver/scope, three
Compose labels, canonical Docker mount paths, mode/owner contract, zero holders, and re-attested
single-account profile and failed exact-five cohort. Any readiness snapshot/RPC/output volume,
third project volume, holder, label/option drift, or other transient residue fails closed.
Its EXIT guard SHA-verifies helper teardown after any attempted mutation, disables any attempted
role provision or reset, and independently validates and removes only the run-owned device/inode at
its exact staging, incoming, or atomic `.consumed` path without reading or logging secret contents.
A preflight failure cannot clean or mutate pre-existing residue, and ambiguous simultaneous paths,
an identity mismatch, or an unsafe entry fails cleanup closed. A still-pending retirement
may then resume the private-session readiness and supervised seal on that release. A resealed state
must never reopen the private sign-in ceremony; it proceeds directly to the same-release independent
recheck. Only the committed binding plus exact receipt continuity unlocks normal release mutation.

### Independent bound-profile recheck

Run this only after the Owner has completed manual session provisioning and the visible signed-in
identity has been independently HMAC-bound to the one active agent-account UUID. The source Player
file is a short-lived operator secret built from the exact five saved, active, valid, currently
eligible KemerBet accounts. Do not pass its contents through command arguments, environment
variables, GitHub inputs, chat, screenshots, or logs.

The readiness service deliberately receives no database URL, private-pilot manifest,
history-reference key, executor switch, or final-action switch. It checks the authenticated agent
identity first, performs the five response-bound ETB lookups sequentially, never fills Amount or
Notes, and exposes no transfer method.

The target-host staging proof uses three simultaneously created but separately privileged services,
not a dynamically attached all-in-one browser. The UID/GID-`10002` controller is control-only and
has no profile, selector, browser executable, proxy signing material, or Internet route. The
UID/GID-`10001` browser joins only the fixed control and proxy bridges and receives the selector,
one-run RPC capability, a file-based account UUID, and a disposable profile snapshot. The
UID/GID-`10003` trusted Layer-7 proxy joins only the fixed proxy and egress bridges and receives the
proxy-only key, nonce, reviewed release SHA, physically separate proxy-only copies of the canonical
agent-identity binding and its HMAC key, and an empty completion-output directory. None of the three
services publishes a port. Static dual-stack addresses and the fixed RPC/proxy destinations are part
of the reviewed contract; both isolated bridges have zero usable default routes.

Before those three services start, two root-run, network-`none` profile jobs copy the exact account
directory from the long-lived session volume into a fresh external snapshot volume and then remount
and verify that snapshot read-only. Only the verified snapshot-volume root is handed to UID/GID
`10001`; the original `kemerbet_sessions` volume is never mounted into the browser. A separate
UID/GID-`10004`, network-`none` authorizer receives the exact-five Player file and physically separate
copies of the one-run signing key and nonce. It atomically pre-mints exactly five sequence- and
Player-bound lookup tokens. The controller receives only that completed token file, never a signing
key or nonce, while the proxy receives no Player cohort. Snapshot traversal rejects any file larger
than 256 MiB and rejects more than 1 GiB of cumulative logical or actually read regular-file bytes;
the streaming copy/hash path reads one byte beyond each remaining ceiling and fails before writing
overflow data. Source traversal alone omits the exact top-level `SingletonCookie`, `SingletonLock`,
and `SingletonSocket` entries only when two stable `lstat` observations prove each is a symlink; it
never follows, copies, or hashes them. Those names as files/directories, every nested or other
symlink, and every such entry in the completed snapshot or strict `verify` traversal fail closed.
Post-run re-attestation of the original profile uses the distinct `verify-original` command, which
reuses only the source omission rule; it cannot weaken completed-snapshot verification. A rejected
partial copy is destroyed with the disposable volume.

The host creates and attests all three networks and all three service containers before installing
separate controller and browser network-namespace firewalls. Each firewall operation uses a
PID-reuse-resistant network-namespace descriptor that is opened only after exact container
inspection, re-attested against the container and `/proc` path, held through release and post-release
firewall verification, and closed before container removal. The host then publishes a distinct
immutable firewall-release file to each process; there is no pause, dynamic network attachment, or
shared release protocol. Chromium starts offline with last-session restore enabled, suppresses the
otherwise automatic fresh `about:blank` tab, disables speculative transports and prediction, maps
only the three reviewed KemerBet hosts to the fixed proxy, and maps every other hostname to
`~NOTFOUND`. It accepts exactly one restored page at the byte-exact canonical `/agents` URL. That
same page is retained because KemerBet's authorization is scoped to the tab's `sessionStorage`; the
service never reads, copies, exports, or logs that storage. Zero, multiple, replaced, closed, crashed,
or noncanonical restored pages—or any unexpected navigation, WebSocket, service worker, or network
topology change—fail closed.

Before it can become application-ready, the trusted proxy fetches the exact `/agents` document and
the seven pinned v84 bootstrap assets sequentially in one fixed, data-independent order with fixed
headers. Every response must be HTTP 200 without a redirect, absent or exact `identity` content
encoding, at most 8 MiB per entry, and at most 32 MiB in aggregate. The isolated renderer receives
those eight resources only from the proxy's private in-memory cache; repeated, reordered, or
concurrent renderer requests cause no new upstream bootstrap traffic. Partial and terminal caches
are zeroed. Only after the complete cache, listening socket, and post-listen dual-homed topology
attestation pass does the proxy atomically publish a mode-`0600`, UID/GID-`10003`, one-link marker at
`/tmp/fetanagent-kemerbet-readiness-layer7-proxy.ready` in its private `/tmp` tmpfs, containing only
`fetanagent-kemerbet-readiness-layer7-proxy-ready-v1` plus LF. Compose validates the marker with
`O_NOFOLLOW`, inode-stability, exact content, and extra-byte checks; the browser cannot mount or read
that tmpfs. The host does not start the browser until this application health check is exact.

For the first lookup, the proxy accepts only a syntactically exact sanitized bearer and sends it only
to one independent, read-only `GET /Account/Profile`; no Player lookup reaches KemerBet first. It
requires HTTP 200, identity encoding, strict bounded UTF-8/JSON, `resultCode: 0`, and the exact bounded
`value.userName`; it recomputes the account-scoped Profile HMAC from the proxy-only account
UUID/binding/key and timing-safely compares it with the v3 stable Profile pin. Only after that match
does it pin the complete bearer digest in memory and permit the first Player lookup. The same bearer
must match for sequences two through five. Any malformed profile, wrong agent, bearer drift, race,
abort, timeout, or disconnect is sticky-fatal and produces no receipt. A new run may validate a new
bearer for the same stable Profile; no bearer or refresh material is stored in the binding. For
each accepted lookup, the proxy independently validates the exact requested Player response and ETB
currency and completes the sequence only after the downstream response finishes. After sequence five
it atomically writes the canonical `fetanagent-kemerbet-readiness-layer7-completion-v3` generic,
identifier-redacted completion receipt with `version: 3`, `sameAgentIdentityValidated: true`,
`stableAgentProfileValidated: true`, and the SHA-256 of the exact canonical binding-file bytes, bound
to the reviewed release and one-run nonce.
The host accepts controller/browser success only with that exact proxy receipt, then removes every
transient container, network, capability, token, firewall release, output directory, and disposable
snapshot volume.

The trusted Layer-7 proxy is part of the trusted computing base. A proxy RCE or proxy-process
compromise is outside this fail-closed guarantee: the proxy terminates KemerBet TLS, necessarily sees
the current bearer and Player identifier, and owns the only egress route, so compromise could bypass
the reviewed Layer-7 policy. Operation therefore depends on the pinned, reviewed image and source,
plus the documented privilege, network, mount, and lifecycle isolation around that proxy.

Its only successful log projection is:

```text
KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.
```

Run it while the long-lived executor is stopped:

```bash
docker compose -f infra/compose.executor.yaml \
  --profile executor-no-transfer-readiness run --rm no-transfer-readiness
```

After the command exits, securely remove the host source for
`kemerbet_no_transfer_readiness_player_ids`. A successful local portal check or a successful image
test is not a substitute for this exact target-host profile proof.

The database target is mandatory whenever the execution runtime is enabled:

| `KEMERBET_EXECUTOR_DEPLOYMENT_TARGET` | Project reference      | Required direct host                  |
| ------------------------------------- | ---------------------- | ------------------------------------- |
| `staging`                             | `spzpiyxheappsfyswewl` | `db.spzpiyxheappsfyswewl.supabase.co` |
| `production`                          | `xzztugbgtulptnbpoelr` | `db.xzztugbgtulptnbpoelr.supabase.co` |

The configuration rejects a missing, differently cased, or unknown target and rejects a database
URL whose host or dedicated runtime login does not match that target. `NODE_ENV=production` is a
runtime-hardening requirement and does not imply the `production` database target.

The executor uses one direct PostgreSQL client for its entire lifetime. That session acquires a
non-blocking, executor-specific advisory lock before the first authenticated browser-session probe,
then carries every catalog check and execution/reconciliation RPC. A second executor fails closed.
Loss of that session makes readiness false and prevents any later lease/RPC on it. Shutdown closes
browser profiles first, releases the advisory lock when the session is still available, and then
ends the database connection.

Local Docker Compose implementations may realize file-backed `secrets` and `configs` as bind
mounts and may not honor requested `uid`, `gid`, or `mode` remapping. Before activation, inspect the
files from a no-action diagnostic image/process and prove that UID `10001` can read them while each
loader still observes only owner UID `0` or `10001`, no group/world write bits, no symlink, and the
exact fixed path. A host source owned by `10001:10001` with mode `0400` is the conservative
file-backed-secret choice. Do not weaken the application checks to accommodate an engine.

## Activation blockers

Do not run `docker compose ... --profile executor up` until all of these are closed:

1. Select an exact Debian Chromium package version from the pinned base image's reviewed repository,
   pass it as `FETANAGENT_CHROMIUM_PACKAGE_VERSION`, build and vulnerability-review the image, and
   record its registry manifest digest. Configure the same complete immutable image reference for
   both services and prove the rendered Compose projection contains no tag or build section. The
   build fails unless the package is exact and its major equals the Chromium
   contract shipped by exact-pinned `playwright-core@1.62.1`. Other apt dependencies still come from
   the moving Debian repository, so the resulting image digest—not the Dockerfile alone—is the
   deployable unit.
2. Prove non-root Chromium sandbox startup on the exact target kernel with `cap_drop: ALL`,
   `no-new-privileges`, the read-only root filesystem, and no `--no-sandbox` fallback. A failed
   sandbox probe is a launch blocker, not a reason to disable the sandbox.
3. Provision and review the fingerprint-verified public Supabase CA, selector contract, distinct
   HMAC keys, identity-binding map, exact private-pilot manifest, and one exact authenticated
   profile for every active database agent account. Prove the manifest exactly matches the armed
   database revision/configuration digest and contains no Player, customer, or account identifier.
   Prove `/readyz` rejects a swapped, stale, logged-out, or CAPTCHA profile.
4. Provision a dedicated runtime LOGIN credential outside Git and prove the startup catalog
   preflight plus lifetime singleton acquisition and loss behavior. The checked-in runtime role
   scaffold is `NOLOGIN` and unprovisioned.
5. Apply the reviewed database migrations through the separate database release process. Prepare
   and arm exactly one five-Player pilot revision while every financial switch remains disabled,
   then make only the pilot-scoped verification, execution, and final-action switches live through
   a separately reviewed activation migration and Owner operation. This Compose file cannot arm a
   pilot or change a database switch.
6. Wire the authoritative verifier to the atomic private-pilot verified-payment
   settlement/enqueue command. It must create only receipt-derived, independently verified proof
   lineage and an immutable capped reservation. A checked-in database command or advisory outcome
   without that trusted caller cannot produce an execution job.
7. Prove incident stop, circuit-open alerting, redacted logs, database and browser shutdown under
   the 60-second stop grace, fenced-action crash recovery, backups, and rollback procedures.
8. Validate the real Compose projection, the manifest/config/secret ownership, IPv6/direct-database
   reachability, and internal `/healthz` and `/readyz` behavior on the target host without
   performing a transfer. Confirm the private-pilot gate, manifest contract version, and redacted
   configured state in startup logs without logging its revision UUID or digest.

The first long-lived start is a supervised `staging` go/no-go. A later `production` target requires
a separate written go/no-go with the production database role, migrations, feature switches,
secrets, profiles, CA verification, immutable image digest, and recovery evidence independently
rechecked. Any later real deposit also requires its own authorized operational procedure. Do not use
configuration rendering, image construction, or manual session provisioning as evidence that
financial execution is authorized.
