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
  it('exposes no evaluator or planner while the contract gate is disabled', () => {
    const contract = createWorkerCbeBirrAuthoritativeShadowContract({
      ...fixedDisabledCapabilities,
      contractEnabled: false,
    });
    expect(contract).toEqual({
      ...fixedDisabledCapabilities,
      enabled: false,
      contractVersion: 1,
    });
    expect(contract).not.toHaveProperty('evaluate');
    expect(contract).not.toHaveProperty('planAttempt');
  });

  it('composes only the pure evaluator and attempt planner when the gate is enabled', () => {
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

    expect(
      contract.planAttempt({
        contractVersion: 1,
        intent: {
          state: 'intake_received',
          openReview: false,
          expectedAmountMinor: 2_500,
          currencyCode: 'ETB',
          openedAt: '2026-08-14T10:00:00.000Z',
          paymentDeadlineAt: '2026-08-14T11:00:00.000Z',
        },
        assessedAt: '2026-08-14T10:10:00.000Z',
        adapterResult: {
          contractVersion: 1,
          providerCode: 'cbe_birr',
          evidence: {
            lookupOutcome: 'unavailable',
            uncertainty: 'network',
          },
        },
      }),
    ).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'retry_candidate',
      decision: {
        contractVersion: 1,
        outcome: 'would_review',
        reasonCode: 'provider_network_uncertain',
      },
    });
    expect(contract).toMatchObject(fixedDisabledCapabilities);
  });

  it('cannot widen operational capabilities or expose dependencies from runtime input', () => {
    for (const contractEnabled of [false, true]) {
      const contract = createWorkerCbeBirrAuthoritativeShadowContract({
        contractEnabled,
        mode: 'live',
        providerTransportEnabled: true,
        durableJobsEnabled: true,
        paymentClaimsEnabled: true,
        kemerBetExecutionEnabled: true,
        providerCredential: 'raw-provider-secret',
        databasePool: { connected: true },
      } as unknown as Parameters<typeof createWorkerCbeBirrAuthoritativeShadowContract>[0]);

      expect(contract).toMatchObject(fixedDisabledCapabilities);
      expect(JSON.stringify(contract)).not.toContain('raw-provider-secret');
      expect(contract).not.toHaveProperty('databasePool');
    }
  });
});
