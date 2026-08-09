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
 * This is the final, explicit API runtime gate for the private Telegram ingress database
 * composition. It cannot enable PostgreSQL, the transport route, bot polling, Player-ID actions,
 * payment verification, or financial actions by itself.
 */
export type ApiTelegramPrivateIngressRuntimeConfig =
  | {
      readonly enabled: false;
    }
  | {
      readonly enabled: true;
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

/**
 * Reserves a distinct action-transport key for a later private route. This configuration alone
 * cannot compose a Fastify route, create a database pool, dispatch an action, start bot polling,
 * or make a Player-ID, payment, or KemerBet request.
 */
export type ApiTelegramActionChannelConfig =
  | {
      readonly enabled: false;
      readonly transportHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly transportHmacSecret: string;
    };

/**
 * This is an explicit operator-only gate for the API database preflight. By itself, enabling it
 * never enables a Fastify route, Telegram polling, Player-ID processing, or financial action.
 * The separate private Telegram ingress runtime gate must also be enabled before composition.
 */
export type ApiPostgresRuntimeConfig =
  | {
      readonly enabled: false;
      readonly connection: undefined;
      readonly tlsMode: undefined;
    }
  | {
      readonly enabled: true;
      readonly connection: {
        readonly database: 'postgres';
        readonly host: string;
        readonly password: string;
        readonly port: 5432;
        readonly user: string;
      };
      readonly tlsMode: 'verify-full';
    };

export interface ApiConfig extends RuntimeConfig {
  readonly financialActionsMode: FinancialActionsMode;
  readonly api: {
    readonly host: string;
    readonly port: number;
  };
  readonly postgresRuntime: ApiPostgresRuntimeConfig;
  readonly telegramIngress: ApiTelegramIngressConfig;
  readonly telegramPrivateIngressRuntime: ApiTelegramPrivateIngressRuntimeConfig;
  readonly telegramActionCapability: ApiTelegramActionCapabilityConfig;
  readonly telegramActionChannel: ApiTelegramActionChannelConfig;
}

function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return 3000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`API_PORT must be an integer from 1 to 65535, received '${value}'.`);
  }
  return parsed;
}

const API_DATABASE_RUNTIME_ROLE = 'payreplayy_api_runtime';
const PAYREPLAYY_SUPABASE_PROJECT_REFERENCE = 'xzztugbgtulptnbpoelr';
const API_DATABASE_DIRECT_HOST = `db.${PAYREPLAYY_SUPABASE_PROJECT_REFERENCE}.supabase.co`;
const API_DATABASE_SESSION_POOLER_HOST = 'aws-0-eu-west-1.pooler.supabase.com';
const API_DATABASE_SESSION_POOLER_USER = `${API_DATABASE_RUNTIME_ROLE}.${PAYREPLAYY_SUPABASE_PROJECT_REFERENCE}`;

function decodeDatabaseUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('DATABASE_URL must contain valid percent-encoded connection components.');
  }
}

function resolveApiDatabaseRuntimeUser(connectionUrl: URL): string {
  const user = decodeDatabaseUrlComponent(connectionUrl.username);
  if (connectionUrl.hostname === API_DATABASE_DIRECT_HOST && user === API_DATABASE_RUNTIME_ROLE) {
    return user;
  }

  if (
    connectionUrl.hostname === API_DATABASE_SESSION_POOLER_HOST &&
    user === API_DATABASE_SESSION_POOLER_USER
  ) {
    return user;
  }

  throw new Error(
    'DATABASE_URL must use the dedicated PayReplayy API runtime login and approved project host.',
  );
}

function loadApiPostgresRuntimeConfig(environment: NodeJS.ProcessEnv): ApiPostgresRuntimeConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_POSTGRES_RUNTIME_ENABLED,
    false,
    'INTERNAL_POSTGRES_RUNTIME_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      connection: undefined,
      tlsMode: undefined,
    };
  }

  const connectionString = environment.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is required when INTERNAL_POSTGRES_RUNTIME_ENABLED=true.');
  }

  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (connectionUrl.protocol !== 'postgres:' && connectionUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }

  if (
    connectionUrl.hostname === '' ||
    connectionUrl.username === '' ||
    connectionUrl.password === ''
  ) {
    throw new Error('DATABASE_URL must include a host and a dedicated runtime login password.');
  }

  if (connectionUrl.port !== '' && connectionUrl.port !== '5432') {
    throw new Error(
      'DATABASE_URL must use port 5432 for a direct or Supavisor session connection.',
    );
  }

  const queryKeys = Array.from(connectionUrl.searchParams.keys());
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    connectionUrl.searchParams.get('sslmode') !== 'verify-full' ||
    connectionUrl.hash !== ''
  ) {
    throw new Error('DATABASE_URL must contain only sslmode=verify-full.');
  }

  const database = decodeDatabaseUrlComponent(connectionUrl.pathname.slice(1));
  if (database !== 'postgres') {
    throw new Error('DATABASE_URL must target the PayReplayy PostgreSQL database.');
  }

  return {
    enabled: true,
    connection: {
      database: 'postgres',
      host: connectionUrl.hostname,
      password: decodeDatabaseUrlComponent(connectionUrl.password),
      port: 5432,
      user: resolveApiDatabaseRuntimeUser(connectionUrl),
    },
    tlsMode: 'verify-full',
  };
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

function loadApiTelegramPrivateIngressRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  postgresRuntime: ApiPostgresRuntimeConfig,
  telegramIngress: ApiTelegramIngressConfig,
): ApiTelegramPrivateIngressRuntimeConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED,
    false,
    'INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED',
  );

  if (!enabled) return { enabled: false };

  if (!postgresRuntime.enabled) {
    throw new Error(
      'INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED requires INTERNAL_POSTGRES_RUNTIME_ENABLED=true.',
    );
  }
  if (!telegramIngress.enabled) {
    throw new Error(
      'INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED requires INTERNAL_TELEGRAM_INGRESS_ENABLED=true.',
    );
  }

  return { enabled: true };
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

function loadApiTelegramActionChannelConfig(
  environment: NodeJS.ProcessEnv,
): ApiTelegramActionChannelConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED,
    false,
    'INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      transportHmacSecret: undefined,
    };
  }

  return {
    enabled: true,
    transportHmacSecret: requiredHexHmacSecret(
      environment.BOT_TO_API_ACTION_HMAC_SECRET,
      'BOT_TO_API_ACTION_HMAC_SECRET',
    ),
  };
}

function assertDistinctApiTelegramHmacSecrets(
  telegramIngress: ApiTelegramIngressConfig,
  telegramActionCapability: ApiTelegramActionCapabilityConfig,
  telegramActionChannel: ApiTelegramActionChannelConfig,
): void {
  if (!telegramActionCapability.enabled && !telegramActionChannel.enabled) return;

  const namedSecrets: (readonly [string, string])[] = [];

  if (telegramActionCapability.enabled) {
    namedSecrets.push(
      ['API_TELEGRAM_CAPABILITY_HMAC_SECRET', telegramActionCapability.capabilityHmacSecret],
      ['API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET', telegramActionCapability.semanticHmacSecret],
    );
  }

  if (telegramActionChannel.enabled) {
    namedSecrets.push(['BOT_TO_API_ACTION_HMAC_SECRET', telegramActionChannel.transportHmacSecret]);
  }

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
  const postgresRuntime = loadApiPostgresRuntimeConfig(environment);
  const telegramIngress = loadApiTelegramIngressConfig(environment);
  const telegramPrivateIngressRuntime = loadApiTelegramPrivateIngressRuntimeConfig(
    environment,
    postgresRuntime,
    telegramIngress,
  );
  const telegramActionCapability = loadApiTelegramActionCapabilityConfig(environment);
  const telegramActionChannel = loadApiTelegramActionChannelConfig(environment);
  assertDistinctApiTelegramHmacSecrets(
    telegramIngress,
    telegramActionCapability,
    telegramActionChannel,
  );

  return {
    ...loadRuntimeConfig(environment),
    financialActionsMode: loadFinancialActionsMode(environment),
    api: {
      host: environment.API_HOST ?? '127.0.0.1',
      port: portFromEnv(environment.API_PORT),
    },
    postgresRuntime,
    telegramIngress,
    telegramPrivateIngressRuntime,
    telegramActionCapability,
    telegramActionChannel,
  };
}

export function redactedApiConfigForLog(config: ApiConfig): Omit<
  ApiConfig,
  | 'postgresRuntime'
  | 'telegramIngress'
  | 'telegramPrivateIngressRuntime'
  | 'telegramActionCapability'
  | 'telegramActionChannel'
> & {
  readonly postgresRuntime: {
    readonly enabled: boolean;
    readonly connectionConfigured: boolean;
    readonly tlsMode: 'verify-full' | undefined;
  };
  readonly telegramIngress: { readonly enabled: boolean; readonly secretsConfigured: boolean };
  readonly telegramPrivateIngressRuntime: { readonly enabled: boolean };
  readonly telegramActionCapability: {
    readonly enabled: boolean;
    readonly secretsConfigured: boolean;
  };
  readonly telegramActionChannel: {
    readonly enabled: boolean;
    readonly secretsConfigured: boolean;
  };
} {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    financialActionsMode: config.financialActionsMode,
    api: config.api,
    postgresRuntime: {
      enabled: config.postgresRuntime.enabled,
      connectionConfigured: config.postgresRuntime.enabled,
      tlsMode: config.postgresRuntime.tlsMode,
    },
    telegramIngress: {
      enabled: config.telegramIngress.enabled,
      secretsConfigured: config.telegramIngress.enabled,
    },
    telegramPrivateIngressRuntime: {
      enabled: config.telegramPrivateIngressRuntime.enabled,
    },
    telegramActionCapability: {
      enabled: config.telegramActionCapability.enabled,
      secretsConfigured: config.telegramActionCapability.enabled,
    },
    telegramActionChannel: {
      enabled: config.telegramActionChannel.enabled,
      secretsConfigured: config.telegramActionChannel.enabled,
    },
  };
}
