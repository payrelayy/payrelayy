# CBE Birr authoritative-lookup prerequisite

`@fetanagent/cbe-birr-authoritative-lookup-prerequisite` is a pure, fail-closed inventory of the
remaining work before authoritative CBE Birr lookup can begin. It imports the Stage 1E source
profile label but does not call its synthetic parser or add transport, protected-material access,
database access, persistence, runtime wiring, evidence, claims, settlement, or financial actions.

The package also has a metadata-only receiver-revision preflight for the newly configured Owner
receiver path. Given an exact, non-sensitive snapshot of the revision status and three protection
version labels, it distinguishes a possible v1 metadata shape from an inactive or legacy/unsupported
shape. **Every** result remains blocked: matching labels do not prove the ciphertext, lookup-phone
format, key provenance, independent worker decryption, or an official receipt. The preflight accepts
no account number, holder name, ciphertext, fingerprint, secret, or revision identifier, and no
application or SQL lease calls it. A newly configured receiver therefore does not clear the
authoritative-lookup blockers by itself.

A separate pure receipt time-window preflight consumes only the parser's canonical Addis Ababa
timestamp and its `second` or `minute` precision, plus server-recorded instruction and submission
times. It requires parser version 2 and the expected layout/precision pairing; drift goes to
review. It treats a displayed minute as the entire possible minute and a displayed second as the
entire possible second. That full interval must fit the exact one-hour instruction, the one-hour
freshness period, and the five-minute provider-clock tolerance; a late submission or overlap with
any boundary returns `would_review`. Even a `window_consistent_advisory` result fixes
`authoritativeVerificationAllowed` and `financialActionAllowed` to `false`: it does not attest the
receipt source, receiver, duplicate state, or Player eligibility. No application, SQL lease, or
financial path imports or calls it, and its input times require a future trusted immutable source.

A separate database preflight now covers the newer, provider-aware dry-run proof records. It takes
one opaque proof-request UUID, requires the CBE Birr verification switch to remain disabled, and
reads only the proof's provider/status/version labels and the active receiver's status/protection
version labels. It returns either `receiver_revision_unavailable` or
`receiver_v1_metadata_only`, always with `eligibility = blocked` and literal false lease and
protected-material flags. It never selects or returns a reference, ciphertext, fingerprint, receiver
ID, account number, key, or holder name, and never locks or changes a row. Only a distinct NOLOGIN
preflight role can call it; that role has no direct table or legacy lease access. There is no
application/worker wiring, lookup, decryption, production migration, or financial activation in
this change. This metadata probe does **not** clear `prelease_prerequisite_gate_absent`: a future
lease path must prove it actually consumes a complete prerequisite decision before acquiring a
lease, and still needs an opaque handle and separately reviewed callback-scoped material access.

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

`official_receipt_live_response_contract_unattested` means the Stage 1E fixture proves only offline
mechanics. A privacy-controlled envelope observation established `application/pdf`, not an exact
semantic response contract. No real customer receipt, phone, transaction ID, screenshot, SMS, PDF,
account, or provider response is embedded in either package. Controlled privacy-reviewed work must
still attest exact PDF field layout, labels, status/type vocabulary, money fields, fee arithmetic,
timestamps, encryption behavior, parsing behavior, size policy, and drift handling.

`official_receipt_live_transport_absent` means there is no permitted or reachable authoritative
lookup HTTP/browser client. The compiled route has HTTPS, an exact host/port/path, ordered `TID` and
`PH`, and zero redirects, but no application code performs that request. Any later runtime must fail
closed on TLS, redirect, timeout, size, content-type, outage, and incident-stop failures.

An isolated sibling package now implements those bounded one-shot transport mechanics plus an
opaque PDF-envelope observation. Its public success disposition is `opaque_pdf_observation`; a
separate package-internal composition can pass the same one-fetch bytes to the isolated advisory
parser without exposing them through the public result. This does not clear the blocker for the
authoritative lookup: no application or worker imports the composition, no protected material can
reach it, no trusted source authorization or incident-stop owner is wired, and the exact PDF field
contract remains unattested. The prerequisite package itself still contains no network client and
every capability remains literal `false`. See
[cbe-birr-authoritative-receipt-transport.md](cbe-birr-authoritative-receipt-transport.md).

## Other unresolved prerequisite groups

The remaining blockers preserve the existing safety design:

1. **Receiver protection and provenance.** Existing receiver lookup material lacks independently
   established protection metadata and key provenance. Metadata cannot be inferred or backfilled;
   a fresh immutable receiver revision is required. The Owner API now requires newly saved CBE Birr
   receiver phones to be exactly `251` plus nine digits, without changing the broader TeleBirr
   rule or retroactively rewriting stored revisions. This format check alone does not establish
   protection provenance, identify which existing revision is conforming, or prove that an official
   receipt credited the configured receiver.
2. **Independent submitted-reference key lifecycle.** Encryption and fingerprint domains are
   separated, but independently provisioned worker decryption and rotation are not established.
3. **Normalization ownership.** Submitted capture, synthetic fixture reduction, receiver lookup,
   and canonical settlement profiles require an exact joint compatibility review. No label implies
   equivalence.
4. **Prelease-safe acquisition.** Metadata preflight must complete before lease mutation or any
   protected-material return. Later work requires an opaque handle and a narrow callback-scoped
   decrypt boundary.

## Normalization ownership inventory

The metadata-only inventory now distinguishes five existing boundaries. Version 2 of the inventory
records these facts without promoting either protection key version to a normalization version:

| Boundary                              | Current status                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy_submitted_reference_capture`  | Legacy CBE-only v1 accepts 5–128 ASCII alphanumeric, dot, underscore, or hyphen characters and uppercases inside protection. It is not the current provider-aware proof envelope.                                                            |
| `provider_aware_proof_capture`        | Current dry-run v2 proof capture accepts 8–32 ASCII alphanumeric characters, uppercases inside protection, and binds the provider to its ciphertext and fingerprint. It has no reviewed worker decrypt lifecycle or live CBE Birr authority. |
| `owner_receiver_reference_protection` | Owner receiver v1 preserves exactly 9–24 decimal digits inside provider-bound protection. It does not infer a country prefix or prove that its digits meet the official lookup's exact 12-digit `PH` selector.                               |
| `offline_synthetic_fixture_reduction` | Fixture-only safe-fact reduction; not a live provider normalizer.                                                                                                                                                                            |
| `shadow_settlement_metadata_label`    | Metadata label only; no bound canonical normalizer.                                                                                                                                                                                          |

Each observed source boundary is independently pinned by a source attestation in tests. Every
boundary remains `authoritativeOwner: unassigned` and `jointReviewStatus: not_completed`.
All ten pairwise compatibility relationships remain `not_established`; transformation reuse and
implicit upgrades remain false. In particular, neither the older v1 reference format nor a
9-digit receiver value may be silently converted into the provider-aware v2 reference or the
official 12-digit lookup selector. This inventory accepts no references, receiver digits,
ciphertext, or keys, and it authorizes no decrypt, lookup, lease, or credit.

An [offline normalization candidate](cbe-birr-normalization-candidate.md) now specifies and tests
the narrow reference and lookup-selector formats with synthetic values only. It has no runtime
consumer and does not assign ownership, establish cross-profile compatibility, or clear any of the
three normalization blockers above.

## Pure boundary

The prerequisite package accepts only exact public metadata labels. It contains no raw reference,
receiver identifier, ciphertext, secret, key, URL, credential, session, lease token, provider
payload, SQL, network, filesystem, queue, or runtime integration. It cannot acquire or settle a
job, create evidence, claim a payment, call KemerBet, execute a deposit, or change a feature switch.

The Stage 1E offline profile reduces uncertainty but does not satisfy any operational blocker.
Migration and deployment remain separate, explicitly reviewed steps.
