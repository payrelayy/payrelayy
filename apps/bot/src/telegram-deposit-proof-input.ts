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

export type TelegramAutoReceiverSmsProofInput =
  | {
      readonly kind: 'candidate';
      readonly providerCode: DepositProofProviderCode;
      readonly transactionReference: string;
    }
  | { readonly kind: 'selection_required' }
  | { readonly kind: 'invalid_input' };

const DIRECT_REFERENCE_PATTERN = /^[A-Za-z0-9]+$/u;
const FORBIDDEN_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CBE_BIRR_REFERENCE_LABEL_PATTERN =
  /\b(?:Txn\s+ID|Transaction\s+(?:ID|Number)|Order\s+ID|Receipt\s+Number)\s*[:#]?\s*([^\s.,;!?:()[\]{}"'<>]+)/giu;
const CBE_BIRR_REFERENCE_ROW_PATTERN =
  /^[ \t]*(?:Payment[ \t]+)?Reference[ \t]*:?[ \t]+([^\s.,;!?:()[\]{}"'<>]+)/gimu;
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
    // The official CBE receipt uses this as a table heading, not a transaction reference.
    if (
      /^Receipt\s+Number\s+Transaction$/iu.test(match[0] ?? '') &&
      /^\s+Date\s+Amount\b/iu.test(text.slice((match.index ?? 0) + match[0].length))
    ) {
      continue;
    }
    const reference = match[1]?.toUpperCase();
    if (!reference || !isDirectReference(reference)) malformed = true;
    else candidates.add(reference);
  }
  for (const match of text.matchAll(CBE_BIRR_REFERENCE_ROW_PATTERN)) {
    const reference = match[1]?.toUpperCase();
    if (!reference || !isDirectReference(reference)) malformed = true;
    else candidates.add(reference);
  }
  for (const match of text.matchAll(LINK_PATTERN)) {
    try {
      const url = new URL(match[0]!.replace(/[.,;)]+$/u, ''));
      const isReceiptClaim =
        url.hostname === 'cbepay1.cbe.com.et' ||
        url.pathname.toLowerCase().includes('aureceipt') ||
        [...url.searchParams.keys()].some((key) => key.toUpperCase() === 'TID');
      // CBE SMS can also contain a feedback link. It nominates no reference and is not opened.
      if (!isReceiptClaim) continue;
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

/**
 * The receiver phone's incoming SMS is the payment authority. This only chooses which protected
 * SMS ledger to query, using the reference shape observed for each provider. A button, caption,
 * sender name, or receipt branding must not override the reference itself.
 */
export function reduceTelegramAutoReceiverSmsProofInput(
  text: string,
  sourceKind: TelebirrCandidateSourceKind = 'sms',
): TelegramAutoReceiverSmsProofInput {
  if (!isBoundedTelegramDepositProofText(text)) return { kind: 'invalid_input' };

  const trimmed = text.trim();
  if (isDirectReference(trimmed)) return classifyReceiverSmsReference(trimmed.toUpperCase());

  const telebirr = extractTelebirrReferenceCandidates({
    contractVersion: 1,
    sourceKind,
    text,
  });
  const cbe = extractCbeBirrReferenceCandidates(text);
  if (telebirr.outcome === 'invalid_input' || telebirr.outcome === 'selection_required') {
    return {
      kind: telebirr.outcome === 'selection_required' ? 'selection_required' : 'invalid_input',
    };
  }
  if (cbe.kind === 'selection_required') return cbe;
  // A malformed receipt claim, including one on another host, cannot be hidden by a label.
  if (
    cbe.kind === 'invalid_input' &&
    /(?:cbepay1\.cbe\.com\.et|\/aureceipt(?:[/?#]|$)|[?&]TID=)/iu.test(text)
  ) {
    return { kind: 'invalid_input' };
  }

  const candidates = new Set<string>();
  if (telebirr.outcome === 'candidate_ready') candidates.add(telebirr.normalizedReference);
  if (cbe.kind === 'candidate') candidates.add(cbe.transactionReference);
  if (candidates.size > 1) return { kind: 'selection_required' };
  if (candidates.size === 0) return { kind: 'invalid_input' };
  return classifyReceiverSmsReference([...candidates][0]!);
}

function classifyReceiverSmsReference(reference: string): TelegramAutoReceiverSmsProofInput {
  // A digit is required for unlabelled text so ordinary words are not mistaken for payments.
  if (!/^[A-Z0-9]+$/u.test(reference) || !/[0-9]/u.test(reference)) {
    return { kind: 'invalid_input' };
  }
  const providerCode =
    reference.length === 10 ? 'telebirr' : reference.length === 11 ? 'cbe_birr' : null;
  return providerCode
    ? { kind: 'candidate', providerCode, transactionReference: reference }
    : { kind: 'invalid_input' };
}
