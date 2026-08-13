import type { FinancialActionsMode } from '@fetanagent/domain';

import {
  booleanFromEnv,
  loadFinancialActionsMode,
  loadRuntimeConfig,
  type RuntimeConfig,
} from './shared.js';

export interface ExecutorConfig extends RuntimeConfig {
  readonly financialActionsMode: FinancialActionsMode;
  readonly kemerBet: {
    readonly executorEnabled: boolean;
    readonly finalActionFeatureEnabled: boolean;
  };
}

export function loadExecutorConfig(environment: NodeJS.ProcessEnv = process.env): ExecutorConfig {
  return {
    ...loadRuntimeConfig(environment),
    financialActionsMode: loadFinancialActionsMode(environment),
    kemerBet: {
      executorEnabled: booleanFromEnv(
        environment.KEMERBET_EXECUTOR_ENABLED,
        false,
        'KEMERBET_EXECUTOR_ENABLED',
      ),
      finalActionFeatureEnabled: booleanFromEnv(
        environment.KEMERBET_FINAL_ACTION_ENABLED,
        false,
        'KEMERBET_FINAL_ACTION_ENABLED',
      ),
    },
  };
}

export function redactedExecutorConfigForLog(config: ExecutorConfig): ExecutorConfig {
  return config;
}
