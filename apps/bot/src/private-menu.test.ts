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
        'Welcome to FetanAgent 👋',
        '',
        'Deposit from TeleBirr to your selected KemerBet Player ID.',
        'Choose an option below.',
        '',
        'No Player ID saved yet.',
      ].join('\n'),
      buttons: [
        { text: '💰 Make a deposit', callbackData: 'gd1.telebirr' },
        { text: '🎮 Set Player ID', callbackData: 'sp1.change' },
        { text: '➕ Request Player ID review', callbackData },
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
