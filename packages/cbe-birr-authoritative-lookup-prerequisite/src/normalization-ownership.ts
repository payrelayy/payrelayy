import { isProxy } from 'node:util/types';

/**
 * Metadata-only inventory of the three normalization boundaries that already exist in the
 * repository. It does not normalize a value, declare the profiles equivalent, select an
 * authoritative profile, or authorize runtime use.
 */
export const CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION = 1 as const;
export const CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION =
  'sha256:002f87dcaa46d0bc49189e21cceaca9d7ea841746edfd4efd520863c4a54b2a4' as const;
export const CBE_BIRR_OFFLINE_FIXTURE_NORMALIZER_SOURCE_ATTESTATION =
  'sha256:362779764454f371171796cc7bf37e604732bad78694c10ebe0917afa8d3ea61' as const;

export const CBE_BIRR_NORMALIZATION_OWNERSHIP_REMAINING_BLOCKERS = Object.freeze([
  'lookup_reference_normalization_unreviewed',
  'receiver_lookup_normalization_unreviewed',
  'canonical_reference_normalization_unreviewed',
] as const);

const submittedReferenceTransformations = Object.freeze([
  'reject_input_changed_by_trim',
  'require_5_to_128_ascii_alphanumeric_dot_underscore_or_hyphen_code_points',
  'map_ascii_lowercase_to_uppercase_with_string_to_upper_case',
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
    profileId: 'submitted_reference_capture' as const,
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

export const CBE_BIRR_NORMALIZATION_COMPATIBILITY_INVENTORY = Object.freeze([
  Object.freeze({
    leftProfileId: 'submitted_reference_capture' as const,
    rightProfileId: 'offline_synthetic_fixture_reduction' as const,
    status: 'not_established' as const,
    equivalenceAllowed: false as const,
    transformationReuseAllowed: false as const,
  }),
  Object.freeze({
    leftProfileId: 'submitted_reference_capture' as const,
    rightProfileId: 'shadow_settlement_metadata_label' as const,
    status: 'not_established' as const,
    equivalenceAllowed: false as const,
    transformationReuseAllowed: false as const,
  }),
  Object.freeze({
    leftProfileId: 'offline_synthetic_fixture_reduction' as const,
    rightProfileId: 'shadow_settlement_metadata_label' as const,
    status: 'not_established' as const,
    equivalenceAllowed: false as const,
    transformationReuseAllowed: false as const,
  }),
] as const);

export interface CbeBirrNormalizationOwnershipRequest {
  readonly contractVersion: typeof CBE_BIRR_NORMALIZATION_OWNERSHIP_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly submittedReferenceNormalizationVersion: null;
  readonly submittedReferenceProtectionKeyVersion: 1;
  readonly submittedReferenceSourceAttestation: typeof CBE_BIRR_SUBMITTED_REFERENCE_CAPTURE_SOURCE_ATTESTATION;
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
  readonly profileCount: 3;
  readonly compatibilityPairCount: 3;
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
    profileCount: 3 as const,
    compatibilityPairCount: 3 as const,
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
