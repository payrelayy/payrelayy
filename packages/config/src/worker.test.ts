import { describe, expect, it } from 'vitest';

import { loadWorkerConfig, redactedWorkerConfigForLog } from './worker.js';

describe('worker shadow configuration', () => {
  it('defaults the advisory contract and every operational capability to disabled', () => {
    expect(loadWorkerConfig({ NODE_ENV: 'test' })).toEqual({
      nodeEnv: 'test',
      logLevel: 'info',
      cbeBirrAuthoritativeShadow: {
        contractEnabled: false,
        mode: 'shadow',
        providerTransportEnabled: false,
        durableJobsEnabled: false,
        paymentClaimsEnabled: false,
        kemerBetExecutionEnabled: false,
      },
    });
  });

  it('can expose only the pure contract while transport, jobs, claims, and execution stay false', () => {
    const config = loadWorkerConfig({
      NODE_ENV: 'test',
      INTERNAL_CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_ENABLED: 'true',
    });
    expect(config.cbeBirrAuthoritativeShadow).toEqual({
      contractEnabled: true,
      mode: 'shadow',
      providerTransportEnabled: false,
      durableJobsEnabled: false,
      paymentClaimsEnabled: false,
      kemerBetExecutionEnabled: false,
    });
  });

  it('never reads a provider URL, receiver, credential, database URL, or execution switch', () => {
    const forbidden = new Set([
      'CBE_BIRR_PROVIDER_URL',
      'CBE_BIRR_RECEIVER_PHONE',
      'CBE_BIRR_PROVIDER_CREDENTIAL',
      'DATABASE_URL',
      'FINANCIAL_ACTIONS_MODE',
      'KEMERBET_EXECUTOR_ENABLED',
      'KEMERBET_FINAL_ACTION_ENABLED',
    ]);
    const environment = new Proxy(
      {
        NODE_ENV: 'test',
        INTERNAL_CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_ENABLED: 'true',
      },
      {
        get(target, property, receiver) {
          if (forbidden.has(String(property))) {
            throw new Error(`forbidden worker environment read: ${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as NodeJS.ProcessEnv;

    expect(loadWorkerConfig(environment).cbeBirrAuthoritativeShadow.contractEnabled).toBe(true);
  });

  it('logs only an explicit safe projection and rejects an invalid gate', () => {
    const config = loadWorkerConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      INTERNAL_CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_ENABLED: 'false',
      CBE_BIRR_PROVIDER_CREDENTIAL: 'must-not-appear',
    });
    expect(redactedWorkerConfigForLog(config)).toEqual(config);
    expect(JSON.stringify(redactedWorkerConfigForLog(config))).not.toContain('must-not-appear');
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        INTERNAL_CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_ENABLED: 'yes',
      }),
    ).toThrow('INTERNAL_CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_ENABLED');
  });
});
