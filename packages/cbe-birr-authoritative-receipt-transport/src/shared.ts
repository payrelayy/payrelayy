import { CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE } from '@fetanagent/cbe-birr-official-source-policy';
import { isProxy } from 'node:util/types';

export const CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_TIMEOUT_MS = 5_000 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES = 64 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES = 1_048_576 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_BYTES = 8_192 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_PAIRS = 32 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_ATTEMPTS = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE = 'application/pdf' as const;

export const CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
  policyVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION,
  method: CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE.method,
  scheme: CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE.scheme,
  host: CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE.host,
  port: CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE.port,
  path: CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE.path,
  queryParameterOrder: Object.freeze(['TID', 'PH'] as const),
  redirectPolicy: CBE_BIRR_OFFICIAL_RECEIPT_REQUEST_PROFILE.redirectPolicy,
  timeoutMs: CBE_BIRR_AUTHORITATIVE_RECEIPT_TIMEOUT_MS,
  minResponseBytes: CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES,
  maxResponseBytes: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES,
  maxHeaderBytes: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_BYTES,
  maxHeaderPairs: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_PAIRS,
  maxAttempts: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_ATTEMPTS,
  contentType: CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE,
  contentEncoding: 'identity' as const,
  requiredBodyMagic: '%PDF-' as const,
  tlsCertificateValidation: 'required' as const,
  minimumTlsVersion: 'TLSv1.2' as const,
  resolvedAddressPolicy: 'public_only' as const,
});

const SOURCE_PROFILE = 'cbe_birr_official_receipt_lookup_v1' as const;
const REFERENCE_PATTERN = /^[A-Z0-9]{8,32}$/u;
const LOOKUP_PHONE_PATTERN = /^251[0-9]{9}$/u;

const lookupInputKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'requestedReference',
  'receiverLookupPhone',
] as const;
const controlKeys = ['contractVersion', 'providerCode', 'providerRequest', 'incidentStop'] as const;

export type UnknownRecord = Record<string, unknown>;

export interface CbeBirrAuthoritativeReceiptLookupInput {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof SOURCE_PROFILE;
  readonly requestedReference: string;
  readonly receiverLookupPhone: string;
}

export interface CbeBirrAuthoritativeReceiptTransportControl {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly providerRequest: 'disabled' | 'allow_one';
  readonly incidentStop: 'open' | 'closed';
}

/**
 * Contains protected lookup material and must never be logged or persisted. It is intentionally
 * not exported from the package entry point.
 */
export interface SensitiveCbeBirrAuthoritativeReceiptRequestPlan {
  readonly method: 'GET';
  readonly scheme: 'https';
  readonly host: 'cbepay1.cbe.com.et';
  readonly port: 443;
  readonly pathAndQuery: string;
  readonly headers: Readonly<{
    accept: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE;
    'accept-encoding': 'identity';
    connection: 'close';
  }>;
  readonly redirectPolicy: 'reject_all';
  readonly timeoutMs: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TIMEOUT_MS;
  readonly maxResponseBytes: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES;
  readonly maxHeaderBytes: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_BYTES;
  readonly maxHeaderPairs: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_PAIRS;
  readonly maxAttempts: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_ATTEMPTS;
}

export type CbeBirrAuthoritativeReceiptTransportFailureReason =
  | 'dns_resolution_failed'
  | 'resolved_address_rejected'
  | 'transport_timeout'
  | 'tls_validation_failed'
  | 'network_request_failed'
  | 'redirect_rejected'
  | 'http_status_rejected'
  | 'response_headers_rejected'
  | 'content_type_rejected'
  | 'content_encoding_rejected'
  | 'response_too_large'
  | 'response_stream_failed';

export type CbeBirrAuthoritativeReceiptFailureReason =
  | 'invalid_request'
  | 'invalid_control'
  | 'provider_request_disabled'
  | 'incident_stop_open'
  | CbeBirrAuthoritativeReceiptTransportFailureReason
  | 'pdf_envelope_rejected';

export type CbeBirrAuthoritativeReceiptFailureClass =
  | 'request'
  | 'control'
  | 'incident_stop'
  | 'dns'
  | 'network'
  | 'tls'
  | 'timeout'
  | 'redirect'
  | 'http_status'
  | 'response_headers'
  | 'content_type'
  | 'content_encoding'
  | 'response_size'
  | 'response_shape';

export interface CbeBirrAuthoritativeReceiptOpaquePdfObservation {
  readonly envelopeVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION;
  readonly mediaType: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE;
  readonly byteLength: number;
  readonly sha256Digest: string;
}

export interface CbeBirrAuthoritativeReceiptInternalTransportSuccess {
  readonly ok: true;
  readonly body: Uint8Array;
}

export interface CbeBirrAuthoritativeReceiptInternalTransportFailure {
  readonly ok: false;
  readonly reasonCode: CbeBirrAuthoritativeReceiptTransportFailureReason;
}

export type CbeBirrAuthoritativeReceiptInternalTransportResult =
  | CbeBirrAuthoritativeReceiptInternalTransportSuccess
  | CbeBirrAuthoritativeReceiptInternalTransportFailure;

export type CbeBirrAuthoritativeReceiptInternalTransport = (
  plan: SensitiveCbeBirrAuthoritativeReceiptRequestPlan,
) => Promise<unknown>;

export function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactEnumerableDataKeys(
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

export function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

export function parseLookupInput(
  candidate: unknown,
): CbeBirrAuthoritativeReceiptLookupInput | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, lookupInputKeys)
  ) {
    return undefined;
  }

  const requestedReference = ownDataValue(candidate, 'requestedReference');
  const receiverLookupPhone = ownDataValue(candidate, 'receiverLookupPhone');
  if (
    ownDataValue(candidate, 'contractVersion') !==
      CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'cbe_birr' ||
    ownDataValue(candidate, 'sourceProfile') !== SOURCE_PROFILE ||
    typeof requestedReference !== 'string' ||
    !REFERENCE_PATTERN.test(requestedReference) ||
    typeof receiverLookupPhone !== 'string' ||
    !LOOKUP_PHONE_PATTERN.test(receiverLookupPhone)
  ) {
    return undefined;
  }

  return Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    sourceProfile: SOURCE_PROFILE,
    requestedReference,
    receiverLookupPhone,
  });
}

export function parseTransportControl(
  candidate: unknown,
): CbeBirrAuthoritativeReceiptTransportControl | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, controlKeys)) {
    return undefined;
  }
  const providerRequest = ownDataValue(candidate, 'providerRequest');
  const incidentStop = ownDataValue(candidate, 'incidentStop');
  if (
    ownDataValue(candidate, 'contractVersion') !==
      CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'cbe_birr' ||
    (providerRequest !== 'disabled' && providerRequest !== 'allow_one') ||
    (incidentStop !== 'open' && incidentStop !== 'closed')
  ) {
    return undefined;
  }

  return Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    providerRequest,
    incidentStop,
  });
}

export function compileSensitiveRequestPlan(
  input: CbeBirrAuthoritativeReceiptLookupInput,
): SensitiveCbeBirrAuthoritativeReceiptRequestPlan {
  return Object.freeze({
    method: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY.method,
    scheme: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY.scheme,
    host: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY.host,
    port: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY.port,
    pathAndQuery: `${CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY.path}?TID=${input.requestedReference}&PH=${input.receiverLookupPhone}`,
    headers: Object.freeze({
      accept: CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE,
      'accept-encoding': 'identity' as const,
      connection: 'close' as const,
    }),
    redirectPolicy: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY.redirectPolicy,
    timeoutMs: CBE_BIRR_AUTHORITATIVE_RECEIPT_TIMEOUT_MS,
    maxResponseBytes: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES,
    maxHeaderBytes: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_BYTES,
    maxHeaderPairs: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_HEADER_PAIRS,
    maxAttempts: CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_ATTEMPTS,
  });
}

export function parseInternalTransportResult(
  candidate: unknown,
): CbeBirrAuthoritativeReceiptInternalTransportResult | undefined {
  if (!isPlainNonProxyRecord(candidate)) return undefined;
  const ok = ownDataValue(candidate, 'ok');
  if (ok === true && hasExactEnumerableDataKeys(candidate, ['ok', 'body'])) {
    const body = ownDataValue(candidate, 'body');
    if (
      body instanceof Uint8Array &&
      !isProxy(body) &&
      body.byteLength <= CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES
    ) {
      return Object.freeze({ ok: true as const, body: Uint8Array.from(body) });
    }
    return undefined;
  }

  if (ok === false && hasExactEnumerableDataKeys(candidate, ['ok', 'reasonCode'])) {
    const reasonCode = ownDataValue(candidate, 'reasonCode');
    if (isTransportFailureReason(reasonCode)) {
      return Object.freeze({ ok: false as const, reasonCode });
    }
  }
  return undefined;
}

const transportFailureReasons = new Set<CbeBirrAuthoritativeReceiptTransportFailureReason>([
  'dns_resolution_failed',
  'resolved_address_rejected',
  'transport_timeout',
  'tls_validation_failed',
  'network_request_failed',
  'redirect_rejected',
  'http_status_rejected',
  'response_headers_rejected',
  'content_type_rejected',
  'content_encoding_rejected',
  'response_too_large',
  'response_stream_failed',
]);

export function isTransportFailureReason(
  candidate: unknown,
): candidate is CbeBirrAuthoritativeReceiptTransportFailureReason {
  return (
    typeof candidate === 'string' &&
    transportFailureReasons.has(candidate as CbeBirrAuthoritativeReceiptTransportFailureReason)
  );
}

export function failureClassForReason(
  reasonCode: CbeBirrAuthoritativeReceiptFailureReason,
): CbeBirrAuthoritativeReceiptFailureClass {
  switch (reasonCode) {
    case 'invalid_request':
    case 'provider_request_disabled':
      return 'request';
    case 'invalid_control':
      return 'control';
    case 'incident_stop_open':
      return 'incident_stop';
    case 'dns_resolution_failed':
    case 'resolved_address_rejected':
      return 'dns';
    case 'transport_timeout':
      return 'timeout';
    case 'tls_validation_failed':
      return 'tls';
    case 'network_request_failed':
    case 'response_stream_failed':
      return 'network';
    case 'redirect_rejected':
      return 'redirect';
    case 'http_status_rejected':
      return 'http_status';
    case 'response_headers_rejected':
      return 'response_headers';
    case 'content_type_rejected':
      return 'content_type';
    case 'content_encoding_rejected':
      return 'content_encoding';
    case 'response_too_large':
      return 'response_size';
    case 'pdf_envelope_rejected':
      return 'response_shape';
  }
}
