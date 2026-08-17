# Deposit executor deployment boundary

## Status

[`compose.executor.yaml`](compose.executor.yaml) is the dedicated, disabled-by-default activation
composition for FetanAgent's behind-the-scenes KemerBet deposit executor. It supports only an
explicit `staging` or `production` database target and is not part of the ordinary staging Compose
inventory. The first supervised activation must target `staging`; production is a later, separate
go/no-go. Both services require an explicit profile, publish no port, and have no inbound action
endpoint.

This artifact does not deploy anything, provision a database login, change either database feature
switch, install credentials, or authorize a transfer. The database `payment_verification` and
`deposit_execution` switches remain unchanged. Starting the long-lived executor is blocked until
every item in [Activation blockers](#activation-blockers) is independently satisfied.

The two services have deliberately different capabilities:

| Service             | Profile                      | Capability                                                                                                                                                                                  |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executor`          | `executor`                   | One non-root, single-replica execution/reconciliation loop with the exact database, binding, selector, HMAC, and browser-profile inputs                                                     |
| `session-provision` | `executor-session-provision` | One transient, headed manual browser with only a single account UUID, X11 authorization, and the profile volume; no database URL, selector, binding map, HMAC key, or financial-action gate |

The long-lived service is consume-only at the database boundary. Its executor group/runtime can
execute exactly six transitions for leasing, pre-action cancellation, final-action fencing,
reconciliation handoff, reconciliation leasing, and reconciliation recording. They cannot execute
`app.enqueue_verified_deposit_execution(uuid)` or create work. Direct enqueue is internal to the
separate atomic verified-settlement function, which must be called by an independently provisioned
authoritative-verifier boundary.

The executor image uses the distribution Chromium at `/usr/bin/chromium`; Playwright downloads no
browser. Both automated and manual persistent-context launchers require Chromium's sandbox and do
not add a `--no-sandbox` argument. Activation Compose has no build section and accepts only the same
reviewed `repository@sha256:<64 lowercase hex>` image reference for both services.

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

| Container path                                       | Required content                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/run/secrets/kemerbet_executor_database_url`        | Exact target-matched direct-PostgreSQL URL for only `fetanagent_deposit_executor_runtime`, database `postgres`, port `5432`, and `sslmode=verify-full` |
| `/run/secrets/kemerbet_agent_identity_bindings`      | Unique lines of `<canonical UUID><single space><hmac-sha256-agent-identity-v1:64-lowercase-hex>`                                                       |
| `/run/secrets/kemerbet_history_reference_hmac_key`   | Exactly 64 lowercase hexadecimal characters encoding an independently generated 32-byte key                                                            |
| `/run/secrets/kemerbet_agent_identity_hmac_key`      | Exactly 64 lowercase hexadecimal characters encoding a different independently generated 32-byte key                                                   |
| `/etc/fetanagent/kemerbet-selector-contract.v1.json` | Separately reviewed selector contract v1                                                                                                               |
| `/run/configs/supabase_ca_certificate`               | Public Supabase CA downloaded and fingerprint-verified through the reviewed operator path                                                              |
| `/var/lib/fetanagent/kemerbet-sessions`              | Service-owned `0700` root with one service-owned `0700` child per bound account                                                                        |

The executor rejects symlinks, path substitution, unsafe owner/mode metadata, file replacement while
reading, equal HMAC keys, malformed or duplicate bindings, missing profiles, unauthenticated or
CAPTCHA sessions, and a visible agent identity that does not match its externally supplied binding.
Errors and health responses contain no account, player, reference, key, or credential material.

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
   HMAC keys, identity-binding map, and one exact authenticated profile for every active database
   agent account. Prove `/readyz` rejects a swapped, stale, logged-out, or CAPTCHA profile.
4. Provision a dedicated runtime LOGIN credential outside Git and prove the startup catalog
   preflight plus lifetime singleton acquisition and loss behavior. The checked-in runtime role
   scaffold is `NOLOGIN` and unprovisioned.
5. Apply the reviewed database migrations through the separate database release process, then make
   the two database feature switches live only through a separately approved operational change.
   This Compose file does not make that change.
6. Wire the authoritative verifier to the atomic verified-payment settlement/enqueue command. A
   checked-in database command without a trusted caller cannot produce an execution job.
7. Prove incident stop, circuit-open alerting, redacted logs, database and browser shutdown under
   the 60-second stop grace, fenced-action crash recovery, backups, and rollback procedures.
8. Validate the real Compose projection, file ownership, IPv6/direct-database reachability, and
   internal `/healthz` and `/readyz` behavior on the target host without performing a transfer.

The first long-lived start is a supervised `staging` go/no-go. A later `production` target requires
a separate written go/no-go with the production database role, migrations, feature switches,
secrets, profiles, CA verification, immutable image digest, and recovery evidence independently
rechecked. Any later real deposit also requires its own authorized operational procedure. Do not use
configuration rendering, image construction, or manual session provisioning as evidence that
financial execution is authorized.
