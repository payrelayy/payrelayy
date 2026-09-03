import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION,
  TELEBIRR_CANDIDATE_EXTRACTION_MAX_CANDIDATES,
  TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES,
  TELEBIRR_REFERENCE_NORMALIZATION_PROFILE,
  extractTelebirrReferenceCandidates,
  redactedTelebirrCandidateExtractionForLog,
  type TelebirrCandidateExtractionRequest,
  type TelebirrCandidateSourceKind,
} from './candidate-extraction.js';

function request(
  sourceKind: TelebirrCandidateSourceKind,
  text: string,
): TelebirrCandidateExtractionRequest {
  return { contractVersion: 1, sourceKind, text };
}

describe('TeleBirr candidate extraction', () => {
  it('pins the versioned, bounded profile', () => {
    expect(TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION).toBe(1);
    expect(TELEBIRR_REFERENCE_NORMALIZATION_PROFILE).toBe('telebirr-reference-candidate-v1');
    expect(TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES).toBe(16 * 1024);
    expect(TELEBIRR_CANDIDATE_EXTRACTION_MAX_CANDIDATES).toBe(8);
  });

  it('normalizes a complete raw transaction ID without assuming a particular prefix', () => {
    expect(extractTelebirrReferenceCandidates(request('transaction_id', '  abcxyz1234  '))).toEqual(
      {
        contractVersion: 1,
        providerCode: 'telebirr',
        normalizationProfile: 'telebirr-reference-candidate-v1',
        sourceKind: 'transaction_id',
        outcome: 'candidate_ready',
        normalizedReference: 'ABCXYZ1234',
      },
    );
  });

  it('extracts only the receipt path candidate and never treats a submitted host as authority', () => {
    const result = extractTelebirrReferenceCandidates(
      request(
        'receipt_url',
        'https://customer-controlled.invalid/receipt/SYNTB00000001?redirect=https://other.invalid',
      ),
    );

    expect(result).toMatchObject({
      sourceKind: 'receipt_url',
      outcome: 'candidate_ready',
      normalizedReference: 'SYNTB00000001',
    });
    expect(JSON.stringify(result)).not.toContain('customer-controlled.invalid');
    expect(JSON.stringify(result)).not.toContain('other.invalid');
  });

  it.each(['sms', 'ocr_text', 'pdf_text'] as const)(
    'extracts reviewed labelled and receipt-path contexts from %s input',
    (sourceKind) => {
      expect(
        extractTelebirrReferenceCandidates(
          request(sourceKind, 'Transaction number is syntb00000001.Thank /receipt/SYNTB00000001'),
        ),
      ).toMatchObject({
        sourceKind,
        outcome: 'candidate_ready',
        normalizedReference: 'SYNTB00000001',
      });
    },
  );

  it('requires explicit selection for distinct candidates and preserves first-seen order', () => {
    const result = extractTelebirrReferenceCandidates(
      request(
        'sms',
        'Transaction ID: SYNTB00000002. Invoice No. SYNTB00000001. Transaction number SYNTB00000002.',
      ),
    );

    expect(result).toEqual({
      contractVersion: 1,
      providerCode: 'telebirr',
      normalizationProfile: 'telebirr-reference-candidate-v1',
      sourceKind: 'sms',
      outcome: 'selection_required',
      normalizedReferences: ['SYNTB00000002', 'SYNTB00000001'],
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome === 'selection_required') {
      expect(Object.isFrozen(result.normalizedReferences)).toBe(true);
    }
  });

  it('scans both receipt paths and labels in pasted text instead of preferring a URL', () => {
    expect(
      extractTelebirrReferenceCandidates(
        request(
          'sms',
          'https://customer-controlled.invalid/receipt/SYNTB00000001?x=1 Transaction ID: SYNTB00000002.',
        ),
      ),
    ).toMatchObject({
      outcome: 'selection_required',
      normalizedReferences: ['SYNTB00000001', 'SYNTB00000002'],
    });
  });

  it.each([
    ['colon', 'Transaction ID:syntb00000001.Thank'],
    ['hash', 'Txn ID # SYNTB00000001, received.'],
    ['is', 'Transaction number is SYNTB00000001.Thank'],
    ['invoice', 'Invoice No. SYNTB00000001; received.'],
    ['invoice number', 'Invoice number: SYNTB00000001!'],
    ['multiline', 'Transaction ID:\r\nSYNTB00000001\nThank you.'],
    ['receipt query', 'https://untrusted.invalid/receipt/SYNTB00000001?redirect=elsewhere'],
    ['receipt fragment', 'https://untrusted.invalid/receipt/SYNTB00000001#details'],
  ] as const)('preserves the supported %s token boundary', (_label, text) => {
    expect(extractTelebirrReferenceCandidates(request('sms', text))).toMatchObject({
      outcome: 'candidate_ready',
      normalizedReference: 'SYNTB00000001',
    });
  });

  it.each([
    ['short labelled value', 'Transaction ID: ABC123'],
    ['overlong labelled value', `Transaction ID: ${'A'.repeat(33)}`],
    ['missing labelled value', 'Transaction ID:'],
    ['short receipt value', '/receipt/ABC123'],
    ['overlong receipt value', `/receipt/${'A'.repeat(33)}`],
    ['missing receipt value', '/receipt/'],
    ['label without delimiter', 'Transaction IDsSYNTB00000002'],
    ['label word continuation', 'Transaction identifier SYNTB00000002'],
    ['is without delimiter', 'Transaction numberis SYNTB00000002'],
  ] as const)(
    'rejects a %s context rather than ignoring it beside a valid reference',
    (_label, malformedContext) => {
      for (const text of [
        malformedContext,
        `Transaction ID: SYNTB00000001. ${malformedContext}`,
        `${malformedContext}\n/receipt/SYNTB00000001`,
      ]) {
        expect(extractTelebirrReferenceCandidates(request('sms', text))).toMatchObject({
          outcome: 'invalid_input',
        });
      }
    },
  );

  it.each([
    ['Unicode letter', 'SYNTB00000001é'],
    ['combining mark', 'SYNTB00000001\u0301'],
    ['zero-width suffix', 'SYNTB00000001\u200b'],
    ['bidi suffix', 'SYNTB00000001\u202e'],
    ['underscore', 'SYNTB00000001_2'],
    ['hyphen', 'SYNTB00000001-ABCD'],
    ['percent escape', 'SYNTB00000001%41'],
    ['Unicode long s', 'SYNTB00000ſ1'],
    ['Unicode sharp s', 'SYNTB00000ß1'],
    ['Unicode Kelvin sign', 'SYNTB00000K1'],
  ] as const)('does not truncate or ASCII-normalize a %s token', (_label, token) => {
    expect(extractTelebirrReferenceCandidates(request('transaction_id', token))).toMatchObject({
      outcome: 'invalid_input',
    });
    for (const context of [`Transaction ID: ${token}`, `/receipt/${token}`]) {
      expect(extractTelebirrReferenceCandidates(request('sms', context))).toMatchObject({
        outcome: 'invalid_input',
      });
      expect(
        extractTelebirrReferenceCandidates(
          request('sms', `Transaction ID: SYNTB00000002. ${context}`),
        ),
      ).toMatchObject({ outcome: 'invalid_input' });
    }
  });

  it('does not recognize a label embedded inside a Unicode word', () => {
    for (const text of [
      'éTransaction ID: SYNTB00000001',
      '\u0301Transaction ID: SYNTB00000001',
      '\u200bTransaction ID: SYNTB00000001',
    ]) {
      expect(extractTelebirrReferenceCandidates(request('sms', text))).toMatchObject({
        outcome: 'no_candidates',
      });
    }
  });

  it('does not extract unlabelled phone numbers, dates, or amounts', () => {
    expect(
      extractTelebirrReferenceCandidates(
        request('sms', 'Synthetic receiver 000000000000, 01/01/2099 00:00:00, ETB 999.99.'),
      ),
    ).toMatchObject({ outcome: 'no_candidates' });
  });

  it('does not treat a labelled phrase as a URL candidate', () => {
    expect(
      extractTelebirrReferenceCandidates(
        request('receipt_url', 'Transaction number is SYNTB00000001'),
      ),
    ).toMatchObject({ outcome: 'no_candidates' });
  });

  it.each([
    ['short raw ID', request('transaction_id', 'ABC123')],
    ['overlong raw ID', request('transaction_id', 'A'.repeat(33))],
    ['Unicode homoglyph', request('transaction_id', 'SYNТB00000001')],
    ['forbidden control', request('sms', 'Transaction ID: SYNTB00000001\u0000')],
    [
      'oversized text',
      request('sms', 'A'.repeat(TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES + 1)),
    ],
  ] as const)('fails %s closed', (_label, candidate) => {
    expect(extractTelebirrReferenceCandidates(candidate)).toMatchObject({
      sourceKind: null,
      outcome: 'invalid_input',
      reasonCode: 'invalid_input',
    });
  });

  it('fails closed instead of truncating more than the reviewed candidate bound', () => {
    const text = Array.from(
      { length: TELEBIRR_CANDIDATE_EXTRACTION_MAX_CANDIDATES + 1 },
      (_, index) => `Transaction ID: SYNTB${String(index + 1).padStart(8, '0')}.`,
    ).join(' ');

    expect(extractTelebirrReferenceCandidates(request('sms', text))).toMatchObject({
      outcome: 'invalid_input',
    });
  });

  it('does not invoke accessors and rejects proxies, symbols, or extra keys', () => {
    const getter = vi.fn(() => 'SYNTB00000001');
    const accessorCandidate = Object.defineProperties(
      {},
      {
        contractVersion: { value: 1, enumerable: true },
        sourceKind: { value: 'transaction_id', enumerable: true },
        text: { get: getter, enumerable: true },
      },
    );
    const proxyCandidate = new Proxy(request('transaction_id', 'SYNTB00000001') as object, {});
    const symbolCandidate = Object.assign(request('transaction_id', 'SYNTB00000001'), {
      [Symbol('hidden')]: 'SYNTB00000002',
    });
    const extraCandidate = { ...request('transaction_id', 'SYNTB00000001'), amount: 150 };

    for (const candidate of [accessorCandidate, proxyCandidate, symbolCandidate, extraCandidate]) {
      expect(extractTelebirrReferenceCandidates(candidate)).toMatchObject({
        outcome: 'invalid_input',
      });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('projects only constant metadata and a count, never a candidate or hostile value', () => {
    const result = extractTelebirrReferenceCandidates(
      request('sms', 'Transaction ID: SYNTB00000001. Transaction ID: SYNTB00000002.'),
    );
    const projection = redactedTelebirrCandidateExtractionForLog(result);

    expect(projection).toEqual({
      contractVersion: 1,
      providerCode: 'telebirr',
      normalizationProfile: 'telebirr-reference-candidate-v1',
      sourceKind: 'sms',
      outcome: 'selection_required',
      candidateCount: 2,
    });
    expect(JSON.stringify(projection)).not.toContain('SYNTB');

    const getter = vi.fn(() => 'SYNTB00000001');
    const hostile = Object.defineProperty({}, 'outcome', { enumerable: true, get: getter });
    expect(redactedTelebirrCandidateExtractionForLog(hostile)).toMatchObject({
      outcome: 'invalid_result',
      candidateCount: 0,
    });
    expect(getter).not.toHaveBeenCalled();
  });
});
