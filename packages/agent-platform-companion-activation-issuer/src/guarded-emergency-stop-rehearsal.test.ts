import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';
import {
  GuardedCompanionEmergencyStopRehearsalUnavailableError,
  prepareGuardedCompanionEmergencyStopRehearsal,
} from './guarded-emergency-stop-rehearsal.js';

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

function child(
  stopAfterPermit: () => Promise<unknown>,
  stopped = Promise.resolve(),
): GuardedCompanionOwnedChild {
  return {
    processId: 411,
    stopped,
    stop: vi.fn(async () => undefined),
    stopAfterPermit: stopAfterPermit as GuardedCompanionOwnedChild['stopAfterPermit'],
  };
}

afterEach(() => vi.useRealTimers());

describe('guarded companion emergency stop rehearsal', () => {
  it('starts both independent stops once and requires their exact committed proofs', async () => {
    let releaseDatabase: (value: unknown) => void = () => undefined;
    let releaseHost: (value: unknown) => void = () => undefined;
    const database = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          releaseDatabase = resolve;
        }),
    );
    const host = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          releaseHost = resolve;
        }),
    );
    const owned = child(host);
    const stop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: owned,
      disableDatabase: database,
    });
    const pending = stop();
    await Promise.resolve();
    expect(database).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledTimes(1);
    releaseHost(hostProof);
    releaseDatabase(databaseProof);
    await expect(pending).resolves.toEqual({
      databaseCredentialsAndSessionsRevoked: true,
      financialAuthorityDisabled: true,
      companionExecutionDisabled: true,
      exactHostStopped: true,
      providerOutcomeRequiresReconciliation: true,
    });
    await expect(stop()).rejects.toBeInstanceOf(
      GuardedCompanionEmergencyStopRehearsalUnavailableError,
    );
    expect(database).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledTimes(1);
    expect(owned.stop).not.toHaveBeenCalled();
  });

  it('attempts the exact host stop when database disablement fails synchronously', async () => {
    const host = vi.fn(async () => hostProof);
    const database = vi.fn((): Promise<unknown> => {
      throw new Error('sensitive database failure');
    });
    const stop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: child(host),
      disableDatabase: database,
    });
    await expect(stop()).rejects.toMatchObject({
      name: 'GuardedCompanionEmergencyStopRehearsalUnavailableError',
      message: 'The guarded companion emergency stop could not be confirmed.',
      requiresIndependentStopAndReconciliation: true,
    });
    expect(database).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledTimes(1);
  });

  it('attempts database disablement when the exact child refuses clean shutdown', async () => {
    const database = vi.fn(async () => databaseProof);
    const host = vi.fn(async (): Promise<unknown> => {
      throw new Error('child failed');
    });
    const stop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: child(host),
      disableDatabase: database,
    });
    await expect(stop()).rejects.toBeInstanceOf(
      GuardedCompanionEmergencyStopRehearsalUnavailableError,
    );
    expect(database).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed or extra success fields without a second attempt', async () => {
    for (const proof of [
      { ...databaseProof, runtimeLogin: 'active' },
      { ...databaseProof, leakedIdentifier: 'unexpected' },
    ]) {
      const stop = prepareGuardedCompanionEmergencyStopRehearsal({
        child: child(async () => hostProof),
        disableDatabase: async () => proof,
      });
      await expect(stop()).rejects.toBeInstanceOf(
        GuardedCompanionEmergencyStopRehearsalUnavailableError,
      );
      await expect(stop()).rejects.toBeInstanceOf(
        GuardedCompanionEmergencyStopRehearsalUnavailableError,
      );
    }
    const host = prepareGuardedCompanionEmergencyStopRehearsal({
      child: child(async () => ({ ...hostProof, extra: true })),
      disableDatabase: async () => databaseProof,
    });
    await expect(host()).rejects.toBeInstanceOf(
      GuardedCompanionEmergencyStopRehearsalUnavailableError,
    );
  });

  it('requires the exact child-exit observation after a stop acknowledgement', async () => {
    const stop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: child(async () => hostProof, Promise.reject(new Error('exit uncertain'))),
      disableDatabase: async () => databaseProof,
    });
    await expect(stop()).rejects.toBeInstanceOf(
      GuardedCompanionEmergencyStopRehearsalUnavailableError,
    );
  });

  it('bounds a hanging host stop and does not repeat either action', async () => {
    vi.useFakeTimers();
    const database = vi.fn(async () => databaseProof);
    const host = vi.fn(() => new Promise<never>(() => undefined));
    const stop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: child(host),
      disableDatabase: database,
    });
    const rejection = expect(stop()).rejects.toBeInstanceOf(
      GuardedCompanionEmergencyStopRehearsalUnavailableError,
    );
    await vi.advanceTimersByTimeAsync(12_001);
    await rejection;
    expect(database).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledTimes(1);
    await expect(stop()).rejects.toBeInstanceOf(
      GuardedCompanionEmergencyStopRehearsalUnavailableError,
    );
  });

  it('bounds a hanging database stop while still stopping the host once', async () => {
    vi.useFakeTimers();
    const database = vi.fn(() => new Promise<never>(() => undefined));
    const host = vi.fn(async () => hostProof);
    const stop = prepareGuardedCompanionEmergencyStopRehearsal({
      child: child(host),
      disableDatabase: database,
    });
    const rejection = expect(stop()).rejects.toBeInstanceOf(
      GuardedCompanionEmergencyStopRehearsalUnavailableError,
    );
    await vi.advanceTimersByTimeAsync(90_001);
    await rejection;
    expect(database).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledTimes(1);
  });

  it('rejects an unowned child or missing independent stop before either can run', () => {
    expect(() =>
      prepareGuardedCompanionEmergencyStopRehearsal({
        child: { ...child(async () => hostProof), processId: 0 },
        disableDatabase: async () => databaseProof,
      }),
    ).toThrow(GuardedCompanionEmergencyStopRehearsalUnavailableError);
    expect(() =>
      prepareGuardedCompanionEmergencyStopRehearsal({
        child: child(async () => hostProof),
        disableDatabase: undefined as never,
      }),
    ).toThrow(GuardedCompanionEmergencyStopRehearsalUnavailableError);
  });
});
