import { isProxy } from 'node:util/types';
import { parse } from 'parse5';

export const CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION = 1 as const;
export const CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION = 1 as const;
export const CBE_BIRR_OFFLINE_RECEIPT_MAX_RESPONSE_BYTES = 32_768 as const;

const SOURCE_PROFILE = 'cbe_birr_official_receipt_lookup_v1' as const;
const SYNTHETIC_MARKER = 'synthetic-cbe-birr-official-receipt-v1' as const;
const SYNTHETIC_REFERENCE_PATTERN = /^SYNTH[A-Z0-9]{3,27}$/u;
const SYNTHETIC_PHONE_PATTERN = /^25190000000[1-9]$/u;
const SYNTHETIC_NAME_PATTERN = /^SYNTHETIC [A-Z][A-Z ]{0,62}$/u;
const MONEY_PATTERN = /^(0|[1-9][0-9]{0,8})\.([0-9]{2}) ETB$/u;
const TIMESTAMP_PATTERN =
  /^(?<day>[0-9]{2})\/(?<month>[0-9]{2})\/(?<year>20[0-9]{2}) (?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})$/u;

const inputKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'fixtureMode',
  'requestedReference',
  'receiverLookupPhone',
  'receiverFullName',
] as const;
const responseKeys = ['status', 'contentType', 'body'] as const;
const disabledCapabilityKeys = [
  'liveTransportAllowed',
  'providerRequestAllowed',
  'databaseAccessAllowed',
  'persistenceAllowed',
  'runtimeWiringAllowed',
  'evidenceClaimAllowed',
  'financialActionAllowed',
] as const;
const resultBaseKeys = [
  'contractVersion',
  'providerCode',
  'sourceProfile',
  'parserVersion',
  'advisoryOnly',
  ...disabledCapabilityKeys,
  'disposition',
  'reasonCode',
] as const;
const safeFactKeys = [
  ...resultBaseKeys,
  'referenceMask',
  'receiverAccountMask',
  'referenceMatch',
  'receiverNameMatch',
  'receiverAccountMatch',
  'providerFinalStatus',
  'transactionType',
  'principalAmountMinor',
  'serviceChargeMinor',
  'vatMinor',
  'totalDebitedMinor',
  'feeArithmetic',
  'occurredAtAddisAbaba',
] as const;
const expectedReceiptLabels = Object.freeze([
  'Transaction ID',
  'Transaction Status',
  'Receiver Name',
  'Receiver Wallet',
  'Transaction Type',
  'Paid Amount',
  'Service Charge',
  'VAT',
  'Total Debited',
  'Transaction Date',
] as const);

type UnknownRecord = Record<string, unknown>;

interface Parse5Node {
  readonly nodeName?: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: readonly { readonly name: string; readonly value: string }[];
  readonly childNodes?: readonly Parse5Node[];
}

interface DisabledOfflineCapabilities {
  readonly liveTransportAllowed: false;
  readonly providerRequestAllowed: false;
  readonly databaseAccessAllowed: false;
  readonly persistenceAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly evidenceClaimAllowed: false;
  readonly financialActionAllowed: false;
}

export interface CbeBirrSyntheticOfficialReceiptInput {
  readonly contractVersion: typeof CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof SOURCE_PROFILE;
  readonly fixtureMode: 'synthetic_only';
  readonly requestedReference: string;
  readonly receiverLookupPhone: string;
  readonly receiverFullName: string;
}

export interface CbeBirrCompiledSyntheticRequest {
  readonly method: 'GET';
  readonly url: string;
  readonly redirectPolicy: 'reject_all';
  readonly queryParameterOrder: readonly ['TID', 'PH'];
}

export interface CbeBirrSyntheticOfficialReceiptResponse {
  readonly status: 200;
  readonly contentType: 'text/html; charset=utf-8';
  readonly body: string;
}

export interface CbeBirrSyntheticOfficialReceiptLookupPlan extends DisabledOfflineCapabilities {
  readonly contractVersion: typeof CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof SOURCE_PROFILE;
  readonly advisoryOnly: true;
  readonly disposition: 'offline_fixture_plan';
  readonly reasonCode: 'live_transport_absent';
  readonly request: CbeBirrCompiledSyntheticRequest;
}

export type CbeBirrSyntheticOfficialReceiptReviewReason =
  | 'fixture_response_invalid'
  | 'fixture_marker_missing'
  | 'receipt_shape_unattested'
  | 'requested_reference_mismatch'
  | 'receiver_name_mismatch'
  | 'receiver_account_mismatch'
  | 'status_not_completed'
  | 'transaction_type_unsupported'
  | 'fee_arithmetic_mismatch';

type CbeBirrSyntheticOfficialReceiptStructuralReviewReason =
  'fixture_response_invalid' | 'fixture_marker_missing' | 'receipt_shape_unattested';

interface CbeBirrSyntheticOfficialReceiptBase extends DisabledOfflineCapabilities {
  readonly contractVersion: typeof CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly sourceProfile: typeof SOURCE_PROFILE;
  readonly parserVersion: typeof CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION;
  readonly advisoryOnly: true;
}

export interface CbeBirrSyntheticOfficialReceiptInvalidResult extends CbeBirrSyntheticOfficialReceiptBase {
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
}

export interface CbeBirrSyntheticOfficialReceiptSafeFacts extends CbeBirrSyntheticOfficialReceiptBase {
  readonly disposition: 'synthetic_safe_facts' | 'would_review';
  readonly reasonCode: 'synthetic_receipt_parsed' | CbeBirrSyntheticOfficialReceiptReviewReason;
  readonly referenceMask: string;
  readonly receiverAccountMask: string;
  readonly referenceMatch: boolean;
  readonly receiverNameMatch: boolean;
  readonly receiverAccountMatch: boolean;
  readonly providerFinalStatus: 'completed' | 'other';
  readonly transactionType: 'send_money' | 'other';
  readonly principalAmountMinor: number;
  readonly serviceChargeMinor: number;
  readonly vatMinor: number;
  readonly totalDebitedMinor: number;
  readonly feeArithmetic: 'consistent' | 'mismatched';
  readonly occurredAtAddisAbaba: string;
}

export interface CbeBirrSyntheticOfficialReceiptFailureResult extends CbeBirrSyntheticOfficialReceiptBase {
  readonly disposition: 'would_review';
  readonly reasonCode: CbeBirrSyntheticOfficialReceiptStructuralReviewReason;
}

export type CbeBirrSyntheticOfficialReceiptResult =
  | CbeBirrSyntheticOfficialReceiptInvalidResult
  | CbeBirrSyntheticOfficialReceiptSafeFacts
  | CbeBirrSyntheticOfficialReceiptFailureResult;

export interface RedactedSyntheticCbeBirrOfficialReceiptLogProjection {
  readonly contractVersion: typeof CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly parserVersion: typeof CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION;
  readonly advisoryOnly: true;
  readonly disposition: CbeBirrSyntheticOfficialReceiptResult['disposition'] | 'invalid_result';
  readonly reasonCode: CbeBirrSyntheticOfficialReceiptResult['reasonCode'] | 'invalid_result';
}

const disabledCapabilities: DisabledOfflineCapabilities = Object.freeze({
  liveTransportAllowed: false,
  providerRequestAllowed: false,
  databaseAccessAllowed: false,
  persistenceAllowed: false,
  runtimeWiringAllowed: false,
  evidenceClaimAllowed: false,
  financialActionAllowed: false,
});
const resultBase: CbeBirrSyntheticOfficialReceiptBase = Object.freeze({
  contractVersion: CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  sourceProfile: SOURCE_PROFILE,
  parserVersion: CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION,
  advisoryOnly: true as const,
  ...disabledCapabilities,
});
const invalidResult: CbeBirrSyntheticOfficialReceiptInvalidResult = Object.freeze({
  ...resultBase,
  disposition: 'invalid_request' as const,
  reasonCode: 'invalid_request' as const,
});

function failureResult(
  reasonCode: CbeBirrSyntheticOfficialReceiptStructuralReviewReason,
): CbeBirrSyntheticOfficialReceiptFailureResult {
  return Object.freeze({
    ...resultBase,
    disposition: 'would_review' as const,
    reasonCode,
  });
}

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
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

function parseInput(candidate: unknown): CbeBirrSyntheticOfficialReceiptInput | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, inputKeys)) {
    return undefined;
  }
  const requestedReference = ownDataValue(candidate, 'requestedReference');
  const receiverLookupPhone = ownDataValue(candidate, 'receiverLookupPhone');
  const receiverFullName = ownDataValue(candidate, 'receiverFullName');
  if (
    ownDataValue(candidate, 'contractVersion') !== CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'cbe_birr' ||
    ownDataValue(candidate, 'sourceProfile') !== SOURCE_PROFILE ||
    ownDataValue(candidate, 'fixtureMode') !== 'synthetic_only' ||
    typeof requestedReference !== 'string' ||
    !SYNTHETIC_REFERENCE_PATTERN.test(requestedReference) ||
    typeof receiverLookupPhone !== 'string' ||
    !SYNTHETIC_PHONE_PATTERN.test(receiverLookupPhone) ||
    typeof receiverFullName !== 'string' ||
    !SYNTHETIC_NAME_PATTERN.test(receiverFullName)
  ) {
    return undefined;
  }
  return Object.freeze({
    contractVersion: CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    sourceProfile: SOURCE_PROFILE,
    fixtureMode: 'synthetic_only' as const,
    requestedReference,
    receiverLookupPhone,
    receiverFullName,
  });
}

function parseSyntheticResponse(
  candidate: unknown,
): CbeBirrSyntheticOfficialReceiptResponse | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, responseKeys)) {
    return undefined;
  }
  const body = ownDataValue(candidate, 'body');
  if (
    ownDataValue(candidate, 'status') !== 200 ||
    ownDataValue(candidate, 'contentType') !== 'text/html; charset=utf-8' ||
    typeof body !== 'string' ||
    body.length === 0 ||
    new TextEncoder().encode(body).byteLength > CBE_BIRR_OFFLINE_RECEIPT_MAX_RESPONSE_BYTES
  ) {
    return undefined;
  }
  return Object.freeze({
    status: 200 as const,
    contentType: 'text/html; charset=utf-8' as const,
    body,
  });
}

function compileRequest(
  input: CbeBirrSyntheticOfficialReceiptInput,
): CbeBirrCompiledSyntheticRequest {
  return Object.freeze({
    method: 'GET' as const,
    url: `https://cbepay1.cbe.com.et:443/aureceipt?TID=${input.requestedReference}&PH=${input.receiverLookupPhone}`,
    redirectPolicy: 'reject_all' as const,
    queryParameterOrder: Object.freeze(['TID', 'PH'] as const),
  });
}

export function buildSyntheticCbeBirrOfficialReceiptLookupPlan(
  inputCandidate: unknown,
): CbeBirrSyntheticOfficialReceiptLookupPlan | CbeBirrSyntheticOfficialReceiptInvalidResult {
  try {
    const input = parseInput(inputCandidate);
    if (!input) return invalidResult;
    return Object.freeze({
      contractVersion: CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION,
      providerCode: 'cbe_birr' as const,
      sourceProfile: SOURCE_PROFILE,
      advisoryOnly: true as const,
      disposition: 'offline_fixture_plan' as const,
      reasonCode: 'live_transport_absent' as const,
      request: compileRequest(input),
      ...disabledCapabilities,
    });
  } catch {
    return invalidResult;
  }
}

function textContent(node: Parse5Node): string {
  if (node.nodeName === '#text') return node.value ?? '';
  if (node.tagName === 'script' || node.tagName === 'style') return '';
  return (node.childNodes ?? []).map(textContent).join('');
}

function normalizedText(node: Parse5Node): string {
  return textContent(node).normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function findSyntheticMarker(node: Parse5Node): boolean {
  if (node.tagName === 'meta') {
    const attributes = new Map((node.attrs ?? []).map(({ name, value }) => [name, value]));
    if (
      attributes.get('name') === 'fetanagent-synthetic-fixture' &&
      attributes.get('content') === SYNTHETIC_MARKER
    ) {
      return true;
    }
  }
  return (node.childNodes ?? []).some(findSyntheticMarker);
}

function collectRows(
  node: Parse5Node,
  rows: readonly Parse5Node[][] = [],
): readonly Parse5Node[][] {
  const mutableRows = rows as Parse5Node[][];
  if (node.tagName === 'tr') {
    const cells = (node.childNodes ?? []).filter(
      (child) => child.tagName === 'th' || child.tagName === 'td',
    );
    if (cells.length > 0) mutableRows.push(cells);
  }
  for (const child of node.childNodes ?? []) collectRows(child, mutableRows);
  return mutableRows;
}

function receiptFields(document: Parse5Node): Map<string, string> | undefined {
  const fields = new Map<string, string>();
  for (const cells of collectRows(document)) {
    if (cells.length !== 2) continue;
    const label = normalizedText(cells[0]!);
    if (!expectedReceiptLabels.includes(label as (typeof expectedReceiptLabels)[number])) continue;
    if (fields.has(label)) return undefined;
    fields.set(label, normalizedText(cells[1]!));
  }
  return expectedReceiptLabels.every((label) => fields.has(label)) ? fields : undefined;
}

function parseMoneyMinor(value: string): number | undefined {
  const match = MONEY_PATTERN.exec(value);
  if (!match) return undefined;
  const minor = BigInt(match[1]!) * 100n + BigInt(match[2]!);
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : undefined;
}

function parseAddisAbabaTimestamp(value: string): string | undefined {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match?.groups) return undefined;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second);
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day ||
    utc.getUTCHours() !== hour ||
    utc.getUTCMinutes() !== minute ||
    utc.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
}

function mask(value: string): string {
  return `***${value.slice(-4)}`;
}

function safeFacts(
  fields: Map<string, string>,
  input: CbeBirrSyntheticOfficialReceiptInput,
): CbeBirrSyntheticOfficialReceiptResult {
  const providerReference = fields.get('Transaction ID')!;
  const receiverName = fields.get('Receiver Name')!;
  const receiverAccount = fields.get('Receiver Wallet')!;
  const principalAmountMinor = parseMoneyMinor(fields.get('Paid Amount')!);
  const serviceChargeMinor = parseMoneyMinor(fields.get('Service Charge')!);
  const vatMinor = parseMoneyMinor(fields.get('VAT')!);
  const totalDebitedMinor = parseMoneyMinor(fields.get('Total Debited')!);
  const occurredAtAddisAbaba = parseAddisAbabaTimestamp(fields.get('Transaction Date')!);
  if (
    !SYNTHETIC_REFERENCE_PATTERN.test(providerReference) ||
    !SYNTHETIC_PHONE_PATTERN.test(receiverAccount) ||
    !SYNTHETIC_NAME_PATTERN.test(receiverName) ||
    principalAmountMinor === undefined ||
    principalAmountMinor <= 0 ||
    serviceChargeMinor === undefined ||
    vatMinor === undefined ||
    totalDebitedMinor === undefined ||
    occurredAtAddisAbaba === undefined
  ) {
    return failureResult('receipt_shape_unattested');
  }

  const referenceMatch = providerReference === input.requestedReference;
  const receiverNameMatch = receiverName === input.receiverFullName;
  const receiverAccountMatch = receiverAccount === input.receiverLookupPhone;
  const providerFinalStatus =
    fields.get('Transaction Status') === 'Completed' ? ('completed' as const) : ('other' as const);
  const transactionType =
    fields.get('Transaction Type') === 'Send Money' ? ('send_money' as const) : ('other' as const);
  const feeArithmetic =
    principalAmountMinor + serviceChargeMinor + vatMinor === totalDebitedMinor
      ? ('consistent' as const)
      : ('mismatched' as const);

  const reasonCode = !referenceMatch
    ? ('requested_reference_mismatch' as const)
    : !receiverNameMatch
      ? ('receiver_name_mismatch' as const)
      : !receiverAccountMatch
        ? ('receiver_account_mismatch' as const)
        : providerFinalStatus !== 'completed'
          ? ('status_not_completed' as const)
          : transactionType !== 'send_money'
            ? ('transaction_type_unsupported' as const)
            : feeArithmetic !== 'consistent'
              ? ('fee_arithmetic_mismatch' as const)
              : ('synthetic_receipt_parsed' as const);

  return Object.freeze({
    ...resultBase,
    disposition:
      reasonCode === 'synthetic_receipt_parsed'
        ? ('synthetic_safe_facts' as const)
        : ('would_review' as const),
    reasonCode,
    referenceMask: mask(providerReference),
    receiverAccountMask: mask(receiverAccount),
    referenceMatch,
    receiverNameMatch,
    receiverAccountMatch,
    providerFinalStatus,
    transactionType,
    principalAmountMinor,
    serviceChargeMinor,
    vatMinor,
    totalDebitedMinor,
    feeArithmetic,
    occurredAtAddisAbaba,
  });
}

export function inspectSyntheticCbeBirrOfficialReceipt(
  inputCandidate: unknown,
  responseCandidate: unknown,
): CbeBirrSyntheticOfficialReceiptResult {
  try {
    const input = parseInput(inputCandidate);
    if (!input) return invalidResult;
    const response = parseSyntheticResponse(responseCandidate);
    if (!response) return failureResult('fixture_response_invalid');
    const document = parse(response.body) as unknown as Parse5Node;
    if (!findSyntheticMarker(document)) return failureResult('fixture_marker_missing');
    const fields = receiptFields(document);
    return fields ? safeFacts(fields, input) : failureResult('receipt_shape_unattested');
  } catch {
    return failureResult('receipt_shape_unattested');
  }
}

const invalidLogProjection: RedactedSyntheticCbeBirrOfficialReceiptLogProjection = Object.freeze({
  contractVersion: CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  parserVersion: CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION,
  advisoryOnly: true as const,
  disposition: 'invalid_result' as const,
  reasonCode: 'invalid_result' as const,
});

function hasExactResultBase(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'contractVersion') === CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION &&
    ownDataValue(candidate, 'providerCode') === 'cbe_birr' &&
    ownDataValue(candidate, 'sourceProfile') === SOURCE_PROFILE &&
    ownDataValue(candidate, 'parserVersion') === CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION &&
    ownDataValue(candidate, 'advisoryOnly') === true &&
    disabledCapabilityKeys.every((key) => ownDataValue(candidate, key) === false)
  );
}

function isSafeIntegerMinor(candidate: unknown, positive: boolean): candidate is number {
  return (
    typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    (positive ? candidate > 0 : candidate >= 0)
  );
}

function isCanonicalAddisAbabaTimestamp(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  const match =
    /^(?<year>20[0-9]{2})-(?<month>[0-9]{2})-(?<day>[0-9]{2})T(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})\+03:00$/u.exec(
      candidate,
    );
  if (!match?.groups) return false;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second);
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    timestamp.getUTCFullYear() === year &&
    timestamp.getUTCMonth() === month - 1 &&
    timestamp.getUTCDate() === day &&
    timestamp.getUTCHours() === hour &&
    timestamp.getUTCMinutes() === minute &&
    timestamp.getUTCSeconds() === second
  );
}

function hasValidSafeFacts(candidate: UnknownRecord): boolean {
  const referenceMask = ownDataValue(candidate, 'referenceMask');
  const receiverAccountMask = ownDataValue(candidate, 'receiverAccountMask');
  const referenceMatch = ownDataValue(candidate, 'referenceMatch');
  const receiverNameMatch = ownDataValue(candidate, 'receiverNameMatch');
  const receiverAccountMatch = ownDataValue(candidate, 'receiverAccountMatch');
  const providerFinalStatus = ownDataValue(candidate, 'providerFinalStatus');
  const transactionType = ownDataValue(candidate, 'transactionType');
  const principalAmountMinor = ownDataValue(candidate, 'principalAmountMinor');
  const serviceChargeMinor = ownDataValue(candidate, 'serviceChargeMinor');
  const vatMinor = ownDataValue(candidate, 'vatMinor');
  const totalDebitedMinor = ownDataValue(candidate, 'totalDebitedMinor');
  const feeArithmetic = ownDataValue(candidate, 'feeArithmetic');
  const occurredAtAddisAbaba = ownDataValue(candidate, 'occurredAtAddisAbaba');
  if (
    typeof referenceMask !== 'string' ||
    !/^\*\*\*[A-Z0-9]{4}$/u.test(referenceMask) ||
    typeof receiverAccountMask !== 'string' ||
    !/^\*\*\*[0-9]{4}$/u.test(receiverAccountMask) ||
    typeof referenceMatch !== 'boolean' ||
    typeof receiverNameMatch !== 'boolean' ||
    typeof receiverAccountMatch !== 'boolean' ||
    (providerFinalStatus !== 'completed' && providerFinalStatus !== 'other') ||
    (transactionType !== 'send_money' && transactionType !== 'other') ||
    !isSafeIntegerMinor(principalAmountMinor, true) ||
    !isSafeIntegerMinor(serviceChargeMinor, false) ||
    !isSafeIntegerMinor(vatMinor, false) ||
    !isSafeIntegerMinor(totalDebitedMinor, false) ||
    (feeArithmetic !== 'consistent' && feeArithmetic !== 'mismatched') ||
    !isCanonicalAddisAbabaTimestamp(occurredAtAddisAbaba)
  ) {
    return false;
  }
  const calculatedTotal =
    BigInt(principalAmountMinor) + BigInt(serviceChargeMinor) + BigInt(vatMinor);
  const arithmeticIsConsistent = calculatedTotal === BigInt(totalDebitedMinor);
  return (feeArithmetic === 'consistent') === arithmeticIsConsistent;
}

function hasAllowedSafeDispositionReason(candidate: UnknownRecord): boolean {
  const disposition = ownDataValue(candidate, 'disposition');
  const reasonCode = ownDataValue(candidate, 'reasonCode');
  const referenceMatch = ownDataValue(candidate, 'referenceMatch');
  const receiverNameMatch = ownDataValue(candidate, 'receiverNameMatch');
  const receiverAccountMatch = ownDataValue(candidate, 'receiverAccountMatch');
  const providerFinalStatus = ownDataValue(candidate, 'providerFinalStatus');
  const transactionType = ownDataValue(candidate, 'transactionType');
  const feeArithmetic = ownDataValue(candidate, 'feeArithmetic');
  if (disposition === 'synthetic_safe_facts') {
    return (
      reasonCode === 'synthetic_receipt_parsed' &&
      referenceMatch === true &&
      receiverNameMatch === true &&
      receiverAccountMatch === true &&
      providerFinalStatus === 'completed' &&
      transactionType === 'send_money' &&
      feeArithmetic === 'consistent'
    );
  }
  if (disposition !== 'would_review') return false;
  switch (reasonCode) {
    case 'requested_reference_mismatch':
      return referenceMatch === false;
    case 'receiver_name_mismatch':
      return referenceMatch === true && receiverNameMatch === false;
    case 'receiver_account_mismatch':
      return (
        referenceMatch === true && receiverNameMatch === true && receiverAccountMatch === false
      );
    case 'status_not_completed':
      return (
        referenceMatch === true &&
        receiverNameMatch === true &&
        receiverAccountMatch === true &&
        providerFinalStatus === 'other'
      );
    case 'transaction_type_unsupported':
      return (
        referenceMatch === true &&
        receiverNameMatch === true &&
        receiverAccountMatch === true &&
        providerFinalStatus === 'completed' &&
        transactionType === 'other'
      );
    case 'fee_arithmetic_mismatch':
      return (
        referenceMatch === true &&
        receiverNameMatch === true &&
        receiverAccountMatch === true &&
        providerFinalStatus === 'completed' &&
        transactionType === 'send_money' &&
        feeArithmetic === 'mismatched'
      );
    default:
      return false;
  }
}

function isExactValidResult(
  candidate: unknown,
): candidate is CbeBirrSyntheticOfficialReceiptResult {
  if (!isPlainNonProxyRecord(candidate) || !hasExactResultBase(candidate)) return false;
  const disposition = ownDataValue(candidate, 'disposition');
  const reasonCode = ownDataValue(candidate, 'reasonCode');
  if (disposition === 'invalid_request' && reasonCode === 'invalid_request') {
    return hasExactEnumerableDataKeys(candidate, resultBaseKeys);
  }
  if (
    disposition === 'would_review' &&
    (reasonCode === 'fixture_response_invalid' ||
      reasonCode === 'fixture_marker_missing' ||
      reasonCode === 'receipt_shape_unattested')
  ) {
    return hasExactEnumerableDataKeys(candidate, resultBaseKeys);
  }
  return (
    hasExactEnumerableDataKeys(candidate, safeFactKeys) &&
    hasValidSafeFacts(candidate) &&
    hasAllowedSafeDispositionReason(candidate)
  );
}

export function projectCbeBirrOfflineReceiptLog(
  resultCandidate: unknown,
): RedactedSyntheticCbeBirrOfficialReceiptLogProjection {
  try {
    if (!isExactValidResult(resultCandidate)) return invalidLogProjection;
    const { disposition, reasonCode } = resultCandidate;
    return Object.freeze({
      contractVersion: CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION,
      providerCode: 'cbe_birr' as const,
      parserVersion: CBE_BIRR_OFFLINE_RECEIPT_PARSER_VERSION,
      advisoryOnly: true as const,
      disposition,
      reasonCode: reasonCode as CbeBirrSyntheticOfficialReceiptResult['reasonCode'],
    });
  } catch {
    return invalidLogProjection;
  }
}

export const redactedSyntheticCbeBirrOfficialReceiptForLog = projectCbeBirrOfflineReceiptLog;

export const syntheticCbeBirrOfficialReceiptFixtureInput: CbeBirrSyntheticOfficialReceiptInput =
  Object.freeze({
    contractVersion: CBE_BIRR_OFFLINE_RECEIPT_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    sourceProfile: SOURCE_PROFILE,
    fixtureMode: 'synthetic_only' as const,
    requestedReference: 'SYNTHCBE00001',
    receiverLookupPhone: '251900000001',
    receiverFullName: 'SYNTHETIC CBE RECEIVER',
  });

export const syntheticCbeBirrOfficialReceiptFixture = `<!doctype html>
<html><head><meta name="fetanagent-synthetic-fixture" content="${SYNTHETIC_MARKER}"></head><body>
<table>
<tr><th>Transaction ID</th><td>SYNTHCBE00001</td></tr>
<tr><th>Transaction Status</th><td>Completed</td></tr>
<tr><th>Receiver Name</th><td>SYNTHETIC CBE RECEIVER</td></tr>
<tr><th>Receiver Wallet</th><td>251900000001</td></tr>
<tr><th>Transaction Type</th><td>Send Money</td></tr>
<tr><th>Paid Amount</th><td>150.00 ETB</td></tr>
<tr><th>Service Charge</th><td>1.74 ETB</td></tr>
<tr><th>VAT</th><td>0.26 ETB</td></tr>
<tr><th>Total Debited</th><td>152.00 ETB</td></tr>
<tr><th>Transaction Date</th><td>01/01/2099 12:34:56</td></tr>
</table></body></html>`;
