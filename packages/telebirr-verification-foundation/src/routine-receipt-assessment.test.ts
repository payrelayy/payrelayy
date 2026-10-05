import { describe, expect, it } from 'vitest';

import { TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE } from './synthetic-official-receipt.js';
import {
  ROUTINE_TELEBIRR_MAXIMUM_AMOUNT_MINOR,
  ROUTINE_TELEBIRR_MINIMUM_AMOUNT_MINOR,
  assessRoutineTelebirrObservedReceiptFacts,
} from './routine-receipt-assessment.js';

const fingerprint = 'a'.repeat(64);
const receiverDigest = `sha256:${'b'.repeat(64)}`;
const receiverProfileDigest = `sha256:${'d'.repeat(64)}`;
const receiverRevisionId = '92679365-f082-4d67-b7cc-13e57149516c';

function fixture() {
  return {
    assessedAt: '2026-10-05T12:12:00.000Z',
    candidate: {
      providerCode: 'telebirr',
      referenceFingerprint: fingerprint,
      referenceKeyVersion: 2,
      referenceProfileVersion: 2,
      submittedAt: '2026-10-05T12:00:00.000Z',
    },
    expectedReceiverNameDigest: receiverDigest,
    expectedReceiverProfileDigest: receiverProfileDigest,
    expectedReceiverRevisionId: receiverRevisionId,
    observation: {
      amountMinor: ROUTINE_TELEBIRR_MINIMUM_AMOUNT_MINOR,
      canonicalReferencePresent: true,
      creditedPartyNameDigest: receiverDigest,
      currencyCode: 'ETB',
      evidenceSource: 'provider_receipt_lookup',
      occurredAt: '2026-10-05T11:45:00.000Z',
      observedAt: '2026-10-05T12:10:00.000Z',
      paymentChannel: 'api_app',
      paymentMode: 'telebirr',
      paymentReason: 'send_money_to_registered_customer',
      providerCode: 'telebirr',
      providerFinalStatus: 'completed',
      providerIdentity: 'matched',
      receiverMatch: 'matched',
      receiverProfileDigest,
      receiverRevisionId,
      referenceFingerprint: fingerprint,
      referenceMatch: 'matched',
      retrievedAt: '2026-10-05T12:10:00.000Z',
      sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    },
  };
}

describe('advisory routine TeleBirr receipt-facts assessment', () => {
  it.each([ROUTINE_TELEBIRR_MINIMUM_AMOUNT_MINOR, ROUTINE_TELEBIRR_MAXIMUM_AMOUNT_MINOR])(
    'matches the inclusive policy boundary at %i minor units without granting authority',
    (amountMinor) => {
      const input = fixture();
      input.observation.amountMinor = amountMinor;
      expect(assessRoutineTelebirrObservedReceiptFacts(input)).toEqual({
        advisoryOnly: true,
        sourceAuthenticationPerformed: false,
        databaseWriteAllowed: false,
        claimAllowed: false,
        settlementAllowed: false,
        enqueueAllowed: false,
        executionAllowed: false,
        financialActionAllowed: false,
        disposition: 'would_match_observed_facts',
        reasonCode: 'observed_facts_match',
      });
    },
  );

  it.each([
    [
      'amount below minimum',
      { amountMinor: ROUTINE_TELEBIRR_MINIMUM_AMOUNT_MINOR - 1 },
      'amount_out_of_range',
    ],
    [
      'amount above maximum',
      { amountMinor: ROUTINE_TELEBIRR_MAXIMUM_AMOUNT_MINOR + 1 },
      'amount_out_of_range',
    ],
    ['missing canonical reference', { canonicalReferencePresent: false }, 'reference_mismatch'],
    ['reference mismatch', { referenceMatch: 'mismatched' }, 'reference_mismatch'],
    ['wrong fingerprint', { referenceFingerprint: 'c'.repeat(64) }, 'reference_mismatch'],
    ['wrong provider', { providerIdentity: 'mismatched' }, 'provider_mismatch'],
    ['wrong receiver', { receiverMatch: 'mismatched' }, 'receiver_mismatch'],
    [
      'wrong credited party',
      { creditedPartyNameDigest: `sha256:${'c'.repeat(64)}` },
      'receiver_mismatch',
    ],
    [
      'wrong receiver revision',
      { receiverRevisionId: '4106d6f5-686b-4ed0-88b0-9246d7bd56e8' },
      'receiver_mismatch',
    ],
    [
      'wrong receiver profile',
      { receiverProfileDigest: `sha256:${'c'.repeat(64)}` },
      'receiver_mismatch',
    ],
    ['pending receipt', { providerFinalStatus: 'pending' }, 'provider_not_completed'],
    ['wrong currency', { currencyCode: 'USD' }, 'receipt_semantics_incomplete'],
    ['wrong source', { evidenceSource: 'customer_screenshot' }, 'receipt_semantics_incomplete'],
    ['wrong payment mode', { paymentMode: 'other' }, 'receipt_semantics_incomplete'],
    ['payment too old', { occurredAt: '2026-10-05T10:59:59.999Z' }, 'payment_time_mismatch'],
    ['payment too late', { occurredAt: '2026-10-05T12:05:00.001Z' }, 'payment_time_mismatch'],
    [
      'observation before payment',
      { observedAt: '2026-10-05T11:40:00.000Z', retrievedAt: '2026-10-05T11:40:00.000Z' },
      'observation_time_invalid',
    ],
    [
      'observation after assessment',
      { observedAt: '2026-10-05T12:13:00.000Z', retrievedAt: '2026-10-05T12:13:00.000Z' },
      'observation_time_invalid',
    ],
    [
      'retrieval time conflict',
      { retrievedAt: '2026-10-05T12:09:00.000Z' },
      'observation_time_invalid',
    ],
  ] as const)('reviews %s', (_name, observationChange, reasonCode) => {
    const input = fixture();
    expect(
      assessRoutineTelebirrObservedReceiptFacts({
        ...input,
        observation: { ...input.observation, ...observationChange },
      }),
    ).toMatchObject({ disposition: 'would_review', reasonCode, claimAllowed: false });
  });

  it('rejects a candidate exactly seven days old', () => {
    const input = fixture();
    expect(
      assessRoutineTelebirrObservedReceiptFacts({
        ...input,
        assessedAt: '2026-10-12T12:00:00.000Z',
      }),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'candidate_expired' });
  });

  it.each([
    null,
    { ...fixture(), rawReference: 'secret' },
    { ...fixture(), candidate: { ...fixture().candidate, rawReference: 'secret' } },
    { ...fixture(), observation: { ...fixture().observation, rawReceipt: 'secret' } },
    { ...fixture(), candidate: { ...fixture().candidate, submittedAt: 'not-a-time' } },
    { ...fixture(), candidate: { ...fixture().candidate, referenceProfileVersion: 1 } },
    {
      ...fixture(),
      observation: {
        ...fixture().observation,
        referenceFingerprint: `hmac-sha256:${fingerprint}`,
      },
    },
    { ...fixture(), observation: { ...fixture().observation, amountMinor: 2500.5 } },
  ])('rejects malformed or overbroad input without echoing data', (input) => {
    expect(assessRoutineTelebirrObservedReceiptFacts(input)).toEqual({
      advisoryOnly: true,
      sourceAuthenticationPerformed: false,
      databaseWriteAllowed: false,
      claimAllowed: false,
      settlementAllowed: false,
      enqueueAllowed: false,
      executionAllowed: false,
      financialActionAllowed: false,
      disposition: 'would_review',
      reasonCode: 'invalid_request',
    });
  });

  it('does not read getter properties or trust inherited data', () => {
    const accessorInput = fixture();
    Object.defineProperty(accessorInput, 'assessedAt', {
      enumerable: true,
      get() {
        throw new Error('must not read');
      },
    });
    expect(assessRoutineTelebirrObservedReceiptFacts(accessorInput).reasonCode).toBe(
      'invalid_request',
    );
    expect(assessRoutineTelebirrObservedReceiptFacts(Object.create(fixture())).reasonCode).toBe(
      'invalid_request',
    );
  });
});
