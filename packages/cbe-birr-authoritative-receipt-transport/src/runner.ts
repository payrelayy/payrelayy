import { cbeBirrNodeHttpsTransport } from './node-https-transport.js';
import { observeCbeBirrOpaquePdfEnvelope } from './pdf-observation.js';
import {
  CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION,
  type CbeBirrAuthoritativeReceiptFailureClass,
  type CbeBirrAuthoritativeReceiptFailureReason,
  type CbeBirrAuthoritativeReceiptInternalTransport,
  type CbeBirrAuthoritativeReceiptOpaquePdfObservation,
  compileSensitiveRequestPlan,
  failureClassForReason,
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  parseInternalTransportResult,
  parseLookupInput,
  parseTransportControl,
} from './shared.js';

const SOURCE_PROFILE = 'cbe_birr_official_receipt_lookup_v1' as const;

interface DisabledDownstreamCapabilities {
  readonly responseContractAttested: false;
  readonly receiptFieldParsingAllowed: false;
  readonly authoritativeAdapterAllowed: false;
  readonly evidenceClaimAllowed: false;
  readonly duplicateClaimAllowed: false;
  readonly databaseAccessAllowed: false;
  readonly persistenceAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly settlementAllowed: false;
  readonly financialActionAllowed: false;
}

interface CbeBirrAuthoritativeReceiptResultBase extends DisabledDownstreamCapabilities {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION;
  readonly transportPolicyVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION;
  readonly pdfEnvelopeVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof SOURCE_PROFILE;
  readonly advisoryOnly: true;
}

export interface CbeBirrAuthoritativeReceiptOpaquePdfResult extends CbeBirrAuthoritativeReceiptResultBase {
  readonly disposition: 'opaque_pdf_observation';
  readonly reasonCode: 'official_pdf_observed';
  readonly observation: CbeBirrAuthoritativeReceiptOpaquePdfObservation;
}

export interface CbeBirrAuthoritativeReceiptFailedResult extends CbeBirrAuthoritativeReceiptResultBase {
  readonly disposition: 'invalid_request' | 'invalid_control' | 'stopped' | 'failed_closed';
  readonly reasonCode: CbeBirrAuthoritativeReceiptFailureReason;
  readonly failureClass: CbeBirrAuthoritativeReceiptFailureClass;
}

export type CbeBirrAuthoritativeReceiptTransportResult =
  CbeBirrAuthoritativeReceiptOpaquePdfResult | CbeBirrAuthoritativeReceiptFailedResult;

export type RedactedCbeBirrAuthoritativeReceiptTransportLogProjection =
  | {
      readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION;
      readonly transportPolicyVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION;
      readonly pdfEnvelopeVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'opaque_pdf_observation';
      readonly reasonCode: 'official_pdf_observed';
      readonly failureClass: null;
    }
  | {
      readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION;
      readonly transportPolicyVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION;
      readonly pdfEnvelopeVersion: typeof CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition:
        CbeBirrAuthoritativeReceiptFailedResult['disposition'] | 'invalid_result';
      readonly reasonCode: CbeBirrAuthoritativeReceiptFailureReason | 'invalid_result';
      readonly failureClass: CbeBirrAuthoritativeReceiptFailureClass | 'invalid_result';
    };

const disabledDownstreamCapabilities: DisabledDownstreamCapabilities = Object.freeze({
  responseContractAttested: false,
  receiptFieldParsingAllowed: false,
  authoritativeAdapterAllowed: false,
  evidenceClaimAllowed: false,
  duplicateClaimAllowed: false,
  databaseAccessAllowed: false,
  persistenceAllowed: false,
  runtimeWiringAllowed: false,
  settlementAllowed: false,
  financialActionAllowed: false,
});

const resultBase: CbeBirrAuthoritativeReceiptResultBase = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
  transportPolicyVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION,
  pdfEnvelopeVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
  providerCode: 'cbe_birr' as const,
  sourceProfile: SOURCE_PROFILE,
  advisoryOnly: true as const,
  ...disabledDownstreamCapabilities,
});

const disabledCapabilityKeys = [
  'responseContractAttested',
  'receiptFieldParsingAllowed',
  'authoritativeAdapterAllowed',
  'evidenceClaimAllowed',
  'duplicateClaimAllowed',
  'databaseAccessAllowed',
  'persistenceAllowed',
  'runtimeWiringAllowed',
  'settlementAllowed',
  'financialActionAllowed',
] as const;
const resultBaseKeys = [
  'contractVersion',
  'transportPolicyVersion',
  'pdfEnvelopeVersion',
  'providerCode',
  'sourceProfile',
  'advisoryOnly',
  ...disabledCapabilityKeys,
] as const;
const failureResultKeys = [...resultBaseKeys, 'disposition', 'reasonCode', 'failureClass'] as const;
const observedResultKeys = [...resultBaseKeys, 'disposition', 'reasonCode', 'observation'] as const;
const observationKeys = ['envelopeVersion', 'mediaType', 'byteLength', 'sha256Digest'] as const;

function dispositionForFailure(
  reasonCode: CbeBirrAuthoritativeReceiptFailureReason,
): CbeBirrAuthoritativeReceiptFailedResult['disposition'] {
  if (reasonCode === 'invalid_request') return 'invalid_request';
  if (reasonCode === 'invalid_control') return 'invalid_control';
  if (reasonCode === 'provider_request_disabled' || reasonCode === 'incident_stop_open') {
    return 'stopped';
  }
  return 'failed_closed';
}

function failedResult(
  reasonCode: CbeBirrAuthoritativeReceiptFailureReason,
): CbeBirrAuthoritativeReceiptFailedResult {
  return Object.freeze({
    ...resultBase,
    disposition: dispositionForFailure(reasonCode),
    reasonCode,
    failureClass: failureClassForReason(reasonCode),
  });
}

/** Internal test seam; it is deliberately absent from the package entry point. */
export async function retrieveCbeBirrAuthoritativeReceiptWithTransport(
  inputCandidate: unknown,
  controlCandidate: unknown,
  transport: CbeBirrAuthoritativeReceiptInternalTransport,
): Promise<CbeBirrAuthoritativeReceiptTransportResult> {
  try {
    const input = parseLookupInput(inputCandidate);
    if (!input) return failedResult('invalid_request');
    const control = parseTransportControl(controlCandidate);
    if (!control) return failedResult('invalid_control');
    if (control.incidentStop === 'open') return failedResult('incident_stop_open');
    if (control.providerRequest === 'disabled') return failedResult('provider_request_disabled');

    let transportCandidate: unknown;
    try {
      transportCandidate = await transport(compileSensitiveRequestPlan(input));
    } catch {
      return failedResult('network_request_failed');
    }
    const transportResult = parseInternalTransportResult(transportCandidate);
    if (!transportResult) return failedResult('network_request_failed');
    if (!transportResult.ok) return failedResult(transportResult.reasonCode);

    const observed = observeCbeBirrOpaquePdfEnvelope(transportResult.body);
    if (!observed.ok) return failedResult(observed.reasonCode);
    return Object.freeze({
      ...resultBase,
      disposition: 'opaque_pdf_observation' as const,
      reasonCode: 'official_pdf_observed' as const,
      observation: observed.observation,
    });
  } catch {
    return failedResult('network_request_failed');
  }
}

/**
 * Performs at most one fixed official-host request. No application imports this package today;
 * callers must also supply an exact request control and an independently wired incident stop.
 */
export function retrieveCbeBirrAuthoritativeReceipt(
  inputCandidate: unknown,
  controlCandidate: unknown,
): Promise<CbeBirrAuthoritativeReceiptTransportResult> {
  return retrieveCbeBirrAuthoritativeReceiptWithTransport(
    inputCandidate,
    controlCandidate,
    cbeBirrNodeHttpsTransport,
  );
}

function hasExactResultBase(candidate: Record<string, unknown>): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION &&
    ownDataValue(candidate, 'transportPolicyVersion') ===
      CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION &&
    ownDataValue(candidate, 'pdfEnvelopeVersion') ===
      CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === SOURCE_PROFILE &&
    ownDataValue(candidate, 'advisoryOnly') === true &&
    disabledCapabilityKeys.every((key) => ownDataValue(candidate, key) === false)
  );
}

function validObservation(candidate: unknown): boolean {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, observationKeys)
  ) {
    return false;
  }
  const byteLength = ownDataValue(candidate, 'byteLength');
  const digest = ownDataValue(candidate, 'sha256Digest');
  return (
    ownDataValue(candidate, 'envelopeVersion') ===
      CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION &&
    ownDataValue(candidate, 'mediaType') === CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE &&
    typeof byteLength === 'number' &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES &&
    byteLength <= CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES &&
    typeof digest === 'string' &&
    /^[0-9a-f]{64}$/u.test(digest)
  );
}

const failureReasons = new Set<CbeBirrAuthoritativeReceiptFailureReason>([
  'invalid_request',
  'invalid_control',
  'provider_request_disabled',
  'incident_stop_open',
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
  'pdf_envelope_rejected',
]);

function validResult(candidate: unknown): candidate is CbeBirrAuthoritativeReceiptTransportResult {
  if (!isPlainNonProxyRecord(candidate) || !hasExactResultBase(candidate)) return false;
  const disposition = ownDataValue(candidate, 'disposition');
  const reasonCode = ownDataValue(candidate, 'reasonCode');
  if (disposition === 'opaque_pdf_observation' && reasonCode === 'official_pdf_observed') {
    return (
      hasExactEnumerableDataKeys(candidate, observedResultKeys) &&
      validObservation(ownDataValue(candidate, 'observation'))
    );
  }
  if (
    !hasExactEnumerableDataKeys(candidate, failureResultKeys) ||
    typeof reasonCode !== 'string' ||
    !failureReasons.has(reasonCode as CbeBirrAuthoritativeReceiptFailureReason)
  ) {
    return false;
  }
  const typedReason = reasonCode as CbeBirrAuthoritativeReceiptFailureReason;
  return (
    disposition === dispositionForFailure(typedReason) &&
    ownDataValue(candidate, 'failureClass') === failureClassForReason(typedReason)
  );
}

const invalidLogProjection: RedactedCbeBirrAuthoritativeReceiptTransportLogProjection =
  Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
    transportPolicyVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION,
    pdfEnvelopeVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_result' as const,
    reasonCode: 'invalid_result' as const,
    failureClass: 'invalid_result' as const,
  });

/** Revalidates and reduces an untrusted result to fixed, identifier-free log fields. */
export function redactedCbeBirrAuthoritativeReceiptTransportResultForLog(
  resultCandidate: unknown,
): RedactedCbeBirrAuthoritativeReceiptTransportLogProjection {
  try {
    if (!validResult(resultCandidate)) return invalidLogProjection;
    if (resultCandidate.disposition === 'opaque_pdf_observation') {
      return Object.freeze({
        contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
        transportPolicyVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION,
        pdfEnvelopeVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
        providerCode: 'cbe_birr' as const,
        advisoryOnly: true as const,
        disposition: resultCandidate.disposition,
        reasonCode: resultCandidate.reasonCode,
        failureClass: null,
      });
    }
    return Object.freeze({
      contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
      transportPolicyVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_POLICY_VERSION,
      pdfEnvelopeVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
      providerCode: 'cbe_birr' as const,
      advisoryOnly: true as const,
      disposition: resultCandidate.disposition,
      reasonCode: resultCandidate.reasonCode,
      failureClass: resultCandidate.failureClass,
    });
  } catch {
    return invalidLogProjection;
  }
}
