import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION,
  DEPOSIT_PROOF_AUTOMATIC_FRESHNESS_SECONDS,
  DEPOSIT_PROOF_MAXIMUM_FUTURE_SKEW_SECONDS,
  DEPOSIT_PROOF_MAXIMUM_PRINCIPAL_MINOR,
  DEPOSIT_PROOF_MINIMUM_PRINCIPAL_MINOR,
  DEPOSIT_PROOF_REFERENCE_KEY_VERSION,
  DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION,
  assessOfficialDepositProof,
  redactedDepositProofAssessmentForLog,
  type DepositProofAssessmentDecision,
  type DepositProofAssessmentInput,
  type DepositProofAssessmentProvider,
  type OfficialDepositProofObservation,
} from './index.js';

const fingerprint = (character: string): string => character.repeat(64);
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const allCapabilitiesDisabled = {
  transportAllowed: false,
  networkAllowed: false,
  databaseWriteAllowed: false,
  settlementAllowed: false,
  claimAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
  blindRetryAllowed: false,
} as const;

interface InputOverrides {
  readonly assessedAt?: string;
  readonly proofRequest?: Readonly<Record<string, unknown>>;
  readonly officialObservation?: Readonly<Record<string, unknown>>;
  readonly receiver?: Readonly<Record<string, unknown>> | null;
  readonly receiverAtOccurredAt?: Readonly<Record<string, unknown>>;
  readonly currentPolicy?: Readonly<Record<string, unknown>>;
  readonly currentEligibility?: Readonly<Record<string, unknown>>;
  readonly duplicateState?: Readonly<Record<string, unknown>>;
}

function sourceFor(
  provider: DepositProofAssessmentProvider,
): OfficialDepositProofObservation['source'] {
  return provider === 'cbe_birr' ? 'cbe_birr_official_receipt' : 'telebirr_official_receipt';
}

function sourceProfileFor(provider: DepositProofAssessmentProvider): string {
  return provider === 'cbe_birr' ? 'cbe_birr_official_receipt_v1' : 'telebirr_official_receipt_v1';
}

function inputWith(overrides: InputOverrides = {}): DepositProofAssessmentInput {
  const requestProvider =
    (overrides.proofRequest?.providerCode as DepositProofAssessmentProvider | undefined) ??
    'cbe_birr';
  const observationProvider =
    (overrides.officialObservation?.providerCode as DepositProofAssessmentProvider | undefined) ??
    requestProvider;
  const observedSource = sourceFor(observationProvider);
  const observedSourceProfile = sourceProfileFor(observationProvider);
  const occurredAt =
    overrides.officialObservation?.occurredAt === undefined
      ? '2026-08-20T11:30:00.000Z'
      : (overrides.officialObservation.occurredAt as string | null);
  const baselineReceiver = {
    identityDigest: digest('a'),
    matchBasis:
      observationProvider === 'cbe_birr'
        ? ('exact_account_identifier' as const)
        : ('exact_full_name' as const),
  };
  const receiver =
    overrides.receiver === undefined
      ? baselineReceiver
      : overrides.receiver === null
        ? null
        : { ...baselineReceiver, ...overrides.receiver };

  const proofRequest = {
    proofRequestId: 'fixture-proof-request-0001',
    providerCode: requestProvider,
    referenceFingerprint: fingerprint('1'),
    referenceKeyVersion: 2,
    referenceProfileVersion: 2,
    selectedPlayerId: 'PLAYER_FIXTURE_001',
    submittedAt: '2026-08-20T12:00:00.000Z',
    ...overrides.proofRequest,
  };
  const officialObservation = {
    observationVersion: 1,
    providerCode: observationProvider,
    lookupOutcome: 'found',
    provenanceState: 'exact',
    canonicalReferenceFingerprint: fingerprint('1'),
    receiptStatus: 'completed',
    transactionType: 'send_money',
    principalAmountMinor: '10000',
    currencyCode: 'ETB',
    occurredAt,
    retrievedAt: '2026-08-20T12:01:00.000Z',
    receiver,
    evidenceDigest: digest('b'),
    adapterVersion: 'official_lookup_adapter_v1',
    parserVersion: 'official_receipt_parser_v1',
    normalizerVersion: 'official_receipt_normalizer_v1',
    sourceProfile: observedSourceProfile,
    source: observedSource,
    ...overrides.officialObservation,
  };
  const assessedAt = overrides.assessedAt ?? '2026-08-20T12:02:00.000Z';
  const currentPolicy = {
    state: 'available',
    providerCode: requestProvider,
    checkedAt: assessedAt,
    policyVersion: 'deposit_policy_v1',
    currencyCode: 'ETB',
    minimumPrincipalAmountMinor: '2500',
    maximumPrincipalAmountMinor: '2500000',
    automaticFreshnessSeconds: 3600,
    maximumFutureSkewSeconds: 300,
    allowedTransactionType: 'send_money',
    acceptedSource: sourceFor(requestProvider),
    acceptedSourceProfile: sourceProfileFor(requestProvider),
    acceptedAdapterVersion: 'official_lookup_adapter_v1',
    acceptedParserVersion: 'official_receipt_parser_v1',
    acceptedNormalizerVersion: 'official_receipt_normalizer_v1',
    ...overrides.currentPolicy,
  };
  const currentEligibility = {
    state: 'eligible',
    selectedPlayerId: proofRequest.selectedPlayerId,
    checkedAt: assessedAt,
    decisionVersion: 'player_eligibility_v1',
    ...overrides.currentEligibility,
  };
  const duplicateState = {
    state: 'unused',
    providerCode: requestProvider,
    canonicalReferenceFingerprint: proofRequest.referenceFingerprint,
    checkedAt: assessedAt,
    ...overrides.duplicateState,
  };
  const receiverAtOccurredAt = {
    state: 'exact',
    providerCode: requestProvider,
    resolvedForOccurredAt: occurredAt,
    revisionId: 'fixture-receiver-revision-0001',
    identityDigest: receiver?.identityDigest ?? null,
    matchBasis: receiver?.matchBasis ?? null,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    effectiveUntil: null,
    ...overrides.receiverAtOccurredAt,
  };

  return {
    contractVersion: 1,
    assessedAt,
    proofRequest,
    officialObservation,
    databaseFacts: {
      receiverAtOccurredAt,
      currentPolicy,
      currentEligibility,
      duplicateState,
    },
  } as DepositProofAssessmentInput;
}

function noReceiptObservation(
  lookupOutcome: 'not_found' | 'unavailable' | 'ambiguous',
  provenanceState: 'exact' | 'source_uncertain' = lookupOutcome === 'not_found'
    ? 'exact'
    : 'source_uncertain',
): Readonly<Record<string, unknown>> {
  return {
    lookupOutcome,
    provenanceState,
    canonicalReferenceFingerprint: null,
    receiptStatus: null,
    transactionType: null,
    principalAmountMinor: null,
    currencyCode: null,
    occurredAt: null,
    receiver: null,
  };
}

function unavailablePolicy(checkedAt = '2026-08-20T12:02:00.000Z') {
  return {
    state: 'unavailable',
    checkedAt,
    policyVersion: null,
    currencyCode: null,
    minimumPrincipalAmountMinor: null,
    maximumPrincipalAmountMinor: null,
    automaticFreshnessSeconds: null,
    maximumFutureSkewSeconds: null,
    allowedTransactionType: null,
    acceptedSource: null,
    acceptedSourceProfile: null,
    acceptedAdapterVersion: null,
    acceptedParserVersion: null,
    acceptedNormalizerVersion: null,
  } as const;
}

function unavailableReceiver(
  state: 'gap' | 'overlap' | 'unavailable',
): Readonly<Record<string, unknown>> {
  return {
    state,
    revisionId: null,
    identityDigest: null,
    matchBasis: null,
    effectiveFrom: null,
    effectiveUntil: null,
  };
}

describe('provider-neutral official deposit proof assessment', () => {
  it('pins the contract, v2 reference binding, amount, freshness, and skew limits', () => {
    expect(DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION).toBe(1);
    expect(DEPOSIT_PROOF_REFERENCE_KEY_VERSION).toBe(2);
    expect(DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION).toBe(2);
    expect(DEPOSIT_PROOF_MINIMUM_PRINCIPAL_MINOR).toBe('2500');
    expect(DEPOSIT_PROOF_MAXIMUM_PRINCIPAL_MINOR).toBe('2500000');
    expect(DEPOSIT_PROOF_AUTOMATIC_FRESHNESS_SECONDS).toBe(3600);
    expect(DEPOSIT_PROOF_MAXIMUM_FUTURE_SKEW_SECONDS).toBe(300);
  });

  it.each(['cbe_birr', 'telebirr'] as const)(
    'would verify one exact %s proof with its provider-specific receiver basis and no authority',
    (providerCode) => {
      const decision = assessOfficialDepositProof(inputWith({ proofRequest: { providerCode } }));

      expect(decision).toEqual({
        contractVersion: 1,
        providerCode,
        advisoryOnly: true,
        disposition: 'would_verify',
        reasonCode: 'exact_proof_match',
        ...allCapabilitiesDisabled,
      });
      expect(Object.isFrozen(decision)).toBe(true);
      expectTypeOf(decision).toMatchTypeOf<DepositProofAssessmentDecision>();
    },
  );

  it.each([
    ['minimum', '2500'],
    ['maximum', '2500000'],
  ] as const)('includes the exact %s policy amount boundary', (_label, principalAmountMinor) => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { principalAmountMinor } })),
    ).toMatchObject({ disposition: 'would_verify', reasonCode: 'exact_proof_match' });
  });

  it.each([
    ['same instant', '2026-08-20T12:00:00.000Z'],
    ['exactly one hour earlier', '2026-08-20T11:00:00.000Z'],
  ] as const)('includes the %s pre-flow freshness boundary', (_label, occurredAt) => {
    expect(
      assessOfficialDepositProof(
        inputWith({
          officialObservation: { occurredAt },
          receiverAtOccurredAt: { resolvedForOccurredAt: occurredAt },
        }),
      ),
    ).toMatchObject({ disposition: 'would_verify' });
  });

  it('uses only receipt principal and exposes no sender-identity comparison input', () => {
    const input = inputWith();
    expect(Reflect.ownKeys(input.officialObservation)).not.toContain('sender');
    expect(Reflect.ownKeys(input.databaseFacts)).not.toContain('senderIdentity');
    expect(assessOfficialDepositProof(input)).toMatchObject({ disposition: 'would_verify' });

    expect(
      assessOfficialDepositProof({
        ...input,
        officialObservation: { ...input.officialObservation, senderName: 'synthetic-only' },
      }),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'invalid_assessment_input' });
  });

  it.each([
    ['unavailable', 'eligibility_unavailable'],
    ['ambiguous', 'eligibility_ambiguous'],
  ] as const)('reviews %s current eligibility fail closed', (state, reasonCode) => {
    expect(
      assessOfficialDepositProof(
        inputWith({ currentEligibility: { state, decisionVersion: null } }),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode, ...allCapabilitiesDisabled });
  });

  it('rejects definite current ineligibility without revealing a Player ID', () => {
    const decision = assessOfficialDepositProof(
      inputWith({ currentEligibility: { state: 'ineligible' } }),
    );
    expect(decision).toMatchObject({
      disposition: 'would_reject',
      reasonCode: 'player_ineligible',
    });
    expect(JSON.stringify(decision)).not.toContain('PLAYER_FIXTURE');
  });

  it('returns only a generic reused-reference rejection', () => {
    const decision = assessOfficialDepositProof(inputWith({ duplicateState: { state: 'reused' } }));
    expect(decision).toMatchObject({
      disposition: 'would_reject',
      reasonCode: 'duplicate_reference_reused',
    });
    expect(Reflect.ownKeys(decision)).not.toContain('previousPlayerId');
    expect(Reflect.ownKeys(decision)).not.toContain('previousCustomerId');
  });

  it.each([
    ['unavailable', 'duplicate_check_unavailable'],
    ['ambiguous', 'duplicate_check_ambiguous'],
  ] as const)('reviews a %s duplicate check with no blind retry', (state, reasonCode) => {
    expect(assessOfficialDepositProof(inputWith({ duplicateState: { state } }))).toMatchObject({
      disposition: 'would_review',
      reasonCode,
      blindRetryAllowed: false,
    });
  });

  it('reviews unavailable current policy', () => {
    expect(
      assessOfficialDepositProof(inputWith({ currentPolicy: unavailablePolicy() })),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'policy_unavailable' });
  });

  it.each([
    ['minimumPrincipalAmountMinor', '2499'],
    ['maximumPrincipalAmountMinor', '2500001'],
    ['automaticFreshnessSeconds', 3599],
    ['maximumFutureSkewSeconds', 301],
  ] as const)('reviews an unreviewed %s policy change', (field, value) => {
    expect(
      assessOfficialDepositProof(inputWith({ currentPolicy: { [field]: value } })),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'policy_contract_mismatch' });
  });

  it.each([
    ['policy provider', { currentPolicy: { providerCode: 'telebirr' } }],
    ['policy timestamp', { currentPolicy: { checkedAt: '2026-08-20T12:01:59.999Z' } }],
    ['eligibility Player ID', { currentEligibility: { selectedPlayerId: 'PLAYER_FIXTURE_002' } }],
    ['eligibility timestamp', { currentEligibility: { checkedAt: '2026-08-20T12:01:59.999Z' } }],
    ['duplicate provider', { duplicateState: { providerCode: 'telebirr' } }],
    [
      'duplicate fingerprint',
      { duplicateState: { canonicalReferenceFingerprint: fingerprint('2') } },
    ],
    ['duplicate timestamp', { duplicateState: { checkedAt: '2026-08-20T12:01:59.999Z' } }],
  ] as const)('reviews an unbound %s fact', (_label, override) => {
    expect(assessOfficialDepositProof(inputWith(override))).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'database_facts_unbound',
    });
  });

  it('rejects a definite cross-provider observation', () => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { providerCode: 'telebirr' } })),
    ).toMatchObject({ disposition: 'would_reject', reasonCode: 'provider_mismatch' });
  });

  it.each([
    ['unavailable', 'source_unavailable'],
    ['ambiguous', 'source_ambiguous'],
  ] as const)('reviews an official source %s outcome', (lookupOutcome, reasonCode) => {
    expect(
      assessOfficialDepositProof(
        inputWith({
          officialObservation: noReceiptObservation(lookupOutcome),
          receiverAtOccurredAt: {
            resolvedForOccurredAt: null,
            ...unavailableReceiver('unavailable'),
          },
        }),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it.each([
    ['source_uncertain', 'source_uncertain'],
    ['unsupported', 'source_unsupported'],
    ['parser_uncertain', 'parser_uncertain'],
  ] as const)('reviews %s provenance', (provenanceState, reasonCode) => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { provenanceState } })),
    ).toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it('rejects a definite official not-found result', () => {
    expect(
      assessOfficialDepositProof(
        inputWith({
          officialObservation: noReceiptObservation('not_found'),
          receiverAtOccurredAt: {
            resolvedForOccurredAt: null,
            ...unavailableReceiver('unavailable'),
          },
        }),
      ),
    ).toMatchObject({ disposition: 'would_reject', reasonCode: 'reference_not_found' });
  });

  it.each([
    ['sourceProfile', 'cbe_birr_official_receipt_v2'],
    ['adapterVersion', 'official_lookup_adapter_v2'],
    ['parserVersion', 'official_receipt_parser_v2'],
    ['normalizerVersion', 'official_receipt_normalizer_v2'],
  ] as const)('reviews unsupported observation %s', (field, value) => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { [field]: value } })),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'observation_version_unsupported' });
  });

  it('rejects a definite same-provider reference mismatch', () => {
    expect(
      assessOfficialDepositProof(
        inputWith({
          officialObservation: { canonicalReferenceFingerprint: fingerprint('2') },
        }),
      ),
    ).toMatchObject({ disposition: 'would_reject', reasonCode: 'reference_mismatch' });
  });

  it.each([
    ['failed', 'would_reject', 'receipt_failed'],
    ['pending', 'would_review', 'receipt_pending'],
    ['unknown', 'would_review', 'receipt_status_unknown'],
  ] as const)('routes a %s receipt status to %s', (receiptStatus, disposition, reasonCode) => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { receiptStatus } })),
    ).toMatchObject({ disposition, reasonCode });
  });

  it.each(['unsupported', 'unknown'] as const)('reviews %s transaction type', (transactionType) => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { transactionType } })),
    ).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'transaction_type_unsupported',
    });
  });

  it('rejects a definite non-ETB receipt', () => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { currencyCode: 'USD' } })),
    ).toMatchObject({ disposition: 'would_reject', reasonCode: 'currency_not_etb' });
  });

  it.each([
    ['gap', 'receiver_history_gap'],
    ['overlap', 'receiver_history_overlap'],
    ['unavailable', 'receiver_history_unavailable'],
  ] as const)('reviews a historical receiver %s', (state, reasonCode) => {
    expect(
      assessOfficialDepositProof(inputWith({ receiverAtOccurredAt: unavailableReceiver(state) })),
    ).toMatchObject({ disposition: 'would_review', reasonCode });
  });

  it('rejects a definite receiver identity mismatch on the correct provider basis', () => {
    expect(
      assessOfficialDepositProof(
        inputWith({
          receiver: { identityDigest: digest('c') },
          receiverAtOccurredAt: { identityDigest: digest('a') },
        }),
      ),
    ).toMatchObject({
      disposition: 'would_reject',
      reasonCode: 'receiver_mismatch',
    });
  });

  it.each([
    [
      'CBE observation uses a full name against an account-identifier revision',
      'cbe_birr',
      'exact_full_name',
      'exact_account_identifier',
    ],
    [
      'CBE historical revision uses a full name against an account-identifier observation',
      'cbe_birr',
      'exact_account_identifier',
      'exact_full_name',
    ],
    [
      'CBE observation and revision correlate on the wrong full-name basis',
      'cbe_birr',
      'exact_full_name',
      'exact_full_name',
    ],
    [
      'TeleBirr observation uses an account identifier against a full-name revision',
      'telebirr',
      'exact_account_identifier',
      'exact_full_name',
    ],
    [
      'TeleBirr historical revision uses an account identifier against a full-name observation',
      'telebirr',
      'exact_full_name',
      'exact_account_identifier',
    ],
    [
      'TeleBirr observation and revision correlate on the wrong account-identifier basis',
      'telebirr',
      'exact_account_identifier',
      'exact_account_identifier',
    ],
  ] as const)('reviews $0', (_label, providerCode, observationMatchBasis, historicalMatchBasis) => {
    const decision = assessOfficialDepositProof(
      inputWith({
        proofRequest: { providerCode },
        receiver: { matchBasis: observationMatchBasis },
        receiverAtOccurredAt: { matchBasis: historicalMatchBasis },
      }),
    );

    expect(decision).toEqual({
      contractVersion: 1,
      providerCode,
      advisoryOnly: true,
      disposition: 'would_review',
      reasonCode: 'receiver_match_basis_unsupported',
      ...allCapabilitiesDisabled,
    });
    expect(redactedDepositProofAssessmentForLog(decision)).toEqual(decision);
  });

  it('rejects a hostile, non-allowlisted receiver basis as invalid input', () => {
    expect(
      assessOfficialDepositProof(
        inputWith({ receiver: { matchBasis: 'caller_asserted_receiver' } }),
      ),
    ).toMatchObject({
      providerCode: 'unknown',
      disposition: 'would_review',
      reasonCode: 'invalid_assessment_input',
      ...allCapabilitiesDisabled,
    });
  });

  it('uses the historical revision covering occurredAt, not a current receiver', () => {
    const occurredAt = '2026-08-20T11:30:00.000Z';
    expect(
      assessOfficialDepositProof(
        inputWith({
          officialObservation: { occurredAt },
          receiverAtOccurredAt: {
            resolvedForOccurredAt: occurredAt,
            effectiveFrom: '2026-08-20T11:00:00.000Z',
            effectiveUntil: '2026-08-20T11:45:00.000Z',
          },
        }),
      ),
    ).toMatchObject({ disposition: 'would_verify' });

    expect(
      assessOfficialDepositProof(
        inputWith({ receiverAtOccurredAt: { effectiveUntil: '2026-08-20T11:30:00.000Z' } }),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'database_facts_unbound' });
  });

  it.each([
    ['below minimum', '2499'],
    ['above maximum', '2500001'],
  ] as const)('reviews a receipt amount %s', (_label, principalAmountMinor) => {
    expect(
      assessOfficialDepositProof(inputWith({ officialObservation: { principalAmountMinor } })),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'amount_out_of_range' });
  });

  it('reviews a receipt older than one hour by one millisecond', () => {
    const occurredAt = '2026-08-20T10:59:59.999Z';
    expect(
      assessOfficialDepositProof(
        inputWith({
          officialObservation: { occurredAt },
          receiverAtOccurredAt: { resolvedForOccurredAt: occurredAt },
        }),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'receipt_too_old' });
  });

  it('reviews a receipt timestamp after submission by one millisecond', () => {
    const occurredAt = '2026-08-20T12:00:00.001Z';
    expect(
      assessOfficialDepositProof(
        inputWith({
          officialObservation: { occurredAt },
          receiverAtOccurredAt: { resolvedForOccurredAt: occurredAt },
        }),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'receipt_after_submission' });
  });

  it.each([
    ['submittedAt', { proofRequest: { submittedAt: '2026-08-20T12:07:00.001Z' } }],
    ['retrievedAt', { officialObservation: { retrievedAt: '2026-08-20T12:07:00.001Z' } }],
    [
      'occurredAt beyond retrieval',
      {
        officialObservation: {
          occurredAt: '2026-08-20T12:06:00.001Z',
          retrievedAt: '2026-08-20T12:01:00.000Z',
        },
        proofRequest: { submittedAt: '2026-08-20T12:06:00.001Z' },
        receiverAtOccurredAt: { resolvedForOccurredAt: '2026-08-20T12:06:00.001Z' },
      },
    ],
  ] as const)('reviews excessive future skew in %s', (_label, override) => {
    expect(assessOfficialDepositProof(inputWith(override))).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'future_skew_exceeded',
    });
  });

  it('makes the injected future-skew limit explicit and includes its exact boundary', () => {
    expect(
      assessOfficialDepositProof(
        inputWith({
          assessedAt: '2026-08-20T12:02:00.000Z',
          proofRequest: { submittedAt: '2026-08-20T12:00:00.000Z' },
          officialObservation: { retrievedAt: '2026-08-20T12:07:00.000Z' },
          currentPolicy: { maximumFutureSkewSeconds: 300 },
        }),
      ),
    ).toMatchObject({ disposition: 'would_verify' });
  });

  it('rejects malformed shapes, extras, accessors, proxies, symbols, and hostile prototypes', () => {
    const getter = vi.fn(() => 1);
    const accessor = Object.defineProperty({}, 'contractVersion', {
      enumerable: true,
      get: getter,
    });
    const proxy = new Proxy(inputWith(), {});
    const extra = { ...inputWith(), rawReference: 'SYNTHETIC_REFERENCE' };
    const symbol = { ...inputWith(), [Symbol('hidden')]: true };
    const hostilePrototype = Object.assign(Object.create({ inherited: true }), inputWith());
    const array = [inputWith()];

    for (const candidate of [accessor, proxy, extra, symbol, hostilePrototype, array, null]) {
      expect(assessOfficialDepositProof(candidate)).toEqual({
        contractVersion: 1,
        providerCode: 'unknown',
        advisoryOnly: true,
        disposition: 'would_review',
        reasonCode: 'invalid_assessment_input',
        ...allCapabilitiesDisabled,
      });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ['mixed-case fingerprint', { proofRequest: { referenceFingerprint: fingerprint('A') } }],
    ['legacy key version', { proofRequest: { referenceKeyVersion: 1 } }],
    ['legacy profile version', { proofRequest: { referenceProfileVersion: 1 } }],
    ['uncanonical timestamp', { proofRequest: { submittedAt: '2026-08-20T12:00:00Z' } }],
    ['unsafe Player ID', { proofRequest: { selectedPlayerId: 'PLAYER ID' } }],
    ['fractional principal', { officialObservation: { principalAmountMinor: '2500.00' } }],
    ['leading-zero principal', { officialObservation: { principalAmountMinor: '02500' } }],
  ] as const)('fails hostile or noncanonical %s input closed', (_label, override) => {
    expect(assessOfficialDepositProof(inputWith(override))).toMatchObject({
      providerCode: 'unknown',
      disposition: 'would_review',
      reasonCode: 'invalid_assessment_input',
      ...allCapabilitiesDisabled,
    });
  });

  it('requires found and non-found observation unions to have exact fact presence', () => {
    expect(
      assessOfficialDepositProof(
        inputWith({ officialObservation: { lookupOutcome: 'not_found' } }),
      ),
    ).toMatchObject({ reasonCode: 'invalid_assessment_input' });
    expect(
      assessOfficialDepositProof(
        inputWith({ officialObservation: { principalAmountMinor: null } }),
      ),
    ).toMatchObject({ reasonCode: 'invalid_assessment_input' });
  });

  it('projects only a revalidated, fixed, non-sensitive decision', () => {
    const decision = assessOfficialDepositProof(inputWith());
    const projection = redactedDepositProofAssessmentForLog(decision);
    const serialized = JSON.stringify(projection);

    expect(projection).toEqual(decision);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(serialized).not.toContain('fixture-proof');
    expect(serialized).not.toContain('PLAYER_FIXTURE');
    expect(serialized).not.toContain(fingerprint('1'));
    expect(serialized).not.toContain(digest('a'));
    expect(serialized).not.toContain('10000');
    const exactProjectionKeys = [
      'contractVersion',
      'providerCode',
      'advisoryOnly',
      'disposition',
      'reasonCode',
      'transportAllowed',
      'networkAllowed',
      'databaseWriteAllowed',
      'settlementAllowed',
      'claimAllowed',
      'enqueueAllowed',
      'executionAllowed',
      'financialActionAllowed',
      'blindRetryAllowed',
    ];
    expect(Reflect.ownKeys(projection)).toHaveLength(exactProjectionKeys.length);
    expect(Reflect.ownKeys(projection)).toEqual(expect.arrayContaining(exactProjectionKeys));
  });

  it('fails tampered or accessor-bearing log candidates to a safe redacted review', () => {
    const valid = assessOfficialDepositProof(inputWith());
    const getter = vi.fn(() => 'would_verify');
    const accessor = Object.defineProperty({}, 'disposition', {
      enumerable: true,
      get: getter,
    });
    for (const candidate of [
      { ...valid, claimAllowed: true },
      { ...valid, reasonCode: 'customer-supplied-text' },
      { ...valid, rawReference: 'SYNTHETIC_REFERENCE' },
      accessor,
      new Proxy(valid, {}),
    ]) {
      expect(redactedDepositProofAssessmentForLog(candidate)).toMatchObject({
        providerCode: 'unknown',
        disposition: 'would_review',
        reasonCode: 'invalid_assessment_input',
        ...allCapabilitiesDisabled,
      });
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
