import { describe, expect, it, vi } from 'vitest';

import { recognizeScreenshotReferenceWithFallback } from './telegram-screenshot-reference.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff]);

describe('Screenshot reference fallback', () => {
  it('uses DigitalOcean first even when local OCR would return a wrong valid-length reference', async () => {
    const local = vi.fn(async () => 'Txn ID: CBEI2345678');
    const vision = vi.fn(async () => ({
      kind: 'candidate' as const,
      reference: 'CBE12345678',
      inputTokens: 100,
      outputTokens: 100,
    }));
    const result = await recognizeScreenshotReferenceWithFallback(jpeg, 'photo', { local, vision });
    expect(result).toBe('CBE12345678');
    expect(local).not.toHaveBeenCalled();
    expect(vision).toHaveBeenCalledWith(jpeg, 'image/jpeg');
  });

  it('withholds unreadable images instead of trusting a conflicting local guess', async () => {
    const local = vi.fn(async () => 'Txn ID: CBEI2345678');
    const result = await recognizeScreenshotReferenceWithFallback(jpeg, 'image', {
      local,
      vision: async () => ({ kind: 'unreadable', inputTokens: 100, outputTokens: 100 }),
    });
    expect(result).toBe('');
    expect(local).not.toHaveBeenCalled();
  });

  it('uses local OCR only when DigitalOcean is unavailable', async () => {
    const local = vi.fn(async () => 'Txn ID: CBE12345678');
    const result = await recognizeScreenshotReferenceWithFallback(jpeg, 'photo', {
      local,
      vision: async () => ({ kind: 'unavailable' }),
    });
    expect(result).toBe('Txn ID: CBE12345678');
    expect(local).toHaveBeenCalledOnce();
  });

  it('keeps PDF text local and never sends PDF bytes to the image model', async () => {
    const vision = vi.fn(async () => ({ kind: 'unavailable' as const }));
    const result = await recognizeScreenshotReferenceWithFallback(Buffer.from('%PDF'), 'pdf', {
      local: async () => 'CBE12345678',
      vision,
    });
    expect(result).toBe('CBE12345678');
    expect(vision).not.toHaveBeenCalled();
  });
});
