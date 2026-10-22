import { reduceTelegramAutoReceiverSmsProofInput } from './telegram-deposit-proof-input.js';
import type { TelegramProofMedia } from './telegram-deposit-media.js';

type MediaKind = TelegramProofMedia['kind'];

interface Dependencies {
  readonly local: (bytes: Buffer, kind: MediaKind) => Promise<string>;
  readonly vision: (bytes: Buffer, mimeType: 'image/jpeg' | 'image/png') => Promise<string | null>;
}

/** One DigitalOcean attempt only when local OCR cannot isolate a reference. */
export async function recognizeScreenshotReferenceWithFallback(
  bytes: Buffer,
  kind: MediaKind,
  dependencies: Dependencies,
): Promise<string> {
  let local = '';
  try {
    local = await dependencies.local(bytes, kind);
  } catch {
    if (kind === 'pdf') throw new Error('PDF extraction unavailable.');
  }
  if (kind === 'pdf') return local;
  const parsed = local
    ? reduceTelegramAutoReceiverSmsProofInput(local, 'ocr_text')
    : { kind: 'invalid_input' as const };
  if (parsed.kind !== 'invalid_input') return local;

  const mimeType = bytes
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ? 'image/png'
    : 'image/jpeg';
  try {
    return (await dependencies.vision(bytes, mimeType)) ?? local;
  } catch {
    return local;
  }
}
