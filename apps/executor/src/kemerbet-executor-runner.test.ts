import { describe, expect, it } from 'vitest';

import { createKemerBetExecutorHealth } from './executor-health.js';
import {
  abortableExecutorDelay,
  bindKemerBetExecutorSigterm,
  createKemerBetExecutorRunner,
  KemerBetExecutorRunnerAlreadyStartedError,
  KemerBetExecutorStartupUnavailableError,
  type KemerBetExecutorRunner,
  type KemerBetExecutorSignalSource,
} from './kemerbet-executor-runner.js';
import type { KemerBetDepositRunResult } from './kemerbet-deposit-runtime.js';

const AGENT_ACCOUNT_ID = '88888888-8888-4888-8888-888888888881';

function result(
  event: Exclude<KemerBetDepositRunResult['event'], 'recovery_circuit_open'>,
  phase: 'prepare' | 'execute' | 'reconcile' | 'none',
): KemerBetDepositRunResult {
  return {
    component: 'kemerbet_deposit_executor',
    event,
    phase,
    actionRetryAllowed: false,
    financialDetailsRedacted: true,
  };
}

function recoveryCircuitResult(): KemerBetDepositRunResult {
  return {
    component: 'kemerbet_deposit_executor',
    event: 'recovery_circuit_open',
    phase: 'prepare',
    actionRetryAllowed: false,
    financialDetailsRedacted: true,
    workerDisposition: 'pause',
  };
}

function health(order: string[] = []) {
  return createKemerBetExecutorHealth({
    platformAgentAccountIds: [AGENT_ACCOUNT_ID],
    probeDatabase: async () => {
      order.push('database-ready');
      return true;
    },
    probeSessionReadiness: async (accountId) => {
      expect(accountId).toBe(AGENT_ACCOUNT_ID);
      order.push('session-ready');
      return { ready: true, reason: 'ready' };
    },
  });
}

function startup(order: string[] = []) {
  return {
    async validateConfiguration() {
      order.push('configuration');
    },
    async assertHistoryReferenceHmacReady() {
      order.push('history-hmac');
    },
    async assertAgentIdentityHmacReady() {
      order.push('identity-hmac');
    },
    async assertDatabaseCatalogPreflight() {
      order.push('catalog');
    },
  };
}

describe('KemerBet executor runner', () => {
  it('runs the exact startup sequence, sleeps one abortable second when idle, and closes in order', async () => {
    const order: string[] = [];
    const delays: number[] = [];
    let runner!: KemerBetExecutorRunner;
    runner = createKemerBetExecutorRunner({
      startup: startup(order),
      health: health(order),
      service: {
        async runOnce() {
          order.push('run-once');
          return result('idle', 'none');
        },
        async close() {
          order.push('database-close');
        },
      },
      sessionRegistry: {
        async close() {
          order.push('browser-close');
        },
      },
      async sleep(milliseconds, signal) {
        delays.push(milliseconds);
        expect(signal.aborted).toBe(false);
        runner.requestStop();
      },
    });

    await runner.start();
    expect(delays).toEqual([1_000]);
    expect(order).toEqual([
      'configuration',
      'history-hmac',
      'identity-hmac',
      'catalog',
      'database-ready',
      'session-ready',
      'run-once',
      'browser-close',
      'database-close',
    ]);
  });

  it.each([
    [result('cancelled_before_action', 'prepare'), 'cancelled_before_action'],
    [result('needs_attention', 'reconcile'), 'needs_attention'],
    [recoveryCircuitResult(), 'recovery_circuit_open'],
  ] as const)('opens the circuit and stops immediately for %s', async (runResult, reason) => {
    let runs = 0;
    let sleeps = 0;
    let browserCloses = 0;
    let databaseCloses = 0;
    const runnerHealth = health();
    let runner!: KemerBetExecutorRunner;
    runner = createKemerBetExecutorRunner({
      startup: startup(),
      health: runnerHealth,
      service: {
        async runOnce() {
          runs += 1;
          return runResult;
        },
        async close() {
          databaseCloses += 1;
        },
      },
      sessionRegistry: {
        async close() {
          browserCloses += 1;
        },
      },
      async sleep() {
        sleeps += 1;
      },
      async waitForStop(signal) {
        expect(signal.aborted).toBe(false);
        runner.requestStop();
      },
    });

    await runner.start();
    expect(runs).toBe(1);
    expect(sleeps).toBe(0);
    expect(runnerHealth.circuitReason()).toBe(reason);
    expect(browserCloses).toBe(1);
    expect(databaseCloses).toBe(1);
  });

  it('uses capped exponential database-error backoff and never overlaps runOnce', async () => {
    const delays: number[] = [];
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    let runner!: KemerBetExecutorRunner;
    runner = createKemerBetExecutorRunner({
      startup: startup(),
      health: health(),
      service: {
        async runOnce() {
          calls += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          active -= 1;
          if (calls <= 3) throw new Error('redacted database outage');
          return result('idle', 'none');
        },
        async close() {},
      },
      sessionRegistry: { async close() {} },
      databaseBackoffBaseMilliseconds: 100,
      databaseBackoffMaximumMilliseconds: 250,
      async sleep(milliseconds) {
        delays.push(milliseconds);
        if (milliseconds === 1_000) runner.requestStop();
      },
    });

    await runner.start();
    expect(delays).toEqual([100, 200, 250, 1_000]);
    expect(calls).toBe(4);
    expect(maximumActive).toBe(1);
  });

  it('rejects a second start while an in-flight lease is being resolved', async () => {
    let resolveRun!: (value: KemerBetDepositRunResult) => void;
    let markRunEntered!: () => void;
    const runEntered = new Promise<void>((resolve) => {
      markRunEntered = resolve;
    });
    const runner = createKemerBetExecutorRunner({
      startup: startup(),
      health: health(),
      service: {
        runOnce: () =>
          new Promise<KemerBetDepositRunResult>((resolveResult) => {
            resolveRun = resolveResult;
            markRunEntered();
          }),
        async close() {},
      },
      sessionRegistry: { async close() {} },
    });
    const first = runner.start();
    await runEntered;

    await expect(runner.start()).rejects.toBeInstanceOf(KemerBetExecutorRunnerAlreadyStartedError);
    runner.requestStop();
    resolveRun(result('idle', 'none'));
    await first;
  });

  it('fails startup closed before leasing and still closes browser and database resources', async () => {
    let runs = 0;
    const closes: string[] = [];
    const runnerHealth = health();
    const runner = createKemerBetExecutorRunner({
      startup: {
        async validateConfiguration() {},
        async assertHistoryReferenceHmacReady() {},
        async assertAgentIdentityHmacReady() {
          throw new Error('secret details must not escape');
        },
        async assertDatabaseCatalogPreflight() {
          throw new Error('must not be reached');
        },
      },
      health: runnerHealth,
      service: {
        async runOnce() {
          runs += 1;
          return result('idle', 'none');
        },
        async close() {
          closes.push('database');
        },
      },
      sessionRegistry: {
        async close() {
          closes.push('browser');
        },
      },
    });

    await expect(runner.start()).rejects.toBeInstanceOf(KemerBetExecutorStartupUnavailableError);
    expect(runs).toBe(0);
    expect(closes).toEqual(['browser', 'database']);
    expect(runnerHealth.circuitReason()).toBe('startup_failed');
  });

  it('turns SIGTERM into graceful stop and closes the browser before the database', async () => {
    let listener: (() => void) | null = null;
    const signalSource: KemerBetExecutorSignalSource = {
      once(_event, next) {
        listener = next;
      },
      off(_event, next) {
        if (listener === next) listener = null;
      },
    };
    const emitSigterm = () => {
      if (listener !== null) listener();
    };
    let resolveRun!: (value: KemerBetDepositRunResult) => void;
    let entered!: () => void;
    const runEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const closes: string[] = [];
    const runner = createKemerBetExecutorRunner({
      startup: startup(),
      health: health(),
      service: {
        runOnce: () =>
          new Promise<KemerBetDepositRunResult>((resolve) => {
            resolveRun = resolve;
            entered();
          }),
        async close() {
          closes.push('database');
        },
      },
      sessionRegistry: {
        async close() {
          closes.push('browser');
        },
      },
    });
    const unbind = bindKemerBetExecutorSigterm(runner, signalSource);
    const running = runner.start();
    await runEntered;

    emitSigterm();
    resolveRun(result('idle', 'none'));
    await running;
    unbind();
    expect(closes).toEqual(['browser', 'database']);
    expect(listener).toBeNull();
  });

  it('aborts the real idle delay promptly without rejecting', async () => {
    const controller = new AbortController();
    const delay = abortableExecutorDelay(10_000, controller.signal);
    controller.abort();
    await expect(delay).resolves.toBeUndefined();
  });
});
