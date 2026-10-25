import { describe, expect, it } from 'vitest';

import { formatTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';

import { renderPlayerRegistrationMenu, renderTelegramOutcomeActions } from './private-menu.js';

const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
  compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
  token: '_____________________w',
});

describe('English-only private customer menu', () => {
  it('puts one Deposit action first and preserves the opaque Player ID action', () => {
    const menu = renderPlayerRegistrationMenu(callbackData);

    expect(menu).toEqual({
      text: 'FetanAgent',
      buttons: [
        { text: '💰 Deposit', callbackData: 'gd1.deposit' },
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
      { text: '💰 Deposit', callbackData: 'gd1.deposit' },
      { text: '🎮 Set Player ID', callbackData: 'sp1.change' },
    ]);
  });

  it('shows the saved Player ID without explaining message routing', () => {
    expect(renderPlayerRegistrationMenu(callbackData, '28379330', true).text).toBe(
      'FetanAgent\nPlayer ID: 28379330',
    );
  });

  it('shows compact outcome actions without an expiry alert or unavailable action', () => {
    expect(renderTelegramOutcomeActions()).toEqual([
      { text: '💰 Deposit', callbackData: 'gd1.deposit' },
      { text: '🔄 Change Player ID', callbackData: 'sp1.change' },
    ]);
    expect(JSON.stringify(renderTelegramOutcomeActions())).not.toMatch(
      /expir|withdraw|unavailable/iu,
    );
  });

  it('keeps the menu provider-neutral when the SMS route is configured', () => {
    expect(renderPlayerRegistrationMenu(callbackData, null, true).buttons).toEqual([
      { text: '💰 Deposit', callbackData: 'gd1.deposit' },
      { text: '🎮 Set Player ID', callbackData: 'sp1.change' },
    ]);
    expect(renderTelegramOutcomeActions()[0]).toEqual({
      text: '💰 Deposit',
      callbackData: 'gd1.deposit',
    });
  });
});
