# Dormant CBE Birr worker key custody candidate

This package loads only a CBE Birr proof-opening child key and two nonsecret profiles from fixed
Linux paths. It requires a separate release pin with the exact SHA-256 digest of each profile, the
child-key ID, and deployment target. The files must be regular, single-link files with approved
ownership and permissions, stable across a no-follow open/read, and below a small size limit.
The producer encryption and fingerprint masters are forbidden in this process's configuration.

The loader is default-off and no application imports it. Its enabled branch exists for synthetic
tests and a later separately reviewed worker integration. A passing load proves local file and
identity consistency only: this repository does not yet supply an approved CBE release pin, mount
these files into a worker, establish rotation and recovery, authorize an official source, or allow
lookup, lease, settlement, or Player credit. Do not log the returned configuration; it contains the
secret child key. Use the redacted projection for diagnostics.
