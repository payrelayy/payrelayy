import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

const { isAbsolute, resolve } = win32;

const RELEASE_PATTERN = /^(?:[0-9a-f]{40}|local-development)$/u;
const PLATFORM_AGENT_ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const PRODUCTION_COMPANION_EXECUTION_SIGNER_KEY_ID =
  'companion-execution-production-v1' as const;
export const PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7NAIqUp1BqgN1d5qzvSGT_WbZ1Z_LmUSAvI_eUs_OzIeaVtLMKfEzCjg9iqiLy_RQiU-4-WaY8XMtHbEkd6z0g' as const;
export const PRODUCTION_COMPANION_EXECUTION_SIGNER_PUBLIC_KEY_SPKI_SHA256 =
  'sha256:c7028976e436f39a10634631a9e0e610b2b054d78cc7c89f115d6260371d21e2' as const;

export interface WindowsCompanionConfig {
  readonly dataRoot: string;
  readonly executionV2Enabled: boolean;
  readonly executionV2ExpectedPlatformAgentAccountId?: string;
  readonly expectedAgentIdentityProvided: boolean;
  readonly pairingPackageProvided: boolean;
  readonly profileRoot: string;
  readonly releaseSha: string;
  takeExpectedAgentIdentity(): string | undefined;
  takePairingPackage(): string | undefined;
}

function defaultDataRoot(environment: NodeJS.ProcessEnv): string {
  if (existsSync('D:\\')) return 'D:\\FetanAgent Companion';
  const localAppData = environment.LOCALAPPDATA;
  if (!localAppData || !isAbsolute(localAppData)) {
    throw new Error('FetanAgent Companion could not locate a safe Windows data directory.');
  }
  return resolve(localAppData, 'FetanAgent Companion');
}

export function loadWindowsCompanionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WindowsCompanionConfig {
  if (process.platform !== 'win32' && environment.NODE_ENV !== 'test') {
    throw new Error('FetanAgent Companion must run in the interactive Windows user session.');
  }
  const configuredRoot = environment.FETANAGENT_COMPANION_DATA_ROOT;
  if (configuredRoot !== undefined && !isAbsolute(configuredRoot)) {
    throw new Error('FetanAgent Companion data directory must be absolute.');
  }
  const dataRoot = resolve(configuredRoot ?? defaultDataRoot(environment));
  if (!isAbsolute(dataRoot) || dataRoot.length > 220 || /[\u0000-\u001f\u007f]/u.test(dataRoot)) {
    throw new Error('FetanAgent Companion data directory is invalid.');
  }
  const releaseSha = environment.FETANAGENT_COMPANION_RELEASE_SHA ?? 'local-development';
  if (!RELEASE_PATTERN.test(releaseSha)) {
    throw new Error('FetanAgent Companion release identity is invalid.');
  }
  let expectedAgentIdentity = environment.FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY;
  if (
    expectedAgentIdentity !== undefined &&
    (expectedAgentIdentity.length < 1 ||
      expectedAgentIdentity !== expectedAgentIdentity.trim() ||
      Buffer.byteLength(expectedAgentIdentity, 'utf8') > 256 ||
      /[\u0000-\u001f\u007f]/u.test(expectedAgentIdentity))
  ) {
    throw new Error('FetanAgent Companion expected agent identity is invalid.');
  }
  delete environment.FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY;
  const expectedAgentIdentityProvided = expectedAgentIdentity !== undefined;
  let pairingPackage = environment.FETANAGENT_COMPANION_PAIRING_PACKAGE;
  if (
    pairingPackage !== undefined &&
    (pairingPackage.length < 1 ||
      pairingPackage.length > 8_192 ||
      pairingPackage !== pairingPackage.trim() ||
      /[\u0000-\u001f\u007f]/u.test(pairingPackage))
  ) {
    throw new Error('FetanAgent Companion pairing package is invalid.');
  }
  delete environment.FETANAGENT_COMPANION_PAIRING_PACKAGE;
  const pairingPackageProvided = pairingPackage !== undefined;
  const executionFlag = environment.INTERNAL_COMPANION_EXECUTION_V2_ENABLED;
  if (executionFlag !== undefined && executionFlag !== 'true') {
    throw new Error('FetanAgent Companion execution-v2 feature state is invalid.');
  }
  const executionV2Enabled = executionFlag === 'true';
  const executionV2ExpectedPlatformAgentAccountId =
    environment.FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID;
  if (
    executionV2ExpectedPlatformAgentAccountId !== undefined &&
    !PLATFORM_AGENT_ACCOUNT_ID_PATTERN.test(executionV2ExpectedPlatformAgentAccountId)
  ) {
    throw new Error('FetanAgent Companion execution-v2 account binding is invalid.');
  }
  if (executionV2Enabled && executionV2ExpectedPlatformAgentAccountId === undefined) {
    throw new Error('FetanAgent Companion execution-v2 account binding is required.');
  }
  return Object.freeze({
    dataRoot,
    executionV2Enabled,
    ...(executionV2ExpectedPlatformAgentAccountId === undefined
      ? {}
      : { executionV2ExpectedPlatformAgentAccountId }),
    expectedAgentIdentityProvided,
    pairingPackageProvided,
    profileRoot: resolve(dataRoot, 'profiles', 'kemerbet', 'primary'),
    releaseSha,
    takeExpectedAgentIdentity: () => {
      const value = expectedAgentIdentity;
      expectedAgentIdentity = undefined;
      return value;
    },
    takePairingPackage: () => {
      const value = pairingPackage;
      pairingPackage = undefined;
      return value;
    },
  });
}

export function redactedWindowsCompanionConfig(config: WindowsCompanionConfig) {
  return Object.freeze({
    dataRootConfigured: config.dataRoot.length > 0,
    executionV2Enabled: config.executionV2Enabled,
    executionV2ExpectedAccountConfigured:
      config.executionV2ExpectedPlatformAgentAccountId !== undefined,
    expectedAgentIdentityProvided: config.expectedAgentIdentityProvided,
    pairingPackageProvided: config.pairingPackageProvided,
    profileConfigured: config.profileRoot.length > 0,
    releaseSha: config.releaseSha,
  });
}
