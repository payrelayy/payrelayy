import {
  booleanFromEnv,
  loadRuntimeConfig,
  requiredHexHmacSecret,
  type NodeEnvironment,
  type RuntimeConfig,
} from './shared.js';

export type TelegramConfig =
  | {
      readonly enabled: false;
      readonly token: undefined;
    }
  | {
      readonly enabled: true;
      readonly token: string;
    };

export type BotApiIngressConfig =
  | {
      readonly enabled: false;
      readonly baseUrl: undefined;
      readonly transportHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly baseUrl: string;
      readonly transportHmacSecret: string;
    };

/**
 * A reserved, independently authenticated action-channel transport. It is config-only in this
 * stage: no bot handler, polling, fetch client, or API route consumes it.
 */
export type BotTelegramActionChannelConfig =
  | {
      readonly enabled: false;
      readonly baseUrl: undefined;
      readonly transportHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly baseUrl: string;
      readonly transportHmacSecret: string;
    };

export interface BotConfig extends RuntimeConfig {
  readonly telegram: TelegramConfig;
  readonly apiIngress: BotApiIngressConfig;
  readonly telegramActionChannel: BotTelegramActionChannelConfig;
}

function requiredTelegramToken(value: string | undefined): string {
  if (!value) {
    throw new Error('TELEGRAM_BOT_TOKEN is required when TELEGRAM_BOT_ENABLED=true.');
  }
  return value;
}

function requiredInternalApiBaseUrl(value: string | undefined, nodeEnv: NodeEnvironment): string {
  if (!value) {
    throw new Error('BOT_TO_API_INGRESS_BASE_URL is required when TELEGRAM_BOT_ENABLED=true.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('BOT_TO_API_INGRESS_BASE_URL must be a valid internal HTTP(S) base URL.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('BOT_TO_API_INGRESS_BASE_URL must be an HTTP(S) origin without credentials.');
  }

  if (
    nodeEnv === 'production' &&
    (parsed.protocol !== 'http:' || parsed.hostname !== 'api' || parsed.port !== '3000')
  ) {
    throw new Error(
      'Production BOT_TO_API_INGRESS_BASE_URL must be the private Docker API origin http://api:3000/.',
    );
  }

  return parsed.toString();
}

function requiredActionApiBaseUrl(value: string | undefined, nodeEnv: NodeEnvironment): string {
  if (!value) {
    throw new Error(
      'BOT_TO_API_ACTION_BASE_URL is required when INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED=true.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('BOT_TO_API_ACTION_BASE_URL must be a valid internal HTTP(S) base URL.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('BOT_TO_API_ACTION_BASE_URL must be an HTTP(S) origin without credentials.');
  }

  if (
    nodeEnv === 'production' &&
    (parsed.protocol !== 'http:' || parsed.hostname !== 'api' || parsed.port !== '3000')
  ) {
    throw new Error(
      'Production BOT_TO_API_ACTION_BASE_URL must be the private Docker API origin http://api:3000/.',
    );
  }

  return parsed.toString();
}

function loadBotTelegramActionChannelConfig(
  environment: NodeJS.ProcessEnv,
  nodeEnv: NodeEnvironment,
  telegramEnabled: boolean,
): BotTelegramActionChannelConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED,
    false,
    'INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      baseUrl: undefined,
      transportHmacSecret: undefined,
    };
  }

  if (!telegramEnabled) {
    throw new Error('INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED requires TELEGRAM_BOT_ENABLED=true.');
  }

  return {
    enabled: true,
    baseUrl: requiredActionApiBaseUrl(environment.BOT_TO_API_ACTION_BASE_URL, nodeEnv),
    transportHmacSecret: requiredHexHmacSecret(
      environment.BOT_TO_API_ACTION_HMAC_SECRET,
      'BOT_TO_API_ACTION_HMAC_SECRET',
    ),
  };
}

function assertDistinctBotTelegramTransportHmacSecrets(
  apiIngress: BotApiIngressConfig,
  telegramActionChannel: BotTelegramActionChannelConfig,
): void {
  if (!apiIngress.enabled || !telegramActionChannel.enabled) return;

  if (apiIngress.transportHmacSecret === telegramActionChannel.transportHmacSecret) {
    throw new Error(
      'BOT_TO_API_ACTION_HMAC_SECRET must be distinct from BOT_TO_API_INGRESS_HMAC_SECRET.',
    );
  }
}

export function loadBotConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
  const runtime = loadRuntimeConfig(environment);
  const enabled = booleanFromEnv(environment.TELEGRAM_BOT_ENABLED, false, 'TELEGRAM_BOT_ENABLED');
  const telegramActionChannel = loadBotTelegramActionChannelConfig(
    environment,
    runtime.nodeEnv,
    enabled,
  );

  if (!enabled) {
    return {
      ...runtime,
      telegram: {
        enabled: false,
        token: undefined,
      },
      apiIngress: {
        enabled: false,
        baseUrl: undefined,
        transportHmacSecret: undefined,
      },
      telegramActionChannel,
    };
  }

  const telegram: TelegramConfig = {
    enabled: true,
    token: requiredTelegramToken(environment.TELEGRAM_BOT_TOKEN),
  };
  const apiIngress: BotApiIngressConfig = {
    enabled: true,
    baseUrl: requiredInternalApiBaseUrl(environment.BOT_TO_API_INGRESS_BASE_URL, runtime.nodeEnv),
    transportHmacSecret: requiredHexHmacSecret(
      environment.BOT_TO_API_INGRESS_HMAC_SECRET,
      'BOT_TO_API_INGRESS_HMAC_SECRET',
    ),
  };
  assertDistinctBotTelegramTransportHmacSecrets(apiIngress, telegramActionChannel);

  return {
    ...runtime,
    telegram,
    apiIngress,
    telegramActionChannel,
  };
}

export function redactedBotConfigForLog(config: BotConfig): Omit<
  BotConfig,
  'telegram' | 'apiIngress' | 'telegramActionChannel'
> & {
  readonly telegram: { readonly enabled: boolean; readonly tokenConfigured: boolean };
  readonly apiIngress: { readonly enabled: boolean; readonly secretsConfigured: boolean };
  readonly telegramActionChannel: {
    readonly enabled: boolean;
    readonly secretsConfigured: boolean;
  };
} {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    telegram: {
      enabled: config.telegram.enabled,
      tokenConfigured: config.telegram.enabled,
    },
    apiIngress: {
      enabled: config.apiIngress.enabled,
      secretsConfigured: config.apiIngress.enabled,
    },
    telegramActionChannel: {
      enabled: config.telegramActionChannel.enabled,
      secretsConfigured: config.telegramActionChannel.enabled,
    },
  };
}
