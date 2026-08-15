import {
  CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
  CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  type CustomerWebAuthConfig,
} from '@fetanagent/config/customer-web';
import { isAuthSessionMissingError } from '@supabase/supabase-js';

import { createCustomerWebResponseEffectTransaction } from './cookies.js';
import { createCustomerWebServerClient } from './server-client.js';
import type {
  CustomerWebAuthActionResult,
  CustomerWebAuthFailure,
  CustomerWebAuthPort,
  CustomerWebAuthRequestContext,
  CustomerWebCurrentCustomerResult,
  CustomerWebEmailInput,
  CustomerWebEmailPasswordInput,
  CustomerWebPasswordRecoveryInput,
} from './types.js';

type EnabledCustomerWebAuthConfig = Extract<CustomerWebAuthConfig, { readonly enabled: true }>;

const GENERIC_FAILURE: CustomerWebAuthFailure = Object.freeze({
  error: 'customer_auth_request_failed',
  ok: false,
});
const RECOVERY_REQUEST_ACCEPTED = Object.freeze({
  ok: true as const,
  status: 'recovery_request_accepted' as const,
});

type DataRecord = Readonly<Record<string, unknown>>;

function readDataRecord(value: unknown): DataRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new Error();
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error();
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    throw new Error();
  }
}

function readExactStringInput(input: unknown, key: string): string {
  const record = readDataRecord(input);
  if (Object.keys(record).length !== 1 || typeof record[key] !== 'string') throw new Error();
  return record[key];
}

function normalizeEmail(input: unknown): string {
  const email = readExactStringInput(input, 'email').trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    /[\u0000-\u001f\u007f]/u.test(email)
  ) {
    throw new Error();
  }
  return email;
}

function normalizeAuthUserId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  ) {
    throw new Error();
  }
  return value;
}

function readPassword(input: unknown): string {
  const password = readExactStringInput(input, 'password');
  if (password.length < 12 || password.length > 128 || /[\u0000]/u.test(password)) {
    throw new Error();
  }
  return password;
}

function readEmailPassword(input: unknown): { readonly email: string; readonly password: string } {
  const record = readDataRecord(input);
  if (
    Object.keys(record).sort().join(',') !== 'email,password' ||
    typeof record.email !== 'string' ||
    typeof record.password !== 'string'
  ) {
    throw new Error();
  }
  return {
    email: normalizeEmail({ email: record.email }),
    password: readPassword({ password: record.password }),
  };
}

function readPasswordRecovery(input: unknown): {
  readonly code: string;
  readonly password: string;
} {
  const record = readDataRecord(input);
  if (
    Object.keys(record).sort().join(',') !== 'code,password' ||
    typeof record.code !== 'string' ||
    typeof record.password !== 'string'
  ) {
    throw new Error();
  }
  const code = record.code;
  if (code.length < 16 || code.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(code)) {
    throw new Error();
  }
  return {
    code,
    password: readPassword({ password: record.password }),
  };
}

function validateEnabledConfig(config: CustomerWebAuthConfig): EnabledCustomerWebAuthConfig {
  const record = readDataRecord(config);
  if (
    Object.keys(record).sort().join(',') !==
      'enabled,passwordRecoveryRedirectUrl,supabasePublishableKey,supabaseUrl' ||
    record.enabled !== true ||
    record.supabaseUrl !== CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN ||
    record.passwordRecoveryRedirectUrl !== CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL ||
    typeof record.supabasePublishableKey !== 'string' ||
    !/^sb_publishable_[A-Za-z0-9_-]{20,256}$/u.test(record.supabasePublishableKey)
  ) {
    throw new Error('Customer web Auth runtime configuration is invalid.');
  }
  return Object.freeze({
    enabled: true,
    passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
    supabasePublishableKey: record.supabasePublishableKey,
    supabaseUrl: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  }) as EnabledCustomerWebAuthConfig;
}

function actionSuccess<Status extends 'authenticated' | 'signed_out' | 'password_updated'>(
  status: Status,
): CustomerWebAuthActionResult<Status> {
  return { ok: true, status };
}

export function createCustomerWebAuthPort(config: CustomerWebAuthConfig): CustomerWebAuthPort {
  const enabledConfig = validateEnabledConfig(config);

  return Object.freeze({
    async signUpWithEmailPassword(
      context: CustomerWebAuthRequestContext,
      input: CustomerWebEmailPasswordInput,
    ): Promise<CustomerWebAuthActionResult<'authenticated'>> {
      try {
        const credentials = readEmailPassword(input);
        const transaction = createCustomerWebResponseEffectTransaction(context);
        const client = createCustomerWebServerClient(enabledConfig, transaction.context);
        const { data, error } = await client.auth.signUp(credentials);
        if (error || !data.session) return GENERIC_FAILURE;
        transaction.commit();
        return actionSuccess('authenticated');
      } catch {
        return GENERIC_FAILURE;
      }
    },

    async signInWithEmailPassword(
      context: CustomerWebAuthRequestContext,
      input: CustomerWebEmailPasswordInput,
    ): Promise<CustomerWebAuthActionResult<'authenticated'>> {
      let transaction: ReturnType<typeof createCustomerWebResponseEffectTransaction> | undefined;
      try {
        const credentials = readEmailPassword(input);
        transaction = createCustomerWebResponseEffectTransaction(context);
        const client = createCustomerWebServerClient(enabledConfig, transaction.context);
        const { data, error } = await client.auth.signInWithPassword(credentials);
        if (error || !data.session) {
          transaction.commitDeletionsOnly();
          return GENERIC_FAILURE;
        }
        transaction.commit();
        return actionSuccess('authenticated');
      } catch {
        try {
          transaction?.commitDeletionsOnly();
        } catch {
          // Response adapters are untrusted; authentication still fails closed.
        }
        return GENERIC_FAILURE;
      }
    },

    async signOut(
      context: CustomerWebAuthRequestContext,
    ): Promise<CustomerWebAuthActionResult<'signed_out'>> {
      let transaction: ReturnType<typeof createCustomerWebResponseEffectTransaction> | undefined;
      try {
        transaction = createCustomerWebResponseEffectTransaction(context);
        const client = createCustomerWebServerClient(enabledConfig, transaction.context);
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) {
          transaction.commitDeletionsOnly();
          return GENERIC_FAILURE;
        }
        transaction.commit();
        return actionSuccess('signed_out');
      } catch {
        try {
          transaction?.commitDeletionsOnly();
        } catch {
          // Response adapters are untrusted; sign-out still fails closed.
        }
        return GENERIC_FAILURE;
      }
    },

    async requestPasswordRecovery(
      context: CustomerWebAuthRequestContext,
      input: CustomerWebEmailInput,
    ): Promise<CustomerWebAuthActionResult<'recovery_request_accepted'>> {
      let transaction: ReturnType<typeof createCustomerWebResponseEffectTransaction> | undefined;
      try {
        const email = normalizeEmail(input);
        transaction = createCustomerWebResponseEffectTransaction(context);
        const client = createCustomerWebServerClient(enabledConfig, transaction.context);
        await client.auth.resetPasswordForEmail(email, {
          redirectTo: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
        });
      } catch {
        // The response remains indistinguishable to prevent account enumeration.
      } finally {
        try {
          transaction?.commit();
        } catch {
          // The response remains indistinguishable when the response adapter fails.
        }
      }
      return RECOVERY_REQUEST_ACCEPTED;
    },

    async completePasswordRecovery(
      context: CustomerWebAuthRequestContext,
      input: CustomerWebPasswordRecoveryInput,
    ): Promise<CustomerWebAuthActionResult<'password_updated'>> {
      try {
        const recovery = readPasswordRecovery(input);
        const transaction = createCustomerWebResponseEffectTransaction(context);
        const client = createCustomerWebServerClient(enabledConfig, transaction.context);
        const exchange = await client.auth.exchangeCodeForSession(recovery.code);
        if (exchange.error || !exchange.data.session) return GENERIC_FAILURE;
        const update = await client.auth.updateUser({ password: recovery.password });
        if (update.error || !update.data.user) return GENERIC_FAILURE;
        transaction.commit();
        return actionSuccess('password_updated');
      } catch {
        return GENERIC_FAILURE;
      }
    },

    async getCurrentCustomer(
      context: CustomerWebAuthRequestContext,
    ): Promise<CustomerWebCurrentCustomerResult> {
      let transaction: ReturnType<typeof createCustomerWebResponseEffectTransaction> | undefined;
      try {
        transaction = createCustomerWebResponseEffectTransaction(context);
        const client = createCustomerWebServerClient(enabledConfig, transaction.context);
        const { data, error } = await client.auth.getUser();
        if (error) {
          if (!data.user && isAuthSessionMissingError(error)) {
            transaction.commitDeletionsOnly();
            return { ok: true, status: 'anonymous' };
          }
          transaction.commitDeletionsOnly();
          return GENERIC_FAILURE;
        }
        if (!data.user) {
          transaction.commit();
          return { ok: true, status: 'anonymous' };
        }
        if (typeof data.user.email !== 'string') {
          transaction.commitDeletionsOnly();
          return GENERIC_FAILURE;
        }
        const authUserId = normalizeAuthUserId(data.user.id);
        const email = normalizeEmail({ email: data.user.email });
        transaction.commit();
        return { account: { authUserId, email }, ok: true, status: 'authenticated' };
      } catch {
        try {
          transaction?.commitDeletionsOnly();
        } catch {
          // Response adapters are untrusted; authorization still fails closed.
        }
        return GENERIC_FAILURE;
      }
    },
  });
}
