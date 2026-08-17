import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import type { FinancialActionsMode } from '@fetanagent/domain';

import {
  booleanFromEnv,
  loadFinancialActionsMode,
  loadRuntimeConfig,
  type RuntimeConfig,
} from './shared.js';

export const KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE =
  'fetanagent_deposit_executor_runtime' as const;
export type KemerBetExecutorDeploymentTarget = 'staging' | 'production';
export const KEMERBET_EXECUTOR_DATABASE_TARGETS = Object.freeze({
  staging: Object.freeze({
    projectReference: 'spzpiyxheappsfyswewl' as const,
    host: 'db.spzpiyxheappsfyswewl.supabase.co' as const,
  }),
  production: Object.freeze({
    projectReference: 'xzztugbgtulptnbpoelr' as const,
    host: 'db.xzztugbgtulptnbpoelr.supabase.co' as const,
  }),
});
export const KEMERBET_EXECUTOR_DATABASE_SECRET_FILE =
  '/run/secrets/kemerbet_executor_database_url' as const;
export const KEMERBET_AGENT_IDENTITY_BINDINGS_FILE =
  '/run/secrets/kemerbet_agent_identity_bindings' as const;
export const KEMERBET_AGENT_PROFILES_ROOT = '/var/lib/fetanagent/kemerbet-sessions' as const;
export const KEMERBET_BROWSER_EXECUTABLE_PATH = '/usr/bin/chromium' as const;
export const KEMERBET_SELECTOR_CONTRACT_FILE =
  '/etc/fetanagent/kemerbet-selector-contract.v1.json' as const;
export const KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE =
  '/run/secrets/kemerbet_history_reference_hmac_key' as const;
export const KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE =
  '/run/secrets/kemerbet_agent_identity_hmac_key' as const;
export const KEMERBET_SUPABASE_CA_CERTIFICATE_FILE =
  '/run/configs/supabase_ca_certificate' as const;
export const KEMERBET_EXECUTOR_HEALTH_HOST = '127.0.0.1' as const;
export const KEMERBET_EXECUTOR_HEALTH_PORT = 8090 as const;

export interface ExecutorConfig extends RuntimeConfig {
  readonly financialActionsMode: FinancialActionsMode;
  readonly kemerBet: {
    readonly executorEnabled: boolean;
    readonly finalActionFeatureEnabled: boolean;
    readonly runtimeIsolation: {
      readonly agentIdentityBindingsFile: typeof KEMERBET_AGENT_IDENTITY_BINDINGS_FILE;
      readonly agentProfilesRoot: typeof KEMERBET_AGENT_PROFILES_ROOT;
      readonly browserExecutablePath: typeof KEMERBET_BROWSER_EXECUTABLE_PATH;
      readonly selectorContractFile: typeof KEMERBET_SELECTOR_CONTRACT_FILE;
      readonly historyReferenceHmacKeyFile: typeof KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE;
      readonly agentIdentityHmacKeyFile: typeof KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE;
      readonly supabaseCaCertificateFile: typeof KEMERBET_SUPABASE_CA_CERTIFICATE_FILE;
      readonly healthHost: typeof KEMERBET_EXECUTOR_HEALTH_HOST;
      readonly healthPort: typeof KEMERBET_EXECUTOR_HEALTH_PORT;
    };
    readonly executionRuntime:
      | { readonly enabled: false }
      | {
          readonly enabled: true;
          readonly deploymentTarget: KemerBetExecutorDeploymentTarget;
          readonly projectReference: (typeof KEMERBET_EXECUTOR_DATABASE_TARGETS)[KemerBetExecutorDeploymentTarget]['projectReference'];
          readonly tlsMode: 'verify-full';
          readonly connection: {
            readonly database: 'postgres';
            readonly host: (typeof KEMERBET_EXECUTOR_DATABASE_TARGETS)[KemerBetExecutorDeploymentTarget]['host'];
            readonly password: string;
            readonly port: 5432;
            readonly user: typeof KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE;
          };
        };
  };
}

type ReadSecretFile = (path: string) => string;

interface ExecutorDatabaseSecretFileStat {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly mode: number;
  readonly size: number;
  readonly uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface ExecutorDatabaseSecretFileHandle {
  close(): void;
  read(maximumBytes: number): Buffer;
  stat(): ExecutorDatabaseSecretFileStat;
}

interface ExecutorDatabaseSecretFileSystem {
  lstat(path: string): ExecutorDatabaseSecretFileStat;
  open(path: string, flags: number): ExecutorDatabaseSecretFileHandle;
  realpath(path: string): string;
}

interface ExecutorConfigDependencies {
  readonly effectiveUserId?: number;
  readonly platform?: NodeJS.Platform;
  readonly readSecretFile?: ReadSecretFile;
  readonly secretFileSystem?: ExecutorDatabaseSecretFileSystem;
}

type ExecutorConfigDependenciesInput = ReadSecretFile | ExecutorConfigDependencies;

const MAXIMUM_EXECUTOR_DATABASE_SECRET_BYTES = 4_096;
const EXECUTOR_DATABASE_SECRET_UNAVAILABLE_MESSAGE =
  'The KemerBet executor database secret is unavailable.';

const nodeSecretFileSystem: ExecutorDatabaseSecretFileSystem = {
  lstat: lstatSync,
  open(path, flags) {
    const descriptor = openSync(path, flags);
    return {
      close: () => closeSync(descriptor),
      read(maximumBytes) {
        const bytes = Buffer.alloc(maximumBytes + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const readBytes = readSync(descriptor, bytes, offset, bytes.length - offset, null);
          if (readBytes === 0) break;
          offset += readBytes;
        }
        return bytes.subarray(0, offset);
      },
      stat: () => fstatSync(descriptor),
    };
  },
  realpath: (path) => realpathSync(path),
};

const FROZEN_PRODUCTION_SETTINGS = {
  KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
  KEMERBET_AGENT_PROFILES_ROOT,
  KEMERBET_BROWSER_EXECUTABLE_PATH,
  KEMERBET_SELECTOR_CONTRACT_FILE,
  KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE,
  KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
  NODE_EXTRA_CA_CERTS: KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
  EXECUTOR_HEALTH_HOST: KEMERBET_EXECUTOR_HEALTH_HOST,
  EXECUTOR_HEALTH_PORT: String(KEMERBET_EXECUTOR_HEALTH_PORT),
} as const;

function executorDatabaseSecretUnavailable(): never {
  throw new Error(EXECUTOR_DATABASE_SECRET_UNAVAILABLE_MESSAGE);
}

function normalizeDependencies(input: ExecutorConfigDependenciesInput): ExecutorConfigDependencies {
  return typeof input === 'function' ? { readSecretFile: input } : input;
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function sameFile(
  left: ExecutorDatabaseSecretFileStat,
  right: ExecutorDatabaseSecretFileStat,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function validateSecretFileStat(
  stat: ExecutorDatabaseSecretFileStat,
  platform: NodeJS.Platform,
  effectiveUserId: number | null,
): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !Number.isSafeInteger(stat.size) ||
    stat.size < 1 ||
    stat.size > MAXIMUM_EXECUTOR_DATABASE_SECRET_BYTES ||
    (platform !== 'win32' &&
      ((stat.uid !== 0 && stat.uid !== effectiveUserId) || (stat.mode & 0o022) !== 0))
  ) {
    executorDatabaseSecretUnavailable();
  }
}

function readVerifiedExecutorDatabaseSecret(
  filePath: string,
  dependencies: ExecutorConfigDependencies,
): string {
  const fileSystem = dependencies.secretFileSystem ?? nodeSecretFileSystem;
  const platform = dependencies.platform ?? process.platform;
  const effectiveUserId =
    platform === 'win32'
      ? null
      : (dependencies.effectiveUserId ??
        (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN));
  if (
    platform !== 'win32' &&
    (effectiveUserId === null || !Number.isSafeInteger(effectiveUserId) || effectiveUserId < 0)
  ) {
    executorDatabaseSecretUnavailable();
  }

  let handle: ExecutorDatabaseSecretFileHandle | null = null;
  let bytes: Buffer | null = null;
  try {
    const before = fileSystem.lstat(filePath);
    validateSecretFileStat(before, platform, effectiveUserId);
    if (!samePath(fileSystem.realpath(filePath), filePath, platform)) {
      executorDatabaseSecretUnavailable();
    }

    handle = fileSystem.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = handle.stat();
    validateSecretFileStat(opened, platform, effectiveUserId);
    if (!sameFile(before, opened)) executorDatabaseSecretUnavailable();

    bytes = handle.read(MAXIMUM_EXECUTOR_DATABASE_SECRET_BYTES);
    const afterRead = handle.stat();
    validateSecretFileStat(afterRead, platform, effectiveUserId);
    if (!sameFile(opened, afterRead) || bytes.length !== opened.size) {
      executorDatabaseSecretUnavailable();
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return executorDatabaseSecretUnavailable();
  } finally {
    bytes?.fill(0);
    if (handle !== null) {
      try {
        handle.close();
      } catch {
        // All guarded-load failures are deliberately reduced to the generic error above.
      }
    }
  }
}

function exactExecutorDatabaseSecretValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAXIMUM_EXECUTOR_DATABASE_SECRET_BYTES ||
    value !== value.trim() ||
    /[\r\n\0]/u.test(value)
  ) {
    executorDatabaseSecretUnavailable();
  }
  return value;
}

function assertFrozenProductionSettings(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV !== 'production') return;
  for (const [name, expected] of Object.entries(FROZEN_PRODUCTION_SETTINGS)) {
    const configured = environment[name];
    if (configured !== undefined && configured !== expected) {
      throw new Error('The executor production isolation setting cannot be overridden.');
    }
  }
}

function readExecutorDatabaseSecret(
  environment: NodeJS.ProcessEnv,
  dependencies: ExecutorConfigDependencies,
): string {
  const filePath = environment.KEMERBET_EXECUTOR_DATABASE_URL_FILE;
  if (!filePath) {
    throw new Error(
      'KEMERBET_EXECUTOR_DATABASE_URL_FILE is required when the execution runtime is enabled.',
    );
  }
  if (!isAbsolute(filePath)) {
    throw new Error('KEMERBET_EXECUTOR_DATABASE_URL_FILE must be an absolute secret-file path.');
  }
  if (
    environment.NODE_ENV === 'production' &&
    filePath !== KEMERBET_EXECUTOR_DATABASE_SECRET_FILE
  ) {
    throw new Error(
      'KEMERBET_EXECUTOR_DATABASE_URL_FILE must use the approved production secret path.',
    );
  }

  let value: unknown;
  try {
    value = dependencies.readSecretFile
      ? dependencies.readSecretFile(filePath)
      : readVerifiedExecutorDatabaseSecret(filePath, dependencies);
  } catch {
    return executorDatabaseSecretUnavailable();
  }
  return exactExecutorDatabaseSecretValue(value);
}

function decodedUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('KEMERBET_EXECUTOR_DATABASE_URL must use valid percent encoding.');
  }
}

function loadDeploymentTarget(environment: NodeJS.ProcessEnv): KemerBetExecutorDeploymentTarget {
  const value = environment.KEMERBET_EXECUTOR_DEPLOYMENT_TARGET;
  if (value !== 'staging' && value !== 'production') {
    throw new Error(
      'KEMERBET_EXECUTOR_DEPLOYMENT_TARGET must be explicitly set to staging or production.',
    );
  }
  return value;
}

function loadExecutionRuntime(
  environment: NodeJS.ProcessEnv,
  financialActionsMode: FinancialActionsMode,
  executorEnabled: boolean,
  finalActionFeatureEnabled: boolean,
  dependencies: ExecutorConfigDependencies,
): ExecutorConfig['kemerBet']['executionRuntime'] {
  const enabled = booleanFromEnv(
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED,
    false,
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
  );
  if (!enabled) return { enabled: false };
  if (
    environment.NODE_ENV !== 'production' ||
    financialActionsMode !== 'live' ||
    !executorEnabled ||
    !finalActionFeatureEnabled ||
    environment.NODE_EXTRA_CA_CERTS !== KEMERBET_SUPABASE_CA_CERTIFICATE_FILE
  ) {
    throw new Error(
      'The KemerBet execution runtime requires production live mode, both executor switches, and the fixed verified database CA path.',
    );
  }

  const deploymentTarget = loadDeploymentTarget(environment);
  const expectedDatabaseTarget = KEMERBET_EXECUTOR_DATABASE_TARGETS[deploymentTarget];

  const rawConnectionUrl = readExecutorDatabaseSecret(environment, dependencies);
  let url: URL;
  try {
    url = new URL(rawConnectionUrl);
  } catch {
    throw new Error('KEMERBET_EXECUTOR_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const user = decodedUrlComponent(url.username);
  const password = decodedUrlComponent(url.password);
  const database = decodedUrlComponent(url.pathname.slice(1));
  const searchEntries = [...url.searchParams.entries()];
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname !== expectedDatabaseTarget.host ||
    (url.port !== '' && url.port !== '5432') ||
    user !== KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE ||
    password.length === 0 ||
    database !== 'postgres' ||
    url.hash !== '' ||
    searchEntries.length !== 1 ||
    searchEntries[0]?.[0] !== 'sslmode' ||
    searchEntries[0]?.[1] !== 'verify-full'
  ) {
    throw new Error(
      'KEMERBET_EXECUTOR_DATABASE_URL must match the explicit deployment target, exact direct host, dedicated runtime, port 5432, postgres database, and sslmode=verify-full.',
    );
  }
  return {
    enabled: true,
    deploymentTarget,
    projectReference: expectedDatabaseTarget.projectReference,
    tlsMode: 'verify-full',
    connection: {
      database: 'postgres',
      host: expectedDatabaseTarget.host,
      password,
      port: 5432,
      user: KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE,
    },
  };
}

export function loadExecutorConfig(
  environment: NodeJS.ProcessEnv = process.env,
  dependenciesInput: ExecutorConfigDependenciesInput = {},
): ExecutorConfig {
  const dependencies = normalizeDependencies(dependenciesInput);
  assertFrozenProductionSettings(environment);
  const financialActionsMode = loadFinancialActionsMode(environment);
  const executorEnabled = booleanFromEnv(
    environment.KEMERBET_EXECUTOR_ENABLED,
    false,
    'KEMERBET_EXECUTOR_ENABLED',
  );
  const finalActionFeatureEnabled = booleanFromEnv(
    environment.KEMERBET_FINAL_ACTION_ENABLED,
    false,
    'KEMERBET_FINAL_ACTION_ENABLED',
  );
  return {
    ...loadRuntimeConfig(environment),
    financialActionsMode,
    kemerBet: {
      executorEnabled,
      finalActionFeatureEnabled,
      runtimeIsolation: {
        agentIdentityBindingsFile: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
        agentProfilesRoot: KEMERBET_AGENT_PROFILES_ROOT,
        browserExecutablePath: KEMERBET_BROWSER_EXECUTABLE_PATH,
        selectorContractFile: KEMERBET_SELECTOR_CONTRACT_FILE,
        historyReferenceHmacKeyFile: KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE,
        agentIdentityHmacKeyFile: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
        supabaseCaCertificateFile: KEMERBET_SUPABASE_CA_CERTIFICATE_FILE,
        healthHost: KEMERBET_EXECUTOR_HEALTH_HOST,
        healthPort: KEMERBET_EXECUTOR_HEALTH_PORT,
      },
      executionRuntime: loadExecutionRuntime(
        environment,
        financialActionsMode,
        executorEnabled,
        finalActionFeatureEnabled,
        dependencies,
      ),
    },
  };
}

export function redactedExecutorConfigForLog(config: ExecutorConfig): {
  readonly nodeEnv: ExecutorConfig['nodeEnv'];
  readonly logLevel: string;
  readonly financialActionsMode: FinancialActionsMode;
  readonly kemerBet: {
    readonly executorEnabled: boolean;
    readonly finalActionFeatureEnabled: boolean;
    readonly executionRuntime: {
      readonly enabled: boolean;
      readonly connectionConfigured: boolean;
      readonly deploymentTarget: KemerBetExecutorDeploymentTarget | undefined;
      readonly tlsMode: 'verify-full' | undefined;
    };
  };
} {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    financialActionsMode: config.financialActionsMode,
    kemerBet: {
      executorEnabled: config.kemerBet.executorEnabled,
      finalActionFeatureEnabled: config.kemerBet.finalActionFeatureEnabled,
      executionRuntime: {
        enabled: config.kemerBet.executionRuntime.enabled,
        connectionConfigured: config.kemerBet.executionRuntime.enabled,
        deploymentTarget: config.kemerBet.executionRuntime.enabled
          ? config.kemerBet.executionRuntime.deploymentTarget
          : undefined,
        tlsMode: config.kemerBet.executionRuntime.enabled
          ? config.kemerBet.executionRuntime.tlsMode
          : undefined,
      },
    },
  };
}
