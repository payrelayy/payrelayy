import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import {
  loadAndVerifyDepositProofReferenceProfile,
  type DepositProofReferenceProfile,
} from './deposit-proof-reference-profile.js';
import { booleanFromEnv, loadRuntimeConfig, type RuntimeConfig } from './shared.js';

export const OWNER_CONTROL_STAGING_PROJECT_REFERENCE = 'spzpiyxheappsfyswewl';
export const OWNER_CONTROL_PRODUCTION_PROJECT_REFERENCE = 'xzztugbgtulptnbpoelr';
export const OWNER_CONTROL_DATABASE_RUNTIME_ROLE = 'fetanagent_owner_control_runtime';
export const OWNER_CONTROL_TELEGRAM_BOT_USERNAME = 'fetanagentbot';
export const OWNER_CONTROL_STAGING_DATABASE_DIRECT_HOST =
  `db.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co` as const;
export const OWNER_CONTROL_PRODUCTION_DATABASE_DIRECT_HOST =
  `db.${OWNER_CONTROL_PRODUCTION_PROJECT_REFERENCE}.supabase.co` as const;
export const OWNER_CONTROL_STAGING_DATABASE_POOLER_HOST =
  'aws-1-eu-west-1.pooler.supabase.com' as const;
export const OWNER_CONTROL_PRODUCTION_DATABASE_POOLER_HOST =
  'aws-0-eu-west-1.pooler.supabase.com' as const;
export const OWNER_CONTROL_STAGING_DATABASE_POOLER_RUNTIME_ROLE =
  `${OWNER_CONTROL_DATABASE_RUNTIME_ROLE}.${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}` as const;
export const OWNER_CONTROL_PRODUCTION_DATABASE_POOLER_RUNTIME_ROLE =
  `${OWNER_CONTROL_DATABASE_RUNTIME_ROLE}.${OWNER_CONTROL_PRODUCTION_PROJECT_REFERENCE}` as const;

export const OWNER_CONTROL_DATABASE_TARGETS = {
  staging: {
    directHost: OWNER_CONTROL_STAGING_DATABASE_DIRECT_HOST,
    poolerHost: OWNER_CONTROL_STAGING_DATABASE_POOLER_HOST,
    poolerRuntimeRole: OWNER_CONTROL_STAGING_DATABASE_POOLER_RUNTIME_ROLE,
    projectReference: OWNER_CONTROL_STAGING_PROJECT_REFERENCE,
    supabaseUrl: `https://${OWNER_CONTROL_STAGING_PROJECT_REFERENCE}.supabase.co`,
  },
  production: {
    directHost: OWNER_CONTROL_PRODUCTION_DATABASE_DIRECT_HOST,
    poolerHost: OWNER_CONTROL_PRODUCTION_DATABASE_POOLER_HOST,
    poolerRuntimeRole: OWNER_CONTROL_PRODUCTION_DATABASE_POOLER_RUNTIME_ROLE,
    projectReference: OWNER_CONTROL_PRODUCTION_PROJECT_REFERENCE,
    supabaseUrl: `https://${OWNER_CONTROL_PRODUCTION_PROJECT_REFERENCE}.supabase.co`,
  },
} as const;
export type OwnerControlDeploymentTarget = keyof typeof OWNER_CONTROL_DATABASE_TARGETS;

// Retain the staging aliases used by the current staging composition.
export const OWNER_CONTROL_DATABASE_DIRECT_HOST = OWNER_CONTROL_STAGING_DATABASE_DIRECT_HOST;
export const OWNER_CONTROL_DATABASE_POOLER_HOST = OWNER_CONTROL_STAGING_DATABASE_POOLER_HOST;
export const OWNER_CONTROL_DATABASE_POOLER_RUNTIME_ROLE =
  OWNER_CONTROL_STAGING_DATABASE_POOLER_RUNTIME_ROLE;

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
  readonly host:
    | (typeof OWNER_CONTROL_DATABASE_TARGETS)[OwnerControlDeploymentTarget]['directHost']
    | (typeof OWNER_CONTROL_DATABASE_TARGETS)[OwnerControlDeploymentTarget]['poolerHost'];
  readonly password: string;
  readonly port: 5432;
  readonly user:
    | typeof OWNER_CONTROL_DATABASE_RUNTIME_ROLE
    | (typeof OWNER_CONTROL_DATABASE_TARGETS)[OwnerControlDeploymentTarget]['poolerRuntimeRole'];
}

export type OwnerControlRuntimeConfig =
  | {
      readonly enabled: false;
      readonly companionDevicePairing: undefined;
      readonly connection: undefined;
      readonly deploymentTarget: undefined;
      readonly devicePairing: undefined;
      readonly projectReference: undefined;
      readonly publishableKey: undefined;
      readonly receiverReferenceProtection: undefined;
      readonly stage: undefined;
      readonly supabaseUrl: undefined;
      readonly tlsMode: undefined;
    }
  | {
      readonly enabled: true;
      readonly companionDevicePairing:
        | {
            readonly serverSignerKeyId: undefined;
            readonly configured: false;
          }
        | {
            readonly serverSignerKeyId: string;
            readonly configured: true;
          };
      readonly connection: OwnerControlDatabaseConnection;
      readonly deploymentTarget: OwnerControlDeploymentTarget;
      readonly devicePairing:
        | {
            readonly assignmentSignerKeyId: undefined;
            readonly configured: false;
          }
        | {
            readonly assignmentSignerKeyId: string;
            readonly configured: true;
          };
      readonly projectReference: (typeof OWNER_CONTROL_DATABASE_TARGETS)[OwnerControlDeploymentTarget]['projectReference'];
      readonly publishableKey: string;
      readonly receiverReferenceProtection: {
        readonly encryptionSecret: string;
        readonly fingerprintSecret: string;
        readonly masterProfile: DepositProofReferenceProfile;
      };
      readonly stage: OwnerControlDeploymentTarget;
      readonly supabaseUrl: (typeof OWNER_CONTROL_DATABASE_TARGETS)[OwnerControlDeploymentTarget]['supabaseUrl'];
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
    if (direct) throw new Error(`${fileName} is required in the production container.`);
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

function parseDatabaseUrl(
  value: string,
  deploymentTarget: OwnerControlDeploymentTarget,
): OwnerControlDatabaseConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('OWNER_CONTROL_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const queryKeys = [...url.searchParams.keys()];
  const user = decode(url.username);
  const expectedTarget = OWNER_CONTROL_DATABASE_TARGETS[deploymentTarget];
  const exactDirectRoute =
    url.hostname === expectedTarget.directHost && user === OWNER_CONTROL_DATABASE_RUNTIME_ROLE;
  const exactSessionPoolerRoute =
    url.hostname === expectedTarget.poolerHost && user === expectedTarget.poolerRuntimeRole;
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    (!exactDirectRoute && !exactSessionPoolerRoute) ||
    (url.port !== '' && url.port !== '5432') ||
    decode(url.password) === '' ||
    decode(url.pathname.slice(1)) !== 'postgres' ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== 'sslmode' ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    url.hash !== ''
  ) {
    throw new Error(
      'OWNER_CONTROL_DATABASE_URL must match the explicit deployment target and use the dedicated Owner-control role through its exact direct or session-pooler endpoint.',
    );
  }

  return {
    database: 'postgres',
    host: exactDirectRoute ? expectedTarget.directHost : expectedTarget.poolerHost,
    password: decode(url.password),
    port: 5432,
    user: exactDirectRoute ? OWNER_CONTROL_DATABASE_RUNTIME_ROLE : expectedTarget.poolerRuntimeRole,
  };
}

function loadOwnerControlDeploymentTarget(
  environment: NodeJS.ProcessEnv,
): OwnerControlDeploymentTarget {
  const target = environment.OWNER_CONTROL_DEPLOYMENT_TARGET;
  if (target !== 'staging' && target !== 'production') {
    throw new Error(
      'OWNER_CONTROL_DEPLOYMENT_TARGET must be explicitly set to staging or production.',
    );
  }
  return target;
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
        companionDevicePairing: undefined,
        connection: undefined,
        deploymentTarget: undefined,
        devicePairing: undefined,
        projectReference: undefined,
        publishableKey: undefined,
        receiverReferenceProtection: undefined,
        stage: undefined,
        supabaseUrl: undefined,
        tlsMode: undefined,
      },
    };
  }

  const deploymentTarget = loadOwnerControlDeploymentTarget(environment);
  const databaseTarget = OWNER_CONTROL_DATABASE_TARGETS[deploymentTarget];
  if (environment.OWNER_CONTROL_SUPABASE_URL !== databaseTarget.supabaseUrl) {
    throw new Error('OWNER_CONTROL_SUPABASE_URL must match the explicit deployment target.');
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
  if (
    environment.DEPOSIT_PROOF_REFERENCE_PROFILE !== undefined ||
    environment.DEPOSIT_PROOF_REFERENCE_PROFILE_FILE !== undefined
  ) {
    throw new Error(
      'Owner receiver-reference protection must use the Owner-specific profile setting.',
    );
  }
  const receiverReferenceMasterProfile = loadAndVerifyDepositProofReferenceProfile(
    {
      ...environment,
      DEPOSIT_PROOF_REFERENCE_PROFILE: environment.OWNER_RECEIVER_REFERENCE_PROFILE,
      DEPOSIT_PROOF_REFERENCE_PROFILE_FILE: environment.OWNER_RECEIVER_REFERENCE_PROFILE_FILE,
    },
    environment.NODE_ENV,
    {
      encryptionMasterSecret: receiverReferenceEncryptionMaster,
      fingerprintMasterSecret: receiverReferenceFingerprintMaster,
    },
    dependencies.readSecretFile === undefined ? {} : { readFile: dependencies.readSecretFile },
  );
  const assignmentSignerKeyId = environment.OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID;
  if (
    assignmentSignerKeyId !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(assignmentSignerKeyId)
  ) {
    throw new Error('OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID is malformed.');
  }
  const companionServerSignerKeyId = environment.OWNER_COMPANION_SERVER_SIGNER_KEY_ID;
  if (
    companionServerSignerKeyId !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(companionServerSignerKeyId)
  ) {
    throw new Error('OWNER_COMPANION_SERVER_SIGNER_KEY_ID is malformed.');
  }

  return {
    ...common,
    runtime: {
      enabled: true,
      companionDevicePairing:
        companionServerSignerKeyId === undefined
          ? { serverSignerKeyId: undefined, configured: false }
          : { serverSignerKeyId: companionServerSignerKeyId, configured: true },
      connection: parseDatabaseUrl(databaseUrl, deploymentTarget),
      deploymentTarget,
      devicePairing:
        assignmentSignerKeyId === undefined
          ? { assignmentSignerKeyId: undefined, configured: false }
          : { assignmentSignerKeyId, configured: true },
      projectReference: databaseTarget.projectReference,
      publishableKey,
      receiverReferenceProtection: {
        encryptionSecret: receiverReferenceEncryptionMaster,
        fingerprintSecret: receiverReferenceFingerprintMaster,
        masterProfile: receiverReferenceMasterProfile,
      },
      stage: deploymentTarget,
      supabaseUrl: databaseTarget.supabaseUrl,
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
      deploymentTarget: config.runtime.deploymentTarget,
      projectReference: config.runtime.projectReference,
      stage: config.runtime.stage,
      tlsMode: config.runtime.tlsMode,
      databaseConfigured: config.runtime.enabled,
      companionDevicePairingConfigured:
        config.runtime.enabled && config.runtime.companionDevicePairing.configured,
      telebirrDevicePairingConfigured:
        config.runtime.enabled && config.runtime.devicePairing.configured,
      publishableKeyConfigured: config.runtime.enabled,
      receiverReferenceProtectionConfigured: config.runtime.enabled,
      receiverReferenceMasterProfileVersion: config.runtime.enabled
        ? config.runtime.receiverReferenceProtection.masterProfile.version
        : undefined,
    },
  } as const;
}
