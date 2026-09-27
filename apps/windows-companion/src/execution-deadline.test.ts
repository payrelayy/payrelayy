import { describe, expect, it } from 'vitest';

import { selectGuardedExecutionDeadline } from './execution-deadline.js';

describe('guarded execution deadline', () => {
  const now = Date.parse('2026-09-27T12:00:00.000Z');

  it('uses the earlier database deadline when the signed handoff lasts longer', () => {
    expect(selectGuardedExecutionDeadline(now + 12 * 60 * 60_000, now + 90 * 60_000, now)).toBe(
      now + 90 * 60_000,
    );
  });

  it('uses the earlier handoff deadline when it ends first', () => {
    expect(selectGuardedExecutionDeadline(now + 30 * 60_000, now + 90 * 60_000, now)).toBe(
      now + 30 * 60_000,
    );
  });

  it('rejects missing, expired, malformed, and overlong database authority', () => {
    for (const databaseDeadline of [undefined, now, now - 1, Number.NaN, now + 3 * 60 * 60_000]) {
      expect(() =>
        selectGuardedExecutionDeadline(now + 12 * 60 * 60_000, databaseDeadline, now),
      ).toThrow('The guarded execution deadline is unavailable.');
    }
    expect(() => selectGuardedExecutionDeadline(now, now + 90 * 60_000, now)).toThrow();
  });
});
