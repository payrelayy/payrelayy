import { describe, expect, it } from 'vitest';

import type { CbeBirrAuthoritativeAdapterFoundEvidence } from './cbe-birr-authoritative-adapter.js';
import {
  CBE_BIRR_AUTHORITATIVE_SHADOW_ATTEMPT_CONTRACT_VERSION,
  cbeBirrAuthoritativeShadowRetryCandidateReasonCodes,
  planCbeBirrAuthoritativeShadowAttempt,
  type CbeBirrAuthoritativeShadowAttemptPlan,
} from './cbe-birr-authoritative-shadow-attempt.js';

const intent = {
  state: 'intake_received' as const,
  openReview: false,
  expectedAmountMinor: 2_500,
  currencyCode: 'ETB' as const,
  openedAt: '2026-08-14T10:00:00.000Z',
  paymentDeadlineAt: '2026-08-14T11:00:00.000Z',
};

const foundEvidence: CbeBirrAuthoritativeAdapterFoundEvidence = {
  lookupOutcome: 'found',
  evidenceSource: 'provider_receipt_lookup',
  providerIdentity: 'matched',
  providerFinalStatus: 'completed',
  canonicalReferencePresent: true,
  amountMinor: 2_500,
  currencyCode: 'ETB',
  receiverMatch: 'matched',
  paymentType: 'send_money',
  occurredAt: '2026-08-14T10:05:00.000Z',
  retrievedAt: '2026-08-14T10:06:00.000Z',
  provenance: {
    adapterVersionPresent: true,
    normalizationVersionPresent: true,
    evidenceDigestPresent: true,
  },
};

function attempt(adapterResult: unknown): unknown {
  return {
    contractVersion: 1,
    intent,
    assessedAt: '2026-08-14T10:10:00.000Z',
    adapterResult,
  };
}

function adapterResult(evidence: unknown): unknown {
  return { contractVersion: 1, providerCode: 'cbe_birr', evidence };
}

function assertNonVerifyingType(plan: CbeBirrAuthoritativeShadowAttemptPlan): void {
  const outcome: 'would_reject' | 'would_review' = plan.decision.outcome;
  expect(outcome).not.toBe('would_verify');
}

describe('CBE Birr authoritative shadow attempt planner', () => {
  it('freezes the version and exact retry-candidate allowlist', () => {
    expect(CBE_BIRR_AUTHORITATIVE_SHADOW_ATTEMPT_CONTRACT_VERSION).toBe(1);
    expect(cbeBirrAuthoritativeShadowRetryCandidateReasonCodes).toEqual([
      'authoritative_receipt_unavailable',
      'provider_network_uncertain',
      'receipt_parse_uncertain',
    ]);
  });

  it('cannot verify a complete match while the duplicate read boundary is absent', () => {
    const plan = planCbeBirrAuthoritativeShadowAttempt(attempt(adapterResult(foundEvidence)));

    expect(plan).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'complete_advisory',
      decision: {
        contractVersion: 1,
        outcome: 'would_review',
        reasonCode: 'duplicate_check_unavailable',
      },
    });
    assertNonVerifyingType(plan);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.decision)).toBe(true);
  });

  it('keeps conclusive and non-retry review outcomes terminal and advisory', () => {
    const cases = [
      [{ lookupOutcome: 'not_found' }, 'would_reject', 'authoritative_receipt_not_found'],
      [{ ...foundEvidence, receiverMatch: 'mismatched' }, 'would_reject', 'receiver_mismatch'],
      [
        { ...foundEvidence, providerFinalStatus: 'failed' },
        'would_reject',
        'provider_status_failed',
      ],
      [{ ...foundEvidence, amountMinor: 2_501 }, 'would_review', 'amount_mismatch'],
      [
        { ...foundEvidence, providerFinalStatus: 'pending' },
        'would_review',
        'provider_status_pending',
      ],
    ] as const;

    for (const [evidence, outcome, reasonCode] of cases) {
      const plan = planCbeBirrAuthoritativeShadowAttempt(attempt(adapterResult(evidence)));
      expect(plan).toMatchObject({
        disposition: 'complete_advisory',
        decision: { outcome, reasonCode },
      });
      assertNonVerifyingType(plan);
    }
  });

  it.each([
    ['provider', 'authoritative_receipt_unavailable'],
    ['network', 'provider_network_uncertain'],
    ['parser', 'receipt_parse_uncertain'],
  ] as const)(
    'classifies %s uncertainty as a retry candidate without scheduling it',
    (uncertainty, reasonCode) => {
      const plan = planCbeBirrAuthoritativeShadowAttempt(
        attempt(adapterResult({ lookupOutcome: 'unavailable', uncertainty })),
      );
      expect(plan).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        disposition: 'retry_candidate',
        decision: { contractVersion: 1, outcome: 'would_review', reasonCode },
      });
      expect(plan).not.toHaveProperty('retryAfterSeconds');
      assertNonVerifyingType(plan);
    },
  );

  it('does not accept caller-supplied duplicate authority', () => {
    const topLevelDuplicate = {
      ...(attempt(adapterResult(foundEvidence)) as object),
      duplicateCheck: 'clear',
    };
    const adapterDuplicate = attempt(adapterResult({ ...foundEvidence, duplicateCheck: 'clear' }));

    expect(planCbeBirrAuthoritativeShadowAttempt(topLevelDuplicate)).toMatchObject({
      disposition: 'complete_advisory',
      decision: { outcome: 'would_review', reasonCode: 'payment_fields_missing' },
    });
    expect(planCbeBirrAuthoritativeShadowAttempt(adapterDuplicate)).toMatchObject({
      disposition: 'retry_candidate',
      decision: { outcome: 'would_review', reasonCode: 'receipt_parse_uncertain' },
    });
  });

  it('fails closed on malformed shapes, accessors, symbols, and proxies without reading traps', () => {
    let accessorReads = 0;
    let proxyTrapCalls = 0;
    const accessorCandidate = {
      contractVersion: 1,
      intent,
      adapterResult: adapterResult(foundEvidence),
    } as Record<string, unknown>;
    Object.defineProperty(accessorCandidate, 'assessedAt', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return '2026-08-14T10:10:00.000Z';
      },
    });
    const symbolCandidate = attempt(adapterResult(foundEvidence)) as Record<PropertyKey, unknown>;
    symbolCandidate[Symbol('secret')] = 'caller-secret';
    const proxyCandidate = new Proxy(attempt(adapterResult(foundEvidence)) as object, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('caller-secret');
      },
    });

    for (const candidate of [null, [], {}, accessorCandidate, symbolCandidate, proxyCandidate]) {
      expect(planCbeBirrAuthoritativeShadowAttempt(candidate)).toMatchObject({
        disposition: 'complete_advisory',
        decision: { outcome: 'would_review', reasonCode: 'payment_fields_missing' },
      });
    }
    expect(accessorReads).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  it('never copies raw references, receivers, payloads, URLs, credentials, or thrown values', () => {
    const sensitiveValues = [
      'RAW-REFERENCE-123',
      '+251900000000',
      '<html>provider payload</html>',
      'https://provider.invalid/private',
      'Bearer provider-secret',
    ];
    const candidates = [
      attempt(
        adapterResult({
          ...foundEvidence,
          rawReference: sensitiveValues[0],
          receiver: sensitiveValues[1],
          payload: sensitiveValues[2],
          receiptUrl: sensitiveValues[3],
          credential: sensitiveValues[4],
        }),
      ),
      new Proxy(attempt(adapterResult(foundEvidence)) as object, {
        ownKeys() {
          throw new Error(sensitiveValues[4]);
        },
      }),
    ];
    const serialized = JSON.stringify(
      candidates.map((candidate) => planCbeBirrAuthoritativeShadowAttempt(candidate)),
    );

    for (const sensitiveValue of sensitiveValues) expect(serialized).not.toContain(sensitiveValue);
  });
});
