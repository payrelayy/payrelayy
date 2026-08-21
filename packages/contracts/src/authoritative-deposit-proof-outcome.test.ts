import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CAN_AUTHORIZE_SQL,
  AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION,
  AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REJECT_REASON_CODES,
  AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REVIEW_REASON_CODES,
  redactedAuthoritativeDepositProofOutcomeForLog,
  validatedAuthoritativeDepositProofOutcomeCandidate,
  type AuthoritativeDepositProofOutcomeCandidate,
  type AuthoritativeDepositProofOutcomeProvider,
} from './authoritative-deposit-proof-outcome.js';

const proofRequestId = '11111111-1111-4111-8111-111111111111';
const receiverRevisionId = '22222222-2222-4222-8222-222222222222';

const disabledCapabilities = {
  advisoryOnly: true,
  sqlAuthorizationAllowed: false,
  transportAllowed: false,
  networkAllowed: false,
  databaseReadAllowed: false,
  databaseWriteAllowed: false,
  persistenceAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
  blindRetryAllowed: false,
} as const;

function commonCandidate(providerCode: AuthoritativeDepositProofOutcomeProvider) {
  return {
    contractVersion: 1,
    proofRequestId,
    providerCode,
    assessmentContractVersion: 1,
    assessmentInputDigest: `sha256:${'a'.repeat(64)}`,
    assessedAt: '2026-08-21T08:00:00.000Z',
    source:
      providerCode === 'cbe_birr'
        ? ('cbe_birr_official_receipt' as const)
        : ('telebirr_official_receipt' as const),
    sourceProfile: `${providerCode}_official_receipt_v1`,
    observationVersion: 1,
    adapterVersion: `${providerCode}_adapter_v1`,
    parserVersion: `${providerCode}_parser_v1`,
    normalizerVersion: `${providerCode}_normalizer_v1`,
    evidenceDigest: `sha256:${'b'.repeat(64)}`,
    retrievedAt: '2026-08-21T07:59:30.000Z',
    ...disabledCapabilities,
  } as const;
}

function settlementCandidate(providerCode: AuthoritativeDepositProofOutcomeProvider) {
  return {
    ...commonCandidate(providerCode),
    disposition: 'settlement_candidate',
    reasonCode: 'exact_proof_match',
    lookupOutcome: 'found',
    provenanceState: 'exact',
    receiptStatus: 'completed',
    transactionType: 'send_money',
    principalAmountMinor: '2500',
    currencyCode: 'ETB',
    occurredAt: '2026-08-21T07:30:00.000Z',
    receiverRevisionId,
    receiverRevisionVersion: 3,
    receiverIdentityDigest: `sha256:${'c'.repeat(64)}`,
    receiverMatchBasis:
      providerCode === 'cbe_birr'
        ? ('exact_account_identifier' as const)
        : ('exact_full_name' as const),
    canonicalReference: {
      protectionProfileVersion: 2,
      encryptionKeyVersion: 2,
      ciphertext: `v2.${providerCode}.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(11)}`,
      fingerprint: 'd'.repeat(64),
      masked: '***AB12',
    },
  } as const;
}

describe('authoritative deposit proof outcome candidate contract', () => {
  it.each(['cbe_birr', 'telebirr'] as const)(
    'reconstructs exact, deeply frozen %s settlement facts without granting authority',
    (providerCode) => {
      const candidate = settlementCandidate(providerCode);
      const validated = validatedAuthoritativeDepositProofOutcomeCandidate(candidate);

      expect(validated).toEqual(candidate);
      expect(validated).not.toBe(candidate);
      expectTypeOf(validated).toMatchTypeOf<
        AuthoritativeDepositProofOutcomeCandidate | undefined
      >();
      expect(Object.isFrozen(validated)).toBe(true);
      expect(validated?.disposition).toBe('settlement_candidate');
      if (validated?.disposition === 'settlement_candidate') {
        expect(Object.isFrozen(validated.canonicalReference)).toBe(true);
      }
      expect(validated).toMatchObject(disabledCapabilities);
      expect(validated).not.toHaveProperty('procedure');
      expect(validated).not.toHaveProperty('arguments');
    },
  );

  it('accepts every exact reject and review pairing and keeps blind retry disabled', () => {
    for (const reasonCode of AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REJECT_REASON_CODES) {
      const validated = validatedAuthoritativeDepositProofOutcomeCandidate({
        ...commonCandidate('cbe_birr'),
        disposition: 'definite_reject',
        reasonCode,
      });
      expect(validated).toMatchObject({ disposition: 'definite_reject', reasonCode });
      expect(validated?.blindRetryAllowed).toBe(false);
      expect(Object.isFrozen(validated)).toBe(true);
    }

    for (const reasonCode of AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REVIEW_REASON_CODES) {
      const validated = validatedAuthoritativeDepositProofOutcomeCandidate({
        ...commonCandidate('telebirr'),
        disposition: 'review_required',
        reasonCode,
      });
      expect(validated).toMatchObject({ disposition: 'review_required', reasonCode });
      expect(validated?.blindRetryAllowed).toBe(false);
      expect(Object.isFrozen(validated)).toBe(true);
    }
  });

  it('rejects crossed dispositions and reason codes exactly', () => {
    for (const candidate of [
      {
        ...commonCandidate('cbe_birr'),
        disposition: 'settlement_candidate',
        reasonCode: 'receiver_mismatch',
      },
      {
        ...commonCandidate('cbe_birr'),
        disposition: 'definite_reject',
        reasonCode: 'exact_proof_match',
      },
      {
        ...commonCandidate('cbe_birr'),
        disposition: 'definite_reject',
        reasonCode: 'source_unavailable',
      },
      {
        ...commonCandidate('telebirr'),
        disposition: 'review_required',
        reasonCode: 'receipt_failed',
      },
    ]) {
      expect(validatedAuthoritativeDepositProofOutcomeCandidate(candidate)).toBeUndefined();
    }
  });

  it('binds official source, receiver basis, and protected ciphertext to the provider', () => {
    const cbeBirr = settlementCandidate('cbe_birr');
    const telebirr = settlementCandidate('telebirr');

    for (const candidate of [
      { ...cbeBirr, source: 'telebirr_official_receipt' },
      { ...cbeBirr, receiverMatchBasis: 'exact_full_name' },
      { ...cbeBirr, canonicalReference: telebirr.canonicalReference },
      { ...telebirr, source: 'cbe_birr_official_receipt' },
      { ...telebirr, receiverMatchBasis: 'exact_account_identifier' },
      { ...telebirr, canonicalReference: cbeBirr.canonicalReference },
    ]) {
      expect(validatedAuthoritativeDepositProofOutcomeCandidate(candidate)).toBeUndefined();
    }
  });

  it('enforces canonical IDs, timestamps, digests, amount, revision, and version labels', () => {
    const baseline = settlementCandidate('cbe_birr');
    const invalidCandidates = [
      { ...baseline, proofRequestId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
      { ...baseline, proofRequestId: '11111111-1111-0111-8111-111111111111' },
      { ...baseline, receiverRevisionId: 'not-a-uuid' },
      { ...baseline, assessedAt: '2026-08-21T08:00:00Z' },
      { ...baseline, occurredAt: '2026-08-21T07:30:00.001+00:00' },
      { ...baseline, retrievedAt: 'invalid' },
      { ...baseline, assessmentInputDigest: `SHA256:${'a'.repeat(64)}` },
      { ...baseline, evidenceDigest: 'b'.repeat(64) },
      { ...baseline, receiverIdentityDigest: `sha256:${'C'.repeat(64)}` },
      { ...baseline, principalAmountMinor: '0' },
      { ...baseline, principalAmountMinor: '02500' },
      { ...baseline, principalAmountMinor: '25.00' },
      { ...baseline, receiverRevisionVersion: 0 },
      { ...baseline, receiverRevisionVersion: 1.5 },
      { ...baseline, sourceProfile: '' },
      { ...baseline, sourceProfile: 'unversioned_profile' },
      { ...baseline, sourceProfile: 'contains whitespace v1' },
      { ...baseline, sourceProfile: 'a'.repeat(97) },
    ];

    for (const candidate of invalidCandidates) {
      expect(validatedAuthoritativeDepositProofOutcomeCandidate(candidate)).toBeUndefined();
    }
  });

  it('enforces exact protected-reference versions, ciphertext, fingerprint, and mask', () => {
    const baseline = settlementCandidate('telebirr');
    const protectedReference = baseline.canonicalReference;
    const invalidReferences = [
      { ...protectedReference, protectionProfileVersion: 1 },
      { ...protectedReference, encryptionKeyVersion: 1 },
      { ...protectedReference, ciphertext: protectedReference.ciphertext.replace('v2.', 'v1.') },
      { ...protectedReference, ciphertext: `${protectedReference.ciphertext}.extra` },
      { ...protectedReference, fingerprint: 'D'.repeat(64) },
      { ...protectedReference, fingerprint: 'd'.repeat(63) },
      { ...protectedReference, masked: '***ab12' },
      { ...protectedReference, masked: '***AB-2' },
    ];

    for (const canonicalReference of invalidReferences) {
      expect(
        validatedAuthoritativeDepositProofOutcomeCandidate({
          ...baseline,
          canonicalReference,
        }),
      ).toBeUndefined();
    }
  });

  it('rejects extras, symbols, non-enumerable values, accessors, and proxies without traps', () => {
    const baseline = settlementCandidate('cbe_birr');
    let accessorReads = 0;
    let proxyTrapCalls = 0;
    const accessorCandidate = { ...baseline } as Record<string, unknown>;
    Object.defineProperty(accessorCandidate, 'reasonCode', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'exact_proof_match';
      },
    });
    const nonEnumerableCandidate = { ...baseline } as Record<string, unknown>;
    Object.defineProperty(nonEnumerableCandidate, 'reasonCode', {
      enumerable: false,
      value: 'exact_proof_match',
    });
    const symbolCandidate = { ...baseline, [Symbol('secret')]: true };
    const hostileProxy = new Proxy(baseline as object, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('proxy trap must not run');
      },
      getPrototypeOf() {
        proxyTrapCalls += 1;
        throw new Error('proxy trap must not run');
      },
    });
    const transparentProxy = new Proxy(baseline, {});
    const nestedAccessorReference = { ...baseline.canonicalReference } as Record<string, unknown>;
    Object.defineProperty(nestedAccessorReference, 'fingerprint', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'd'.repeat(64);
      },
    });
    const nestedAccessorCandidate = {
      ...baseline,
      canonicalReference: nestedAccessorReference,
    };
    const nestedProxyCandidate = {
      ...baseline,
      canonicalReference: new Proxy(baseline.canonicalReference, {
        ownKeys() {
          proxyTrapCalls += 1;
          throw new Error('nested proxy trap must not run');
        },
      }),
    };
    const revoked = Proxy.revocable(baseline as object, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('revoked proxy trap must not run');
      },
    });
    revoked.revoke();

    for (const candidate of [
      { ...baseline, extra: true },
      symbolCandidate,
      nonEnumerableCandidate,
      accessorCandidate,
      Object.assign(Object.create({ inherited: true }), baseline),
      hostileProxy,
      transparentProxy,
      nestedAccessorCandidate,
      nestedProxyCandidate,
      revoked.proxy,
    ]) {
      expect(validatedAuthoritativeDepositProofOutcomeCandidate(candidate)).toBeUndefined();
    }
    expect(accessorReads).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  it('makes raw provider material structurally unrepresentable', () => {
    const baseline = settlementCandidate('cbe_birr');
    for (const candidate of [
      { ...baseline, canonicalReferenceRaw: 'SECRET-REFERENCE' },
      { ...baseline, rawProviderBody: '<html>secret receipt</html>' },
      { ...baseline, receiptUrl: 'https://provider.invalid/private' },
      {
        ...baseline,
        canonicalReference: {
          ...baseline.canonicalReference,
          rawReference: 'SECRET-REFERENCE',
        },
      },
    ]) {
      expect(validatedAuthoritativeDepositProofOutcomeCandidate(candidate)).toBeUndefined();
    }
  });

  it('returns a fixed, deeply frozen, redacted review projection for hostile or invalid input', () => {
    const sensitive = settlementCandidate('cbe_birr');
    const validProjection = redactedAuthoritativeDepositProofOutcomeForLog(sensitive);
    const invalidProjection = redactedAuthoritativeDepositProofOutcomeForLog({
      ...sensitive,
      rawProviderBody: 'DO-NOT-LOG-THIS',
    });

    expect(validProjection).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      safeFactsOnly: true,
      disposition: 'settlement_candidate',
      reasonCode: 'exact_proof_match',
      ...disabledCapabilities,
    });
    expect(invalidProjection).toEqual({
      contractVersion: 1,
      providerCode: 'unknown',
      safeFactsOnly: true,
      disposition: 'review_required',
      reasonCode: 'invalid_assessment_input',
      ...disabledCapabilities,
    });
    expect(Object.isFrozen(validProjection)).toBe(true);
    expect(Object.isFrozen(invalidProjection)).toBe(true);
    const serialized = JSON.stringify([validProjection, invalidProjection]);
    expect(serialized).not.toContain(sensitive.proofRequestId);
    expect(serialized).not.toContain(sensitive.canonicalReference.ciphertext);
    expect(serialized).not.toContain(sensitive.canonicalReference.fingerprint);
    expect(serialized).not.toContain(sensitive.canonicalReference.masked);
    expect(serialized).not.toContain('DO-NOT-LOG-THIS');
  });

  it('exports an explicit non-SQL-authority invariant', () => {
    expect(AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION).toBe(1);
    expect(AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CAN_AUTHORIZE_SQL).toBe(false);
  });
});
