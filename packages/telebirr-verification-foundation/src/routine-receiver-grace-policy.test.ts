import { describe, expect, it } from 'vitest';

import {
  assessRoutineTelebirrOldReceiverGrace,
  type RoutineReceiverGraceInput,
} from './routine-receiver-grace-policy.js';

const oldId = '12d383da-06cc-4b61-a176-b85c8ea1016d';
const newId = 'a8f34d19-907d-494f-a155-031fb4522e23';
const ownerDigest = `sha256:${'a'.repeat(64)}`;

function validInput(): RoutineReceiverGraceInput {
  return {
    instructionIssuedAt: '2026-10-15T12:00:00.000Z',
    instructionExpiresAt: '2026-10-15T13:00:00.000Z',
    oldReceiverRetiredAt: '2026-10-15T12:10:00.000Z',
    paymentOccurredAt: '2026-10-15T12:15:00.000Z',
    referenceSubmittedAt: '2026-10-15T12:20:00.000Z',
    emergencyRevokedAt: null,
    oldReceiverRevisionId: oldId,
    officialReceiptAuthenticated: true,
    officialReceiptCompleted: true,
    receiptReceiverNameDigest: ownerDigest,
    receiptVisibleSuffix: '1234',
    configuredReceiverRevisions: [
      { revisionId: oldId, receiverNameDigest: ownerDigest, visibleSuffix: '1234' },
      { revisionId: newId, receiverNameDigest: ownerDigest, visibleSuffix: '5678' },
    ],
  };
}

describe('one-hour old TeleBirr receiver grace policy (advisory only)', () => {
  it('matches a unique name and visible suffix during the issued hour without granting money authority', () => {
    expect(assessRoutineTelebirrOldReceiverGrace(validInput())).toEqual({
      advisoryOnly: true,
      financialActionAllowed: false,
      disposition: 'would_match_grace',
      reasonCode: 'grace_facts_match',
    });
  });

  it('keeps the issued old revision for a payment made before rotation and submitted after it', () => {
    expect(
      assessRoutineTelebirrOldReceiverGrace({
        ...validInput(),
        paymentOccurredAt: '2026-10-15T12:09:59.999Z',
      }),
    ).toMatchObject({ disposition: 'would_match_grace', reasonCode: 'grace_facts_match' });
  });

  it.each([
    [
      'same name and suffix on a second receiver',
      {
        configuredReceiverRevisions: [
          { revisionId: oldId, receiverNameDigest: ownerDigest, visibleSuffix: '1234' },
          { revisionId: newId, receiverNameDigest: ownerDigest, visibleSuffix: '1234' },
        ],
      },
      'receiver_identity_ambiguous',
    ],
    ['missing visible suffix', { receiptVisibleSuffix: null }, 'receiver_identity_ambiguous'],
    [
      'non-four-digit visible suffix',
      { receiptVisibleSuffix: '123' },
      'receiver_identity_ambiguous',
    ],
    [
      'name belongs to a different receiver',
      { receiptReceiverNameDigest: `sha256:${'b'.repeat(64)}` },
      'receiver_identity_mismatch',
    ],
    [
      'suffix points to the new receiver',
      { receiptVisibleSuffix: '5678' },
      'receiver_identity_mismatch',
    ],
    [
      'reference submitted after expiry',
      { referenceSubmittedAt: '2026-10-15T13:00:00.000Z' },
      'reference_submitted_after_expiry',
    ],
    [
      'payment after expiry',
      { paymentOccurredAt: '2026-10-15T13:00:00.000Z' },
      'payment_outside_instruction',
    ],
    [
      'emergency revocation',
      { emergencyRevokedAt: '2026-10-15T12:14:00.000Z' },
      'emergency_revoked',
    ],
    [
      'emergency revocation after payment but before the decision',
      {
        paymentOccurredAt: '2026-10-15T12:09:00.000Z',
        emergencyRevokedAt: '2026-10-15T12:10:00.000Z',
      },
      'emergency_revoked',
    ],
    ['unattested receipt', { officialReceiptAuthenticated: false }, 'official_receipt_unproven'],
    [
      'receiver retired before instruction',
      { oldReceiverRetiredAt: '2026-10-15T11:59:59.999Z' },
      'instruction_not_in_grace',
    ],
  ] as const)('reviews %s', (_label, changes, expectedReason) => {
    expect(assessRoutineTelebirrOldReceiverGrace({ ...validInput(), ...changes })).toMatchObject({
      financialActionAllowed: false,
      disposition: 'would_review',
      reasonCode: expectedReason,
    });
  });
});
