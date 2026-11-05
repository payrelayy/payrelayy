import { describe, expect, it } from 'vitest';

import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR, ETB_SCALE, EtbAmount } from './money.js';

describe('FetanAgent deposit amount policy', () => {
  it('accepts the inclusive per-deposit 25–25,000 ETB boundaries', () => {
    expect(DEPOSIT_MINIMUM_MINOR).toBe(25 * ETB_SCALE);
    expect(DEPOSIT_MAXIMUM_MINOR).toBe(25_000 * ETB_SCALE);
    expect(EtbAmount.fromMinor(DEPOSIT_MINIMUM_MINOR).isWithinDepositLimits()).toBe(true);
    expect(EtbAmount.fromMinor(DEPOSIT_MAXIMUM_MINOR).isWithinDepositLimits()).toBe(true);
  });

  it('rejects only amounts outside the configured per-deposit range', () => {
    expect(EtbAmount.fromMinor(DEPOSIT_MINIMUM_MINOR - 1).isWithinDepositLimits()).toBe(false);
    expect(EtbAmount.fromMinor(DEPOSIT_MAXIMUM_MINOR + 1).isWithinDepositLimits()).toBe(false);
  });
});
