import { describe, expect, it, vi } from 'vitest';

import {
  TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_NORMALIZER_VERSION,
  TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA,
  TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA_VERSION,
  TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  normalizeSyntheticTelebirrOfficialReceipt,
  redactedSyntheticTelebirrOfficialReceiptForLog,
  syntheticTelebirrOfficialReceiptFixtureContext,
  syntheticTelebirrOfficialReceiptFixtures,
  validatedTelebirrSafeReceiptEvidence,
} from './synthetic-official-receipt.js';

type FixtureRecord = Readonly<Record<string, unknown>>;

function completedWith(overrides: {
  readonly envelope?: FixtureRecord;
  readonly transaction?: FixtureRecord;
  readonly retrieval?: FixtureRecord;
}): unknown {
  const completed = syntheticTelebirrOfficialReceiptFixtures.completed as {
    readonly transaction: FixtureRecord;
    readonly retrieval: FixtureRecord;
  } & FixtureRecord;
  return {
    ...completed,
    ...overrides.envelope,
    transaction: { ...completed.transaction, ...overrides.transaction },
    retrieval: { ...completed.retrieval, ...overrides.retrieval },
  };
}

function contextWith(overrides: {
  readonly requestedReference?: string;
  readonly receiverRevision?: FixtureRecord;
}): unknown {
  return {
    ...syntheticTelebirrOfficialReceiptFixtureContext,
    ...(overrides.requestedReference ? { requestedReference: overrides.requestedReference } : {}),
    receiverRevision: {
      ...syntheticTelebirrOfficialReceiptFixtureContext.receiverRevision,
      ...overrides.receiverRevision,
    },
  };
}

const parserUnavailable = { lookupOutcome: 'unavailable', uncertainty: 'parser' } as const;

describe('synthetic TeleBirr official-receipt normalization', () => {
  it('pins the offline schema, source profile, and normalizer version', () => {
    expect(TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA).toBe(
      'FETANAGENT_TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_V1',
    );
    expect(TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_SCHEMA_VERSION).toBe(1);
    expect(TELEBIRR_OFFICIAL_RECEIPT_FIXTURE_NORMALIZER_VERSION).toBe(1);
    expect(TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE).toBe('telebirr_official_receipt_v1');
  });

  it('reduces a completed synthetic receipt to exact safe facts', () => {
    const evidence = normalizeSyntheticTelebirrOfficialReceipt(
      syntheticTelebirrOfficialReceiptFixtures.completed,
      syntheticTelebirrOfficialReceiptFixtureContext,
    );

    expect(evidence).toEqual({
      lookupOutcome: 'found',
      evidenceSource: 'provider_receipt_lookup',
      providerIdentity: 'matched',
      providerFinalStatus: 'completed',
      canonicalReferencePresent: true,
      referenceMatch: 'matched',
      amountMinor: 15_000,
      currencyCode: 'ETB',
      receiverMatch: 'matched',
      maskedReceiverDiagnostic: 'matched',
      paymentMode: 'telebirr',
      paymentReason: 'send_money_to_registered_customer',
      paymentChannel: 'api_app',
      occurredAt: '2026-08-20T18:02:39.000Z',
      retrievedAt: '2026-08-20T18:03:00.000Z',
      provenance: {
        adapterVersionPresent: true,
        normalizationVersionPresent: true,
        evidenceDigestPresent: true,
      },
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    if (evidence.lookupOutcome === 'found') expect(Object.isFrozen(evidence.provenance)).toBe(true);
  });

  it('uses Settled Amount only and never adds fees, VAT, stamp duty, or Total Paid Amount', () => {
    const baseline = normalizeSyntheticTelebirrOfficialReceipt(
      syntheticTelebirrOfficialReceiptFixtures.completed,
      syntheticTelebirrOfficialReceiptFixtureContext,
    );
    const changedFees = normalizeSyntheticTelebirrOfficialReceipt(
      completedWith({
        transaction: {
          stampDuty: '7 Birr',
          discountAmount: '3 Birr',
          serviceFee: '99.99 Birr',
          serviceFeeVat: '15 Birr',
          totalPaidAmount: '999 Birr',
        },
      }),
      syntheticTelebirrOfficialReceiptFixtureContext,
    );

    expect(baseline).toMatchObject({ amountMinor: 15_000 });
    expect(changedFees).toMatchObject({ amountMinor: 15_000 });
    expect(changedFees).not.toHaveProperty('serviceFee');
    expect(changedFees).not.toHaveProperty('totalPaidAmount');
  });

  it.each([
    ['25 Birr', 2_500],
    ['25,000 Birr', 2_500_000],
    ['24.99 Birr', 2_499],
    ['25,000.01 Birr', 2_500_001],
  ] as const)('preserves receipt-derived principal %s as %i minor units', (display, minor) => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ transaction: { settledAmount: display } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toMatchObject({ lookupOutcome: 'found', amountMinor: minor });
  });

  it.each([
    '01 Birr',
    '1,00 Birr',
    '1,0000 Birr',
    '1.001 Birr',
    'NaN Birr',
    '-1 Birr',
    '150 ETB',
    '99999999999999 Birr',
  ])('fails malformed or unsafe amount %s closed', (settledAmount) => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ transaction: { settledAmount } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual(parserUnavailable);
  });

  it.each([
    ['OTHER', { providerIdentity: 'mismatched' }],
    ['UNKNOWN', { providerIdentity: 'unknown' }],
  ] as const)('preserves issuer identity %s as a safe fact', (issuerIdentity, expected) => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ envelope: { issuerIdentity } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toMatchObject(expected);
  });

  it.each([
    ['PENDING', 'pending'],
    ['FAILED', 'failed'],
    ['REVERSED', 'reversed'],
    ['UNKNOWN', 'unknown'],
  ] as const)(
    'preserves explicit %s status without defaulting to completed',
    (status, expected) => {
      expect(
        normalizeSyntheticTelebirrOfficialReceipt(
          completedWith({ transaction: { status } }),
          syntheticTelebirrOfficialReceiptFixtureContext,
        ),
      ).toMatchObject({ providerFinalStatus: expected });
    },
  );

  it('preserves reference, payment-mode, and reason mismatches without leaking raw values', () => {
    const evidence = normalizeSyntheticTelebirrOfficialReceipt(
      completedWith({
        transaction: {
          invoiceNumber: 'SYNTB00000002',
          paymentMode: 'OTHER',
          paymentReason: 'OTHER',
        },
      }),
      syntheticTelebirrOfficialReceiptFixtureContext,
    );

    expect(evidence).toMatchObject({
      referenceMatch: 'mismatched',
      paymentMode: 'other',
      paymentReason: 'other',
    });
    expect(JSON.stringify(evidence)).not.toContain('SYNTB00000002');
  });

  it('matches Latin names only after conservative case, whitespace, and punctuation normalization', () => {
    const context = contextWith({
      receiverRevision: { fullName: "SYNTHETIC O'NEIL-PRIMARY" },
    });
    const evidence = normalizeSyntheticTelebirrOfficialReceipt(
      completedWith({
        transaction: { creditedPartyName: 'synthetic   o’neil‐primary' },
      }),
      context,
    );

    expect(evidence).toMatchObject({ receiverMatch: 'matched' });
  });

  it('normalizes Ethiopic synthetic names without transliteration', () => {
    const context = contextWith({ receiverRevision: { fullName: 'ሙከራ ተቀባይ' } });
    const matchingEvidence = normalizeSyntheticTelebirrOfficialReceipt(
      completedWith({ transaction: { creditedPartyName: 'ሙከራ   ተቀባይ' } }),
      context,
    );
    const transliteratedEvidence = normalizeSyntheticTelebirrOfficialReceipt(
      completedWith({ transaction: { creditedPartyName: 'SYNTHETIC TEST RECEIVER' } }),
      context,
    );

    expect(matchingEvidence).toMatchObject({ receiverMatch: 'matched' });
    expect(transliteratedEvidence).toMatchObject({ receiverMatch: 'mismatched' });
  });

  it.each([
    'SYNTHETIC PRIMARY RECEIVER',
    'SYNTHETIC RECEIVER',
    'SYNTHETIC RECEIVER PRIMARY ALIAS',
    'SYNTHETIC RECEIVER PR1MARY',
  ])('rejects reordered, partial, alias, or similar receiver name %s', (creditedPartyName) => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ transaction: { creditedPartyName } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toMatchObject({ receiverMatch: 'mismatched' });
  });

  it('does not let a matching or conflicting masked number authorize the full receiver name', () => {
    const wrongName = normalizeSyntheticTelebirrOfficialReceipt(
      completedWith({ transaction: { creditedPartyName: 'SYNTHETIC RECEIVER OTHER' } }),
      syntheticTelebirrOfficialReceiptFixtureContext,
    );
    const conflictingMask = normalizeSyntheticTelebirrOfficialReceipt(
      completedWith({ transaction: { creditedPartyMaskedNumber: 'SYN****0002' } }),
      syntheticTelebirrOfficialReceiptFixtureContext,
    );

    expect(wrongName).toMatchObject({
      receiverMatch: 'mismatched',
      maskedReceiverDiagnostic: 'matched',
    });
    expect(conflictingMask).toMatchObject({
      receiverMatch: 'matched',
      maskedReceiverDiagnostic: 'mismatched',
    });
  });

  it('parses the reviewed local format explicitly as Africa/Addis_Ababa UTC+03', () => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({
          transaction: { paymentDate: '01-01-2027 00:00:00' },
          retrieval: { retrievedAt: '2026-12-31T21:00:01.000Z' },
        }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toMatchObject({ occurredAt: '2026-12-31T21:00:00.000Z' });
  });

  it.each(['31-02-2026 10:00:00', '20/08/2026 21:02:39', '20-08-2026 25:00:00'])(
    'fails impossible or unreviewed payment timestamp %s closed',
    (paymentDate) => {
      expect(
        normalizeSyntheticTelebirrOfficialReceipt(
          completedWith({ transaction: { paymentDate } }),
          syntheticTelebirrOfficialReceiptFixtureContext,
        ),
      ).toEqual(parserUnavailable);
    },
  );

  it('fails a retrieval timestamp before the provider payment timestamp closed', () => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ retrieval: { retrievedAt: '2026-08-20T18:02:38.999Z' } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual(parserUnavailable);
  });

  it('preserves exact not-found and unavailable classes', () => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        syntheticTelebirrOfficialReceiptFixtures.notFound,
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual({ lookupOutcome: 'not_found' });
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        syntheticTelebirrOfficialReceiptFixtures.providerUnavailable,
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual({ lookupOutcome: 'unavailable', uncertainty: 'provider' });
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        syntheticTelebirrOfficialReceiptFixtures.deviceUnavailable,
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual({ lookupOutcome: 'unavailable', uncertainty: 'device' });
  });

  it('fails non-synthetic fixture identities and receiver names closed', () => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ transaction: { invoiceNumber: 'UNSCOPED00000001' } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual(parserUnavailable);
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ transaction: { creditedPartyName: 'UNSCOPED RECEIVER' } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual(parserUnavailable);
  });

  it('rejects drift, extra keys, accessors, proxies, and hostile contexts without reading them', () => {
    const getter = vi.fn(() => 'found');
    const accessor = Object.defineProperty({}, 'lookupOutcome', {
      enumerable: true,
      get: getter,
    });
    const proxy = new Proxy(syntheticTelebirrOfficialReceiptFixtures.completed, {});
    const extra = { ...syntheticTelebirrOfficialReceiptFixtures.completed, receiptHtml: 'hidden' };
    const symbol = Object.assign({}, syntheticTelebirrOfficialReceiptFixtures.completed, {
      [Symbol('hidden')]: 'hidden',
    });
    const completed = syntheticTelebirrOfficialReceiptFixtures.completed as {
      readonly transaction: FixtureRecord;
    } & FixtureRecord;
    const hostileTransaction = Object.defineProperty(
      { ...completed.transaction },
      'settledAmount',
      { enumerable: true, get: getter },
    );
    const nestedAccessor = { ...completed, transaction: hostileTransaction };
    const badContext = { ...syntheticTelebirrOfficialReceiptFixtureContext, unexpected: true };

    for (const candidate of [accessor, proxy, extra, symbol, nestedAccessor]) {
      expect(
        normalizeSyntheticTelebirrOfficialReceipt(
          candidate,
          syntheticTelebirrOfficialReceiptFixtureContext,
        ),
      ).toEqual(parserUnavailable);
    }
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        syntheticTelebirrOfficialReceiptFixtures.completed,
        badContext,
      ),
    ).toEqual(parserUnavailable);
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects oversized receiver names before normalization', () => {
    expect(
      normalizeSyntheticTelebirrOfficialReceipt(
        completedWith({ transaction: { creditedPartyName: `SYNTHETIC ${'A'.repeat(300)}` } }),
        syntheticTelebirrOfficialReceiptFixtureContext,
      ),
    ).toEqual(parserUnavailable);
  });

  it('revalidates exact safe facts and rejects any reflected extra field', () => {
    const evidence = normalizeSyntheticTelebirrOfficialReceipt(
      syntheticTelebirrOfficialReceiptFixtures.completed,
      syntheticTelebirrOfficialReceiptFixtureContext,
    );

    expect(validatedTelebirrSafeReceiptEvidence(evidence)).toEqual(evidence);
    expect(validatedTelebirrSafeReceiptEvidence({ ...evidence, rawReference: 'hidden' })).toBe(
      undefined,
    );
    expect(
      validatedTelebirrSafeReceiptEvidence({
        ...evidence,
        canonicalReferencePresent: false,
        referenceMatch: 'matched',
      }),
    ).toBe(undefined);
    expect(
      validatedTelebirrSafeReceiptEvidence({
        ...evidence,
        amountMinor: null,
        currencyCode: 'ETB',
      }),
    ).toBe(undefined);
  });

  it('returns a constant-key redacted projection with no raw fixture values', () => {
    const projection = redactedSyntheticTelebirrOfficialReceiptForLog(
      syntheticTelebirrOfficialReceiptFixtures.completed,
      syntheticTelebirrOfficialReceiptFixtureContext,
    );

    expect(projection).toEqual({
      fixtureSchemaVersion: 1,
      normalizerVersion: 1,
      providerCode: 'telebirr',
      sourceProfile: 'telebirr_official_receipt_v1',
      offlineOnly: true,
      lookupOutcome: 'found',
      uncertainty: null,
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('SYNTB');
    expect(serialized).not.toContain('RECEIVER');
    expect(serialized).not.toContain('150');
  });
});
