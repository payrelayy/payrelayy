import { describe, expect, it } from 'vitest';

import {
  cbeBirrAuthoritativeShadowReasonCodes,
  cbeBirrAuthoritativeShadowReasonCodesByOutcome,
  evaluateCbeBirrAuthoritativeShadow,
  redactedCbeBirrAuthoritativeShadowDecisionForLog,
  type CbeBirrAuthoritativeShadowFoundEvidence,
  type CbeBirrAuthoritativeShadowInput,
} from './cbe-birr-authoritative-shadow.js';

const foundEvidence: CbeBirrAuthoritativeShadowFoundEvidence = {
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
  duplicateCheck: 'clear',
};

const baseline: CbeBirrAuthoritativeShadowInput = {
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
  evidence: foundEvidence,
};

function withEvidence(
  evidence: Partial<CbeBirrAuthoritativeShadowFoundEvidence>,
): CbeBirrAuthoritativeShadowInput {
  return {
    ...baseline,
    evidence: {
      ...foundEvidence,
      ...evidence,
      provenance: evidence.provenance ?? foundEvidence.provenance,
    },
  };
}

function expectDecision(
  candidate: unknown,
  outcome: 'would_verify' | 'would_reject' | 'would_review',
  reasonCode: string,
): void {
  expect(evaluateCbeBirrAuthoritativeShadow(candidate)).toEqual({
    contractVersion: 1,
    outcome,
    reasonCode,
  });
}

describe('CBE Birr authoritative shadow decision', () => {
  it('would verify only a complete authoritative match and supports every allowlisted source', () => {
    for (const evidenceSource of [
      'provider_api',
      'provider_receipt_lookup',
      'provider_account_activity',
    ] as const) {
      expectDecision(withEvidence({ evidenceSource }), 'would_verify', 'shadow_checks_passed');
    }
  });

  it('uses the exact frozen outcome/reason allowlist', () => {
    expect(cbeBirrAuthoritativeShadowReasonCodesByOutcome).toEqual({
      would_verify: ['shadow_checks_passed'],
      would_reject: [
        'authoritative_receipt_not_found',
        'receiver_mismatch',
        'provider_status_failed',
        'provider_reference_reused',
      ],
      would_review: [
        'authoritative_receipt_unavailable',
        'amount_mismatch',
        'payment_stale',
        'payment_timestamp_future',
        'payment_fields_missing',
        'receipt_parse_uncertain',
        'provider_network_uncertain',
        'provider_status_pending',
        'payment_type_mismatch',
        'verification_review_required',
        'duplicate_check_unavailable',
      ],
    });
    expect(cbeBirrAuthoritativeShadowReasonCodes).toEqual([
      'shadow_checks_passed',
      'authoritative_receipt_not_found',
      'receiver_mismatch',
      'provider_status_failed',
      'provider_reference_reused',
      'authoritative_receipt_unavailable',
      'amount_mismatch',
      'payment_stale',
      'payment_timestamp_future',
      'payment_fields_missing',
      'receipt_parse_uncertain',
      'provider_network_uncertain',
      'provider_status_pending',
      'payment_type_mismatch',
      'verification_review_required',
      'duplicate_check_unavailable',
    ]);
  });

  it('rejects only conclusive not-found, wrong-receiver, failed, reused-reference cases', () => {
    expectDecision(
      { ...baseline, evidence: { lookupOutcome: 'not_found' } },
      'would_reject',
      'authoritative_receipt_not_found',
    );
    expectDecision(
      withEvidence({ receiverMatch: 'mismatched' }),
      'would_reject',
      'receiver_mismatch',
    );
    expectDecision(
      withEvidence({ providerFinalStatus: 'failed' }),
      'would_reject',
      'provider_status_failed',
    );
    expectDecision(
      withEvidence({ duplicateCheck: 'reused' }),
      'would_reject',
      'provider_reference_reused',
    );
  });

  it('reviews each class of unavailable official source', () => {
    expectDecision(
      { ...baseline, evidence: { lookupOutcome: 'unavailable', uncertainty: 'provider' } },
      'would_review',
      'authoritative_receipt_unavailable',
    );
    expectDecision(
      { ...baseline, evidence: { lookupOutcome: 'unavailable', uncertainty: 'network' } },
      'would_review',
      'provider_network_uncertain',
    );
    expectDecision(
      { ...baseline, evidence: { lookupOutcome: 'unavailable', uncertainty: 'parser' } },
      'would_review',
      'receipt_parse_uncertain',
    );
  });

  it('reviews provider identity and non-final status uncertainty', () => {
    for (const providerIdentity of ['mismatched', 'unknown'] as const) {
      expectDecision(withEvidence({ providerIdentity }), 'would_review', 'receipt_parse_uncertain');
    }
    expectDecision(
      withEvidence({ providerFinalStatus: 'pending' }),
      'would_review',
      'provider_status_pending',
    );
    expectDecision(
      withEvidence({ providerFinalStatus: 'unknown' }),
      'would_review',
      'receipt_parse_uncertain',
    );
  });

  it('reviews incompatible or unknown payment type and currency', () => {
    expectDecision(withEvidence({ paymentType: 'other' }), 'would_review', 'payment_type_mismatch');
    expectDecision(
      withEvidence({ paymentType: 'unknown' }),
      'would_review',
      'payment_fields_missing',
    );
    expectDecision(
      withEvidence({ currencyCode: 'other' }),
      'would_review',
      'receipt_parse_uncertain',
    );
    expectDecision(
      withEvidence({ currencyCode: 'unknown' }),
      'would_review',
      'payment_fields_missing',
    );
  });

  it('reviews missing receiver/reference/amount facts and an exact amount mismatch', () => {
    expectDecision(
      withEvidence({ receiverMatch: 'unknown' }),
      'would_review',
      'payment_fields_missing',
    );
    expectDecision(
      withEvidence({ canonicalReferencePresent: false }),
      'would_review',
      'payment_fields_missing',
    );
    expectDecision(withEvidence({ amountMinor: null }), 'would_review', 'payment_fields_missing');
    expectDecision(withEvidence({ amountMinor: 2_501 }), 'would_review', 'amount_mismatch');
  });

  it('reviews every missing provenance component', () => {
    for (const missing of [
      'adapterVersionPresent',
      'normalizationVersionPresent',
      'evidenceDigestPresent',
    ] as const) {
      expectDecision(
        withEvidence({ provenance: { ...foundEvidence.provenance, [missing]: false } }),
        'would_review',
        'payment_fields_missing',
      );
    }
  });

  it('reviews stale, future, missing, and contradictory timestamps', () => {
    expectDecision(
      withEvidence({ occurredAt: '2026-08-14T09:59:59.999Z' }),
      'would_review',
      'payment_stale',
    );
    expectDecision(
      withEvidence({ occurredAt: '2026-08-14T11:00:00.001Z' }),
      'would_review',
      'payment_stale',
    );
    expectDecision(
      { ...baseline, assessedAt: '2026-08-14T11:00:00.001Z' },
      'would_review',
      'payment_stale',
    );
    expectDecision(
      withEvidence({ occurredAt: '2026-08-14T10:15:00.001Z' }),
      'would_review',
      'payment_timestamp_future',
    );
    expectDecision(
      withEvidence({ retrievedAt: '2026-08-14T10:15:00.001Z' }),
      'would_review',
      'payment_timestamp_future',
    );
    expectDecision(
      withEvidence({ retrievedAt: '2026-08-14T09:59:59.999Z' }),
      'would_review',
      'receipt_parse_uncertain',
    );
    expectDecision(
      withEvidence({ retrievedAt: '2026-08-14T10:04:59.999Z' }),
      'would_review',
      'receipt_parse_uncertain',
    );
    expectDecision(withEvidence({ occurredAt: null }), 'would_review', 'payment_fields_missing');
    expectDecision(withEvidence({ retrievedAt: null }), 'would_review', 'payment_fields_missing');
  });

  it('reviews an ineligible intent or unavailable duplicate check before any approval', () => {
    for (const state of ['verification_pending', 'verification_review', 'other'] as const) {
      expectDecision(
        { ...baseline, intent: { ...baseline.intent, state } },
        'would_review',
        'verification_review_required',
      );
    }
    expectDecision(
      { ...baseline, intent: { ...baseline.intent, openReview: true } },
      'would_review',
      'verification_review_required',
    );
    expectDecision(
      withEvidence({ duplicateCheck: 'unavailable' }),
      'would_review',
      'duplicate_check_unavailable',
    );
  });

  it('fails closed on malformed, extended, unsupported, or non-normalized contract shapes', () => {
    const symbolExtended = { ...baseline } as Record<PropertyKey, unknown>;
    symbolExtended[Symbol('raw-provider-field')] = 'SENSITIVE-SYMBOL-VALUE';
    let getterReads = 0;
    const accessorExtended = { ...baseline } as Record<string, unknown>;
    Object.defineProperty(accessorExtended, 'assessedAt', {
      enumerable: true,
      get() {
        getterReads += 1;
        return baseline.assessedAt;
      },
    });
    const malformed: readonly unknown[] = [
      null,
      [],
      {},
      { ...baseline, contractVersion: 2 },
      { ...baseline, assessedAt: '2026-08-14T10:10:00Z' },
      { ...baseline, assessedAt: '2026-08-14T09:59:59.999Z' },
      { ...baseline, intent: { ...baseline.intent, expectedAmountMinor: 25.5 } },
      { ...baseline, intent: { ...baseline.intent, openedAt: 'not-a-date' } },
      { ...baseline, unexpected: true },
      { ...baseline, evidence: { ...foundEvidence, rawReference: 'SENSITIVE-REFERENCE' } },
      { ...baseline, evidence: { lookupOutcome: 'unavailable', uncertainty: 'timeout' } },
      { ...baseline, evidence: { ...foundEvidence, evidenceSource: 'screenshot_ocr' } },
      { ...baseline, evidence: { ...foundEvidence, amountMinor: Number.NaN } },
      {
        ...baseline,
        evidence: {
          ...foundEvidence,
          provenance: { ...foundEvidence.provenance, adapterVersion: 'secret-version' },
        },
      },
      symbolExtended,
      accessorExtended,
      new Proxy(baseline, {
        getPrototypeOf() {
          throw new Error('unexpected adapter proxy');
        },
      }),
    ];

    for (const candidate of malformed) {
      expectDecision(candidate, 'would_review', 'payment_fields_missing');
    }
    expect(getterReads).toBe(0);
  });

  it('never returns or logs raw reference, receiver, URL, credential, or provider payload data', () => {
    const sensitiveValues = [
      'RAW-TRANSACTION-REFERENCE',
      '+251900000000',
      'https://provider.invalid/receipt',
      'Bearer secret-token',
      '<html>raw provider payload</html>',
    ];
    const candidate = {
      ...baseline,
      evidence: {
        ...foundEvidence,
        rawReference: sensitiveValues[0],
        rawReceiver: sensitiveValues[1],
        receiptUrl: sensitiveValues[2],
        authorization: sensitiveValues[3],
        providerPayload: sensitiveValues[4],
      },
    };
    const decision = evaluateCbeBirrAuthoritativeShadow(candidate);
    const tamperedDecision = {
      ...decision,
      rawReference: sensitiveValues[0],
      rawReceiver: sensitiveValues[1],
      receiptUrl: sensitiveValues[2],
      authorization: sensitiveValues[3],
      providerPayload: sensitiveValues[4],
    };
    const logValue = redactedCbeBirrAuthoritativeShadowDecisionForLog(tamperedDecision);
    const serialized = JSON.stringify({ decision, logValue });

    expect(decision).toEqual({
      contractVersion: 1,
      outcome: 'would_review',
      reasonCode: 'payment_fields_missing',
    });
    expect(logValue).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      outcome: 'would_review',
      reasonCode: 'payment_fields_missing',
    });
    for (const sensitiveValue of sensitiveValues) expect(serialized).not.toContain(sensitiveValue);
  });

  it('fails the log projection closed for forged values, accessors, extras, and proxies', () => {
    const fallback = {
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      outcome: 'would_review',
      reasonCode: 'payment_fields_missing',
    };
    const sensitiveValue = 'Bearer forged-provider-credential';
    let accessorReads = 0;
    const accessorDecision = {
      contractVersion: 1,
      reasonCode: 'shadow_checks_passed',
    } as Record<string, unknown>;
    Object.defineProperty(accessorDecision, 'outcome', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return sensitiveValue;
      },
    });

    for (const candidate of [
      { contractVersion: 1, outcome: sensitiveValue, reasonCode: 'shadow_checks_passed' },
      { contractVersion: 1, outcome: 'would_review', reasonCode: sensitiveValue },
      {
        contractVersion: 1,
        outcome: 'would_verify',
        reasonCode: 'shadow_checks_passed',
        rawReference: sensitiveValue,
      },
      accessorDecision,
      new Proxy(
        { contractVersion: 1, outcome: 'would_verify', reasonCode: 'shadow_checks_passed' },
        {
          getPrototypeOf() {
            throw new Error(sensitiveValue);
          },
        },
      ),
    ]) {
      const projected = redactedCbeBirrAuthoritativeShadowDecisionForLog(candidate);
      expect(projected).toEqual(fallback);
      expect(JSON.stringify(projected)).not.toContain(sensitiveValue);
    }
    expect(accessorReads).toBe(0);
  });
});
