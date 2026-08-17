import type { DepositStatus } from '@fetanagent/domain';
import { describe, expect, it } from 'vitest';

import {
  isCustomerDepositStatusProjection,
  projectCustomerDepositStatus,
  type CustomerDepositStatusProjection,
} from './customer-deposit-status.js';

const expected = [
  ['intake_received', { label: 'Ready to start', tone: 'neutral' }],
  ['verification_pending', { label: 'Checking payment', tone: 'working' }],
  ['verification_review', { label: 'Being checked', tone: 'working' }],
  ['verified', { label: 'Preparing deposit', tone: 'working' }],
  ['execution_pending', { label: 'Preparing deposit', tone: 'working' }],
  ['execution_in_progress', { label: 'Preparing deposit', tone: 'working' }],
  ['execution_review', { label: 'Needs attention', tone: 'attention' }],
  ['execution_reconciliation', { label: 'Being checked', tone: 'working' }],
  ['executed', { label: 'Completed', tone: 'success' }],
  ['rejected', { label: 'Could not confirm', tone: 'attention' }],
  ['expired', { label: 'Expired', tone: 'neutral' }],
  ['cancelled', { label: 'Cancelled', tone: 'neutral' }],
  ['execution_uncertain', { label: 'Being checked', tone: 'working' }],
] as const satisfies readonly (readonly [DepositStatus, CustomerDepositStatusProjection])[];

describe('customer deposit status projection', () => {
  it.each(expected)('maps %s to the exact customer-safe presentation', (status, projection) => {
    const result = projectCustomerDepositStatus(status);
    expect(result).toEqual(projection);
    expect(Object.keys(result).sort()).toEqual(['label', 'tone']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('exhaustively covers every authoritative deposit status exactly once', () => {
    expect(expected.map(([status]) => status)).toEqual([
      'intake_received',
      'verification_pending',
      'verification_review',
      'verified',
      'execution_pending',
      'execution_in_progress',
      'execution_review',
      'execution_reconciliation',
      'executed',
      'rejected',
      'expired',
      'cancelled',
      'execution_uncertain',
    ]);
  });

  it('never projects an agent, external reference, execution attempt, or database identifier', () => {
    const encoded = JSON.stringify(
      expected.map(([status]) => projectCustomerDepositStatus(status)),
    );
    expect(encoded).not.toMatch(/agent|external|reference|attempt|_id|uuid/iu);
  });

  it('strictly validates only canonical label and tone pairs', () => {
    expect(isCustomerDepositStatusProjection({ label: 'Completed', tone: 'success' })).toBe(true);
    expect(isCustomerDepositStatusProjection({ label: 'Completed', tone: 'working' })).toBe(false);
    expect(
      isCustomerDepositStatusProjection({
        label: 'Completed',
        tone: 'success',
        executionAttemptId: 'hidden',
      }),
    ).toBe(false);
    expect(isCustomerDepositStatusProjection({ label: 'execution_pending', tone: 'working' })).toBe(
      false,
    );
  });
});
