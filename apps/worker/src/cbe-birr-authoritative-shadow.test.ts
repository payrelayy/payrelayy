import { describe, expect, it } from 'vitest';

import { createWorkerCbeBirrAuthoritativeShadowContract } from './cbe-birr-authoritative-shadow.js';

const fixedDisabledCapabilities = {
  mode: 'shadow' as const,
  providerTransportEnabled: false as const,
  durableJobsEnabled: false as const,
  paymentClaimsEnabled: false as const,
  kemerBetExecutionEnabled: false as const,
};

describe('worker CBE Birr authoritative-shadow scaffold', () => {
  it('exposes no evaluator while the contract gate is disabled', () => {
    const contract = createWorkerCbeBirrAuthoritativeShadowContract({
      ...fixedDisabledCapabilities,
      contractEnabled: false,
    });
    expect(contract).toEqual({ enabled: false, contractVersion: 1 });
    expect(contract).not.toHaveProperty('evaluate');
  });

  it('composes only the pure evaluator when the contract gate is enabled', () => {
    const contract = createWorkerCbeBirrAuthoritativeShadowContract({
      ...fixedDisabledCapabilities,
      contractEnabled: true,
    });
    expect(contract.enabled).toBe(true);
    if (!contract.enabled) throw new Error('contract unexpectedly disabled');

    const decision = contract.evaluate({ unexpected: 'raw-provider-material' });
    expect(decision).toEqual({
      contractVersion: 1,
      outcome: 'would_review',
      reasonCode: 'payment_fields_missing',
    });
    expect(JSON.stringify(contract.decisionForLog(decision))).not.toContain(
      'raw-provider-material',
    );
  });
});
