# FetanAgent TeleBirr device-state broker

This private package is the PostgreSQL side of the authenticated Ethiopian Android verifier. It
maps the bridge's exact pairing, enrollment, replay, heartbeat, and evidence-staging operations to
the dedicated routines created by
`20260904013000_private_telebirr_device_state_runtime.sql`.

The adapter uses only the short-lived `fetanagent_telebirr_device_state_runtime` login. It performs
a complete catalog and privilege preflight before every operation, keeps a single PostgreSQL
session under a process advisory lock, rejects malformed database rows, and reduces all database
or catalog drift to one non-sensitive unavailable error.

It has no generic SQL API and no table, Supabase `service_role`, claim, settlement, queue,
execution, wallet, or money capability. Pairing stores only the challenge digest. Evidence staging
does not invoke the trusted-verifier completion boundary.

The package now includes a strict local-only server for exactly those nine operations at the fixed
Unix socket `/run/fetanagent-telebirr-device-state/state.sock`. It accepts no TCP address, host,
URL, generic RPC method, or database command. Startup requires a non-root-owned runtime directory
that resolves to itself with mode `0700`; the created socket is inode-checked and mode `0600`.
Every request and response is canonical, bounded, operation/path-bound, and carries the exact
no-money safety contract.

The package now has a fail-closed executable lifecycle and the repository `Dockerfile` contains a
dedicated `telebirr-device-state-broker` target. The image runs as UID/GID `10001:10001`, exposes no
port, starts PostgreSQL before the socket, rechecks database readiness after listening, and closes
the socket before PostgreSQL. It is disabled by default and accepts no calendar stop or expiry.

The enabled staging runtime accepts only these guarded files:

- `/run/secrets/telebirr_device_state_broker_database_url`: root- or runtime-owned mode `0400`, for
  the exact `fetanagent_telebirr_device_state_runtime` role at the reviewed Supabase host with
  `sslmode=verify-full`;
- `/run/configs/supabase_ca_certificate`: root- or runtime-owned, read-only PEM CA material.

Inline database credentials, Supabase `service_role`, assignment signing/opening keys, root
reference-protection secrets, root execution, non-Linux execution, writable/substituted guarded
files, and any non-dry-run financial mode fail closed to one redacted error. The credentials,
container deployment, bridge composition, and Android enrollment are still intentionally
unprovisioned.
