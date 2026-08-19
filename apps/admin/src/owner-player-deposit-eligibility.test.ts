import { describe, expect, it } from 'vitest';

import {
  OwnerPlayerDepositEligibilityRejectedError,
  OwnerPlayerDepositEligibilityUnavailableError,
  PostgresOwnerPlayerDepositEligibility,
} from './owner-player-deposit-eligibility.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const playerAccountId = '22222222-2222-4222-8222-222222222222';
const decisionId = '33333333-3333-4333-8333-333333333333';

describe('Postgres Owner Player-ID deposit eligibility', () => {
  it('lists an associated player without inventing an eligibility decision', async () => {
    const eligibility = new PostgresOwnerPlayerDepositEligibility({
      query: async (sql, values) => {
        expect(sql).toContain('app.list_owner_player_deposit_eligibility');
        expect(values).toEqual([authUserId, 50]);
        return {
          rows: [
            {
              decided_at: null,
              decision: null,
              decision_id: null,
              decision_version: null,
              player_account_id: playerAccountId,
              player_id: '28379330',
              player_status: 'active',
              platform_code: 'kemerbet',
              reason_code: null,
              validation_status: 'valid',
            },
          ],
        };
      },
    });

    await expect(eligibility.list(authUserId)).resolves.toEqual([
      {
        playerAccountId,
        playerId: '28379330',
        playerStatus: 'active',
        platformCode: 'kemerbet',
        validationStatus: 'valid',
      },
    ]);
  });

  it('maps an exact eligible decision and server timestamp', async () => {
    const decidedAt = new Date('2026-08-19T16:30:00.123Z');
    const eligibility = new PostgresOwnerPlayerDepositEligibility({
      query: async (_sql, values) => {
        expect(values).toEqual([
          authUserId,
          playerAccountId,
          'eligible',
          'financial_eligibility_approved',
        ]);
        return {
          rows: [
            {
              decided_at: decidedAt,
              decided_decision: 'eligible',
              decided_decision_id: decisionId,
              decided_player_account_id: playerAccountId,
              decided_reason_code: 'financial_eligibility_approved',
              decided_version: 1,
              decision_already_recorded: false,
            },
          ],
        };
      },
    });

    await expect(eligibility.decide(authUserId, playerAccountId, 'eligible')).resolves.toEqual({
      alreadyRecorded: false,
      decidedAt: decidedAt.toISOString(),
      decision: 'eligible',
      decisionId,
      decisionVersion: 1,
      playerAccountId,
      reasonCode: 'financial_eligibility_approved',
    });
  });

  it('uses only the fixed revocation reason and preserves idempotent receipts', async () => {
    const eligibility = new PostgresOwnerPlayerDepositEligibility({
      query: async (_sql, values) => {
        expect(values).toEqual([
          authUserId,
          playerAccountId,
          'revoked',
          'financial_eligibility_revoked',
        ]);
        return {
          rows: [
            {
              decided_at: new Date('2026-08-19T16:31:00.000Z'),
              decided_decision: 'revoked',
              decided_decision_id: decisionId,
              decided_player_account_id: playerAccountId,
              decided_reason_code: 'financial_eligibility_revoked',
              decided_version: 2,
              decision_already_recorded: true,
            },
          ],
        };
      },
    });

    await expect(eligibility.decide(authUserId, playerAccountId, 'revoked')).resolves.toMatchObject(
      {
        alreadyRecorded: true,
        decision: 'revoked',
        reasonCode: 'financial_eligibility_revoked',
      },
    );
  });

  it('rejects invalid inputs before querying PostgreSQL', async () => {
    const eligibility = new PostgresOwnerPlayerDepositEligibility({
      query: async () => {
        throw new Error('must not query');
      },
    });

    await expect(eligibility.list('not-a-uuid')).rejects.toBeInstanceOf(
      OwnerPlayerDepositEligibilityRejectedError,
    );
    await expect(eligibility.decide(authUserId, 'not-a-uuid', 'eligible')).rejects.toBeInstanceOf(
      OwnerPlayerDepositEligibilityRejectedError,
    );
  });

  it('fails closed on malformed or contradictory database rows', async () => {
    const eligibility = new PostgresOwnerPlayerDepositEligibility({
      query: async () => ({
        rows: [
          {
            decided_at: new Date(),
            decision: 'eligible',
            decision_id: decisionId,
            decision_version: 1,
            player_account_id: playerAccountId,
            player_id: '28379330',
            player_status: 'active',
            platform_code: 'kemerbet',
            reason_code: 'financial_eligibility_revoked',
            validation_status: 'valid',
          },
        ],
      }),
    });

    await expect(eligibility.list(authUserId)).rejects.toBeInstanceOf(
      OwnerPlayerDepositEligibilityUnavailableError,
    );
  });

  it('redacts PostgreSQL failures into fixed operation errors', async () => {
    const rejected = new PostgresOwnerPlayerDepositEligibility({
      query: async () => Promise.reject({ code: 'P0001', detail: 'sensitive' }),
    });
    const unavailable = new PostgresOwnerPlayerDepositEligibility({
      query: async () => Promise.reject({ code: '08006', detail: 'sensitive' }),
    });

    await expect(rejected.list(authUserId)).rejects.toBeInstanceOf(
      OwnerPlayerDepositEligibilityRejectedError,
    );
    await expect(unavailable.list(authUserId)).rejects.toBeInstanceOf(
      OwnerPlayerDepositEligibilityUnavailableError,
    );
  });
});
