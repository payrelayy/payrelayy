import { CBE_BIRR_OFFICIAL_SOURCE_PROFILE } from '@fetanagent/cbe-birr-official-source-policy';
import { isProxy } from 'node:util/types';

export * from './normalization-ownership.js';

/**
 * Pure Stage 1F prerequisite inventory. This package cannot accept or decrypt protected material,
 * infer missing protection metadata, acquire a lease, contact a provider, persist state, or make a
 * financial claim. It only records the currently reviewed reasons an authoritative lookup cannot
 * begin.
 */
export const CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION = 1 as const;
export const CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE =
  'cbe_birr_shadow_protected_lookup_material_legacy' as const;

export const CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS = Object.freeze([
  'source_permission_unproven',
  'receiver_lookup_protection_metadata_absent',
  'receiver_lookup_key_provenance_unproven',
  'receiver_lookup_new_revision_and_fresh_provisioning_required',
  'receiver_lookup_metadata_inference_or_backfill_forbidden',
  'submitted_reference_encryption_and_fingerprint_subkeys_share_api_master_provisioning_root',
  'submitted_reference_independent_worker_decrypt_lifecycle_absent',
  'lookup_reference_normalization_unreviewed',
  'receiver_lookup_normalization_unreviewed',
  'canonical_reference_normalization_unreviewed',
  'prelease_prerequisite_gate_absent',
  'lease_boundary_returns_protected_material',
] as const);

export type CbeBirrAuthoritativeLookupRemainingBlocker =
  (typeof CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS)[number];

export interface CbeBirrAuthoritativeLookupPrerequisiteRequest {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
  readonly legacyMaterialShape: typeof CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE;
}

interface CbeBirrAuthoritativeLookupDisabledCapabilities {
  readonly ciphertextAcceptanceAllowed: false;
  readonly plaintextAcceptanceAllowed: false;
  readonly keyMaterialAllowed: false;
  readonly normalizationAllowed: false;
  readonly metadataInferenceAllowed: false;
  readonly metadataBackfillAllowed: false;
  readonly sourcePermissionAllowed: false;
  readonly decryptionAllowed: false;
  readonly transportAllowed: false;
  readonly providerRequestAllowed: false;
  readonly leaseAcquisitionAllowed: false;
  readonly protectedMaterialReturnAllowed: false;
  readonly persistenceAllowed: false;
  readonly schemaMutationAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly financialClaimAllowed: false;
}

export interface CbeBirrAuthoritativeLookupBlockedResult extends CbeBirrAuthoritativeLookupDisabledCapabilities {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
  readonly legacyMaterialShape: typeof CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE;
  readonly advisoryOnly: true;
  readonly disposition: 'blocked';
  readonly reasonCode: 'authoritative_lookup_prerequisites_incomplete';
  readonly remainingBlockers: typeof CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS;
}

export interface CbeBirrAuthoritativeLookupInvalidResult extends CbeBirrAuthoritativeLookupDisabledCapabilities {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
}

export type CbeBirrAuthoritativeLookupPrerequisiteResult =
  CbeBirrAuthoritativeLookupBlockedResult | CbeBirrAuthoritativeLookupInvalidResult;

export type RedactedCbeBirrAuthoritativeLookupBlockedLogProjection =
  CbeBirrAuthoritativeLookupBlockedResult;

export interface RedactedCbeBirrAuthoritativeLookupInvalidLogProjection {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_result';
  readonly reasonCode: 'invalid_result';
}

export type RedactedCbeBirrAuthoritativeLookupPrerequisiteLogProjection =
  | RedactedCbeBirrAuthoritativeLookupBlockedLogProjection
  | RedactedCbeBirrAuthoritativeLookupInvalidLogProjection;

type UnknownRecord = Record<string, unknown>;

const requestKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'legacyMaterialShape',
] as const;

const disabledCapabilityKeys = [
  'ciphertextAcceptanceAllowed',
  'plaintextAcceptanceAllowed',
  'keyMaterialAllowed',
  'normalizationAllowed',
  'metadataInferenceAllowed',
  'metadataBackfillAllowed',
  'sourcePermissionAllowed',
  'decryptionAllowed',
  'transportAllowed',
  'providerRequestAllowed',
  'leaseAcquisitionAllowed',
  'protectedMaterialReturnAllowed',
  'persistenceAllowed',
  'schemaMutationAllowed',
  'runtimeWiringAllowed',
  'financialClaimAllowed',
] as const;

const blockedResultKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'legacyMaterialShape',
  'advisoryOnly',
  'disposition',
  'reasonCode',
  'remainingBlockers',
  ...disabledCapabilityKeys,
] as const;

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
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

function isExactBlockerTuple(
  candidate: unknown,
): candidate is typeof CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    isProxy(candidate) ||
    !Array.isArray(candidate) ||
    Object.getPrototypeOf(candidate) !== Array.prototype
  ) {
    return false;
  }

  const ownKeys = Reflect.ownKeys(candidate);
  const expectedOwnKeys = [
    ...CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS.map((_, index) => String(index)),
    'length',
  ];
  if (
    ownKeys.length !== expectedOwnKeys.length ||
    !expectedOwnKeys.every((key) => ownKeys.includes(key))
  ) {
    return false;
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS.length
  ) {
    return false;
  }

  return CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS.every((blocker, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === blocker
    );
  });
}

function hasAllDisabledCapabilities(candidate: UnknownRecord): boolean {
  return disabledCapabilityKeys.every((key) => ownDataValue(candidate, key) === false);
}

function isExactRequest(
  candidate: unknown,
): candidate is CbeBirrAuthoritativeLookupPrerequisiteRequest {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, requestKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === CBE_BIRR_OFFICIAL_SOURCE_PROFILE &&
    ownDataValue(candidate, 'legacyMaterialShape') === CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE
  );
}

function isExactBlockedResult(
  candidate: unknown,
): candidate is CbeBirrAuthoritativeLookupBlockedResult {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, blockedResultKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === CBE_BIRR_OFFICIAL_SOURCE_PROFILE &&
    ownDataValue(candidate, 'legacyMaterialShape') === CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE &&
    ownDataValue(candidate, 'advisoryOnly') === true &&
    ownDataValue(candidate, 'disposition') === 'blocked' &&
    ownDataValue(candidate, 'reasonCode') === 'authoritative_lookup_prerequisites_incomplete' &&
    isExactBlockerTuple(ownDataValue(candidate, 'remainingBlockers')) &&
    hasAllDisabledCapabilities(candidate)
  );
}

const disabledCapabilities: CbeBirrAuthoritativeLookupDisabledCapabilities = {
  ciphertextAcceptanceAllowed: false,
  plaintextAcceptanceAllowed: false,
  keyMaterialAllowed: false,
  normalizationAllowed: false,
  metadataInferenceAllowed: false,
  metadataBackfillAllowed: false,
  sourcePermissionAllowed: false,
  decryptionAllowed: false,
  transportAllowed: false,
  providerRequestAllowed: false,
  leaseAcquisitionAllowed: false,
  protectedMaterialReturnAllowed: false,
  persistenceAllowed: false,
  schemaMutationAllowed: false,
  runtimeWiringAllowed: false,
  financialClaimAllowed: false,
};

/** The sole decision for the one valid request. Every capability remains fixed off. */
export const CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT: CbeBirrAuthoritativeLookupBlockedResult =
  Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    sourceProfile: CBE_BIRR_OFFICIAL_SOURCE_PROFILE,
    legacyMaterialShape: CBE_BIRR_LEGACY_LOOKUP_MATERIAL_SHAPE,
    advisoryOnly: true as const,
    disposition: 'blocked' as const,
    reasonCode: 'authoritative_lookup_prerequisites_incomplete' as const,
    remainingBlockers: CBE_BIRR_AUTHORITATIVE_LOOKUP_REMAINING_BLOCKERS,
    ...disabledCapabilities,
  });

/** A distinct constant decision for every malformed or hostile request. */
export const CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT: CbeBirrAuthoritativeLookupInvalidResult =
  Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_request' as const,
    reasonCode: 'invalid_request' as const,
    ...disabledCapabilities,
  });

const blockedLogProjection: RedactedCbeBirrAuthoritativeLookupBlockedLogProjection = Object.freeze({
  ...CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT,
});

const invalidLogProjection: RedactedCbeBirrAuthoritativeLookupInvalidLogProjection = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_LOOKUP_PREREQUISITE_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  advisoryOnly: true as const,
  disposition: 'invalid_result' as const,
  reasonCode: 'invalid_result' as const,
});

/** Evaluates untrusted metadata without accepting, deriving, or echoing protected material. */
export function evaluateCbeBirrAuthoritativeLookupPrerequisites(
  requestCandidate: unknown,
): CbeBirrAuthoritativeLookupPrerequisiteResult {
  try {
    return isExactRequest(requestCandidate)
      ? CBE_BIRR_AUTHORITATIVE_LOOKUP_BLOCKED_RESULT
      : CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT;
  } catch {
    return CBE_BIRR_AUTHORITATIVE_LOOKUP_INVALID_RESULT;
  }
}

/** Emits only fixed allowlisted metadata after trap-free structural revalidation. */
export function redactedCbeBirrAuthoritativeLookupPrerequisiteForLog(
  resultCandidate: unknown,
): RedactedCbeBirrAuthoritativeLookupPrerequisiteLogProjection {
  try {
    return isExactBlockedResult(resultCandidate) ? blockedLogProjection : invalidLogProjection;
  } catch {
    return invalidLogProjection;
  }
}
