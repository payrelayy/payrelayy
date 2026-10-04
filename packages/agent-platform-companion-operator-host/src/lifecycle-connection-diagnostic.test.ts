import { describe, expect, it, vi } from 'vitest';
import {
  ACQUIRE_SQL,
  RELEASE_SQL,
} from '@fetanagent/agent-platform-companion-activation-issuer/guarded-operator-lifecycle-lock';
import {
  inspectLifecycleConnection,
  OPERATOR_BACKEND_SQL,
} from './lifecycle-connection-diagnostic.js';

function fixture(failure?: 'backend' | 'acquire' | 'denied' | 'release') {
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql === OPERATOR_BACKEND_SQL) {
      expect(values).toEqual([]);
      if (failure === 'backend') throw new Error('private connection material');
      return { rows: [{ backend_pid: 417 }] };
    }
    expect(values).toEqual([1178682452, 1329885472, 417]);
    if (sql === ACQUIRE_SQL) {
      if (failure === 'acquire') throw new Error('private SQL or connection material');
      return { rows: [{ acquired: failure !== 'denied' }] };
    }
    if (sql === RELEASE_SQL) {
      if (failure === 'release') throw new Error('private cleanup material');
      return { rows: [{ released: true }] };
    }
    throw new Error('Unexpected operation');
  });
  return { query, on: vi.fn(), off: vi.fn() };
}

describe('non-executing first-query connection diagnostic', () => {
  it('uses the actual backend and the exact existing acquire/release statements once', async () => {
    const connection = fixture();
    expect(await inspectLifecycleConnection(connection)).toBe('ready');
    expect(connection.query.mock.calls.map(([sql]) => sql)).toEqual([
      OPERATOR_BACKEND_SQL,
      ACQUIRE_SQL,
      RELEASE_SQL,
    ]);
    expect(connection.on).toHaveBeenCalledTimes(2);
    expect(connection.off).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['backend', 'backend_binding', 1],
    ['acquire', 'lifecycle_lock', 2],
    ['denied', 'lifecycle_lock', 2],
    ['release', 'lifecycle_lock_release', 3],
  ] as const)('reports %s without private data or retries', async (failure, phase, count) => {
    const connection = fixture(failure);
    const result = await inspectLifecycleConnection(connection);
    expect(result).toBe(phase);
    expect(result).not.toContain('private');
    expect(connection.query).toHaveBeenCalledTimes(count);
  });

  it.each([0, undefined, '417', 4.5])(
    'rejects an invalid backend before acquiring a lock: %s',
    async (backend_pid) => {
      const connection = fixture();
      connection.query.mockResolvedValueOnce({ rows: [{ backend_pid }] } as never);
      expect(await inspectLifecycleConnection(connection)).toBe('backend_binding');
      expect(connection.query).toHaveBeenCalledTimes(1);
    },
  );
});
