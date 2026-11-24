import { describe, expect, it } from 'vitest';

import { inlineMenu, PLAY_BUTTON_TEXT, WITHDRAW_BUTTON_TEXT } from './telegram-action-menu.js';
import { TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA } from './telegram-guided-deposit.js';
import { KEMERBET_PLAY_LINK } from './telegram-play-link.js';

describe('Telegram verified Player action row', () => {
  it('shows Deposit, Play, Withdraw in order on one row', () => {
    const keyboard = inlineMenu([
      { text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA },
      { text: PLAY_BUTTON_TEXT, url: KEMERBET_PLAY_LINK },
      { text: WITHDRAW_BUTTON_TEXT, url: 'https://t.me/balem18' },
    ]);
    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: '💰 Deposit', callback_data: TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA },
        { text: PLAY_BUTTON_TEXT, url: KEMERBET_PLAY_LINK },
        { text: WITHDRAW_BUTTON_TEXT, url: 'https://t.me/balem18' },
      ],
    ]);
  });

  it('keeps Play out of an unverified Player menu', () => {
    const keyboard = inlineMenu([{ text: '➕ Add Player ID', callbackData: 'add' }]);
    expect(keyboard.inline_keyboard.flat().some((button) => button.text === PLAY_BUTTON_TEXT)).toBe(
      false,
    );
  });
});
