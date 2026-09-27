import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GuardedOneJobOutcomeUnavailableError,
  loadGuardedApprovedJobId,
  loadGuardedOneJobOutcome,
  watchGuardedApprovedJobId,
  watchGuardedOneJobOutcome,
} from './guarded-one-job-outcome.js';

const requestKey = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

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

function administrator(rows: unknown[]) {
  const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows }));
  return { query };
}

const noLoss = new Promise<never>(() => undefined);
afterEach(() => vi.useRealTimers());

describe('one Owner-approved execution job outcome', () => {
  it('selects only one later Owner-approved job for the consumed activation', async () => {
    const db = administrator([{ job_id: jobId, approval_current: true, job_status: 'queued' }]);
    await expect(loadGuardedApprovedJobId(requestKey, db)).resolves.toBe(jobId);
    const [sql, values] = db.query.mock.calls[0]!;
    expect(values).toEqual([requestKey]);
    expect(sql).toContain('approval.approved_at >= consumption.activated_at');
    expect(sql).toContain('approval.approved_by_admin_id = consumption.activated_by_admin_id');
    expect(sql).toContain("session_user = 'postgres'");
    expect(sql).not.toMatch(/for\s+(update|share)|\b(insert|update|delete|alter|drop)\s+/iu);
    await expect(loadGuardedApprovedJobId(requestKey, administrator([]))).resolves.toBeNull();
  });

  it('fails closed on a second approval or an expired unclaimed approval', async () => {
    const row = { job_id: jobId, approval_current: true, job_status: 'queued' };
    for (const rows of [
      [row, row],
      [{ ...row, approval_current: false }],
      [{ ...row, job_id: 'bad' }],
    ]) {
      await expect(
        loadGuardedApprovedJobId(requestKey, administrator(rows)),
      ).rejects.toBeInstanceOf(GuardedOneJobOutcomeUnavailableError);
    }
  });

  it('waits for one later approval without submitting or leasing work', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-27T12:00:00.000Z');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ job_id: jobId, approval_current: true, job_status: 'leased' }],
      });
    const selected = watchGuardedApprovedJobId({
      requestKey,
      administrator: { query },
      validUntil: '2026-09-27T13:00:00.000Z',
      trustedNow: () => new Date(),
      supervisorLost: noLoss,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(selected).resolves.toBe(jobId);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reads one activation-bound job in one parameterized, lock-free snapshot', async () => {
    const db = administrator([pending]);
    await expect(loadGuardedOneJobOutcome(requestKey, jobId, db)).resolves.toBe('pending');
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, values] = db.query.mock.calls[0]!;
    expect(values).toEqual([requestKey, jobId]);
    expect(sql).toContain('consumption.request_key = $1::uuid');
    expect(sql).toContain('approval.execution_job_id = $2::uuid');
    expect(sql).toContain("session_user = 'postgres'");
    expect(sql).not.toMatch(/for\s+(update|share)|\b(insert|update|delete|alter|drop)\s+/iu);
  });

  it('does not call a database for malformed identities', async () => {
    const db = administrator([pending]);
    await expect(loadGuardedOneJobOutcome('bad', jobId, db)).rejects.toBeInstanceOf(
      GuardedOneJobOutcomeUnavailableError,
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  it('requires a positive matching provider-history reconciliation for confirmation', async () => {
    const db = administrator([confirmed]);
    await expect(loadGuardedOneJobOutcome(requestKey, jobId, db)).resolves.toBe('confirmed');
    for (const change of [
      { history_match_count: 2 },
      { exact_player_match: false },
      { exact_amount_match: false },
      { exact_currency_match: false },
      { exact_player_credit_match: false },
      { reconciliation_job_status: 'queued' },
      { assignment_state: 'authority_signed' },
      { attempt_agent_match: false },
      { assignment_epoch_match: false },
    ]) {
      const changed = administrator([{ ...confirmed, ...change }]);
      await expect(loadGuardedOneJobOutcome(requestKey, jobId, changed)).rejects.toBeInstanceOf(
        GuardedOneJobOutcomeUnavailableError,
      );
    }
  });

  it('keeps a signed result pending until the separate database reconciliation completes', async () => {
    const db = administrator([
      {
        ...pending,
        job_status: 'succeeded',
        intent_status: 'execution_reconciliation',
        attempt_status: 'reconciliation_required',
        attempt_agent_match: true,
        assignment_state: 'result_recorded',
        assignment_epoch_match: true,
      },
    ]);
    await expect(loadGuardedOneJobOutcome(requestKey, jobId, db)).resolves.toBe('pending');
  });

  it('routes ambiguity and terminal failure to review, never completion', async () => {
    for (const row of [
      { ...pending, reconciliation_outcome: 'ambiguous' },
      { ...pending, reconciliation_outcome: 'not_observed' },
      { ...pending, intent_status: 'execution_review' },
      { ...pending, attempt_status: 'review_required', attempt_agent_match: true },
      { ...pending, job_status: 'dead' },
    ]) {
      await expect(loadGuardedOneJobOutcome(requestKey, jobId, administrator([row]))).resolves.toBe(
        'review_required',
      );
    }
  });

  it('fails closed on missing, duplicate, malformed, or private driver output', async () => {
    for (const rows of [[], [pending, pending], [{ ...pending, unexpected: 'private' }]]) {
      await expect(
        loadGuardedOneJobOutcome(requestKey, jobId, administrator(rows)),
      ).rejects.toBeInstanceOf(GuardedOneJobOutcomeUnavailableError);
    }
    const query = vi.fn(async () => {
      throw new Error('private database detail');
    });
    await expect(loadGuardedOneJobOutcome(requestKey, jobId, { query })).rejects.toThrow(
      'The guarded one-job outcome cannot be confirmed.',
    );
  });

  it('watches the same job read-only until its positive reconciliation commits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-27T12:00:00.000Z');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [pending] })
      .mockResolvedValueOnce({ rows: [confirmed] });
    const observation = watchGuardedOneJobOutcome({
      requestKey,
      executionJobId: jobId,
      administrator: { query },
      validUntil: '2026-09-27T13:00:00.000Z',
      trustedNow: () => new Date(),
      supervisorLost: noLoss,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(observation).resolves.toBe('confirmed');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      [requestKey, jobId],
      [requestKey, jobId],
    ]);
  });

  it('stops observing on supervisor loss without another query', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-27T12:00:00.000Z');
    let rejectLoss!: (reason: Error) => void;
    const lost = new Promise<never>((_, reject) => {
      rejectLoss = reject;
    });
    const db = administrator([pending]);
    const observation = watchGuardedOneJobOutcome({
      requestKey,
      executionJobId: jobId,
      administrator: db,
      validUntil: '2026-09-27T13:00:00.000Z',
      trustedNow: () => new Date(),
      supervisorLost: lost,
    });
    await vi.advanceTimersByTimeAsync(1);
    rejectLoss(new Error('private watchdog detail'));
    await expect(observation).rejects.toBeInstanceOf(GuardedOneJobOutcomeUnavailableError);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired or too-short activation window before querying', async () => {
    const db = administrator([pending]);
    await expect(
      watchGuardedOneJobOutcome({
        requestKey,
        executionJobId: jobId,
        administrator: db,
        validUntil: '2026-09-27T12:00:20.000Z',
        trustedNow: () => new Date('2026-09-27T12:00:00.000Z'),
        supervisorLost: noLoss,
      }),
    ).rejects.toBeInstanceOf(GuardedOneJobOutcomeUnavailableError);
    expect(db.query).not.toHaveBeenCalled();
  });
});
