import { isProxy } from 'node:util/types';

/**
 * Metadata-only inventory of the five normalization and protection boundaries in the
 * repository. It does not normalize a value, declare the profiles equivalent, select an
 * authoritative profile, or authorize runtime use.
 */
export const CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION = 5 as const;
export const CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION =
  'sha256:56a14b1b377a2d64de345ae03d390d0a01fa46f91a3af8017ed2137e74671195' as const;
export const CBE_BIRR_PROVIDER_AWARE_PROOF_CAPTURE_SOURCE_ATTESTATION =
  'sha256:b73126eeed525ace2901f65efde3ab2375090b3a3bb6930096b8f362812aa86d' as const;
export const CBE_BIRR_RECEIVER_REFERENCE_PROTECTION_SOURCE_ATTESTATION =
  'sha256:745cd258ab7de570380eb59f5ec7d1763a815f87bee955522e7d90bec421dc7a' as const;
export const CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION =
  'sha256:362779764454f371171796cc7bf37e604732bad78694c10ebe0917afa8d3ea61' as const;

export const CBE_BIRR_NORMALIZATION_OWNERSHIP_REMAINING_BLOCKERS = Object.freeze([
  'canonical_reference_authoritative_owner_unassigned',
] as const);

/**
 * Scoped synthetic review of v2 proof capture/open and the PDF parser's exact Order ID comparison.
 * It verifies local byte compatibility only, not source provenance, provider semantics, or
 * cross-profile ownership. No runtime imports or financial authority follow from this review.
 */
export const CBE_BIRR_PROOF_TO_PDF_REFERENCE_LOCAL_REVIEW = Object.freeze({
  reviewVersion: 1 as const,
  scope: 'provider_aware_proof_v2_to_synthetic_pdf_order_id' as const,
  disposition: 'local_format_compatible' as const,
  providerOrderIdSemanticsAttested: false as const,
  authoritativeOwnerAssigned: false as const,
  runtimeWiringAllowed: false as const,
  financialActionAllowed: false as const,
});

/**
 * Scoped source review of the local v2 CBE proof capture and the unwired receipt transport's
 * TID validator. Synthetic cross-package tests pin their 8–32 ASCII alphanumeric and uppercase
 * behavior. This does not attest provider acceptance, authorize decryption, or complete the
 * separate receiver/canonical-reference ownership review.
 */
export const CBE_BIRR_LOOKUP_REFERENCE_LOCAL_REVIEW = Object.freeze({
  reviewVersion: 1 as const,
  scope: 'provider_aware_proof_v2_to_unwired_receipt_tid' as const,
  disposition: 'local_format_compatible' as const,
  providerAcceptanceAttested: false as const,
  workerDecryptionAllowed: false as const,
  runtimeWiringAllowed: false as const,
  financialActionAllowed: false as const,
});

/**
 * Scoped source review of a synthetic v2 receiver-revision envelope through the unwired receipt
 * transport's full-phone validator and PH selector. It does not prove receiver/key provenance,
 * live PDF credit identity, or authority to fetch a receipt.
 */
export const CBE_BIRR_RECEIVER_LOOKUP_LOCAL_REVIEW = Object.freeze({
  reviewVersion: 1 as const,
  scope: 'receiver_revision_v2_to_unwired_receipt_ph' as const,
  disposition: 'local_format_compatible' as const,
  receiverRevisionProvenanceAttested: false as const,
  keyProvenanceAttested: false as const,
  receiptCreditIdentityAttested: false as const,
  runtimeWiringAllowed: false as const,
  financialActionAllowed: false as const,
});

const submittedReferenceTransformations = Object.freeze([
  'reject_input_changed_by_trim',
  'require_5_to_128_ascii_alphanumeric_dot_underscore_or_hyphen_code_points',
  'map_ascii_lowercase_to_uppercase_with_string_to_upper_case',
] as const);

const providerAwareProofTransformations = Object.freeze([
  'reject_input_changed_by_trim',
  'require_8_to_32_ascii_alphanumeric_characters',
  'map_ascii_lowercase_to_uppercase_inside_protection',
  'bind_provider_to_ciphertext_and_fingerprint',
] as const);

const receiverReferenceTransformations = Object.freeze([
  'require_9_to_24_ascii_decimal_digits',
  'preserve_exact_digits_without_country_prefix_inference',
  'bind_provider_to_ciphertext_fingerprint_and_unprotect',
] as const);

const fixtureTransformations = Object.freeze([
  'reject_nonexact_shapes_accessors_proxies_extra_fields_and_unknown_values',
  'map_invalid_candidate_to_parser_unavailable',
  'map_exact_not_found_and_allowlisted_unavailable_uncertainty_to_safe_facts',
  'map_PROVIDER_API_PROVIDER_RECEIPT_LOOKUP_PROVIDER_ACCOUNT_ACTIVITY_to_lowercase_safe_facts',
  'map_MATCHED_MISMATCHED_UNKNOWN_provider_identity_to_lowercase_safe_facts',
  'map_COMPLETED_PENDING_FAILED_UNKNOWN_status_to_lowercase_safe_facts',
  'map_ETB_OTHER_UNKNOWN_currency_to_ETB_other_unknown',
  'map_SEND_MONEY_OTHER_UNKNOWN_payment_type_to_send_money_other_unknown',
  'validate_synthetic_canonical_reference_then_reduce_to_presence',
  'validate_positive_safe_integer_amount_or_null_then_preserve',
  'compare_synthetic_receiver_key_then_reduce_to_match_state',
  'preserve_only_exact_canonical_utc_timestamps',
  'allow_only_null_or_exact_fixture_adapter_normalization_and_digest_metadata_then_reduce_to_presence',
] as const);

const noShadowSettlementTransformations = Object.freeze([] as const);

export const CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY = Object.freeze([
  Object.freeze({
    profileId: 'legacy_submitted_reference_capture' as const,
    observedCodeBoundary: '@fetanagent/deposit-reference-protection' as const,
    scope: 'submission_capture_protection_only' as const,
    normalizationVersionLabel: null,
    versionStatus: 'normalization_version_absent' as const,
    authoritativeOwner: 'unassigned' as const,
    jointReviewStatus: 'not_completed' as const,
    sourceAttestation: CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION,
    exactTransformations: submittedReferenceTransformations,
    outputClass: 'uppercase_reference_inside_protection_boundary' as const,
    authoritativeLookupEligible: false as const,
  }),
  Object.freeze({
    profileId: 'provider_aware_proof_capture' as const,
    observedCodeBoundary: '@fetanagent/deposit-reference-protection' as const,
    scope: 'dry_run_provider_scoped_submission_capture_only' as const,
    normalizationVersionLabel: null,
    versionStatus: 'normalization_version_absent' as const,
    authoritativeOwner: 'unassigned' as const,
    jointReviewStatus: 'not_completed' as const,
    sourceAttestation: CBE_BIRR_PROVIDER_AWARE_PROOF_CAPTURE_SOURCE_ATTESTATION,
    exactTransformations: providerAwareProofTransformations,
    outputClass: 'uppercase_reference_inside_provider_bound_v2_protection' as const,
    authoritativeLookupEligible: false as const,
  }),
  Object.freeze({
    profileId: 'owner_receiver_reference_protection' as const,
    observedCodeBoundary: '@fetanagent/deposit-reference-protection' as const,
    scope: 'owner_configured_receiver_storage_and_presentation_only' as const,
    normalizationVersionLabel: null,
    versionStatus: 'normalization_version_absent' as const,
    authoritativeOwner: 'unassigned' as const,
    jointReviewStatus: 'not_completed' as const,
    sourceAttestation: CBE_BIRR_RECEIVER_REFERENCE_PROTECTION_SOURCE_ATTESTATION,
    exactTransformations: receiverReferenceTransformations,
    outputClass: 'exact_digits_inside_receiver_protection_boundary' as const,
    authoritativeLookupEligible: false as const,
  }),
  Object.freeze({
    profileId: 'offline_synthetic_fixture_reduction' as const,
    observedCodeBoundary: '@fetanagent/cbe-birr-authoritative-fixtures' as const,
    scope: 'offline_synthetic_fixture_only' as const,
    normalizationVersionLabel: 'fixture-normalizer-v1' as const,
    versionStatus: 'fixture_only_version' as const,
    authoritativeOwner: 'unassigned' as const,
    jointReviewStatus: 'not_completed' as const,
    sourceAttestation: CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION,
    exactTransformations: fixtureTransformations,
    outputClass: 'redacted_advisory_safe_facts' as const,
    authoritativeLookupEligible: false as const,
  }),
  Object.freeze({
    profileId: 'shadow_settlement_metadata_label' as const,
    observedCodeBoundary: '@fetanagent/contracts' as const,
    scope: 'advisory_shadow_settlement_metadata_only' as const,
    normalizationVersionLabel: 'cbe-birr-normalization-v1' as const,
    versionStatus: 'metadata_label_without_bound_normalizer' as const,
    authoritativeOwner: 'unassigned' as const,
    jointReviewStatus: 'not_completed' as const,
    sourceAttestation: null,
    exactTransformations: noShadowSettlementTransformations,
    outputClass: 'settlement_argument_label_only' as const,
    authoritativeLookupEligible: false as const,
  }),
] as const);

export type CbeBirrNormalizationProfileInventoryEntry =
  (typeof CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY)[number];
export type CbeBirrNormalizationProfileId = CbeBirrNormalizationProfileInventoryEntry['profileId'];

export const CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY = Object.freeze(
  CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY.flatMap((left, index) =>
    CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY.slice(index + 1).map((right) =>
      Object.freeze({
        leftProfileId: left.profileId,
        rightProfileId: right.profileId,
        status: 'not_established' as const,
        equivalenceAllowed: false as const,
        transformationReuseAllowed: false as const,
      }),
    ),
  ),
);

export interface CbeBirrNormalizationOwnershipRequest {
  readonly contractVersion: typeof CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly submittedReferenceNormalizationVersion: null;
  readonly submittedReferenceProtectionKeyVersion: 1;
  readonly submittedReferenceSourceAttestation: typeof CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION;
  readonly providerAwareProofProtectionKeyVersion: 2;
  readonly providerAwareProofProfileVersion: 2;
  readonly providerAwareProofSourceAttestation: typeof CBE_BIRR_PROVIDER_AWARE_PROOF_CAPTURE_SOURCE_ATTESTATION;
  readonly receiverReferenceProtectionKeyVersion: 1;
  readonly receiverReferenceProfileVersion: 1;
  readonly receiverReferenceSourceAttestation: typeof CBE_BIRR_RECEIVER_REFERENCE_PROTECTION_SOURCE_ATTESTATION;
  readonly fixtureSchemaLabel: 'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V1';
  readonly fixtureSchemaVersion: 1;
  readonly fixtureNormalizerVersion: 1;
  readonly fixtureAdapterLabel: 'fixture-adapter-v1';
  readonly fixtureNormalizationLabel: 'fixture-normalizer-v1';
  readonly fixtureNormalizerSourceAttestation: typeof CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION;
  readonly shadowSettlementContractVersion: 1;
  readonly shadowSettlementNormalizationLabel: 'cbe-birr-normalization-v1';
}

interface CbeBirrNormalizationOwnershipDisabledCapabilities {
  readonly authoritativeProfileSelectionAllowed: false;
  readonly crossProfileCompatibilityAssumptionAllowed: false;
  readonly crossProfileTransformationReuseAllowed: false;
  readonly implicitVersionUpgradeAllowed: false;
  readonly normalizationExecutionAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly providerRequestAllowed: false;
  readonly financialClaimAllowed: false;
}

export interface CbeBirrNormalizationOwnershipBlockedResult extends CbeBirrNormalizationOwnershipDisabledCapabilities {
  readonly contractVersion: typeof CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'blocked';
  readonly reasonCode: 'normalization_ownership_review_incomplete';
  readonly authoritativeOwner: 'unassigned';
  readonly jointReviewStatus: 'not_completed';
  readonly remainingBlockers: typeof CBE_BIRR_NORMALIZATION_OWNERSHIP_REMAINING_BLOCKERS;
  readonly profiles: typeof CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY;
  readonly compatibility: typeof CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY;
}

export interface CbeBirrNormalizationOwnershipInvalidResult extends CbeBirrNormalizationOwnershipDisabledCapabilities {
  readonly contractVersion: typeof CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
}

export type CbeBirrNormalizationOwnershipResult =
  CbeBirrNormalizationOwnershipBlockedResult | CbeBirrNormalizationOwnershipInvalidResult;

export interface RedactedCbeBirrNormalizationOwnershipBlockedLogProjection {
  readonly contractVersion: typeof CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'blocked';
  readonly reasonCode: 'normalization_ownership_review_incomplete';
  readonly profileCount: 5;
  readonly compatibilityPairCount: 10;
}

export interface RedactedCbeBirrNormalizationOwnershipInvalidLogProjection {
  readonly contractVersion: typeof CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_result';
  readonly reasonCode: 'invalid_result';
}

export type RedactedCbeBirrNormalizationOwnershipLogProjection =
  | RedactedCbeBirrNormalizationOwnershipBlockedLogProjection
  | RedactedCbeBirrNormalizationOwnershipInvalidLogProjection;

type UnknownRecord = Record<string, unknown>;

const requestKeys = [
  'contractVersion',
  'providerCode',
  'submittedReferenceNormalizationVersion',
  'submittedReferenceProtectionKeyVersion',
  'submittedReferenceSourceAttestation',
  'providerAwareProofProtectionKeyVersion',
  'providerAwareProofProfileVersion',
  'providerAwareProofSourceAttestation',
  'receiverReferenceProtectionKeyVersion',
  'receiverReferenceProfileVersion',
  'receiverReferenceSourceAttestation',
  'fixtureSchemaLabel',
  'fixtureSchemaVersion',
  'fixtureNormalizerVersion',
  'fixtureAdapterLabel',
  'fixtureNormalizationLabel',
  'fixtureNormalizerSourceAttestation',
  'shadowSettlementContractVersion',
  'shadowSettlementNormalizationLabel',
] as const;

const disabledCapabilities: CbeBirrNormalizationOwnershipDisabledCapabilities = Object.freeze({
  authoritativeProfileSelectionAllowed: false,
  crossProfileCompatibilityAssumptionAllowed: false,
  crossProfileTransformationReuseAllowed: false,
  implicitVersionUpgradeAllowed: false,
  normalizationExecutionAllowed: false,
  runtimeWiringAllowed: false,
  providerRequestAllowed: false,
  financialClaimAllowed: false,
});

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value')
    );
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function isExactRequest(candidate: unknown): candidate is CbeBirrNormalizationOwnershipRequest {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, requestKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'submittedReferenceNormalizationVersion') === null &&
    ownDataValue(candidate, 'submittedReferenceProtectionKeyVersion') === 1 &&
    ownDataValue(candidate, 'submittedReferenceSourceAttestation') ===
      CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION &&
    ownDataValue(candidate, 'providerAwareProofProtectionKeyVersion') === 2 &&
    ownDataValue(candidate, 'providerAwareProofProfileVersion') === 2 &&
    ownDataValue(candidate, 'providerAwareProofSourceAttestation') ===
      CBE_BIRR_PROVIDER_AWARE_PROOF_CAPTURE_SOURCE_ATTESTATION &&
    ownDataValue(candidate, 'receiverReferenceProtectionKeyVersion') === 1 &&
    ownDataValue(candidate, 'receiverReferenceProfileVersion') === 1 &&
    ownDataValue(candidate, 'receiverReferenceSourceAttestation') ===
      CBE_BIRR_RECEIVER_REFERENCE_PROTECTION_SOURCE_ATTESTATION &&
    ownDataValue(candidate, 'fixtureSchemaLabel') ===
      'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V1' &&
    ownDataValue(candidate, 'fixtureSchemaVersion') === 1 &&
    ownDataValue(candidate, 'fixtureNormalizerVersion') === 1 &&
    ownDataValue(candidate, 'fixtureAdapterLabel') === 'fixture-adapter-v1' &&
    ownDataValue(candidate, 'fixtureNormalizationLabel') === 'fixture-normalizer-v1' &&
    ownDataValue(candidate, 'fixtureNormalizerSourceAttestation') ===
      CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION &&
    ownDataValue(candidate, 'shadowSettlementContractVersion') === 1 &&
    ownDataValue(candidate, 'shadowSettlementNormalizationLabel') === 'cbe-birr-normalization-v1'
  );
}

export const CBE_BIRR_NORMALIZATION_OWNERSHIP_CURRENT_REQUEST: CbeBirrNormalizationOwnershipRequest =
  Object.freeze({
    contractVersion: CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    submittedReferenceNormalizationVersion: null,
    submittedReferenceProtectionKeyVersion: 1 as const,
    submittedReferenceSourceAttestation: CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION,
    providerAwareProofProtectionKeyVersion: 2 as const,
    providerAwareProofProfileVersion: 2 as const,
    providerAwareProofSourceAttestation: CBE_BIRR_PROVIDER_AWARE_PROOF_CAPTURE_SOURCE_ATTESTATION,
    receiverReferenceProtectionKeyVersion: 1 as const,
    receiverReferenceProfileVersion: 1 as const,
    receiverReferenceSourceAttestation: CBE_BIRR_RECEIVER_REFERENCE_PROTECTION_SOURCE_ATTESTATION,
    fixtureSchemaLabel: 'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V1' as const,
    fixtureSchemaVersion: 1 as const,
    fixtureNormalizerVersion: 1 as const,
    fixtureAdapterLabel: 'fixture-adapter-v1' as const,
    fixtureNormalizationLabel: 'fixture-normalizer-v1' as const,
    fixtureNormalizerSourceAttestation: CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION,
    shadowSettlementContractVersion: 1 as const,
    shadowSettlementNormalizationLabel: 'cbe-birr-normalization-v1' as const,
  });

/** The only decision for the exact current inventory; every positive capability remains off. */
export const CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT: CbeBirrNormalizationOwnershipBlockedResult =
  Object.freeze({
    contractVersion: CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'blocked' as const,
    reasonCode: 'normalization_ownership_review_incomplete' as const,
    authoritativeOwner: 'unassigned' as const,
    jointReviewStatus: 'not_completed' as const,
    remainingBlockers: CBE_BIRR_NORMALIZATION_OWNERSHIP_REMAINING_BLOCKERS,
    profiles: CBE_BIRR_NORMALIZATION_PROFILE_INVENTORY,
    compatibility: CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY,
    ...disabledCapabilities,
  });

/** A distinct fixed decision for an unknown profile label, version, field, or hostile value. */
export const CBE_BIRR_NORMALIZATION_OWNERSHIP_INVALID_RESULT: CbeBirrNormalizationOwnershipInvalidResult =
  Object.freeze({
    contractVersion: CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_request' as const,
    reasonCode: 'invalid_request' as const,
    ...disabledCapabilities,
  });

const blockedLogProjection: RedactedCbeBirrNormalizationOwnershipBlockedLogProjection =
  Object.freeze({
    contractVersion: CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'blocked' as const,
    reasonCode: 'normalization_ownership_review_incomplete' as const,
    profileCount: 5 as const,
    compatibilityPairCount: 10 as const,
  });

const invalidLogProjection: RedactedCbeBirrNormalizationOwnershipInvalidLogProjection =
  Object.freeze({
    contractVersion: CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_result' as const,
    reasonCode: 'invalid_result' as const,
  });

/**
 * Evaluates only fixed public version metadata. It never accepts or transforms a transaction
 * reference, receiver value, provider payload, protected material, or runtime configuration.
 */
export function evaluateCbeBirrNormalizationOwnership(
  requestCandidate: unknown,
): CbeBirrNormalizationOwnershipResult {
  try {
    return isExactRequest(requestCandidate)
      ? CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT
      : CBE_BIRR_NORMALIZATION_OWNERSHIP_INVALID_RESULT;
  } catch {
    return CBE_BIRR_NORMALIZATION_OWNERSHIP_INVALID_RESULT;
  }
}

/** Returns fixed allowlisted metadata and never reflects a candidate value. */
export function redactedCbeBirrNormalizationOwnershipForLog(
  resultCandidate: unknown,
): RedactedCbeBirrNormalizationOwnershipLogProjection {
  return resultCandidate === CBE_BIRR_NORMALIZATION_OWNERSHIP_BLOCKED_RESULT
    ? blockedLogProjection
    : invalidLogProjection;
}
