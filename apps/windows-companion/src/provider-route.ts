import type { APIResponse, BrowserContext, Route } from 'playwright-core';

import {
  decideLocalKemerBetRequest,
  isLocalKemerBetProviderUrl,
  type LocalKemerBetGuardPhase,
} from './request-guard.js';

type BlockReason = 'mutation_attempt_blocked' | 'provider_request_failed';

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escaped[character] ?? '';
  });
}

/** Forward locally without allowing an approved request to redirect to an unapproved operation. */
async function forwardProviderRequest(
  route: Route,
  phase: () => LocalKemerBetGuardPhase,
  reportBlocked: (reason: BlockReason) => void,
  allowNavigationRedirect: () => boolean,
  resetNavigationRedirects: () => void,
): Promise<void> {
  const request = route.request();
  const method = request.method();
  const originalUrl = new URL(request.url());
  let targetUrl = originalUrl;
  let response: APIResponse | undefined;
  const deadline = Date.now() + 30_000;
  const abort = async (reason: BlockReason): Promise<void> => {
    await route.abort('blockedbyclient').catch(() => undefined);
    reportBlocked(reason);
  };

  try {
    // Inspect only these non-secret override headers; never read the credential body or auth headers.
    for (const name of ['x-http-method-override', 'x-http-method', 'x-method-override']) {
      if ((await request.headerValue(name)) !== null) {
        await abort('mutation_attempt_blocked');
        return;
      }
    }
    for (let hop = 0; hop < 5; hop += 1) {
      if (decideLocalKemerBetRequest(method, targetUrl.href, phase()).action !== 'allow') {
        await abort('mutation_attempt_blocked');
        return;
      }
      const timeout = deadline - Date.now();
      if (timeout <= 0) {
        await abort('provider_request_failed');
        return;
      }
      // route.continue() does not re-run routing for redirect hops. No redirect or network retry
      // is automatic here, including a 307/308 after a permitted login or session refresh POST.
      // Payload forwarding happens only on this Windows device, not through a FetanAgent server.
      response = await route.fetch({
        url: targetUrl.href,
        maxRedirects: 0,
        maxRetries: 0,
        timeout,
      });
      const status = response.status();
      if (status >= 300 && status < 400 && status !== 304) {
        if (method !== 'GET' && method !== 'HEAD') {
          await abort('mutation_attempt_blocked');
          return;
        }
        const location = response.headers()['location'];
        if (!location) {
          await abort('provider_request_failed');
          return;
        }
        const next = new URL(location, targetUrl);
        // Cross-origin redirects must never forward private provider headers to another host.
        if (next.origin !== originalUrl.origin || !isLocalKemerBetProviderUrl(next)) {
          await abort('mutation_attempt_blocked');
          return;
        }
        if (decideLocalKemerBetRequest(method, next.href, phase()).action !== 'allow') {
          await abort('mutation_attempt_blocked');
          return;
        }
        if (request.isNavigationRequest()) {
          if (!allowNavigationRedirect()) {
            await abort('provider_request_failed');
            return;
          }
          // Forwarding a redirect's final HTML under the original URL breaks provider login
          // routing. A local meta navigation preserves the address and starts a NEW guarded
          // browser request, instead of an HTTP redirect hop that bypasses Playwright routing.
          await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
            body: `<!doctype html><meta http-equiv="refresh" content="0;url=${escapeHtmlAttribute(next.href)}"><title>Opening KemerBet</title>`,
          });
          return;
        }
        await response.dispose();
        response = undefined;
        targetUrl = next;
        continue;
      }
      // The library forwards the response bytes unchanged. No body is parsed, logged, or saved
      // by application code, and the transient API response buffer is disposed immediately.
      await route.fulfill({ response });
      if (request.isNavigationRequest()) resetNavigationRedirects();
      return;
    }
    await abort('provider_request_failed');
  } catch {
    // Exceptions can contain request metadata. Only the fixed reason is ever reported.
    await abort('provider_request_failed');
  } finally {
    await response?.dispose().catch(() => undefined);
  }
}

export async function installProviderMutationBoundary(
  context: BrowserContext,
  phase: () => LocalKemerBetGuardPhase,
  reportBlocked: (reason: BlockReason) => void,
): Promise<void> {
  // Chrome starts offline; context-wide routing covers initial popup, iframe, and worker
  // requests, with service workers disabled. Unrelated CAPTCHA traffic stays in Chrome.
  let navigationRedirects = 0;
  await context.route(isLocalKemerBetProviderUrl, (route) =>
    forwardProviderRequest(
      route,
      phase,
      reportBlocked,
      () => ++navigationRedirects <= 5,
      () => {
        navigationRedirects = 0;
      },
    ),
  );
}
