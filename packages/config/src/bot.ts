import { booleanFromEnv, loadRuntimeConfig, type RuntimeConfig } from './shared.js';

export type TelegramConfig =
  | {
      readonly enabled: false;
      readonly token: undefined;
    }
  | {
      readonly enabled: true;
      readonly token: string;
    };

export interface BotConfig extends RuntimeConfig {
  readonly telegram: TelegramConfig;
}

function requiredTelegramToken(value: string | undefined): string {
  if (!value) {
    throw new Error('TELEGRAM_BOT_TOKEN is required when TELEGRAM_BOT_ENABLED=true.');
  }
  return value;
}

export function loadBotConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
  const runtime = loadRuntimeConfig(environment);
  const enabled = booleanFromEnv(environment.TELEGRAM_BOT_ENABLED, false, 'TELEGRAM_BOT_ENABLED');

  if (!enabled) {
    return {
      ...runtime,
      telegram: {
        enabled: false,
        token: undefined,
      },
    };
  }

  return {
    ...runtime,
    telegram: {
      enabled: true,
      token: requiredTelegramToken(environment.TELEGRAM_BOT_TOKEN),
    },
  };
}

export function redactedBotConfigForLog(config: BotConfig): Omit<BotConfig, 'telegram'> & {
  readonly telegram: { readonly enabled: boolean; readonly tokenConfigured: boolean };
} {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    telegram: {
      enabled: config.telegram.enabled,
      tokenConfigured: config.telegram.enabled,
    },
  };
}
