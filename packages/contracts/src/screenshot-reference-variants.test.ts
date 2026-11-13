import { describe, expect, it } from 'vitest';

import { screenshotReferenceVariants } from './screenshot-reference-variants.js';

describe('Screenshot reference variants', () => {
  it('keeps the OCR reading first and changes only 0/O or 5/S', () => {
    expect(screenshotReferenceVariants('DK0S123456')).toEqual([
      'DK0S123456',
      'DKOS123456',
      'DK05123456',
      'DKO5123456',
      'DK0S1234S6',
      'DKOS1234S6',
      'DK051234S6',
      'DKO51234S6',
    ]);
  });

  it('does not expand invalid or overly ambiguous references', () => {
    expect(screenshotReferenceVariants('DK00000555')).toEqual(['DK00000555']);
    expect(screenshotReferenceVariants('DK0S')).toEqual(['DK0S']);
    expect(screenshotReferenceVariants('dk0s123456')).toEqual(['dk0s123456']);
    expect(screenshotReferenceVariants('ABCDEFGHIJ')).toEqual(['ABCDEFGHIJ']);
    expect(screenshotReferenceVariants('ABCDEF0SGH')).toEqual([
      'ABCDEF0SGH',
      'ABCDEF05GH',
      'ABCDEFO5GH',
    ]);
  });
});
