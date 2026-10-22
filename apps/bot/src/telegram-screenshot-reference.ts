import type { ScreenshotReferenceResult } from './digitalocean-screenshot-reference.js';
import { prepareScreenshotForDigitalOcean } from './screenshot-image-preparation.js';
import type { TelegramProofMedia } from './telegram-deposit-media.js';

type MediaKind = TelegramProofMedia['kind'];

interface Dependencies {
  readonly local: (bytes: Buffer, kind: MediaKind) => Promise<string>;
  readonly vision: (
    bytes: Buffer,
    mimeType: 'image/jpeg' | 'image/png',
  ) => Promise<ScreenshotReferenceResult>;
}

/** Read images with DigitalOcean first; keep local OCR for service outages and PDFs. */
export async function recognizeScreenshotReferenceWithFallback(
  bytes: Buffer,
  kind: MediaKind,
  dependencies: Dependencies,
): Promise<string> {
  if (kind === 'pdf') return dependencies.local(bytes, kind);
  const mimeType = bytes
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ? 'image/png'
    : 'image/jpeg';
  try {
    const prepared = await prepareScreenshotForDigitalOcean(bytes, mimeType);
    const result = await dependencies.vision(prepared.image, prepared.mimeType);
    if (result.kind === 'candidate') return result.reference;
    if (result.kind === 'unreadable') return '';
  } catch {
    // A network or provider failure may still leave local OCR usable.
  }
  return dependencies.local(bytes, kind);
}
