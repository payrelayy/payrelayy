import { Buffer } from 'node:buffer';
import { isProxy } from 'node:util/types';

import {
  getDocument,
  OPS,
  PasswordException,
  VerbosityLevel,
  version as pdfJsVersion,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFOperatorList, TextContent } from 'pdfjs-dist/types/src/display/api.js';

import {
  CBE_BIRR_PDF_PARSER_CHILD_ARGUMENT,
  CBE_BIRR_PDF_PARSER_CHILD_KILL_GRACE_MS,
  createCbeBirrPdfParserAdmissionGate,
  spawnCbeBirrPdfParserChild,
  superviseCbeBirrPdfParserChild,
  type CbeBirrPdfParserChildBoundary,
} from './isolation.js';

/**
 * Pure byte-input boundary for the one-page CBE Birr receipt-PDF shape attested in Stage 1E.
 *
 * This package deliberately exposes no URL, transport, callback, persistence, claim, settlement,
 * enqueue, execution, or financial capability. The attested shape exposes a display name but no
 * unambiguous full receiver account/wallet identifier, so it can never produce an acceptance or
 * settlement candidate. Display names are presence-checked and discarded, never compared.
 *
 * Runtime composition remains deliberately unresolved: the transport's public safe result omits
 * raw PDF bytes. A future, separately reviewed internal one-fetch orchestration must pass the same
 * response bytes directly into this byte-only API (or own a protected single-use byte callback).
 * It must never refetch the receipt or expose raw PDF bytes through a public transport result.
 */
export const CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_PDFJS_VERSION = '6.2.108' as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE =
  'cbe_birr_official_receipt_lookup_v1' as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_TIME_ZONE = 'Africa/Addis_Ababa' as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES = 1_048_576 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_TEXT_ITEMS = 512 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_TEXT_CODE_POINTS = 16_384 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_OPERATOR_COUNT = 8_192 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_OPERATOR_ARGUMENT_ITEMS = 32_768 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_FONT_STYLES = 64 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_TIMEOUT_MS = 2_000 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_KILL_GRACE_MS =
  CBE_BIRR_PDF_PARSER_CHILD_KILL_GRACE_MS;
export const CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_SCHEDULER_ALLOWANCE_MS = 500 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_TOTAL_RETURN_BOUND_MS =
  CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_TIMEOUT_MS +
  CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_KILL_GRACE_MS * 2 +
  CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_SCHEDULER_ALLOWANCE_MS;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_CONCURRENT_CHILDREN = 1 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_OLD_GENERATION_MB = 96 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_SEMI_SPACE_MB = 16 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_CHILD_STACK_KB = 4_096 as const;
export const CBE_BIRR_AUTHORITATIVE_PDF_MAX_IPC_RESULT_BYTES = 8_192 as const;

const MAX_MARKED_CONTENT_ITEMS = 256;
const MAX_TEXT_ITEM_CODE_POINTS = 512;
const MAX_OPERATOR_ARGUMENT_DEPTH = 4;
const MAX_OPERATOR_STATE_DEPTH = 64;
const MAX_PAGE_DIMENSION = 10_000;
const MAX_IMAGE_PIXELS = 4_000_000;
const FULL_PAGE_IMAGE_AREA_RATIO = 0.5;
const ISOLATED_CHILD_PROTOCOL_VERSION = 1 as const;
const ISOLATED_CHILD_KIND = 'fetanagent_cbe_birr_pdf_parser_child_v1' as const;
const isolatedChildAdmissionGate = createCbeBirrPdfParserAdmissionGate(
  CBE_BIRR_AUTHORITATIVE_PDF_MAX_CONCURRENT_CHILDREN,
);
const intrinsicTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength',
)?.get;

const CANONICAL_REFERENCE_PATTERN = /^[A-Z0-9]{8,32}$/u;
const CONFIGURED_RECEIVER_IDENTIFIER_PATTERN = /^[0-9]{12}$/u;
const MONEY_PATTERN = /^(0|[1-9][0-9]{0,15})\.([0-9]{2}) ([A-Z]{3})$/u;
const RECEIPT_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/-]{0,63}$/u;
const SOURCE_VALUE_PATTERN = /^[^\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]{1,128}$/u;
const SOURCE_CHANNEL_PATTERN = /^[\x20-\x7e]{1,64}$/u;
const SOURCE_TIMESTAMP_PATTERN =
  /^(?<day>[0-9]{2})\/(?<month>[0-9]{2})\/(?<year>20[0-9]{2}) (?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})$/u;
const CANONICAL_ADDIS_TIMESTAMP_PATTERN =
  /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\+03:00$/u;
const MINOR_UNITS_PATTERN = /^(0|[1-9][0-9]{0,17})$/u;

const EXPECTED_BANK_HEADING = 'Commercial Bank of Ethiopia';
const EXPECTED_RECEIPT_HEADING = 'VAT Invoice / Customer Receipt';
const EXPECTED_DETAILS_HEADING = 'Transaction Details';
const EXPECTED_SUMMARY_HEADING = 'Receipt Number Transaction Date Amount';
const EXPECTED_FIELD_LABELS = Object.freeze([
  'Receiver Name',
  'Transaction Status',
  'Reference',
  'Paid amount',
  'Service Charge',
  'VAT',
  'Total Paid Amount',
  'Payment Reason',
  'Payment Channel',
] as const);

const ACTIVE_CONTENT_NAMES = new Set([
  'AA',
  'Action',
  'GoToE',
  'GoToR',
  'ImportData',
  'JavaScript',
  'JS',
  'Launch',
  'Movie',
  'OpenAction',
  'Rendition',
  'RichMedia',
  'Sound',
  'SubmitForm',
  'URI',
]);
const ATTACHMENT_NAMES = new Set(['EmbeddedFile', 'EmbeddedFiles']);
const FORM_NAMES = new Set(['AcroForm', 'XFA']);
const RELEVANT_RAW_NAMES = new Set([
  'Encrypt',
  ...ACTIVE_CONTENT_NAMES,
  ...ATTACHMENT_NAMES,
  ...FORM_NAMES,
]);

const expectationKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'canonicalReference',
  'configuredReceiverAccountIdentifier',
] as const;
const isolatedChildRequestKeys = ['protocolVersion', 'pdfBytes', 'expectations'] as const;
const isolatedChildResultFrameKeys = ['kind', 'protocolVersion', 'result'] as const;
const disabledCapabilityKeys = [
  'advisoryOnly',
  'safeFactsOnly',
  'sqlAuthorizationAllowed',
  'transportAllowed',
  'networkAllowed',
  'providerRequestAllowed',
  'decryptionAllowed',
  'databaseReadAllowed',
  'databaseWriteAllowed',
  'persistenceAllowed',
  'runtimeWiringAllowed',
  'claimAllowed',
  'settlementAllowed',
  'enqueueAllowed',
  'executionAllowed',
  'financialActionAllowed',
  'kemerBetActionAllowed',
  'blindRetryAllowed',
] as const;
const resultBaseKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'parserVersion',
  ...disabledCapabilityKeys,
  'disposition',
  'reasonCode',
] as const;
const safeFactKeys = [
  'documentTopology',
  'pageCount',
  'activeContentAbsent',
  'attachmentsAbsent',
  'formsAbsent',
  'referenceMatched',
  'receiverDisplayNamePresent',
  'receiverIdentifierEvidence',
  'receiverIdentityMatch',
  'receiverMatchBasis',
  'receiptStatus',
  'transactionType',
  'currencyCode',
  'principalAmountMinor',
  'serviceChargeMinor',
  'vatMinor',
  'totalPaidAmountMinor',
  'feeArithmetic',
  'occurredAt',
  'occurredAtTimeZone',
] as const;

type UnknownRecord = Record<string, unknown>;

interface DisabledParserCapabilities {
  readonly advisoryOnly: true;
  readonly safeFactsOnly: true;
  readonly sqlAuthorizationAllowed: false;
  readonly transportAllowed: false;
  readonly networkAllowed: false;
  readonly providerRequestAllowed: false;
  readonly decryptionAllowed: false;
  readonly databaseReadAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly persistenceAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly kemerBetActionAllowed: false;
  readonly blindRetryAllowed: false;
}

export interface CbeBirrAuthoritativePdfParserExpectations {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE;
  readonly canonicalReference: string;
  readonly configuredReceiverAccountIdentifier: string;
}

export type CbeBirrAuthoritativePdfParserReviewReason =
  | 'invalid_parser_input'
  | 'pdf_size_invalid'
  | 'pdf_framing_invalid'
  | 'pdf_encrypted'
  | 'pdf_unreadable'
  | 'pdf_page_count_unsupported'
  | 'pdf_attachment_present'
  | 'pdf_active_content_present'
  | 'pdf_form_present'
  | 'pdf_annotation_present'
  | 'pdf_complexity_exceeded'
  | 'pdf_isolation_capacity_exceeded'
  | 'pdf_isolation_timeout'
  | 'pdf_isolation_failed'
  | 'pdf_isolation_unavailable'
  | 'pdf_ocr_or_image_only'
  | 'pdf_text_unavailable'
  | 'pdf_field_missing'
  | 'pdf_field_duplicate'
  | 'pdf_field_conflict'
  | 'pdf_layout_drift'
  | 'pdf_value_invalid'
  | 'receipt_status_unsupported'
  | 'transaction_type_unsupported'
  | 'fee_arithmetic_mismatch'
  | 'receiver_identity_unavailable';

export type CbeBirrAuthoritativePdfParserRejectReason = 'reference_mismatch' | 'currency_not_etb';

export type CbeBirrAuthoritativePdfParserReason =
  CbeBirrAuthoritativePdfParserReviewReason | CbeBirrAuthoritativePdfParserRejectReason;

interface CbeBirrAuthoritativePdfParserResultBase extends DisabledParserCapabilities {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE;
  readonly parserVersion: typeof CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION;
}

export interface CbeBirrAuthoritativePdfSafeFacts {
  readonly documentTopology: 'cbe_birr_vat_customer_receipt_v1';
  readonly pageCount: 1;
  readonly activeContentAbsent: true;
  readonly attachmentsAbsent: true;
  readonly formsAbsent: true;
  readonly referenceMatched: boolean;
  readonly receiverDisplayNamePresent: true;
  readonly receiverIdentifierEvidence: 'unavailable';
  readonly receiverIdentityMatch: 'unavailable';
  readonly receiverMatchBasis: 'exact_account_identifier_required';
  readonly receiptStatus: 'completed' | 'unsupported';
  readonly transactionType: 'send_money' | 'unsupported';
  readonly currencyCode: 'ETB' | 'other';
  readonly principalAmountMinor: string;
  readonly serviceChargeMinor: string;
  readonly vatMinor: string;
  readonly totalPaidAmountMinor: string;
  readonly feeArithmetic: 'consistent' | 'mismatched';
  readonly occurredAt: string;
  readonly occurredAtTimeZone: typeof CBE_BIRR_AUTHORITATIVE_PDF_TIME_ZONE;
}

export interface CbeBirrAuthoritativePdfStructuralReviewResult extends CbeBirrAuthoritativePdfParserResultBase {
  readonly disposition: 'would_review';
  readonly reasonCode: Exclude<
    CbeBirrAuthoritativePdfParserReviewReason,
    | 'receipt_status_unsupported'
    | 'transaction_type_unsupported'
    | 'fee_arithmetic_mismatch'
    | 'receiver_identity_unavailable'
  >;
}

export interface CbeBirrAuthoritativePdfParsedReviewResult extends CbeBirrAuthoritativePdfParserResultBase {
  readonly disposition: 'would_review';
  readonly reasonCode:
    | 'receipt_status_unsupported'
    | 'transaction_type_unsupported'
    | 'fee_arithmetic_mismatch'
    | 'receiver_identity_unavailable';
  readonly facts: CbeBirrAuthoritativePdfSafeFacts;
}

export interface CbeBirrAuthoritativePdfDefiniteRejectResult extends CbeBirrAuthoritativePdfParserResultBase {
  readonly disposition: 'would_reject';
  readonly reasonCode: CbeBirrAuthoritativePdfParserRejectReason;
  readonly facts: CbeBirrAuthoritativePdfSafeFacts;
}

export type CbeBirrAuthoritativePdfParserResult =
  | CbeBirrAuthoritativePdfStructuralReviewResult
  | CbeBirrAuthoritativePdfParsedReviewResult
  | CbeBirrAuthoritativePdfDefiniteRejectResult;

export interface RedactedCbeBirrAuthoritativePdfParserLogProjection extends DisabledParserCapabilities {
  readonly contractVersion: typeof CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly parserVersion: typeof CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION;
  readonly disposition: CbeBirrAuthoritativePdfParserResult['disposition'] | 'invalid_result';
  readonly reasonCode: CbeBirrAuthoritativePdfParserReason | 'invalid_result';
}

interface ParsedExpectations {
  readonly canonicalReference: string;
  readonly configuredReceiverAccountIdentifier: string;
}

interface TextFragment {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TextRow {
  readonly text: string;
}

interface ParsedMoney {
  readonly minor: string;
  readonly currency: string;
}

interface ExtractedReceiptFields {
  readonly reference: string;
  readonly status: string;
  readonly paymentReason: string;
  readonly principal: ParsedMoney;
  readonly serviceCharge: ParsedMoney;
  readonly vat: ParsedMoney;
  readonly totalPaid: ParsedMoney;
  readonly occurredAt: string;
}

type ExtractedReceiptResult =
  | { readonly ok: true; readonly fields: ExtractedReceiptFields }
  | {
      readonly ok: false;
      readonly reasonCode:
        | 'pdf_field_missing'
        | 'pdf_field_duplicate'
        | 'pdf_field_conflict'
        | 'pdf_layout_drift'
        | 'pdf_value_invalid';
    };

const disabledCapabilities: DisabledParserCapabilities = Object.freeze({
  advisoryOnly: true as const,
  safeFactsOnly: true as const,
  sqlAuthorizationAllowed: false as const,
  transportAllowed: false as const,
  networkAllowed: false as const,
  providerRequestAllowed: false as const,
  decryptionAllowed: false as const,
  databaseReadAllowed: false as const,
  databaseWriteAllowed: false as const,
  persistenceAllowed: false as const,
  runtimeWiringAllowed: false as const,
  claimAllowed: false as const,
  settlementAllowed: false as const,
  enqueueAllowed: false as const,
  executionAllowed: false as const,
  financialActionAllowed: false as const,
  kemerBetActionAllowed: false as const,
  blindRetryAllowed: false as const,
});

const resultBase: CbeBirrAuthoritativePdfParserResultBase = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  sourceProfile: CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE,
  parserVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION,
  ...disabledCapabilities,
});

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }
  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function parseExpectations(candidate: unknown): ParsedExpectations | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, expectationKeys)
  ) {
    return undefined;
  }
  const canonicalReference = ownDataValue(candidate, 'canonicalReference');
  const configuredReceiverAccountIdentifier = ownDataValue(
    candidate,
    'configuredReceiverAccountIdentifier',
  );
  if (
    ownDataValue(candidate, 'contractVersion') !==
      CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'cbe_birr' ||
    ownDataValue(candidate, 'sourceProfile') !== CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE ||
    typeof canonicalReference !== 'string' ||
    !CANONICAL_REFERENCE_PATTERN.test(canonicalReference) ||
    typeof configuredReceiverAccountIdentifier !== 'string' ||
    !CONFIGURED_RECEIVER_IDENTIFIER_PATTERN.test(configuredReceiverAccountIdentifier)
  ) {
    return undefined;
  }
  return Object.freeze({ canonicalReference, configuredReceiverAccountIdentifier });
}

function exactUint8ArrayByteLength(candidate: unknown): number | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Uint8Array.prototype ||
    typeof intrinsicTypedArrayByteLengthGetter !== 'function'
  ) {
    return undefined;
  }
  try {
    const byteLength = Reflect.apply(intrinsicTypedArrayByteLengthGetter, candidate, []) as unknown;
    return typeof byteLength === 'number' && Number.isSafeInteger(byteLength) && byteLength >= 0
      ? byteLength
      : undefined;
  } catch {
    return undefined;
  }
}

function copyExactUint8Array(
  candidate: unknown,
  expectedByteLength: number,
): Uint8Array | undefined {
  if (
    expectedByteLength < 1 ||
    expectedByteLength > CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES ||
    exactUint8ArrayByteLength(candidate) !== expectedByteLength
  ) {
    return undefined;
  }
  try {
    const copy = new Uint8Array(candidate as Uint8Array);
    return exactUint8ArrayByteLength(copy) === expectedByteLength ? copy : undefined;
  } catch {
    return undefined;
  }
}

function structuralReview(
  reasonCode: CbeBirrAuthoritativePdfStructuralReviewResult['reasonCode'],
): CbeBirrAuthoritativePdfStructuralReviewResult {
  return Object.freeze({
    ...resultBase,
    disposition: 'would_review' as const,
    reasonCode,
  });
}

function parsedReview(
  reasonCode: CbeBirrAuthoritativePdfParsedReviewResult['reasonCode'],
  facts: CbeBirrAuthoritativePdfSafeFacts,
): CbeBirrAuthoritativePdfParsedReviewResult {
  return deepFreeze({
    ...resultBase,
    disposition: 'would_review' as const,
    reasonCode,
    facts,
  });
}

function definiteReject(
  reasonCode: CbeBirrAuthoritativePdfParserRejectReason,
  facts: CbeBirrAuthoritativePdfSafeFacts,
): CbeBirrAuthoritativePdfDefiniteRejectResult {
  return deepFreeze({
    ...resultBase,
    disposition: 'would_reject' as const,
    reasonCode,
    facts,
  });
}

function isPdfWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function hasPdfFraming(bytes: Uint8Array): boolean {
  const prefix = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
  if (bytes.length < 14 || !prefix.every((byte, index) => bytes[index] === byte)) return false;
  const major = bytes[5];
  const dot = bytes[6];
  const minor = bytes[7];
  if (
    (major !== 0x31 && major !== 0x32) ||
    dot !== 0x2e ||
    minor === undefined ||
    minor < 0x30 ||
    minor > 0x39 ||
    !isPdfWhitespace(bytes[8] ?? -1)
  ) {
    return false;
  }

  let end = bytes.length - 1;
  while (end >= 0 && isPdfWhitespace(bytes[end]!)) end -= 1;
  const eof = [0x25, 0x25, 0x45, 0x4f, 0x46] as const;
  const start = end - eof.length + 1;
  return start >= 0 && eof.every((byte, index) => bytes[start + index] === byte);
}

function hexNibble(byte: number): number | undefined {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return undefined;
}

function isPdfNameDelimiter(byte: number): boolean {
  return (
    isPdfWhitespace(byte) ||
    byte === 0x28 ||
    byte === 0x29 ||
    byte === 0x3c ||
    byte === 0x3e ||
    byte === 0x5b ||
    byte === 0x5d ||
    byte === 0x7b ||
    byte === 0x7d ||
    byte === 0x2f ||
    byte === 0x25
  );
}

function relevantRawPdfNames(bytes: Uint8Array): ReadonlySet<string> {
  const found = new Set<string>();
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x2f) continue;
    const decoded: number[] = [];
    let cursor = index + 1;
    while (cursor < bytes.length && !isPdfNameDelimiter(bytes[cursor]!)) {
      const current = bytes[cursor]!;
      if (current === 0x23 && cursor + 2 < bytes.length) {
        const high = hexNibble(bytes[cursor + 1]!);
        const low = hexNibble(bytes[cursor + 2]!);
        if (high !== undefined && low !== undefined) {
          decoded.push(high * 16 + low);
          cursor += 3;
          if (decoded.length > 64) break;
          continue;
        }
      }
      decoded.push(current);
      cursor += 1;
      if (decoded.length > 64) break;
    }
    if (decoded.length > 0 && decoded.length <= 64 && decoded.every((byte) => byte <= 0x7f)) {
      const name = String.fromCharCode(...decoded);
      if (RELEVANT_RAW_NAMES.has(name)) found.add(name);
    }
    index = Math.max(index, cursor - 1);
  }
  return found;
}

function preflightPdf(
  bytes: Uint8Array,
): CbeBirrAuthoritativePdfStructuralReviewResult | undefined {
  if (bytes.length === 0 || bytes.length > CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES) {
    return structuralReview('pdf_size_invalid');
  }
  if (!hasPdfFraming(bytes)) return structuralReview('pdf_framing_invalid');
  const names = relevantRawPdfNames(bytes);
  if (names.has('Encrypt')) return structuralReview('pdf_encrypted');
  if ([...ATTACHMENT_NAMES].some((name) => names.has(name))) {
    return structuralReview('pdf_attachment_present');
  }
  if ([...FORM_NAMES].some((name) => names.has(name))) {
    return structuralReview('pdf_form_present');
  }
  if ([...ACTIVE_CONTENT_NAMES].some((name) => names.has(name))) {
    return structuralReview('pdf_active_content_present');
  }
  return undefined;
}

function containerHasEntries(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Map || value instanceof Set) return value.size > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object' && !isProxy(value)) return Reflect.ownKeys(value).length > 0;
  return true;
}

async function inspectDocumentFeatures(
  document: PDFDocumentProxy,
  page: PDFPageProxy,
): Promise<CbeBirrAuthoritativePdfStructuralReviewResult | undefined> {
  if (document.isPureXfa || document.allXfaHtml !== null || page.isPureXfa) {
    return structuralReview('pdf_form_present');
  }

  const [
    attachments,
    documentJavaScript,
    hasJavaScript,
    openAction,
    fields,
    calculationOrder,
    permissions,
    signatures,
    outline,
    annotations,
    pageJavaScript,
    pageXfa,
  ] = await Promise.all([
    document.getAttachments(),
    document.getJSActions(),
    document.hasJSActions(),
    document.getOpenAction(),
    document.getFieldObjects(),
    document.getCalculationOrderIds(),
    document.getPermissions(),
    document.getSignatures(),
    document.getOutline(),
    page.getAnnotations({ intent: 'display' }),
    page.getJSActions(),
    page.getXfa(),
  ]);

  if (containerHasEntries(attachments)) return structuralReview('pdf_attachment_present');
  if (
    hasJavaScript ||
    containerHasEntries(documentJavaScript) ||
    openAction !== null ||
    containerHasEntries(outline) ||
    containerHasEntries(pageJavaScript)
  ) {
    return structuralReview('pdf_active_content_present');
  }
  if (
    fields !== null ||
    containerHasEntries(calculationOrder) ||
    permissions !== null ||
    signatures !== null ||
    pageXfa !== null
  ) {
    return structuralReview(
      fields !== null || pageXfa !== null ? 'pdf_form_present' : 'pdf_encrypted',
    );
  }
  if (annotations.length > 0) return structuralReview('pdf_annotation_present');
  return undefined;
}

function boundedArgumentItemCount(
  value: unknown,
  remaining: number,
  depth = 0,
): number | undefined {
  if (remaining < 1 || depth > MAX_OPERATOR_ARGUMENT_DEPTH) return undefined;
  if (value === null || typeof value !== 'object') return 1;
  if (isProxy(value)) return undefined;
  if (ArrayBuffer.isView(value)) {
    const count = value.byteLength;
    return count <= remaining ? count : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > remaining) return undefined;
    let used = 1;
    for (const item of value) {
      const count = boundedArgumentItemCount(item, remaining - used, depth + 1);
      if (count === undefined) return undefined;
      used += count;
      if (used > remaining) return undefined;
    }
    return used;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > remaining) return undefined;
  let used = 1;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
    const count = boundedArgumentItemCount(descriptor.value, remaining - used, depth + 1);
    if (count === undefined) return undefined;
    used += count;
    if (used > remaining) return undefined;
  }
  return used;
}

function operatorListWithinBounds(operatorList: PDFOperatorList): boolean {
  if (
    !Array.isArray(operatorList.fnArray) ||
    !Array.isArray(operatorList.argsArray) ||
    operatorList.fnArray.length !== operatorList.argsArray.length ||
    operatorList.fnArray.length > CBE_BIRR_AUTHORITATIVE_PDF_MAX_OPERATOR_COUNT
  ) {
    return false;
  }
  let argumentItems = 0;
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    if (!Number.isInteger(operatorList.fnArray[index])) return false;
    const count = boundedArgumentItemCount(
      operatorList.argsArray[index],
      CBE_BIRR_AUTHORITATIVE_PDF_MAX_OPERATOR_ARGUMENT_ITEMS - argumentItems,
    );
    if (count === undefined) return false;
    argumentItems += count;
  }
  return argumentItems <= CBE_BIRR_AUTHORITATIVE_PDF_MAX_OPERATOR_ARGUMENT_ITEMS;
}

function finiteSixNumbers(candidate: unknown): readonly number[] | undefined {
  if (!Array.isArray(candidate) || candidate.length < 6 || isProxy(candidate)) return undefined;
  const values = candidate.slice(0, 6);
  return values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? (values as number[])
    : undefined;
}

function hasFullPageRasterImage(page: PDFPageProxy, operatorList: PDFOperatorList): boolean {
  const [x1, y1, x2, y2] = page.view;
  if (![x1, y1, x2, y2].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return true;
  }
  const pageArea = Math.abs((x2! - x1!) * (y2! - y1!));
  if (pageArea <= 0) return true;

  let determinant = 1;
  let cumulativeRasterArea = 0;
  const stack: number[] = [];
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index];
    const argumentsForOperation = operatorList.argsArray[index];
    if (operation === OPS.save) {
      if (stack.length >= MAX_OPERATOR_STATE_DEPTH) return true;
      stack.push(determinant);
    } else if (operation === OPS.restore) {
      determinant = stack.pop() ?? 1;
    } else if (operation === OPS.transform) {
      const matrix = finiteSixNumbers(argumentsForOperation);
      if (!matrix) return true;
      const localDeterminant = matrix[0]! * matrix[3]! - matrix[1]! * matrix[2]!;
      determinant *= localDeterminant;
      if (!Number.isFinite(determinant)) return true;
    } else if (
      operation === OPS.paintImageXObject ||
      operation === OPS.paintInlineImageXObject ||
      operation === OPS.paintImageMaskXObject ||
      operation === OPS.paintSolidColorImageMask
    ) {
      cumulativeRasterArea += Math.min(Math.abs(determinant), pageArea);
      if (cumulativeRasterArea / pageArea >= FULL_PAGE_IMAGE_AREA_RATIO) return true;
    } else if (
      operation === OPS.paintImageMaskXObjectGroup ||
      operation === OPS.paintInlineImageXObjectGroup ||
      operation === OPS.paintImageXObjectRepeat ||
      operation === OPS.paintImageMaskXObjectRepeat
    ) {
      // Group/repeat operators carry placement arrays rather than one auditable current transform.
      return true;
    }
  }
  return false;
}

function normalizeExtractedText(value: string): string | undefined {
  if (value.length === 0) return '';
  if (
    /\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    return undefined;
  }
  return value
    .normalize('NFC')
    .replace(/[\t\n\r\f ]+/gu, ' ')
    .trim();
}

function dataProperty(candidate: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function extractTextFragments(textContent: TextContent): readonly TextFragment[] | undefined {
  if (
    !Array.isArray(textContent.items) ||
    isProxy(textContent.items) ||
    textContent.items.length > CBE_BIRR_AUTHORITATIVE_PDF_MAX_TEXT_ITEMS + MAX_MARKED_CONTENT_ITEMS
  ) {
    return undefined;
  }
  if (
    typeof textContent.styles !== 'object' ||
    textContent.styles === null ||
    isProxy(textContent.styles) ||
    Reflect.ownKeys(textContent.styles).length > CBE_BIRR_AUTHORITATIVE_PDF_MAX_FONT_STYLES
  ) {
    return undefined;
  }

  const fragments: TextFragment[] = [];
  let markedItems = 0;
  let codePoints = 0;
  for (const item of textContent.items) {
    if (typeof item !== 'object' || item === null || isProxy(item)) return undefined;
    const rawText = dataProperty(item, 'str');
    if (rawText === undefined) {
      markedItems += 1;
      if (markedItems > MAX_MARKED_CONTENT_ITEMS) return undefined;
      continue;
    }
    const transform = finiteSixNumbers(dataProperty(item, 'transform'));
    const width = dataProperty(item, 'width');
    const height = dataProperty(item, 'height');
    const direction = dataProperty(item, 'dir');
    if (
      typeof rawText !== 'string' ||
      !transform ||
      typeof width !== 'number' ||
      !Number.isFinite(width) ||
      width < 0 ||
      typeof height !== 'number' ||
      !Number.isFinite(height) ||
      height < 0 ||
      direction !== 'ltr' ||
      Math.abs(transform[1]!) > 0.01 ||
      Math.abs(transform[2]!) > 0.01
    ) {
      return undefined;
    }
    const text = normalizeExtractedText(rawText);
    if (text === undefined) return undefined;
    const itemCodePoints = Array.from(text).length;
    if (itemCodePoints > MAX_TEXT_ITEM_CODE_POINTS) return undefined;
    codePoints += itemCodePoints;
    if (codePoints > CBE_BIRR_AUTHORITATIVE_PDF_MAX_TEXT_CODE_POINTS) return undefined;
    if (text.length === 0) continue;
    const x = transform[4]!;
    const y = transform[5]!;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > MAX_PAGE_DIMENSION ||
      Math.abs(y) > MAX_PAGE_DIMENSION
    ) {
      return undefined;
    }
    fragments.push({ text, x, y, width, height });
    if (fragments.length > CBE_BIRR_AUTHORITATIVE_PDF_MAX_TEXT_ITEMS) return undefined;
  }
  return fragments;
}

function textRows(fragments: readonly TextFragment[]): readonly TextRow[] | undefined {
  const ordered = [...fragments].sort((left, right) => right.y - left.y || left.x - right.x);
  const grouped: TextFragment[][] = [];
  for (const fragment of ordered) {
    const current = grouped.at(-1);
    if (!current || Math.abs(current[0]!.y - fragment.y) > 1.5) {
      grouped.push([fragment]);
    } else {
      current.push(fragment);
    }
  }

  const rows: TextRow[] = [];
  for (const group of grouped) {
    group.sort((left, right) => left.x - right.x);
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1]!;
      const current = group[index]!;
      if (current.x < previous.x + previous.width - 2) return undefined;
    }
    const text = group
      .map((fragment) => fragment.text)
      .join(' ')
      .replace(/ +/gu, ' ')
      .trim();
    if (text.length > 0) rows.push({ text });
  }
  return rows;
}

function markerCount(rows: readonly TextRow[], marker: string): number {
  if (marker === 'VAT') {
    return rows.filter(
      ({ text }) =>
        text === marker || (text.startsWith(`${marker} `) && text !== EXPECTED_RECEIPT_HEADING),
    ).length;
  }
  return rows.filter(({ text }) => text === marker || text.startsWith(`${marker} `)).length;
}

function valueAfterLabel(row: TextRow, label: string): string | undefined {
  const prefix = `${label} `;
  return row.text.startsWith(prefix) ? row.text.slice(prefix.length) : undefined;
}

function parseMoney(value: string): ParsedMoney | undefined {
  const match = MONEY_PATTERN.exec(value);
  if (!match) return undefined;
  const minor = (BigInt(match[1]!) * 100n + BigInt(match[2]!)).toString();
  return { minor, currency: match[3]! };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseAddisAbabaTimestamp(value: string): string | undefined {
  const match = SOURCE_TIMESTAMP_PATTERN.exec(value);
  if (!match?.groups) return undefined;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
}

function extractReceiptFields(rows: readonly TextRow[]): ExtractedReceiptResult {
  const markers = [
    EXPECTED_BANK_HEADING,
    EXPECTED_RECEIPT_HEADING,
    EXPECTED_DETAILS_HEADING,
    EXPECTED_SUMMARY_HEADING,
    ...EXPECTED_FIELD_LABELS,
  ];
  for (const marker of markers) {
    const count = markerCount(rows, marker);
    if (count === 0) return { ok: false, reasonCode: 'pdf_field_missing' };
    if (count > 1) return { ok: false, reasonCode: 'pdf_field_duplicate' };
  }
  if (rows.length !== 14) return { ok: false, reasonCode: 'pdf_layout_drift' };
  if (
    rows[0]?.text !== EXPECTED_BANK_HEADING ||
    rows[1]?.text !== EXPECTED_RECEIPT_HEADING ||
    rows[2]?.text !== EXPECTED_DETAILS_HEADING ||
    rows[6]?.text !== EXPECTED_SUMMARY_HEADING
  ) {
    return { ok: false, reasonCode: 'pdf_layout_drift' };
  }

  const expectedRowLabels = [
    [3, 'Receiver Name'],
    [4, 'Transaction Status'],
    [5, 'Reference'],
    [8, 'Paid amount'],
    [9, 'Service Charge'],
    [10, 'VAT'],
    [11, 'Total Paid Amount'],
    [12, 'Payment Reason'],
    [13, 'Payment Channel'],
  ] as const;
  for (const [index, label] of expectedRowLabels) {
    if (!rows[index]?.text.startsWith(`${label} `)) {
      return { ok: false, reasonCode: 'pdf_layout_drift' };
    }
  }

  const receiverName = valueAfterLabel(rows[3]!, 'Receiver Name');
  const status = valueAfterLabel(rows[4]!, 'Transaction Status');
  const reference = valueAfterLabel(rows[5]!, 'Reference');
  const principal = parseMoney(valueAfterLabel(rows[8]!, 'Paid amount') ?? '');
  const serviceCharge = parseMoney(valueAfterLabel(rows[9]!, 'Service Charge') ?? '');
  const vat = parseMoney(valueAfterLabel(rows[10]!, 'VAT') ?? '');
  const totalPaid = parseMoney(valueAfterLabel(rows[11]!, 'Total Paid Amount') ?? '');
  const paymentReason = valueAfterLabel(rows[12]!, 'Payment Reason');
  const paymentChannel = valueAfterLabel(rows[13]!, 'Payment Channel');

  const summaryMatch =
    /^(?<receipt>[A-Za-z0-9][A-Za-z0-9/-]{0,63}) (?<timestamp>[0-9]{2}\/[0-9]{2}\/20[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}) (?<amount>(?:0|[1-9][0-9]{0,15})\.[0-9]{2} [A-Z]{3})$/u.exec(
      rows[7]!.text,
    );
  const summaryMoney = summaryMatch?.groups ? parseMoney(summaryMatch.groups.amount!) : undefined;
  const occurredAt = summaryMatch?.groups
    ? parseAddisAbabaTimestamp(summaryMatch.groups.timestamp!)
    : undefined;

  if (
    !receiverName ||
    !SOURCE_VALUE_PATTERN.test(receiverName) ||
    !status ||
    !SOURCE_CHANNEL_PATTERN.test(status) ||
    !reference ||
    !CANONICAL_REFERENCE_PATTERN.test(reference) ||
    !summaryMatch?.groups ||
    !RECEIPT_NUMBER_PATTERN.test(summaryMatch.groups.receipt!) ||
    !summaryMoney ||
    !principal ||
    principal.minor === '0' ||
    !serviceCharge ||
    !vat ||
    !totalPaid ||
    !paymentReason ||
    !SOURCE_CHANNEL_PATTERN.test(paymentReason) ||
    !paymentChannel ||
    !SOURCE_CHANNEL_PATTERN.test(paymentChannel) ||
    !occurredAt
  ) {
    return { ok: false, reasonCode: 'pdf_value_invalid' };
  }

  const currencies = new Set([
    summaryMoney.currency,
    principal.currency,
    serviceCharge.currency,
    vat.currency,
    totalPaid.currency,
  ]);
  if (currencies.size !== 1 || summaryMoney.minor !== principal.minor) {
    return { ok: false, reasonCode: 'pdf_field_conflict' };
  }

  return {
    ok: true,
    fields: {
      reference,
      status,
      paymentReason,
      principal,
      serviceCharge,
      vat,
      totalPaid,
      occurredAt,
    },
  };
}

function safeFacts(
  fields: ExtractedReceiptFields,
  expectations: ParsedExpectations,
): CbeBirrAuthoritativePdfSafeFacts {
  const receiptStatus =
    fields.status === 'Completed' ? ('completed' as const) : ('unsupported' as const);
  const transactionType =
    fields.paymentReason === 'Send Money' ? ('send_money' as const) : ('unsupported' as const);
  const currencyCode = fields.principal.currency === 'ETB' ? ('ETB' as const) : ('other' as const);
  const arithmeticMatches =
    BigInt(fields.principal.minor) +
      BigInt(fields.serviceCharge.minor) +
      BigInt(fields.vat.minor) ===
    BigInt(fields.totalPaid.minor);

  // The configured identifier is deliberately consumed only as a required expectation. The
  // allowlisted PDF topology contains no full receiver identifier that could be compared to it.
  void expectations.configuredReceiverAccountIdentifier;
  return deepFreeze({
    documentTopology: 'cbe_birr_vat_customer_receipt_v1' as const,
    pageCount: 1 as const,
    activeContentAbsent: true as const,
    attachmentsAbsent: true as const,
    formsAbsent: true as const,
    referenceMatched: fields.reference === expectations.canonicalReference,
    receiverDisplayNamePresent: true as const,
    receiverIdentifierEvidence: 'unavailable' as const,
    receiverIdentityMatch: 'unavailable' as const,
    receiverMatchBasis: 'exact_account_identifier_required' as const,
    receiptStatus,
    transactionType,
    currencyCode,
    principalAmountMinor: fields.principal.minor,
    serviceChargeMinor: fields.serviceCharge.minor,
    vatMinor: fields.vat.minor,
    totalPaidAmountMinor: fields.totalPaid.minor,
    feeArithmetic: arithmeticMatches ? ('consistent' as const) : ('mismatched' as const),
    occurredAt: fields.occurredAt,
    occurredAtTimeZone: CBE_BIRR_AUTHORITATIVE_PDF_TIME_ZONE,
  });
}

function reduceFacts(facts: CbeBirrAuthoritativePdfSafeFacts): CbeBirrAuthoritativePdfParserResult {
  if (!facts.referenceMatched) return definiteReject('reference_mismatch', facts);
  if (facts.receiptStatus !== 'completed') return parsedReview('receipt_status_unsupported', facts);
  if (facts.transactionType !== 'send_money') {
    return parsedReview('transaction_type_unsupported', facts);
  }
  if (facts.currencyCode !== 'ETB') return definiteReject('currency_not_etb', facts);
  if (facts.feeArithmetic !== 'consistent') return parsedReview('fee_arithmetic_mismatch', facts);
  return parsedReview('receiver_identity_unavailable', facts);
}

async function inspectLoadedPdf(
  document: PDFDocumentProxy,
  expectations: ParsedExpectations,
): Promise<CbeBirrAuthoritativePdfParserResult> {
  if (document.numPages !== 1) return structuralReview('pdf_page_count_unsupported');
  const page = await document.getPage(1);
  const featureReview = await inspectDocumentFeatures(document, page);
  if (featureReview) return featureReview;

  const [operatorList, textContent] = await Promise.all([
    page.getOperatorList({ intent: 'display' }),
    page.getTextContent({ includeMarkedContent: true, disableNormalization: true }),
  ]);
  if (!operatorListWithinBounds(operatorList)) return structuralReview('pdf_complexity_exceeded');
  const fragments = extractTextFragments(textContent);
  if (!fragments) return structuralReview('pdf_complexity_exceeded');
  if (fragments.length === 0 || hasFullPageRasterImage(page, operatorList)) {
    return structuralReview('pdf_ocr_or_image_only');
  }
  const rows = textRows(fragments);
  if (!rows) return structuralReview('pdf_layout_drift');
  if (rows.length === 0) return structuralReview('pdf_text_unavailable');
  const extracted = extractReceiptFields(rows);
  if (!extracted.ok) return structuralReview(extracted.reasonCode);
  return reduceFacts(safeFacts(extracted.fields, expectations));
}

/**
 * Parses only caller-supplied bytes. The second argument contains exact comparison expectations;
 * neither argument permits a URL, transport callback, loader, or mutable dependency surface.
 */
async function parseCbeBirrAuthoritativePdfInIsolatedChild(
  pdfBytesCandidate: unknown,
  expectationsCandidate: unknown,
): Promise<CbeBirrAuthoritativePdfParserResult> {
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    const expectations = parseExpectations(expectationsCandidate);
    const pdfByteLength = exactUint8ArrayByteLength(pdfBytesCandidate);
    if (!expectations || pdfByteLength === undefined) {
      return structuralReview('invalid_parser_input');
    }
    if (pdfByteLength === 0 || pdfByteLength > CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES) {
      return structuralReview('pdf_size_invalid');
    }
    const pdfBytes = copyExactUint8Array(pdfBytesCandidate, pdfByteLength);
    if (!pdfBytes) return structuralReview('invalid_parser_input');
    if (pdfJsVersion !== CBE_BIRR_AUTHORITATIVE_PDFJS_VERSION) {
      return structuralReview('pdf_unreadable');
    }
    const preflightReview = preflightPdf(pdfBytes);
    if (preflightReview) return preflightReview;

    let passwordRequested = false;
    loadingTask = getDocument({
      data: pdfBytes,
      verbosity: VerbosityLevel.ERRORS,
      stopAtErrors: true,
      maxImageSize: MAX_IMAGE_PIXELS,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableFontFace: true,
      fontExtraProperties: false,
      enableXfa: false,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: false,
    });
    loadingTask.onPassword = () => {
      passwordRequested = true;
      void loadingTask?.destroy();
    };
    try {
      const document = await loadingTask.promise;
      return await inspectLoadedPdf(document, expectations);
    } catch (error) {
      if (passwordRequested || error instanceof PasswordException) {
        return structuralReview('pdf_encrypted');
      }
      return structuralReview('pdf_unreadable');
    }
  } catch {
    return structuralReview('pdf_unreadable');
  } finally {
    try {
      await loadingTask?.destroy();
    } catch {
      // Resource cleanup cannot alter the already fail-closed parse result.
    }
  }
}

function hasDisabledCapabilities(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'advisoryOnly') === true &&
    ownDataValue(candidate, 'safeFactsOnly') === true &&
    disabledCapabilityKeys
      .filter((key) => key !== 'advisoryOnly' && key !== 'safeFactsOnly')
      .every((key) => ownDataValue(candidate, key) === false)
  );
}

function hasExactResultBase(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') ===
      CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE &&
    ownDataValue(candidate, 'parserVersion') === CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION &&
    hasDisabledCapabilities(candidate)
  );
}

function isCanonicalAddisTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_ADDIS_TIMESTAMP_PATTERN.test(value)) return false;
  const [date, timeWithOffset] = value.split('T');
  const [yearText, monthText, dayText] = date!.split('-');
  const [hourText, minuteText, secondWithOffset] = timeWithOffset!.split(':');
  const secondText = secondWithOffset!.slice(0, 2);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function parseSafeFactsCandidate(candidate: unknown): CbeBirrAuthoritativePdfSafeFacts | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, safeFactKeys)) {
    return undefined;
  }
  const referenceMatched = ownDataValue(candidate, 'referenceMatched');
  const receiptStatus = ownDataValue(candidate, 'receiptStatus');
  const transactionType = ownDataValue(candidate, 'transactionType');
  const currencyCode = ownDataValue(candidate, 'currencyCode');
  const principalAmountMinor = ownDataValue(candidate, 'principalAmountMinor');
  const serviceChargeMinor = ownDataValue(candidate, 'serviceChargeMinor');
  const vatMinor = ownDataValue(candidate, 'vatMinor');
  const totalPaidAmountMinor = ownDataValue(candidate, 'totalPaidAmountMinor');
  const feeArithmetic = ownDataValue(candidate, 'feeArithmetic');
  const occurredAt = ownDataValue(candidate, 'occurredAt');
  if (
    ownDataValue(candidate, 'documentTopology') !== 'cbe_birr_vat_customer_receipt_v1' ||
    ownDataValue(candidate, 'pageCount') !== 1 ||
    ownDataValue(candidate, 'activeContentAbsent') !== true ||
    ownDataValue(candidate, 'attachmentsAbsent') !== true ||
    ownDataValue(candidate, 'formsAbsent') !== true ||
    typeof referenceMatched !== 'boolean' ||
    ownDataValue(candidate, 'receiverDisplayNamePresent') !== true ||
    ownDataValue(candidate, 'receiverIdentifierEvidence') !== 'unavailable' ||
    ownDataValue(candidate, 'receiverIdentityMatch') !== 'unavailable' ||
    ownDataValue(candidate, 'receiverMatchBasis') !== 'exact_account_identifier_required' ||
    (receiptStatus !== 'completed' && receiptStatus !== 'unsupported') ||
    (transactionType !== 'send_money' && transactionType !== 'unsupported') ||
    (currencyCode !== 'ETB' && currencyCode !== 'other') ||
    typeof principalAmountMinor !== 'string' ||
    !MINOR_UNITS_PATTERN.test(principalAmountMinor) ||
    principalAmountMinor === '0' ||
    typeof serviceChargeMinor !== 'string' ||
    !MINOR_UNITS_PATTERN.test(serviceChargeMinor) ||
    typeof vatMinor !== 'string' ||
    !MINOR_UNITS_PATTERN.test(vatMinor) ||
    typeof totalPaidAmountMinor !== 'string' ||
    !MINOR_UNITS_PATTERN.test(totalPaidAmountMinor) ||
    (feeArithmetic !== 'consistent' && feeArithmetic !== 'mismatched') ||
    !isCanonicalAddisTimestamp(occurredAt) ||
    ownDataValue(candidate, 'occurredAtTimeZone') !== CBE_BIRR_AUTHORITATIVE_PDF_TIME_ZONE
  ) {
    return undefined;
  }
  const arithmeticMatches =
    BigInt(principalAmountMinor) + BigInt(serviceChargeMinor) + BigInt(vatMinor) ===
    BigInt(totalPaidAmountMinor);
  if ((feeArithmetic === 'consistent') !== arithmeticMatches) return undefined;
  return deepFreeze({
    documentTopology: 'cbe_birr_vat_customer_receipt_v1' as const,
    pageCount: 1 as const,
    activeContentAbsent: true as const,
    attachmentsAbsent: true as const,
    formsAbsent: true as const,
    referenceMatched,
    receiverDisplayNamePresent: true as const,
    receiverIdentifierEvidence: 'unavailable' as const,
    receiverIdentityMatch: 'unavailable' as const,
    receiverMatchBasis: 'exact_account_identifier_required' as const,
    receiptStatus,
    transactionType,
    currencyCode,
    principalAmountMinor,
    serviceChargeMinor,
    vatMinor,
    totalPaidAmountMinor,
    feeArithmetic,
    occurredAt,
    occurredAtTimeZone: CBE_BIRR_AUTHORITATIVE_PDF_TIME_ZONE,
  });
}

const structuralReviewReasons = new Set<
  CbeBirrAuthoritativePdfStructuralReviewResult['reasonCode']
>([
  'invalid_parser_input',
  'pdf_size_invalid',
  'pdf_framing_invalid',
  'pdf_encrypted',
  'pdf_unreadable',
  'pdf_page_count_unsupported',
  'pdf_attachment_present',
  'pdf_active_content_present',
  'pdf_form_present',
  'pdf_annotation_present',
  'pdf_complexity_exceeded',
  'pdf_isolation_capacity_exceeded',
  'pdf_isolation_timeout',
  'pdf_isolation_failed',
  'pdf_isolation_unavailable',
  'pdf_ocr_or_image_only',
  'pdf_text_unavailable',
  'pdf_field_missing',
  'pdf_field_duplicate',
  'pdf_field_conflict',
  'pdf_layout_drift',
  'pdf_value_invalid',
]);

function parsedReasonMatchesFacts(
  disposition: unknown,
  reasonCode: unknown,
  facts: CbeBirrAuthoritativePdfSafeFacts,
): boolean {
  if (disposition === 'would_reject') {
    return (
      (reasonCode === 'reference_mismatch' && !facts.referenceMatched) ||
      (reasonCode === 'currency_not_etb' &&
        facts.referenceMatched &&
        facts.receiptStatus === 'completed' &&
        facts.transactionType === 'send_money' &&
        facts.currencyCode === 'other')
    );
  }
  if (disposition !== 'would_review' || !facts.referenceMatched) return false;
  if (reasonCode === 'receipt_status_unsupported') return facts.receiptStatus === 'unsupported';
  if (facts.receiptStatus !== 'completed') return false;
  if (reasonCode === 'transaction_type_unsupported') {
    return facts.transactionType === 'unsupported';
  }
  if (facts.transactionType !== 'send_money' || facts.currencyCode !== 'ETB') return false;
  if (reasonCode === 'fee_arithmetic_mismatch') return facts.feeArithmetic === 'mismatched';
  return reasonCode === 'receiver_identity_unavailable' && facts.feeArithmetic === 'consistent';
}

function parseResultCandidate(candidate: unknown): CbeBirrAuthoritativePdfParserResult | undefined {
  if (!isPlainNonProxyRecord(candidate)) return undefined;
  const hasFacts = Object.hasOwn(candidate, 'facts');
  const expectedKeys = hasFacts ? [...resultBaseKeys, 'facts'] : resultBaseKeys;
  if (!hasExactEnumerableDataKeys(candidate, expectedKeys) || !hasExactResultBase(candidate)) {
    return undefined;
  }
  const disposition = ownDataValue(candidate, 'disposition');
  const reasonCode = ownDataValue(candidate, 'reasonCode');
  if (!hasFacts) {
    return disposition === 'would_review' &&
      typeof reasonCode === 'string' &&
      structuralReviewReasons.has(
        reasonCode as CbeBirrAuthoritativePdfStructuralReviewResult['reasonCode'],
      )
      ? structuralReview(reasonCode as CbeBirrAuthoritativePdfStructuralReviewResult['reasonCode'])
      : undefined;
  }
  const facts = parseSafeFactsCandidate(ownDataValue(candidate, 'facts'));
  if (!facts || !parsedReasonMatchesFacts(disposition, reasonCode, facts)) return undefined;
  if (disposition === 'would_reject') {
    return definiteReject(reasonCode as CbeBirrAuthoritativePdfParserRejectReason, facts);
  }
  return parsedReview(reasonCode as CbeBirrAuthoritativePdfParsedReviewResult['reasonCode'], facts);
}

function exactChildExpectations(
  expectations: ParsedExpectations,
): CbeBirrAuthoritativePdfParserExpectations {
  return Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    sourceProfile: CBE_BIRR_AUTHORITATIVE_PDF_SOURCE_PROFILE,
    canonicalReference: expectations.canonicalReference,
    configuredReceiverAccountIdentifier: expectations.configuredReceiverAccountIdentifier,
  });
}

function isolatedChildEntryUrl(): URL {
  const currentModule = new URL(import.meta.url);
  return currentModule.pathname.endsWith('/src/index.ts')
    ? new URL('../dist/index.js', currentModule)
    : currentModule;
}

async function handleIsolatedChildRequest(
  candidate: unknown,
): Promise<CbeBirrAuthoritativePdfParserResult> {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, isolatedChildRequestKeys) ||
    ownDataValue(candidate, 'protocolVersion') !== ISOLATED_CHILD_PROTOCOL_VERSION
  ) {
    return structuralReview('invalid_parser_input');
  }
  return parseCbeBirrAuthoritativePdfInIsolatedChild(
    ownDataValue(candidate, 'pdfBytes'),
    ownDataValue(candidate, 'expectations'),
  );
}

function frameIsolatedChildResult(result: CbeBirrAuthoritativePdfParserResult): string {
  const frame = JSON.stringify({
    kind: ISOLATED_CHILD_KIND,
    protocolVersion: ISOLATED_CHILD_PROTOCOL_VERSION,
    result,
  });
  if (Buffer.byteLength(frame, 'utf8') <= CBE_BIRR_AUTHORITATIVE_PDF_MAX_IPC_RESULT_BYTES) {
    return frame;
  }
  return JSON.stringify({
    kind: ISOLATED_CHILD_KIND,
    protocolVersion: ISOLATED_CHILD_PROTOCOL_VERSION,
    result: structuralReview('pdf_isolation_failed'),
  });
}

function parseIsolatedChildResultFrame(
  candidate: unknown,
): CbeBirrAuthoritativePdfParserResult | undefined {
  if (
    typeof candidate !== 'string' ||
    candidate.length > CBE_BIRR_AUTHORITATIVE_PDF_MAX_IPC_RESULT_BYTES ||
    Buffer.byteLength(candidate, 'utf8') > CBE_BIRR_AUTHORITATIVE_PDF_MAX_IPC_RESULT_BYTES
  ) {
    return undefined;
  }
  let frame: unknown;
  try {
    frame = JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isPlainNonProxyRecord(frame) ||
    !hasExactEnumerableDataKeys(frame, isolatedChildResultFrameKeys) ||
    ownDataValue(frame, 'kind') !== ISOLATED_CHILD_KIND ||
    ownDataValue(frame, 'protocolVersion') !== ISOLATED_CHILD_PROTOCOL_VERSION
  ) {
    return undefined;
  }
  return parseResultCandidate(ownDataValue(frame, 'result'));
}

function isExactInternalParserChild(): boolean {
  return (
    process.argv.length === 3 &&
    process.argv[2] === CBE_BIRR_PDF_PARSER_CHILD_ARGUMENT &&
    typeof process.send === 'function' &&
    process.connected
  );
}

if (isExactInternalParserChild()) {
  process.once('message', (candidate: unknown) => {
    void (async () => {
      let result: CbeBirrAuthoritativePdfParserResult;
      try {
        result = await handleIsolatedChildRequest(candidate);
      } catch {
        result = structuralReview('pdf_unreadable');
      }
      const frame = frameIsolatedChildResult(result);
      try {
        process.send!(frame, (error) => {
          try {
            if (process.connected) process.disconnect();
          } finally {
            process.exit(error ? 1 : 0);
          }
        });
      } catch {
        process.exit(1);
      }
    })();
  });
}

/**
 * Parses only caller-supplied bytes behind a process-locally admission-bounded one-shot OS child
 * with explicit V8 memory limits, ignored stdio, empty environment, and a 2-second parent selection
 * deadline. After selection, two bounded forced-kill grace periods produce a separate 2.9-second
 * total return bound including spawn/scheduler allowance. The second argument contains exact
 * comparison expectations; neither argument permits a URL, transport callback, loader, mutable
 * dependency, or authority. Child errors and output are discarded and never copied into results or
 * logs. Admission is released only after child-process exit is positively observed; an unconfirmed
 * kill permanently leaves the gate fail-closed.
 */
export async function parseCbeBirrAuthoritativePdf(
  pdfBytesCandidate: unknown,
  expectationsCandidate: unknown,
): Promise<CbeBirrAuthoritativePdfParserResult> {
  try {
    const expectations = parseExpectations(expectationsCandidate);
    const pdfByteLength = exactUint8ArrayByteLength(pdfBytesCandidate);
    if (!expectations || pdfByteLength === undefined) {
      return structuralReview('invalid_parser_input');
    }
    if (pdfByteLength === 0 || pdfByteLength > CBE_BIRR_AUTHORITATIVE_PDF_MAX_BYTES) {
      return structuralReview('pdf_size_invalid');
    }
    const pdfBytes = copyExactUint8Array(pdfBytesCandidate, pdfByteLength);
    if (!pdfBytes) return structuralReview('invalid_parser_input');
    if (!(pdfBytes.buffer instanceof ArrayBuffer)) {
      return structuralReview('pdf_isolation_unavailable');
    }

    const admissionLease = isolatedChildAdmissionGate.tryAcquire();
    if (!admissionLease) return structuralReview('pdf_isolation_capacity_exceeded');

    let releaseAdmission = true;
    try {
      let child: CbeBirrPdfParserChildBoundary;
      try {
        child = spawnCbeBirrPdfParserChild(
          isolatedChildEntryUrl(),
          CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_OLD_GENERATION_MB,
          CBE_BIRR_AUTHORITATIVE_PDF_CHILD_MAX_SEMI_SPACE_MB,
          CBE_BIRR_AUTHORITATIVE_PDF_CHILD_STACK_KB,
        );
        releaseAdmission = false;
      } catch {
        return structuralReview('pdf_isolation_unavailable');
      }

      const outcome = await superviseCbeBirrPdfParserChild(
        child,
        Object.freeze({
          protocolVersion: ISOLATED_CHILD_PROTOCOL_VERSION,
          pdfBytes,
          expectations: exactChildExpectations(expectations),
        }),
        CBE_BIRR_AUTHORITATIVE_PDF_ISOLATION_TIMEOUT_MS,
      );
      releaseAdmission = outcome.cleanupConfirmed;
      if (outcome.state === 'timeout') return structuralReview('pdf_isolation_timeout');
      if (outcome.state === 'failure') return structuralReview('pdf_isolation_failed');
      return (
        parseIsolatedChildResultFrame(outcome.candidate) ?? structuralReview('pdf_isolation_failed')
      );
    } finally {
      if (releaseAdmission) admissionLease.release();
    }
  } catch {
    return structuralReview('pdf_isolation_failed');
  }
}

const invalidLogProjection: RedactedCbeBirrAuthoritativePdfParserLogProjection = deepFreeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  parserVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION,
  disposition: 'invalid_result' as const,
  reasonCode: 'invalid_result' as const,
  ...disabledCapabilities,
});

/**
 * Revalidates a result and emits a constant-key projection. Raw references, receiver identifiers,
 * display names, receipt numbers, timestamps, amounts, byte counts, and PDF material are omitted.
 */
export function redactedCbeBirrAuthoritativePdfParserResultForLog(
  resultCandidate: unknown,
): RedactedCbeBirrAuthoritativePdfParserLogProjection {
  try {
    const parsed = parseResultCandidate(resultCandidate);
    if (!parsed) return invalidLogProjection;
    return deepFreeze({
      contractVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_CONTRACT_VERSION,
      providerCode: 'cbe_birr' as const,
      parserVersion: CBE_BIRR_AUTHORITATIVE_PDF_PARSER_VERSION,
      disposition: parsed.disposition,
      reasonCode: parsed.reasonCode,
      ...disabledCapabilities,
    });
  } catch {
    return invalidLogProjection;
  }
}
