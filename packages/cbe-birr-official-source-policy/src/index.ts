import { isProxy } from 'node:util/types';

/**
 * Pure Stage 1E source-boundary contract. Version 2 defines an exact offline request profile but
 * deliberately provides no transport, provider request, persistence, claim, or financial path.
 */
export const CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION = 2 as const;
export const CBE_BIRR_OFFICIAL_SOURCE_PROFILE = 'cbe_birr_official_receipt_lookup_v1' as const;
export const CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE = 'provider_receipt_lookup' as const;

export const CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE = Object.freeze({
  method: 'GET' as const,
  scheme: 'https' as const,
  host: 'cbepay1.cbe.com.et' as const,
  port: 443 as const,
  path: '/aureceipt' as const,
  queryParameterOrder: Object.freeze(['TID', 'PH'] as const),
  redirectPolicy: 'reject_all' as const,
});

interface CbeBirrOfficialSourceDisabledCapabilities {
  readonly transportAllowed: false;
  readonly providerRequestAllowed: false;
  readonly decryptionAllowed: false;
  readonly leaseAcquisitionAllowed: false;
  readonly databaseAccessAllowed: false;
  readonly persistenceAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly evidenceClaimAllowed: false;
  readonly financialActionAllowed: false;
}

export interface CbeBirrOfficialSourcePolicyRequest {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
}

export interface CbeBirrOfficialSourcePolicyOfflineProfileResult extends CbeBirrOfficialSourceDisabledCapabilities {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_OFFICIAL_SOURCE_PROFILE;
  readonly advisoryOnly: true;
  readonly disposition: 'offline_profile_defined';
  readonly evidenceSource: typeof CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE;
  readonly reasonCode: 'live_transport_absent';
  readonly requestProfile: typeof CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE;
}

export interface CbeBirrOfficialSourcePolicyInvalidResult extends CbeBirrOfficialSourceDisabledCapabilities {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
}

export type CbeBirrOfficialSourcePolicyResult =
  CbeBirrOfficialSourcePolicyOfflineProfileResult | CbeBirrOfficialSourcePolicyInvalidResult;

export type RedactedCbeBirrOfficialSourcePolicyOfflineProfileLogProjection =
  CbeBirrOfficialSourcePolicyOfflineProfileResult;

export interface RedactedCbeBirrOfficialSourcePolicyInvalidLogProjection {
  readonly contractVersion: typeof CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_result';
  readonly reasonCode: 'invalid_result';
}

export type RedactedCbeBirrOfficialSourcePolicyLogProjection =
  | RedactedCbeBirrOfficialSourcePolicyOfflineProfileLogProjection
  | RedactedCbeBirrOfficialSourcePolicyInvalidLogProjection;

type UnknownRecord = Record<string, unknown>;

const requestKeys = ['contractVersion', 'providerCode', 'sourceProfile'] as const;
const disabledCapabilityKeys = [
  'transportAllowed',
  'providerRequestAllowed',
  'decryptionAllowed',
  'leaseAcquisitionAllowed',
  'databaseAccessAllowed',
  'persistenceAllowed',
  'runtimeWiringAllowed',
  'evidenceClaimAllowed',
  'financialActionAllowed',
] as const;
const resultKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'advisoryOnly',
  'disposition',
  'evidenceSource',
  'reasonCode',
  'requestProfile',
  ...disabledCapabilityKeys,
] as const;
const requestProfileKeys = [
  'method',
  'scheme',
  'host',
  'port',
  'path',
  'queryParameterOrder',
  'redirectPolicy',
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
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function isExactStringTuple(candidate: unknown, expected: readonly string[]): boolean {
  if (
    !Array.isArray(candidate) ||
    isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Array.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(candidate);
  const expectedKeys = [...expected.map((_, index) => String(index)), 'length'];
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key)) &&
    expected.every((value, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
      return descriptor?.enumerable === true && descriptor.value === value;
    })
  );
}

function isExactRequestProfile(candidate: unknown): boolean {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, requestProfileKeys)
  ) {
    return false;
  }
  return (
    ownDataValue(candidate, 'method') === 'GET' &&
    ownDataValue(candidate, 'scheme') === 'https' &&
    ownDataValue(candidate, 'host') === 'cbepay1.cbe.com.et' &&
    ownDataValue(candidate, 'port') === 443 &&
    ownDataValue(candidate, 'path') === '/aureceipt' &&
    isExactStringTuple(ownDataValue(candidate, 'queryParameterOrder'), ['TID', 'PH']) &&
    ownDataValue(candidate, 'redirectPolicy') === 'reject_all'
  );
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

function hasAllDisabledCapabilities(candidate: UnknownRecord): boolean {
  return disabledCapabilityKeys.every((key) => ownDataValue(candidate, key) === false);
}

function isExactOfflineProfileResult(
  candidate: unknown,
): candidate is CbeBirrOfficialSourcePolicyOfflineProfileResult {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, resultKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === CBE_BIRR_OFFICIAL_SOURCE_PROFILE &&
    ownDataValue(candidate, 'advisoryOnly') === true &&
    ownDataValue(candidate, 'disposition') === 'offline_profile_defined' &&
    ownDataValue(candidate, 'evidenceSource') === CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE &&
    ownDataValue(candidate, 'reasonCode') === 'live_transport_absent' &&
    isExactRequestProfile(ownDataValue(candidate, 'requestProfile')) &&
    hasAllDisabledCapabilities(candidate)
  );
}

const disabledCapabilities: CbeBirrOfficialSourceDisabledCapabilities = {
  transportAllowed: false,
  providerRequestAllowed: false,
  decryptionAllowed: false,
  leaseAcquisitionAllowed: false,
  databaseAccessAllowed: false,
  persistenceAllowed: false,
  runtimeWiringAllowed: false,
  evidenceClaimAllowed: false,
  financialActionAllowed: false,
};

export const CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT: CbeBirrOfficialSourcePolicyOfflineProfileResult =
  Object.freeze({
    contractVersion: CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    sourceProfile: CBE_BIRR_OFFICIAL_SOURCE_PROFILE,
    advisoryOnly: true as const,
    disposition: 'offline_profile_defined' as const,
    evidenceSource: CBE_BIRR_OFFICIAL_EVIDENCE_SOURCE,
    reasonCode: 'live_transport_absent' as const,
    requestProfile: CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE,
    ...disabledCapabilities,
  });

export const CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT: CbeBirrOfficialSourcePolicyInvalidResult =
  Object.freeze({
    contractVersion: CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_request' as const,
    reasonCode: 'invalid_request' as const,
    ...disabledCapabilities,
  });

const offlineProfileLogProjection: RedactedCbeBirrOfficialSourcePolicyOfflineProfileLogProjection =
  Object.freeze({ ...CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT });
const invalidLogProjection: RedactedCbeBirrOfficialSourcePolicyInvalidLogProjection = Object.freeze(
  {
    contractVersion: CBE_BIRR_OFFICIAL_SOURCE_POLICY_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_result' as const,
    reasonCode: 'invalid_result' as const,
  },
);

export function evaluateCbeBirrOfficialSourcePolicy(
  requestCandidate: unknown,
): CbeBirrOfficialSourcePolicyResult {
  try {
    return isExactRequest(requestCandidate)
      ? CBE_BIRR_OFFICIAL_SOURCE_POLICY_OFFLINE_PROFILE_RESULT
      : CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT;
  } catch {
    return CBE_BIRR_OFFICIAL_SOURCE_POLICY_INVALID_RESULT;
  }
}

export function redactedCbeBirrOfficialSourcePolicyResultForLog(
  resultCandidate: unknown,
): RedactedCbeBirrOfficialSourcePolicyLogProjection {
  try {
    return isExactOfflineProfileResult(resultCandidate)
      ? offlineProfileLogProjection
      : invalidLogProjection;
  } catch {
    return invalidLogProjection;
  }
}

export {
  CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION,
  CBE_BIRR_OFFLINE_RECEIPT_MAX_RESPONSE_BYTES,
  CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION,
  buildSyntheticCbeBirrOfficialReceiptLookupPlan,
  inspectSyntheticCbeBirrOfficialReceipt,
  projectCbeBirrOfflineReceiptLog,
  redactedSyntheticCbeBirrOfficialReceiptForLog,
  syntheticCbeBirrOfficialReceiptFixture,
  syntheticCbeBirrOfficialReceiptFixtureInput,
  type CbeBirrCompiledSyntheticRequest,
  type CbeBirrSyntheticOfficialReceiptInput,
  type CbeBirrSyntheticOfficialReceiptResponse,
  type CbeBirrSyntheticOfficialReceiptResult,
} from './offline-receipt.js';
