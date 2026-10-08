import { describe, expect, it, vi } from 'vitest';

import {
  RoutineNoMoneySqlUnavailableError,
  createRoutineNoMoneyPostgresDatabase,
} from './routine-no-money-postgres.js';

const id = '44444444-4444-4444-8444-444444444444';
const digest = `sha256:${'a'.repeat(64)}`;
const signedObservation = { bodyDigest: digest, body: { challengeId: id } };

describe('private routine no-money SQL adapter', () => {
  it('calls only the four allowlisted functions with positional parameters', async () => {
    const query = vi.fn(async (text: string, _values: unknown[]) => ({
      rows: text.includes('stage_routine_telebirr') ? [{ status: 'recorded' }] : [{ value: 1 }],
    }));
    const database = createRoutineNoMoneyPostgresDatabase({ query });
    await database.loadEnrollment(id);
    await database.issuePollAssignment({
      enrollmentId: id,
      requestId: id,
      replayIdentity: digest,
      requestExpiresAt: '2026-10-06T13:03:30.000Z',
      signerId: id,
    });
    await database.loadObservationMaterial(id);
    expect(
      await database.stageObservationDigest({
        challengeId: id,
        assignmentBodyDigest: digest,
        observationBodyDigest: digest,
        observationSignatureDigest: digest,
        replayIdentity: digest,
        signedObservation,
        serverPolicyResult: 'signed_evidence_matches_policy',
      }),
    ).toBe('recorded');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'select * from app.load_routine_telebirr_no_money_enrollment($1::uuid)',
      'select * from app.issue_routine_telebirr_no_money_poll_assignment($1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::uuid)',
      'select * from app.load_routine_telebirr_no_money_observation_material($1::uuid)',
      'select app.stage_routine_telebirr_no_money_signed_observation($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::jsonb,$7::text) as status',
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([id, id, digest, '2026-10-06T13:03:30.000Z', id]);
  });

  it('fails closed on a multirow return, malformed status, or SQL error', async () => {
    const multi = createRoutineNoMoneyPostgresDatabase({
      query: async () => ({ rows: [{}, {}] }),
    });
    await expect(multi.loadEnrollment(id)).rejects.toBeInstanceOf(
      RoutineNoMoneySqlUnavailableError,
    );
    const malformed = createRoutineNoMoneyPostgresDatabase({
      query: async () => ({ rows: [{ status: 'recorded', payment: true }] }),
    });
    await expect(
      malformed.stageObservationDigest({
        challengeId: id,
        assignmentBodyDigest: digest,
        observationBodyDigest: digest,
        observationSignatureDigest: digest,
        replayIdentity: digest,
        signedObservation,
        serverPolicyResult: 'signed_evidence_matches_policy',
      }),
    ).rejects.toBeInstanceOf(RoutineNoMoneySqlUnavailableError);
    const accessor = createRoutineNoMoneyPostgresDatabase({
      query: async () => ({
        rows: [Object.defineProperty({}, 'status', { enumerable: true, get: () => 'recorded' })],
      }),
    });
    await expect(
      accessor.stageObservationDigest({
        challengeId: id,
        assignmentBodyDigest: digest,
        observationBodyDigest: digest,
        observationSignatureDigest: digest,
        replayIdentity: digest,
        signedObservation,
        serverPolicyResult: 'signed_evidence_matches_policy',
      }),
    ).rejects.toBeInstanceOf(RoutineNoMoneySqlUnavailableError);
    const failed = createRoutineNoMoneyPostgresDatabase({
      query: async () => {
        throw new Error('database connection detail');
      },
    });
    await expect(failed.loadObservationMaterial(id)).rejects.toBeInstanceOf(
      RoutineNoMoneySqlUnavailableError,
    );
  });
});
