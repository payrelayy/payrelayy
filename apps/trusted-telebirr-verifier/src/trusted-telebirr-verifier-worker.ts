import type { TrustedTelebirrVerifierWorkSource } from './postgres-trusted-telebirr-verifier.js';
import {
  redactedTrustedTelebirrVerificationForLog,
  type RedactedTrustedTelebirrVerificationLogProjection,
  type TrustedTelebirrVerifier,
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
  readonly pollIntervalMilliseconds?: number;
}

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
      const request = await dependencies.source.loadNext();
      if (stopping) return;
      if (request === null) {
        await pause();
        continue;
      }

      const result = await dependencies.verifier.verifyAndComplete(request);
      if (result.status === 'not_settled') {
        if (result.disposition !== 'invalid' || result.reasonCode !== 'trusted_evidence_invalid') {
          throw new TrustedTelebirrVerifierWorkerUnavailableError();
        }
        await dependencies.source.quarantineInvalid({
          verificationAttemptId: request.verificationAttemptId,
          leaseToken: request.leaseToken,
          observationBodyDigest: request.signedObservation.bodyDigest,
        });
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
