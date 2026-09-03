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
Secret/config loading, credential provisioning, and the local-only bridge transport remain
separate composition work. This package opens no listener and has no start entrypoint. No fixed
calendar date stops it; only the database pilot, enrollment, key revocation, and short lease
validity windows can deny an assignment.
