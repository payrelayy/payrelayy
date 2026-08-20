# CBE Birr authoritative-lookup prerequisite

`@fetanagent/cbe-birr-authoritative-lookup-prerequisite` is a pure, fail-closed inventory of the
remaining work before authoritative CBE Birr lookup can begin. It imports the Stage 1E source
profile label but does not call its synthetic parser or add transport, protected-material access,
database access, persistence, runtime wiring, evidence, claims, settlement, or financial actions.

The only valid-request disposition remains `blocked`, with reason
`authoritative_lookup_prerequisites_incomplete`. All 16 capability fields are literal `false`:

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

## Exact remaining blockers

The contract returns these 13 blockers in this fixed order:

1. `official_receipt_live_response_contract_unattested`
2. `official_receipt_live_transport_absent`
3. `receiver_lookup_protection_metadata_absent`
4. `receiver_lookup_key_provenance_unproven`
5. `receiver_lookup_new_revision_and_fresh_provisioning_required`
6. `receiver_lookup_metadata_inference_or_backfill_forbidden`
7. `submitted_reference_encryption_and_fingerprint_subkeys_share_api_master_provisioning_root`
8. `submitted_reference_independent_worker_decrypt_lifecycle_absent`
9. `lookup_reference_normalization_unreviewed`
10. `receiver_lookup_normalization_unreviewed`
11. `canonical_reference_normalization_unreviewed`
12. `prelease_prerequisite_gate_absent`
13. `lease_boundary_returns_protected_material`

The obsolete broad `source_permission_unproven` blocker has been replaced, not merely removed. The
offline route and synthetic parser are now explicit, while the exact live response contract and
the live transport remain independently blocked.

## What the two new source blockers mean

`official_receipt_live_response_contract_unattested` means the parse5 fixture proves only offline
mechanics. No real customer receipt, phone, transaction ID, screenshot, SMS, PDF, account, or
provider response is embedded in the package. Controlled privacy-reviewed samples still have to
attest exact live labels, status/type vocabulary, money fields, fee arithmetic, timestamps,
encoding, content type, maximum size, and drift behavior.

`official_receipt_live_transport_absent` means there is deliberately no HTTP/browser client. The
compiled route has HTTPS, an exact host/port/path, ordered `TID` and `PH`, and zero redirects, but no
code performs that request. A future transport remains separate work and must fail closed on TLS,
redirect, timeout, size, content-type, outage, and incident-stop failures.

## Other unresolved prerequisite groups

The remaining blockers preserve the existing safety design:

1. **Receiver protection and provenance.** Existing receiver lookup material lacks independently
   established protection metadata and key provenance. Metadata cannot be inferred or backfilled;
   a fresh immutable receiver revision is required.
2. **Independent submitted-reference key lifecycle.** Encryption and fingerprint domains are
   separated, but independently provisioned worker decryption and rotation are not established.
3. **Normalization ownership.** Submitted capture, synthetic fixture reduction, receiver lookup,
   and canonical settlement profiles require an exact joint compatibility review. No label implies
   equivalence.
4. **Prelease-safe acquisition.** Metadata preflight must complete before lease mutation or any
   protected-material return. Later work requires an opaque handle and a narrow callback-scoped
   decrypt boundary.

## Normalization ownership inventory

The metadata-only inventory still records three existing boundaries:

| Boundary                              | Current status                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `submitted_reference_capture`         | Strict bounded ASCII input and uppercase mapping inside protection; its key version is not a normalization ID. |
| `offline_synthetic_fixture_reduction` | Fixture-only safe-fact reduction; not a live provider normalizer.                                              |
| `shadow_settlement_metadata_label`    | Metadata label only; no bound canonical normalizer.                                                            |

Every boundary remains `authoritativeOwner: unassigned` and `jointReviewStatus: not_completed`.
All pairwise compatibility relationships remain `not_established` and implicit upgrades remain
false.

## Pure boundary

The prerequisite package accepts only exact public metadata labels. It contains no raw reference,
receiver identifier, ciphertext, secret, key, URL, credential, session, lease token, provider
payload, SQL, network, filesystem, queue, or runtime integration. It cannot acquire or settle a
job, create evidence, claim a payment, call KemerBet, execute a deposit, or change a feature switch.

The Stage 1E offline profile reduces uncertainty but does not satisfy any operational blocker.
Migration and deployment remain separate, explicitly reviewed steps.
