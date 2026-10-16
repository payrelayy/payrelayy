import { isProxy } from 'node:util/types';

/**
 * Offline, advisory-only time-window check for a parsed CBE Birr receipt. It cannot establish
 * receipt authenticity, receiver identity, duplicate clearance, or Player-credit eligibility.
 */
export const CBE_BIRR_RECEIPT_TIME_WINDOW_CONTRACT_VERSION = 1 as const;

const ONE_HOUR_MS = 3_600_000;
const FIVE_MINUTES_MS = 300_000;
const ADDIS_OFFSET_MS = 10_800_000;
const ADDIS_TIMESTAMP_PATTERN = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\+03:00$/u;
const UTC_TIMESTAMP_PATTERN =
  /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const inputKeys = [
  'contractVersion',
  'providerCode',
  'parserVersion',
  'documentTopology',
  'occurredAt',
  'occurredAtPrecision',
  'occurredAtTimeZone',
  'instructionIssuedAt',
  'instructionExpiresAt',
  'submittedAt',
] as const;

export interface CbeBirrReceiptTimeWindowInput {
  readonly contractVersion: typeof CBE_BIRR_RECEIPT_TIME_WINDOW_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly parserVersion: 2;
  readonly documentTopology:
    'cbe_birr_vat_customer_receipt_v1' | 'cbe_birr_vat_customer_receipt_credit_account_v2';
  readonly occurredAt: string;
  readonly occurredAtPrecision: 'second' | 'minute';
  readonly occurredAtTimeZone: 'Africa/Addis_Ababa';
  readonly instructionIssuedAt: string;
  readonly instructionExpiresAt: string;
  readonly submittedAt: string;
}

export type CbeBirrReceiptTimeWindowReason =
  | 'within_window_advisory'
  | 'invalid_input'
  | 'instruction_window_invalid'
  | 'submission_outside_instruction'
  | 'receipt_outside_instruction'
  | 'receipt_outside_freshness_window';

export interface CbeBirrReceiptTimeWindowResult {
  readonly contractVersion: typeof CBE_BIRR_RECEIPT_TIME_WINDOW_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly advisoryOnly: true;
  readonly authoritativeVerificationAllowed: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'window_consistent_advisory' | 'would_review';
  readonly reasonCode: CbeBirrReceiptTimeWindowReason;
}

function result(reasonCode: CbeBirrReceiptTimeWindowReason): CbeBirrReceiptTimeWindowResult {
  return Object.freeze({
    contractVersion: CBE_BIRR_RECEIPT_TIME_WINDOW_CONTRACT_VERSION,
    providerCode: 'cbe_birr',
    advisoryOnly: true,
    authoritativeVerificationAllowed: false,
    financialActionAllowed: false,
    disposition:
      reasonCode === 'within_window_advisory' ? 'window_consistent_advisory' : 'would_review',
    reasonCode,
  });
}

function isExactDataRecord(value: unknown): value is Record<(typeof inputKeys)[number], unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === inputKeys.length &&
    inputKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
      );
    })
  );
}

function dataValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function parseAddisTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !ADDIS_TIMESTAMP_PATTERN.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const reconstructed = `${new Date(timestamp + ADDIS_OFFSET_MS).toISOString().slice(0, 19)}+03:00`;
  return reconstructed === value ? timestamp : null;
}

function parseUtcTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

/**
 * A displayed minute represents [HH:mm:00, HH:mm+1:00), and a displayed second represents
 * [HH:mm:ss, HH:mm:ss+1). The entire possible interval must fit both the instruction and
 * freshness windows. This is only one prerequisite; a consistent window never verifies money.
 */
export function assessCbeBirrReceiptTimeWindow(input: unknown): CbeBirrReceiptTimeWindowResult {
  if (!isExactDataRecord(input)) return result('invalid_input');
  const occurredAt = parseAddisTimestamp(dataValue(input, 'occurredAt'));
  const precision = dataValue(input, 'occurredAtPrecision');
  const topology = dataValue(input, 'documentTopology');
  const issuedAt = parseUtcTimestamp(dataValue(input, 'instructionIssuedAt'));
  const expiresAt = parseUtcTimestamp(dataValue(input, 'instructionExpiresAt'));
  const submittedAt = parseUtcTimestamp(dataValue(input, 'submittedAt'));
  if (
    dataValue(input, 'contractVersion') !== CBE_BIRR_RECEIPT_TIME_WINDOW_CONTRACT_VERSION ||
    dataValue(input, 'providerCode') !== 'cbe_birr' ||
    dataValue(input, 'parserVersion') !== 2 ||
    dataValue(input, 'occurredAtTimeZone') !== 'Africa/Addis_Ababa' ||
    occurredAt === null ||
    (precision !== 'second' && precision !== 'minute') ||
    !(
      (topology === 'cbe_birr_vat_customer_receipt_v1' && precision === 'second') ||
      (topology === 'cbe_birr_vat_customer_receipt_credit_account_v2' && precision === 'minute')
    ) ||
    (precision === 'minute' && !(dataValue(input, 'occurredAt') as string).endsWith(':00+03:00')) ||
    issuedAt === null ||
    expiresAt === null ||
    submittedAt === null
  ) {
    return result('invalid_input');
  }
  if (expiresAt - issuedAt !== ONE_HOUR_MS) return result('instruction_window_invalid');
  if (submittedAt < issuedAt || submittedAt >= expiresAt) {
    return result('submission_outside_instruction');
  }

  const endExclusive = occurredAt + (precision === 'minute' ? 60_000 : 1_000);
  if (occurredAt < issuedAt || endExclusive > expiresAt) {
    return result('receipt_outside_instruction');
  }
  if (occurredAt < submittedAt - ONE_HOUR_MS || endExclusive > submittedAt + FIVE_MINUTES_MS + 1) {
    return result('receipt_outside_freshness_window');
  }
  return result('within_window_advisory');
}
