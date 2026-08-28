import { describe, expect, it } from 'vitest';

import { reconcileOwnerKemerbetReadinessRootReceipt } from './owner-kemerbet-readiness-reconciler.js';

const claimId = '88888888-8888-4888-8888-888888888888';
const receiptId = '99999999-9999-4999-8999-999999999999';

describe('Owner KemerBet readiness root-receipt reconciliation', () => {
  it('does nothing when the exact root receipt boundary is empty', async () => {
    const result = await reconcileOwnerKemerbetReadinessRootReceipt(
      { rootReceipt: async () => undefined },
      {
        recordRootReceipt: async () => {
          throw new Error('database receipt must not run');
        },
      },
      () => receiptId,
    );

    expect(result).toBe('none');
  });

  it('keeps retryable failure frozen without recording a terminal DB receipt', async () => {
    const result = await reconcileOwnerKemerbetReadinessRootReceipt(
      { rootReceipt: async () => ({ claimId, event: 'retryable_failed' }) },
      {
        recordRootReceipt: async () => {
          throw new Error('database receipt must not run');
        },
      },
      () => receiptId,
    );

    expect(result).toBe('retryable_failed');
  });

  it('keeps a spent-recheck terminal marker out of every retry and DB outcome path', async () => {
    const result = await reconcileOwnerKemerbetReadinessRootReceipt(
      {
        rootReceipt: async () => ({
          claimId,
          event: 'recheck_authorization_spent_failed_terminal',
        }),
      },
      {
        recordRootReceipt: async () => {
          throw new Error('a spent authorization cannot be reconciled as a retryable outcome');
        },
      },
      () => receiptId,
    );

    expect(result).toBe('recheck_authorization_spent_failed_terminal');
  });

  it('projects the distinct recovery marker without terminalizing it outside atomic profile recovery', async () => {
    const result = await reconcileOwnerKemerbetReadinessRootReceipt(
      {
        rootReceipt: async () => ({
          claimId,
          event: 'security_recovery_failed_terminal',
        }),
      },
      {
        recordRootReceipt: async () => {
          throw new Error('terminal receipt must be recorded only inside atomic profile recovery');
        },
      },
      () => receiptId,
    );

    expect(result).toBe('security_recovery_required');
  });

  it('projects the finalized-profile latch without writing a DB root receipt', async () => {
    const result = await reconcileOwnerKemerbetReadinessRootReceipt(
      {
        rootReceipt: async () => ({
          claimId,
          event: 'security_recovery_profile_finalized',
        }),
      },
      {
        recordRootReceipt: async () => {
          throw new Error('the finalized-profile latch is not a cohort outcome');
        },
      },
      () => receiptId,
    );

    expect(result).toBe('security_recovery_cohort_required');
  });

  it.each(['imported', 'completed'] as const)(
    'records an exact %s root receipt with a fresh server receipt identity',
    async (event) => {
      const calls: unknown[][] = [];
      const result = await reconcileOwnerKemerbetReadinessRootReceipt(
        { rootReceipt: async () => ({ claimId, event }) },
        {
          recordRootReceipt: async (...values) => {
            calls.push(values);
          },
        },
        () => receiptId,
      );

      expect(result).toBe(event === 'completed' ? 'completed_recorded' : 'imported_recorded');
      expect(calls).toEqual([[claimId, receiptId, event]]);
    },
  );

  it('propagates a rejected filesystem or DB receipt without exposing identifiers in a result', async () => {
    const expected = new Error('unavailable');
    await expect(
      reconcileOwnerKemerbetReadinessRootReceipt(
        { rootReceipt: async () => ({ claimId, event: 'completed' }) },
        {
          recordRootReceipt: async () => {
            throw expected;
          },
        },
        () => receiptId,
      ),
    ).rejects.toBe(expected);
  });
});
