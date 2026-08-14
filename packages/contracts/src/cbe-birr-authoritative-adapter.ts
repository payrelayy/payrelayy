import { isProxy } from 'node:util/types';

import type {
  CbeBirrAuthoritativeShadowFoundEvidence,
  CbeBirrAuthoritativeShadowMissingEvidence,
  CbeBirrAuthoritativeShadowUnavailableEvidence,
} from './cbe-birr-authoritative-shadow.js';

/**
 * Safe, synchronous boundary between a CBE Birr adapter and the Stage 1A shadow evaluator.
 *
 * The adapter must reduce provider material before constructing this contract. Raw canonical
 * references, receiver identifiers, receipt bodies, URLs, credentials, and transport metadata are
 * deliberately impossible to represent. Duplicate-reference state is also excluded because a
 * separate read boundary must establish it.
 */
export const CBE_BIRR_AUTHORITATIVE_ADAPTER_CONTRACT_VERSION = 1 as const;

export type CbeBirrAuthoritativeAdapterFoundEvidence = Omit<
  CbeBirrAuthoritativeShadowFoundEvidence,
  'duplicateCheck'
>;

export type CbeBirrAuthoritativeAdapterEvidence =
  | CbeBirrAuthoritativeShadowUnavailableEvidence
  | CbeBirrAuthoritativeShadowMissingEvidence
  | CbeBirrAuthoritativeAdapterFoundEvidence;

export interface CbeBirrAuthoritativeAdapterResult {
  readonly contractVersion: 1;
  readonly providerCode: 'cbe_birr';
  readonly evidence: CbeBirrAuthoritativeAdapterEvidence;
}

export interface CbeBirrAuthoritativeAdapterLogProjection {
  readonly contractVersion: 1;
  readonly providerCode: 'cbe_birr';
  readonly safeFactsOnly: true;
  readonly lookupOutcome: 'found' | 'not_found' | 'unavailable';
  readonly uncertainty: 'provider' | 'network' | 'parser' | null;
}

type UnknownRecord = Record<string, unknown>;

const resultKeys = ['contractVersion', 'providerCode', 'evidence'] as const;
const foundEvidenceKeys = [
  'lookupOutcome',
  'evidenceSource',
  'providerIdentity',
  'providerFinalStatus',
  'canonicalReferencePresent',
  'amountMinor',
  'currencyCode',
  'receiverMatch',
  'paymentType',
  'occurredAt',
  'retrievedAt',
  'provenance',
] as const;
const provenanceKeys = [
  'adapterVersionPresent',
  'normalizationVersionPresent',
  'evidenceDigestPresent',
] as const;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const parserUnavailableEvidence = Object.freeze({
  lookupOutcome: 'unavailable' as const,
  uncertainty: 'parser' as const,
});

const parserUnavailableResult: CbeBirrAuthoritativeAdapterResult = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_ADAPTER_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  evidence: parserUnavailableEvidence,
});

function isPlainRecord(value: unknown): value is UnknownRecord {
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

function parseUtcTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function parseProvenance(
  candidate: unknown,
): CbeBirrAuthoritativeAdapterFoundEvidence['provenance'] | undefined {
  if (!isPlainRecord(candidate) || !hasExactEnumerableDataKeys(candidate, provenanceKeys)) {
    return undefined;
  }

  const adapterVersionPresent = ownDataValue(candidate, 'adapterVersionPresent');
  const normalizationVersionPresent = ownDataValue(candidate, 'normalizationVersionPresent');
  const evidenceDigestPresent = ownDataValue(candidate, 'evidenceDigestPresent');
  if (
    typeof adapterVersionPresent !== 'boolean' ||
    typeof normalizationVersionPresent !== 'boolean' ||
    typeof evidenceDigestPresent !== 'boolean'
  ) {
    return undefined;
  }

  return Object.freeze({
    adapterVersionPresent,
    normalizationVersionPresent,
    evidenceDigestPresent,
  });
}

function parseFoundEvidence(
  candidate: UnknownRecord,
): CbeBirrAuthoritativeAdapterFoundEvidence | undefined {
  if (!hasExactEnumerableDataKeys(candidate, foundEvidenceKeys)) return undefined;

  const evidenceSource = ownDataValue(candidate, 'evidenceSource');
  const providerIdentity = ownDataValue(candidate, 'providerIdentity');
  const providerFinalStatus = ownDataValue(candidate, 'providerFinalStatus');
  const canonicalReferencePresent = ownDataValue(candidate, 'canonicalReferencePresent');
  const amountMinor = ownDataValue(candidate, 'amountMinor');
  const currencyCode = ownDataValue(candidate, 'currencyCode');
  const receiverMatch = ownDataValue(candidate, 'receiverMatch');
  const paymentType = ownDataValue(candidate, 'paymentType');
  const occurredAt = parseUtcTimestamp(ownDataValue(candidate, 'occurredAt'));
  const retrievedAt = parseUtcTimestamp(ownDataValue(candidate, 'retrievedAt'));
  const provenance = parseProvenance(ownDataValue(candidate, 'provenance'));

  if (
    ownDataValue(candidate, 'lookupOutcome') !== 'found' ||
    (evidenceSource !== 'provider_api' &&
      evidenceSource !== 'provider_receipt_lookup' &&
      evidenceSource !== 'provider_account_activity') ||
    (providerIdentity !== 'matched' &&
      providerIdentity !== 'mismatched' &&
      providerIdentity !== 'unknown') ||
    (providerFinalStatus !== 'completed' &&
      providerFinalStatus !== 'pending' &&
      providerFinalStatus !== 'failed' &&
      providerFinalStatus !== 'unknown') ||
    typeof canonicalReferencePresent !== 'boolean' ||
    (amountMinor !== null &&
      (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0)) ||
    (currencyCode !== 'ETB' && currencyCode !== 'other' && currencyCode !== 'unknown') ||
    (receiverMatch !== 'matched' &&
      receiverMatch !== 'mismatched' &&
      receiverMatch !== 'unknown') ||
    (paymentType !== 'send_money' && paymentType !== 'other' && paymentType !== 'unknown') ||
    occurredAt === undefined ||
    retrievedAt === undefined ||
    !provenance
  ) {
    return undefined;
  }

  return Object.freeze({
    lookupOutcome: 'found' as const,
    evidenceSource,
    providerIdentity,
    providerFinalStatus,
    canonicalReferencePresent,
    amountMinor: amountMinor as number | null,
    currencyCode,
    receiverMatch,
    paymentType,
    occurredAt,
    retrievedAt,
    provenance,
  });
}

function parseEvidence(candidate: unknown): CbeBirrAuthoritativeAdapterEvidence | undefined {
  if (!isPlainRecord(candidate)) return undefined;
  const lookupOutcomeDescriptor = Object.getOwnPropertyDescriptor(candidate, 'lookupOutcome');
  if (
    !lookupOutcomeDescriptor ||
    lookupOutcomeDescriptor.enumerable !== true ||
    !Object.hasOwn(lookupOutcomeDescriptor, 'value')
  ) {
    return undefined;
  }

  if (lookupOutcomeDescriptor.value === 'not_found') {
    return hasExactEnumerableDataKeys(candidate, ['lookupOutcome'])
      ? Object.freeze({ lookupOutcome: 'not_found' as const })
      : undefined;
  }

  if (lookupOutcomeDescriptor.value === 'unavailable') {
    if (!hasExactEnumerableDataKeys(candidate, ['lookupOutcome', 'uncertainty'])) return undefined;
    const uncertainty = ownDataValue(candidate, 'uncertainty');
    if (uncertainty !== 'provider' && uncertainty !== 'network' && uncertainty !== 'parser') {
      return undefined;
    }
    return Object.freeze({ lookupOutcome: 'unavailable' as const, uncertainty });
  }

  return lookupOutcomeDescriptor.value === 'found' ? parseFoundEvidence(candidate) : undefined;
}

function parseResult(candidate: unknown): CbeBirrAuthoritativeAdapterResult | undefined {
  if (!isPlainRecord(candidate) || !hasExactEnumerableDataKeys(candidate, resultKeys)) {
    return undefined;
  }

  const evidence = parseEvidence(ownDataValue(candidate, 'evidence'));
  if (
    ownDataValue(candidate, 'contractVersion') !==
      CBE_BIRR_AUTHORITATIVE_ADAPTER_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'cbe_birr' ||
    !evidence
  ) {
    return undefined;
  }

  return Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_ADAPTER_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    evidence,
  });
}

/**
 * Reconstructs an exact allowlisted result or returns parser uncertainty. It never copies an
 * unrecognized field or caller-controlled string into its output.
 */
export function validatedCbeBirrAuthoritativeAdapterResult(
  candidate: unknown,
): CbeBirrAuthoritativeAdapterResult {
  try {
    return parseResult(candidate) ?? parserUnavailableResult;
  } catch {
    return parserUnavailableResult;
  }
}

/** Constant-key safe log projection. This function does not itself emit a log. */
export function redactedCbeBirrAuthoritativeAdapterResultForLog(
  candidate: unknown,
): CbeBirrAuthoritativeAdapterLogProjection {
  const result = validatedCbeBirrAuthoritativeAdapterResult(candidate);
  return Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_ADAPTER_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    safeFactsOnly: true as const,
    lookupOutcome: result.evidence.lookupOutcome,
    uncertainty:
      result.evidence.lookupOutcome === 'unavailable' ? result.evidence.uncertainty : null,
  });
}
