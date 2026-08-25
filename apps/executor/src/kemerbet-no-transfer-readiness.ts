import { timingSafeEqual } from 'node:crypto';
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
  loadKemerBetAgentIdentityBindings,
  loadKemerBetNoTransferReadinessPlayerIds,
  loadKemerBetSelectorContract,
  type KemerBetAgentIdentityBindings,
  type KemerBetNoTransferReadinessPlayers,
} from './executor-runtime-isolation.js';
import {
  createKemerBetAgentIdentityFingerprinter,
  type KemerBetAgentIdentityFingerprinter,
} from './kemerbet-agent-identity-fingerprint.js';
import {
  type KemerBetNoTransferReadinessPersistentProfileProbeOptions,
  type KemerBetNoTransferReadinessSealProbe,
} from './kemerbet-no-transfer-readiness-seal.js';
import {
  createKemerBetReadinessBrowserRpcClient,
  loadKemerBetReadinessBrowserRpcCapability,
  type KemerBetReadinessBrowserRpcClient,
} from './kemerbet-readiness-browser-rpc.js';
import {
  loadKemerBetReadinessLayer7Authorizations,
  type KemerBetReadinessLayer7Authorizations,
} from './kemerbet-readiness-layer7-authorizations.js';
import { createKemerBetReadinessControllerIsolatedNetworkRevalidator } from './kemerbet-readiness-network-gate.js';
import { waitForKemerBetReadinessFirewallRelease } from './kemerbet-readiness-firewall-release.js';
import {
  assertKemerBetAgentPageSelectorContractV2,
  type KemerBetAgentPageSelectorContractV2,
} from './playwright-kemerbet-agent-page.js';

const DISALLOWED_ENVIRONMENT_KEYS = [
  'KEMERBET_EXECUTOR_DATABASE_URL',
  'KEMERBET_EXECUTOR_DATABASE_URL_FILE',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE',
  'KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE',
] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FINGERPRINT_PATTERN = /^hmac-sha256-agent-identity-v1:[0-9a-f]{64}$/u;
const KEY_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CONTROLLER_EFFECTIVE_USER_ID = 10002;
const BROWSER_EFFECTIVE_USER_ID = 10001;

export interface KemerBetNoTransferReadinessDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly assertBrowserExecutable?: () => Promise<void>;
  readonly loadAgentIdentityBindings?: () => Promise<KemerBetAgentIdentityBindings>;
  readonly loadPlayerIds?: () => Promise<KemerBetNoTransferReadinessPlayers>;
  readonly loadSelectorContract?: () => Promise<KemerBetAgentPageSelectorContractV2>;
  readonly createAgentIdentityFingerprinter?: () => Promise<KemerBetAgentIdentityFingerprinter>;
  readonly effectiveUserId?: number;
  readonly openProbe?: (
    options: KemerBetNoTransferReadinessPersistentProfileProbeOptions,
  ) => Promise<KemerBetNoTransferReadinessSealProbe>;
  readonly openRpcClient?: () => Promise<KemerBetReadinessBrowserRpcClient>;
  readonly loadLayer7Authorizations?: () => Promise<KemerBetReadinessLayer7Authorizations>;
  readonly createNetworkRevalidator?: () => Promise<() => Promise<void>>;
  readonly waitForFirewallRelease?: () => Promise<void>;
  readonly logSuccess?: (result: {
    readonly component: 'kemerbet_no_transfer_readiness';
    readonly event: 'passed';
    readonly accountsChecked: 1;
    readonly playersChecked: 5;
    readonly currency: 'ETB';
    readonly transferDisabled: true;
    readonly identifiersRedacted: true;
    readonly moneyMoved: false;
  }) => void;
}

export class KemerBetNoTransferReadinessUnavailableError extends Error {
  constructor() {
    super('The KemerBet no-transfer readiness boundary is unavailable.');
    this.name = 'KemerBetNoTransferReadinessUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetNoTransferReadinessUnavailableError();
}

function assertInertEnvironment(environment: NodeJS.ProcessEnv): boolean {
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.KEMERBET_NO_TRANSFER_READINESS_ENABLED !== 'true' ||
    environment.KEMERBET_EXECUTOR_ENABLED !== 'false' ||
    environment.KEMERBET_FINAL_ACTION_ENABLED !== 'false' ||
    environment.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED !== 'false' ||
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED !== 'false' ||
    (environment.KEMERBET_READINESS_BROWSER_RPC_ENABLED !== undefined &&
      environment.KEMERBET_READINESS_BROWSER_RPC_ENABLED !== 'true') ||
    environment.KEMERBET_READINESS_BROWSER_RPC_ORIGIN !== undefined ||
    DISALLOWED_ENVIRONMENT_KEYS.some((key) => environment[key] !== undefined)
  ) {
    return unavailable();
  }
  return environment.KEMERBET_READINESS_BROWSER_RPC_ENABLED === 'true';
}

function validateSelectorContract(value: unknown): KemerBetAgentPageSelectorContractV2 {
  assertKemerBetAgentPageSelectorContractV2(value);
  return value;
}

function defaultSuccessLog(
  result: Parameters<NonNullable<KemerBetNoTransferReadinessDependencies['logSuccess']>>[0],
) {
  console.info(result, 'KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.');
}

async function productionOpenRpcClient(): Promise<KemerBetReadinessBrowserRpcClient> {
  const capability = await loadKemerBetReadinessBrowserRpcCapability({
    effectiveUserId: CONTROLLER_EFFECTIVE_USER_ID,
  });
  try {
    return createKemerBetReadinessBrowserRpcClient({ capability });
  } finally {
    capability.fill(0);
  }
}

function exactFingerprint(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  const comparable =
    rightBytes.length === leftBytes.length ? rightBytes : Buffer.alloc(leftBytes.length);
  const equal = timingSafeEqual(leftBytes, comparable);
  leftBytes.fill(0);
  if (comparable !== rightBytes) comparable.fill(0);
  rightBytes.fill(0);
  return equal && comparable === rightBytes;
}

function reportSuccess(dependencies: KemerBetNoTransferReadinessDependencies): void {
  (dependencies.logSuccess ?? defaultSuccessLog)({
    component: 'kemerbet_no_transfer_readiness',
    event: 'passed',
    accountsChecked: 1,
    playersChecked: 5,
    currency: 'ETB',
    transferDisabled: true,
    identifiersRedacted: true,
    moneyMoved: false,
  });
}

/**
 * Verify one bound, pre-provisioned agent profile and exactly five private Player lookups. This
 * process has no database credential, pilot manifest, history key, amount input, transfer method,
 * or execution loop. It emits only aggregate redacted success.
 */
export async function runKemerBetNoTransferReadiness(
  dependencies: KemerBetNoTransferReadinessDependencies = {},
): Promise<void> {
  const useBrowserRpc = assertInertEnvironment(dependencies.environment ?? process.env);
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (effectiveUserId !== CONTROLLER_EFFECTIVE_USER_ID) return unavailable();
  await (
    dependencies.waitForFirewallRelease ??
    (() => waitForKemerBetReadinessFirewallRelease({ role: 'controller' }))
  )();
  let probe: KemerBetNoTransferReadinessSealProbe | null = null;
  let rpcClient: KemerBetReadinessBrowserRpcClient | null = null;
  let rpcOpened = false;
  let layer7Authorizations: KemerBetReadinessLayer7Authorizations | null = null;
  let revalidateNetworkTopology: (() => Promise<void>) | null = null;
  try {
    if (useBrowserRpc) {
      revalidateNetworkTopology = await (
        dependencies.createNetworkRevalidator ??
        createKemerBetReadinessControllerIsolatedNetworkRevalidator
      )();
    }
    const [bindings, players, fingerprintAgentIdentity] = await Promise.all([
      dependencies.loadAgentIdentityBindings?.() ??
        loadKemerBetAgentIdentityBindings({ filePath: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE }),
      dependencies.loadPlayerIds?.() ??
        loadKemerBetNoTransferReadinessPlayerIds({
          filePath: KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
        }),
      dependencies.createAgentIdentityFingerprinter?.() ??
        createKemerBetAgentIdentityFingerprinter({
          secretFilePath: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
        }),
    ]);
    if (
      bindings.platformAgentAccountIds.length !== 1 ||
      bindings.expectedAgentIdentityBindings.size !== 1 ||
      players.playerIds.length !== 5 ||
      new Set(players.playerIds).size !== 5 ||
      players.playerIds.some((playerId) => !PLAYER_ID_PATTERN.test(playerId)) ||
      !KEY_FINGERPRINT_PATTERN.test(fingerprintAgentIdentity.keyFingerprint)
    ) {
      return unavailable();
    }
    const accountId = bindings.platformAgentAccountIds[0]!;
    const expectedAgentIdentityFingerprint = bindings.expectedAgentIdentityBindings.get(accountId);
    if (
      !UUID_PATTERN.test(accountId) ||
      accountId === '00000000-0000-0000-0000-000000000000' ||
      expectedAgentIdentityFingerprint === undefined ||
      !FINGERPRINT_PATTERN.test(expectedAgentIdentityFingerprint) ||
      [...bindings.expectedAgentIdentityBindings.keys()].some((key) => key !== accountId)
    ) {
      return unavailable();
    }

    if (useBrowserRpc) {
      rpcClient = await (dependencies.openRpcClient ?? productionOpenRpcClient)();
      let rawAgentIdentity: string | null = await rpcClient.open();
      rpcOpened = true;
      let observedAgentIdentityFingerprint: string;
      try {
        observedAgentIdentityFingerprint = fingerprintAgentIdentity(accountId, rawAgentIdentity);
      } catch {
        return unavailable();
      } finally {
        rawAgentIdentity = null;
      }
      if (!exactFingerprint(observedAgentIdentityFingerprint, expectedAgentIdentityFingerprint)) {
        unavailable();
      }
      layer7Authorizations =
        (await dependencies.loadLayer7Authorizations?.()) ??
        (await loadKemerBetReadinessLayer7Authorizations({
          effectiveUserId: CONTROLLER_EFFECTIVE_USER_ID,
        }));
      if (layer7Authorizations.authorizations.length !== players.playerIds.length) unavailable();
      await revalidateNetworkTopology?.();
      for (const [index, playerId] of players.playerIds.entries()) {
        await rpcClient.lookup(playerId, layer7Authorizations.authorizations[index]!);
      }
      await revalidateNetworkTopology?.();
      await rpcClient.finalize();
      reportSuccess(dependencies);
      return;
    }

    const [selectorContract] = await Promise.all([
      dependencies.loadSelectorContract?.() ??
        loadKemerBetSelectorContract({
          filePath: KEMERBET_SELECTOR_CONTRACT_FILE,
          validate: validateSelectorContract,
        }),
      dependencies.assertBrowserExecutable?.() ??
        assertKemerBetBrowserExecutable({ executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH }),
    ]);
    const openProbe = dependencies.openProbe;
    if (openProbe === undefined) unavailable();
    probe = await openProbe({
      accountId,
      effectiveUserId: BROWSER_EFFECTIVE_USER_ID,
      expectedAgentIdentityFingerprint,
      fingerprintAgentIdentity,
      reportForbiddenRequest: () => undefined,
      reportStage: () => undefined,
      selectorContract,
    });
    if (probe.observedAgentIdentityFingerprint !== expectedAgentIdentityFingerprint) unavailable();
    for (const playerId of players.playerIds) {
      const result = await probe.probePlayerLookup({ playerId, currencyCode: 'ETB' });
      if (
        result?.exactPlayerMatch !== true ||
        result.exactCurrencyMatch !== true ||
        result.transferDisabled !== true
      ) {
        return unavailable();
      }
    }
    await probe.finalizeReadOnlyProof();
    reportSuccess(dependencies);
  } catch {
    return unavailable();
  } finally {
    if (rpcOpened) await rpcClient?.close().catch(() => undefined);
    layer7Authorizations = null;
    await probe?.close().catch(() => undefined);
  }
}

export async function runKemerBetNoTransferReadinessMain(
  dependencies: KemerBetNoTransferReadinessDependencies & {
    readonly reportFailure?: () => void;
    readonly setExitCode?: (exitCode: number) => void;
  } = {},
): Promise<void> {
  try {
    await runKemerBetNoTransferReadiness(dependencies);
  } catch {
    (
      dependencies.reportFailure ??
      (() => console.error('FetanAgent KemerBet no-transfer readiness failed closed.'))
    )();
    (dependencies.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runKemerBetNoTransferReadinessMain();
}
