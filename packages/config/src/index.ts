import type { FinancialActionsMode } from '@payreplayy/domain';

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: string;
  readonly financialActionsMode: FinancialActionsMode;
  readonly api: {
    readonly host: string;
    readonly port: number;
  };
  readonly telegram: {
    readonly enabled: boolean;
    readonly token: string | undefined;
  };
  readonly kemerBet: {
    readonly executorEnabled: boolean;
    readonly finalActionFeatureEnabled: boolean;
  };
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected a boolean environment value, received '${value}'.`);
}

function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return 3000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`API_PORT must be an integer from 1 to 65535, received '${value}'.`);
  }
  return parsed;
}

function optional(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error(`NODE_ENV must be development, test, or production; received '${nodeEnv}'.`);
  }

  const financialActionsMode = environment.FINANCIAL_ACTIONS_MODE ?? 'dry_run';
  if (financialActionsMode !== 'dry_run' && financialActionsMode !== 'live') {
    throw new Error(
      `FINANCIAL_ACTIONS_MODE must be dry_run or live; received '${financialActionsMode}'.`,
    );
  }
  if (financialActionsMode === 'live' && nodeEnv !== 'production') {
    throw new Error('FINANCIAL_ACTIONS_MODE=live is allowed only when NODE_ENV=production.');
  }

  return {
    nodeEnv,
    logLevel: environment.LOG_LEVEL ?? 'info',
    financialActionsMode,
    api: {
      host: environment.API_HOST ?? '127.0.0.1',
      port: portFromEnv(environment.API_PORT),
    },
    telegram: {
      enabled: booleanFromEnv(environment.TELEGRAM_BOT_ENABLED, false),
      token: optional(environment.TELEGRAM_BOT_TOKEN),
    },
    kemerBet: {
      executorEnabled: booleanFromEnv(environment.KEMERBET_EXECUTOR_ENABLED, false),
      finalActionFeatureEnabled: booleanFromEnv(environment.KEMERBET_FINAL_ACTION_ENABLED, false),
    },
  };
}

export function redactedConfigForLog(config: AppConfig): Omit<AppConfig, 'telegram'> & {
  readonly telegram: { readonly enabled: boolean; readonly tokenConfigured: boolean };
} {
  return {
    ...config,
    telegram: { enabled: config.telegram.enabled, tokenConfigured: Boolean(config.telegram.token) },
  };
}
