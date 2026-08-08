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

/**
 * This controls only API-side capability-contract keys. It does not enable a Telegram route,
 * database action, bot polling, Player-ID validation, or any financial capability.
 */
export type ApiTelegramActionCapabilityConfig =
  | {
      readonly enabled: false;
      readonly capabilityHmacSecret: undefined;
      readonly semanticHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly capabilityHmacSecret: string;
      readonly semanticHmacSecret: string;
    };

export interface ApiConfig extends RuntimeConfig {
  readonly financialActionsMode: FinancialActionsMode;
  readonly api: {
    readonly host: string;
    readonly port: number;
  };
  readonly telegramIngress: ApiTelegramIngressConfig;
  readonly telegramActionCapability: ApiTelegramActionCapabilityConfig;
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

function loadApiTelegramActionCapabilityConfig(
  environment: NodeJS.ProcessEnv,
): ApiTelegramActionCapabilityConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED,
    false,
    'INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      capabilityHmacSecret: undefined,
      semanticHmacSecret: undefined,
    };
  }

  return {
    enabled: true,
    capabilityHmacSecret: requiredHexHmacSecret(
      environment.API_TELEGRAM_CAPABILITY_HMAC_SECRET,
      'API_TELEGRAM_CAPABILITY_HMAC_SECRET',
    ),
    semanticHmacSecret: requiredHexHmacSecret(
      environment.API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET,
      'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET',
    ),
  };
}

function assertDistinctApiTelegramHmacSecrets(
  telegramIngress: ApiTelegramIngressConfig,
  telegramActionCapability: ApiTelegramActionCapabilityConfig,
): void {
  if (!telegramActionCapability.enabled) return;

  const namedSecrets: (readonly [string, string])[] = [
    ['API_TELEGRAM_CAPABILITY_HMAC_SECRET', telegramActionCapability.capabilityHmacSecret],
    ['API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET', telegramActionCapability.semanticHmacSecret],
  ];

  if (telegramIngress.enabled) {
    namedSecrets.push(
      ['BOT_TO_API_INGRESS_HMAC_SECRET', telegramIngress.transportHmacSecret],
      ['API_TELEGRAM_PAYLOAD_HMAC_SECRET', telegramIngress.payloadHmacSecret],
    );
  }

  for (let left = 0; left < namedSecrets.length; left += 1) {
    for (let right = left + 1; right < namedSecrets.length; right += 1) {
      const leftSecret = namedSecrets[left];
      const rightSecret = namedSecrets[right];
      if (leftSecret === undefined || rightSecret === undefined) continue;
      if (leftSecret[1] === rightSecret[1]) {
        throw new Error(`${leftSecret[0]} must be distinct from ${rightSecret[0]}.`);
      }
    }
  }
}

export function loadApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const telegramIngress = loadApiTelegramIngressConfig(environment);
  const telegramActionCapability = loadApiTelegramActionCapabilityConfig(environment);
  assertDistinctApiTelegramHmacSecrets(telegramIngress, telegramActionCapability);

  return {
    ...loadRuntimeConfig(environment),
    financialActionsMode: loadFinancialActionsMode(environment),
    api: {
      host: environment.API_HOST ?? '127.0.0.1',
      port: portFromEnv(environment.API_PORT),
    },
    telegramIngress,
    telegramActionCapability,
  };
}

export function redactedApiConfigForLog(config: ApiConfig): Omit<
  ApiConfig,
  'telegramIngress' | 'telegramActionCapability'
> & {
  readonly telegramIngress: { readonly enabled: boolean; readonly secretsConfigured: boolean };
  readonly telegramActionCapability: {
    readonly enabled: boolean;
    readonly secretsConfigured: boolean;
  };
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
    telegramActionCapability: {
      enabled: config.telegramActionCapability.enabled,
      secretsConfigured: config.telegramActionCapability.enabled,
    },
  };
}
