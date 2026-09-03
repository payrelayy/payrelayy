# Private TeleBirr assignment broker

This export-only package is the private half of the Android device bridge. It leases one already
eligible TeleBirr proof, opens the provider-bound protected reference with a scoped child key,
constructs and signs the exact short-lived device assignment, and persists only the signature and
digest transcript required for exact lost-ack replay.

The broker never receives the API encryption master or fingerprint master. It accepts no raw
reference, amount, claim, settlement, wallet, execution, or KemerBet dependency. The only plaintext
reference comes from the callback-scoped opener and exists in the signed assignment long enough to
reach the already authenticated phone.

The included PostgreSQL adapter holds one direct singleton connection and audits the runtime's
effective catalog surface before every lease or persistence call. Its matching forward migration
creates a dormant `NOLOGIN` scaffold with exactly two guarded routines and no base-table access.

The package now also exposes a local-only server factory for the one fixed Unix socket
`/run/fetanagent-telebirr-assignment-broker/assignment.sock`. It accepts only one canonical,
bounded `POST /v1/assignment:poll` contract. The pre-created runtime directory must be owned by the
non-root process at mode `0700`; the server verifies it before and after binding and verifies the
socket at mode `0600`. It accepts no host, TCP port, generic RPC method, opening command, or
credential. Broker failures leave the process only as an opaque temporary-unavailable response.

The broker now has a fail-closed start entrypoint and a dedicated non-root container target. Startup
is disabled by default and succeeds only on Linux when all of these independent no-money gates are
exact: production Node mode, `FINANCIAL_ACTIONS_MODE=dry_run`, the internal broker gate, the
broker-specific no-money pilot gate, and the staging target. It accepts no inline secret and rejects
API/service-role credentials and both reference-protection master-key names.

Enabled startup reads only these fixed files through `lstat`/`realpath`/`O_NOFOLLOW`/`fstat`
before-and-after checks. Every file must be owned by root or the effective non-root runtime user;
the actual mount permissions must allow that runtime user to open it:

- `/run/secrets/telebirr_assignment_broker_database_url` — mode `0400`, the dedicated short-lived
  runtime login on the exact direct staging host with `sslmode=verify-full`;
- `/run/secrets/telebirr_assignment_broker_reference_opening_key.v1.json` — mode `0400`, only the
  TeleBirr/purpose-scoped child key and its fingerprint;
- `/run/secrets/telebirr_assignment_broker_runtime_manifest.v1.json` — mode `0400`, canonical
  signer, opening-key, pilot, receiver-profile, and normalized credited-party bindings;
- `/run/secrets/telebirr_assignment_broker_signer.pkcs8.der` — mode `0400`, canonical P-256 PKCS#8
  material whose derived SPKI digest must match the manifest; and
- `/run/configs/supabase_ca_certificate` — immutable mode `0400`, `0440`, or `0444` CA material,
  also pinned by `NODE_EXTRA_CA_CERTS` and passed directly to the PostgreSQL client.

The application establishes and preflights the singleton direct PostgreSQL connection before
binding the local socket, checks it again after binding, and closes the socket before database
authority. Startup, readiness, signing, and shutdown errors expose only fixed redacted outcomes.
The image exposes no TCP port and contains no secret.

Before any provisioning, the manual `Staging TeleBirr broker readiness` workflow runs one
exact-commit, administrator-authenticated, TLS-verified, read-only transaction. It emits only fixed
receiver/pilot/device/work states and refuses an altered role, function, financial-switch, or
protected-receiver boundary. It never emits the receiver name, account, mask, IDs, key material, or
database credential and has no provisioning mode.

If that inspection finds a stale or otherwise unsafe runtime `LOGIN`, the separate manual
`Staging TeleBirr broker emergency disable` workflow can only normalize the two broker roles to
`NOLOGIN`, remove both passwords, normalize only their expected one-way membership, terminate their
existing sessions, and rerun the redacted full inspection. It rejects unexpected membership edges,
is bound to the exact `main` commit and staging project, locks and requires all seven
financial/provider switches to remain disabled, and has no pilot, receiver, device, DigitalOcean,
secret-generation, or enablement action.

No credential, runtime `LOGIN`, receiver value, child key, signer, or bridge deployment has been
provisioned by this source change. No fixed calendar date stops the broker; only explicit gates,
database pilot/enrollment/key state, bounded runtime-role validity, and short lease validity windows
can deny an assignment.
