import { describe, expect, it } from 'vitest';

import { formatTelegramPlayerRegistrationCapabilityCallback } from '@payreplayy/contracts';

import { renderPlayerRegistrationMenu } from './private-menu.js';

const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
  compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
  token: '_____________________w',
});

describe('English-only private Player ID menu', () => {
  it('renders only the approved Player ID action from an API-supplied opaque callback', () => {
    const menu = renderPlayerRegistrationMenu(callbackData);

    expect(menu).toEqual({
      text: 'Add your KemerBet Player ID to PayReplayy.',
      buttons: [{ text: 'Add KemerBet Player ID', callbackData }],
    });
    expect(JSON.stringify(menu)).not.toMatch(/deposit|withdrawal|language/i);
  });

  it('refuses to render a static or malformed action callback', () => {
    expect(() => renderPlayerRegistrationMenu('start:player-registration')).toThrow(
      'valid opaque capability callback',
    );
  });
});
