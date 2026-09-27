import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  guardedPrePermitStopped,
  isGuardedPrePermitStopRequest,
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
});
