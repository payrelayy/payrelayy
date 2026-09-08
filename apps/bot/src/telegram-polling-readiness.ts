import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import type { Transformer } from 'grammy';

export const TELEGRAM_POLLING_READINESS_PATH = '/tmp/fetanagent-telegram-polling-readiness.json';
export const TELEGRAM_POLLING_READINESS_MAX_AGE_MS = 90_000;
const MAX_READINESS_BYTES = 256;

function removeIndicator(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing/unreadable indicators must never interrupt Telegram processing.
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** Reads only bounded, non-secret metadata. An absent or unreadable result fails closed. */
export function isTelegramPollingReady(
  path = TELEGRAM_POLLING_READINESS_PATH,
  now = Date.now(),
  processAlive: (processId: number) => boolean = isProcessAlive,
): boolean {
  let descriptor: number | undefined;
  try {
    if (!lstatSync(path).isFile()) return false;
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_READINESS_BYTES)
      return false;
    const buffer = Buffer.alloc(MAX_READINESS_BYTES + 1);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (length < 1 || length > MAX_READINESS_BYTES) return false;
    const value: unknown = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const fields = Object.keys(value).sort();
    if (fields.join(',') !== 'lastSuccessfulPollAtMs,processId,schemaVersion') return false;
    if (!('schemaVersion' in value) || value.schemaVersion !== 1) return false;
    if (
      !('processId' in value) ||
      typeof value.processId !== 'number' ||
      !Number.isSafeInteger(value.processId) ||
      value.processId <= 0 ||
      !('lastSuccessfulPollAtMs' in value) ||
      typeof value.lastSuccessfulPollAtMs !== 'number' ||
      !Number.isSafeInteger(value.lastSuccessfulPollAtMs) ||
      value.lastSuccessfulPollAtMs <= 0 ||
      !Number.isSafeInteger(now) ||
      now < value.lastSuccessfulPollAtMs ||
      now - value.lastSuccessfulPollAtMs > TELEGRAM_POLLING_READINESS_MAX_AGE_MS
    ) {
      return false;
    }
    return processAlive(value.processId);
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The healthcheck must never expose filesystem details.
      }
    }
  }
}

/** Observes existing getUpdates responses; does not inspect updates or issue additional requests. */
export function createTelegramPollingReadiness(
  options: { readonly path?: string; readonly now?: () => number } = {},
): { readonly transformer: Transformer; readonly stop: () => void } {
  const path = options.path ?? TELEGRAM_POLLING_READINESS_PATH;
  const pendingPath = `${path}.${process.pid}.pending`;
  const now = options.now ?? Date.now;
  let active = true;
  let reportedWriteFailure = false;
  // The tmpfs may survive a process restart. Old success must not authorize a new process.
  removeIndicator(path);
  removeIndicator(pendingPath);

  const stop = (): void => {
    active = false;
    removeIndicator(path);
    removeIndicator(pendingPath);
  };

  const transformer: Transformer = async (previous, method, payload, signal) => {
    const response = await previous(method, payload, signal);
    if (active && method === 'getUpdates' && response.ok === true) {
      try {
        const lastSuccessfulPollAtMs = now();
        if (!Number.isSafeInteger(lastSuccessfulPollAtMs) || lastSuccessfulPollAtMs <= 0) {
          throw new Error('Invalid readiness clock.');
        }
        writeFileSync(
          pendingPath,
          JSON.stringify({ schemaVersion: 1, processId: process.pid, lastSuccessfulPollAtMs }),
          { encoding: 'utf8', mode: 0o600, flag: 'wx' },
        );
        renameSync(pendingPath, path);
      } catch {
        removeIndicator(path);
        removeIndicator(pendingPath);
        if (!reportedWriteFailure) {
          reportedWriteFailure = true;
          console.warn('Telegram polling readiness indicator could not be written.');
        }
      }
    }
    return response;
  };

  return { transformer, stop };
}
