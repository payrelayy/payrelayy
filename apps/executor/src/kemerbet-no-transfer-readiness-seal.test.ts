import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import {
  isAllowedKemerBetReadinessSealRequest,
  KemerBetNoTransferReadinessSealUnavailableError,
  runKemerBetNoTransferReadinessSeal,
  runKemerBetNoTransferReadinessSealMain,
  type KemerBetNoTransferReadinessSealDependencies,
} from './kemerbet-no-transfer-readiness-seal.js';
import type { KemerBetAgentPageSelectorContractV2 } from './playwright-kemerbet-agent-page.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_IDS = ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'] as const;
const FINGERPRINT = `hmac-sha256-agent-identity-v1:${'1'.repeat(64)}`;

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    FINANCIAL_ACTIONS_MODE: 'dry_run',
    KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'true',
    KEMERBET_AGENT_IDENTITY_BINDING_ACCOUNT_ID: ACCOUNT_ID,
    KEMERBET_EXECUTOR_ENABLED: 'false',
    KEMERBET_FINAL_ACTION_ENABLED: 'false',
    KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
    INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
  };
}

function fingerprinter(): KemerBetAgentIdentityFingerprinter {
  return Object.assign(() => FINGERPRINT, { keyFingerprint: '2'.repeat(64) });
}

function fixture(overrides: Partial<KemerBetNoTransferReadinessSealDependencies> = {}) {
  const probes: string[] = [];
  const close = vi.fn(async () => undefined);
  const writeBinding = vi.fn(async () => undefined);
  const logSuccess = vi.fn();
  const dependencies: KemerBetNoTransferReadinessSealDependencies = {
    environment: environment(),
    effectiveUserId: 10001,
    assertBrowserExecutable: async () => undefined,
    loadPlayerIds: async () => ({ playerIds: PLAYER_IDS }),
    loadSelectorContract: async () => ({ version: 2 }) as KemerBetAgentPageSelectorContractV2,
    createAgentIdentityFingerprinter: async () => fingerprinter(),
    openProbe: async () => ({
      observedAgentIdentityFingerprint: FINGERPRINT,
      async probePlayerLookup(target) {
        probes.push(target.playerId);
        return {
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        };
      },
      close,
    }),
    writeBinding,
    logSuccess,
    ...overrides,
  };
  return { dependencies, probes, close, writeBinding, logSuccess };
}

describe('KemerBet no-transfer readiness seal', () => {
  it('reuses the exact signed-in page without navigating or reloading it', () => {
    const source = readFileSync(
      new URL('./kemerbet-no-transfer-readiness-seal.ts', import.meta.url),
      'utf8',
    );
    const start = source.indexOf(
      'export async function createKemerBetNoTransferReadinessSealProbeFromPage',
    );
    const end = source.indexOf('async function productionOpenProbe', start);
    const body = start >= 0 && end > start ? source.slice(start, end) : undefined;

    expect(body).toBeDefined();
    expect(body).toContain('options.page.url() !== KEMERBET_AGENT_DEPOSIT_URL');
    expect(body).toContain('await agentPage.adoptCurrentDepositPageWithoutNavigation()');
    expect(body).toContain('forceReadOnlyLookupClick: true');
    expect(body).toContain('reportLookupStage: (stage) => options.reportStage?.(stage)');
    expect(body).not.toContain('createKemerBetDepositBrowser');
    expect(body).not.toContain('.goto(');
    expect(body).not.toContain('.reload(');
  });

  it('binds one redacted identity only after exactly five sequential lookup proofs', async () => {
    const test = fixture();

    await expect(runKemerBetNoTransferReadinessSeal(test.dependencies)).resolves.toBeUndefined();

    expect(test.probes).toEqual(PLAYER_IDS);
    expect(test.writeBinding).toHaveBeenCalledWith(ACCOUNT_ID, FINGERPRINT, 10001);
    expect(test.close).toHaveBeenCalledOnce();
    expect(test.logSuccess).toHaveBeenCalledWith({
      component: 'kemerbet_no_transfer_readiness_seal',
      event: 'sealed',
      accountsBound: 1,
      playersChecked: 5,
      currency: 'ETB',
      transferDisabled: true,
      identifiersRedacted: true,
      moneyMoved: false,
    });
    expect(JSON.stringify(test.logSuccess.mock.calls)).not.toMatch(/PLAYER-|hmac-sha256/u);
  });

  it('reports only fixed, redacted workflow stages', async () => {
    const stages: string[] = [];
    const test = fixture({ reportStage: (stage) => stages.push(stage) });

    await runKemerBetNoTransferReadinessSeal(test.dependencies);

    expect(stages).toEqual([
      'environment_guard',
      'readiness_inputs',
      'signed_in_page',
      'binding_write',
    ]);
    expect(JSON.stringify(stages)).not.toMatch(/PLAYER-|hmac-sha256|11111111/iu);
  });

  it.each([
    ['FINANCIAL_ACTIONS_MODE', 'live'],
    ['KEMERBET_EXECUTOR_ENABLED', 'true'],
    ['KEMERBET_FINAL_ACTION_ENABLED', 'true'],
    ['KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED', 'true'],
    ['INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED', 'true'],
    ['KEMERBET_EXECUTOR_DATABASE_URL_FILE', '/run/secrets/database'],
    ['KEMERBET_AGENT_IDENTITY_BINDINGS_FILE', '/run/secrets/bindings'],
    ['KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE', '/run/secrets/history'],
  ])('fails before opening a profile when %s is %s', async (key, value) => {
    const openProbe = vi.fn();
    const test = fixture({ environment: { ...environment(), [key]: value }, openProbe });

    await expect(runKemerBetNoTransferReadinessSeal(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );
    expect(openProbe).not.toHaveBeenCalled();
    expect(test.writeBinding).not.toHaveBeenCalled();
  });

  it('closes the browser and emits no binding when any Player lookup is unavailable', async () => {
    const close = vi.fn(async () => undefined);
    const test = fixture({
      openProbe: async () => ({
        observedAgentIdentityFingerprint: FINGERPRINT,
        probePlayerLookup: async (target) =>
          target.playerId === PLAYER_IDS[2]
            ? null
            : {
                exactPlayerMatch: true,
                exactCurrencyMatch: true,
                transferDisabled: true,
              },
        close,
      }),
    });

    await expect(runKemerBetNoTransferReadinessSeal(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(test.writeBinding).not.toHaveBeenCalled();
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it('rejects a non-exact or duplicate five-Player cohort before opening the profile', async () => {
    for (const playerIds of [PLAYER_IDS.slice(0, 4), [...PLAYER_IDS.slice(0, 4), PLAYER_IDS[0]]]) {
      const openProbe = vi.fn();
      const test = fixture({ loadPlayerIds: async () => ({ playerIds }), openProbe });
      await expect(runKemerBetNoTransferReadinessSeal(test.dependencies)).rejects.toBeInstanceOf(
        KemerBetNoTransferReadinessSealUnavailableError,
      );
      expect(openProbe).not.toHaveBeenCalled();
    }
  });

  it('admits only read requests and the exact Agent main-frame navigation', () => {
    expect(
      isAllowedKemerBetReadinessSealRequest({
        isMainFrame: true,
        isNavigationRequest: true,
        method: 'GET',
        requestUrl: 'https://agentsystem.admindigi.com/agents',
      }),
    ).toBe(true);
    expect(
      isAllowedKemerBetReadinessSealRequest({
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
      }),
    ).toBe(true);
    for (const candidate of [
      {
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'POST',
        requestUrl: 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit',
      },
      {
        isMainFrame: true,
        isNavigationRequest: true,
        method: 'GET',
        requestUrl: 'https://agentsystem.admindigi.com/login?et=1',
      },
      {
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'GET',
        requestUrl: 'http://agentsystem.admindigi.com/agents',
      },
    ]) {
      expect(isAllowedKemerBetReadinessSealRequest(candidate)).toBe(false);
    }
  });

  it('reports only a fixed generic main-process failure', async () => {
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    await runKemerBetNoTransferReadinessSealMain({
      ...fixture().dependencies,
      environment: { ...environment(), FINANCIAL_ACTIONS_MODE: 'live' },
      reportFailure,
      setExitCode,
    });
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});
