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

A separate database preflight covers provider-aware dry-run proof records. Its v2 schema adds
private, immutable CBE Birr payment instructions and one-to-one proof bindings. An instruction
snapshots the exact v2 receiver lookup revision, provider, customer, Player account, channel, and
one-hour window. Composite foreign keys prevent a proof from being rebound to another customer,
Player, provider, channel, or receiver revision. No runtime role can write either table; existing
unbound proofs are never backfilled or assumed to have an instruction.

The preflight takes one opaque proof-request UUID and requires the CBE Birr verification switch to
remain disabled. It sends instructions created after a proof to time-window review, even if their
claimed issue time was backdated. It reports an absent binding, time-window review, retired receiver, or exact
v2 instruction-bound metadata. Every result has `eligibility = blocked` and literal false lease and
protected-material flags. It never selects or returns a reference, ciphertext, fingerprint, receiver
ID, account number, key, or holder name, and never locks or changes a row. Only the NOLOGIN
preflight role can call it; that role has no direct table or legacy lease access. There is no
application/worker wiring, lookup, decryption, payment, or financial activation. This probe does
**not** clear `prelease_prerequisite_gate_absent`: a future lease path must prove it consumes a
complete prerequisite decision before acquiring a lease, then use an opaque handle and separately
reviewed callback-scoped material access.

The Telegram issuer candidate can create one private, immutable CBE Birr instruction from
an admitted inbound event, an eligible Player, and a current v2 receiver revision. It records the
event-to-instruction retry lineage and an exact one-hour window, but returns no payable receiver
details. The capture candidate can then atomically record a dry-run proof and bind it to
that instruction. It refuses another customer or Player, rejects a late or retired receiver, and
cannot attach an older unbound proof on replay. Both candidates require all financial switches
disabled. Their API adapters bind the event and instruction to separate semantic HMAC consumers.
The private Telegram route now accepts explicit `/cbe_test PLAYER` and
`/cbe_test_proof TOKEN PLAYER SYNTHCBE0001` staging commands. It is default-off behind
`TELEGRAM_CBE_BIRR_BOUND_DRY_RUN_STAGING_ENABLED`, which requires the staging Player-action target
and `FINANCIAL_ACTIONS_MODE=dry_run`. The new migration grants only these two RPCs to the
Player-action group role; it does not grant direct table access. The SQL functions still enforce
the disabled financial switches independently. The route remains default-off; application and
migration rollout must be checked for each target. The route displays no payment destination,
performs no receipt lookup, and cannot credit a Player. V2 receiver provisioning, authoritative
lookup, and financial activation remain separate work.

The routine candidate ledger is a separate inert pointer to one immutable, instruction-bound v2
proof. Its ungranted enrollment function requires the exact blocked metadata preflight and disabled
CBE verification switch, then returns only an opaque candidate ID and replay flag. It stores no
reference, receiver value, amount, or receipt. Enrollment itself does not require TeleBirr's shared
deposit switches to be disabled, but the existing CBE dry-run proof capture still does. No runtime
role can call enrollment or read the ledger; there is no verifier lease, result writer, source
request, claim, or credit. This does not clear the prelease or protected-material blockers.

A separate candidate-ID prelease preflight now rechecks the bound proof and currently active v2
receiver revision when a routine candidate is examined. It returns only a blocked disposition,
reason, and literal false lease/material flags; retirement of the bound receiver moves the
candidate to review. Its only grantee is a dedicated NOLOGIN metadata role with no table access.
No runtime role is a member, no lease calls it, and no protected ciphertext or key is returned.
This is an offline prelease building block, not a completed acquisition gate: blockers 10 and 11
remain open until a later lease path consumes this decision atomically and uses a separately
reviewed material boundary.

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

The contract returns these 11 blockers in this fixed order:

1. `official_receipt_live_response_contract_unattested`
2. `official_receipt_live_transport_absent`
3. `receiver_lookup_protection_metadata_absent`
4. `receiver_lookup_key_provenance_unproven`
5. `receiver_lookup_new_revision_and_fresh_provisioning_required`
6. `receiver_lookup_metadata_inference_or_backfill_forbidden`
7. `submitted_reference_encryption_and_fingerprint_subkeys_share_api_master_provisioning_root`
8. `submitted_reference_independent_worker_decrypt_lifecycle_absent`
9. `canonical_reference_authoritative_owner_unassigned`
10. `prelease_prerequisite_gate_absent`
11. `lease_boundary_returns_protected_material`

The local `lookup_reference_normalization_unreviewed` blocker is closed for the narrow path from
provider-aware v2 CBE Birr proof capture to the unwired receipt transport's `TID` input. An offline
cross-package test verifies 8–32 ASCII alphanumeric acceptance, uppercase canonicalization inside
v2 protection, opening the v2 envelope with an internal CBE-only candidate, exact `TID`
preservation, and rejection of lowercase direct lookup input, legacy punctuation, Unicode,
whitespace, and wrong-provider input. This is a local code-shape review only: the candidate has no
worker key lifecycle, lease, runtime import, or provider acceptance, and every lookup and financial
capability remains false. See [cbe-birr-proof-open-candidate.md](cbe-birr-proof-open-candidate.md).

A separate dormant CBE Birr opening package now demonstrates the provider-scoped child-key,
worker-profile-to-producer-root identity check, and synchronous callback shape with synthetic proof
envelopes. No deployment pins the worker profile or provides independent key custody, and no
worker, lease, provider lookup, or financial action is permitted; blockers 7, 8, 10, and 11 remain
open.

An offline provisioning check now compares a proposed worker child with the v2 producer-root
derivation and returns only nonsecret consistency metadata. No real keys are provisioned, and the
worker still has no trusted file custody or deployment binding. A separate dormant guarded-file
loader now checks synthetic private-file custody against externally supplied profile digests and
child-key/deployment pins, but no application imports it, no release has approved pins, and no
worker files are mounted. The same blockers remain open.

The local `receiver_lookup_normalization_unreviewed` blocker is closed only for a synthetic v2
envelope bound to a supplied receiver-revision UUID and version, then passed as the
full `251` plus nine-digit phone to the unwired receipt transport. A synthetic cross-package test
pins the exact phone and nine-digit `PH` derivation and rejects truncated, changed, or Unicode
inputs. This does not establish that an Owner created the revision, that its keys were independently
provisioned, or that a real PDF credits the configured receiver. All provider and financial
capabilities remain false.

The local v2 proof-to-PDF reference shape has now been reviewed with a generated synthetic receipt.
The test captures mixed-case input, opens its authenticated v2 envelope, and compares the exact
uppercase reference with the PDF `Order ID`. A different `Order ID` would reject; lowercase or
conflicting PDF values stay in review without facts. This replaces the broad local normalization
uncertainty with `canonical_reference_authoritative_owner_unassigned`. The test does not attest that
CBE issued the receipt or defines `Order ID` as an authoritative transaction ID. A joint owner and
source review is still required before runtime use. Every lookup and financial capability is false.

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
   receipt credited the configured receiver. An
   [offline revision-bound protection candidate](cbe-birr-receiver-revision-protection-candidate.md)
   is internal-only. A private v2 revision storage/rotation contract and guarded Owner route now
   exist, but an active v2 revision by itself does not provision a verifier child key, establish
   worker custody, or prove authoritative receiver credit. The receiver-provenance blocker
   therefore remains for verification.
   A separate offline receiver-child provisioning check now verifies a proposed key against
   both approved Owner lookup-master fingerprints and an independently supplied exact revision
   identity. The guarded receiver-key loader can reject stale release pins. Neither check
   retrieves the active revision, provisions a real key, or connects a verifier; the blocker
   remains open.
   An Owner-only metadata function can identify the active v2 revision UUID/version and
   protection versions while CBE verification is disabled. It returns no phone or key material.
   Its narrow grant follows the deployed startup catalog allowlist. An internal Owner adapter now
   requires an independently supplied revision UUID/version, checks it against the current SQL
   snapshot, and returns only those five fields. A guarded Owner-only read route accepts an exact
   Owner-confirmed revision and returns that projection when the existing v2 rotation route flag
   is enabled; no provisioner calls it yet. Its result is a point-in-time snapshot, so key
   provisioning and later worker use must each recheck the active revision.
2. **Independent submitted-reference key lifecycle.** Encryption and fingerprint domains are
   separated, but independently provisioned worker decryption and rotation are not established.
3. **Normalization ownership.** Synthetic fixture reduction and canonical settlement profiles
   still require a broader joint compatibility review. The local v2 proof-to-`TID`, proof-to-PDF
   `Order ID`, and receiver-revision-to-`PH` format checks do not establish provider acceptance,
   receipt credit identity, or profile equivalence.
4. **Prelease-safe acquisition.** Metadata preflight must complete before lease mutation or any
   protected-material return. Later work requires an opaque handle and a narrow callback-scoped
   decrypt boundary.

## Normalization ownership inventory

The metadata-only inventory now distinguishes five existing boundaries. Version 5 of the inventory
records these facts without promoting either protection key version to a normalization version:

| Boundary                              | Current status                                                                                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy_submitted_reference_capture`  | Legacy CBE-only v1 accepts 5–128 ASCII alphanumeric, dot, underscore, or hyphen characters and uppercases inside protection. It is not the current provider-aware proof envelope.                                                                                    |
| `provider_aware_proof_capture`        | Current dry-run v2 proof capture accepts 8–32 ASCII alphanumeric characters, uppercases inside protection, and binds the provider to its ciphertext and fingerprint. It has no reviewed worker decrypt lifecycle or live CBE Birr authority.                         |
| `owner_receiver_reference_protection` | Owner receiver v1 preserves exactly 9–24 decimal digits inside provider-bound protection. It does not infer a country prefix or prove that its digits are a full 12-digit configured receiver phone from which the official nine-digit `PH` selector can be derived. |
| `offline_synthetic_fixture_reduction` | Fixture-only safe-fact reduction; not a live provider normalizer.                                                                                                                                                                                                    |
| `shadow_settlement_metadata_label`    | Metadata label only; no bound canonical normalizer.                                                                                                                                                                                                                  |

Each observed source boundary is independently pinned by a source attestation in tests. Every
boundary remains `authoritativeOwner: unassigned` and `jointReviewStatus: not_completed`.
All ten pairwise compatibility relationships among these five profiles remain `not_established`;
transformation reuse and implicit upgrades remain false. In particular, neither the older v1 reference format nor a
9-digit receiver value may be silently converted into the provider-aware v2 reference or the
full 12-digit receiver input or the resulting nine-digit official lookup selector. This inventory accepts no references, receiver digits,
ciphertext, or keys, and it authorizes no decrypt, lookup, lease, or credit.

An [offline normalization candidate](cbe-birr-normalization-candidate.md) now specifies and tests
the narrow reference and lookup-selector formats with synthetic values only. Its reference rule is
checked against the actual v2 protection, unwired transport, and synthetic PDF parser boundaries.
The candidate has no runtime consumer, and authoritative normalization ownership remains unassigned.

## Pure boundary

The prerequisite package accepts only exact public metadata labels. It contains no raw reference,
receiver identifier, ciphertext, secret, key, URL, credential, session, lease token, provider
payload, SQL, network, filesystem, queue, or runtime integration. It cannot acquire or settle a
job, create evidence, claim a payment, call KemerBet, execute a deposit, or change a feature switch.

The Stage 1E offline profile reduces uncertainty but does not satisfy any operational blocker.
Migration and deployment remain separate, explicitly reviewed steps.
