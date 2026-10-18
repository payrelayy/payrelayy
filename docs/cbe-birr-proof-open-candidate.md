# CBE Birr provider-aware proof open candidate

`packages/deposit-reference-protection/src/cbe-birr-proof-open.ts` is an internal, offline candidate
for opening one provider-aware v2 CBE Birr proof reference. It is not exported by the package entry
point or imported by an application or worker. It has no database, lease, transport, receipt,
provider, settlement, or Player-credit access.

The candidate accepts only a CBE Birr v2 ciphertext, stored mask, profile and encryption-key
version 2 labels, and an encryption master. It derives the same provider-bound encryption subkey and
authenticated data as proof capture, verifies the GCM tag, requires an already canonical 8–32
character ASCII alphanumeric reference, and checks the stored display mask. It never needs the
fingerprint master. Errors have one fixed message and omit protected values. Synthetic tests cover
the round trip and reject wrong keys, provider confusion, tampering, legacy envelopes, and malformed
metadata. A cross-package test passes the opened value to the unwired receipt `TID` validator.

This proves local cryptographic compatibility only. The current API encryption and fingerprint
subkeys share an API master provisioning root. There is no independent worker key provisioning,
rotation and recovery process, prelease authorization, proof-to-receiver-revision binding, or
callback-scoped material access. The candidate must remain unwired until those boundaries and the
other authoritative lookup prerequisites are reviewed. No real receipt or personal data is stored
in this package or its tests.

An additional dormant `@fetanagent/cbe-birr-reference-opening` package tests the narrower worker
opening boundary. It accepts only the CBE Birr/purpose-scoped v2 child key with a matching nonsecret
key fingerprint, requires a worker profile to match an independently supplied producer v2 root
identity, checks the stored mask, and makes the authenticated reference available only to a
synchronous trusted callback. The profile fixes the provider, purpose, reserved source label,
envelope/key versions, child-key ID, and both root fingerprints. It cannot accept the API master or
derive another provider key. No application imports this package. Independent profile provenance,
worker key provisioning, rotation, recovery, deployment binding, prelease authorization, and
callback use inside a reviewed worker are still absent; the inventory blockers and all
lookup/financial gates remain unchanged.

The separate offline `@fetanagent/cbe-birr-worker-key-provisioning-check` package verifies that a
proposed worker child is derived from the approved v2 producer encryption root, that both producer
roots match their nonsecret identities, and that the proposed worker profile matches the child and
root pair. It returns only a nonsecret consistency witness and handles no files or live secrets in
tests. Actual private-file provisioning, independent custody, rotation, recovery, and deployment
pinning remain unimplemented; the blockers remain open.
