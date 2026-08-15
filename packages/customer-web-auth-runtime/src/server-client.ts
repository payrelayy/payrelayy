import { createServerClient } from '@supabase/ssr';

import type { CustomerWebAuthConfig } from '@fetanagent/config/customer-web';

import { appendResponseEffects, readRequestCookies } from './cookies.js';
import type { CustomerWebAuthRequestContext } from './types.js';

type EnabledCustomerWebAuthConfig = Extract<CustomerWebAuthConfig, { readonly enabled: true }>;

type AuthResult<Data> = Promise<{
  readonly data: Data;
  readonly error: unknown | null;
}>;

export interface CustomerWebServerClient {
  readonly auth: {
    exchangeCodeForSession(code: string): AuthResult<{ readonly session: unknown | null }>;
    getUser(): AuthResult<{
      readonly user: { readonly email?: string } | null;
    }>;
    resetPasswordForEmail(
      email: string,
      options: { readonly redirectTo: string },
    ): AuthResult<unknown>;
    signInWithPassword(credentials: {
      readonly email: string;
      readonly password: string;
    }): AuthResult<{ readonly session: unknown | null }>;
    signOut(options: { readonly scope: 'local' }): Promise<{ readonly error: unknown | null }>;
    signUp(credentials: {
      readonly email: string;
      readonly password: string;
    }): AuthResult<{ readonly session: unknown | null }>;
    updateUser(attributes: {
      readonly password: string;
    }): AuthResult<{ readonly user: unknown | null }>;
  };
}

export function createCustomerWebServerClient(
  config: EnabledCustomerWebAuthConfig,
  context: CustomerWebAuthRequestContext,
): CustomerWebServerClient {
  const requestCookies = readRequestCookies(context);
  return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookieEncoding: 'base64url',
    cookieOptions: {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
    },
    cookies: {
      getAll() {
        return [...requestCookies];
      },
      setAll(cookiesToSet, headers) {
        appendResponseEffects(context, cookiesToSet, headers);
      },
    },
  }) as unknown as CustomerWebServerClient;
}
