import { describe, expect, it } from 'vitest';

import {
  CBE_BIRR_AUTHORITATIVE_ADAPTER_CONTRACT_VERSION,
  redactedCbeBirrAuthoritativeAdapterResultForLog,
  validatedCbeBirrAuthoritativeAdapterResult,
  type CbeBirrAuthoritativeAdapterFoundEvidence,
  type CbeBirrAuthoritativeAdapterResult,
} from './cbe-birr-authoritative-adapter.js';

const foundEvidence: CbeBirrAuthoritativeAdapterFoundEvidence = {
  lookupOutcome: 'found',
  evidenceSource: 'provider_receipt_lookup',
  providerIdentity: 'matched',
  providerFinalStatus: 'completed',
  canonicalReferencePresent: true,
  amountMinor: 2500,
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

const foundResult: CbeBirrAuthoritativeAdapterResult = {
  contractVersion: CBE_BIRR_AUTHORITATIVE_ADAPTER_CONTRACT_VERSION,
  providerCode: 'cbe_birr',
  evidence: foundEvidence,
};

describe('CBE Birr authoritative adapter safe-result contract', () => {
  it('accepts and reconstructs exact found safe facts without duplicate state', () => {
    const result = validatedCbeBirrAuthoritativeAdapterResult(foundResult);

    expect(result).toEqual(foundResult);
    expect(result).not.toBe(foundResult);
    expect(result.evidence).not.toBe(foundResult.evidence);
    expect(result.evidence).not.toHaveProperty('duplicateCheck');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
    if (result.evidence.lookupOutcome === 'found') {
      expect(Object.isFrozen(result.evidence.provenance)).toBe(true);
    }
  });

  it('accepts only exact not-found and unavailable evidence shapes', () => {
    expect(
      validatedCbeBirrAuthoritativeAdapterResult({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        evidence: { lookupOutcome: 'not_found' },
      }),
    ).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      evidence: { lookupOutcome: 'not_found' },
    });

    expect(
      validatedCbeBirrAuthoritativeAdapterResult({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        evidence: { lookupOutcome: 'unavailable', uncertainty: 'network' },
      }),
    ).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      evidence: { lookupOutcome: 'unavailable', uncertainty: 'network' },
    });
  });

  it('fails closed for unsupported, extended, decision-bearing, or duplicate-bearing results', () => {
    const sensitiveValues = {
      rawCanonicalReference: 'SECRET-REFERENCE-123',
      receiverIdentifier: '+251900000000',
      providerPayload: '<receipt>secret</receipt>',
      receiptUrl: 'https://provider.invalid/private',
      credential: 'secret-token',
    };
    const malformedCandidates = [
      { ...foundResult, contractVersion: 2 },
      { ...foundResult, providerCode: 'other' },
      { ...foundResult, outcome: 'would_verify' },
      { ...foundResult, decision: 'verified' },
      { ...foundResult, ...sensitiveValues },
      {
        ...foundResult,
        evidence: { ...foundEvidence, duplicateCheck: 'clear' },
      },
      {
        ...foundResult,
        evidence: { ...foundEvidence, canonicalReference: 'SECRET-REFERENCE-123' },
      },
      {
        ...foundResult,
        evidence: {
          ...foundEvidence,
          provenance: { ...foundEvidence.provenance, adapterVersion: 'secret-version' },
        },
      },
    ];

    for (const candidate of malformedCandidates) {
      const result = validatedCbeBirrAuthoritativeAdapterResult(candidate);
      expect(result).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        evidence: { lookupOutcome: 'unavailable', uncertainty: 'parser' },
      });
      const serialized = JSON.stringify(result);
      for (const sensitive of Object.values(sensitiveValues)) {
        expect(serialized).not.toContain(sensitive);
      }
    }
  });

  it('fails closed on invalid timestamps, numeric fields, and provenance', () => {
    const invalidEvidence = [
      { ...foundEvidence, amountMinor: 25.5 },
      { ...foundEvidence, amountMinor: 0 },
      { ...foundEvidence, occurredAt: '2026-08-14T10:05:00Z' },
      { ...foundEvidence, retrievedAt: 'invalid' },
      {
        ...foundEvidence,
        provenance: { ...foundEvidence.provenance, evidenceDigestPresent: 'yes' },
      },
    ];

    for (const evidence of invalidEvidence) {
      expect(
        validatedCbeBirrAuthoritativeAdapterResult({ ...foundResult, evidence }).evidence,
      ).toEqual({ lookupOutcome: 'unavailable', uncertainty: 'parser' });
    }
  });

  it('does not invoke accessors and rejects transparent or hostile proxies', () => {
    let getterCalls = 0;
    const accessorCandidate = Object.defineProperty(
      {
        contractVersion: 1,
        providerCode: 'cbe_birr',
      },
      'evidence',
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return foundResult.evidence;
        },
      },
    );
    const hostileProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile');
        },
      },
    );
    const transparentProxy = new Proxy(foundResult, {});

    expect(validatedCbeBirrAuthoritativeAdapterResult(accessorCandidate).evidence).toEqual({
      lookupOutcome: 'unavailable',
      uncertainty: 'parser',
    });
    expect(getterCalls).toBe(0);
    expect(validatedCbeBirrAuthoritativeAdapterResult(hostileProxy).evidence).toEqual({
      lookupOutcome: 'unavailable',
      uncertainty: 'parser',
    });
    expect(validatedCbeBirrAuthoritativeAdapterResult(transparentProxy).evidence).toEqual({
      lookupOutcome: 'unavailable',
      uncertainty: 'parser',
    });
  });

  it('returns a constant-key log projection without copying caller-controlled values', () => {
    const projection = redactedCbeBirrAuthoritativeAdapterResultForLog({
      ...foundResult,
      rawCanonicalReference: 'SECRET-REFERENCE-123',
    });

    expect(projection).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      safeFactsOnly: true,
      lookupOutcome: 'unavailable',
      uncertainty: 'parser',
    });
    expect(Object.keys(projection)).toEqual([
      'contractVersion',
      'providerCode',
      'safeFactsOnly',
      'lookupOutcome',
      'uncertainty',
    ]);
    expect(JSON.stringify(projection)).not.toContain('SECRET-REFERENCE-123');
    expect(Object.isFrozen(projection)).toBe(true);
  });
});
