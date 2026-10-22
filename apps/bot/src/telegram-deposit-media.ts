import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES } from '@fetanagent/telebirr-verification-foundation/candidate-extraction';

import { reduceTelegramDepositProofInput } from './telegram-deposit-proof-input.js';

const runFile = promisify(execFile);

// Telegram permits much larger documents, but there is no reason to download or render them for
// a single receipt reference. These limits also keep OCR from stalling the polling process.
export const TELEGRAM_PROOF_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 3;
const MAX_ACTIVE_MEDIA_JOBS = 2;
const MAX_WAITING_MEDIA_JOBS = 24;
const MAX_MEDIA_WAIT_MS = 30_000;
const MAX_IMAGE_PIXELS = 8_000_000;
const MAX_FILE_PATH_LENGTH = 256;
const TELEGRAM_FILE_PATH = /^[A-Za-z0-9_./-]+$/u;

export type TelegramProofMedia =
  | { readonly kind: 'photo'; readonly fileId: string; readonly fileSize: number | undefined }
  | { readonly kind: 'image'; readonly fileId: string; readonly fileSize: number | undefined }
  | { readonly kind: 'pdf'; readonly fileId: string; readonly fileSize: number | undefined };

export type TelegramProofMediaSelection =
  | { readonly kind: 'selected'; readonly media: TelegramProofMedia }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'too_large' };

interface TelegramFileLike {
  readonly file_id?: unknown;
  readonly file_size?: unknown;
  readonly mime_type?: unknown;
  readonly file_name?: unknown;
}

interface TelegramMediaMessageLike {
  readonly photo?: unknown;
  readonly document?: unknown;
}

function boundedSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Never request an unsupported attachment from Telegram or turn its caption into payment proof. */
export function selectTelegramProofMedia(
  message: TelegramMediaMessageLike,
): TelegramProofMediaSelection {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo.at(-1) as TelegramFileLike;
    if (typeof largest?.file_id !== 'string' || largest.file_id.length === 0) {
      return { kind: 'unsupported' };
    }
    const fileSize = boundedSize(largest.file_size);
    if (fileSize !== undefined && fileSize > TELEGRAM_PROOF_MEDIA_MAX_BYTES) {
      return { kind: 'too_large' };
    }
    return { kind: 'selected', media: { kind: 'photo', fileId: largest.file_id, fileSize } };
  }

  const document = message.document as TelegramFileLike | undefined;
  if (!document) return { kind: 'unsupported' };
  if (typeof document.file_id !== 'string' || document.file_id.length === 0) {
    return { kind: 'unsupported' };
  }
  const filename = typeof document.file_name === 'string' ? document.file_name.toLowerCase() : '';
  const genericMime =
    document.mime_type === undefined || document.mime_type === 'application/octet-stream';
  const kind =
    document.mime_type === 'application/pdf' || (genericMime && filename.endsWith('.pdf'))
      ? 'pdf'
      : document.mime_type === 'image/png' ||
          document.mime_type === 'image/jpeg' ||
          (genericMime && /\.(?:png|jpe?g)$/u.test(filename))
        ? 'image'
        : undefined;
  if (!kind) return { kind: 'unsupported' };
  const fileSize = boundedSize(document.file_size);
  if (fileSize !== undefined && fileSize > TELEGRAM_PROOF_MEDIA_MAX_BYTES) {
    return { kind: 'too_large' };
  }
  return { kind: 'selected', media: { kind, fileId: document.file_id, fileSize } };
}

export interface TelegramProofMediaDependencies {
  readonly getFile: (
    fileId: string,
  ) => Promise<{ readonly file_path?: string; readonly file_size?: number }>;
  readonly token: string;
  readonly fetch?: typeof fetch;
  readonly recognize?: (bytes: Buffer, kind: TelegramProofMedia['kind']) => Promise<string>;
}

export type TelegramProofMediaResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'busy' };

let activeMediaJobs = 0;
const mediaJobWaiters: Array<{ resolve: (acquired: boolean) => void; timer: NodeJS.Timeout }> = [];

function acquireMediaJob(): Promise<boolean> {
  if (activeMediaJobs < MAX_ACTIVE_MEDIA_JOBS && mediaJobWaiters.length === 0) {
    activeMediaJobs += 1;
    return Promise.resolve(true);
  }
  if (mediaJobWaiters.length >= MAX_WAITING_MEDIA_JOBS) return Promise.resolve(false);
  return new Promise((resolve) => {
    const waiter = {
      resolve,
      timer: setTimeout(() => {
        const index = mediaJobWaiters.indexOf(waiter);
        if (index !== -1) mediaJobWaiters.splice(index, 1);
        resolve(false);
      }, MAX_MEDIA_WAIT_MS),
    };
    mediaJobWaiters.push(waiter);
  });
}

function releaseMediaJob(): void {
  const next = mediaJobWaiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(true);
  } else {
    activeMediaJobs -= 1;
  }
}

class UnreadableTelegramProof extends Error {}

function withinImageBounds(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_IMAGE_PIXELS;
}

function isBoundedImage(bytes: Buffer): boolean {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return (
      bytes.length >= 24 &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.toString('ascii', 12, 16) === 'IHDR' &&
      withinImageBounds(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    );
  }
  if (!bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9) return false;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (segmentLength < 7) return false;
      return withinImageBounds(bytes.readUInt16BE(offset + 3), bytes.readUInt16BE(offset + 5));
    }
    offset += segmentLength;
  }
  return false;
}

function hasMediaSignature(bytes: Buffer, kind: TelegramProofMedia['kind']): boolean {
  return kind === 'pdf' ? bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) : isBoundedImage(bytes);
}

function safeTelegramFilePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_FILE_PATH_LENGTH &&
    TELEGRAM_FILE_PATH.test(value) &&
    !value.startsWith('/') &&
    !value.split('/').includes('..')
  );
}

async function downloadTelegramFile(
  media: TelegramProofMedia,
  dependencies: TelegramProofMediaDependencies,
): Promise<Buffer | 'too_large'> {
  const file = await dependencies.getFile(media.fileId);
  if (!safeTelegramFilePath(file.file_path)) throw new Error('Telegram file path unavailable.');
  if (
    boundedSize(file.file_size) !== undefined &&
    file.file_size! > TELEGRAM_PROOF_MEDIA_MAX_BYTES
  ) {
    return 'too_large';
  }
  const response = await (dependencies.fetch ?? fetch)(
    `https://api.telegram.org/file/bot${dependencies.token}/${file.file_path}`,
    { redirect: 'error', signal: AbortSignal.timeout(12_000) },
  );
  if (!response.ok || !response.body) throw new Error('Telegram file download unavailable.');
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > TELEGRAM_PROOF_MEDIA_MAX_BYTES) {
    await response.body.cancel();
    return 'too_large';
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > TELEGRAM_PROOF_MEDIA_MAX_BYTES) {
        await reader.cancel();
        return 'too_large';
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function boundedExtractedText(text: string): string {
  // Poppler and Tesseract may separate pages with form-feed. It is layout, not customer text.
  const normalized = text.replace(/\f/gu, '\n');
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf8') > TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES
  ) {
    throw new UnreadableTelegramProof('Receipt text is empty or too large.');
  }
  return normalized;
}

async function runExtractor(
  command: string,
  arguments_: string[],
  timeout: number,
): Promise<string> {
  const { stdout } = await runFile(command, arguments_, {
    timeout,
    maxBuffer: TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES,
    windowsHide: true,
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', OMP_THREAD_LIMIT: '1' },
  });
  return stdout;
}

/** The source file and rendered pages are erased after every attempt, including process failure. */
export async function recognizeTelegramProofMedia(
  bytes: Buffer,
  kind: TelegramProofMedia['kind'],
): Promise<string> {
  if (!hasMediaSignature(bytes, kind))
    throw new UnreadableTelegramProof('Unsupported receipt content.');
  const directory = await mkdtemp(join(tmpdir(), 'fetanagent-proof-'));
  try {
    const isPng = bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const source = join(
      directory,
      kind === 'pdf' ? 'source.pdf' : isPng ? 'source.png' : 'source.jpg',
    );
    await writeFile(source, bytes, { mode: 0o600 });
    if (kind !== 'pdf') {
      return boundedExtractedText(
        await runExtractor('tesseract', [source, 'stdout', '-l', 'eng', '--psm', '3'], 12_000),
      );
    }

    const info = await runExtractor('pdfinfo', [source], 5_000);
    const pageCount = /^Pages:\s+(\d+)\s*$/mu.exec(info)?.[1];
    if (!pageCount || Number(pageCount) < 1 || Number(pageCount) > MAX_PDF_PAGES) {
      throw new UnreadableTelegramProof('PDF page count is unsupported.');
    }
    const embeddedText = (
      await runExtractor('pdftotext', ['-layout', '-f', '1', '-l', pageCount, source, '-'], 8_000)
    ).replace(/\f/gu, '\n');
    // Text PDFs are common. An image-only PDF uses the bounded raster/OCR fallback below.
    if (
      embeddedText.trim().length > 0 &&
      reduceTelegramDepositProofInput('telebirr', embeddedText, 'pdf_text').kind !== 'invalid_input'
    ) {
      return boundedExtractedText(embeddedText);
    }

    const outputRoot = join(directory, 'page');
    await runExtractor(
      'pdftoppm',
      ['-f', '1', '-l', pageCount, '-scale-to', '1800', '-gray', '-png', source, outputRoot],
      15_000,
    );
    const pages = (await readdir(directory)).filter((name) => /^page-\d+\.png$/u.test(name)).sort();
    if (pages.length !== Number(pageCount)) throw new Error('PDF rasterization incomplete.');
    const ocrText: string[] = [];
    for (const page of pages) {
      ocrText.push(
        await runExtractor(
          'tesseract',
          [join(directory, page), 'stdout', '-l', 'eng', '--psm', '3'],
          12_000,
        ),
      );
    }
    return boundedExtractedText(ocrText.join('\n'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Media is transient; an explicitly configured recognizer may forward image bytes to DigitalOcean. */
export async function extractTelegramProofMediaText(
  media: TelegramProofMedia,
  dependencies: TelegramProofMediaDependencies,
): Promise<TelegramProofMediaResult> {
  if (!(await acquireMediaJob())) return { kind: 'busy' };
  try {
    const bytes = await downloadTelegramFile(media, dependencies);
    if (bytes === 'too_large') return { kind: 'too_large' };
    if (!hasMediaSignature(bytes, media.kind)) return { kind: 'unreadable' };
    const text = await (dependencies.recognize ?? recognizeTelegramProofMedia)(bytes, media.kind);
    return { kind: 'text', text: boundedExtractedText(text) };
  } catch (error) {
    return { kind: error instanceof UnreadableTelegramProof ? 'unreadable' : 'unavailable' };
  } finally {
    releaseMediaJob();
  }
}
