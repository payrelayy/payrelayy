import { describe, expect, it } from 'vitest';

import { formatTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';

import { renderPlayerRegistrationMenu, renderTelegramQuickMenu } from './private-menu.js';

const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
  compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
  token: '_____________________w',
});

describe('English-only private customer menu', () => {
  it('puts the guided TeleBirr deposit first and preserves the opaque Player ID action', () => {
    const menu = renderPlayerRegistrationMenu(callbackData);

    expect(menu).toEqual({
      text: 'FetanAgent\nSet a Player ID to deposit.',
      buttons: [
        { text: '💰 TeleBirr', callbackData: 'gd1.telebirr' },
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

  it('hides the manual-review entry only for the automatic Find menu', () => {
    expect(renderPlayerRegistrationMenu(callbackData, null, true).buttons).toEqual([
      { text: '💰 TeleBirr', callbackData: 'gd1.telebirr' },
      { text: '🎮 Set Player ID', callbackData: 'sp1.change' },
    ]);
  });

  it('shows a neutral, compact menu after cleanup without an expiry alert or unavailable action', () => {
    expect(renderTelegramQuickMenu()).toEqual({
      text: 'FetanAgent',
      buttons: [
        { text: '💰 TeleBirr', callbackData: 'gd1.telebirr' },
        { text: '🔄 Change Player ID', callbackData: 'sp1.change' },
      ],
    });
    expect(JSON.stringify(renderTelegramQuickMenu())).not.toMatch(/expir|withdraw|unavailable/iu);
  });

  it('shows both payment methods only when the SMS route is configured', () => {
    expect(renderPlayerRegistrationMenu(callbackData, null, true, true).buttons).toEqual([
      { text: '💰 TeleBirr', callbackData: 'gd1.telebirr' },
      { text: '💳 CBE Birr', callbackData: 'gd1.cbe' },
      { text: '🎮 Set Player ID', callbackData: 'sp1.change' },
    ]);
    expect(renderTelegramQuickMenu(true).buttons[1]).toEqual({
      text: '💳 CBE Birr',
      callbackData: 'gd1.cbe',
    });
  });
});
