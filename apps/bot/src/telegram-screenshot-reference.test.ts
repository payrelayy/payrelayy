import { describe, expect, it, vi } from 'vitest';

import { recognizeScreenshotReferenceWithFallback } from './telegram-screenshot-reference.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff]);

describe('Screenshot reference fallback', () => {
  it('uses the DigitalOcean reader only when local OCR cannot isolate one reference', async () => {
    const vision = vi.fn(async () => 'CBE12345678');
    const result = await recognizeScreenshotReferenceWithFallback(jpeg, 'photo', {
      local: async () => 'Receipt\nTxn lD: CBEI234S678',
      vision,
    });
    expect(result).toBe('CBE12345678');
    expect(vision).toHaveBeenCalledTimes(1);
    expect(vision).toHaveBeenCalledWith(jpeg, 'image/jpeg');
  });

  it('does not replace one local reference or an ambiguous result', async () => {
    const vision = vi.fn(async () => 'CBE12345678');
    expect(
      await recognizeScreenshotReferenceWithFallback(jpeg, 'photo', {
        local: async () => 'Txn ID: CBE12345678',
        vision,
      }),
    ).toBe('Txn ID: CBE12345678');
    expect(
      await recognizeScreenshotReferenceWithFallback(jpeg, 'photo', {
        local: async () => 'Txn ID: CBE12345678\nTxn ID: CBE87654321',
        vision,
      }),
    ).toContain('CBE87654321');
    expect(vision).not.toHaveBeenCalled();
  });

  it('keeps PDF text local and never sends PDF bytes to the image model', async () => {
    const vision = vi.fn(async () => 'CBE12345678');
    const result = await recognizeScreenshotReferenceWithFallback(Buffer.from('%PDF'), 'pdf', {
      local: async () => 'CBE12345678',
      vision,
    });
    expect(result).toBe('CBE12345678');
    expect(vision).not.toHaveBeenCalled();
  });
});
