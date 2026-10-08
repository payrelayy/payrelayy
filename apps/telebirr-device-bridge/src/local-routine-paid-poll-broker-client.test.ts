import { describe, expect, it, vi } from 'vitest';

import {
  createRoutinePaidPollLocalAdapter,
  createRoutinePaidUploadLocalAdapter,
} from './local-routine-paid-poll-broker-client.js';

const enrollmentId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const digest = `sha256:${'a'.repeat(64)}`;

describe('private routine paid poll broker client', () => {
  it('maps only the two paid poll operations', async () => {
    const der = Buffer.alloc(91, 3);
    const wire = vi.fn(async (operation: string) =>
      operation === 'load_enrollment'
        ? { kind: 'enrollment', enrollment: { enrollmentId } }
        : {
            kind: 'assignment',
            context: {
              enrollmentId,
              trustedLookup: {},
              trustedRawReference: 'REDACTEDREFERENCE',
              trustedSigner: {},
              deviceEnrollment: {},
              trustedSignerSpkiDer: der.toString('base64url'),
              signedAssignment: {},
            },
          },
    );
    const adapter = createRoutinePaidPollLocalAdapter(wire, () => '2026-10-08T12:00:00.000Z');
    expect(await adapter.loadEnrollment(enrollmentId)).toEqual({ enrollment: { enrollmentId } });
    const result = await adapter.claimAndIssuePoll({
      enrollmentId,
      requestId,
      replayIdentity: digest,
      requestExpiresAt: '2026-10-08T12:01:00.000Z',
    });
    expect(result.kind).toBe('assignment');
    if (result.kind === 'assignment') expect(result.context.trustedSignerSpkiDer).toEqual(der);
    expect(wire.mock.calls.map(([operation]) => operation)).toEqual([
      'load_enrollment',
      'claim_and_issue_poll',
    ]);
  });

  it('rejects an unrecognized result or malformed signer key', async () => {
    const unrecognized = createRoutinePaidPollLocalAdapter(
      async () => ({ kind: 'paid' }),
      () => '2026-10-08T12:00:00.000Z',
    );
    await expect(unrecognized.loadEnrollment(enrollmentId)).rejects.toThrow();
    const malformed = createRoutinePaidPollLocalAdapter(
      async () => ({
        kind: 'assignment',
        context: {
          enrollmentId,
          trustedLookup: {},
          trustedRawReference: 'REDACTEDREFERENCE',
          trustedSigner: {},
          deviceEnrollment: {},
          trustedSignerSpkiDer: 'not-a-key',
          signedAssignment: {},
        },
      }),
      () => '2026-10-08T12:00:00.000Z',
    );
    await expect(
      malformed.claimAndIssuePoll({
        enrollmentId,
        requestId,
        replayIdentity: digest,
        requestExpiresAt: '2026-10-08T12:01:00.000Z',
      }),
    ).rejects.toThrow();
  });
});

describe('private routine paid upload broker client', () => {
  it('loads only a paid context and stages the verified evidence', async () => {
    const der = Buffer.alloc(91, 3);
    const wire = vi.fn(async (operation: string) =>
      operation === 'load_observation'
        ? {
            kind: 'observation_context',
            context: {
              enrollmentId,
              trustedLookup: {},
              trustedRawReference: 'REDACTEDREFERENCE',
              trustedSigner: {},
              deviceEnrollment: {},
              trustedSignerSpkiDer: der.toString('base64url'),
              trustedIssuanceMode: 'paid',
            },
          }
        : { kind: 'recorded' },
    );
    const adapter = createRoutinePaidUploadLocalAdapter(wire, () => '2026-10-08T12:00:00.000Z');
    expect((await adapter.loadObservation(requestId))?.trustedSignerSpkiDer).toEqual(der);
    expect(
      await adapter.stageObservation({
        evidence: {
          providerCode: 'telebirr',
          candidateId: enrollmentId,
          challengeId: requestId,
          referenceFingerprint: 'b'.repeat(64),
          receiverRevisionId: enrollmentId,
          receiverVersion: 1,
          submittedAt: '2026-10-08T11:59:00.000Z',
          observedAt: '2026-10-08T12:00:00.000Z',
          occurredAt: '2026-10-08T11:59:00.000Z',
          retrievedAt: '2026-10-08T12:00:00.000Z',
          amountMinor: 2500,
          currencyCode: 'ETB',
          sourceDocumentDigest: digest,
          observationBodyDigest: digest,
          replayIdentity: digest,
        },
        assignmentBodyDigest: digest,
        observationSignatureDigest: digest,
        signedObservation: {},
      }),
    ).toBe('recorded');
    expect(wire.mock.calls.map(([operation]) => operation)).toEqual([
      'load_observation',
      'stage_observation',
    ]);
  });

  it('rejects an unauthenticated no-money context', async () => {
    const adapter = createRoutinePaidUploadLocalAdapter(
      async () => ({
        kind: 'observation_context',
        context: {
          enrollmentId,
          trustedLookup: {},
          trustedRawReference: 'REDACTEDREFERENCE',
          trustedSigner: {},
          deviceEnrollment: {},
          trustedSignerSpkiDer: Buffer.alloc(91, 3).toString('base64url'),
          trustedIssuanceMode: 'no_money',
        },
      }),
      () => '2026-10-08T12:00:00.000Z',
    );
    await expect(adapter.loadObservation(requestId)).rejects.toThrow();
  });
});
