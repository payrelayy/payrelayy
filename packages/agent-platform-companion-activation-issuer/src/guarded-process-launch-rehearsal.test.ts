import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { GuardedLocalLaunchProofChannel } from './guarded-local-launch-channel.js';
import {
  GuardedProcessLaunchRehearsalUnavailableError,
  rehearseGuardedWindowsCompanionLaunch,
  type GuardedProcessLaunchRehearsalInputs,
} from './guarded-process-launch-rehearsal.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const certificateId = randomUUID();
  const proof = Object.freeze({ diagnostic: 'untrusted-proof' });
  const exit = deferred();
  const close = vi.fn(async () => undefined);
  const stop = vi.fn(async () => exit.resolve());
  const receiveProof = vi.fn(async () => proof);
  const channel: GuardedLocalLaunchProofChannel = {
    pipePath: '\\\\.\\pipe\\fetanagent-companion-launch-00000000000000000000000000000000',
    receiveProof,
    close,
  };
  const input: GuardedProcessLaunchRehearsalInputs = {
    request: {
      requestKey: randomUUID(),
      pilotRevisionId: randomUUID(),
      activationEpoch: '1',
      certificateId,
      platformAgentAccountId: randomUUID(),
      companionReleaseSha: 'a'.repeat(40),
      companionArchiveSha256: `sha256:${'b'.repeat(64)}`,
      companionInstallationTreeSha256: `sha256:${'c'.repeat(64)}`,
      requestedAt: '2026-09-27T00:00:00.000Z',
      expiresAt: '2026-09-27T00:10:00.000Z',
    },
    certificate: {
      certificateId,
      certificateBodyDigest: `sha256:${'d'.repeat(64)}`,
      deviceKeyId: 'test-device-key',
      devicePublicKeySpki: 'test-spki',
      devicePublicKeySpkiSha256: `sha256:${'e'.repeat(64)}`,
      validFrom: '2026-09-26T00:00:00.000Z',
      validUntil: '2026-09-28T00:00:00.000Z',
    },
    release: {
      releaseSha: 'a'.repeat(40),
      archiveSha256: `sha256:${'b'.repeat(64)}`,
      installationTreeSha256: `sha256:${'c'.repeat(64)}`,
      observedAt: '2026-09-27T00:00:00.000Z',
    },
    dataRoot: 'C:\\protected\\data',
    installationRoot: 'C:\\protected\\installed',
    powershellExecutable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    verifierScriptPath: 'C:\\reviewed\\inspect-guarded-windows-companion-process.ps1',
    trustedNow: () => new Date('2026-09-27T00:00:01.000Z'),
    start: vi.fn(() => ({ processId: 1234, stopped: exit.promise, stop })),
  };
  const openChannel = vi.fn(async () => channel);
  const observe = vi.fn(async () => ({ processId: 1234 }));
  return { input, proof, exit, close, stop, receiveProof, openChannel, observe };
}

describe('guarded process launch rehearsal', () => {
  it('receives and independently observes one proof, then stops without a permit', async () => {
    const f = fixture();
    const order: string[] = [];
    f.stop.mockImplementationOnce(async () => {
      order.push('stop');
      f.exit.resolve();
    });
    f.close.mockImplementationOnce(async () => {
      order.push('close');
    });
    const result = await rehearseGuardedWindowsCompanionLaunch(f.input, f);
    expect(result).toEqual({
      proofObserved: true,
      processObserved: true,
      processStopped: true,
      permitSent: false,
    });
    const challenge = f.openChannel.mock.calls[0]?.[0];
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(f.input.start).toHaveBeenCalledWith({
      challenge,
      pipePath: '\\\\.\\pipe\\fetanagent-companion-launch-00000000000000000000000000000000',
    });
    expect(f.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        proof: f.proof,
        challenge,
        challengeIssuedAt: '2026-09-27T00:00:01.000Z',
      }),
    );
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    expect(order).toEqual(['stop', 'close']);
  });

  it('fails closed and stops the child when independent observation rejects', async () => {
    const f = fixture();
    f.observe.mockRejectedValueOnce(new Error('sensitive observer detail'));
    await expect(rehearseGuardedWindowsCompanionLaunch(f.input, f)).rejects.toThrow(
      GuardedProcessLaunchRehearsalUnavailableError,
    );
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('rejects a proof bound to a different child process', async () => {
    const f = fixture();
    f.observe.mockResolvedValueOnce({ processId: 4321 });
    await expect(rehearseGuardedWindowsCompanionLaunch(f.input, f)).rejects.toThrow(
      GuardedProcessLaunchRehearsalUnavailableError,
    );
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('stops the child when the local proof is unavailable', async () => {
    const f = fixture();
    f.receiveProof.mockRejectedValueOnce(new Error('sensitive pipe detail'));
    await expect(rehearseGuardedWindowsCompanionLaunch(f.input, f)).rejects.toThrow(
      GuardedProcessLaunchRehearsalUnavailableError,
    );
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('fails promptly when the child exits before proof delivery', async () => {
    const f = fixture();
    f.receiveProof.mockImplementationOnce(() => new Promise(() => undefined));
    f.exit.resolve();
    await expect(rehearseGuardedWindowsCompanionLaunch(f.input, f)).rejects.toThrow(
      GuardedProcessLaunchRehearsalUnavailableError,
    );
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('closes the channel if the protected starter throws before transferring a child', async () => {
    const f = fixture();
    const start = vi.fn(() => {
      throw new Error('sensitive start detail');
    });
    await expect(rehearseGuardedWindowsCompanionLaunch({ ...f.input, start }, f)).rejects.toThrow(
      GuardedProcessLaunchRehearsalUnavailableError,
    );
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.stop).not.toHaveBeenCalled();
  });

  it('never reports success when child exit cannot be confirmed', async () => {
    const f = fixture();
    f.stop.mockImplementationOnce(async () => {
      f.exit.resolve();
      throw new Error('sensitive stop detail');
    });
    await expect(rehearseGuardedWindowsCompanionLaunch(f.input, f)).rejects.toThrow(
      GuardedProcessLaunchRehearsalUnavailableError,
    );
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('still stops the child if closing the local channel fails', async () => {
    const f = fixture();
    f.close.mockRejectedValueOnce(new Error('sensitive close detail'));
    await expect(rehearseGuardedWindowsCompanionLaunch(f.input, f)).rejects.toThrow(
      GuardedProcessLaunchRehearsalUnavailableError,
    );
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('does not start a child if the signal is already aborted', async () => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(
      rehearseGuardedWindowsCompanionLaunch({ ...f.input, signal: abort.signal }, f),
    ).rejects.toThrow(GuardedProcessLaunchRehearsalUnavailableError);
    expect(f.openChannel).not.toHaveBeenCalled();
    expect(f.input.start).not.toHaveBeenCalled();
  });
});
