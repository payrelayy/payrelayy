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

This package does not yet listen on a socket or port and is not deployed. The next composition
slice will expose these nine fixed operations through one strict local Unix-socket protocol so the
internet-facing bridge remains free of PostgreSQL code and credentials.
