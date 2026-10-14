import {
  TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MAX_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MIN_CODE_POINTS,
  type DepositProofProviderCode,
} from '@fetanagent/contracts';
import {
  TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES,
  extractTelebirrReferenceCandidates,
  type TelebirrCandidateSourceKind,
} from '@fetanagent/telebirr-verification-foundation/candidate-extraction';

export const TELEGRAM_DEPOSIT_PROOF_COMMAND_MAX_BYTES =
  TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES;

export type TelegramDepositProofInput =
  | { readonly kind: 'candidate'; readonly transactionReference: string }
  | { readonly kind: 'selection_required' }
  | { readonly kind: 'invalid_input' };

const DIRECT_REFERENCE_PATTERN = /^[A-Za-z0-9]+$/u;
const FORBIDDEN_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CBE_BIRR_REFERENCE_LABEL_PATTERN =
  /\b(?:Txn\s+ID|Order\s+ID|Receipt\s+Number)\s*[:#]?\s*([A-Za-z0-9]{1,64})/giu;
const LINK_PATTERN = /https?:\/\/[^\s<>"']+/giu;

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

function extractCbeBirrReferenceCandidates(text: string): TelegramDepositProofInput {
  const candidates = new Set<string>();
  let malformed = false;
  for (const match of text.matchAll(CBE_BIRR_REFERENCE_LABEL_PATTERN)) {
    const reference = match[1]?.toUpperCase();
    if (!reference || !isDirectReference(reference)) malformed = true;
    else candidates.add(reference);
  }
  for (const match of text.matchAll(LINK_PATTERN)) {
    try {
      const url = new URL(match[0]!.replace(/[.,;)]+$/u, ''));
      const references = url.searchParams.getAll('TID');
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'cbepay1.cbe.com.et' ||
        (url.port !== '' && url.port !== '443') ||
        url.pathname !== '/aureceipt' ||
        references.length !== 1 ||
        !isDirectReference(references[0] ?? '')
      ) {
        malformed = true;
      } else {
        candidates.add(references[0]!.toUpperCase());
      }
    } catch {
      malformed = true;
    }
  }
  if (malformed || candidates.size === 0) return { kind: 'invalid_input' };
  if (candidates.size > 1) return { kind: 'selection_required' };
  return { kind: 'candidate', transactionReference: [...candidates][0]! };
}

/**
 * Candidate extraction only: never open a submitted URL or trust its host, payment facts, or
 * claimed amount. Only one reference may cross the existing bot-to-API protection boundary.
 * Failed/ambiguous results deliberately contain no submitted text or candidate references.
 */
export function reduceTelegramDepositProofInput(
  providerCode: DepositProofProviderCode,
  text: string,
  sourceKind: TelebirrCandidateSourceKind = 'sms',
): TelegramDepositProofInput {
  if (!isBoundedTelegramDepositProofText(text)) return { kind: 'invalid_input' };

  // Both provider references are canonical uppercase identifiers. This is candidate extraction
  // only; the official source remains the sole payment authority.
  if (isDirectReference(text)) {
    return {
      kind: 'candidate',
      transactionReference: text.toUpperCase(),
    };
  }

  const trimmed = text.trim();
  if (isDirectReference(trimmed)) {
    return { kind: 'candidate', transactionReference: trimmed.toUpperCase() };
  }
  if (providerCode === 'cbe_birr') return extractCbeBirrReferenceCandidates(text);

  // Scan both labels and receipt paths, even when the text starts with a URL. URL-only scanning
  // would overlook a conflicting labelled transaction in the same pasted message.
  const extraction = extractTelebirrReferenceCandidates({
    contractVersion: 1,
    sourceKind,
    text,
  });
  if (extraction.outcome === 'candidate_ready') {
    return { kind: 'candidate', transactionReference: extraction.normalizedReference };
  }
  return {
    kind: extraction.outcome === 'selection_required' ? 'selection_required' : 'invalid_input',
  };
}
