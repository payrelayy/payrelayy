import type { ExecutorConfig } from '@fetanagent/config/executor';

import type { KemerBetDepositBrowser } from './kemerbet-deposit-browser-adapter.js';
import {
  createKemerBetDepositPostgresRuntime,
  type KemerBetDepositPostgresRuntime,
} from './kemerbet-deposit-postgres-runtime.js';
import { createKemerBetDepositRuntime } from './kemerbet-deposit-runtime.js';
import type { KemerBetDepositRunResult } from './kemerbet-deposit-runtime.js';

export interface KemerBetDepositService {
  runOnce(): Promise<KemerBetDepositRunResult>;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export interface KemerBetDepositServiceDependencies {
  readonly browserForAgentAccount: (
    platformAgentAccountId: string,
  ) => Promise<KemerBetDepositBrowser | null>;
  readonly workerInstanceId: string;
  readonly leaseSeconds: number;
  readonly now: () => Date;
  readonly log: (event: KemerBetDepositRunResult) => void;
  readonly createPostgresRuntime?: typeof createKemerBetDepositPostgresRuntime;
}

export class KemerBetDepositServiceUnavailableError extends Error {
  constructor() {
    super('The KemerBet deposit execution service is unavailable.');
    this.name = 'KemerBetDepositServiceUnavailableError';
  }
}

export async function createKemerBetDepositService(
  config: ExecutorConfig,
  dependencies: KemerBetDepositServiceDependencies,
): Promise<KemerBetDepositService> {
  if (
    config.financialActionsMode !== 'live' ||
    !config.kemerBet.executorEnabled ||
    !config.kemerBet.finalActionFeatureEnabled ||
    !config.kemerBet.executionRuntime.enabled
  ) {
    throw new KemerBetDepositServiceUnavailableError();
  }

  const postgres: KemerBetDepositPostgresRuntime = await (
    dependencies.createPostgresRuntime ?? createKemerBetDepositPostgresRuntime
  )(config.kemerBet.executionRuntime);
  const runtime = createKemerBetDepositRuntime({
    database: postgres.database,
    browserForAgentAccount: dependencies.browserForAgentAccount,
    workerInstanceId: dependencies.workerInstanceId,
    leaseSeconds: dependencies.leaseSeconds,
    finalActionEnabled: true,
    now: dependencies.now,
    log: dependencies.log,
  });

  return {
    runOnce: () => runtime.runOnce(),
    ready: () => postgres.ready(),
    close: () => postgres.close(),
  };
}
