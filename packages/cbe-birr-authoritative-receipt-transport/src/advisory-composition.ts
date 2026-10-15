import {
  CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
  CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE,
  parseCbeBirrAuthoritativePdf,
  redactedCbeBirrAuthoritativePdfParserResultForLog,
  type CbeBirrAuthoritativePdfParserResult,
} from '@fetanagent/cbe-birr-authoritative-pdf-parser';

import { cbeBirrNodeHttpsTransport } from './node-https-transport.js';
import {
  failedResult,
  fetchCbeBirrAuthoritativeReceiptInternallyWithTransport,
  type CbeBirrAuthoritativeReceiptFailedResult,
  type CbeBirrAuthoritativeReceiptOpaquePdfResult,
} from './runner.js';
import type { CbeBirrAuthoritativeReceiptInternalTransport } from './shared.js';

/**
 * Package-internal advisory seam. Neither this module nor its raw-byte fetch is exported from
 * the package entry point; no app imports it. In particular, "would_reject" is not a customer
 * rejection and "would_review" is not an accepted payment.
 */
export type CbeBirrOneFetchAdvisoryResult =
  | {
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly runtimeWiringAllowed: false;
      readonly financialActionAllowed: false;
      readonly disposition: 'transport_failed_closed';
      readonly transportResult: CbeBirrAuthoritativeReceiptFailedResult;
    }
  | {
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly runtimeWiringAllowed: false;
      readonly financialActionAllowed: false;
      readonly disposition: 'parser_failed_closed';
      readonly transportResult: CbeBirrAuthoritativeReceiptOpaquePdfResult;
    }
  | {
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly runtimeWiringAllowed: false;
      readonly financialActionAllowed: false;
      readonly disposition: 'parsed_advisory';
      readonly transportResult: CbeBirrAuthoritativeReceiptOpaquePdfResult;
      readonly parserResult: CbeBirrAuthoritativePdfParserResult;
    };

type AdvisoryPdfParser = typeof parseCbeBirrAuthoritativePdf;

const base = Object.freeze({
  providerCode: 'cbe_birr' as const,
  advisoryOnly: true as const,
  runtimeWiringAllowed: false as const,
  financialActionAllowed: false as const,
});

/** Internal test seam; the receiver expectation must eventually come from an immutable revision. */
export async function retrieveAndParseCbeBirrReceiptWithTransportAndParser(
  inputCandidate: unknown,
  controlCandidate: unknown,
  configuredReceiverAccountIdentifierCandidate: unknown,
  transport: CbeBirrAuthoritativeReceiptInternalTransport,
  parser: AdvisoryPdfParser,
): Promise<CbeBirrOneFetchAdvisoryResult> {
  // PH is only a lookup selector, never receiver proof. Validate the separate expected account
  // before even constructing a request; the PDF parser will compare it to Credit Account.
  if (
    typeof configuredReceiverAccountIdentifierCandidate !== 'string' ||
    !/^[0-9]{12}$/u.test(configuredReceiverAccountIdentifierCandidate)
  ) {
    return Object.freeze({
      ...base,
      disposition: 'transport_failed_closed' as const,
      transportResult: failedResult('invalid_request'),
    });
  }

  const fetched = await fetchCbeBirrAuthoritativeReceiptInternallyWithTransport(
    inputCandidate,
    controlCandidate,
    transport,
  );
  if (!fetched.ok) {
    return Object.freeze({
      ...base,
      disposition: 'transport_failed_closed' as const,
      transportResult: fetched.result,
    });
  }

  try {
    const parserResult = await parser(fetched.body, {
      contractVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
      providerCode: 'cbe_birr',
      sourceProfile: CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE,
      canonicalReference: fetched.input.requestedReference,
      configuredReceiverAccountIdentifier: configuredReceiverAccountIdentifierCandidate,
    });
    if (
      redactedCbeBirrAuthoritativePdfParserResultForLog(parserResult).disposition ===
      'invalid_result'
    ) {
      return Object.freeze({
        ...base,
        disposition: 'parser_failed_closed' as const,
        transportResult: fetched.result,
      });
    }
    return Object.freeze({
      ...base,
      disposition: 'parsed_advisory' as const,
      transportResult: fetched.result,
      parserResult,
    });
  } catch {
    return Object.freeze({
      ...base,
      disposition: 'parser_failed_closed' as const,
      transportResult: fetched.result,
    });
  }
}

/** Internal one-fetch composition. It is intentionally absent from src/index.ts. */
export function retrieveAndParseCbeBirrReceiptAdvisoryOnly(
  inputCandidate: unknown,
  controlCandidate: unknown,
  configuredReceiverAccountIdentifierCandidate: unknown,
): Promise<CbeBirrOneFetchAdvisoryResult> {
  return retrieveAndParseCbeBirrReceiptWithTransportAndParser(
    inputCandidate,
    controlCandidate,
    configuredReceiverAccountIdentifierCandidate,
    cbeBirrNodeHttpsTransport,
    parseCbeBirrAuthoritativePdf,
  );
}
