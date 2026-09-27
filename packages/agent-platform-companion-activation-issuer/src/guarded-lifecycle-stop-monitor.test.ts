import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';
import {
  armGuardedCompanionLifecycleStopMonitor,
  GuardedCompanionLifecycleStopUnavailableError,
} from './guarded-lifecycle-stop-monitor.js';

const databaseProof = Object.freeze({
  schemaVersion: 1,
  operation: 'companion_execution_emergency_disable',
  deploymentTarget: 'production',
  runtimeLogin: 'disabled',
  companionExecution: 'disabled',
  financialAuthority: 'disabled',
  providerOutcomeRequiresReconciliation: true,
});
const hostProof = Object.freeze({
  processStopped: true,
  providerOutcomeRequiresReconciliation: true,
});
const completeProof = Object.freeze({
  databaseCredentialsAndSessionsRevoked: true,
  financialAuthorityDisabled: true,
  companionExecutionDisabled: true,
  exactHostStopped: true,
  providerOutcomeRequiresReconciliation: true,
});
const start = Date.parse('2026-09-27T12:00:00.000Z');

function ownedChild(hostResult: unknown = hostProof): {
  child: GuardedCompanionOwnedChild;
  exit: () => void;
  hostStop: ReturnType<typeof vi.fn>;
} {
  let exit!: () => void;
  const stopped = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const hostStop = vi.fn(async () => {
    exit();
    return hostResult as typeof hostProof;
  });
  return {
    child: {
      processId: 411,
      stopped,
      stop: vi.fn(async () => undefined),
      stopAfterPermit: hostStop,
    },
    exit,
    hostStop,
  };
}

afterEach(() => vi.useRealTimers());

describe('guarded companion lifecycle stop monitor', () => {
  it('uses the database expiry with a safety margin and invokes the complete stop once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const owned = ownedChild();
    const disableDatabase = vi.fn(async () => databaseProof);
    const monitor = armGuardedCompanionLifecycleStopMonitor({
      child: owned.child,
      validUntil: new Date(start + 90 * 60_000).toISOString(),
      disableDatabase,
    });
    await vi.advanceTimersByTimeAsync(90 * 60_000 - 30_001);
    expect(disableDatabase).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(monitor.done).resolves.toEqual(completeProof);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.hostStop).toHaveBeenCalledTimes(1);
    await expect(monitor.stopNow()).resolves.toEqual(completeProof);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
  });

  it('stops on exact child exit and deduplicates an operator abort and deadline race', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const owned = ownedChild();
    const signal = new AbortController();
    const disableDatabase = vi.fn(async () => databaseProof);
    const monitor = armGuardedCompanionLifecycleStopMonitor({
      child: owned.child,
      validUntil: new Date(start + 90 * 60_000).toISOString(),
      disableDatabase,
      signal: signal.signal,
    });
    owned.exit();
    signal.abort();
    await vi.advanceTimersByTimeAsync(90 * 60_000);
    await expect(monitor.done).resolves.toEqual(completeProof);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.hostStop).toHaveBeenCalledTimes(1);
  });

  it('stops on an operator abort without waiting for the deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const owned = ownedChild();
    const signal = new AbortController();
    const disableDatabase = vi.fn(async () => databaseProof);
    const monitor = armGuardedCompanionLifecycleStopMonitor({
      child: owned.child,
      validUntil: new Date(start + 90 * 60_000).toISOString(),
      disableDatabase,
      signal: signal.signal,
    });
    signal.abort();
    await expect(monitor.done).resolves.toEqual(completeProof);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.hostStop).toHaveBeenCalledTimes(1);
  });

  it('immediately stops when expiry is malformed, too near, or overlong', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    for (const validUntil of [
      'not-a-timestamp',
      new Date(start + 59_000).toISOString(),
      new Date(start + 3 * 60 * 60_000).toISOString(),
    ]) {
      const owned = ownedChild();
      const disableDatabase = vi.fn(async () => databaseProof);
      const monitor = armGuardedCompanionLifecycleStopMonitor({
        child: owned.child,
        validUntil,
        disableDatabase,
      });
      await expect(monitor.done).resolves.toEqual(completeProof);
      expect(disableDatabase).toHaveBeenCalledTimes(1);
      expect(owned.hostStop).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects a false database success proof without repeating either stop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const owned = ownedChild();
    const disableDatabase = vi.fn(async () => ({ ...databaseProof, runtimeLogin: 'active' }));
    const monitor = armGuardedCompanionLifecycleStopMonitor({
      child: owned.child,
      validUntil: new Date(start + 90 * 60_000).toISOString(),
      disableDatabase,
    });
    await expect(monitor.stopNow()).rejects.toBeInstanceOf(
      GuardedCompanionLifecycleStopUnavailableError,
    );
    await expect(monitor.done).rejects.toBeInstanceOf(
      GuardedCompanionLifecycleStopUnavailableError,
    );
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.hostStop).toHaveBeenCalledTimes(1);
  });

  it('redacts a database failure and leaves independent stop and provider reconciliation required', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const owned = ownedChild();
    const disableDatabase = vi.fn(async (): Promise<unknown> => {
      throw new Error('sensitive database failure');
    });
    const monitor = armGuardedCompanionLifecycleStopMonitor({
      child: owned.child,
      validUntil: new Date(start + 90 * 60_000).toISOString(),
      disableDatabase,
    });
    await expect(monitor.stopNow()).rejects.toMatchObject({
      message: 'The guarded companion lifecycle stop could not be confirmed.',
      requiresIndependentStopAndReconciliation: true,
    });
    await expect(monitor.done).rejects.toBeInstanceOf(
      GuardedCompanionLifecycleStopUnavailableError,
    );
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.hostStop).toHaveBeenCalledTimes(1);
  });

  it('bounds a hanging database stop and reports its outcome as unconfirmed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const owned = ownedChild();
    const disableDatabase = vi.fn(() => new Promise<never>(() => undefined));
    const monitor = armGuardedCompanionLifecycleStopMonitor({
      child: owned.child,
      validUntil: new Date(start + 90 * 60_000).toISOString(),
      disableDatabase,
    });
    const rejection = expect(monitor.stopNow()).rejects.toBeInstanceOf(
      GuardedCompanionLifecycleStopUnavailableError,
    );
    await vi.advanceTimersByTimeAsync(105_001);
    await rejection;
    await expect(monitor.done).rejects.toBeInstanceOf(
      GuardedCompanionLifecycleStopUnavailableError,
    );
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.hostStop).toHaveBeenCalledTimes(1);
  });
});
