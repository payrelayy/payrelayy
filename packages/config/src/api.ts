import type { FinancialActionsMode } from '@payreplayy/domain';

import {
  booleanFromEnv,
  loadFinancialActionsMode,
  loadRuntimeConfig,
  requiredHexHmacSecret,
  type RuntimeConfig,
} from './shared.js';

export type ApiTelegramIngressConfig =
  | {
      readonly enabled: false;
      readonly transportHmacSecret: undefined;
      readonly payloadHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly transportHmacSecret: string;
      readonly payloadHmacSecret: string;
    };

export interface ApiConfig extends RuntimeConfig {
  readonly financialActionsMode: FinancialActionsMode;
  readonly api: {
    readonly host: string;
    readonly port: number;
  };
  readonly telegramIngress: ApiTelegramIngressConfig;
}

function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return 3000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`API_PORT must be an integer from 1 to 65535, received '${value}'.`);
  }
  return parsed;
}

function loadApiTelegramIngressConfig(environment: NodeJS.ProcessEnv): ApiTelegramIngressConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_INGRESS_ENABLED,
    false,
    'INTERNAL_TELEGRAM_INGRESS_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      transportHmacSecret: undefined,
      payloadHmacSecret: undefined,
    };
  }

  return {
    enabled: true,
    transportHmacSecret: requiredHexHmacSecret(
      environment.BOT_TO_API_INGRESS_HMAC_SECRET,
      'BOT_TO_API_INGRESS_HMAC_SECRET',
    ),
    payloadHmacSecret: requiredHexHmacSecret(
      environment.API_TELEGRAM_PAYLOAD_HMAC_SECRET,
      'API_TELEGRAM_PAYLOAD_HMAC_SECRET',
    ),
  };
}

export function loadApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    ...loadRuntimeConfig(environment),
    financialActionsMode: loadFinancialActionsMode(environment),
    api: {
      host: environment.API_HOST ?? '127.0.0.1',
      port: portFromEnv(environment.API_PORT),
    },
    telegramIngress: loadApiTelegramIngressConfig(environment),
  };
}

export function redactedApiConfigForLog(config: ApiConfig): Omit<ApiConfig, 'telegramIngress'> & {
  readonly telegramIngress: { readonly enabled: boolean; readonly secretsConfigured: boolean };
} {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    financialActionsMode: config.financialActionsMode,
    api: config.api,
    telegramIngress: {
      enabled: config.telegramIngress.enabled,
      secretsConfigured: config.telegramIngress.enabled,
    },
  };
}
