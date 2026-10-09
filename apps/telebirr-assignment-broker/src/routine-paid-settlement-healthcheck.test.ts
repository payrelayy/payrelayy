import { describe, expect, it } from 'vitest';
import { settlementHeartbeatFresh } from './routine-paid-settlement-healthcheck.js';

describe('isolated paid settlement heartbeat', () => {
  it('accepts only a recent, exact millisecond timestamp', () => {
    const now = 1_791_544_000_000;
    expect(settlementHeartbeatFresh(`${now - 5_000}\n`, now)).toBe(true);
    expect(settlementHeartbeatFresh(`${now - 20_000}\n`, now)).toBe(true);
    expect(settlementHeartbeatFresh(`${now - 20_001}\n`, now)).toBe(false);
    expect(settlementHeartbeatFresh(`${now + 1}\n`, now)).toBe(false);
    expect(settlementHeartbeatFresh(`reference=${now}\n`, now)).toBe(false);
  });
});
