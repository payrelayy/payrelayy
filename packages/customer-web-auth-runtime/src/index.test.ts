import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionMissingError } from '@supabase/supabase-js';

import {
  CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
  CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  type CustomerWebAuthConfig,
} from '@fetanagent/config/customer-web';

import * as runtime from './index.js';
import type {
  CustomerWebAuthRequestContext,
  CustomerWebAuthResponseHeaderName,
  CustomerWebResponseCookie,
} from './types.js';

const sdk = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: sdk.createServerClient,
}));

const publishableKey = `sb_publishable_${'a'.repeat(22)}_${'b'.repeat(8)}`;
const password = 'correct horse battery staple';
const recoveryCode = 'a_secure_recovery_code_1234567890';
const config: Extract<CustomerWebAuthConfig, { readonly enabled: true }> = {
  enabled: true,
  passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
  supabasePublishableKey: publishableKey,
  supabaseUrl: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
};
const { createCustomerWebAuthPort } = runtime;

const auth = {
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
};

type SsrCookieOptions = {
  readonly cookieEncoding: string;
  readonly cookieOptions: Readonly<Record<string, unknown>>;
  readonly cookies: {
    getAll(): readonly { readonly name: string; readonly value: string }[];
    setAll(
      cookies: readonly {
        readonly name: string;
        readonly options: Readonly<Record<string, unknown>>;
        readonly value: string;
      }[],
      headers: Readonly<Record<string, string>>,
    ): void;
  };
};

function successfulSession() {
  return { data: { session: { access_token: 'never-returned-test-token' } }, error: null };
}

function createContext(
  requestCookies: readonly { readonly name: string; readonly value: string }[] = [],
): {
  readonly appendedCookies: CustomerWebResponseCookie[];
  readonly appendedHeaders: (readonly [CustomerWebAuthResponseHeaderName, string])[];
  readonly context: CustomerWebAuthRequestContext;
} {
  const appendedCookies: CustomerWebResponseCookie[] = [];
  const appendedHeaders: (readonly [CustomerWebAuthResponseHeaderName, string])[] = [];
  return {
    appendedCookies,
    appendedHeaders,
    context: {
      cookies: {
        appendResponseHeader(name, value) {
          appendedHeaders.push([name, value]);
        },
        appendSetCookie(cookie) {
          appendedCookies.push(cookie);
        },
        readAll() {
          return requestCookies;
        },
      },
    },
  };
}

function latestSsrOptions(): SsrCookieOptions {
  const call = sdk.createServerClient.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![2] as SsrCookieOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.signUp.mockResolvedValue(successfulSession());
  auth.signInWithPassword.mockResolvedValue(successfulSession());
  auth.signOut.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  auth.exchangeCodeForSession.mockResolvedValue(successfulSession());
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'not-returned' } }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  sdk.createServerClient.mockReturnValue({ auth });
});

describe('customer web Auth port', () => {
  it('pins the server-only runtime export surface', () => {
    expect(Object.keys(runtime).sort()).toEqual(['createCustomerWebAuthPort']);
  });

  it('creates one server-only Supabase client per operation with strict cookie defaults', async () => {
    const port = createCustomerWebAuthPort(config);
    const { context } = createContext([{ name: 'sb-session', value: 'request-cookie' }]);

    await port.signUpWithEmailPassword(context, { email: 'User@Example.COM', password });
    await port.signInWithEmailPassword(context, { email: 'User@Example.COM', password });
    await port.signOut(context);
    await port.requestPasswordRecovery(context, { email: 'User@Example.COM' });
    await port.completePasswordRecovery(context, {
      code: recoveryCode,
      password: `${password} updated`,
    });
    await port.getCurrentCustomer(context);

    expect(sdk.createServerClient).toHaveBeenCalledTimes(6);
    for (const call of sdk.createServerClient.mock.calls) {
      expect(call[0]).toBe(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN);
      expect(call[1]).toBe(publishableKey);
      const options = call[2] as SsrCookieOptions;
      expect(options.cookieEncoding).toBe('base64url');
      expect(options.cookieOptions).toEqual({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: true,
      });
      expect(options.cookies.getAll()).toEqual([{ name: 'sb-session', value: 'request-cookie' }]);
    }
  });

  it('calls only the narrow Auth SDK methods with normalized inputs and no signup options', async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { email: '  Current.Customer@Example.COM ' } },
      error: null,
    });
    const port = createCustomerWebAuthPort(config);
    const { context } = createContext();

    expect(
      await port.signUpWithEmailPassword(context, {
        email: '  New.Customer@Example.COM ',
        password,
      }),
    ).toEqual({ ok: true, status: 'authenticated' });
    expect(
      await port.signInWithEmailPassword(context, {
        email: '  Existing.Customer@Example.COM ',
        password,
      }),
    ).toEqual({ ok: true, status: 'authenticated' });
    expect(await port.signOut(context)).toEqual({ ok: true, status: 'signed_out' });
    expect(
      await port.requestPasswordRecovery(context, { email: ' Recovery@Example.COM ' }),
    ).toEqual({ ok: true, status: 'recovery_request_accepted' });
    expect(
      await port.completePasswordRecovery(context, {
        code: recoveryCode,
        password: `${password} updated`,
      }),
    ).toEqual({ ok: true, status: 'password_updated' });
    expect(await port.getCurrentCustomer(context)).toEqual({
      account: { email: 'current.customer@example.com' },
      ok: true,
      status: 'authenticated',
    });

    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'new.customer@example.com',
      password,
    });
    expect(auth.signUp.mock.calls[0]).toHaveLength(1);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'existing.customer@example.com',
      password,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('recovery@example.com', {
      redirectTo: 'https://fetanagent.com/auth/recovery',
    });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(recoveryCode);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: `${password} updated` });
    expect(auth.getUser).toHaveBeenCalledOnce();
  });

  it('fails sign-up and sign-in closed and discards non-deletion effects without an immediate session', async () => {
    auth.signUp.mockImplementation(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-signup', options: {}, value: 'must-be-discarded' }],
        { 'Cache-Control': 'private, no-store' },
      );
      return { data: { session: null, user: { id: 'not-returned' } }, error: null };
    });
    auth.signInWithPassword.mockImplementation(async () => {
      latestSsrOptions().cookies.setAll(
        [
          { name: 'sb-session', options: {}, value: 'must-be-discarded' },
          {
            name: 'sb-live-session',
            options: { expires: new Date(0), maxAge: 3600 },
            value: 'must-also-be-discarded',
          },
          { name: 'sb-old-session', options: { maxAge: 0 }, value: '' },
        ],
        { 'Cache-Control': 'private, no-store' },
      );
      return { data: { session: null }, error: null };
    });
    const port = createCustomerWebAuthPort(config);
    const signupState = createContext();
    const signinState = createContext();

    await expect(
      port.signUpWithEmailPassword(signupState.context, {
        email: 'new@example.com',
        password,
      }),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    await expect(
      port.signInWithEmailPassword(signinState.context, {
        email: 'existing@example.com',
        password,
      }),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    expect(signupState.appendedCookies).toEqual([]);
    expect(signupState.appendedHeaders).toEqual([]);
    expect(signinState.appendedCookies).toEqual([
      {
        httpOnly: true,
        maxAge: 0,
        name: 'sb-old-session',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: '',
      },
    ]);
    expect(signinState.appendedHeaders).toEqual([['cache-control', 'private, no-store']]);
  });

  it('enforces the exact 12 through 128 character password boundary', async () => {
    const port = createCustomerWebAuthPort(config);

    await expect(
      port.signUpWithEmailPassword(createContext().context, {
        email: 'customer@example.com',
        password: 'a'.repeat(11),
      }),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    await expect(
      port.signUpWithEmailPassword(createContext().context, {
        email: 'customer@example.com',
        password: 'a'.repeat(12),
      }),
    ).resolves.toEqual({ ok: true, status: 'authenticated' });
    await expect(
      port.signUpWithEmailPassword(createContext().context, {
        email: 'customer@example.com',
        password: 'a'.repeat(128),
      }),
    ).resolves.toEqual({ ok: true, status: 'authenticated' });
    await expect(
      port.signUpWithEmailPassword(createContext().context, {
        email: 'customer@example.com',
        password: 'a'.repeat(129),
      }),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    expect(auth.signUp).toHaveBeenCalledTimes(2);
  });

  it('appends duplicate cookie mutations, preserves deletion expiry, and hardens every cookie', async () => {
    const port = createCustomerWebAuthPort(config);
    const state = createContext();
    const expires = new Date('2026-08-16T00:00:00.000Z');
    const deletedAt = new Date(0);
    auth.getUser.mockImplementation(async () => {
      latestSsrOptions().cookies.setAll(
        [
          {
            name: 'sb-session',
            options: {
              domain: 'attacker.example',
              expires,
              httpOnly: false,
              maxAge: 3600,
              path: '/unsafe',
              sameSite: 'none',
              secure: false,
            },
            value: 'rotated-cookie',
          },
          {
            name: 'sb-session',
            options: { domain: 'attacker.example', expires: deletedAt, maxAge: 0 },
            value: '',
          },
        ],
        {
          'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
          Expires: '0',
          Pragma: 'no-cache',
          Vary: 'Cookie',
          'X-Untrusted': 'must-not-propagate',
        },
      );
      return { data: { user: null }, error: null };
    });

    await port.getCurrentCustomer(state.context);

    expect(state.appendedCookies).toEqual([
      {
        expires,
        httpOnly: true,
        maxAge: 3600,
        name: 'sb-session',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: 'rotated-cookie',
      },
      {
        expires: deletedAt,
        httpOnly: true,
        maxAge: 0,
        name: 'sb-session',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: '',
      },
    ]);
    expect(state.appendedCookies.every((cookie) => !Object.hasOwn(cookie, 'domain'))).toBe(true);
    expect(state.appendedHeaders).toEqual([
      ['cache-control', 'private, no-cache, no-store, must-revalidate, max-age=0'],
      ['expires', '0'],
      ['pragma', 'no-cache'],
      ['vary', 'Cookie'],
    ]);
  });

  it('adds a private no-store response header if an SSR mutation omits it', async () => {
    const port = createCustomerWebAuthPort(config);
    const state = createContext();
    auth.getUser.mockImplementation(async () => {
      latestSsrOptions().cookies.setAll([], { Pragma: 'no-cache' });
      return { data: { user: null }, error: null };
    });

    await port.getCurrentCustomer(state.context);

    expect(state.appendedHeaders).toEqual([
      ['pragma', 'no-cache'],
      ['cache-control', 'private, no-store'],
    ]);
  });

  it('returns one generic recovery response for existing, missing, invalid, and failed requests', async () => {
    const port = createCustomerWebAuthPort(config);
    const expected = { ok: true, status: 'recovery_request_accepted' };
    const existingState = createContext();
    const missingState = createContext();
    const networkState = createContext();

    auth.resetPasswordForEmail.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-pkce', options: {}, value: 'existing-verifier' }],
        { 'Cache-Control': 'private, no-store' },
      );
      return { data: {}, error: null };
    });

    await expect(
      port.requestPasswordRecovery(existingState.context, { email: 'known@example.com' }),
    ).resolves.toEqual(expected);
    auth.resetPasswordForEmail.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-pkce', options: {}, value: 'missing-verifier' }],
        { Pragma: 'no-cache' },
      );
      return { data: null, error: new Error('unknown account') };
    });
    await expect(
      port.requestPasswordRecovery(missingState.context, { email: 'missing@example.com' }),
    ).resolves.toEqual(expected);
    auth.resetPasswordForEmail.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-pkce', options: {}, value: 'network-verifier' }],
        { 'Cache-Control': 'private, no-store' },
      );
      throw new Error('network unavailable');
    });
    await expect(
      port.requestPasswordRecovery(networkState.context, { email: 'network@example.com' }),
    ).resolves.toEqual(expected);
    await expect(
      port.requestPasswordRecovery(createContext().context, { email: 'not-an-email' }),
    ).resolves.toEqual(expected);

    expect(existingState.appendedCookies).toHaveLength(1);
    expect(missingState.appendedCookies).toHaveLength(1);
    expect(networkState.appendedCookies).toHaveLength(1);
    expect(missingState.appendedHeaders).toEqual([
      ['pragma', 'no-cache'],
      ['cache-control', 'private, no-store'],
    ]);
  });

  it('completes recovery atomically with one client and commits only after password update', async () => {
    const port = createCustomerWebAuthPort(config);
    const successState = createContext();
    auth.exchangeCodeForSession.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-session', options: {}, value: 'exchange-cookie' }],
        { 'Cache-Control': 'private, no-store' },
      );
      return successfulSession();
    });
    auth.updateUser.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-session', options: {}, value: 'updated-cookie' }],
        { Vary: 'Cookie' },
      );
      return { data: { user: { id: 'not-returned' } }, error: null };
    });

    await expect(
      port.completePasswordRecovery(successState.context, {
        code: recoveryCode,
        password: `${password} updated`,
      }),
    ).resolves.toEqual({ ok: true, status: 'password_updated' });
    expect(sdk.createServerClient).toHaveBeenCalledOnce();
    expect(successState.appendedCookies.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: 'sb-session', value: 'exchange-cookie' },
      { name: 'sb-session', value: 'updated-cookie' },
    ]);

    vi.clearAllMocks();
    sdk.createServerClient.mockReturnValue({ auth });
    auth.exchangeCodeForSession.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-session', options: {}, value: 'must-be-discarded' }],
        { 'Cache-Control': 'private, no-store' },
      );
      return successfulSession();
    });
    auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const failedState = createContext();

    await expect(
      port.completePasswordRecovery(failedState.context, {
        code: recoveryCode,
        password: `${password} replacement`,
      }),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    expect(failedState.appendedCookies).toEqual([]);
    expect(failedState.appendedHeaders).toEqual([]);
  });

  it('does not update a password or commit effects when recovery-code exchange fails', async () => {
    auth.exchangeCodeForSession.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-session', options: {}, value: 'must-be-discarded' }],
        { 'Cache-Control': 'private, no-store' },
      );
      return { data: { session: null }, error: new Error('invalid or used code') };
    });
    const state = createContext();

    await expect(
      createCustomerWebAuthPort(config).completePasswordRecovery(state.context, {
        code: recoveryCode,
        password: `${password} replacement`,
      }),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(state.appendedCookies).toEqual([]);
    expect(state.appendedHeaders).toEqual([]);
  });

  it('commits sign-out deletions and only deletions from failed server authorization', async () => {
    auth.signOut.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [{ name: 'sb-session', options: { maxAge: 0 }, value: '' }],
        { 'Cache-Control': 'private, no-store' },
      );
      return { error: null };
    });
    const signoutState = createContext();
    await expect(createCustomerWebAuthPort(config).signOut(signoutState.context)).resolves.toEqual({
      ok: true,
      status: 'signed_out',
    });
    expect(signoutState.appendedCookies).toHaveLength(1);
    expect(signoutState.appendedCookies[0]?.maxAge).toBe(0);

    auth.getUser.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [
          { name: 'sb-live', options: { maxAge: 3600 }, value: 'discard-me' },
          { name: 'sb-expired', options: { expires: new Date(0) }, value: 'old' },
        ],
        { 'Cache-Control': 'private, no-store' },
      );
      return { data: { user: null }, error: new Error('invalid session') };
    });
    const currentState = createContext();
    await expect(
      createCustomerWebAuthPort(config).getCurrentCustomer(currentState.context),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    expect(currentState.appendedCookies.map(({ name }) => name)).toEqual(['sb-expired']);
  });

  it('uses getUser rather than getSession and returns anonymous without a server-confirmed user', async () => {
    const guardedAuth = new Proxy(auth, {
      get(target, property, receiver) {
        if (property === 'getSession') throw new Error('getSession must not authorize workspace');
        return Reflect.get(target, property, receiver);
      },
    });
    sdk.createServerClient.mockReturnValue({ auth: guardedAuth });
    const port = createCustomerWebAuthPort(config);

    await expect(port.getCurrentCustomer(createContext().context)).resolves.toEqual({
      ok: true,
      status: 'anonymous',
    });
    expect(auth.getUser).toHaveBeenCalledOnce();
  });

  it('maps only the real missing-session Auth error with a null user to anonymous', async () => {
    auth.getUser.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll(
        [
          { name: 'sb-unexpected-live', options: { maxAge: 3600 }, value: 'discard-me' },
          { name: 'sb-missing-session', options: { maxAge: 0 }, value: '' },
        ],
        { 'Cache-Control': 'private, no-store' },
      );
      return { data: { user: null }, error: new AuthSessionMissingError() };
    });
    const port = createCustomerWebAuthPort(config);
    const anonymousState = createContext();

    await expect(port.getCurrentCustomer(anonymousState.context)).resolves.toEqual({
      ok: true,
      status: 'anonymous',
    });
    expect(anonymousState.appendedCookies.map(({ name }) => name)).toEqual(['sb-missing-session']);

    auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('upstream unavailable'),
    });
    await expect(port.getCurrentCustomer(createContext().context)).resolves.toEqual({
      error: 'customer_auth_request_failed',
      ok: false,
    });
  });

  it('does not log or return passwords, tokens, or submitted email addresses on failures', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];
    auth.signInWithPassword.mockRejectedValue(new Error('contains sensitive upstream detail'));
    const port = createCustomerWebAuthPort(config);
    const email = 'private.customer@example.com';
    const result = await port.signInWithEmailPassword(createContext().context, {
      email,
      password,
    });

    expect(result).toEqual({ error: 'customer_auth_request_failed', ok: false });
    expect(JSON.stringify(result)).not.toMatch(
      new RegExp(`${email}|${password}|never-returned-test-token`, 'u'),
    );
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it('fails closed on hostile, accessor, duplicate, or malformed cookie-port inputs', async () => {
    const port = createCustomerWebAuthPort(config);
    const failure = { error: 'customer_auth_request_failed', ok: false };
    const accessorCookie = Object.defineProperties(
      {},
      {
        name: {
          enumerable: true,
          get() {
            throw new Error('cookie name accessor executed');
          },
        },
        value: { enumerable: true, value: 'value' },
      },
    );
    const customPrototypePort = Object.assign(Object.create({ adapter: 'custom' }), {
      appendResponseHeader() {},
      appendSetCookie() {},
      readAll() {
        return [];
      },
    });
    const hostileContexts = [
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('context proxy trap');
          },
        },
      ),
      { cookies: customPrototypePort },
      createContext([accessorCookie as { name: string; value: string }]).context,
      createContext([
        { name: 'sb-session', value: 'one' },
        { name: 'sb-session', value: 'two' },
      ]).context,
      createContext([{ name: 'sb-session', value: 'bad\r\nvalue' }]).context,
    ];

    for (const hostileContext of hostileContexts) {
      await expect(
        port.signInWithEmailPassword(hostileContext as CustomerWebAuthRequestContext, {
          email: 'customer@example.com',
          password,
        }),
      ).resolves.toEqual(failure);
    }
  });

  it('rejects hostile, accessor-backed, and extra authentication fields before SDK use', async () => {
    const port = createCustomerWebAuthPort(config);
    const failure = { error: 'customer_auth_request_failed', ok: false };
    const hostileInput = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('input proxy trap');
        },
      },
    );
    const accessorInput = Object.defineProperties(
      {},
      {
        email: {
          enumerable: true,
          get() {
            throw new Error('email accessor executed');
          },
        },
        password: { enumerable: true, value: password },
      },
    );

    await expect(
      port.signInWithEmailPassword(createContext().context, hostileInput as never),
    ).resolves.toEqual(failure);
    await expect(
      port.signUpWithEmailPassword(createContext().context, accessorInput as never),
    ).resolves.toEqual(failure);
    await expect(
      port.signUpWithEmailPassword(createContext().context, {
        email: 'customer@example.com',
        password,
        role: 'admin',
      } as never),
    ).resolves.toEqual(failure);
    await expect(
      port.completePasswordRecovery(createContext().context, {
        code: recoveryCode,
        password,
        session: 'client-forged',
      } as never),
    ).resolves.toEqual(failure);
    expect(sdk.createServerClient).not.toHaveBeenCalled();
  });

  it('fails closed without committing hostile SDK response mutations', async () => {
    const hostileCookie = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('outgoing cookie proxy trap');
        },
      },
    );
    auth.signInWithPassword.mockImplementationOnce(async () => {
      latestSsrOptions().cookies.setAll([hostileCookie as never], {
        'Cache-Control': 'private, no-store',
      });
      return successfulSession();
    });
    const state = createContext();

    await expect(
      createCustomerWebAuthPort(config).signInWithEmailPassword(state.context, {
        email: 'customer@example.com',
        password,
      }),
    ).resolves.toEqual({ error: 'customer_auth_request_failed', ok: false });
    expect(state.appendedCookies).toEqual([]);
    expect(state.appendedHeaders).toEqual([]);
  });

  it('contains no browser storage, privileged key, database, Telegram, financial, or logging path', async () => {
    const [authSource, cookieSource, serverSource] = await Promise.all([
      readFile(new URL('./auth-port.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cookies.ts', import.meta.url), 'utf8'),
      readFile(new URL('./server-client.ts', import.meta.url), 'utf8'),
    ]);
    const productionSource = `${authSource}\n${cookieSource}\n${serverSource}`;

    expect(productionSource).not.toMatch(
      /createBrowserClient|localStorage|sessionStorage|service[_-]?role|sb_secret_|SUPABASE_SECRET|SUPABASE_SERVICE|\.from\s*\(|\.rpc\s*\(|postgres|database|telegram|kemerbet|deposit|withdraw|payment|financial|admin|\bconsole\.|\blogger\.|getSession\s*\(|\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|\bEventSource\b|process\.getBuiltinModule/iu,
    );
    expect(serverSource).toMatch(/\bcreateServerClient\s*\(/u);
  });
});
