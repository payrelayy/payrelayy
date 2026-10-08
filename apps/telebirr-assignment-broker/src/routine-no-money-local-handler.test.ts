import { describe, expect, it, vi } from 'vitest';

import {
  ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE,
  ROUTINE_NO_MONEY_LOCAL_PATH,
} from '@fetanagent/telebirr-verification-foundation';

import { createRoutineNoMoneyLocalHandler } from './routine-no-money-local-handler.js';
import type { createRoutineNoMoneyBroker } from './routine-no-money-broker.js';

const enrollmentId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const challengeId = '33333333-3333-4333-8333-333333333333';
const digest = `sha256:${'a'.repeat(64)}`;
const expiresAt = '2026-10-08T13:00:00.000Z';
const context = {
  enrollmentId,
  trustedLookup: {},
  trustedRawReference: 'REDACTEDREFERENCE',
  trustedSigner: {},
  deviceEnrollment: {},
  trustedSignerSpkiDer: Buffer.alloc(91, 1),
  signedAssignment: {},
};

function broker() {
  return {
    loadEnrollment: vi.fn(async () => ({ enrollment: { enrollmentId } })),
    claimAndIssuePoll: vi.fn(async () => ({ kind: 'assignment' as const, context })),
    loadObservation: vi.fn(async () => context),
    stageObservationDigest: vi.fn(async () => 'recorded' as const),
  };
}

function request(
  operation: string,
  input: unknown,
  contentType: string = ROUTINE_NO_MONEY_LOCAL_CONTENT_TYPE,
) {
  const body = Buffer.from(JSON.stringify({ operation, input }), 'utf8');
  return {
    method: 'POST',
    path: ROUTINE_NO_MONEY_LOCAL_PATH,
    headers: [
      ['content-length', String(body.byteLength)],
      ['content-type', contentType],
    ] as const,
    body,
  };
}

describe('private routine no-money local handler', () => {
  it('returns an enrollment without taking a caller-provided public-key hint', async () => {
    const fake = broker();
    const handler = createRoutineNoMoneyLocalHandler(
      fake as unknown as ReturnType<typeof createRoutineNoMoneyBroker>,
    );
    const result = await handler(request('load_enrollment', { enrollmentId }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(Buffer.from(result.body).toString('utf8'))).toEqual({
      kind: 'enrollment',
      enrollment: { enrollmentId },
    });
    expect(fake.loadEnrollment).toHaveBeenCalledWith(enrollmentId);
  });

  it('issues only a private, bounded assignment and encodes the public key as DER base64url', async () => {
    const fake = broker();
    const handler = createRoutineNoMoneyLocalHandler(
      fake as unknown as ReturnType<typeof createRoutineNoMoneyBroker>,
    );
    const result = await handler(
      request('claim_and_issue_poll', {
        enrollmentId,
        requestId,
        replayIdentity: digest,
        requestExpiresAt: expiresAt,
      }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(Buffer.from(result.body).toString('utf8'));
    expect(body.kind).toBe('assignment');
    expect(body.context.trustedSignerSpkiDer).toBe(Buffer.alloc(91, 1).toString('base64url'));
    expect(fake.claimAndIssuePoll).toHaveBeenCalledOnce();
  });

  it('loads one challenge and stages digest-only evidence', async () => {
    const fake = broker();
    const handler = createRoutineNoMoneyLocalHandler(
      fake as unknown as ReturnType<typeof createRoutineNoMoneyBroker>,
    );
    const loaded = await handler(request('load_observation', { challengeId }));
    expect(loaded.statusCode).toBe(200);
    const staged = await handler(
      request('stage_observation_digest', {
        challengeId,
        assignmentBodyDigest: digest,
        observationBodyDigest: digest,
        observationSignatureDigest: digest,
        replayIdentity: digest,
        signedObservation: {
          contractVersion: 1,
          providerCode: 'telebirr',
          protocolMode: 'routine_signed_observation_v1',
          transcriptVersion: 'telebirr-routine-observation-transcript-v1',
          bodyDigestAlgorithm: 'sha256',
          bodyDigest: digest,
          signatureAlgorithm: 'ecdsa-p256-sha256',
          signatureEncoding: 'ieee-p1363-base64url',
          body: { challengeId },
          signature: 'A'.repeat(86),
        },
        serverPolicyResult: 'signed_evidence_matches_policy',
      }),
    );
    expect(staged.statusCode).toBe(200);
    expect(JSON.parse(Buffer.from(staged.body).toString('utf8'))).toEqual({ kind: 'recorded' });
    expect(fake.stageObservationDigest).toHaveBeenCalledOnce();
  });

  it('rejects malformed media type and input before broker access', async () => {
    const fake = broker();
    const handler = createRoutineNoMoneyLocalHandler(
      fake as unknown as ReturnType<typeof createRoutineNoMoneyBroker>,
    );
    expect(
      (await handler(request('load_enrollment', { enrollmentId }, 'application/json'))).statusCode,
    ).toBe(400);
    expect(
      (await handler(request('load_enrollment', { enrollmentId: 'not-a-uuid' }))).statusCode,
    ).toBe(400);
    expect(fake.loadEnrollment).not.toHaveBeenCalled();
  });

  it('fails closed on protected broker failure', async () => {
    const fake = broker();
    fake.loadEnrollment.mockRejectedValueOnce(new Error('sensitive failure'));
    const handler = createRoutineNoMoneyLocalHandler(
      fake as unknown as ReturnType<typeof createRoutineNoMoneyBroker>,
    );
    const result = await handler(request('load_enrollment', { enrollmentId }));
    expect(result.statusCode).toBe(503);
    expect(Buffer.from(result.body).toString('utf8')).toBe('{"code":"temporarily_unavailable"}');
  });
});
