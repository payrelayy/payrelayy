import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';

import {
  KemerBetProvisionServerUnavailableError,
  checkpointKemerBetProvisionSignedInPage,
  createKemerBetReadinessSealFailureEvent,
  createKemerBetReadinessSealFailureTracker,
  createKemerBetSessionProvisionServer,
  isAllowedKemerBetSessionRequest,
  removeStaleChromiumSingletonArtifacts,
  type KemerBetReadinessSealFailureEvent,
} from './kemerbet-session-provision-server.js';

const LOGIN_PAGE = 'https://agentsystem.admindigi.com/login?et=1';
const AGENTS_PAGE = 'https://agentsystem.admindigi.com/agents';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SAFE_ENVIRONMENT = Object.freeze({
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'true',
  KEMERBET_EXECUTOR_ENABLED: 'false',
  KEMERBET_FINAL_ACTION_ENABLED: 'false',
  KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
  INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
});

async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const reject = (error: Error) => rejectListen(error);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === 'string') throw new Error('Loopback test server unavailable.');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function postReadinessSeal(origin: string, body: string): Promise<Response> {
  return fetch(`${origin}/v1/readiness/seal`, {
    method: 'POST',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body,
  });
}

async function postSessionCheckpoint(origin: string, body: string): Promise<Response> {
  return fetch(`${origin}/v1/session/checkpoint`, {
    method: 'POST',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body,
  });
}

describe('private KemerBet session provision server', () => {
  it('removes only the three exact stale Chromium profile-owner symlinks', async () => {
    const profilePath = resolve('validated-kemerbet-profile');
    const existing = new Set([
      resolve(profilePath, 'SingletonCookie'),
      resolve(profilePath, 'SingletonLock'),
      resolve(profilePath, 'SingletonSocket'),
    ]);
    const removed: string[] = [];
    const fileSystem = {
      lstat: async (path: string) => {
        if (!existing.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { isSymbolicLink: () => true };
      },
      unlink: async (path: string) => {
        removed.push(path);
        existing.delete(path);
      },
    };

    await removeStaleChromiumSingletonArtifacts(profilePath, fileSystem);
    await removeStaleChromiumSingletonArtifacts(profilePath, fileSystem);

    expect(removed.map((path) => basename(path))).toEqual([
      'SingletonCookie',
      'SingletonLock',
      'SingletonSocket',
    ]);
  });

  it('fails closed instead of deleting a non-symlink singleton entry', async () => {
    const removed: string[] = [];
    await expect(
      removeStaleChromiumSingletonArtifacts(resolve('validated-kemerbet-profile'), {
        lstat: async () => ({ isSymbolicLink: () => false }),
        unlink: async (path: string) => {
          removed.push(path);
        },
      }),
    ).rejects.toBeInstanceOf(KemerBetProvisionServerUnavailableError);
    expect(removed).toEqual([]);
  });

  it('uses the hardened container boundary instead of an incompatible nested Chromium sandbox', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/chromiumSandbox: false/u);
    expect(source).not.toMatch(/chromiumSandbox: true/u);
  });

  it('replaces the credential-entry deadline with bounded authenticated retention after sign-in', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/const LOGIN_LIFETIME_MS = 10 \* 60 \* 1_000/u);
    expect(source).toMatch(/const AUTHENTICATED_SESSION_LIFETIME_MS = 12 \* 60 \* 60 \* 1_000/u);
    expect(source).toMatch(/armExpiry\(LOGIN_LIFETIME_MS\)/u);
    expect(source).toMatch(
      /if \(signedIn && !signedInLogged\) \{[\s\S]*?armExpiry\(AUTHENTICATED_SESSION_LIFETIME_MS\)/u,
    );
    expect(source).not.toMatch(/const SESSION_LIFETIME_MS/u);
  });

  it('reloads and revalidates the same sole guarded page before accepting a checkpoint', async () => {
    let currentUrl = AGENTS_PAGE;
    let page: Page;
    const context = {
      pages: () => [page],
      serviceWorkers: () => [],
    } as unknown as BrowserContext;
    const reload = vi.fn(async () => undefined);
    const waitForTimeout = vi.fn(async () => undefined);
    page = {
      context: () => context,
      isClosed: () => false,
      reload,
      url: () => currentUrl,
      waitForTimeout,
    } as unknown as Page;
    const verifyAuthenticatedPage = vi.fn(async () => undefined);

    await checkpointKemerBetProvisionSignedInPage(
      {
        accountId: '11111111-1111-4111-8111-111111111111',
        context,
        effectiveUserId: 10_001,
        page,
      },
      { verifyAuthenticatedPage },
    );

    expect(reload).toHaveBeenCalledExactlyOnceWith({
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    expect(waitForTimeout).toHaveBeenCalledExactlyOnceWith(250);
    expect(verifyAuthenticatedPage).toHaveBeenCalledExactlyOnceWith({
      accountId: '11111111-1111-4111-8111-111111111111',
      context,
      effectiveUserId: 10_001,
      page,
    });

    currentUrl = LOGIN_PAGE;
    await expect(
      checkpointKemerBetProvisionSignedInPage(
        {
          accountId: '11111111-1111-4111-8111-111111111111',
          context,
          effectiveUserId: 10_001,
          page,
        },
        { verifyAuthenticatedPage },
      ),
    ).rejects.toBeInstanceOf(KemerBetProvisionServerUnavailableError);
  });

  it('requires checkpoint success before closing and permanently latches the provision lane', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("request.url === '/v1/session/checkpoint'");
    const start = source.indexOf('const checkpointForRecheck');
    const end = source.indexOf('const input =', start);
    const checkpoint = source.slice(start, end);
    expect(checkpoint.indexOf('await checkpointSignedInPage')).toBeLessThan(
      checkpoint.indexOf('checkpointedForRecheck = true'),
    );
    expect(checkpoint.indexOf('const blockedRequestBaseline')).toBeLessThan(
      checkpoint.indexOf('await checkpointSignedInPage'),
    );
    const validation = checkpoint.indexOf('await checkpointSignedInPage');
    const exactTopology = checkpoint.indexOf('requireExactCheckpointTopology');
    const irreversibleLatch = checkpoint.indexOf('checkpointedForRecheck = true');
    const cleanProfileClose = checkpoint.indexOf('await closePersistentBrowserForCheckpoint');
    const postCloseValidation = checkpoint.lastIndexOf(
      'blockedRequestCounter !== blockedRequestBaseline',
    );
    const stateClear = checkpoint.indexOf('context = undefined');
    expect(validation).toBeGreaterThanOrEqual(0);
    expect(exactTopology).toBeGreaterThan(validation);
    expect(irreversibleLatch).toBeGreaterThan(exactTopology);
    expect(cleanProfileClose).toBeGreaterThan(irreversibleLatch);
    expect(postCloseValidation).toBeGreaterThan(cleanProfileClose);
    expect(stateClear).toBeGreaterThan(postCloseValidation);
    expect(checkpoint).toContain('profilePath !== retainedProfilePath');
    expect(checkpoint).toContain('profilePath: retainedProfilePath');
    expect(checkpoint.indexOf('profilePath = undefined')).toBeGreaterThan(stateClear);
    expect(checkpoint).not.toContain('await retainedContext.close()');
    expect(source).toContain('blockedRequestCounter += 1n');
    expect(source).toContain('if (checkpointValidationActive) checkpointBlockedForRecheck = true');
    expect(checkpoint).toContain('checkpointValidationActive = true');
    expect(checkpoint).toContain('checkpointBlockedForRecheck ||');
    expect(checkpoint).toMatch(/finally \{\s+checkpointValidationActive = false/u);
    expect(irreversibleLatch).toBeLessThan(cleanProfileClose);
    expect(cleanProfileClose).toBeLessThan(stateClear);
    expect(source).toContain(
      'if (checkpointedForRecheck || context || page || profilePath || accountId || expiresAt)',
    );
    expect(source).toMatch(
      /if \(\s*checkpointedForRecheck \|\|\s*!context \|\|\s*!page \|\|\s*!profilePath \|\|\s*!accountId \|\|\s*!expiresAt\s*\)/u,
    );
    const inputBody = source.slice(
      source.indexOf('const input = async'),
      source.indexOf('const sealReadiness = async'),
    );
    expect(inputBody).toContain('checkpointedForRecheck ||');
    for (const fixedField of [
      'checkpointed: true',
      'providerSessionFresh: true',
      'transferDisabled: true',
      'moneyMoved: false',
      'identifiersRedacted: true',
    ]) {
      expect(checkpoint).toContain(fixedField);
    }
  });

  it('fails the private checkpoint closed when no exact signed-in session exists', async () => {
    const provision = createKemerBetSessionProvisionServer({
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      const response = await postSessionCheckpoint(
        origin,
        JSON.stringify({ requestId: REQUEST_ID }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'session_unavailable' });
    } finally {
      await closeServer(provision.server);
    }
  });

  it('requires the private checkpoint before any exact-five recheck state advances', () => {
    const helper = readFileSync(
      new URL('../../../infra/operations/fetanagent-staging-deploy-helper.sh', import.meta.url),
      'utf8',
    );
    expect(helper).toContain('path: "/v1/session/checkpoint"');
    expect(helper).toContain('response.statusCode !== 201');
    expect(helper).toContain('request.setTimeout(125000, () => request.destroy())');
    expect(helper).toContain(
      'keys !== "checkpointed,identifiersRedacted,moneyMoved,providerSessionFresh,transferDisabled"',
    );
    const checkpoint = helper.indexOf(
      'checkpoint_kemerbet_session_for_recheck "$session_container"',
    );
    const journal = helper.indexOf('record_kemerbet_recheck_promotion_journal', checkpoint);
    const retireFailure = helper.indexOf('owner_kemerbet_cohort_marker remove-failed', checkpoint);
    const promote = helper.indexOf('promote_owner_staged_kemerbet_player_ids', checkpoint);
    expect(checkpoint).toBeGreaterThan(-1);
    expect(journal).toBeGreaterThan(checkpoint);
    expect(retireFailure).toBeGreaterThan(journal);
    expect(promote).toBeGreaterThan(retireFailure);
    expect(helper.slice(checkpoint, journal)).toContain(
      "die 'a freshly authenticated private KemerBet session is required before recheck'",
    );
  });

  it('exposes only an aggregate one-time readiness seal on the current signed-in page', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/request\.url === '\/v1\/readiness\/seal'/u);
    expect(source).toMatch(/validPageUrl\(retainedPage\.url\(\)\) !== 'agents'/u);
    expect(source).toMatch(/FINANCIAL_ACTIONS_MODE: 'dry_run'/u);
    expect(source).toMatch(/KEMERBET_EXECUTOR_ENABLED: 'false'/u);
    expect(source).toMatch(/KEMERBET_FINAL_ACTION_ENABLED: 'false'/u);
    expect(source).toMatch(/playersChecked: 5/u);
    expect(source).toMatch(/transferDisabled: true/u);
    expect(source).toMatch(/moneyMoved: false/u);
    expect(source).toMatch(/identifiersRedacted: true/u);
    expect(source).toMatch(/error: 'session_unavailable', stage: failureStage/u);
    expect(source).toContain('reportStage: readinessFailure.reportStage');
    expect(source).toContain('reportForbiddenRequest: readinessFailure.reportForbiddenRequest');
    expect(source).toContain('reportForbiddenRequest: options.reportForbiddenRequest');
    expect(source).toContain(
      'createKemerBetReadinessSealFailureEvent(failureStage, failureForbiddenRequest)',
    );
    expect(source).toMatch(/event: 'readiness_seal_failed'/u);
    expect(source).toMatch(/detailsRedacted: true/u);
    expect(source).toContain('close: closeRetainedContextForSeal');
    expect(source).not.toContain('close: async () => undefined');
    const closeStart = source.indexOf('const closeRetainedContextForSeal');
    const closeEnd = source.indexOf('await runReadinessSeal', closeStart);
    const closeBody = source.slice(closeStart, closeEnd);
    const terminalLatch = closeBody.indexOf('checkpointedForRecheck = true');
    const cleanProfileClose = closeBody.indexOf('await closePersistentBrowserForCheckpoint');
    expect(closeBody).toContain('if (checkpointedForRecheck) return unavailable()');
    expect(terminalLatch).toBeGreaterThanOrEqual(0);
    expect(cleanProfileClose).toBeGreaterThan(terminalLatch);
    expect(closeBody).toContain('await closePersistentBrowserForCheckpoint');
    expect(closeBody).toContain('profilePath: retainedProfilePath');
    expect(closeBody).not.toContain('await retainedContext.close()');
    expect(closeBody.indexOf('await closePersistentBrowserForCheckpoint')).toBeLessThan(
      closeBody.indexOf('context = undefined'),
    );
    expect(closeBody.indexOf('context = undefined')).toBeLessThan(
      closeBody.indexOf('profilePath = undefined'),
    );
    expect(source).toMatch(
      /!retainedContextClosed \|\|\s+context !== undefined \|\|\s+page !== undefined \|\|\s+profilePath !== undefined \|\|\s+accountId !== undefined/u,
    );
    const sealAdmission = source.slice(source.indexOf('const sealReadiness = async'), closeStart);
    expect(sealAdmission).toContain('checkpointedForRecheck ||');
  });

  it('creates only the fixed redacted failure schema for every readiness stage', () => {
    const stages = [
      'environment_guard',
      'readiness_inputs',
      'signed_in_page',
      'route_guard',
      'agent_identity',
      'agent_session_guard',
      'agent_identity_marker',
      'agent_identity_value',
      'agent_identity_stability',
      'page_adoption',
      'lookup_surface',
      'lookup_request',
      'lookup_input',
      'lookup_input_blurred',
      'lookup_action',
      'lookup_click_actionability',
      'lookup_native_click',
      'lookup_response',
      'lookup_network_request',
      'forbidden_request',
      'lookup_contract',
      'lookup_result',
      'lookup_reset',
      'final_guard',
      'binding_write',
    ] as const;

    for (const stage of stages) {
      expect(createKemerBetReadinessSealFailureEvent(stage)).toEqual({
        component: 'kemerbet_session_provision',
        event: 'readiness_seal_failed',
        detailsRedacted: true,
        stage,
      });
    }

    const sensitive = 'credential=raw-secret playerId=raw-player https://secret.invalid';
    for (const candidate of [undefined, 'unknown_stage', sensitive, new Error(sensitive)]) {
      const event = createKemerBetReadinessSealFailureEvent(candidate);
      expect(event).toEqual({
        component: 'kemerbet_session_provision',
        event: 'readiness_seal_failed',
        detailsRedacted: true,
      });
      expect(JSON.stringify(event)).not.toContain(sensitive);
      expect(event).not.toHaveProperty('stage');
    }
  });

  it('adds only a validated fixed forbidden-request diagnostic to a forbidden failure', () => {
    const diagnostic = {
      reason: 'non_read_method',
      target: 'third_party',
      method: 'POST',
      kind: 'subresource',
    } as const;
    expect(createKemerBetReadinessSealFailureEvent('forbidden_request', diagnostic)).toEqual({
      component: 'kemerbet_session_provision',
      event: 'readiness_seal_failed',
      detailsRedacted: true,
      stage: 'forbidden_request',
      forbiddenRequest: diagnostic,
    });
    expect(createKemerBetReadinessSealFailureEvent('lookup_result', diagnostic)).toEqual({
      component: 'kemerbet_session_provision',
      event: 'readiness_seal_failed',
      detailsRedacted: true,
      stage: 'lookup_result',
    });

    const sensitive = 'credential=raw-secret playerId=raw-player https://secret.invalid';
    const reads = new Map<PropertyKey, number>();
    const changingDiagnostic = new Proxy(diagnostic, {
      get: (target, property, receiver) => {
        if (
          property === 'reason' ||
          property === 'target' ||
          property === 'method' ||
          property === 'kind'
        ) {
          const count = (reads.get(property) ?? 0) + 1;
          reads.set(property, count);
          return count === 1 ? Reflect.get(target, property, receiver) : sensitive;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const snapshotEvent = createKemerBetReadinessSealFailureEvent(
      'forbidden_request',
      changingDiagnostic,
    );
    expect(snapshotEvent).toEqual({
      component: 'kemerbet_session_provision',
      event: 'readiness_seal_failed',
      detailsRedacted: true,
      stage: 'forbidden_request',
      forbiddenRequest: diagnostic,
    });
    expect(reads).toEqual(
      new Map<PropertyKey, number>([
        ['reason', 1],
        ['target', 1],
        ['method', 1],
        ['kind', 1],
      ]),
    );
    expect(JSON.stringify(snapshotEvent)).not.toContain(sensitive);

    for (const candidate of [
      { ...diagnostic, target: sensitive },
      { ...diagnostic, method: sensitive },
      { ...diagnostic, extra: sensitive },
      new Error(sensitive),
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error(sensitive);
          },
        },
      ),
    ]) {
      const event = createKemerBetReadinessSealFailureEvent('forbidden_request', candidate);
      expect(event).toEqual({
        component: 'kemerbet_session_provision',
        event: 'readiness_seal_failed',
        detailsRedacted: true,
        stage: 'forbidden_request',
      });
      expect(JSON.stringify(event)).not.toContain(sensitive);
      expect(event).not.toHaveProperty('forbiddenRequest');
    }
  });

  it('keeps the first forbidden diagnostic and stage sticky until one atomic consume', () => {
    const tracker = createKemerBetReadinessSealFailureTracker();
    const first = {
      reason: 'non_read_method',
      target: 'known_telemetry',
      method: 'POST',
      kind: 'subresource',
    } as const;
    const later = {
      reason: 'exact_financial_endpoint',
      target: 'agent_api',
      method: 'POST',
      kind: 'subresource',
    } as const;

    tracker.begin();
    tracker.reportStage('lookup_action');
    tracker.reportForbiddenRequest(first);
    tracker.reportStage('lookup_result');
    tracker.reportForbiddenRequest(later);

    const failure = tracker.consume();
    expect(failure).toEqual({ stage: 'forbidden_request', forbiddenRequest: first });
    expect(
      createKemerBetReadinessSealFailureEvent(failure.stage, failure.forbiddenRequest),
    ).toEqual({
      component: 'kemerbet_session_provision',
      event: 'readiness_seal_failed',
      detailsRedacted: true,
      stage: 'forbidden_request',
      forbiddenRequest: first,
    });
    expect(tracker.consume()).toEqual({});

    tracker.begin();
    tracker.reportStage('final_guard');
    expect(tracker.consume()).toEqual({ stage: 'final_guard' });
  });

  it('logs exactly one fixed stage and preserves the staged 503 when diagnostics throw', async () => {
    const events: KemerBetReadinessSealFailureEvent[] = [];
    const loggerError = 'logger-credential=raw-secret playerId=raw-player';
    const provision = createKemerBetSessionProvisionServer({
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      logReadinessSealFailure: (event) => {
        events.push(event);
        throw new Error(loggerError);
      },
    });
    const origin = await listenOnLoopback(provision.server);

    try {
      const response = await postReadinessSeal(origin, JSON.stringify({ requestId: REQUEST_ID }));

      expect(response.status).toBe(503);
      const responseBody = await response.json();
      expect(responseBody).toEqual({
        error: 'session_unavailable',
        stage: 'signed_in_page',
      });
      expect(events).toEqual([
        {
          component: 'kemerbet_session_provision',
          event: 'readiness_seal_failed',
          detailsRedacted: true,
          stage: 'signed_in_page',
        },
      ]);
      expect(JSON.stringify(events)).not.toContain(REQUEST_ID);
      expect(JSON.stringify(responseBody)).not.toContain(loggerError);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('writes the default failure event as one exact redacted JSON log line', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const provision = createKemerBetSessionProvisionServer({
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
    });
    const origin = await listenOnLoopback(provision.server);

    try {
      const response = await postReadinessSeal(origin, JSON.stringify({ requestId: REQUEST_ID }));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'session_unavailable',
        stage: 'signed_in_page',
      });
      const expectedLine = JSON.stringify({
        component: 'kemerbet_session_provision',
        event: 'readiness_seal_failed',
        detailsRedacted: true,
        stage: 'signed_in_page',
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(expectedLine);
      expect(expectedLine).not.toMatch(/[\r\n]/u);
    } finally {
      await closeServer(provision.server);
      consoleError.mockRestore();
    }
  });

  it('omits an unknown stage and never logs malformed request or parser details', async () => {
    const events: KemerBetReadinessSealFailureEvent[] = [];
    const provision = createKemerBetSessionProvisionServer({
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      logReadinessSealFailure: (event) => events.push(event),
    });
    const origin = await listenOnLoopback(provision.server);
    const sensitive = 'credential=raw-secret playerId=raw-player https://secret.invalid';

    try {
      const response = await postReadinessSeal(
        origin,
        `{"requestId":"${REQUEST_ID}","password":"${sensitive}"`,
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'session_unavailable' });
      expect(events).toEqual([
        {
          component: 'kemerbet_session_provision',
          event: 'readiness_seal_failed',
          detailsRedacted: true,
        },
      ]);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(REQUEST_ID);
      expect(serialized).not.toContain(sensitive);
      expect(serialized).not.toContain('password');
      expect(events[0]).not.toHaveProperty('stage');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('always blocks the exact deposit endpoint and every unreviewed post-login mutation', () => {
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'POST',
        pageUrl: LOGIN_PAGE,
        requestUrl: 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit',
      }),
    ).toBe(false);
    for (const requestUrl of [
      'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit?unexpected=1',
      'https://admin-api.agt-digi.com/another-mutation',
      'https://agentsystem.admindigi.com/logout',
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'POST',
          pageUrl: AGENTS_PAGE,
          requestUrl,
        }),
      ).toBe(false);
    }
  });

  it("allows only KemerBet's exact refresh-token request during authenticated retention", () => {
    const exactRefresh = {
      headers: {
        'content-type': 'application/json',
        grant_type: 'refresh_token',
      },
      isMainFrame: true,
      isNavigationRequest: false,
      method: 'POST',
      pageUrl: AGENTS_PAGE,
      postData: JSON.stringify({ refreshToken: 'reviewed-refresh-token-value' }),
      redirectedFrom: false,
      resourceType: 'fetch',
      requestUrl: 'https://admin-api.agt-digi.com/Account/RefreshToken',
    } as const;

    expect(isAllowedKemerBetSessionRequest(exactRefresh)).toBe(true);
    expect(
      isAllowedKemerBetSessionRequest({
        ...exactRefresh,
        headers: { ...exactRefresh.headers, 'content-type': 'application/json; charset=utf-8' },
      }),
    ).toBe(true);

    for (const candidate of [
      { ...exactRefresh, pageUrl: LOGIN_PAGE },
      { ...exactRefresh, isMainFrame: false },
      { ...exactRefresh, isNavigationRequest: true },
      { ...exactRefresh, method: 'PUT' },
      { ...exactRefresh, redirectedFrom: true },
      { ...exactRefresh, resourceType: 'document' },
      {
        ...exactRefresh,
        headers: { ...exactRefresh.headers, grant_type: 'password' },
      },
      {
        ...exactRefresh,
        headers: { ...exactRefresh.headers, 'content-type': 'text/plain' },
      },
      { ...exactRefresh, postData: JSON.stringify({ refreshToken: 'too-short' }) },
      {
        ...exactRefresh,
        postData: JSON.stringify({ refreshToken: 'reviewed-refresh-token-value', extra: true }),
      },
      { ...exactRefresh, postData: '{not-json' },
      { ...exactRefresh, requestUrl: `${exactRefresh.requestUrl}?unexpected=1` },
      { ...exactRefresh, requestUrl: 'https://admin-api.agt-digi.com:443/Account/RefreshToken' },
      {
        ...exactRefresh,
        requestUrl: 'https://user@admin-api.agt-digi.com/Account/RefreshToken',
      },
      { ...exactRefresh, requestUrl: 'https://admin-api.agt-digi.com/account/RefreshToken' },
      { ...exactRefresh, requestUrl: 'https://admin-api.agt-digi.com/Account/Profile' },
      { ...exactRefresh, requestUrl: 'https://evil.example/Account/RefreshToken' },
    ]) {
      expect(isAllowedKemerBetSessionRequest(candidate)).toBe(false);
    }
  });

  it('allows login transport but only exact login or agents top-level navigation', () => {
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'POST',
        pageUrl: LOGIN_PAGE,
        requestUrl: 'https://admin-api.agt-digi.com/Auth/Login',
      }),
    ).toBe(true);
    for (const requestUrl of [
      'https://evil.example/login',
      'https://agentsystem.admindigi.com/',
      'https://agentsystem.admindigi.com/login?unexpected=1',
      'https://agentsystem.admindigi.com/agents?unexpected=1',
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          isMainFrame: true,
          isNavigationRequest: true,
          method: 'GET',
          pageUrl: LOGIN_PAGE,
          requestUrl,
        }),
      ).toBe(false);
    }
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
        isNavigationRequest: true,
        method: 'GET',
        pageUrl: LOGIN_PAGE,
        requestUrl: AGENTS_PAGE,
      }),
    ).toBe(true);
  });

  it('allows only exact reCAPTCHA subframe navigation while keeping top-level redirects blocked', () => {
    for (const requestUrl of [
      'https://www.google.com/recaptcha/api2/anchor?site-key=redacted',
      'https://www.google.com/recaptcha/api2/bframe?site-key=redacted',
      'https://www.recaptcha.net/recaptcha/api2/anchor?site-key=redacted',
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          isMainFrame: false,
          isNavigationRequest: true,
          method: 'GET',
          pageUrl: LOGIN_PAGE,
          requestUrl,
        }),
      ).toBe(true);
    }
    for (const candidate of [
      { isMainFrame: true, requestUrl: 'https://www.google.com/recaptcha/api2/anchor' },
      { isMainFrame: false, requestUrl: 'https://www.google.com/search?q=login' },
      { isMainFrame: false, requestUrl: 'https://evil.example/recaptcha/api2/anchor' },
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          ...candidate,
          isNavigationRequest: true,
          method: 'GET',
          pageUrl: LOGIN_PAGE,
        }),
      ).toBe(false);
    }
  });

  it('rejects every live, executor, final-action, pilot, or wrong-user environment at construction', () => {
    const safe = {
      NODE_ENV: 'production',
      FINANCIAL_ACTIONS_MODE: 'dry_run',
      KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'true',
      KEMERBET_EXECUTOR_ENABLED: 'false',
      KEMERBET_FINAL_ACTION_ENABLED: 'false',
      KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
      INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
    };
    for (const candidate of [
      { environment: { ...safe, FINANCIAL_ACTIONS_MODE: 'live' }, effectiveUserId: 10_001 },
      {
        environment: { ...safe, KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'false' },
        effectiveUserId: 10_001,
      },
      { environment: { ...safe, KEMERBET_EXECUTOR_ENABLED: 'true' }, effectiveUserId: 10_001 },
      { environment: { ...safe, KEMERBET_FINAL_ACTION_ENABLED: 'true' }, effectiveUserId: 10_001 },
      {
        environment: { ...safe, KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'true' },
        effectiveUserId: 10_001,
      },
      {
        environment: { ...safe, INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true' },
        effectiveUserId: 10_001,
      },
      { environment: safe, effectiveUserId: 0 },
    ]) {
      expect(() => createKemerBetSessionProvisionServer(candidate)).toThrow(
        KemerBetProvisionServerUnavailableError,
      );
    }
  });
});
