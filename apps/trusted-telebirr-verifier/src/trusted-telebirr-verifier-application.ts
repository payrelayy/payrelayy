import {
  createTrustedTelebirrPostgresRuntime,
  type TrustedTelebirrPostgresRuntime,
} from './postgres-trusted-telebirr-verifier.js';
import {
  loadTrustedTelebirrVerifierConfig,
  type TrustedTelebirrVerifierConfig,
} from './trusted-telebirr-verifier-config.js';
import {
  createTrustedTelebirrVerifier,
  type TrustedTelebirrPinnedKeys,
  type TrustedTelebirrVerifier,
  type TrustedTelebirrVerifierDatabase,
} from './trusted-telebirr-verifier.js';
import {
  createTrustedTelebirrVerifierHealth,
  TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST,
  TRUSTED_TELEBIRR_VERIFIER_HEALTH_PORT,
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

export const TRUSTED_TELEBIRR_VERIFIER_SHUTDOWN_TIMEOUT_MS = 15_000 as const;

export interface TrustedTelebirrVerifierSignalSource {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export interface TrustedTelebirrVerifierApplication {
  run(): Promise<void>;
  stop(): Promise<void>;
}

export interface TrustedTelebirrVerifierApplicationDependencies {
  readonly loadConfiguration?: () => TrustedTelebirrVerifierConfig;
  readonly createPostgresRuntime?: (
    connection: Extract<TrustedTelebirrVerifierConfig, { readonly enabled: true }>['connection'],
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

export class TrustedTelebirrVerifierApplicationUnavailableError extends Error {
  constructor() {
    super('The trusted TeleBirr verifier application is unavailable.');
    this.name = 'TrustedTelebirrVerifierApplicationUnavailableError';
  }
}

function shutdownDeadline(milliseconds: number): Readonly<{
  run(operation: () => Promise<void>): Promise<void>;
}> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 60_000) {
    throw new TrustedTelebirrVerifierApplicationUnavailableError();
  }
  return Object.freeze({
    async run(operation) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          operation(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new TrustedTelebirrVerifierApplicationUnavailableError()),
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
    // Startup always returns only the fixed application-unavailable error.
  }
}

/** Compose the private process around the database-only staged-evidence ingress. */
export async function createTrustedTelebirrVerifierApplication(
  dependencies: TrustedTelebirrVerifierApplicationDependencies = {},
): Promise<TrustedTelebirrVerifierApplication> {
  const timeoutMilliseconds =
    dependencies.shutdownTimeoutMilliseconds ?? TRUSTED_TELEBIRR_VERIFIER_SHUTDOWN_TIMEOUT_MS;
  const deadline = shutdownDeadline(timeoutMilliseconds);
  let runtime: TrustedTelebirrPostgresRuntime | null = null;

  try {
    const config = (dependencies.loadConfiguration ?? loadTrustedTelebirrVerifierConfig)();
    if (!config.enabled) throw new TrustedTelebirrVerifierApplicationUnavailableError();

    runtime = await (dependencies.createPostgresRuntime ?? createTrustedTelebirrPostgresRuntime)(
      config.connection,
    );
    const exactRuntime = runtime;
    const verifier = (dependencies.createVerifier ?? createTrustedTelebirrVerifier)(
      exactRuntime.database,
      config.pinnedKeys,
    );
    if (typeof verifier.verifyAndComplete !== 'function' || !(await exactRuntime.ready())) {
      throw new TrustedTelebirrVerifierApplicationUnavailableError();
    }
    const worker = (
      dependencies.createWorker ??
      ((source, pinnedVerifier) =>
        createTrustedTelebirrVerifierWorker({
          source,
          verifier: pinnedVerifier,
          onResult: (result) =>
            console.info(result, 'Trusted TeleBirr verification result recorded.'),
        }))
    )(exactRuntime.workSource, verifier);

    const health = createTrustedTelebirrVerifierHealth(() => exactRuntime.ready());
    const healthServer = (
      dependencies.createHealthServer ??
      ((value) =>
        createTrustedTelebirrVerifierHealthServer(value, {
          host: TRUSTED_TELEBIRR_VERIFIER_HEALTH_HOST,
          port: TRUSTED_TELEBIRR_VERIFIER_HEALTH_PORT,
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
          throw new TrustedTelebirrVerifierApplicationUnavailableError();
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
          throw new TrustedTelebirrVerifierApplicationUnavailableError();
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
            throw new TrustedTelebirrVerifierApplicationUnavailableError();
          }
          await stopPromise;
        } catch {
          await stop().catch(() => undefined);
          throw new TrustedTelebirrVerifierApplicationUnavailableError();
        }
      },

      stop,
    });
  } catch {
    if (runtime !== null) await closeRuntimeAfterStartupFailure(runtime, timeoutMilliseconds);
    throw new TrustedTelebirrVerifierApplicationUnavailableError();
  }
}
