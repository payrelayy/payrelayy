import type { TrustedTelebirrVerifierWorkSource } from './postgres-trusted-telebirr-verifier.js';
import {
  redactedTrustedTelebirrVerificationForLog,
  TrustedTelebirrVerifierUnavailableError,
  type RedactedTrustedTelebirrVerificationLogProjection,
  type TrustedTelebirrVerifier,
  type TrustedTelebirrVerifierFailureStage,
} from './trusted-telebirr-verifier.js';

export const TRUSTED_TELEBIRR_VERIFIER_POLL_INTERVAL_MS = 1_000 as const;

export interface TrustedTelebirrVerifierWorker {
  run(): Promise<void>;
  stop(): Promise<void>;
}

export interface TrustedTelebirrVerifierWorkerDependencies {
  readonly source: TrustedTelebirrVerifierWorkSource;
  readonly verifier: TrustedTelebirrVerifier;
  readonly onResult?: (result: RedactedTrustedTelebirrVerificationLogProjection) => void;
  readonly onFailureStage?: (stage: TrustedTelebirrVerifierWorkerFailureStage) => void;
  readonly pollIntervalMilliseconds?: number;
}

export type TrustedTelebirrVerifierWorkerFailureStage =
  | 'load_staged_evidence'
  | TrustedTelebirrVerifierFailureStage
  | 'persist_quarantine'
  | 'unpersisted_result';

export class TrustedTelebirrVerifierWorkerUnavailableError extends Error {
  constructor() {
    super('The trusted TeleBirr verifier worker is unavailable.');
    this.name = 'TrustedTelebirrVerifierWorkerUnavailableError';
  }
}

/**
 * Consume only database-staged, signed evidence. The source owns durable idempotency; this loop
 * owns no network listener and emits only the verifier's fixed redacted projection.
 */
export function createTrustedTelebirrVerifierWorker(
  dependencies: TrustedTelebirrVerifierWorkerDependencies,
): TrustedTelebirrVerifierWorker {
  const interval =
    dependencies.pollIntervalMilliseconds ?? TRUSTED_TELEBIRR_VERIFIER_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(interval) || interval < 10 || interval > 10_000) {
    throw new TrustedTelebirrVerifierWorkerUnavailableError();
  }

  let stopping = false;
  let runPromise: Promise<void> | null = null;
  let wakePause: (() => void) | null = null;

  const reportFailureStage = (stage: TrustedTelebirrVerifierWorkerFailureStage): void => {
    try {
      dependencies.onFailureStage?.(stage);
    } catch {
      // A fixed redacted diagnostic sink cannot change the fail-closed worker result.
    }
  };

  const pause = (): Promise<void> =>
    new Promise((resolve) => {
      if (stopping) return resolve();
      const timer = setTimeout(() => {
        if (wakePause === wake) wakePause = null;
        resolve();
      }, interval);
      timer.unref?.();
      const wake = () => {
        clearTimeout(timer);
        if (wakePause === wake) wakePause = null;
        resolve();
      };
      wakePause = wake;
    });

  const loop = async (): Promise<void> => {
    while (!stopping) {
      let request: Awaited<ReturnType<TrustedTelebirrVerifierWorkSource['loadNext']>>;
      try {
        request = await dependencies.source.loadNext();
      } catch {
        reportFailureStage('load_staged_evidence');
        throw new TrustedTelebirrVerifierWorkerUnavailableError();
      }
      if (stopping) return;
      if (request === null) {
        await pause();
        continue;
      }

      let result: Awaited<ReturnType<TrustedTelebirrVerifier['verifyAndComplete']>>;
      try {
        result = await dependencies.verifier.verifyAndComplete(request);
      } catch (error) {
        reportFailureStage(
          error instanceof TrustedTelebirrVerifierUnavailableError
            ? error.failureStage
            : 'unavailable',
        );
        throw new TrustedTelebirrVerifierWorkerUnavailableError();
      }
      const invalidEvidence =
        (result.status === 'not_settled' &&
          result.disposition === 'invalid' &&
          result.reasonCode === 'trusted_evidence_invalid') ||
        (result.status === 'shadow_not_completed' &&
          result.disposition === 'would_reject' &&
          result.reasonCode === 'trusted_evidence_invalid');
      if (invalidEvidence) {
        try {
          await dependencies.source.quarantineInvalid({
            verificationAttemptId: request.verificationAttemptId,
            leaseToken: request.leaseToken,
            observationBodyDigest: request.signedObservation.bodyDigest,
          });
        } catch {
          reportFailureStage('persist_quarantine');
          throw new TrustedTelebirrVerifierWorkerUnavailableError();
        }
      } else if (result.status === 'not_settled' || result.status === 'shadow_not_completed') {
        reportFailureStage('unpersisted_result');
        throw new TrustedTelebirrVerifierWorkerUnavailableError();
      }
      try {
        dependencies.onResult?.(redactedTrustedTelebirrVerificationForLog(result));
      } catch {
        // A redacted log sink cannot change the durable verifier outcome or stop consumption.
      }
    }
  };

  return Object.freeze({
    run() {
      if (runPromise !== null) {
        return Promise.reject(new TrustedTelebirrVerifierWorkerUnavailableError());
      }
      runPromise = loop().catch(() => {
        throw new TrustedTelebirrVerifierWorkerUnavailableError();
      });
      return runPromise;
    },

    async stop() {
      stopping = true;
      wakePause?.();
      if (runPromise !== null) await runPromise;
    },
  });
}
