import { describe, expect, it, vi } from 'vitest';

import { createRoutineNoMoneyLocalAdapter } from './local-routine-no-money-broker-client.js';

const enrollmentId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const challengeId = '33333333-3333-4333-8333-333333333333';
const digest = `sha256:${'a'.repeat(64)}`;
const signedObservation = { bodyDigest: digest, body: { challengeId } };

describe('private routine no-money broker client', () => {
  it('maps the four operations without disclosing a database or signing key to the bridge', async () => {
    const der = Buffer.alloc(91, 3);
    const wire = vi.fn(async (operation: string) => {
      switch (operation) {
        case 'load_enrollment':
          return { kind: 'enrollment', enrollment: { enrollmentId } };
        case 'claim_and_issue_poll':
          return {
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
          };
        case 'load_observation':
          return {
            kind: 'observation',
            context: {
              enrollmentId,
              trustedLookup: {},
              trustedRawReference: 'REDACTEDREFERENCE',
              trustedSigner: {},
              deviceEnrollment: {},
              trustedSignerSpkiDer: der.toString('base64url'),
            },
          };
        default:
          return { kind: 'recorded' };
      }
    });
    const dependencies = createRoutineNoMoneyLocalAdapter(wire, () => '2026-10-08T12:00:00.000Z');
    expect(await dependencies.loadEnrollment(enrollmentId)).toEqual({
      enrollment: { enrollmentId },
    });
    const issued = await dependencies.claimAndIssuePoll({
      enrollmentId,
      requestId,
      replayIdentity: digest,
      requestExpiresAt: '2026-10-08T12:05:00.000Z',
    });
    expect(issued.kind).toBe('assignment');
    if (issued.kind === 'assignment') expect(issued.context.trustedSignerSpkiDer).toEqual(der);
    expect((await dependencies.loadObservation(challengeId))?.trustedSignerSpkiDer).toEqual(der);
    expect(
      await dependencies.stageObservationDigest({
        challengeId,
        assignmentBodyDigest: digest,
        observationBodyDigest: digest,
        observationSignatureDigest: digest,
        replayIdentity: digest,
        signedObservation,
        serverPolicyResult: 'signed_evidence_matches_policy',
      }),
    ).toBe('recorded');
    expect(wire.mock.calls.map(([operation]) => operation)).toEqual([
      'load_enrollment',
      'claim_and_issue_poll',
      'load_observation',
      'stage_observation_digest',
    ]);
  });

  it('rejects malformed key material and unexpected broker outcomes', async () => {
    const malformed = createRoutineNoMoneyLocalAdapter(
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
        requestExpiresAt: '2026-10-08T12:05:00.000Z',
      }),
    ).rejects.toThrow();
    const unexpected = createRoutineNoMoneyLocalAdapter(
      async () => ({ kind: 'paid' }),
      () => '2026-10-08T12:00:00.000Z',
    );
    await expect(
      unexpected.stageObservationDigest({
        challengeId,
        assignmentBodyDigest: digest,
        observationBodyDigest: digest,
        observationSignatureDigest: digest,
        replayIdentity: digest,
        signedObservation,
        serverPolicyResult: 'signed_evidence_matches_policy',
      }),
    ).rejects.toThrow();
  });
});
