import { isProxy } from 'node:util/types';

/**
 * Pure Stage 1E source-boundary contract. This package cannot select a transport, decrypt
 * provider material, acquire work, or make a provider request. It only records that permission
 * to use the named official evidence source has not yet been proven.
 */
export const CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION = 1 as const;
export const CBE_BIRR_OFFICIAL_SOURCE_PROFILE = 'cbe_birr_official_receipt_lookup_v1' as const;
export const CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE = 'provider_receipt_lookup' as const;

export interface CbeBirrOfficialSourcePolicyRequest {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
}

export interface CbeBirrOfficialSourcePolicyBlockedResult {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
  readonly advisoryOnly: true;
  readonly disposition: 'blocked';
  readonly evidenceSource: typeof CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE;
  readonly reasonCode: 'source_permission_unproven';
  readonly transportAllowed: false;
  readonly decryptionAllowed: false;
  readonly leaseAcquisitionAllowed: false;
  readonly providerRequestAllowed: false;
}

export interface CbeBirrOfficialSourcePolicyInvalidResult {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
  readonly transportAllowed: false;
  readonly decryptionAllowed: false;
  readonly leaseAcquisitionAllowed: false;
  readonly providerRequestAllowed: false;
}

export type CbeBirrOfficialSourcePolicyResult =
  CbeBirrOfficialSourcePolicyBlockedResult | CbeBirrOfficialSourcePolicyInvalidResult;

export interface RedactedCbeBirrOfficialSourcePolicyBlockedLogProjection {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
  readonly advisoryOnly: true;
  readonly disposition: 'blocked';
  readonly evidenceSource: typeof CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE;
  readonly reasonCode: 'source_permission_unproven';
  readonly transportAllowed: false;
  readonly decryptionAllowed: false;
  readonly leaseAcquisitionAllowed: false;
  readonly providerRequestAllowed: false;
}

export interface RedactedCbeBirrOfficialSourcePolicyInvalidLogProjection {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_result';
  readonly reasonCode: 'invalid_result';
}

export type RedactedCbeBirrOfficialSourcePolicyLogProjection =
  | RedactedCbeBirrOfficialSourcePolicyBlockedLogProjection
  | RedactedCbeBirrOfficialSourcePolicyInvalidLogProjection;

type UnknownRecord = Record<string, unknown>;

const requestKeys = ['contractVersion', 'providerCode', 'sourceProfile'] as const;
const blockedResultKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'advisoryOnly',
  'disposition',
  'evidenceSource',
  'reasonCode',
  'transportAllowed',
  'decryptionAllowed',
  'leaseAcquisitionAllowed',
  'providerRequestAllowed',
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

function isExactRequest(candidate: unknown): candidate is CbeBirrOfficialSourcePolicyRequest {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, requestKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === CBE_BIRR_OFFICIAL_SOURCE_PROFILE
  );
}

function isExactBlockedResult(
  candidate: unknown,
): candidate is CbeBirrOfficialSourcePolicyBlockedResult {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, blockedResultKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === CBE_BIRR_OFFICIAL_SOURCE_PROFILE &&
    ownDataValue(candidate, 'advisoryOnly') === true &&
    ownDataValue(candidate, 'disposition') === 'blocked' &&
    ownDataValue(candidate, 'evidenceSource') === CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE &&
    ownDataValue(candidate, 'reasonCode') === 'source_permission_unproven' &&
    ownDataValue(candidate, 'transportAllowed') === false &&
    ownDataValue(candidate, 'decryptionAllowed') === false &&
    ownDataValue(candidate, 'leaseAcquisitionAllowed') === false &&
    ownDataValue(candidate, 'providerRequestAllowed') === false
  );
}

/**
 * The sole result for the one valid request. It is a constant fail-closed decision: callers cannot
 * influence any capability flag or select provider connection material.
 */
export const CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT: CbeBirrOfficialSourcePolicyBlockedResult =
  Object.freeze({
    contractVersion: CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    sourceProfile: CBE_BIRR_OFFICIAL_SOURCE_PROFILE,
    advisoryOnly: true as const,
    disposition: 'blocked' as const,
    evidenceSource: CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE,
    reasonCode: 'source_permission_unproven' as const,
    transportAllowed: false as const,
    decryptionAllowed: false as const,
    leaseAcquisitionAllowed: false as const,
    providerRequestAllowed: false as const,
  });

/** A distinct constant result for every malformed or hostile request. */
export const CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT: CbeBirrOfficialSourcePolicyInvalidResult =
  Object.freeze({
    contractVersion: CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_request' as const,
    reasonCode: 'invalid_request' as const,
    transportAllowed: false as const,
    decryptionAllowed: false as const,
    leaseAcquisitionAllowed: false as const,
    providerRequestAllowed: false as const,
  });

const blockedLogProjection: RedactedCbeBirrOfficialSourcePolicyBlockedLogProjection = Object.freeze(
  { ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT },
);

const invalidLogProjection: RedactedCbeBirrOfficialSourcePolicyInvalidLogProjection = Object.freeze(
  {
    contractVersion: CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_result' as const,
    reasonCode: 'invalid_result' as const,
  },
);

/**
 * Evaluates untrusted data without executing or selecting any provider capability. Invalid and
 * hostile inputs return the same constant invalid result and are never copied or thrown.
 */
export function evaluateCbeBirrOfficialSourcePolicy(
  requestCandidate: unknown,
): CbeBirrOfficialSourcePolicyResult {
  try {
    return isExactRequest(requestCandidate)
      ? CBE_BIRR_OFFICIAL_SOURCE_POLICY_BLOCKED_RESULT
      : CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT;
  } catch {
    return CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT;
  }
}

/**
 * Revalidates an untrusted result and emits only constant, allowlisted policy fields. It never
 * serializes the candidate, accessor values, proxy errors, or connection material.
 */
export function redactedCbeBirrOfficialSourcePolicyResultForLog(
  resultCandidate: unknown,
): RedactedCbeBirrOfficialSourcePolicyLogProjection {
  try {
    return isExactBlockedResult(resultCandidate) ? blockedLogProjection : invalidLogProjection;
  } catch {
    return invalidLogProjection;
  }
}
