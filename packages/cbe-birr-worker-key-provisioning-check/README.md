# Offline CBE Birr worker-key provisioning check

This package verifies a proposed CBE Birr proof-opening child key against the approved v2 proof
producer master pair and the proposed nonsecret worker profile. It independently hashes both
producer roots, derives only the CBE Birr encryption child with the exact v2 domain, and compares
the child bytes and key ID before returning a frozen nonsecret witness. A TeleBirr child or an
internally consistent but unrelated CBE key fails.

Run this check only in a trusted offline provisioning process. The process must obtain the producer
profile from an independently approved source and keep the producer masters out of the worker.
That proof-opening check does not generate, write, deliver, or rotate any secret or profile file.
The package has no filesystem, environment, database, HTTP, provider, lease, settlement, or payment access. No
application imports it. A passing synthetic or future private check does not establish file
custody, deployment pinning, official-source permission, or authoritative lookup readiness.

The package also checks a proposed **receiver-revision lookup** child key against the Owner's
approved v2 lookup root profile and exact independently approved revision UUID/version. It hashes
both Owner masters, derives the revision-scoped encryption child, and compares its bytes and ID
with the proposed worker key and opening profile. It returns only a frozen nonsecret consistency
witness. The dedicated offline `cbe-birr-receiver-provisioning` subpath exposes child derivation;
the separate verifier subpath exposes only opening. Synthetic tests reject a self-consistent child
and manifest for the wrong revision and confirm compatibility with an Owner-produced envelope.
The offline receiver candidate composes these existing pieces for a trusted provisioner. It
requires an independently approved revision, root profile, and Owner master pair, plus an injected
trusted Owner snapshot reader. It checks the same active v2 revision before and after deriving a
revision-scoped child, runs the cryptographic consistency check, and returns canonical nonsecret
root/worker profile bytes and proposed release pins. Its secret `workerKey` is nonenumerable so
serializing the candidate to JSON omits it; callers must still treat the entire object as secret.
The candidate does not contact the Owner route itself, write or mount files, approve release pins,
or activate worker custody. A future delivery step and worker use must independently recheck the
active revision. Only synthetic keys are used in this repository's tests.
