import type { FinancialActionsMode } from '@payreplayy/domain';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface RuntimeConfig {
  readonly nodeEnv: NodeEnvironment;
  readonly logLevel: string;
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error(`NODE_ENV must be development, test, or production; received '${nodeEnv}'.`);
  }

  return {
    nodeEnv,
    logLevel: environment.LOG_LEVEL ?? 'info',
  };
}

export function loadFinancialActionsMode(
  environment: NodeJS.ProcessEnv = process.env,
): FinancialActionsMode {
  const financialActionsMode = environment.FINANCIAL_ACTIONS_MODE ?? 'dry_run';
  if (financialActionsMode !== 'dry_run' && financialActionsMode !== 'live') {
    throw new Error(
      `FINANCIAL_ACTIONS_MODE must be dry_run or live; received '${financialActionsMode}'.`,
    );
  }
  if (financialActionsMode === 'live' && environment.NODE_ENV !== 'production') {
    throw new Error('FINANCIAL_ACTIONS_MODE=live is allowed only when NODE_ENV=production.');
  }

  return financialActionsMode;
}

export function booleanFromEnv(
  value: string | undefined,
  fallback: boolean,
  variableName: string,
): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected ${variableName} to be true or false, received '${value}'.`);
}
