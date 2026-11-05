import { assessCbeBirrReceiptTimeWindow } from '@fetanagent/cbe-birr-authoritative-lookup-prerequisite';
import {
  redactedCbeBirrAuthoritativePdfParserResultForLog,
  type CbeBirrAuthoritativePdfParserResult,
} from '@fetanagent/cbe-birr-authoritative-pdf-parser';

import type { CbeBirrReceiverBoundAdvisoryResult } from './advisory-composition.js';

/**
 * Package-internal, no-money assessment of one protected-receiver receipt observation. A
 * consistent receipt is still untrusted for financial purposes until the source contract,
 * duplicate claim, current receiver and settlement boundaries are independently established.
 */
export type CbeBirrNoMoneyAssessmentReason =
  | 'receipt_unavailable'
  | 'receipt_requires_review'
  | 'receiver_revision_inactive'
  | 'principal_out_of_range'
  | 'instruction_window_review'
  | 'receipt_consistent_advisory';

export type CbeBirrNoMoneyAssessment = Readonly<{
  contractVersion: 1;
  providerCode: 'cbe_birr';
  advisoryOnly: true;
  sourceContractAttested: false;
  runtimeWiringAllowed: false;
  claimAllowed: false;
  financialActionAllowed: false;
  disposition: 'would_review' | 'receipt_consistent_advisory';
  reasonCode: CbeBirrNoMoneyAssessmentReason;
  /** Principal only, excluding service charge, VAT, tip and any other fees. */
  principalAmountMinor?: string;
}>;

export interface CbeBirrNoMoneyInstructionSnapshot {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly submittedAt: string;
  /** Must be read from the same immutable instruction-bound revision before a future lease. */
  readonly receiverRevisionActiveAtSubmission: boolean;
}

const MIN_PRINCIPAL_MINOR = 2_500n;
const MAX_PRINCIPAL_MINOR = 2_500_000n;
const CANONICAL_MINOR_UNITS = /^(0|[1-9][0-9]{0,17})$/u;

function review(
  reasonCode: Exclude<CbeBirrNoMoneyAssessmentReason, 'receipt_consistent_advisory'>,
): CbeBirrNoMoneyAssessment {
  return Object.freeze({
    contractVersion: 1,
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    sourceContractAttested: false,
    runtimeWiringAllowed: false,
    claimAllowed: false,
    financialActionAllowed: false,
    disposition: 'would_review',
    reasonCode,
  });
}

function isMatchedReceipt(
  parserResult: CbeBirrAuthoritativePdfParserResult,
): parserResult is Extract<CbeBirrAuthoritativePdfParserResult, { facts: unknown }> {
  if (
    redactedCbeBirrAuthoritativePdfParserResultForLog(parserResult).disposition === 'invalid_result'
  ) {
    return false;
  }
  if (
    parserResult.disposition !== 'would_review' ||
    parserResult.reasonCode !== 'receiver_identity_observed' ||
    !('facts' in parserResult)
  )
    return false;
  const facts = parserResult.facts;
  return (
    facts.documentTopology === 'cbe_birr_vat_customer_receipt_credit_account_v2' &&
    facts.referenceMatched &&
    facts.receiverIdentifierEvidence === 'exact_pdf_credit_account' &&
    facts.receiverIdentityMatch === 'matched' &&
    facts.receiverMatchBasis === 'pdf_credit_account' &&
    facts.receiptStatus === 'completed' &&
    facts.transactionType === 'send_money' &&
    facts.currencyCode === 'ETB' &&
    facts.feeArithmetic === 'consistent'
  );
}

/**
 * A bounded PDF fetched for one protected receiver may produce a no-money consistency signal.
 * This function never turns the parser's advisory observation into payment authority.
 */
export function assessCbeBirrProtectedReceiptNoMoney(
  receipt: CbeBirrReceiverBoundAdvisoryResult,
  instruction: CbeBirrNoMoneyInstructionSnapshot,
): CbeBirrNoMoneyAssessment {
  if (typeof receipt !== 'object' || receipt === null) return review('receipt_unavailable');
  if (receipt.disposition !== 'parsed_advisory') return review('receipt_unavailable');
  if (!isMatchedReceipt(receipt.parserResult)) return review('receipt_requires_review');
  if (
    typeof instruction !== 'object' ||
    instruction === null ||
    instruction.receiverRevisionActiveAtSubmission !== true
  ) {
    return review('receiver_revision_inactive');
  }

  const facts = receipt.parserResult.facts;
  if (!CANONICAL_MINOR_UNITS.test(facts.principalAmountMinor)) {
    return review('receipt_requires_review');
  }
  const principalAmountMinor = BigInt(facts.principalAmountMinor);
  if (principalAmountMinor < MIN_PRINCIPAL_MINOR || principalAmountMinor > MAX_PRINCIPAL_MINOR) {
    return review('principal_out_of_range');
  }

  const window = assessCbeBirrReceiptTimeWindow({
    contractVersion: 1,
    providerCode: 'cbe_birr',
    parserVersion: receipt.parserResult.parserVersion,
    documentTopology: facts.documentTopology,
    occurredAt: facts.occurredAt,
    occurredAtPrecision: facts.occurredAtPrecision,
    occurredAtTimeZone: facts.occurredAtTimeZone,
    instructionIssuedAt: instruction.issuedAt,
    instructionExpiresAt: instruction.expiresAt,
    submittedAt: instruction.submittedAt,
  });
  if (window.disposition !== 'window_consistent_advisory') {
    return review('instruction_window_review');
  }
  return Object.freeze({
    contractVersion: 1,
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    sourceContractAttested: false,
    runtimeWiringAllowed: false,
    claimAllowed: false,
    financialActionAllowed: false,
    disposition: 'receipt_consistent_advisory',
    reasonCode: 'receipt_consistent_advisory',
    principalAmountMinor: facts.principalAmountMinor,
  });
}
