import { describe, expect, it } from 'vitest';

import {
  OwnerExecutionApprovalConflictError,
  OwnerExecutionApprovalRejectedError,
  OwnerExecutionApprovalUnavailableError,
  PostgresOwnerTelebirrExecutionApprovals,
} from './owner-telebirr-execution-approvals.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const requestKey = '33333333-3333-4333-8333-333333333333';

describe('Owner TeleBirr execution approvals', () => {
  it('returns a narrow verified queue without a payment reference', async () => {
    const approvals = new PostgresOwnerTelebirrExecutionApprovals({
      query: async (sql, values) => {
        expect(sql).toContain('app.list_owner_pending_telebirr_executions');
        expect(values).toEqual([actorId, 25]);
        return {
          rows: [
            {
              execution_job_id: jobId,
              player_id: 'test-player',
              amount_minor: '2500',
              currency_code: 'ETB',
              queued_at: new Date('2026-09-27T12:00:00.000Z'),
              verified_at: new Date('2026-09-27T11:59:00.000Z'),
              approved_at: null,
              approval_expires_at: null,
            },
          ],
        };
      },
    });
    expect(await approvals.list(actorId)).toEqual([
      {
        executionJobId: jobId,
        playerId: 'test-player',
        amountMinor: '2500',
        currencyCode: 'ETB',
        queuedAt: '2026-09-27T12:00:00.000Z',
        verifiedAt: '2026-09-27T11:59:00.000Z',
      },
    ]);
  });

  it('records a single idempotent Owner action without claiming a deposit', async () => {
    const approvals = new PostgresOwnerTelebirrExecutionApprovals({
      query: async (sql, values) => {
        expect(sql).toContain('app.approve_owner_telebirr_execution');
        expect(sql).not.toMatch(/lease_|fence_|transfer_/u);
        expect(values).toEqual([actorId, jobId, requestKey]);
        return {
          rows: [
            {
              approval: {
                approvedAt: '2026-09-27T12:00:00+00:00',
                expiresAt: '2026-09-27T13:00:00+00:00',
                alreadyApproved: false,
              },
            },
          ],
        };
      },
    });
    expect(await approvals.approve(actorId, jobId, requestKey)).toMatchObject({
      alreadyApproved: false,
    });
  });

  it('fails closed on invalid input, conflict, and malformed database results', async () => {
    const conflict = new PostgresOwnerTelebirrExecutionApprovals({
      query: async () => {
        throw { code: 'P0001' };
      },
    });
    await expect(conflict.approve(actorId, jobId, requestKey)).rejects.toBeInstanceOf(
      OwnerExecutionApprovalConflictError,
    );
    await expect(conflict.approve(actorId, jobId, 'bad')).rejects.toBeInstanceOf(
      OwnerExecutionApprovalRejectedError,
    );
    const malformed = new PostgresOwnerTelebirrExecutionApprovals({
      query: async () => ({ rows: [{ approval: { approvedAt: 'bad' } }] }),
    });
    await expect(malformed.approve(actorId, jobId, requestKey)).rejects.toBeInstanceOf(
      OwnerExecutionApprovalUnavailableError,
    );
  });
});
