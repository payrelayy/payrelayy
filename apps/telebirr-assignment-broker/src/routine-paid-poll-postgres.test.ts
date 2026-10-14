import { describe, expect, it, vi } from 'vitest';

import {
  RoutinePaidPollSqlUnavailableError,
  createRoutinePaidPollPostgresDatabase,
} from './routine-paid-poll-postgres.js';

const challengeId = '22222222-2222-4222-8222-222222222222';
const challengeDigest = `sha256:${'a'.repeat(64)}`;
const devicePublicKeySpkiSha256 = `sha256:${'b'.repeat(64)}`;
const input = { challengeId, challengeDigest, devicePublicKeySpkiSha256 };

describe('private routine paid SQL terminal check', () => {
  it('binds all challenge and device values as positional parameters', async () => {
    const query = vi.fn(async () => ({ rows: [{ terminal: true }] }));
    const database = createRoutinePaidPollPostgresDatabase({ query });
    expect(await database.classifyTerminal(input)).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'select app.classify_routine_telebirr_paid_upload_terminal($1::uuid,$2::text,$3::text) as terminal',
      [challengeId, challengeDigest, devicePublicKeySpkiSha256],
    );
  });

  it('fails closed on malformed, missing, multirow, or failed SQL results', async () => {
    for (const rows of [
      [],
      [{ terminal: 'true' }],
      [{ terminal: true, extra: true }],
      [{ terminal: false }, { terminal: true }],
      [Object.defineProperty({}, 'terminal', { enumerable: true, get: () => true })],
    ]) {
      const database = createRoutinePaidPollPostgresDatabase({
        query: async () => ({ rows }),
      });
      await expect(database.classifyTerminal(input)).rejects.toBeInstanceOf(
        RoutinePaidPollSqlUnavailableError,
      );
    }
    const failed = createRoutinePaidPollPostgresDatabase({
      query: async () => {
        throw new Error('private database detail');
      },
    });
    await expect(failed.classifyTerminal(input)).rejects.toBeInstanceOf(
      RoutinePaidPollSqlUnavailableError,
    );
  });
});

describe('signed wrong-receiver result', () => {
  it('uses only the narrow parameterized function and accepts an exact status', async () => {
    const query = vi.fn(async () => ({ rows: [{ status: 'recorded' }] }));
    const database = createRoutinePaidPollPostgresDatabase({ query });
    const signedObservation = { bodyDigest: challengeDigest };
    expect(await database.recordTerminalRejection({ challengeId, signedObservation })).toBe(
      'recorded',
    );
    expect(query).toHaveBeenCalledWith(
      'select app.record_routine_telebirr_paid_terminal_result($1::uuid,$2::jsonb) as status',
      [challengeId, JSON.stringify(signedObservation)],
    );
  });

  it('fails closed on missing or unexpected SQL shape', async () => {
    for (const rows of [[], [{ status: 'recorded', extra: true }], [{ result: 'recorded' }]]) {
      const database = createRoutinePaidPollPostgresDatabase({ query: async () => ({ rows }) });
      await expect(
        database.recordTerminalRejection({ challengeId, signedObservation: {} }),
      ).rejects.toBeInstanceOf(RoutinePaidPollSqlUnavailableError);
    }
  });
});
