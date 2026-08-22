import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import {
  loadAndVerifyDepositProofReferenceProfile,
  type DepositProofReferenceProfile,
} from './deposit-proof-reference-profile.js';
import { booleanFromEnv, loadRuntimeConfig, type RuntimeConfig } from './shared.js';

export const OWNER_CONTROL_STAGING_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl';
export const OWNER_CONTROL_DATABASE_RUNTIME_ROLE = 'fetanagent_owner_control_runtime';
export const OWNER_CONTROL_TELEGRAM_BOT_USERNAME = 'fetanagentbot';
export const OWNER_CONTROL_DATABASE_DIRECT_HOST = `db.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`;

const STAGING_SUPABASE_URL = `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`;
const PRODUCTION_SECRET_PATHS: Readonly<Record<string, string>> = {
  OWNER_CONTROL_DATABASE_URL: '/run/secrets/owner_control_database_url',
  OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER:
    '/run/secrets/owner_receiver_reference_encryption_master',
  OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER:
    '/run/secrets/owner_receiver_reference_fingerprint_master',
  OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY: '/run/secrets/owner_control_supabase_publishable_key',
};

export interface OwnerControlDatabaseConnection {
  readonly database: 'postgres';
  readonly host: typeof OWNER_CONTROL_DATABASE_DIRECT_HOST;
  readonly password: string;
  readonly port: 5432;
  readonly user: typeof OWNER_CONTROL_DATABASE_RUNTIME_ROLE;
}

export type OwnerControlRuntimeConfig =
  | {
      readonly enabled: false;
      readonly connection: undefined;
      readonly projectReference: undefined;
      readonly publishableKey: undefined;
      readonly receiverReferenceProtection: undefined;
      readonly stage: undefined;
      readonly supabaseUrl: undefined;
      readonly tlsMode: undefined;
    }
  | {
      readonly enabled: true;
      readonly connection: OwnerControlDatabaseConnection;
      readonly projectReference: typeof OWNER_CONTROL_STAGING_PROJECT_REFERENCE;
      readonly publishableKey: string;
      readonly receiverReferenceProtection: {
        readonly encryptionSecret: string;
        readonly fingerprintSecret: string;
        readonly masterProfile: DepositProofReferenceProfile;
      };
      readonly stage: 'staging';
      readonly supabaseUrl: typeof STAGING_SUPABASE_URL;
      readonly tlsMode: 'verify-full';
    };

export interface OwnerControlConfig extends RuntimeConfig {
  readonly botUsername: typeof OWNER_CONTROL_TELEGRAM_BOT_USERNAME;
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
    url.hostname !== OWNER_CONTROL_DATABASE_DIRECT_HOST ||
    (url.port !== '' && url.port !== '5432') ||
    decode(url.username) !== OWNER_CONTROL_DATABASE_RUNTIME_ROLE ||
    decode(url.password) === '' ||
    decode(url.pathname.slice(1)) !== 'postgres' ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    url.hash !== ''
  ) {
    throw new Error(
      'OWNER_CONTROL_DATABASE_URL must use the dedicated staging Owner-control role through the exact IPv6 direct database endpoint.',
    );
  }

  return {
    database: 'postgres',
    host: OWNER_CONTROL_DATABASE_DIRECT_HOST,
    password: decode(url.password),
    port: 5432,
    user: OWNER_CONTROL_DATABASE_RUNTIME_ROLE,
  };
}

export function loadOwnerControlConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: OwnerControlConfigDependencies = {},
): OwnerControlConfig {
  const common: Omit<OwnerControlConfig, 'runtime'> = {
    ...loadRuntimeConfig(environment),
    botUsername: OWNER_CONTROL_TELEGRAM_BOT_USERNAME,
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
        receiverReferenceProtection: undefined,
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
  const receiverReferenceEncryptionMaster = readSecret(
    environment,
    'OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER',
    dependencies,
  );
  const receiverReferenceFingerprintMaster = readSecret(
    environment,
    'OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER',
    dependencies,
  );
  if (!databaseUrl) throw new Error('OWNER_CONTROL_DATABASE_URL is required.');
  if (!publishableKey || !/^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(publishableKey)) {
    throw new Error('OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY is missing or malformed.');
  }
  if (
    !receiverReferenceEncryptionMaster ||
    !receiverReferenceFingerprintMaster ||
    !/^[0-9a-f]{64}$/u.test(receiverReferenceEncryptionMaster) ||
    !/^[0-9a-f]{64}$/u.test(receiverReferenceFingerprintMaster) ||
    receiverReferenceEncryptionMaster === receiverReferenceFingerprintMaster
  ) {
    throw new Error('Owner receiver-reference protection masters are missing or malformed.');
  }
  const receiverReferenceMasterProfile = loadAndVerifyDepositProofReferenceProfile(
    environment,
    environment.NODE_ENV,
    {
      encryptionMasterSecret: receiverReferenceEncryptionMaster,
      fingerprintMasterSecret: receiverReferenceFingerprintMaster,
    },
    dependencies.readSecretFile === undefined ? {} : { readFile: dependencies.readSecretFile },
  );

  return {
    ...common,
    runtime: {
      enabled: true,
      connection: parseDatabaseUrl(databaseUrl),
      projectReference: OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
      publishableKey,
      receiverReferenceProtection: {
        encryptionSecret: receiverReferenceEncryptionMaster,
        fingerprintSecret: receiverReferenceFingerprintMaster,
        masterProfile: receiverReferenceMasterProfile,
      },
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
      receiverReferenceProtectionConfigured: config.runtime.enabled,
      receiverReferenceMasterProfileVersion: config.runtime.enabled
        ? config.runtime.receiverReferenceProtection.masterProfile.version
        : undefined,
    },
  } as const;
}
