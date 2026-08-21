import { describe, expect, it } from 'vitest';

import { observeCbeBirrOpaquePdfEnvelope } from './pdf-observation.js';
import { syntheticPdfEnvelope } from './test-helpers.js';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('opaque synthetic PDF envelope observation', () => {
  it('returns a frozen one-way descriptor and never raw PDF bytes', () => {
    const body = syntheticPdfEnvelope();
    const result = observeCbeBirrOpaquePdfEnvelope(body);
    expect(result).toEqual({
      ok: true,
      observation: {
        envelopeVersion: 1,
        mediaType: 'application/pdf',
        byteLength: body.byteLength,
        sha256Digest: '90a31c86a9adeddd5d7a3ee1bce8f7ac95d46c66ab827218f7da93b4c71dda63',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.observation)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('%PDF-');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC TEST ENVELOPE');
  });

  it.each([
    ['empty', new Uint8Array()],
    ['too short', bytes('%PDF-1.7\n%%EOF\n')],
    ['HTML', bytes(`<!doctype html>${'x'.repeat(100)}`)],
    ['leading whitespace', bytes(` %PDF-1.7\n${'x'.repeat(100)}\n%%EOF\n`)],
    ['wrong magic case', bytes(`%Pdf-1.7\n${'x'.repeat(100)}\n%%EOF\n`)],
    ['missing EOF', bytes(`%PDF-1.7\n${'x'.repeat(100)}`)],
    ['EOF too far from end', bytes(`%PDF-1.7\n%%EOF\n${'x'.repeat(1_025)}`)],
    ['trailing non-whitespace', bytes(`%PDF-1.7\n${'x'.repeat(100)}\n%%EOF\nX`)],
    ['oversized', Uint8Array.from({ length: 1_048_577 }, (_, index) => index % 251)],
  ])('rejects a %s envelope', (_label, candidate) => {
    expect(observeCbeBirrOpaquePdfEnvelope(candidate)).toEqual({
      ok: false,
      reasonCode: 'pdf_envelope_rejected',
    });
  });

  it('permits only ASCII PDF trailing whitespace after the final EOF marker', () => {
    for (const suffix of ['', '\t', '\n', '\f', '\r', ' ', '\r\n']) {
      const candidate = bytes(`%PDF-2.0\n${'x'.repeat(100)}\n%%EOF${suffix}`);
      expect(observeCbeBirrOpaquePdfEnvelope(candidate)).toMatchObject({ ok: true });
    }
    expect(
      observeCbeBirrOpaquePdfEnvelope(bytes(`%PDF-2.0\n${'x'.repeat(100)}\n%%EOF\u0000`)),
    ).toEqual({ ok: false, reasonCode: 'pdf_envelope_rejected' });
  });
});
