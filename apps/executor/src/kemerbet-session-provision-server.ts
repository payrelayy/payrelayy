import { chmod, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type BrowserContext, type Page, type Route } from 'playwright-core';

import { assertKemerBetBrowserExecutable } from './executor-runtime-isolation.js';

const CONTROL_ROOT = '/run/fetanagent-kemerbet-session-control';
const CONTROL_SOCKET = `${CONTROL_ROOT}/session.sock`;
const PROFILE_ROOT = '/var/lib/fetanagent/kemerbet-sessions';
const CHROMIUM_PATH = '/usr/bin/chromium';
const LOGIN_URL = 'https://agentsystem.admindigi.com/login';
const WEB_ORIGIN = 'https://agentsystem.admindigi.com';
const API_ORIGIN = 'https://admin-api.agt-digi.com';
const DEPOSIT_PATH = '/Wallet/PlayerEPOSDeposit';
const RECAPTCHA_ORIGINS = new Set(['https://www.google.com', 'https://www.recaptcha.net']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_BODY_BYTES = 1_024;
const LOGIN_LIFETIME_MS = 10 * 60 * 1_000;
const AUTHENTICATED_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const NAMED_KEYS = new Set(['Backspace', 'Delete', 'Enter', 'Escape', 'Tab']);

interface SafeStat {
  readonly mode: number;
  readonly uid: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface StartInput {
  readonly platformAgentAccountId: string;
  readonly requestId: string;
}

interface PointerInput {
  readonly kind: 'pointer';
  readonly requestId: string;
  readonly x: number;
  readonly y: number;
}

interface KeyInput {
  readonly key: string;
  readonly kind: 'key';
  readonly requestId: string;
}

type SessionInput = PointerInput | KeyInput;

export interface KemerBetProvisionSessionStatus {
  readonly active: boolean;
  readonly expiresAt?: string;
  readonly imageBase64?: string;
  readonly imageContentType?: 'image/jpeg';
  readonly loginRequired: boolean;
  readonly signedIn: boolean;
  readonly transferDisabled: true;
}

export interface KemerBetProvisionServerDependencies {
  readonly assertBrowserExecutable?: () => Promise<void>;
  readonly effectiveUserId?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly launchPersistentContext?: typeof chromium.launchPersistentContext;
  readonly now?: () => Date;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
  readonly log?: (event: 'started' | 'signed_in' | 'stopped') => void;
}

export class KemerBetProvisionServerUnavailableError extends Error {
  constructor() {
    super('The private KemerBet session provision service is unavailable.');
    this.name = 'KemerBetProvisionServerUnavailableError';
  }
}

function unavailable(): never {
  throw new KemerBetProvisionServerUnavailableError();
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? object
    : undefined;
}

function assertEnvironment(environment: NodeJS.ProcessEnv, effectiveUserId: number): void {
  if (
    effectiveUserId !== 10001 ||
    environment.NODE_ENV !== 'production' ||
    environment.FINANCIAL_ACTIONS_MODE !== 'dry_run' ||
    environment.KEMERBET_EXECUTOR_ENABLED !== 'false' ||
    environment.KEMERBET_FINAL_ACTION_ENABLED !== 'false' ||
    environment.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED !== 'false' ||
    environment.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED !== 'false'
  ) {
    unavailable();
  }
}

async function assertSafeDirectory(path: string, effectiveUserId: number): Promise<void> {
  const before = (await lstat(path)) as SafeStat;
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== effectiveUserId ||
    (before.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== path
  ) {
    unavailable();
  }
  const after = (await lstat(path)) as SafeStat;
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.uid !== before.uid ||
    after.mode !== before.mode
  ) {
    unavailable();
  }
}

async function prepareProfile(accountId: string, effectiveUserId: number): Promise<string> {
  if (!UUID_PATTERN.test(accountId)) unavailable();
  await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
  const profilePath = resolve(PROFILE_ROOT, accountId);
  if (profilePath !== `${PROFILE_ROOT}/${accountId}`) unavailable();
  await mkdir(profilePath, { mode: 0o700 }).catch((error: unknown) => {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      unavailable();
    }
  });
  await assertSafeDirectory(profilePath, effectiveUserId);
  await assertSafeDirectory(PROFILE_ROOT, effectiveUserId);
  return profilePath;
}

function validPageUrl(value: string): 'agents' | 'login' | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.origin !== WEB_ORIGIN || url.username || url.password || url.hash) return undefined;
  if (url.pathname === '/agents' && url.search === '') return 'agents';
  if (url.pathname === '/login' && (url.search === '' || url.search === '?et=1')) return 'login';
  return undefined;
}

export function isAllowedKemerBetSessionRequest(input: {
  readonly isMainFrame: boolean;
  readonly isNavigationRequest: boolean;
  readonly method: string;
  readonly pageUrl: string;
  readonly requestUrl: string;
}): boolean {
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return false;
  }
  const pageState = validPageUrl(input.pageUrl);
  const exactDeposit = url.origin === API_ORIGIN && url.pathname === DEPOSIT_PATH;
  const mutatingAfterLogin =
    pageState === 'agents' &&
    input.method !== 'GET' &&
    input.method !== 'HEAD' &&
    input.method !== 'OPTIONS';
  const exactRecaptchaFrame =
    !input.isMainFrame &&
    RECAPTCHA_ORIGINS.has(url.origin) &&
    url.pathname.startsWith('/recaptcha/');
  const navigationAllowed =
    !input.isNavigationRequest || validPageUrl(url.toString()) !== undefined || exactRecaptchaFrame;
  return !exactDeposit && !mutatingAfterLogin && navigationAllowed;
}

async function guardedRoute(route: Route, page: Page): Promise<void> {
  const request = route.request();
  if (
    !isAllowedKemerBetSessionRequest({
      isMainFrame: request.frame() === page.mainFrame(),
      isNavigationRequest: request.isNavigationRequest(),
      method: request.method(),
      pageUrl: page.url(),
      requestUrl: request.url(),
    })
  ) {
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (contentType !== 'application/json') unavailable();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunkValue of request) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) unavailable();
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return unavailable();
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store, max-age=0',
    'content-length': Buffer.byteLength(serialized),
    'content-type': 'application/json; charset=utf-8',
    pragma: 'no-cache',
  });
  response.end(serialized);
}

function validStartInput(value: unknown): StartInput | undefined {
  const object = exactObject(value, ['platformAgentAccountId', 'requestId']);
  return object &&
    typeof object.platformAgentAccountId === 'string' &&
    UUID_PATTERN.test(object.platformAgentAccountId) &&
    typeof object.requestId === 'string' &&
    REQUEST_ID_PATTERN.test(object.requestId)
    ? (object as unknown as StartInput)
    : undefined;
}

function validSessionInput(value: unknown): SessionInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'pointer') {
    const object = exactObject(value, ['kind', 'requestId', 'x', 'y']);
    return object &&
      typeof object.requestId === 'string' &&
      REQUEST_ID_PATTERN.test(object.requestId) &&
      Number.isInteger(object.x) &&
      Number(object.x) >= 0 &&
      Number(object.x) < VIEWPORT.width &&
      Number.isInteger(object.y) &&
      Number(object.y) >= 0 &&
      Number(object.y) < VIEWPORT.height
      ? (object as unknown as PointerInput)
      : undefined;
  }
  if (candidate.kind === 'key') {
    const object = exactObject(value, ['key', 'kind', 'requestId']);
    const key = object?.key;
    return object &&
      typeof object.requestId === 'string' &&
      REQUEST_ID_PATTERN.test(object.requestId) &&
      typeof key === 'string' &&
      (NAMED_KEYS.has(key) || (/^[\u0020-\u007e]$/u.test(key) && key !== '`'))
      ? (object as unknown as KeyInput)
      : undefined;
  }
  return undefined;
}

export function createKemerBetSessionProvisionServer(
  dependencies: KemerBetProvisionServerDependencies = {},
): {
  readonly close: () => Promise<void>;
  readonly listen: () => Promise<void>;
  readonly server: Server;
} {
  const effectiveUserId =
    dependencies.effectiveUserId ??
    (typeof process.geteuid === 'function' ? process.geteuid() : Number.NaN);
  assertEnvironment(dependencies.environment ?? process.env, effectiveUserId);
  const launch =
    dependencies.launchPersistentContext ?? chromium.launchPersistentContext.bind(chromium);
  const now = dependencies.now ?? (() => new Date());
  const setTimer = dependencies.setTimer ?? setTimeout;
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  const log =
    dependencies.log ??
    ((event: 'started' | 'signed_in' | 'stopped') =>
      console.info({ component: 'kemerbet_session_provision', event, detailsRedacted: true }));
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let accountId: string | undefined;
  let expiresAt: Date | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let signedInLogged = false;
  let lane = Promise.resolve();

  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lane.then(operation, operation);
    lane = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const stop = async (): Promise<void> => {
    if (expiryTimer !== undefined) clearTimer(expiryTimer);
    expiryTimer = undefined;
    const activeContext = context;
    context = undefined;
    page = undefined;
    accountId = undefined;
    expiresAt = undefined;
    signedInLogged = false;
    if (activeContext) {
      await activeContext.close().catch(() => undefined);
      log('stopped');
    }
  };

  const armExpiry = (lifetimeMs: number): void => {
    if (expiryTimer !== undefined) clearTimer(expiryTimer);
    expiresAt = new Date(now().getTime() + lifetimeMs);
    expiryTimer = setTimer(() => void serialized(stop), lifetimeMs);
  };

  const status = async (): Promise<KemerBetProvisionSessionStatus> => {
    if (!context || !page || !accountId || !expiresAt) {
      return { active: false, loginRequired: false, signedIn: false, transferDisabled: true };
    }
    if (now().getTime() >= expiresAt.getTime()) {
      await stop();
      return { active: false, loginRequired: false, signedIn: false, transferDisabled: true };
    }
    const state = validPageUrl(page.url());
    if (!state) return unavailable();
    const signedIn = state === 'agents';
    if (signedIn && !signedInLogged) {
      // The ten-minute deadline protects credential entry only. Once KemerBet confirms
      // authentication, keep this exact locked browser context alive so an Owner-page
      // re-authentication does not discard KemerBet's in-memory authenticated state.
      armExpiry(AUTHENTICATED_SESSION_LIFETIME_MS);
      signedInLogged = true;
      log('signed_in');
    }
    const image = await page.screenshot({ animations: 'disabled', quality: 70, type: 'jpeg' });
    return {
      active: true,
      expiresAt: expiresAt.toISOString(),
      imageBase64: image.toString('base64'),
      imageContentType: 'image/jpeg',
      loginRequired: state === 'login',
      signedIn,
      transferDisabled: true,
    };
  };

  const start = async (input: StartInput): Promise<KemerBetProvisionSessionStatus> => {
    if (context || page || accountId || expiresAt) return unavailable();
    await (
      dependencies.assertBrowserExecutable ??
      (() => assertKemerBetBrowserExecutable({ executablePath: CHROMIUM_PATH }))
    )();
    const profile = await prepareProfile(input.platformAgentAccountId, effectiveUserId);
    const nextContext = await launch(profile, {
      acceptDownloads: false,
      bypassCSP: false,
      // This browser runs inside the dedicated non-root Compose sandbox (read-only root,
      // every Linux capability dropped, no-new-privileges, and an isolated network). The
      // Chromium setuid/user-namespace sandbox cannot initialize under that exact boundary;
      // asking Playwright to enable it makes the private sign-in browser fail before the
      // KemerBet login page opens. Keep the outer container sandbox and do not request the
      // incompatible nested Chromium sandbox.
      chromiumSandbox: false,
      executablePath: CHROMIUM_PATH,
      headless: true,
      ignoreHTTPSErrors: false,
      serviceWorkers: 'block',
      viewport: VIEWPORT,
    });
    const pages = nextContext.pages();
    const nextPage =
      pages.length === 1 ? pages[0] : pages.length === 0 ? await nextContext.newPage() : undefined;
    if (!nextPage) {
      await nextContext.close();
      return unavailable();
    }
    await nextPage.route('**/*', (route) => guardedRoute(route, nextPage));
    await nextPage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (validPageUrl(nextPage.url()) === undefined) {
      await nextContext.close();
      return unavailable();
    }
    context = nextContext;
    page = nextPage;
    accountId = input.platformAgentAccountId;
    armExpiry(LOGIN_LIFETIME_MS);
    log('started');
    return status();
  };

  const input = async (candidate: SessionInput): Promise<KemerBetProvisionSessionStatus> => {
    if (!context || !page || !accountId || !expiresAt || validPageUrl(page.url()) !== 'login') {
      return unavailable();
    }
    if (candidate.kind === 'pointer') {
      await page.mouse.click(candidate.x, candidate.y);
    } else if (NAMED_KEYS.has(candidate.key)) {
      await page.keyboard.press(candidate.key);
    } else {
      await page.keyboard.insertText(candidate.key);
    }
    await page.waitForTimeout(120);
    return status();
  };

  const server = createServer((request, response) => {
    void serialized(async () => {
      try {
        if (request.url === '/healthz' && request.method === 'GET') {
          sendJson(response, 200, { status: 'ok', service: 'kemerbet-session-provision' });
          return;
        }
        if (request.url === '/v1/session' && request.method === 'GET') {
          sendJson(response, 200, await status());
          return;
        }
        if (request.url === '/v1/session/start' && request.method === 'POST') {
          const candidate = validStartInput(await readJson(request));
          if (!candidate) return unavailable();
          sendJson(response, 201, await start(candidate));
          return;
        }
        if (request.url === '/v1/session/input' && request.method === 'POST') {
          const candidate = validSessionInput(await readJson(request));
          if (!candidate) return unavailable();
          sendJson(response, 200, await input(candidate));
          return;
        }
        if (request.url === '/v1/session/stop' && request.method === 'POST') {
          const object = exactObject(await readJson(request), ['requestId']);
          if (typeof object?.requestId !== 'string' || !REQUEST_ID_PATTERN.test(object.requestId)) {
            return unavailable();
          }
          await stop();
          sendJson(response, 200, await status());
          return;
        }
        sendJson(response, 404, { error: 'not_found' });
      } catch {
        if (!response.headersSent) sendJson(response, 503, { error: 'session_unavailable' });
        else response.destroy();
      }
    });
  });

  return {
    server,
    listen: async () => {
      await assertSafeDirectory(CONTROL_ROOT, effectiveUserId);
      await rm(CONTROL_SOCKET, { force: true });
      await new Promise<void>((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(CONTROL_SOCKET, () => {
          server.off('error', reject);
          resolvePromise();
        });
      });
      await chmod(CONTROL_SOCKET, 0o600);
      const socketStat = (await lstat(CONTROL_SOCKET)) as SafeStat;
      if (
        socketStat.isSymbolicLink() ||
        socketStat.uid !== effectiveUserId ||
        (socketStat.mode & 0o777) !== 0o600
      ) {
        await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
        await rm(CONTROL_SOCKET, { force: true });
        unavailable();
      }
    },
    close: async () => {
      await serialized(stop);
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      await rm(CONTROL_SOCKET, { force: true });
    },
  };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const provisionServer = createKemerBetSessionProvisionServer();
  const close = async () => {
    await provisionServer.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  await provisionServer.listen();
  console.info({ component: 'kemerbet_session_provision', event: 'listening' });
}
