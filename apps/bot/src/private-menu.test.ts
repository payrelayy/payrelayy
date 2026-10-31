import { describe, expect, it } from 'vitest';

import { formatTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';

import { renderPlayerRegistrationMenu, renderTelegramOutcomeActions } from './private-menu.js';

const callbackData = formatTelegramPlayerRegistrationCapabilityCallback({
  compactCapabilityId: 'AAAAAAAAAAAAAAAAAAAAAA',
  token: '_____________________w',
});

describe('English-only private customer menu', () => {
  it('shows only Add Player ID before a Player is saved', () => {
    const menu = renderPlayerRegistrationMenu(callbackData);

    expect(menu).toEqual({
      text: 'FetanAgent',
      buttons: [{ text: '➕ Add Player ID', callbackData: 'sp1.change' }],
    });
    expect(Buffer.byteLength(menu.buttons[0]!.callbackData!, 'utf8')).toBeLessThanOrEqual(64);
    expect(JSON.stringify(menu)).not.toMatch(/Withdraw|withdrawal|language/i);
  });

  it('refuses to render a static or malformed action callback', () => {
    expect(() => renderPlayerRegistrationMenu('start:player-registration')).toThrow(
      'valid opaque capability callback',
    );
  });

  it('shows the saved Player ID with Deposit followed by manual Withdraw', () => {
    expect(renderPlayerRegistrationMenu(callbackData, '28379330').text).toBe(
      'FetanAgent\nPlayer ID: 28379330\nWithdrawals are handled manually. Tap Withdraw to chat with the handler; no request is submitted here.',
    );
    expect(renderPlayerRegistrationMenu(callbackData, '28379330').buttons).toEqual([
      { text: '💰 Deposit', callbackData: 'gd1.deposit' },
      { text: '💸 Withdraw', url: 'https://owner.fetanagent.com/v1/public/withdrawal-chat' },
    ]);
  });

  it('shows compact outcome actions without an expiry alert or unavailable action', () => {
    expect(renderTelegramOutcomeActions()).toEqual([
      { text: '💰 Deposit', callbackData: 'gd1.deposit' },
    ]);
    expect(JSON.stringify(renderTelegramOutcomeActions())).not.toMatch(
      /expir|withdraw|unavailable/iu,
    );
  });

  it('keeps the menu provider-neutral when the SMS route is configured', () => {
    expect(renderPlayerRegistrationMenu(callbackData).buttons).toEqual([
      { text: '➕ Add Player ID', callbackData: 'sp1.change' },
    ]);
    expect(renderTelegramOutcomeActions()[0]).toEqual({
      text: '💰 Deposit',
      callbackData: 'gd1.deposit',
    });
  });
});
