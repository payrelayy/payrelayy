import { readFileSync } from 'node:fs';

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
const AUTHORIZATIONS = PLAYER_IDS.map(
  (_playerId, index) => `v1.${'a'.repeat(32)}.${index + 1}.${String(index + 1).repeat(64)}`,
);

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
  const finalizeReadOnlyProof = vi.fn(async () => undefined);
  const logSuccess = vi.fn();
  const dependencies: KemerBetNoTransferReadinessDependencies = {
    environment: environment(),
    effectiveUserId: 10002,
    waitForFirewallRelease: async () => undefined,
    assertBrowserExecutable: async () => undefined,
    loadAgentIdentityBindings: async () => ({
      platformAgentAccountIds: [ACCOUNT_ID],
      expectedAgentIdentityBindings: new Map([[ACCOUNT_ID, FINGERPRINT]]),
    }),
    loadPlayerIds: async () => ({ playerIds: PLAYER_IDS }),
    loadSelectorContract: async () => ({ version: 2 }) as KemerBetAgentPageSelectorContractV2,
    createAgentIdentityFingerprinter: async () => fingerprinter(),
    reportStage: () => undefined,
    openProbe: async () => ({
      observedAgentIdentityFingerprint: FINGERPRINT,
      providerAuthorizationDigest: () => `sha256-provider-authorization-v1:${'3'.repeat(64)}`,
      async probePlayerLookup(target) {
        probes.push(target.playerId);
        return {
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        };
      },
      finalizeReadOnlyProof,
      close,
    }),
    logSuccess,
    ...overrides,
  };
  return { dependencies, probes, close, finalizeReadOnlyProof, logSuccess };
}

describe('KemerBet server no-transfer readiness', () => {
  it('uses the split RPC path without loading Chromium/profile and pairs five pre-minted tokens', async () => {
    const lookup = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const revalidate = vi.fn(async () => undefined);
    const openProbe = vi.fn();
    const loadSelectorContract = vi.fn();
    const assertBrowserExecutable = vi.fn();
    const test = fixture({
      environment: { ...environment(), KEMERBET_READINESS_BROWSER_RPC_ENABLED: 'true' },
      createNetworkRevalidator: async () => revalidate,
      loadLayer7Authorizations: async () => ({ authorizations: AUTHORIZATIONS }),
      openRpcClient: async () => ({
        open: async () => 'raw-agent-identity',
        lookup,
        finalize,
        close,
      }),
      openProbe,
      loadSelectorContract,
      assertBrowserExecutable,
    });

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).resolves.toBeUndefined();

    expect(lookup.mock.calls).toEqual(
      PLAYER_IDS.map((playerId, index) => [playerId, AUTHORIZATIONS[index]]),
    );
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(openProbe).not.toHaveBeenCalled();
    expect(loadSelectorContract).not.toHaveBeenCalled();
    expect(assertBrowserExecutable).not.toHaveBeenCalled();
  });

  it('records only the fixed controller stage sequence and the first lookup before lookup failure', async () => {
    const successfulStages: string[] = [];
    const successful = fixture({
      environment: { ...environment(), KEMERBET_READINESS_BROWSER_RPC_ENABLED: 'true' },
      createNetworkRevalidator: async () => async () => undefined,
      loadLayer7Authorizations: async () => ({ authorizations: AUTHORIZATIONS }),
      openRpcClient: async () => ({
        open: async () => 'raw-agent-identity',
        lookup: async () => undefined,
        finalize: async () => undefined,
        close: async () => undefined,
      }),
      reportStage: (stage) => successfulStages.push(stage),
    });
    await runKemerBetNoTransferReadiness(successful.dependencies);
    expect(successfulStages).toEqual([
      'controller_bootstrap',
      'controller_rpc_open',
      'controller_identity',
      'controller_authorization',
      'controller_lookup_1',
      'controller_lookup_2',
      'controller_lookup_3',
      'controller_lookup_4',
      'controller_lookup_5',
      'controller_finalize',
      'controller_cleanup',
      'controller_complete',
    ]);

    const failedStages: string[] = [];
    const failed = fixture({
      environment: { ...environment(), KEMERBET_READINESS_BROWSER_RPC_ENABLED: 'true' },
      createNetworkRevalidator: async () => async () => undefined,
      loadLayer7Authorizations: async () => ({ authorizations: AUTHORIZATIONS }),
      openRpcClient: async () => ({
        open: async () => 'raw-agent-identity',
        lookup: async () => {
          throw new Error('fixed test failure');
        },
        finalize: async () => undefined,
        close: async () => undefined,
      }),
      reportStage: (stage) => failedStages.push(stage),
    });
    await expect(runKemerBetNoTransferReadiness(failed.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(failedStages.at(-1)).toBe('controller_lookup_1');
    expect(JSON.stringify(failedStages)).not.toMatch(/PLAYER|raw-agent|v1\./u);
  });

  it('fails closed before controller completion when the successful RPC session cannot close', async () => {
    const stages: string[] = [];
    const close = vi.fn(async () => {
      throw new Error('fixed close failure');
    });
    const test = fixture({
      environment: { ...environment(), KEMERBET_READINESS_BROWSER_RPC_ENABLED: 'true' },
      createNetworkRevalidator: async () => async () => undefined,
      loadLayer7Authorizations: async () => ({ authorizations: AUTHORIZATIONS }),
      openRpcClient: async () => ({
        open: async () => 'raw-agent-identity',
        lookup: async () => undefined,
        finalize: async () => undefined,
        close,
      }),
      reportStage: (stage) => stages.push(stage),
    });

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(stages.at(-1)).toBe('controller_cleanup');
    expect(stages).not.toContain('controller_complete');
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it('checks one bound account and exactly five Players sequentially with aggregate output only', async () => {
    const test = fixture();

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).resolves.toBeUndefined();

    expect(test.probes).toEqual(PLAYER_IDS);
    expect(test.finalizeReadOnlyProof).toHaveBeenCalledOnce();
    expect(test.finalizeReadOnlyProof.mock.invocationCallOrder[0]).toBeLessThan(
      test.logSuccess.mock.invocationCallOrder[0]!,
    );
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
    const failedClose = vi.fn(async () => undefined);
    const test = fixture({
      openProbe: async () => ({
        observedAgentIdentityFingerprint: FINGERPRINT,
        providerAuthorizationDigest: () => `sha256-provider-authorization-v1:${'3'.repeat(64)}`,
        probePlayerLookup: async (target) =>
          target.playerId === PLAYER_IDS[2]
            ? null
            : {
                exactPlayerMatch: true,
                exactCurrencyMatch: true,
                transferDisabled: true,
              },
        finalizeReadOnlyProof: async () => undefined,
        close: failedClose,
      }),
    });

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(failedClose).toHaveBeenCalledOnce();
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

  it('requires controller EUID 10002 before loading any private input', async () => {
    const loadPlayerIds = vi.fn(async () => ({ playerIds: PLAYER_IDS }));
    const test = fixture({ effectiveUserId: 0, loadPlayerIds });

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(loadPlayerIds).not.toHaveBeenCalled();
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it.each([
    [[...PLAYER_IDS.slice(0, 4), PLAYER_IDS[0]]],
    [[...PLAYER_IDS.slice(0, 4), 'PLAYER WITH SPACE']],
    [[...PLAYER_IDS.slice(0, 4), '']],
  ])(
    'rejects duplicate or noncanonical Player IDs before opening the profile',
    async (playerIds) => {
      const openProbe = vi.fn();
      const test = fixture({ loadPlayerIds: async () => ({ playerIds }), openProbe });

      await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
        KemerBetNoTransferReadinessUnavailableError,
      );
      expect(openProbe).not.toHaveBeenCalled();
      expect(test.logSuccess).not.toHaveBeenCalled();
    },
  );

  it('requires the exact sole binding fingerprint and binds it into the persistent probe', async () => {
    const openProbe = vi.fn(async () => ({
      observedAgentIdentityFingerprint: FINGERPRINT,
      providerAuthorizationDigest: () => `sha256-provider-authorization-v1:${'3'.repeat(64)}`,
      probePlayerLookup: async () => ({
        exactPlayerMatch: true as const,
        exactCurrencyMatch: true as const,
        transferDisabled: true as const,
      }),
      finalizeReadOnlyProof: async () => undefined,
      close: async () => undefined,
    }));
    const test = fixture({ openProbe });

    await runKemerBetNoTransferReadiness(test.dependencies);

    expect(openProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        effectiveUserId: 10001,
        expectedAgentIdentityFingerprint: FINGERPRINT,
      }),
    );
    const serialized = JSON.stringify(test.logSuccess.mock.calls);
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain(FINGERPRINT);
  });

  it('rejects an observed identity mismatch before any Player lookup and closes the profile', async () => {
    const probePlayerLookup = vi.fn();
    const close = vi.fn(async () => undefined);
    const test = fixture({
      openProbe: async () => ({
        observedAgentIdentityFingerprint: `hmac-sha256-agent-identity-v1:${'2'.repeat(64)}`,
        providerAuthorizationDigest: () => `sha256-provider-authorization-v1:${'3'.repeat(64)}`,
        probePlayerLookup,
        finalizeReadOnlyProof: async () => undefined,
        close,
      }),
    });

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(probePlayerLookup).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it('does not emit success when final route draining fails', async () => {
    const close = vi.fn(async () => undefined);
    const test = fixture({
      openProbe: async () => ({
        observedAgentIdentityFingerprint: FINGERPRINT,
        providerAuthorizationDigest: () => `sha256-provider-authorization-v1:${'3'.repeat(64)}`,
        probePlayerLookup: async () => ({
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        }),
        finalizeReadOnlyProof: async () => {
          throw new Error('fixed test failure');
        },
        close,
      }),
    });

    await expect(runKemerBetNoTransferReadiness(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessUnavailableError,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it('does not use the generic session registry or history adapter path', () => {
    const source = readFileSync(
      new URL('./kemerbet-no-transfer-readiness.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('createKemerBetReadinessBrowserRpcClient');
    expect(source).toContain('loadKemerBetReadinessLayer7Authorizations');
    expect(source).toContain('await probe.finalizeReadOnlyProof()');
    expect(source).not.toContain('createKemerBetAgentSessionRegistry');
    expect(source).not.toContain('probeReadiness');
    expect(source).not.toContain('fingerprintExternalReference');
    expect(source).not.toContain('kemerbet-deposit-browser-adapter');
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
