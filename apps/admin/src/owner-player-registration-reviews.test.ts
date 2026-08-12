import { describe, expect, it } from 'vitest';

import {
  OwnerPlayerRegistrationReviewRejectedError,
  OwnerPlayerRegistrationReviewUnavailableError,
  PostgresOwnerPlayerRegistrationReviews,
} from './owner-player-registration-reviews.js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';

describe('PostgreSQL Owner Player-ID review adapter', () => {
  it('lists only a bounded, well-shaped non-claiming KemerBet review queue', async () => {
    let observedSql = '';
    let observedValues: readonly (number | string)[] = [];
    const adapter = new PostgresOwnerPlayerRegistrationReviews({
      query: async (sql, values) => {
        observedSql = sql;
        observedValues = values;
        return {
          rows: [
            {
              platform_code: 'kemerbet',
              registration_request_id: requestId,
              request_created_at: new Date('2026-08-11T12:00:00.000Z'),
              request_status: 'pending_validation',
              request_updated_at: new Date('2026-08-11T12:00:00.000Z'),
              submitted_player_id: 'STAGING-TEST-20260811-01',
            },
          ],
        };
      },
    });

    await expect(adapter.list(authUserId, 20)).resolves.toEqual([
      {
        createdAt: '2026-08-11T12:00:00.000Z',
        playerId: 'STAGING-TEST-20260811-01',
        platformCode: 'kemerbet',
        requestId,
        status: 'pending_validation',
        updatedAt: '2026-08-11T12:00:00.000Z',
      },
    ]);
    expect(observedSql).toContain('app.list_owner_player_registration_requests');
    expect(observedValues).toEqual([authUserId, 20]);
  });

  it('maps each decision to its fixed safe reason without accepting free text', async () => {
    let observedValues: readonly (number | string)[] = [];
    const reviewedAt = new Date('2026-08-11T12:05:00.000Z');
    const adapter = new PostgresOwnerPlayerRegistrationReviews({
      query: async (_sql, values) => {
        observedValues = values;
        return {
          rows: [
            {
              decision_already_recorded: false,
              reviewed_at: reviewedAt,
              reviewed_registration_request_id: requestId,
              reviewed_status: 'exists',
            },
          ],
        };
      },
    });

    await expect(adapter.review(authUserId, requestId, 'exists')).resolves.toEqual({
      alreadyRecorded: false,
      requestId,
      reviewedAt: reviewedAt.toISOString(),
      status: 'exists',
    });
    expect(observedValues).toEqual([authUserId, requestId, 'exists', 'owner_platform_lookup']);
  });

  it('rejects malformed rows and maps database detail to generic errors', async () => {
    const malformed = new PostgresOwnerPlayerRegistrationReviews({
      query: async () => ({ rows: [{ submitted_player_id: 'raw only' }] }),
    });
    await expect(malformed.list(authUserId)).rejects.toBeInstanceOf(
      OwnerPlayerRegistrationReviewUnavailableError,
    );

    const rejected = new PostgresOwnerPlayerRegistrationReviews({
      query: async () => {
        throw Object.assign(new Error('sensitive database detail'), { code: 'P0001' });
      },
    });
    await expect(rejected.review(authUserId, requestId, 'not_found')).rejects.toBeInstanceOf(
      OwnerPlayerRegistrationReviewRejectedError,
    );
  });

  it('lists and records only the fixed explicit ownership association', async () => {
    const associatedAt = new Date('2026-08-11T12:15:00.000Z');
    const playerAccountId = '33333333-3333-4333-8333-333333333333';
    const calls: (readonly (number | string)[])[] = [];
    const adapter = new PostgresOwnerPlayerRegistrationReviews({
      query: async (sql, values) => {
        calls.push(values);
        return sql.includes('list_owner_player_registration_association_candidates')
          ? {
              rows: [
                {
                  platform_code: 'kemerbet',
                  registration_request_id: requestId,
                  reviewed_at: new Date('2026-08-11T12:10:00.000Z'),
                  submitted_player_id: '28379330',
                },
              ],
            }
          : {
              rows: [
                {
                  associated_at: associatedAt,
                  associated_player_account_id: playerAccountId,
                  associated_registration_request_id: requestId,
                  association_already_recorded: false,
                },
              ],
            };
      },
    });
    await expect(adapter.listAssociationCandidates(authUserId)).resolves.toEqual([
      {
        playerId: '28379330',
        platformCode: 'kemerbet',
        requestId,
        reviewedAt: '2026-08-11T12:10:00.000Z',
      },
    ]);
    await expect(adapter.associate(authUserId, requestId)).resolves.toEqual({
      alreadyRecorded: false,
      associatedAt: associatedAt.toISOString(),
      playerAccountId,
      requestId,
    });
    expect(calls[1]).toEqual([authUserId, requestId, 'owner_verified_platform_ownership']);
  });
});
