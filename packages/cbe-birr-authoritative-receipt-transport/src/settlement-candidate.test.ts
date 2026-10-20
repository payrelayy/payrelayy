import type { CbeBirrAuthoritativePdfParserResult } from '@fetanagent/cbe-birr-authoritative-pdf-parser';
import { describe, expect, it, vi } from 'vitest';

import type { CbeBirrReceiverBoundAdvisoryResult } from './advisory-composition.js';
import { fetchCbeBirrAuthoritativeReceiptInternallyWithTransport } from './runner.js';
import {
  classifyCbeBirrSettlementCandidate,
  retrieveCbeBirrSettlementCandidateWithLookup,
} from './settlement-candidate.js';
import {
  SYNTHETIC_PHONE,
  SYNTHETIC_REFERENCE,
  allowedTransportControl,
  syntheticLookupInput,
  syntheticPdfEnvelope,
} from './test-helpers.js';

const instruction = {
  receiverRevisionId: '12345678-1234-4123-8123-123456789abc',
  receiverVersion: 3,
  issuedAt: '2026-10-14T21:00:00.000Z',
  expiresAt: '2026-10-14T22:00:00.000Z',
  submittedAt: '2026-10-14T21:05:00.000Z',
  receiverRevisionActiveAtSubmission: true,
} as const;
const observedAt = new Date('2026-10-14T21:06:00.000Z');

const disabledParserCapabilities = {
  advisoryOnly: true,
  safeFactsOnly: true,
  sqlAuthorizationAllowed: false,
  transportAllowed: false,
  networkAllowed: false,
  providerRequestAllowed: false,
  decryptionAllowed: false,
  databaseReadAllowed: false,
  databaseWriteAllowed: false,
  persistenceAllowed: false,
  runtimeWiringAllowed: false,
  claimAllowed: false,
  settlementAllowed: false,
  enqueueAllowed: false,
  executionAllowed: false,
  financialActionAllowed: false,
  kemerBetActionAllowed: false,
  blindRetryAllowed: false,
} as const;

function matchedParserResult(principalAmountMinor = '10000') {
  return {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
    parserVersion: 2,
    ...disabledParserCapabilities,
    disposition: 'would_review',
    reasonCode: 'receiver_identity_observed',
    facts: {
      documentTopology: 'cbe_birr_vat_customer_receipt_credit_account_v2',
      pageCount: 1,
      activeContentAbsent: true,
      attachmentsAbsent: true,
      formsAbsent: true,
      referenceMatched: true,
      receiverDisplayNamePresent: true,
      receiverIdentifierEvidence: 'exact_pdf_credit_account',
      receiverIdentityMatch: 'matched',
      receiverMatchBasis: 'pdf_credit_account',
      receiptStatus: 'completed',
      transactionType: 'send_money',
      currencyCode: 'ETB',
      principalAmountMinor,
      serviceChargeMinor: '200',
      vatMinor: '30',
      totalPaidAmountMinor: (BigInt(principalAmountMinor) + 230n).toString(),
      feeArithmetic: 'consistent',
      additionalFeesMinor: '0',
      occurredAt: '2026-10-15T00:03:00+03:00',
      occurredAtPrecision: 'minute',
      occurredAtTimeZone: 'Africa/Addis_Ababa',
    },
  } as const satisfies CbeBirrAuthoritativePdfParserResult;
}

async function officialObservation(
  parserResult: CbeBirrAuthoritativePdfParserResult = matchedParserResult(),
): Promise<CbeBirrReceiverBoundAdvisoryResult> {
  const fetched = await fetchCbeBirrAuthoritativeReceiptInternallyWithTransport(
    syntheticLookupInput,
    allowedTransportControl,
    async () => ({ ok: true, body: syntheticPdfEnvelope() }),
  );
  if (!fetched.ok) throw new Error('Synthetic transport did not produce a PDF observation.');
  return {
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    runtimeWiringAllowed: false,
    financialActionAllowed: false,
    disposition: 'parsed_advisory',
    transportResult: fetched.result,
    parserResult,
  };
}

describe('one-fetch CBE receipt handoff to the claim preflight', () => {
  it('keeps exact official receipt facts redacted and still forbids a claim or credit', async () => {
    const result = classifyCbeBirrSettlementCandidate(
      await officialObservation(),
      instruction,
      observedAt,
    );
    expect(result).toMatchObject({
      disposition: 'receipt_ready_for_claim_preflight',
      reasonCode: 'official_receipt_matched',
      principalAmountMinor: '10000',
      occurredAtPrecision: 'minute',
      sourceDocumentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      sourceContractAttested: false,
      claimAllowed: false,
      financialActionAllowed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_REFERENCE);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_PHONE);
  });

  it.each(['reference_mismatch', 'receiver_mismatch', 'currency_not_etb'] as const)(
    'classifies exact parser rejection %s without creating money authority',
    async (reason) => {
      const matched = matchedParserResult();
      const parserResult = {
        ...matched,
        disposition: 'would_reject' as const,
        reasonCode: reason,
        facts: {
          ...matched.facts,
          ...(reason === 'reference_mismatch' ? { referenceMatched: false } : {}),
          ...(reason === 'receiver_mismatch' ? { receiverIdentityMatch: 'mismatched' } : {}),
          ...(reason === 'currency_not_etb' ? { currencyCode: 'other' } : {}),
        },
      } satisfies CbeBirrAuthoritativePdfParserResult;
      const result = classifyCbeBirrSettlementCandidate(
        await officialObservation(parserResult),
        instruction,
        observedAt,
      );
      expect(result).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
        sourceContractAttested: false,
        claimAllowed: false,
        financialActionAllowed: false,
        disposition: 'reject',
        reasonCode: reason,
      });
    },
  );

  it('holds out-of-range, stale, and malformed observations for review', async () => {
    const tooSmall = classifyCbeBirrSettlementCandidate(
      await officialObservation(matchedParserResult('2499')),
      instruction,
      observedAt,
    );
    expect(tooSmall).toMatchObject({ disposition: 'review', reasonCode: 'principal_out_of_range' });
    const stale = classifyCbeBirrSettlementCandidate(
      await officialObservation(),
      { ...instruction, submittedAt: '2026-10-14T22:00:00.000Z' },
      observedAt,
    );
    expect(stale).toMatchObject({ disposition: 'review', reasonCode: 'instruction_window_review' });
    const malformed = classifyCbeBirrSettlementCandidate(
      await officialObservation({
        ...matchedParserResult(),
        privateReference: SYNTHETIC_REFERENCE,
      } as unknown as CbeBirrAuthoritativePdfParserResult),
      instruction,
      observedAt,
    );
    expect(malformed).toMatchObject({
      disposition: 'review',
      reasonCode: 'receipt_requires_review',
    });
    for (const result of [tooSmall, stale, malformed]) {
      expect(result.claimAllowed).toBe(false);
      expect(result.financialActionAllowed).toBe(false);
      expect(result).not.toHaveProperty('principalAmountMinor');
    }
  });

  it('does not promote a failed fetch or parser outcome to a claim candidate', async () => {
    const parsed = await officialObservation();
    for (const receipt of [
      { ...parsed, disposition: 'parser_failed_closed' as const, parserResult: undefined },
      { ...parsed, disposition: 'transport_failed_closed' as const, parserResult: undefined },
    ]) {
      const result = classifyCbeBirrSettlementCandidate(
        receipt as unknown as CbeBirrReceiverBoundAdvisoryResult,
        instruction,
        observedAt,
      );
      expect(result).toMatchObject({
        disposition: 'review',
        reasonCode: 'receipt_unavailable',
        claimAllowed: false,
        financialActionAllowed: false,
      });
    }
  });

  it('blocks an invalid instruction before the provider lookup', async () => {
    const lookup = vi.fn(async () => officialObservation());
    const result = await retrieveCbeBirrSettlementCandidateWithLookup(
      SYNTHETIC_REFERENCE,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { ...instruction, receiverRevisionActiveAtSubmission: false },
      allowedTransportControl,
      lookup,
      () => observedAt,
    );
    expect(result).toMatchObject({
      disposition: 'review',
      reasonCode: 'receiver_revision_inactive',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('requires the instruction and opened receiver to name the same revision before lookup', async () => {
    const lookup = vi.fn(async () => officialObservation());
    const receiver = {
      receiverRevisionId: instruction.receiverRevisionId,
      receiverVersion: instruction.receiverVersion,
    } as never;
    const child = {
      receiverRevisionId: instruction.receiverRevisionId,
      receiverVersion: instruction.receiverVersion,
    } as never;
    const result = await retrieveCbeBirrSettlementCandidateWithLookup(
      SYNTHETIC_REFERENCE,
      receiver,
      child,
      undefined as never,
      undefined as never,
      { ...instruction, receiverVersion: instruction.receiverVersion + 1 },
      allowedTransportControl,
      lookup,
      () => observedAt,
    );
    expect(result).toMatchObject({
      disposition: 'review',
      reasonCode: 'receiver_revision_inactive',
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});
