import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  redactedCbeBirrAuthoritativeReceiptTransportResultForLog,
  retrieveCbeBirrAuthoritativeReceiptWithTransport,
  type CbeBirrAuthoritativeReceiptTransportResult,
} from './runner.js';
import type {
  CbeBirrAuthoritativeReceiptInternalTransport,
  CbeBirrAuthoritativeReceiptTransportFailureReason,
  SensitiveCbeBirrAuthoritativeReceiptRequestPlan,
} from './shared.js';
import {
  SYNTHETIC_PHONE,
  SYNTHETIC_REFERENCE,
  allowedTransportControl,
  syntheticLookupInput,
  syntheticPdfEnvelope,
} from './test-helpers.js';

function successfulTransport(
  capture?: (plan: SensitiveCbeBirrAuthoritativeReceiptRequestPlan) => void,
): CbeBirrAuthoritativeReceiptInternalTransport {
  return async (plan) => {
    capture?.(plan);
    return { ok: true, body: syntheticPdfEnvelope() };
  };
}

describe('CBE Birr authoritative receipt PDF transport runner', () => {
  it('compiles one fixed request and returns only an opaque, non-authoritative PDF observation', async () => {
    let captured: SensitiveCbeBirrAuthoritativeReceiptRequestPlan | undefined;
    const result = await retrieveCbeBirrAuthoritativeReceiptWithTransport(
      syntheticLookupInput,
      allowedTransportControl,
      successfulTransport((plan) => {
        captured = plan;
      }),
    );

    expect(captured).toEqual({
      method: 'GET',
      scheme: 'https',
      host: 'cbepay1.cbe.com.et',
      port: 443,
      pathAndQuery: `/aureceipt?TID=${SYNTHETIC_REFERENCE}&PH=${SYNTHETIC_PHONE}`,
      headers: {
        accept: 'application/pdf',
        'accept-encoding': 'identity',
        connection: 'close',
      },
      redirectPolicy: 'reject_all',
      timeoutMs: 5_000,
      maxResponseBytes: 1_048_576,
      maxHeaderBytes: 8_192,
      maxHeaderPairs: 32,
      maxAttempts: 1,
    });
    expect(result).toEqual({
      contractVersion: 1,
      transportPolicyVersion: 1,
      pdfEnvelopeVersion: 1,
      providerCode: 'cbe_birr',
      sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
      advisoryOnly: true,
      responseContractAttested: false,
      receiptFieldParsingAllowed: false,
      authoritativeAdapterAllowed: false,
      evidenceClaimAllowed: false,
      duplicateClaimAllowed: false,
      databaseAccessAllowed: false,
      persistenceAllowed: false,
      runtimeWiringAllowed: false,
      settlementAllowed: false,
      financialActionAllowed: false,
      disposition: 'opaque_pdf_observation',
      reasonCode: 'official_pdf_observed',
      observation: {
        envelopeVersion: 1,
        mediaType: 'application/pdf',
        byteLength: syntheticPdfEnvelope().byteLength,
        sha256Digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured?.headers)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.disposition === 'opaque_pdf_observation') {
      expect(Object.isFrozen(result.observation)).toBe(true);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SYNTHETIC_REFERENCE);
    expect(serialized).not.toContain(SYNTHETIC_PHONE);
    expect(serialized).not.toContain('%PDF-');
    expect(serialized).not.toContain('SYNTHETIC TEST ENVELOPE');
  });

  it.each([
    ['HTML body', new TextEncoder().encode('<!doctype html><html></html>')],
    ['missing magic', new Uint8Array(128)],
    ['too short', new TextEncoder().encode('%PDF-1.7\n%%EOF\n')],
    ['missing EOF', new TextEncoder().encode(`%PDF-1.7\n${'x'.repeat(100)}`)],
    [
      'trailing payload',
      new TextEncoder().encode(`%PDF-1.7\n${'x'.repeat(100)}\n%%EOF\nnot-whitespace`),
    ],
  ])('fails closed for a synthetic %s instead of parsing fields', async (_label, body) => {
    await expect(
      retrieveCbeBirrAuthoritativeReceiptWithTransport(
        syntheticLookupInput,
        allowedTransportControl,
        async () => ({ ok: true, body }),
      ),
    ).resolves.toMatchObject({
      disposition: 'failed_closed',
      reasonCode: 'pdf_envelope_rejected',
      failureClass: 'response_shape',
    });
  });

  it('stops before request construction when disabled or when the incident stop is open', async () => {
    let calls = 0;
    const transport: CbeBirrAuthoritativeReceiptInternalTransport = async () => {
      calls += 1;
      throw new Error('transport must remain unreachable');
    };
    await expect(
      retrieveCbeBirrAuthoritativeReceiptWithTransport(
        syntheticLookupInput,
        { ...allowedTransportControl, providerRequest: 'disabled' },
        transport,
      ),
    ).resolves.toMatchObject({
      disposition: 'stopped',
      reasonCode: 'provider_request_disabled',
      failureClass: 'request',
    });
    await expect(
      retrieveCbeBirrAuthoritativeReceiptWithTransport(
        syntheticLookupInput,
        { ...allowedTransportControl, incidentStop: 'open' },
        transport,
      ),
    ).resolves.toMatchObject({
      disposition: 'stopped',
      reasonCode: 'incident_stop_open',
      failureClass: 'incident_stop',
    });
    expect(calls).toBe(0);
  });

  it('requires a canonical 12-digit international selector and rejects hostile input without transport', async () => {
    let accessorReads = 0;
    const accessor = { ...syntheticLookupInput } as Record<string, unknown>;
    Object.defineProperty(accessor, 'requestedReference', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return SYNTHETIC_REFERENCE;
      },
    });
    const candidates: unknown[] = [
      null,
      {},
      { ...syntheticLookupInput, contractVersion: 2 },
      { ...syntheticLookupInput, extra: 'SENSITIVE' },
      { ...syntheticLookupInput, requestedReference: 'synthcbe00001' },
      { ...syntheticLookupInput, requestedReference: 'SYNТHCBE00001' },
      { ...syntheticLookupInput, requestedReference: 'A'.repeat(33) },
      { ...syntheticLookupInput, receiverLookupPhone: '25100000000' },
      { ...syntheticLookupInput, receiverLookupPhone: '0251000000000' },
      Object.assign({ ...syntheticLookupInput }, { [Symbol('sensitive')]: 'SENSITIVE' }),
      accessor,
      new Proxy({ ...syntheticLookupInput }, {}),
    ];
    let calls = 0;
    for (const candidate of candidates) {
      const result = await retrieveCbeBirrAuthoritativeReceiptWithTransport(
        candidate,
        allowedTransportControl,
        async () => {
          calls += 1;
          return { ok: true, body: syntheticPdfEnvelope() };
        },
      );
      expect(result).toMatchObject({
        disposition: 'invalid_request',
        reasonCode: 'invalid_request',
        failureClass: 'request',
      });
      expect(JSON.stringify(result)).not.toContain('SENSITIVE');
    }
    expect(calls).toBe(0);
    expect(accessorReads).toBe(0);
  });

  it('rejects malformed and hostile controls without executing transport', async () => {
    let accessorReads = 0;
    const accessor = { ...allowedTransportControl } as Record<string, unknown>;
    Object.defineProperty(accessor, 'incidentStop', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'closed';
      },
    });
    const candidates: unknown[] = [
      null,
      {},
      { ...allowedTransportControl, providerRequest: true },
      { ...allowedTransportControl, incidentStop: false },
      { ...allowedTransportControl, extra: 'SENSITIVE' },
      accessor,
      new Proxy({ ...allowedTransportControl }, {}),
    ];
    let calls = 0;
    for (const candidate of candidates) {
      const result = await retrieveCbeBirrAuthoritativeReceiptWithTransport(
        syntheticLookupInput,
        candidate,
        async () => {
          calls += 1;
          return { ok: true, body: syntheticPdfEnvelope() };
        },
      );
      expect(result).toMatchObject({
        disposition: 'invalid_control',
        reasonCode: 'invalid_control',
        failureClass: 'control',
      });
    }
    expect(calls).toBe(0);
    expect(accessorReads).toBe(0);
  });

  const transportFailures: readonly [CbeBirrAuthoritativeReceiptTransportFailureReason, string][] =
    [
      ['dns_resolution_failed', 'dns'],
      ['resolved_address_rejected', 'dns'],
      ['transport_timeout', 'timeout'],
      ['tls_validation_failed', 'tls'],
      ['network_request_failed', 'network'],
      ['redirect_rejected', 'redirect'],
      ['http_status_rejected', 'http_status'],
      ['response_headers_rejected', 'response_headers'],
      ['content_type_rejected', 'content_type'],
      ['content_encoding_rejected', 'content_encoding'],
      ['response_too_large', 'response_size'],
      ['response_stream_failed', 'network'],
    ];

  it.each(transportFailures)(
    'maps %s to one fixed redacted failure class',
    async (reasonCode, failureClass) => {
      const result = await retrieveCbeBirrAuthoritativeReceiptWithTransport(
        syntheticLookupInput,
        allowedTransportControl,
        async () => ({ ok: false, reasonCode }),
      );
      expect(result).toMatchObject({ disposition: 'failed_closed', reasonCode, failureClass });
      expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REFERENCE);
      expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PHONE);
    },
  );

  it('fails closed when the internal transport throws or returns an untrusted shape', async () => {
    await expect(
      retrieveCbeBirrAuthoritativeReceiptWithTransport(
        syntheticLookupInput,
        allowedTransportControl,
        async () => {
          throw new Error(`${SYNTHETIC_REFERENCE} ${SYNTHETIC_PHONE}`);
        },
      ),
    ).resolves.toMatchObject({
      reasonCode: 'network_request_failed',
      failureClass: 'network',
    });
    await expect(
      retrieveCbeBirrAuthoritativeReceiptWithTransport(
        syntheticLookupInput,
        allowedTransportControl,
        async () => ({ ok: true, body: syntheticPdfEnvelope(), extra: 'SENSITIVE' }),
      ),
    ).resolves.toMatchObject({ reasonCode: 'network_request_failed' });
  });

  it('excludes the PDF digest, length, bytes, reference, and phone from log projection', async () => {
    const observed = await retrieveCbeBirrAuthoritativeReceiptWithTransport(
      syntheticLookupInput,
      allowedTransportControl,
      successfulTransport(),
    );
    const projection = redactedCbeBirrAuthoritativeReceiptTransportResultForLog(observed);
    expect(projection).toEqual({
      contractVersion: 1,
      transportPolicyVersion: 1,
      pdfEnvelopeVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'opaque_pdf_observation',
      reasonCode: 'official_pdf_observed',
      failureClass: null,
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(SYNTHETIC_REFERENCE);
    expect(serialized).not.toContain(SYNTHETIC_PHONE);
    expect(serialized).not.toMatch(/[0-9a-f]{64}/u);

    const forged = redactedCbeBirrAuthoritativeReceiptTransportResultForLog({
      ...(observed as object),
      evidenceClaimAllowed: true,
      secret: `${SYNTHETIC_REFERENCE} ${SYNTHETIC_PHONE}`,
    });
    expect(forged).toEqual({
      contractVersion: 1,
      transportPolicyVersion: 1,
      pdfEnvelopeVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      disposition: 'invalid_result',
      reasonCode: 'invalid_result',
      failureClass: 'invalid_result',
    });
  });

  it('keeps all downstream authority and PDF field parsing literal false in the result type', () => {
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['responseContractAttested']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['receiptFieldParsingAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['authoritativeAdapterAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['evidenceClaimAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['runtimeWiringAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['settlementAllowed']
    >().toEqualTypeOf<false>();
    expectTypeOf<
      CbeBirrAuthoritativeReceiptTransportResult['financialActionAllowed']
    >().toEqualTypeOf<false>();
  });
});
