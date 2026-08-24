import { readFileSync } from 'node:fs';

import type { Page, Route } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import {
  createKemerBetNoTransferReadinessSealProbeFromPage,
  guardKemerBetReadinessSealRoute,
  isAllowedKemerBetReadinessSealRequest,
  isExactKemerBetReadinessSealPlayerLookupRequest,
  KemerBetNoTransferReadinessSealUnavailableError,
  runKemerBetNoTransferReadinessSeal,
  runKemerBetNoTransferReadinessSealMain,
  type KemerBetNoTransferReadinessSealDependencies,
} from './kemerbet-no-transfer-readiness-seal.js';
import {
  KEMERBET_AGENT_DEPOSIT_URL,
  type KemerBetAgentPageSelectorContractV2,
} from './playwright-kemerbet-agent-page.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_IDS = ['PLAYER-1', 'PLAYER-2', 'PLAYER-3', 'PLAYER-4', 'PLAYER-5'] as const;
const FINGERPRINT = `hmac-sha256-agent-identity-v1:${'1'.repeat(64)}`;
const SELECTOR_CONTRACT = JSON.parse(
  readFileSync(
    new URL('../../../infra/config/kemerbet-selector-contract.v2.json', import.meta.url),
    'utf8',
  ),
) as KemerBetAgentPageSelectorContractV2;

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

function guardedRouteFixture(input: {
  readonly method: string;
  readonly requestUrl: string;
  readonly isMainFrame?: boolean;
  readonly isNavigationRequest?: boolean;
}) {
  const mainFrame = {};
  const subframe = {};
  const abort = vi.fn(async (_errorCode: 'blockedbyclient'): Promise<void> => undefined);
  const continueRequest = vi.fn(async (): Promise<void> => undefined);
  const route = {
    request: () => ({
      frame: () => (input.isMainFrame === true ? mainFrame : subframe),
      isNavigationRequest: () => input.isNavigationRequest === true,
      method: () => input.method,
      url: () => input.requestUrl,
    }),
    abort,
    continue: continueRequest,
  };
  const page = { mainFrame: () => mainFrame };
  const stages: string[] = [];
  return { abort, continueRequest, page, route, stages };
}

interface TestLocator {
  locator(selector: string): TestLocator;
  nth(index: number): TestLocator;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  innerText(): Promise<string>;
  inputValue(): Promise<string>;
}

function testLocator(
  options: {
    readonly present?: boolean;
    readonly text?: string;
    readonly children?: Readonly<Record<string, TestLocator>>;
  } = {},
): TestLocator {
  const present = options.present ?? true;
  const locator: TestLocator = {
    locator: (selector) => options.children?.[selector] ?? testLocator({ present: false }),
    nth: (index) => (present && index === 0 ? locator : testLocator({ present: false })),
    count: async () => (present ? 1 : 0),
    isVisible: async () => present,
    innerText: async () => options.text ?? '',
    inputValue: async () => options.text ?? '',
  };
  return locator;
}

async function realProbePageHarness() {
  const mainFrame = {};
  const identityValue = testLocator({ text: 'agent-one@example.invalid' });
  const identityRoot = testLocator({
    children: {
      [SELECTOR_CONTRACT.signedInAgentIdentity.value.selector]: identityValue,
    },
  });
  let readinessRoute: ((route: Route) => Promise<void>) | null = null;
  let waitForTimeoutHook: (milliseconds: number) => Promise<void> = async () => undefined;
  const installRoute = vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => {
    readinessRoute = handler;
  });
  const removeRoute = vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => {
    if (readinessRoute !== handler) throw new Error('unexpected readiness route');
    readinessRoute = null;
  });
  const waitForTimeout = vi.fn(async (milliseconds: number) => waitForTimeoutHook(milliseconds));
  const closeOwner = vi.fn(async () => undefined);
  const stages: string[] = [];
  const page = {
    url: () => KEMERBET_AGENT_DEPOSIT_URL,
    mainFrame: () => mainFrame,
    locator: (selector: string) =>
      selector === SELECTOR_CONTRACT.signedInAgentIdentity.root
        ? identityRoot
        : testLocator({ present: false }),
    route: installRoute,
    unroute: removeRoute,
    waitForTimeout,
  } as unknown as Page;
  const probe = await createKemerBetNoTransferReadinessSealProbeFromPage({
    accountId: ACCOUNT_ID,
    close: closeOwner,
    fingerprintAgentIdentity: fingerprinter(),
    page,
    reportStage: (stage) => stages.push(stage),
    selectorContract: SELECTOR_CONTRACT,
  });

  return {
    closeOwner,
    dispatchRoute(route: Route): Promise<void> {
      const handler = readinessRoute;
      if (handler === null) throw new Error('readiness route is not installed');
      return handler(route);
    },
    installRoute,
    probe,
    removeRoute,
    setWaitForTimeoutHook(hook: (milliseconds: number) => Promise<void>) {
      waitForTimeoutHook = hook;
    },
    stages,
    waitForTimeout,
  };
}

function fixture(overrides: Partial<KemerBetNoTransferReadinessSealDependencies> = {}) {
  const probes: string[] = [];
  const close = vi.fn(async () => undefined);
  const finalizeReadOnlyProof = vi.fn(async () => undefined);
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
      finalizeReadOnlyProof,
      close,
    }),
    writeBinding,
    logSuccess,
    ...overrides,
  };
  return {
    dependencies,
    probes,
    close,
    finalizeReadOnlyProof,
    writeBinding,
    logSuccess,
  };
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
    expect(body).toContain('activateReadOnlyLookupWithGuardedNativeClick: true');
    expect(body).toContain('reportLookupStage: (stage) => options.reportStage?.(stage)');
    expect(body).toContain('let forbiddenRequestObserved = false');
    expect(body).toContain("reportStage('forbidden_request')");
    expect(body).toContain('const readinessRequestBoundaryInvalid = (): boolean =>');
    expect(body).toContain('if (closed || readinessRequestBoundaryInvalid()) unavailable()');
    expect(source).toContain('await probe.finalizeReadOnlyProof()');
    expect(body).toContain("reportStage('lookup_reset')");
    expect(body).toContain('await agentPage.resetReadOnlyPlayerLookup()');
    expect(body).not.toContain('activateReadOnlyLookupWithoutPointer');
    expect(body).not.toContain('createKemerBetDepositBrowser');
    expect(body).not.toContain('.goto(');
    expect(body).not.toContain('.reload(');
  });

  it('permits only the guarded unforced native Find click in readiness mode', () => {
    const pageSource = readFileSync(
      new URL('./playwright-kemerbet-agent-page.ts', import.meta.url),
      'utf8',
    );
    const sealSource = readFileSync(
      new URL('./kemerbet-no-transfer-readiness-seal.ts', import.meta.url),
      'utf8',
    );

    expect(sealSource).toContain('activateReadOnlyLookupWithGuardedNativeClick: true');
    expect(sealSource).toContain("| 'lookup_click_actionability'");
    expect(sealSource).toContain("| 'lookup_native_click'");
    expect(pageSource).toContain("reportLookupStage('lookup_click_actionability')");
    expect(pageSource).toContain(
      'await actionabilityCandidate.click({ timeout: timeoutMs, trial: true })',
    );
    expect(pageSource).toContain("reportLookupStage('lookup_native_click')");
    expect(pageSource).toContain('await exactFindButton.click({ timeout: timeoutMs })');
    expect(pageSource).toContain(
      'workflowControlLocator(contract.depositWorkflow.transferButton, true).count()',
    );
    expect(pageSource).toContain('includeHidden: true');

    expect(`${sealSource}\n${pageSource}`).not.toContain('lookup_event_dispatch');
    expect(`${sealSource}\n${pageSource}`).not.toContain('onTransferOkActionEvent');
    expect(pageSource).not.toMatch(/force\s*:\s*true/u);
    expect(pageSource).not.toMatch(/\.press\(\s*['"]Enter['"]/u);
    expect(pageSource).not.toMatch(/\belement\.click\(/u);
  });

  it('binds one redacted identity only after exactly five sequential lookup proofs', async () => {
    const test = fixture();

    await expect(runKemerBetNoTransferReadinessSeal(test.dependencies)).resolves.toBeUndefined();

    expect(test.probes).toEqual(PLAYER_IDS);
    expect(test.finalizeReadOnlyProof).toHaveBeenCalledOnce();
    expect(test.finalizeReadOnlyProof.mock.invocationCallOrder[0]).toBeLessThan(
      test.writeBinding.mock.invocationCallOrder[0]!,
    );
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
      'final_guard',
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
        finalizeReadOnlyProof: async () => undefined,
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

  it('rejects the binding boundary when the real route wrapper sees a forbidden settle request', async () => {
    const harness = await realProbePageHarness();
    const forbidden = guardedRouteFixture({
      method: 'POST',
      requestUrl: 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit',
    });
    harness.setWaitForTimeoutHook(async (milliseconds) => {
      expect(milliseconds).toBe(250);
      await harness.dispatchRoute(forbidden.route as unknown as Route);
    });
    const test = fixture({
      openProbe: async () => ({
        ...harness.probe,
        probePlayerLookup: async () => ({
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        }),
      }),
    });

    await expect(runKemerBetNoTransferReadinessSeal(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );

    expect(harness.waitForTimeout).toHaveBeenCalledWith(250);
    expect(forbidden.abort).toHaveBeenCalledOnce();
    expect(forbidden.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(forbidden.continueRequest).not.toHaveBeenCalled();
    expect(harness.stages).toContain('forbidden_request');
    expect(harness.removeRoute).toHaveBeenCalledOnce();
    expect(harness.closeOwner).toHaveBeenCalledOnce();
    expect(test.writeBinding).not.toHaveBeenCalled();
    expect(test.logSuccess).not.toHaveBeenCalled();
  });

  it('drains a delayed rejected real route operation and fails finalization', async () => {
    const harness = await realProbePageHarness();
    const delayed = guardedRouteFixture({
      method: 'GET',
      requestUrl: 'https://static.example.invalid/assets/application.js',
    });
    let rejectContinuation: ((error: Error) => void) | undefined;
    const continuation = new Promise<void>((_resolve, reject) => {
      rejectContinuation = reject;
    });
    delayed.continueRequest.mockImplementation(() => continuation);

    const routeOperation = harness.dispatchRoute(delayed.route as unknown as Route);
    const observedRouteOperation = routeOperation.then(
      () => ({ status: 'fulfilled' as const }),
      (reason: unknown) => ({ reason, status: 'rejected' as const }),
    );
    const finalization = harness.probe.finalizeReadOnlyProof();
    const observedFinalization = finalization.then(
      () => ({ status: 'fulfilled' as const }),
      (reason: unknown) => ({ reason, status: 'rejected' as const }),
    );

    await vi.waitFor(() => expect(harness.removeRoute).toHaveBeenCalledOnce());
    expect(delayed.continueRequest).toHaveBeenCalledOnce();
    expect(harness.closeOwner).not.toHaveBeenCalled();

    const routeFailure = new Error('delayed route continuation failed');
    rejectContinuation?.(routeFailure);
    const [routeResult, finalizationResult] = await Promise.all([
      observedRouteOperation,
      observedFinalization,
    ]);

    expect(routeResult).toEqual({ reason: routeFailure, status: 'rejected' });
    expect(finalizationResult.status).toBe('rejected');
    if (finalizationResult.status === 'rejected') {
      expect(finalizationResult.reason).toBeInstanceOf(
        KemerBetNoTransferReadinessSealUnavailableError,
      );
    }
    expect(harness.closeOwner).not.toHaveBeenCalled();

    await harness.probe.close();
    expect(harness.closeOwner).toHaveBeenCalledOnce();
  });

  it('writes no binding when the final drained route reports a forbidden request attempt', async () => {
    const close = vi.fn(async () => undefined);
    const finalizeReadOnlyProof = vi.fn(async () => {
      throw new KemerBetNoTransferReadinessSealUnavailableError();
    });
    const test = fixture({
      openProbe: async () => ({
        observedAgentIdentityFingerprint: FINGERPRINT,
        probePlayerLookup: async () => ({
          exactPlayerMatch: true,
          exactCurrencyMatch: true,
          transferDisabled: true,
        }),
        finalizeReadOnlyProof,
        close,
      }),
    });

    await expect(runKemerBetNoTransferReadinessSeal(test.dependencies)).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );

    expect(finalizeReadOnlyProof).toHaveBeenCalledOnce();
    expect(test.writeBinding).not.toHaveBeenCalled();
    expect(test.logSuccess).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
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
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'GET',
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

  it('continues the exact Player lookup GET and reports only its fixed network stage', async () => {
    const test = guardedRouteFixture({
      method: 'GET',
      requestUrl:
        'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
    });

    await guardKemerBetReadinessSealRoute(test.route, test.page, (stage) =>
      test.stages.push(stage),
    );

    expect(test.continueRequest).toHaveBeenCalledOnce();
    expect(test.abort).not.toHaveBeenCalled();
    expect(test.stages).toEqual(['lookup_network_request']);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'aborts a %s request without reporting a lookup stage',
    async (method) => {
      const test = guardedRouteFixture({
        method,
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
      });

      await guardKemerBetReadinessSealRoute(test.route, test.page, (stage) =>
        test.stages.push(stage),
      );

      expect(test.abort).toHaveBeenCalledOnce();
      expect(test.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(test.continueRequest).not.toHaveBeenCalled();
      expect(test.stages).toEqual([]);
    },
  );

  it('continues an unrelated allowed HTTPS GET without reporting a lookup stage', async () => {
    const test = guardedRouteFixture({
      method: 'GET',
      requestUrl: 'https://static.example.invalid/assets/application.js',
    });

    await guardKemerBetReadinessSealRoute(test.route, test.page, (stage) =>
      test.stages.push(stage),
    );

    expect(test.continueRequest).toHaveBeenCalledOnce();
    expect(test.abort).not.toHaveBeenCalled();
    expect(test.stages).toEqual([]);
  });

  it('recognizes only the exact redacted Player lookup request for network-stage reporting', () => {
    expect(
      isExactKemerBetReadinessSealPlayerLookupRequest({
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
      }),
    ).toBe(true);

    for (const candidate of [
      {
        method: 'POST',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
      },
      {
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted&externalId=other',
      },
      {
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted&extra=1',
      },
      {
        method: 'GET',
        requestUrl: 'https://untrusted.invalid/Player/GeneralInfoByExternalId?externalId=redacted',
      },
      {
        method: 'GET',
        requestUrl: 'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=',
      },
      {
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted#fragment',
      },
      {
        method: 'GET',
        requestUrl: 'not a valid URL',
      },
      {
        method: 'GET',
        requestUrl: 'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=%ZZ',
      },
      {
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted%20value',
      },
      {
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted%01value',
      },
      {
        method: 'GET',
        requestUrl: `https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=${'a'.repeat(
          129,
        )}`,
      },
    ]) {
      expect(isExactKemerBetReadinessSealPlayerLookupRequest(candidate)).toBe(false);
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
