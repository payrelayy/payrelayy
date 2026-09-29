import { describe, expect, it, vi } from 'vitest';

import {
  GuardedPostStopReviewUnavailableError,
  inspectGuardedOneJobAfterStop,
} from './guarded-post-stop-review.js';

const requestKey = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const noApproval = { job_id: null, approval_recorded: false, job_match: false };
const approved = { job_id: jobId, approval_recorded: true, job_match: true };

const stopped = Object.freeze({
  databaseCredentialsAndSessionsRevoked: true,
  financialAuthorityDisabled: true,
  companionExecutionDisabled: true,
  exactHostStopped: true,
  providerOutcomeRequiresReconciliation: true,
} as const);

const pending = Object.freeze({
  job_status: 'queued',
  intent_status: 'execution_pending',
  attempt_status: null,
  attempt_agent_match: null,
  assignment_state: null,
  assignment_epoch_match: null,
  reconciliation_outcome: null,
  reconciliation_job_status: null,
  history_match_count: null,
  exact_player_match: null,
  exact_amount_match: null,
  exact_currency_match: null,
  exact_player_credit_match: null,
});

const confirmed = Object.freeze({
  ...pending,
  job_status: 'succeeded',
  intent_status: 'executed',
  attempt_status: 'confirmed_executed',
  attempt_agent_match: true,
  assignment_state: 'result_recorded',
  assignment_epoch_match: true,
  reconciliation_outcome: 'confirmed_executed',
  reconciliation_job_status: 'succeeded',
  history_match_count: 1,
  exact_player_match: true,
  exact_amount_match: true,
  exact_currency_match: true,
  exact_player_credit_match: true,
});

function database(...results: unknown[][]) {
  const query = vi.fn(async () => ({ rows: results.shift() ?? [] }));
  return { query };
}

function inspect(
  db: ReturnType<typeof database>,
  stopOnUncertainty: () => Promise<typeof stopped> = vi.fn(async () => stopped),
) {
  return inspectGuardedOneJobAfterStop({
    requestKey,
    administrator: db,
    stopOnUncertainty,
  });
}

describe('one-job review after an independent emergency stop', () => {
  it('stops first, then inspects the exact consumed approval without expiry filtering', async () => {
    const order: string[] = [];
    const db = database([noApproval]);
    db.query.mockImplementation(async () => {
      order.push('query');
      return { rows: [noApproval] };
    });
    const stop = vi.fn(async () => {
      order.push('stop');
      return stopped;
    });

    await expect(inspect(db, stop)).resolves.toBe('no_owner_approval_recorded');
    expect(order).toEqual(['stop', 'query']);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, values] = db.query.mock.calls[0]!;
    expect(values).toEqual([requestKey]);
    expect(sql).toContain('consumption.request_key = $1::uuid');
    expect(sql).toContain('approval.approved_at >= consumption.activated_at');
    expect(sql).toContain("session_user = 'postgres'");
    expect(sql).not.toContain('approval.expires_at >');
    expect(sql).not.toMatch(/for\s+(update|share)|\b(insert|update|delete|alter|drop)\s+/iu);
  });

  it('requires positive, exact reconciliation before reporting a confirmed outcome', async () => {
    await expect(inspect(database([approved], [pending]))).resolves.toBe(
      'provider_review_required',
    );
    const db = database([approved], [confirmed]);
    await expect(inspect(db)).resolves.toBe('confirmed_in_reconciliation_ledger');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1]![1]).toEqual([requestKey, jobId]);
    expect(db.query.mock.calls[1]![0]).toContain(
      'approval.approved_at >= consumption.activated_at',
    );
  });

  it('never queries when the independent stop is missing or malformed', async () => {
    for (const stop of [
      vi.fn(async () => ({ ...stopped, exactHostStopped: false }) as typeof stopped),
      vi.fn(async () => ({ ...stopped, extra: 'private' }) as typeof stopped),
      vi.fn(async () => {
        throw new Error('private stop detail');
      }),
    ]) {
      const db = database([approved]);
      await expect(inspect(db, stop)).rejects.toBeInstanceOf(GuardedPostStopReviewUnavailableError);
      expect(db.query).not.toHaveBeenCalled();
    }
  });

  it('fails closed on ambiguous approvals, malformed identities, and private driver errors', async () => {
    for (const rows of [
      [],
      [approved, approved],
      [{ ...approved, job_id: 'bad' }],
      [{ ...approved, job_match: false }],
      [{ ...approved, extra: 'private' }],
    ]) {
      await expect(inspect(database(rows))).rejects.toBeInstanceOf(
        GuardedPostStopReviewUnavailableError,
      );
    }
    const db = database([approved]);
    await expect(
      inspectGuardedOneJobAfterStop({
        requestKey: 'bad',
        administrator: db,
        stopOnUncertainty: async () => stopped,
      }),
    ).rejects.toBeInstanceOf(GuardedPostStopReviewUnavailableError);
    expect(db.query).not.toHaveBeenCalled();

    const broken = database([]);
    broken.query.mockRejectedValueOnce(new Error('private database detail'));
    await expect(inspect(broken)).rejects.toThrow(
      'The exact one-job post-stop review could not be confirmed.',
    );
  });
});
