import { describe, expect, it } from 'vitest';

import { formatTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';

import { renderPlayerRegistrationMenu } from './private-menu.js';

const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
  compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
  token: '_____________________w',
});

describe('English-only private customer menu', () => {
  it('puts the guided TeleBirr deposit first and preserves the opaque Player ID action', () => {
    const menu = renderPlayerRegistrationMenu(callbackData);

    expect(menu).toEqual({
      text: [
        'What would you like to do?',
        '',
        'For a TeleBirr deposit, tap Deposit and follow the short prompt.',
        'Staging test: do not send new money. Nothing will be credited or moved.',
      ].join('\n'),
      buttons: [
        { text: '💰 Deposit with TeleBirr', callbackData: 'gd1.telebirr' },
        { text: 'Add KemerBet Player ID', callbackData },
      ],
    });
    expect(Buffer.byteLength(menu.buttons[0]!.callbackData, 'utf8')).toBeLessThanOrEqual(64);
    expect(JSON.stringify(menu)).not.toMatch(/withdrawal|language/i);
  });

  it('refuses to render a static or malformed action callback', () => {
    expect(() => renderPlayerRegistrationMenu('start:player-registration')).toThrow(
      'valid opaque capability callback',
    );
  });
});
