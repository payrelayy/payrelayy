import { describe, expect, it } from 'vitest';

import { shouldRunExactFiveLookup, shouldRunPlayerValidation } from './worker-mode.js';

describe('companion worker mode', () => {
  it('keeps the no-money lookup available outside routine deposit mode', () => {
    expect(shouldRunExactFiveLookup(false)).toBe(true);
  });

  it('does not start the no-money lookup beside live routine deposits', () => {
    expect(shouldRunExactFiveLookup(true)).toBe(false);
  });

  it('replaces exact-five with single-Player validation only in the opt-in no-money mode', () => {
    expect(shouldRunExactFiveLookup(false, true)).toBe(false);
    expect(shouldRunPlayerValidation(false, false, true)).toBe(true);
    expect(shouldRunPlayerValidation(false, false, false)).toBe(false);
  });

  it('never starts Player validation beside either financial execution mode', () => {
    expect(shouldRunPlayerValidation(true, false, true)).toBe(false);
    expect(shouldRunPlayerValidation(false, true, true)).toBe(false);
    expect(shouldRunPlayerValidation(true, true, true)).toBe(false);
  });
});
