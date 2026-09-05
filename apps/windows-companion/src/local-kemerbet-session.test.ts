import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WindowsCompanionConfig } from './config.js';
import {
  startLocalKemerBetSession,
  type LocalKemerBetSession,
  type LocalKemerBetSessionEvent,
} from './local-kemerbet-session.js';

const dependencies = vi.hoisted(() => ({
  acquireSessionLock: vi.fn(),
  launchPersistentContext: vi.fn(),
  mkdir: vi.fn(),
  realpath: vi.fn(),
  releaseSessionLock: vi.fn(),
  verifyLocalKemerBetIdentity: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: dependencies.mkdir,
  realpath: dependencies.realpath,
}));
vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: dependencies.launchPersistentContext },
}));
vi.mock('./session-lock.js', () => ({
  acquireSessionLock: dependencies.acquireSessionLock,
  releaseSessionLock: dependencies.releaseSessionLock,
}));
vi.mock('./local-kemerbet-identity.js', () => ({
  verifyLocalKemerBetIdentity: dependencies.verifyLocalKemerBetIdentity,
}));

const AGENTS_URL = 'https://agentsystem.admindigi.com/agents';
const LOGIN_URL = 'https://agentsystem.admindigi.com/login';
const LOGIN_RETRY_URL = 'https://agentsystem.admindigi.com/login?et=1';
const ACCOUNT_INFO_URL = 'https://admin-api.agt-digi.com/Account/Info';
const DEPOSIT_URL = 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit';
const TEN_MINUTES = 10 * 60 * 1_000;
const TWELVE_HOURS = 12 * 60 * 60 * 1_000;
const config: WindowsCompanionConfig = {
  dataRoot: resolve('test-fixtures', 'local-companion'),
  expectedAgentIdentityProvided: false,
  pairingPackageProvided: false,
  profileRoot: resolve('test-fixtures', 'local-companion', 'profile'),
  releaseSha: 'local-development',
  takeExpectedAgentIdentity: () => undefined,
  takePairingPackage: () => undefined,
};

type Listener = (...args: unknown[]) => unknown;
type RouteMatcher = string | RegExp | ((url: URL) => boolean);

class FakeEvents {
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

class FakePage extends FakeEvents {
  private currentUrl = 'about:blank';
  private readonly frame = {};
  readonly close = vi.fn(async () => undefined);
  readonly goto = vi.fn(async (url: string) => {
    this.order.push('page:goto');
    this.navigate(url);
    return null;
  });

  constructor(private readonly order: string[]) {
    super();
  }

  url(): string {
    return this.currentUrl;
  }

  mainFrame(): object {
    return this.frame;
  }

  navigate(url: string): void {
    this.currentUrl = url;
    this.emit('framenavigated', this.frame);
  }
}

function matchesRoute(matcher: RouteMatcher, rawUrl: string): boolean {
  if (typeof matcher === 'function') return matcher(new URL(rawUrl));
  if (matcher instanceof RegExp) return matcher.test(rawUrl);
  const escaped = matcher.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(rawUrl);
}

interface FakeRouteOptions {
  readonly responseStatus?: number;
  readonly responseHeaders?: Record<string, string>;
  readonly navigation?: boolean;
}

function fakeRoute(url: string, method: string, options: FakeRouteOptions = {}) {
  const request = {
    url: () => url,
    method: () => method,
    headerValue: vi.fn(async () => null),
    isNavigationRequest: () => options.navigation ?? false,
  };
  const response = {
    status: () => options.responseStatus ?? 200,
    headers: () => options.responseHeaders ?? {},
    url: () => url,
    dispose: vi.fn(async () => undefined),
    body: vi.fn(() => {
      throw new Error('The session must not read response bodies.');
    }),
  };
  return {
    request: () => request,
    response,
    abort: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    fetch: vi.fn(async () => response),
    fulfill: vi.fn(async () => undefined),
  };
}

type FakeRoute = ReturnType<typeof fakeRoute>;
type RouteHandler = (route: FakeRoute, request: ReturnType<FakeRoute['request']>) => unknown;

class FakeContext extends FakeEvents {
  readonly registrations: { matcher: RouteMatcher; handler: RouteHandler }[] = [];
  readonly socketRegistrations: { matcher: RouteMatcher; handler: Listener }[] = [];
  readonly page: FakePage;
  readonly route = vi.fn(async (matcher: RouteMatcher, handler: RouteHandler) => {
    this.order.push('context:route');
    this.registrations.push({ matcher, handler });
  });
  readonly routeWebSocket = vi.fn(async (matcher: RouteMatcher, handler: Listener) => {
    this.order.push('context:websocket');
    this.socketRegistrations.push({ matcher, handler });
  });
  readonly setOffline = vi.fn(async (offline: boolean) => {
    this.order.push(`context:offline:${String(offline)}`);
  });
  readonly pages = vi.fn(() => [this.page]);
  readonly newPage = vi.fn(async () => this.page);
  readonly unroute = vi.fn(async () => undefined);
  readonly unrouteAll = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => {
    this.order.push('context:close');
    this.emit('close');
  });

  constructor(readonly order: string[]) {
    super();
    this.page = new FakePage(order);
  }

  async dispatch(url: string, method: string, options: FakeRouteOptions = {}): Promise<FakeRoute> {
    const registration = this.registrations.find((entry) => matchesRoute(entry.matcher, url));
    if (!registration) throw new Error('The provider request has no context guard.');
    const route = fakeRoute(url, method, options);
    await registration.handler(route, route.request());
    return route;
  }
}

function fakeAccountInfoResponse({
  url = ACCOUNT_INFO_URL,
  method = 'GET',
  status = 200,
}: { url?: string; method?: string; status?: number } = {}) {
  const forbiddenRead = () => {
    throw new Error('The session must not inspect provider response content.');
  };
  return {
    url: () => url,
    request: () => ({ method: () => method }),
    status: () => status,
    body: vi.fn(forbiddenRead),
    json: vi.fn(forbiddenRead),
    text: vi.fn(forbiddenRead),
    headers: vi.fn(forbiddenRead),
    allHeaders: vi.fn(forbiddenRead),
  };
}

const sessions: LocalKemerBetSession[] = [];

async function start(landingUrl = AGENTS_URL) {
  const order: string[] = [];
  const context = new FakeContext(order);
  const events: LocalKemerBetSessionEvent[] = [];
  context.page.goto.mockImplementationOnce(async () => {
    order.push('page:goto');
    context.page.navigate(landingUrl);
    return null;
  });
  dependencies.launchPersistentContext.mockImplementation(async () => {
    order.push('context:launch');
    return context;
  });
  const session = await startLocalKemerBetSession(config, (event) => events.push(event));
  // Expected deadline failures are consumed before timers run, avoiding unhandled test promises.
  void session.done.catch(() => undefined);
  sessions.push(session);
  return { context, events, order, page: context.page, session };
}

async function settleIdentityVerification(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));
  vi.resetAllMocks();
  dependencies.mkdir.mockResolvedValue(undefined);
  dependencies.realpath.mockImplementation(async (path: string) => path);
  dependencies.acquireSessionLock.mockResolvedValue({
    path: resolve(config.dataRoot, 'companion.lock'),
    handle: { close: vi.fn(async () => undefined) },
  });
  dependencies.releaseSessionLock.mockResolvedValue(undefined);
  dependencies.verifyLocalKemerBetIdentity.mockResolvedValue({
    bindingCreated: false,
    identityVerified: true,
    identifiersRedacted: true,
    transferDisabled: true,
  });
});

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.stop();
    await session.done.catch(() => undefined);
  }
  vi.useRealTimers();
});

describe('local KemerBet enrollment session', () => {
  it('starts Chrome offline and guards HTTP and WebSockets before enabling its network', async () => {
    const { context, order, page } = await start();

    expect(dependencies.launchPersistentContext).toHaveBeenCalledWith(
      config.profileRoot,
      expect.objectContaining({
        chromiumSandbox: true,
        headless: false,
        offline: true,
        serviceWorkers: 'block',
        acceptDownloads: false,
      }),
    );
    expect(order.indexOf('context:route')).toBeGreaterThan(order.indexOf('context:launch'));
    expect(order.indexOf('context:route')).toBeLessThan(order.indexOf('context:offline:false'));
    expect(order.indexOf('context:websocket')).toBeLessThan(order.indexOf('context:offline:false'));
    expect(order.indexOf('context:offline:false')).toBeLessThan(order.indexOf('page:goto'));
    expect(context.setOffline).toHaveBeenCalledExactlyOnceWith(false);
    expect(page.goto).toHaveBeenCalledWith(
      AGENTS_URL,
      expect.objectContaining({ waitUntil: 'commit', timeout: 45_000 }),
    );
    for (const url of [ACCOUNT_INFO_URL, LOGIN_URL]) {
      expect(context.registrations.some((entry) => matchesRoute(entry.matcher, url))).toBe(true);
    }
    for (const url of [
      'wss://admin-api.agt-digi.com/socket',
      'wss://agentsystem.admindigi.com/socket',
    ]) {
      const registration = context.socketRegistrations.find((entry) =>
        matchesRoute(entry.matcher, url),
      );
      expect(registration).toBeDefined();
      const close = vi.fn();
      await registration!.handler({ close });
      expect(close).toHaveBeenCalledWith(expect.objectContaining({ code: 1008 }));
    }
  });

  it('retains a restored agent-page candidate beyond ten minutes without any Account/Info response', async () => {
    const { context, events } = await start();

    expect(events.at(-1)).toEqual({
      state: 'signed_in_verified',
      transferDisabled: true,
      detailsRedacted: true,
    });
    expect(events.map((event) => event.state)).not.toContain('authenticated');
    await vi.advanceTimersByTimeAsync(TEN_MINUTES + 1);
    expect(context.close).not.toHaveBeenCalled();
    expect(events.filter((event) => event.state === 'signed_in_candidate')).toHaveLength(1);
  });

  it('reports a newly created local identity binding without exposing identity material', async () => {
    dependencies.verifyLocalKemerBetIdentity.mockResolvedValueOnce({
      bindingCreated: true,
      identityVerified: true,
      identifiersRedacted: true,
      transferDisabled: true,
    });
    const { events } = await start();
    expect(events.at(-1)).toEqual({
      state: 'signed_in_verified',
      reason: 'identity_binding_created',
      transferDisabled: true,
      detailsRedacted: true,
    });
    expect(JSON.stringify(events)).not.toContain('@');
  });

  it('fails closed when the local identity does not match the bound KemerBet account', async () => {
    dependencies.verifyLocalKemerBetIdentity.mockRejectedValueOnce(
      Object.assign(new Error('redacted identity mismatch'), {
        code: 'FETANAGENT_IDENTITY_MISMATCH',
      }),
    );
    await expect(start()).rejects.toThrow('could not start');
  });

  it('starts a fresh identity check after a login-page interruption invalidates an active check', async () => {
    let resolveFirstVerification:
      | ((result: {
          bindingCreated: boolean;
          identityVerified: true;
          identifiersRedacted: true;
          transferDisabled: true;
        }) => void)
      | undefined;
    dependencies.verifyLocalKemerBetIdentity.mockImplementationOnce(
      async () =>
        await new Promise((resolvePromise) => {
          resolveFirstVerification = resolvePromise;
        }),
    );
    const { events, page } = await start(LOGIN_URL);

    page.navigate(AGENTS_URL);
    await settleIdentityVerification();
    expect(dependencies.verifyLocalKemerBetIdentity).toHaveBeenCalledTimes(1);
    page.navigate(LOGIN_URL);
    page.navigate(AGENTS_URL);
    await settleIdentityVerification();

    resolveFirstVerification?.({
      bindingCreated: false,
      identityVerified: true,
      identifiersRedacted: true,
      transferDisabled: true,
    });
    await settleIdentityVerification();
    await settleIdentityVerification();

    expect(dependencies.verifyLocalKemerBetIdentity).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.state).toBe('signed_in_verified');
  });

  it.each([AGENTS_URL, `${AGENTS_URL}/`])(
    'recognizes only a page candidate on the reviewed main-frame URL %s, without API evidence',
    async (url) => {
      const { events, page } = await start(LOGIN_URL);
      page.navigate(url);
      await settleIdentityVerification();
      expect(events.at(-1)).toEqual({
        state: 'signed_in_verified',
        transferDisabled: true,
        detailsRedacted: true,
      });
      expect(events.map((event) => event.state)).not.toContain('authenticated');
    },
  );

  it.each([
    `${AGENTS_URL}?unexpected=1`,
    `${AGENTS_URL}#unexpected`,
    `${AGENTS_URL}-other`,
    'https://agentsystem.admindigi.com/Agents',
    'https://example.invalid/agents',
  ])('does not classify a non-reviewed agent URL as a candidate: %s', async (url) => {
    const { events, page } = await start(LOGIN_URL);
    page.navigate(url);
    expect(events.some((event) => event.state === 'signed_in_candidate')).toBe(false);
  });

  it('ignores child-frame navigation when determining the main agent-page candidate', async () => {
    const { events, page } = await start(LOGIN_URL);
    const eventsBeforeChildFrame = events.length;
    page.emit('framenavigated', { url: () => AGENTS_URL });
    expect(events).toHaveLength(eventsBeforeChildFrame);
    expect(events.some((event) => event.state === 'signed_in_candidate')).toBe(false);

    page.navigate(AGENTS_URL);
    await settleIdentityVerification();
    expect(events.at(-1)?.state).toBe('signed_in_verified');
  });

  it.each([
    '',
    '?languageCode=en',
    '?languageCode=am',
    '?languageCode=en-US',
    '?languageCode=EN',
    '?languageCode=ENG',
    '?languageCode=am_ET',
  ])(
    'does not depend on Account/Info ordering or locale %s and never reads its content',
    async (query) => {
      const { events, page } = await start(LOGIN_URL);
      expect(events.some((event) => event.state === 'signed_in_candidate')).toBe(false);
      const response = fakeAccountInfoResponse({ url: `${ACCOUNT_INFO_URL}${query}` });

      page.emit('response', response);
      expect(events.at(-1)?.state).toBe('login_required');
      expect(events.some((event) => event.state === 'signed_in_candidate')).toBe(false);
      page.navigate(AGENTS_URL);
      await settleIdentityVerification();
      page.emit('response', response);

      expect(events.at(-1)).toEqual({
        state: 'signed_in_verified',
        transferDisabled: true,
        detailsRedacted: true,
      });
      expect(events.filter((event) => event.state === 'signed_in_candidate')).toHaveLength(1);
      expect(events.map((event) => event.state)).not.toContain('authenticated');
      for (const read of [
        response.body,
        response.json,
        response.text,
        response.headers,
        response.allHeaders,
      ]) {
        expect(read).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    { status: 201 },
    { status: 204 },
    { status: 400 },
    { status: 401 },
    { status: 403 },
    { status: 500 },
    { method: 'POST' },
    { method: 'HEAD' },
    { url: `${ACCOUNT_INFO_URL}?unexpected=1` },
    { url: `${ACCOUNT_INFO_URL}?languageCode=` },
    { url: `${ACCOUNT_INFO_URL}?languageCode=english` },
    { url: `${ACCOUNT_INFO_URL}?languageCode=en&languageCode=am` },
    { url: `${ACCOUNT_INFO_URL}?languageCode=en&extra=1` },
    { url: `${ACCOUNT_INFO_URL}#unexpected` },
    { url: `${ACCOUNT_INFO_URL}/` },
    { url: 'https://example.invalid/Account/Info' },
  ])('does not promote rejected or non-exact Account/Info evidence: %j', async (options) => {
    const { events, page } = await start(LOGIN_URL);
    page.emit('response', fakeAccountInfoResponse(options));
    expect(events.some((event) => event.state === 'signed_in_candidate')).toBe(false);
  });

  it('ignores Account/Info evidence on the login page', async () => {
    const { events, page } = await start(LOGIN_URL);
    page.emit('response', fakeAccountInfoResponse());
    expect(events.at(-1)?.state).toBe('login_required');
    expect(events.some((event) => event.state === 'signed_in_candidate')).toBe(false);
  });

  it('does not extend the twelve-hour candidate deadline on repeated agent navigation or response events', async () => {
    const { context, events, page, session } = await start();
    page.emit('response', fakeAccountInfoResponse());
    await vi.advanceTimersByTimeAsync(TWELVE_HOURS - 60 * 60 * 1_000);
    page.navigate(AGENTS_URL);
    page.navigate(`${AGENTS_URL}/`);
    page.emit('response', fakeAccountInfoResponse());
    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000 - 1);
    expect(context.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    await expect(session.done).resolves.toBeUndefined();
    expect(events.filter((event) => event.state === 'signed_in_candidate')).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      state: 'stopped',
      reason: 'candidate_lifetime_complete',
      transferDisabled: true,
      detailsRedacted: true,
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('resets a returned candidate to a fresh ten-minute login window without sliding on reload', async () => {
    const { context, events, page, session } = await start();
    await vi.advanceTimersByTimeAsync(8 * 60 * 1_000);
    page.emit('response', fakeAccountInfoResponse());
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1_000);
    page.navigate(LOGIN_URL);
    expect(events.at(-1)?.state).toBe('login_required');
    // A delayed account response cannot restore candidate state after returning to login.
    page.emit('response', fakeAccountInfoResponse());
    expect(events.filter((event) => event.state === 'signed_in_candidate')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(9 * 60 * 1_000);
    page.navigate(LOGIN_RETRY_URL);
    await vi.advanceTimersByTimeAsync(60 * 1_000 - 1);
    expect(context.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(session.done).rejects.toThrow('failed closed');
    expect(events.at(-1)).toEqual({
      state: 'failed',
      reason: 'login_lifetime_expired',
      transferDisabled: true,
      detailsRedacted: true,
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('ignores an already-queued login deadline after the same browser becomes verified', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let queuedLoginDeadline: (() => void) | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...arguments_: unknown[]) => void,
      delay?: number,
      ...arguments_: unknown[]
    ): ReturnType<typeof setTimeout> => {
      if (delay === TEN_MINUTES && queuedLoginDeadline === undefined) {
        queuedLoginDeadline = () => Reflect.apply(callback, undefined, arguments_);
        return Reflect.apply(originalSetTimeout, globalThis, [() => undefined, delay]);
      }
      return Reflect.apply(originalSetTimeout, globalThis, [callback, delay, ...arguments_]);
    }) as typeof setTimeout);
    const { context, events, page } = await start(LOGIN_URL);
    expect(queuedLoginDeadline).toBeDefined();

    page.navigate(AGENTS_URL);
    await settleIdentityVerification();
    expect(events.at(-1)?.state).toBe('signed_in_verified');
    queuedLoginDeadline!();
    await Promise.resolve();

    expect(context.close).not.toHaveBeenCalled();
    expect(events.at(-1)?.state).toBe('signed_in_verified');
  });

  it('ignores an already-queued candidate deadline after returning to login', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let queuedCandidateDeadline: (() => void) | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...arguments_: unknown[]) => void,
      delay?: number,
      ...arguments_: unknown[]
    ): ReturnType<typeof setTimeout> => {
      if (delay === TWELVE_HOURS && queuedCandidateDeadline === undefined) {
        queuedCandidateDeadline = () => Reflect.apply(callback, undefined, arguments_);
        return Reflect.apply(originalSetTimeout, globalThis, [() => undefined, delay]);
      }
      return Reflect.apply(originalSetTimeout, globalThis, [callback, delay, ...arguments_]);
    }) as typeof setTimeout);
    const { context, events, page } = await start();
    expect(queuedCandidateDeadline).toBeDefined();

    page.navigate(LOGIN_URL);
    expect(events.at(-1)?.state).toBe('login_required');
    queuedCandidateDeadline!();
    await Promise.resolve();

    expect(context.close).not.toHaveBeenCalled();
    expect(events.at(-1)?.state).toBe('login_required');
  });

  it('does not extend the initial ten-minute login deadline on repeated login navigation', async () => {
    const { context, events, page, session } = await start(LOGIN_URL);
    await vi.advanceTimersByTimeAsync(TEN_MINUTES - 1);
    page.navigate(LOGIN_RETRY_URL);
    expect(context.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(session.done).rejects.toThrow('failed closed');
    expect(events.at(-1)?.reason).toBe('login_lifetime_expired');
  });

  it('keeps the twelve-hour-ten-minute process cap when login and candidate states repeat', async () => {
    const { context, events, page, session } = await start();
    await vi.advanceTimersByTimeAsync(TWELVE_HOURS - TEN_MINUTES);
    page.navigate(LOGIN_URL);
    await vi.advanceTimersByTimeAsync(60 * 1_000);
    page.navigate(AGENTS_URL);
    await vi.advanceTimersByTimeAsync(19 * 60 * 1_000 - 1);
    expect(context.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    await expect(session.done).resolves.toBeUndefined();
    expect(events.at(-1)?.reason).toBe('session_lifetime_complete');
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it.each([LOGIN_URL, AGENTS_URL])(
    'aborts a denied provider mutation without sending it or destroying the browser at %s',
    async (landingUrl) => {
      const { context, events } = await start(landingUrl);

      const route = await context.dispatch(DEPOSIT_URL, 'POST');

      expect(route.abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
      expect(route.continue).not.toHaveBeenCalled();
      expect(route.fetch).not.toHaveBeenCalled();
      expect(route.fulfill).not.toHaveBeenCalled();
      expect(context.close).not.toHaveBeenCalled();
      expect(context.unroute).not.toHaveBeenCalled();
      expect(context.unrouteAll).not.toHaveBeenCalled();
      expect(events.at(-1)).toEqual({
        state: landingUrl === AGENTS_URL ? 'signed_in_verified' : 'login_required',
        reason: 'mutation_attempt_blocked',
        transferDisabled: true,
        detailsRedacted: true,
      });
      const second = await context.dispatch(DEPOSIT_URL, 'GET');
      expect(second.abort).toHaveBeenCalledTimes(1);
      expect(second.fetch).not.toHaveBeenCalled();
    },
  );

  it('forwards an approved provider read with redirects and retries disabled, without reading its body', async () => {
    const { context } = await start();

    const route = await context.dispatch(ACCOUNT_INFO_URL, 'GET');

    expect(route.fetch).toHaveBeenCalledExactlyOnceWith({
      url: ACCOUNT_INFO_URL,
      maxRedirects: 0,
      maxRetries: 0,
      timeout: 30_000,
    });
    expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ response: route.response });
    expect(route.response.dispose).toHaveBeenCalledTimes(1);
    expect(route.response.body).not.toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it.each([307, 308])(
    'does not follow a permitted login POST redirected with HTTP %i to a deposit',
    async (responseStatus) => {
      const { context, events, page } = await start();
      page.navigate(LOGIN_URL);
      const loginUrl = 'https://admin-api.agt-digi.com/Account/Login';

      const route = await context.dispatch(loginUrl, 'POST', {
        responseStatus,
        responseHeaders: { location: DEPOSIT_URL },
      });

      expect(route.fetch).toHaveBeenCalledExactlyOnceWith({
        url: loginUrl,
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 30_000,
      });
      expect(route.abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
      expect(route.continue).not.toHaveBeenCalled();
      expect(route.fulfill).not.toHaveBeenCalled();
      expect(route.response.body).not.toHaveBeenCalled();
      expect(route.response.dispose).toHaveBeenCalledTimes(1);
      expect(context.close).not.toHaveBeenCalled();
      expect(events.at(-1)?.reason).toBe('mutation_attempt_blocked');
    },
  );

  it('turns a safe navigation redirect into a new guarded navigation rather than fetching its target', async () => {
    const { context } = await start();

    const route = await context.dispatch(AGENTS_URL, 'GET', {
      navigation: true,
      responseStatus: 302,
      responseHeaders: { location: '/login?et=1' },
    });

    expect(route.fetch).toHaveBeenCalledExactlyOnceWith({
      url: AGENTS_URL,
      maxRedirects: 0,
      maxRetries: 0,
      timeout: 30_000,
    });
    expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      body: expect.stringContaining(`url=${LOGIN_RETRY_URL}`),
    });
    expect(route.response.body).not.toHaveBeenCalled();
    expect(route.response.dispose).toHaveBeenCalledTimes(1);
    expect(route.continue).not.toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
  });

  it('keeps the context request guard installed until browser shutdown is confirmed', async () => {
    const { context, session } = await start();
    let resolveClose!: () => void;
    context.close.mockImplementationOnce(
      () => new Promise<void>((resolvePromise) => (resolveClose = resolvePromise)),
    );

    const stopping = session.stop();
    try {
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(dependencies.releaseSessionLock).not.toHaveBeenCalled();
      const route = await context.dispatch(DEPOSIT_URL, 'POST');
      expect(route.abort).toHaveBeenCalledTimes(1);
      expect(route.continue).not.toHaveBeenCalled();
      expect(route.fetch).not.toHaveBeenCalled();
      expect(context.unroute).not.toHaveBeenCalled();
      expect(context.unrouteAll).not.toHaveBeenCalled();
    } finally {
      resolveClose();
      await stopping;
    }
    await expect(session.done).resolves.toBeUndefined();
    expect(dependencies.releaseSessionLock).toHaveBeenCalledTimes(1);
    expect(context.unroute).not.toHaveBeenCalled();
    expect(context.unrouteAll).not.toHaveBeenCalled();
  });

  it('retains the request guard and profile lock when browser closure fails', async () => {
    const { context, events, session } = await start();
    context.close.mockRejectedValueOnce(new Error('Synthetic close failure'));

    await session.stop();

    await expect(session.done).rejects.toThrow('failed closed');
    expect(events.at(-1)?.reason).toBe('shutdown_unconfirmed');
    expect(dependencies.releaseSessionLock).not.toHaveBeenCalled();
    expect(context.unroute).not.toHaveBeenCalled();
    expect(context.unrouteAll).not.toHaveBeenCalled();
    const route = await context.dispatch(DEPOSIT_URL, 'POST');
    expect(route.abort).toHaveBeenCalledTimes(1);
    expect(route.fetch).not.toHaveBeenCalled();
  });
});
