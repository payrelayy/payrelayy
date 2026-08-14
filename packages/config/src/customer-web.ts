import { booleanFromEnv } from './shared.js';

export const CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN =
  'https://spzpiyxheappsfyswewl.supabase.co' as const;
export const CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL =
  'https://fetanagent.com/auth/recovery' as const;

export type CustomerWebAuthConfig =
  | {
      readonly enabled: false;
      readonly passwordRecoveryRedirectUrl: typeof CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL;
      readonly supabasePublishableKey: undefined;
      readonly supabaseUrl: undefined;
    }
  | {
      readonly enabled: true;
      readonly passwordRecoveryRedirectUrl: typeof CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL;
      readonly supabasePublishableKey: string;
      readonly supabaseUrl: typeof CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN;
    };

export type RedactedCustomerWebAuthConfig = {
  readonly enabled: boolean;
  readonly passwordRecoveryRedirectUrl: typeof CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL;
  readonly publishableKeyConfigured: boolean;
  readonly supabaseOriginConfigured: boolean;
};

function requiredPublishableKey(value: string | undefined): string {
  if (!value || !/^sb_publishable_[A-Za-z0-9_-]{20,256}$/u.test(value)) {
    throw new Error(
      'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY must be a current Supabase publishable key.',
    );
  }
  return value;
}

export function loadCustomerWebAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CustomerWebAuthConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED,
    false,
    'INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED',
  );

  if (!enabled) {
    return {
      enabled: false,
      passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
      supabasePublishableKey: undefined,
      supabaseUrl: undefined,
    };
  }

  if (environment.CUSTOMER_WEB_SUPABASE_URL !== CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN) {
    throw new Error(
      'CUSTOMER_WEB_SUPABASE_URL must be the exact approved customer-web staging Supabase origin.',
    );
  }

  return {
    enabled: true,
    passwordRecoveryRedirectUrl: CUSTOMER_WEB_PASSWORD_RECOVERY_REDIRECT_URL,
    supabasePublishableKey: requiredPublishableKey(
      environment.CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY,
    ),
    supabaseUrl: CUSTOMER_WEB_STAGING_SUPABASE_ORIGIN,
  };
}

export function redactedCustomerWebAuthConfigForLog(
  config: CustomerWebAuthConfig,
): RedactedCustomerWebAuthConfig {
  return {
    enabled: config.enabled,
    passwordRecoveryRedirectUrl: config.passwordRecoveryRedirectUrl,
    publishableKeyConfigured: config.enabled,
    supabaseOriginConfigured: config.enabled,
  };
}
