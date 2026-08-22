import { describe, expect, it, vi } from 'vitest';

import {
  KemerBetNoTransferReadinessUnavailableError,
  runKemerBetNoTransferReadiness,
  runKemerBetNoTransferReadinessMain,
  type KemerBetNoTransferReadinessDependencies,
} from './kemerbet-no-transfer-readiness.js';
import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import type { KemerBetAgentPageSelectorContractV2 } from './playwright-kemerbet-agent-page.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_IDS = ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'] as const;
const FINGERPRINT = `hmac-sha256-agent-identity-v1:${'1'.repeat(64)}`;

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    FINANCIAL_ACTIONS_MODE: 'dry_run',
    KEMERBET_NO_TRANSFER_READINESS_ENABLED: 'true',
    KEMERBET_EXECUTOR_ENABLED: 'false',
    KEMERBET_FINAL_ACTION_ENABLED: 'false',
    KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
    INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
  };
}

function fingerprinter(): KemerBetAgentIdentityFingerprinter {
  const value = () => FINGERPRINT;
  return Object.defineProperty(value, 'keyFingerprint', {
    value: '1'.repeat(64),
  }) as unknown as KemerBetAgentIdentityFingerprinter;
}

function fixture(overrides: Partial<KemerBetNoTransferReadinessDependencies> = {}) {
  const probes: string[] = [];
  const close = vi.fn(async () => undefined);
  const logSuccess = vi.fn();
  const dependencies: KemerBetNoTransferReadinessDependencies = {
    environment: environment(),
    assertBrowserExecutable: async () => undefined,
    loadAgentIdentityBindings: async () => ({
      platformAgentAccountIds: [ACCOUNT_ID],
      expectedAgentIdentityBindings: new Map([[ACCOUNT_ID, FINGERPRINT]]),
    }),
    loadPlayerIds: async () => ({ playerIds: PLAYER_IDS }),
    loadSelectorContract: async () => ({ version: 2 }) as KemerBetAgentPageSelectorContractV2,
    createAgentIdentityFingerprinter: async () => fingerprinter(),
    createRegistry: () => ({
      probeReadiness: async () => ({ ready: true, reason: 'ready' }),
      async probePlayerLookup(_accountId, target) {
        probes.push(target.playerId);
        return {
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        };
      },
      close,
    }),
    logSuccess,
    ...overrides,
  };
  return { dependencies, probes, close, logSuccess };
}

describe('KemerBet server no-transfer readiness', () => {
  it('checks one bound account and exactly five Players sequentially with aggregate output only', async () => {
    const test = fixture();

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).resolves.toBeUndefined();

    expect(test.probes).toEqual(PLAYER_IDS);
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.logSuccess).toHaveBeenCalledWith({
      component: 'kemerbet_no_transfer_readiness',
      event: 'passed',
      accountsChecked: 1,
      playersChecked: 5,
      currency: 'ETB',
      transferDisabled: true,
      identifiersRedacted: true,
      moneyMoved: false,
    });
    expect(JSON.stringify(test.logSuccess.mock.calls)).not.toMatch(/PLAYER-/u);
  });

  it.each([
    ['FINANCIAL_ACTIONS_MODE', 'live'],
    ['KEMERBET_EXECUTOR_ENABLED', 'true'],
    ['KEMERBET_FINAL_ACTION_ENABLED', 'true'],
    ['KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED', 'true'],
    ['INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED', 'true'],
    ['KEMERBET_EXECUTOR_DATABASE_URL_FILE', '/run/secrets/database'],
    ['KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE', '/run/secrets/history'],
  ])('fails before loading inputs when %s is %s', async (key, value) => {
    const loadPlayerIds = vi.fn(async () => ({ playerIds: PLAYER_IDS }));
    const test = fixture({ environment: { ...environment(), [key]: value }, loadPlayerIds });

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(loadPlayerIds).not.toHaveBeenCalled();
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it('fails closed, emits no aggregate success, and closes the profile when one lookup is unavailable', async () => {
    const test = fixture({
      createRegistry: () => ({
        probeReadiness: async () => ({ ready: true, reason: 'ready' }),
        probePlayerLookup: async (_accountId, target) =>
          target.playerId === PLAYER_IDS[2]
            ? null
            : {
                exactPlayerMatch: true,
                exactCurrencyMatch: true,
                transferDisabled: true,
              },
        close: testClose,
      }),
    });
    const testClose = test.close;

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(testClose).toHaveBeenCalledOnce();
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it('rejects any cohort or binding cardinality other than exact five and one', async () => {
    const fourPlayers = fixture({
      loadPlayerIds: async () => ({ playerIds: PLAYER_IDS.slice(0, 4) }),
    });
    await expect(runKemerBetNoTransferReadiness(fourPlayers.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );

    const twoAccounts = fixture({
      loadAgentIdentityBindings: async () => ({
        platformAgentAccountIds: [ACCOUNT_ID, '22222222-2222-4222-8222-222222222222'],
        expectedAgentIdentityBindings: new Map([
          [ACCOUNT_ID, FINGERPRINT],
          [
            '22222222-2222-4222-8222-222222222222',
            `hmac-sha256-agent-identity-v1:${'2'.repeat(64)}`,
          ],
        ]),
      }),
    });
    await expect(runKemerBetNoTransferReadiness(twoAccounts.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
  });

  it('reports only a fixed generic main-process failure', async () => {
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    await runKemerBetNoTransferReadinessMain({
      ...fixture().dependencies,
      environment: { ...environment(), FINANCIAL_ACTIONS_MODE: 'live' },
      reportFailure,
      setExitCode,
    });
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});
