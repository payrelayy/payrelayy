import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  guardedPrePermitStopRequest,
  isGuardedPrePermitStopped,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it, vi } from 'vitest';

import { installGuardedPrePermitShutdown } from './guarded-pre-permit-shutdown.js';

function fixture() {
  const endpoint = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null);
      return true;
    }),
    disconnect: vi.fn(function (this: { connected: boolean }) {
      this.connected = false;
    }),
  });
  const challenge = randomBytes(32).toString('base64url');
  const abort = vi.fn();
  let confirm!: () => void;
  let fail!: (error: Error) => void;
  const stopAndConfirm = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        confirm = resolve;
        fail = reject;
      }),
  );
  return {
    endpoint,
    processEndpoint: endpoint as unknown as NodeJS.Process,
    challenge,
    abort,
    stopAndConfirm,
    confirm: () => confirm(),
    fail: () => fail(new Error()),
  };
}

describe('guarded pre-permit child shutdown', () => {
  it('acknowledges only after browser/session shutdown is confirmed', async () => {
    const f = fixture();
    const gate = installGuardedPrePermitShutdown(
      f.processEndpoint,
      f.challenge,
      f.abort,
      f.stopAndConfirm,
    );
    f.endpoint.emit('message', guardedPrePermitStopRequest(f.challenge));
    expect(gate.requested()).toBe(true);
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.stopAndConfirm).toHaveBeenCalledOnce();
    expect(f.endpoint.send).not.toHaveBeenCalled();
    f.confirm();
    await vi.waitFor(() => expect(f.endpoint.send).toHaveBeenCalledOnce());
    expect(isGuardedPrePermitStopped(f.endpoint.send.mock.calls[0]?.[0], f.challenge)).toBe(true);
    expect(f.endpoint.disconnect).toHaveBeenCalledOnce();
  });

  it('ignores unrelated messages and a stop after permit disarms the listener', () => {
    const f = fixture();
    const gate = installGuardedPrePermitShutdown(
      f.processEndpoint,
      f.challenge,
      f.abort,
      f.stopAndConfirm,
    );
    f.endpoint.emit('message', { type: 'other' });
    expect(gate.requested()).toBe(false);
    gate.disarm();
    f.endpoint.emit('message', guardedPrePermitStopRequest(f.challenge));
    expect(f.stopAndConfirm).not.toHaveBeenCalled();
    expect(f.abort).not.toHaveBeenCalled();
  });

  it('withholds acknowledgement when cleanup is unconfirmed', async () => {
    const f = fixture();
    installGuardedPrePermitShutdown(f.processEndpoint, f.challenge, f.abort, f.stopAndConfirm);
    f.endpoint.emit('message', guardedPrePermitStopRequest(f.challenge));
    f.fail();
    await vi.waitFor(() => expect(f.endpoint.disconnect).toHaveBeenCalledOnce());
    expect(f.endpoint.send).not.toHaveBeenCalled();
  });

  it('closes the guarded session if its parent disconnects before a permit', async () => {
    const f = fixture();
    const gate = installGuardedPrePermitShutdown(
      f.processEndpoint,
      f.challenge,
      f.abort,
      f.stopAndConfirm,
    );
    f.endpoint.connected = false;
    f.endpoint.emit('disconnect');
    expect(gate.requested()).toBe(true);
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.stopAndConfirm).toHaveBeenCalledOnce();
    f.confirm();
    await Promise.resolve();
    expect(f.endpoint.send).not.toHaveBeenCalled();
  });
});
