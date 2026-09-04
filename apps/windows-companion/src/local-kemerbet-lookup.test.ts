import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createLocalKemerBetLookupAuthorization } from './local-kemerbet-lookup.js';

describe('local KemerBet exact-five lookup boundary', () => {
  it('consumes one exact Player-ID authorization once and resets explicitly', () => {
    const authorization = createLocalKemerBetLookupAuthorization();
    expect(authorization.currentPlayerId()).toBeUndefined();
    authorization.begin('28379330');
    expect(authorization.currentPlayerId()).toBe('28379330');
    expect(authorization.consume('28379331')).toBe(false);
    expect(authorization.consume('28379330')).toBe(true);
    expect(authorization.currentPlayerId()).toBeUndefined();
    expect(authorization.consume('28379330')).toBe(false);
    authorization.clear();
    authorization.begin('28379331');
    expect(authorization.currentPlayerId()).toBe('28379331');
  });

  it('rejects nested or malformed authorization and contains no provider mutation endpoint', () => {
    const authorization = createLocalKemerBetLookupAuthorization();
    expect(() => authorization.begin('../28379330')).toThrow();
    authorization.begin('28379330');
    expect(() => authorization.begin('28379331')).toThrow();

    const source = readFileSync(new URL('./local-kemerbet-lookup.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('PlayerEPOSDeposit');
    expect(source).not.toContain('/Wallet/');
    expect(source).not.toMatch(/transfer\.click/iu);
    expect(source).not.toMatch(/amount\.fill/iu);
    expect(source).not.toMatch(/notes\.fill/iu);
  });
});
