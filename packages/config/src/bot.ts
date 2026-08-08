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

export interface BotConfig extends RuntimeConfig {
  readonly telegram: TelegramConfig;
  readonly apiIngress: BotApiIngressConfig;
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
      apiIngress: {
        enabled: false,
        baseUrl: undefined,
        transportHmacSecret: undefined,
      },
    };
  }

  return {
    ...runtime,
    telegram: {
      enabled: true,
      token: requiredTelegramToken(environment.TELEGRAM_BOT_TOKEN),
    },
    apiIngress: {
      enabled: true,
      baseUrl: requiredInternalApiBaseUrl(environment.BOT_TO_API_INGRESS_BASE_URL, runtime.nodeEnv),
      transportHmacSecret: requiredHexHmacSecret(
        environment.BOT_TO_API_INGRESS_HMAC_SECRET,
        'BOT_TO_API_INGRESS_HMAC_SECRET',
      ),
    },
  };
}

export function redactedBotConfigForLog(config: BotConfig): Omit<
  BotConfig,
  'telegram' | 'apiIngress'
> & {
  readonly telegram: { readonly enabled: boolean; readonly tokenConfigured: boolean };
  readonly apiIngress: { readonly enabled: boolean; readonly secretsConfigured: boolean };
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
  };
}
