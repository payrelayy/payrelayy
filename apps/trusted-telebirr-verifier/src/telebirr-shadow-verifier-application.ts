import { createTelebirrShadowPostgresRuntime } from './postgres-telebirr-shadow-verifier.js';
import type { TrustedTelebirrPostgresRuntime } from './postgres-trusted-telebirr-verifier.js';
import {
  loadTelebirrShadowVerifierConfig,
  type TelebirrShadowVerifierConfig,
} from './trusted-telebirr-verifier-config.js';
import {
  createTelebirrShadowVerifier,
  type TrustedTelebirrPinnedKeys,
  type TrustedTelebirrVerifier,
  type TrustedTelebirrVerifierDatabase,
} from './trusted-telebirr-verifier.js';
import {
  createTelebirrShadowVerifierHealth,
  TELEBIRR_SHADOW_VERIFIER_HEALTH_PORT,
  TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST,
  type TrustedTelebirrVerifierHealth,
} from './trusted-telebirr-verifier-health.js';
import {
  createTrustedTelebirrVerifierHealthServer,
  type TrustedTelebirrVerifierHealthServer,
} from './trusted-telebirr-verifier-health-server.js';
import {
  createTrustedTelebirrVerifierWorker,
  type TrustedTelebirrVerifierWorker,
} from './trusted-telebirr-verifier-worker.js';
import type {
  TrustedTelebirrVerifierApplication,
  TrustedTelebirrVerifierSignalSource,
} from './trusted-telebirr-verifier-application.js';

export const TELEBIRR_SHADOW_VERIFIER_SHUTDOWN_TIMEOUT_MS = 15_000 as const;

export interface TelebirrShadowVerifierApplicationDependencies {
  readonly loadConfiguration?: () => TelebirrShadowVerifierConfig;
  readonly createPostgresRuntime?: (
    connection: Extract<TelebirrShadowVerifierConfig, { readonly enabled: true }>['connection'],
  ) => Promise<TrustedTelebirrPostgresRuntime>;
  readonly createVerifier?: (
    database: TrustedTelebirrVerifierDatabase,
    pinnedKeys: TrustedTelebirrPinnedKeys,
  ) => TrustedTelebirrVerifier;
  readonly createHealthServer?: (
    health: TrustedTelebirrVerifierHealth,
  ) => TrustedTelebirrVerifierHealthServer;
  readonly createWorker?: (
    source: TrustedTelebirrPostgresRuntime['workSource'],
    verifier: TrustedTelebirrVerifier,
  ) => TrustedTelebirrVerifierWorker;
  readonly signalSource?: TrustedTelebirrVerifierSignalSource;
  readonly shutdownTimeoutMilliseconds?: number;
}

export class TelebirrShadowVerifierApplicationUnavailableError extends Error {
  constructor() {
    super('The TeleBirr shadow verifier application is unavailable.');
    this.name = 'TelebirrShadowVerifierApplicationUnavailableError';
  }
}

function shutdownDeadline(milliseconds: number): Readonly<{
  run(operation: () => Promise<void>): Promise<void>;
}> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 60_000) {
    throw new TelebirrShadowVerifierApplicationUnavailableError();
  }
  return Object.freeze({
    async run(operation) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          operation(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new TelebirrShadowVerifierApplicationUnavailableError()),
              milliseconds,
            );
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  });
}

async function closeRuntimeAfterStartupFailure(
  runtime: TrustedTelebirrPostgresRuntime,
  timeoutMilliseconds: number,
): Promise<void> {
  try {
    await shutdownDeadline(timeoutMilliseconds).run(() => runtime.close());
  } catch {
    // Startup always returns only the fixed shadow-application unavailable error.
  }
}

/** Compose the no-money process around only the dedicated shadow database role and functions. */
export async function createTelebirrShadowVerifierApplication(
  dependencies: TelebirrShadowVerifierApplicationDependencies = {},
): Promise<TrustedTelebirrVerifierApplication> {
  const timeoutMilliseconds =
    dependencies.shutdownTimeoutMilliseconds ?? TELEBIRR_SHADOW_VERIFIER_SHUTDOWN_TIMEOUT_MS;
  const deadline = shutdownDeadline(timeoutMilliseconds);
  let runtime: TrustedTelebirrPostgresRuntime | null = null;

  try {
    const config = (dependencies.loadConfiguration ?? loadTelebirrShadowVerifierConfig)();
    if (!config.enabled) throw new TelebirrShadowVerifierApplicationUnavailableError();

    runtime = await (dependencies.createPostgresRuntime ?? createTelebirrShadowPostgresRuntime)(
      config.connection,
    );
    const exactRuntime = runtime;
    const verifier = (dependencies.createVerifier ?? createTelebirrShadowVerifier)(
      exactRuntime.database,
      config.pinnedKeys,
    );
    if (typeof verifier.verifyAndComplete !== 'function' || !(await exactRuntime.ready())) {
      throw new TelebirrShadowVerifierApplicationUnavailableError();
    }
    const worker = (
      dependencies.createWorker ??
      ((source, pinnedVerifier) =>
        createTrustedTelebirrVerifierWorker({
          source,
          verifier: pinnedVerifier,
          onResult: (result) =>
            console.info(result, 'TeleBirr shadow verification result recorded.'),
        }))
    )(exactRuntime.workSource, verifier);

    const health = createTelebirrShadowVerifierHealth(() => exactRuntime.ready());
    const healthServer = (
      dependencies.createHealthServer ??
      ((value) =>
        createTrustedTelebirrVerifierHealthServer(value, {
          host: TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST,
          port: TELEBIRR_SHADOW_VERIFIER_HEALTH_PORT,
        }))
    )(health);
    const signalSource = dependencies.signalSource ?? process;
    let started = false;
    let stopPromise: Promise<void> | null = null;

    const unbindSignals = () => {
      signalSource.removeListener('SIGINT', onSignal);
      signalSource.removeListener('SIGTERM', onSignal);
    };

    const stop = (): Promise<void> => {
      if (stopPromise !== null) return stopPromise;
      health.markStopping();
      unbindSignals();
      stopPromise = deadline.run(async () => {
        const processResults = await Promise.allSettled([healthServer.close(), worker.stop()]);
        const databaseResult = await Promise.allSettled([exactRuntime.close()]);
        if ([...processResults, ...databaseResult].some((result) => result.status === 'rejected')) {
          throw new TelebirrShadowVerifierApplicationUnavailableError();
        }
      });
      return stopPromise;
    };

    function onSignal(): void {
      void stop().catch(() => undefined);
    }

    return Object.freeze({
      async run() {
        if (started || stopPromise !== null) {
          throw new TelebirrShadowVerifierApplicationUnavailableError();
        }
        started = true;
        try {
          signalSource.once('SIGINT', onSignal);
          signalSource.once('SIGTERM', onSignal);
          await healthServer.start();
          if (stopPromise !== null) {
            await stopPromise;
            return;
          }
          await worker.run();
          if (stopPromise === null) {
            throw new TelebirrShadowVerifierApplicationUnavailableError();
          }
          await stopPromise;
        } catch {
          await stop().catch(() => undefined);
          throw new TelebirrShadowVerifierApplicationUnavailableError();
        }
      },
      stop,
    });
  } catch {
    if (runtime !== null) await closeRuntimeAfterStartupFailure(runtime, timeoutMilliseconds);
    throw new TelebirrShadowVerifierApplicationUnavailableError();
  }
}
