import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import { booleanFromEnv, loadRuntimeConfig, type RuntimeConfig } from './shared.js';

export const OWNER_CONTROL_STAGING_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl';
export const OWNER_CONTROL_DATABASE_RUNTIME_ROLE = 'payreplayy_owner_control_runtime';

const SESSION_POOLER_HOST = 'aws-1-eu-west-1.pooler.supabase.com';
const SESSION_POOLER_USER = `${OWNER_CONTROL_DATABASE_RUNTIME_ROLE}.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}`;
const STAGING_SUPABASE_URL = `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`;
const PRODUCTION_SECRET_PATHS: Readonly<Record<string, string>> = {
  OWNER_CONTROL_DATABASE_URL: '/run/secrets/owner_control_database_url',
  OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: '/run/secrets/owner_control_supabase_publishable_key',
};

export interface OwnerControlDatabaseConnection {
  readonly database: 'postgres';
  readonly host: typeof SESSION_POOLER_HOST;
  readonly password: string;
  readonly port: 5432;
  readonly user: typeof SESSION_POOLER_USER;
}

export type OwnerControlRuntimeConfig =
  | {
      readonly enabled: false;
      readonly connection: undefined;
      readonly projectReference: undefined;
      readonly publishableKey: undefined;
      readonly stage: undefined;
      readonly supabaseUrl: undefined;
      readonly tlsMode: undefined;
    }
  | {
      readonly enabled: true;
      readonly connection: OwnerControlDatabaseConnection;
      readonly projectReference: typeof OWNER_CONTROL_STAGING_PROJECT_REFERENCE;
      readonly publishableKey: string;
      readonly stage: 'staging';
      readonly supabaseUrl: typeof STAGING_SUPABASE_URL;
      readonly tlsMode: 'verify-full';
    };

export interface OwnerControlConfig extends RuntimeConfig {
  readonly botUsername: 'PayReplayyBot';
  readonly runtime: OwnerControlRuntimeConfig;
  readonly server: {
    readonly host: string;
    readonly port: number;
  };
}

export interface OwnerControlConfigDependencies {
  readonly readSecretFile?: (path: string) => string;
}

function readSecret(
  environment: NodeJS.ProcessEnv,
  name: string,
  dependencies: OwnerControlConfigDependencies,
): string | undefined {
  const direct = environment[name];
  const fileName = `${name}_FILE`;
  const filePath = environment[fileName];

  if (environment.NODE_ENV === 'production') {
    if (direct) throw new Error(`${fileName} is required in the production staging container.`);
    if (filePath && filePath !== PRODUCTION_SECRET_PATHS[name]) {
      throw new Error(`${fileName} must use the approved private runtime secret path.`);
    }
  }
  if (direct && filePath) throw new Error(`${name} and ${fileName} must not both be configured.`);
  if (direct) return direct;
  if (!filePath) return undefined;
  if (!posix.isAbsolute(filePath) && !win32.isAbsolute(filePath)) {
    throw new Error(`${fileName} must be an absolute path.`);
  }

  let value: string;
  try {
    value = (dependencies.readSecretFile ?? ((path) => readFileSync(path, 'utf8')))(filePath);
  } catch {
    throw new Error(`${fileName} could not be read.`);
  }
  const withoutTerminalNewline = value.replace(/\r?\n$/, '');
  if (withoutTerminalNewline === '' || /[\r\n]/u.test(withoutTerminalNewline)) {
    throw new Error(`${fileName} must contain exactly one value.`);
  }
  return withoutTerminalNewline;
}

function parsePort(value: string | undefined): number {
  if (!value) return 3002;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('OWNER_CONTROL_PORT must be an integer from 1 to 65535.');
  }
  return port;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('OWNER_CONTROL_DATABASE_URL contains invalid percent encoding.');
  }
}

function parseDatabaseUrl(value: string): OwnerControlDatabaseConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('OWNER_CONTROL_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const queryKeys = [...url.searchParams.keys()];
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname !== SESSION_POOLER_HOST ||
    (url.port !== '' && url.port !== '5432') ||
    decode(url.username) !== SESSION_POOLER_USER ||
    decode(url.password) === '' ||
    decode(url.pathname.slice(1)) !== 'postgres' ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    url.hash !== ''
  ) {
    throw new Error(
      'OWNER_CONTROL_DATABASE_URL must use the dedicated staging Owner-control role through the approved verify-full session pooler.',
    );
  }

  return {
    database: 'postgres',
    host: SESSION_POOLER_HOST,
    password: decode(url.password),
    port: 5432,
    user: SESSION_POOLER_USER,
  };
}

export function loadOwnerControlConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: OwnerControlConfigDependencies = {},
): OwnerControlConfig {
  const common = {
    ...loadRuntimeConfig(environment),
    botUsername: 'PayReplayyBot' as const,
    server: {
      host: environment.OWNER_CONTROL_HOST ?? '127.0.0.1',
      port: parsePort(environment.OWNER_CONTROL_PORT),
    },
  };
  const enabled = booleanFromEnv(
    environment.INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED,
    false,
    'INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED',
  );
  if (!enabled) {
    return {
      ...common,
      runtime: {
        enabled: false,
        connection: undefined,
        projectReference: undefined,
        publishableKey: undefined,
        stage: undefined,
        supabaseUrl: undefined,
        tlsMode: undefined,
      },
    };
  }

  if (environment.OWNER_CONTROL_SUPABASE_URL !== STAGING_SUPABASE_URL) {
    throw new Error('OWNER_CONTROL_SUPABASE_URL must target the exact staging project.');
  }
  const databaseUrl = readSecret(environment, 'OWNER_CONTROL_DATABASE_URL', dependencies);
  const publishableKey = readSecret(
    environment,
    'OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY',
    dependencies,
  );
  if (!databaseUrl) throw new Error('OWNER_CONTROL_DATABASE_URL is required.');
  if (!publishableKey || !/^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(publishableKey)) {
    throw new Error('OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY is missing or malformed.');
  }

  return {
    ...common,
    runtime: {
      enabled: true,
      connection: parseDatabaseUrl(databaseUrl),
      projectReference: OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
      publishableKey,
      stage: 'staging',
      supabaseUrl: STAGING_SUPABASE_URL,
      tlsMode: 'verify-full',
    },
  };
}

export function redactedOwnerControlConfigForLog(config: OwnerControlConfig) {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    botUsername: config.botUsername,
    server: config.server,
    runtime: {
      enabled: config.runtime.enabled,
      projectReference: config.runtime.projectReference,
      stage: config.runtime.stage,
      tlsMode: config.runtime.tlsMode,
      databaseConfigured: config.runtime.enabled,
      publishableKeyConfigured: config.runtime.enabled,
    },
  } as const;
}
