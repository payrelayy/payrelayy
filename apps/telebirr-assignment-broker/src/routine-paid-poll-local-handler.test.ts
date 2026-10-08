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
    loadObservation: vi.fn(async () => ({
      enrollmentId,
      trustedLookup: {},
      trustedRawReference: 'REDACTEDREFERENCE',
      trustedSigner: {},
      deviceEnrollment: {},
      trustedSignerSpkiDer: Buffer.alloc(91, 1),
      trustedIssuanceMode: 'paid' as const,
    })),
    stageObservation: vi.fn(async () => 'recorded' as const),
  };
}

describe('private routine paid poll local handler', () => {
  it('exposes enrollment, paid assignment, and a paid observation snapshot', async () => {
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
    const observation = await handler(request('load_observation', { challengeId: requestId }));
    expect(observation.statusCode).toBe(200);
    const observed = JSON.parse(Buffer.from(observation.body).toString('utf8'));
    expect(observed.kind).toBe('observation_context');
    expect(observed.context.trustedIssuanceMode).toBe('paid');
    const staged = await handler(
      request('stage_observation', {
        evidence: {
          providerCode: 'telebirr',
          candidateId: enrollmentId,
          challengeId: requestId,
          referenceFingerprint: 'a'.repeat(64),
          receiverRevisionId: enrollmentId,
          receiverVersion: 1,
          submittedAt: '2026-10-08T12:00:00.000Z',
          observedAt: '2026-10-08T12:01:00.000Z',
          occurredAt: '2026-10-08T12:00:00.000Z',
          retrievedAt: '2026-10-08T12:01:00.000Z',
          amountMinor: 2500,
          currencyCode: 'ETB',
          sourceDocumentDigest: digest,
          observationBodyDigest: digest,
          replayIdentity: digest,
        },
        assignmentBodyDigest: digest,
        observationSignatureDigest: digest,
        signedObservation: {
          contractVersion: 1,
          providerCode: 'telebirr',
          protocolMode: 'routine_signed_observation_v1',
          transcriptVersion: 1,
          bodyDigestAlgorithm: 'sha256',
          bodyDigest: digest,
          signatureAlgorithm: 'ecdsa-p256-sha256',
          signatureEncoding: 'ieee-p1363-base64url',
          body: {},
          signature: 'A'.repeat(86),
        },
      }),
    );
    expect(staged.statusCode).toBe(200);
    expect(JSON.parse(Buffer.from(staged.body).toString('utf8'))).toEqual({ kind: 'recorded' });
    expect(fake.stageObservation).toHaveBeenCalledOnce();
  });

  it('rejects no-money media and malformed operations before broker access', async () => {
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
    expect((await handler(request('load_observation', { challengeId: 'bad' }))).statusCode).toBe(
      400,
    );
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
    expect(fake.loadObservation).not.toHaveBeenCalled();
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
