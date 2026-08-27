import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { chromium, type BrowserContext, type Page } from 'playwright-core';

import { closeKemerBetPersistentBrowserForRestorableCheckpoint } from './kemerbet-persistent-browser-checkpoint.js';

const CHROMIUM_PATH = '/usr/bin/chromium';
const EFFECTIVE_USER_ID = 10_001;
const RESTORE_TIMEOUT_MS = 15_000;
const SUCCESS_OUTPUT = 'KEMERBET_PERSISTENT_BROWSER_CHECKPOINT_SMOKE_OK';
const FAILURE_OUTPUT = 'KEMERBET_PERSISTENT_BROWSER_CHECKPOINT_SMOKE_FAILED';
const SENTINEL_KEY = 'fetanagent_checkpoint_smoke';
const SENTINEL_VALUE = 'opaque-v10-session-continuity';

const CHROMIUM_NETWORK_REDUCTION_ARGUMENTS = Object.freeze([
  '--disable-quic',
  '--dns-prefetch-disable',
  '--disable-features=NetworkPrediction,PreconnectToSearch,SpeculationRulesPrefetchFuture,WebTransport',
  '--disable-network-prediction',
  '--disable-preconnect',
  '--disable-webrtc',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
] as const);

function unavailable(): never {
  throw new Error(FAILURE_OUTPUT);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') unavailable();
  return (address as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise());
    server.closeAllConnections();
  });
}

async function waitForRestoredSmokePage(
  context: BrowserContext,
  expectedUrl: string,
): Promise<Page> {
  const startedAt = Date.now();
  let pages = context.pages();
  if (pages.length > 1) unavailable();
  let page = pages[0];
  if (page === undefined) {
    page = await context.waitForEvent('page', { timeout: RESTORE_TIMEOUT_MS }).catch(unavailable);
  }
  const remainingMs = Math.max(1, RESTORE_TIMEOUT_MS - (Date.now() - startedAt));
  await page
    .waitForURL(expectedUrl, { timeout: remainingMs, waitUntil: 'commit' })
    .catch(unavailable);
  pages = context.pages();
  if (pages.length !== 1 || pages[0] !== page || page.url() !== expectedUrl) unavailable();
  return page;
}

async function runSmoke(): Promise<void> {
  if (process.getuid?.() !== EFFECTIVE_USER_ID || process.getgid?.() !== EFFECTIVE_USER_ID) {
    unavailable();
  }

  const profilePath = await mkdtemp(join(tmpdir(), 'fetanagent-checkpoint-smoke-'));
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/agents') {
      response.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><title>checkpoint smoke</title>');
  });

  let firstContext: BrowserContext | null = null;
  let restoredContext: BrowserContext | null = null;
  try {
    const port = await listen(server);
    const expectedUrl = `http://127.0.0.1:${port}/agents`;
    firstContext = await chromium.launchPersistentContext(profilePath, {
      args: [...CHROMIUM_NETWORK_REDUCTION_ARGUMENTS],
      chromiumSandbox: false,
      executablePath: CHROMIUM_PATH,
      headless: true,
      serviceWorkers: 'block',
    });
    let page = firstContext.pages()[0];
    if (page === undefined) page = await firstContext.newPage();
    await page.goto(expectedUrl, { timeout: RESTORE_TIMEOUT_MS, waitUntil: 'load' });
    await page.evaluate(
      ([key, value]) => {
        const browserGlobal = globalThis as unknown as {
          sessionStorage: { setItem(itemKey: string, itemValue: string): void };
        };
        browserGlobal.sessionStorage.setItem(key, value);
      },
      [SENTINEL_KEY, SENTINEL_VALUE] as const,
    );
    await closeKemerBetPersistentBrowserForRestorableCheckpoint({
      context: firstContext,
      effectiveUserId: EFFECTIVE_USER_ID,
      page,
      profilePath,
    });
    firstContext = null;

    restoredContext = await chromium.launchPersistentContext(profilePath, {
      args: ['--restore-last-session', ...CHROMIUM_NETWORK_REDUCTION_ARGUMENTS],
      chromiumSandbox: false,
      executablePath: CHROMIUM_PATH,
      headless: true,
      ignoreDefaultArgs: ['about:blank'],
      offline: true,
      serviceWorkers: 'block',
    });
    page = await waitForRestoredSmokePage(restoredContext, expectedUrl);
    const retained = await page.evaluate(
      ([key, value]) => {
        const browserGlobal = globalThis as unknown as {
          sessionStorage: { getItem(itemKey: string): string | null };
        };
        return browserGlobal.sessionStorage.getItem(key) === value;
      },
      [SENTINEL_KEY, SENTINEL_VALUE] as const,
    );
    if (retained !== true) unavailable();
    await closeKemerBetPersistentBrowserForRestorableCheckpoint({
      context: restoredContext,
      effectiveUserId: EFFECTIVE_USER_ID,
      page,
      profilePath,
    });
    restoredContext = null;
  } finally {
    await firstContext?.close().catch(() => undefined);
    await restoredContext?.close().catch(() => undefined);
    await closeServer(server).catch(() => undefined);
  }
}

runSmoke().then(
  () => console.log(SUCCESS_OUTPUT),
  () => {
    console.error(FAILURE_OUTPUT);
    process.exitCode = 1;
  },
);
