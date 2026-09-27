import { describe, expect, it, vi } from 'vitest';

import {
  GuardedOperatorActivationUnavailableError,
  runGuardedOperatorActivationWithAdapters,
  runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters,
  type GuardedOperatorActivationInput,
} from './guarded-operator-activation.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const REQUEST = '22222222-2222-4222-8222-222222222222';
const ACTOR = '11111111-1111-4111-8111-111111111111';

function fixture() {
  const order: string[] = [];
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const child = {
    processId: 411,
    stopped,
    stop: vi.fn(async () => {
      order.push('child_stop');
      resolveStopped();
    }),
    stopAfterPermit: vi.fn(),
  };
  const channel = {
    pipePath: '\\\\.\\pipe\\test',
    receiveProof: vi.fn(async () => ({ body: {}, signature: '' })),
    commitAndPermit: vi.fn(),
    close: vi.fn(async () => {
      order.push('channel_close');
    }),
  };
  let rejectLock!: () => void;
  const lost = new Promise<never>((_, reject) => {
    rejectLock = () => reject(new Error('dedicated session lost'));
  });
  const lock = {
    lost,
    release: vi.fn(async () => {
      order.push('lock_release');
    }),
  };
  const snapshot = {
    request: { requestKey: REQUEST, activationEpoch: 'epoch' },
    currentIdentity: {},
    certificate: {},
  };
  const release = { releaseSha: 'b'.repeat(40) };
  const observe = vi.fn(async () => {
    order.push('observe');
    return { processId: child.processId, executionHandoffSha256: DIGEST };
  });
  const runLifecycle = vi.fn(async () => {
    order.push('lifecycle');
    await child.stop();
    await channel.close();
    return 'confirmed' as const;
  });
  const adapters = {
    acquireLock: vi.fn(async () => {
      order.push('lock');
      return lock;
    }),
    attest: vi.fn(
      async (
        _request: string,
        sources: {
          loadDatabaseSnapshot(key: string): Promise<unknown>;
          verifyPublishedReleaseAndInstalledTree(request: unknown): Promise<unknown>;
          observePairedProcess(input: unknown): Promise<unknown>;
          retainAttestation(attestation: unknown): Promise<void>;
        },
      ) => {
        order.push('attest');
        const first = (await sources.loadDatabaseSnapshot(REQUEST)) as typeof snapshot;
        await sources.verifyPublishedReleaseAndInstalledTree(first.request);
        await sources.observePairedProcess({
          request: first.request,
          certificate: first.certificate,
          challenge: 'challenge',
          challengeIssuedAt: new Date().toISOString(),
        });
        await sources.loadDatabaseSnapshot(REQUEST);
        await sources.retainAttestation({ requestKey: REQUEST, launchProofDigest: DIGEST });
      },
    ),
    loadSnapshot: vi.fn(async () => {
      order.push('snapshot');
      return snapshot;
    }),
    verifyRelease: vi.fn(async () => {
      order.push('release');
      return release;
    }),
    publishHandoff: vi.fn(async () => {
      order.push('handoff');
      return { handoffSha256: DIGEST };
    }),
    openChannel: vi.fn(async () => {
      order.push('channel');
      return channel;
    }),
    start: vi.fn(() => {
      order.push('child');
      return child;
    }),
    observe,
    retainRow: vi.fn(async () => {
      order.push('retain');
    }),
    prepareSupervisor: vi.fn(() => {
      order.push('supervisor');
      return {};
    }),
    runLifecycle,
  };
  const input = {
    requestKey: REQUEST,
    actorAuthUserId: ACTOR,
    administrator: { processID: 417, query: vi.fn(), on: vi.fn(), off: vi.fn() },
    releaseInputs: {
      releaseTag: 'windows-companion-v-test',
      archivePath: 'archive',
      checksumPath: 'checksum',
      installationRoot: 'installation',
      verifierScriptPath: 'verifier',
      powershellExecutable: 'powershell',
    },
    dataRoot: 'data',
    processVerifierScriptPath: 'process-verifier',
    windowsEnvironment: {},
    signHandoff: vi.fn(),
    disableDatabase: vi.fn(),
    trustedNow: () => new Date(),
  } as unknown as GuardedOperatorActivationInput;
  type Adapters = Parameters<typeof runGuardedOperatorActivationWithAdapters>[1];
  return {
    input,
    adapters: adapters as unknown as Adapters,
    order,
    child,
    channel,
    lock,
    runLifecycle,
    observe,
    rejectLock,
  };
}

describe('internal protected operator composition', () => {
  it('holds one lock across independent attestation and the one-job lifecycle', async () => {
    const state = fixture();
    await expect(
      runGuardedOperatorActivationWithAdapters(state.input, state.adapters),
    ).resolves.toBe('confirmed');
    expect(state.order).toEqual([
      'lock',
      'attest',
      'snapshot',
      'release',
      'handoff',
      'channel',
      'child',
      'observe',
      'snapshot',
      'retain',
      'supervisor',
      'lifecycle',
      'child_stop',
      'channel_close',
      'lock_release',
    ]);
    expect(state.runLifecycle).toHaveBeenCalledTimes(1);
    expect(state.lock.release).toHaveBeenCalledTimes(1);
  });

  it('stops only the exact pre-permit child if process observation fails', async () => {
    const state = fixture();
    state.observe.mockRejectedValueOnce(new Error('private observation detail'));
    await expect(
      runGuardedOperatorActivationWithAdapters(state.input, state.adapters),
    ).rejects.toBeInstanceOf(GuardedOperatorActivationUnavailableError);
    expect(state.child.stop).toHaveBeenCalledTimes(1);
    expect(state.channel.close).toHaveBeenCalledTimes(1);
    expect(state.lock.release).toHaveBeenCalledTimes(1);
    expect(state.runLifecycle).not.toHaveBeenCalled();
  });

  it('rejects an invalid owned child before reading a launch proof or permit', async () => {
    const state = fixture();
    vi.mocked(state.adapters.start).mockImplementationOnce(() => ({
      processId: 0,
      stopped: Promise.resolve(),
      stop: state.child.stop,
      stopAfterPermit: state.child.stopAfterPermit,
    }));
    await expect(
      runGuardedOperatorActivationWithAdapters(state.input, state.adapters),
    ).rejects.toBeInstanceOf(GuardedOperatorActivationUnavailableError);
    expect(state.channel.receiveProof).not.toHaveBeenCalled();
    expect(state.child.stop).toHaveBeenCalledTimes(1);
    expect(state.runLifecycle).not.toHaveBeenCalled();
  });

  it('does not create a child or start a transition if the lock is unavailable', async () => {
    const state = fixture();
    vi.mocked(state.adapters.acquireLock).mockRejectedValueOnce(new Error('held'));
    await expect(
      runGuardedOperatorActivationWithAdapters(state.input, state.adapters),
    ).rejects.toBeInstanceOf(GuardedOperatorActivationUnavailableError);
    expect(state.order).toEqual([]);
    expect(state.adapters.acquireLock).toHaveBeenCalledTimes(1);
    expect(state.runLifecycle).not.toHaveBeenCalled();
  });

  it('never reports completion when lifecycle-lock release cannot be confirmed', async () => {
    const state = fixture();
    state.lock.release.mockRejectedValueOnce(new Error('lost'));
    await expect(
      runGuardedOperatorActivationWithAdapters(state.input, state.adapters),
    ).rejects.toBeInstanceOf(GuardedOperatorActivationUnavailableError);
    expect(state.runLifecycle).toHaveBeenCalledTimes(1);
    expect(state.child.stop).toHaveBeenCalledTimes(1);
  });

  it('stops before a permit when the dedicated lock connection is lost', async () => {
    const state = fixture();
    vi.mocked(state.adapters.openChannel).mockImplementationOnce(async () => {
      state.rejectLock();
      await Promise.resolve();
      return state.channel as never;
    });
    await expect(
      runGuardedOperatorActivationWithAdapters(state.input, state.adapters),
    ).rejects.toBeInstanceOf(GuardedOperatorActivationUnavailableError);
    expect(state.child.stop).not.toHaveBeenCalled();
    expect(state.channel.close).toHaveBeenCalledTimes(1);
    expect(state.runLifecycle).not.toHaveBeenCalled();
  });

  it('uses only the protected remote session and closes it after the lifecycle', async () => {
    const state = fixture();
    const { administrator: _discarded, ...input } = state.input;
    const remote = {
      backendPid: 499,
      lost: new Promise<never>(() => undefined),
      execute: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    await expect(
      runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters(
        input,
        remote,
        state.adapters,
      ),
    ).resolves.toBe('confirmed');
    expect(state.adapters.acquireLock).toHaveBeenCalledWith(
      expect.objectContaining({ processID: 499 }),
    );
    expect(remote.close).toHaveBeenCalledTimes(1);
    expect(state.lock.release).toHaveBeenCalledTimes(1);
  });

  it('fails closed if the remote session cannot be confirmed closed', async () => {
    const state = fixture();
    const { administrator: _discarded, ...input } = state.input;
    const remote = {
      backendPid: 499,
      lost: new Promise<never>(() => undefined),
      execute: vi.fn(),
      close: vi.fn(async () => {
        throw new Error('transport stopped without confirmation');
      }),
    };
    await expect(
      runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters(
        input,
        remote,
        state.adapters,
      ),
    ).rejects.toBeInstanceOf(GuardedOperatorActivationUnavailableError);
    expect(state.runLifecycle).toHaveBeenCalledTimes(1);
    expect(remote.close).toHaveBeenCalledTimes(1);
  });
});
