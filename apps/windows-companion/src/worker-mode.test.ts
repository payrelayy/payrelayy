import { describe, expect, it } from 'vitest';

import { shouldRunExactFiveLookup } from './worker-mode.js';

describe('companion worker mode', () => {
  it('keeps the no-money lookup available outside routine deposit mode', () => {
    expect(shouldRunExactFiveLookup(false)).toBe(true);
  });

  it('does not start the no-money lookup beside live routine deposits', () => {
    expect(shouldRunExactFiveLookup(true)).toBe(false);
  });
});
