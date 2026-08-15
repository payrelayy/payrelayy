import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
  CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  loadCustomerWebAuthConfig,
  redactedCustomerWebAuthConfigForLog,
} from './customer-web.js';

const publishableKey = `sb_publishable_${'a'.repeat(22)}_${'b'.repeat(8)}`;

describe('customer web auth configuration', () => {
  it('is disabled by default without reading the Supabase URL or key', () => {
    const environment = new Proxy(
      { INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (
            property === 'CUSTOMER_WEB_SUPABASE_URL' ||
            property === 'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY'
          ) {
            throw new Error(`disabled auth configuration read ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadCustomerWebAuthConfig(environment)).toEqual({
      enabled: false,
      passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
      supabasePublishableKey: undefined,
      supabaseUrl: undefined,
    });
  });

  it('loads only the exact staging origin and a current publishable key', () => {
    const config = loadCustomerWebAuthConfig({
      CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      CUSTOMER_WEB_SUPABASE_URL: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
      INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true',
    });

    expect(config).toEqual({
      enabled: true,
      passwordRecoveryRedirectUrl: 'https://fetanagent.com/auth/recovery',
      supabasePublishableKey: publishableKey,
      supabaseUrl: 'https://spzpiyxheappsfyswewl.supabase.co',
    });
    expect(redactedCustomerWebAuthConfigForLog(config)).toEqual({
      enabled: true,
      passwordRecoveryRedirectUrl: 'https://fetanagent.com/auth/recovery',
      publishableKeyConfigured: true,
      supabaseOriginConfigured: true,
    });
    expect(JSON.stringify(redactedCustomerWebAuthConfigForLog(config))).not.toContain(
      publishableKey,
    );
  });

  it('rejects alternate origins, secret keys, service-role material, and malformed keys', () => {
    const loadWith = (url: string, key: string) =>
      loadCustomerWebAuthConfig({
        CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY: key,
        CUSTOMER_WEB_SUPABASE_URL: url,
        INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true',
      });

    expect(() => loadWith('https://example.test', publishableKey)).toThrow(
      'exact approved customer-web staging Supabase origin',
    );
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_secret_${'a'.repeat(32)}`),
    ).toThrow('current Supabase publishable key');
    expect(() => loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, 'service_role')).toThrow(
      'current Supabase publishable key',
    );
    expect(() => loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, 'eyJ.fake.jwt')).toThrow(
      'current Supabase publishable key',
    );
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(19)}`),
    ).toThrow('current Supabase publishable key');
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(20)}`),
    ).not.toThrow();
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(256)}`),
    ).not.toThrow();
    expect(() =>
      loadWith(CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN, `sb_publishable_${'a'.repeat(257)}`),
    ).toThrow('current Supabase publishable key');
  });
});
