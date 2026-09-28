import { describe, expect, it, vi } from 'vitest';

import type { SignedCompanionExecutionActivationHandoff } from '@fetanagent/agent-platform-companion-execution-contracts';

import type { GuardedOperatorActivationInput } from './guarded-operator-activation.js';
import type { GuardedOperatorRemoteSession } from './guarded-operator-query-client.js';
import { runGuardedOperatorActivationOverSshWithAdapters } from './guarded-operator-ssh-activation.js';
import type { ProtectedOperatorDeviceSigner } from './protected-operator-query-http-client.js';
import type { ProtectedOperatorSshConnection } from './protected-operator-query-ssh-client.js';

const REQUEST = '22222222-2222-4222-8222-222222222222';
const input = { requestKey: REQUEST } as Omit<
  GuardedOperatorActivationInput,
  'administrator' | 'signHandoff' | 'disableDatabase'
>;
const device = {} as ProtectedOperatorDeviceSigner;
const connection = {} as ProtectedOperatorSshConnection;
const closeRemote = vi.fn(async () => undefined);
const remote = { close: closeRemote } as unknown as GuardedOperatorRemoteSession;
const signed = {} as SignedCompanionExecutionActivationHandoff;
type Adapters = Parameters<typeof runGuardedOperatorActivationOverSshWithAdapters>[3];

describe('protected SSH one-job operator ordering', () => {
  it('signs before the first query and consumes the cached handoff exactly once', async () => {
    closeRemote.mockClear();
    const order: string[] = [];
    const adapters = {
      stop: vi.fn(() => async (key: string) => {
        expect(key).toBe(REQUEST);
        order.push('stop');
      }),
      sign: vi.fn(() => async (key: string) => {
        expect(key).toBe(REQUEST);
        order.push('sign');
        return signed;
      }),
      open: vi.fn(async () => {
        order.push('open');
        return remote;
      }),
      activate: vi.fn(async (activation: GuardedOperatorActivationInput) => {
        order.push('activate');
        expect(await activation.signHandoff(REQUEST)).toBe(signed);
        await expect(activation.signHandoff(REQUEST)).rejects.toThrow();
        await activation.disableDatabase();
        return 'confirmed' as const;
      }),
    } as unknown as Adapters;

    await expect(
      runGuardedOperatorActivationOverSshWithAdapters(input, device, connection, adapters),
    ).resolves.toBe('confirmed');
    expect(order).toEqual(['sign', 'open', 'activate', 'stop']);
    expect(closeRemote).not.toHaveBeenCalled();
  });

  it('never opens a query session if the one-use signature is unavailable', async () => {
    const adapters = {
      stop: vi.fn(),
      sign: vi.fn(() => async () => {
        throw new Error('protected failure');
      }),
      open: vi.fn(),
      activate: vi.fn(),
    } as unknown as Adapters;

    await expect(
      runGuardedOperatorActivationOverSshWithAdapters(input, device, connection, adapters),
    ).rejects.toThrow('The guarded one-job operator activation could not be confirmed.');
    expect(adapters.open).not.toHaveBeenCalled();
    expect(adapters.activate).not.toHaveBeenCalled();
  });

  it('rejects a request-key mismatch without using the cached signature', async () => {
    closeRemote.mockClear();
    const adapters = {
      stop: vi.fn(() => async () => undefined),
      sign: vi.fn(() => async () => signed),
      open: vi.fn(async () => remote),
      activate: vi.fn(async (activation: GuardedOperatorActivationInput) => {
        await expect(
          activation.signHandoff('33333333-3333-4333-8333-333333333333'),
        ).rejects.toThrow();
        return 'confirmed' as const;
      }),
    } as unknown as Adapters;

    await expect(
      runGuardedOperatorActivationOverSshWithAdapters(input, device, connection, adapters),
    ).rejects.toThrow('The guarded one-job operator activation could not be confirmed.');
    expect(closeRemote).toHaveBeenCalledTimes(1);
  });
});
