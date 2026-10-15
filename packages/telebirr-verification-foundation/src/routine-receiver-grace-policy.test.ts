import { describe, expect, it } from 'vitest';

import {
  assessRoutineTelebirrDirectOldReceiverGrace,
  assessRoutineTelebirrOldReceiverGrace,
  type RoutineReceiverGraceDirectInput,
  type RoutineReceiverGraceInput,
} from './routine-receiver-grace-policy.js';

const oldId = '12d383da-06cc-4b61-a176-b85c8ea1016d';
const newId = 'a8f34d19-907d-494f-a155-031fb4522e23';
const ownerDigest = `sha256:${'a'.repeat(64)}`;
const identityId = 'bb7792bc-f9fe-4a6a-a4cd-c197fdb8df96';
const playerId = 'cd572038-4822-4ffc-b62f-14d9acfde564';
const firstInstructionId = '939e637f-ac4a-43ad-bb8d-5b1e9bc822db';
const secondInstructionId = '3974815f-7618-42b7-b69d-02962b14626c';

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

function directInput(): RoutineReceiverGraceDirectInput {
  const base = validInput();
  return {
    customerIdentityId: identityId,
    playerAccountId: playerId,
    privateChatId: '123456789',
    paymentOccurredAt: base.paymentOccurredAt,
    referenceSubmittedAt: base.referenceSubmittedAt,
    officialReceiptAuthenticated: true,
    officialReceiptCompleted: true,
    receiptReceiverNameDigest: ownerDigest,
    receiptVisibleSuffix: '1234',
    configuredReceiverRevisions: base.configuredReceiverRevisions,
    instructions: [
      {
        instructionEventId: firstInstructionId,
        customerIdentityId: identityId,
        playerAccountId: playerId,
        privateChatId: '123456789',
        receiverRevisionId: oldId,
        issuedAt: base.instructionIssuedAt,
        expiresAt: base.instructionExpiresAt,
        receiverRetiredAt: base.oldReceiverRetiredAt,
        emergencyRevokedAt: null,
      },
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

describe('direct-submission old-receiver instruction selector (advisory only)', () => {
  it('finds one instruction in the same Telegram chat and Player without a reply', () => {
    expect(assessRoutineTelebirrDirectOldReceiverGrace(directInput())).toEqual({
      advisoryOnly: true,
      financialActionAllowed: false,
      disposition: 'would_match_one_instruction',
      reasonCode: 'one_instruction_matches',
      matchedInstructionEventId: firstInstructionId,
      matchedReceiverRevisionId: oldId,
    });
  });

  it.each([
    ['different Telegram identity', { customerIdentityId: newId }],
    ['different private chat', { privateChatId: '987654321' }],
    ['different Player', { playerAccountId: newId }],
  ] as const)('does not borrow an instruction from a %s', (_label, changes) => {
    expect(
      assessRoutineTelebirrDirectOldReceiverGrace({
        ...directInput(),
        instructions: [{ ...directInput().instructions[0]!, ...changes }],
      }),
    ).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'instruction_not_found',
      matchedInstructionEventId: null,
    });
  });

  it('reviews overlapping instructions even when they name the same receiver', () => {
    const first = directInput().instructions[0]!;
    expect(
      assessRoutineTelebirrDirectOldReceiverGrace({
        ...directInput(),
        instructions: [first, { ...first, instructionEventId: secondInstructionId }],
      }),
    ).toMatchObject({
      disposition: 'would_review',
      reasonCode: 'instruction_ambiguous',
      matchedInstructionEventId: null,
    });
  });

  it('selects the only matching instruction when another is outside its issued hour', () => {
    const first = directInput().instructions[0]!;
    expect(
      assessRoutineTelebirrDirectOldReceiverGrace({
        ...directInput(),
        instructions: [
          first,
          {
            ...first,
            instructionEventId: secondInstructionId,
            issuedAt: '2026-10-15T11:00:00.000Z',
            expiresAt: '2026-10-15T12:00:00.000Z',
            receiverRetiredAt: '2026-10-15T11:10:00.000Z',
          },
        ],
      }),
    ).toMatchObject({
      disposition: 'would_match_one_instruction',
      matchedInstructionEventId: firstInstructionId,
    });
  });

  it.each([
    ['an expired submission', { referenceSubmittedAt: '2026-10-15T13:00:00.000Z' }],
    ['a missing receiver suffix', { receiptVisibleSuffix: null }],
    ['an unauthenticated receipt', { officialReceiptAuthenticated: false }],
    ['a non-completed receipt', { officialReceiptCompleted: false }],
    ['a mismatched receiver name', { receiptReceiverNameDigest: `sha256:${'b'.repeat(64)}` }],
    ['a mismatched receiver suffix', { receiptVisibleSuffix: '5678' }],
  ] as const)('keeps %s for review', (_label, changes) => {
    expect(
      assessRoutineTelebirrDirectOldReceiverGrace({
        ...directInput(),
        ...changes,
      }),
    ).toMatchObject({ disposition: 'would_review', financialActionAllowed: false });
  });

  it('does not select a same-name and same-suffix collision across configured revisions', () => {
    expect(
      assessRoutineTelebirrDirectOldReceiverGrace({
        ...directInput(),
        configuredReceiverRevisions: [
          { revisionId: oldId, receiverNameDigest: ownerDigest, visibleSuffix: '1234' },
          { revisionId: newId, receiverNameDigest: ownerDigest, visibleSuffix: '1234' },
        ],
      }),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'no_qualifying_instruction' });
  });

  it('cannot match after emergency receiver revocation', () => {
    const first = directInput().instructions[0]!;
    expect(
      assessRoutineTelebirrDirectOldReceiverGrace({
        ...directInput(),
        instructions: [{ ...first, emergencyRevokedAt: '2026-10-15T12:15:00.000Z' }],
      }),
    ).toMatchObject({ disposition: 'would_review', reasonCode: 'no_qualifying_instruction' });
  });
});
