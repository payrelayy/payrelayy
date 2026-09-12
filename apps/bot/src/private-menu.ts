import { parseTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';
import { DEFAULT_LOCALE, message } from '@fetanagent/i18n';

import {
  TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
} from './telegram-guided-deposit.js';

export interface PrivateTelegramMenuButton {
  readonly text: string;
  readonly callbackData: string;
}

export interface PrivateTelegramMenu {
  readonly text: string;
  readonly buttons: readonly PrivateTelegramMenuButton[];
}

/**
 * The privileged Player-ID action always uses the API-supplied opaque callback. The fixed deposit
 * callback below has no authority: it only opens a local reply prompt, and the completed input
 * still crosses the existing authenticated API and database boundary.
 */
export function renderPlayerRegistrationMenu(capabilityCallbackData: string): PrivateTelegramMenu {
  if (!parseTelegramPlayerRegistrationCapabilityCallback(capabilityCallbackData)) {
    throw new Error('The Player ID menu requires a valid opaque capability callback.');
  }

  return {
    text: TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT,
    buttons: [
      {
        text: TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT,
        callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
      },
      {
        text: message(DEFAULT_LOCALE, 'addKemerBetPlayerId'),
        callbackData: capabilityCallbackData,
      },
    ],
  };
}
