import { describe, expect, it, vi } from 'vitest';

import type { TrustedTelebirrVerifierWorkSource } from './postgres-trusted-telebirr-verifier.js';
import type {
  TrustedTelebirrVerificationRequest,
  TrustedTelebirrVerifier,
} from './trusted-telebirr-verifier.js';
import {
  createTrustedTelebirrVerifierWorker,
  TrustedTelebirrVerifierWorkerUnavailableError,
} from './trusted-telebirr-verifier-worker.js';

const request = {
  contractVersion: 1,
  verificationAttemptId: '11111111-1111-4111-8111-111111111111',
  leaseToken: '22222222-2222-4222-8222-222222222222',
  completionRequestKey: '33333333-3333-4333-8333-333333333333',
  signedAssignment: {},
  signedObservation: { bodyDigest: `sha256:${'1'.repeat(64)}` },
} as unknown as TrustedTelebirrVerificationRequest;

function source(loadNext: TrustedTelebirrVerifierWorkSource['loadNext']) {
  return {
    loadNext: vi.fn(loadNext),
    quarantineInvalid: vi.fn(async () => undefined),
  } satisfies TrustedTelebirrVerifierWorkSource;
}

describe('trusted TeleBirr verifier staged-evidence worker', () => {
  it('waits without work and stops an active pause promptly', async () => {
    const work = source(async () => null);
    const verifier: TrustedTelebirrVerifier = { verifyAndComplete: vi.fn() };
    const worker = createTrustedTelebirrVerifierWorker({
      source: work,
      verifier,
      pollIntervalMilliseconds: 10_000,
    });

    const running = worker.run();
    await vi.waitFor(() => expect(work.loadNext).toHaveBeenCalledOnce());
    await expect(worker.stop()).resolves.toBeUndefined();
    await expect(running).resolves.toBeUndefined();
    expect(verifier.verifyAndComplete).not.toHaveBeenCalled();
  });

  it('completes staged evidence and exposes only the fixed redacted result', async () => {
    let calls = 0;
    const work = source(async () => (calls++ === 0 ? request : null));
    const verifier: TrustedTelebirrVerifier = {
      verifyAndComplete: vi.fn(
        async () =>
          ({
            status: 'settled',
            verificationOutcomeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            depositIntentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            depositPaymentClaimId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            executionJobId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            alreadyCompleted: false,
          }) as const,
      ),
    };
    const onResult = vi.fn();
    const worker = createTrustedTelebirrVerifierWorker({
      source: work,
      verifier,
      onResult,
      pollIntervalMilliseconds: 10,
    });

    const running = worker.run();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    await worker.stop();
    await running;

    expect(work.quarantineInvalid).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith({
      verifierVersion: 'trusted-telebirr-verifier-v1',
      status: 'settled',
      disposition: 'settlement_candidate',
      reasonCode: 'exact_proof_match',
      alreadyCompleted: false,
    });
    expect(JSON.stringify(onResult.mock.calls)).not.toContain('aaaaaaaa');
  });

  it('quarantines authenticated-ingress evidence that fails trusted verification', async () => {
    let calls = 0;
    const work = source(async () => (calls++ === 0 ? request : null));
    const verifier: TrustedTelebirrVerifier = {
      verifyAndComplete: vi.fn(
        async () =>
          ({
            status: 'not_settled',
            disposition: 'invalid',
            reasonCode: 'trusted_evidence_invalid',
          }) as const,
      ),
    };
    const worker = createTrustedTelebirrVerifierWorker({
      source: work,
      verifier,
      pollIntervalMilliseconds: 10,
    });

    const running = worker.run();
    await vi.waitFor(() =>
      expect(work.quarantineInvalid).toHaveBeenCalledWith({
        verificationAttemptId: request.verificationAttemptId,
        leaseToken: request.leaseToken,
        observationBodyDigest: request.signedObservation.bodyDigest,
      }),
    );
    await worker.stop();
    await running;
  });

  it('fails closed on a source error or an unpersisted non-terminal result', async () => {
    const unavailable = createTrustedTelebirrVerifierWorker({
      source: source(async () => {
        throw new Error('database detail');
      }),
      verifier: { verifyAndComplete: vi.fn() },
    });
    await expect(unavailable.run()).rejects.toEqual(
      new TrustedTelebirrVerifierWorkerUnavailableError(),
    );

    const unpersisted = createTrustedTelebirrVerifierWorker({
      source: source(async () => request),
      verifier: {
        verifyAndComplete: vi.fn(
          async () =>
            ({
              status: 'not_settled',
              disposition: 'review_required',
              reasonCode: 'source_unavailable',
            }) as const,
        ),
      },
    });
    await expect(unpersisted.run()).rejects.toEqual(
      new TrustedTelebirrVerifierWorkerUnavailableError(),
    );
  });
});
