# Offline CBE Birr worker-key provisioning check

This package verifies a proposed CBE Birr proof-opening child key against the approved v2 proof
producer master pair and the proposed nonsecret worker profile. It independently hashes both
producer roots, derives only the CBE Birr encryption child with the exact v2 domain, and compares
the child bytes and key ID before returning a frozen nonsecret witness. A TeleBirr child or an
internally consistent but unrelated CBE key fails.

Run this check only in a trusted offline provisioning process. The process must obtain the producer
profile from an independently approved source and keep the producer masters out of the worker.
The package does not generate, write, deliver, or rotate any secret or profile file. It has no
filesystem, environment, database, HTTP, provider, lease, settlement, or payment access. No
application imports it. A passing synthetic or future private check does not establish file
custody, deployment pinning, official-source permission, or authoritative lookup readiness.
