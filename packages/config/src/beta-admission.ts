import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import {
  booleanFromEnv,
  loadRuntimeConfig,
  requiredHexHmacSecret,
  type RuntimeConfig,
} from './shared.js';

export const FETANAGENT_STAGING_SUPABASE_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl';
export const BETA_ADMISSION_DATABASE_RUNTIME_ROLE = 'fetanagent_beta_admission_runtime';

export const BETA_ADMISSION_DATABASE_DIRECT_HOST = `db.${FETANAGENT_STAGING_SUPABASE_PROJECT_REFERENCE}.supabase.co`;
const PRODUCTION_SECRET_FILE_PATHS: Readonly<Record<string, string>> = {
  BETA_ADMISSION_DATABASE_URL: '/run/secrets/beta_admission_database_url',
  BOT_TO_BETA_ADMISSION_HMAC_SECRET: '/run/secrets/beta_admission_bot_transport_hmac',
  BETA_ADMISSION_PAYLOAD_HMAC_SECRET: '/run/secrets/beta_admission_payload_hmac',
};

export interface BetaAdmissionDatabaseConnection {
  readonly database: 'postgres';
  readonly host: string;
  readonly password: string;
  readonly port: 5432;
  readonly user: string;
}

export type BetaAdmissionRuntimeConfig =
  | {
      readonly enabled: false;
      readonly stage: undefined;
      readonly projectReference: undefined;
      readonly connection: undefined;
      readonly tlsMode: undefined;
      readonly transportHmacSecret: undefined;
      readonly payloadHmacSecret: undefined;
    }
  | {
      readonly enabled: true;
      readonly stage: 'staging';
      readonly projectReference: typeof FETANAGENT_STAGING_SUPABASE_PROJECT_REFERENCE;
      readonly connection: BetaAdmissionDatabaseConnection;
      readonly tlsMode: 'verify-full';
      readonly transportHmacSecret: string;
      readonly payloadHmacSecret: string;
    };

export interface BetaAdmissionConfig extends RuntimeConfig {
  readonly server: {
    readonly host: string;
    readonly port: number;
  };
  readonly runtime: BetaAdmissionRuntimeConfig;
}

export interface BetaAdmissionConfigDependencies {
  readonly readSecretFile?: (path: string) => string;
}

function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return 3001;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`BETA_ADMISSION_PORT must be an integer from 1 to 65535; received '${value}'.`);
  }
  return parsed;
}

function secretFromEnvironmentOrFile(
  environment: NodeJS.ProcessEnv,
  variableName: string,
  dependencies: BetaAdmissionConfigDependencies,
): string | undefined {
  const directValue = environment[variableName];
  const fileVariableName = `${variableName}_FILE`;
  const filePath = environment[fileVariableName];

  if (environment.NODE_ENV === 'production') {
    if (directValue) {
      throw new Error(`${fileVariableName} is required in the production staging container.`);
    }
    if (filePath && filePath !== PRODUCTION_SECRET_FILE_PATHS[variableName]) {
      throw new Error(`${fileVariableName} must use the approved private runtime secret path.`);
    }
  }

  if (directValue && filePath) {
    throw new Error(`${variableName} and ${fileVariableName} must not both be configured.`);
  }
  if (directValue) return directValue;
  if (!filePath) return undefined;
  if (!posix.isAbsolute(filePath) && !win32.isAbsolute(filePath)) {
    throw new Error(`${fileVariableName} must be an absolute path.`);
  }

  let value: string;
  try {
    value = (dependencies.readSecretFile ?? ((path) => readFileSync(path, 'utf8')))(filePath);
  } catch {
    throw new Error(`${fileVariableName} could not be read.`);
  }

  const withoutOneTerminalNewline = value.replace(/\r?\n$/, '');
  if (withoutOneTerminalNewline === '' || /[\r\n]/.test(withoutOneTerminalNewline)) {
    throw new Error(`${fileVariableName} must contain exactly one secret value.`);
  }
  return withoutOneTerminalNewline;
}

function decodeDatabaseUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(
      'BETA_ADMISSION_DATABASE_URL must contain valid percent-encoded connection components.',
    );
  }
}

function resolveRuntimeUser(connectionUrl: URL): string {
  const user = decodeDatabaseUrlComponent(connectionUrl.username);
  if (
    connectionUrl.hostname === BETA_ADMISSION_DATABASE_DIRECT_HOST &&
    user === BETA_ADMISSION_DATABASE_RUNTIME_ROLE
  ) {
    return user;
  }

  throw new Error(
    'BETA_ADMISSION_DATABASE_URL must use the dedicated staging beta-admission runtime login through the exact IPv6 direct database endpoint.',
  );
}

function parseDatabaseConnection(connectionString: string): BetaAdmissionDatabaseConnection {
  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error('BETA_ADMISSION_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (connectionUrl.protocol !== 'postgres:' && connectionUrl.protocol !== 'postgresql:') {
    throw new Error('BETA_ADMISSION_DATABASE_URL must use the postgres or postgresql protocol.');
  }
  if (
    connectionUrl.hostname === '' ||
    connectionUrl.username === '' ||
    connectionUrl.password === ''
  ) {
    throw new Error(
      'BETA_ADMISSION_DATABASE_URL must include a host and dedicated runtime login password.',
    );
  }
  if (connectionUrl.port !== '' && connectionUrl.port !== '5432') {
    throw new Error('BETA_ADMISSION_DATABASE_URL must use direct database port 5432.');
  }

  const queryKeys = Array.from(connectionUrl.searchParams.keys());
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    connectionUrl.searchParams.get('sslmode') !== 'verify-full' ||
    connectionUrl.hash !== ''
  ) {
    throw new Error('BETA_ADMISSION_DATABASE_URL must contain only sslmode=verify-full.');
  }

  const database = decodeDatabaseUrlComponent(connectionUrl.pathname.slice(1));
  if (database !== 'postgres') {
    throw new Error('BETA_ADMISSION_DATABASE_URL must target the postgres database.');
  }

  return {
    database: 'postgres',
    host: connectionUrl.hostname,
    password: decodeDatabaseUrlComponent(connectionUrl.password),
    port: 5432,
    user: resolveRuntimeUser(connectionUrl),
  };
}

/**
 * Loads the dedicated invite-redemption service configuration. The single runtime gate is the
 * only path that reads database or HMAC material. Its database URL is pinned to the staging
 * project and cannot be repointed to production by configuration.
 */
export function loadBetaAdmissionConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: BetaAdmissionConfigDependencies = {},
): BetaAdmissionConfig {
  const common = {
    ...loadRuntimeConfig(environment),
    server: {
      host: environment.BETA_ADMISSION_HOST ?? '127.0.0.1',
      port: portFromEnv(environment.BETA_ADMISSION_PORT),
    },
  };
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED,
    false,
    'INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED',
  );

  if (!enabled) {
    return {
      ...common,
      runtime: {
        enabled: false,
        stage: undefined,
        projectReference: undefined,
        connection: undefined,
        tlsMode: undefined,
        transportHmacSecret: undefined,
        payloadHmacSecret: undefined,
      },
    };
  }

  const databaseUrl = secretFromEnvironmentOrFile(
    environment,
    'BETA_ADMISSION_DATABASE_URL',
    dependencies,
  );
  if (!databaseUrl) {
    throw new Error(
      'BETA_ADMISSION_DATABASE_URL is required when the beta-admission runtime is enabled.',
    );
  }
  const transportHmacSecret = requiredHexHmacSecret(
    secretFromEnvironmentOrFile(environment, 'BOT_TO_BETA_ADMISSION_HMAC_SECRET', dependencies),
    'BOT_TO_BETA_ADMISSION_HMAC_SECRET',
  );
  const payloadHmacSecret = requiredHexHmacSecret(
    secretFromEnvironmentOrFile(environment, 'BETA_ADMISSION_PAYLOAD_HMAC_SECRET', dependencies),
    'BETA_ADMISSION_PAYLOAD_HMAC_SECRET',
  );
  if (transportHmacSecret === payloadHmacSecret) {
    throw new Error(
      'BOT_TO_BETA_ADMISSION_HMAC_SECRET must be distinct from BETA_ADMISSION_PAYLOAD_HMAC_SECRET.',
    );
  }

  return {
    ...common,
    runtime: {
      enabled: true,
      stage: 'staging',
      projectReference: FETANAGENT_STAGING_SUPABASE_PROJECT_REFERENCE,
      connection: parseDatabaseConnection(databaseUrl),
      tlsMode: 'verify-full',
      transportHmacSecret,
      payloadHmacSecret,
    },
  };
}

export function redactedBetaAdmissionConfigForLog(config: BetaAdmissionConfig) {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    server: config.server,
    runtime: {
      enabled: config.runtime.enabled,
      stage: config.runtime.stage,
      projectReference: config.runtime.projectReference,
      connectionConfigured: config.runtime.enabled,
      tlsMode: config.runtime.tlsMode,
      secretsConfigured: config.runtime.enabled,
    },
  } as const;
}
