import { describe, expect, it } from 'vitest';

import {
  OwnerRoutineTelebirrReceiverReviewRejectedError,
  OwnerRoutineTelebirrReceiverReviewUnavailableError,
  PostgresOwnerRoutineTelebirrReceiverReviews,
} from './owner-routine-telebirr-receiver-reviews.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const caseId = '22222222-2222-4222-8222-222222222222';
const row = {
  case_id: caseId,
  player_id: '28379330',
  reference_masked: '***AB12',
  instructed_receiver_masked: '***7494',
  candidate_receiver_masked: '***7002',
  submitted_at: new Date('2026-10-15T12:01:00Z'),
  recorded_at: new Date('2026-10-15T12:01:01Z'),
  reason_code: 'receiver_changed_during_instruction',
};

describe('Owner TeleBirr receiver-change review projection', () => {
  it('calls only the bounded private read RPC and returns masked case fields', async () => {
    const projection = new PostgresOwnerRoutineTelebirrReceiverReviews({
      async query(sql, values) {
        expect(sql).toContain('app.list_owner_routine_telebirr_receiver_change_reviews');
        expect(sql).not.toMatch(/ciphertext|fingerprint|private_chat_id/iu);
        expect(values).toEqual([ownerId, 20, null]);
        return { rows: [row] };
      },
    });
    const reviews = await projection.list(ownerId, 20);
    expect(reviews).toEqual([
      {
        caseId,
        playerId: '28379330',
        referenceMasked: '***AB12',
        instructedReceiverMasked: '***7494',
        candidateReceiverMasked: '***7002',
        submittedAt: '2026-10-15T12:01:00.000Z',
        recordedAt: '2026-10-15T12:01:01.000Z',
        reasonCode: 'receiver_changed_during_instruction',
      },
    ]);
    expect(JSON.stringify(reviews)).not.toContain('telegram');
  });

  it('rejects invalid requests and fails closed on malformed rows', async () => {
    const projection = new PostgresOwnerRoutineTelebirrReceiverReviews({
      async query() {
        return { rows: [{ ...row, reference_masked: 'RAWREFERENCE' }] };
      },
    });
    await expect(projection.list('invalid')).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrReceiverReviewRejectedError,
    );
    await expect(projection.list(ownerId, 51)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrReceiverReviewRejectedError,
    );
    await expect(projection.list(ownerId, 25, 'bad-cursor')).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrReceiverReviewRejectedError,
    );
    await expect(projection.list(ownerId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrReceiverReviewUnavailableError,
    );
  });

  it('uses an opaque case ID as the next-page cursor', async () => {
    const projection = new PostgresOwnerRoutineTelebirrReceiverReviews({
      async query(_sql, values) {
        expect(values).toEqual([ownerId, 25, caseId]);
        return { rows: [] };
      },
    });
    await expect(projection.list(ownerId, 25, caseId)).resolves.toEqual([]);
  });

  it('distinguishes a denied Owner from a database outage', async () => {
    const denied = new PostgresOwnerRoutineTelebirrReceiverReviews({
      async query() {
        throw Object.assign(new Error('denied'), { code: 'P0001' });
      },
    });
    await expect(denied.list(ownerId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrReceiverReviewRejectedError,
    );
    const unavailable = new PostgresOwnerRoutineTelebirrReceiverReviews({
      async query() {
        throw new Error('offline');
      },
    });
    await expect(unavailable.list(ownerId)).rejects.toBeInstanceOf(
      OwnerRoutineTelebirrReceiverReviewUnavailableError,
    );
  });
});
