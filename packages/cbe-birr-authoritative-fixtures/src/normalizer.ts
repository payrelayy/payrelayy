import { isProxy } from 'node:util/types';

import type {
  CbeBirrAuthoritativeAdapterEvidence,
  CbeBirrAuthoritativeAdapterFoundEvidence,
} from '@fetanagent/contracts';

/**
 * Versioned, redacted fixture material only. This package has no provider transport, credentials,
 * persistence, execution wiring, or side effects.
 */
export const CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA =
  'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V1' as const;
export const CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA_VERSION = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_FIXTURE_NORMALIZER_VERSION = 1 as const;

const EXPECTED_SYNTHETIC_RECEIVER_KEY = 'fixture-receiver-primary';
const FIXTURE_ADAPTER_VERSION = 'fixture-adapter-v1';
const FIXTURE_NORMALIZATION_VERSION = 'fixture-normalizer-v1';
const FIXTURE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SYNTHETIC_REFERENCE_PATTERN = /^SYN-CBE-[A-Z0-9]{8,24}$/;
const SYNTHETIC_RECEIVER_PATTERN = /^fixture-receiver-[a-z0-9-]{1,40}$/;
const SYNTHETIC_DIGEST_PATTERN = /^fixture-sha256:[a-f0-9]{64}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const notFoundKeys = ['schema', 'fixtureId', 'providerCode', 'lookupOutcome'] as const;
const unavailableKeys = [
  'schema',
  'fixtureId',
  'providerCode',
  'lookupOutcome',
  'uncertainty',
] as const;
const foundKeys = [
  'schema',
  'fixtureId',
  'providerCode',
  'lookupOutcome',
  'evidenceSource',
  'providerIdentity',
  'transaction',
  'retrieval',
] as const;
const transactionKeys = [
  'status',
  'canonicalReference',
  'amountMinor',
  'currencyCode',
  'receiverKey',
  'paymentType',
  'occurredAt',
] as const;
const retrievalKeys = [
  'retrievedAt',
  'adapterVersion',
  'normalizationVersion',
  'evidenceDigest',
] as const;

type UnknownRecord = Record<string, unknown>;

export type CbeBirrAuthoritativeNormalizedFixtureFoundEvidence =
  CbeBirrAuthoritativeAdapterFoundEvidence;

/**
 * The duplicate-reference result is intentionally absent. A separate explicit in-memory test
 * boundary must add it before Stage 1A evaluation; a fixture adapter must never assume `clear`.
 */
export type CbeBirrAuthoritativeNormalizedFixtureEvidence = CbeBirrAuthoritativeAdapterEvidence;

export interface CbeBirrAuthoritativeFixtureNormalizationLogProjection {
  readonly fixtureSchemaVersion: 1;
  readonly normalizerVersion: 1;
  readonly providerCode: 'cbe_birr';
  readonly offlineOnly: true;
  readonly lookupOutcome: 'found' | 'not_found' | 'unavailable';
  readonly uncertainty: 'provider' | 'network' | 'parser' | null;
}

const parserUnavailable = Object.freeze({
  lookupOutcome: 'unavailable' as const,
  uncertainty: 'parser' as const,
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

function isFixtureEnvelope(value: UnknownRecord): boolean {
  return (
    ownDataValue(value, 'schema') === CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA &&
    typeof ownDataValue(value, 'fixtureId') === 'string' &&
    FIXTURE_ID_PATTERN.test(ownDataValue(value, 'fixtureId') as string) &&
    ownDataValue(value, 'providerCode') === 'cbe_birr'
  );
}

function parseUtcTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return undefined;

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function normalizeEvidenceSource(
  value: unknown,
): CbeBirrAuthoritativeNormalizedFixtureFoundEvidence['evidenceSource'] | undefined {
  if (value === 'PROVIDER_API') return 'provider_api';
  if (value === 'PROVIDER_RECEIPT_LOOKUP') return 'provider_receipt_lookup';
  if (value === 'PROVIDER_ACCOUNT_ACTIVITY') return 'provider_account_activity';
  return undefined;
}

function normalizeProviderIdentity(
  value: unknown,
): CbeBirrAuthoritativeNormalizedFixtureFoundEvidence['providerIdentity'] | undefined {
  if (value === 'MATCHED') return 'matched';
  if (value === 'MISMATCHED') return 'mismatched';
  if (value === 'UNKNOWN') return 'unknown';
  return undefined;
}

function normalizeStatus(
  value: unknown,
): CbeBirrAuthoritativeNormalizedFixtureFoundEvidence['providerFinalStatus'] | undefined {
  if (value === 'COMPLETED') return 'completed';
  if (value === 'PENDING') return 'pending';
  if (value === 'FAILED') return 'failed';
  if (value === 'UNKNOWN') return 'unknown';
  return undefined;
}

function normalizeCurrency(
  value: unknown,
): CbeBirrAuthoritativeNormalizedFixtureFoundEvidence['currencyCode'] | undefined {
  if (value === 'ETB') return 'ETB';
  if (value === 'OTHER') return 'other';
  if (value === 'UNKNOWN') return 'unknown';
  return undefined;
}

function normalizePaymentType(
  value: unknown,
): CbeBirrAuthoritativeNormalizedFixtureFoundEvidence['paymentType'] | undefined {
  if (value === 'SEND_MONEY') return 'send_money';
  if (value === 'OTHER') return 'other';
  if (value === 'UNKNOWN') return 'unknown';
  return undefined;
}

function parseFound(
  envelope: UnknownRecord,
): CbeBirrAuthoritativeNormalizedFixtureFoundEvidence | undefined {
  if (!hasExactEnumerableDataKeys(envelope, foundKeys) || !isFixtureEnvelope(envelope)) {
    return undefined;
  }

  const evidenceSource = normalizeEvidenceSource(ownDataValue(envelope, 'evidenceSource'));
  const providerIdentity = normalizeProviderIdentity(ownDataValue(envelope, 'providerIdentity'));
  const transaction = ownDataValue(envelope, 'transaction');
  const retrieval = ownDataValue(envelope, 'retrieval');
  if (
    ownDataValue(envelope, 'lookupOutcome') !== 'found' ||
    !evidenceSource ||
    !providerIdentity ||
    !isPlainNonProxyRecord(transaction) ||
    !hasExactEnumerableDataKeys(transaction, transactionKeys) ||
    !isPlainNonProxyRecord(retrieval) ||
    !hasExactEnumerableDataKeys(retrieval, retrievalKeys)
  ) {
    return undefined;
  }

  const status = normalizeStatus(ownDataValue(transaction, 'status'));
  const canonicalReference = ownDataValue(transaction, 'canonicalReference');
  const amountMinor = ownDataValue(transaction, 'amountMinor');
  const currencyCode = normalizeCurrency(ownDataValue(transaction, 'currencyCode'));
  const receiverKey = ownDataValue(transaction, 'receiverKey');
  const paymentType = normalizePaymentType(ownDataValue(transaction, 'paymentType'));
  const occurredAt = parseUtcTimestamp(ownDataValue(transaction, 'occurredAt'));
  const retrievedAt = parseUtcTimestamp(ownDataValue(retrieval, 'retrievedAt'));
  const adapterVersion = ownDataValue(retrieval, 'adapterVersion');
  const normalizationVersion = ownDataValue(retrieval, 'normalizationVersion');
  const evidenceDigest = ownDataValue(retrieval, 'evidenceDigest');

  if (
    !status ||
    (canonicalReference !== null &&
      (typeof canonicalReference !== 'string' ||
        !SYNTHETIC_REFERENCE_PATTERN.test(canonicalReference))) ||
    (amountMinor !== null &&
      (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0)) ||
    !currencyCode ||
    (receiverKey !== null &&
      (typeof receiverKey !== 'string' || !SYNTHETIC_RECEIVER_PATTERN.test(receiverKey))) ||
    !paymentType ||
    occurredAt === undefined ||
    retrievedAt === undefined ||
    (adapterVersion !== null && adapterVersion !== FIXTURE_ADAPTER_VERSION) ||
    (normalizationVersion !== null && normalizationVersion !== FIXTURE_NORMALIZATION_VERSION) ||
    (evidenceDigest !== null &&
      (typeof evidenceDigest !== 'string' || !SYNTHETIC_DIGEST_PATTERN.test(evidenceDigest)))
  ) {
    return undefined;
  }

  const provenance = Object.freeze({
    adapterVersionPresent: adapterVersion !== null,
    normalizationVersionPresent: normalizationVersion !== null,
    evidenceDigestPresent: evidenceDigest !== null,
  });

  return Object.freeze({
    lookupOutcome: 'found' as const,
    evidenceSource,
    providerIdentity,
    providerFinalStatus: status,
    canonicalReferencePresent: canonicalReference !== null,
    amountMinor: amountMinor as number | null,
    currencyCode,
    receiverMatch:
      receiverKey === null
        ? ('unknown' as const)
        : receiverKey === EXPECTED_SYNTHETIC_RECEIVER_KEY
          ? ('matched' as const)
          : ('mismatched' as const),
    paymentType,
    occurredAt,
    retrievedAt,
    provenance,
  });
}

/**
 * Strictly normalizes an unknown, redacted fixture response into Stage 1A safe facts. Any shape,
 * version, accessor, proxy, extra field, unsupported value, or size violation fails closed to
 * parser uncertainty. No raw reference or receiver value crosses this boundary.
 */
export function normalizeCbeBirrAuthoritativeFixtureResponse(
  candidate: unknown,
): CbeBirrAuthoritativeNormalizedFixtureEvidence {
  try {
    if (!isPlainNonProxyRecord(candidate)) return parserUnavailable;

    const lookupOutcomeDescriptor = Object.getOwnPropertyDescriptor(candidate, 'lookupOutcome');
    if (
      !lookupOutcomeDescriptor ||
      lookupOutcomeDescriptor.enumerable !== true ||
      !Object.hasOwn(lookupOutcomeDescriptor, 'value')
    ) {
      return parserUnavailable;
    }

    if (lookupOutcomeDescriptor.value === 'not_found') {
      if (!hasExactEnumerableDataKeys(candidate, notFoundKeys) || !isFixtureEnvelope(candidate)) {
        return parserUnavailable;
      }
      return Object.freeze({ lookupOutcome: 'not_found' as const });
    }

    if (lookupOutcomeDescriptor.value === 'unavailable') {
      if (
        !hasExactEnumerableDataKeys(candidate, unavailableKeys) ||
        !isFixtureEnvelope(candidate)
      ) {
        return parserUnavailable;
      }

      const uncertainty = ownDataValue(candidate, 'uncertainty');
      if (uncertainty !== 'provider' && uncertainty !== 'network' && uncertainty !== 'parser') {
        return parserUnavailable;
      }
      return Object.freeze({ lookupOutcome: 'unavailable' as const, uncertainty });
    }

    if (lookupOutcomeDescriptor.value === 'found') {
      return parseFound(candidate) ?? parserUnavailable;
    }

    return parserUnavailable;
  } catch {
    return parserUnavailable;
  }
}

/** A constant-key projection suitable for assertions; this function does not emit a log. */
export function redactedCbeBirrAuthoritativeFixtureNormalizationForLog(
  candidate: unknown,
): CbeBirrAuthoritativeFixtureNormalizationLogProjection {
  const evidence = normalizeCbeBirrAuthoritativeFixtureResponse(candidate);
  return Object.freeze({
    fixtureSchemaVersion: CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA_VERSION,
    normalizerVersion: CBE_BIRR_AUTHORITATIVE_FIXTURE_NORMALIZER_VERSION,
    providerCode: 'cbe_birr' as const,
    offlineOnly: true as const,
    lookupOutcome: evidence.lookupOutcome,
    uncertainty: evidence.lookupOutcome === 'unavailable' ? evidence.uncertainty : null,
  });
}
