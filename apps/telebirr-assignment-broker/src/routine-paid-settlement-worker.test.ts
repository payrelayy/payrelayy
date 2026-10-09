import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_PAID_SETTLEMENT_BATCH_SIZE,
  runRoutinePaidSettlementPass,
  type RoutinePaidSettlementCandidate,
  type RoutinePaidSettlementDatabase,
} from './routine-paid-settlement-worker.js';

const first: RoutinePaidSettlementCandidate = {
  challengeId: '11111111-1111-4111-8111-111111111111',
  verificationCompletedAtUtc: '2026-10-09T10:00:00.000001Z',
};
const second: RoutinePaidSettlementCandidate = {
  challengeId: '22222222-2222-4222-8222-222222222222',
  verificationCompletedAtUtc: '2026-10-09T10:00:00.000002Z',
};

describe('routine paid settlement worker', () => {
  it('continues past a rejected observation and does not log receipt data', async () => {
    const listCandidates = vi.fn(async () => [first, second]);
    const finalize = vi.fn(async (id: string) => {
      if (id === first.challengeId) throw new Error('sensitive receipt details');
      return 'created' as const;
    });
    const database: RoutinePaidSettlementDatabase = { listCandidates, finalize };
    const pass = await runRoutinePaidSettlementPass(database);
    expect(listCandidates).toHaveBeenCalledWith(undefined, ROUTINE_PAID_SETTLEMENT_BATCH_SIZE);
    expect(finalize.mock.calls.map(([id]) => id)).toEqual([first.challengeId, second.challengeId]);
    expect(pass).toEqual({
      nextCursor: undefined,
      examined: 2,
      created: 1,
      alreadyFinalized: 0,
      rejected: 1,
    });
    expect(JSON.stringify(pass)).not.toContain('sensitive receipt details');
  });

  it('carries a cursor across full pages and lets a restart rescan pending rows', async () => {
    const page = Array.from({ length: ROUTINE_PAID_SETTLEMENT_BATCH_SIZE }, (_, index) => ({
      challengeId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      verificationCompletedAtUtc: `2026-10-09T10:00:00.${String(index + 1).padStart(6, '0')}Z`,
    }));
    const listCandidates = vi.fn(async (cursor: RoutinePaidSettlementCandidate | undefined) =>
      cursor ? [] : page,
    );
    const database: RoutinePaidSettlementDatabase = {
      listCandidates,
      finalize: vi.fn(async () => 'already_finalized' as const),
    };
    const firstPass = await runRoutinePaidSettlementPass(database);
    expect(firstPass.nextCursor).toEqual(page[page.length - 1]);
    expect(firstPass.alreadyFinalized).toBe(ROUTINE_PAID_SETTLEMENT_BATCH_SIZE);
    const nextPass = await runRoutinePaidSettlementPass(database, firstPass.nextCursor);
    expect(nextPass.examined).toBe(0);
    expect(nextPass.nextCursor).toBeUndefined();
    expect(listCandidates).toHaveBeenNthCalledWith(
      2,
      page[page.length - 1],
      ROUTINE_PAID_SETTLEMENT_BATCH_SIZE,
    );
  });

  it('rejects a scan larger than its fixed bound', async () => {
    const database: RoutinePaidSettlementDatabase = {
      listCandidates: async () => Array(ROUTINE_PAID_SETTLEMENT_BATCH_SIZE + 1).fill(first),
      finalize: vi.fn(async () => 'created' as const),
    };
    await expect(runRoutinePaidSettlementPass(database)).rejects.toThrow(/scan is unavailable/u);
    expect(database.finalize).not.toHaveBeenCalled();
  });
});
