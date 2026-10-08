import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE,
  ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE,
  ROUTINE_PAID_POLL_LOCAL_PATH,
} from '@fetanagent/telebirr-verification-foundation';

import { createRoutinePaidPollLocalHandler } from './routine-paid-poll-local-handler.js';
import type { createRoutinePaidPollBroker } from './routine-paid-poll-broker.js';

const enrollmentId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const digest = `sha256:${'a'.repeat(64)}`;

function request(
  operation: string,
  input: unknown,
  contentType: string = ROUTINE_PAID_POLL_LOCAL_CONTENT_TYPE,
) {
  const body = Buffer.from(JSON.stringify({ operation, input }));
  return {
    method: 'POST',
    path: ROUTINE_PAID_POLL_LOCAL_PATH,
    headers: [
      ['content-length', String(body.byteLength)],
      ['content-type', contentType],
    ] as const,
    body,
  };
}

function fakeBroker() {
  return {
    loadEnrollment: vi.fn(async () => ({ enrollment: { enrollmentId } })),
    claimAndIssuePoll: vi.fn(async () => ({
      kind: 'assignment' as const,
      context: {
        enrollmentId,
        trustedLookup: {},
        trustedRawReference: 'REDACTEDREFERENCE',
        trustedSigner: {},
        deviceEnrollment: {},
        trustedSignerSpkiDer: Buffer.alloc(91, 1),
        signedAssignment: {},
      },
    })),
  };
}

describe('private routine paid poll local handler', () => {
  it('exposes only enrollment lookup and atomic paid poll assignment', async () => {
    const fake = fakeBroker();
    const handler = createRoutinePaidPollLocalHandler(
      fake as unknown as ReturnType<typeof createRoutinePaidPollBroker>,
    );
    const loaded = await handler(request('load_enrollment', { enrollmentId }));
    expect(loaded.statusCode).toBe(200);
    expect(JSON.parse(Buffer.from(loaded.body).toString('utf8'))).toEqual({
      kind: 'enrollment',
      enrollment: { enrollmentId },
    });
    const assigned = await handler(
      request('claim_and_issue_poll', {
        enrollmentId,
        requestId,
        replayIdentity: digest,
        requestExpiresAt: '2026-10-08T13:00:00.000Z',
      }),
    );
    expect(assigned.statusCode).toBe(200);
    const value = JSON.parse(Buffer.from(assigned.body).toString('utf8'));
    expect(value.kind).toBe('assignment');
    expect(value.context.trustedSignerSpkiDer).toBe(Buffer.alloc(91, 1).toString('base64url'));
    expect(fake.claimAndIssuePoll).toHaveBeenCalledOnce();
  });

  it('rejects no-money media, observation operations, and malformed input before broker access', async () => {
    const fake = fakeBroker();
    const handler = createRoutinePaidPollLocalHandler(
      fake as unknown as ReturnType<typeof createRoutinePaidPollBroker>,
    );
    expect(
      (
        await handler(
          request('load_enrollment', { enrollmentId }, ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await handler(request('load_observation', { challengeId: requestId }))).statusCode,
    ).toBe(400);
    expect(
      (
        await handler(
          request('claim_and_issue_poll', {
            enrollmentId,
            requestId,
            replayIdentity: 'bad',
            requestExpiresAt: '2026-10-08T13:00:00.000Z',
          }),
        )
      ).statusCode,
    ).toBe(400);
    expect(fake.loadEnrollment).not.toHaveBeenCalled();
    expect(fake.claimAndIssuePoll).not.toHaveBeenCalled();
  });

  it('fails closed with no private error detail', async () => {
    const fake = fakeBroker();
    fake.loadEnrollment.mockRejectedValueOnce(new Error('private-value'));
    const handler = createRoutinePaidPollLocalHandler(
      fake as unknown as ReturnType<typeof createRoutinePaidPollBroker>,
    );
    const result = await handler(request('load_enrollment', { enrollmentId }));
    expect(result.statusCode).toBe(503);
    expect(Buffer.from(result.body).toString('utf8')).toBe('{"code":"temporarily_unavailable"}');
  });
});
