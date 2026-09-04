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

There is still no executable start entrypoint and nothing is deployed or provisioned by this
package. The next composition slice will add strict file-backed configuration and a fail-closed
application lifecycle around the PostgreSQL runtime and this socket server.
