import { describe, expect, it } from 'vitest';

import {
  CBE_BIRR_NORMALIZATION_CANDIDATE_VERSION,
  isCanonicalCbeBirrReferenceCandidate,
  isCbeBirrReceiverLookupSelectorCandidate,
  normalizeCbeBirrSubmittedReferenceCandidate,
} from './index.js';

describe('offline CBE Birr normalization candidate', () => {
  it('case-folds only exact ASCII submitted references', () => {
    expect(CBE_BIRR_NORMALIZATION_CANDIDATE_VERSION).toBe(1);
    expect(normalizeCbeBirrSubmittedReferenceCandidate('synthetic123')).toBe('SYNTHETIC123');
    expect(normalizeCbeBirrSubmittedReferenceCandidate('SYNTHETIC123')).toBe('SYNTHETIC123');
    expect(normalizeCbeBirrSubmittedReferenceCandidate('a'.repeat(8))).toBe('A'.repeat(8));
    expect(normalizeCbeBirrSubmittedReferenceCandidate('z'.repeat(32))).toBe('Z'.repeat(32));
  });

  it('does not reinterpret legacy, malformed, or Unicode references', () => {
    for (const candidate of [
      '',
      'a'.repeat(7),
      'a'.repeat(33),
      ' SYNTHETIC123',
      'SYNTHETIC123 ',
      'SYNTH-123',
      'SYNTH_123',
      'SYNTH.123',
      'SYNTHETIC\n123',
      'SYNTHETİC123',
      'ＳＹＮＴＨ１２３',
      null,
      12345678,
      { toString: () => 'SYNTHETIC123' },
    ]) {
      expect(normalizeCbeBirrSubmittedReferenceCandidate(candidate)).toBeNull();
    }
  });

  it('requires independent observed references to already be canonical', () => {
    expect(isCanonicalCbeBirrReferenceCandidate('SYNTHETIC123')).toBe(true);
    expect(isCanonicalCbeBirrReferenceCandidate('synthetic123')).toBe(false);
    expect(isCanonicalCbeBirrReferenceCandidate('SYNTH-123')).toBe(false);
    expect(isCanonicalCbeBirrReferenceCandidate('A'.repeat(7))).toBe(false);
    expect(isCanonicalCbeBirrReferenceCandidate('A'.repeat(33))).toBe(false);
  });

  it('requires an exact full receiver lookup selector without prefix inference', () => {
    expect(isCbeBirrReceiverLookupSelectorCandidate('251900000001')).toBe(true);
    for (const candidate of [
      '900000001',
      '0251900000001',
      '+251900000001',
      '251900000001 ',
      '25190000000',
      '2519000000010',
      '251９00000001',
      null,
      251900000001,
    ]) {
      expect(isCbeBirrReceiverLookupSelectorCandidate(candidate)).toBe(false);
    }
  });
});
