# Offline CBE Birr worker-key provisioning check

This package verifies a proposed CBE Birr proof-opening child key against the approved v2 proof
producer master pair and the proposed nonsecret worker profile. It independently hashes both
producer roots, derives only the CBE Birr encryption child with the exact v2 domain, and compares
the child bytes and key ID before returning a frozen nonsecret witness. A TeleBirr child or an
internally consistent but unrelated CBE key fails.

Run this check only in a trusted offline provisioning process. The process must obtain the producer
profile from an independently approved source and keep the producer masters out of the worker.
That proof-opening check does not generate, write, deliver, or rotate any secret or profile file.
That offline check has no filesystem, environment, database, HTTP, provider, lease, settlement,
or payment access. No application imports this package. A passing synthetic or future private check does not establish file
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

The offline delivery-bundle step accepts only a candidate created in the same process and an
independently approved exact pin set. It rechecks the active Owner revision, verifies the proposed
profile digests and child-key ID, and shapes the three files expected by the guarded worker loader.
The key bytes are nonenumerable and must be erased after use. This step does not write or mount a
file, approve pins, read a live key, start a worker, contact CBE, or change a financial switch. A
future installer must recheck the revision at delivery, and a future worker must recheck it at use.

The private staging step is an unwired, one-use Linux installer for that bundle. It requires an
independently approved worker UID, an empty root-owned `0700` directory at its fixed host path,
matching release pins, and an active Owner revision before and after the write. It validates the
bundle with the guarded loader, creates each file exclusively with no-follow flags, writes and
syncs the two public profiles before the `0400` worker-owned child key, and reopens every file to
compare its exact bytes. On failure it removes only files it created when their inode still matches;
any residue blocks the next attempt. Bundle buffers are zeroed after an attempt. JavaScript secret
strings in the earlier candidate cannot be reliably erased, so the trusted provisioning process
must be short-lived and must never log or serialize them.

Staged files are **not** mounted into a worker. No app or workflow calls this installer, no real
Owner keys or release pins are supplied, and no existing files are replaced. A later deployment
must separately approve the worker UID and host mount, verify the mounted files with the guarded
loader, recheck the active revision at use, and define rotation and recovery before CBE can run.
The disposable Linux bind-mount check and its remaining operational limits are recorded in
[`docs/cbe-birr-receiver-custody-mount-rehearsal.md`](../../docs/cbe-birr-receiver-custody-mount-rehearsal.md).
