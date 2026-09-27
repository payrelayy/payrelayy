import { describe, expect, it, vi } from 'vitest';

import {
  acquireGuardedOperatorLifecycleLock,
  GuardedOperatorLifecycleLockUnavailableError,
} from './guarded-operator-lifecycle-lock.js';

function administrator(query: ReturnType<typeof vi.fn>) {
  return { processID: 417, query, on: vi.fn(), off: vi.fn() };
}

describe('protected operator session lock', () => {
  it('acquires and releases one nonblocking lock on the same dedicated backend', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: true }] });
    const client = administrator(query);
    const lock = await acquireGuardedOperatorLifecycleLock(client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([1178682452, 1329885472, 417]);
    expect(query.mock.calls[0]?.[0]).toContain('pg_catalog.pg_try_advisory_lock');
    expect(query.mock.calls[0]?.[0]).toContain("session_user = 'postgres'");
    expect(query.mock.calls[0]?.[0]).toContain('not exists');
    expect(query.mock.calls[0]?.[0]).toContain('held.objsubid = 2');
    expect(client.on).toHaveBeenCalledTimes(2);
    await lock.release();
    expect(query.mock.calls[1]?.[1]).toEqual(query.mock.calls[0]?.[1]);
    expect(query.mock.calls[1]?.[0]).toContain('pg_catalog.pg_advisory_unlock');
    expect(client.off).toHaveBeenCalledTimes(2);
    await expect(lock.release()).rejects.toBeInstanceOf(
      GuardedOperatorLifecycleLockUnavailableError,
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects a pooled query facade without one backend process identity', async () => {
    const query = vi.fn();
    await expect(acquireGuardedOperatorLifecycleLock({ query } as never)).rejects.toBeInstanceOf(
      GuardedOperatorLifecycleLockUnavailableError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('never waits on another operator or proceeds after a denied lock', async () => {
    const query = vi.fn(async () => ({ rows: [{ acquired: false }] }));
    await expect(acquireGuardedOperatorLifecycleLock(administrator(query))).rejects.toBeInstanceOf(
      GuardedOperatorLifecycleLockUnavailableError,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports a lost or mismatched release without a second unlock attempt', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: false }] });
    const lock = await acquireGuardedOperatorLifecycleLock(administrator(query));
    await expect(lock.release()).rejects.toBeInstanceOf(
      GuardedOperatorLifecycleLockUnavailableError,
    );
    await expect(lock.release()).rejects.toBeInstanceOf(
      GuardedOperatorLifecycleLockUnavailableError,
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('signals an unexpectedly ended dedicated connection to the operator', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ acquired: true }] });
    const client = administrator(query);
    const lock = await acquireGuardedOperatorLifecycleLock(client);
    const onEnd = client.on.mock.calls.find((call) => call[0] === 'end')?.[1] as
      (() => void) | undefined;
    expect(onEnd).toBeTypeOf('function');
    onEnd?.();
    await expect(lock.lost).rejects.toBeInstanceOf(GuardedOperatorLifecycleLockUnavailableError);
  });
});
