import { describe, expect, it } from 'vitest';

import {
  evaluateCbeBirrAuthoritativeShadow,
  validatedCbeBirrAuthoritativeAdapterResult,
  type CbeBirrAuthoritativeShadowDecision,
  type CbeBirrAuthoritativeShadowInput,
} from '@fetanagent/contracts';

import {
  CBE_BIRR_AUTHORITATIVE_FIXTURE_NORMALIZER_VERSION,
  CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA,
  CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA_VERSION,
  normalizeCbeBirrAuthoritativeFixtureResponse,
  redactedCbeBirrAuthoritativeFixtureIds,
  redactedCbeBirrAuthoritativeFixtureNormalizationForLog,
  redactedCbeBirrAuthoritativeFixtureResponses,
  type CbeBirrAuthoritativeNormalizedFixtureEvidence,
} from './index.js';

const baselineIntent: CbeBirrAuthoritativeShadowInput['intent'] = {
  state: 'intake_received',
  openReview: false,
  expectedAmountMinor: 2_500,
  currencyCode: 'ETB',
  openedAt: '2026-08-14T10:00:00.000Z',
  paymentDeadlineAt: '2026-08-14T11:00:00.000Z',
};

type DuplicateCheck = 'clear' | 'reused' | 'unavailable';

function addExplicitDuplicateCheck(
  evidence: CbeBirrAuthoritativeNormalizedFixtureEvidence,
  duplicateCheck: DuplicateCheck,
): CbeBirrAuthoritativeShadowInput['evidence'] {
  return evidence.lookupOutcome === 'found' ? { ...evidence, duplicateCheck } : evidence;
}

function evaluateFixture(
  fixtureKey: keyof typeof redactedCbeBirrAuthoritativeFixtureResponses,
  duplicateCheck: DuplicateCheck,
): CbeBirrAuthoritativeShadowDecision {
  return evaluateCandidate(
    redactedCbeBirrAuthoritativeFixtureResponses[fixtureKey],
    duplicateCheck,
  );
}

function evaluateCandidate(
  candidate: unknown,
  duplicateCheck: DuplicateCheck,
): CbeBirrAuthoritativeShadowDecision {
  const normalizedEvidence = normalizeCbeBirrAuthoritativeFixtureResponse(candidate);
  const evidence = validatedCbeBirrAuthoritativeAdapterResult({
    contractVersion: 1,
    providerCode: 'cbe_birr',
    evidence: normalizedEvidence,
  }).evidence;
  return evaluateCbeBirrAuthoritativeShadow({
    contractVersion: 1,
    intent: baselineIntent,
    assessedAt: '2026-08-14T10:10:00.000Z',
    evidence: addExplicitDuplicateCheck(evidence, duplicateCheck),
  });
}

const parserUnavailable = { lookupOutcome: 'unavailable', uncertainty: 'parser' } as const;

describe('CBE Birr authoritative-response fixtures', () => {
  it('freezes the fixture and normalizer versions', () => {
    expect(CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA).toBe(
      'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V1',
    );
    expect(CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA_VERSION).toBe(1);
    expect(CBE_BIRR_AUTHORITATIVE_FIXTURE_NORMALIZER_VERSION).toBe(1);
    expect(redactedCbeBirrAuthoritativeFixtureIds).toEqual({
      completed: 'completed',
      wrongReceiver: 'wrong-receiver',
      providerIdentityMismatch: 'provider-identity-mismatch',
      wrongAmount: 'wrong-amount',
      stale: 'stale',
      future: 'future',
      pending: 'pending',
      failed: 'failed',
      notFound: 'not-found',
      providerOutage: 'provider-outage',
      networkUncertain: 'network-uncertain',
      parserUncertain: 'parser-uncertain',
      malformed: 'malformed',
      layoutDrift: 'layout-drift',
      reused: 'reused',
      duplicateUnavailable: 'duplicate-unavailable',
    });
  });

  it('normalizes a completed fixture to safe facts without duplicate-reference authority', () => {
    const raw = redactedCbeBirrAuthoritativeFixtureResponses.completed as {
      readonly transaction: {
        readonly canonicalReference: string;
        readonly receiverKey: string;
      };
    };
    const evidence = normalizeCbeBirrAuthoritativeFixtureResponse(raw);

    expect(evidence).toEqual({
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
    });
    expect(evidence).not.toHaveProperty('duplicateCheck');
    expect(JSON.stringify(evidence)).not.toContain(raw.transaction.canonicalReference);
    expect(JSON.stringify(evidence)).not.toContain(raw.transaction.receiverKey);
    expect(evaluateFixture('completed', 'clear')).toEqual({
      contractVersion: 1,
      outcome: 'would_verify',
      reasonCode: 'shadow_checks_passed',
    });
  });

  it.each([
    ['PROVIDER_API', 'provider_api'],
    ['PROVIDER_RECEIPT_LOOKUP', 'provider_receipt_lookup'],
    ['PROVIDER_ACCOUNT_ACTIVITY', 'provider_account_activity'],
  ] as const)('normalizes the explicit %s evidence source to %s', (source, expected) => {
    const raw = redactedCbeBirrAuthoritativeFixtureResponses.completed as object;
    const normalizedEvidence = normalizeCbeBirrAuthoritativeFixtureResponse({
      ...raw,
      evidenceSource: source,
    });
    const validatedEvidence = validatedCbeBirrAuthoritativeAdapterResult({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      evidence: normalizedEvidence,
    }).evidence;

    expect(normalizedEvidence).toMatchObject({
      lookupOutcome: 'found',
      evidenceSource: expected,
    });
    expect(validatedEvidence).toEqual(normalizedEvidence);
  });

  it('preserves an explicit provider identity mismatch through shared validation', () => {
    const normalizedEvidence = normalizeCbeBirrAuthoritativeFixtureResponse(
      redactedCbeBirrAuthoritativeFixtureResponses.providerIdentityMismatch,
    );
    const validatedEvidence = validatedCbeBirrAuthoritativeAdapterResult({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      evidence: normalizedEvidence,
    }).evidence;

    expect(normalizedEvidence).toMatchObject({
      lookupOutcome: 'found',
      providerIdentity: 'mismatched',
    });
    expect(validatedEvidence).toEqual(normalizedEvidence);
  });

  it.each([
    ['wrongReceiver', 'would_reject', 'receiver_mismatch'],
    ['providerIdentityMismatch', 'would_review', 'receipt_parse_uncertain'],
    ['wrongAmount', 'would_review', 'amount_mismatch'],
    ['stale', 'would_review', 'payment_stale'],
    ['future', 'would_review', 'payment_timestamp_future'],
    ['pending', 'would_review', 'provider_status_pending'],
    ['failed', 'would_reject', 'provider_status_failed'],
    ['notFound', 'would_reject', 'authoritative_receipt_not_found'],
    ['providerOutage', 'would_review', 'authoritative_receipt_unavailable'],
    ['networkUncertain', 'would_review', 'provider_network_uncertain'],
    ['parserUncertain', 'would_review', 'receipt_parse_uncertain'],
    ['malformed', 'would_review', 'receipt_parse_uncertain'],
    ['layoutDrift', 'would_review', 'receipt_parse_uncertain'],
  ] as const)(
    'maps %s through the Stage 1A evaluator to %s / %s',
    (fixtureKey, outcome, reasonCode) => {
      expect(evaluateFixture(fixtureKey, 'clear')).toEqual({
        contractVersion: 1,
        outcome,
        reasonCode,
      });
    },
  );

  it.each([
    [
      'unknown provider identity',
      { providerIdentity: 'UNKNOWN' },
      { providerIdentity: 'unknown' },
      'receipt_parse_uncertain',
    ],
    [
      'unknown final status',
      { transaction: { status: 'UNKNOWN' } },
      { providerFinalStatus: 'unknown' },
      'receipt_parse_uncertain',
    ],
    [
      'other currency',
      { transaction: { currencyCode: 'OTHER' } },
      { currencyCode: 'other' },
      'receipt_parse_uncertain',
    ],
    [
      'unknown currency',
      { transaction: { currencyCode: 'UNKNOWN' } },
      { currencyCode: 'unknown' },
      'payment_fields_missing',
    ],
    [
      'other payment type',
      { transaction: { paymentType: 'OTHER' } },
      { paymentType: 'other' },
      'payment_type_mismatch',
    ],
    [
      'unknown payment type',
      { transaction: { paymentType: 'UNKNOWN' } },
      { paymentType: 'unknown' },
      'payment_fields_missing',
    ],
    [
      'missing canonical reference',
      { transaction: { canonicalReference: null } },
      { canonicalReferencePresent: false },
      'payment_fields_missing',
    ],
    [
      'missing amount',
      { transaction: { amountMinor: null } },
      { amountMinor: null },
      'payment_fields_missing',
    ],
    [
      'missing receiver',
      { transaction: { receiverKey: null } },
      { receiverMatch: 'unknown' },
      'payment_fields_missing',
    ],
    [
      'missing occurrence time',
      { transaction: { occurredAt: null } },
      { occurredAt: null },
      'payment_fields_missing',
    ],
    [
      'missing retrieval time',
      { retrieval: { retrievedAt: null } },
      { retrievedAt: null },
      'payment_fields_missing',
    ],
    [
      'missing adapter version',
      { retrieval: { adapterVersion: null } },
      { provenance: { adapterVersionPresent: false } },
      'payment_fields_missing',
    ],
    [
      'missing normalization version',
      { retrieval: { normalizationVersion: null } },
      { provenance: { normalizationVersionPresent: false } },
      'payment_fields_missing',
    ],
    [
      'missing evidence digest',
      { retrieval: { evidenceDigest: null } },
      { provenance: { evidenceDigestPresent: false } },
      'payment_fields_missing',
    ],
    [
      'retrieval before occurrence',
      { retrieval: { retrievedAt: '2026-08-14T10:04:59.999Z' } },
      { retrievedAt: '2026-08-14T10:04:59.999Z' },
      'receipt_parse_uncertain',
    ],
    [
      'future retrieval with a valid occurrence time',
      { retrieval: { retrievedAt: '2026-08-14T10:15:00.001Z' } },
      { retrievedAt: '2026-08-14T10:15:00.001Z' },
      'payment_timestamp_future',
    ],
  ] as const)(
    'preserves %s as an exact safe fact before advisory evaluation',
    (_label, override, expectedEvidence, reasonCode) => {
      const raw = redactedCbeBirrAuthoritativeFixtureResponses.completed as {
        readonly transaction: Readonly<Record<string, unknown>>;
        readonly retrieval: Readonly<Record<string, unknown>>;
      };
      const transactionOverride = 'transaction' in override ? override.transaction : undefined;
      const retrievalOverride = 'retrieval' in override ? override.retrieval : undefined;
      const candidate = {
        ...(raw as object),
        ...(!transactionOverride && !retrievalOverride ? override : {}),
        transaction: { ...raw.transaction, ...transactionOverride },
        retrieval: { ...raw.retrieval, ...retrievalOverride },
      };
      const normalizedEvidence = normalizeCbeBirrAuthoritativeFixtureResponse(candidate);
      const validatedEvidence = validatedCbeBirrAuthoritativeAdapterResult({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        evidence: normalizedEvidence,
      }).evidence;

      expect(normalizedEvidence.lookupOutcome).toBe('found');
      expect(normalizedEvidence).toMatchObject(expectedEvidence);
      expect(validatedEvidence).toEqual(normalizedEvidence);
      expect(evaluateCandidate(candidate, 'clear')).toEqual({
        contractVersion: 1,
        outcome: 'would_review',
        reasonCode,
      });
    },
  );

  it('keeps reused and unavailable duplicate classification outside the adapter', () => {
    const reusedEvidence = normalizeCbeBirrAuthoritativeFixtureResponse(
      redactedCbeBirrAuthoritativeFixtureResponses.reused,
    );
    const unavailableEvidence = normalizeCbeBirrAuthoritativeFixtureResponse(
      redactedCbeBirrAuthoritativeFixtureResponses.duplicateUnavailable,
    );

    expect(reusedEvidence).not.toHaveProperty('duplicateCheck');
    expect(unavailableEvidence).not.toHaveProperty('duplicateCheck');
    expect(evaluateFixture('reused', 'reused')).toEqual({
      contractVersion: 1,
      outcome: 'would_reject',
      reasonCode: 'provider_reference_reused',
    });
    expect(evaluateFixture('duplicateUnavailable', 'unavailable')).toEqual({
      contractVersion: 1,
      outcome: 'would_review',
      reasonCode: 'duplicate_check_unavailable',
    });
  });

  it('normalizes conclusive not-found and explicit outage classes exactly', () => {
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse(
        redactedCbeBirrAuthoritativeFixtureResponses.notFound,
      ),
    ).toEqual({ lookupOutcome: 'not_found' });
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse(
        redactedCbeBirrAuthoritativeFixtureResponses.providerOutage,
      ),
    ).toEqual({ lookupOutcome: 'unavailable', uncertainty: 'provider' });
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse(
        redactedCbeBirrAuthoritativeFixtureResponses.networkUncertain,
      ),
    ).toEqual({ lookupOutcome: 'unavailable', uncertainty: 'network' });
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse(
        redactedCbeBirrAuthoritativeFixtureResponses.parserUncertain,
      ),
    ).toEqual(parserUnavailable);
  });

  it('fails malformed and drifted layouts closed without attempting repair', () => {
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse(
        redactedCbeBirrAuthoritativeFixtureResponses.malformed,
      ),
    ).toEqual(parserUnavailable);
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse(
        redactedCbeBirrAuthoritativeFixtureResponses.layoutDrift,
      ),
    ).toEqual(parserUnavailable);
  });

  it('fails closed for accessors without reading them', () => {
    const raw = redactedCbeBirrAuthoritativeFixtureResponses.completed as {
      readonly transaction: Readonly<Record<string, unknown>>;
    };
    let topLevelReads = 0;
    let nestedReads = 0;
    const topLevelAccessor = { ...(raw as object) } as Record<string, unknown>;
    Object.defineProperty(topLevelAccessor, 'lookupOutcome', {
      enumerable: true,
      get() {
        topLevelReads += 1;
        return 'found';
      },
    });
    const nestedAccessor = { ...raw.transaction };
    Object.defineProperty(nestedAccessor, 'canonicalReference', {
      enumerable: true,
      get() {
        nestedReads += 1;
        return 'SYN-CBE-00000001';
      },
    });

    expect(normalizeCbeBirrAuthoritativeFixtureResponse(topLevelAccessor)).toEqual(
      parserUnavailable,
    );
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse({
        ...(raw as object),
        transaction: nestedAccessor,
      }),
    ).toEqual(parserUnavailable);
    expect(topLevelReads).toBe(0);
    expect(nestedReads).toBe(0);
  });

  it('rejects top-level and nested proxies before invoking their traps', () => {
    const raw = redactedCbeBirrAuthoritativeFixtureResponses.completed as {
      readonly transaction: object;
    };
    let trapCalls = 0;
    const topLevelProxy = new Proxy(raw as object, {
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('secret-from-top-level-proxy');
      },
    });
    const nestedProxy = new Proxy(raw.transaction, {
      ownKeys() {
        trapCalls += 1;
        throw new Error('secret-from-nested-proxy');
      },
    });

    expect(normalizeCbeBirrAuthoritativeFixtureResponse(topLevelProxy)).toEqual(parserUnavailable);
    expect(
      normalizeCbeBirrAuthoritativeFixtureResponse({
        ...(raw as object),
        transaction: nestedProxy,
      }),
    ).toEqual(parserUnavailable);
    expect(trapCalls).toBe(0);
  });

  it('rejects extra fields, symbols, unsupported values, and non-record inputs', () => {
    const raw = redactedCbeBirrAuthoritativeFixtureResponses.completed as {
      readonly transaction: Readonly<Record<string, unknown>>;
      readonly retrieval: Readonly<Record<string, unknown>>;
    };
    const symbolExtended = { ...(raw as object) } as Record<PropertyKey, unknown>;
    symbolExtended[Symbol('raw-secret')] = 'secret-symbol-value';
    class ForgedFixture {
      schema = CBE_BIRR_AUTHORITATIVE_FIXTURE_SCHEMA;
    }

    const candidates: readonly unknown[] = [
      null,
      [],
      'fixture',
      new ForgedFixture(),
      { ...(raw as object), unexpected: true },
      { ...(raw as object), transaction: { ...raw.transaction, rawPayload: 'secret' } },
      { ...(raw as object), retrieval: { ...raw.retrieval, receiptUrl: 'secret' } },
      { ...(raw as object), schema: 'FETANAGENT_CBE_BIRR_AUTHORITATIVE_FIXTURE_V2' },
      { ...(raw as object), providerCode: 'other_provider' },
      { ...(raw as object), evidenceSource: 'SCREENSHOT_OCR' },
      { ...(raw as object), transaction: { ...raw.transaction, status: 'SETTLED' } },
      { ...(raw as object), transaction: { ...raw.transaction, amountMinor: Number.NaN } },
      {
        ...(raw as object),
        transaction: { ...raw.transaction, occurredAt: '2026-08-14T10:05:00Z' },
      },
      symbolExtended,
    ];

    for (const candidate of candidates) {
      expect(normalizeCbeBirrAuthoritativeFixtureResponse(candidate)).toEqual(parserUnavailable);
    }
  });

  it('enforces bounded synthetic identifiers and never leaks raw values or thrown secrets', () => {
    const raw = redactedCbeBirrAuthoritativeFixtureResponses.completed as {
      readonly transaction: Readonly<Record<string, unknown>> & {
        readonly canonicalReference: string;
        readonly receiverKey: string;
      };
    };
    const sensitiveValues = [
      raw.transaction.canonicalReference,
      raw.transaction.receiverKey,
      'REAL-LOOKING-TRANSACTION-REFERENCE-1234567890',
      '+251900000000',
      'Bearer fixture-secret-credential',
      'https://provider.invalid/receipt/private',
      '<html>private fixture payload</html>',
    ];
    const oversizedFixtureId = {
      ...(raw as object),
      fixtureId: `oversized-${'x'.repeat(100_000)}`,
    };
    const oversizedReference = {
      ...(raw as object),
      transaction: {
        ...raw.transaction,
        canonicalReference: `SYN-CBE-${'A'.repeat(100_000)}`,
      },
    };
    const secretReference = {
      ...(raw as object),
      transaction: {
        ...raw.transaction,
        canonicalReference: sensitiveValues[2],
        receiverKey: sensitiveValues[3],
      },
    };
    const throwingProxy = new Proxy(raw as object, {
      ownKeys() {
        throw new Error(sensitiveValues[4]);
      },
    });
    const embeddedSecrets = [
      {
        candidate: { ...(raw as object), receiptUrl: sensitiveValues[5] },
        secret: sensitiveValues[5],
      },
      {
        candidate: {
          ...(raw as object),
          transaction: { ...raw.transaction, rawPayload: sensitiveValues[6] },
        },
        secret: sensitiveValues[6],
      },
      {
        candidate: {
          ...(raw as object),
          transaction: {
            ...raw.transaction,
            canonicalReference: 'SYN-CBE-00000001\r\nraw-secret',
          },
        },
        secret: 'SYN-CBE-00000001\r\nraw-secret',
      },
      {
        candidate: {
          ...(raw as object),
          transaction: {
            ...raw.transaction,
            receiverKey: 'fixture-receiver-primary\0raw-secret',
          },
        },
        secret: 'fixture-receiver-primary\0raw-secret',
      },
    ] as const;

    for (const { candidate, secret } of embeddedSecrets) {
      const candidateOutputs = [
        normalizeCbeBirrAuthoritativeFixtureResponse(candidate),
        redactedCbeBirrAuthoritativeFixtureNormalizationForLog(candidate),
      ];
      expect(candidateOutputs[0]).toEqual(parserUnavailable);
      expect(JSON.stringify(candidateOutputs)).not.toContain(secret);
    }

    const outputs = [
      normalizeCbeBirrAuthoritativeFixtureResponse(raw),
      redactedCbeBirrAuthoritativeFixtureNormalizationForLog(raw),
      normalizeCbeBirrAuthoritativeFixtureResponse(oversizedFixtureId),
      redactedCbeBirrAuthoritativeFixtureNormalizationForLog(oversizedFixtureId),
      normalizeCbeBirrAuthoritativeFixtureResponse(oversizedReference),
      redactedCbeBirrAuthoritativeFixtureNormalizationForLog(oversizedReference),
      normalizeCbeBirrAuthoritativeFixtureResponse(secretReference),
      redactedCbeBirrAuthoritativeFixtureNormalizationForLog(secretReference),
      normalizeCbeBirrAuthoritativeFixtureResponse(throwingProxy),
      redactedCbeBirrAuthoritativeFixtureNormalizationForLog(throwingProxy),
    ];
    const serialized = JSON.stringify(outputs);

    expect(outputs.slice(2)).toEqual([
      parserUnavailable,
      {
        fixtureSchemaVersion: 1,
        normalizerVersion: 1,
        providerCode: 'cbe_birr',
        offlineOnly: true,
        lookupOutcome: 'unavailable',
        uncertainty: 'parser',
      },
      parserUnavailable,
      {
        fixtureSchemaVersion: 1,
        normalizerVersion: 1,
        providerCode: 'cbe_birr',
        offlineOnly: true,
        lookupOutcome: 'unavailable',
        uncertainty: 'parser',
      },
      parserUnavailable,
      {
        fixtureSchemaVersion: 1,
        normalizerVersion: 1,
        providerCode: 'cbe_birr',
        offlineOnly: true,
        lookupOutcome: 'unavailable',
        uncertainty: 'parser',
      },
      parserUnavailable,
      {
        fixtureSchemaVersion: 1,
        normalizerVersion: 1,
        providerCode: 'cbe_birr',
        offlineOnly: true,
        lookupOutcome: 'unavailable',
        uncertainty: 'parser',
      },
    ]);
    for (const sensitiveValue of sensitiveValues) expect(serialized).not.toContain(sensitiveValue);
  });
});
