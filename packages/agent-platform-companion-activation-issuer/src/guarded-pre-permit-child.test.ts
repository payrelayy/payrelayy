import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  guardedPrePermitStopped,
  guardedRuntimeStopped,
  isGuardedPrePermitStopRequest,
  isGuardedRuntimeStopRequest,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  bindGuardedPrePermitChild,
  GuardedPrePermitChildStopUnavailableError,
} from './guarded-pre-permit-child.js';

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 1234,
    connected: true,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null);
      return true;
    }),
  });
  const challenge = randomBytes(32).toString('base64url');
  const owned = bindGuardedPrePermitChild(child as unknown as ChildProcess, challenge);
  const close = (code: number | null, signal: NodeJS.Signals | null = null): void => {
    child.exitCode = code;
    child.signalCode = signal;
    child.connected = false;
    child.emit('close', code, signal);
  };
  return { child, challenge, owned, close };
}

describe('exact guarded pre-permit child binding', () => {
  it('sends one challenge-bound stop and confirms clean child exit after acknowledgement', async () => {
    const f = fixture();
    const pending = f.owned.stop();
    expect(f.child.send).toHaveBeenCalledOnce();
    expect(isGuardedPrePermitStopRequest(f.child.send.mock.calls[0]?.[0], f.challenge)).toBe(true);
    f.child.emit('message', guardedPrePermitStopped(f.challenge));
    f.close(0);
    await expect(pending).resolves.toBeUndefined();
    await expect(f.owned.stopped).resolves.toBeUndefined();
    expect(f.owned.processId).toBe(1234);
  });

  it('does not accept an acknowledgement for another challenge', async () => {
    const f = fixture();
    const pending = f.owned.stop();
    f.child.emit('message', guardedPrePermitStopped(randomBytes(32).toString('base64url')));
    f.close(0);
    await expect(pending).rejects.toThrow(GuardedPrePermitChildStopUnavailableError);
  });

  it('does not accept abrupt or failed exit even after an acknowledgement', async () => {
    const f = fixture();
    const pending = f.owned.stop();
    f.child.emit('message', guardedPrePermitStopped(f.challenge));
    f.close(null, 'SIGTERM');
    await expect(pending).rejects.toThrow(GuardedPrePermitChildStopUnavailableError);
  });

  it('cannot stop a child whose IPC channel has already closed', async () => {
    const f = fixture();
    f.child.connected = false;
    await expect(f.owned.stop()).rejects.toThrow(GuardedPrePermitChildStopUnavailableError);
    expect(f.child.send).not.toHaveBeenCalled();
    f.close(0);
  });

  it('stops the exact child after a permit without claiming a provider outcome', async () => {
    const f = fixture();
    const pending = f.owned.stopAfterPermit();
    expect(f.child.send).toHaveBeenCalledOnce();
    expect(isGuardedRuntimeStopRequest(f.child.send.mock.calls[0]?.[0], f.challenge)).toBe(true);
    f.child.emit('message', guardedPrePermitStopped(f.challenge));
    f.child.emit('message', guardedRuntimeStopped(f.challenge));
    f.close(0);
    await expect(pending).resolves.toEqual({
      processStopped: true,
      providerOutcomeRequiresReconciliation: true,
    });
    await expect(f.owned.stopAfterPermit()).resolves.toMatchObject({ processStopped: true });
    expect(f.child.send).toHaveBeenCalledOnce();
    await expect(f.owned.stop()).rejects.toThrow(GuardedPrePermitChildStopUnavailableError);
  });

  it('refuses mismatched post-permit acknowledgement or abrupt exit', async () => {
    const mismatched = fixture();
    const first = mismatched.owned.stopAfterPermit();
    mismatched.child.emit('message', guardedRuntimeStopped(randomBytes(32).toString('base64url')));
    mismatched.close(0);
    await expect(first).rejects.toThrow(GuardedPrePermitChildStopUnavailableError);

    const signaled = fixture();
    const second = signaled.owned.stopAfterPermit();
    signaled.child.emit('message', guardedRuntimeStopped(signaled.challenge));
    signaled.close(null, 'SIGTERM');
    await expect(second).rejects.toThrow(GuardedPrePermitChildStopUnavailableError);
  });

  it('fails boundedly rather than treating a missing post-permit exit as stopped', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const pending = f.owned.stopAfterPermit();
      const rejected = expect(pending).rejects.toThrow(GuardedPrePermitChildStopUnavailableError);
      f.child.emit('message', guardedRuntimeStopped(f.challenge));
      await vi.advanceTimersByTimeAsync(10_001);
      await rejected;
      expect(f.child.send).toHaveBeenCalledOnce();
      f.close(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
