import { describe, expect, it } from 'vitest';

import { createSerializedPostgresLane } from './serialized-postgres-lane.js';

describe('single-client PostgreSQL lane', () => {
  it('runs overlapping operations one at a time, including after a failure', async () => {
    const lane = createSerializedPostgresLane();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = lane.run(async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
      throw new Error('redacted failure');
    });
    const second = lane.run(async () => {
      order.push('second');
      return 2;
    });
    await Promise.resolve();
    expect(order).toEqual(['first-start']);
    releaseFirst?.();
    await expect(first).rejects.toThrow('redacted failure');
    await expect(second).resolves.toBe(2);
    await lane.drain();
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
