import { readFileSync } from 'node:fs';

import type { Page, Route } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import {
  classifyKemerBetReadinessSealRequest,
  createKemerBetNoTransferReadinessSealProbeFromPage,
  guardKemerBetReadinessSealRoute,
  isAllowedKemerBetReadinessSealRequest,
  isExactKemerBetReadinessSealPlayerLookupRequest,
  KemerBetNoTransferReadinessSealUnavailableError,
  runKemerBetNoTransferReadinessSeal,
  runKemerBetNoTransferReadinessSealMain,
  type KemerBetNoTransferReadinessSealDependencies,
  type KemerBetReadinessSealForbiddenRequestDiagnostic,
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
  readonly headers?: Readonly<Record<string, string>>;
  readonly isMainFrame?: boolean;
  readonly isNavigationRequest?: boolean;
  readonly resourceType?: string;
}) {
  const mainFrame = {};
  const subframe = {};
  const abort = vi.fn(async (_errorCode: 'blockedbyclient'): Promise<void> => undefined);
  const continueRequest = vi.fn(async (): Promise<void> => undefined);
  const route = {
    request: () => ({
      frame: () => (input.isMainFrame === true ? mainFrame : subframe),
      headers: () => ({ ...input.headers }),
      isNavigationRequest: () => input.isNavigationRequest === true,
      method: () => input.method,
      resourceType: () => input.resourceType ?? 'xhr',
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

async function realProbePageHarness(
  options: {
    readonly reportForbiddenRequest?: (
      diagnostic: KemerBetReadinessSealForbiddenRequestDiagnostic,
    ) => void;
    readonly reportStage?: (stage: string) => void;
  } = {},
) {
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
  const forbiddenRequests: KemerBetReadinessSealForbiddenRequestDiagnostic[] = [];
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
    reportForbiddenRequest:
      options.reportForbiddenRequest ?? ((diagnostic) => forbiddenRequests.push(diagnostic)),
    reportStage: options.reportStage ?? ((stage) => stages.push(stage)),
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
    forbiddenRequests,
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
    const guardedStart = source.indexOf(
      'async function createKemerBetNoTransferReadinessGuardedProbeFromPage',
    );
    const start = source.indexOf(
      'export async function createKemerBetNoTransferReadinessSealProbeFromPage',
    );
    const end = source.indexOf(
      'export interface KemerBetNoTransferReadinessPersistentProfileProbeOptions',
      start,
    );
    const guardedBody =
      guardedStart >= 0 && start > guardedStart ? source.slice(guardedStart, start) : undefined;
    const publicBody = start >= 0 && end > start ? source.slice(start, end) : undefined;

    expect(guardedBody).toBeDefined();
    expect(publicBody).toBeDefined();
    expect(guardedBody).toContain('await agentPage.adoptCurrentDepositPageWithoutNavigation()');
    expect(guardedBody).toContain('activateReadOnlyLookupWithGuardedNativeClick: true');
    expect(guardedBody).toContain('reportLookupStage: (stage) => options.reportStage?.(stage)');
    expect(guardedBody).toContain('requestBoundary.invalid()');
    expect(guardedBody).toContain('requestBoundary.withExpectedPlayerLookup');
    expect(source).toContain('await probe.finalizeReadOnlyProof()');
    expect(guardedBody).toContain("reportStage('lookup_reset')");
    expect(guardedBody).toContain('await agentPage.resetReadOnlyPlayerLookup()');
    expect(guardedBody).not.toContain('activateReadOnlyLookupWithoutPointer');
    expect(guardedBody).not.toContain('createKemerBetDepositBrowser');
    expect(publicBody).toContain("startup: { mode: 'adopt_authenticated_page' }");
    expect(publicBody).not.toContain('.goto(');
    expect(publicBody).not.toContain('.reload(');
  });

  it('installs context-wide HTTP and WebSocket guards before the persistent page goes online', () => {
    const source = readFileSync(
      new URL('./kemerbet-no-transfer-readiness-seal.ts', import.meta.url),
      'utf8',
    );
    const start = source.indexOf(
      'export async function openKemerBetNoTransferReadinessPersistentProfileProbe',
    );
    const end = source.indexOf('async function productionOpenProbe', start);
    const body = start >= 0 && end > start ? source.slice(start, end) : '';

    const resolveProfile = body.indexOf('resolveSafeProfile(');
    const removeSingletons = body.indexOf('removeStaleChromiumSingletonArtifacts(');
    const revalidateProfile = body.indexOf('assertSafeDirectory(profile');
    const launchPersistentContext = body.indexOf('chromium.launchPersistentContext(');

    expect(resolveProfile).toBeGreaterThanOrEqual(0);
    expect(removeSingletons).toBeGreaterThan(resolveProfile);
    expect(revalidateProfile).toBeGreaterThan(removeSingletons);
    expect(launchPersistentContext).toBeGreaterThan(revalidateProfile);

    expect(body).toContain('offline: true');
    expect(body).toContain("serviceWorkers: 'block'");
    expect(body).toContain("retainedContext.route('**/*', handler)");
    expect(body).toContain("retainedContext.routeWebSocket('**/*'");
    expect(body).toContain("retainedContext.unroute('**/*', handler)");
    expect(body).not.toContain("page.routeWebSocket('**/*'");
    const restoredPageCloseIndex = body.indexOf('restoredPage.close()');
    expect(restoredPageCloseIndex).toBeGreaterThanOrEqual(0);
    expect(restoredPageCloseIndex).toBeLessThan(body.indexOf('requestBoundary.install()'));
    expect(body.indexOf('requestBoundary.install()')).toBeLessThan(
      body.indexOf("retainedContext.routeWebSocket('**/*'"),
    );
    expect(body.indexOf("retainedContext.routeWebSocket('**/*'")).toBeLessThan(
      body.indexOf('retainedContext.newPage()'),
    );
    expect(body.indexOf('retainedContext.newPage()')).toBeLessThan(
      body.indexOf('retainedContext.setOffline(false)'),
    );
    expect(body).not.toContain('requestBoundary?.remove()');

    const guardedStart = source.indexOf(
      'async function createKemerBetNoTransferReadinessGuardedProbeFromPage',
    );
    const guardedEnd = source.indexOf(
      'export async function createKemerBetNoTransferReadinessSealProbeFromPage',
      guardedStart,
    );
    const guardedBody = source.slice(guardedStart, guardedEnd);
    const persistentCloseStart = guardedBody.indexOf(
      "if (options.startup.mode === 'offline_canonical_navigation')",
    );
    const persistentCloseEnd = guardedBody.indexOf('} else {', persistentCloseStart);
    const persistentClose = guardedBody.slice(persistentCloseStart, persistentCloseEnd);
    expect(persistentClose).toContain('await options.close()');
    expect(persistentClose).not.toContain('.catch(');
    expect(persistentClose).not.toContain('requestBoundary.remove');
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
      requestUrl:
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/index-BUEO7OSf.js',
      resourceType: 'script',
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

    await vi.waitFor(() => expect(delayed.continueRequest).toHaveBeenCalledOnce());
    expect(harness.removeRoute).not.toHaveBeenCalled();
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
    expect(harness.removeRoute).toHaveBeenCalledOnce();
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
        expectedPlayerId: 'redacted',
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'GET',
        requestUrl:
          'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
        resourceType: 'xhr',
      }),
    ).toBe(true);
    expect(
      isAllowedKemerBetReadinessSealRequest({
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'GET',
        requestUrl:
          'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/index-BUEO7OSf.js',
        resourceType: 'script',
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
      {
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'GET',
        requestUrl: 'https://agentsystem.admindigi.com/logout',
        resourceType: 'xhr',
      },
    ]) {
      expect(isAllowedKemerBetReadinessSealRequest(candidate)).toBe(false);
    }
  });

  it('binds GET and narrowly constrained CORS preflight to the one active Player', () => {
    const exactLookupUrl =
      'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=PLAYER-1';
    const base = {
      expectedPlayerId: 'PLAYER-1',
      isMainFrame: true,
      isNavigationRequest: false,
      requestUrl: exactLookupUrl,
      resourceType: 'xhr',
    } as const;

    expect(isAllowedKemerBetReadinessSealRequest({ ...base, method: 'GET' })).toBe(true);
    expect(
      isAllowedKemerBetReadinessSealRequest({
        ...base,
        headers: {
          origin: 'https://agentsystem.admindigi.com',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization, content-type',
        },
        method: 'OPTIONS',
      }),
    ).toBe(true);
    for (const candidate of [
      { ...base, expectedPlayerId: 'PLAYER-2', method: 'GET' },
      { ...base, expectedPlayerId: null, method: 'GET' },
      { ...base, method: 'HEAD' },
      {
        ...base,
        headers: {
          origin: 'https://unknown.invalid',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
        method: 'OPTIONS',
      },
      {
        ...base,
        headers: {
          origin: 'https://agentsystem.admindigi.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization',
        },
        method: 'OPTIONS',
      },
      {
        ...base,
        headers: {
          origin: 'https://agentsystem.admindigi.com',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization, x-unreviewed',
        },
        method: 'OPTIONS',
      },
    ]) {
      expect(isAllowedKemerBetReadinessSealRequest(candidate)).toBe(false);
    }
  });

  it('allows only the exact audited v84 bootstrap assets without query data', () => {
    const origin = 'https://agt-client-akm.agent-digi.com';
    for (const [pathname, resourceType] of [
      ['/prd/agt-admin-client/v84/index-BUEO7OSf.js', 'script'],
      ['/prd/agt-admin-client/v84/index-BnOqIDsD.css', 'stylesheet'],
      ['/prd/agt-admin-client/v84/_ltrOffset-C2RQMwco.css', 'stylesheet'],
      ['/prd/agt-admin-client/v84/ltr-v1RhStcA.js', 'script'],
      ['/prd/agt-admin-client/v84/ltr-v3JyGz8d.js', 'script'],
      ['/prd/agt-admin-client/v84/index-Bi1Y1r_Z.js', 'script'],
      ['/prd/agt-admin-client/v84/index-6dvVbeUF.js', 'script'],
    ] as const) {
      expect(
        isAllowedKemerBetReadinessSealRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'GET',
          requestUrl: `${origin}${pathname}`,
          resourceType,
        }),
      ).toBe(true);
    }
    for (const candidate of [
      {
        requestUrl: `${origin}/prd/agt-admin-client/v84/index-BUEO7OSf.js?cache=1`,
        resourceType: 'script',
      },
      {
        requestUrl: `${origin}/prd/agt-admin-client/v84/unreviewed.js`,
        resourceType: 'script',
      },
      {
        requestUrl: `${origin}/prd/agt-admin-client/v84/index-BUEO7OSf.js`,
        resourceType: 'image',
      },
    ]) {
      expect(
        isAllowedKemerBetReadinessSealRequest({
          ...candidate,
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'GET',
        }),
      ).toBe(false);
    }
  });

  it('classifies blocked requests using fixed redacted values only', () => {
    expect(
      classifyKemerBetReadinessSealRequest({
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'POST',
        requestUrl: 'https://send.sentry.report/api/306/envelope/?dsn=redacted',
      }),
    ).toEqual({ decision: 'abort_optional', target: 'known_telemetry' });
    expect(
      classifyKemerBetReadinessSealRequest({
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'GET',
        requestUrl: 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit',
      }),
    ).toEqual({
      decision: 'forbid',
      diagnostic: {
        reason: 'exact_financial_endpoint',
        target: 'agent_api',
        method: 'GET',
        kind: 'subresource',
      },
    });
    expect(
      classifyKemerBetReadinessSealRequest({
        isMainFrame: false,
        isNavigationRequest: true,
        method: 'GET',
        requestUrl: 'https://www.google.com/recaptcha/api2/anchor?secret=redacted',
      }),
    ).toEqual({ decision: 'abort_optional', target: 'recaptcha' });

    const sensitive = 'credential=raw-secret playerId=raw-player';
    const diagnostic = classifyKemerBetReadinessSealRequest({
      isMainFrame: false,
      isNavigationRequest: false,
      method: `CUSTOM ${sensitive}`,
      requestUrl: `not-a-url ${sensitive}`,
    });
    expect(diagnostic).toEqual({
      decision: 'forbid',
      diagnostic: {
        reason: 'malformed_url',
        target: 'unparseable',
        method: 'OTHER',
        kind: 'subresource',
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain(sensitive);
  });

  it('keeps every Wallet or Transaction read sticky-forbidden', () => {
    for (const requestUrl of [
      'https://admin-api.agt-digi.com/Wallet/UnreviewedRead',
      'https://admin-api.agt-digi.com/Transaction/UnreviewedRead',
    ]) {
      expect(
        classifyKemerBetReadinessSealRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'GET',
          requestUrl,
          resourceType: 'xhr',
        }),
      ).toMatchObject({
        decision: 'forbid',
        diagnostic: {
          reason: 'exact_financial_endpoint',
          target: 'agent_api',
          method: 'GET',
        },
      });
    }
  });

  it('does not mistake a read-only subresource initiated by the main frame for navigation', () => {
    const lookup = {
      expectedPlayerId: 'redacted',
      isMainFrame: true,
      isNavigationRequest: false,
      method: 'GET',
      requestUrl:
        'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
      resourceType: 'xhr',
    } as const;

    expect(classifyKemerBetReadinessSealRequest(lookup)).toEqual({ decision: 'allow' });
    expect(isAllowedKemerBetReadinessSealRequest(lookup)).toBe(true);
  });

  it('distinguishes exact known telemetry and auth-session targets from lookalikes', () => {
    for (const requestUrl of [
      'https://send.sentry.report/api/306/envelope/?dsn=redacted',
      'https://t.cs.hotjar.io/api/v2/clientsites/redacted/visit-data',
    ]) {
      expect(
        classifyKemerBetReadinessSealRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'POST',
          requestUrl,
        }),
      ).toEqual({ decision: 'abort_optional', target: 'known_telemetry' });
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'TRACE']) {
      expect(
        classifyKemerBetReadinessSealRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method,
          requestUrl: 'https://admin-api.agt-digi.com/Account/RefreshToken',
        }),
      ).toMatchObject({
        decision: 'forbid',
        diagnostic: {
          reason: 'exact_auth_session_endpoint',
          target: 'agent_auth_session',
          method: method === 'TRACE' ? 'OTHER' : method,
        },
      });
    }
    for (const requestUrl of [
      'https://send.sentry.report.evil.invalid/api/306/envelope/',
      'https://sub.send.sentry.report/api/306/envelope/',
      'https://send.sentry.report./api/306/envelope/',
      'https://send.sentry.report/api/999/envelope/',
      'https://t.cs.hotjar.io.evil.invalid/api/v2/clientsites/redacted/visit-data',
    ]) {
      expect(
        classifyKemerBetReadinessSealRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'POST',
          requestUrl,
        }),
      ).toMatchObject({
        decision: 'forbid',
        diagnostic: { reason: 'non_read_method', target: 'third_party', method: 'POST' },
      });
    }
    for (const [requestUrl, reason] of [
      ['http://send.sentry.report/api/306/envelope/', 'non_https'],
      ['https://send.sentry.report:8443/api/306/envelope/', 'explicit_port'],
      ['https://user:secret@send.sentry.report/api/306/envelope/', 'url_credentials'],
    ] as const) {
      expect(
        classifyKemerBetReadinessSealRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'GET',
          requestUrl,
        }),
      ).toMatchObject({
        decision: 'forbid',
        diagnostic: { reason, target: 'known_telemetry', method: 'GET' },
      });
    }
    for (const [requestUrl, target] of [
      ['https://admin-api.agt-digi.com.evil.invalid/Account/RefreshToken', 'third_party'],
      ['https://sub.admin-api.agt-digi.com/Account/RefreshToken', 'third_party'],
      ['https://admin-api.agt-digi.com./Account/RefreshToken', 'third_party'],
      ['https://admin-api.agt-digi.com/Account/RefreshToken/extra', 'agent_api'],
      ['https://admin-api.agt-digi.com/account/refreshtoken', 'agent_api'],
    ] as const) {
      expect(
        classifyKemerBetReadinessSealRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'POST',
          requestUrl,
        }),
      ).toMatchObject({
        decision: 'forbid',
        diagnostic: { reason: 'non_read_method', target, method: 'POST' },
      });
    }
  });

  it.each([
    ['non_https', 'GET', 'http://agentsystem.admindigi.com/agents'],
    ['url_credentials', 'GET', 'https://user:secret@agentsystem.admindigi.com/agents'],
    ['explicit_port', 'GET', 'https://agentsystem.admindigi.com:8443/agents'],
    ['fragment', 'GET', 'https://agentsystem.admindigi.com/agents#secret'],
  ] as const)(
    'reports the fixed %s reason without carrying request data',
    (reason, method, url) => {
      const classification = classifyKemerBetReadinessSealRequest({
        isMainFrame: false,
        isNavigationRequest: false,
        method,
        requestUrl: url,
      });
      expect(classification.decision).toBe('forbid');
      if (classification.decision === 'forbid') {
        expect(classification.diagnostic.reason).toBe(reason);
        expect(JSON.stringify(classification.diagnostic)).not.toContain(url);
        expect(JSON.stringify(classification.diagnostic)).not.toContain('secret');
      }
    },
  );

  it('records only the first forbidden diagnostic while every forbidden request stays aborted', async () => {
    const harness = await realProbePageHarness();
    const first = guardedRouteFixture({
      isMainFrame: true,
      method: 'POST',
      requestUrl: 'https://unknown.invalid/collect?playerId=raw-player',
    });
    const later = guardedRouteFixture({
      method: 'POST',
      requestUrl: 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit',
    });

    await harness.dispatchRoute(first.route as unknown as Route);
    await harness.dispatchRoute(later.route as unknown as Route);

    expect(first.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(later.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(first.continueRequest).not.toHaveBeenCalled();
    expect(later.continueRequest).not.toHaveBeenCalled();
    expect(harness.forbiddenRequests).toEqual([
      {
        reason: 'non_read_method',
        target: 'third_party',
        method: 'POST',
        kind: 'subresource',
      },
    ]);
    expect(JSON.stringify(harness.forbiddenRequests)).not.toMatch(/raw-player|unknown|collect/iu);
    await expect(harness.probe.finalizeReadOnlyProof()).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );
    await harness.probe.close();
  });

  it('locally aborts only reviewed optional providers/assets without poisoning the proof', async () => {
    const harness = await realProbePageHarness();
    const optionalRequests = [
      guardedRouteFixture({
        method: 'POST',
        requestUrl: 'https://send.sentry.report/api/306/envelope/?redacted=1',
        resourceType: 'fetch',
      }),
      guardedRouteFixture({
        method: 'GET',
        requestUrl:
          'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/icomoon-CTmSmUzv.woff?squmb1',
        resourceType: 'font',
      }),
      guardedRouteFixture({
        method: 'GET',
        requestUrl:
          'https://agt-cdn.cdn-digi.com/prd/companies/2093/projects/39803/logo_24e4a06149154c9a956062027baa2fed.png',
        resourceType: 'image',
      }),
      guardedRouteFixture({
        method: 'GET',
        requestUrl: 'https://admin-api.agt-digi.com/Account/Info',
        resourceType: 'xhr',
      }),
    ];

    for (const request of optionalRequests) {
      await harness.dispatchRoute(request.route as unknown as Route);
      expect(request.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(request.continueRequest).not.toHaveBeenCalled();
    }
    expect(harness.forbiddenRequests).toEqual([]);
    await expect(harness.probe.finalizeReadOnlyProof()).resolves.toBeUndefined();
    expect(harness.closeOwner).toHaveBeenCalledOnce();
  });

  it('makes an unknown third-party image request a sticky proof failure', async () => {
    const harness = await realProbePageHarness();
    const unknownImage = guardedRouteFixture({
      method: 'GET',
      requestUrl: 'https://unknown.invalid/unreviewed.png?player=raw-player',
      resourceType: 'image',
    });

    await harness.dispatchRoute(unknownImage.route as unknown as Route);

    expect(unknownImage.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(harness.forbiddenRequests).toEqual([
      {
        reason: 'noncanonical_navigation',
        target: 'third_party',
        method: 'GET',
        kind: 'subresource',
      },
    ]);
    expect(JSON.stringify(harness.forbiddenRequests)).not.toMatch(/unknown|raw-player|\.png/iu);
    await expect(harness.probe.finalizeReadOnlyProof()).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );
    await harness.probe.close();
  });

  it('keeps the forbidden boundary fail-closed when the diagnostic callback throws', async () => {
    const harness = await realProbePageHarness({
      reportForbiddenRequest: () => {
        throw new Error('diagnostic logger failed with raw-secret');
      },
    });
    const forbidden = guardedRouteFixture({
      method: 'POST',
      requestUrl: 'https://unknown.invalid/collect?token=raw-secret',
    });

    await harness.dispatchRoute(forbidden.route as unknown as Route);

    expect(forbidden.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(forbidden.continueRequest).not.toHaveBeenCalled();
    expect(harness.stages).toContain('forbidden_request');
    await expect(harness.probe.finalizeReadOnlyProof()).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );
    await harness.probe.close();
  });

  it('still explicitly aborts a forbidden request when stage reporting throws', async () => {
    const harness = await realProbePageHarness({
      reportStage: (stage) => {
        if (stage === 'forbidden_request') {
          throw new Error('stage logger failed with raw-secret');
        }
      },
    });
    const forbidden = guardedRouteFixture({
      isMainFrame: true,
      method: 'POST',
      requestUrl: 'https://unknown.invalid/collect?token=raw-secret',
    });

    await harness.dispatchRoute(forbidden.route as unknown as Route);

    expect(forbidden.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(forbidden.continueRequest).not.toHaveBeenCalled();
    await expect(harness.probe.finalizeReadOnlyProof()).rejects.toBeInstanceOf(
      KemerBetNoTransferReadinessSealUnavailableError,
    );
    await harness.probe.close();
  });

  it('continues the exact Player lookup GET and reports only its fixed network stage', async () => {
    const test = guardedRouteFixture({
      isMainFrame: true,
      method: 'GET',
      requestUrl:
        'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
    });

    await guardKemerBetReadinessSealRoute(
      test.route,
      test.page,
      (stage) => test.stages.push(stage),
      'redacted',
    );

    expect(test.continueRequest).toHaveBeenCalledOnce();
    expect(test.abort).not.toHaveBeenCalled();
    expect(test.stages).toEqual(['lookup_network_request']);
  });

  it('continues the exact Player lookup GET when its diagnostic stage reporter throws', async () => {
    const test = guardedRouteFixture({
      isMainFrame: true,
      method: 'GET',
      requestUrl:
        'https://admin-api.agt-digi.com/Player/GeneralInfoByExternalId?externalId=redacted',
    });

    await expect(
      guardKemerBetReadinessSealRoute(
        test.route,
        test.page,
        () => {
          throw new Error('stage logger failed with raw-secret');
        },
        'redacted',
      ),
    ).resolves.toBeUndefined();

    expect(test.continueRequest).toHaveBeenCalledOnce();
    expect(test.abort).not.toHaveBeenCalled();
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

  it('aborts an unreviewed third-party GET without reporting a lookup stage', async () => {
    const test = guardedRouteFixture({
      method: 'GET',
      requestUrl: 'https://static.example.invalid/assets/application.js',
    });

    await guardKemerBetReadinessSealRoute(test.route, test.page, (stage) =>
      test.stages.push(stage),
    );

    expect(test.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(test.continueRequest).not.toHaveBeenCalled();
    expect(test.stages).toEqual([]);
  });

  it('recognizes only the exact redacted Player lookup request for network-stage reporting', () => {
    expect(
      isExactKemerBetReadinessSealPlayerLookupRequest({
        expectedPlayerId: 'redacted',
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
      expect(
        isExactKemerBetReadinessSealPlayerLookupRequest({
          ...candidate,
          expectedPlayerId: 'redacted',
        }),
      ).toBe(false);
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
