import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import { booleanFromEnv } from './shared.js';

export const CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl' as const;
export const CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN =
  `https://${CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE}.supabase.co` as const;
export const CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL =
  'https://fetanagent.com/auth/recovery' as const;
export const CUSTOMER_WEB_DATABASE_RUNTIME_ROLE = 'fetanagent_customer_web_runtime' as const;
export const CUSTOMER_WEB_DATABASE_DIRECT_HOST =
  `db.${CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE}.supabase.co` as const;
export const CUSTOMER_WEB_PRODUCTION_DATABASE_URL_SECRET_FILE =
  '/run/secrets/customer_web_database_url' as const;

export type CustomerWebAuthConfig =
  | {
      readonly enabled: false;
      readonly passwordRecoveryRedirectUrl: typeof CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL;
      readonly supabasePublishableKey: undefined;
      readonly supabaseUrl: undefined;
    }
  | {
      readonly enabled: true;
      readonly passwordRecoveryRedirectUrl: typeof CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL;
      readonly supabasePublishableKey: string;
      readonly supabaseUrl: typeof CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN;
    };

export type RedactedCustomerWebAuthConfig = {
  readonly enabled: boolean;
  readonly passwordRecoveryRedirectUrl: typeof CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL;
  readonly publishableKeyConfigured: boolean;
  readonly supabaseOriginConfigured: boolean;
};

export interface CustomerWebDatabaseConnection {
  readonly database: 'postgres';
  readonly host: typeof CUSTOMER_WEB_DATABASE_DIRECT_HOST;
  readonly password: string;
  readonly port: 5432;
  readonly user: typeof CUSTOMER_WEB_DATABASE_RUNTIME_ROLE;
}

export type CustomerWebWorkspaceConfig =
  | {
      readonly connection: undefined;
      readonly enabled: false;
      readonly projectReference: undefined;
      readonly stage: undefined;
      readonly tlsMode: undefined;
    }
  | {
      readonly connection: CustomerWebDatabaseConnection;
      readonly enabled: true;
      readonly projectReference: typeof CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE;
      readonly stage: 'staging';
      readonly tlsMode: 'verify-full';
    };

export interface CustomerWebWorkspaceConfigDependencies {
  readonly readSecretFile?: (path: string) => string;
}

export type RedactedCustomerWebWorkspaceConfig = {
  readonly connectionConfigured: boolean;
  readonly enabled: boolean;
  readonly projectReference: typeof CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE | undefined;
  readonly stage: 'staging' | undefined;
  readonly tlsMode: 'verify-full' | undefined;
};

function requiredPublishableKey(value: string | undefined): string {
  if (!value || !/^sb_publishable_[A-Za-z0-9_-]{20,256}$/u.test(value)) {
    throw new Error(
      'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY must be a current Supabase publishable key.',
    );
  }
  return value;
}

function databaseUrlFromEnvironmentOrFile(
  environment: NodeJS.ProcessEnv,
  dependencies: CustomerWebWorkspaceConfigDependencies,
): string | undefined {
  const directValue = environment.CUSTOMER_WEB_DATABASE_URL;
  const filePath = environment.CUSTOMER_WEB_DATABASE_URL_FILE;

  if (environment.NODE_ENV === 'production') {
    if (directValue !== undefined) {
      throw new Error(
        'CUSTOMER_WEB_DATABASE_URL_FILE is required in the production customer-web container.',
      );
    }
    if (filePath !== CUSTOMER_WEB_PRODUCTION_DATABASE_URL_SECRET_FILE) {
      throw new Error(
        'CUSTOMER_WEB_DATABASE_URL_FILE must use the approved private runtime secret path.',
      );
    }
  }

  if (directValue !== undefined && filePath !== undefined) {
    throw new Error(
      'CUSTOMER_WEB_DATABASE_URL and CUSTOMER_WEB_DATABASE_URL_FILE must not both be configured.',
    );
  }
  if (directValue !== undefined) return directValue;
  if (filePath === undefined) return undefined;
  if (!posix.isAbsolute(filePath) && !win32.isAbsolute(filePath)) {
    throw new Error('CUSTOMER_WEB_DATABASE_URL_FILE must be an absolute path.');
  }

  let value: string;
  try {
    value = (dependencies.readSecretFile ?? ((path) => readFileSync(path, 'utf8')))(filePath);
  } catch {
    throw new Error('CUSTOMER_WEB_DATABASE_URL_FILE could not be read.');
  }
  const withoutOneTerminalNewline = value.replace(/\r?\n$/u, '');
  if (withoutOneTerminalNewline === '' || /[\r\n]/u.test(withoutOneTerminalNewline)) {
    throw new Error('CUSTOMER_WEB_DATABASE_URL_FILE must contain exactly one secret value.');
  }
  return withoutOneTerminalNewline;
}

function decodeDatabaseUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(
      'CUSTOMER_WEB_DATABASE_URL must contain valid percent-encoded connection components.',
    );
  }
}

function parseCustomerWebDatabaseConnection(
  connectionString: string,
): CustomerWebDatabaseConnection {
  if (
    connectionString !== connectionString.trim() ||
    /[\u0000-\u001f\u007f]/u.test(connectionString)
  ) {
    throw new Error('CUSTOMER_WEB_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error('CUSTOMER_WEB_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (connectionUrl.protocol !== 'postgres:' && connectionUrl.protocol !== 'postgresql:') {
    throw new Error('CUSTOMER_WEB_DATABASE_URL must use the postgres or postgresql protocol.');
  }
  if (
    connectionUrl.hostname !== CUSTOMER_WEB_DATABASE_DIRECT_HOST ||
    connectionUrl.username === '' ||
    connectionUrl.password === ''
  ) {
    throw new Error(
      'CUSTOMER_WEB_DATABASE_URL must use the exact staging direct database endpoint and dedicated runtime login.',
    );
  }
  if (connectionUrl.port !== '' && connectionUrl.port !== '5432') {
    throw new Error('CUSTOMER_WEB_DATABASE_URL must use direct database port 5432.');
  }

  const queryKeys = Array.from(connectionUrl.searchParams.keys());
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    connectionUrl.searchParams.get('sslmode') !== 'verify-full' ||
    connectionUrl.hash !== ''
  ) {
    throw new Error('CUSTOMER_WEB_DATABASE_URL must contain only sslmode=verify-full.');
  }
  const user = decodeDatabaseUrlComponent(connectionUrl.username);
  if (user !== CUSTOMER_WEB_DATABASE_RUNTIME_ROLE) {
    throw new Error(
      'CUSTOMER_WEB_DATABASE_URL must use the exact staging direct database endpoint and dedicated runtime login.',
    );
  }
  const database = decodeDatabaseUrlComponent(connectionUrl.pathname.slice(1));
  if (database !== 'postgres') {
    throw new Error('CUSTOMER_WEB_DATABASE_URL must target the postgres database.');
  }

  return {
    database: 'postgres',
    host: CUSTOMER_WEB_DATABASE_DIRECT_HOST,
    password: decodeDatabaseUrlComponent(connectionUrl.password),
    port: 5432,
    user: CUSTOMER_WEB_DATABASE_RUNTIME_ROLE,
  };
}

export function loadCustomerWebAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CustomerWebAuthConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED,
    false,
    'INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
      supabasePublishableKey: undefined,
      supabaseUrl: undefined,
    };
  }

  if (environment.CUSTOMER_WEB_SUPABASE_URL !== CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN) {
    throw new Error(
      'CUSTOMER_WEB_SUPABASE_URL must be the exact approved customer-web staging Supabase origin.',
    );
  }

  return {
    enabled: true,
    passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
    supabasePublishableKey: requiredPublishableKey(
      environment.CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY,
    ),
    supabaseUrl: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  };
}

export function redactedCustomerWebAuthConfigForLog(
  config: CustomerWebAuthConfig,
): RedactedCustomerWebAuthConfig {
  return {
    enabled: config.enabled,
    passwordRecoveryRedirectUrl: config.passwordRecoveryRedirectUrl,
    publishableKeyConfigured: config.enabled,
    supabaseOriginConfigured: config.enabled,
  };
}

/**
 * Loads the server-only customer workspace database capability. The production service accepts the
 * URL only from its fixed private secret mount, and the URL cannot be repointed away from staging.
 */
export function loadCustomerWebWorkspaceConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: CustomerWebWorkspaceConfigDependencies = {},
): CustomerWebWorkspaceConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED,
    false,
    'INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED',
  );
  if (!enabled) {
    return {
      connection: undefined,
      enabled: false,
      projectReference: undefined,
      stage: undefined,
      tlsMode: undefined,
    };
  }

  const databaseUrl = databaseUrlFromEnvironmentOrFile(environment, dependencies);
  if (!databaseUrl) {
    throw new Error(
      'CUSTOMER_WEB_DATABASE_URL_FILE is required when the customer workspace runtime is enabled.',
    );
  }
  return {
    connection: parseCustomerWebDatabaseConnection(databaseUrl),
    enabled: true,
    projectReference: CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE,
    stage: 'staging',
    tlsMode: 'verify-full',
  };
}

export function redactedCustomerWebWorkspaceConfigForLog(
  config: CustomerWebWorkspaceConfig,
): RedactedCustomerWebWorkspaceConfig {
  return {
    connectionConfigured: config.enabled,
    enabled: config.enabled,
    projectReference: config.projectReference,
    stage: config.stage,
    tlsMode: config.tlsMode,
  };
}
