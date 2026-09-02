import { createServer, type Server } from 'node:http';

import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ origin: '' }));
vi.mock('./request-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./request-guard.js')>();
  return {
    ...actual,
    isLocalKemerBetProviderUrl: (url: URL) => url.origin === fixture.origin,
    decideLocalKemerBetRequest: (
      method: string,
      rawUrl: string,
      phase: import('./request-guard.js').LocalKemerBetGuardPhase,
    ) => {
      const url = new URL(rawUrl);
      if (url.origin !== fixture.origin) return { action: 'abort', reason: 'invalid_transport' };
      const mappedOrigin =
        url.pathname === '/'
          ? 'https://agentsystem.admindigi.com'
          : 'https://admin-api.agt-digi.com';
      return actual.decideLocalKemerBetRequest(
        method,
        `${mappedOrigin}${url.pathname}${url.search}`,
        phase,
      );
    },
  };
});

import { installProviderMutationBoundary } from './provider-route.js';

describe.skipIf(process.platform !== 'win32')(
  'provider boundary in real Windows Chrome (loopback only)',
  () => {
    let server: Server;
    let browser: Browser;
    let context: BrowserContext | undefined;
    let financialRequests = 0;
    let loginRequests = 0;

    beforeAll(async () => {
      server = createServer((request, response) => {
        if (request.url === '/') {
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end('<!doctype html><title>Local regression fixture</title>');
          return;
        }
        if (request.url === '/Wallet/PlayerEPOSDeposit') {
          financialRequests += 1;
          response.writeHead(200);
          response.end('forbidden fixture endpoint');
          return;
        }
        if (request.url === '/Account/Login' && request.method === 'POST') {
          loginRequests += 1;
          request.resume();
          const redirect = request.headers['x-fixture-redirect'];
          if (redirect === '307' || redirect === '308') {
            response.writeHead(Number(redirect), { location: '/Wallet/PlayerEPOSDeposit' });
            response.end();
          } else {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ fixture: 'nonsecret-login-response' }));
          }
          return;
        }
        response.writeHead(404);
        response.end();
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Loopback fixture did not start');
      fixture.origin = `http://127.0.0.1:${address.port}`;
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    }, 30_000);

    afterEach(async () => {
      await context?.close();
      context = undefined;
    });

    afterAll(async () => {
      await browser?.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    async function startFixture() {
      financialRequests = 0;
      loginRequests = 0;
      const blocked: string[] = [];
      context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
      // A separate catch-all guarantees this test cannot contact a real provider or other host.
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === fixture.origin
          ? route.fallback()
          : route.abort('blockedbyclient'),
      );
      await installProviderMutationBoundary(
        context,
        () => 'manual_login',
        (reason) => blocked.push(reason),
      );
      await context.setOffline(false);
      const page = await context.newPage();
      await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
      return { page, blocked };
    }

    it.each([307, 308])(
      'aborts login POST %s before its financial redirect and keeps Chrome open',
      async (status) => {
        const { page, blocked } = await startFixture();
        const result = await page.evaluate(async (redirect) => {
          try {
            await fetch('/Account/Login', {
              method: 'POST',
              headers: { 'x-fixture-redirect': String(redirect) },
              body: 'nonsecret-regression-fixture',
            });
            return 'unexpected-success';
          } catch {
            return 'aborted';
          }
        }, status);
        expect(result).toBe('aborted');
        expect(loginRequests).toBe(1);
        expect(financialRequests).toBe(0);
        expect(blocked).toContain('mutation_attempt_blocked');
        expect(page.isClosed()).toBe(false);
        expect(await page.title()).toBe('Local regression fixture');
      },
      15_000,
    );

    it('fulfills the unchanged nonsecret 200 login response back into browser fetch', async () => {
      const { page, blocked } = await startFixture();
      const result = await page.evaluate(async () => {
        const response = await fetch('/Account/Login', {
          method: 'POST',
          body: 'nonsecret-regression-fixture',
        });
        return { status: response.status, body: await response.json() };
      });
      expect(result).toEqual({ status: 200, body: { fixture: 'nonsecret-login-response' } });
      expect(loginRequests).toBe(1);
      expect(financialRequests).toBe(0);
      expect(blocked).toEqual([]);
      expect(page.isClosed()).toBe(false);
    }, 15_000);
  },
);
