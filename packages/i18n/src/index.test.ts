import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, message, normalizeLocale } from './index.js';

describe('English-only locale support', () => {
  it.each([undefined, 'en', 'en-US', 'am', 'am-ET', 'fr', ''])(
    'normalizes %j to English',
    (languageCode) => {
      expect(normalizeLocale(languageCode)).toBe(DEFAULT_LOCALE);
    },
  );

  it('contains only the English message copy', () => {
    expect(message(DEFAULT_LOCALE, 'stageZero')).toMatch(/not available yet/i);
    expect(message(DEFAULT_LOCALE, 'addKemerBetPlayerId')).toBe('Add KemerBet Player ID');
  });
});
