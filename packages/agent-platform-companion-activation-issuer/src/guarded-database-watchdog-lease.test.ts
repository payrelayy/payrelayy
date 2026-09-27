import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GuardedDatabaseWatchdogLeaseUnavailableError,
  prepareGuardedDatabaseWatchdogLease,
} from './guarded-database-watchdog-lease.js';

afterEach(() => vi.useRealTimers());

describe('internal database watchdog lease', () => {
  it('rejects invalid activation epochs without querying the database', () => {
    const query = vi.fn();
    for (const activationEpoch of ['0', '-1', '01', '9223372036854775808']) {
      expect(() =>
        prepareGuardedDatabaseWatchdogLease({
          administrator: { query },
          activationEpoch,
          trustedNow: () => new Date(),
        }),
      ).toThrow(GuardedDatabaseWatchdogLeaseUnavailableError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when the exact Cron jobs are not recently healthy', async () => {
    const query = vi.fn(async () => ({ rows: [{ ready: false }] }));
    const lease = prepareGuardedDatabaseWatchdogLease({
      administrator: { query },
      activationEpoch: '7',
      trustedNow: () => new Date(),
    });
    await expect(lease.confirmReady()).rejects.toBeInstanceOf(
      GuardedDatabaseWatchdogLeaseUnavailableError,
    );
    await expect(lease.lost).rejects.toBeInstanceOf(GuardedDatabaseWatchdogLeaseUnavailableError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('cron.job_run_details');
    expect(query.mock.calls[0]?.[1]).toEqual([]);
    await expect(
      lease.onActivated(new Date(Date.now() + 60_000).toISOString()),
    ).rejects.toBeInstanceOf(GuardedDatabaseWatchdogLeaseUnavailableError);
  });

  it('renews the exact epoch before permit, then reports a later missed heartbeat', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    let renewals = 0;
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      if (sql.includes('cron.job_run_details')) {
        expect(values).toEqual([]);
        return { rows: [{ ready: true }] };
      }
      expect(sql).toContain('renew_agent_platform_companion_execution_watchdog');
      expect(values).toEqual(['7']);
      renewals += 1;
      if (renewals === 2) throw new Error('private database detail');
      return { rows: [{ lease_expires_at: new Date(Date.now() + 45_000) }] };
    });
    const lease = prepareGuardedDatabaseWatchdogLease({
      administrator: { query },
      activationEpoch: '7',
      trustedNow: () => new Date(),
    });
    await lease.confirmReady();
    const hardExpiry = new Date(Date.now() + 30 * 60_000).toISOString();
    await lease.onActivated(hardExpiry);
    expect(renewals).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(lease.lost).rejects.toBeInstanceOf(GuardedDatabaseWatchdogLeaseUnavailableError);
    expect(renewals).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(renewals).toBe(2);
  });

  it('never accepts a renewal deadline outside the reviewed 45-second lease', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    const query = vi.fn(async (sql: string) =>
      sql.includes('cron.job_run_details')
        ? { rows: [{ ready: true }] }
        : { rows: [{ lease_expires_at: new Date(Date.now() + 60_000) }] },
    );
    const lease = prepareGuardedDatabaseWatchdogLease({
      administrator: { query },
      activationEpoch: '7',
      trustedNow: () => new Date(),
    });
    await lease.confirmReady();
    await expect(
      lease.onActivated(new Date(Date.now() + 30 * 60_000).toISOString()),
    ).rejects.toBeInstanceOf(GuardedDatabaseWatchdogLeaseUnavailableError);
    await expect(lease.lost).rejects.toBeInstanceOf(GuardedDatabaseWatchdogLeaseUnavailableError);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
