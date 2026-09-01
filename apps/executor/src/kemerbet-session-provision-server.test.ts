import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Frame, Page, Route, WebSocketRoute } from 'playwright-core';

import {
  KemerBetProvisionServerUnavailableError,
  checkpointKemerBetProvisionSignedInPage,
  createKemerBetProvisionStartupFailureEvent,
  createKemerBetRecaptchaCeremony,
  createKemerBetReadinessSealFailureEvent,
  createKemerBetReadinessSealFailureTracker,
  createKemerBetSessionProvisionServer as createRawKemerBetSessionProvisionServer,
  classifyKemerBetSessionRequest,
  isAllowedKemerBetSessionRequest,
  prepareKemerBetProvisionAuthenticatedIdentityVerifier,
  removeStaleChromiumSingletonArtifacts,
  type KemerBetReadinessSealFailureEvent,
  type KemerBetRecaptchaAssetFetcher,
  type KemerBetRecaptchaCeremony,
} from './kemerbet-session-provision-server.js';

const LOGIN_PAGE = 'https://agentsystem.admindigi.com/login?et=1';
const POST_LOGIN_ROOT_PAGE = 'https://agentsystem.admindigi.com/';
const AGENTS_PAGE = 'https://agentsystem.admindigi.com/agents';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const TEST_RECAPTCHA_SITE_KEY = 'a'.repeat(40);
const TEST_RECAPTCHA_VERSION = 'ox8dsmiqR62P1bqhciWOn7Fg';
const TEST_RECAPTCHA_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36';
const TEST_RECAPTCHA_LINUX_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36';
const TEST_RECAPTCHA_RUNTIME_URL = `https://www.gstatic.com/recaptcha/releases/${TEST_RECAPTCHA_VERSION}/recaptcha__en.js`;
const TEST_RECAPTCHA_CSS_URL = `https://www.gstatic.com/recaptcha/releases/${TEST_RECAPTCHA_VERSION}/styles__ltr.css`;
const TEST_RECAPTCHA_LOGO_URL = 'https://www.gstatic.com/recaptcha/api2/logo_48.png';
const TEST_RECAPTCHA_WORKER_URL = `https://www.google.com/recaptcha/api2/webworker.js?hl=en&v=${TEST_RECAPTCHA_VERSION}`;
const SAFE_ENVIRONMENT = Object.freeze({
  NODE_ENV: 'production',
  FINANCIAL_ACTIONS_MODE: 'dry_run',
  KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'true',
  KEMERBET_EXECUTOR_ENABLED: 'false',
  KEMERBET_FINAL_ACTION_ENABLED: 'false',
  KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false',
  INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false',
});

type ProvisionDependencies = NonNullable<
  Parameters<typeof createRawKemerBetSessionProvisionServer>[0]
>;

function createKemerBetSessionProvisionServer(dependencies: ProvisionDependencies = {}) {
  const wallClock = dependencies.now;
  return createRawKemerBetSessionProvisionServer({
    acquireProfileGenerationLease: async () => ({
      releaseAfterCleanCheckpoint: async () => undefined,
    }),
    inspectProfileGenerationLease: async () => ({ state: 'clear' }),
    inspectProfileGenerationStatus: async () => ({ state: 'clear' }),
    purgePersistedServiceWorkerState: async () => undefined,
    ...(wallClock !== undefined && dependencies.monotonicNow === undefined
      ? { monotonicNow: () => wallClock().getTime() }
      : {}),
    ...dependencies,
  });
}

function createTestIdentityFingerprinter(): ((accountId: string, rawIdentity: string) => string) & {
  readonly keyFingerprint: string;
} {
  return Object.assign(
    (profileId: string, rawIdentity: string) =>
      `hmac-sha256-agent-identity-v1:${createHash('sha256')
        .update(`${profileId}\0${rawIdentity}`, 'utf8')
        .digest('hex')}`,
    { keyFingerprint: `sha256:${'f'.repeat(64)}` },
  );
}

function prepareVerifiedIdentity(accountId: string): Promise<{
  readonly accountId: string;
  readonly fingerprintAgentIdentity: ReturnType<typeof createTestIdentityFingerprinter>;
  verify(page: Page): Promise<void>;
}> {
  return Promise.resolve({
    accountId,
    fingerprintAgentIdentity: createTestIdentityFingerprinter(),
    verify: async () => undefined,
  });
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

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

async function postSessionStart(origin: string, body: string): Promise<Response> {
  return fetch(`${origin}/v1/session/start`, {
    method: 'POST',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body,
  });
}

function sessionStatusUrl(origin: string, accountId = ACCOUNT_ID): string {
  return `${origin}/v1/session?platformAgentAccountId=${encodeURIComponent(accountId)}`;
}

function sessionFrameUrl(
  origin: string,
  generation: string,
  after: number,
  accountId = ACCOUNT_ID,
): string {
  return `${origin}/v1/session/frame?generation=${encodeURIComponent(generation)}&after=${after}&platformAgentAccountId=${encodeURIComponent(accountId)}`;
}

async function stopSession(
  origin: string,
  requestId: string,
  accountId = ACCOUNT_ID,
): Promise<Response> {
  return fetch(`${origin}/v1/session/stop`, {
    method: 'POST',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body: JSON.stringify({ platformAgentAccountId: accountId, requestId }),
  });
}

async function sessionStatus(
  origin: string,
  accountId = ACCOUNT_ID,
): Promise<Record<string, unknown>> {
  const response = await fetch(sessionStatusUrl(origin, accountId), {
    headers: { connection: 'close' },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function waitForSessionPhase(
  origin: string,
  expectedPhase: string,
  accountId = ACCOUNT_ID,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await sessionStatus(origin, accountId);
    if (status.phase === expectedPhase) return status;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
  }
  throw new Error(`Session did not reach ${expectedPhase}.`);
}

function fakeLoginBrowser(screenshot: () => Promise<Buffer>): {
  readonly context: BrowserContext;
  readonly dispatchRoute: (route: Route) => Promise<void>;
  readonly dispatchWebSocket: (route: WebSocketRoute) => Promise<void>;
  readonly emitPageClose: () => void;
  readonly emitPopup: (candidatePage: Page) => void;
  readonly emitServiceWorker: (worker?: unknown) => void;
  readonly emitUnexpectedClose: () => void;
  readonly insertedTexts: readonly string[];
  readonly isContextClosed: () => boolean;
  readonly navigate: (url: string) => void;
  readonly page: Page;
  readonly setPointerAction: (action: () => Promise<void>) => void;
  readonly setServiceWorkers: (workers: readonly unknown[]) => void;
  readonly startupEvents: readonly string[];
} {
  let contextClosed = false;
  let pageClosed = false;
  let currentUrl = LOGIN_PAGE;
  let closeListener: (() => void) | undefined;
  let pageCloseListener: (() => void) | undefined;
  let popupListener: ((candidatePage: Page) => void) | undefined;
  let serviceWorkerListener: ((worker: unknown) => void) | undefined;
  let frameNavigationListener: ((frame: unknown) => void) | undefined;
  let routeHandler: ((route: Route) => Promise<void> | void) | undefined;
  let webSocketRouteHandler: ((route: WebSocketRoute) => Promise<void> | void) | undefined;
  let pointerAction: () => Promise<void> = async () => undefined;
  let context: BrowserContext;
  let page: Page;
  let contextPages: Page[];
  let serviceWorkers: unknown[] = [];
  const insertedTexts: string[] = [];
  const startupEvents: string[] = [];
  const mainFrame = { page: () => page };
  page = {
    context: () => context,
    goto: async () => {
      startupEvents.push('goto');
      return null;
    },
    isClosed: () => pageClosed || contextClosed,
    keyboard: {
      insertText: async (text: string) => {
        insertedTexts.push(text);
      },
      press: async () => undefined,
    },
    mainFrame: () => mainFrame,
    mouse: { click: async () => pointerAction() },
    on: (event: string, listener: (value: unknown) => void) => {
      if (event === 'framenavigated') frameNavigationListener = listener;
      if (event === 'close') pageCloseListener = listener as () => void;
      return page;
    },
    screenshot,
    serviceWorkers: () => [],
    url: () => currentUrl,
    waitForTimeout: async () => undefined,
  } as unknown as Page;
  contextPages = [page];
  context = {
    close: async () => {
      if (contextClosed) return;
      contextClosed = true;
      pageClosed = true;
      pageCloseListener?.();
      closeListener?.();
    },
    newPage: async () => page,
    on: (event: string, listener: (...values: never[]) => void) => {
      if (event === 'close') closeListener = listener;
      if (event === 'page') {
        startupEvents.push('popup-guard');
        popupListener = listener as (candidatePage: Page) => void;
      }
      if (event === 'serviceworker') {
        startupEvents.push('serviceworker-guard');
        serviceWorkerListener = listener as (worker: unknown) => void;
      }
      return context;
    },
    pages: () => contextPages,
    route: async (_pattern: string, handler: (route: Route) => Promise<void> | void) => {
      startupEvents.push('http-guard');
      routeHandler = handler;
    },
    routeWebSocket: async (
      _pattern: string,
      handler: (route: WebSocketRoute) => Promise<void> | void,
    ) => {
      startupEvents.push('websocket-guard');
      webSocketRouteHandler = handler;
    },
    setOffline: async (offline: boolean) => {
      startupEvents.push(`offline:${String(offline)}`);
    },
    serviceWorkers: () => serviceWorkers,
  } as unknown as BrowserContext;
  return {
    context,
    dispatchRoute: async (route) => {
      if (!routeHandler) throw new Error('Context route guard was not installed.');
      await routeHandler(route);
    },
    dispatchWebSocket: async (route) => {
      if (!webSocketRouteHandler) throw new Error('Context WebSocket guard was not installed.');
      await webSocketRouteHandler(route);
    },
    emitPageClose: () => {
      if (pageClosed || contextClosed) return;
      pageClosed = true;
      pageCloseListener?.();
    },
    emitPopup: (candidatePage) => {
      contextPages = [...contextPages, candidatePage];
      popupListener?.(candidatePage);
    },
    emitServiceWorker: (worker = {}) => {
      serviceWorkers = [...serviceWorkers, worker];
      serviceWorkerListener?.(worker);
    },
    emitUnexpectedClose: () => {
      if (contextClosed) return;
      contextClosed = true;
      pageClosed = true;
      closeListener?.();
    },
    insertedTexts,
    isContextClosed: () => contextClosed,
    navigate: (url) => {
      currentUrl = url;
      frameNavigationListener?.(mainFrame);
    },
    page,
    setPointerAction: (action) => {
      pointerAction = action;
    },
    setServiceWorkers: (workers) => {
      serviceWorkers = [...workers];
    },
    startupEvents,
  };
}

const TEST_RECAPTCHA_BODIES = Object.freeze({
  api: Buffer.from('reviewed api fixture'),
  css: Buffer.from('reviewed css fixture'),
  logo: Buffer.from('reviewed logo fixture'),
  runtime: Buffer.from('reviewed runtime fixture'),
  webworker: Buffer.from('reviewed worker fixture'),
});

const TEST_RECAPTCHA_PINS = Object.freeze(
  Object.fromEntries(
    Object.entries(TEST_RECAPTCHA_BODIES).map(([name, body]) => [
      name,
      Object.freeze({
        accessControlAllowOrigin: name === 'runtime' ? '*' : undefined,
        bytes: body.byteLength,
        crossOriginEmbedderPolicy: name === 'webworker' ? 'require-corp' : undefined,
        crossOriginResourcePolicy: name === 'webworker' ? 'same-site' : 'cross-origin',
        mime: name === 'css' ? 'text/css' : name === 'logo' ? 'image/png' : 'text/javascript',
        sha256: createHash('sha256').update(body).digest('hex'),
      }),
    ]),
  ) as {
    readonly api: TestRecaptchaPin;
    readonly css: TestRecaptchaPin;
    readonly logo: TestRecaptchaPin;
    readonly runtime: TestRecaptchaPin;
    readonly webworker: TestRecaptchaPin;
  },
);

interface TestRecaptchaPin {
  readonly accessControlAllowOrigin?: string | undefined;
  readonly bytes: number;
  readonly crossOriginEmbedderPolicy?: string | undefined;
  readonly crossOriginResourcePolicy: string;
  readonly mime: string;
  readonly sha256: string;
}

function testRecaptchaAsset(url: string): {
  readonly body: Buffer;
  readonly mime: string;
  readonly pin: TestRecaptchaPin;
} {
  if (url.startsWith('https://www.google.com/recaptcha/api.js?render=')) {
    return {
      body: TEST_RECAPTCHA_BODIES.api,
      mime: 'text/javascript',
      pin: TEST_RECAPTCHA_PINS.api,
    };
  }
  if (url === TEST_RECAPTCHA_RUNTIME_URL) {
    return {
      body: TEST_RECAPTCHA_BODIES.runtime,
      mime: 'text/javascript',
      pin: TEST_RECAPTCHA_PINS.runtime,
    };
  }
  if (url === TEST_RECAPTCHA_CSS_URL) {
    return { body: TEST_RECAPTCHA_BODIES.css, mime: 'text/css', pin: TEST_RECAPTCHA_PINS.css };
  }
  if (url === TEST_RECAPTCHA_LOGO_URL) {
    return { body: TEST_RECAPTCHA_BODIES.logo, mime: 'image/png', pin: TEST_RECAPTCHA_PINS.logo };
  }
  if (url === TEST_RECAPTCHA_WORKER_URL) {
    return {
      body: TEST_RECAPTCHA_BODIES.webworker,
      mime: 'text/javascript',
      pin: TEST_RECAPTCHA_PINS.webworker,
    };
  }
  throw new Error('Unexpected test asset URL.');
}

function testRecaptchaFetcher(): KemerBetRecaptchaAssetFetcher {
  return async ({ url, userAgent }) => {
    if (userAgent !== TEST_RECAPTCHA_USER_AGENT) {
      throw new Error('Unexpected test Chromium User-Agent.');
    }
    const asset = testRecaptchaAsset(url);
    return {
      accessControlAllowOrigin: asset.pin.accessControlAllowOrigin ?? null,
      body: asset.body,
      contentType: asset.mime,
      crossOriginEmbedderPolicy: asset.pin.crossOriginEmbedderPolicy ?? null,
      crossOriginResourcePolicy: asset.pin.crossOriginResourcePolicy,
      finalUrl: url,
      status: 200,
    };
  };
}

interface TestRecaptchaRoute {
  readonly abort: ReturnType<typeof vi.fn>;
  readonly continue: ReturnType<typeof vi.fn>;
  readonly fulfill: ReturnType<typeof vi.fn>;
  readonly frame?: Frame;
  readonly route: Route;
}

function testRecaptchaFrames(): {
  readonly anchorFrame: Frame;
  readonly mainFrame: Frame;
  readonly navigate: (url: string) => void;
  readonly page: Page;
} {
  let currentUrl = LOGIN_PAGE;
  let page: Page;
  const mainFrame = {
    page: () => page,
    parentFrame: () => null,
    url: () => LOGIN_PAGE,
  } as unknown as Frame;
  const anchorFrame = {
    page: () => page,
    parentFrame: () => mainFrame,
    url: () => exactTestAnchorUrl(),
  } as unknown as Frame;
  page = {
    mainFrame: () => mainFrame,
    url: () => currentUrl,
  } as unknown as Page;
  return {
    anchorFrame,
    mainFrame,
    navigate: (url: string) => {
      currentUrl = url;
    },
    page,
  };
}

function testRecaptchaFramesForPage(page: Page): {
  readonly anchorFrame: Frame;
  readonly mainFrame: Frame;
  readonly page: Page;
} {
  const mainFrame = page.mainFrame();
  const anchorFrame = {
    page: () => page,
    parentFrame: () => mainFrame,
    url: () => exactTestAnchorUrl(),
  } as unknown as Frame;
  return { anchorFrame, mainFrame, page };
}

function testRecaptchaRoute(input: {
  readonly bodyBytes?: number;
  readonly contentType?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly frame?: Frame;
  readonly frameUnavailable?: boolean;
  readonly method?: string;
  readonly navigation?: boolean;
  readonly postData?: string | null;
  readonly redirected?: boolean;
  readonly resourceType: string;
  readonly url: string;
  readonly userAgent?: string | null;
}): TestRecaptchaRoute {
  const abort = vi.fn(async () => undefined);
  const continueRequest = vi.fn(async () => undefined);
  const fulfill = vi.fn(async () => undefined);
  const request = {
    frame: () => {
      if (input.frameUnavailable) throw new Error('worker request has no frame');
      if (!input.frame) throw new Error('test frame missing');
      return input.frame;
    },
    headers: () => ({
      ...input.extraHeaders,
      ...(input.contentType === undefined ? {} : { 'content-type': input.contentType }),
      ...(input.userAgent === null
        ? {}
        : { 'user-agent': input.userAgent ?? TEST_RECAPTCHA_USER_AGENT }),
    }),
    isNavigationRequest: () => input.navigation ?? false,
    method: () => input.method ?? 'GET',
    postData: () => input.postData ?? null,
    postDataBuffer: () =>
      input.bodyBytes === undefined ? null : Buffer.alloc(input.bodyBytes, 0x78),
    redirectedFrom: () => (input.redirected ? ({} as never) : null),
    resourceType: () => input.resourceType,
    url: () => input.url,
  };
  return {
    abort,
    continue: continueRequest,
    fulfill,
    ...(input.frame === undefined ? {} : { frame: input.frame }),
    route: {
      abort,
      continue: continueRequest,
      fulfill,
      request: () => request,
    } as unknown as Route,
  };
}

function exactTestAnchorUrl(
  overrides: Readonly<Record<string, string>> = {},
  duplicate?: readonly [string, string],
): string {
  const query = new URLSearchParams([
    ['ar', '1'],
    ['k', TEST_RECAPTCHA_SITE_KEY],
    ['co', 'aHR0cHM6Ly9hZ2VudHN5c3RlbS5hZG1pbmRpZ2kuY29tOjQ0Mw..'],
    ['hl', 'en'],
    ['v', TEST_RECAPTCHA_VERSION],
    ['size', 'invisible'],
    ['anchor-ms', '20000'],
    ['execute-ms', '30000'],
    ['cb', 'abc123def456'],
  ]);
  for (const [key, value] of Object.entries(overrides)) query.set(key, value);
  if (duplicate) query.append(duplicate[0], duplicate[1]);
  return `https://www.google.com/recaptcha/api2/anchor?${query.toString()}`;
}

function exactTestRecaptchaRoutes(frames: {
  readonly anchorFrame: Frame;
  readonly mainFrame: Frame;
  readonly page: Page;
}): readonly TestRecaptchaRoute[] {
  return [
    testRecaptchaRoute({
      frame: frames.mainFrame,
      resourceType: 'script',
      url: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
    }),
    testRecaptchaRoute({
      frame: frames.mainFrame,
      resourceType: 'script',
      url: TEST_RECAPTCHA_RUNTIME_URL,
    }),
    testRecaptchaRoute({
      frame: frames.anchorFrame,
      navigation: true,
      resourceType: 'document',
      url: exactTestAnchorUrl(),
    }),
    testRecaptchaRoute({
      frame: frames.anchorFrame,
      resourceType: 'stylesheet',
      url: TEST_RECAPTCHA_CSS_URL,
    }),
    testRecaptchaRoute({
      frame: frames.anchorFrame,
      resourceType: 'script',
      url: TEST_RECAPTCHA_RUNTIME_URL,
    }),
    testRecaptchaRoute({
      extraHeaders: { referer: exactTestAnchorUrl() },
      frame: frames.anchorFrame,
      resourceType: 'script',
      url: TEST_RECAPTCHA_WORKER_URL,
      userAgent: null,
    }),
    testRecaptchaRoute({
      frame: frames.anchorFrame,
      resourceType: 'image',
      url: TEST_RECAPTCHA_LOGO_URL,
    }),
    testRecaptchaRoute({
      frame: frames.anchorFrame,
      resourceType: 'other',
      url: TEST_RECAPTCHA_RUNTIME_URL,
    }),
    testRecaptchaRoute({
      bodyBytes: 10_892,
      contentType: 'application/x-protobuffer',
      frame: frames.anchorFrame,
      method: 'POST',
      resourceType: 'xhr',
      url: `https://www.google.com/recaptcha/api2/reload?k=${TEST_RECAPTCHA_SITE_KEY}`,
    }),
    testRecaptchaRoute({
      bodyBytes: 2_107,
      frame: frames.mainFrame,
      method: 'POST',
      resourceType: 'fetch',
      url: `https://www.google.com/recaptcha/api2/clr?k=${TEST_RECAPTCHA_SITE_KEY}`,
    }),
    testRecaptchaRoute({
      bodyBytes: 7_949,
      contentType: 'application/x-protobuf',
      frame: frames.anchorFrame,
      method: 'POST',
      resourceType: 'xhr',
      url: `https://www.google.com/recaptcha/api2/bcn?k=${TEST_RECAPTCHA_SITE_KEY}`,
    }),
  ];
}

function createTestRecaptchaCeremony(
  input: {
    readonly fetchAsset?: KemerBetRecaptchaAssetFetcher;
    readonly monotonicNow?: () => number;
    readonly onForbiddenRequest?: (stage: 'recaptcha_asset' | 'recaptcha_ceremony') => void;
    readonly wallClockNow?: () => number;
  } = {},
) {
  return createKemerBetRecaptchaCeremony({
    assetPins: TEST_RECAPTCHA_PINS,
    deadlineMonotonicMs: 10_000,
    deadlineWallClockMs: 10_000,
    expectedSiteKeySha256: createHash('sha256').update(TEST_RECAPTCHA_SITE_KEY).digest('hex'),
    fetchAsset: input.fetchAsset ?? testRecaptchaFetcher(),
    monotonicNow: input.monotonicNow ?? (() => 1_000),
    onForbiddenRequest: input.onForbiddenRequest ?? (() => undefined),
    wallClockNow: input.wallClockNow ?? (() => 1_000),
  });
}

async function dispatchTestRecaptchaRoute(
  ceremony: ReturnType<typeof createTestRecaptchaCeremony>,
  page: Page,
  candidate: TestRecaptchaRoute,
): Promise<void> {
  await ceremony.handleRoute({
    page,
    ...(candidate.frame === undefined ? {} : { requestFrame: candidate.frame }),
    route: candidate.route,
  });
}

function completeTestPostLoginTransition(
  ceremony: ReturnType<typeof createTestRecaptchaCeremony>,
  frames: ReturnType<typeof testRecaptchaFrames>,
  readOrder: readonly ('account_info' | 'available_published')[] = [
    'account_info',
    'available_published',
  ],
): void {
  expect(ceremony.consumePostLoginRequestPermit(LOGIN_PAGE, 'login_reload_navigation')).toBe(true);
  expect(ceremony.observeMainFrameCommit(LOGIN_PAGE)).toBe('post_login_reload');
  frames.navigate(POST_LOGIN_ROOT_PAGE);
  expect(ceremony.observeMainFrameCommit(POST_LOGIN_ROOT_PAGE)).toBe('post_login_root');
  for (const permit of readOrder) {
    expect(ceremony.consumePostLoginRequestPermit(POST_LOGIN_ROOT_PAGE, permit)).toBe(true);
  }
  frames.navigate(AGENTS_PAGE);
  expect(ceremony.observeMainFrameCommit(AGENTS_PAGE)).toBe('agents');
}

function stubProvisionRecaptchaCeremony(
  input: {
    readonly classifyCommittedPage?: KemerBetRecaptchaCeremony['classifyCommittedPage'];
    readonly consumePermit?: boolean;
    readonly consumePostLoginPermit?: KemerBetRecaptchaCeremony['consumePostLoginRequestPermit'];
    readonly handle?: 'handled' | 'not_recaptcha';
    readonly onConsume?: () => void;
    readonly onHandle?: () => void;
    readonly retire?: boolean;
  } = {},
): {
  readonly ceremony: KemerBetRecaptchaCeremony;
  readonly classifyCommittedPage: ReturnType<typeof vi.fn>;
  readonly consumeKemerBetLoginPermit: ReturnType<typeof vi.fn>;
  readonly consumePostLoginRequestPermit: ReturnType<typeof vi.fn>;
  readonly handleRoute: ReturnType<typeof vi.fn>;
  readonly observeMainFrameCommit: ReturnType<typeof vi.fn>;
  readonly retireForReauthentication: ReturnType<typeof vi.fn>;
} {
  const classifyCommittedPage = vi.fn(
    input.classifyCommittedPage ??
      ((pageUrl: string) => {
        if (pageUrl === LOGIN_PAGE) return 'login';
        if (pageUrl === AGENTS_PAGE) return 'agents';
        return undefined;
      }),
  );
  const consumeKemerBetLoginPermit = vi.fn(async () => {
    input.onConsume?.();
    return input.consumePermit ?? true;
  });
  const consumePostLoginRequestPermit = vi.fn(input.consumePostLoginPermit ?? (() => false));
  const handleRoute = vi.fn(async () => {
    input.onHandle?.();
    return input.handle ?? ('handled' as const);
  });
  const observeMainFrameCommit = vi.fn(() => undefined);
  const retireForReauthentication = vi.fn(() => input.retire ?? true);
  return {
    ceremony: {
      classifyCommittedPage,
      consumeKemerBetLoginPermit,
      consumePostLoginRequestPermit,
      handleRoute,
      observeMainFrameCommit,
      retireForReauthentication,
    },
    classifyCommittedPage,
    consumeKemerBetLoginPermit,
    consumePostLoginRequestPermit,
    handleRoute,
    observeMainFrameCommit,
    retireForReauthentication,
  };
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
    expect(source).toMatch(
      /const MAX_GENERATION_LIFETIME_MS = LOGIN_LIFETIME_MS \+ AUTHENTICATED_SESSION_LIFETIME_MS/u,
    );
    expect(source).toMatch(/armExpiry\(LOGIN_LIFETIME_MS, input\.requestId\)/u);
    expect(source).toContain('authenticatedDeadline ??= new Date(');
    expect(source).toContain(
      'armExpiryAt(authenticatedDeadline, authenticatedDeadlineMonotonicMs, generation)',
    );
    expect(source).toContain("nextPage.on('framenavigated'");
    expect(source).toContain('Math.min(deadline.getTime(), generationDeadline.getTime())');
    expect(source).not.toMatch(/const SESSION_LIFETIME_MS/u);
    const statusBody = source.slice(
      source.indexOf('const status = async'),
      source.indexOf('const initialize = async'),
    );
    expect(statusBody).not.toContain('screenshot');
    expect(statusBody).toContain('checkpointedForRecheck &&');
    expect(statusBody).toContain("phase !== 'checkpointed' &&");
    expect(statusBody).toContain('!exactTerminalStartupFailure');
    expect(source).toContain("request.url?.startsWith('/v1/session/frame?')");
    const frameRoute = source.slice(
      source.indexOf("request.url?.startsWith('/v1/session/frame?')"),
      source.indexOf("request.url === '/v1/session/start'"),
    );
    expect(frameRoute).toContain('checkpointedForRecheck ||');
    expect(source).toContain('sendJson(response, 202, start(candidate))');
  });

  it('creates only the fixed redacted startup failure event', () => {
    const event = createKemerBetProvisionStartupFailureEvent(
      'recaptcha_asset',
      'contract_mismatch',
    );
    expect(event).toEqual({
      component: 'kemerbet_session_provision',
      detailsRedacted: true,
      event: 'startup_failed',
      failureCode: 'contract_mismatch',
      schemaVersion: 1,
      stage: 'recaptcha_asset',
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(JSON.stringify(event)).not.toMatch(/password|token|request|url|stack/iu);
  });

  it('accepts startup immediately, keeps metadata responsive, and deduplicates by generation', async () => {
    const neverReady = new Promise<void>(() => undefined);
    const setTimer = vi.fn(
      () => ({}) as ReturnType<typeof setTimeout>,
    ) as unknown as typeof setTimeout;
    const clearTimer = vi.fn() as unknown as typeof clearTimeout;
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => neverReady,
      clearTimer,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      setTimer,
    });
    const origin = await listenOnLoopback(provision.server);
    const requestBody = JSON.stringify({
      platformAgentAccountId: ACCOUNT_ID,
      requestId: REQUEST_ID,
    });
    try {
      const accepted = await postSessionStart(origin, requestBody);
      expect(accepted.status).toBe(202);
      const starting = await accepted.json();
      expect(starting).toMatchObject({
        active: true,
        frameSequence: 0,
        generation: REQUEST_ID,
        loginRequired: false,
        phase: 'starting',
        signedIn: false,
        startup: {
          detailsRedacted: true,
          schemaVersion: 1,
          stage: 'preflight',
          status: 'starting',
        },
        transferDisabled: true,
      });
      expect(starting).not.toHaveProperty('imageBase64');

      const metadata = await fetch(sessionStatusUrl(origin), {
        headers: { connection: 'close' },
      });
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toEqual(starting);

      const unchangedFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      expect(unchangedFrame.status).toBe(204);
      expect(unchangedFrame.headers.get('x-fetanagent-session-generation')).toBe(REQUEST_ID);
      expect(unchangedFrame.headers.get('x-fetanagent-frame-sequence')).toBe('0');

      const duplicate = await postSessionStart(origin, requestBody);
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toEqual(starting);

      const conflicting = await postSessionStart(
        origin,
        JSON.stringify({
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
        }),
      );
      expect(conflicting.status).toBe(503);
      expect(await conflicting.json()).toEqual({ error: 'session_unavailable' });
    } finally {
      await closeServer(provision.server);
    }
  });

  it('refuses to launch when the immutable identity binding is for another active account', async () => {
    const launchPersistentContext = vi.fn();
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: async () => ({
        accountId: OTHER_ACCOUNT_ID,
        fingerprintAgentIdentity: createTestIdentityFingerprinter(),
        verify: async () => undefined,
      }),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      const failed = await waitForSessionPhase(origin, 'idle');
      expect(failed).toMatchObject({
        active: false,
        startup: {
          detailsRedacted: true,
          failureCode: 'contract_mismatch',
          schemaVersion: 1,
          stage: 'preflight',
          status: 'failed',
        },
        transferDisabled: true,
      });
      expect(logStartupFailure).toHaveBeenCalledOnce();
      expect(logStartupFailure).toHaveBeenCalledWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'contract_mismatch',
        schemaVersion: 1,
        stage: 'preflight',
      });
      const duplicate = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toEqual(failed);
      expect(logStartupFailure).toHaveBeenCalledOnce();
      const crossAccountDuplicate = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: OTHER_ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      expect(crossAccountDuplicate.status).toBe(503);
      expect(await crossAccountDuplicate.json()).toEqual({ error: 'session_unavailable' });
      expect(logStartupFailure).toHaveBeenCalledOnce();
      expect(launchPersistentContext).not.toHaveBeenCalled();
    } finally {
      await closeServer(provision.server);
    }
  });

  it('preserves one cleanup failure for the exact account and id after forced startup teardown', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    browser.emitPageClose();
    Object.assign(browser.context, {
      route: async () => {
        throw new Error('https://provider.invalid/?password=must-never-appear');
      },
    });
    const launchPersistentContext = vi.fn(async () => browser.context);
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      const failed = await waitForSessionPhase(origin, 'idle');
      expect(failed).toMatchObject({
        active: false,
        startup: {
          detailsRedacted: true,
          failureCode: 'cleanup_unverified',
          schemaVersion: 1,
          stage: 'cleanup',
          status: 'failed',
        },
        transferDisabled: true,
      });
      expect(logStartupFailure).toHaveBeenCalledExactlyOnceWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'cleanup_unverified',
        schemaVersion: 1,
        stage: 'cleanup',
      });
      expect(JSON.stringify(logStartupFailure.mock.calls)).not.toMatch(
        /provider\.invalid|password|must-never-appear/iu,
      );

      const duplicate = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toEqual(failed);

      const crossAccountDuplicate = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: OTHER_ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      expect(crossAccountDuplicate.status).toBe(503);
      const newRequest = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: SECOND_REQUEST_ID }),
      );
      expect(newRequest.status).toBe(503);
      expect(launchPersistentContext).toHaveBeenCalledOnce();
      expect(logStartupFailure).toHaveBeenCalledOnce();
    } finally {
      await closeServer(provision.server);
    }
  });

  it('lets forced cleanup override a racing startup transport failure', async () => {
    const navigation = deferred<null>();
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    Object.assign(browser.page, { goto: async () => navigation.promise });
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (browser.startupEvents.includes('offline:false')) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      }
      expect(browser.startupEvents).toContain('offline:false');

      browser.emitServiceWorker();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const current = await sessionStatus(origin);
        if (current.phase === 'faulted' || current.phase === 'stopping') break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      }
      browser.emitPageClose();
      navigation.resolve(null);

      const failed = await waitForSessionPhase(origin, 'idle');
      expect(failed).toMatchObject({
        active: false,
        startup: {
          failureCode: 'cleanup_unverified',
          stage: 'cleanup',
          status: 'failed',
        },
        transferDisabled: true,
      });
      expect(logStartupFailure).toHaveBeenCalledExactlyOnceWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'cleanup_unverified',
        schemaVersion: 1,
        stage: 'cleanup',
      });
    } finally {
      navigation.resolve(null);
      await closeServer(provision.server);
    }
  });

  it('keeps the causal startup failure when a stopping race already produced a clean checkpoint', async () => {
    const navigation = deferred<null>();
    const firstBrowser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const secondBrowser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    Object.assign(firstBrowser.page, { goto: async () => navigation.promise });
    const releaseAfterCleanCheckpoint = vi.fn(async () => undefined);
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const launchPersistentContext = vi
      .fn()
      .mockResolvedValueOnce(firstBrowser.context)
      .mockResolvedValueOnce(secondBrowser.context);
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      acquireProfileGenerationLease: async () => ({ releaseAfterCleanCheckpoint }),
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (firstBrowser.startupEvents.includes('offline:false')) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      }
      expect(firstBrowser.startupEvents).toContain('offline:false');

      firstBrowser.emitServiceWorker();
      await waitForSessionPhase(origin, 'stopping');
      navigation.resolve(null);

      const failed = await waitForSessionPhase(origin, 'idle');
      expect(failed).toMatchObject({
        active: false,
        startup: {
          failureCode: 'forbidden_request',
          stage: 'transport_guard',
          status: 'failed',
        },
        transferDisabled: true,
      });
      expect(logStartupFailure).toHaveBeenCalledExactlyOnceWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'forbidden_request',
        schemaVersion: 1,
        stage: 'transport_guard',
      });
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
      expect(releaseAfterCleanCheckpoint).toHaveBeenCalledTimes(1);

      const restarted = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: SECOND_REQUEST_ID }),
      );
      expect(restarted.status).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      expect(launchPersistentContext).toHaveBeenCalledTimes(2);
      expect((await stopSession(origin, SECOND_REQUEST_ID)).status).toBe(202);
      await waitForSessionPhase(origin, 'idle');
    } finally {
      navigation.resolve(null);
      await closeServer(provision.server);
    }
  });

  it('keeps a navigation failure operation-local after concurrent provider and reCAPTCHA progress', async () => {
    const sensitive = 'https://provider.invalid/?credential=must-never-escape';
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const abort = vi.fn(async () => undefined);
    const continueRequest = vi.fn(async () => undefined);
    const providerAssetRoute = {
      abort,
      continue: continueRequest,
      request: () => ({
        frame: () => browser.page.mainFrame(),
        headers: () => ({}),
        isNavigationRequest: () => false,
        method: () => 'GET',
        postData: () => null,
        redirectedFrom: () => null,
        resourceType: () => 'image',
        url: () =>
          'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/logo-sign-DirsW9WY.svg',
      }),
    } as unknown as Route;
    let reportRecaptchaStage:
      ((stage: 'recaptcha_asset' | 'recaptcha_ceremony') => void) | undefined;
    const recaptcha = stubProvisionRecaptchaCeremony({ handle: 'not_recaptcha' });
    Object.assign(browser.page, {
      goto: async () => {
        await browser.dispatchRoute(providerAssetRoute);
        reportRecaptchaStage?.('recaptcha_asset');
        reportRecaptchaStage?.('recaptcha_ceremony');
        throw new Error(sensitive);
      },
    });
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony: (input) => {
        reportRecaptchaStage = input.onStage;
        return recaptcha.ceremony;
      },
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      const failed = await waitForSessionPhase(origin, 'idle');
      expect(abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
      expect(continueRequest).not.toHaveBeenCalled();
      expect(failed).toMatchObject({
        active: false,
        startup: {
          failureCode: 'dependency_unavailable',
          stage: 'provider_navigation',
          status: 'failed',
        },
      });
      expect(logStartupFailure).toHaveBeenCalledExactlyOnceWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'dependency_unavailable',
        schemaVersion: 1,
        stage: 'provider_navigation',
      });
      expect(JSON.stringify({ failed, calls: logStartupFailure.mock.calls })).not.toContain(
        sensitive,
      );
    } finally {
      await closeServer(provision.server);
    }
  });

  it('retries a failed initial preview capture on the next serialized frame request', async () => {
    const screenshot = vi
      .fn<() => Promise<Buffer>>()
      .mockRejectedValueOnce(new Error('temporary screenshot failure'))
      .mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const browser = fakeLoginBrowser(screenshot);
    const closePersistentBrowserForCheckpoint = vi.fn(async () => {
      await browser.context.close();
    });
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      const accepted = await postSessionStart(
        origin,
        JSON.stringify({
          platformAgentAccountId: ACCOUNT_ID,
          requestId: REQUEST_ID,
        }),
      );
      expect(accepted.status).toBe(202);
      const loginRequired = await waitForSessionPhase(origin, 'login_required');
      expect(loginRequired.frameSequence).toBe(0);

      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      expect(frame.status).toBe(200);
      expect(frame.headers.get('content-type')).toBe('image/jpeg');
      expect(frame.headers.get('x-fetanagent-frame-sequence')).toBe('1');
      expect(Buffer.from(await frame.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      expect(screenshot).toHaveBeenCalledTimes(2);
      expect(screenshot).toHaveBeenLastCalledWith({
        animations: 'disabled',
        quality: 70,
        timeout: 4_000,
        type: 'jpeg',
      });
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('binds status, frame, input, Stop, and duplicate Start to the exact active account while starting', async () => {
    const neverReady = new Promise<void>(() => undefined);
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => neverReady,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);

      const wrongStatus = await fetch(sessionStatusUrl(origin, OTHER_ACCOUNT_ID), {
        headers: { connection: 'close' },
      });
      expect(wrongStatus.status).toBe(503);
      expect(await wrongStatus.json()).toEqual({ error: 'session_unavailable' });

      const wrongFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0, OTHER_ACCOUNT_ID), {
        headers: { connection: 'close' },
      });
      expect(wrongFrame.status).toBe(503);
      expect(await wrongFrame.json()).toEqual({ error: 'session_unavailable' });

      const wrongInput = await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence: 1,
          key: 'Tab',
          kind: 'key',
          platformAgentAccountId: OTHER_ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
        }),
      });
      expect(wrongInput.status).toBe(503);
      expect(await wrongInput.json()).toEqual({ error: 'session_unavailable' });

      const wrongStop = await stopSession(origin, SECOND_REQUEST_ID, OTHER_ACCOUNT_ID);
      expect(wrongStop.status).toBe(503);
      expect(await wrongStop.json()).toEqual({ error: 'session_unavailable' });

      const wrongDuplicate = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: OTHER_ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      expect(wrongDuplicate.status).toBe(503);
      expect(await wrongDuplicate.json()).toEqual({ error: 'session_unavailable' });

      expect(await sessionStatus(origin)).toMatchObject({
        generation: REQUEST_ID,
        phase: 'starting',
      });
    } finally {
      await closeServer(provision.server);
    }
  });

  it('refreshes a same-URL login preview after the bounded freshness interval', async () => {
    const firstImage = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
    const secondImage = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9]);
    const screenshot = vi
      .fn<() => Promise<Buffer>>()
      .mockResolvedValueOnce(firstImage)
      .mockResolvedValueOnce(secondImage);
    const browser = fakeLoginBrowser(screenshot);
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');

      const firstFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      expect(firstFrame.status).toBe(200);
      expect(firstFrame.headers.get('x-fetanagent-frame-sequence')).toBe('1');
      expect(Buffer.from(await firstFrame.arrayBuffer())).toEqual(firstImage);

      timestamp += 1_000;
      const refreshedFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 1), {
        headers: { connection: 'close' },
      });
      expect(refreshedFrame.status).toBe(200);
      expect(refreshedFrame.headers.get('x-fetanagent-frame-sequence')).toBe('2');
      expect(Buffer.from(await refreshedFrame.arrayBuffer())).toEqual(secondImage);
      expect(screenshot).toHaveBeenCalledTimes(2);
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('dispatches each exact printable text batch once against its consumed displayed frame', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const firstFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      let frameSequence = Number(firstFrame.headers.get('x-fetanagent-frame-sequence'));

      for (const text of ['OwnerUser2026', 'P@ss word!']) {
        const response = await fetch(`${origin}/v1/session/input`, {
          method: 'POST',
          headers: { connection: 'close', 'content-type': 'application/json' },
          body: JSON.stringify({
            frameSequence,
            kind: 'text',
            platformAgentAccountId: ACCOUNT_ID,
            requestId: SECOND_REQUEST_ID,
            sessionGeneration: REQUEST_ID,
            text,
          }),
        });
        expect(response.status).toBe(200);
        const status = (await response.json()) as Record<string, unknown>;
        expect(status.phase).toBe('login_required');
        expect(status.frameSequence).toBeTypeOf('number');
        frameSequence = Number(status.frameSequence);
      }

      expect(browser.insertedTexts).toEqual(['OwnerUser2026', 'P@ss word!']);
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('rejects malformed, oversized, backtick, control, non-ASCII, and extra-key text batches', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      const frameSequence = Number(frame.headers.get('x-fetanagent-frame-sequence'));
      const exact = {
        frameSequence,
        kind: 'text',
        platformAgentAccountId: ACCOUNT_ID,
        requestId: SECOND_REQUEST_ID,
        sessionGeneration: REQUEST_ID,
      } as const;

      for (const candidate of [
        { ...exact, text: '' },
        { ...exact, text: 'x'.repeat(65) },
        { ...exact, text: 'has`backtick' },
        { ...exact, text: 'has\ncontrol' },
        { ...exact, text: 'nonascii-አ' },
        { ...exact, text: 'valid', extra: true },
        { ...exact },
      ]) {
        const response = await fetch(`${origin}/v1/session/input`, {
          method: 'POST',
          headers: { connection: 'close', 'content-type': 'application/json' },
          body: JSON.stringify(candidate),
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'session_unavailable' });
      }
      expect(browser.insertedTexts).toEqual([]);

      const accepted = await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({ ...exact, text: 'valid final batch' }),
      });
      expect(accepted.status).toBe(200);
      expect(browser.insertedTexts).toEqual(['valid final batch']);
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('ignores a queued login timer after the same input authenticates and rearms twelve hours', async () => {
    const timerCallbacks: Array<() => void> = [];
    const setTimer = ((callback: () => void) => {
      timerCallbacks.push(callback);
      return timerCallbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const clearTimer = vi.fn() as unknown as typeof clearTimeout;
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const displayedFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      expect(displayedFrame.status).toBe(200);
      const displayedSequence = Number(displayedFrame.headers.get('x-fetanagent-frame-sequence'));
      const queuedLoginTimer = timerCallbacks.at(-1);
      expect(queuedLoginTimer).toBeTypeOf('function');

      browser.setPointerAction(async () => {
        timestamp += 10 * 60 * 1_000 - 1;
        browser.navigate(AGENTS_PAGE);
        queuedLoginTimer?.();
      });
      const input = await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence: displayedSequence,
          kind: 'pointer',
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
          x: 10,
          y: 10,
        }),
      });
      expect(input.status).toBe(200);
      expect(await input.json()).toMatchObject({ phase: 'authenticating', signedIn: false });

      const authenticated = await waitForSessionPhase(origin, 'authenticated');
      expect(authenticated).toMatchObject({ phase: 'authenticated', signedIn: true });
      expect(authenticated.expiresAt).toBe('2026-08-27T12:09:59.999Z');
      expect(clearTimer).toHaveBeenCalled();
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('rotates the one-use ceremony synchronously for bounded reauthentication without extending twelve hours', async () => {
    const firstCeremony = stubProvisionRecaptchaCeremony();
    const secondCeremony = stubProvisionRecaptchaCeremony();
    const ceremonies = [firstCeremony, secondCeremony];
    const ceremonyDeadlines: number[] = [];
    const ceremonyWallDeadlines: number[] = [];
    const createRecaptchaCeremony = vi.fn(
      (input: Parameters<typeof createKemerBetRecaptchaCeremony>[0]) => {
        ceremonyDeadlines.push(input.deadlineMonotonicMs);
        ceremonyWallDeadlines.push(input.deadlineWallClockMs);
        const ceremony = ceremonies[ceremonyDeadlines.length - 1];
        if (!ceremony) throw new Error('unexpected ceremony rotation');
        return ceremony.ceremony;
      },
    );
    const log = vi.fn();
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      log,
      monotonicNow: () => timestamp,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      expect(ceremonyDeadlines).toEqual([timestamp + 10 * 60 * 1_000]);
      expect(ceremonyWallDeadlines).toEqual([timestamp + 10 * 60 * 1_000]);

      browser.navigate(AGENTS_PAGE);
      const firstAuthenticated = await waitForSessionPhase(origin, 'authenticated');
      expect(firstAuthenticated.expiresAt).toBe('2026-08-27T12:00:00.000Z');
      expect(log.mock.calls.filter(([event]) => event === 'signed_in')).toHaveLength(1);

      timestamp += 2 * 60 * 60 * 1_000;
      browser.navigate(LOGIN_PAGE);

      // The main-frame commit listener must retire and replace the old ceremony before the next
      // document request can race into the route handler, not after the asynchronous phase poll.
      expect(firstCeremony.retireForReauthentication).toHaveBeenCalledTimes(1);
      expect(createRecaptchaCeremony).toHaveBeenCalledTimes(2);
      expect(ceremonyDeadlines[1]).toBe(timestamp + 10 * 60 * 1_000);
      expect(ceremonyWallDeadlines[1]).toBe(timestamp + 10 * 60 * 1_000);
      const racingRequest = testRecaptchaRoute({
        frame: browser.page.mainFrame(),
        resourceType: 'script',
        url: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
      });
      await browser.dispatchRoute(racingRequest.route);
      expect(secondCeremony.handleRoute).toHaveBeenCalledTimes(1);
      expect(firstCeremony.handleRoute).not.toHaveBeenCalled();

      const reauthentication = await waitForSessionPhase(origin, 'login_required');
      expect(reauthentication.expiresAt).toBe('2026-08-27T02:10:00.000Z');

      browser.navigate(AGENTS_PAGE);
      const reauthenticated = await waitForSessionPhase(origin, 'authenticated');
      expect(reauthenticated.expiresAt).toBe(firstAuthenticated.expiresAt);
      expect(log.mock.calls.filter(([event]) => event === 'signed_in')).toHaveLength(1);
      expect(secondCeremony.observeMainFrameCommit).toHaveBeenCalledWith(AGENTS_PAGE);
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('faults instead of replacing an unsafe in-flight ceremony during reauthentication', async () => {
    const unsafeCeremony = stubProvisionRecaptchaCeremony({ retire: false });
    const replacementCeremony = stubProvisionRecaptchaCeremony();
    const ceremonies = [unsafeCeremony, replacementCeremony];
    const createRecaptchaCeremony = vi.fn(
      (input: Parameters<typeof createKemerBetRecaptchaCeremony>[0]) => {
        const ceremony = ceremonies[createRecaptchaCeremony.mock.calls.length - 1];
        if (!ceremony) throw new Error('unexpected ceremony rotation');
        if (ceremony === unsafeCeremony) {
          unsafeCeremony.retireForReauthentication.mockImplementation(() => {
            input.onForbiddenRequest('recaptcha_ceremony');
            return false;
          });
        }
        return ceremony.ceremony;
      },
    );
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      browser.navigate(AGENTS_PAGE);
      await waitForSessionPhase(origin, 'authenticated');

      browser.navigate(LOGIN_PAGE);
      expect(unsafeCeremony.retireForReauthentication).toHaveBeenCalledTimes(1);
      expect(createRecaptchaCeremony).toHaveBeenCalledTimes(2);
      expect(replacementCeremony.handleRoute).not.toHaveBeenCalled();
      await waitForSessionPhase(origin, 'idle');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('does not rotate reauthentication at the exact wall-clock authenticated deadline', async () => {
    const ceremony = stubProvisionRecaptchaCeremony();
    const createRecaptchaCeremony = vi.fn(() => ceremony.ceremony);
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const startedAt = Date.parse('2026-08-27T00:00:00.000Z');
    let wallTimestamp = startedAt;
    let monotonicTimestamp = 1_000;
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      monotonicNow: () => monotonicTimestamp,
      now: () => new Date(wallTimestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      browser.navigate(AGENTS_PAGE);
      await waitForSessionPhase(origin, 'authenticated');

      wallTimestamp = startedAt + 12 * 60 * 60 * 1_000;
      monotonicTimestamp += 60 * 60 * 1_000;
      browser.navigate(LOGIN_PAGE);
      expect(createRecaptchaCeremony).toHaveBeenCalledTimes(1);
      expect(ceremony.retireForReauthentication).not.toHaveBeenCalled();
      await waitForSessionPhase(origin, 'idle');
    } finally {
      await closeServer(provision.server);
    }
  });

  it.each(['wall', 'monotonic'] as const)(
    'aborts the exact login request before credentials leave at the active $0 deadline',
    async (clock) => {
      const ceremony = stubProvisionRecaptchaCeremony({ handle: 'not_recaptcha' });
      const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const startedAt = Date.parse('2026-08-27T00:00:00.000Z');
      let wallTimestamp = startedAt;
      let monotonicTimestamp = 1_000;
      const provision = createKemerBetSessionProvisionServer({
        assertBrowserExecutable: async () => undefined,
        clearTimer: vi.fn() as unknown as typeof clearTimeout,
        closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
        createRecaptchaCeremony: () => ceremony.ceremony,
        effectiveUserId: 10_001,
        environment: SAFE_ENVIRONMENT,
        launchPersistentContext: async () => browser.context,
        monotonicNow: () => monotonicTimestamp,
        now: () => new Date(wallTimestamp),
        prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
        prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
        setTimer: vi.fn(
          () => ({}) as ReturnType<typeof setTimeout>,
        ) as unknown as typeof setTimeout,
        validateSessionProfile: async () => undefined,
      });
      const origin = await listenOnLoopback(provision.server);
      try {
        expect(
          (
            await postSessionStart(
              origin,
              JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
            )
          ).status,
        ).toBe(202);
        await waitForSessionPhase(origin, 'login_required');
        if (clock === 'wall') wallTimestamp += 10 * 60 * 1_000;
        else monotonicTimestamp += 10 * 60 * 1_000;

        const loginRequest = testRecaptchaRoute({
          contentType: 'application/json',
          extraHeaders: { et: '1' },
          frame: browser.page.mainFrame(),
          method: 'POST',
          postData: JSON.stringify({
            password: 'never-sent-value',
            token: 'never-forwarded-test-token',
            userName: 'never-forwarded-test-user',
          }),
          resourceType: 'xhr',
          url: 'https://admin-api.agt-digi.com/Account/Login',
        });
        await browser.dispatchRoute(loginRequest.route);
        expect(loginRequest.abort).toHaveBeenCalledOnce();
        expect(loginRequest.continue).not.toHaveBeenCalled();
        expect(ceremony.handleRoute).not.toHaveBeenCalled();
        expect(ceremony.consumeKemerBetLoginPermit).not.toHaveBeenCalled();
        await waitForSessionPhase(origin, 'idle');
      } finally {
        await closeServer(provision.server);
      }
    },
  );

  it('rechecks the active deadline after consuming the login permit and before network release', async () => {
    const startedAt = Date.parse('2026-08-27T00:00:00.000Z');
    let wallTimestamp = startedAt;
    const ceremony = stubProvisionRecaptchaCeremony({
      handle: 'not_recaptcha',
      onConsume: () => {
        wallTimestamp = startedAt + 10 * 60 * 1_000;
      },
    });
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony: () => ceremony.ceremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      monotonicNow: () => 1_000,
      now: () => new Date(wallTimestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const loginRequest = testRecaptchaRoute({
        contentType: 'application/json',
        extraHeaders: { et: '1' },
        frame: browser.page.mainFrame(),
        method: 'POST',
        postData: JSON.stringify({
          password: 'never-sent-value',
          token: 'never-forwarded-test-token',
          userName: 'never-forwarded-test-user',
        }),
        resourceType: 'xhr',
        url: 'https://admin-api.agt-digi.com/Account/Login',
      });
      await browser.dispatchRoute(loginRequest.route);
      expect(ceremony.consumeKemerBetLoginPermit).toHaveBeenCalledOnce();
      expect(loginRequest.abort).toHaveBeenCalledOnce();
      expect(loginRequest.continue).not.toHaveBeenCalled();
      await waitForSessionPhase(origin, 'idle');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('locks input and withholds the preview before releasing the exact login request', async () => {
    const ceremony = stubProvisionRecaptchaCeremony({
      consumePermit: true,
      handle: 'not_recaptcha',
    });
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony: () => ceremony.ceremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      monotonicNow: () => 1_000,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const displayedFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      expect(displayedFrame.status).toBe(200);
      const displayedFrameSequence = Number(
        displayedFrame.headers.get('x-fetanagent-frame-sequence'),
      );
      expect(displayedFrameSequence).toBeGreaterThan(0);

      const loginRequest = testRecaptchaRoute({
        contentType: 'application/json',
        extraHeaders: { et: '1' },
        frame: browser.page.mainFrame(),
        method: 'POST',
        postData: JSON.stringify({
          password: 'never-sent-value',
          token: 'never-forwarded-test-token',
          userName: 'never-forwarded-test-user',
        }),
        resourceType: 'xhr',
        url: 'https://admin-api.agt-digi.com/Account/Login',
      });
      await browser.dispatchRoute(loginRequest.route);
      expect(loginRequest.continue).toHaveBeenCalledOnce();
      expect(loginRequest.abort).not.toHaveBeenCalled();
      expect(await sessionStatus(origin)).toMatchObject({
        phase: 'authenticating',
        signedIn: false,
      });

      const replayedInput = await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence: displayedFrameSequence,
          kind: 'pointer',
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
          x: 10,
          y: 10,
        }),
      });
      expect(replayedInput.status).toBe(503);
      expect(await replayedInput.json()).toEqual({ error: 'session_unavailable' });

      const postReleaseFrame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      expect(postReleaseFrame.status).toBe(204);
      expect(postReleaseFrame.headers.get('content-type')).toBeNull();
      expect((await postReleaseFrame.arrayBuffer()).byteLength).toBe(0);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('keeps credentials local through clr and admits the exact v85 post-login transition', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const frames = testRecaptchaFramesForPage(browser.page);
    const ceremony = createTestRecaptchaCeremony();
    const identityVerification = deferred<void>();
    const verifyIdentity = vi.fn(() => identityVerification.promise);
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony: () => ceremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      monotonicNow: () => 1_000,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      prepareAuthenticatedIdentityVerifier: async (accountId) => ({
        accountId,
        fingerprintAgentIdentity: createTestIdentityFingerprinter(),
        verify: verifyIdentity,
      }),
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      // Real Chromium commits the initial login document before its reCAPTCHA requests. The fake
      // browser keeps navigation explicit so this test can bind the same immutable document.
      browser.navigate(LOGIN_PAGE);

      const recaptchaRoutes = exactTestRecaptchaRoutes(frames);
      for (const candidate of recaptchaRoutes.slice(0, 9)) {
        await browser.dispatchRoute(candidate.route);
      }
      const loginRequest = testRecaptchaRoute({
        contentType: 'application/json',
        extraHeaders: { et: '1' },
        frame: frames.mainFrame,
        method: 'POST',
        postData: JSON.stringify({
          password: 'never-sent-value',
          token: 'never-forwarded-test-token',
          userName: 'never-forwarded-test-user',
        }),
        resourceType: 'xhr',
        url: 'https://admin-api.agt-digi.com/Account/Login',
      });
      const pendingLogin = browser.dispatchRoute(loginRequest.route);

      await vi.waitFor(() => {
        expect(loginRequest.continue).not.toHaveBeenCalled();
        expect(loginRequest.abort).not.toHaveBeenCalled();
      });

      const clr = recaptchaRoutes[9];
      if (!clr) throw new Error('clr fixture missing');
      await browser.dispatchRoute(clr.route);
      await pendingLogin;

      expect(clr.continue).toHaveBeenCalledOnce();
      expect(loginRequest.continue).toHaveBeenCalledOnce();
      expect(loginRequest.abort).not.toHaveBeenCalled();
      expect(clr.continue.mock.invocationCallOrder[0]).toBeLessThan(
        loginRequest.continue.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
      );

      const loginReload = testRecaptchaRoute({
        frame: frames.mainFrame,
        navigation: true,
        resourceType: 'document',
        url: LOGIN_PAGE,
      });
      await browser.dispatchRoute(loginReload.route);
      expect(loginReload.continue).toHaveBeenCalledOnce();
      expect(loginReload.abort).not.toHaveBeenCalled();
      browser.navigate(LOGIN_PAGE);
      await waitForSessionPhase(origin, 'authenticating');

      // KemerBet v85 changes the canonical document to root without necessarily issuing another
      // routed document request, then sends exactly two read-only bootstrap XHRs in either order.
      browser.navigate(POST_LOGIN_ROOT_PAGE);
      const rootHeaders = {
        accept: 'application/json, text/plain, */*',
        authorization: 'Bearer reviewed-authentication-token',
        origin: 'https://agentsystem.admindigi.com',
        referer: POST_LOGIN_ROOT_PAGE,
      };
      const availablePublished = testRecaptchaRoute({
        extraHeaders: rootHeaders,
        frame: frames.mainFrame,
        resourceType: 'xhr',
        url: 'https://admin-api.agt-digi.com/SystemLanguage/AvailablePublished',
      });
      const accountInfo = testRecaptchaRoute({
        extraHeaders: rootHeaders,
        frame: frames.mainFrame,
        resourceType: 'xhr',
        url: 'https://admin-api.agt-digi.com/Account/Info?languageCode=en',
      });
      // Deliberately reverse the observed order to prove concurrent XHR scheduling cannot make
      // a valid sign-in intermittently fail.
      await Promise.all([
        browser.dispatchRoute(availablePublished.route),
        browser.dispatchRoute(accountInfo.route),
      ]);
      expect(availablePublished.continue).toHaveBeenCalledOnce();
      expect(accountInfo.continue).toHaveBeenCalledOnce();
      expect(availablePublished.abort).not.toHaveBeenCalled();
      expect(accountInfo.abort).not.toHaveBeenCalled();
      expect(verifyIdentity).not.toHaveBeenCalled();

      browser.navigate(AGENTS_PAGE);
      await vi.waitFor(() => expect(verifyIdentity).toHaveBeenCalledOnce());
      expect(await sessionStatus(origin)).toMatchObject({
        phase: 'authenticating',
        signedIn: false,
      });
      identityVerification.resolve();
      await waitForSessionPhase(origin, 'authenticated');
      expect(await sessionStatus(origin)).toMatchObject({ phase: 'authenticated', signedIn: true });
    } finally {
      await closeServer(provision.server);
    }
  });

  it('aborts the pending exact credential route when its bounded clr wait expires', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const frames = testRecaptchaFramesForPage(browser.page);
    const ceremony = createTestRecaptchaCeremony();
    const permitRequested = deferred<void>();
    const observedCeremony: KemerBetRecaptchaCeremony = {
      ...ceremony,
      consumeKemerBetLoginPermit: () => {
        const result = ceremony.consumeKemerBetLoginPermit();
        permitRequested.resolve();
        return result;
      },
    };
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony: () => observedCeremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      monotonicNow: () => 1_000,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      for (const candidate of exactTestRecaptchaRoutes(frames).slice(0, 9)) {
        await browser.dispatchRoute(candidate.route);
      }

      vi.useFakeTimers();
      const loginRequest = testRecaptchaRoute({
        contentType: 'application/json',
        extraHeaders: { et: '1' },
        frame: frames.mainFrame,
        method: 'POST',
        postData: JSON.stringify({
          password: 'never-sent-value',
          token: 'never-forwarded-test-token',
          userName: 'never-forwarded-test-user',
        }),
        resourceType: 'xhr',
        url: 'https://admin-api.agt-digi.com/Account/Login',
      });
      const pendingLogin = browser.dispatchRoute(loginRequest.route);
      await permitRequested.promise;
      expect(loginRequest.continue).not.toHaveBeenCalled();
      expect(loginRequest.abort).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      await pendingLogin;

      expect(loginRequest.abort).toHaveBeenCalledOnce();
      expect(loginRequest.continue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await closeServer(provision.server);
    }
  });

  it('rechecks the exact wall deadline immediately before an authenticated bearer read release', async () => {
    const startedAt = Date.parse('2026-08-27T00:00:00.000Z');
    let wallTimestamp = startedAt;
    let monotonicTimestamp = 1_000;
    const ceremony = stubProvisionRecaptchaCeremony({
      handle: 'not_recaptcha',
      onHandle: () => {
        wallTimestamp = startedAt + 12 * 60 * 60 * 1_000;
      },
    });
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      createRecaptchaCeremony: () => ceremony.ceremony,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      monotonicNow: () => monotonicTimestamp,
      now: () => new Date(wallTimestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      browser.navigate(AGENTS_PAGE);
      await waitForSessionPhase(origin, 'authenticated');

      monotonicTimestamp += 60 * 60 * 1_000;
      const authenticatedRead = testRecaptchaRoute({
        contentType: 'application/json;charset=utf-8',
        extraHeaders: { authorization: 'Bearer reviewed-authentication-token' },
        frame: browser.page.mainFrame(),
        resourceType: 'xhr',
        url: 'https://admin-api.agt-digi.com/Account/Info?languageCode=en-US',
      });
      await browser.dispatchRoute(authenticatedRead.route);
      expect(authenticatedRead.abort).toHaveBeenCalledOnce();
      expect(authenticatedRead.continue).not.toHaveBeenCalled();
      expect(ceremony.handleRoute).toHaveBeenCalledOnce();
      await waitForSessionPhase(origin, 'idle');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('keeps an agents URL unauthenticated until the exact immutable identity proof succeeds', async () => {
    const identityProof = deferred<void>();
    const verifyIdentity = vi.fn(() => identityProof.promise);
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: async (accountId) => ({
        accountId,
        fingerprintAgentIdentity: createTestIdentityFingerprinter(),
        verify: verifyIdentity,
      }),
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      const frameSequence = Number(frame.headers.get('x-fetanagent-frame-sequence'));
      browser.setPointerAction(async () => browser.navigate(AGENTS_PAGE));

      const input = await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence,
          kind: 'pointer',
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
          x: 10,
          y: 10,
        }),
      });
      expect(input.status).toBe(200);
      expect(await input.json()).toMatchObject({ phase: 'authenticating', signedIn: false });
      expect(await sessionStatus(origin)).toMatchObject({
        phase: 'authenticating',
        signedIn: false,
      });
      expect(verifyIdentity).toHaveBeenCalledExactlyOnceWith(browser.page);

      identityProof.resolve(undefined);
      expect(await waitForSessionPhase(origin, 'authenticated')).toMatchObject({
        phase: 'authenticated',
        signedIn: true,
      });
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('never accepts an in-flight identity proof after another agents document commits', async () => {
    const firstIdentityProof = deferred<void>();
    const secondIdentityProof = deferred<void>();
    const verifyIdentity = vi
      .fn<(_: Page) => Promise<void>>()
      .mockImplementationOnce(() => firstIdentityProof.promise)
      .mockImplementationOnce(() => secondIdentityProof.promise);
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: async (accountId) => ({
        accountId,
        fingerprintAgentIdentity: createTestIdentityFingerprinter(),
        verify: verifyIdentity,
      }),
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      browser.setPointerAction(async () => browser.navigate(AGENTS_PAGE));
      expect(
        (
          await fetch(`${origin}/v1/session/input`, {
            method: 'POST',
            headers: { connection: 'close', 'content-type': 'application/json' },
            body: JSON.stringify({
              frameSequence: Number(frame.headers.get('x-fetanagent-frame-sequence')),
              kind: 'pointer',
              platformAgentAccountId: ACCOUNT_ID,
              requestId: SECOND_REQUEST_ID,
              sessionGeneration: REQUEST_ID,
              x: 10,
              y: 10,
            }),
          })
        ).status,
      ).toBe(200);
      expect(verifyIdentity).toHaveBeenCalledTimes(1);

      browser.navigate(AGENTS_PAGE);
      firstIdentityProof.resolve(undefined);
      for (let attempt = 0; attempt < 30 && verifyIdentity.mock.calls.length < 2; attempt += 1) {
        await sessionStatus(origin);
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      }
      expect(verifyIdentity).toHaveBeenCalledTimes(2);
      expect(await sessionStatus(origin)).toMatchObject({
        phase: 'authenticating',
        signedIn: false,
      });

      secondIdentityProof.resolve(undefined);
      expect(await waitForSessionPhase(origin, 'authenticated')).toMatchObject({
        phase: 'authenticated',
        signedIn: true,
      });
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('revokes a document-bound identity proof on every later agents-page navigation', async () => {
    const secondIdentityProof = deferred<void>();
    const verifyIdentity = vi
      .fn<(_: Page) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => secondIdentityProof.promise);
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: async (accountId) => ({
        accountId,
        fingerprintAgentIdentity: createTestIdentityFingerprinter(),
        verify: verifyIdentity,
      }),
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      browser.setPointerAction(async () => browser.navigate(AGENTS_PAGE));
      expect(
        (
          await fetch(`${origin}/v1/session/input`, {
            method: 'POST',
            headers: { connection: 'close', 'content-type': 'application/json' },
            body: JSON.stringify({
              frameSequence: Number(frame.headers.get('x-fetanagent-frame-sequence')),
              kind: 'pointer',
              platformAgentAccountId: ACCOUNT_ID,
              requestId: SECOND_REQUEST_ID,
              sessionGeneration: REQUEST_ID,
              x: 10,
              y: 10,
            }),
          })
        ).status,
      ).toBe(200);
      await waitForSessionPhase(origin, 'authenticated');

      browser.navigate(AGENTS_PAGE);
      expect(await sessionStatus(origin)).toMatchObject({
        phase: 'authenticating',
        signedIn: false,
      });
      expect(verifyIdentity).toHaveBeenCalledTimes(2);

      secondIdentityProof.reject(new Error('identity_changed'));
      await waitForSessionPhase(origin, 'idle');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('rejects identity proof accepted exactly at the immutable login deadline', async () => {
    const identityProof = deferred<void>();
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const log = vi.fn();
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      log,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: async (accountId) => ({
        accountId,
        fingerprintAgentIdentity: createTestIdentityFingerprinter(),
        verify: () => identityProof.promise,
      }),
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      browser.setPointerAction(async () => browser.navigate(AGENTS_PAGE));
      const input = await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence: Number(frame.headers.get('x-fetanagent-frame-sequence')),
          kind: 'pointer',
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
          x: 10,
          y: 10,
        }),
      });
      expect(await input.json()).toMatchObject({ phase: 'authenticating', signedIn: false });

      timestamp += 10 * 60 * 1_000;
      identityProof.resolve(undefined);
      await waitForSessionPhase(origin, 'idle');
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalledWith('signed_in');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('rejects a checkpoint proof that reaches the exact authenticated lease deadline', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      checkpointSignedInPage: async () => {
        timestamp += 12 * 60 * 60 * 1_000;
      },
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      browser.setPointerAction(async () => browser.navigate(AGENTS_PAGE));
      await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence: Number(frame.headers.get('x-fetanagent-frame-sequence')),
          kind: 'pointer',
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
          x: 10,
          y: 10,
        }),
      });
      await waitForSessionPhase(origin, 'authenticated');

      const checkpoint = await postSessionCheckpoint(
        origin,
        JSON.stringify({ requestId: SECOND_REQUEST_ID }),
      );
      expect(checkpoint.status).toBe(503);
      expect(await checkpoint.json()).toEqual({ error: 'session_unavailable' });
      expect(closePersistentBrowserForCheckpoint).not.toHaveBeenCalled();
      await sessionStatus(origin);
      await waitForSessionPhase(origin, 'idle');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('rejects a readiness seal that reaches the exact lease deadline after clean close', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const releaseAfterCleanCheckpoint = vi.fn(async () => undefined);
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const createReadinessProbeFromPage = vi.fn(
      async (options: { readonly close: () => Promise<void> }) => ({
        close: options.close,
        finalizeReadOnlyProof: async () => undefined,
        observedAgentIdentityFingerprint: `v1:${'a'.repeat(64)}`,
        probePlayerLookup: async () => null,
        providerAuthorizationDigest: () => `v1:${'b'.repeat(64)}`,
      }),
    );
    const stagedPlayers = Object.freeze({
      playerIds: Object.freeze(['player-1', 'player-2', 'player-3', 'player-4', 'player-5']),
      reattest: vi.fn(async () => undefined),
    });
    const loadReadinessPlayerIds = vi.fn(async () => stagedPlayers);
    const runReadinessSeal = vi.fn(
      async (options: {
        readonly loadPlayerIds: () => Promise<{
          readonly playerIds: readonly string[];
          readonly reattest: () => Promise<void>;
        }>;
        readonly openProbe: (input: {
          readonly accountId: string;
          readonly effectiveUserId: number;
          readonly fingerprintAgentIdentity: never;
          readonly reportForbiddenRequest: () => void;
          readonly reportStage: () => void;
          readonly selectorContract: never;
        }) => Promise<{ readonly close: () => Promise<void> }>;
      }) => {
        expect(await options.loadPlayerIds()).toBe(stagedPlayers);
        const probe = await options.openProbe({
          accountId: ACCOUNT_ID,
          effectiveUserId: 10_001,
          fingerprintAgentIdentity: undefined as never,
          reportForbiddenRequest: () => undefined,
          reportStage: () => undefined,
          selectorContract: undefined as never,
        });
        await probe.close();
        timestamp += 12 * 60 * 60 * 1_000;
      },
    );
    const provision = createKemerBetSessionProvisionServer({
      acquireProfileGenerationLease: async () => ({ releaseAfterCleanCheckpoint }),
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      createReadinessProbeFromPage: createReadinessProbeFromPage as unknown as NonNullable<
        ProvisionDependencies['createReadinessProbeFromPage']
      >,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      loadReadinessPlayerIds,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      runReadinessSeal: runReadinessSeal as unknown as NonNullable<
        ProvisionDependencies['runReadinessSeal']
      >,
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      browser.setPointerAction(async () => browser.navigate(AGENTS_PAGE));
      await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence: Number(frame.headers.get('x-fetanagent-frame-sequence')),
          kind: 'pointer',
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
          x: 10,
          y: 10,
        }),
      });
      await waitForSessionPhase(origin, 'authenticated');

      const seal = await postReadinessSeal(
        origin,
        JSON.stringify({ requestId: SECOND_REQUEST_ID }),
      );
      expect(seal.status).toBe(503);
      expect(await seal.json()).toEqual({
        error: 'session_unavailable',
        stage: 'signed_in_page',
      });
      expect(runReadinessSeal).toHaveBeenCalledTimes(1);
      expect(loadReadinessPlayerIds).toHaveBeenCalledTimes(1);
      expect(createReadinessProbeFromPage).toHaveBeenCalledTimes(1);
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
      expect(releaseAfterCleanCheckpoint).toHaveBeenCalledTimes(1);
      expect(await sessionStatus(origin)).toMatchObject({
        active: false,
        phase: 'checkpointed',
        signedIn: false,
      });
    } finally {
      await closeServer(provision.server);
    }
  });

  it('rechecks and rejects input reaching the exact login deadline immediately before dispatch', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const pointerAction = vi.fn(async () => undefined);
    browser.setPointerAction(pointerAction);
    const startedAt = Date.parse('2026-08-27T00:00:00.000Z');
    let inputClockActive = false;
    let inputLeaseReads = 0;
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      now: () =>
        new Date(
          inputClockActive
            ? startedAt + 10 * 60 * 1_000 - (inputLeaseReads++ === 0 ? 1 : 0)
            : startedAt,
        ),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0), {
        headers: { connection: 'close' },
      });
      inputClockActive = true;
      const input = await fetch(`${origin}/v1/session/input`, {
        method: 'POST',
        headers: { connection: 'close', 'content-type': 'application/json' },
        body: JSON.stringify({
          frameSequence: Number(frame.headers.get('x-fetanagent-frame-sequence')),
          kind: 'pointer',
          platformAgentAccountId: ACCOUNT_ID,
          requestId: SECOND_REQUEST_ID,
          sessionGeneration: REQUEST_ID,
          x: 10,
          y: 10,
        }),
      });
      expect(input.status).toBe(503);
      expect(await input.json()).toEqual({ error: 'session_unavailable' });
      expect(inputLeaseReads).toBe(2);
      expect(pointerAction).not.toHaveBeenCalled();
      await waitForSessionPhase(origin, 'idle');
    } finally {
      await closeServer(provision.server);
    }
  });

  it('quarantines a generation at its hard deadline when Chromium close fails forever', async () => {
    const timers: Array<{ readonly callback: () => void; readonly delay: number }> = [];
    const setTimer = ((callback: () => void, delay?: number) => {
      timers.push({ callback, delay: delay ?? 0 });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async () => {
      throw new Error('permanent close failure');
    });
    const forceQuarantine = vi.fn();
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      forceQuarantine,
      launchPersistentContext: async () => browser.context,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      expect((await stopSession(origin, REQUEST_ID)).status).toBe(202);
      await waitForSessionPhase(origin, 'faulted');
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);

      const hardDeadline = Math.max(...timers.map(({ delay }) => delay));
      expect(hardDeadline).toBe(13 * 60 * 60 * 1_000 - 50 * 60 * 1_000);
      timestamp += hardDeadline;
      timers.find(({ delay }) => delay === hardDeadline)?.callback();
      expect(forceQuarantine).toHaveBeenCalledExactlyOnceWith(1);

      const status = await fetch(sessionStatusUrl(origin), { headers: { connection: 'close' } });
      expect(status.status).toBe(503);
      expect(await status.json()).toEqual({ error: 'session_unavailable' });
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: SECOND_REQUEST_ID }),
          )
        ).status,
      ).toBe(503);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('publishes one redacted cleanup failure before a hard deadline quarantines startup', async () => {
    const browserExecutable = deferred<void>();
    const timers: Array<{ readonly callback: () => void; readonly delay: number }> = [];
    const setTimer = ((callback: () => void, delay?: number) => {
      timers.push({ callback, delay: delay ?? 0 });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const forceQuarantine = vi.fn();
    const logStartupFailure = vi.fn();
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => browserExecutable.promise,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      forceQuarantine,
      logStartupFailure,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      setTimer,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      const hardDeadline = Math.max(...timers.map(({ delay }) => delay));
      expect(hardDeadline).toBe((12 * 60 + 10) * 60 * 1_000);
      timestamp += hardDeadline;
      timers.find(({ delay }) => delay === hardDeadline)?.callback();

      expect(forceQuarantine).toHaveBeenCalledExactlyOnceWith(1);
      expect(logStartupFailure).toHaveBeenCalledExactlyOnceWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'cleanup_unverified',
        schemaVersion: 1,
        stage: 'cleanup',
      });
      browserExecutable.reject(
        new Error('https://provider.invalid/?credential=must-never-escape-from-hard-deadline'),
      );
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      expect(JSON.stringify(logStartupFailure.mock.calls)).not.toMatch(
        /provider\.invalid|credential|must-never-escape/iu,
      );
      expect(logStartupFailure).toHaveBeenCalledOnce();
    } finally {
      browserExecutable.reject(new Error('test cleanup'));
      await closeServer(provision.server);
    }
  });

  it('enforces the immutable hard deadline with a monotonic clock after wall-clock rollback', async () => {
    const timers: Array<{ readonly callback: () => void; readonly delay: number }> = [];
    const setTimer = ((callback: () => void, delay?: number) => {
      timers.push({ callback, delay: delay ?? 0 });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const forceQuarantine = vi.fn();
    const wallTimestamp = Date.parse('2026-08-27T00:00:00.000Z');
    let monotonicTimestamp = 100_000;
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async () => {
        throw new Error('permanent close failure');
      },
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      forceQuarantine,
      launchPersistentContext: async () => browser.context,
      monotonicNow: () => monotonicTimestamp,
      now: () => new Date(wallTimestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'faulted');

      const hardDeadlineMs = 10 * 60 * 1_000 + 12 * 60 * 60 * 1_000;
      const hardDeadlineTimer = timers.find(({ delay }) => delay === hardDeadlineMs);
      expect(hardDeadlineTimer).toBeDefined();
      // The civil clock has not advanced at all, but monotonic elapsed time has reached the exact
      // immutable generation deadline. The dedicated process must still self-quarantine.
      monotonicTimestamp += hardDeadlineMs;
      hardDeadlineTimer?.callback();
      expect(forceQuarantine).toHaveBeenCalledExactlyOnceWith(1);
      expect(
        (await fetch(sessionStatusUrl(origin), { headers: { connection: 'close' } })).status,
      ).toBe(503);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('closes and permanently quarantines the context when only the retained page closes', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      browser.emitPageClose();
      for (let attempt = 0; attempt < 30 && !browser.isContextClosed(); attempt += 1) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      }
      expect(browser.isContextClosed()).toBe(true);
      expect(closePersistentBrowserForCheckpoint).not.toHaveBeenCalled();
      expect(
        (await fetch(sessionStatusUrl(origin), { headers: { connection: 'close' } })).status,
      ).toBe(503);
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: SECOND_REQUEST_ID }),
          )
        ).status,
      ).toBe(503);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('aborts a popup request and automatically tears down the retained context', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');

      const popupClose = vi.fn(async () => undefined);
      const popup = { close: popupClose } as unknown as Page;
      const abort = vi.fn(async () => undefined);
      const continueRequest = vi.fn(async () => undefined);
      const popupFrame = { page: () => popup };
      const route = {
        abort,
        continue: continueRequest,
        request: () => ({
          frame: () => popupFrame,
          headers: () => ({}),
          isNavigationRequest: () => true,
          method: () => 'GET',
          postData: () => null,
          redirectedFrom: () => null,
          resourceType: () => 'document',
          url: () => LOGIN_PAGE,
        }),
      } as unknown as Route;

      await browser.dispatchRoute(route);
      expect(abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
      expect(continueRequest).not.toHaveBeenCalled();

      browser.emitPopup(popup);
      await waitForSessionPhase(origin, 'idle');
      expect(popupClose).toHaveBeenCalledTimes(1);
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('installs popup, HTTP, and WebSocket guards while offline before the first navigation', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    let observedLaunchOptions: unknown;
    const launchPersistentContext = vi.fn(async (_profilePath: string, options: unknown) => {
      observedLaunchOptions = options;
      return browser.context;
    });
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      expect(launchPersistentContext).toHaveBeenCalledTimes(1);
      expect(observedLaunchOptions).toMatchObject({ offline: true });
      const launchOptions = observedLaunchOptions as {
        readonly args?: readonly string[];
        readonly ignoreDefaultArgs?: readonly string[];
      };
      const disabledFeatureArguments =
        launchOptions.args?.filter((argument) => argument.startsWith('--disable-features=')) ?? [];
      expect(disabledFeatureArguments).toHaveLength(1);
      const disabledFeatures = disabledFeatureArguments[0]
        ?.slice('--disable-features='.length)
        .split(',');
      expect(disabledFeatures).toEqual(
        expect.arrayContaining([
          'AvoidUnnecessaryBeforeUnloadCheckSync',
          'BoundaryEventDispatchTracksNodeRemoval',
          'DestroyProfileOnBrowserClose',
          'DialMediaRouteProvider',
          'GlobalMediaControls',
          'HttpsUpgrades',
          'LensOverlay',
          'MediaRouter',
          'PaintHolding',
          'ThirdPartyStoragePartitioning',
          'BlockOriginHeaderModificationOnRedirect',
          'Translate',
          'AutoDeElevate',
          'OptimizationHints',
          'msForceBrowserSignIn',
          'msEdgeUpdateLaunchServicesPreferredVersion',
          'AutofillServerCommunication',
          'NetworkPrediction',
          'PreconnectToSearch',
          'SpeculationRulesPrefetchFuture',
          'WebTransport',
        ]),
      );
      expect(launchOptions.ignoreDefaultArgs).toEqual([
        '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,' +
          'BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,' +
          'DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,' +
          'PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,' +
          'Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,' +
          'msEdgeUpdateLaunchServicesPreferredVersion',
      ]);
      expect(launchOptions.args).toEqual(
        expect.arrayContaining([
          '--disable-quic',
          '--dns-prefetch-disable',
          '--disable-network-prediction',
          '--disable-preconnect',
          '--disable-webrtc',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        ]),
      );
      expect(JSON.stringify(observedLaunchOptions)).not.toContain(
        'content-autofill.googleapis.com',
      );
      expect(browser.startupEvents).toEqual([
        'popup-guard',
        'serviceworker-guard',
        'http-guard',
        'websocket-guard',
        'offline:false',
        'goto',
      ]);
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('acquires the durable generation lease and purges workers before offline Chromium launch', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const startupOrder: string[] = [];
    const releaseAfterCleanCheckpoint = vi.fn(async () => undefined);
    const provision = createKemerBetSessionProvisionServer({
      acquireProfileGenerationLease: async () => {
        startupOrder.push('generation-lease');
        return { releaseAfterCleanCheckpoint };
      },
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async (_profilePath, options) => {
        startupOrder.push(`launch-offline:${String(options?.offline)}`);
        return browser.context;
      },
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      purgePersistedServiceWorkerState: async () => {
        startupOrder.push('purge-workers');
      },
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      expect(startupOrder).toEqual(['generation-lease', 'purge-workers', 'launch-offline:true']);
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      expect(releaseAfterCleanCheckpoint).toHaveBeenCalledTimes(1);
      await closeServer(provision.server);
    }
  });

  it('reports an exact pre-existing generation marker as an inactive redacted quarantine', async () => {
    const acquireProfileGenerationLease = vi.fn();
    const launchPersistentContext = vi.fn();
    const purgePersistedServiceWorkerState = vi.fn();
    const events: string[] = [];
    const provision = createKemerBetSessionProvisionServer({
      acquireProfileGenerationLease,
      assertBrowserExecutable: async () => undefined,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      inspectProfileGenerationLease: async () => ({
        reasonCode: 'unclean_session_generation',
        state: 'quarantined',
      }),
      inspectProfileGenerationStatus: async () => ({
        reasonCode: 'unclean_session_generation',
        state: 'quarantined',
      }),
      launchPersistentContext,
      log: (event) => events.push(event),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      purgePersistedServiceWorkerState,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      const status = await sessionStatus(origin);
      expect(status).toEqual({
        active: false,
        loginRequired: false,
        phase: 'idle',
        quarantine: {
          reasonCode: 'unclean_session_generation',
          recoveryRequired: true,
        },
        signedIn: false,
        transferDisabled: true,
      });
      expect(events).toEqual(['profile_quarantined']);
      expect(acquireProfileGenerationLease).not.toHaveBeenCalled();
      expect(purgePersistedServiceWorkerState).not.toHaveBeenCalled();
      expect(launchPersistentContext).not.toHaveBeenCalled();

      const wrongAccountStatus = await fetch(sessionStatusUrl(origin, OTHER_ACCOUNT_ID), {
        headers: { connection: 'close' },
      });
      expect(wrongAccountStatus.status).toBe(503);
      expect(await wrongAccountStatus.json()).toEqual({ error: 'session_unavailable' });

      const repeated = await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: SECOND_REQUEST_ID }),
      );
      expect(repeated.status).toBe(202);
      expect(await repeated.json()).toEqual(status);
      const frame = await fetch(sessionFrameUrl(origin, REQUEST_ID, 0));
      expect(frame.status).toBe(503);
      expect(await frame.json()).toEqual({ error: 'session_unavailable' });
    } finally {
      await closeServer(provision.server);
    }
  });

  it('never enables network when a persisted service worker survives the offline purge', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    browser.setServiceWorkers([{}]);
    const releaseAfterCleanCheckpoint = vi.fn(async () => undefined);
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      acquireProfileGenerationLease: async () => ({ releaseAfterCleanCheckpoint }),
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      const failed = await waitForSessionPhase(origin, 'idle');
      expect(failed).toMatchObject({
        startup: {
          failureCode: 'contract_mismatch',
          stage: 'transport_guard',
          status: 'failed',
        },
      });
      expect(logStartupFailure).toHaveBeenCalledExactlyOnceWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'contract_mismatch',
        schemaVersion: 1,
        stage: 'transport_guard',
      });
      expect(browser.startupEvents).not.toContain('offline:false');
      expect(browser.startupEvents).not.toContain('goto');
      expect(releaseAfterCleanCheckpoint).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('faults and tears down the whole generation on a runtime service worker target', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      browser.emitServiceWorker();
      const stopped = await waitForSessionPhase(origin, 'idle');
      expect(stopped).toMatchObject({
        startup: {
          detailsRedacted: true,
          failureCode: 'forbidden_request',
          schemaVersion: 1,
          stage: 'transport_guard',
          status: 'failed',
        },
      });
      expect(logStartupFailure).toHaveBeenCalledExactlyOnceWith({
        component: 'kemerbet_session_provision',
        detailsRedacted: true,
        event: 'startup_failed',
        failureCode: 'forbidden_request',
        schemaVersion: 1,
        stage: 'transport_guard',
      });
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('aborts an exact cosmetic resource without poisoning the ready preview', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const logStartupFailure = vi.fn();
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      logStartupFailure,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      const abort = vi.fn(async () => undefined);
      const continueRequest = vi.fn(async () => undefined);
      const route = {
        abort,
        continue: continueRequest,
        request: () => ({
          frame: () => browser.page.mainFrame(),
          headers: () => ({}),
          isNavigationRequest: () => false,
          method: () => 'GET',
          postData: () => null,
          redirectedFrom: () => null,
          resourceType: () => 'image',
          url: () =>
            'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/logo-sign-DirsW9WY.svg',
        }),
      } as unknown as Route;

      await browser.dispatchRoute(route);
      expect(abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
      expect(continueRequest).not.toHaveBeenCalled();
      expect(await sessionStatus(origin)).toMatchObject({
        phase: 'login_required',
        startup: { stage: 'preview_ready', status: 'ready' },
      });
      expect(logStartupFailure).not.toHaveBeenCalled();
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      expect(logStartupFailure).not.toHaveBeenCalled();
      await closeServer(provision.server);
    }
  });

  it('faults the whole generation on a forbidden HTTP request', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const abort = vi.fn(async () => undefined);
      const continueRequest = vi.fn(async () => undefined);
      const route = {
        abort,
        continue: continueRequest,
        request: () => ({
          frame: () => browser.page.mainFrame(),
          headers: () => ({ 'content-type': 'application/json' }),
          isNavigationRequest: () => false,
          method: () => 'POST',
          postData: () => JSON.stringify({ credential: 'must-not-leave' }),
          redirectedFrom: () => null,
          resourceType: () => 'xhr',
          url: () => 'https://evil.example/collect',
        }),
      } as unknown as Route;

      await browser.dispatchRoute(route);
      expect(abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
      expect(continueRequest).not.toHaveBeenCalled();
      await waitForSessionPhase(origin, 'idle');
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('fails closed and tears down the generation on an unreviewed WebSocket', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const close = vi.fn(async () => undefined);
      await browser.dispatchWebSocket({
        close,
        url: () => 'wss://evil.example/session',
      } as unknown as WebSocketRoute);
      expect(close).toHaveBeenCalledExactlyOnceWith({ code: 1008, reason: 'blocked' });
      await waitForSessionPhase(origin, 'idle');
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('locally closes an exact reviewed SignalR socket without poisoning the generation', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint: async (input) => input.context.close(),
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      const close = vi.fn(async () => undefined);
      await browser.dispatchWebSocket({
        close,
        url: () => 'wss://admin-api.agt-digi.com/ws?accessToken=reviewed-token-value&apiType=admin',
      } as unknown as WebSocketRoute);
      expect(close).toHaveBeenCalledExactlyOnceWith({ code: 1008, reason: 'blocked' });
      expect(await sessionStatus(origin)).toMatchObject({
        phase: 'login_required',
        signedIn: false,
      });
    } finally {
      await stopSession(origin, REQUEST_ID);
      await waitForSessionPhase(origin, 'idle');
      await closeServer(provision.server);
    }
  });

  it('faults the whole generation if even an exact optional SignalR socket cannot be closed', async () => {
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => input.context.close());
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      await postSessionStart(
        origin,
        JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
      );
      await waitForSessionPhase(origin, 'login_required');
      await browser.dispatchWebSocket({
        close: async () => {
          throw new Error('WebSocket close failed');
        },
        url: () => 'wss://admin-api.agt-digi.com/ws?accessToken=reviewed-token-value&apiType=admin',
      } as unknown as WebSocketRoute);
      await waitForSessionPhase(origin, 'idle');
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('retries an expired immutable fault cleanup when the first clean browser close fails', async () => {
    const timerCallbacks: Array<() => void> = [];
    const setTimer = vi.fn((callback: () => void) => {
      timerCallbacks.push(callback);
      return timerCallbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi
      .fn()
      .mockRejectedValueOnce(new Error('first clean close failed'))
      .mockImplementationOnce(async (input: { readonly context: BrowserContext }) =>
        input.context.close(),
      );
    let timestamp = Date.parse('2026-08-27T00:00:00.000Z');
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      now: () => new Date(timestamp),
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      timestamp += 10 * 60 * 1_000;

      const popup = { close: async () => undefined } as unknown as Page;
      browser.emitPopup(popup);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (closePersistentBrowserForCheckpoint.mock.calls.length >= 1) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      }
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
      expect(setTimer).toHaveBeenLastCalledWith(expect.any(Function), 5_000);
      const retryCleanup = timerCallbacks.at(-1);
      expect(retryCleanup).toBeTypeOf('function');

      retryCleanup?.();
      await waitForSessionPhase(origin, 'idle');
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(2);
    } finally {
      await closeServer(provision.server);
    }
  });

  it('returns idempotent stopping responses without waiting for cleanup longer than five seconds', async () => {
    const cleanupDelayMs = 5_100;
    let cleanupPromise: Promise<void> | undefined;
    const browser = fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const closePersistentBrowserForCheckpoint = vi.fn(async () => {
      cleanupPromise = new Promise<void>((resolveCleanup) =>
        setTimeout(resolveCleanup, cleanupDelayMs),
      );
      await cleanupPromise;
    });
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browser.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({ platformAgentAccountId: ACCOUNT_ID, requestId: REQUEST_ID }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');

      const firstStop = await Promise.race([
        stopSession(origin, REQUEST_ID),
        new Promise<'timed_out'>((resolveTimeout) =>
          setTimeout(() => resolveTimeout('timed_out'), 1_000),
        ),
      ]);
      expect(firstStop).not.toBe('timed_out');
      if (firstStop === 'timed_out') throw new Error('Stop response was blocked by cleanup.');
      expect(firstStop.status).toBe(202);
      expect(await firstStop.json()).toMatchObject({ active: true, phase: 'stopping' });
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);

      const repeatedStop = await Promise.race([
        stopSession(origin, SECOND_REQUEST_ID),
        new Promise<'timed_out'>((resolveTimeout) =>
          setTimeout(() => resolveTimeout('timed_out'), 1_000),
        ),
      ]);
      expect(repeatedStop).not.toBe('timed_out');
      if (repeatedStop === 'timed_out') throw new Error('Repeated Stop response was blocked.');
      expect(repeatedStop.status).toBe(202);
      expect(await repeatedStop.json()).toMatchObject({ active: true, phase: 'stopping' });
      expect(await sessionStatus(origin)).toMatchObject({ active: true, phase: 'stopping' });

      expect(cleanupDelayMs).toBeGreaterThan(5_000);
      await cleanupPromise;
      await waitForSessionPhase(origin, 'idle');
      const stoppedAgain = await stopSession(origin, SECOND_REQUEST_ID);
      expect(stoppedAgain.status).toBe(202);
      expect(await stoppedAgain.json()).toMatchObject({ active: false, phase: 'idle' });
      expect(closePersistentBrowserForCheckpoint).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupPromise;
      await closeServer(provision.server);
    }
  }, 10_000);

  it('permanently quarantines an unexpectedly closed context instead of reusing its profile', async () => {
    const browsers = [
      fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      fakeLoginBrowser(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    ];
    let launchIndex = 0;
    const closePersistentBrowserForCheckpoint = vi.fn(async (input) => {
      await input.context.close();
    });
    const provision = createKemerBetSessionProvisionServer({
      assertBrowserExecutable: async () => undefined,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
      closePersistentBrowserForCheckpoint,
      effectiveUserId: 10_001,
      environment: SAFE_ENVIRONMENT,
      launchPersistentContext: async () => browsers[launchIndex++]!.context,
      prepareAuthenticatedIdentityVerifier: prepareVerifiedIdentity,
      prepareSessionProfile: async () => resolve('validated-kemerbet-profile'),
      setTimer: vi.fn(() => ({}) as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      validateSessionProfile: async () => undefined,
    });
    const origin = await listenOnLoopback(provision.server);
    try {
      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({
              platformAgentAccountId: ACCOUNT_ID,
              requestId: REQUEST_ID,
            }),
          )
        ).status,
      ).toBe(202);
      await waitForSessionPhase(origin, 'login_required');
      browsers[0]!.emitUnexpectedClose();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(sessionStatusUrl(origin), {
          headers: { connection: 'close' },
        });
        if (response.status === 503) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 0));
      }
      expect(closePersistentBrowserForCheckpoint).not.toHaveBeenCalled();

      expect(
        (
          await postSessionStart(
            origin,
            JSON.stringify({
              platformAgentAccountId: ACCOUNT_ID,
              requestId: SECOND_REQUEST_ID,
            }),
          )
        ).status,
      ).toBe(503);
      expect(launchIndex).toBe(1);
    } finally {
      await closeServer(provision.server);
    }
    expect(closePersistentBrowserForCheckpoint).not.toHaveBeenCalled();
  });

  it('binds every preview input to one exact generation and displayed frame', () => {
    const source = readFileSync(
      new URL('./kemerbet-session-provision-server.ts', import.meta.url),
      'utf8',
    );
    const inputBody = source.slice(
      source.indexOf('const input = async'),
      source.indexOf('const sealReadiness = async'),
    );
    expect(inputBody).toContain('candidate.sessionGeneration !== sessionGeneration');
    expect(inputBody).toContain('candidate.frameSequence !== frameSequence');
    expect(inputBody).toContain("phase !== 'login_required'");
    expect(inputBody).not.toContain('imageBase64');
    const stopBody = source.slice(
      source.indexOf('const finishStop = async'),
      source.indexOf('const queueStopCleanup'),
    );
    expect(stopBody).toContain('await closeBrowserCleanly');
    expect(stopBody).not.toContain('.close().catch(() => undefined)');
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

  it('authorizes a fresh recovery Profile only by observing the signed-in identity under the retired UUID', async () => {
    const rawIdentity = 'private-test-agent-identity';
    const baseFingerprinter = Object.assign(
      vi.fn(
        (profileId: string, identity: string) =>
          `hmac-sha256-agent-identity-v1:${createHash('sha256')
            .update(`${profileId}\0${identity}`, 'utf8')
            .digest('hex')}`,
      ),
      { keyFingerprint: `sha256:${'e'.repeat(64)}` },
    );
    const expectedFingerprint = baseFingerprinter(OTHER_ACCOUNT_ID, rawIdentity);
    const expectedFreshFingerprint = baseFingerprinter(ACCOUNT_ID, rawIdentity);
    baseFingerprinter.mockClear();
    const observed: string[] = [];
    let observedRawIdentity = rawIdentity;
    const observeIdentityFingerprint = vi.fn(
      async (input: {
        readonly fingerprintAgentIdentity: (profileId: string, identity: string) => string;
        readonly platformAgentAccountId: string;
      }) => {
        const result = input.fingerprintAgentIdentity(
          input.platformAgentAccountId,
          observedRawIdentity,
        );
        observed.push(result);
        return result;
      },
    );
    const verifier = await prepareKemerBetProvisionAuthenticatedIdentityVerifier(
      ACCOUNT_ID,
      10_001,
      {
        createFingerprinter: async () => baseFingerprinter,
        loadIdentityAuthorization: async () => ({
          expectedAgentIdentityFingerprint: expectedFingerprint,
          kind: 'security_recovery',
          platformAgentAccountId: ACCOUNT_ID,
          verificationPlatformAgentAccountId: OTHER_ACCOUNT_ID,
        }),
        loadSelectorContract: async () => undefined as never,
        observeIdentityFingerprint,
      },
    );
    const page = {} as Page;

    await expect(verifier.verify(page)).resolves.toBeUndefined();
    expect(verifier.accountId).toBe(ACCOUNT_ID);
    expect(verifier.fingerprintAgentIdentity.keyFingerprint).toBe(baseFingerprinter.keyFingerprint);
    expect(observed).toEqual([expectedFreshFingerprint]);
    expect(baseFingerprinter.mock.calls).toEqual([
      [OTHER_ACCOUNT_ID, rawIdentity],
      [ACCOUNT_ID, rawIdentity],
    ]);
    expect(observeIdentityFingerprint).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        page,
        platformAgentAccountId: ACCOUNT_ID,
      }),
    );

    observedRawIdentity = 'another-agent-identity';
    await expect(verifier.verify(page)).rejects.toBeInstanceOf(
      KemerBetProvisionServerUnavailableError,
    );
  });

  it('rejects a recovery authorization for any fresh Profile other than the requested one', async () => {
    await expect(
      prepareKemerBetProvisionAuthenticatedIdentityVerifier(ACCOUNT_ID, 10_001, {
        createFingerprinter: async () =>
          Object.assign(() => `hmac-sha256-agent-identity-v1:${'a'.repeat(64)}`, {
            keyFingerprint: `sha256:${'f'.repeat(64)}`,
          }),
        loadIdentityAuthorization: async () => ({
          expectedAgentIdentityFingerprint: `hmac-sha256-agent-identity-v1:${'a'.repeat(64)}`,
          kind: 'security_recovery',
          platformAgentAccountId: OTHER_ACCOUNT_ID,
          verificationPlatformAgentAccountId: ACCOUNT_ID,
        }),
        loadSelectorContract: async () => undefined as never,
      }),
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
    const stateClear = checkpoint.indexOf("clearRuntimeState('checkpointed')");
    expect(validation).toBeGreaterThanOrEqual(0);
    expect(exactTopology).toBeGreaterThan(validation);
    expect(irreversibleLatch).toBeGreaterThan(exactTopology);
    expect(cleanProfileClose).toBeGreaterThan(irreversibleLatch);
    expect(postCloseValidation).toBeGreaterThan(cleanProfileClose);
    expect(stateClear).toBeGreaterThan(postCloseValidation);
    expect(checkpoint).toContain('profilePath !== retainedProfilePath');
    expect(checkpoint).toContain('profilePath: retainedProfilePath');
    expect(source).toMatch(
      /const clearRuntimeState[\s\S]*?context = undefined;[\s\S]*?profilePath = undefined;/u,
    );
    expect(checkpoint).not.toContain('await retainedContext.close()');
    expect(source).toContain('blockedRequestCounter += 1n');
    expect(source).toContain('if (checkpointValidationActive) checkpointBlockedForRecheck = true');
    expect(checkpoint).toContain('checkpointValidationActive = true');
    expect(checkpoint).toContain('checkpointBlockedForRecheck ||');
    expect(checkpoint).toMatch(/finally \{\s+checkpointValidationActive = false/u);
    expect(irreversibleLatch).toBeLessThan(cleanProfileClose);
    expect(cleanProfileClose).toBeLessThan(stateClear);
    expect(source).toContain('profileGenerationLease ||');
    expect(source).toContain('pendingProfileGenerationLease ||');
    const inputBody = source.slice(
      source.indexOf('const input = async'),
      source.indexOf('const sealReadiness = async'),
    );
    expect(inputBody).toContain('checkpointedForRecheck ||');
    expect(inputBody).toContain("phase !== 'login_required'");
    expect(inputBody).toContain('candidate.sessionGeneration !== sessionGeneration');
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
      closeBody.indexOf("clearRuntimeState('checkpointed')"),
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
    for (const requestUrl of [
      'https://evil.example/collect?session=secret',
      'https://admin-api.agt-digi.com/Account/Profile',
      'https://admin-api.agt-digi.com/unknown-read',
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          headers: { authorization: 'Bearer reviewed-authentication-token' },
          isMainFrame: true,
          isNavigationRequest: false,
          method: 'GET',
          pageUrl: AGENTS_PAGE,
          resourceType: 'xhr',
          requestUrl,
        }),
      ).toBe(false);
    }
  });

  it("allows only KemerBet's exact refresh-token request during authenticated retention", () => {
    const exactNewServiceRefresh = {
      headers: {
        authorization: 'Bearer reviewed-authentication-token',
        'content-type': 'application/json',
        et: '1',
        grant_type: 'refresh_token',
      },
      isMainFrame: true,
      isNavigationRequest: false,
      method: 'POST',
      pageUrl: AGENTS_PAGE,
      postData: JSON.stringify({ refreshToken: 'reviewed-refresh-token-value' }),
      redirectedFrom: false,
      resourceType: 'xhr',
      requestUrl: 'https://admin-api.agt-digi.com/Account/RefreshToken',
    } as const;
    const exactGlobalRefresh = {
      ...exactNewServiceRefresh,
      headers: {
        'content-type': 'application/json',
        et: '1',
      },
    } as const;

    expect(isAllowedKemerBetSessionRequest(exactNewServiceRefresh)).toBe(true);
    expect(isAllowedKemerBetSessionRequest(exactGlobalRefresh)).toBe(true);
    expect(
      isAllowedKemerBetSessionRequest({
        ...exactNewServiceRefresh,
        headers: {
          ...exactNewServiceRefresh.headers,
          'content-type': 'application/json; charset=utf-8',
        },
      }),
    ).toBe(true);

    for (const candidate of [
      { ...exactNewServiceRefresh, pageUrl: LOGIN_PAGE },
      { ...exactNewServiceRefresh, isMainFrame: false },
      { ...exactNewServiceRefresh, isNavigationRequest: true },
      { ...exactNewServiceRefresh, method: 'PUT' },
      { ...exactNewServiceRefresh, redirectedFrom: true },
      { ...exactNewServiceRefresh, resourceType: 'document' },
      {
        ...exactNewServiceRefresh,
        headers: { ...exactNewServiceRefresh.headers, grant_type: 'password' },
      },
      {
        ...exactNewServiceRefresh,
        headers: { ...exactNewServiceRefresh.headers, 'content-type': 'text/plain' },
      },
      {
        ...exactNewServiceRefresh,
        headers: {
          'content-type': 'application/json',
          et: '1',
          grant_type: 'refresh_token',
        },
      },
      {
        ...exactGlobalRefresh,
        headers: { ...exactGlobalRefresh.headers, authorization: 'Bearer injected-token-value' },
      },
      { ...exactNewServiceRefresh, postData: JSON.stringify({ refreshToken: 'too-short' }) },
      {
        ...exactNewServiceRefresh,
        postData: JSON.stringify({ refreshToken: 'reviewed-refresh-token-value', extra: true }),
      },
      { ...exactNewServiceRefresh, postData: '{not-json' },
      {
        ...exactNewServiceRefresh,
        requestUrl: `${exactNewServiceRefresh.requestUrl}?unexpected=1`,
      },
      {
        ...exactNewServiceRefresh,
        requestUrl: 'https://admin-api.agt-digi.com:443/Account/RefreshToken',
      },
      {
        ...exactNewServiceRefresh,
        requestUrl: 'https://user@admin-api.agt-digi.com/Account/RefreshToken',
      },
      {
        ...exactNewServiceRefresh,
        requestUrl: 'https://admin-api.agt-digi.com/account/RefreshToken',
      },
      { ...exactNewServiceRefresh, requestUrl: 'https://admin-api.agt-digi.com/Account/Profile' },
      { ...exactNewServiceRefresh, requestUrl: 'https://evil.example/Account/RefreshToken' },
    ]) {
      expect(isAllowedKemerBetSessionRequest(candidate)).toBe(false);
    }
  });

  it('allows login transport but only exact login or agents top-level navigation', () => {
    const exactLogin = {
      headers: { 'content-type': 'application/json', et: '1' },
      isMainFrame: true,
      isNavigationRequest: false,
      method: 'POST',
      pageUrl: LOGIN_PAGE,
      postData: JSON.stringify({
        password: 'redacted-password',
        token: 'reviewed-recaptcha-token-value',
        userName: 'owner',
      }),
      resourceType: 'xhr',
      requestUrl: 'https://admin-api.agt-digi.com/Account/Login',
    } as const;
    expect(isAllowedKemerBetSessionRequest(exactLogin)).toBe(true);
    for (const candidate of [
      {
        ...exactLogin,
        postData: JSON.stringify({ password: 'redacted-password', userName: 'owner' }),
      },
      {
        ...exactLogin,
        postData: JSON.stringify({
          password: 'redacted-password',
          token: 'reviewed-recaptcha-token-value',
          userName: 'owner',
          extra: null,
        }),
      },
      {
        ...exactLogin,
        postData: JSON.stringify({
          password: 'redacted-password',
          token: 'reviewed-recaptcha-token-value',
          username: 'owner',
        }),
      },
      { ...exactLogin, resourceType: 'fetch' },
    ]) {
      expect(isAllowedKemerBetSessionRequest(candidate)).toBe(false);
    }
    expect(
      isAllowedKemerBetSessionRequest({
        headers: { 'content-type': 'application/json', et: '1' },
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'POST',
        pageUrl: LOGIN_PAGE,
        postData: JSON.stringify({
          password: 'redacted-password',
          token: 'reviewed-recaptcha-token-value',
          userName: 'owner',
        }),
        resourceType: 'xhr',
        requestUrl: 'https://admin-api.agt-digi.com/Auth/Login',
      }),
    ).toBe(false);
    expect(
      isAllowedKemerBetSessionRequest({
        headers: { 'content-type': 'application/json', et: '1' },
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'POST',
        pageUrl: LOGIN_PAGE,
        postData: JSON.stringify({
          password: 'redacted-password',
          token: 'reviewed-recaptcha-token-value',
          userName: 'owner',
        }),
        resourceType: 'xhr',
        requestUrl: 'https://evil.example/collect',
      }),
    ).toBe(false);
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

  it('allows only endpoint-exact CORS preflights and query-bearing Account Info reads', () => {
    const preflight = {
      headers: {
        'access-control-request-headers': 'content-type,et',
        'access-control-request-method': 'POST',
        origin: 'https://agentsystem.admindigi.com',
      },
      isMainFrame: true,
      isNavigationRequest: false,
      method: 'OPTIONS',
      pageUrl: LOGIN_PAGE,
      resourceType: 'other',
      requestUrl: 'https://admin-api.agt-digi.com/Account/Login',
    } as const;
    expect(isAllowedKemerBetSessionRequest(preflight)).toBe(true);
    expect(
      isAllowedKemerBetSessionRequest({
        ...preflight,
        headers: {
          ...preflight.headers,
          'access-control-request-headers': 'authorization,content-type,et',
        },
      }),
    ).toBe(false);

    const globalRefreshPreflight = {
      ...preflight,
      pageUrl: AGENTS_PAGE,
      requestUrl: 'https://admin-api.agt-digi.com/Account/RefreshToken',
    } as const;
    expect(isAllowedKemerBetSessionRequest(globalRefreshPreflight)).toBe(true);
    expect(
      isAllowedKemerBetSessionRequest({
        ...globalRefreshPreflight,
        headers: {
          ...globalRefreshPreflight.headers,
          'access-control-request-headers': 'authorization,content-type,et,grant_type',
        },
      }),
    ).toBe(true);

    const accountInfoUrl = 'https://admin-api.agt-digi.com/Account/Info?languageCode=en-US';
    const accountInfoPreflight = {
      ...preflight,
      headers: {
        'access-control-request-headers': 'authorization,content-type',
        'access-control-request-method': 'GET',
        origin: 'https://agentsystem.admindigi.com',
      },
      pageUrl: AGENTS_PAGE,
      requestUrl: accountInfoUrl,
    } as const;
    expect(isAllowedKemerBetSessionRequest(accountInfoPreflight)).toBe(true);
    expect(
      isAllowedKemerBetSessionRequest({
        headers: {
          authorization: 'Bearer reviewed-authentication-token',
          'content-type': 'application/json;charset=utf-8',
        },
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'GET',
        pageUrl: AGENTS_PAGE,
        resourceType: 'xhr',
        requestUrl: accountInfoUrl,
      }),
    ).toBe(true);
    for (const requestUrl of [
      'https://admin-api.agt-digi.com/Account/Info?languageCode=en-US&languageCode=am',
      'https://admin-api.agt-digi.com/Account/Info?languageCode=en-US&extra=1',
      'https://admin-api.agt-digi.com/Account/Info?languageCode=',
    ]) {
      expect(isAllowedKemerBetSessionRequest({ ...accountInfoPreflight, requestUrl })).toBe(false);
    }
    expect(
      isAllowedKemerBetSessionRequest({
        headers: { authorization: 'Bearer reviewed-authentication-token' },
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'GET',
        pageUrl: AGENTS_PAGE,
        requestUrl: 'https://admin-api.agt-digi.com/Project/Balance',
        resourceType: 'xhr',
      }),
    ).toBe(false);
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'GET',
        pageUrl: LOGIN_PAGE,
        requestUrl: 'https://agt-cdn.cdn-digi.com/prd/system/translations/backoffice_en.json',
        resourceType: 'fetch',
      }),
    ).toBe(true);
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'GET',
        pageUrl: LOGIN_PAGE,
        requestUrl:
          'https://agt-cdn.cdn-digi.com/prd/system/translations/backoffice_en.json?credential-like=must-not-leave',
        resourceType: 'fetch',
      }),
    ).toBe(false);
  });

  it('admits exactly one complete pinned reCAPTCHA ceremony and never forwards executable bytes', async () => {
    const frames = testRecaptchaFrames();
    const fetchAsset = vi.fn(testRecaptchaFetcher());
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({
      fetchAsset,
      onForbiddenRequest: forbidden,
    });
    const routes = exactTestRecaptchaRoutes(frames);

    for (const candidate of routes) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }

    for (const index of [0, 1, 3, 4, 5, 6, 7]) {
      expect(routes[index]?.fulfill).toHaveBeenCalledOnce();
      expect(routes[index]?.continue).not.toHaveBeenCalled();
    }
    for (const index of [2, 8, 9, 10]) {
      expect(routes[index]?.continue).toHaveBeenCalledOnce();
      expect(routes[index]?.fulfill).not.toHaveBeenCalled();
    }
    for (const candidate of routes) expect(candidate.abort).not.toHaveBeenCalled();
    expect(fetchAsset).toHaveBeenCalledTimes(5);
    for (const [fetchInput] of fetchAsset.mock.calls) {
      expect(Object.keys(fetchInput).sort()).toEqual(['maxBytes', 'timeoutMs', 'url', 'userAgent']);
      expect(fetchInput.userAgent).toBe(TEST_RECAPTCHA_USER_AGENT);
    }
    expect(forbidden).not.toHaveBeenCalled();
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(true);

    const apiHeaders = routes[0]?.fulfill.mock.calls[0]?.[0]?.headers;
    const runtimeHeaders = routes[1]?.fulfill.mock.calls[0]?.[0]?.headers;
    const workerHeaders = routes[5]?.fulfill.mock.calls[0]?.[0]?.headers;
    expect(apiHeaders).toMatchObject({
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    });
    expect(apiHeaders).not.toHaveProperty('access-control-allow-origin');
    expect(runtimeHeaders).toMatchObject({
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    });
    expect(workerHeaders).toMatchObject({
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-site',
      'x-content-type-options': 'nosniff',
    });
    expect(workerHeaders).not.toHaveProperty('access-control-allow-origin');

    const replay = testRecaptchaRoute({
      bodyBytes: 7_949,
      contentType: 'application/x-protobuf',
      frame: frames.anchorFrame,
      method: 'POST',
      resourceType: 'xhr',
      url: `https://www.google.com/recaptcha/api2/bcn?k=${TEST_RECAPTCHA_SITE_KEY}`,
    });
    await dispatchTestRecaptchaRoute(ceremony, frames.page, replay);
    expect(replay.abort).toHaveBeenCalledOnce();
    expect(forbidden).toHaveBeenCalledOnce();
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
  });

  it('holds the live interleaved login permit locally until the exact clr proof completes', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    for (const candidate of routes.slice(0, 9)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }

    let settled: boolean | undefined;
    const pendingPermit = ceremony.consumeKemerBetLoginPermit().then((accepted) => {
      settled = accepted;
      return accepted;
    });
    await Promise.resolve();
    expect(settled).toBeUndefined();

    const clr = routes[9];
    if (!clr) throw new Error('clr fixture missing');
    await dispatchTestRecaptchaRoute(ceremony, frames.page, clr);
    await expect(pendingPermit).resolves.toBe(true);
    expect(clr.continue).toHaveBeenCalledOnce();
    expect(forbidden).not.toHaveBeenCalled();

    const bcn = routes[10];
    if (!bcn) throw new Error('bcn fixture missing');
    await dispatchTestRecaptchaRoute(ceremony, frames.page, bcn);
    expect(bcn.continue).toHaveBeenCalledOnce();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('allows the exact login permit immediately when clr already completed before the login route', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    for (const candidate of routes.slice(0, 10)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }

    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(true);
    const bcn = routes[10];
    if (!bcn) throw new Error('bcn fixture missing');
    await dispatchTestRecaptchaRoute(ceremony, frames.page, bcn);
    expect(bcn.continue).toHaveBeenCalledOnce();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('accepts the exact post-login DFA when optional bcn is absent', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    ceremony.observeMainFrameCommit(LOGIN_PAGE);
    for (const candidate of routes.slice(0, 10)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }

    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(true);
    completeTestPostLoginTransition(ceremony, frames, ['available_published', 'account_info']);

    expect(forbidden).not.toHaveBeenCalled();
    expect(routes[10]?.continue).not.toHaveBeenCalled();
  });

  it('admits one exact optional bcn tail racing after the post-login DFA', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    ceremony.observeMainFrameCommit(LOGIN_PAGE);
    for (const candidate of routes.slice(0, 10)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(true);
    completeTestPostLoginTransition(ceremony, frames);

    const bcn = routes[10];
    if (!bcn) throw new Error('bcn fixture missing');
    await dispatchTestRecaptchaRoute(ceremony, frames.page, bcn);
    expect(bcn.continue).toHaveBeenCalledOnce();
    expect(forbidden).not.toHaveBeenCalled();

    const duplicateBcn = testRecaptchaRoute({
      bodyBytes: 7_949,
      contentType: 'application/x-protobuf',
      frame: frames.anchorFrame,
      method: 'POST',
      resourceType: 'xhr',
      url: `https://www.google.com/recaptcha/api2/bcn?k=${TEST_RECAPTCHA_SITE_KEY}`,
    });
    await dispatchTestRecaptchaRoute(ceremony, frames.page, duplicateBcn);
    expect(duplicateBcn.abort).toHaveBeenCalledOnce();
    expect(forbidden).toHaveBeenCalledExactlyOnceWith('recaptcha_ceremony');
  });

  it('settles a reserved login permit false for an invalid clr tail', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    for (const candidate of routes.slice(0, 9)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }
    const pendingPermit = ceremony.consumeKemerBetLoginPermit();
    const invalidClr = testRecaptchaRoute({
      bodyBytes: 2_107,
      frame: frames.anchorFrame,
      method: 'POST',
      resourceType: 'fetch',
      url: `https://www.google.com/recaptcha/api2/clr?k=${TEST_RECAPTCHA_SITE_KEY}`,
    });

    await dispatchTestRecaptchaRoute(ceremony, frames.page, invalidClr);

    await expect(pendingPermit).resolves.toBe(false);
    expect(invalidClr.abort).toHaveBeenCalledOnce();
    expect(forbidden).toHaveBeenCalledExactlyOnceWith('recaptcha_ceremony');
  });

  it('poisons both callers when a second login request races one reserved permit', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    for (const candidate of routes.slice(0, 9)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }

    const first = ceremony.consumeKemerBetLoginPermit();
    const second = ceremony.consumeKemerBetLoginPermit();

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(forbidden).toHaveBeenCalledExactlyOnceWith('recaptcha_ceremony');
  });

  it('times out a reserved login permit without releasing credentials', async () => {
    vi.useFakeTimers();
    try {
      const frames = testRecaptchaFrames();
      const forbidden = vi.fn();
      const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
      const routes = exactTestRecaptchaRoutes(frames);
      for (const candidate of routes.slice(0, 9)) {
        await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
      }
      const pendingPermit = ceremony.consumeKemerBetLoginPermit();

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(pendingPermit).resolves.toBe(false);
      expect(forbidden).toHaveBeenCalledExactlyOnceWith('recaptcha_ceremony');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retires only an unused ceremony or a ceremony whose sole login permit was consumed', async () => {
    const unusedFrames = testRecaptchaFrames();
    const unusedForbidden = vi.fn();
    const unused = createTestRecaptchaCeremony({ onForbiddenRequest: unusedForbidden });
    expect(unused.retireForReauthentication()).toBe(true);
    const retiredBootstrap = exactTestRecaptchaRoutes(unusedFrames)[0];
    if (!retiredBootstrap) throw new Error('bootstrap fixture missing');
    await dispatchTestRecaptchaRoute(unused, unusedFrames.page, retiredBootstrap);
    expect(retiredBootstrap.abort).toHaveBeenCalledOnce();
    expect(unusedForbidden).toHaveBeenCalledOnce();

    const inProgressFrames = testRecaptchaFrames();
    const inProgressForbidden = vi.fn();
    const inProgress = createTestRecaptchaCeremony({
      onForbiddenRequest: inProgressForbidden,
    });
    const inProgressBootstrap = exactTestRecaptchaRoutes(inProgressFrames)[0];
    if (!inProgressBootstrap) throw new Error('bootstrap fixture missing');
    await dispatchTestRecaptchaRoute(inProgress, inProgressFrames.page, inProgressBootstrap);
    expect(inProgress.retireForReauthentication()).toBe(false);
    expect(inProgressForbidden).toHaveBeenCalledOnce();

    const reusableFrames = testRecaptchaFrames();
    const reusableForbidden = vi.fn();
    const reusable = createTestRecaptchaCeremony({ onForbiddenRequest: reusableForbidden });
    for (const candidate of exactTestRecaptchaRoutes(reusableFrames)) {
      await dispatchTestRecaptchaRoute(reusable, reusableFrames.page, candidate);
    }
    expect(reusable.retireForReauthentication()).toBe(false);
    expect(reusableForbidden).toHaveBeenCalledOnce();

    const consumedFrames = testRecaptchaFrames();
    const consumed = createTestRecaptchaCeremony();
    for (const candidate of exactTestRecaptchaRoutes(consumedFrames)) {
      await dispatchTestRecaptchaRoute(consumed, consumedFrames.page, candidate);
    }
    await expect(consumed.consumeKemerBetLoginPermit()).resolves.toBe(true);
    expect(consumed.retireForReauthentication()).toBe(true);
  });

  it.each(['wall', 'monotonic'] as const)(
    'blocks the next dynamic request at the exact $0 ceremony deadline',
    async (clock) => {
      let expireImmediatelyBeforeContinue = false;
      let selectedClockReads = 0;
      const selectedClockValue = (): number => {
        if (!expireImmediatelyBeforeContinue) return 1_000;
        selectedClockReads += 1;
        return selectedClockReads >= 2 ? 10_000 : 1_000;
      };
      const frames = testRecaptchaFrames();
      const forbidden = vi.fn();
      const ceremony = createTestRecaptchaCeremony({
        monotonicNow: () => (clock === 'monotonic' ? selectedClockValue() : 1_000),
        onForbiddenRequest: forbidden,
        wallClockNow: () => (clock === 'wall' ? selectedClockValue() : 1_000),
      });
      const routes = exactTestRecaptchaRoutes(frames);
      for (const candidate of routes.slice(0, 8)) {
        await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
      }
      expireImmediatelyBeforeContinue = true;
      selectedClockReads = 0;

      const dynamicRequest = routes[8];
      if (!dynamicRequest) throw new Error('dynamic fixture missing');
      await dispatchTestRecaptchaRoute(ceremony, frames.page, dynamicRequest);
      expect(dynamicRequest.abort).toHaveBeenCalledOnce();
      expect(dynamicRequest.continue).not.toHaveBeenCalled();
      expect(forbidden).toHaveBeenCalledOnce();
    },
  );

  it('does not release a completed login permit at the exact wall-clock ceremony deadline', async () => {
    let wallTimestamp = 1_000;
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({
      onForbiddenRequest: forbidden,
      wallClockNow: () => wallTimestamp,
    });
    for (const candidate of exactTestRecaptchaRoutes(frames)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }
    wallTimestamp = 10_000;
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it('fulfills executable content only after exact URL, status, MIME, length, and digest proof', async () => {
    const frames = testRecaptchaFrames();
    const pending = deferred<{
      readonly accessControlAllowOrigin: string | null;
      readonly body: Uint8Array;
      readonly contentType: string | null;
      readonly crossOriginEmbedderPolicy: string | null;
      readonly crossOriginResourcePolicy: string | null;
      readonly finalUrl: string;
      readonly status: number;
    }>();
    const ceremony = createTestRecaptchaCeremony({ fetchAsset: () => pending.promise });
    const [bootstrap] = exactTestRecaptchaRoutes(frames);
    if (!bootstrap) throw new Error('bootstrap fixture missing');

    const handling = ceremony.handleRoute({
      page: frames.page,
      requestFrame: frames.mainFrame,
      route: bootstrap.route,
    });
    await Promise.resolve();
    expect(bootstrap.fulfill).not.toHaveBeenCalled();
    expect(bootstrap.continue).not.toHaveBeenCalled();

    pending.resolve({
      accessControlAllowOrigin: null,
      body: TEST_RECAPTCHA_BODIES.api,
      contentType: 'text/javascript; charset=utf-8',
      crossOriginEmbedderPolicy: null,
      crossOriginResourcePolicy: 'cross-origin',
      finalUrl: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
      status: 200,
    });
    await handling;
    expect(bootstrap.fulfill).toHaveBeenCalledOnce();
    expect(bootstrap.continue).not.toHaveBeenCalled();
  });

  it('never fulfills a pending pinned asset after its login document is replaced', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const pending = deferred<{
      readonly accessControlAllowOrigin: string | null;
      readonly body: Uint8Array;
      readonly contentType: string | null;
      readonly crossOriginEmbedderPolicy: string | null;
      readonly crossOriginResourcePolicy: string | null;
      readonly finalUrl: string;
      readonly status: number;
    }>();
    const ceremony = createTestRecaptchaCeremony({
      fetchAsset: () => pending.promise,
      onForbiddenRequest: forbidden,
    });
    ceremony.observeMainFrameCommit(LOGIN_PAGE);
    const [bootstrap] = exactTestRecaptchaRoutes(frames);
    if (!bootstrap) throw new Error('bootstrap fixture missing');
    const handling = ceremony.handleRoute({
      page: frames.page,
      requestFrame: frames.mainFrame,
      route: bootstrap.route,
    });
    await Promise.resolve();

    ceremony.observeMainFrameCommit(LOGIN_PAGE);
    pending.resolve({
      accessControlAllowOrigin: null,
      body: TEST_RECAPTCHA_BODIES.api,
      contentType: 'text/javascript',
      crossOriginEmbedderPolicy: null,
      crossOriginResourcePolicy: 'cross-origin',
      finalUrl: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
      status: 200,
    });
    await handling;

    expect(bootstrap.fulfill).not.toHaveBeenCalled();
    expect(bootstrap.continue).not.toHaveBeenCalled();
    expect(bootstrap.abort).toHaveBeenCalledOnce();
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it('forwards only the exact bounded retained-browser User-Agent to the pinned asset fetcher', async () => {
    const frames = testRecaptchaFrames();
    const fetchAsset = vi.fn(testRecaptchaFetcher());
    const ceremony = createTestRecaptchaCeremony({ fetchAsset });
    const bootstrap = testRecaptchaRoute({
      extraHeaders: {
        authorization: 'Bearer must-not-leave-the-browser',
        cookie: 'must-not-leave-the-browser=1',
        referer: LOGIN_PAGE,
        'sec-ch-ua': 'must-not-leave-the-browser',
        'x-arbitrary': 'must-not-leave-the-browser',
      },
      frame: frames.mainFrame,
      resourceType: 'script',
      url: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
    });

    await dispatchTestRecaptchaRoute(ceremony, frames.page, bootstrap);

    expect(fetchAsset).toHaveBeenCalledExactlyOnceWith({
      maxBytes: TEST_RECAPTCHA_BODIES.api.byteLength,
      timeoutMs: 10_000,
      url: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
      userAgent: TEST_RECAPTCHA_USER_AGENT,
    });
    expect(JSON.stringify(fetchAsset.mock.calls)).not.toContain('must-not-leave-the-browser');
    expect(bootstrap.fulfill).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'missing', userAgent: null },
    { name: 'Node default', userAgent: 'node' },
    { name: 'Undici default', userAgent: 'undici' },
    {
      name: 'credential-bearing suffix',
      userAgent: `${TEST_RECAPTCHA_USER_AGENT} Bearer must-not-leave`,
    },
    {
      name: 'oversized Chromium-shaped value',
      userAgent: `${TEST_RECAPTCHA_USER_AGENT}${'0'.repeat(193)}`,
    },
  ])('rejects a $name asset User-Agent before fetch', async ({ userAgent }) => {
    const frames = testRecaptchaFrames();
    const fetchAsset = vi.fn(testRecaptchaFetcher());
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ fetchAsset, onForbiddenRequest: forbidden });
    const bootstrap = testRecaptchaRoute({
      frame: frames.mainFrame,
      resourceType: 'script',
      url: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
      userAgent,
    });

    await dispatchTestRecaptchaRoute(ceremony, frames.page, bootstrap);

    expect(fetchAsset).not.toHaveBeenCalled();
    expect(bootstrap.abort).toHaveBeenCalledOnce();
    expect(bootstrap.fulfill).not.toHaveBeenCalled();
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it('poisons a generation when a later pinned request changes an otherwise valid User-Agent', async () => {
    const frames = testRecaptchaFrames();
    const fetchAsset = vi.fn(testRecaptchaFetcher());
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ fetchAsset, onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    await dispatchTestRecaptchaRoute(ceremony, frames.page, routes[0]!);
    const changedRuntime = testRecaptchaRoute({
      frame: frames.mainFrame,
      resourceType: 'script',
      url: TEST_RECAPTCHA_RUNTIME_URL,
      userAgent: TEST_RECAPTCHA_LINUX_USER_AGENT,
    });

    await dispatchTestRecaptchaRoute(ceremony, frames.page, changedRuntime);

    expect(fetchAsset).toHaveBeenCalledOnce();
    expect(changedRuntime.abort).toHaveBeenCalledOnce();
    expect(changedRuntime.fulfill).not.toHaveBeenCalled();
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it.each([
    {
      frame: 'missing',
      name: 'missing anchor frame',
      referer: exactTestAnchorUrl(),
      userAgent: null,
    },
    {
      frame: 'main',
      name: 'main frame',
      referer: exactTestAnchorUrl(),
      userAgent: null,
    },
    {
      frame: 'anchor',
      name: 'wrong anchor Referer',
      referer: LOGIN_PAGE,
      userAgent: TEST_RECAPTCHA_USER_AGENT,
    },
    {
      frame: 'anchor',
      name: 'malformed routed User-Agent',
      referer: exactTestAnchorUrl(),
      userAgent: 'node',
    },
  ] as const)(
    'rejects the Chrome 152 worker bootstrap with a $name',
    async ({ frame, referer, userAgent }) => {
      const frames = testRecaptchaFrames();
      const forbidden = vi.fn();
      const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
      const routes = exactTestRecaptchaRoutes(frames);
      for (const candidate of routes.slice(0, 4)) {
        await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
      }
      const invalidWorker = testRecaptchaRoute({
        extraHeaders: { referer },
        ...(frame === 'anchor'
          ? { frame: frames.anchorFrame }
          : frame === 'main'
            ? { frame: frames.mainFrame }
            : { frameUnavailable: true }),
        resourceType: 'script',
        url: TEST_RECAPTCHA_WORKER_URL,
        userAgent,
      });

      await dispatchTestRecaptchaRoute(ceremony, frames.page, invalidWorker);

      expect(invalidWorker.abort).toHaveBeenCalledOnce();
      expect(invalidWorker.fulfill).not.toHaveBeenCalled();
      expect(forbidden).toHaveBeenCalledOnce();
      await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
    },
  );

  it('does not extend the worker-bootstrap User-Agent omission to its runtime import', async () => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    for (const candidate of routes.slice(0, 6)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }
    const missingRuntimeUserAgent = testRecaptchaRoute({
      frame: frames.anchorFrame,
      resourceType: 'other',
      url: TEST_RECAPTCHA_RUNTIME_URL,
      userAgent: null,
    });

    await dispatchTestRecaptchaRoute(ceremony, frames.page, missingRuntimeUserAgent);

    expect(missingRuntimeUserAgent.abort).toHaveBeenCalledOnce();
    expect(missingRuntimeUserAgent.fulfill).not.toHaveBeenCalled();
    expect(forbidden).toHaveBeenCalledOnce();
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
  });

  it('does not serialize unrelated KemerBet assets behind a pinned reCAPTCHA download', async () => {
    const frames = testRecaptchaFrames();
    const pending = deferred<{
      readonly accessControlAllowOrigin: string | null;
      readonly body: Uint8Array;
      readonly contentType: string | null;
      readonly crossOriginEmbedderPolicy: string | null;
      readonly crossOriginResourcePolicy: string | null;
      readonly finalUrl: string;
      readonly status: number;
    }>();
    const ceremony = createTestRecaptchaCeremony({ fetchAsset: () => pending.promise });
    const [bootstrap] = exactTestRecaptchaRoutes(frames);
    if (!bootstrap) throw new Error('bootstrap fixture missing');
    const bootstrapHandling = ceremony.handleRoute({
      page: frames.page,
      requestFrame: frames.mainFrame,
      route: bootstrap.route,
    });
    await Promise.resolve();

    const unrelated = testRecaptchaRoute({
      frame: frames.mainFrame,
      resourceType: 'image',
      url: 'https://agentsystem.admindigi.com/src/favicon.svg',
    });
    await expect(
      ceremony.handleRoute({
        page: frames.page,
        requestFrame: frames.mainFrame,
        route: unrelated.route,
      }),
    ).resolves.toBe('not_recaptcha');
    expect(unrelated.abort).not.toHaveBeenCalled();
    expect(unrelated.continue).not.toHaveBeenCalled();
    expect(unrelated.fulfill).not.toHaveBeenCalled();

    pending.resolve({
      accessControlAllowOrigin: null,
      body: TEST_RECAPTCHA_BODIES.api,
      contentType: 'text/javascript',
      crossOriginEmbedderPolicy: null,
      crossOriginResourcePolicy: 'cross-origin',
      finalUrl: `https://www.google.com/recaptcha/api.js?render=${TEST_RECAPTCHA_SITE_KEY}`,
      status: 200,
    });
    await bootstrapHandling;
  });

  it.each([
    { name: 'observed Chromium 151 order', staticOrder: [4, 5, 6, 7] },
    { name: 'logo before worker startup', staticOrder: [4, 6, 5, 7] },
    { name: 'worker import before logo', staticOrder: [4, 5, 7, 6] },
    { name: 'anchor runtime after worker startup', staticOrder: [5, 4, 6, 7] },
    { name: 'anchor runtime last', staticOrder: [5, 7, 6, 4] },
  ])('accepts the bounded Chromium static subresource race: $name', async ({ staticOrder }) => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    const order = [0, 1, 2, 3, ...staticOrder, 8, 9, 10];

    for (const index of order) {
      const candidate = routes[index];
      if (!candidate) throw new Error('reCAPTCHA fixture missing');
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }

    expect(forbidden).not.toHaveBeenCalled();
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(true);
  });

  it.each([
    { name: 'duplicate anchor runtime', first: 4, duplicate: 4 },
    { name: 'duplicate logo', first: 6, duplicate: 6 },
    { name: 'duplicate worker bootstrap', first: 5, duplicate: 5 },
    { name: 'worker import before worker bootstrap', first: undefined, duplicate: 7 },
  ])('poisons a static subresource sequence for $name', async ({ first, duplicate }) => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = exactTestRecaptchaRoutes(frames);
    for (const candidate of routes.slice(0, 4)) {
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }
    if (first !== undefined) {
      const candidate = routes[first];
      if (!candidate) throw new Error('reCAPTCHA fixture missing');
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }
    const replay = routes[duplicate];
    if (!replay) throw new Error('reCAPTCHA fixture missing');
    await dispatchTestRecaptchaRoute(ceremony, frames.page, replay);

    expect(replay.abort).toHaveBeenCalledOnce();
    expect(forbidden).toHaveBeenCalledOnce();
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
  });

  it.each([
    {
      frame: 'main',
      name: 'main-frame replay',
      resourceType: 'script',
    },
    {
      frame: 'missing',
      name: 'worker-frame replay',
      resourceType: 'script',
    },
    {
      frame: 'anchor',
      name: 'anchor-frame non-script replay',
      resourceType: 'other',
    },
  ] as const)(
    'rejects an otherwise pinned anchor runtime with a $name',
    async ({ frame, resourceType }) => {
      const frames = testRecaptchaFrames();
      const forbidden = vi.fn();
      const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
      const routes = exactTestRecaptchaRoutes(frames);
      for (const candidate of routes.slice(0, 4)) {
        await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
      }
      const invalidAnchorRuntime = testRecaptchaRoute({
        ...(frame === 'anchor'
          ? { frame: frames.anchorFrame }
          : frame === 'main'
            ? { frame: frames.mainFrame }
            : { frameUnavailable: true }),
        resourceType,
        url: TEST_RECAPTCHA_RUNTIME_URL,
      });

      await dispatchTestRecaptchaRoute(ceremony, frames.page, invalidAnchorRuntime);

      expect(invalidAnchorRuntime.abort).toHaveBeenCalledOnce();
      expect(invalidAnchorRuntime.fulfill).not.toHaveBeenCalled();
      expect(forbidden).toHaveBeenCalledOnce();
      await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
    },
  );

  it('binds the ceremony to one login document and retires it on the expected agents commit', async () => {
    const interruptedFrames = testRecaptchaFrames();
    const interruptedForbidden = vi.fn();
    const interrupted = createTestRecaptchaCeremony({
      onForbiddenRequest: interruptedForbidden,
    });
    interrupted.observeMainFrameCommit(LOGIN_PAGE);
    const interruptedRoutes = exactTestRecaptchaRoutes(interruptedFrames);
    for (const candidate of interruptedRoutes.slice(0, 2)) {
      await dispatchTestRecaptchaRoute(interrupted, interruptedFrames.page, candidate);
    }
    interrupted.observeMainFrameCommit(LOGIN_PAGE);
    await dispatchTestRecaptchaRoute(interrupted, interruptedFrames.page, interruptedRoutes[2]!);
    expect(interruptedForbidden).toHaveBeenCalledOnce();
    expect(interruptedRoutes[2]?.abort).toHaveBeenCalledOnce();
    await expect(interrupted.consumeKemerBetLoginPermit()).resolves.toBe(false);

    const completedFrames = testRecaptchaFrames();
    const completedForbidden = vi.fn();
    const completed = createTestRecaptchaCeremony({ onForbiddenRequest: completedForbidden });
    completed.observeMainFrameCommit(LOGIN_PAGE);
    for (const candidate of exactTestRecaptchaRoutes(completedFrames)) {
      await dispatchTestRecaptchaRoute(completed, completedFrames.page, candidate);
    }
    await expect(completed.consumeKemerBetLoginPermit()).resolves.toBe(true);
    completeTestPostLoginTransition(completed, completedFrames);
    expect(completedForbidden).not.toHaveBeenCalled();
  });

  it.each(['sequential', 'concurrent'])(
    'consumes one login permit against $0 replay',
    async (mode) => {
      const frames = testRecaptchaFrames();
      const forbidden = vi.fn();
      const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
      for (const candidate of exactTestRecaptchaRoutes(frames)) {
        await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
      }

      const results =
        mode === 'concurrent'
          ? await Promise.all([
              ceremony.consumeKemerBetLoginPermit(),
              ceremony.consumeKemerBetLoginPermit(),
            ])
          : [
              await ceremony.consumeKemerBetLoginPermit(),
              await ceremony.consumeKemerBetLoginPermit(),
            ];

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(results.filter((result) => !result)).toHaveLength(1);
      expect(forbidden).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      name: 'one-byte digest mismatch',
      mutate: (result: Awaited<ReturnType<KemerBetRecaptchaAssetFetcher>>) => ({
        ...result,
        body: Buffer.from([...result.body.slice(0, -1), result.body.at(-1)! ^ 1]),
      }),
    },
    {
      name: 'redirect',
      mutate: (result: Awaited<ReturnType<KemerBetRecaptchaAssetFetcher>>) => ({
        ...result,
        finalUrl: 'https://www.google.com/recaptcha/api.js?redirected=1',
        status: 302,
      }),
    },
    {
      name: 'wrong MIME',
      mutate: (result: Awaited<ReturnType<KemerBetRecaptchaAssetFetcher>>) => ({
        ...result,
        contentType: 'text/html',
      }),
    },
    {
      name: 'wrong size',
      mutate: (result: Awaited<ReturnType<KemerBetRecaptchaAssetFetcher>>) => ({
        ...result,
        body: result.body.slice(0, -1),
      }),
    },
    {
      name: 'unexpected CORS exposure',
      mutate: (result: Awaited<ReturnType<KemerBetRecaptchaAssetFetcher>>) => ({
        ...result,
        accessControlAllowOrigin: '*',
      }),
    },
    {
      name: 'wrong resource policy',
      mutate: (result: Awaited<ReturnType<KemerBetRecaptchaAssetFetcher>>) => ({
        ...result,
        crossOriginResourcePolicy: 'same-site',
      }),
    },
    {
      name: 'unexpected embedder policy',
      mutate: (result: Awaited<ReturnType<KemerBetRecaptchaAssetFetcher>>) => ({
        ...result,
        crossOriginEmbedderPolicy: 'require-corp',
      }),
    },
  ])('poisons the generation for a pinned asset $name', async ({ mutate }) => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const baselineFetcher = testRecaptchaFetcher();
    const ceremony = createTestRecaptchaCeremony({
      fetchAsset: async (fetchInput) => mutate(await baselineFetcher(fetchInput)),
      onForbiddenRequest: forbidden,
    });
    const [bootstrap] = exactTestRecaptchaRoutes(frames);
    if (!bootstrap) throw new Error('bootstrap fixture missing');

    await dispatchTestRecaptchaRoute(ceremony, frames.page, bootstrap);

    expect(bootstrap.abort).toHaveBeenCalledOnce();
    expect(bootstrap.fulfill).not.toHaveBeenCalled();
    expect(bootstrap.continue).not.toHaveBeenCalled();
    expect(forbidden).toHaveBeenCalledExactlyOnceWith('recaptcha_asset');
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
  });

  it.each([
    {
      name: 'wrong runtime version',
      replaceAt: 1,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          frame: frames.mainFrame,
          resourceType: 'script',
          url: 'https://www.gstatic.com/recaptcha/releases/wrong/recaptcha__en.js',
        }),
    },
    {
      name: 'duplicate anchor key',
      replaceAt: 2,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          frame: frames.anchorFrame,
          navigation: true,
          resourceType: 'document',
          url: exactTestAnchorUrl({}, ['k', TEST_RECAPTCHA_SITE_KEY]),
        }),
    },
    {
      name: 'wrong anchor query',
      replaceAt: 2,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          frame: frames.anchorFrame,
          navigation: true,
          resourceType: 'document',
          url: exactTestAnchorUrl({ co: 'wrong-origin' }),
        }),
    },
    {
      name: 'non-canonical anchor encoding',
      replaceAt: 2,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          frame: frames.anchorFrame,
          navigation: true,
          resourceType: 'document',
          url: exactTestAnchorUrl().replace('hl=en', 'hl=%65n'),
        }),
    },
    ...[
      ['four-digit anchor timing', '9999'],
      ['six-digit anchor timing', '100000'],
      ['non-decimal anchor timing', '12a45'],
    ].map(([name, timing]) => ({
      name,
      replaceAt: 2,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          frame: frames.anchorFrame,
          navigation: true,
          resourceType: 'document',
          url: exactTestAnchorUrl({ 'anchor-ms': timing! }),
        }),
    })),
    {
      name: 'main-frame reload',
      replaceAt: 8,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          bodyBytes: 10_892,
          contentType: 'application/x-protobuffer',
          frame: frames.mainFrame,
          method: 'POST',
          resourceType: 'xhr',
          url: `https://www.google.com/recaptcha/api2/reload?k=${TEST_RECAPTCHA_SITE_KEY}`,
        }),
    },
    {
      name: 'anchor-frame clr',
      replaceAt: 9,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          bodyBytes: 2_107,
          frame: frames.anchorFrame,
          method: 'POST',
          resourceType: 'fetch',
          url: `https://www.google.com/recaptcha/api2/clr?k=${TEST_RECAPTCHA_SITE_KEY}`,
        }),
    },
    {
      name: 'unavailable-frame clr',
      replaceAt: 9,
      replacement: () =>
        testRecaptchaRoute({
          bodyBytes: 2_107,
          frameUnavailable: true,
          method: 'POST',
          resourceType: 'fetch',
          url: `https://www.google.com/recaptcha/api2/clr?k=${TEST_RECAPTCHA_SITE_KEY}`,
        }),
    },
    {
      name: 'foreign-main-frame clr',
      replaceAt: 9,
      replacement: () =>
        testRecaptchaRoute({
          bodyBytes: 2_107,
          frame: testRecaptchaFrames().mainFrame,
          method: 'POST',
          resourceType: 'fetch',
          url: `https://www.google.com/recaptcha/api2/clr?k=${TEST_RECAPTCHA_SITE_KEY}`,
        }),
    },
    {
      name: 'main-frame bcn',
      replaceAt: 10,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          bodyBytes: 7_949,
          contentType: 'application/x-protobuf',
          frame: frames.mainFrame,
          method: 'POST',
          resourceType: 'xhr',
          url: `https://www.google.com/recaptcha/api2/bcn?k=${TEST_RECAPTCHA_SITE_KEY}`,
        }),
    },
    {
      name: 'duplicate dynamic key',
      replaceAt: 8,
      replacement: (frames: ReturnType<typeof testRecaptchaFrames>) =>
        testRecaptchaRoute({
          bodyBytes: 10_892,
          contentType: 'application/x-protobuffer',
          frame: frames.anchorFrame,
          method: 'POST',
          resourceType: 'xhr',
          url: `https://www.google.com/recaptcha/api2/reload?k=${TEST_RECAPTCHA_SITE_KEY}&k=${TEST_RECAPTCHA_SITE_KEY}`,
        }),
    },
  ])('poisons the generation for $name', async ({ replaceAt, replacement }) => {
    const frames = testRecaptchaFrames();
    const forbidden = vi.fn();
    const ceremony = createTestRecaptchaCeremony({ onForbiddenRequest: forbidden });
    const routes = [...exactTestRecaptchaRoutes(frames)];
    routes[replaceAt] = replacement(frames);

    for (let index = 0; index <= replaceAt; index += 1) {
      const candidate = routes[index];
      if (!candidate) throw new Error('reCAPTCHA fixture missing');
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
    }

    expect(routes[replaceAt]?.abort).toHaveBeenCalledOnce();
    expect(forbidden).toHaveBeenCalledOnce();
    await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
  });

  it('poisons extra, out-of-order, over-budget, and exactly-at-deadline traffic', async () => {
    const cases: Array<{
      readonly candidate: (frames: ReturnType<typeof testRecaptchaFrames>) => TestRecaptchaRoute;
      readonly prefix: number;
      readonly now?: number;
    }> = [
      {
        candidate: (frames) =>
          testRecaptchaRoute({
            frame: frames.mainFrame,
            resourceType: 'script',
            url: TEST_RECAPTCHA_RUNTIME_URL,
          }),
        prefix: 0,
      },
      {
        candidate: (frames) =>
          testRecaptchaRoute({
            bodyBytes: 2_107,
            frame: frames.mainFrame,
            method: 'POST',
            resourceType: 'fetch',
            url: `https://www.google.com/recaptcha/api2/clr?k=${TEST_RECAPTCHA_SITE_KEY}`,
          }),
        prefix: 8,
      },
      {
        candidate: (frames) =>
          testRecaptchaRoute({
            bodyBytes: 16_385,
            contentType: 'application/x-protobuffer',
            frame: frames.anchorFrame,
            method: 'POST',
            resourceType: 'xhr',
            url: `https://www.google.com/recaptcha/api2/reload?k=${TEST_RECAPTCHA_SITE_KEY}`,
          }),
        prefix: 8,
      },
      {
        candidate: (frames) => exactTestRecaptchaRoutes(frames)[0]!,
        now: 10_000,
        prefix: 0,
      },
    ];

    for (const testCase of cases) {
      const frames = testRecaptchaFrames();
      const forbidden = vi.fn();
      const ceremony = createTestRecaptchaCeremony({
        monotonicNow: () => testCase.now ?? 1_000,
        onForbiddenRequest: forbidden,
      });
      const prefix = exactTestRecaptchaRoutes(frames).slice(0, testCase.prefix);
      for (const candidate of prefix) {
        await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
      }
      const candidate = testCase.candidate(frames);
      await dispatchTestRecaptchaRoute(ceremony, frames.page, candidate);
      expect(candidate.abort).toHaveBeenCalledOnce();
      expect(forbidden).toHaveBeenCalledOnce();
      await expect(ceremony.consumeKemerBetLoginPermit()).resolves.toBe(false);
    }
  });

  it('keeps every stateless or unsequenced dynamic reCAPTCHA request fail-closed', () => {
    for (const candidate of [
      {
        isMainFrame: false,
        isNavigationRequest: true,
        method: 'GET',
        requestUrl: 'https://www.google.com/recaptcha/api2/anchor?site-key=redacted',
      },
      {
        isMainFrame: false,
        isNavigationRequest: true,
        method: 'GET',
        requestUrl: 'https://www.recaptcha.net/recaptcha/api2/bframe?site-key=redacted',
      },
      {
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'POST',
        postData: 'credential-like=must-not-leave',
        requestUrl: 'https://www.google.com/recaptcha/api2/reload?k=credential-like',
        resourceType: 'xhr',
      },
      {
        isMainFrame: false,
        isNavigationRequest: false,
        method: 'GET',
        requestUrl:
          'https://www.gstatic.com/recaptcha/releases/reviewed/recaptcha__en.js?credential-like=must-not-leave',
        resourceType: 'script',
      },
    ]) {
      expect(
        isAllowedKemerBetSessionRequest({
          ...candidate,
          pageUrl: LOGIN_PAGE,
        }),
      ).toBe(false);
    }
    expect(
      isAllowedKemerBetSessionRequest({
        isMainFrame: true,
        isNavigationRequest: false,
        method: 'GET',
        pageUrl: LOGIN_PAGE,
        requestUrl: 'https://www.google.com/recaptcha/api.js?render=wrong-public-site-key',
        resourceType: 'script',
      }),
    ).toBe(false);
  });

  it('allows only required bootstrap resources and locally aborts exact cosmetic drift', () => {
    const base = {
      isMainFrame: false,
      isNavigationRequest: false,
      method: 'GET',
      pageUrl: LOGIN_PAGE,
    } as const;
    for (const [requestUrl, resourceType] of [
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-Bb0iEF9d.js',
        'script',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-CzsfyLxR.css',
        'stylesheet',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/_ltrOffset-C2RQMwco.css',
        'stylesheet',
      ],
      ['https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/ltr-DYDLRvnG.js', 'script'],
      ['https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/ltr-Dbx7HiAx.js', 'script'],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-CPiUBAbk.js',
        'script',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-CQOv3eGS.js',
        'script',
      ],
      ['https://agt-cdn.cdn-digi.com/prd/system/translations/backoffice_en.json', 'fetch'],
    ] as const) {
      expect(classifyKemerBetSessionRequest({ ...base, requestUrl, resourceType })).toBe('allow');
    }

    for (const [requestUrl, resourceType] of [
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/auth-bg-Dn8uzDgY.svg',
        'image',
      ],
      ['https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/en-DC_46aZL.svg', 'image'],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/logo-sign-DirsW9WY.svg',
        'image',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-CAPnnhhN.ttf?squmb1',
        'font',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-Nwt_l_Rk.eot?squmb1',
        'font',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-B4fQAYPi.woff?squmb1',
        'font',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/icomoon-BdqDhh2R.svg?squmb1',
        'image',
      ],
      ['https://agentsystem.admindigi.com/src/favicon.svg', 'other'],
      [
        'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap',
        'stylesheet',
      ],
      [
        'https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2',
        'font',
      ],
    ] as const) {
      expect(classifyKemerBetSessionRequest({ ...base, requestUrl, resourceType })).toBe(
        'abort_optional',
      );
    }

    for (const [requestUrl, resourceType] of [
      ['https://fonts.googleapis.com/css2?family=Roboto&display=swap', 'stylesheet'],
      [
        'https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2?changed=1',
        'font',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/en-DC_46aZL.svg?changed=1',
        'image',
      ],
      ['https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-Bb0iEF9d.js', 'image'],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/index-BUEO7OSf.js',
        'script',
      ],
      [
        'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-DpF7T6QK.js',
        'script',
      ],
      ['https://agentsystem.admindigi.comhttps//agentsystem.admindigi.com/unreviewed', 'script'],
    ] as const) {
      expect(classifyKemerBetSessionRequest({ ...base, requestUrl, resourceType })).toBe('forbid');
    }
    expect(
      classifyKemerBetSessionRequest({
        ...base,
        redirectedFrom: true,
        requestUrl:
          'https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-Bb0iEF9d.js',
        resourceType: 'script',
      }),
    ).toBe('forbid');
    expect(
      classifyKemerBetSessionRequest({
        ...base,
        redirectedFrom: true,
        requestUrl:
          'https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2',
        resourceType: 'font',
      }),
    ).toBe('forbid');
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
