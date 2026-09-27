import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuardedCompanionOwnedChild } from './guarded-pre-permit-child.js';
import {
  GuardedCompanionExecutionSupervisorUnavailableError,
  prepareGuardedCompanionExecutionSupervisor,
} from './guarded-execution-supervisor.js';

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
const fixedTime = Date.parse('2026-09-27T12:00:00.000Z');

function childFixture() {
  let exit!: () => void;
  const stopped = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const stopAfterPermit = vi.fn(async () => {
    exit();
    return hostProof;
  });
  const child: GuardedCompanionOwnedChild = {
    processId: 411,
    stopped,
    stop: vi.fn(async () => undefined),
    stopAfterPermit,
  };
  return { child, exit, stopAfterPermit };
}

afterEach(() => vi.useRealTimers());

describe('source-only guarded execution supervisor', () => {
  it('rejects an unowned child before inspecting the database', () => {
    const query = vi.fn();
    expect(() =>
      prepareGuardedCompanionExecutionSupervisor({
        child: undefined as never,
        administrator: { query },
        activationEpoch: '7',
        disableDatabase: async () => databaseProof,
        trustedNow: () => new Date(),
      }),
    ).toThrow(GuardedCompanionExecutionSupervisorUnavailableError);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not stop or renew when the independent jobs are not ready', async () => {
    const owned = childFixture();
    const query = vi.fn(async () => ({ rows: [{ ready: false }] }));
    const disableDatabase = vi.fn(async () => databaseProof);
    const supervisor = prepareGuardedCompanionExecutionSupervisor({
      child: owned.child,
      administrator: { query },
      activationEpoch: '7',
      disableDatabase,
      trustedNow: () => new Date(),
    });
    await expect(supervisor.confirmReady()).rejects.toBeInstanceOf(
      GuardedCompanionExecutionSupervisorUnavailableError,
    );
    await expect(supervisor.lost).rejects.toBeInstanceOf(
      GuardedCompanionExecutionSupervisorUnavailableError,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(disableDatabase).not.toHaveBeenCalled();
    expect(owned.stopAfterPermit).not.toHaveBeenCalled();
  });

  it('arms the exact-child stop and renews the database lease before allowing a permit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime);
    const owned = childFixture();
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      if (sql.includes('cron.job_run_details')) return { rows: [{ ready: true }] };
      expect(values).toEqual(['7']);
      return { rows: [{ lease_expires_at: new Date(Date.now() + 45_000) }] };
    });
    const disableDatabase = vi.fn(async () => databaseProof);
    const supervisor = prepareGuardedCompanionExecutionSupervisor({
      child: owned.child,
      administrator: { query },
      activationEpoch: '7',
      disableDatabase,
      trustedNow: () => new Date(),
    });
    await supervisor.confirmReady();
    await supervisor.onActivated(new Date(fixedTime + 90 * 60_000).toISOString());
    expect(query).toHaveBeenCalledTimes(2);
    expect(disableDatabase).not.toHaveBeenCalled();
    const stopped = await supervisor.stopOnUncertainty();
    expect(stopped).toMatchObject({
      databaseCredentialsAndSessionsRevoked: true,
      financialAuthorityDisabled: true,
      exactHostStopped: true,
      providerOutcomeRequiresReconciliation: true,
    });
    await expect(supervisor.lost).rejects.toBeInstanceOf(
      GuardedCompanionExecutionSupervisorUnavailableError,
    );
    await expect(supervisor.stopOnUncertainty()).resolves.toEqual(stopped);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.stopAfterPermit).toHaveBeenCalledTimes(1);
  });

  it('automatically invokes the shared stop once when a later renewal fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime);
    const owned = childFixture();
    let renewals = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('cron.job_run_details')) return { rows: [{ ready: true }] };
      renewals += 1;
      if (renewals === 2) throw new Error('private database detail');
      return { rows: [{ lease_expires_at: new Date(Date.now() + 45_000) }] };
    });
    const disableDatabase = vi.fn(async () => databaseProof);
    const supervisor = prepareGuardedCompanionExecutionSupervisor({
      child: owned.child,
      administrator: { query },
      activationEpoch: '7',
      disableDatabase,
      trustedNow: () => new Date(),
    });
    await supervisor.confirmReady();
    await supervisor.onActivated(new Date(fixedTime + 90 * 60_000).toISOString());
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(supervisor.lost).rejects.toBeInstanceOf(
      GuardedCompanionExecutionSupervisorUnavailableError,
    );
    await expect(supervisor.stopOnUncertainty()).resolves.toMatchObject({
      exactHostStopped: true,
    });
    expect(renewals).toBe(2);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.stopAfterPermit).toHaveBeenCalledTimes(1);
  });

  it('deduplicates an exact-child exit and operator abort after activation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime);
    const owned = childFixture();
    const abort = new AbortController();
    const query = vi.fn(async (sql: string) =>
      sql.includes('cron.job_run_details')
        ? { rows: [{ ready: true }] }
        : { rows: [{ lease_expires_at: new Date(Date.now() + 45_000) }] },
    );
    const disableDatabase = vi.fn(async () => databaseProof);
    const supervisor = prepareGuardedCompanionExecutionSupervisor({
      child: owned.child,
      administrator: { query },
      activationEpoch: '7',
      disableDatabase,
      trustedNow: () => new Date(),
      signal: abort.signal,
    });
    await supervisor.confirmReady();
    await supervisor.onActivated(new Date(fixedTime + 90 * 60_000).toISOString());
    owned.exit();
    abort.abort();
    await expect(supervisor.stopOnUncertainty()).resolves.toMatchObject({
      companionExecutionDisabled: true,
    });
    await expect(supervisor.lost).rejects.toBeInstanceOf(
      GuardedCompanionExecutionSupervisorUnavailableError,
    );
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.stopAfterPermit).toHaveBeenCalledTimes(1);
  });

  it('stops on a failed initial post-activation lease renewal, without another try', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime);
    const owned = childFixture();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('cron.job_run_details')) return { rows: [{ ready: true }] };
      throw new Error('private renewal detail');
    });
    const disableDatabase = vi.fn(async () => databaseProof);
    const supervisor = prepareGuardedCompanionExecutionSupervisor({
      child: owned.child,
      administrator: { query },
      activationEpoch: '7',
      disableDatabase,
      trustedNow: () => new Date(),
    });
    await supervisor.confirmReady();
    await expect(
      supervisor.onActivated(new Date(fixedTime + 90 * 60_000).toISOString()),
    ).rejects.toBeInstanceOf(GuardedCompanionExecutionSupervisorUnavailableError);
    await expect(supervisor.stopOnUncertainty()).resolves.toMatchObject({
      financialAuthorityDisabled: true,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(disableDatabase).toHaveBeenCalledTimes(1);
    expect(owned.stopAfterPermit).toHaveBeenCalledTimes(1);
  });
});
