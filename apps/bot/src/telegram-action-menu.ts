import { InlineKeyboard } from 'grammy';

import {
  TELEGRAM_GUIDED_CBE_CALLBACK_DATA,
  TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA,
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
} from './telegram-guided-deposit.js';
import type { PrivateTelegramMenuButton } from './private-menu.js';

export const PLAY_BUTTON_TEXT = '▶️ Play';
export const WITHDRAW_BUTTON_TEXT = '💸 Withdraw';

export function isDepositMenuButton(button: PrivateTelegramMenuButton): boolean {
  return (
    button.callbackData === TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA ||
    button.callbackData === TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA ||
    button.callbackData === TELEGRAM_GUIDED_CBE_CALLBACK_DATA
  );
}

/** Keep the three verified-Player actions on one row in Deposit, Play, Withdraw order. */
export function inlineMenu(buttons: readonly PrivateTelegramMenuButton[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [index, button] of buttons.entries()) {
    const previous = buttons[index - 1];
    if (
      index > 0 &&
      !(button.text === PLAY_BUTTON_TEXT && !!previous && isDepositMenuButton(previous)) &&
      !(
        button.text === WITHDRAW_BUTTON_TEXT &&
        !!previous &&
        (previous.text === PLAY_BUTTON_TEXT || isDepositMenuButton(previous))
      )
    )
      keyboard.row();
    if (button.url === undefined) keyboard.text(button.text, button.callbackData);
    else keyboard.url(button.text, button.url);
  }
  return keyboard;
}
