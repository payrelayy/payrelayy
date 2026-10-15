/**
 * Receiver-grace policy only. This module neither authenticates a provider receipt nor grants
 * settlement authority; the signed phone and database must independently enforce the same facts.
 */
const ONE_HOUR_MS = 60 * 60 * 1_000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VISIBLE_SUFFIX = /^[0-9]{4}$/u;

export interface RoutineReceiverGraceRevision {
  readonly revisionId: string;
  readonly receiverNameDigest: string;
  readonly visibleSuffix: string;
}

export interface RoutineReceiverGraceInput {
  readonly instructionIssuedAt: string;
  readonly instructionExpiresAt: string;
  readonly oldReceiverRetiredAt: string;
  readonly paymentOccurredAt: string;
  readonly referenceSubmittedAt: string;
  readonly emergencyRevokedAt: string | null;
  readonly oldReceiverRevisionId: string;
  readonly officialReceiptAuthenticated: boolean;
  readonly officialReceiptCompleted: boolean;
  readonly receiptReceiverNameDigest: string;
  readonly receiptVisibleSuffix: string | null;
  readonly configuredReceiverRevisions: readonly RoutineReceiverGraceRevision[];
}

export type RoutineReceiverGraceReason =
  | 'invalid_input'
  | 'instruction_not_in_grace'
  | 'payment_outside_instruction'
  | 'reference_submitted_after_expiry'
  | 'emergency_revoked'
  | 'official_receipt_unproven'
  | 'receiver_identity_ambiguous'
  | 'receiver_identity_mismatch'
  | 'grace_facts_match';

export interface RoutineReceiverGraceAssessment {
  readonly advisoryOnly: true;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_match_grace';
  readonly reasonCode: RoutineReceiverGraceReason;
}

/**
 * Read-only candidate set for a reference sent directly to the bot. These identifiers and
 * timestamps must come from durable instruction rows, never from Telegram message text.
 */
export interface RoutineReceiverGraceInstruction {
  readonly instructionEventId: string;
  readonly customerIdentityId: string;
  readonly playerAccountId: string;
  readonly privateChatId: string;
  readonly receiverRevisionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly receiverRetiredAt: string;
  readonly emergencyRevokedAt: string | null;
}

export interface RoutineReceiverGraceDirectInput {
  readonly customerIdentityId: string;
  readonly playerAccountId: string;
  readonly privateChatId: string;
  readonly paymentOccurredAt: string;
  readonly referenceSubmittedAt: string;
  readonly officialReceiptAuthenticated: boolean;
  readonly officialReceiptCompleted: boolean;
  readonly receiptReceiverNameDigest: string;
  readonly receiptVisibleSuffix: string | null;
  readonly configuredReceiverRevisions: readonly RoutineReceiverGraceRevision[];
  readonly instructions: readonly RoutineReceiverGraceInstruction[];
}

export interface RoutineReceiverGraceDirectAssessment {
  readonly advisoryOnly: true;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_match_one_instruction';
  readonly reasonCode:
    | 'invalid_input'
    | 'instruction_not_found'
    | 'instruction_ambiguous'
    | 'no_qualifying_instruction'
    | 'one_instruction_matches';
  readonly matchedInstructionEventId: string | null;
  readonly matchedReceiverRevisionId: string | null;
}

function result(
  disposition: RoutineReceiverGraceAssessment['disposition'],
  reasonCode: RoutineReceiverGraceReason,
): RoutineReceiverGraceAssessment {
  return Object.freeze({
    advisoryOnly: true,
    financialActionAllowed: false,
    disposition,
    reasonCode,
  });
}

function utcMs(value: string): number | null {
  if (!ISO_UTC.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

/**
 * A name plus four visible digits is a user-accepted heuristic, not full-number proof. Even a
 * positive result remains non-authoritative until the source, signed observation, one-use claim,
 * instruction binding, and eligibility are checked transactionally by the paid pipeline.
 */
export function assessRoutineTelebirrOldReceiverGrace(
  input: RoutineReceiverGraceInput,
): RoutineReceiverGraceAssessment {
  const issuedAt = utcMs(input.instructionIssuedAt);
  const expiresAt = utcMs(input.instructionExpiresAt);
  const retiredAt = utcMs(input.oldReceiverRetiredAt);
  const occurredAt = utcMs(input.paymentOccurredAt);
  const submittedAt = utcMs(input.referenceSubmittedAt);
  const revokedAt = input.emergencyRevokedAt === null ? null : utcMs(input.emergencyRevokedAt);
  const revisions = input.configuredReceiverRevisions;
  if (
    issuedAt === null ||
    expiresAt === null ||
    retiredAt === null ||
    occurredAt === null ||
    submittedAt === null ||
    (input.emergencyRevokedAt !== null && revokedAt === null) ||
    !UUID_V4.test(input.oldReceiverRevisionId) ||
    !DIGEST.test(input.receiptReceiverNameDigest) ||
    revisions.length === 0 ||
    revisions.length > 32 ||
    revisions.some(
      (revision) =>
        !UUID_V4.test(revision.revisionId) ||
        !DIGEST.test(revision.receiverNameDigest) ||
        !VISIBLE_SUFFIX.test(revision.visibleSuffix),
    ) ||
    new Set(revisions.map((revision) => revision.revisionId)).size !== revisions.length
  )
    return result('would_review', 'invalid_input');
  if (expiresAt - issuedAt !== ONE_HOUR_MS || retiredAt < issuedAt || retiredAt >= expiresAt) {
    return result('would_review', 'instruction_not_in_grace');
  }
  // The instruction names the old revision for its entire issued hour. A payment made just
  // before rotation can be submitted afterward and must not be rebound to the new receiver.
  if (occurredAt < issuedAt || occurredAt >= expiresAt || occurredAt > submittedAt) {
    return result('would_review', 'payment_outside_instruction');
  }
  if (submittedAt >= expiresAt) return result('would_review', 'reference_submitted_after_expiry');
  // Emergency revocation blocks any *new* automatic grace decision, even for a payment that
  // occurred before revocation. A completed credit is handled by its own immutable ledger.
  if (revokedAt !== null) {
    return result('would_review', 'emergency_revoked');
  }
  if (!input.officialReceiptAuthenticated || !input.officialReceiptCompleted) {
    return result('would_review', 'official_receipt_unproven');
  }
  if (input.receiptVisibleSuffix === null || !VISIBLE_SUFFIX.test(input.receiptVisibleSuffix)) {
    return result('would_review', 'receiver_identity_ambiguous');
  }
  const matching = revisions.filter(
    (revision) =>
      revision.receiverNameDigest === input.receiptReceiverNameDigest &&
      revision.visibleSuffix === input.receiptVisibleSuffix,
  );
  if (matching.length === 0) return result('would_review', 'receiver_identity_mismatch');
  if (matching.length > 1) return result('would_review', 'receiver_identity_ambiguous');
  if (matching[0]!.revisionId !== input.oldReceiverRevisionId) {
    return result('would_review', 'receiver_identity_mismatch');
  }
  return result('would_match_grace', 'grace_facts_match');
}

function directResult(
  reasonCode: RoutineReceiverGraceDirectAssessment['reasonCode'],
  instruction: RoutineReceiverGraceInstruction | null = null,
): RoutineReceiverGraceDirectAssessment {
  return Object.freeze({
    advisoryOnly: true,
    financialActionAllowed: false,
    disposition: instruction === null ? 'would_review' : 'would_match_one_instruction',
    reasonCode,
    matchedInstructionEventId: instruction?.instructionEventId ?? null,
    matchedReceiverRevisionId: instruction?.receiverRevisionId ?? null,
  });
}

/**
 * A direct submission can only identify a retired receiver through exactly one same-chat,
 * same-Player, unexpired instruction and a signed official credited-party name/suffix match.
 * This selector is advisory: the paid database claim must repeat every check under a lock.
 */
export function assessRoutineTelebirrDirectOldReceiverGrace(
  input: RoutineReceiverGraceDirectInput,
): RoutineReceiverGraceDirectAssessment {
  if (
    !UUID_V4.test(input.customerIdentityId) ||
    !UUID_V4.test(input.playerAccountId) ||
    !/^[1-9][0-9]{0,15}$/u.test(input.privateChatId) ||
    BigInt(input.privateChatId) > 9007199254740991n ||
    utcMs(input.paymentOccurredAt) === null ||
    utcMs(input.referenceSubmittedAt) === null ||
    input.instructions.length > 32 ||
    new Set(input.instructions.map((instruction) => instruction.instructionEventId)).size !==
      input.instructions.length
  )
    return directResult('invalid_input');

  const sameContext = input.instructions.filter(
    (instruction) =>
      instruction.customerIdentityId === input.customerIdentityId &&
      instruction.playerAccountId === input.playerAccountId &&
      instruction.privateChatId === input.privateChatId,
  );
  if (sameContext.length === 0) return directResult('instruction_not_found');

  const matches: RoutineReceiverGraceInstruction[] = [];
  for (const instruction of sameContext) {
    if (!UUID_V4.test(instruction.instructionEventId)) return directResult('invalid_input');
    const assessment = assessRoutineTelebirrOldReceiverGrace({
      instructionIssuedAt: instruction.issuedAt,
      instructionExpiresAt: instruction.expiresAt,
      oldReceiverRetiredAt: instruction.receiverRetiredAt,
      paymentOccurredAt: input.paymentOccurredAt,
      referenceSubmittedAt: input.referenceSubmittedAt,
      emergencyRevokedAt: instruction.emergencyRevokedAt,
      oldReceiverRevisionId: instruction.receiverRevisionId,
      officialReceiptAuthenticated: input.officialReceiptAuthenticated,
      officialReceiptCompleted: input.officialReceiptCompleted,
      receiptReceiverNameDigest: input.receiptReceiverNameDigest,
      receiptVisibleSuffix: input.receiptVisibleSuffix,
      configuredReceiverRevisions: input.configuredReceiverRevisions,
    });
    if (assessment.reasonCode === 'invalid_input') return directResult('invalid_input');
    if (assessment.disposition === 'would_match_grace') matches.push(instruction);
  }
  if (matches.length === 0) return directResult('no_qualifying_instruction');
  if (matches.length !== 1) return directResult('instruction_ambiguous');
  return directResult('one_instruction_matches', matches[0]!);
}
