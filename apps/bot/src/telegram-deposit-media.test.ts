import { describe, expect, it, vi } from 'vitest';

import {
  TELEGRAM_PROOF_MEDIA_MAX_BYTES,
  extractTelegramProofMediaText,
  selectTelegramProofMedia,
} from './telegram-deposit-media.js';
import { TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT } from './telegram-guided-deposit.js';

// Only the header is needed: recognition is injected, so no image is decoded in unit tests.
const image = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0x64, 0x03, 0x01, 0x11, 0x00, 0x02,
  0x11, 0x00, 0x03, 0x11, 0x00,
]);
const pdf = Buffer.from('%PDF-1.7\nsynthetic test');

describe('Telegram receipt media intake', () => {
  it('explains unreadable input without implying a payment was checked', () => {
    expect(TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT).toContain(
      'Deposit not credited. Reason: invalid payment information. Contact support if this is unexpected.',
    );
    expect(TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT).toContain('No payment was submitted');
  });
  it('selects only a bounded photo or JPG/PNG/PDF document', () => {
    expect(
      selectTelegramProofMedia({
        photo: [
          { file_id: 'small', file_size: 100 },
          { file_id: 'largest', file_size: 200 },
        ],
      }),
    ).toEqual({
      kind: 'selected',
      media: { kind: 'photo', fileId: 'largest', fileSize: 200 },
    });
    expect(
      selectTelegramProofMedia({
        document: {
          file_id: 'pdf-id',
          file_size: 100,
          mime_type: 'application/pdf',
        },
      }),
    ).toEqual({ kind: 'selected', media: { kind: 'pdf', fileId: 'pdf-id', fileSize: 100 } });
    expect(
      selectTelegramProofMedia({
        document: {
          file_id: 'png-id',
          mime_type: 'image/png',
        },
      }),
    ).toEqual({
      kind: 'selected',
      media: { kind: 'image', fileId: 'png-id', fileSize: undefined },
    });
    expect(
      selectTelegramProofMedia({
        document: {
          file_id: 'pdf-generic',
          mime_type: 'application/octet-stream',
          file_name: 'receipt.PDF',
        },
      }),
    ).toEqual({
      kind: 'selected',
      media: { kind: 'pdf', fileId: 'pdf-generic', fileSize: undefined },
    });
    expect(
      selectTelegramProofMedia({
        document: {
          file_id: 'x',
          mime_type: 'application/zip',
        },
      }),
    ).toEqual({ kind: 'unsupported' });
    expect(
      selectTelegramProofMedia({
        document: {
          file_id: 'x',
          mime_type: 'application/pdf',
          file_size: TELEGRAM_PROOF_MEDIA_MAX_BYTES + 1,
        },
      }),
    ).toEqual({ kind: 'too_large' });
  });

  it('downloads only from the fixed Telegram file endpoint and forwards no file metadata', async () => {
    const fetch = vi.fn(async () => new Response(image));
    const recognize = vi.fn(async () => 'Transaction ID: SYNTB00000001');
    const result = await extractTelegramProofMediaText(
      { kind: 'photo', fileId: 'file-id', fileSize: image.length },
      {
        token: 'synthetic-token',
        getFile: async (id) => {
          expect(id).toBe('file-id');
          return { file_path: 'photos/file_1.jpg', file_size: image.length };
        },
        fetch,
        recognize,
      },
    );
    expect(result).toEqual({ kind: 'text', text: 'Transaction ID: SYNTB00000001' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/file/botsynthetic-token/photos/file_1.jpg',
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(recognize).toHaveBeenCalledWith(image, 'photo');
  });

  it('waits through a short screenshot burst instead of rejecting the third submission', async () => {
    const releases: Array<(text: string) => void> = [];
    const recognize = vi.fn(() => new Promise<string>((resolve) => releases.push(resolve)));
    const getFile = vi.fn(async () => ({ file_path: 'photos/file.jpg' }));
    const dependencies = {
      token: 'synthetic-token',
      getFile,
      fetch: async () => new Response(image),
      recognize,
    };
    const media = { kind: 'photo' as const, fileId: 'file-id', fileSize: image.length };
    const jobs = Array.from({ length: 3 }, () =>
      extractTelegramProofMediaText(media, dependencies),
    );

    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    expect(getFile).toHaveBeenCalledTimes(2);
    releases.shift()!('Transaction ID: SYNTB00000001');
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(3));
    releases.forEach((release) => release('Transaction ID: SYNTB00000001'));

    expect(await Promise.all(jobs)).toEqual(
      Array(3).fill({
        kind: 'text',
        text: 'Transaction ID: SYNTB00000001',
      }),
    );
  });

  it('normalizes OCR page breaks before the strict candidate parser sees them', async () => {
    const result = await extractTelegramProofMediaText(
      { kind: 'photo', fileId: 'file-id', fileSize: image.length },
      {
        token: 'synthetic-token',
        getFile: async () => ({ file_path: 'photos/file.jpg' }),
        fetch: async () => new Response(image),
        recognize: async () => 'Transaction ID: SYNTB00000001\f',
      },
    );
    expect(result).toEqual({ kind: 'text', text: 'Transaction ID: SYNTB00000001\n' });
  });

  it('accepts signed-looking PDF bytes as extraction input but never as payment proof', async () => {
    const recognize = vi.fn(async () => 'Transaction ID: SYNTB00000001');
    const result = await extractTelegramProofMediaText(
      { kind: 'pdf', fileId: 'pdf-id', fileSize: pdf.length },
      {
        token: 'synthetic-token',
        getFile: async () => ({ file_path: 'documents/file.pdf' }),
        fetch: async () => new Response(pdf),
        recognize,
      },
    );
    expect(result).toEqual({ kind: 'text', text: 'Transaction ID: SYNTB00000001' });
    expect(recognize).toHaveBeenCalledWith(pdf, 'pdf');
  });

  it('rejects an unexpected file path, claimed size, or content before OCR', async () => {
    const recognize = vi.fn(async () => 'Transaction ID: SYNTB00000001');
    const media = { kind: 'photo' as const, fileId: 'x', fileSize: undefined };
    const common = { token: 'synthetic-token', recognize };
    expect(
      await extractTelegramProofMediaText(media, {
        ...common,
        getFile: async () => ({ file_path: 'https://attacker.invalid/a' }),
        fetch: async () => new Response(image),
      }),
    ).toEqual({ kind: 'unavailable' });
    expect(
      await extractTelegramProofMediaText(media, {
        ...common,
        getFile: async () => ({ file_path: 'photos/../file.jpg' }),
        fetch: async () => new Response(image),
      }),
    ).toEqual({ kind: 'unavailable' });
    expect(
      await extractTelegramProofMediaText(media, {
        ...common,
        getFile: async () => ({
          file_path: 'photos/file.jpg',
          file_size: TELEGRAM_PROOF_MEDIA_MAX_BYTES + 1,
        }),
        fetch: async () => new Response(image),
      }),
    ).toEqual({ kind: 'too_large' });
    expect(
      await extractTelegramProofMediaText(media, {
        ...common,
        getFile: async () => ({ file_path: 'photos/file.jpg' }),
        fetch: async () => new Response('not an image'),
      }),
    ).toEqual({ kind: 'unreadable' });
    expect(recognize).not.toHaveBeenCalled();
  });

  it('rejects a decompression-bomb image header before OCR', async () => {
    const oversizedDimensions = Buffer.from(image);
    oversizedDimensions.writeUInt16BE(6000, 7);
    oversizedDimensions.writeUInt16BE(6000, 9);
    const recognize = vi.fn(async () => 'Transaction ID: SYNTB00000001');
    expect(
      await extractTelegramProofMediaText(
        { kind: 'photo', fileId: 'x', fileSize: oversizedDimensions.length },
        {
          token: 'synthetic-token',
          getFile: async () => ({ file_path: 'photos/file.jpg' }),
          fetch: async () => new Response(oversizedDimensions),
          recognize,
        },
      ),
    ).toEqual({ kind: 'unreadable' });
    expect(recognize).not.toHaveBeenCalled();
  });

  it('rejects bytes beyond the cap even without Telegram size metadata', async () => {
    const oversized = Buffer.alloc(TELEGRAM_PROOF_MEDIA_MAX_BYTES + 1, 0xff);
    const recognize = vi.fn(async () => 'Transaction ID: SYNTB00000001');
    expect(
      await extractTelegramProofMediaText(
        { kind: 'photo', fileId: 'x', fileSize: undefined },
        {
          token: 'synthetic-token',
          getFile: async () => ({ file_path: 'photos/file.jpg' }),
          fetch: async () => new Response(oversized),
          recognize,
        },
      ),
    ).toEqual({ kind: 'too_large' });
    expect(recognize).not.toHaveBeenCalled();
  });
});
