import type { KemerBetExecutorCircuitReason, KemerBetExecutorHealth } from './executor-health.js';
import type { KemerBetDepositRunResult } from './kemerbet-deposit-runtime.js';

export interface KemerBetExecutorRunnerService {
  runOnce(): Promise<KemerBetDepositRunResult>;
  close(): Promise<void>;
}

export interface KemerBetExecutorRunnerSessionRegistry {
  close(): Promise<void>;
}

export interface KemerBetExecutorRunnerStartup {
  validateConfiguration(): Promise<void> | void;
  assertHistoryReferenceHmacReady(): Promise<void> | void;
  assertAgentIdentityHmacReady(): Promise<void> | void;
  assertDatabaseCatalogPreflight(): Promise<void>;
}

export interface KemerBetExecutorRunnerDependencies {
  readonly service: KemerBetExecutorRunnerService;
  readonly sessionRegistry: KemerBetExecutorRunnerSessionRegistry;
  readonly startup: KemerBetExecutorRunnerStartup;
  readonly health: KemerBetExecutorHealth;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly waitForStop?: (signal: AbortSignal) => Promise<void>;
  readonly onResult?: (result: KemerBetDepositRunResult) => void;
  readonly onDatabaseBackoff?: (delayMilliseconds: number) => void;
  readonly idleMilliseconds?: number;
  readonly databaseBackoffBaseMilliseconds?: number;
  readonly databaseBackoffMaximumMilliseconds?: number;
}

export interface KemerBetExecutorRunner {
  start(signal?: AbortSignal): Promise<void>;
  requestStop(): void;
  stop(): Promise<void>;
}

export class KemerBetExecutorRunnerAlreadyStartedError extends Error {
  constructor() {
    super('The KemerBet executor runner cannot be started more than once.');
    this.name = 'KemerBetExecutorRunnerAlreadyStartedError';
  }
}

export class KemerBetExecutorStartupUnavailableError extends Error {
  constructor() {
    super('The KemerBet executor runner failed its startup readiness checks.');
    this.name = 'KemerBetExecutorStartupUnavailableError';
  }
}

function boundedMilliseconds(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 60_000) {
    throw new TypeError('Executor timing must be an integer from 1 through 60000 milliseconds.');
  }
  return resolved;
}

export async function abortableExecutorDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function waitForExecutorStop(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const stopped = () => {
      signal.removeEventListener('abort', stopped);
      resolve();
    };
    signal.addEventListener('abort', stopped, { once: true });
  });
}

function circuitReason(result: KemerBetDepositRunResult): KemerBetExecutorCircuitReason | null {
  if (result.event === 'cancelled_before_action') return 'cancelled_before_action';
  if (result.event === 'needs_attention') return 'needs_attention';
  if (result.event === 'recovery_circuit_open') return 'recovery_circuit_open';
  return null;
}

export function createKemerBetExecutorRunner(
  dependencies: KemerBetExecutorRunnerDependencies,
): KemerBetExecutorRunner {
  const idleMilliseconds = boundedMilliseconds(dependencies.idleMilliseconds, 1_000);
  const backoffBase = boundedMilliseconds(dependencies.databaseBackoffBaseMilliseconds, 250);
  const backoffMaximum = boundedMilliseconds(
    dependencies.databaseBackoffMaximumMilliseconds,
    5_000,
  );
  if (backoffBase > backoffMaximum) {
    throw new TypeError('Executor database backoff base cannot exceed its maximum.');
  }
  const sleep = dependencies.sleep ?? abortableExecutorDelay;
  const waitForStop = dependencies.waitForStop ?? waitForExecutorStop;
  const controller = new AbortController();
  let state: 'created' | 'running' | 'stopping' | 'stopped' = 'created';
  let completion: Promise<void> | null = null;
  let closed = false;

  async function closeResources(): Promise<void> {
    if (closed) return;
    closed = true;
    dependencies.health.markStopping();
    let browserCloseError: unknown;
    try {
      await dependencies.sessionRegistry.close();
    } catch (error) {
      browserCloseError = error;
    }
    try {
      await dependencies.service.close();
    } catch (error) {
      if (browserCloseError === undefined) throw error;
    }
    if (browserCloseError !== undefined) throw browserCloseError;
  }

  function requestStop(): void {
    if (state === 'stopped') return;
    if (state === 'running') state = 'stopping';
    controller.abort();
  }

  async function execute(externalSignal?: AbortSignal): Promise<void> {
    const externalStop = () => requestStop();
    externalSignal?.addEventListener('abort', externalStop, { once: true });
    try {
      if (externalSignal?.aborted) requestStop();
      if (controller.signal.aborted) return;

      try {
        await dependencies.startup.validateConfiguration();
        await dependencies.startup.assertHistoryReferenceHmacReady();
        await dependencies.startup.assertAgentIdentityHmacReady();
        await dependencies.startup.assertDatabaseCatalogPreflight();
        const readiness = await dependencies.health.readyz();
        if (!readiness.ready) throw new KemerBetExecutorStartupUnavailableError();
      } catch (error) {
        dependencies.health.openCircuit('startup_failed');
        if (error instanceof KemerBetExecutorStartupUnavailableError) throw error;
        throw new KemerBetExecutorStartupUnavailableError();
      }

      let consecutiveDatabaseErrors = 0;
      while (!controller.signal.aborted) {
        let result: KemerBetDepositRunResult;
        try {
          // Sequential awaiting is intentional: there is exactly one leased workflow at a time.
          result = await dependencies.service.runOnce();
          consecutiveDatabaseErrors = 0;
        } catch {
          if (controller.signal.aborted) break;
          consecutiveDatabaseErrors += 1;
          const exponent = Math.min(consecutiveDatabaseErrors - 1, 20);
          const delay = Math.min(backoffBase * 2 ** exponent, backoffMaximum);
          dependencies.onDatabaseBackoff?.(delay);
          await sleep(delay, controller.signal);
          continue;
        }

        dependencies.onResult?.(result);
        const reason = circuitReason(result);
        if (reason !== null) {
          dependencies.health.openCircuit(reason);
          // A financial circuit pauses all leasing but keeps liveness available for supervision.
          // Only SIGTERM or an explicit stop closes the browser sessions and database runtime.
          await waitForStop(controller.signal);
          break;
        }
        if (result.event === 'idle') {
          await sleep(idleMilliseconds, controller.signal);
        }
      }
    } finally {
      externalSignal?.removeEventListener('abort', externalStop);
      await closeResources();
      state = 'stopped';
    }
  }

  const runner: KemerBetExecutorRunner = {
    start(signal) {
      if (state !== 'created') {
        return Promise.reject(new KemerBetExecutorRunnerAlreadyStartedError());
      }
      state = 'running';
      completion = execute(signal);
      return completion;
    },

    requestStop,

    async stop() {
      requestStop();
      if (completion !== null) {
        await completion;
      } else {
        state = 'stopping';
        await closeResources();
        state = 'stopped';
      }
    },
  };

  return runner;
}

export interface KemerBetExecutorSignalSource {
  once(event: 'SIGTERM', listener: () => void): void;
  off(event: 'SIGTERM', listener: () => void): void;
}

export function bindKemerBetExecutorSigterm(
  runner: KemerBetExecutorRunner,
  signalSource: KemerBetExecutorSignalSource = process,
): () => void {
  const stop = () => runner.requestStop();
  signalSource.once('SIGTERM', stop);
  return () => signalSource.off('SIGTERM', stop);
}
