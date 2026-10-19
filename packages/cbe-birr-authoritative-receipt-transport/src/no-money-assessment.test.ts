import type { CbeBirrAuthoritativePdfParserResult } from '@fetanagent/cbe-birr-authoritative-pdf-parser';
import { describe, expect, it } from 'vitest';

import type { CbeBirrReceiverBoundAdvisoryResult } from './advisory-composition.js';
import { assessCbeBirrProtectedReceiptNoMoney } from './no-money-assessment.js';

const instruction = {
  issuedAt: '2026-10-14T21:00:00.000Z',
  expiresAt: '2026-10-14T22:00:00.000Z',
  submittedAt: '2026-10-14T21:05:00.000Z',
  receiverRevisionActiveAtSubmission: true,
} as const;

const capabilities = {
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

function parsedReceipt(principalAmountMinor = '10000') {
  const result = {
    contractVersion: 1,
    providerCode: 'cbe_birr',
    sourceProfile: 'cbe_birr_official_receipt_lookup_v1',
    parserVersion: 2,
    ...capabilities,
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
  return result;
}

function observedReceipt(parserResult: unknown): CbeBirrReceiverBoundAdvisoryResult {
  return {
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    runtimeWiringAllowed: false,
    financialActionAllowed: false,
    disposition: 'parsed_advisory',
    parserResult,
    transportResult: { disposition: 'opaque_pdf_observation' },
  } as CbeBirrReceiverBoundAdvisoryResult;
}

describe('CBE Birr protected-receiver no-money assessment', () => {
  it.each(['2500', '10000', '2500000'])(
    'accepts a consistent %s-minor-unit principal without granting a financial action',
    (principal) => {
      const result = assessCbeBirrProtectedReceiptNoMoney(
        observedReceipt(parsedReceipt(principal)),
        instruction,
      );
      expect(result).toEqual({
        contractVersion: 1,
        providerCode: 'cbe_birr',
        advisoryOnly: true,
        sourceContractAttested: false,
        runtimeWiringAllowed: false,
        claimAllowed: false,
        financialActionAllowed: false,
        disposition: 'receipt_consistent_advisory',
        reasonCode: 'receipt_consistent_advisory',
        principalAmountMinor: principal,
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it.each(['2499', '2500001'])(
    'reviews an out-of-range %s-minor-unit principal rather than crediting fees',
    (principal) => {
      const result = assessCbeBirrProtectedReceiptNoMoney(
        observedReceipt(parsedReceipt(principal)),
        instruction,
      );
      expect(result).toMatchObject({
        disposition: 'would_review',
        reasonCode: 'principal_out_of_range',
        financialActionAllowed: false,
      });
      expect(result).not.toHaveProperty('principalAmountMinor');
    },
  );

  it('reviews a retired receiver, a minute crossing the instruction cutoff, and late submission', () => {
    const receipt = observedReceipt(parsedReceipt());
    expect(
      assessCbeBirrProtectedReceiptNoMoney(receipt, {
        ...instruction,
        receiverRevisionActiveAtSubmission: false,
      }).reasonCode,
    ).toBe('receiver_revision_inactive');
    expect(
      assessCbeBirrProtectedReceiptNoMoney(receipt, {
        ...instruction,
        issuedAt: '2026-10-14T21:03:30.000Z',
        expiresAt: '2026-10-14T22:03:30.000Z',
      }).reasonCode,
    ).toBe('instruction_window_review');
    expect(
      assessCbeBirrProtectedReceiptNoMoney(receipt, {
        ...instruction,
        submittedAt: instruction.expiresAt,
      }).reasonCode,
    ).toBe('instruction_window_review');
  });

  it('reviews malformed, unmatched, and unavailable observations without exposing protected data', () => {
    const matched = parsedReceipt();
    for (const parserResult of [
      { ...matched, facts: { ...matched.facts, receiverIdentityMatch: 'mismatched' } },
      { ...matched, facts: { ...matched.facts, referenceMatched: false } },
      { ...matched, privateReference: 'SYNTHETIC123' },
    ]) {
      const result = assessCbeBirrProtectedReceiptNoMoney(
        observedReceipt(parserResult),
        instruction,
      );
      expect(result).toMatchObject({
        disposition: 'would_review',
        reasonCode: 'receipt_requires_review',
      });
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC123');
    }
    expect(
      assessCbeBirrProtectedReceiptNoMoney(
        { disposition: 'receiver_unavailable' } as CbeBirrReceiverBoundAdvisoryResult,
        instruction,
      ).reasonCode,
    ).toBe('receipt_unavailable');
  });
});
