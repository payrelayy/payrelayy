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
        'To deposit, tap 💰 Deposit with TeleBirr.',
        'The bot will ask for your KemerBet Player ID and TeleBirr transaction number.',
        'Automatic credit is not enabled yet.',
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
