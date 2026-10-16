import { describe, expect, it } from 'vitest';

import {
  CBE_BIRR_RECEIPT_TIME_WINDOW_CONTRACT_VERSION,
  assessCbeBirrReceiptTimeWindow,
  type CbeBirrReceiptTimeWindowInput,
} from './receipt-time-window.js';

const base = (): CbeBirrReceiptTimeWindowInput => ({
  contractVersion: CBE_BIRR_RECEIPT_TIME_WINDOW_CONTRACT_VERSION,
  providerCode: 'cbe_birr',
  parserVersion: 2,
  documentTopology: 'cbe_birr_vat_customer_receipt_credit_account_v2',
  occurredAt: '2026-10-15T00:03:00+03:00',
  occurredAtPrecision: 'minute',
  occurredAtTimeZone: 'Africa/Addis_Ababa',
  instructionIssuedAt: '2026-10-14T21:00:00.000Z',
  instructionExpiresAt: '2026-10-14T22:00:00.000Z',
  submittedAt: '2026-10-14T21:30:00.000Z',
});

describe('CBE Birr receipt time-window preflight', () => {
  it('returns only a non-authoritative advisory for a wholly contained minute', () => {
    const decision = assessCbeBirrReceiptTimeWindow(base());
    expect(decision).toEqual({
      contractVersion: 1,
      providerCode: 'cbe_birr',
      advisoryOnly: true,
      authoritativeVerificationAllowed: false,
      financialActionAllowed: false,
      disposition: 'window_consistent_advisory',
      reasonCode: 'within_window_advisory',
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(JSON.stringify(decision)).not.toContain('2026-');
  });

  it('reviews a displayed minute overlapping instruction issue or expiry', () => {
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        instructionIssuedAt: '2026-10-14T21:03:30.000Z',
        instructionExpiresAt: '2026-10-14T22:03:30.000Z',
      }).reasonCode,
    ).toBe('receipt_outside_instruction');
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        instructionIssuedAt: '2026-10-14T20:03:30.000Z',
        instructionExpiresAt: '2026-10-14T21:03:30.000Z',
        submittedAt: '2026-10-14T21:03:20.000Z',
      }).reasonCode,
    ).toBe('receipt_outside_instruction');
  });

  it('accepts a minute whose possible interval ends exactly at instruction expiry', () => {
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        instructionIssuedAt: '2026-10-14T20:04:00.000Z',
        instructionExpiresAt: '2026-10-14T21:04:00.000Z',
        submittedAt: '2026-10-14T21:03:59.000Z',
      }).reasonCode,
    ).toBe('within_window_advisory');
  });

  it('reviews a displayed minute crossing the five-minute future tolerance', () => {
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        occurredAt: '2026-10-15T00:08:00+03:00',
        submittedAt: '2026-10-14T21:03:30.000Z',
      }).reasonCode,
    ).toBe('receipt_outside_freshness_window');
  });

  it('checks the full possible second, not only its :00 millisecond representation', () => {
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        documentTopology: 'cbe_birr_vat_customer_receipt_v1',
        occurredAtPrecision: 'second',
        instructionIssuedAt: '2026-10-14T20:03:00.500Z',
        instructionExpiresAt: '2026-10-14T21:03:00.500Z',
        submittedAt: '2026-10-14T21:03:00.400Z',
      }).reasonCode,
    ).toBe('receipt_outside_instruction');
  });

  it('reviews late submissions and malformed instruction lengths', () => {
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        submittedAt: '2026-10-14T22:00:00.000Z',
      }).reasonCode,
    ).toBe('submission_outside_instruction');
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        instructionExpiresAt: '2026-10-14T22:00:01.000Z',
      }).reasonCode,
    ).toBe('instruction_window_invalid');
  });

  it('rejects invalid dates, forged precision, extra keys, and accessor inputs', () => {
    expect(
      assessCbeBirrReceiptTimeWindow({ ...base(), occurredAt: '2026-02-30T00:03:00+03:00' })
        .reasonCode,
    ).toBe('invalid_input');
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        occurredAt: '2026-10-15T00:03:17+03:00',
        occurredAtPrecision: 'minute',
      }).reasonCode,
    ).toBe('invalid_input');
    expect(
      assessCbeBirrReceiptTimeWindow({
        ...base(),
        occurredAtPrecision: 'second',
      }).reasonCode,
    ).toBe('invalid_input');
    expect(assessCbeBirrReceiptTimeWindow({ ...base(), parserVersion: 3 }).reasonCode).toBe(
      'invalid_input',
    );
    expect(assessCbeBirrReceiptTimeWindow({ ...base(), extra: true }).reasonCode).toBe(
      'invalid_input',
    );
    const accessor = Object.defineProperty({ ...base() }, 'occurredAt', {
      enumerable: true,
      get: () => {
        throw new Error('must not execute');
      },
    });
    expect(assessCbeBirrReceiptTimeWindow(accessor).reasonCode).toBe('invalid_input');
    expect(assessCbeBirrReceiptTimeWindow(new Proxy(base(), {})).reasonCode).toBe('invalid_input');
  });
});
