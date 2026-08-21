import {
  CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
  type CbeBirrAuthoritativeReceiptLookupInput,
  type CbeBirrAuthoritativeReceiptTransportControl,
} from './shared.js';

export const SYNTHETIC_REFERENCE = 'SYNTHCBE00001' as const;
export const SYNTHETIC_PHONE = '251000000000' as const;

export const syntheticLookupInput: CbeBirrAuthoritativeReceiptLookupInput = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  sourceProfile: 'cbe_birr_official_receipt_lookup_v1' as const,
  requestedReference: SYNTHETIC_REFERENCE,
  receiverLookupPhone: SYNTHETIC_PHONE,
});

export const allowedTransportControl: CbeBirrAuthoritativeReceiptTransportControl = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_TRANSPORT_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  providerRequest: 'allow_one' as const,
  incidentStop: 'closed' as const,
});

/** A structural test envelope only; it is not a real or provider-derived receipt. */
export function syntheticPdfEnvelope(): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7
% SYNTHETIC TEST ENVELOPE - NOT A RECEIPT
1 0 obj
<< /Type /Catalog >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`);
}
