import {
  createCustomerWebAuthPort,
  type CustomerWebAuthPort,
  type CustomerWebAuthRequestContext,
} from '@fetanagent/customer-web-auth-runtime';
import {
  CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
  CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
} from '@fetanagent/config/customer-web';
import { describe, expect, it, vi } from 'vitest';

import { buildCustomerWebApp } from './app.js';

const csrfToken = 'A'.repeat(43);
const recoveryCode = 'recovery_code_1234567890';
const publicOrigin = 'https://fetanagent.com';

function fakeAuth(overrides: Partial<CustomerWebAuthPort> = {}): CustomerWebAuthPort {
  return {
    completePasswordRecovery: async () => ({ ok: true, status: 'password_updated' }),
    getCurrentCustomer: async () => ({ ok: true, status: 'anonymous' }),
    requestPasswordRecovery: async () => ({
      ok: true,
      status: 'recovery_request_accepted',
    }),
    signInWithEmailPassword: async () => ({ ok: true, status: 'authenticated' }),
    signOut: async () => ({ ok: true, status: 'signed_out' }),
    signUpWithEmailPassword: async () => ({ ok: true, status: 'authenticated' }),
    ...overrides,
  };
}

function setCookies(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): string[] {
  const value = response.headers['set-cookie'];
  return value === undefined ? [] : Array.isArray(value) ? value : [String(value)];
}

function csrfCookie(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): string {
  const cookie = setCookies(response).find((value) => value.startsWith('__Host-fetanagent-csrf='));
  if (!cookie) throw new Error('CSRF cookie is missing.');
  return cookie.split(';', 1)[0]!;
}

function csrfValue(cookie: string): string {
  return cookie.slice(cookie.indexOf('=') + 1);
}

function form(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function mutationHeaders(cookie: string): Record<string, string> {
  return {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    cookie,
    origin: publicOrigin,
    'sec-fetch-site': 'same-origin',
  };
}

function expectPlainAuthContext(context: CustomerWebAuthRequestContext): void {
  expect(Object.getPrototypeOf(context)).toBe(Object.prototype);
  expect(Reflect.ownKeys(context)).toEqual(['cookies']);
  expect(Object.getPrototypeOf(context.cookies)).toBe(Object.prototype);
  expect(Object.keys(context.cookies).sort()).toEqual([
    'appendResponseHeader',
    'appendSetCookie',
    'readAll',
  ]);
  for (const name of Object.keys(context.cookies)) {
    const descriptor = Object.getOwnPropertyDescriptor(context.cookies, name);
    expect(descriptor).toHaveProperty('value');
    expect(typeof descriptor?.value).toBe('function');
  }
}

describe('customer web SSR and PWA boundary', () => {
  it('serves a responsive public home with strict browser policy and neutral copy', async () => {
    const app = buildCustomerWebApp({ auth: fakeAuth(), csrfTokenFactory: () => csrfToken });
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("form-action 'self'");
    expect(response.headers['content-security-policy']).toContain("worker-src 'self'");
    expect(response.headers['strict-transport-security']).toContain('includeSubDomains');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.body).toContain('Simple account access, wherever you are.');
    expect(response.body).toContain('Create account');
    expect(response.body).toContain('Sign in');

    const forbidden = ['own' + 'er', 'ad' + 'min', 'manual ' + 'verification'];
    for (const term of forbidden) expect(response.body.toLowerCase()).not.toContain(term);
    await app.close();
  });

  it('uses a plain own-data cookie port for every Auth operation', async () => {
    const operations: string[] = [];
    const observe = (operation: string, context: CustomerWebAuthRequestContext): void => {
      expectPlainAuthContext(context);
      operations.push(operation);
    };
    const app = buildCustomerWebApp({
      auth: {
        completePasswordRecovery: async (context) => {
          observe('completePasswordRecovery', context);
          return { ok: true, status: 'password_updated' };
        },
        getCurrentCustomer: async (context) => {
          observe('getCurrentCustomer', context);
          return { ok: true, status: 'anonymous' };
        },
        requestPasswordRecovery: async (context) => {
          observe('requestPasswordRecovery', context);
          return { ok: true, status: 'recovery_request_accepted' };
        },
        signInWithEmailPassword: async (context) => {
          observe('signInWithEmailPassword', context);
          return { ok: true, status: 'authenticated' };
        },
        signOut: async (context) => {
          observe('signOut', context);
          return { ok: true, status: 'signed_out' };
        },
        signUpWithEmailPassword: async (context) => {
          observe('signUpWithEmailPassword', context);
          return { ok: true, status: 'authenticated' };
        },
      },
    });
    const cookie = `__Host-fetanagent-csrf=${csrfToken}`;
    const credentials = form({
      _csrf: csrfToken,
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });

    await app.inject({ method: 'GET', url: '/' });
    await app.inject({
      method: 'POST',
      url: '/create-account',
      headers: mutationHeaders(cookie),
      payload: credentials,
    });
    await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: mutationHeaders(cookie),
      payload: credentials,
    });
    await app.inject({
      method: 'POST',
      url: '/forgot-password',
      headers: mutationHeaders(cookie),
      payload: form({ _csrf: csrfToken, email: 'person@example.com' }),
    });
    await app.inject({
      method: 'POST',
      url: '/update-password',
      headers: mutationHeaders(`${cookie}; __Host-fetanagent-recovery=${recoveryCode}`),
      payload: form({ _csrf: csrfToken, password: 'a-new-long-password' }),
    });
    await app.inject({
      method: 'POST',
      url: '/sign-out',
      headers: mutationHeaders(cookie),
      payload: form({ _csrf: csrfToken }),
    });

    expect(operations).toEqual([
      'getCurrentCustomer',
      'signUpWithEmailPassword',
      'signInWithEmailPassword',
      'requestPasswordRecovery',
      'completePasswordRecovery',
      'signOut',
    ]);
    await app.close();
  });

  it('integrates the real Auth runtime for an anonymous root without network access', async () => {
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', network);
    const auth = createCustomerWebAuthPort({
      enabled: true,
      passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
      supabasePublishableKey: `sb_publishable_${'A'.repeat(32)}`,
      supabaseUrl: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
    });
    const app = buildCustomerWebApp({ auth });
    try {
      const response = await app.inject({ method: 'GET', url: '/' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Simple account access, wherever you are.');
      expect(network).not.toHaveBeenCalled();
    } finally {
      await app.close();
      vi.unstubAllGlobals();
    }
  });

  it('serves health and readiness without touching the Auth port', async () => {
    const getCurrentCustomer = vi.fn<CustomerWebAuthPort['getCurrentCustomer']>();
    const app = buildCustomerWebApp({ auth: fakeAuth({ getCurrentCustomer }) });

    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({
      status: 'ok',
    });
    expect((await app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({
      status: 'ready',
    });
    expect(getCurrentCustomer).not.toHaveBeenCalled();
    await app.close();
  });

  it('marks every account and workspace response no-store', async () => {
    const app = buildCustomerWebApp({
      auth: fakeAuth({
        getCurrentCustomer: async () => ({
          account: { email: 'person@example.com' },
          ok: true,
          status: 'authenticated',
        }),
      }),
      csrfTokenFactory: () => csrfToken,
    });

    for (const url of [
      '/create-account',
      '/sign-in',
      '/forgot-password',
      '/update-password',
      '/workspace',
    ]) {
      const headers =
        url === '/update-password'
          ? { cookie: `__Host-fetanagent-recovery=${recoveryCode}` }
          : undefined;
      const response = await app.inject(
        headers === undefined ? { method: 'GET', url } : { method: 'GET', url, headers },
      );
      expect(response.headers['cache-control'], url).toContain('no-store');
      expect(response.headers.pragma, url).toBe('no-cache');
      expect(response.headers.expires, url).toBe('0');
      expect(response.headers.vary, url).toContain('Cookie');
    }
    await app.close();
  });

  it('keeps the offline page static and free of cookies', async () => {
    const app = buildCustomerWebApp({ auth: fakeAuth() });
    const response = await app.inject({ method: 'GET', url: '/offline' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('You are offline.');
    expect(setCookies(response)).toEqual([]);
    await app.close();
  });

  it('publishes fixed PWA icons and caches only public assets plus the offline page', async () => {
    const app = buildCustomerWebApp({ auth: fakeAuth() });
    const manifestResponse = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    const manifest = manifestResponse.json<{
      icons: { purpose: string; sizes: string; src: string; type: string }[];
    }>();
    expect(manifest.icons).toEqual([
      {
        purpose: 'any',
        sizes: 'any',
        src: '/assets/mark.v1.svg',
        type: 'image/svg+xml',
      },
      {
        purpose: 'any',
        sizes: '192x192',
        src: '/assets/mark-192.v1.png',
        type: 'image/png',
      },
      {
        purpose: 'any',
        sizes: '512x512',
        src: '/assets/mark-512.v1.png',
        type: 'image/png',
      },
      {
        purpose: 'maskable',
        sizes: '192x192',
        src: '/assets/mark-maskable-192.v1.png',
        type: 'image/png',
      },
      {
        purpose: 'maskable',
        sizes: '512x512',
        src: '/assets/mark-maskable-512.v1.png',
        type: 'image/png',
      },
    ]);

    for (const icon of manifest.icons.slice(1)) {
      const response = await app.inject({ method: 'GET', url: icon.src });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain(icon.type);
      expect(response.rawPayload.byteLength).toBeGreaterThan(2_000);
      expect(response.headers['cache-control']).toContain('immutable');
      const expectedSize = Number(icon.sizes.split('x', 1)[0]);
      expect(response.rawPayload.readUInt32BE(16)).toBe(expectedSize);
      expect(response.rawPayload.readUInt32BE(20)).toBe(expectedSize);
    }

    const worker = await app.inject({ method: 'GET', url: '/service-worker.v1.js' });
    expect(worker.headers['cache-control']).toContain('no-cache');
    expect(worker.body).toContain("'/offline'");
    expect(worker.body).toContain("'/assets/mark-maskable-512.v1.png'");
    expect(worker.body).toContain("request.mode === 'navigate'");
    expect(worker.body).toContain("request.method !== 'GET'");
    expect(worker.body).not.toContain('fetch(request).catch');
    for (const privatePath of ['/sign-in', '/create-account', '/workspace', '/update-password']) {
      expect(worker.body).not.toContain(`'${privatePath}'`);
    }
    expect(worker.body).not.toMatch(/addEventListener\(['"](?:sync|push)/u);
    await app.close();
  });

  it('protects the workspace with a server-confirmed current customer', async () => {
    const anonymous = buildCustomerWebApp({ auth: fakeAuth() });
    const denied = await anonymous.inject({ method: 'GET', url: '/workspace' });
    expect(denied.statusCode).toBe(303);
    expect(denied.headers.location).toBe('/sign-in');
    await anonymous.close();

    const authenticated = buildCustomerWebApp({
      auth: fakeAuth({
        getCurrentCustomer: async () => ({
          account: { email: 'safe@example.com<script>' },
          ok: true,
          status: 'authenticated',
        }),
      }),
      csrfTokenFactory: () => csrfToken,
    });
    const allowed = await authenticated.inject({ method: 'GET', url: '/workspace' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain('safe@example.com&lt;script&gt;');
    expect(allowed.body).not.toContain('safe@example.com<script>');
    expect(allowed.body).toContain('Account status');
    expect(allowed.body).toContain('Security');
    await authenticated.close();
  });

  it('sends persistent authenticated visits directly to the workspace', async () => {
    const app = buildCustomerWebApp({
      auth: fakeAuth({
        getCurrentCustomer: async () => ({
          account: { email: 'person@example.com' },
          ok: true,
          status: 'authenticated',
        }),
      }),
    });

    for (const url of ['/', '/sign-in', '/create-account']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(303);
      expect(response.headers.location, url).toBe('/workspace');
      expect(response.headers['cache-control'], url).toContain('private');
      expect(response.headers['cache-control'], url).toContain('no-store');
    }
    await app.close();
  });

  it('fails closed when current-session confirmation is unavailable', async () => {
    const app = buildCustomerWebApp({
      auth: fakeAuth({
        getCurrentCustomer: async () => ({
          error: 'customer_auth_request_failed',
          ok: false,
        }),
      }),
    });

    for (const url of ['/', '/sign-in', '/create-account', '/workspace']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(503);
      expect(response.body, url).toContain('Temporarily unavailable.');
      expect(response.headers['cache-control'], url).toContain('no-store');
    }
    await app.close();
  });

  it('delegates sign-in only after exact same-origin and double-submit CSRF checks', async () => {
    const signIn = vi.fn<CustomerWebAuthPort['signInWithEmailPassword']>(async () => ({
      ok: true,
      status: 'authenticated',
    }));
    const app = buildCustomerWebApp({
      auth: fakeAuth({ signInWithEmailPassword: signIn }),
      csrfTokenFactory: () => csrfToken,
    });
    const page = await app.inject({ method: 'GET', url: '/sign-in' });
    const cookie = csrfCookie(page);
    const response = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: mutationHeaders(cookie),
      payload: form({
        _csrf: csrfValue(cookie),
        email: ' Person@Example.COM ',
        password: 'correct horse battery staple',
      }),
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/workspace');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn.mock.calls[0]?.[1]).toEqual({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });
    await app.close();
  });

  it.each([
    ['missing origin', { origin: undefined }],
    ['wrong origin', { origin: 'https://example.test' }],
    ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['missing fetch metadata', { 'sec-fetch-site': undefined }],
  ])('rejects %s before calling Auth', async (_label, replacements) => {
    const signIn = vi.fn<CustomerWebAuthPort['signInWithEmailPassword']>();
    const app = buildCustomerWebApp({
      auth: fakeAuth({ signInWithEmailPassword: signIn }),
      csrfTokenFactory: () => csrfToken,
    });
    const headers: Record<string, string> = mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`);
    for (const [name, value] of Object.entries(replacements)) {
      if (value === undefined) delete headers[name];
      else headers[name] = value;
    }
    const response = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers,
      payload: form({
        _csrf: csrfToken,
        email: 'person@example.com',
        password: 'correct horse battery staple',
      }),
    });
    expect(response.statusCode).toBe(400);
    expect(signIn).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects mismatched and duplicated CSRF cookies', async () => {
    const signIn = vi.fn<CustomerWebAuthPort['signInWithEmailPassword']>();
    const app = buildCustomerWebApp({ auth: fakeAuth({ signInWithEmailPassword: signIn }) });
    for (const cookie of [
      `__Host-fetanagent-csrf=${'B'.repeat(43)}`,
      `__Host-fetanagent-csrf=${csrfToken}; __Host-fetanagent-csrf=${csrfToken}`,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/sign-in',
        headers: mutationHeaders(cookie),
        payload: form({
          _csrf: csrfToken,
          email: 'person@example.com',
          password: 'correct horse battery staple',
        }),
      });
      expect(response.statusCode).toBe(400);
    }
    expect(signIn).not.toHaveBeenCalled();
    await app.close();
  });

  it('reuses one valid CSRF cookie so another account tab does not invalidate an open form', async () => {
    const signIn = vi.fn<CustomerWebAuthPort['signInWithEmailPassword']>(async () => ({
      ok: true,
      status: 'authenticated',
    }));
    const tokenFactory = vi.fn(() => csrfToken);
    const app = buildCustomerWebApp({
      auth: fakeAuth({ signInWithEmailPassword: signIn }),
      csrfTokenFactory: tokenFactory,
    });
    const firstPage = await app.inject({ method: 'GET', url: '/sign-in' });
    const cookie = csrfCookie(firstPage);
    const secondPage = await app.inject({
      method: 'GET',
      url: '/forgot-password',
      headers: { cookie },
    });
    expect(setCookies(secondPage)).toEqual([]);
    expect(secondPage.body).toContain(`name="_csrf" value="${csrfToken}"`);
    expect(tokenFactory).toHaveBeenCalledTimes(1);

    const submission = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: mutationHeaders(cookie),
      payload: form({
        _csrf: csrfToken,
        email: 'person@example.com',
        password: 'correct horse battery staple',
      }),
    });
    expect(submission.statusCode).toBe(303);
    expect(signIn).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects unsupported, duplicate, and oversized bodies before Auth', async () => {
    const signIn = vi.fn<CustomerWebAuthPort['signInWithEmailPassword']>();
    const app = buildCustomerWebApp({ auth: fakeAuth({ signInWithEmailPassword: signIn }) });
    const baseHeaders = mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`);

    const json = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: { ...baseHeaders, 'content-type': 'application/json' },
      payload: { _csrf: csrfToken, email: 'person@example.com', password: 'long-enough-password' },
    });
    expect(json.statusCode).toBe(400);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: baseHeaders,
      payload: `_csrf=${csrfToken}&email=first%40example.com&email=second%40example.com&password=long-enough-password`,
    });
    expect(duplicate.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: baseHeaders,
      payload: `padding=${'x'.repeat(9_000)}`,
    });
    expect(oversized.statusCode).toBe(413);
    expect(signIn).not.toHaveBeenCalled();
    await app.close();
  });

  it('rate-limits account mutations by route and remote address', async () => {
    let now = 10_000;
    const signIn = vi.fn<CustomerWebAuthPort['signInWithEmailPassword']>(async () => ({
      error: 'customer_auth_request_failed',
      ok: false,
    }));
    const app = buildCustomerWebApp({
      auth: fakeAuth({ signInWithEmailPassword: signIn }),
      now: () => now,
      rateLimit: { maxRequests: 2, windowMs: 10_000 },
    });
    const request = {
      method: 'POST' as const,
      url: '/sign-in',
      headers: mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`),
      payload: form({
        _csrf: csrfToken,
        email: 'person@example.com',
        password: 'correct horse battery staple',
      }),
    };
    expect((await app.inject(request)).statusCode).toBe(400);
    expect((await app.inject(request)).statusCode).toBe(400);
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('10');
    expect(signIn).toHaveBeenCalledTimes(2);

    now += 10_000;
    expect((await app.inject(request)).statusCode).toBe(400);
    expect(signIn).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it('does not consume a rate-limit bucket until mutation security checks pass', async () => {
    const signIn = vi.fn<CustomerWebAuthPort['signInWithEmailPassword']>(async () => ({
      error: 'customer_auth_request_failed',
      ok: false,
    }));
    const app = buildCustomerWebApp({
      auth: fakeAuth({ signInWithEmailPassword: signIn }),
      rateLimit: { maxRequests: 1, windowMs: 10_000 },
    });
    const payload = form({
      _csrf: csrfToken,
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rejected = await app.inject({
        method: 'POST',
        url: '/sign-in',
        headers: {
          ...mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`),
          origin: 'https://example.test',
        },
        payload,
      });
      expect(rejected.statusCode).toBe(400);
    }

    const acceptedForHandling = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`),
      payload,
    });
    expect(acceptedForHandling.statusCode).toBe(400);
    expect(signIn).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('keeps sign-in failures generic and never echoes submitted credentials', async () => {
    const app = buildCustomerWebApp({
      auth: fakeAuth({
        signInWithEmailPassword: async () => ({
          error: 'customer_auth_request_failed',
          ok: false,
        }),
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`),
      payload: form({
        _csrf: csrfToken,
        email: 'private-person@example.com',
        password: 'private-password-value',
      }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('private-person@example.com');
    expect(response.body).not.toContain('private-password-value');
    expect(response.body).not.toContain('customer_auth_request_failed');
    await app.close();
  });

  it('uses one indistinguishable recovery-request receipt', async () => {
    const requestPasswordRecovery = vi.fn<CustomerWebAuthPort['requestPasswordRecovery']>(
      async () => ({ ok: true, status: 'recovery_request_accepted' }),
    );
    const app = buildCustomerWebApp({ auth: fakeAuth({ requestPasswordRecovery }) });
    const response = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      headers: mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`),
      payload: form({ _csrf: csrfToken, email: 'person@example.com' }),
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/forgot-password?sent=1');
    expect(requestPasswordRecovery).toHaveBeenCalledTimes(1);

    const receipt = await app.inject({ method: 'GET', url: '/forgot-password?sent=1' });
    expect(receipt.body).toContain(
      'If the account can use that address, recovery instructions are on the way.',
    );
    await app.close();
  });

  it('moves a valid recovery code directly into a short-lived restricted cookie', async () => {
    const app = buildCustomerWebApp({ auth: fakeAuth() });
    const response = await app.inject({
      method: 'GET',
      url: `/auth/recovery?code=${recoveryCode}`,
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/update-password');
    expect(response.body).toBe('');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    const recoveryCookie = setCookies(response).find((value) =>
      value.startsWith('__Host-fetanagent-recovery='),
    );
    expect(recoveryCookie).toContain(`=${recoveryCode};`);
    expect(recoveryCookie).toContain('Path=/');
    expect(recoveryCookie).toContain('Max-Age=600');
    expect(recoveryCookie).toContain('Secure');
    expect(recoveryCookie).toContain('HttpOnly');
    expect(recoveryCookie).toContain('SameSite=Lax');
    expect(response.headers.location).not.toContain(recoveryCode);
    await app.close();
  });

  it('never renders or accepts a password update without a recovery cookie', async () => {
    const completePasswordRecovery = vi.fn<CustomerWebAuthPort['completePasswordRecovery']>();
    const app = buildCustomerWebApp({
      auth: fakeAuth({ completePasswordRecovery }),
      csrfTokenFactory: () => csrfToken,
    });
    const page = await app.inject({ method: 'GET', url: '/update-password' });
    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toBe('/forgot-password');

    const update = await app.inject({
      method: 'POST',
      url: '/update-password',
      headers: mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`),
      payload: form({ _csrf: csrfToken, password: 'a-new-long-password' }),
    });
    expect(update.statusCode).toBe(400);
    expect(completePasswordRecovery).not.toHaveBeenCalled();
    expect(setCookies(update).some((cookie) => cookie.includes('Max-Age=0'))).toBe(true);
    await app.close();
  });

  it('rejects duplicate recovery cookies without invoking Auth', async () => {
    const completePasswordRecovery = vi.fn<CustomerWebAuthPort['completePasswordRecovery']>();
    const app = buildCustomerWebApp({ auth: fakeAuth({ completePasswordRecovery }) });
    const duplicated = `__Host-fetanagent-csrf=${csrfToken}; __Host-fetanagent-recovery=${recoveryCode}; __Host-fetanagent-recovery=${recoveryCode}`;

    const page = await app.inject({
      method: 'GET',
      url: '/update-password',
      headers: { cookie: duplicated },
    });
    expect(page.statusCode).toBe(303);
    expect(page.headers.location).toBe('/forgot-password');

    const response = await app.inject({
      method: 'POST',
      url: '/update-password',
      headers: mutationHeaders(duplicated),
      payload: form({ _csrf: csrfToken, password: 'a-new-long-password' }),
    });
    expect(response.statusCode).toBe(400);
    expect(completePasswordRecovery).not.toHaveBeenCalled();
    expect(
      setCookies(response).some((cookie) => cookie.startsWith('__Host-fetanagent-recovery=;')),
    ).toBe(true);
    await app.close();
  });

  it('completes recovery atomically and always deletes the one-time code cookie', async () => {
    const completePasswordRecovery = vi.fn<CustomerWebAuthPort['completePasswordRecovery']>(
      async () => ({ ok: true, status: 'password_updated' }),
    );
    const app = buildCustomerWebApp({ auth: fakeAuth({ completePasswordRecovery }) });
    const cookies = `__Host-fetanagent-csrf=${csrfToken}; __Host-fetanagent-recovery=${recoveryCode}`;
    const response = await app.inject({
      method: 'POST',
      url: '/update-password',
      headers: mutationHeaders(cookies),
      payload: form({ _csrf: csrfToken, password: 'a-new-long-password' }),
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/workspace');
    expect(completePasswordRecovery).toHaveBeenCalledTimes(1);
    expect(completePasswordRecovery.mock.calls[0]?.[1]).toEqual({
      code: recoveryCode,
      password: 'a-new-long-password',
    });
    const cleared = setCookies(response).find((cookie) =>
      cookie.startsWith('__Host-fetanagent-recovery=;'),
    );
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('Max-Age=0');
    await app.close();

    const failed = buildCustomerWebApp({
      auth: fakeAuth({
        completePasswordRecovery: async () => ({
          error: 'customer_auth_request_failed',
          ok: false,
        }),
      }),
    });
    const failedResponse = await failed.inject({
      method: 'POST',
      url: '/update-password',
      headers: mutationHeaders(cookies),
      payload: form({ _csrf: csrfToken, password: 'a-new-long-password' }),
    });
    expect(failedResponse.statusCode).toBe(400);
    expect(
      setCookies(failedResponse).some((cookie) =>
        cookie.startsWith('__Host-fetanagent-recovery=;'),
      ),
    ).toBe(true);
    await failed.close();
  });

  it('passes ordered request cookies and preserves every Auth cookie mutation', async () => {
    let cookiesRead: unknown;
    const signIn = async (context: CustomerWebAuthRequestContext) => {
      cookiesRead = context.cookies.readAll();
      context.cookies.appendSetCookie({
        httpOnly: true,
        name: 'fetanagent-session',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: 'first',
      });
      context.cookies.appendSetCookie({
        expires: new Date(0),
        httpOnly: true,
        maxAge: 0,
        name: 'fetanagent-session',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: '',
      });
      context.cookies.appendResponseHeader('vary', 'Cookie');
      return { ok: true as const, status: 'authenticated' as const };
    };
    const app = buildCustomerWebApp({
      auth: fakeAuth({ signInWithEmailPassword: signIn }),
    });
    const requestCookie = `first=one; first=two; __Host-fetanagent-csrf=${csrfToken}`;
    const response = await app.inject({
      method: 'POST',
      url: '/sign-in',
      headers: mutationHeaders(requestCookie),
      payload: form({
        _csrf: csrfToken,
        email: 'person@example.com',
        password: 'correct horse battery staple',
      }),
    });
    expect(cookiesRead).toEqual([
      { name: 'first', value: 'one' },
      { name: 'first', value: 'two' },
      { name: '__Host-fetanagent-csrf', value: csrfToken },
    ]);
    const responseCookies = setCookies(response).filter((cookie) =>
      cookie.startsWith('fetanagent-session='),
    );
    expect(responseCookies).toHaveLength(2);
    expect(responseCookies[0]).toContain('fetanagent-session=first');
    expect(responseCookies[1]).toContain('Max-Age=0');
    expect(response.headers.vary).toContain('Cookie');
    await app.close();
  });

  it('delegates sign-out only through a protected same-origin form', async () => {
    const signOut = vi.fn<CustomerWebAuthPort['signOut']>(async () => ({
      ok: true,
      status: 'signed_out',
    }));
    const app = buildCustomerWebApp({ auth: fakeAuth({ signOut }) });
    const response = await app.inject({
      method: 'POST',
      url: '/sign-out',
      headers: mutationHeaders(`__Host-fetanagent-csrf=${csrfToken}`),
      payload: form({ _csrf: csrfToken }),
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/sign-in?signed-out=1');
    expect(signOut).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
