import { describe, expect, it } from 'vitest';

import { loadBetaAdmissionPreflightConfig } from './beta-admission.js';

describe('beta-admission preflight configuration', () => {
  it('is disabled by default and when its explicit gate is false', () => {
    expect(loadBetaAdmissionPreflightConfig({})).toEqual({ enabled: false });
    expect(
      loadBetaAdmissionPreflightConfig({
        INTERNAL_TELEGRAM_BETA_ADMISSION_PREFLIGHT_ENABLED: 'false',
      }),
    ).toEqual({ enabled: false });
  });

  it('does not read a URL, token, or HMAC secret while disabled', () => {
    const environment = new Proxy(
      { INTERNAL_TELEGRAM_BETA_ADMISSION_PREFLIGHT_ENABLED: 'false' },
      {
        get(target, property, receiver) {
          if (
            property === 'DATABASE_URL' ||
            property === 'NONCE_RETENTION_DATABASE_URL' ||
            property === 'TELEGRAM_BOT_TOKEN' ||
            property === 'BOT_TO_API_INGRESS_BASE_URL' ||
            property === 'BOT_TO_API_INGRESS_HMAC_SECRET' ||
            property === 'API_TELEGRAM_PAYLOAD_HMAC_SECRET' ||
            property === 'API_TELEGRAM_CAPABILITY_HMAC_SECRET' ||
            property === 'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET' ||
            property === 'BOT_TO_API_ACTION_BASE_URL' ||
            property === 'BOT_TO_API_ACTION_HMAC_SECRET'
          ) {
            throw new Error(`disabled beta-admission preflight must not read ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadBetaAdmissionPreflightConfig(environment)).toEqual({ enabled: false });
  });

  it('fails closed with a generic message when explicitly enabled', () => {
    expect(() =>
      loadBetaAdmissionPreflightConfig({
        INTERNAL_TELEGRAM_BETA_ADMISSION_PREFLIGHT_ENABLED: 'true',
      }),
    ).toThrow('Beta-admission preflight is not provisioned in this stage.');
  });
});
