import {
  hasExactEnumerableDataKeys,
  isNonProxyArray,
  isPlainNonProxyRecord,
  ownDataValue,
  utf8ByteLengthWithin,
  type UnknownRecord,
} from './exact-data-record.js';

export const TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_REFERENCE_NORMALIZATION_PROFILE = 'telebirr-reference-candidate-v1' as const;
export const TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES = 16 * 1024;
export const TELEBIRR_CANDIDATE_EXTRACTION_MAX_CANDIDATES = 8;

const REFERENCE_PATTERN = /^[A-Z0-9]{8,32}$/u;
const RAW_REFERENCE_PATTERN = /^[A-Za-z0-9]{8,32}$/u;
const FORBIDDEN_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
// Scan introducers before validating a complete token. A bounded matching regex would silently
// ignore a conflicting short/overlong reference, or accept a prefix before a Unicode suffix.
// Deliberately omit Unicode case folding: ASCII lookalikes must not become reference characters.
const RECEIPT_PATH_CONTEXT_PATTERN = /\/receipt\//gi;
const LABELLED_REFERENCE_CONTEXT_PATTERN =
  /\b(?:transaction[ \t\r\n]*(?:number|id)|txn[ \t\r\n]*id|invoice[ \t\r\n]*(?:number|no\.?))/gi;
const LABEL_CONTEXT_CONTINUATION_PATTERN = /[\p{L}\p{M}\p{N}\p{Pc}\p{Cf}]/u;
const LABEL_SEPARATOR_PATTERN = /[ \t\r\n:#]/u;
const CONTEXT_WHITESPACE_PATTERN = /[ \t\r\n]/u;
// A period remains a supported sentence boundary even without a following space ("ID.Thank").
// Hyphens, underscores, percent escapes and non-ASCII suffixes are not delimiters: validate them
// as part of the raw token and reject instead of truncating the customer's proposed reference.
const LABEL_TOKEN_BOUNDARY_PATTERN = /[ \t\r\n.,;!?:()[\]{}"'<>]/u;
const RECEIPT_TOKEN_BOUNDARY_PATTERN = /[ \t\r\n.,;!?#()[\]{}"'<>]/u;

const requestKeys = ['contractVersion', 'sourceKind', 'text'] as const;
const invalidResultKeys = [
  'contractVersion',
  'providerCode',
  'normalizationProfile',
  'sourceKind',
  'outcome',
  'reasonCode',
] as const;
const noCandidatesResultKeys = [
  'contractVersion',
  'providerCode',
  'normalizationProfile',
  'sourceKind',
  'outcome',
] as const;
const readyResultKeys = [...noCandidatesResultKeys, 'normalizedReference'] as const;
const selectionResultKeys = [...noCandidatesResultKeys, 'normalizedReferences'] as const;

export type TelebirrCandidateSourceKind =
  'transaction_id' | 'receipt_url' | 'sms' | 'ocr_text' | 'pdf_text';

export interface TelebirrCandidateExtractionRequest {
  readonly contractVersion: typeof TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION;
  readonly sourceKind: TelebirrCandidateSourceKind;
  readonly text: string;
}

interface CandidateExtractionBase {
  readonly contractVersion: typeof TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly normalizationProfile: typeof TELEBIRR_REFERENCE_NORMALIZATION_PROFILE;
}

export interface TelebirrCandidateExtractionInvalidResult extends CandidateExtractionBase {
  readonly sourceKind: null;
  readonly outcome: 'invalid_input';
  readonly reasonCode: 'invalid_input';
}

export interface TelebirrCandidateExtractionNoCandidatesResult extends CandidateExtractionBase {
  readonly sourceKind: TelebirrCandidateSourceKind;
  readonly outcome: 'no_candidates';
}

export interface TelebirrCandidateExtractionReadyResult extends CandidateExtractionBase {
  readonly sourceKind: TelebirrCandidateSourceKind;
  readonly outcome: 'candidate_ready';
  readonly normalizedReference: string;
}

export interface TelebirrCandidateExtractionSelectionResult extends CandidateExtractionBase {
  readonly sourceKind: TelebirrCandidateSourceKind;
  readonly outcome: 'selection_required';
  readonly normalizedReferences: readonly string[];
}

export type TelebirrCandidateExtractionResult =
  | TelebirrCandidateExtractionInvalidResult
  | TelebirrCandidateExtractionNoCandidatesResult
  | TelebirrCandidateExtractionReadyResult
  | TelebirrCandidateExtractionSelectionResult;

export interface RedactedTelebirrCandidateExtractionLogProjection {
  readonly contractVersion: typeof TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly normalizationProfile: typeof TELEBIRR_REFERENCE_NORMALIZATION_PROFILE;
  readonly sourceKind: TelebirrCandidateSourceKind | null;
  readonly outcome:
    'invalid_input' | 'no_candidates' | 'candidate_ready' | 'selection_required' | 'invalid_result';
  readonly candidateCount: number;
}

const baseResult = Object.freeze({
  contractVersion: TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION,
  providerCode: 'telebirr' as const,
  normalizationProfile: TELEBIRR_REFERENCE_NORMALIZATION_PROFILE,
});

const invalidInputResult: TelebirrCandidateExtractionInvalidResult = Object.freeze({
  ...baseResult,
  sourceKind: null,
  outcome: 'invalid_input' as const,
  reasonCode: 'invalid_input' as const,
});

const invalidLogProjection: RedactedTelebirrCandidateExtractionLogProjection = Object.freeze({
  ...baseResult,
  sourceKind: null,
  outcome: 'invalid_result' as const,
  candidateCount: 0,
});

function isSourceKind(value: unknown): value is TelebirrCandidateSourceKind {
  return (
    value === 'transaction_id' ||
    value === 'receipt_url' ||
    value === 'sms' ||
    value === 'ocr_text' ||
    value === 'pdf_text'
  );
}

function parseRequest(candidate: unknown): TelebirrCandidateExtractionRequest | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, requestKeys)) {
    return undefined;
  }

  const sourceKind = ownDataValue(candidate, 'sourceKind');
  const text = ownDataValue(candidate, 'text');
  if (
    ownDataValue(candidate, 'contractVersion') !== TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION ||
    !isSourceKind(sourceKind) ||
    typeof text !== 'string' ||
    text.length === 0 ||
    !utf8ByteLengthWithin(text, TELEBIRR_CANDIDATE_EXTRACTION_MAX_INPUT_BYTES) ||
    FORBIDDEN_TEXT_CONTROL_PATTERN.test(text)
  ) {
    return undefined;
  }

  return { contractVersion: TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION, sourceKind, text };
}

function collectContextCandidates(
  text: string,
  pattern: RegExp,
  contextKind: 'receipt_path' | 'label',
  candidates: string[],
  seen: Set<string>,
): boolean {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    let tokenStart = match.index + match[0].length;
    if (contextKind === 'label') {
      // JavaScript's \b is ASCII-only. Do not recognize a label embedded in a larger Unicode word.
      const precedingCharacter = Array.from(
        text.slice(Math.max(0, match.index - 2), match.index),
      ).at(-1);
      if (precedingCharacter && LABEL_CONTEXT_CONTINUATION_PATTERN.test(precedingCharacter)) {
        continue;
      }
      if (!LABEL_SEPARATOR_PATTERN.test(text[tokenStart] ?? '')) return false;
      while (CONTEXT_WHITESPACE_PATTERN.test(text[tokenStart] ?? '')) tokenStart += 1;
      if (text[tokenStart] === ':' || text[tokenStart] === '#') {
        tokenStart += 1;
      } else if (/^[iI][sS](?=[ \t\r\n]|$)/u.test(text.slice(tokenStart))) {
        tokenStart += 2;
      }
      while (CONTEXT_WHITESPACE_PATTERN.test(text[tokenStart] ?? '')) tokenStart += 1;
    }

    const tokenBoundary =
      contextKind === 'receipt_path'
        ? RECEIPT_TOKEN_BOUNDARY_PATTERN
        : LABEL_TOKEN_BOUNDARY_PATTERN;
    let tokenEnd = tokenStart;
    while (tokenEnd < text.length && !tokenBoundary.test(text[tokenEnd] ?? '')) tokenEnd += 1;
    const rawCandidate = text.slice(tokenStart, tokenEnd);
    if (!RAW_REFERENCE_PATTERN.test(rawCandidate)) return false;
    const candidate = rawCandidate.toUpperCase();
    if (seen.has(candidate)) continue;

    seen.add(candidate);
    candidates.push(candidate);
    if (candidates.length > TELEBIRR_CANDIDATE_EXTRACTION_MAX_CANDIDATES) return false;
  }

  return true;
}

function extractCandidates(request: TelebirrCandidateExtractionRequest): readonly string[] | null {
  const candidates: string[] = [];
  const seen = new Set<string>();

  if (request.sourceKind === 'transaction_id') {
    const trimmed = request.text.trim();
    return RAW_REFERENCE_PATTERN.test(trimmed) ? Object.freeze([trimmed.toUpperCase()]) : null;
  }

  if (
    !collectContextCandidates(
      request.text,
      RECEIPT_PATH_CONTEXT_PATTERN,
      'receipt_path',
      candidates,
      seen,
    )
  )
    return null;

  if (
    request.sourceKind !== 'receipt_url' &&
    !collectContextCandidates(
      request.text,
      LABELLED_REFERENCE_CONTEXT_PATTERN,
      'label',
      candidates,
      seen,
    )
  ) {
    return null;
  }

  return Object.freeze(candidates);
}

/**
 * Extracts candidate text only. It never opens a URL, trusts a submitted host, verifies a receipt,
 * or grants a payment or financial capability.
 */
export function extractTelebirrReferenceCandidates(
  requestCandidate: unknown,
): TelebirrCandidateExtractionResult {
  try {
    const request = parseRequest(requestCandidate);
    if (!request) return invalidInputResult;

    const candidates = extractCandidates(request);
    if (candidates === null) return invalidInputResult;

    if (candidates.length === 0) {
      return Object.freeze({
        ...baseResult,
        sourceKind: request.sourceKind,
        outcome: 'no_candidates' as const,
      });
    }

    if (candidates.length === 1) {
      return Object.freeze({
        ...baseResult,
        sourceKind: request.sourceKind,
        outcome: 'candidate_ready' as const,
        normalizedReference: candidates[0]!,
      });
    }

    return Object.freeze({
      ...baseResult,
      sourceKind: request.sourceKind,
      outcome: 'selection_required' as const,
      normalizedReferences: candidates,
    });
  } catch {
    return invalidInputResult;
  }
}

function hasExactBaseResult(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') === TELEBIRR_CANDIDATE_EXTRACTION_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'telebirr' &&
    ownDataValue(candidate, 'normalizationProfile') === TELEBIRR_REFERENCE_NORMALIZATION_PROFILE
  );
}

function parseExactReferenceArray(value: unknown): readonly string[] | undefined {
  if (!isNonProxyArray(value)) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    !lengthDescriptor ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    typeof lengthDescriptor.value !== 'number' ||
    lengthDescriptor.value < 2 ||
    lengthDescriptor.value > TELEBIRR_CANDIDATE_EXTRACTION_MAX_CANDIDATES
  ) {
    return undefined;
  }

  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = Array.from({ length: lengthDescriptor.value }, (_, index) => String(index));
  if (
    ownKeys.length !== expectedKeys.length + 1 ||
    !ownKeys.includes('length') ||
    ownKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => ownKeys.includes(key))
  ) {
    return undefined;
  }

  const parsed: string[] = [];
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return undefined;
    }

    const candidate = descriptor.value;
    if (
      typeof candidate !== 'string' ||
      !REFERENCE_PATTERN.test(candidate) ||
      parsed.includes(candidate)
    ) {
      return undefined;
    }
    parsed.push(candidate);
  }

  return Object.freeze(parsed);
}

/** Returns a constant-key projection and never emits candidate reference text. */
export function redactedTelebirrCandidateExtractionForLog(
  resultCandidate: unknown,
): RedactedTelebirrCandidateExtractionLogProjection {
  try {
    if (!isPlainNonProxyRecord(resultCandidate) || !hasExactBaseResult(resultCandidate)) {
      return invalidLogProjection;
    }

    const outcome = ownDataValue(resultCandidate, 'outcome');
    const sourceKind = ownDataValue(resultCandidate, 'sourceKind');

    if (
      outcome === 'invalid_input' &&
      hasExactEnumerableDataKeys(resultCandidate, invalidResultKeys) &&
      sourceKind === null &&
      ownDataValue(resultCandidate, 'reasonCode') === 'invalid_input'
    ) {
      return Object.freeze({
        ...baseResult,
        sourceKind: null,
        outcome: 'invalid_input' as const,
        candidateCount: 0,
      });
    }

    if (!isSourceKind(sourceKind)) return invalidLogProjection;

    if (
      outcome === 'no_candidates' &&
      hasExactEnumerableDataKeys(resultCandidate, noCandidatesResultKeys)
    ) {
      return Object.freeze({
        ...baseResult,
        sourceKind,
        outcome: 'no_candidates' as const,
        candidateCount: 0,
      });
    }

    if (
      outcome === 'candidate_ready' &&
      hasExactEnumerableDataKeys(resultCandidate, readyResultKeys) &&
      typeof ownDataValue(resultCandidate, 'normalizedReference') === 'string' &&
      REFERENCE_PATTERN.test(ownDataValue(resultCandidate, 'normalizedReference') as string)
    ) {
      return Object.freeze({
        ...baseResult,
        sourceKind,
        outcome: 'candidate_ready' as const,
        candidateCount: 1,
      });
    }

    if (
      outcome === 'selection_required' &&
      hasExactEnumerableDataKeys(resultCandidate, selectionResultKeys)
    ) {
      const references = parseExactReferenceArray(
        ownDataValue(resultCandidate, 'normalizedReferences'),
      );
      if (references) {
        return Object.freeze({
          ...baseResult,
          sourceKind,
          outcome: 'selection_required' as const,
          candidateCount: references.length,
        });
      }
    }

    return invalidLogProjection;
  } catch {
    return invalidLogProjection;
  }
}
