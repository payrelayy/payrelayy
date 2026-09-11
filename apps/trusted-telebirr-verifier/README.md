# Trusted TeleBirr verifier database-only consumer

This workspace contains a runnable trusted verifier with database-only staged-evidence ingress. It remains
**unprovisioned, undeployed, and disabled by default**. Adding the process shell does not activate
TeleBirr verification, create a payment claim, settle a deposit, enqueue KemerBet work, or move
money.

## What the process does

On an explicitly authorized start, the production entrypoint:

1. loads the existing fixed-path, Linux-only guarded configuration;
2. validates the staging direct PostgreSQL URL, verified CA, and canonical P-256 signer/device
   public-key pins;
3. opens exactly one direct PostgreSQL client;
4. acquires the lifetime singleton advisory lock and runs the exact catalog preflight;
5. constructs the pinned `trusted-telebirr-verifier-v1` verifier;
6. polls one existing, unexpired, database-staged signed assignment/observation pair at a time;
7. authenticates both signatures, re-reads all database authority, and invokes the existing atomic
   completion routine only for that exact attempt and lease; and
8. exposes only redacted `GET /healthz` and `GET /readyz` on `127.0.0.1:8091`.

Readiness re-proves both the singleton lock and the exact catalog preflight. It returns only the
service state and a fixed failure reason. No identifier, reference, digest, signature, key,
database detail, or financial result is returned. Every other path and every non-GET request is
rejected. There is no observation upload, lease creation, public completion, or generic request
route. Cryptographically invalid staged pairs are recorded in a separate append-only quarantine so
they cannot starve later work; the quarantine path cannot create a claim or move money.

The executable configuration requires an explicit `staging` or `production` deployment target and
binds each value to its exact Supabase direct database host and the dedicated verifier runtime role.
A missing, differently cased, or cross-wired target fails closed before the verifier can connect.

The catalog contract audits the reachable schema, relation, column, sequence, and routine surface,
not only `app`: the runtime may use only `app` and the empty `public` schema, cannot create in a
non-system schema, cannot reach any user relation, column, or sequence, and can execute exactly four
granted functions: one staged-evidence reader, one fixed invalid-evidence quarantine, the authority
reader, and the existing guarded completion routine. The hosted database's inherited PUBLIC defaults deliberately
leave `CONNECT`, `TEMPORARY`, and `public` schema `USAGE` effective. Those residual capabilities are
treated as explicit, exact preflight facts rather than hidden assumptions. They are bounded by the
single direct connection, connection limit, finite login validity, no arbitrary-SQL or public
ingress surface, fully qualified queries, empty reachable `public` schema, and operation-time role
guard; changing any audited catalog fact makes the runtime unavailable.
The disposable PostgreSQL 17 tests mirror the hosted extension boundary by installing `pgcrypto`
in the non-usable `extensions` schema. Installing its PUBLIC-executable routines in `public` would
expand the runtime's effective routine surface and correctly fail the exact-four-routine preflight.

`SIGINT` and `SIGTERM` immediately mark readiness unavailable, stop the loopback listener, release
the singleton, and close PostgreSQL. Cleanup has one fixed 15-second deadline; the Compose stop
grace is 20 seconds. Startup and runtime failures emit only one generic fail-closed message.

## Deployment artifacts (still dormant)

[`../../infra/compose.trusted-telebirr-verifier.yaml`](../../infra/compose.trusted-telebirr-verifier.yaml)
is a separate opt-in profile. Ordinary Compose startup does not select it. It requires, without
defaults:

- a reviewed immutable `repository@sha256:...` image reference;
- explicit `live`, verifier-enabled, and private-pilot-enabled gate values;
- a root-managed short-lived runtime database URL file;
- a reviewed public signer/device pin manifest; and
- the reviewed Supabase CA certificate.

The container runs as UID/GID `10001`, is read-only, drops every capability, enables
`no-new-privileges`, has bounded CPU/memory/PIDs/logs, mounts no Docker socket, publishes no port,
and joins only its dedicated outbound database network. Its health listener remains container
loopback-only. The image is built from the repository's digest-pinned Linux/amd64 Node base and
contains no runtime secret or configuration material.

The image-smoke workflow builds it with no secrets, proves the real entrypoint fails closed with all
gates off, and probes only a stubbed unavailable health boundary under `--network none`.

The separate production-only composition and manual lifecycle are documented in
[`../../infra/production-trusted-telebirr-verifier.md`](../../infra/production-trusted-telebirr-verifier.md).
That path can only plan, stage a stopped content-ID-pinned image and digest-pinned public-key
manifest, prove the runtime remains absent/`NOLOGIN`, or run independent host/database emergency
disablement. It has no activation, login-provisioning, renewal, or rollback route; its production
Compose gates are fixed off until a shared atomic database interlock is separately reviewed.

The same package also contains a strictly separate, dry-run-only shadow entrypoint. Its runtime
role, four-function database surface, singleton, health identity/port, secret path, Docker target,
and opt-in Compose profile are distinct from the live verifier. It authenticates official
observations into append-only advisory outcomes and accepts completion only when all three
financial IDs are null and `settlement_created=false`. See
[`../../docs/telebirr-shadow-verification.md`](../../docs/telebirr-shadow-verification.md) for the
exact intake RPC, seven-gate predicate, redacted status surface, and no-money deployment boundary.
The manual, immutable staging plan/deploy/status/stop lifecycle is documented separately in
[`../../infra/staging-telebirr-shadow-verifier.md`](../../infra/staging-telebirr-shadow-verifier.md).

## Existing database and verifier safety

The database migrations still leave the runtime as a `NOLOGIN` scaffold. Its group can execute
exactly the four functions described above, cannot set the group role, and receives no table,
column, sequence, schema-create, or generic routine authority. Every function rechecks the exact
short-lived runtime session at operation time. The catalog preflight audits the reachable
non-system surface before startup, every work read, every authority read, completion, quarantine,
and every readiness probe.

The verifier requires separately pinned canonical P-256 SPKI keys for the assignment signer and
enrolled device, checks both signed transcripts, performs a second authoritative database read
before completion, derives replay identity itself, and reduces logs to a fixed redacted projection.
The worker accepts evidence only from the append-only Android staging table through the dedicated
SECURITY DEFINER reader; it has no arbitrary query, URL, socket, or uploader input.

## Still required before any activation

The application slice intentionally does not:

- create or enable the runtime LOGIN/password through the disabled production lifecycle;
- generate or install an assignment-signing private key;
- enroll an Android device or install its public key;
- create the receiver profile, pilot, proof, or financial switches;
- expose an uploader, API, bot route, public listener, scheduler, or generic-worker hook; or
- deploy/start a container during build, test, staging, or any automatic trigger, or call TeleBirr,
  KemerBet, or any financial provider.

Provisioning and activation require the physical Android enrollment plus the operational
stop/expiry/revocation/rotation/rollback evidence listed in
[`../../docs/real-money-go-live-phases.md`](../../docs/real-money-go-live-phases.md).

## Local verification

These commands build and test artifacts only; they do not provision or start the service:

```powershell
pnpm --filter "@fetanagent/trusted-telebirr-verifier..." run build
pnpm --filter @fetanagent/trusted-telebirr-verifier run test
node infra/verify-trusted-telebirr-verifier-deployment.mjs
node infra/verify-telebirr-shadow-verifier-deployment.mjs
node infra/verify-telebirr-shadow-verifier-staging-lifecycle.mjs
```
