import { createHash } from 'node:crypto';

import {
  CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES,
  CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
  type CbeBirrAuthoritativeReceiptOpaquePdfObservation,
} from './shared.js';

export type CbeBirrOpaquePdfObservationResult =
  | {
      readonly ok: true;
      readonly observation: CbeBirrAuthoritativeReceiptOpaquePdfObservation;
    }
  | {
      readonly ok: false;
      readonly reasonCode: 'pdf_envelope_rejected';
    };

const PDF_MAGIC = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PDF_EOF = Uint8Array.from([0x25, 0x25, 0x45, 0x4f, 0x46]);

function hasPrefix(body: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((value, index) => body[index] === value);
}

function hasTerminalPdfEof(body: Uint8Array): boolean {
  const searchStart = Math.max(0, body.byteLength - 1_024);
  for (let offset = body.byteLength - PDF_EOF.byteLength; offset >= searchStart; offset -= 1) {
    if (!PDF_EOF.every((value, index) => body[offset + index] === value)) continue;
    for (let index = offset + PDF_EOF.byteLength; index < body.byteLength; index += 1) {
      const value = body[index];
      if (value !== 0x09 && value !== 0x0a && value !== 0x0c && value !== 0x0d && value !== 0x20) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Checks only a bounded PDF envelope and returns a one-way opaque descriptor. It does not parse,
 * extract, normalize, or attest any receipt field.
 */
export function observeCbeBirrOpaquePdfEnvelope(
  body: Uint8Array,
): CbeBirrOpaquePdfObservationResult {
  try {
    if (
      body.byteLength < CBE_BIRR_AUTHORITATIVE_RECEIPT_MIN_RESPONSE_BYTES ||
      body.byteLength > CBE_BIRR_AUTHORITATIVE_RECEIPT_MAX_RESPONSE_BYTES ||
      !hasPrefix(body, PDF_MAGIC) ||
      !hasTerminalPdfEof(body)
    ) {
      return Object.freeze({ ok: false as const, reasonCode: 'pdf_envelope_rejected' as const });
    }

    const observation: CbeBirrAuthoritativeReceiptOpaquePdfObservation = Object.freeze({
      envelopeVersion: CBE_BIRR_AUTHORITATIVE_RECEIPT_PDF_ENVELOPE_VERSION,
      mediaType: CBE_BIRR_AUTHORITATIVE_RECEIPT_CONTENT_TYPE,
      byteLength: body.byteLength,
      sha256Digest: createHash('sha256').update(body).digest('hex'),
    });
    return Object.freeze({ ok: true as const, observation });
  } catch {
    return Object.freeze({ ok: false as const, reasonCode: 'pdf_envelope_rejected' as const });
  }
}
