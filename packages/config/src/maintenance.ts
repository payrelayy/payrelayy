import { booleanFromEnv, loadRuntimeConfig, type RuntimeConfig } from './shared.js';

const NONCE_RETENTION_RUNTIME_ROLE = 'fetanagent_nonce_retention_runtime';
const SUPABASE_PROJECT_REFERENCE_PATTERN = /^[a-z0-9]{20}$/;

/**
 * This controls only the manual maintenance database preflight. It does not create a database
 * connection during normal application startup, schedule a purge, or enable Telegram or payments.
 */
export type NonceRetentionMaintenanceRuntimeConfig =
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

export interface MaintenanceConfig extends RuntimeConfig {
  readonly nonceRetentionRuntime: NonceRetentionMaintenanceRuntimeConfig;
}

function decodeDatabaseUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(
      'NONCE_RETENTION_DATABASE_URL must contain valid percent-encoded connection components.',
    );
  }
}

function resolveNonceRetentionRuntimeUser(connectionUrl: URL): string {
  const user = decodeDatabaseUrlComponent(connectionUrl.username);
  if (user === NONCE_RETENTION_RUNTIME_ROLE) {
    return user;
  }

  const sessionPoolerPrefix = `${NONCE_RETENTION_RUNTIME_ROLE}.`;
  const sessionPoolerProjectReference = user.startsWith(sessionPoolerPrefix)
    ? user.slice(sessionPoolerPrefix.length)
    : undefined;
  if (
    connectionUrl.hostname.endsWith('.pooler.supabase.com') &&
    sessionPoolerProjectReference !== undefined &&
    SUPABASE_PROJECT_REFERENCE_PATTERN.test(sessionPoolerProjectReference)
  ) {
    return user;
  }

  throw new Error(
    'NONCE_RETENTION_DATABASE_URL must use the dedicated FetanAgent nonce-retention runtime login.',
  );
}

function loadNonceRetentionMaintenanceRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): NonceRetentionMaintenanceRuntimeConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED,
    false,
    'INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      connection: undefined,
      tlsMode: undefined,
    };
  }

  const connectionString = environment.NONCE_RETENTION_DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'NONCE_RETENTION_DATABASE_URL is required when INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED=true.',
    );
  }

  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error('NONCE_RETENTION_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (connectionUrl.protocol !== 'postgres:' && connectionUrl.protocol !== 'postgresql:') {
    throw new Error('NONCE_RETENTION_DATABASE_URL must use the postgres or postgresql protocol.');
  }

  if (
    connectionUrl.hostname === '' ||
    connectionUrl.username === '' ||
    connectionUrl.password === ''
  ) {
    throw new Error(
      'NONCE_RETENTION_DATABASE_URL must include a host and a dedicated runtime login password.',
    );
  }

  if (connectionUrl.port !== '' && connectionUrl.port !== '5432') {
    throw new Error(
      'NONCE_RETENTION_DATABASE_URL must use port 5432 for a direct or Supavisor session connection.',
    );
  }

  const queryKeys = Array.from(connectionUrl.searchParams.keys());
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    connectionUrl.searchParams.get('sslmode') !== 'verify-full' ||
    connectionUrl.hash !== ''
  ) {
    throw new Error('NONCE_RETENTION_DATABASE_URL must contain only sslmode=verify-full.');
  }

  const database = decodeDatabaseUrlComponent(connectionUrl.pathname.slice(1));
  if (database !== 'postgres') {
    throw new Error('NONCE_RETENTION_DATABASE_URL must target the FetanAgent PostgreSQL database.');
  }

  return {
    enabled: true,
    connection: {
      database: 'postgres',
      host: connectionUrl.hostname,
      password: decodeDatabaseUrlComponent(connectionUrl.password),
      port: 5432,
      user: resolveNonceRetentionRuntimeUser(connectionUrl),
    },
    tlsMode: 'verify-full',
  };
}

export function loadMaintenanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MaintenanceConfig {
  return {
    ...loadRuntimeConfig(environment),
    nonceRetentionRuntime: loadNonceRetentionMaintenanceRuntimeConfig(environment),
  };
}

export function redactedMaintenanceConfigForLog(config: MaintenanceConfig): RuntimeConfig & {
  readonly nonceRetentionRuntime: {
    readonly enabled: boolean;
    readonly connectionConfigured: boolean;
    readonly tlsMode: 'verify-full' | undefined;
  };
} {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    nonceRetentionRuntime: {
      enabled: config.nonceRetentionRuntime.enabled,
      connectionConfigured: config.nonceRetentionRuntime.enabled,
      tlsMode: config.nonceRetentionRuntime.tlsMode,
    },
  };
}
