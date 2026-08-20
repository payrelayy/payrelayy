import { readFileSync } from 'node:fs';

import type { FinancialActionsMode } from '@fetanagent/domain';

import {
  booleanFromEnv,
  loadFinancialActionsMode,
  loadRuntimeConfig,
  requiredHexHmacSecret,
  type RuntimeConfig,
} from './shared.js';
import {
  CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE,
  CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE,
  loadAndVerifyCbeDepositReferenceKeyProfile,
} from './deposit-reference-profile.js';
import {
  DEPOSIT_PROOF_REFERENCE_PRODUCTION_ENCRYPTION_MASTER_SECRET_FILE,
  DEPOSIT_PROOF_REFERENCE_PRODUCTION_FINGERPRINT_MASTER_SECRET_FILE,
  loadAndVerifyDepositProofReferenceProfile,
} from './deposit-proof-reference-profile.js';

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

export type ApiTelegramPlayerActionRuntimeConfig =
  | {
      readonly enabled: false;
      readonly connection: undefined;
      readonly payloadHmacSecret: undefined;
      readonly depositReferenceEncryptionSecret: undefined;
      readonly depositReferenceFingerprintSecret: undefined;
      readonly depositReferenceKeyProfileVersion: undefined;
      readonly depositProofReferenceEncryptionMasterSecret: undefined;
      readonly depositProofReferenceFingerprintMasterSecret: undefined;
      readonly depositProofReferenceProfileVersion: undefined;
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
      readonly payloadHmacSecret: string;
      readonly depositReferenceEncryptionSecret: string;
      readonly depositReferenceFingerprintSecret: string;
      readonly depositReferenceKeyProfileVersion: 1;
      readonly depositProofReferenceEncryptionMasterSecret: string;
      readonly depositProofReferenceFingerprintMasterSecret: string;
      readonly depositProofReferenceProfileVersion: 2;
      readonly tlsMode: 'verify-full';
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
  readonly telegramPlayerActionRuntime: ApiTelegramPlayerActionRuntimeConfig;
}

function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return 3000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`API_PORT must be an integer from 1 to 65535, received '${value}'.`);
  }
  return parsed;
}

const API_DATABASE_RUNTIME_ROLE = 'fetanagent_api_runtime';
const FETANAGENT_SUPABASE_PROJECT_REFERENCE = 'xzztugbgtulptnbpoelr';
const API_DATABASE_DIRECT_HOST = `db.${FETANAGENT_SUPABASE_PROJECT_REFERENCE}.supabase.co`;
const API_DATABASE_SESSION_POOLER_HOST = 'aws-0-eu-west-1.pooler.supabase.com';
const API_DATABASE_SESSION_POOLER_USER = `${API_DATABASE_RUNTIME_ROLE}.${FETANAGENT_SUPABASE_PROJECT_REFERENCE}`;
const PLAYER_ACTION_DATABASE_RUNTIME_ROLE = 'fetanagent_player_actions_runtime';
const PLAYER_ACTION_STAGING_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl';
const PLAYER_ACTION_DATABASE_DIRECT_HOST = `db.${PLAYER_ACTION_STAGING_PROJECT_REFERENCE}.supabase.co`;

function secretFromEnvironmentOrFile(
  value: string | undefined,
  filePath: string | undefined,
  valueVariableName: string,
  fileVariableName: string,
  productionFilePath: string,
  nodeEnv: ApiConfig['nodeEnv'],
): string | undefined {
  const hasValue = value !== undefined && value !== '';
  const hasFile = filePath !== undefined && filePath !== '';
  if (hasValue && hasFile) {
    throw new Error(`${valueVariableName} and ${fileVariableName} are mutually exclusive.`);
  }
  if (hasValue) return value;
  if (!hasFile) return undefined;
  if (nodeEnv === 'production' && filePath !== productionFilePath) {
    throw new Error(`${fileVariableName} must use the approved private runtime secret path.`);
  }

  let secret: string;
  try {
    secret = readFileSync(filePath, 'utf8').replace(/\r?\n$/u, '');
  } catch {
    throw new Error(`${fileVariableName} could not be read.`);
  }
  if (!secret || /[\r\n]/u.test(secret)) {
    throw new Error(`${fileVariableName} must contain exactly one non-empty secret value.`);
  }
  return secret;
}

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
    'DATABASE_URL must use the dedicated FetanAgent API runtime login and approved project host.',
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
    throw new Error('DATABASE_URL must target the FetanAgent PostgreSQL database.');
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
  nodeEnv: ApiConfig['nodeEnv'],
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
      secretFromEnvironmentOrFile(
        environment.API_TELEGRAM_CAPABILITY_HMAC_SECRET,
        environment.API_TELEGRAM_CAPABILITY_HMAC_SECRET_FILE,
        'API_TELEGRAM_CAPABILITY_HMAC_SECRET',
        'API_TELEGRAM_CAPABILITY_HMAC_SECRET_FILE',
        '/run/secrets/api_player_action_capability_hmac',
        nodeEnv,
      ),
      'API_TELEGRAM_CAPABILITY_HMAC_SECRET',
    ),
    semanticHmacSecret: requiredHexHmacSecret(
      secretFromEnvironmentOrFile(
        environment.API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET,
        environment.API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET_FILE,
        'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET',
        'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET_FILE',
        '/run/secrets/api_player_action_semantic_hmac',
        nodeEnv,
      ),
      'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET',
    ),
  };
}

function loadApiTelegramActionChannelConfig(
  environment: NodeJS.ProcessEnv,
  nodeEnv: ApiConfig['nodeEnv'],
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
      secretFromEnvironmentOrFile(
        environment.BOT_TO_API_ACTION_HMAC_SECRET,
        environment.BOT_TO_API_ACTION_HMAC_SECRET_FILE,
        'BOT_TO_API_ACTION_HMAC_SECRET',
        'BOT_TO_API_ACTION_HMAC_SECRET_FILE',
        '/run/secrets/api_player_action_transport_hmac',
        nodeEnv,
      ),
      'BOT_TO_API_ACTION_HMAC_SECRET',
    ),
  };
}

function resolvePlayerActionDatabaseRuntimeUser(connectionUrl: URL): string {
  const user = decodeDatabaseUrlComponent(connectionUrl.username);
  if (
    connectionUrl.hostname === PLAYER_ACTION_DATABASE_DIRECT_HOST &&
    user === PLAYER_ACTION_DATABASE_RUNTIME_ROLE
  ) {
    return user;
  }
  throw new Error(
    'PLAYER_ACTION_DATABASE_URL must use the dedicated staging Player-ID action runtime login through the exact IPv6 direct database endpoint.',
  );
}

function loadApiTelegramPlayerActionRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  nodeEnv: ApiConfig['nodeEnv'],
  actionChannel: ApiTelegramActionChannelConfig,
  capability: ApiTelegramActionCapabilityConfig,
): ApiTelegramPlayerActionRuntimeConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED,
    false,
    'INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED',
  );
  if (!enabled) {
    return {
      enabled: false,
      connection: undefined,
      payloadHmacSecret: undefined,
      depositReferenceEncryptionSecret: undefined,
      depositReferenceFingerprintSecret: undefined,
      depositReferenceKeyProfileVersion: undefined,
      depositProofReferenceEncryptionMasterSecret: undefined,
      depositProofReferenceFingerprintMasterSecret: undefined,
      depositProofReferenceProfileVersion: undefined,
      tlsMode: undefined,
    };
  }
  if (!actionChannel.enabled || !capability.enabled) {
    throw new Error(
      'INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED requires the action channel and capability contract gates.',
    );
  }

  const connectionString = secretFromEnvironmentOrFile(
    environment.PLAYER_ACTION_DATABASE_URL,
    environment.PLAYER_ACTION_DATABASE_URL_FILE,
    'PLAYER_ACTION_DATABASE_URL',
    'PLAYER_ACTION_DATABASE_URL_FILE',
    '/run/secrets/player_action_database_url',
    nodeEnv,
  );
  if (!connectionString) {
    throw new Error(
      'PLAYER_ACTION_DATABASE_URL is required when INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED=true.',
    );
  }

  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error('PLAYER_ACTION_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (
    (connectionUrl.protocol !== 'postgres:' && connectionUrl.protocol !== 'postgresql:') ||
    connectionUrl.hostname === '' ||
    connectionUrl.username === '' ||
    connectionUrl.password === '' ||
    (connectionUrl.port !== '' && connectionUrl.port !== '5432') ||
    decodeDatabaseUrlComponent(connectionUrl.pathname.slice(1)) !== 'postgres' ||
    connectionUrl.hash !== ''
  ) {
    throw new Error('PLAYER_ACTION_DATABASE_URL must be a complete port-5432 PostgreSQL URL.');
  }
  const queryKeys = Array.from(connectionUrl.searchParams.keys());
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    connectionUrl.searchParams.get('sslmode') !== 'verify-full'
  ) {
    throw new Error('PLAYER_ACTION_DATABASE_URL must contain only sslmode=verify-full.');
  }

  if (
    nodeEnv === 'production' &&
    (environment.CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET !== undefined ||
      environment.CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET !== undefined ||
      environment.CBE_DEPOSIT_REFERENCE_KEY_PROFILE !== undefined ||
      environment.DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET !== undefined ||
      environment.DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET !== undefined ||
      environment.DEPOSIT_PROOF_REFERENCE_PROFILE !== undefined)
  ) {
    throw new Error(
      'Deposit-reference roots and profiles must use their fixed versioned files in production.',
    );
  }

  const depositReferenceEncryptionSecret = requiredHexHmacSecret(
    secretFromEnvironmentOrFile(
      environment.CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET,
      environment.CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE,
      'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET',
      'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE',
      CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE,
      nodeEnv,
    ),
    'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET',
  );
  const depositReferenceFingerprintSecret = requiredHexHmacSecret(
    secretFromEnvironmentOrFile(
      environment.CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET,
      environment.CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE,
      'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET',
      'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE',
      CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE,
      nodeEnv,
    ),
    'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET',
  );
  const depositReferenceKeyProfile = loadAndVerifyCbeDepositReferenceKeyProfile(
    environment,
    nodeEnv,
    {
      encryptionSecret: depositReferenceEncryptionSecret,
      fingerprintSecret: depositReferenceFingerprintSecret,
    },
  );
  const depositProofReferenceEncryptionMasterSecret = requiredHexHmacSecret(
    secretFromEnvironmentOrFile(
      environment.DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET,
      environment.DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE,
      'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
      'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
      DEPOSIT_PROOF_REFERENCE_PRODUCTION_ENCRYPTION_MASTER_SECRET_FILE,
      nodeEnv,
    ),
    'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
  );
  const depositProofReferenceFingerprintMasterSecret = requiredHexHmacSecret(
    secretFromEnvironmentOrFile(
      environment.DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET,
      environment.DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE,
      'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
      'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE',
      DEPOSIT_PROOF_REFERENCE_PRODUCTION_FINGERPRINT_MASTER_SECRET_FILE,
      nodeEnv,
    ),
    'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
  );
  const depositProofReferenceProfile = loadAndVerifyDepositProofReferenceProfile(
    environment,
    nodeEnv,
    {
      encryptionMasterSecret: depositProofReferenceEncryptionMasterSecret,
      fingerprintMasterSecret: depositProofReferenceFingerprintMasterSecret,
    },
  );

  return {
    enabled: true,
    connection: {
      database: 'postgres',
      host: connectionUrl.hostname,
      password: decodeDatabaseUrlComponent(connectionUrl.password),
      port: 5432,
      user: resolvePlayerActionDatabaseRuntimeUser(connectionUrl),
    },
    payloadHmacSecret: requiredHexHmacSecret(
      secretFromEnvironmentOrFile(
        environment.API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET,
        environment.API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET_FILE,
        'API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET',
        'API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET_FILE',
        '/run/secrets/api_player_action_payload_hmac',
        nodeEnv,
      ),
      'API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET',
    ),
    depositReferenceEncryptionSecret,
    depositReferenceFingerprintSecret,
    depositReferenceKeyProfileVersion: depositReferenceKeyProfile.version,
    depositProofReferenceEncryptionMasterSecret,
    depositProofReferenceFingerprintMasterSecret,
    depositProofReferenceProfileVersion: depositProofReferenceProfile.version,
    tlsMode: 'verify-full',
  };
}

function assertDistinctApiTelegramHmacSecrets(
  telegramIngress: ApiTelegramIngressConfig,
  telegramActionCapability: ApiTelegramActionCapabilityConfig,
  telegramActionChannel: ApiTelegramActionChannelConfig,
  telegramPlayerActionRuntime: ApiTelegramPlayerActionRuntimeConfig,
): void {
  if (
    !telegramActionCapability.enabled &&
    !telegramActionChannel.enabled &&
    !telegramPlayerActionRuntime.enabled
  ) {
    return;
  }

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

  if (telegramPlayerActionRuntime.enabled) {
    namedSecrets.push(
      [
        'API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET',
        telegramPlayerActionRuntime.payloadHmacSecret,
      ],
      [
        'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET',
        telegramPlayerActionRuntime.depositReferenceEncryptionSecret,
      ],
      [
        'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET',
        telegramPlayerActionRuntime.depositReferenceFingerprintSecret,
      ],
      [
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
        telegramPlayerActionRuntime.depositProofReferenceEncryptionMasterSecret,
      ],
      [
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
        telegramPlayerActionRuntime.depositProofReferenceFingerprintMasterSecret,
      ],
    );
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
  const runtime = loadRuntimeConfig(environment);
  const postgresRuntime = loadApiPostgresRuntimeConfig(environment);
  const telegramIngress = loadApiTelegramIngressConfig(environment);
  const telegramPrivateIngressRuntime = loadApiTelegramPrivateIngressRuntimeConfig(
    environment,
    postgresRuntime,
    telegramIngress,
  );
  const telegramActionCapability = loadApiTelegramActionCapabilityConfig(
    environment,
    runtime.nodeEnv,
  );
  const telegramActionChannel = loadApiTelegramActionChannelConfig(environment, runtime.nodeEnv);
  const telegramPlayerActionRuntime = loadApiTelegramPlayerActionRuntimeConfig(
    environment,
    runtime.nodeEnv,
    telegramActionChannel,
    telegramActionCapability,
  );
  assertDistinctApiTelegramHmacSecrets(
    telegramIngress,
    telegramActionCapability,
    telegramActionChannel,
    telegramPlayerActionRuntime,
  );

  return {
    ...runtime,
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
    telegramPlayerActionRuntime,
  };
}

export function redactedApiConfigForLog(config: ApiConfig): Omit<
  ApiConfig,
  | 'postgresRuntime'
  | 'telegramIngress'
  | 'telegramPrivateIngressRuntime'
  | 'telegramActionCapability'
  | 'telegramActionChannel'
  | 'telegramPlayerActionRuntime'
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
  readonly telegramPlayerActionRuntime: {
    readonly enabled: boolean;
    readonly connectionConfigured: boolean;
    readonly depositReferenceKeysConfigured: boolean;
    readonly depositReferenceKeyProfileVersion: 1 | undefined;
    readonly depositProofReferenceMastersConfigured: boolean;
    readonly depositProofReferenceProfileVersion: 2 | undefined;
    readonly payloadHmacConfigured: boolean;
    readonly tlsMode: 'verify-full' | undefined;
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
    telegramPlayerActionRuntime: {
      enabled: config.telegramPlayerActionRuntime.enabled,
      connectionConfigured: config.telegramPlayerActionRuntime.enabled,
      depositReferenceKeysConfigured: config.telegramPlayerActionRuntime.enabled,
      depositReferenceKeyProfileVersion:
        config.telegramPlayerActionRuntime.depositReferenceKeyProfileVersion,
      depositProofReferenceMastersConfigured: config.telegramPlayerActionRuntime.enabled,
      depositProofReferenceProfileVersion:
        config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
      payloadHmacConfigured: config.telegramPlayerActionRuntime.enabled,
      tlsMode: config.telegramPlayerActionRuntime.tlsMode,
    },
  };
}
