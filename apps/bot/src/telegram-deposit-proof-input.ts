import {
  TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MAX_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MIN_CODE_POINTS,
  type DepositProofProviderCode,
} from '@fetanagent/contracts';
import {
  TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES,
  extractTelebirrReferenceCandidates,
} from '@fetanagent/telebirr-verification-foundation/candidate-extraction';

export const TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES =
  TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES;

export type TelegramDepositProofInput =
  | { readonly kind: 'candidate'; readonly transactionReference: string }
  | { readonly kind: 'selection_required' }
  | { readonly kind: 'invalid_input' };

const DIRECT_REFERENCE_PATTERN = /^[A-Za-z0-9]+$/u;
const FORBIDDEN_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

/** Bound the whole command before splitting, trimming, or scanning customer-controlled text. */
export function isBoundedTelegramDepositProofText(text: string): boolean {
  return (
    text.length <= TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES &&
    Buffer.byteLength(text, 'utf8') <= TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES &&
    !FORBIDDEN_TEXT_CONTROL_PATTERN.test(text)
  );
}

function isDirectReference(text: string): boolean {
  return (
    text.length >= TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MIN_CODE_POINTS &&
    text.length <= TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MAX_CODE_POINTS &&
    DIRECT_REFERENCE_PATTERN.test(text)
  );
}

/**
 * Candidate extraction only: never open a submitted URL or trust its host, payment facts, or
 * claimed amount. Only one reference may cross the existing bot-to-API protection boundary.
 * Failed/ambiguous results deliberately contain no submitted text or candidate references.
 */
export function reduceTelegramDepositProofInput(
  providerCode: DepositProofProviderCode,
  text: string,
): TelegramDepositProofInput {
  if (!isBoundedTelegramDepositProofText(text)) return { kind: 'invalid_input' };

  // Keep the established direct-reference envelope byte-for-byte stable for delivery retries,
  // including lowercase input. Provider normalization still happens at the protected API boundary.
  if (isDirectReference(text)) return { kind: 'candidate', transactionReference: text };
  if (providerCode !== 'telebirr') return { kind: 'invalid_input' };

  const trimmed = text.trim();
  if (isDirectReference(trimmed)) return { kind: 'candidate', transactionReference: trimmed };

  // Scan both labels and receipt paths, even when the text starts with a URL. URL-only scanning
  // would overlook a conflicting labelled transaction in the same pasted message.
  const extraction = extractTelebirrReferenceCandidates({
    contractVersion: 1,
    sourceKind: 'sms',
    text,
  });
  if (extraction.outcome === 'candidate_ready') {
    return { kind: 'candidate', transactionReference: extraction.normalizedReference };
  }
  return {
    kind: extraction.outcome === 'selection_required' ? 'selection_required' : 'invalid_input',
  };
}
