import { describe, expect, it } from 'vitest';

import {
  OWNER_COMPANION_EXECUTION_READINESS_SQL,
  OwnerCompanionExecutionReadinessRejectedError,
  OwnerCompanionExecutionReadinessUnavailableError,
  PostgresOwnerCompanionExecutionReadiness,
  parseOwnerCompanionExecutionReadiness,
} from './owner-companion-execution-readiness.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const paidReview = {
  activationAvailable: false,
  cancelledUntouchedJobs: 1,
  companionExecutionDisabled: true,
  customerResolutionPending: true,
  effectiveTrustedEpochAvailable: false,
  executionCapabilityDormant: true,
  financialSwitchesDisabled: true,
  identifiersRedacted: true,
  nextAction: 'customer_resolution_pending',
  openExecutionReviews: 1,
  openJobs: 0,
  pilotState: 'stopped',
  readOnly: true,
  untouchedQueuedJobs: 0,
};

describe('read-only Owner companion execution readiness', () => {
  it('accepts only the bounded identifier-free paid-review projection', () => {
    expect(parseOwnerCompanionExecutionReadiness(paidReview)).toEqual(paidReview);
    for (const changed of [
      { ...paidReview, activationAvailable: true },
      { ...paidReview, receiptReference: 'secret' },
      { ...paidReview, openJobs: 3 },
      { ...paidReview, customerResolutionPending: true, openExecutionReviews: 0 },
      { ...paidReview, nextAction: 'execute_deposit' },
    ]) {
      expect(() => parseOwnerCompanionExecutionReadiness(changed)).toThrow(
        OwnerCompanionExecutionReadinessUnavailableError,
      );
    }
  });

  it('calls only the Owner-granted status function, never a base table', async () => {
    const calls: Array<{ sql: string; values: readonly string[] }> = [];
    const service = new PostgresOwnerCompanionExecutionReadiness({
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ readiness: paidReview }] };
      },
    });
    expect(await service.status(ownerId)).toEqual(paidReview);
    expect(calls).toEqual([{ sql: OWNER_COMPANION_EXECUTION_READINESS_SQL, values: [ownerId] }]);
    expect(OWNER_COMPANION_EXECUTION_READINESS_SQL).toMatch(/^select app\./u);
  });

  it('rejects an invalid subject and fails closed on missing or rejected data', async () => {
    const unavailable = new PostgresOwnerCompanionExecutionReadiness({
      query: async () => ({ rows: [] }),
    });
    await expect(unavailable.status('not-a-uuid')).rejects.toThrow(
      OwnerCompanionExecutionReadinessRejectedError,
    );
    await expect(unavailable.status(ownerId)).rejects.toThrow(
      OwnerCompanionExecutionReadinessUnavailableError,
    );
    const forbidden = new PostgresOwnerCompanionExecutionReadiness({
      query: async () => {
        throw { code: '42501' };
      },
    });
    await expect(forbidden.status(ownerId)).rejects.toThrow(
      OwnerCompanionExecutionReadinessRejectedError,
    );
  });
});
