import { createHash } from 'node:crypto';

import { parseCbeBirrAuthoritativePdf } from '@fetanagent/cbe-birr-authoritative-pdf-parser';
import { describe, expect, it } from 'vitest';

import { retrieveAndParseCbeBirrReceiptWithTransportAndParser } from './advisory-composition.js';
import {
  SYNTHETIC_PHONE,
  SYNTHETIC_REFERENCE,
  allowedTransportControl,
  syntheticLookupInput,
  syntheticPdfEnvelope,
} from './test-helpers.js';

describe('package-only CBE Birr one-fetch advisory composition', () => {
  it('passes the same observed PDF bytes to the isolated parser after exactly one official-host request', async () => {
    const body = syntheticPdfEnvelope();
    const digest = createHash('sha256').update(body).digest('hex');
    let requests = 0;
    let parses = 0;
    const result = await retrieveAndParseCbeBirrReceiptWithTransportAndParser(
      syntheticLookupInput,
      allowedTransportControl,
      async (plan) => {
        requests += 1;
        expect(plan.host).toBe('cbepay1.cbe.com.et');
        expect(plan.pathAndQuery).toBe(
          `/aureceipt?TID=${SYNTHETIC_REFERENCE}&PH=${SYNTHETIC_PHONE.slice(3)}`,
        );
        return { ok: true, body };
      },
      async (parserBody, expectations) => {
        parses += 1;
        if (!(parserBody instanceof Uint8Array)) throw new Error('Expected bounded PDF bytes.');
        expect(createHash('sha256').update(parserBody).digest('hex')).toBe(digest);
        expect(expectations).toEqual({
          contractVersion: 1,
          providerCode: 'cbe_birr',
          sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
          canonicalReference: SYNTHETIC_REFERENCE,
          configuredReceiverAccountIdentifier: SYNTHETIC_PHONE,
        });
        return parseCbeBirrAuthoritativePdf(parserBody, expectations);
      },
    );

    expect(requests).toBe(1);
    expect(parses).toBe(1);
    expect(result).toMatchObject({
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      runtimeWiringAllowed: false,
      financialActionAllowed: false,
      disposition: 'parsed_advisory',
      transportResult: {
        disposition: 'opaque_pdf_observation',
        observation: { sha256Digest: digest },
      },
      parserResult: { disposition: 'would_review' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REFERENCE);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PHONE);
    expect(JSON.stringify(result)).not.toContain('%PDF-');
  });

  it('refuses a missing or malformed lookup receiver before the network or parser', async () => {
    let requests = 0;
    let parses = 0;
    for (const receiver of [
      undefined,
      null,
      '25100000000',
      '251000000001x',
      251000000001,
      '000000000001',
    ]) {
      const result = await retrieveAndParseCbeBirrReceiptWithTransportAndParser(
        { ...syntheticLookupInput, receiverLookupPhone: receiver },
        allowedTransportControl,
        async () => {
          requests += 1;
          return { ok: true, body: syntheticPdfEnvelope() };
        },
        async () => {
          parses += 1;
          throw new Error('must not parse');
        },
      );
      expect(result).toMatchObject({
        disposition: 'transport_failed_closed',
        transportResult: { disposition: 'invalid_request', reasonCode: 'invalid_request' },
      });
    }
    expect(requests).toBe(0);
    expect(parses).toBe(0);
  });

  it('uses one frozen receiver snapshot for both the lookup and PDF comparison', async () => {
    const mutableInput = { ...syntheticLookupInput };
    let requests = 0;
    let parses = 0;
    const result = await retrieveAndParseCbeBirrReceiptWithTransportAndParser(
      mutableInput,
      allowedTransportControl,
      async (plan) => {
        requests += 1;
        mutableInput.receiverLookupPhone = '251000000001';
        expect(plan.pathAndQuery).toContain(`PH=${SYNTHETIC_PHONE.slice(3)}`);
        return { ok: true, body: syntheticPdfEnvelope() };
      },
      async (body, expectations) => {
        parses += 1;
        expect(body).toBeInstanceOf(Uint8Array);
        expect(expectations).toMatchObject({
          configuredReceiverAccountIdentifier: SYNTHETIC_PHONE,
        });
        return parseCbeBirrAuthoritativePdf(body, expectations);
      },
    );
    expect(requests).toBe(1);
    expect(parses).toBe(1);
    expect(result.disposition).toBe('parsed_advisory');
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PHONE);
    expect(JSON.stringify(result)).not.toContain(mutableInput.receiverLookupPhone);
  });

  it('honors the incident stop and never parses a failed or malformed response', async () => {
    let requests = 0;
    let parses = 0;
    const parser = async (): Promise<never> => {
      parses += 1;
      throw new Error('must not parse');
    };
    const stopped = await retrieveAndParseCbeBirrReceiptWithTransportAndParser(
      syntheticLookupInput,
      { ...allowedTransportControl, incidentStop: 'open' },
      async () => {
        requests += 1;
        return { ok: true, body: syntheticPdfEnvelope() };
      },
      parser,
    );
    expect(stopped).toMatchObject({
      disposition: 'transport_failed_closed',
      transportResult: { disposition: 'stopped', reasonCode: 'incident_stop_open' },
    });
    const malformed = await retrieveAndParseCbeBirrReceiptWithTransportAndParser(
      syntheticLookupInput,
      allowedTransportControl,
      async () => {
        requests += 1;
        return { ok: true, body: new TextEncoder().encode('<html>not a PDF</html>') };
      },
      parser,
    );
    expect(malformed).toMatchObject({
      disposition: 'transport_failed_closed',
      transportResult: { disposition: 'failed_closed', reasonCode: 'pdf_envelope_rejected' },
    });
    expect(requests).toBe(1);
    expect(parses).toBe(0);
  });

  it('fails closed without leaking parser exceptions or returning any raw receipt bytes', async () => {
    const result = await retrieveAndParseCbeBirrReceiptWithTransportAndParser(
      syntheticLookupInput,
      allowedTransportControl,
      async () => ({ ok: true, body: syntheticPdfEnvelope() }),
      async () => {
        throw new Error('SYNTHETIC PRIVATE PARSER ERROR');
      },
    );
    expect(result).toMatchObject({
      disposition: 'parser_failed_closed',
      advisoryOnly: true,
      financialActionAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC PRIVATE PARSER ERROR');
    expect(JSON.stringify(result)).not.toContain('%PDF-');
  });

  it('does not propagate a forged parser result carrying protected fields', async () => {
    const result = await retrieveAndParseCbeBirrReceiptWithTransportAndParser(
      syntheticLookupInput,
      allowedTransportControl,
      async () => ({ ok: true, body: syntheticPdfEnvelope() }),
      async () =>
        ({
          disposition: 'would_reject',
          reasonCode: 'receiver_mismatch',
          privateReference: SYNTHETIC_REFERENCE,
        }) as never,
    );
    expect(result).toMatchObject({
      disposition: 'parser_failed_closed',
      advisoryOnly: true,
      financialActionAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REFERENCE);
  });
});
