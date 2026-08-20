import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import { booleanFromEnv, loadFinancialActionsMode } from './shared.js';
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
export const CUSTOMER_WEB_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SECRET_FILE =
  '/run/secrets/customer_web_supabase_publishable_key' as const;
export const CUSTOMER_WEB_PRODUCTION_RATE_LIMIT_HMAC_SECRET_FILE =
  '/run/secrets/customer_web_rate_limit_hmac' as const;

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

export type CustomerWebDepositConfig =
  | {
      readonly enabled: false;
      readonly referenceEncryptionSecret: undefined;
      readonly referenceFingerprintSecret: undefined;
      readonly referenceKeyProfileVersion: undefined;
    }
  | {
      readonly enabled: true;
      readonly referenceEncryptionSecret: string;
      readonly referenceFingerprintSecret: string;
      readonly referenceKeyProfileVersion: 1;
    };

export type CustomerWebDryRunDepositProofConfig =
  | {
      readonly enabled: false;
      readonly financialActionsMode: undefined;
      readonly liveFinancialActionsEnabled: undefined;
      readonly referenceEncryptionMasterSecret: undefined;
      readonly referenceFingerprintMasterSecret: undefined;
      readonly referenceProfileVersion: undefined;
    }
  | {
      readonly enabled: true;
      readonly financialActionsMode: 'dry_run';
      readonly liveFinancialActionsEnabled: false;
      readonly referenceEncryptionMasterSecret: string;
      readonly referenceFingerprintMasterSecret: string;
      readonly referenceProfileVersion: 2;
    };

export type CustomerWebRateLimitConfig =
  | { readonly enabled: false; readonly hmacSecret: undefined }
  | { readonly enabled: true; readonly hmacSecret: string };

export interface CustomerWebRateLimitConfigDependencies {
  readonly readSecretFile?: (path: string) => string;
}

export interface CustomerWebAuthConfigDependencies {
  readonly readSecretFile?: (path: string) => string;
}

export interface CustomerWebDepositConfigDependencies {
  readonly readSecretFile?: (path: string) => string;
}

export type CustomerWebDryRunDepositProofConfigDependencies = CustomerWebDepositConfigDependencies;

export interface RedactedCustomerWebDepositConfig {
  readonly enabled: boolean;
  readonly referenceProtectionConfigured: boolean;
  readonly referenceKeyProfileVersion: 1 | undefined;
}

export interface RedactedCustomerWebDryRunDepositProofConfig {
  readonly enabled: boolean;
  readonly financialActionsMode: 'dry_run' | undefined;
  readonly liveFinancialActionsEnabled: false | undefined;
  readonly referenceMastersConfigured: boolean;
  readonly referenceProfileVersion: 2 | undefined;
}

export interface RedactedCustomerWebRateLimitConfig {
  readonly enabled: boolean;
  readonly hmacConfigured: boolean;
}

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

function publishableKeyFromEnvironmentOrFile(
  environment: NodeJS.ProcessEnv,
  dependencies: CustomerWebAuthConfigDependencies,
): string | undefined {
  const direct = environment.CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY;
  const file = environment.CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE;
  if (environment.NODE_ENV === 'production') {
    if (direct !== undefined) {
      throw new Error(
        'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE is required in the production customer-web container.',
      );
    }
    if (file !== CUSTOMER_WEB_PRODUCTION_SUPABASE_PUBLISHABLE_KEY_SECRET_FILE) {
      throw new Error(
        'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE must use the approved private runtime secret path.',
      );
    }
  }
  if (direct !== undefined && file !== undefined) {
    throw new Error(
      'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY and CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE must not both be configured.',
    );
  }
  if (direct !== undefined) return direct;
  if (file === undefined) return undefined;
  if (!posix.isAbsolute(file) && !win32.isAbsolute(file)) {
    throw new Error('CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE must be an absolute path.');
  }
  let value: string;
  try {
    value = (dependencies.readSecretFile ?? ((path) => readFileSync(path, 'utf8')))(file);
  } catch {
    throw new Error('CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE could not be read.');
  }
  const withoutOneTerminalNewline = value.replace(/\r?\n$/u, '');
  if (withoutOneTerminalNewline === '' || /[\r\n]/u.test(withoutOneTerminalNewline)) {
    throw new Error(
      'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE must contain exactly one secret value.',
    );
  }
  return withoutOneTerminalNewline;
}

function depositReferenceSecretFromEnvironmentOrFile(
  environment: NodeJS.ProcessEnv,
  dependencies: CustomerWebDepositConfigDependencies,
  names: {
    readonly direct: string;
    readonly file: string;
    readonly productionFile: string;
  },
): string | undefined {
  const directValue = environment[names.direct];
  const filePath = environment[names.file];
  if (environment.NODE_ENV === 'production') {
    if (directValue !== undefined) {
      throw new Error(`${names.file} is required in production.`);
    }
    if (filePath !== names.productionFile) {
      throw new Error(`${names.file} must use the approved private path.`);
    }
  }
  if (directValue !== undefined && filePath !== undefined) {
    throw new Error(`${names.direct} and ${names.file} are mutually exclusive.`);
  }
  let value = directValue;
  if (value === undefined && filePath !== undefined) {
    if (!posix.isAbsolute(filePath) && !win32.isAbsolute(filePath)) {
      throw new Error(`${names.file} must be an absolute path.`);
    }
    try {
      value = (dependencies.readSecretFile ?? ((path) => readFileSync(path, 'utf8')))(filePath);
    } catch {
      throw new Error(`${names.file} could not be read.`);
    }
    value = value.replace(/\r?\n$/u, '');
  }
  if (value === undefined) return undefined;
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${names.direct} must be exactly 32 lowercase-hex bytes.`);
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

export function loadCustomerWebRateLimitConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: CustomerWebRateLimitConfigDependencies = {},
): CustomerWebRateLimitConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED,
    false,
    'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED',
  );
  if (!enabled) return { enabled: false, hmacSecret: undefined };

  const direct = environment.CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET;
  const file = environment.CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE;
  if (environment.NODE_ENV === 'production') {
    if (direct !== undefined) {
      throw new Error('CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE is required in production.');
    }
    if (file !== CUSTOMER_WEB_PRODUCTION_RATE_LIMIT_HMAC_SECRET_FILE) {
      throw new Error(
        'CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE must use the approved private path.',
      );
    }
  }
  if (direct !== undefined && file !== undefined) {
    throw new Error(
      'CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET and CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE are mutually exclusive.',
    );
  }
  let value = direct;
  if (value === undefined && file !== undefined) {
    if (!posix.isAbsolute(file) && !win32.isAbsolute(file)) {
      throw new Error('CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE must be an absolute path.');
    }
    try {
      value = (dependencies.readSecretFile ?? ((path) => readFileSync(path, 'utf8')))(file).replace(
        /\r?\n$/u,
        '',
      );
    } catch {
      throw new Error('CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE could not be read.');
    }
  }
  if (value === undefined || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error('CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET must be exactly 32 lowercase-hex bytes.');
  }
  return { enabled: true, hmacSecret: value };
}

export function redactedCustomerWebRateLimitConfigForLog(
  config: CustomerWebRateLimitConfig,
): RedactedCustomerWebRateLimitConfig {
  return { enabled: config.enabled, hmacConfigured: config.enabled };
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
  dependencies: CustomerWebAuthConfigDependencies = {},
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
      publishableKeyFromEnvironmentOrFile(environment, dependencies),
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

/** Loads only the server-side reference-protection capability for live customer deposit intake. */
export function loadCustomerWebDepositConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: CustomerWebDepositConfigDependencies = {},
): CustomerWebDepositConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED,
    false,
    'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED',
  );
  if (!enabled) {
    return {
      enabled: false,
      referenceEncryptionSecret: undefined,
      referenceFingerprintSecret: undefined,
      referenceKeyProfileVersion: undefined,
    };
  }
  const referenceEncryptionSecret = depositReferenceSecretFromEnvironmentOrFile(
    environment,
    dependencies,
    {
      direct: 'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET',
      file: 'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE',
      productionFile: CBE_DEPOSIT_REFERENCE_PRODUCTION_ENCRYPTION_SECRET_FILE,
    },
  );
  const referenceFingerprintSecret = depositReferenceSecretFromEnvironmentOrFile(
    environment,
    dependencies,
    {
      direct: 'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET',
      file: 'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE',
      productionFile: CBE_DEPOSIT_REFERENCE_PRODUCTION_FINGERPRINT_SECRET_FILE,
    },
  );
  if (!referenceEncryptionSecret || !referenceFingerprintSecret) {
    throw new Error(
      'Both CBE deposit-reference secret files are required when deposits are enabled.',
    );
  }
  const profile = loadAndVerifyCbeDepositReferenceKeyProfile(
    environment,
    environment.NODE_ENV,
    {
      encryptionSecret: referenceEncryptionSecret,
      fingerprintSecret: referenceFingerprintSecret,
    },
    dependencies.readSecretFile === undefined ? {} : { readFile: dependencies.readSecretFile },
  );
  return {
    enabled: true,
    referenceEncryptionSecret,
    referenceFingerprintSecret,
    referenceKeyProfileVersion: profile.version,
  };
}

export function redactedCustomerWebDepositConfigForLog(
  config: CustomerWebDepositConfig,
): RedactedCustomerWebDepositConfig {
  return {
    enabled: config.enabled,
    referenceProtectionConfigured: config.enabled,
    referenceKeyProfileVersion: config.enabled ? config.referenceKeyProfileVersion : undefined,
  };
}

/**
 * Loads the provider-neutral v2 reference-protection capability for amount-free dry-run proof
 * intake. It cannot compose while either live KemerBet gate or the legacy deposit gate is active.
 */
export function loadCustomerWebDryRunDepositProofConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: CustomerWebDryRunDepositProofConfigDependencies = {},
): CustomerWebDryRunDepositProofConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED,
    false,
    'INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED',
  );
  if (!enabled) {
    return {
      enabled: false,
      financialActionsMode: undefined,
      liveFinancialActionsEnabled: undefined,
      referenceEncryptionMasterSecret: undefined,
      referenceFingerprintMasterSecret: undefined,
      referenceProfileVersion: undefined,
    };
  }

  const financialActionsMode = loadFinancialActionsMode(environment);
  const legacyDepositEnabled = booleanFromEnv(
    environment.INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED,
    false,
    'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED',
  );
  const kemerbetExecutorEnabled = booleanFromEnv(
    environment.KEMERBET_EXECUTOR_ENABLED,
    false,
    'KEMERBET_EXECUTOR_ENABLED',
  );
  const kemerbetFinalActionEnabled = booleanFromEnv(
    environment.KEMERBET_FINAL_ACTION_ENABLED,
    false,
    'KEMERBET_FINAL_ACTION_ENABLED',
  );
  if (
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    financialActionsMode !== 'dry_run' ||
    environment.INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED !== 'false' ||
    legacyDepositEnabled ||
    environment.KEMERBET_EXECUTOR_ENABLED !== 'false' ||
    kemerbetExecutorEnabled ||
    environment.KEMERBET_FINAL_ACTION_ENABLED !== 'false' ||
    kemerbetFinalActionEnabled
  ) {
    throw new Error(
      'Customer-web dry-run deposit proof intake requires exact dry-run mode and all legacy/live financial gates explicitly false.',
    );
  }

  const referenceEncryptionMasterSecret = depositReferenceSecretFromEnvironmentOrFile(
    environment,
    dependencies,
    {
      direct: 'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
      file: 'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE',
      productionFile: DEPOSIT_PROOF_REFERENCE_PRODUCTION_ENCRYPTION_MASTER_SECRET_FILE,
    },
  );
  const referenceFingerprintMasterSecret = depositReferenceSecretFromEnvironmentOrFile(
    environment,
    dependencies,
    {
      direct: 'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
      file: 'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE',
      productionFile: DEPOSIT_PROOF_REFERENCE_PRODUCTION_FINGERPRINT_MASTER_SECRET_FILE,
    },
  );
  if (!referenceEncryptionMasterSecret || !referenceFingerprintMasterSecret) {
    throw new Error(
      'Both provider-neutral deposit proof-reference master secret files are required when dry-run proof intake is enabled.',
    );
  }
  const profile = loadAndVerifyDepositProofReferenceProfile(
    environment,
    environment.NODE_ENV,
    {
      encryptionMasterSecret: referenceEncryptionMasterSecret,
      fingerprintMasterSecret: referenceFingerprintMasterSecret,
    },
    dependencies.readSecretFile === undefined ? {} : { readFile: dependencies.readSecretFile },
  );

  return {
    enabled: true,
    financialActionsMode,
    liveFinancialActionsEnabled: false,
    referenceEncryptionMasterSecret,
    referenceFingerprintMasterSecret,
    referenceProfileVersion: profile.version,
  };
}

export function redactedCustomerWebDryRunDepositProofConfigForLog(
  config: CustomerWebDryRunDepositProofConfig,
): RedactedCustomerWebDryRunDepositProofConfig {
  return {
    enabled: config.enabled,
    financialActionsMode: config.financialActionsMode,
    liveFinancialActionsEnabled: config.liveFinancialActionsEnabled,
    referenceMastersConfigured: config.enabled,
    referenceProfileVersion: config.referenceProfileVersion,
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
