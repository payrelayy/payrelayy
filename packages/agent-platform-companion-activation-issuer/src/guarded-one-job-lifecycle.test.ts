import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuardedLocalActivationChannel } from './guarded-local-activation-channel.js';
import {
  GuardedLocalActivationUncertainError,
  GuardedLocalActivationUnavailableError,
} from './guarded-local-activation-channel.js';
import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';
import type { GuardedCompanionExecutionSupervisor } from './guarded-execution-supervisor.js';
import {
  GuardedOneJobLifecycleUnavailableError,
  runGuardedOneJobLifecycle,
  type GuardedOneJobLifecycleInput,
} from './guarded-one-job-lifecycle.js';
import {
  loadGuardedOneJobOutcome,
  watchGuardedApprovedJobId,
  watchGuardedOneJobOutcome,
} from './guarded-one-job-outcome.js';

vi.mock('./guarded-one-job-outcome.js', () => ({
  loadGuardedOneJobOutcome: vi.fn(),
  watchGuardedApprovedJobId: vi.fn(),
  watchGuardedOneJobOutcome: vi.fn(),
}));

const stopProof = Object.freeze({
  databaseCredentialsAndSessionsRevoked: true as const,
  financialAuthorityDisabled: true as const,
  companionExecutionDisabled: true as const,
  exactHostStopped: true as const,
  providerOutcomeRequiresReconciliation: true as const,
});
const noLoss = new Promise<never>(() => undefined);
const jobId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const order: string[] = [];
  const child: GuardedCompanionOwnedChild = {
    processId: 411,
    stopped: Promise.resolve(),
    stop: vi.fn(async () => {
      order.push('pre_permit_stop');
    }),
    stopAfterPermit: vi.fn(async () => {
      order.push('host_stop');
      return { processStopped: true, providerOutcomeRequiresReconciliation: true };
    }),
  };
  const supervisor: GuardedCompanionExecutionSupervisor = {
    confirmReady: vi.fn(async () => undefined),
    onActivated: vi.fn(async () => undefined),
    lost: noLoss,
    stopOnUncertainty: vi.fn(async () => {
      order.push('database_and_host_stop');
      return stopProof;
    }),
  };
  const channel: GuardedLocalActivationChannel = {
    pipePath: '\\\\.\\pipe\\test',
    receiveProof: vi.fn(async () => {
      throw new Error();
    }),
    commitAndPermit: vi.fn(async () => {
      order.push('permit');
      return {
        validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
        permitAcknowledged: true as const,
        runtimeConfirmationRequired: true as const,
        independentStopLoss: noLoss,
      };
    }),
    close: vi.fn(async () => {
      order.push('close');
    }),
  };
  const input: GuardedOneJobLifecycleInput = {
    channel,
    child,
    supervisor,
    actorAuthUserId: '11111111-1111-4111-8111-111111111111',
    requestKey: '22222222-2222-4222-8222-222222222222',
    verifiedProofDigest: `sha256:${'a'.repeat(64)}`,
    runtimePassword: 'b'.repeat(64),
    administrator: { query: vi.fn() },
    trustedNow: () => new Date(),
  };
  return { input, channel, child, supervisor, order };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(watchGuardedApprovedJobId).mockResolvedValue(jobId);
});

describe('internal one-job post-attestation lifecycle', () => {
  it('permits once, observes exact ledger completion, then stops before reporting it', async () => {
    const { input, channel, child, supervisor, order } = fixture();
    vi.mocked(watchGuardedOneJobOutcome).mockImplementation(async () => {
      order.push('observed');
      return 'confirmed';
    });
    vi.mocked(loadGuardedOneJobOutcome).mockImplementation(async () => {
      order.push('after_stop');
      return 'confirmed';
    });
    await expect(runGuardedOneJobLifecycle(input)).resolves.toBe('confirmed');
    expect(order).toEqual(['permit', 'observed', 'database_and_host_stop', 'after_stop', 'close']);
    expect(channel.commitAndPermit).toHaveBeenCalledTimes(1);
    expect(watchGuardedApprovedJobId).toHaveBeenCalledTimes(1);
    expect(supervisor.stopOnUncertainty).toHaveBeenCalledTimes(1);
    expect(child.stop).not.toHaveBeenCalled();
    expect(vi.mocked(watchGuardedOneJobOutcome).mock.calls[0]?.[0]).toMatchObject({
      requestKey: input.requestKey,
      executionJobId: jobId,
      supervisorLost: noLoss,
    });
  });

  it('returns review only after stopping and confirming the same terminal state', async () => {
    const { input, supervisor } = fixture();
    vi.mocked(watchGuardedOneJobOutcome).mockResolvedValue('review_required');
    vi.mocked(loadGuardedOneJobOutcome).mockResolvedValue('review_required');
    await expect(runGuardedOneJobLifecycle(input)).resolves.toBe('review_required');
    expect(supervisor.stopOnUncertainty).toHaveBeenCalledTimes(1);
  });

  it('uses only the pre-permit child stop when the transition was not dispatched', async () => {
    const { input, channel, child, supervisor } = fixture();
    vi.mocked(channel.commitAndPermit).mockRejectedValue(
      new GuardedLocalActivationUnavailableError(),
    );
    await expect(runGuardedOneJobLifecycle(input)).rejects.toBeInstanceOf(
      GuardedOneJobLifecycleUnavailableError,
    );
    expect(child.stop).toHaveBeenCalledTimes(1);
    expect(supervisor.stopOnUncertainty).not.toHaveBeenCalled();
    expect(watchGuardedOneJobOutcome).not.toHaveBeenCalled();
    expect(watchGuardedApprovedJobId).not.toHaveBeenCalled();
  });

  it('runs the bound emergency stop on uncertain activation, without retrying the permit', async () => {
    const { input, channel, child, supervisor } = fixture();
    vi.mocked(channel.commitAndPermit).mockRejectedValue(
      new GuardedLocalActivationUncertainError(),
    );
    await expect(runGuardedOneJobLifecycle(input)).rejects.toBeInstanceOf(
      GuardedOneJobLifecycleUnavailableError,
    );
    expect(channel.commitAndPermit).toHaveBeenCalledTimes(1);
    expect(supervisor.stopOnUncertainty).toHaveBeenCalledTimes(1);
    expect(child.stop).not.toHaveBeenCalled();
  });

  it('stops on a broken outcome observation and never calls it a completed job', async () => {
    const { input, supervisor } = fixture();
    vi.mocked(watchGuardedOneJobOutcome).mockRejectedValue(new Error('private database detail'));
    await expect(runGuardedOneJobLifecycle(input)).rejects.toThrow(
      'The guarded one-job lifecycle could not be confirmed.',
    );
    expect(supervisor.stopOnUncertainty).toHaveBeenCalledTimes(1);
    expect(loadGuardedOneJobOutcome).not.toHaveBeenCalled();
  });

  it('stops if no exact later Owner approval can be established', async () => {
    const { input, supervisor } = fixture();
    vi.mocked(watchGuardedApprovedJobId).mockRejectedValue(new Error('private approval detail'));
    await expect(runGuardedOneJobLifecycle(input)).rejects.toBeInstanceOf(
      GuardedOneJobLifecycleUnavailableError,
    );
    expect(watchGuardedOneJobOutcome).not.toHaveBeenCalled();
    expect(supervisor.stopOnUncertainty).toHaveBeenCalledTimes(1);
  });

  it('does not call a result complete if the post-stop ledger changed', async () => {
    const { input, supervisor } = fixture();
    vi.mocked(watchGuardedOneJobOutcome).mockResolvedValue('confirmed');
    vi.mocked(loadGuardedOneJobOutcome).mockResolvedValue('review_required');
    await expect(runGuardedOneJobLifecycle(input)).rejects.toBeInstanceOf(
      GuardedOneJobLifecycleUnavailableError,
    );
    expect(supervisor.stopOnUncertainty).toHaveBeenCalledTimes(2);
  });
});
