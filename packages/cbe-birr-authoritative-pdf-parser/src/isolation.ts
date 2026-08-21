import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CBE_BIRR_PDF_PARSER_CHILD_ARGUMENT =
  '--fetanagent-cbe-birr-pdf-parser-child-v1' as const;
export const CBE_BIRR_PDF_PARSER_CHILD_KILL_GRACE_MS = 200 as const;

export interface CbeBirrPdfParserChildBoundary {
  readonly pid: number | undefined;
  readonly onceMessage: (listener: (candidate: unknown) => void) => void;
  readonly onceError: (listener: () => void) => void;
  readonly onceExit: (listener: () => void) => void;
  readonly removeMessageListener: (listener: (candidate: unknown) => void) => void;
  readonly removeErrorListener: (listener: () => void) => void;
  readonly removeExitListener: (listener: () => void) => void;
  readonly sendBoundedRequest: (payload: object, failureListener: () => void) => void;
  readonly forceKill: () => boolean;
  readonly disconnect: () => void;
  readonly unref: () => void;
}

type CbeBirrPdfParserSelectedOutcome =
  | { readonly state: 'message'; readonly candidate: unknown }
  | { readonly state: 'timeout' }
  | { readonly state: 'failure' };

export type CbeBirrPdfParserIsolationOutcome = CbeBirrPdfParserSelectedOutcome & {
  readonly cleanupConfirmed: boolean;
};

export interface CbeBirrPdfParserAdmissionLease {
  readonly release: () => void;
}

export interface CbeBirrPdfParserAdmissionGate {
  readonly tryAcquire: () => CbeBirrPdfParserAdmissionLease | undefined;
}

/**
 * Internal process-local child admission gate. A lease is idempotent so defensive cleanup cannot
 * accidentally increase capacity. The gate queues nothing and therefore fails closed under load.
 */
export function createCbeBirrPdfParserAdmissionGate(
  maximumConcurrentChildren: number,
): CbeBirrPdfParserAdmissionGate {
  if (!Number.isSafeInteger(maximumConcurrentChildren) || maximumConcurrentChildren < 1) {
    throw new RangeError('maximumConcurrentChildren must be a positive safe integer');
  }

  let activeChildren = 0;
  return Object.freeze({
    tryAcquire(): CbeBirrPdfParserAdmissionLease | undefined {
      if (activeChildren >= maximumConcurrentChildren) return undefined;
      activeChildren += 1;
      let released = false;
      return Object.freeze({
        release(): void {
          if (released) return;
          released = true;
          activeChildren -= 1;
        },
      });
    },
  });
}

/**
 * Starts the fixed parser module as a one-shot OS child. No request data appears in argv, env,
 * cwd, stdout, or stderr. The absolute executable and module paths are fixed by this package.
 */
export function spawnCbeBirrPdfParserChild(
  entryModuleUrl: URL,
  maximumOldGenerationMegabytes: number,
  maximumSemiSpaceMegabytes: number,
  stackKilobytes: number,
): CbeBirrPdfParserChildBoundary {
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${maximumOldGenerationMegabytes}`,
      `--max-semi-space-size=${maximumSemiSpaceMegabytes}`,
      `--stack-size=${stackKilobytes}`,
      fileURLToPath(entryModuleUrl),
      CBE_BIRR_PDF_PARSER_CHILD_ARGUMENT,
    ],
    {
      cwd: dirname(process.execPath),
      detached: false,
      env: Object.freeze({}),
      serialization: 'advanced',
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    },
  );

  return Object.freeze({
    pid: child.pid,
    onceMessage(listener: (candidate: unknown) => void): void {
      child.once('message', listener);
    },
    onceError(listener: () => void): void {
      child.once('error', listener);
    },
    onceExit(listener: () => void): void {
      child.once('exit', listener);
    },
    removeMessageListener(listener: (candidate: unknown) => void): void {
      child.off('message', listener);
    },
    removeErrorListener(listener: () => void): void {
      child.off('error', listener);
    },
    removeExitListener(listener: () => void): void {
      child.off('exit', listener);
    },
    sendBoundedRequest(payload: object, failureListener: () => void): void {
      child.send(payload, (error) => {
        if (error) failureListener();
      });
    },
    forceKill(): boolean {
      return child.kill('SIGKILL');
    },
    disconnect(): void {
      if (child.connected) child.disconnect();
    },
    unref(): void {
      child.unref();
    },
  });
}

/**
 * Internal one-shot supervisor. It never inspects, formats, logs, or retains the PDF payload.
 * OS-process exit is the only positive cleanup acknowledgement. If two forced-kill attempts do not
 * produce exit within the bounded grace periods, cleanup is unconfirmed so the caller can retain
 * its admission lease permanently and prevent any further child creation.
 */
export function superviseCbeBirrPdfParserChild(
  child: CbeBirrPdfParserChildBoundary,
  payload: object,
  timeoutMilliseconds: number,
  killGraceMilliseconds: number = CBE_BIRR_PDF_PARSER_CHILD_KILL_GRACE_MS,
): Promise<CbeBirrPdfParserIsolationOutcome> {
  return new Promise((resolve) => {
    let selectedOutcome: CbeBirrPdfParserSelectedOutcome | undefined;
    let resolved = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let firstKillTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = (): void => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (firstKillTimer) clearTimeout(firstKillTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
    const removeListeners = (): void => {
      try {
        child.removeMessageListener(onMessage);
      } catch {
        // Cleanup diagnostics must neither leak nor replace the selected terminal outcome.
      }
      try {
        child.removeErrorListener(onError);
      } catch {
        // Cleanup diagnostics must neither leak nor replace the selected terminal outcome.
      }
      try {
        child.removeExitListener(onExit);
      } catch {
        // Cleanup diagnostics must neither leak nor replace the selected terminal outcome.
      }
    };
    const safeForceKill = (): void => {
      try {
        child.forceKill();
      } catch {
        // The bounded fallback still runs and the terminal outcome remains redacted.
      }
    };
    const safeDisconnectAndUnref = (): void => {
      try {
        child.disconnect();
      } catch {
        // The child may already have closed its IPC channel.
      }
      try {
        child.unref();
      } catch {
        // The admission lease remains held when cleanup cannot be confirmed.
      }
    };
    const finalize = (cleanupConfirmed: boolean): void => {
      if (resolved || !selectedOutcome) return;
      resolved = true;
      clearTimers();
      if (cleanupConfirmed) {
        removeListeners();
      } else {
        safeDisconnectAndUnref();
      }
      resolve(Object.freeze({ ...selectedOutcome, cleanupConfirmed }));
    };
    const beginBoundedKill = (): void => {
      safeForceKill();
      firstKillTimer = setTimeout(
        () => {
          safeForceKill();
          fallbackTimer = setTimeout(() => finalize(false), Math.max(1, killGraceMilliseconds));
        },
        Math.max(1, killGraceMilliseconds),
      );
    };
    const select = (outcome: CbeBirrPdfParserSelectedOutcome): void => {
      if (selectedOutcome) return;
      selectedOutcome = outcome;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      beginBoundedKill();
    };
    const onMessage = (candidate: unknown): void => {
      select(Object.freeze({ state: 'message' as const, candidate }));
    };
    const onError = (): void => {
      select(Object.freeze({ state: 'failure' as const }));
    };
    const onExit = (): void => {
      if (resolved) {
        removeListeners();
        return;
      }
      if (!selectedOutcome) selectedOutcome = Object.freeze({ state: 'failure' as const });
      finalize(true);
    };

    try {
      child.onceMessage(onMessage);
      child.onceError(onError);
      child.onceExit(onExit);
      deadlineTimer = setTimeout(
        () => select(Object.freeze({ state: 'timeout' as const })),
        Math.max(1, timeoutMilliseconds),
      );
      child.sendBoundedRequest(payload, onError);
    } catch {
      select(Object.freeze({ state: 'failure' as const }));
    }
  });
}
