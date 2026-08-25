import { timingSafeEqual } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';

import {
  KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
  KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
  KEMERBET_BROWSER_EXECUTABLE_PATH,
  KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
  KEMERBET_SELECTOR_CONTRACT_FILE,
} from '@fetanagent/config/executor';

import {
  assertKemerBetBrowserExecutable,
  loadKemerBetSelectorContract,
} from './executor-runtime-isolation.js';
import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import { loadKemerBetReadinessAccountId } from './kemerbet-readiness-account-id.js';
import {
  openKemerBetNoTransferReadinessPersistentProfileProbe,
  type KemerBetNoTransferReadinessPersistentProfileProbeOptions,
  type KemerBetNoTransferReadinessSealProbe,
} from './kemerbet-no-transfer-readiness-seal.js';
import {
  KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4,
  loadKemerBetReadinessBrowserRpcCapability,
  startKemerBetReadinessBrowserRpcServer,
  type KemerBetReadinessBrowserDriverSession,
  type KemerBetReadinessBrowserRpcServerHandle,
} from './kemerbet-readiness-browser-rpc.js';
import {
  KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,
  KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE,
} from './kemerbet-readiness-layer7-authorization.js';
import { KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE } from './kemerbet-readiness-layer7-authorizations.js';
import { createKemerBetReadinessFixedIsolatedNetworkRevalidator } from './kemerbet-readiness-network-gate.js';
import { waitForKemerBetReadinessFirewallRelease } from './kemerbet-readiness-firewall-release.js';
import {
  assertKemerBetAgentPageSelectorContractV2,
  type KemerBetAgentPageSelectorContractV2,
} from './playwright-kemerbet-agent-page.js';

const DRIVER_EFFECTIVE_USER_ID = 10001;
const LAYER7_PROXY_IPV4 = '172.31.254.10';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RAW_IDENTITY_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const SPKI_SHA256_PATTERN = /^[A-Za-z0-9+/]{43}=$/u;
const INTERNAL_IDENTITY_SENTINEL = `hmac-sha256-agent-identity-v1:${'0'.repeat(64)}`;
const SENSITIVE_PATHS = Object.freeze([
  KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,
  KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
  KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
  KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE,
  KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,
  KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE,
  '/run/output',
  '/run/fetanagent-kemerbet-readiness-seal-output',
] as const);
const DISALLOWED_ENVIRONMENT_KEYS = Object.freeze([
  'KEMERBET_EXECUTOR_DATABASE_URL',
  'KEMERBET_EXECUTOR_DATABASE_URL_FILE',
  'KEMERBET_AGENT_IDENTITY_BINDINGS_FILE',
  'KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE',
  'KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE',
  'KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE',
] as const);

export interface KemerBetReadinessBrowserDriverDependencies {
  readonly assertBrowserExecutable?: () => Promise<void>;
  readonly assertSensitivePathsAbsent?: () => Promise<void>;
  readonly createControlIpv4Revalidator?: () => Promise<() => Promise<void>>;
  readonly createNetworkRevalidator?: () => Promise<() => Promise<void>>;
  readonly effectiveUserId?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly loadCapability?: () => Promise<Buffer>;
  readonly loadAccountId?: () => Promise<string>;
  readonly loadSelectorContract?: () => Promise<KemerBetAgentPageSelectorContractV2>;
  readonly openProbe?: (
    options: KemerBetNoTransferReadinessPersistentProfileProbeOptions,
  ) => Promise<KemerBetNoTransferReadinessSealProbe>;
  readonly startServer?: (options: {
    readonly capability: Buffer;
    readonly host: string;
    readonly openSession: () => Promise<KemerBetReadinessBrowserDriverSession>;
  }) => Promise<KemerBetReadinessBrowserRpcServerHandle>;
  readonly waitForFirewallRelease?: () => Promise<void>;
}

export class KemerBetReadinessBrowserDriverUnavailableError extends Error {
  constructor() {
    super('The KemerBet readiness browser driver is unavailable.');
    this.name = 'KemerBetReadinessBrowserDriverUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetReadinessBrowserDriverUnavailableError();
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function assertEnvironment(environment: NodeJS.ProcessEnv): {
  readonly proxyIpv4: string;
  readonly proxySpkiSha256: string;
} {
  const proxyIpv4 = environment.KEMERBET_READINESS_L7_PROXY_IPV4;
  const proxySpkiSha256 = environment.KEMERBET_READINESS_L7_PROXY_SPKI_SHA256;
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.KEMERBET_READINESS_BROWSER_DRIVER_ENABLED !== 'true' ||
    environment.KEMERBET_EXECUTOR_ENABLED !== 'false' ||
    environment.KEMERBET_FINAL_ACTION_ENABLED !== 'false' ||
    environment.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED !== 'false' ||
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED !== 'false' ||
    environment.KEMERBET_AGENT_IDENTITY_BINDING_ACCOUNT_ID !== undefined ||
    proxyIpv4 === undefined ||
    proxyIpv4 !== LAYER7_PROXY_IPV4 ||
    proxySpkiSha256 === undefined ||
    !SPKI_SHA256_PATTERN.test(proxySpkiSha256) ||
    DISALLOWED_ENVIRONMENT_KEYS.some((key) => environment[key] !== undefined)
  ) {
    return unavailable();
  }
  return { proxyIpv4, proxySpkiSha256 };
}

export async function createKemerBetReadinessBrowserControlIpv4Revalidator(
  options: {
    readonly captureNetworkInterfaces?: typeof networkInterfaces;
  } = {},
): Promise<() => Promise<void>> {
  const capture = options.captureNetworkInterfaces ?? networkInterfaces;
  const observe = (): string => {
    const matches = Object.entries(capture()).flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter(
          (address) =>
            address.family === 'IPv4' &&
            !address.internal &&
            address.address === KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4,
        )
        .map(() => name),
    );
    if (matches.length !== 1 || !/^[A-Za-z0-9_.-]{1,32}$/u.test(matches[0] ?? '')) unavailable();
    return matches[0]!;
  };
  const expectedInterface = observe();
  const revalidate = async (): Promise<void> => {
    if (observe() !== expectedInterface) unavailable();
  };
  await revalidate();
  return revalidate;
}

async function assertSensitivePathsAbsent(): Promise<void> {
  for (const path of SENSITIVE_PATHS) {
    try {
      await lstat(path);
      unavailable();
    } catch (error) {
      if (!isMissing(error)) unavailable();
    }
  }
}

function validateSelectorContract(value: unknown): KemerBetAgentPageSelectorContractV2 {
  assertKemerBetAgentPageSelectorContractV2(value);
  return value;
}

export function createKemerBetReadinessRawIdentityCapture(accountId: string): {
  readonly destroy: () => void;
  readonly fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter;
  readonly takeIdentity: () => string;
} {
  if (!UUID_PATTERN.test(accountId) || accountId === '00000000-0000-0000-0000-000000000000') {
    unavailable();
  }
  let captured: Buffer | null = null;
  const fingerprintAgentIdentity = Object.assign(
    (observedAccountId: string, rawIdentity: string): string => {
      if (observedAccountId !== accountId || !RAW_IDENTITY_PATTERN.test(rawIdentity)) unavailable();
      const candidate = Buffer.from(rawIdentity, 'utf8');
      if (candidate.length < 1 || candidate.length > 1_024) unavailable();
      if (captured === null) {
        captured = Buffer.from(candidate);
      } else {
        const sameLength = candidate.length === captured.length;
        const comparable = sameLength ? candidate : Buffer.alloc(captured.length);
        const equal = timingSafeEqual(comparable, captured);
        if (!sameLength) comparable.fill(0);
        if (!sameLength || !equal) unavailable();
      }
      candidate.fill(0);
      return INTERNAL_IDENTITY_SENTINEL;
    },
    { keyFingerprint: '0'.repeat(64) },
  ) as KemerBetAgentIdentityFingerprinter;
  return Object.freeze({
    destroy: () => {
      captured?.fill(0);
      captured = null;
    },
    fingerprintAgentIdentity,
    takeIdentity: () => {
      if (captured === null) unavailable();
      const identity = captured.toString('utf8');
      if (!RAW_IDENTITY_PATTERN.test(identity)) unavailable();
      return identity;
    },
  });
}

async function openBrowserDriverSession(options: {
  readonly accountId: string;
  readonly effectiveUserId: number;
  readonly openProbe: NonNullable<KemerBetReadinessBrowserDriverDependencies['openProbe']>;
  readonly proxyIpv4: string;
  readonly proxySpkiSha256: string;
  readonly revalidateNetworkTopology: () => Promise<void>;
  readonly selectorContract: KemerBetAgentPageSelectorContractV2;
}): Promise<KemerBetReadinessBrowserDriverSession> {
  const capture = createKemerBetReadinessRawIdentityCapture(options.accountId);
  let probe: KemerBetNoTransferReadinessSealProbe | null = null;
  try {
    probe = await options.openProbe({
      accountId: options.accountId,
      effectiveUserId: options.effectiveUserId,
      fingerprintAgentIdentity: capture.fingerprintAgentIdentity,
      isolatedBrowserDriverBoundary: {
        proxyIpv4: options.proxyIpv4,
        proxySpkiSha256: options.proxySpkiSha256,
        revalidateNetworkTopology: options.revalidateNetworkTopology,
      },
      reportForbiddenRequest: () => undefined,
      reportStage: () => undefined,
      selectorContract: options.selectorContract,
    });
    const retainedProbe = probe;
    const agentIdentity = capture.takeIdentity();
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      try {
        await retainedProbe.close();
      } finally {
        capture.destroy();
        closed = true;
      }
    };
    return Object.freeze({
      agentIdentity,
      lookup: async (playerId: string, layer7Authorization: string) => {
        const result = await retainedProbe.probePlayerLookup({
          playerId,
          currencyCode: 'ETB',
          layer7Authorization,
        });
        if (
          result?.exactPlayerMatch !== true ||
          result.exactCurrencyMatch !== true ||
          result.transferDisabled !== true
        ) {
          unavailable();
        }
      },
      finalize: retainedProbe.finalizeReadOnlyProof,
      close,
    });
  } catch {
    await probe?.close().catch(() => undefined);
    capture.destroy();
    return unavailable();
  }
}

export async function runKemerBetReadinessBrowserDriver(
  dependencies: KemerBetReadinessBrowserDriverDependencies = {},
): Promise<void> {
  let capability: Buffer | null = null;
  let server: KemerBetReadinessBrowserRpcServerHandle | null = null;
  try {
    const environment = dependencies.environment ?? process.env;
    const config = assertEnvironment(environment);
    const effectiveUserId =
      dependencies.effectiveUserId ??
      (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
    if (effectiveUserId !== DRIVER_EFFECTIVE_USER_ID) unavailable();
    await (
      dependencies.waitForFirewallRelease ??
      (() => waitForKemerBetReadinessFirewallRelease({ role: 'browser' }))
    )();
    await (dependencies.assertSensitivePathsAbsent ?? assertSensitivePathsAbsent)();
    const [revalidateNetworkTopology, revalidateControlIpv4] = await Promise.all([
      dependencies.createNetworkRevalidator?.() ??
        createKemerBetReadinessFixedIsolatedNetworkRevalidator(),
      dependencies.createControlIpv4Revalidator?.() ??
        createKemerBetReadinessBrowserControlIpv4Revalidator(),
      dependencies.assertBrowserExecutable?.() ??
        assertKemerBetBrowserExecutable({ executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH }),
    ]);
    const accountId =
      (await dependencies.loadAccountId?.()) ??
      (await loadKemerBetReadinessAccountId({ effectiveUserId: DRIVER_EFFECTIVE_USER_ID }));
    const selectorContract =
      (await dependencies.loadSelectorContract?.()) ??
      (await loadKemerBetSelectorContract({
        filePath: KEMERBET_SELECTOR_CONTRACT_FILE,
        validate: validateSelectorContract,
      }));
    capability =
      (await dependencies.loadCapability?.()) ??
      (await loadKemerBetReadinessBrowserRpcCapability({
        effectiveUserId: DRIVER_EFFECTIVE_USER_ID,
      }));
    const openProbe =
      dependencies.openProbe ?? openKemerBetNoTransferReadinessPersistentProfileProbe;
    const startServer = dependencies.startServer ?? startKemerBetReadinessBrowserRpcServer;
    await revalidateNetworkTopology();
    await revalidateControlIpv4();
    server = await startServer({
      capability,
      host: KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4,
      openSession: () =>
        openBrowserDriverSession({
          ...config,
          accountId,
          effectiveUserId,
          openProbe,
          revalidateNetworkTopology,
          selectorContract,
        }),
    });
    await revalidateNetworkTopology();
    await revalidateControlIpv4();
    if ((await server.completed) !== 'succeeded') unavailable();
  } catch {
    return unavailable();
  } finally {
    await server?.close().catch(() => undefined);
    capability?.fill(0);
  }
}

export async function runKemerBetReadinessBrowserDriverMain(
  dependencies: KemerBetReadinessBrowserDriverDependencies & {
    readonly setExitCode?: (exitCode: number) => void;
  } = {},
): Promise<void> {
  try {
    await runKemerBetReadinessBrowserDriver(dependencies);
  } catch {
    (dependencies.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runKemerBetReadinessBrowserDriverMain();
}

export const KEMERBET_READINESS_BROWSER_DRIVER_CONTRACT = Object.freeze({
  controlIpv4: KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4,
  effectiveUserId: DRIVER_EFFECTIVE_USER_ID,
  layer7ProxyIpv4: LAYER7_PROXY_IPV4,
  sensitivePaths: SENSITIVE_PATHS,
});
