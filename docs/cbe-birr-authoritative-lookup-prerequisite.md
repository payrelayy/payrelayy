# CBE Birr authoritative-lookup prerequisite

`@fetanagent/cbe-birr-authoritative-lookup-prerequisite` is a pure, fail-closed inventory of the
work that must be completed before an authoritative CBE Birr lookup can be designed. It does not
perform a lookup and does not make the reserved `cbe_birr_official_receipt_lookup_v1` source profile
permitted, reachable, or authoritative.

The only valid-request disposition is `blocked`, with reason
`authoritative_lookup_prerequisites_incomplete`. Every capability reported by the contract is
false. That includes source permission, protected-material eligibility, preflight-safe job
acquisition, normalization readiness, decryption, transport, provider request, provider evidence,
and payment-claim capability. Hostile, incomplete, or unknown input cannot select a positive path.

The only valid request consists of `contractVersion: 1`, `providerCode: cbe_birr`,
`sourceProfile: cbe_birr_official_receipt_lookup_v1`, and
`legacyMaterialShape: cbe_birr_shadow_protected_lookup_material_legacy`. These are public policy
labels only; unknown fields or values fail closed.

The result fixes all 16 capability fields to literal `false`:

- `ciphertextAcceptanceAllowed`
- `plaintextAcceptanceAllowed`
- `keyMaterialAllowed`
- `normalizationAllowed`
- `metadataInferenceAllowed`
- `metadataBackfillAllowed`
- `sourcePermissionAllowed`
- `decryptionAllowed`
- `transportAllowed`
- `providerRequestAllowed`
- `leaseAcquisitionAllowed`
- `protectedMaterialReturnAllowed`
- `persistenceAllowed`
- `schemaMutationAllowed`
- `runtimeWiringAllowed`
- `financialClaimAllowed`

## Exact blocked prerequisites

The contract returns these 12 blockers in this fixed order:

1. `source_permission_unproven`
2. `receiver_lookup_protection_metadata_absent`
3. `receiver_lookup_key_provenance_unproven`
4. `receiver_lookup_new_revision_and_fresh_provisioning_required`
5. `receiver_lookup_metadata_inference_or_backfill_forbidden`
6. `submitted_reference_encryption_and_fingerprint_subkeys_share_api_master_provisioning_root`
7. `submitted_reference_independent_worker_decrypt_lifecycle_absent`
8. `lookup_reference_normalization_unreviewed`
9. `receiver_lookup_normalization_unreviewed`
10. `canonical_reference_normalization_unreviewed`
11. `prelease_prerequisite_gate_absent`
12. `lease_boundary_returns_protected_material`

They cover five P0 areas, all unresolved:

1. **Official-source permission.** There is no independently reviewed permission artifact proving
   the exact source, purpose, caller, authentication method, deployment context, limits, data use,
   and revocation rules. Browser visibility, observed behavior, synthetic fixtures, and the reserved
   source-profile name are not permission.
2. **Receiver protection and provenance.** The current receiver verification ciphertext lacks
   protection metadata and key provenance. It cannot be treated as worker-ready material. Metadata
   must not be inferred or backfilled onto an existing receiver record. A fresh new immutable
   receiver-account revision must be created under a separately reviewed protection and provenance
   design.
3. **Submitted-reference key lifecycle.** The submitted-reference encryption and fingerprint
   subkeys are domain-separated, but they share one API master provisioning and rotation root.
   There is no independently provisioned worker decryption lifecycle. A future worker boundary must
   not inherit the API root or infer a worker-safe lifecycle from the current stored value.
4. **Normalization review.** Three distinct normalization profiles or version labels currently
   participate across reference capture, synthetic authoritative-fixture reduction, and shadow
   settlement metadata. Their equivalence, ownership, allowed transformations, and upgrade rules
   have not been jointly reviewed. None may be assumed to be the official-lookup normalization
   profile.
5. **Preflight-safe acquisition.** The current shadow lease operation mutates durable job state and
   returns protected material before the prerequisite check could run. The boundary must be
   redesigned so a non-mutating metadata preflight completes first and any later acquisition uses
   an opaque handle rather than returning protected material in the lease payload.

## Stage 1G containment

The database now exposes a metadata-only preflight for an existing shadow job. It returns only the
job identifier, fixed version labels, a fixed `blocked` result,
`legacy_protected_lookup_material_ineligible`, and literal-false lease and protected-material flags.
It does not return deposit, submission, receiver, key, fingerprint, ciphertext, or provider data and
does not lock or mutate the job.

The shadow-worker role can execute only this preflight. Its execution rights on the legacy lease,
completion, and retry procedures are revoked. The legacy procedures remain in the schema solely for
migration continuity; their presence is not permission to call them. This containment does not
resolve any prerequisite below, create an opaque acquisition handle, or permit a provider lookup.

The legacy-shape label `cbe_birr_shadow_protected_lookup_material_legacy` identifies the blocked
shape only. It does not call the current ciphertext an envelope or protection profile, approve its
format, bless a `v1`, establish provenance, or authorize migration by inference.

## Pure boundary

The prerequisite package contains no raw transaction reference, receiver identifier, ciphertext,
secret, encryption or fingerprint key, protected-material version, algorithm selection, KMS value,
URL, host, route, credential, session, authorization data, lease identifier or token, opaque handle,
provider request or response, or provider payload. It also has no network, filesystem, database,
SQL, migration, schema, queue, worker, or other runtime integration.

It cannot acquire or settle a job, decrypt material, normalize a provider response, create provider
evidence, transition verification state, claim a payment, call KemerBet, execute a deposit, validate
or collect a withdrawal, pay out funds, or change a feature switch. Logs and errors are limited to
fixed public policy labels and blocker status; they cannot include protected material or operational
secrets.

## Required next work

The five areas are P0 design and migration prerequisites, not an implementation checklist for a
live transport. The next reviews must produce reproducible evidence for:

- an independently reviewed source-permission artifact and exact access rules;
- a fresh immutable receiver-account revision with explicit, non-inferred protection provenance;
- separately provisioned and rotated lookup-material protection with an independent worker decrypt
  lifecycle;
- a non-mutating metadata preflight plus an opaque-handle acquisition design that reveals protected
  material only inside a separately reviewed, callback-scoped boundary; and
- one explicit normalization ownership model covering all three existing profiles, with exact
  transformations, compatibility tests, and fail-closed upgrade rules.

Completing those designs would permit another review only. It would not select a source, enable
decryption or transport, make a provider call, create authoritative evidence, or authorize any
financial action. The official-source policy in
[cbe-birr-official-source-policy.md](cbe-birr-official-source-policy.md) remains independently
blocked.
