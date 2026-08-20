import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseCanonicalUtcTimestamp,
  utf8ByteLengthWithin,
  type UnknownRecord,
} from './exact-data-record.js';

export const TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA =
  'FETANAGENT_TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_V1' as const;
export const TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA_VERSION = 1 as const;
export const TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_NORMALIZER_VERSION = 1 as const;
export const TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE = 'telebirr_official_receipt_v1' as const;

const FIXTURE_ADAPTER_VERSION = 'fixture-telebirr-adapter-v1';
const FIXTURE_NORMALIZATION_VERSION = 'fixture-telebirr-normalizer-v1';
const SUPPORTED_PAYMENT_REASON = 'Send Money to Registered Customer';
const ADDIS_ABABA_OFFSET_MS = 3 * 60 * 60 * 1000;
const MAX_RECEIVER_NAME_BYTES = 256;

const FIXTURE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const SYNTHETIC_REFERENCE_PATTERN = /^SYNTB[A-Z0-9]{8,20}$/u;
const SYNTHETIC_REVISION_PATTERN = /^fixture-receiver-revision-[a-z0-9-]{1,40}$/u;
const SYNTHETIC_MASKED_NUMBER_PATTERN = /^SYN\*{4}\d{4}$/u;
const SYNTHETIC_DIGEST_PATTERN = /^fixture-sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_NAME_CHARACTER_PATTERN = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

const contextKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'requestedReference',
  'receiverRevision',
] as const;
const receiverRevisionKeys = ['revisionId', 'fullName', 'maskedNumber'] as const;
const notFoundKeys = [
  'schema',
  'fixtureId',
  'providerCode',
  'sourceProfile',
  'lookupOutcome',
] as const;
const unavailableKeys = [...notFoundKeys, 'uncertainty'] as const;
const foundKeys = [...notFoundKeys, 'issuerIdentity', 'transaction', 'retrieval'] as const;
const transactionKeys = [
  'status',
  'invoiceNumber',
  'creditedPartyName',
  'creditedPartyMaskedNumber',
  'paymentDate',
  'settledAmount',
  'stampDuty',
  'discountAmount',
  'serviceFee',
  'serviceFeeVat',
  'totalPaidAmount',
  'paymentMode',
  'paymentReason',
  'paymentChannel',
] as const;
const retrievalKeys = [
  'retrievedAt',
  'adapterVersion',
  'normalizationVersion',
  'evidenceDigest',
] as const;
const foundEvidenceKeys = [
  'lookupOutcome',
  'evidenceSource',
  'providerIdentity',
  'providerFinalStatus',
  'canonicalReferencePresent',
  'referenceMatch',
  'amountMinor',
  'currencyCode',
  'receiverMatch',
  'maskedReceiverDiagnostic',
  'paymentMode',
  'paymentReason',
  'paymentChannel',
  'occurredAt',
  'retrievedAt',
  'provenance',
] as const;
const provenanceKeys = [
  'adapterVersionPresent',
  'normalizationVersionPresent',
  'evidenceDigestPresent',
] as const;

export interface TelebirrOfficialReceiptFixtureContext {
  readonly contractVersion: 1;
  readonly providerCode: 'telebirr';
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly requestedReference: string;
  readonly receiverRevision: {
    readonly revisionId: string;
    readonly fullName: string;
    readonly maskedNumber: string | null;
  };
}

export interface TelebirrSafeFoundReceiptEvidence {
  readonly lookupOutcome: 'found';
  readonly evidenceSource: 'provider_receipt_lookup';
  readonly providerIdentity: 'matched' | 'mismatched' | 'unknown';
  readonly providerFinalStatus: 'completed' | 'pending' | 'failed' | 'reversed' | 'unknown';
  readonly canonicalReferencePresent: boolean;
  readonly referenceMatch: 'matched' | 'mismatched' | 'unknown';
  readonly amountMinor: number | null;
  readonly currencyCode: 'ETB' | 'unknown';
  readonly receiverMatch: 'matched' | 'mismatched' | 'unknown';
  readonly maskedReceiverDiagnostic: 'matched' | 'mismatched' | 'unknown';
  readonly paymentMode: 'telebirr' | 'other' | 'unknown';
  readonly paymentReason: 'send_money_to_registered_customer' | 'other' | 'unknown';
  readonly paymentChannel: 'api_app' | 'other' | 'unknown';
  readonly occurredAt: string | null;
  readonly retrievedAt: string | null;
  readonly provenance: {
    readonly adapterVersionPresent: boolean;
    readonly normalizationVersionPresent: boolean;
    readonly evidenceDigestPresent: boolean;
  };
}

export type TelebirrSafeReceiptEvidence =
  | TelebirrSafeFoundReceiptEvidence
  | { readonly lookupOutcome: 'not_found' }
  | {
      readonly lookupOutcome: 'unavailable';
      readonly uncertainty: 'provider' | 'network' | 'parser' | 'device';
    };

export interface RedactedSyntheticTelebirrOfficialReceiptLogProjection {
  readonly fixtureSchemaVersion: 1;
  readonly normalizerVersion: 1;
  readonly providerCode: 'telebirr';
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly offlineOnly: true;
  readonly lookupOutcome: 'found' | 'not_found' | 'unavailable';
  readonly uncertainty: 'provider' | 'network' | 'parser' | 'device' | null;
}

interface ParsedContext {
  readonly requestedReference: string;
  readonly normalizedReceiverName: string;
  readonly maskedNumber: string | null;
}

const parserUnavailable = Object.freeze({
  lookupOutcome: 'unavailable' as const,
  uncertainty: 'parser' as const,
});

function isFixtureEnvelope(value: UnknownRecord): boolean {
  return (
    ownDataValue(value, 'schema') === TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA &&
    typeof ownDataValue(value, 'fixtureId') === 'string' &&
    FIXTURE_ID_PATTERN.test(ownDataValue(value, 'fixtureId') as string) &&
    ownDataValue(value, 'providerCode') === 'telebirr' &&
    ownDataValue(value, 'sourceProfile') === TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE
  );
}

function normalizeSyntheticReceiverName(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !utf8ByteLengthWithin(value, MAX_RECEIVER_NAME_BYTES) ||
    FORBIDDEN_NAME_CHARACTER_PATTERN.test(value)
  ) {
    return undefined;
  }

  const normalized = value
    .normalize('NFC')
    .replace(/[\u2019\u02bc]/gu, "'")
    .replace(/[\u2010\u2011]/gu, '-')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim()
    .toLowerCase();

  if (
    normalized.length === 0 ||
    (!normalized.startsWith('synthetic ') && !normalized.startsWith('ሙከራ '))
  ) {
    return undefined;
  }

  return normalized;
}

function parseSyntheticMaskedNumber(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && SYNTHETIC_MASKED_NUMBER_PATTERN.test(value)
    ? value
    : undefined;
}

function parseContext(candidate: unknown): ParsedContext | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, contextKeys)) {
    return undefined;
  }

  const requestedReference = ownDataValue(candidate, 'requestedReference');
  const receiverRevision = ownDataValue(candidate, 'receiverRevision');
  if (
    ownDataValue(candidate, 'contractVersion') !== 1 ||
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
    typeof requestedReference !== 'string' ||
    !SYNTHETIC_REFERENCE_PATTERN.test(requestedReference) ||
    !isPlainNonProxyRecord(receiverRevision) ||
    !hasExactEnumerableDataKeys(receiverRevision, receiverRevisionKeys)
  ) {
    return undefined;
  }

  const revisionId = ownDataValue(receiverRevision, 'revisionId');
  const normalizedReceiverName = normalizeSyntheticReceiverName(
    ownDataValue(receiverRevision, 'fullName'),
  );
  const maskedNumber = parseSyntheticMaskedNumber(ownDataValue(receiverRevision, 'maskedNumber'));
  if (
    typeof revisionId !== 'string' ||
    !SYNTHETIC_REVISION_PATTERN.test(revisionId) ||
    !normalizedReceiverName ||
    maskedNumber === undefined
  ) {
    return undefined;
  }

  return Object.freeze({ requestedReference, normalizedReceiverName, maskedNumber });
}

function parseAddisAbabaTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;

  const match = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    year < 2020 ||
    year > 2099 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }

  const utcMilliseconds =
    Date.UTC(year, month - 1, day, hour, minute, second, 0) - ADDIS_ABABA_OFFSET_MS;
  const localRoundTrip = new Date(utcMilliseconds + ADDIS_ABABA_OFFSET_MS);
  if (
    localRoundTrip.getUTCFullYear() !== year ||
    localRoundTrip.getUTCMonth() !== month - 1 ||
    localRoundTrip.getUTCDate() !== day ||
    localRoundTrip.getUTCHours() !== hour ||
    localRoundTrip.getUTCMinutes() !== minute ||
    localRoundTrip.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  return new Date(utcMilliseconds).toISOString();
}

function parseBirrMinorUnits(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;

  const match = /^(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))? Birr$/u.exec(value);
  if (!match) return undefined;

  const majorText = match[1]!.replaceAll(',', '');
  if (majorText.length > 13) return undefined;

  const fractionText = (match[2] ?? '').padEnd(2, '0');
  const minorUnits = BigInt(majorText) * 100n + BigInt(fractionText || '0');
  return minorUnits <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minorUnits) : undefined;
}

function normalizeProviderIdentity(
  value: unknown,
): TelebirrSafeFoundReceiptEvidence['providerIdentity'] | undefined {
  if (value === 'SUPPORTED_OFFICIAL_TELEBIRR') return 'matched';
  if (value === 'OTHER') return 'mismatched';
  if (value === 'UNKNOWN') return 'unknown';
  return undefined;
}

function normalizeStatus(
  value: unknown,
): TelebirrSafeFoundReceiptEvidence['providerFinalStatus'] | undefined {
  if (value === 'COMPLETED') return 'completed';
  if (value === 'PENDING') return 'pending';
  if (value === 'FAILED') return 'failed';
  if (value === 'REVERSED') return 'reversed';
  if (value === 'UNKNOWN') return 'unknown';
  return undefined;
}

function normalizePaymentMode(
  value: unknown,
): TelebirrSafeFoundReceiptEvidence['paymentMode'] | undefined {
  if (value === 'telebirr') return 'telebirr';
  if (value === 'OTHER') return 'other';
  if (value === 'UNKNOWN' || value === null) return 'unknown';
  return undefined;
}

function normalizePaymentReason(
  value: unknown,
): TelebirrSafeFoundReceiptEvidence['paymentReason'] | undefined {
  if (value === SUPPORTED_PAYMENT_REASON) return 'send_money_to_registered_customer';
  if (value === 'OTHER') return 'other';
  if (value === 'UNKNOWN' || value === null) return 'unknown';
  return undefined;
}

function normalizePaymentChannel(
  value: unknown,
): TelebirrSafeFoundReceiptEvidence['paymentChannel'] | undefined {
  if (value === 'API/App') return 'api_app';
  if (value === 'OTHER') return 'other';
  if (value === 'UNKNOWN' || value === null) return 'unknown';
  return undefined;
}

function parseFound(
  envelope: UnknownRecord,
  context: ParsedContext,
): TelebirrSafeFoundReceiptEvidence | undefined {
  if (!hasExactEnumerableDataKeys(envelope, foundKeys) || !isFixtureEnvelope(envelope)) {
    return undefined;
  }

  const transaction = ownDataValue(envelope, 'transaction');
  const retrieval = ownDataValue(envelope, 'retrieval');
  const providerIdentity = normalizeProviderIdentity(ownDataValue(envelope, 'issuerIdentity'));
  if (
    ownDataValue(envelope, 'lookupOutcome') !== 'found' ||
    !providerIdentity ||
    !isPlainNonProxyRecord(transaction) ||
    !hasExactEnumerableDataKeys(transaction, transactionKeys) ||
    !isPlainNonProxyRecord(retrieval) ||
    !hasExactEnumerableDataKeys(retrieval, retrievalKeys)
  ) {
    return undefined;
  }

  const providerFinalStatus = normalizeStatus(ownDataValue(transaction, 'status'));
  const invoiceNumber = ownDataValue(transaction, 'invoiceNumber');
  const creditedPartyName = ownDataValue(transaction, 'creditedPartyName');
  const normalizedCreditedPartyName =
    creditedPartyName === null ? null : normalizeSyntheticReceiverName(creditedPartyName);
  const creditedPartyMaskedNumber = parseSyntheticMaskedNumber(
    ownDataValue(transaction, 'creditedPartyMaskedNumber'),
  );
  const occurredAt = parseAddisAbabaTimestamp(ownDataValue(transaction, 'paymentDate'));
  const settledAmount = parseBirrMinorUnits(ownDataValue(transaction, 'settledAmount'));
  const stampDuty = parseBirrMinorUnits(ownDataValue(transaction, 'stampDuty'));
  const discountAmount = parseBirrMinorUnits(ownDataValue(transaction, 'discountAmount'));
  const serviceFee = parseBirrMinorUnits(ownDataValue(transaction, 'serviceFee'));
  const serviceFeeVat = parseBirrMinorUnits(ownDataValue(transaction, 'serviceFeeVat'));
  const totalPaidAmount = parseBirrMinorUnits(ownDataValue(transaction, 'totalPaidAmount'));
  const paymentMode = normalizePaymentMode(ownDataValue(transaction, 'paymentMode'));
  const paymentReason = normalizePaymentReason(ownDataValue(transaction, 'paymentReason'));
  const paymentChannel = normalizePaymentChannel(ownDataValue(transaction, 'paymentChannel'));
  const retrievedAt = parseCanonicalUtcTimestamp(ownDataValue(retrieval, 'retrievedAt'));
  const adapterVersion = ownDataValue(retrieval, 'adapterVersion');
  const normalizationVersion = ownDataValue(retrieval, 'normalizationVersion');
  const evidenceDigest = ownDataValue(retrieval, 'evidenceDigest');

  if (
    !providerFinalStatus ||
    (invoiceNumber !== null &&
      (typeof invoiceNumber !== 'string' || !SYNTHETIC_REFERENCE_PATTERN.test(invoiceNumber))) ||
    (creditedPartyName !== null && !normalizedCreditedPartyName) ||
    creditedPartyMaskedNumber === undefined ||
    occurredAt === undefined ||
    settledAmount === undefined ||
    (settledAmount !== null && settledAmount <= 0) ||
    stampDuty === undefined ||
    discountAmount === undefined ||
    serviceFee === undefined ||
    serviceFeeVat === undefined ||
    totalPaidAmount === undefined ||
    !paymentMode ||
    !paymentReason ||
    !paymentChannel ||
    retrievedAt === undefined ||
    (adapterVersion !== null && adapterVersion !== FIXTURE_ADAPTER_VERSION) ||
    (normalizationVersion !== null && normalizationVersion !== FIXTURE_NORMALIZATION_VERSION) ||
    (evidenceDigest !== null &&
      (typeof evidenceDigest !== 'string' || !SYNTHETIC_DIGEST_PATTERN.test(evidenceDigest))) ||
    (occurredAt !== null && retrievedAt !== null && retrievedAt < occurredAt)
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
    evidenceSource: 'provider_receipt_lookup' as const,
    providerIdentity,
    providerFinalStatus,
    canonicalReferencePresent: invoiceNumber !== null,
    referenceMatch:
      invoiceNumber === null
        ? ('unknown' as const)
        : invoiceNumber === context.requestedReference
          ? ('matched' as const)
          : ('mismatched' as const),
    amountMinor: settledAmount,
    currencyCode: settledAmount === null ? ('unknown' as const) : ('ETB' as const),
    receiverMatch:
      normalizedCreditedPartyName === null
        ? ('unknown' as const)
        : normalizedCreditedPartyName === context.normalizedReceiverName
          ? ('matched' as const)
          : ('mismatched' as const),
    maskedReceiverDiagnostic:
      creditedPartyMaskedNumber === null || context.maskedNumber === null
        ? ('unknown' as const)
        : creditedPartyMaskedNumber === context.maskedNumber
          ? ('matched' as const)
          : ('mismatched' as const),
    paymentMode,
    paymentReason,
    paymentChannel,
    occurredAt,
    retrievedAt,
    provenance,
  });
}

/**
 * Strictly normalizes synthetic, redacted fixture material. It has no receipt transport, browser,
 * database, claim, settlement, or financial capability. Malformed input fails closed to parser
 * uncertainty, and raw reference or receiver values never cross the output boundary.
 */
export function normalizeSyntheticTelebirrOfficialReceipt(
  responseCandidate: unknown,
  contextCandidate: unknown,
): TelebirrSafeReceiptEvidence {
  try {
    const context = parseContext(contextCandidate);
    if (!context || !isPlainNonProxyRecord(responseCandidate)) return parserUnavailable;

    const lookupOutcomeDescriptor = Object.getOwnPropertyDescriptor(
      responseCandidate,
      'lookupOutcome',
    );
    if (
      !lookupOutcomeDescriptor ||
      lookupOutcomeDescriptor.enumerable !== true ||
      !Object.hasOwn(lookupOutcomeDescriptor, 'value')
    ) {
      return parserUnavailable;
    }

    if (lookupOutcomeDescriptor.value === 'not_found') {
      return hasExactEnumerableDataKeys(responseCandidate, notFoundKeys) &&
        isFixtureEnvelope(responseCandidate)
        ? Object.freeze({ lookupOutcome: 'not_found' as const })
        : parserUnavailable;
    }

    if (lookupOutcomeDescriptor.value === 'unavailable') {
      if (
        !hasExactEnumerableDataKeys(responseCandidate, unavailableKeys) ||
        !isFixtureEnvelope(responseCandidate)
      ) {
        return parserUnavailable;
      }

      const uncertainty = ownDataValue(responseCandidate, 'uncertainty');
      return uncertainty === 'provider' ||
        uncertainty === 'network' ||
        uncertainty === 'parser' ||
        uncertainty === 'device'
        ? Object.freeze({ lookupOutcome: 'unavailable' as const, uncertainty })
        : parserUnavailable;
    }

    return lookupOutcomeDescriptor.value === 'found'
      ? (parseFound(responseCandidate, context) ?? parserUnavailable)
      : parserUnavailable;
  } catch {
    return parserUnavailable;
  }
}

function parseProvenance(
  candidate: unknown,
): TelebirrSafeFoundReceiptEvidence['provenance'] | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, provenanceKeys)) {
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

function parseSafeFoundEvidence(
  candidate: UnknownRecord,
): TelebirrSafeFoundReceiptEvidence | undefined {
  if (!hasExactEnumerableDataKeys(candidate, foundEvidenceKeys)) return undefined;

  const providerIdentity = ownDataValue(candidate, 'providerIdentity');
  const providerFinalStatus = ownDataValue(candidate, 'providerFinalStatus');
  const canonicalReferencePresent = ownDataValue(candidate, 'canonicalReferencePresent');
  const referenceMatch = ownDataValue(candidate, 'referenceMatch');
  const amountMinor = ownDataValue(candidate, 'amountMinor');
  const currencyCode = ownDataValue(candidate, 'currencyCode');
  const receiverMatch = ownDataValue(candidate, 'receiverMatch');
  const maskedReceiverDiagnostic = ownDataValue(candidate, 'maskedReceiverDiagnostic');
  const paymentMode = ownDataValue(candidate, 'paymentMode');
  const paymentReason = ownDataValue(candidate, 'paymentReason');
  const paymentChannel = ownDataValue(candidate, 'paymentChannel');
  const occurredAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'occurredAt'));
  const retrievedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'retrievedAt'));
  const provenance = parseProvenance(ownDataValue(candidate, 'provenance'));

  if (
    ownDataValue(candidate, 'lookupOutcome') !== 'found' ||
    ownDataValue(candidate, 'evidenceSource') !== 'provider_receipt_lookup' ||
    (providerIdentity !== 'matched' &&
      providerIdentity !== 'mismatched' &&
      providerIdentity !== 'unknown') ||
    (providerFinalStatus !== 'completed' &&
      providerFinalStatus !== 'pending' &&
      providerFinalStatus !== 'failed' &&
      providerFinalStatus !== 'reversed' &&
      providerFinalStatus !== 'unknown') ||
    typeof canonicalReferencePresent !== 'boolean' ||
    (referenceMatch !== 'matched' &&
      referenceMatch !== 'mismatched' &&
      referenceMatch !== 'unknown') ||
    (canonicalReferencePresent ? referenceMatch === 'unknown' : referenceMatch !== 'unknown') ||
    (amountMinor !== null &&
      (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0)) ||
    (currencyCode !== 'ETB' && currencyCode !== 'unknown') ||
    (amountMinor === null ? currencyCode !== 'unknown' : currencyCode !== 'ETB') ||
    (receiverMatch !== 'matched' &&
      receiverMatch !== 'mismatched' &&
      receiverMatch !== 'unknown') ||
    (maskedReceiverDiagnostic !== 'matched' &&
      maskedReceiverDiagnostic !== 'mismatched' &&
      maskedReceiverDiagnostic !== 'unknown') ||
    (paymentMode !== 'telebirr' && paymentMode !== 'other' && paymentMode !== 'unknown') ||
    (paymentReason !== 'send_money_to_registered_customer' &&
      paymentReason !== 'other' &&
      paymentReason !== 'unknown') ||
    (paymentChannel !== 'api_app' && paymentChannel !== 'other' && paymentChannel !== 'unknown') ||
    occurredAt === undefined ||
    retrievedAt === undefined ||
    (occurredAt !== null && retrievedAt !== null && retrievedAt < occurredAt) ||
    !provenance
  ) {
    return undefined;
  }

  return Object.freeze({
    lookupOutcome: 'found' as const,
    evidenceSource: 'provider_receipt_lookup' as const,
    providerIdentity,
    providerFinalStatus,
    canonicalReferencePresent,
    referenceMatch,
    amountMinor: amountMinor as number | null,
    currencyCode,
    receiverMatch,
    maskedReceiverDiagnostic,
    paymentMode,
    paymentReason,
    paymentChannel,
    occurredAt,
    retrievedAt,
    provenance,
  });
}

/** Reconstructs an exact safe-fact envelope without reflecting any unrecognized field. */
export function validatedTelebirrSafeReceiptEvidence(
  candidate: unknown,
): TelebirrSafeReceiptEvidence | undefined {
  try {
    if (!isPlainNonProxyRecord(candidate)) return undefined;
    const outcomeDescriptor = Object.getOwnPropertyDescriptor(candidate, 'lookupOutcome');
    if (
      !outcomeDescriptor ||
      outcomeDescriptor.enumerable !== true ||
      !Object.hasOwn(outcomeDescriptor, 'value')
    ) {
      return undefined;
    }

    if (outcomeDescriptor.value === 'not_found') {
      return hasExactEnumerableDataKeys(candidate, ['lookupOutcome'])
        ? Object.freeze({ lookupOutcome: 'not_found' as const })
        : undefined;
    }

    if (outcomeDescriptor.value === 'unavailable') {
      if (!hasExactEnumerableDataKeys(candidate, ['lookupOutcome', 'uncertainty'])) {
        return undefined;
      }
      const uncertainty = ownDataValue(candidate, 'uncertainty');
      return uncertainty === 'provider' ||
        uncertainty === 'network' ||
        uncertainty === 'parser' ||
        uncertainty === 'device'
        ? Object.freeze({ lookupOutcome: 'unavailable' as const, uncertainty })
        : undefined;
    }

    return outcomeDescriptor.value === 'found' ? parseSafeFoundEvidence(candidate) : undefined;
  } catch {
    return undefined;
  }
}

/** A constant-key projection suitable for assertions; this function does not emit a log. */
export function redactedSyntheticTelebirrOfficialReceiptForLog(
  responseCandidate: unknown,
  contextCandidate: unknown,
): RedactedSyntheticTelebirrOfficialReceiptLogProjection {
  const evidence = normalizeSyntheticTelebirrOfficialReceipt(responseCandidate, contextCandidate);
  return Object.freeze({
    fixtureSchemaVersion: TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA_VERSION,
    normalizerVersion: TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_NORMALIZER_VERSION,
    providerCode: 'telebirr' as const,
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    offlineOnly: true as const,
    lookupOutcome: evidence.lookupOutcome,
    uncertainty: evidence.lookupOutcome === 'unavailable' ? evidence.uncertainty : null,
  });
}

const syntheticDigest = `fixture-sha256:${'0'.repeat(64)}`;

export const syntheticTelebirrOfficialReceiptFixtureContext: TelebirrOfficialReceiptFixtureContext =
  Object.freeze({
    contractVersion: 1 as const,
    providerCode: 'telebirr' as const,
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    requestedReference: 'SYNTB00000001',
    receiverRevision: Object.freeze({
      revisionId: 'fixture-receiver-revision-primary',
      fullName: 'SYNTHETIC RECEIVER PRIMARY',
      maskedNumber: 'SYN****0001',
    }),
  });

const completedFixture = Object.freeze({
  schema: TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA,
  fixtureId: 'completed',
  providerCode: 'telebirr',
  sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  lookupOutcome: 'found',
  issuerIdentity: 'SUPPORTED_OFFICIAL_TELEBIRR',
  transaction: Object.freeze({
    status: 'COMPLETED',
    invoiceNumber: 'SYNTB00000001',
    creditedPartyName: 'SYNTHETIC RECEIVER PRIMARY',
    creditedPartyMaskedNumber: 'SYN****0001',
    paymentDate: '20-08-2026 21:02:39',
    settledAmount: '150 Birr',
    stampDuty: '0.0 Birr',
    discountAmount: '0.0 Birr',
    serviceFee: '1.74 Birr',
    serviceFeeVat: '0.26 Birr',
    totalPaidAmount: '152 Birr',
    paymentMode: 'telebirr',
    paymentReason: SUPPORTED_PAYMENT_REASON,
    paymentChannel: 'API/App',
  }),
  retrieval: Object.freeze({
    retrievedAt: '2026-08-20T18:03:00.000Z',
    adapterVersion: FIXTURE_ADAPTER_VERSION,
    normalizationVersion: FIXTURE_NORMALIZATION_VERSION,
    evidenceDigest: syntheticDigest,
  }),
});

export const syntheticTelebirrOfficialReceiptFixtures = Object.freeze({
  completed: completedFixture,
  notFound: Object.freeze({
    schema: TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA,
    fixtureId: 'not-found',
    providerCode: 'telebirr',
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    lookupOutcome: 'not_found',
  }),
  providerUnavailable: Object.freeze({
    schema: TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA,
    fixtureId: 'provider-unavailable',
    providerCode: 'telebirr',
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    lookupOutcome: 'unavailable',
    uncertainty: 'provider',
  }),
  deviceUnavailable: Object.freeze({
    schema: TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA,
    fixtureId: 'device-unavailable',
    providerCode: 'telebirr',
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    lookupOutcome: 'unavailable',
    uncertainty: 'device',
  }),
});
