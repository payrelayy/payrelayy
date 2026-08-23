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

| Service                 | Profile                          | Capability                                                                                                                                                                                                                                           |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executor`              | `executor`                       | One non-root, single-replica execution/reconciliation loop with the exact database, binding, selector, HMAC, and browser-profile inputs                                                                                                              |
| `session-provision`     | `executor-session-provision`     | One transient, headed manual browser with only a single account UUID, X11 authorization, and the profile volume; no database URL, selector, binding map, HMAC key, or financial-action gate                                                          |
| `no-transfer-readiness` | `executor-no-transfer-readiness` | One transient, headless, exact-five lookup probe with one bound profile, the identity key/binding, selector v2, and a one-use Player-ID file; no database credential, pilot manifest, history key, Amount operation, transfer method, or action loop |

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

| Container path                                                                    | Required content                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/run/secrets/kemerbet_executor_database_url`                                     | Exact target-matched direct-PostgreSQL URL for only `fetanagent_deposit_executor_runtime`, database `postgres`, port `5432`, and `sslmode=verify-full`                          |
| `/run/secrets/kemerbet_agent_identity_bindings`                                   | Unique lines of `<canonical UUID><single space><hmac-sha256-agent-identity-v1:64-lowercase-hex>`                                                                                |
| `/run/secrets/kemerbet_history_reference_hmac_key`                                | Exactly 64 lowercase hexadecimal characters encoding an independently generated 32-byte key                                                                                     |
| `/run/secrets/kemerbet_agent_identity_hmac_key`                                   | Exactly 64 lowercase hexadecimal characters encoding a different independently generated 32-byte key                                                                            |
| `/run/secrets/kemerbet_no_transfer_readiness_player_ids`                          | Exactly five distinct canonical Player IDs, one per line; one-use Phase 1 input, never logged, committed, retained as a pilot manifest, or mounted into the long-lived executor |
| `/run/fetanagent-kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings` | One-time, atomically created mode-`0600` identity-binding output; the command refuses to overwrite an existing file                                                             |
| `/run/configs/private_live_deposit_pilot.v1.json`                                 | Canonical one-line JSON with exact ordered keys `contractVersion`, `pilotRevisionId`, `configurationDigest`; no Player, customer, or account identifiers                        |
| `/etc/fetanagent/kemerbet-selector-contract.v2.json`                              | Separately reviewed selector contract v2                                                                                                                                        |
| `/run/configs/supabase_ca_certificate`                                            | Public Supabase CA downloaded and fingerprint-verified through the reviewed operator path                                                                                       |
| `/var/lib/fetanagent/kemerbet-sessions`                                           | Service-owned `0700` root with one service-owned `0700` child per bound account                                                                                                 |

The executor rejects symlinks, path substitution, unsafe owner/mode metadata, file replacement while
reading, equal HMAC keys, malformed or duplicate bindings, missing profiles, unauthenticated or
CAPTCHA sessions, and a visible agent identity that does not match its externally supplied binding.
Errors and health responses contain no account, player, reference, key, or credential material.

## Five-Player no-transfer readiness

### One-time identity binding and target-host seal

The first target-host proof uses the same `readiness:seal` boundary inside the private sign-in
service. KemerBet keeps this account's authenticated state in the running Chromium process, so the
Owner preview must report a successful KemerBet sign-in and remain open while the one-time private
Unix-socket endpoint runs. The seal adds a stricter route for its lifetime: only `GET`, `HEAD`, and
`OPTIONS` are permitted, the only main-frame destination is exact `/agents`, and every POST—including
the deposit endpoint—is blocked before it reaches the network. The serialized service lane prevents
preview input, stop, or another seal request from interleaving with the proof.

The seal receives only one canonical platform-account UUID, the identity HMAC key, the reviewed
selector v2 file, the exact-five one-use Player-ID file, the persistent profile volume, and an empty
service-owned mode-`0700` output directory. It receives no database URL, existing binding, pilot
manifest, history-reference key, Amount operation, settlement authority, or action loop. It writes
the binding only after the authenticated identity is observed twice and all five response-bound ETB
lookups pass. Its only successful log projection is:

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

### Independent bound-profile recheck

Run this only after the Owner has completed manual session provisioning and the visible signed-in
identity has been independently HMAC-bound to the one active agent-account UUID. The source Player
file is a short-lived operator secret built from the exact five saved, active, valid, currently
eligible KemerBet accounts. Do not pass its contents through command arguments, environment
variables, GitHub inputs, chat, screenshots, or logs.

The readiness service deliberately receives no database URL, private-pilot manifest,
history-reference key, executor switch, or final-action switch. It checks the authenticated agent
identity first, performs the five response-bound ETB lookups sequentially, never fills Amount or
Notes, and exposes no transfer method. Its only successful log projection is:

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
