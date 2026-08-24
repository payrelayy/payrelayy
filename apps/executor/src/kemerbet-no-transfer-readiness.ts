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
  openKemerBetNoTransferReadinessPersistentProfileProbe,
  type KemerBetNoTransferReadinessPersistentProfileProbeOptions,
  type KemerBetNoTransferReadinessSealProbe,
} from './kemerbet-no-transfer-readiness-seal.js';
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

function assertInertEnvironment(environment: NodeJS.ProcessEnv): void {
  if (
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.KEMERBET_NO_TRANSFER_READINESS_ENABLED !== 'true' ||
    environment.KEMERBET_EXECUTOR_ENABLED !== 'false' ||
    environment.KEMERBET_FINAL_ACTION_ENABLED !== 'false' ||
    environment.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED !== 'false' ||
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED !== 'false' ||
    DISALLOWED_ENVIRONMENT_KEYS.some((key) => environment[key] !== undefined)
  ) {
    return unavailable();
  }
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

/**
 * Verify one bound, pre-provisioned agent profile and exactly five private Player lookups. This
 * process has no database credential, pilot manifest, history key, amount input, transfer method,
 * or execution loop. It emits only aggregate redacted success.
 */
export async function runKemerBetNoTransferReadiness(
  dependencies: KemerBetNoTransferReadinessDependencies = {},
): Promise<void> {
  assertInertEnvironment(dependencies.environment ?? process.env);
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  if (effectiveUserId !== 10001) return unavailable();
  let probe: KemerBetNoTransferReadinessSealProbe | null = null;
  try {
    const [bindings, players, selectorContract, fingerprintAgentIdentity] = await Promise.all([
      dependencies.loadAgentIdentityBindings?.() ??
        loadKemerBetAgentIdentityBindings({ filePath: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE }),
      dependencies.loadPlayerIds?.() ??
        loadKemerBetNoTransferReadinessPlayerIds({
          filePath: KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,
        }),
      dependencies.loadSelectorContract?.() ??
        loadKemerBetSelectorContract({
          filePath: KEMERBET_SELECTOR_CONTRACT_FILE,
          validate: validateSelectorContract,
        }),
      dependencies.createAgentIdentityFingerprinter?.() ??
        createKemerBetAgentIdentityFingerprinter({
          secretFilePath: KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,
        }),
      dependencies.assertBrowserExecutable?.() ??
        assertKemerBetBrowserExecutable({ executablePath: KEMERBET_BROWSER_EXECUTABLE_PATH }),
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
    probe = await (dependencies.openProbe ?? openKemerBetNoTransferReadinessPersistentProfileProbe)(
      {
        accountId,
        effectiveUserId,
        expectedAgentIdentityFingerprint,
        fingerprintAgentIdentity,
        reportForbiddenRequest: () => undefined,
        reportStage: () => undefined,
        selectorContract,
      },
    );
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
  } catch {
    return unavailable();
  } finally {
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
