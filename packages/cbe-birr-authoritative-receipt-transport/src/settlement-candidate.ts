import {
  parseCbeBirrAuthoritativePdf,
  redactedCbeBirrAuthoritativePdfParserResultForLog,
} from '@fetanagent/cbe-birr-authoritative-pdf-parser';
import type {
  CbeBirrApprovedReceiverLookupRootProfile,
  CbeBirrReceiverLookupChildKey,
  CbeBirrReceiverLookupOpeningProfile,
  OpenCbeBirrReceiverLookupInput,
} from '@fetanagent/deposit-reference-protection/cbe-birr-receiver-opening';

import {
  retrieveAndParseCbeBirrReceiptForProtectedReceiverAdvisoryOnly,
  type CbeBirrReceiverBoundAdvisoryResult,
} from './advisory-composition.js';
import {
  assessCbeBirrProtectedReceiptNoMoney,
  type CbeBirrNoMoneyInstructionSnapshot,
} from './no-money-assessment.js';
import { cbeBirrNodeHttpsTransport } from './node-https-transport.js';
import { redactedCbeBirrAuthoritativeReceiptTransportResultForLog } from './runner.js';
import type { CbeBirrAuthoritativeReceiptTransportControl } from './shared.js';

type ReviewReason =
  | 'receipt_unavailable'
  | 'receipt_requires_review'
  | 'receiver_revision_inactive'
  | 'principal_out_of_range'
  | 'instruction_window_review';
type RejectReason = 'reference_mismatch' | 'receiver_mismatch' | 'currency_not_etb';

/** The revision must come from the same immutable database instruction as the proof. */
export interface CbeBirrSettlementInstructionSnapshot extends CbeBirrNoMoneyInstructionSnapshot {
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
}

interface ResultBase {
  readonly contractVersion: 1;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: 'cbe_birr_official_receipt_lookup_v1';
  readonly sourceContractAttested: false;
  /** Only the atomic database claim boundary may grant these capabilities. */
  readonly claimAllowed: false;
  readonly financialActionAllowed: false;
}

export type CbeBirrSettlementCandidateResult =
  | (ResultBase & {
      readonly disposition: 'review';
      readonly reasonCode: ReviewReason;
    })
  | (ResultBase & {
      readonly disposition: 'reject';
      readonly reasonCode: RejectReason;
    })
  | (ResultBase & {
      readonly disposition: 'receipt_ready_for_claim_preflight';
      readonly reasonCode: 'official_receipt_matched';
      readonly principalAmountMinor: string;
      readonly occurredAt: string;
      readonly occurredAtPrecision: 'minute';
      readonly observedAt: string;
      readonly sourceDocumentDigest: string;
      readonly parserVersion: 2;
    });

const base = Object.freeze({
  contractVersion: 1 as const,
  providerCode: 'cbe_birr' as const,
  sourceProfile: 'cbe_birr_official_receipt_lookup_v1' as const,
  sourceContractAttested: false as const,
  claimAllowed: false as const,
  financialActionAllowed: false as const,
});

function review(reasonCode: ReviewReason): CbeBirrSettlementCandidateResult {
  return Object.freeze({ ...base, disposition: 'review' as const, reasonCode });
}

function reject(reasonCode: RejectReason): CbeBirrSettlementCandidateResult {
  return Object.freeze({ ...base, disposition: 'reject' as const, reasonCode });
}

/**
 * This reducer is package-internal. A caller-supplied PDF or fabricated result must never enter
 * it from an application boundary: the production entry point below performs the fixed official
 * HTTPS retrieval and isolated PDF parse itself.
 */
export function classifyCbeBirrSettlementCandidate(
  receipt: CbeBirrReceiverBoundAdvisoryResult,
  instruction: CbeBirrNoMoneyInstructionSnapshot,
  observedAt: Date,
): CbeBirrSettlementCandidateResult {
  if (
    receipt.disposition !== 'parsed_advisory' ||
    redactedCbeBirrAuthoritativeReceiptTransportResultForLog(receipt.transportResult)
      .disposition !== 'opaque_pdf_observation'
  ) {
    return review('receipt_unavailable');
  }
  const parsed = receipt.parserResult;
  if (redactedCbeBirrAuthoritativePdfParserResultForLog(parsed).disposition === 'invalid_result') {
    return review('receipt_requires_review');
  }
  if (parsed.disposition === 'would_reject') return reject(parsed.reasonCode);

  const assessment = assessCbeBirrProtectedReceiptNoMoney(receipt, instruction);
  if (assessment.disposition !== 'receipt_consistent_advisory') {
    return review(
      assessment.reasonCode === 'receipt_consistent_advisory'
        ? 'receipt_requires_review'
        : assessment.reasonCode,
    );
  }
  if (
    parsed.disposition !== 'would_review' ||
    parsed.reasonCode !== 'receiver_identity_observed' ||
    !('facts' in parsed) ||
    parsed.facts.occurredAtPrecision !== 'minute' ||
    parsed.parserVersion !== 2 ||
    !Number.isFinite(observedAt.getTime())
  ) {
    return review('receipt_requires_review');
  }
  if (assessment.principalAmountMinor === undefined) {
    return review('receipt_requires_review');
  }

  // Only a one-fetch official-origin observation and the exact parser facts can reach this
  // result. The amount is principal only. The database must still recheck active receiver,
  // policy, Player eligibility, one-use reference, switches, and execution fences atomically.
  return Object.freeze({
    ...base,
    disposition: 'receipt_ready_for_claim_preflight' as const,
    reasonCode: 'official_receipt_matched' as const,
    principalAmountMinor: assessment.principalAmountMinor,
    occurredAt: parsed.facts.occurredAt,
    occurredAtPrecision: parsed.facts.occurredAtPrecision,
    observedAt: observedAt.toISOString(),
    sourceDocumentDigest: `sha256:${receipt.transportResult.observation.sha256Digest}`,
    parserVersion: parsed.parserVersion,
  });
}

type Lookup = (
  reference: string,
  protectedReceiver: OpenCbeBirrReceiverLookupInput,
  childKey: CbeBirrReceiverLookupChildKey,
  openingProfile: CbeBirrReceiverLookupOpeningProfile,
  approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile,
  control: CbeBirrAuthoritativeReceiptTransportControl,
) => Promise<CbeBirrReceiverBoundAdvisoryResult>;

/** Test seam; not exported by the package's production subpath. */
export async function retrieveCbeBirrSettlementCandidateWithLookup(
  reference: string,
  protectedReceiver: OpenCbeBirrReceiverLookupInput,
  childKey: CbeBirrReceiverLookupChildKey,
  openingProfile: CbeBirrReceiverLookupOpeningProfile,
  approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile,
  instruction: CbeBirrSettlementInstructionSnapshot,
  control: CbeBirrAuthoritativeReceiptTransportControl,
  lookup: Lookup,
  clock: () => Date,
): Promise<CbeBirrSettlementCandidateResult> {
  try {
    const issuedAt = Date.parse(instruction.issuedAt);
    const expiresAt = Date.parse(instruction.expiresAt);
    const submittedAt = Date.parse(instruction.submittedAt);
    if (
      instruction.receiverRevisionActiveAtSubmission !== true ||
      instruction.receiverRevisionId !== protectedReceiver.receiverRevisionId ||
      instruction.receiverVersion !== protectedReceiver.receiverVersion ||
      instruction.receiverRevisionId !== childKey.receiverRevisionId ||
      instruction.receiverVersion !== childKey.receiverVersion
    ) {
      return review('receiver_revision_inactive');
    }
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(submittedAt) ||
      expiresAt - issuedAt !== 3_600_000 ||
      submittedAt < issuedAt ||
      submittedAt >= expiresAt
    ) {
      return review('instruction_window_review');
    }
    const receipt = await lookup(
      reference,
      protectedReceiver,
      childKey,
      openingProfile,
      approvedRootProfile,
      control,
    );
    return classifyCbeBirrSettlementCandidate(receipt, instruction, clock());
  } catch {
    return review('receipt_unavailable');
  }
}

/**
 * Fetches one receipt from the compiled CBE host with the protected receiver child key, then
 * emits only redacted claim-preflight facts. It never writes a result or authorizes a payment.
 */
export function retrieveCbeBirrSettlementCandidate(
  reference: string,
  protectedReceiver: OpenCbeBirrReceiverLookupInput,
  childKey: CbeBirrReceiverLookupChildKey,
  openingProfile: CbeBirrReceiverLookupOpeningProfile,
  approvedRootProfile: CbeBirrApprovedReceiverLookupRootProfile,
  instruction: CbeBirrSettlementInstructionSnapshot,
  control: CbeBirrAuthoritativeReceiptTransportControl,
): Promise<CbeBirrSettlementCandidateResult> {
  return retrieveCbeBirrSettlementCandidateWithLookup(
    reference,
    protectedReceiver,
    childKey,
    openingProfile,
    approvedRootProfile,
    instruction,
    control,
    (requestedReference, receiver, key, profile, root, requestControl) =>
      retrieveAndParseCbeBirrReceiptForProtectedReceiverAdvisoryOnly(
        requestedReference,
        receiver,
        key,
        profile,
        root,
        requestControl,
        cbeBirrNodeHttpsTransport,
        parseCbeBirrAuthoritativePdf,
      ),
    () => new Date(),
  );
}
