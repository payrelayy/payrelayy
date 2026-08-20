import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CBE_BIRR_OFFLINE_RECEIPT_MAX_RESPONSE_BYTES,
  buildSyntheticCbeBirrOfficialReceiptLookupPlan,
  inspectSyntheticCbeBirrOfficialReceipt,
  projectCbeBirrOfflineReceiptLog,
  redactedSyntheticCbeBirrOfficialReceiptForLog,
  syntheticCbeBirrOfficialReceiptFixture,
  syntheticCbeBirrOfficialReceiptFixtureInput,
  type CbeBirrSyntheticOfficialReceiptResponse,
  type CbeBirrSyntheticOfficialReceiptResult,
} from './index.js';

function responseWith(body: string): CbeBirrSyntheticOfficialReceiptResponse {
  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body,
  };
}

function replaceFixture(from: string, to: string): string {
  expect(syntheticCbeBirrOfficialReceiptFixture).toContain(from);
  return syntheticCbeBirrOfficialReceiptFixture.replace(from, to);
}

describe('offline-only CBE Birr official receipt plan', () => {
  it('compiles the fixed route, explicit port, exact TID then PH order, and zero redirects', () => {
    const plan = buildSyntheticCbeBirrOfficialReceiptLookupPlan(
      syntheticCbeBirrOfficialReceiptFixtureInput,
    );
    expect(plan).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      advisoryOnly: true,
      disposition: 'offline_fixture_plan',
      reasonCode: 'live_transport_absent',
      request: {
        method: 'GET',
        url: 'https://cbepay1.cbe.com.et:443/aureceipt?TID=SYNTHCBE00001&PH=251900000001',
        redirectPolicy: 'reject_all',
        queryParameterOrder: ['TID', 'PH'],
      },
      liveTransportAllowed: false,
      providerRequestAllowed: false,
      databaseAccessAllowed: false,
      persistenceAllowed: false,
      runtimeWiringAllowed: false,
      evidenceClaimAllowed: false,
      financialActionAllowed: false,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen('request' in plan ? plan.request : null)).toBe(true);
  });

  it('rejects noncanonical, nonsynthetic, extra, accessor, and proxy input', () => {
    let reads = 0;
    const accessor = {
      ...syntheticCbeBirrOfficialReceiptFixtureInput,
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'requestedReference', {
      enumerable: true,
      get() {
        reads += 1;
        return 'SYNTHCBE00001';
      },
    });
    const candidates: unknown[] = [
      { ...syntheticCbeBirrOfficialReceiptFixtureInput, requestedReference: 'synthcbe00001' },
      { ...syntheticCbeBirrOfficialReceiptFixtureInput, requestedReference: ' SYNTHCBE00001' },
      { ...syntheticCbeBirrOfficialReceiptFixtureInput, requestedReference: 'ABC12345' },
      { ...syntheticCbeBirrOfficialReceiptFixtureInput, receiverLookupPhone: '251911111111' },
      { ...syntheticCbeBirrOfficialReceiptFixtureInput, receiverFullName: 'ORDINARY RECEIVER' },
      { ...syntheticCbeBirrOfficialReceiptFixtureInput, extra: 'DO-NOT-ECHO' },
      accessor,
      new Proxy(syntheticCbeBirrOfficialReceiptFixtureInput, {}),
    ];
    for (const candidate of candidates) {
      expect(buildSyntheticCbeBirrOfficialReceiptLookupPlan(candidate)).toMatchObject({
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
      });
    }
    expect(reads).toBe(0);
  });

  it('keeps every live/provider/database/persistence/runtime/claim/financial capability false', () => {
    expectTypeOf<
      CbeBirrSyntheticOfficialReceiptResult['liveTransportAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrSyntheticOfficialReceiptResult['providerRequestAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrSyntheticOfficialReceiptResult['databaseAccessAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrSyntheticOfficialReceiptResult['persistenceAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrSyntheticOfficialReceiptResult['runtimeWiringAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrSyntheticOfficialReceiptResult['evidenceClaimAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrSyntheticOfficialReceiptResult['financialActionAllowed']
    >().toEqualTypeOf<false>();
  });
});

describe('parse5 synthetic CBE Birr receipt inspection', () => {
  it('accepts only exact synthetic response data and returns redacted safe facts', () => {
    const result = inspectSyntheticCbeBirrOfficialReceipt(
      syntheticCbeBirrOfficialReceiptFixtureInput,
      responseWith(syntheticCbeBirrOfficialReceiptFixture),
    );

    expect(result).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      parserVersion: 1,
      advisoryOnly: true,
      disposition: 'synthetic_safe_facts',
      reasonCode: 'synthetic_receipt_parsed',
      referenceMask: '***0001',
      receiverAccountMask: '***0001',
      referenceMatch: true,
      receiverNameMatch: true,
      receiverAccountMatch: true,
      providerFinalStatus: 'completed',
      transactionType: 'send_money',
      principalAmountMinor: 15_000,
      serviceChargeMinor: 174,
      vatMinor: 26,
      totalDebitedMinor: 15_200,
      feeArithmetic: 'consistent',
      occurredAtAddisAbaba: '2099-01-01T12:34:56+03:00',
      liveTransportAllowed: false,
      providerRequestAllowed: false,
      databaseAccessAllowed: false,
      persistenceAllowed: false,
      runtimeWiringAllowed: false,
      evidenceClaimAllowed: false,
      financialActionAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC CBE RECEIVER');
    expect(JSON.stringify(result)).not.toContain('251900000001');
    expect(JSON.stringify(result)).not.toContain('SYNTHCBE00001');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ['SYNTHCBE00001', 'SYNTHCBE00002', 'requested_reference_mismatch'],
    ['SYNTHETIC CBE RECEIVER', 'SYNTHETIC OTHER RECEIVER', 'receiver_name_mismatch'],
    ['251900000001', '251900000002', 'receiver_account_mismatch'],
    ['>Completed<', '>Pending<', 'status_not_completed'],
    ['>Send Money<', '>Cash Out<', 'transaction_type_unsupported'],
    ['>152.00 ETB<', '>153.00 ETB<', 'fee_arithmetic_mismatch'],
  ] as const)('fails changed receipt fact %s closed as %s', (from, to, reasonCode) => {
    const result = inspectSyntheticCbeBirrOfficialReceipt(
      syntheticCbeBirrOfficialReceiptFixtureInput,
      responseWith(replaceFixture(from, to)),
    );
    expect(result).toMatchObject({ disposition: 'would_review', reasonCode });
    expect(projectCbeBirrOfflineReceiptLog(result)).toMatchObject({
      disposition: 'would_review',
      reasonCode,
    });
  });

  it('requires the explicit synthetic marker and all exact fields exactly once', () => {
    const withoutMarker = syntheticCbeBirrOfficialReceiptFixture.replace(
      '<meta name="fetanagent-synthetic-fixture" content="synthetic-cbe-birr-official-receipt-v1">',
      '',
    );
    expect(
      inspectSyntheticCbeBirrOfficialReceipt(
        syntheticCbeBirrOfficialReceiptFixtureInput,
        responseWith(withoutMarker),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'fixture_marker_missing' });

    const duplicate = syntheticCbeBirrOfficialReceiptFixture.replace(
      '</table>',
      '<tr><th>Transaction ID</th><td>SYNTHCBE00001</td></tr></table>',
    );
    expect(
      inspectSyntheticCbeBirrOfficialReceipt(
        syntheticCbeBirrOfficialReceiptFixtureInput,
        responseWith(duplicate),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'receipt_shape_unattested' });
  });

  it('rejects malformed amounts, impossible +03 timestamps, oversized bodies, and responses', () => {
    for (const body of [
      replaceFixture('150.00 ETB', '150 ETB'),
      replaceFixture('01/01/2099 12:34:56', '31/02/2099 12:34:56'),
    ]) {
      expect(
        inspectSyntheticCbeBirrOfficialReceipt(
          syntheticCbeBirrOfficialReceiptFixtureInput,
          responseWith(body),
        ),
      ).toMatchObject({ disposition: 'would_review', reasonCode: 'receipt_shape_unattested' });
    }

    expect(
      inspectSyntheticCbeBirrOfficialReceipt(
        syntheticCbeBirrOfficialReceiptFixtureInput,
        responseWith('x'.repeat(CBE_BIRR_OFFLINE_RECEIPT_MAX_RESPONSE_BYTES + 1)),
      ),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'fixture_response_invalid' });
    expect(
      inspectSyntheticCbeBirrOfficialReceipt(syntheticCbeBirrOfficialReceiptFixtureInput, {
        status: 302,
        contentType: 'text/html; charset=utf-8',
        body: syntheticCbeBirrOfficialReceiptFixture,
      }),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'fixture_response_invalid' });
  });

  it('never accepts or invokes a callback, accessor, proxy, or network-capable hook', () => {
    let calls = 0;
    let reads = 0;
    let proxyTraps = 0;
    const callback = () => {
      calls += 1;
      return responseWith(syntheticCbeBirrOfficialReceiptFixture);
    };
    const accessorResponse = {
      status: 200,
      contentType: 'text/html; charset=utf-8',
    } as Record<string, unknown>;
    Object.defineProperty(accessorResponse, 'body', {
      enumerable: true,
      get() {
        reads += 1;
        return syntheticCbeBirrOfficialReceiptFixture;
      },
    });
    const proxiedResponse = new Proxy(responseWith(syntheticCbeBirrOfficialReceiptFixture), {
      ownKeys() {
        proxyTraps += 1;
        return [];
      },
      getPrototypeOf() {
        proxyTraps += 1;
        return Object.prototype;
      },
    });
    for (const candidate of [
      callback,
      { kind: 'synthetic_fixture_transport', load: callback },
      { ...responseWith(syntheticCbeBirrOfficialReceiptFixture), fetch: callback },
      accessorResponse,
      proxiedResponse,
    ]) {
      expect(
        inspectSyntheticCbeBirrOfficialReceipt(
          syntheticCbeBirrOfficialReceiptFixtureInput,
          candidate,
        ),
      ).toMatchObject({ disposition: 'would_review', reasonCode: 'fixture_response_invalid' });
    }
    expect(calls).toBe(0);
    expect(reads).toBe(0);
    expect(proxyTraps).toBe(0);
  });

  it('emits an allowlisted log projection with no reference, receiver, URL, or HTML', () => {
    const result = inspectSyntheticCbeBirrOfficialReceipt(
      syntheticCbeBirrOfficialReceiptFixtureInput,
      responseWith(syntheticCbeBirrOfficialReceiptFixture),
    );
    const projection = redactedSyntheticCbeBirrOfficialReceiptForLog(result);
    expect(projection).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      parserVersion: 1,
      advisoryOnly: true,
      disposition: 'synthetic_safe_facts',
      reasonCode: 'synthetic_receipt_parsed',
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /SYNTHCBE00001|251900000001|SYNTHETIC CBE RECEIVER|aureceipt|<html/iu,
    );

    const forged = redactedSyntheticCbeBirrOfficialReceiptForLog({
      ...result,
      disposition: 'verified',
      secret: 'DO-NOT-ECHO',
    });
    expect(forged).toMatchObject({ disposition: 'invalid_result', reasonCode: 'invalid_result' });
    expect(JSON.stringify(forged)).not.toContain('DO-NOT-ECHO');
  });

  it('revalidates exact variants, reason pairings, safe facts, and disabled capabilities', () => {
    const safeResult = inspectSyntheticCbeBirrOfficialReceipt(
      syntheticCbeBirrOfficialReceiptFixtureInput,
      responseWith(syntheticCbeBirrOfficialReceiptFixture),
    );
    const structuralReview = inspectSyntheticCbeBirrOfficialReceipt(
      syntheticCbeBirrOfficialReceiptFixtureInput,
      { status: 500, contentType: 'text/html; charset=utf-8', body: 'DO-NOT-ECHO' },
    );
    const invalidRequest = inspectSyntheticCbeBirrOfficialReceipt(
      { ...syntheticCbeBirrOfficialReceiptFixtureInput, extra: 'DO-NOT-ECHO' },
      responseWith(syntheticCbeBirrOfficialReceiptFixture),
    );
    expect(projectCbeBirrOfflineReceiptLog(invalidRequest)).toMatchObject({
      disposition: 'invalid_request',
      reasonCode: 'invalid_request',
    });
    expect(projectCbeBirrOfflineReceiptLog(structuralReview)).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'fixture_response_invalid',
    });

    const { referenceMask: _removedReferenceMask, ...missingSafeFact } =
      safeResult as unknown as Record<string, unknown>;
    expect(_removedReferenceMask).toBe('***0001');
    const forgedCandidates: unknown[] = [
      { ...safeResult, extra: 'DO-NOT-ECHO' },
      { ...safeResult, liveTransportAllowed: true },
      { ...safeResult, providerRequestAllowed: true },
      { ...safeResult, databaseAccessAllowed: true },
      { ...safeResult, persistenceAllowed: true },
      { ...safeResult, runtimeWiringAllowed: true },
      { ...safeResult, evidenceClaimAllowed: true },
      { ...safeResult, financialActionAllowed: true },
      { ...safeResult, disposition: 'would_review' },
      { ...safeResult, reasonCode: 'fee_arithmetic_mismatch' },
      { ...safeResult, referenceMask: '***SECRET' },
      { ...safeResult, receiverAccountMask: '***ABCD' },
      { ...safeResult, principalAmountMinor: 15_000.5 },
      { ...safeResult, totalDebitedMinor: 15_199 },
      { ...safeResult, occurredAtAddisAbaba: '2099-02-31T12:34:56+03:00' },
      missingSafeFact,
      { ...structuralReview, referenceMask: '***0001' },
      { ...structuralReview, reasonCode: 'requested_reference_mismatch' },
    ];
    for (const candidate of forgedCandidates) {
      const projection = projectCbeBirrOfflineReceiptLog(candidate);
      expect(projection).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        parserVersion: 1,
        advisoryOnly: true,
        disposition: 'invalid_result',
        reasonCode: 'invalid_result',
      });
      expect(JSON.stringify(projection)).not.toContain('DO-NOT-ECHO');
    }
  });

  it('does not read result accessors or proxy traps while projecting logs', () => {
    let reads = 0;
    let proxyTraps = 0;
    const safeResult = inspectSyntheticCbeBirrOfficialReceipt(
      syntheticCbeBirrOfficialReceiptFixtureInput,
      responseWith(syntheticCbeBirrOfficialReceiptFixture),
    );
    const accessor = { ...safeResult } as Record<string, unknown>;
    Object.defineProperty(accessor, 'reasonCode', {
      enumerable: true,
      get() {
        reads += 1;
        return 'synthetic_receipt_parsed';
      },
    });
    const proxied = new Proxy(safeResult, {
      ownKeys() {
        proxyTraps += 1;
        return [];
      },
      getPrototypeOf() {
        proxyTraps += 1;
        return Object.prototype;
      },
    });
    for (const candidate of [accessor, proxied]) {
      expect(projectCbeBirrOfflineReceiptLog(candidate)).toMatchObject({
        disposition: 'invalid_result',
        reasonCode: 'invalid_result',
      });
    }
    expect(reads).toBe(0);
    expect(proxyTraps).toBe(0);
  });
});
